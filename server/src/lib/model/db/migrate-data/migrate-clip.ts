import { IConnection } from 'mysql2Types';
import { getConfig } from '../../../../config-helper';
import { AWS } from '../../../aws';
import { rateLimit } from './aws-rate-limit';
import { ClipData } from './fetch-s3-data';

async function fetchSentenceFromS3(glob: string): Promise<string> {
  return (await AWS.getS3()
    .getObject({ Bucket: getConfig().BUCKET_NAME, Key: glob + '.txt' })
    .promise()).Body.toString();
}

export async function migrateClip(
  connection: IConnection,
  clip: ClipData,
  print: any
) {
  const insertClip = (sentenceText: string) =>
    connection.execute(
      'INSERT INTO clips (client_id, original_sentence_id, path, sentence) VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE id = id',
      [clip.client_id, clip.original_sentence_id, clip.path, sentenceText]
    );

  const [[sentence]] = (await connection.query(
    'SELECT * FROM sentences WHERE id = ?',
    [clip.original_sentence_id]
  )) as any;

  if (sentence) {
    await insertClip(sentence.text);
    return;
  }

  await rateLimit();

  try {
    const sentenceText = await fetchSentenceFromS3(
      clip.path.substr(0, clip.path.length - 4)
    );

    if (sentenceText) {
      await connection.execute(
        'INSERT INTO sentences (id, text, is_used) VALUES (?, ?, FALSE) ON DUPLICATE KEY UPDATE is_used = FALSE',
        [clip.original_sentence_id, sentenceText]
      );
      await insertClip(sentenceText);
    }
  } catch (e) {
    print(
      'error while getting sentence',
      clip.original_sentence_id,
      'for clip',
      clip.path,
      ':',
      e
    );
  }
}

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
});
const bucket = () => process.env.S3_BUCKET ?? 'tuheng-private';
const storageDeadline = () => ({ abortSignal: AbortSignal.timeout(90_000) });
export async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e;
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket() }));
    } catch (err) {
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes((err as Error).name))
        throw err;
    }
  }
}
export async function putObject(key: string, body: Buffer, mime: string) {
  await client.send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime }),
    storageDeadline(),
  );
}
export async function getObject(key: string) {
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    storageDeadline(),
  );
  if (!res.Body) throw new Error('ASSET_UNREADABLE');
  return Buffer.from(await res.Body.transformToByteArray());
}
export async function deleteObject(key: string) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }), storageDeadline());
}
export async function copyObject(source: string, target: string) {
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: target,
      CopySource: [bucket(), ...source.split('/')].map(encodeURIComponent).join('/'),
    }),
    storageDeadline(),
  );
}
export async function storageHealth() {
  await client.send(new HeadBucketCommand({ Bucket: bucket() }));
  return true;
}

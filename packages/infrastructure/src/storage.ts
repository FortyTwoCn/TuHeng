import { isIP } from 'node:net';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';

function envFlag(value: string | undefined, fallback: boolean) {
  switch (value?.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
      return true;
    case '0':
    case 'false':
    case 'no':
      return false;
    default:
      return fallback;
  }
}
const bucket = () => process.env.S3_BUCKET ?? 'tuheng-private';
const forcePathStyle = () => envFlag(process.env.S3_FORCE_PATH_STYLE, true);

function httpBase(value: string | undefined) {
  const raw = value?.trim();
  if (!raw || !/^https?:\/\//i.test(raw) || /[?#\\]/.test(raw)) return null;
  const url = URL.parse(raw);
  return url && !url.username && !url.password ? url : null;
}
function withoutTrailingSlash(url: URL) {
  return url.origin + url.pathname.replace(/\/+$/, '');
}
export function isS3PublicAccessEnabled() {
  return envFlag(process.env.S3_PUBLIC_ACCESS, false);
}
export function getS3ReadBaseUrl() {
  const explicit = process.env.S3_PUBLIC_READ_BASE_URL?.trim();
  if (explicit) {
    const url = httpBase(explicit);
    return url ? withoutTrailingSlash(url) : null;
  }
  const endpoint = httpBase(process.env.S3_ENDPOINT);
  if (!endpoint) return null;
  const name = bucket();
  if (!name || name === '.' || name === '..') return null;
  if (forcePathStyle()) return withoutTrailingSlash(endpoint) + '/' + encodeURIComponent(name);
  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) ||
    isIP(endpoint.hostname.replace(/^\[|\]$/g, ''))
  )
    return null;
  endpoint.hostname = name + '.' + endpoint.hostname;
  return withoutTrailingSlash(endpoint);
}
export function resolvePublicObjectUrl(objectKey: string): string | null {
  if (!isS3PublicAccessEnabled()) return null;
  const base = getS3ReadBaseUrl();
  const parts = objectKey.split('/');
  if (!base || !objectKey || parts.some((part) => part === '.' || part === '..')) return null;
  return base + '/' + parts.map(encodeURIComponent).join('/');
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: forcePathStyle(),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
});
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
async function readObject(key: string) {
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    storageDeadline(),
  );
  if (!res.Body) throw new Error('ASSET_UNREADABLE');
  return { body: res.Body, length: res.ContentLength };
}
export async function getObject(key: string) {
  const { body } = await readObject(key);
  return Buffer.from(await body.transformToByteArray());
}
export async function readAuthorizedObject(key: string, allowPublicRead: boolean) {
  const location = allowPublicRead ? resolvePublicObjectUrl(key) : null;
  if (location) return { location };
  const { body, length } = await readObject(key);
  return { stream: body.transformToWebStream(), length };
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

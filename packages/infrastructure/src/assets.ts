import { database } from '@tuheng/database';
import { inspectImage, preprocess } from '@tuheng/image-pipeline';
import { canReadAsset, ensure, audit, type Actor } from '@tuheng/domain';
import { putObject, getObject, deleteObject } from './storage';
export async function uploadAsset(
  a: Actor,
  file: { name: string; bytes: Buffer; mime: string },
  purpose: string,
) {
  ensure(
    file.bytes.length > 0 && file.bytes.length <= Number(process.env.UPLOAD_MAX_BYTES ?? 15728640),
    'UPLOAD_SIZE_LIMIT',
    413,
  );
  ensure(
    ['QUESTION', 'REFERENCE', 'SUBMISSION', 'DOCUMENT'].includes(purpose),
    'INVALID_ASSET_PURPOSE',
  );
  let mime: string,
    width: number | null = null,
    height: number | null = null;
  if (file.bytes.subarray(0, 5).toString() === '%PDF-') {
    ensure(purpose !== 'SUBMISSION', 'SUBMISSION_MUST_BE_IMAGE');
    mime = 'application/pdf';
  } else {
    try {
      const info = await inspectImage(file.bytes);
      mime = info.mime;
      width = info.width;
      height = info.height;
    } catch {
      throw new Error('INVALID_IMAGE_CONTENT');
    }
  }
  const key = `private/${a.id}/${crypto.randomUUID()}`;
  await putObject(key, file.bytes, mime);
  try {
    const asset = await database.create('storedAsset', {
      ownerId: a.id,
      objectKey: key,
      name: file.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200),
      mime,
      bytes: file.bytes.length,
      width,
      height,
      purpose,
    });
    await audit(database, a, 'ASSET_UPLOADED', asset.id, { mime, bytes: file.bytes.length });
    return { id: asset.id, name: asset.name, mime };
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
}
export async function downloadAsset(a: Actor, id: string) {
  const asset = await canReadAsset(database, a, id);
  return { asset, buffer: await getObject(asset.objectKey) };
}
export async function transformAsset(
  a: Actor,
  id: string,
  options: Parameters<typeof preprocess>[1],
) {
  const asset = await database.get('storedAsset', id);
  ensure(asset?.ownerId === a.id, 'ASSET_FORBIDDEN', 403);
  ensure(
    !(await database.list('submissionAsset', { assetId: id })).length,
    'SUBMITTED_ASSET_IMMUTABLE',
  );
  const p = await preprocess(await getObject(asset.objectKey), options);
  const key = `private/${a.id}/${crypto.randomUUID()}`;
  await putObject(key, p.buffer, p.mime);
  return database.create('storedAsset', {
    ownerId: a.id,
    objectKey: key,
    name: asset.name,
    mime: p.mime,
    bytes: p.buffer.length,
    width: p.width,
    height: p.height,
    purpose: asset.purpose,
    parentId: id,
    transform: p.record,
  });
}

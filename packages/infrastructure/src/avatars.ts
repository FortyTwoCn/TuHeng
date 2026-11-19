import sharp from 'sharp';
import { database, prisma } from '@tuheng/database';
import {
  AssetArchiveContext,
  AvatarCrop,
  avatarCropBox,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PIXELS,
} from '@tuheng/contracts';
import {
  archiveAssetKey,
  archiveScope,
  audit,
  DomainError,
  ensure,
  type Actor,
} from '@tuheng/domain';
import { assetChecksum, currentResourceActor } from './assets';
import { getObject, putObject } from './storage';

const discardLater = () => new Date(Date.now() + 24 * 3600_000);

async function avatarImages(bytes: Buffer, crop: AvatarCrop) {
  const image = sharp(bytes, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: 'error' });
  const meta = await image.metadata().catch(() => null);
  ensure(
    meta?.width &&
      meta.height &&
      meta.width * meta.height <= AVATAR_MAX_PIXELS &&
      ['jpeg', 'png', 'webp'].includes(meta.format ?? '') &&
      (meta.pages ?? 1) === 1,
    'INVALID_AVATAR_IMAGE',
  );
  // Normalize EXIF orientation and re-encode with Sharp's metadata-stripping defaults.
  const format = meta.format as 'jpeg' | 'png' | 'webp';
  const original = await image
    .autoOrient()
    .toFormat(format)
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new DomainError('INVALID_AVATAR_IMAGE');
    });
  const { width, height } = original.info;
  const { edge, left, top } = avatarCropBox(width, height, crop);
  const makeVariant = (size: number) =>
    sharp(original.data)
      .extract({ left, top, width: edge, height: edge })
      .resize(size, size)
      .webp({ quality: 86 })
      .toBuffer();
  const [small, large] = await Promise.all([makeVariant(128), makeVariant(512)]);
  return [
    { variant: 'original', width, height, mime: 'image/' + format, buffer: original.data },
    { variant: 'small', width: 128, height: 128, mime: 'image/webp', buffer: small },
    { variant: 'large', width: 512, height: 512, mime: 'image/webp', buffer: large },
  ] as const;
}

export async function replaceAvatar(
  actor: Actor,
  expectedRevision: number,
  bytes: Buffer,
  input: unknown,
) {
  ensure(bytes.length > 0 && bytes.length <= AVATAR_MAX_BYTES, 'AVATAR_SIZE_LIMIT', 413);
  const crop = AvatarCrop.parse(input);
  const images = await avatarImages(bytes, crop);
  const versionId = crypto.randomUUID();
  const uploads = await database.transaction(async (tx) => {
    const a = await currentResourceActor(tx, actor);
    const account = await tx.get('user', a.id);
    ensure(account?.avatarRevision === expectedRevision, 'AVATAR_CHANGED', 409);
    const variants = [];
    for (const { variant, width, height, mime, buffer } of images) {
      const context = {
        kind: 'AVATAR',
        schoolId: a.schoolId,
        userId: a.id,
        versionId,
        variant,
      } as const;
      const id = variant === 'original' ? versionId : crypto.randomUUID();
      const objectKey = archiveAssetKey(context, id, mime);
      await tx.create('storedAsset', {
        id,
        ownerId: a.id,
        name: `avatar-${variant}`,
        purpose: 'AVATAR',
        storageContext: context,
        ...archiveScope(context),
        objectKey,
        state: 'WRITING',
        parentId: variant === 'original' ? null : versionId,
        width,
        height,
        mime,
        bytes: buffer.length,
        checksum: assetChecksum(buffer),
        discardAfter: discardLater(),
      });
      variants.push({ id, objectKey, mime, buffer });
    }
    return variants;
  });
  await Promise.all(
    uploads.map(({ objectKey, buffer, mime }) => putObject(objectKey, buffer, mime)),
  );
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    const changed = await tx.user.updateMany({
      where: {
        id: actor.id,
        active: true,
        avatarRevision: expectedRevision,
        tokenVersion: actor.tokenVersion,
      },
      data: { avatarAssetId: versionId, avatarRevision: { increment: 1 } },
    });
    ensure(changed.count, 'AVATAR_CHANGED', 409);
    const ready = await tx.storedAsset.updateMany({
      where: {
        id: { in: uploads.map(({ id }) => id) },
        ownerId: user.id,
        purpose: 'AVATAR',
        state: 'WRITING',
      },
      data: { state: 'ARCHIVED', discardAfter: null },
    });
    ensure(ready.count === uploads.length, 'ASSET_UNAVAILABLE', 409);
    if (user.avatarAssetId)
      await tx.storedAsset.updateMany({
        where: {
          ownerId: user.id,
          purpose: 'AVATAR',
          OR: [{ id: user.avatarAssetId }, { parentId: user.avatarAssetId }],
        },
        data: { discardAfter: discardLater() },
      });
    await tx.auditLog.create({
      data: { actorId: user.id, action: 'AVATAR_REPLACED', resourceId: versionId, details: {} },
    });
    return { avatarAssetId: versionId, avatarRevision: expectedRevision + 1 };
  });
}

export async function removeAvatar(actor: Actor, expectedRevision: number) {
  return database.transaction(async (tx) => {
    const a = await currentResourceActor(tx, actor);
    const user = await tx.get('user', a.id);
    ensure(user?.avatarRevision === expectedRevision, 'AVATAR_CHANGED', 409);
    if (!user.avatarAssetId) return { avatarAssetId: null, avatarRevision: expectedRevision };
    const variants = await tx.list('storedAsset', {
      ownerId: a.id,
      parentId: user.avatarAssetId,
      purpose: 'AVATAR',
    });
    const discardAfter = discardLater();
    await tx.update('user', a.id, { avatarAssetId: null, avatarRevision: expectedRevision + 1 });
    for (const id of [user.avatarAssetId, ...variants.map((asset) => asset.id)])
      await tx.update('storedAsset', id, { discardAfter });
    await audit(tx, a, 'AVATAR_REMOVED', user.avatarAssetId);
    return { avatarAssetId: null, avatarRevision: expectedRevision + 1 };
  });
}

export async function avatarImage(actor: Actor, version: string, size: 'small' | 'large') {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { avatar: true },
  });
  const original = user?.avatar;
  ensure(
    original?.id === version &&
      original.ownerId === actor.id &&
      original.purpose === 'AVATAR' &&
      original.state === 'ARCHIVED',
    'AVATAR_NOT_FOUND',
    404,
  );
  const context = AssetArchiveContext.parse(original.storageContext);
  ensure(
    context.kind === 'AVATAR' && context.userId === actor.id && context.versionId === version,
    'AVATAR_NOT_FOUND',
    404,
  );
  const objectKey = archiveAssetKey({ ...context, variant: size }, version, 'image/webp');
  const asset = await prisma.storedAsset.findUnique({ where: { objectKey } });
  ensure(
    asset?.ownerId === actor.id &&
      asset.parentId === version &&
      asset.state === 'ARCHIVED' &&
      asset.purpose === 'AVATAR' &&
      asset.mime === 'image/webp',
    'AVATAR_NOT_FOUND',
    404,
  );
  return getObject(asset.objectKey);
}

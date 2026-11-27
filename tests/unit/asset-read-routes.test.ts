import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { archiveAssetKey, DomainError, type Actor } from '@tuheng/domain';
import { GET as assetGet } from '../../apps/web/app/api/assets/[id]/route';
import { GET as avatarGet } from '../../apps/web/app/api/profile/avatar/route';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  user: vi.fn(),
  storedAsset: vi.fn(),
}));
vi.mock('../../apps/web/lib/auth', () => ({ actor: mocks.actor }));
vi.mock('@tuheng/database', () => ({
  database: { get: mocks.get, list: mocks.list },
  prisma: { user: { findUnique: mocks.user }, storedAsset: { findUnique: mocks.storedAsset } },
}));

const owner: Actor = {
  id: 'owner',
  name: '学生',
  kind: 'STUDENT',
  roles: ['STUDENT'],
  schoolId: 'school',
};
const asset = {
  id: 'edit',
  ownerId: owner.id,
  storageSchoolId: owner.schoolId,
  purpose: 'DOCUMENT',
  state: 'ARCHIVED',
  parentId: 'original',
  objectKey: 'folder/编辑 #1.png',
  name: '编辑 #1.png',
  mime: 'image/png',
};
const publicBase = 'https://assets.example.test/tuheng';
const getAsset = (proxy = '') =>
  assetGet(new Request('https://app.example.test/api/assets/edit?realm=STUDENT' + proxy), {
    params: Promise.resolve({ id: asset.id }),
  });

beforeEach(() => {
  vi.stubEnv('S3_PUBLIC_ACCESS', 'false');
  vi.stubEnv('S3_PUBLIC_READ_BASE_URL', publicBase + '/');
  mocks.actor.mockResolvedValue(owner);
  mocks.get.mockResolvedValue(asset);
  mocks.list.mockResolvedValue([]);
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({
    Body: { transformToWebStream: () => new Response('image').body },
    ContentLength: 5,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('authorized browser resource reads', () => {
  it.each(['false', 'true'])(
    'checks session and school scope before reading or redirecting (%s)',
    async (flag) => {
      vi.stubEnv('S3_PUBLIC_ACCESS', flag);
      mocks.actor.mockRejectedValueOnce(new DomainError('UNAUTHENTICATED', 401));
      const unsigned = await getAsset();
      expect(unsigned.status).toBe(401);
      expect(unsigned.headers.has('Location')).toBe(false);
      expect(mocks.get).not.toHaveBeenCalled();
      mocks.actor.mockResolvedValue({ ...owner, schoolId: 'another-school' });
      const outsideSchool = await getAsset();
      expect(outsideSchool.status).toBe(403);
      expect(outsideSchool.headers.has('Location')).toBe(false);
      expect(S3Client.prototype.send).not.toHaveBeenCalled();
    },
  );

  it('streams private files with the existing headers', async () => {
    const response = await getAsset();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe('image');
  });

  it('redirects an authorized edit without fetching from storage and supports proxy=1', async () => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    const response = await getAsset();
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(
      publicBase + '/folder/%E7%BC%96%E8%BE%91%20%231.png',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
    expect(await (await getAsset('&proxy=1')).text()).toBe('image');
  });

  it.each([
    { parentId: null },
    { mime: 'application/pdf' },
    { purpose: 'GRADING_PROCESSED' },
    { state: 'ARCHIVING' },
  ])('serves private resources by proxy in public mode (%j)', async (override) => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    mocks.get.mockResolvedValue({ ...asset, ...override });
    const response = await getAsset();
    expect(response.status).toBe(200);
    expect(response.headers.has('Location')).toBe(false);
  });

  it('retains owner-only staged reads and refuses unfinished writes', async () => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    mocks.get.mockResolvedValueOnce({ ...asset, state: 'STAGED', uploadSessionId: 'upload' });
    mocks.get.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 1000), cancelledAt: null });
    expect((await getAsset()).status).toBe(200);
    mocks.get.mockResolvedValueOnce({ ...asset, state: 'WRITING' });
    expect((await getAsset()).status).toBe(403);
  });

  it('uses the same external base for the authorized current avatar variant', async () => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    const version = '2d6bc368-213f-44bd-9316-c2354c03c7c8';
    const context = {
      kind: 'AVATAR',
      variant: 'original',
      versionId: version,
      schoolId: 'school',
      userId: owner.id,
    } as const;
    const objectKey = archiveAssetKey({ ...context, variant: 'small' }, version, 'image/webp');
    const url =
      'https://app.example.test/api/profile/avatar?realm=STUDENT&version=' +
      version +
      '&size=small';
    mocks.user.mockResolvedValue({
      avatar: {
        id: version,
        ownerId: owner.id,
        purpose: 'AVATAR',
        state: 'ARCHIVED',
        storageContext: context,
      },
    });
    mocks.storedAsset.mockResolvedValue({
      ownerId: owner.id,
      parentId: version,
      purpose: 'AVATAR',
      state: 'ARCHIVED',
      mime: 'image/webp',
      objectKey,
    });
    const response = await avatarGet(new Request(url));
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(publicBase + '/' + objectKey);
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
    expect((await avatarGet(new Request(url + '&proxy=1'))).status).toBe(200);
    mocks.actor.mockResolvedValue({ ...owner, id: 'another-user' });
    expect((await avatarGet(new Request(url))).status).toBe(404);
  });
});

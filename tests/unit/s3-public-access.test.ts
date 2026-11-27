import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ configure: vi.fn(), send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (original) => ({
  ...(await original<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = mocks.send;
    constructor(config: unknown) {
      mocks.configure(config);
    }
  },
}));

import {
  getS3ReadBaseUrl,
  isS3PublicAccessEnabled,
  resolvePublicObjectUrl,
} from '../../packages/infrastructure/src/storage';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('S3 browser read URLs', () => {
  it.each([undefined, 'false', 'no', '0'])('keeps storage private with %s', (flag) => {
    vi.stubEnv('S3_PUBLIC_ACCESS', flag);
    vi.stubEnv('S3_PUBLIC_READ_BASE_URL', 'https://assets.example.test');
    expect(isS3PublicAccessEnabled()).toBe(false);
    expect(resolvePublicObjectUrl('album/photo.png')).toBeNull();
  });

  it.each(['1', 'TrUe', ' YES '])(
    'encodes object keys under an explicit read base with %s',
    (flag) => {
      vi.stubEnv('S3_PUBLIC_ACCESS', flag);
      vi.stubEnv('S3_PUBLIC_READ_BASE_URL', ' https://assets.example.test/objects/tuheng/// ');
      vi.stubEnv('S3_ENDPOINT', 'http://127.0.0.1:9000');
      expect(isS3PublicAccessEnabled()).toBe(true);
      expect(getS3ReadBaseUrl()).toBe('https://assets.example.test/objects/tuheng');
      expect(resolvePublicObjectUrl('图纸/剖面 #2+?.png')).toBe(
        'https://assets.example.test/objects/tuheng/%E5%9B%BE%E7%BA%B8/%E5%89%96%E9%9D%A2%20%232%2B%3F.png',
      );
      expect(resolvePublicObjectUrl('drawing/../preview.png')).toBeNull();
    },
  );

  it('derives a public address from the endpoint and bucket when no external base is given', () => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    vi.stubEnv('S3_PUBLIC_READ_BASE_URL', '');
    vi.stubEnv('S3_ENDPOINT', 'https://store.example.test/prefix/');
    vi.stubEnv('S3_BUCKET', 'test-bucket');
    vi.stubEnv('S3_FORCE_PATH_STYLE', undefined);
    expect(resolvePublicObjectUrl('a/b.png')).toBe(
      'https://store.example.test/prefix/test-bucket/a/b.png',
    );
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'false');
    expect(resolvePublicObjectUrl('a/b.png')).toBe(
      'https://test-bucket.store.example.test/prefix/a/b.png',
    );
    vi.stubEnv('S3_ENDPOINT', undefined);
    expect(resolvePublicObjectUrl('a/b.png')).toBeNull();
  });

  it.each([
    'ftp://assets.example.test',
    'https://',
    'https://user@assets.example.test',
    'https://assets.example.test?query=1',
  ])('falls back to proxy when an explicit base is invalid (%s)', (base) => {
    vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
    vi.stubEnv('S3_PUBLIC_READ_BASE_URL', base);
    vi.stubEnv('S3_ENDPOINT', 'https://store.example.test');
    expect(resolvePublicObjectUrl('a/b.png')).toBeNull();
  });

  it.each([
    [undefined, true],
    ['no', false],
  ] as const)(
    'configures the signed client with path-style %s and uploads without an ACL',
    async (value, expected) => {
      vi.resetModules();
      vi.stubEnv('S3_FORCE_PATH_STYLE', value);
      vi.stubEnv('S3_ENDPOINT', 'https://write.example.test');
      vi.stubEnv('S3_PUBLIC_ACCESS', 'true');
      vi.stubEnv('S3_PUBLIC_READ_BASE_URL', 'https://read.example.test');
      vi.stubEnv('S3_BUCKET', 'test-bucket');
      const { putObject } = await import('../../packages/infrastructure/src/storage');
      await putObject('preview.webp', Buffer.from('test'), 'image/webp');
      expect(mocks.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://write.example.test',
          forcePathStyle: expected,
        }),
      );
      const [command] = mocks.send.mock.calls[0];
      expect(command.input).toMatchObject({ Bucket: 'test-bucket', Key: 'preview.webp' });
      expect(command.input).not.toHaveProperty('ACL');
    },
  );
});

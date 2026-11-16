import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { guardedFetch, resolveOutbound } from '../../packages/infrastructure/src/outbound';
import { trustedClientNetworkKey } from '../../apps/web/lib/http';
afterEach(() => vi.unstubAllEnvs());
it('rejects internal addresses, unsafe schemes and untrusted IP spoofing', async () => {
  vi.stubEnv('TUHENG_OUTBOUND_ALLOWLIST', '');
  await expect(resolveOutbound('127.0.0.1', 443, 'AI')).rejects.toThrow(
    'OUTBOUND_ADDRESS_FORBIDDEN',
  );
  await expect(resolveOutbound('169.254.169.254', 443, 'AI')).rejects.toThrow(
    'OUTBOUND_ADDRESS_FORBIDDEN',
  );
  await expect(guardedFetch('http://example.com')).rejects.toThrow('OUTBOUND_TLS_REQUIRED');
  await expect(guardedFetch('https://user:password@example.com')).rejects.toThrow(
    'INVALID_PROVIDER_URL',
  );
  vi.stubEnv('TUHENG_TRUST_PROXY_IP', '0');
  expect(trustedClientNetworkKey(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('unknown');
  vi.stubEnv('TUHENG_TRUST_PROXY_IP', '1');
  expect(trustedClientNetworkKey(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8');
  expect(trustedClientNetworkKey(new Headers({ 'x-real-ip': '8.8.8.8,127.0.0.1' }))).toBe(
    'unknown',
  );
});
it('pins an allowlisted local peer but refuses redirects and oversized responses', async () => {
  let targetHits = 0;
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' });
      res.end();
    } else if (req.url === '/large') {
      res.writeHead(200, { 'content-length': String(5 * 1024 * 1024) });
      res.end();
    } else {
      targetHits++;
      res.end('ok');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  vi.stubEnv('TUHENG_OUTBOUND_ALLOWLIST', '127.0.0.1:' + port);
  try {
    await expect(guardedFetch('http://127.0.0.1:' + port + '/redirect')).rejects.toThrow();
    expect(targetHits).toBe(0);
    await expect(
      guardedFetch('http://127.0.0.1:' + port + '/large', { signal: AbortSignal.timeout(2000) }),
    ).rejects.toThrow('PROVIDER_RESPONSE_TOO_LARGE');
    expect(await (await guardedFetch('http://127.0.0.1:' + port + '/ok')).text()).toBe('ok');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

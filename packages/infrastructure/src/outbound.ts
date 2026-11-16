import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';
import { ensure } from '@tuheng/domain';

export function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
export function explicitlyAllowed(host: string, port: number) {
  return (process.env.TUHENG_OUTBOUND_ALLOWLIST ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(`${host.toLowerCase()}:${port}`);
}
export async function resolveOutbound(host: string, port: number, purpose: 'AI' | 'SMTP') {
  ensure(!/[\s/@\\?#]/.test(host), 'INVALID_OUTBOUND_HOST');
  const allowed = explicitlyAllowed(host, port);
  ensure(
    allowed || (purpose === 'AI' ? port === 443 : [465, 587].includes(port)),
    'OUTBOUND_PORT_FORBIDDEN',
  );
  const addresses = await lookup(host.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
  ensure(
    addresses.length && (allowed || addresses.every((a) => isPublicAddress(a.address))),
    'OUTBOUND_ADDRESS_FORBIDDEN',
  );
  return addresses;
}
export const guardedFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  ensure(!url.username && !url.password && !url.hash && !url.search, 'INVALID_PROVIDER_URL');
  ensure(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' && explicitlyAllowed(url.hostname, port)),
    'OUTBOUND_TLS_REQUIRED',
  );
  const addresses = await resolveOutbound(url.hostname, port, 'AI');
  // Pin the verified DNS answer for this connection; never re-resolve after checking.
  const address = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    },
  });
  try {
    const response = await fetch(url, { ...init, redirect: 'error', dispatcher } as RequestInit);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 4 * 1024 * 1024) {
      // Release the connection immediately instead of waiting for a rejected body's timeout.
      await response.body?.cancel();
      throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
        }
        chunks.push(part.value);
      }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    await dispatcher.close();
  }
};

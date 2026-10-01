import { createHash, randomBytes } from 'node:crypto';

/** Snapshot JPEG main stream (channel 101) via ISAPI. */
export const HIKVISION_SNAPSHOT_URI = '/ISAPI/Streaming/channels/101/picture';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Parse `key="value"` / `key=value` dari header Digest (WWW-Authenticate maupun Authorization). */
export function parseDigestParams(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  return out;
}

// ponytail: MD5 + qop=auth saja (default Hikvision); tambah SHA-256 bila kamera lain memintanya.
export function buildDigestAuth(opts: {
  method: string;
  uri: string;
  username: string;
  password: string;
  challenge: string;
  nc?: string;
  cnonce?: string;
}): string {
  const c = parseDigestParams(opts.challenge);
  const nc = opts.nc ?? '00000001';
  const cnonce = opts.cnonce ?? randomBytes(8).toString('hex');
  const qop = c.qop?.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : undefined;
  const ha1 = md5(`${opts.username}:${c.realm}:${opts.password}`);
  const ha2 = md5(`${opts.method}:${opts.uri}`);
  const response = qop
    ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);

  const parts = [
    `username="${opts.username}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${opts.uri}"`,
    `response="${response}"`,
  ];
  if (c.opaque) parts.push(`opaque="${c.opaque}"`);
  if (c.algorithm) parts.push(`algorithm=${c.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

/** Ambil snapshot JPEG dari kamera Hikvision. Throw bila auth/HTTP/content-type/timeout gagal. */
export async function fetchHikvisionSnapshot(
  host: string,
  creds: { username: string; password: string; timeoutMs: number }
): Promise<Buffer> {
  const url = `http://${host}${HIKVISION_SNAPSHOT_URI}`;
  const signal = AbortSignal.timeout(creds.timeoutMs);

  let res = await fetch(url, { signal });
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate') ?? '';
    await res.arrayBuffer();
    if (!/^digest/i.test(challenge)) {
      throw new Error(`kamera meminta auth non-digest: ${challenge || '(kosong)'}`);
    }
    res = await fetch(url, {
      signal,
      headers: {
        Authorization: buildDigestAuth({
          method: 'GET',
          uri: HIKVISION_SNAPSHOT_URI,
          username: creds.username,
          password: creds.password,
          challenge,
        }),
      },
    });
  }

  if (!res.ok) throw new Error(`kamera membalas HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('image/jpeg')) {
    throw new Error(`content-type bukan image/jpeg: ${type || '(kosong)'}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/** Token link chia sẻ: 16 byte ~128 bit, base64url (mục 12.C). */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Băm mật khẩu link bằng scrypt (Node built-in — mục 12.C). Lưu "salt:hash". */
export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Token phiên khi mở khoá mật khẩu (mục 12.E). HMAC-SHA256 tự ký, không state
 * server, không thêm dependency jsonwebtoken. Định dạng: base64url(payload).sig
 */
export function signShareSession(
  token: string,
  secret: string,
  ttlSeconds = 1800,
): string {
  const payload = { t: token, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyShareSession(
  sessionToken: string | undefined,
  token: string,
  secret: string,
): boolean {
  if (!sessionToken) return false;
  const [body, sig] = sessionToken.split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      t: string;
      exp: number;
    };
    return payload.t === token && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

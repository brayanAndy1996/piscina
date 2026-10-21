import { randomBytes, scrypt, timingSafeEqual, createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$65536$8$2$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$65536$8$2' ||
      !/^[a-f0-9]{32}$/.test(parts[4] ?? '') || !/^[a-f0-9]{64}$/.test(parts[5] ?? '')) return false;
  const expected = Buffer.from(parts[5]!, 'hex');
  return timingSafeEqual(expected, await derive(password, Buffer.from(parts[4]!, 'hex')));
}
export function canReplaceDevice(expiresAt: number | null, now: number): boolean {
  return expiresAt === null || now >= expiresAt;
}
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function signingKey(encoded: string): KeyObject {
  try {
    const key = createPrivateKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error();
    return key;
  } catch { throw new Error('Configura API_OFFLINE_PRIVATE_KEY con una clave Ed25519 válida.'); }
}
export function publicKeyHex(key: KeyObject): string {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
}
export function signPayload(key: KeyObject, payload: string): string { return sign(null, Buffer.from(payload, 'utf8'), key).toString('hex'); }
export function verifyDevice(publicKey: string, message: string, signature: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/.test(publicKey) || !/^[a-f0-9]{128}$/.test(signature)) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

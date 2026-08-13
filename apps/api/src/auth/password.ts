export const PASSWORD_ITERATIONS = 600_000;
export const PASSWORD_MIN_BYTES = 12;
export const PASSWORD_MAX_BYTES = 256;

export interface PasswordDigest {
  hash: string;
  salt: string;
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<PasswordDigest> {
  validatePassword(password);
  const passwordSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const passwordSaltBuffer = Uint8Array.from(passwordSalt);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits'
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: passwordSaltBuffer, iterations: PASSWORD_ITERATIONS },
    key,
    256
  );
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt: bytesToBase64Url(passwordSalt) };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string): Promise<boolean> {
  try {
    const actual = await hashPassword(password, base64UrlToBytes(salt));
    return timingSafeEqual(actual.hash, expectedHash);
  } catch {
    return false;
  }
}

export function validatePassword(password: string): void {
  const bytes = new TextEncoder().encode(password).byteLength;
  if (bytes < PASSWORD_MIN_BYTES || bytes > PASSWORD_MAX_BYTES) {
    throw new Error('密码必须为 12–256 UTF-8 字节');
  }
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

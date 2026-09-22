import { randomBytes, scrypt as _scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// Server-only password hashing. Format matches the versioned scheme documented
// on the users table: `scrypt$N$r$p$salt$hash` (base64url segments).

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, DEFAULT_PARAMS);
  return [
    "scrypt",
    DEFAULT_PARAMS.N,
    DEFAULT_PARAMS.r,
    DEFAULT_PARAMS.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!n || !r || !p || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  try {
    const key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * Password hashing for the self-hosted identity layer.
 *
 * New passwords are stored as `pbkdf2$<iterations>$<salt-b64url>$<hash-b64url>`
 * (PBKDF2-HMAC-SHA512 via WebCrypto — available in both Node and edge runtimes,
 * unlike node:crypto scrypt which is stubbed in some Worker runtimes).
 *
 * Imported accounts may carry a legacy bcrypt hash (`$2a$`/`$2b$`/`$2y$…`, with
 * or without a `bcrypt$` prefix). Those verify through bcryptjs and are
 * transparently upgraded to PBKDF2 on the next successful sign-in.
 */
import bcrypt from "bcryptjs";

const ITERATIONS = 210_000;
const KEY_BITS = 512;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-512" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Hash a new password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Verify a password against a stored hash.
 * `needsUpgrade` is true when the stored hash is a legacy format that should be
 * rewritten with `hashPassword` after a successful sign-in.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!stored) return { ok: false, needsUpgrade: false };

  if (stored.startsWith("pbkdf2$")) {
    const [, iterations, salt, hash] = stored.split("$");
    if (!iterations || !salt || !hash) return { ok: false, needsUpgrade: false };
    const computed = await pbkdf2(password, fromB64url(salt), Number(iterations));
    const ok = timingSafeEqual(computed, fromB64url(hash));
    return { ok, needsUpgrade: ok && Number(iterations) < ITERATIONS };
  }

  // Legacy / imported bcrypt, with or without the `bcrypt$` version prefix.
  const bcryptHash = stored.startsWith("bcrypt$") ? stored.slice("bcrypt$".length) : stored;
  if (/^\$2[aby]?\$/.test(bcryptHash)) {
    try {
      const ok = await bcrypt.compare(password, bcryptHash);
      return { ok, needsUpgrade: ok };
    } catch {
      return { ok: false, needsUpgrade: false };
    }
  }

  return { ok: false, needsUpgrade: false };
}

const WEAK = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein1",
  "welcome1",
  "iloveyou",
  "admin123",
  "atsiq123",
  "changeme",
]);

/** Server-side password policy. Returns a human message when unacceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (WEAK.has(password.toLowerCase())) return "That password is too common — choose another.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}

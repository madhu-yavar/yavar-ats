import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption for long-lived credentials stored in Postgres (OAuth
 * refresh tokens, AI keys, the capture token). A database dump must not yield
 * live credentials, so values are AES-256-GCM encrypted under
 * SECRET_ENCRYPTION_KEY (32 bytes, base64 or hex).
 *
 * Wire format: "enc:v1.<iv b64>.<ciphertext b64>.<tag b64>"
 * Values without that prefix pass through untouched, so deployment can add
 * the key and encrypt lazily on the next write of each secret.
 */

const PREFIX = "enc:v1.";
let cachedKey: Buffer | null | undefined;
let warned = false;

function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env["SECRET_ENCRYPTION_KEY"]?.trim();
  if (!raw) {
    cachedKey = null;
    return null;
  }
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be 32 bytes (base64 or hex) — generate one with `openssl rand -base64 32`.",
    );
  }
  cachedKey = buf;
  return buf;
}

export function encryptionEnabled(): boolean {
  return key() !== null;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) {
    if (!warned) {
      warned = true;
      console.warn(
        "SECRET_ENCRYPTION_KEY is not set — credentials are being stored unencrypted. Set it (openssl rand -base64 32) and re-save each credential.",
      );
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${ct.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptSecret(stored: string | null | undefined): string {
  const value = stored ?? "";
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext
  const k = key();
  if (!k) {
    console.error("Found an encrypted credential but SECRET_ENCRYPTION_KEY is not set.");
    return "";
  }
  try {
    const [ivB64, ctB64, tagB64] = value.slice(PREFIX.length).split(".");
    if (!ivB64 || !ctB64 || !tagB64) return "";
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return ""; // wrong key or tampered value — never surface partial plaintext
  }
}

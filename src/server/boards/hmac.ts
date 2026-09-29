/**
 * Signature verification for board webhook deliveries (Indeed's
 * X-Indeed-Signature and Naukri's shared-secret header). Constant-time
 * comparison, fail-closed on any malformed input.
 */
import { createHmac, timingSafeEqual } from "crypto";

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 hex digest of `body` keyed by `secret`, compared to `expected`. */
export function verifyHexHmacSha256(secret: string, body: string, expected: string): boolean {
  if (!secret || !expected) return false;
  // Be liberal about case and an optional algorithm prefix ("sha256=ab12…").
  const cleaned = expected
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(cleaned)) return false;
  const actual = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return constantTimeEqual(actual, cleaned);
}

/** HMAC-SHA256 base64 digest variant (some boards sign base64). */
export function verifyBase64HmacSha256(secret: string, body: string, expected: string): boolean {
  if (!secret || !expected) return false;
  const cleaned = expected.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return false;
  const actual = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return constantTimeEqual(actual, cleaned);
}

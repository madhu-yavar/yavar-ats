import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless, HMAC-signed action tokens (email confirmation etc.) — no table
// needed. Signed with SESSION_SECRET; carrying an expiry inside the payload.

const b64u = (b: Buffer) => b.toString("base64url");

export type ActionTokenPurpose = "email-confirm";

function signature(payload: string): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return b64u(createHmac("sha256", secret).update(payload).digest());
}

export function signActionToken(
  userId: string,
  purpose: ActionTokenPurpose,
  ttlMs: number,
): string {
  const payload = b64u(Buffer.from(JSON.stringify({ u: userId, p: purpose, e: Date.now() + ttlMs })));
  return `${payload}.${signature(payload)}`;
}

export function verifyActionToken(
  token: string,
  purpose: ActionTokenPurpose,
): { userId: string } | null {
  if (!token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = signature(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: unknown;
      p?: unknown;
      e?: unknown;
    };
    if (
      parsed.p !== purpose ||
      typeof parsed.u !== "string" ||
      typeof parsed.e !== "number" ||
      parsed.e < Date.now()
    ) {
      return null;
    }
    return { userId: parsed.u };
  } catch {
    return null;
  }
}

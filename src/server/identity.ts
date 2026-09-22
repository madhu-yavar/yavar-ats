import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, gt } from "drizzle-orm";

import { db } from "./db";
import { sessions, users } from "@db/schema";

/**
 * Self-hosted identity layer: the `atsiq_session` httpOnly cookie is resolved
 * against the sessions table on every server-function call (7-day sliding
 * window). There is no external token service in this path.
 */

export const SESSION_COOKIE = "atsiq_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// node:crypto is imported lazily: this module is (transitively) parsed by the
// client bundle for middleware introspection, and must never pull node builtins.
async function hashToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

/** Create a DB-backed session; returns the raw cookie token (never stored). */
export async function createSession(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    userId,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export function sessionCookie(token: string): string {
  const secure = process.env["PUBLIC_SITE_URL"]?.startsWith("https") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function destroySession(request: Request): Promise<void> {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(raw)));
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Validate the cookie against the sessions table; returns the user identity. */
async function resolveSession(request: Request): Promise<{ userId: string; email: string } | null> {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw || raw.length < 32) return null;
  const [row] = await db
    .select({ userId: sessions.userId, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await hashToken(raw)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/**
 * Authn for every server function: the httpOnly session cookie, validated
 * against the sessions table. Everything downstream (requireOrg/requireRole/…)
 * is unchanged.
 */
export const requireIdentity = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const session = request ? await resolveSession(request) : null;

  if (!session) throw new Error("Unauthorized: please sign in again.");
  return next({
    context: {
      userId: session.userId,
      claims: { sub: session.userId, email: session.email, email_verified: true } as Record<
        string,
        unknown
      >,
      via: "session" as const,
    },
  });
});

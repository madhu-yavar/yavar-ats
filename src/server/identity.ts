import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { and, eq, gt } from "drizzle-orm";

import { db } from "./db";
import { sessions, users } from "@db/schema";

/**
 * Identity layer for the cookie-session era.
 *
 * Authn resolution order for every server function:
 *   1. `atsiq_session` httpOnly cookie → sessions table (7-day sliding window)
 *   2. Supabase-compatible JWT bearer (the legacy path, kept for one release)
 *
 * The JWT path exists so an old client bundle cannot lock anyone out; the
 * cookie is what the sign-in flow establishes and what a browser rely on.
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

/** Verify a Supabase-compatible JWT the same way the legacy middleware does. */
async function resolveJwt(
  request: Request,
): Promise<{ userId: string; email: string; claims: Record<string, unknown> } | null> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const authHeader = request.headers.get("authorization");
  if (!supabaseUrl || !supabaseKey || !authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (token.split(".").length !== 3) return null;
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = (data?.claims ?? {}) as Record<string, unknown>;
  if (error || !claims["sub"]) return null;
  return {
    userId: String(claims["sub"]),
    email: typeof claims["email"] === "string" ? claims["email"] : "",
    claims,
  };
}

/**
 * Replacement for requireSupabaseAuth: same context shape ({ userId, claims }),
 * cookie session first, JWT bearer second. Everything downstream
 * (requireOrg/requireRole/…) is unchanged.
 */
export const requireIdentity = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const session = request ? await resolveSession(request) : null;

  let identity: { userId: string; claims: Record<string, unknown>; via: "session" | "jwt" } | null =
    null;
  if (session) {
    identity = {
      userId: session.userId,
      claims: { sub: session.userId, email: session.email, email_verified: true },
      via: "session",
    };
  } else {
    const jwt = request ? await resolveJwt(request) : null;
    if (jwt) identity = { userId: jwt.userId, claims: jwt.claims, via: "jwt" };
  }
  if (!identity) throw new Error("Unauthorized: No authorization header provided");
  return next({ context: identity });
});

/** Establish a cookie session from an already-verified bearer JWT. */
export async function exchangeTokenForSession(
  request: Request,
): Promise<{ ok: true; cookie: string; userId: string; email: string } | { ok: false }> {
  const jwt = await resolveJwt(request);
  if (!jwt) return { ok: false };
  const email =
    jwt.email ||
    (
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, jwt.userId))
        .limit(1)
    )[0]?.email ||
    "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const token = await createSession(jwt.userId, {
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  return { ok: true, cookie: sessionCookie(token), userId: jwt.userId, email };
}

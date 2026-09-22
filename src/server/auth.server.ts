/**
 * Self-hosted identity: sign-up, sign-in, email confirmation and password
 * reset, all against the project's own Postgres. No external auth service.
 *
 * Invariants:
 *  - passwords only ever leave this module as hashes (see ./password)
 *  - tokens are single-use, hashed at rest, and expire
 *  - sign-in answers are deliberately generic: the response never reveals
 *    whether an address exists
 *  - every refusal and every privileged transition is audited
 */
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { authTokens, loginAttempts, sessions, users } from "@db/schema";
import { createSession, sessionCookie } from "./identity";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { redactEmail, writeAudit } from "./audit";
import { workEmailProblem } from "../lib/work-email";
import { sendTemplateEmail } from "../lib/email-templates/send-email";

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 8;
const MAX_FAILURES_PER_IP = 30;

export type AuthResult =
  | { ok: true; cookie?: string; message?: string }
  | { ok: false; error: string; status: number };

export function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

async function randomToken(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(32).toString("base64url");
}

async function recentFailures(field: "email" | "ip", value: string): Promise<number> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(field === "email" ? loginAttempts.email : loginAttempts.ip, value),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

async function recordAttempt(email: string, ip: string | null, success: boolean): Promise<void> {
  try {
    await db.insert(loginAttempts).values({ email, ip, success });
  } catch (e) {
    console.error("[auth] could not record the sign-in attempt", e);
  }
}

/** Issue a single-use email token and return the raw value for the link. */
async function issueToken(userId: string, purpose: "confirm" | "reset"): Promise<string> {
  const raw = await randomToken();
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: await sha256(raw),
    expiresAt: new Date(Date.now() + (purpose === "confirm" ? CONFIRM_TTL_MS : RESET_TTL_MS)),
  });
  return raw;
}

/** Atomically consume a token: the UPDATE itself is the guard (no TOCTOU). */
async function consumeToken(
  raw: string,
  purpose: "confirm" | "reset",
): Promise<{ userId: string } | null> {
  if (!raw || raw.length < 20) return null;
  const rows = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, await sha256(raw)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId });
  return rows[0] ?? null;
}

async function mail(
  template: "auth-confirm" | "auth-reset",
  to: string,
  data: Record<string, unknown>,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const res = await sendTemplateEmail(template, to, { templateData: data });
    return { sent: res.sent };
  } catch (e) {
    console.error("[auth] email send failed", template, redactEmail(to), e);
    return { sent: false, error: e instanceof Error ? e.message : "Email could not be sent." };
  }
}

/* --------------------------------------------------------------- sign-up */

export async function signUp(input: {
  email: unknown;
  password: unknown;
  fullName?: unknown;
  origin: string;
  ip: string | null;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const password = String(input.password ?? "");
  const fullName = String(input.fullName ?? "").trim() || null;

  const emailProblem = workEmailProblem(email);
  if (emailProblem) return { ok: false, error: emailProblem, status: 400 };
  const pwProblem = passwordProblem(password);
  if (pwProblem) return { ok: false, error: pwProblem, status: 400 };

  const [existing] = await db
    .select({ id: users.id, confirmedAt: users.emailConfirmedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Never disclose registration state: an existing address gets the same
  // answer, and a confirmation resend if it is still unconfirmed.
  if (existing) {
    if (!existing.confirmedAt) {
      const token = await issueToken(existing.id, "confirm");
      await mail("auth-confirm", email, {
        siteName: "ATSIQ",
        siteUrl: input.origin,
        recipient: email,
        confirmationUrl: `${input.origin}/api/auth/confirm?token=${token}`,
      });
    }
    return {
      ok: true,
      message: "Check your inbox — we have sent a link to confirm your work email.",
    };
  }

  const [created] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), fullName })
    .returning({ id: users.id });
  if (!created) return { ok: false, error: "Could not create the account.", status: 500 };

  const token = await issueToken(created.id, "confirm");
  const sent = await mail("auth-confirm", email, {
    siteName: "ATSIQ",
    siteUrl: input.origin,
    recipient: email,
    confirmationUrl: `${input.origin}/api/auth/confirm?token=${token}`,
  });

  await writeAudit({
    actor: email,
    actorUserId: created.id,
    action: "auth.signup",
    entityType: "user",
    entityId: created.id,
    detail: { emailed: sent.sent, ip: input.ip },
  });

  return {
    ok: true,
    message: sent.sent
      ? "Check your inbox — we have sent a link to confirm your work email."
      : "Account created, but the confirmation email could not be sent. Ask your administrator to resend it.",
  };
}

/* --------------------------------------------------------------- sign-in */

export async function signIn(input: {
  email: unknown;
  password: unknown;
  ip: string | null;
  userAgent: string | null;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const password = String(input.password ?? "");
  const generic = "Email or password is incorrect.";

  if (!email || !password) return { ok: false, error: generic, status: 400 };

  if (
    (await recentFailures("email", email)) >= MAX_FAILURES_PER_EMAIL ||
    (input.ip && (await recentFailures("ip", input.ip)) >= MAX_FAILURES_PER_IP)
  ) {
    await writeAudit({
      actor: email,
      action: "auth.signin.throttled",
      detail: { ip: input.ip },
    });
    return {
      ok: false,
      error: "Too many attempts — wait a few minutes before trying again.",
      status: 429,
    };
  }

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      confirmedAt: users.emailConfirmedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const verdict = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !verdict.ok) {
    await recordAttempt(email, input.ip, false);
    await writeAudit({ actor: email, action: "auth.signin.failed", detail: { ip: input.ip } });
    return { ok: false, error: generic, status: 401 };
  }

  if (!user.confirmedAt) {
    await recordAttempt(email, input.ip, false);
    return {
      ok: false,
      error: "Confirm your work email first — check your inbox for the link we sent.",
      status: 403,
    };
  }

  if (verdict.needsUpgrade) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
  }

  const token = await createSession(user.id, { ip: input.ip, userAgent: input.userAgent });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAttempt(email, input.ip, true);

  return { ok: true, cookie: sessionCookie(token) };
}

/* -------------------------------------------------------- email confirm */

export async function confirmEmail(raw: string): Promise<{ ok: boolean; error?: string }> {
  const consumed = await consumeToken(raw, "confirm");
  if (!consumed) return { ok: false, error: "This confirmation link has expired or was used." };
  await db
    .update(users)
    .set({ emailConfirmedAt: new Date() })
    .where(and(eq(users.id, consumed.userId), isNull(users.emailConfirmedAt)));
  await writeAudit({
    actor: "system",
    actorUserId: consumed.userId,
    action: "auth.email_confirmed",
    entityType: "user",
    entityId: consumed.userId,
  });
  return { ok: true };
}

/* ------------------------------------------------------ password resets */

export async function requestReset(input: {
  email: unknown;
  origin: string;
}): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(input.email);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const token = await issueToken(user.id, "reset");
    await mail("auth-reset", email, {
      siteName: "ATSIQ",
      confirmationUrl: `${input.origin}/auth/reset?token=${token}`,
    });
    await writeAudit({
      actor: email,
      actorUserId: user.id,
      action: "auth.reset_requested",
      entityType: "user",
      entityId: user.id,
    });
  }
  // Same answer either way — the response must not reveal who has an account.
  return {
    ok: true,
    message: "If that address has an ATSIQ account, a reset link is on its way.",
  };
}

export async function applyReset(input: {
  token: unknown;
  password: unknown;
}): Promise<AuthResult> {
  const password = String(input.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem, status: 400 };

  const consumed = await consumeToken(String(input.token ?? ""), "reset");
  if (!consumed) {
    return { ok: false, error: "This reset link has expired or was already used.", status: 400 };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), emailConfirmedAt: sql`coalesce(${users.emailConfirmedAt}, now())` })
    .where(eq(users.id, consumed.userId));
  // A reset invalidates every existing session for that user.
  await db.delete(sessions).where(eq(sessions.userId, consumed.userId));
  await writeAudit({
    actor: "system",
    actorUserId: consumed.userId,
    action: "auth.password_reset",
    entityType: "user",
    entityId: consumed.userId,
  });

  return { ok: true, message: "Password updated — sign in with your new password." };
}

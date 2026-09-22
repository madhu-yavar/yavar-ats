/**
 * Browser side of the self-hosted identity layer. Every call is a same-origin
 * POST; the session lives in an httpOnly cookie the browser never reads.
 */

export type MeUser = {
  id: string;
  email: string;
  full_name: string | null;
  email_confirmed_at: string | null;
};

async function post(path: string, body: Record<string, unknown>): Promise<{ message?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
  if (!res.ok) throw new Error(payload.detail ?? "Something went wrong. Try again.");
  return payload;
}

export async function fetchMe(): Promise<MeUser | null> {
  try {
    const res = await fetch("/api/auth/me", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const payload = (await res.json()) as { user?: MeUser | null };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

export const authSignIn = (email: string, password: string) =>
  post("/api/auth/signin", { email, password });

export const authSignUp = (email: string, password: string, fullName?: string) =>
  post("/api/auth/signup", { email, password, fullName });

export const authRequestReset = (email: string) => post("/api/auth/request-reset", { email });

export const authApplyReset = (token: string, password: string) =>
  post("/api/auth/reset", { token, password });

export async function authSignOut(): Promise<void> {
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => undefined);
}

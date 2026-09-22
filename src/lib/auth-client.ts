// Client-side helpers for the first-party cookie-session auth flow.
// Replaces supabase-js auth calls in the UI; the httpOnly cookie carries
// the session, so nothing sensitive lives in localStorage.

export async function fetchMe(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

export async function loginRequest(email: string, password: string): Promise<string> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
  if (!res.ok) throw new Error(body.error || "Invalid email or password.");
  return body.email ?? email;
}

export async function registerRequest(email: string, password: string): Promise<string> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(body.error || "Registration failed.");
  return body.message || "Check your inbox to confirm your work email.";
}

/** Clears the cookie session on the server (and nothing lives in localStorage). */
export async function signOutApp(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
}

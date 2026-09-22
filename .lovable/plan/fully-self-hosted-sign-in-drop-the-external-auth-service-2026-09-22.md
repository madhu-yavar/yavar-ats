# Fully self-hosted sign-in (drop the external auth service)

Today your data already lives in your own Postgres, and a cookie-session layer
(`users` + `sessions` tables) is already in place. The only remaining external
dependency is the hosted auth service that checks passwords and issues tokens.
This plan replaces it with sign-in that runs entirely on your own stack.

## What changes for users

- Sign-up, sign-in, sign-out, "forgot password" and work-email confirmation all
  run inside ATSIQ, backed by your Postgres.
- Existing accounts keep working: their email, confirmation status and password
  are imported, so nobody has to reset anything.
- Sessions stay as they are today — a secure, http-only cookie with a 7-day
  sliding window; signing out revokes the session server-side.

## Build steps

1. **Account import (migration `0012_local_auth.sql`)**
   - Copy existing identities (id, email, confirmation timestamp, password hash)
     into `public.users` so user IDs already referenced by org members,
     candidates and audit rows stay valid.
   - Add `auth_tokens` (email confirmation + password reset): user, purpose,
     token hash, expiry, consumed-at; indexed and single-use.
   - Add `login_attempts` for lockout accounting.

2. **Password layer (`src/server/password.ts`)**
   - New passwords: scrypt with per-user salt, stored as `scrypt$N$r$p$salt$hash`.
   - Imported passwords: verify the legacy bcrypt format, then transparently
     re-hash to scrypt on the next successful sign-in.
   - Strength rules enforced server-side (length, not-a-known-weak-password).

3. **Auth endpoints (`src/routes/api/auth/*`)**
   - `POST signup` — work-email validation (existing `src/lib/work-email.ts`
     rules stay), create user, send confirmation mail, no session until confirmed.
   - `POST signin` — verify password, require confirmed email, create session,
     set cookie, record `last_login_at`; generic error text so the response never
     reveals whether an email exists.
   - `POST signout` — revoke the session row and clear the cookie.
   - `POST request-reset` / `POST reset` — single-use, 1-hour token; resetting
     revokes all of that user's sessions.
   - `GET confirm` — consume the confirmation token, mark the email confirmed.
   - `GET me` — current identity for the app shell.
   - All of these are rate-limited in `src/server.ts` (per IP and per email) and
     write to `audit_log` for sign-in failures, resets and confirmations.

4. **Emails** — confirmation and reset messages reuse the existing branded
   template setup and SMTP sender, so they come from your own domain.

5. **Front end**
   - `src/components/AuthGate.tsx`: replace the external auth SDK calls with the
     new endpoints; keep the current screens, copy and pending-approval flow.
   - `src/hooks/useMe.ts`: read identity from `GET /api/auth/me`.
   - `src/routes/__root.tsx` / `src/start.ts`: drop the bearer-token attacher and
     auth-state listener — the session cookie is sent automatically.

6. **Remove the dependency**
   - Delete the JWT bearer path from `src/server/identity.ts` (cookie only).
   - Remove the generated auth client/middleware imports across server modules;
     the `Tables<>` type helper is regenerated locally so nothing depends on the
     hosted schema types.
   - Uninstall the vendor auth SDK once nothing imports it.

7. **Verification**
   - Playwright run through sign-up → confirm → sign-in → protected page →
     sign-out → password reset, plus a check that an unconfirmed account and a
     wrong password are both refused.
   - Confirm existing accounts (including the super-admin account) sign in with
     their current passwords.

## Notes

- Google sign-in is not part of this slice; password sign-in covers every
  current user. It can be added afterwards as a direct Google OAuth flow with no
  third-party auth service involved.
- Session cookie behaviour, org approval gating, roles and the tenant-isolation
  middleware are untouched.

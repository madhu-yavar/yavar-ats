# Local test stack (production-safe)

Everything runs locally: a disposable Postgres (fixture with two demo tenants),
a GoTrue-compatible auth stub, and the Vite dev server. Production Supabase is
never touched — `.env.local` points the app at the local stub.

The integration suite has a mandatory hostname guard and refuses to run unless
`DATABASE_URL` resolves to `127.0.0.1`, `localhost` or `::1`. Never weaken or
remove this guard.

    scripts/local-e2e/local-dev.sh        # start
    scripts/local-e2e/local-dev.sh stop   # stop

Logins (password `demo1234`):

- `madhu@demo.com` — platform super admin, owner of **Demo Corp**
- `hr@yavar.ai` — owner of **Yavar Technologies**

One command also wipes/rebuilds the database: delete `/tmp/atsiq-pgdata` before
starting. Browser smoke test (needs `bun`): `bun scripts/local-e2e/e2e-check.ts`
with `BASE_URL` set to the printed dev URL. Playwright is not a repo
dependency — install it once where you keep test tooling:
`cd scripts/local-e2e && bun i playwright` (uses your installed Chrome, no
browser download).

Known local limits: pages marked as port debt (Screening calls, Collaboration,
Catalogue, Talent Brain) render but their data APIs still expect Supabase, so
they stay empty locally. AI features need your own key: paste it in
Integrations → AI model (stored org-scoped, server-side only).

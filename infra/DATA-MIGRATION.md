# ATSIQ — production data migration: Lovable DB → Cloud SQL

Migrates the live data (users, organisations, candidates, requisitions, …)
from the **Lovable-managed Postgres** (the database behind atsiq.yavar.ai) to
the **Cloud SQL instance** behind z-atsiq.yavar.ai.

Both databases share the same schema (applied from `drizzle/pg-migrations/`),
so this is a **data-only** move: no DDL is executed on the target.

---

## 0. Prerequisites

| Need | Where |
|---|---|
| Source connection string | Lovable project → database settings (or Lovable support). Lovable databases are Supabase projects: host is `db.<project-ref>.supabase.co` (or the pooler), db `postgres` |
| `pg_dump` / `psql` client | Version **14 or newer** (match the source engine) |
| Target connection string | The `atsiq-database-url` Secret Manager value (see `infra/DEPLOYMENT-HANDOFF.md` §2) |
| Approval to pause writes on Lovable | For the final export — a few minutes is enough. Anything written on Lovable *after* the dump will NOT exist on GCP until you re-export |

**Known blockers to clear first**

1. **SMTP is broken on the target** — `POST /api/auth/register` currently fails
   with `535 5.7.3 Authentication unsuccessful` (Microsoft 365 rejects the
   login). The mail admin must enable **Authenticated SMTP** for the sending
   mailbox (M365 admin centre → user → Mail → Manage email apps → tick
   "Authenticated SMTP", or
   `Set-CASMailbox -Identity <mailbox> -SmtpClientAuthenticationDisabled $false`),
   then DevOps updates the `atsiq-smtp-url` secret. Users cannot confirm their
   emails or reset passwords until this works.

## 1. Explore the source (read-only)

```bash
export SRC="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"

# Row counts you will verify against later — save this output:
psql "$SRC" -c "
  SELECT 'users' t, count(*) FROM users
  UNION ALL SELECT 'organizations', count(*) FROM organizations
  UNION ALL SELECT 'org_members', count(*) FROM org_members
  UNION ALL SELECT 'candidates', count(*) FROM candidates
  UNION ALL SELECT 'requisitions', count(*) FROM requisitions
  UNION ALL SELECT 'applications', count(*) FROM applications
  UNION ALL SELECT 'offers', count(*) FROM offers
  UNION ALL SELECT 'interviews', count(*) FROM interviews
  ORDER BY 1;"
```

If any of those tables error as missing on the source, note it and continue —
the verification in §5 simply compares what exists.

## 2. Export the data

Data only — the target already has the schema. Exclude the Supabase-managed
schemas and two tables whose contents must NOT carry over:

- `sessions` — old session rows would keep pre-cutover logins alive; forcing
  fresh sign-ins on GCP is the safer posture.
- `pg_migrations` — the target keeps its own migration journal.

```bash
pg_dump "$SRC" \
  --data-only \
  --no-owner --no-privileges \
  --schema=public \
  --exclude-table=sessions \
  --exclude-table=pg_migrations \
  --file=lovable-data.sql
```

Sanity-check the dump is not empty and not a Supabase internal dump:

```bash
grep -c "^COPY public\." lovable-data.sql   # should list many tables
grep -m2 "^COPY auth\.\|^COPY storage\." lovable-data.sql   # should print NOTHING
```

## 3. Clean the target (it currently holds only test rows)

z-atsiq.yavar.ai was deployed against an empty database and a couple of
registration attempts created unconfirmed rows (`madhu.r@yavar.ai` if you
tried to sign up, `e2e-probe@yavar.ai` from testing). Those would collide with
the restored rows on unique emails, so reset to a clean schema:

```bash
export TGT="postgresql://atsiq:<password>@/atsiq?host=/cloudsql/PROJECT:REGION:atsiq"

psql "$TGT" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# re-apply schema + the migration journal
DATABASE_URL="$TGT" bun scripts/migrate-pg.mjs        # from a repo checkout
```

## 4. Restore

```bash
psql "$TGT" -v ON_ERROR_STOP=1 -f lovable-data.sql
```

`--data-only` dumps use `COPY` statements; plain `psql` applies them as-is.
If it fails partway, the target is dirty — repeat §3 (drop schema, re-apply
migrations) and fix the cause before retrying. Common causes: a table that
exists on the source but not in `drizzle/pg-migrations/` (report it — the
baseline needs updating), or an FK ordering issue (re-run with
`-c "SET session_replication_role = replica;"` prepended to the dump file).

## 5. Verify

```bash
# Counts must match §1 exactly:
psql "$TGT" -c "
  SELECT 'users' t, count(*) FROM users
  UNION ALL SELECT 'organizations', count(*) FROM organizations
  UNION ALL SELECT 'org_members', count(*) FROM org_members
  UNION ALL SELECT 'candidates', count(*) FROM candidates
  UNION ALL SELECT 'requisitions', count(*) FROM requisitions
  UNION ALL SELECT 'applications', count(*) FROM applications
  UNION ALL SELECT 'offers', count(*) FROM offers
  UNION ALL SELECT 'interviews', count(*) FROM interviews
  ORDER BY 1;"

# Spot checks:
psql "$TGT" -c "SELECT email, email_confirmed_at IS NOT NULL AS confirmed,
  password_hash IS NOT NULL AS can_log_in FROM users ORDER BY email;"
psql "$TGT" -c "SELECT name, status FROM organizations;"
```

Expect: `madhu.r@yavar.ai` present and confirmed; organisation
**Yavar Technologies** with status `active`; owner membership for madhu.

> **Passwords:** accounts whose hash starts with `scrypt$` or `bcrypt$` can
> sign in on GCP with their existing password. Accounts with a **NULL
> `password_hash`** are Supabase-era logins that never signed in after the
> first-party cutover — they use "Forgot password" (requires the SMTP fix in
> §0) to set one and confirm their email in a single step.

## 6. Application smoke tests on z-atsiq.yavar.ai

1. Sign in as an existing user (real password) → workspace loads
2. `/platform` → platform console lists the organisations from the dump
3. `/candidates` → candidate rows render; open one → CV link works
   (validates object-storage wiring: files must have been migrated too — see
   the note below)
4. Upload a new CV → file stored, no error
5. "Forgot password" → email arrives (proves the SMTP fix)

> **Object storage is separate from the database.** CV/template/brand files do
> NOT travel in the pg_dump. If the Lovable deployment stored files in its
> Supabase storage bucket, they must be copied to the GCS/S3 bucket and the
> stored paths (`candidates.resume_file_path`, etc.) kept consistent. Get the
> file listing + copy from Lovable support if CV downloads 404 after migration.

## 7. Cut-over

1. Announce a short write-freeze on the Lovable app (or just accept the delta
   and re-run §2–§4 once more immediately before switching).
2. Re-point `atsiq.yavar.ai` in Cloudflare to the Cloud Run URL.
3. Keep the Lovable project parked (not deleted) for a week; its database is
   the rollback target. Rollback = switch the DNS origin back.

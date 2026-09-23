# ATSIQ self-hosting — leaving Lovable behind

The application is fully portable: TanStack Start (React 19 SSR on Nitro) as a
plain Node server, ordinary PostgreSQL via drizzle, S3-compatible object
storage, and first-party cookie auth. Nothing in the runtime needs Lovable or
Supabase. This document is the step-by-step exit plan; `DEPLOYMENT-GCP.md`
remains the reference for the full GCP environment (GKE variant, OAuth
redirects, cron jobs).

## 0. Runtime dependencies after the exit

| Need                                              | Provider                             | Env                                                                                 |
| ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Postgres 14+                                      | Cloud SQL (or any in-house PG)       | `DATABASE_URL`                                                                      |
| Sessions/auth                                     | The app itself (`sessions` table)    | `SESSION_SECRET`                                                                    |
| Object storage (CV vault, templates, brand logos) | GCS with HMAC keys, MinIO, or any S3 | `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Transactional email                               | Any SMTP                             | `SMTP_URL`, `EMAIL_FROM`                                                            |
| Encryption of stored org credentials              | App itself                           | `SECRET_ENCRYPTION_KEY`                                                             |
| Public URL                                        | Your DNS                             | `PUBLIC_SITE_URL`                                                                   |

Optional feature flags (LinkedIn/Google/Teams/Zoom OAuth, cron secrets) are
listed in `DEPLOYMENT-GCP.md` §4 and stay dark when unset.

## 1. Get the data out of Lovable

The source of truth for a fresh database is `drizzle/pg-migrations/` — the
Lovable-era `drizzle/migrations` journal is incomplete (core tables were
applied outside drizzle) and must NOT be used with `drizzle-kit migrate`.

1. Ask Lovable support (or the project's database console) for a recent backup
   / `pg_dump` of the production database — required especially while the
   point-in-time restore discussed with them is outstanding.
2. For a **fresh** database instead, apply the schema with the idempotent
   runner (no dump needed):

   ```bash
   DATABASE_URL="postgres://…/atsiq" bun scripts/migrate-pg.mjs
   ```

3. To **migrate existing production data**, restore their dump over the schema
   from step 2 (restore with `--data-only`, or drop the dump's schema section):

   ```bash
   pg_restore --data-only --no-owner -d "$DATABASE_URL" lovable-dump.dump
   ```

## 2. One-time GCP setup (Cloud Run path)

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com

# Database
gcloud sql instances create atsiq --database-version=POSTGRES_14 --tier=db-g1-small --region=REGION
gcloud sql databases create atsiq --instance=atsiq
gcloud sql users create atsiq --instance=atsiq --password=…
# Connection string for private IP via the Cloud SQL connector:
#   postgres://atsiq:…@/atsiq?host=/cloudsql/PROJECT:REGION:atsiq

# Secrets (values per DEPLOYMENT-GCP.md §4)
printf %s "postgres://…" | gcloud secrets create atsiq-database-url --data-file=-
printf %s "$(openssl rand -hex 32)" | gcloud secrets create atsiq-session-secret --data-file=-
printf %s "$(openssl rand -base64 32)" | gcloud secrets create atsiq-secret-encryption-key --data-file=-
printf %s "smtps://user:pass@smtp.example.com:465" | gcloud secrets create atsiq-smtp-url --data-file=-
# + atsiq-inbound-email-secret, atsiq-cron-secret (optional features)

# Container registry
gcloud artifacts repositories create atsiq --repository-format=docker --location=REGION
```

## 3. Continuous deployment

`.github/workflows/deploy.yml` (already in this repo) builds the Dockerfile,
runs `scripts/migrate-pg.mjs` against the database, and deploys to Cloud Run on
every push to `main`. Enable it by adding the repo secrets `GCP_PROJECT`,
`GCP_SA_KEY` and the variables `GCP_REGION`, `GCP_REPOSITORY`,
`DEPLOY_ENABLED=true` (see the header of the workflow file).

## 4. DNS cut-over

1. Deploy and smoke-test on the Cloud Run URL first: `/` 200, sign-in,
   `/platform`, upload a CV.
2. In Cloudflare, switch the `atsiq.yavar.ai` origin to the Cloud Run URL (or
   add a CNAME to `ghs.googlehosted.com` and let Cloudflare proxy it).
3. Keep the Lovable deployment parked (not deleted) until a week of clean
   operation, then cancel it.

## 5. Remaining legacy fragments (non-blocking)

- `@lovable.dev/email-js` is only a _fallback_ in `src/lib/email-templates/send-email.ts`;
  with `SMTP_URL` set, email never touches Lovable. Removing the fallback is a
  small cleanup.
- `@lovable.dev/vite-tanstack-config` is a build-time vite helper; swapping it
  for the raw `@tanstack/react-start` plugin is optional hygiene.
- `drizzle/migrations/` (incomplete Lovable journal) can be deleted once
  nothing references it — `scripts/migrate-pg.mjs` + `drizzle/pg-migrations/`
  are the canonical schema path.
- Supabase JWT bearer auth was removed; the leftover `src/integrations/supabase/`
  folder is re-export seams and type definitions only.

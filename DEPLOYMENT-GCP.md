# ATSIQ — GCP deployment handoff (z-atsiq.yavar.ai)

Instructions for DevOps to deploy the ATSIQ ATS to a GCP cluster under the domain **z-atsiq.yavar.ai** (DNS labels are case-insensitive; lowercase used throughout).

## 1. Source

| | |
|---|---|
| Git repo | https://github.com/madhu-yavar/yavar-ats.git |
| Branch | `main` (deploy latest commit) |
| App type | TanStack Start (React 19) SSR app on Nitro → plain **Node server** (`.output/server/index.mjs`) |
| Package manager | Bun (lockfile `bun.lock`); runtime image needs only Node |
| Database | Plain **PostgreSQL** (Drizzle ORM, SQL migrations in `drizzle/pg-migrations/`) — no Supabase DB |
| Auth | Supabase-compatible auth (GoTrue) **endpoint only** — see §4 |
| Files (CV vault, templates) | S3-compatible object storage |

A production `Dockerfile` is at the repo root. `vite build` produces a Node server (nitro `node-server` preset, already configured in `vite.config.ts`). Verified locally: `node .output/server/index.mjs` serves `/` and `/privacy` with HTTP 200.

## 2. GCP infrastructure to provision

| Component | Suggestion |
|---|---|
| Cluster | GKE (Autopilot is fine) |
| Database | Cloud SQL for PostgreSQL (14+), **private IP**, database `atsiq` |
| Object storage | GCS bucket `resumes` used in **S3-compatible mode** (enable HMAC key for a service account; endpoint `https://storage.googleapis.com`) — or in-cluster MinIO / any S3-compatible store |
| Secrets | GCP Secret Manager → mounted as K8s Secrets |
| DNS | Cloud DNS record `z-atsiq.yavar.ai` → load-balancer IP |
| TLS | GCLB Ingress + `ManagedCertificate` (or cert-manager) |
| Cron | Cloud Scheduler (2 jobs, see §6) |
| Container registry | Artifact Registry |

## 3. Build & run

**Image** (build args bake the auth endpoint into the client bundle):

```bash
gcloud builds submit \
  --tag REGION-docker.pkg.dev/PROJECT/REGISTRY/atsiq:TAG \
  --build-arg VITE_SUPABASE_URL="https://lxvchkkaxfrbfqxcrkxo.supabase.co" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="<publishable key — §4>"
```

Container: port **3000**, `HOST=0.0.0.0`. No `/health` endpoint exists — use `GET /` (HTTP 200) as readiness/liveness probe. One DB migration **Job per release** (below) must complete before rolling the Deployment.

**Migrations** (run from a checkout with Bun, once per release, before deploy):

```bash
DATABASE_URL="postgresql://USER:PASS@PRIVATE_IP:5432/atsiq" bunx drizzle-kit migrate
```

## 4. Environment variables

### Required — app will not boot without these

| Variable | Value / how to generate |
|---|---|
| `DATABASE_URL` | `postgresql://…` Cloud SQL private IP |
| `SESSION_SECRET` | `openssl rand -hex 32` (must be ≥ 32 chars) |
| `PUBLIC_SITE_URL` | `https://z-atsiq.yavar.ai` (used in capture links, OAuth redirects, emails) |
| `SUPABASE_URL` | `https://lxvchkkaxfrbfqxcrkxo.supabase.co` — the **auth** endpoint (GoTrue). Data does NOT live here; identity/JWT verification does. |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key of that project (the `sb_publishable_…` value from the repo's tracked `.env`). Not a secret; safe in config. |

### Build-time (Docker build args, same values as above)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — the browser bundle reads these at build time; runtime env alone is not enough for sign-in.

### Object storage (required for CV upload / templates / brand assets)

| Variable | Value |
|---|---|
| `S3_ENDPOINT` | `https://storage.googleapis.com` (or MinIO/R2 endpoint) |
| `S3_BUCKET` | `resumes` |
| `S3_REGION` | any (default `us-east-1` works with GCS) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | GCS HMAC key pair |

### Optional feature flags — the app boots without them; the feature stays dark

| Feature | Variables |
|---|---|
| AI scoring / copilot (needs ≥1 provider) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` (social profiling) |
| LinkedIn org-level connect | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI=https://z-atsiq.yavar.ai/api/public/linkedin/callback`, `LINKEDIN_SCOPES`, `LINKEDIN_STATE_SECRET` (random 32+) |
| Google Calendar / Meet 1-click | `GOOGLE_CALENDAR_OAUTH_CLIENT_ID`, `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` |
| Microsoft Teams meeting | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` |
| Zoom meeting | `ZOOM_OAUTH_CLIENT_ID`, `ZOOM_OAUTH_CLIENT_SECRET` |
| OAuth state signing (required if any meeting OAuth above is enabled) | `OAUTH_STATE_SECRET` (random 32+) |
| Google sign-in button | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| Careers-inbox email webhook | `INBOUND_EMAIL_SECRET` (random 32+), `INBOUND_EMAIL_DOMAIN` |
| Scheduler/cron routes | `LOVABLE_CRON_SECRET` (random 32+; optional `LOVABLE_CRON_SECRET_PREVIOUS` for rotation) |
| Transactional email | `SMTP_URL` (e.g. `smtps://user:pass@smtp.example.com:465`), `EMAIL_FROM` |

**Secrets to generate:** `SESSION_SECRET`, `SECRET_ENCRYPTION_KEY` (AES-256 key for credentials at rest; `openssl rand -base64 32`), `OAUTH_STATE_SECRET`, `LINKEDIN_STATE_SECRET`, `INBOUND_EMAIL_SECRET`, `LOVABLE_CRON_SECRET` — stored in Secret Manager. Setting `SECRET_ENCRYPTION_KEY` enables encryption of OAuth/AI/capture credentials; without it they are stored in the clear (a one-time warning is logged). Rotate-sensitive: decryptSecret returns empty on mismatch rather than erroring.

### Rate limiter — proxy positioning (required)

The in-process rate limiter keys on the client IP taken from the **right-most**
`X-Forwarded-For` hop (spoof-proof behind exactly one trusted proxy). Set:

```
TRUSTED_PROXY_COUNT=1     # number of trusted proxy hops (GKE L7 LB = 1)
```

The container must only be reachable **through** that proxy (no direct-to-node
traffic): a client that bypasses the LB can send an arbitrary XFF and rotate
limiter buckets. If you add a second proxy hop, raise the count to 2.

## 5. OAuth redirect URIs to register (per provider console)

All under the new domain:

- LinkedIn: `https://z-atsiq.yavar.ai/api/public/linkedin/callback`
- Google Calendar: `https://z-atsiq.yavar.ai/api/public/integrations/google/callback`
- Microsoft: `https://z-atsiq.yavar.ai/api/public/integrations/microsoft/callback`
- Zoom: `https://z-atsiq.yavar.ai/api/public/integrations/zoom/callback`

## 6. Cron (Cloud Scheduler, auth via header)

Both endpoints expect `Authorization: Bearer $LOVABLE_CRON_SECRET`:

| Job | Target | Typical cadence |
|---|---|---|
| Careers-inbox sync | `https://z-atsiq.yavar.ai/api/public/inbox-sync` | every 5–15 min |
| Candidate re-sync/scoring | `https://z-atsiq.yavar.ai/api/public/sync-candidates` | hourly |

## 7. Example Kubernetes objects (sketch)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atsiq
spec:
  replicas: 2
  selector: { matchLabels: { app: atsiq } }
  template:
    metadata:
      labels: { app: atsiq }
    spec:
      containers:
        - name: atsiq
          image: REGION-docker.pkg.dev/PROJECT/REGISTRY/atsiq:TAG
          ports: [{ containerPort: 3000 }]
          envFrom:
            - secretRef: { name: atsiq-env }   # all vars from §4
          readinessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 15
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
```

Plus a `Service` (port 80 → 3000) and an `Ingress` with `ManagedCertificate` for `z-atsiq.yavar.ai` and a Cloud DNS A record pointing at the ingress IP.

## 8. First-boot checklist

1. Migration Job ran clean against `atsiq` DB.
2. `https://z-atsiq.yavar.ai` loads and sign-in works (auth endpoint reachable from both browser and cluster).
3. Create first org/user, upload a CV — confirms `DATABASE_URL` + S3/HMAC path.
4. Trigger one cron route manually with the bearer token → HTTP 200.
5. Smoke: `/`, `/candidates`, `/requisitions`, `/privacy` → HTTP 200.

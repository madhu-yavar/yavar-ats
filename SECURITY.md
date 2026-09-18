# Security Policy

## Reporting a vulnerability

Email **security@yavar.ai** (or use the contact in README.md if that alias is not yet live).
Please include reproduction steps and affected URLs/endpoints. Do not open a public issue
for a suspected vulnerability.

- Acknowledgement target: **2 business days**
- Triage + severity decision: **5 business days**
- Fix or mitigation for Critical/High: **30 days**

We credit reporters in release notes on request.

## Scope

- `z-atsiq.yavar.ai` / `atsiq.yavar.ai` deployments and this repository's code.
- Out of scope: social engineering, volumetric DoS, spam, attacks against third-party
  providers (LinkedIn, Google, Microsoft, Zoom, OpenAI/Anthropic).

## Secure-development baseline

- Authz contract: every tenant-scoped server function uses `requireOrg`/`requireRole`
  and every query carries an explicit `org_id` predicate (see `src/lib/auth.middleware.ts`).
- Secrets: `SECRET_ENCRYPTION_KEY` encrypts stored credentials (AES-256-GCM); OAuth state
  is HMAC-signed with required secrets; no secret values are committed.
- Rate limiting on all public HTTP routes and server-function RPCs (`src/server.ts`).
- SSRF gate: server-side fetches of user-supplied URLs go through `src/server/safe-fetch.ts`.
- Auditing: privileged actions append to `audit_log` (`src/server/audit.ts`).
- CI: typecheck, lint, `bun audit --level high`, gitleaks, integration tests (`.github/workflows/ci.yml`).

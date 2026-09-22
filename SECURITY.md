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

- Authentication: first-party credentials and database-backed sessions are delivered in Secure,
  HttpOnly cookies with a bounded seven-day sliding lifetime. Password hashes use scrypt; legacy
  bcrypt hashes are upgraded after a successful sign-in.
- Authorization contract: every tenant-scoped server function uses `requireOrg`, `requireRole`,
  `requireOrgOwner` or `requirePlatformAdmin`, and every query carries an explicit `orgId`
  predicate. There is no database row-level-security fallback; server middleware and query scope
  are the mandatory tenant boundary.
- Roles are stored in a separate membership-role table. Platform administration is a separate,
  server-validated allowlist and is never inferred from browser storage.
- Secrets: `SECRET_ENCRYPTION_KEY` encrypts stored credentials (AES-256-GCM); OAuth state
  is HMAC-signed with required secrets; no secret values are committed. Every organisation supplies
  its own AI provider key, and no deployment-level AI key is used as a fallback.
- Rate limiting on all public HTTP routes and server-function RPCs (`src/server.ts`).
- SSRF gate: server-side fetches of user-supplied URLs go through `src/server/safe-fetch.ts`.
- Auditing: privileged actions append to `audit_log` (`src/server/audit.ts`).
- AI safety: untrusted CV, JD, profile and mail text is delimited before prompting; structured model
  responses are schema-validated before use. AI decisions retain evidence and permit audited human override.
- Files: CVs and screening recordings remain private in S3-compatible storage and are served through
  authorised application paths rather than public object URLs.
- CI: typecheck, lint, `bun audit --level high`, gitleaks, integration tests (`.github/workflows/ci.yml`).

## Data and dependency boundaries

PostgreSQL is the operational system of record. Authentication, files, AI providers, meeting services,
email and job boards are external trust boundaries with narrowly scoped credentials. Public capture,
webhook, OAuth callback and scheduler endpoints validate callers, validate payloads and are rate limited.

## Release evidence

`VERIFICATION_REPORT.md` records the latest automated and browser checks. A fresh application security
scan and production dependency scan are required before each publication. Provider integrations that need
customer credentials are reported as environment-dependent rather than represented as tested.

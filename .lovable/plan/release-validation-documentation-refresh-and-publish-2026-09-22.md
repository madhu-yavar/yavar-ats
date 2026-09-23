# Release validation, documentation refresh, and publish

## Scope

Bring the product documentation and in-app user manual in line with the current ATSIQ implementation, verify the critical journeys end to end, run current security checks, and publish only after release blockers are cleared.

## Implementation

1. **End-to-end validation**
   - Exercise public landing, sign-in failure/recovery entry points, authenticated session restoration, dashboard, requisitions, talent pool, matching, screening, interviews, offers, reports, Return on Individual, Talent Brain, integrations, IJP, templates, help, and platform-only access.
   - Prefer read-only and non-destructive checks against live organisation data. Use isolated records only where a write is essential, and remove or clearly label test records.
   - Verify API responses, browser errors, route rendering, role gates, tenant isolation indicators, downloadable assets, and the new landing film.
   - Run the maintained automated integration suite and type checks; record exact outcomes and any intentionally untested third-party calls.

2. **In-app user manual**
   - Update the shared manual source used by both `/help` and the HR copilot.
   - Add the Return on Individual workflow, live compensation research and saved organisation knowledge, deep LinkedIn capture behaviour, organisation-owned AI key policy, screening/audio flow, meeting-provider readiness, templates, IJP, catalogue access, and current self-hosted sign-in/recovery behaviour.
   - Improve `/help` navigation and scannability without changing the established visual system.

3. **Repository documentation**
   - Replace the starter README with a current product and operating overview.
   - Correct the deployment guide for plain Postgres, self-hosted cookie sessions, S3-compatible private files, organisation-owned AI keys, encryption requirements, and current public endpoints.
   - Refresh the security policy and verification report with current tenant middleware, audit, encryption, rate limiting, SSRF, prompt-injection protection, session security, and latest test evidence.
   - Keep the roadmap aligned with completed and blocked work.

4. **Investor and architecture documents**
   - Produce versioned updated files rather than overwriting the previous investor document.
   - Refresh the business narrative, all product modules, AI module catalogue, Talent Brain ontology, Return on Individual and prescriptive analytics, solution architecture, technical architecture, governance, deployment model, security, and current implementation status.
   - Remove obsolete managed-backend, shared-AI-key, RLS, and legacy-auth claims.
   - Render and inspect every generated page before delivery.

5. **Security and release**
   - Run a fresh project security scan and dependency scan.
   - Resolve any release-blocking findings without weakening tenant isolation or secret handling; document accepted limitations separately.
   - Re-run focused tests after any security fix.
   - Publish the validated project, then confirm the expected production URL responds and report any third-party integration checks that require real provider credentials.

## Technical notes

- The operational data path remains Drizzle against plain PostgreSQL via `DATABASE_URL`.
- Authentication remains first-party, database-backed, HttpOnly cookie sessions; the temporary legacy bearer compatibility path will be documented accurately rather than presented as the primary architecture.
- Every tenant-scoped server operation must retain `requireOrg`/role middleware and explicit `orgId` predicates.
- AI calls must require the selected organisation's encrypted Gemini, OpenAI, or Claude credential; there is no platform/shared AI-key fallback.
- Existing labelled `test_roi_cohort` rows remain identifiable and will not be represented as production hires.

## Acceptance criteria

- Current E2E, integration, and type checks have recorded results.
- `/help` and the HR copilot share the updated manual content.
- README, deployment, security, verification, technical architecture, and investor documents agree with the shipped implementation.
- Generated documents pass full-page visual inspection.
- A fresh security scan has no unresolved critical release blocker.
- Publishing is requested and the production URL is checked after deployment begins.

# Roadmap

## HRMS integrations (2026-09-29)

Study in `docs/hrms-integrations-study.md`: vendor API landscape (Keka, greytHR, Workday buildable today; Darwinbox, ZingHR, Adrenalin partnership-gated), recommended connector architecture reusing the existing integration-credential, outbox and cron primitives, and the phased plan below.

- [x] P0: connector foundations — "hrms" category on Integrations, adapter interface, sync engine + cron job, employee-master cache, field mappings
- [ ] P1: read connectors for Keka and greytHR (public APIs): employee and department sync
- [ ] P2: outbound platform — signed webhooks with delivery outbox and retries, scoped public REST API keys
- [ ] P3: on-hire push to Keka (incl. preboarding) and greytHR, hooked at the stage-transition choke point
- [ ] P4: Workday read via OAuth + RaaS/REST with a per-customer ISU setup guide; partnership track in parallel
- [ ] P5: CSV import/export templates for partnership-gated HRMS (Darwinbox, ZingHR, Adrenalin); direct adapters as vendor specs arrive; evaluate a unified-API aggregator behind a DPIA

## AI governance and spend visibility (2026-09-28)

- [x] AI usage ledger (`ai_usage_events`): one row per provider request — organisation, module, provider, model, prompt/completion/total tokens, retry attempt, latency, outcome — written fire-and-forget from the gateway; OpenAI/Anthropic/Gemini usage frames harvested, transcription included, missing frames recorded as zero (never estimated)
- [x] Platform super-admin AI usage console (`/platform-ai-usage`): totals, daily stacked tokens, spend per module/organisation/model, filterable request log with pagination, CSV export
- [x] Vendor/model abstraction: AI provider and model names removed from the landing page, product catalogue (page and PDF/XLSX export), user manual, toasts/cards and all server-to-client payloads; a one-time migration (`0016`) scrubbed model ids already persisted in candidate activity trails. The organisation's own Integrations → AI model settings keeps provider and model choice (BYO keys)
- [x] Usage attribution fixes: careers-inbox CV parsing and Talent Brain AI now carry the organisation id so every ledger row resolves to a tenant

## Candidate communications (2026-09-27)

- [x] Candidate email outbox with queued delivery, retries and suppression
- [x] Four automatic email types: application acknowledgment, stage update, interview invitation and offer notification
- [x] Per-organisation toggles, reply-to address and timezone on Integrations → Candidate emails; platform SMTP relay does delivery

## Account security (2026-09-28)

- [x] One password policy everywhere (8–128 characters with upper, lower and digit) enforced server-side on registration, reset and change; new password must differ from current; show/hide toggles and a visible policy hint on every password field

## First-login guidance

- [x] Add a first-login, replayable integration-to-offer journey in the HR copilot and share its steps with the user manual

## Landing film + visual polish

- [x] Remove the landing-film explainer sentence and add an animated Talent Brain graph sequence
- [x] Render enterprise brand film and place it on the landing page
- [x] Remove the "Who pays for AI" note from integrations
- [x] Polish the dashboard shell, KPI band and panels
- [x] Polish the Talent Brain knowledge graph
- [x] Repair first-party sign-in and verify session persistence
- [x] Expand the film with CHRO dashboard, RoI and capability highlights
- [x] Review the dashboard and Talent Brain in the signed-in application

## Return on Individual (RoI) semantic layer — CHRO

- [x] RoI model: capability per hire from match evidence, scarcity, impact, innovation, trajectory, breadth
- [x] Cost anchor with honest fallback (offer where released, requisition budget otherwise)
- [x] RoI index normalised against the organisation's own median hire cost
- [x] Capability-to-goal engine: 10 programme blueprints, team readiness vs pool readiness, named contributors
- [x] Organisation strength / exposure readings, incl. single-person dependencies and dormant capability
- [x] Department rollups and individual-by-individual evidence view
- [x] Super-admin organisation switcher on the RoI page
- [x] Executive band on the dashboard answering the question up front
- [x] Review the accepted-offer test cohort in the authenticated preview

- [x] Replace landing film with a glossy real-page/data narrative
- [x] Verify RoI cards are computed from organisation evidence, not mock records
- [x] Harden interview scheduling, scorecard progression and audit trails
- [x] Add an explicitly labelled 50-person accepted-offer test cohort

## Pre-onboarding document validation

- [x] onboarding_documents table, private storage and org-scoped access
- [x] Extraction agent for ID, experience letters, payslips and certificates on the org's own AI key
- [x] Careers-inbox routing of offer-stage candidate documents
- [x] HR validation screen: original document beside the agent's reading, validate / reject / re-read
- [x] Offer release gated on validated mandatory documents
- [x] User manual and repository documentation updated

## Release validation and documentation

- [ ] Restore the database to immediately before 2026-09-22 22:13 UTC and reconcile all business-record counts (blocked: provider point-in-time recovery required)
- [ ] Run authenticated and public end-to-end workflow tests (blocked until database recovery)
- [x] Refresh repository product, deployment, security and verification documents
- [x] Refresh the in-app user manual and copilot knowledge source
- [x] Update the technical architecture document to the current implementation
- [x] Update and visually inspect the investor product document
- [ ] Run current security checks and resolve release blockers (basic scan passed; dependency scan parser blocked by URL-pinned xlsx package)
- [ ] Publish and verify the production release (blocked until database recovery and revalidation)
- [x] Pre-onboarding: per-employer salary breakup captured verbatim; multi-page, scanned, merged and zipped uploads read as individual documents

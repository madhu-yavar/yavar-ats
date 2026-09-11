## Meeting links (in progress)

- [x] HR configures Zoom / Google Meet / Teams credentials on the Integrations page (no builder-side connector).
- [x] "Generate meeting link" on interview scheduling uses those stored credentials.

## Deeper scoring signals (done)

- [x] Career-history analytics (tenure, stints, gaps, progression, skill recency) — deterministic, 10% weight.
- [x] Impact & innovation scoring from evidence in the CV — 10% weight.
- [x] Logistics & risk filters (CTC band, notice period, relocation, work authorisation) — flags only, never alters the score.
- [x] Mindset assessment: role-specific situational questionnaire on a private candidate link, AI-scored on six behavioural dimensions.
- [x] Weights re-balanced to exactly 100: Skills 40 / Experience 15 / Career 10 / Impact 10 / Education 10 / Social 15.

## Talent pool hygiene & historic matching (done)

- [x] Duplicate detection on email (alias-aware), phone (last 10 digits), LinkedIn/GitHub URL, name+employer — with certain/likely confidence.
- [x] Bulk CV intake enriches an existing profile instead of creating a second row; blanks filled, skills unioned, newest CV kept.
- [x] "Merge" bulk action folds duplicates into the oldest record and re-points applications and child records.
- [x] CV freshness (fresh <90d / aging / stale >1yr) with "Possible duplicates" and "Stale CVs" saved views.
- [x] Dashboard: pool-health panel, funnel conversion, source mix, skill scarcity, stalled SLA list, and auto-suggested pool candidates per open requisition with one-click add.

## Enterprise readiness — slice 1: organisation onboarding (done)

- [x] Multi-tenant schema (organizations, org_members, org_id across ATS tables with parent-derived triggers + RLS).
- [x] Four-step onboarding wizard: org profile, departments, hiring locations, team invitations.
- [x] Org gate: signed-in users without a membership go through onboarding; paused members are blocked.
- [x] Users & roles page rebuilt as an org roster with email invitations, role grants, pause/remove.

## Next

- [x] Slice 2: role-scoped CHRO / HR-head dashboards.
- [x] Slice 3: embedded HR copilot (one conversation, database-backed).

## LinkedIn Recruiter capture repair

- [x] Read the active applicant profile rather than the recommendations panel.
- [x] Download the CV from the project Highlights attachment row.
- [x] Persist LinkedIn profile analysis and background JD/CV scoring after capture.
- [x] Replace label-based scraping with structure-aware profile, attachment and icon-control discovery.
- [x] Capture each applicant's public LinkedIn profile separately from the Recruiter-only URL.
- [x] Report the exact failed stage: navigation, identity, attachment, control, download, storage or analysis.
- [x] Verify active-profile identity, Highlights CV discovery, Attachments CV discovery, public-profile capture and applicant-queue filtering against screenshot-shaped browser fixtures.
- [x] Handle icon-only attachment controls outside the filename wrapper and recover the CV from LinkedIn's expanded preview when no browser download event fires.

## Enterprise readiness — slice 2 & 3 (done)

- [x] Slice 2: CHRO / HR-head leadership board on the dashboard (open demand, salary commitment vs departmental budget, pipeline coverage per seat, offer accept rate, time to hire, demand & supply by department). Recruiters keep the operational view only.
- [x] Slice 3: embedded HR copilot — floating panel on every page, one ongoing conversation per user persisted in `copilot_messages` (org-scoped, RLS own-rows), grounded in a live org data snapshot via the configured AI provider.
- [x] Org registration path made explicit on the sign-in screen ("New company? Register your organisation" → owner account → 4-step setup wizard).

## Landing page (done)

- [x] Replace the terse split-screen sign-in with an information-rich, Zoho-Recruit-style enterprise landing page (hero + sign-in card, capability grid, module walkthrough, scoring model, governance, FAQ, CTA) while keeping email/Google sign-in and org registration intact.

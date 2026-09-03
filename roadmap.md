
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
- [ ] Slice 2: role-scoped CHRO / HR-head dashboards.
- [ ] Slice 3: embedded HR copilot (one conversation, database-backed).

## Enterprise readiness — slice 2 & 3 (done)
- [x] Slice 2: CHRO / HR-head leadership board on the dashboard (open demand, salary commitment vs departmental budget, pipeline coverage per seat, offer accept rate, time to hire, demand & supply by department). Recruiters keep the operational view only.
- [x] Slice 3: embedded HR copilot — floating panel on every page, one ongoing conversation per user persisted in `copilot_messages` (org-scoped, RLS own-rows), grounded in a live org data snapshot via the configured AI provider.
- [x] Org registration path made explicit on the sign-in screen ("New company? Register your organisation" → owner account → 4-step setup wizard).

## Landing page (done)
- [x] Replace the terse split-screen sign-in with an information-rich, Zoho-Recruit-style enterprise landing page (hero + sign-in card, capability grid, module walkthrough, scoring model, governance, FAQ, CTA) while keeping email/Google sign-in and org registration intact.

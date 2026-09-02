# Verification agent, talent pool table, and full candidate lifecycle

## 1. How LinkedIn/GitHub evaluation works today (and what's missing)

Today, for each candidate we harvest links from the CV text (LinkedIn, GitHub, X, portfolio), then:

- **GitHub** — real API read: original repos, stars, followers, active months, last push, language overlap with the JD. Fully deterministic and explainable.
- **LinkedIn** — third-party profiles are not readable via any API, so the agent scores the *career narrative* from the CV plus any recruiter-pasted profile text.
- **Portfolio / X / blog** — the page is fetched live, stripped to text, and scored by AI for depth and relevance.
- These blend into one social score (GitHub 45 / LinkedIn 40 / writing 15) worth 15 points of the match.

**Missing: genuineness.** Nothing currently cross-checks the projects, presentations, and claims written in the CV against the public evidence. That is what we add.

### Verification agent (new)

For every scored candidate, a verification agent will:

1. Extract discrete **claims** from the CV: projects, technologies, employers, publications/talks, certifications, dates.
2. Pull **evidence**: GitHub repo names/descriptions/languages/commit recency, fetched portfolio and article pages, LinkedIn text on file.
3. Return per claim a verdict — `verified` / `partially_verified` / `unverified` / `contradicted` — with the evidence snippet and where it came from.
4. Produce an **authenticity score (0-100)** plus red flags: unverifiable flagship project, timeline conflicts, skills claimed with zero public trace, portfolio that is a template or dead link, LinkedIn title inconsistent with the CV.
5. Store the result so recruiters and approvers see it next to the match score. Authenticity never silently changes the match score; low authenticity raises a visible risk flag and can gate shortlisting.

Genuineness is evidence-bounded by design: absence of public evidence is reported as "unverified", never as "fake".

## 2. Talent pool: table, not cards

Replace the card grid with a dense data table wired to the database:

- Columns: name, current title/experience, top skills, location, source, best match score, current stage, last activity, next action.
- Server-side filtering and pagination (talent pool is expected to grow past thousands): search by name/email/skill, filter by stage, source, experience band, score band, internal/external, verification status.
- Saved views (All, New this week, In interview, Offer stage, Rejected, On hold, Joined), bulk select for bulk actions (add to requisition, reject with reason, re-score, re-verify).
- Row expands to a compact detail drawer; full profile stays on its own page.

## 3. Candidate lifecycle wired to the DB

The current stage list stops at hired. Extend the state machine to cover reality:

```text
sourced -> screened -> shortlisted -> L1 -> L2 -> L3
        -> offer_pending -> offer_released -> offer_accepted / offer_declined
        -> joined / no_show / joining_deferred
        -> rejected (with reason) / withdrawn / on_hold / talent_pool_reserve
```

- Interviews become optional: a candidate can move to offer without every level, and every stage change is legal only along allowed transitions.
- New `stage_events` table: from-stage, to-stage, actor, reason, note, timestamp — a full audit trail visible on the candidate page.
- Interview records carry status: `unscheduled`, `scheduled`, `rescheduled`, `completed`, `no_show`, `cancelled`; the pipeline shows what is actually pending versus done.
- Rejection and withdrawal capture a structured reason from master data, so reports can show why we lose people.
- Stage changes are made through server functions that validate the transition and write the event, not raw table updates from the UI.

## 4. Regular sync (agents, not one-shot calls)

- A sync worker re-fetches social signals and re-runs verification for candidates whose data is stale (default 30 days) or who are active in a pipeline.
- Exposed as a scheduled endpoint plus a manual "Re-sync now" action per candidate and in bulk from the table.
- Every run records status, model, and timestamp, so a stale or failed signal is visible rather than silently old.
- A stage-hygiene pass flags stuck candidates: interview scheduled but past due, offer released with no response, shortlisted with no interview.

## Technical notes

- New migration: extend `app_stage` enum, add `stage_events`, add rejection-reason master kind, add `claim_verifications` (or a verification JSON column plus score on `match_scores`), add `last_synced_at` / `sync_status` on `candidates` and `social_profiles`. GRANTs and RLS policies included for every new table.
- Verification agent in `src/lib/verification.server.ts`, called from a new `verifyCandidate` server function and from the bulk pipeline run.
- Transition logic in `src/lib/lifecycle.ts` (allowed transitions, pure) + `src/lib/lifecycle.functions.ts` (validated server-side mutations).
- Table built on the existing UI kit with server-side pagination via a paged server function; sync endpoint under `src/routes/api/public/` with secret verification.

## Suggested build order

1. Migration + lifecycle state machine and stage events.
2. Talent pool table with filters, saved views, bulk actions.
3. Verification agent + authenticity panel on the candidate and matching pages.
4. Scheduled re-sync and stage-hygiene flags.

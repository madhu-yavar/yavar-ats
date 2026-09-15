# Screening support for HR + CHRO performance & incentives

Two features on top of the existing JD↔CV match.

## Feature 1 — Preliminary screening support

### A. Question kit (per candidate, per role)

On a candidate's record inside a role, a **Prepare screening questions** action produces
8–10 questions built from that specific JD↔CV comparison. Each question shows:

- the question itself
- **why to ask it** — the gap, claim or risk in this CV against this JD (e.g. must-have
  skill not evidenced, 14-month gap, tenure pattern, salary/notice mismatch, unverified
  social claim)
- **what a strong answer contains** — the expected signal, plus what a weak or evasive
  answer looks like
- a focus tag (must-have skill, experience depth, ownership, stability, logistics,
  culture/mindset) and a weight so the second-level score can be weighted

Questions are grouped by focus, printable, and copyable so HR can run the call from the
screen. HR can edit, delete or add a question; edits are kept with the kit.

### B. Answer capture and second-level score

Below the kit, HR records what the candidate actually said:

- **Type it** — one box per question, or one paste-in box for a whole call summary
- **Upload audio** — an interview recording (m4a/mp3/wav/webm). The file is stored in the
  private vault, transcribed, then the transcript is split against the questions

The agent then returns a **screening score (0–100)** with:

- per-question verdict: strong / partial / weak / not answered, a score, the evidence line
  from the answer, and a one-line rationale
- an overall rationale, red flags, and a recommendation (advance / hold / reject) with the
  reason
- a **combined fit** = the existing JD↔CV match blended with the screening score, shown
  side by side with both numbers so nothing is hidden

Every run records the provider and model that produced it, like the market benchmark does.
Re-running keeps history so HR can compare a second call with the first.

Transcription note: audio is transcribed with the organisation's own configured AI provider
when that provider transcribes audio (Gemini and OpenAI keys do). If the organisation is on
the built-in AI, built-in credits are used — the panel says which one ran.

## Feature 2 — HR team performance & incentives (CHRO)

A new **HR performance** section on the CHRO view, over a date range and department filter.

Per recruiter, from real pipeline activity (no manual entry):

- requisitions worked, candidates added, screenings run, interviews scheduled and held
- offers made, offers accepted, joiners
- conversion rates: added → screened → interviewed → offered → joined
- speed: median days to first screen, to interview, to offer, to close
- quality: average match score of candidates they advanced, interview no-show rate,
  offer-decline rate, rejection-after-interview rate
- an overall **performance score** out of 100 from a weighted mix of volume, conversion,
  speed and quality, with each component visible so the number is explainable

Incentives:

- the CHRO sets the scheme once: target closures per recruiter per month, payout per
  closure, quality multiplier bands (e.g. score ≥85 → 1.2×), and an optional cap
- the table then shows, per recruiter: closures against target, attainment %, quality
  multiplier, **computed incentive**, and the workings behind it
- leaderboard view, team totals, incentive budget for the period, and CSV export for payroll

Only the CHRO / HR head / owner sees it; a recruiter never sees peers' numbers.

## Technical notes

- Migration adds `screening_kits` (org, candidate, requisition, questions jsonb, engine,
  created_by), `screening_runs` (kit, answers jsonb, transcript, audio_path, score,
  per-question verdicts jsonb, rationale, recommendation, engine, created_by) and
  `hr_incentive_schemes` (org, period settings, payout, multiplier bands, cap). All with
  GRANTs, RLS scoped to the org, and CHRO-only write on the scheme table.
- Private storage bucket for screening audio, same org/candidate folder pattern and
  signed-URL access as the resume vault.
- `src/lib/screening.server.ts` builds the kit and grades answers through the existing
  `aiJson` resolver, so it follows the organisation's provider/model choice and BYO key.
  Audio goes through a new transcription helper in the same file.
- `src/lib/screening.functions.ts` exposes authenticated server functions: build kit, save
  edits, submit typed answers, upload audio, grade, fetch history.
- `src/lib/hr-performance.server.ts` aggregates from `stage_events.actor`, `applications`,
  `interviews`, `offers`, `match_scores` and the new screening tables; recruiter attribution
  comes from the actor on each stage move. `src/lib/hr-performance.functions.ts` gates it to
  CHRO/HR head/owner.
- UI: a Screening panel on `src/routes/candidates.$id.tsx` (and reachable from the matching
  page), plus an HR performance section with the incentive editor on `src/routes/reports.tsx`.

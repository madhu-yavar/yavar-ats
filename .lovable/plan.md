# Talent pool ↔ JD matching, LinkedIn posting, smart weights

Yes — we're aligned. The model you described is exactly the right one, and it's what this plan builds:

```text
Talent pool (grows continuously)          New CVs from posts / IJP / imports
        |                                              |
        +---------------------+------------------------+
                              v
                 Requisition + approved JD
                              v
        Shortlist candidates -> score (skills / exp / edu / social)
                              v
              Ranked pipeline -> interviews -> offer
```

The talent pool is permanent and requisition-agnostic. A JD never "owns" CVs — an **application** links a candidate to a requisition, and a **match score** is the JD-vs-CV verdict for that pair. Same CV can be scored against many JDs with different weights.

## 1. Education requirement — multi-select (same as Location)

Requisition form: replace the single education dropdown with a pick-or-create multi-select so a requisition can accept e.g. "B.E. Computer Science", "B.Tech IT", "MCA". Stored as a joined value on `education_requirement`, and passed to scoring as an "any of these qualifies" list so the AI stops penalising equivalent degrees.

## 2. Fix bulk CV upload in the Talent pool

Current flow: read file in browser → extract text (pdf.js / mammoth) → AI parse → insert candidate. Failure points to fix:
- pdf.js worker URL fails to load in the built app → pin the worker from the installed package and fall back to a no-worker path.
- Files with no extractable text (scanned/image PDFs) fail silently per-file → surface a clear per-file reason.
- Whole batch stops feeling responsive on 20+ files → process with bounded concurrency (3 at a time) and a live per-file status list.
- Duplicate email collisions → match existing candidate by email and update instead of erroring.
- Errors are only in a dialog log → also log the real error to the console and keep the dialog open until dismissed.

I'll reproduce with a real PDF and DOCX in the browser before calling it fixed.

## 3. Connect JD to CVs — an explicit "Source candidates" step

New panel on the requisition page (and mirrored on the Matching page):

- **From talent pool** — searchable, filterable list (skill overlap with the JD must-haves, experience band, location, internal/external) with a suggested set pre-ticked. Ticking adds applications in one click.
- **New CVs for this requisition** — the same bulk uploader, but it creates the candidate *and* the application against this requisition in one pass.
- **Auto-shortlist** — one button: rank the whole pool by cheap deterministic overlap (must-have skill hits + experience band), take the top N, create applications, then run the AI scoring pipeline on them.

After sourcing, "Score pipeline" produces the ranked table you already have — skills / experience / education / social breakdown per candidate, with rationale and risk flags.

## 4. Match weights with JD intelligence

Add **Suggest from JD**: the AI reads the approved JD (must-haves, responsibilities, qualification wording, seniority) and returns a weight set plus a one-line reason per dimension — e.g. a hands-on senior backend role pushes Skills up and Education down; a fresher role pushes Education and Social up. You can accept, tweak (auto-rebalanced to 100), or reset to requisition defaults. Accepting writes the weights back to the requisition so every future run inherits them.

## 5. LinkedIn job post designer

- **Design**: on an approved requisition, a "Post to LinkedIn" panel generates a post from the JD — hook line, role summary, 4-5 bullets, location/band, CTA and hashtags — with a live preview rendered like a LinkedIn card, fully editable, plus character count.
- **Post**: uses the LinkedIn connection from the Integrations page. Admin configures which organisation page to post as and whether posting is manual or automatic on approval.
- **Guardrails**: the button only lights up when the requisition is approved and the LinkedIn connection tests green; otherwise it shows exactly what's missing. Posted state, timestamp and permalink are stored on the requisition and shown on the card.
- If LinkedIn credentials aren't provisioned yet, "Copy post" + "Open LinkedIn" still gives you a working manual path, so the designer is useful on day one.

## Technical notes

- Migration: `education_requirement` stays TEXT (joined list, no breaking change); new nullable columns on `requisitions` for LinkedIn post body, posted-at, post URL and target org; new nullable admin config on the LinkedIn integration row for auto-post-on-approval.
- New server fns in `src/lib/matching.functions.ts`: `suggestWeights` (JD → weights + rationale) and `draftSocialPost` (JD → post copy). LinkedIn publishing goes in `src/lib/integrations.server.ts` behind a `postToLinkedin` server fn that reads credentials server-side only.
- Pool shortlisting ranker is deterministic and local (no AI cost) in a new `src/lib/shortlist.ts`; AI scoring stays in the existing bulk pipeline.
- Bulk upload refactor: shared `intakeCvs()` helper used by both the Talent pool page and the requisition sourcing panel.

## Order of work

1. Fix bulk CV upload (blocking everything else).
2. Education multi-select.
3. Requisition "Source candidates" panel + auto-shortlist.
4. Suggest weights from JD.
5. LinkedIn post designer + posting/config.

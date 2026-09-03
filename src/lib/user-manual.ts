/**
 * The single source of truth for the ATSIQ user manual.
 *
 * It is rendered on /help for humans and injected into the HR copilot prompt, so an
 * organisation can self-configure and operate the platform without external hand-holding.
 * Edit here only — both surfaces stay in sync automatically.
 */

export type ManualSection = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
};

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "registration",
    title: "1. Registering your organisation",
    summary:
      "Every user belongs to an organisation. Accounts cannot exist on their own, so the organisation is registered first and a platform super admin approves it.",
    steps: [
      "Sign up with your work email address. Free or disposable mailboxes (gmail, outlook, yahoo, temporary domains) are rejected — the domain proves the organisation is genuine.",
      "Confirm your email from the verification message sent to that inbox.",
      "Complete the registration wizard: organisation name, registered legal name, industry, headquarters country and city, reporting currency, careers inbox, plus at least one department and one location. All of these are mandatory.",
      "Your organisation is then queued for review and you see the 'Awaiting platform approval' screen. It refreshes itself — you do not need to sign out and back in.",
      "A platform super admin approves or rejects the registration. You receive an acknowledgement email either way, and approval opens the workspace on your next screen refresh.",
    ],
  },
  {
    id: "users",
    title: "2. Users, roles and access (Users & roles)",
    summary:
      "The registering user becomes the organisation owner. Only the owner invites internal users, and invitations are restricted to your own email domain.",
    steps: [
      "Invite a colleague from Users & roles (/team) with their work email and the role they should hold.",
      "Roles available: recruiter, hiring manager, department head, HR head, president/CBO. Roles decide who can approve requisitions, job descriptions and offers.",
      "Grant or revoke roles at any time from the row action menu.",
      "Pause access to suspend someone while keeping all their history; delete removes the membership and roles permanently.",
      "The owner cannot be deleted until ownership is transferred. A platform super admin can remove any user, including an owner.",
      "Use search, role and status filters, pagination and CSV export to manage large employee bases.",
    ],
  },
  {
    id: "configuration",
    title: "3. First-time configuration",
    summary: "Three pages get a fresh tenant production-ready.",
    steps: [
      "Master data (/masters): departments, skills, locations, education levels and industries. Everything else picks from these lists, so fill them first.",
      "Integrations (/integrations): connect sourcing (LinkedIn, GitHub) and meeting providers (Microsoft Teams, Zoom, Google Meet/Calendar). Credentials are stored server-side and never exposed to the browser; use 'Test' to confirm each one.",
      "Organisation (/organisation): keep the organisation profile, currency and careers inbox current. The owner can also archive the organisation here — archiving locks everyone out but deletes nothing.",
      "AI provider: choose Gemini, OpenAI or Claude and the model used for matching, scoring, verification and the copilot. Test the connection before running batches.",
    ],
  },
  {
    id: "requisitions",
    title: "4. Requisitions and job descriptions",
    summary: "A requisition is the hiring demand; the JD is its published description. Both move through approval.",
    steps: [
      "Create a requisition (/requisitions) with department, openings, experience band, budget, location, must-have and good-to-have skills.",
      "Set the scoring weights on the requisition: skills, experience, career history, impact, education and social. They must total 100. Ask the AI for a suggestion if unsure.",
      "Draft or paste the JD; the parser splits purpose, responsibilities, must-have and good-to-have skills and qualifications into versioned fields.",
      "Send for approval: department head, then HR head, then president/CBO where required. Every decision is recorded in the approval trail.",
      "Approved requisitions become open, can be posted internally (IJP) and start accepting applications.",
    ],
  },
  {
    id: "talent-pool",
    title: "5. Talent pool and CV intake",
    summary: "One growing candidate pool, deduplicated and freshness-tracked.",
    steps: [
      "Add candidates individually or upload CVs in bulk (PDF/DOCX) on Talent pool (/candidates) — parsing fills name, contact, skills, experience and employment history automatically.",
      "Review parsing quality in the table: filter by skill, experience, location, source, freshness and duplicates.",
      "Freshness: fresh (updated within 90 days), aging (91-365 days), stale (over a year). Refresh or re-sync stale profiles before relying on them.",
      "Duplicates are grouped by normalised email, phone and name. Merge keeps the richest record and reassigns every application, interview, offer and score.",
      "Social links (LinkedIn, GitHub, X, portfolio, blog) are fetched and verified where the provider allows it; the verification agent scores authenticity and flags contradictions against CV claims.",
    ],
  },
  {
    id: "matching",
    title: "6. JD to CV matching and scoring",
    summary:
      "Scoring is evidence-based and always out of 100, using the requisition's own weights.",
    steps: [
      "Open Matching engine (/matching) and pick a requisition.",
      "'Suggested from pool' pre-ranks existing talent-pool candidates against that JD; add the ones worth pursuing to the pipeline.",
      "Select candidates (or the whole pipeline) and run scoring in bulk.",
      "Each score breaks down into skills, experience, career history, impact/ownership, innovation/learning, education and social, with matched and missing skills, rationale and risk flags.",
      "A recruiter can override the AI recommendation with a reason; the original score and the override are both retained.",
    ],
  },
  {
    id: "interviews",
    title: "7. Interviews",
    summary: "Multi-level interviews with calendar invites, scorecards and automatic progression.",
    steps: [
      "Schedule from Interviews (/interviews): level, interviewer and email, mode, duration and agenda. The candidate's stored email is used for the invite.",
      "A meeting link is created with your configured provider and an .ics invite is issued to interviewer and candidate.",
      "Reschedule from the same row; a reason is mandatory and the change is audited.",
      "Interviewers open My interviews (/interviews/mine) and submit a competency scorecard with rating, comments and a recommendation. Submissions lock.",
      "Select advances the candidate to the next level, hold pauses the pipeline, reject closes it with a required reason.",
      "Optional AI screening interviews score JD match, skillset, role fit and culture fit before human rounds.",
    ],
  },
  {
    id: "offers",
    title: "8. Offers and joining",
    summary: "Candidates reaching the offer stage flow through approval, release and joining.",
    steps: [
      "When a candidate clears the final interview level, move them to the offer stage; they then appear on Offers (/offers).",
      "Raise the offer with CTC and joining date; it routes through HR and CBO approval.",
      "Release the approved offer, then record accepted, declined, revoked, joined, no-show or deferred outcomes.",
      "Every stage change captures actor, reason and note, so the audit trail is complete.",
    ],
  },
  {
    id: "reports",
    title: "9. Reports and dashboards",
    summary: "Operational analytics for recruiters and executive views for HR heads and the CHRO.",
    steps: [
      "Dashboard (/) is the command centre: KPIs, funnel, pool health, source mix, requisition analytics, stalled candidates, skill gaps, offers and upcoming interviews.",
      "Reports (/reports) adds filters by department, requisition, location, skill, source and date, plus funnel conversion, score distribution, drop-off, interviewer load and CSV export.",
      "Executive views summarise open demand, cost against budgeted headcount, time-to-hire and pipeline risk.",
    ],
  },
  {
    id: "copilot",
    title: "10. HR copilot",
    summary: "An embedded assistant grounded in your own live data and in this manual.",
    steps: [
      "Open the copilot from any page and ask about your pipeline, a requisition, pool coverage for a skill, or how to perform any task in the platform.",
      "It answers only from your organisation's data and this manual — it never invents candidates or numbers.",
      "The conversation is stored per user and can be cleared at any time.",
    ],
  },
  {
    id: "platform",
    title: "11. Platform super admin (product owner only)",
    summary: "Cross-tenant administration lives on Platform console (/platform).",
    steps: [
      "Review the pending registration queue and approve or reject organisations; the registering owner is emailed the decision.",
      "See every organisation's live statistics: members, requisitions, candidates, interviews, offers and hires.",
      "Edit an organisation profile, archive and restore it, or permanently delete it — deletion is irreversible, requires the exact organisation name and also removes login accounts left without any other membership.",
      "Manage the super-admin allowlist by email.",
    ],
  },
];

/** Markdown rendering of the manual, used for the copilot knowledge base. */
export const MANUAL_TEXT = MANUAL_SECTIONS.map(
  (s) => `${s.title}\n${s.summary}\n${s.steps.map((t) => `- ${t}`).join("\n")}`,
).join("\n\n");

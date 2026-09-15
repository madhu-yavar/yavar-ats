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
      "Invite a colleague from Users & roles (/team) with their work email and the role they should hold. They receive a branded invitation email immediately.",
      "Change someone's roles later from the Roles (click to edit) cell in their row: tick to grant, untick to revoke. Both the organisation owner and any President/CBO admin can do this; other roles can view but not change.",
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
      "Screen space: collapse the left People Excellence menu with the arrow button beside its title. The choice is remembered on that browser, and the icons stay clickable while collapsed.",
      "Master data (/masters): departments, skills, locations, education levels and industries. Everything else picks from these lists, so fill them first.",
      "Integrations (/integrations) is split into three tabs: Candidate sources, Interview meetings and AI model. Each row is closed until you click it, so the page stays short; open a row to paste credentials, press Save and then Test.",
      "Credentials are stored on the server and are never sent back to the browser. 'What each source can do' at the bottom of the sources tab explains what LinkedIn, the careers inbox, Naukri, Indeed and GitHub each need.",
      "Organisation (/organisation): keep the organisation profile, currency and careers inbox current. The owner can also archive the organisation here — archiving locks everyone out but deletes nothing.",
      "AI provider: choose Gemini, OpenAI or Claude and the model used for matching, scoring, verification and the copilot. Test the connection before running batches.",
    ],
  },
  {
    id: "requisitions",
    title: "4. Requisitions and job descriptions",
    summary:
      "A requisition is the hiring demand; the JD is its published description. Both move through approval.",
    steps: [
      "Create a requisition (/requisitions) with department, openings, experience band, budget, location, must-have and good-to-have skills.",
      "Use role-profile assistance to fill missing skills, qualifications and responsibilities from the role title; existing HR entries are preserved and remain editable.",
      "Use Get market range for a current low, median and high compensation benchmark. Review the named public sources, evidence extracts, freshness and confidence before adopting the suggested CTC band.",
      "Set the scoring weights on the requisition: skills, experience, career history, impact, education and social. They must total 100. Ask the AI for a suggestion if unsure.",
      "Draft or paste the JD; the parser splits purpose, responsibilities, must-have and good-to-have skills and qualifications into versioned fields.",
      "Send for approval: department head, then HR head, then president/CBO where required. Every decision is recorded in the approval trail.",
      "Approved requisitions become open, can be posted internally (IJP) and start accepting applications.",
    ],
  },
  {
    id: "talent-pool",
    title: "5. Talent pool and CV intake",
    summary:
      "A shared organisation pool with clear recruiter ownership, source history, duplicate control and freshness tracking.",
    steps: [
      "Add candidates individually or upload CVs in bulk (PDF/DOCX) on Talent pool (/candidates) — parsing fills name, contact, skills, experience and employment history automatically.",
      "Use Mine, Unassigned or All to focus the list. Every candidate can have an owning recruiter; assignment and hand-over history remains visible.",
      "Review the master-detail view and filter it by skill, experience, location, source, added date, freshness, duplicates, owner and stage. Source identifies manual upload, LinkedIn capture, careers inbox, Naukri, Indeed, referral, consultant, campus or IJP.",
      "Freshness: fresh (updated within 90 days), aging (91-365 days), stale (over a year). Refresh or re-sync stale profiles before relying on them.",
      "Select rows to move stage, merge duplicates, re-run verification, or permanently delete candidates along with their applications, interviews, scores and stored CV files.",
      "Duplicates are grouped by normalised email, phone and name. Merge keeps the richest record and reassigns every application, interview, offer and score.",
      "Social links (LinkedIn, GitHub, X, portfolio, blog) are fetched and verified where the provider allows it; the verification agent scores authenticity and flags contradictions against CV claims.",
      "Original CVs are held privately. Open or download them through ATSIQ, rather than through the storage host. A profile-only LinkedIn capture remains usable and is marked as file pending until the original CV is recovered.",
    ],
  },
  {
    id: "candidate-sources",
    title: "6. Candidate sources and LinkedIn Recruiter capture",
    summary: "Source candidates without losing their origin, evidence or original CV.",
    steps: [
      "Configure candidate sources on Integrations (/integrations). The careers inbox can import attached CVs; LinkedIn Recruiter capture uses the downloadable ATSIQ browser companion.",
      "In LinkedIn Recruiter, open the job's applicant list and start the companion. It visits applicants in the authenticated Recruiter session, reads the active profile and public profile link, finds the CV under Highlights or Attachments, and sends the evidence to ATSIQ.",
      "The companion reports the precise failed stage when navigation, identity confirmation, attachment discovery, download, private storage or analysis does not complete. Stop interrupts the current wait rather than leaving the run stuck.",
      "A successful original-file capture is parsed and stored privately. When only validated profile evidence is available, ATSIQ keeps the candidate, runs available social analysis and matching, and waits for a later CV capture to enrich the same person.",
      "Use Careers inbox (/inbox) to trigger mailbox intake and background matching for CVs received through job advertisements.",
    ],
  },
  {
    id: "matching",
    title: "7. JD to CV matching and scoring",
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
    id: "screening",
    title: "8. Preliminary screening-call support",
    summary:
      "A JD-and-CV-specific helper for consistent recruiter screening and explainable second-level matching.",
    steps: [
      "Open Screening calls (/screening), choose a requisition and candidate, or open the Screening section on the candidate profile.",
      "Generate a question kit. Each question includes why HR should ask it, the most relevant answer expected, and weak-answer guidance grounded in the JD and candidate evidence.",
      "Review, edit, remove, copy or print the questions before the call. The saved kit remains attached to that candidate and role.",
      "After the call, enter answers question by question, paste whole-call notes, or upload the private audio recording for transcription.",
      "Submit for analysis to receive per-question verdicts and evidence, a screening score, recommendation, red flags and rationale. ATSIQ also shows the combined fit using 60% existing JD/CV match and 40% screening result.",
      "Previous runs and private recording links remain available for authorised organisation users.",
    ],
  },
  {
    id: "interviews",
    title: "9. Interviews",
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
    title: "10. Offers and joining",
    summary: "Candidates reaching the offer stage flow through approval, release and joining.",
    steps: [
      "When a candidate clears the final interview level, move them to the offer stage; they then appear on Offers (/offers).",
      "Raise the offer with CTC and joining date; it routes through HR and CBO approval.",
      "Release the approved offer, then record accepted, declined, revoked, joined, no-show or deferred outcomes.",
      "Every stage change captures actor, reason and note, so the audit trail is complete.",
    ],
  },
  {
    id: "collaboration",
    title: "11. Recruiter ownership, referrals and talent sharing",
    summary:
      "The organisation shares one talent pool while ownership and every hand-over remain explicit.",
    steps: [
      "Assign or take ownership from Talent pool, including bulk assignment. Mine shows your candidates, Unassigned shows work needing an owner, and All preserves organisation-wide visibility.",
      "On a candidate profile, use Ownership & team to hand the candidate to a colleague, refer them to a colleague's requisition, add notes and mention teammates. Ownership events form a permanent trail.",
      "Open Team & sharing (/collaboration) to accept or decline referrals and see referrals you sent. Accepting a referral makes you the owner and adds the candidate to the named role when applicable.",
      "Post a request for talent with role, skills and context. Colleagues can suggest candidates already in the shared pool, and the requester can close the request when filled.",
      "Organisation owners can offer or respond to an opt-in pool-sharing agreement with another organisation. Sharing is explicit and can be revoked; it is never enabled automatically.",
    ],
  },
  {
    id: "reports",
    title: "12. Dashboards, reports and HR performance",
    summary:
      "Operational work for recruiters and governance, quality and performance views for HR leadership.",
    steps: [
      "Dashboard (/) changes with the signed-in role. Recruiters see operational priorities; CHROs, HR heads and owners see decisions and prescriptions such as approval aging, weak pipeline coverage, screening gaps, SLA breaches, offer health, budget risk and funnel drop-off.",
      "Reports (/reports) adds filters by department, requisition, location, skill, source and date, plus funnel conversion, score distribution, drop-off, interviewer load and CSV export.",
      "Leadership-only HR performance compares recruiter activity, quality, conversion, speed and target attainment. Configure incentive bands and caps, inspect the calculation and export the result; recruiters cannot see the team-governance view.",
      "Platform super admins receive a cross-organisation aggregate view, while organisation records remain separated by access controls.",
    ],
  },
  {
    id: "copilot",
    title: "13. HR copilot",
    summary: "An embedded assistant grounded in your own live data and in this manual.",
    steps: [
      "Open the copilot from any page and ask about your pipeline, a requisition, pool coverage for a skill, or how to perform any task in the platform.",
      "It answers only from your organisation's data and this manual — it never invents candidates or numbers.",
      "The conversation is stored per user and can be cleared at any time.",
    ],
  },
  {
    id: "platform",
    title: "14. Platform super admin (product owner only)",
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

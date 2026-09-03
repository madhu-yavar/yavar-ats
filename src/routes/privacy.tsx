import { createFileRoute } from "@tanstack/react-router";

import { LegalPage, type LegalSection } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — ATSIQ by Yavar AI" },
      {
        name: "description",
        content:
          "How Yavar AI collects, uses, stores and protects recruiter and candidate data inside the ATSIQ applicant tracking platform, and the rights available to data subjects.",
      },
      { property: "og:title", content: "Privacy Policy — ATSIQ by Yavar AI" },
      {
        property: "og:description",
        content: "Data collection, purpose, retention, sharing and data-subject rights for the ATSIQ platform.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://atsiq.yavar.ai/privacy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://atsiq.yavar.ai/privacy" }],
  }),
  component: Privacy,
});

const SECTIONS: LegalSection[] = [
  {
    title: "Who we are",
    body: [
      "ATSIQ is a talent-acquisition platform operated by Yavar AI (Yavar Techworks). When your organisation registers on ATSIQ, your organisation is the controller of the recruiting data it uploads and Yavar AI acts as the processor that hosts and processes that data on your instructions.",
      "Questions about this policy can be sent to the contact address published on yavar.ai.",
    ],
  },
  {
    title: "Information we collect",
    body: [
      "Organisation and user data: organisation name and legal name, industry, headquarters, reporting currency, work email addresses, names, titles and the roles assigned to each user.",
      "Candidate data supplied by your recruiters: name, contact details, location, CV text, education, employment history, skills, compensation expectations, notice period, consent flags, and the public professional links a candidate shares (for example LinkedIn, GitHub, portfolio or blog URLs).",
      "Process data generated in the product: requisitions and job descriptions, application stages and stage reasons, match scores and rationales, verification results, assessment answers, interview schedules, scorecards, offers and audit trails.",
      "Technical data: authentication events, timestamps, and application logs needed to keep the service secure and reliable.",
    ],
  },
  {
    title: "How we use it",
    body: [
      "To provide the service: hosting your organisation's workspace, matching CVs against job descriptions, evaluating publicly shared professional profiles, scheduling interviews, recording evaluations and producing reports.",
      "To communicate: registration confirmation, organisation approval or rejection notices, user invitations and workflow notifications.",
      "To keep the platform secure and available, to prevent abuse, and to meet legal obligations.",
      "We do not sell personal data and we do not use candidate data for advertising.",
    ],
  },
  {
    title: "AI processing",
    body: [
      "Scoring, verification, summarisation and copilot answers are produced with large-language-model providers. Your organisation chooses the provider and may supply its own API key. Only the data required for the task, such as the job description and the relevant CV or public profile text, is sent for processing.",
      "AI output is decision support. Hiring decisions remain with your recruiters and interviewers, and every score can be overridden with a recorded reason.",
    ],
  },
  {
    title: "Sharing",
    body: [
      "Data is visible only to the users of your organisation, scoped by their role. Yavar AI staff access tenant data only when required to operate or support the platform.",
      "We use service providers for hosting and database services, transactional email delivery, and the AI provider your organisation selects. Each processes data solely to deliver the service.",
      "We may disclose data where required by law or to protect rights, safety and the integrity of the platform.",
    ],
  },
  {
    title: "Retention",
    body: [
      "Recruiting records are retained while your organisation's workspace is active, so that audit trails and hiring history remain intact.",
      "When an organisation is archived, data is retained in a restorable state. When an organisation is permanently deleted by a platform administrator, its records and the accounts that belong only to it are removed.",
      "Candidate records are classified by freshness and can be merged or deleted by your organisation at any time.",
    ],
  },
  {
    title: "Your rights",
    body: [
      "Depending on where you live, you may request access, correction, deletion, restriction or portability of your personal data, and object to certain processing.",
      "Candidates should contact the organisation that holds their record; that organisation can correct, merge or delete it directly in the product. If you contact Yavar AI, we will route the request to the relevant organisation and assist as processor.",
    ],
  },
  {
    title: "Security",
    body: [
      "Access requires an authenticated account. Tenant data is isolated per organisation and enforced at the database layer, roles limit what each user can see and do, and provider API keys are stored server-side and never exposed in the browser.",
      "No system is perfectly secure. If we become aware of a breach affecting your data we will notify affected organisations without undue delay.",
    ],
  },
  {
    title: "Changes",
    body: [
      "We may update this policy as the product evolves. Material changes will be communicated to organisation owners by email; continued use after the effective date constitutes acceptance.",
    ],
  },
];

function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="How ATSIQ, the talent-acquisition platform by Yavar AI, handles organisation, recruiter and candidate data."
      sections={SECTIONS}
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { LegalPage, type LegalSection } from "@/components/LegalPage";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookies Policy — ATSIQ by Yavar AI" },
      {
        name: "description",
        content:
          "Which cookies and local browser storage ATSIQ uses, why each one is needed, how long it lasts, and how to control them in your browser.",
      },
      { property: "og:title", content: "Cookies Policy — ATSIQ by Yavar AI" },
      {
        property: "og:description",
        content: "Strictly necessary session storage, preference storage, and how to manage it.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://atsiq.yavar.ai/cookies" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://atsiq.yavar.ai/cookies" }],
  }),
  component: Cookies,
});

const SECTIONS: LegalSection[] = [
  {
    title: "What we use",
    body: [
      "ATSIQ is a private workplace application, not an advertising-funded website. We use only the cookies and browser storage needed to keep you signed in and to remember your working preferences.",
    ],
  },
  {
    title: "Strictly necessary",
    body: [
      "Authentication session: a token stored by your browser (cookie and local storage) that identifies your signed-in session, refreshes it while you work, and ends it when you sign out. Without it you cannot use the platform.",
      "Security and integrity: short-lived values used to protect sign-in, confirm your email address and prevent request forgery.",
    ],
  },
  {
    title: "Preferences",
    body: [
      "Interface state such as the filters, page size and column choices you last used on the talent pool, requisitions and reports screens, so lists open the way you left them. This data stays in your browser and is not used for tracking.",
    ],
  },
  {
    title: "What we do not use",
    body: [
      "No advertising or cross-site tracking cookies, no third-party marketing pixels, and no profiling of you across other websites.",
    ],
  },
  {
    title: "Retention",
    body: [
      "Session tokens last for the duration of your session and are removed when you sign out or when the session expires. Preference values persist in your browser until you clear site data.",
    ],
  },
  {
    title: "Managing cookies",
    body: [
      "You can clear or block cookies and site data in your browser settings at any time. Blocking the strictly necessary session storage will sign you out and prevent ATSIQ from working.",
      "Signing out from the application removes the session on that device.",
    ],
  },
  {
    title: "Contact",
    body: [
      "For questions about this policy, contact Yavar AI through the address published on yavar.ai, or reach us on LinkedIn at linkedin.com/company/yavar-techworks.",
    ],
  },
];

function Cookies() {
  return (
    <LegalPage
      title="Cookies Policy"
      intro="Cookies and browser storage used by ATSIQ, the talent-acquisition platform by Yavar AI."
      sections={SECTIONS}
    />
  );
}

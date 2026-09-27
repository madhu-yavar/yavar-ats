import * as React from "react";

import type { TemplateEntry } from "./registry";
import { EmailLayout, layoutStyles } from "./email-layout";

interface Props {
  candidateName?: string;
  orgName?: string;
  jobTitle?: string;
}

const { text } = layoutStyles;

const Email = ({ candidateName, orgName = "the hiring team", jobTitle = "the role" }: Props) => (
  <EmailLayout
    preview={`Your offer from ${orgName} for ${jobTitle}`}
    orgName={orgName}
    heading="Your offer letter is here"
    greeting={candidateName ? `Hi ${candidateName},` : "Hello,"}
  >
    <p style={text}>
      Congratulations! We are delighted to extend an offer to you for the{" "}
      <strong>{jobTitle}</strong> position at <strong>{orgName}</strong>.
    </p>
    <p style={text}>
      Your offer letter is attached to this email as a PDF. Please review it carefully. The
      recruiting team will reach out to walk you through the details and next steps.
    </p>
    <p style={text}>We look forward to welcoming you to the team.</p>
  </EmailLayout>
);

export const template = {
  component: Email,
  subject: (data: Props) =>
    `Your offer from ${data["orgName"] ?? "us"} — ${data["jobTitle"] ?? ""}`.replace(/\s+/g, " "),
  displayName: "Candidate offer released",
  previewData: {
    candidateName: "Asha",
    orgName: "Yavar TechWorks",
    jobTitle: "Senior Backend Engineer",
  },
} satisfies TemplateEntry;

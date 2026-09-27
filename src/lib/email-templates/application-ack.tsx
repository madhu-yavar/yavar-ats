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
    preview={`We have received your application for ${jobTitle}`}
    orgName={orgName}
    heading="We have received your application"
    greeting={candidateName ? `Hi ${candidateName},` : "Hello,"}
  >
    <p style={text}>
      Thank you for applying for <strong>{jobTitle}</strong> with <strong>{orgName}</strong>. Your
      application has been logged and our recruiting team will review it shortly.
    </p>
    <p style={text}>
      We will keep you updated on your status by email. No further action is needed from you right
      now.
    </p>
  </EmailLayout>
);

export const template = {
  component: Email,
  subject: (data: Props) => `Application received — ${data["jobTitle"] ?? "your application"}`,
  displayName: "Candidate application acknowledgment",
  previewData: {
    candidateName: "Asha",
    orgName: "Yavar TechWorks",
    jobTitle: "Senior Backend Engineer",
  },
} satisfies TemplateEntry;

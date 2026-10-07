import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import type { TemplateEntry } from "./registry";

interface Props {
  siteName?: string;
  siteUrl?: string;
  joinUrl?: string;
  orgName?: string;
  inviteeName?: string;
  inviterName?: string;
  roleLabel?: string;
  title?: string;
  email?: string;
}

/**
 * Organisation-invitation email. This is the member-onboarding artefact: it
 * narrates the platform, walks the invitee through joining step by step and
 * states the sign-in procedure for every visit after the first.
 * joinUrl (signed, 7 days) is the primary call to action; when absent the
 * template degrades to the sign-in page.
 */
const Email = ({
  siteName = "ATSIQ",
  siteUrl = "https://atsiq.yavar.ai",
  joinUrl,
  orgName = "your organisation",
  inviteeName,
  inviterName,
  roleLabel = "Recruiter",
  title,
  email,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Set your password and join {orgName} on {siteName} as {roleLabel}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>You've been invited to join {orgName}</Heading>
        <Text style={text}>
          {inviterName ? `${inviterName} has` : "Your organisation administrator has"} added you{" "}
          {inviteeName ? `(${inviteeName}) ` : ""}to the <strong>{orgName}</strong>{" "}
          talent-acquisition workspace on {siteName} as <strong>{roleLabel}</strong>
          {title ? ` (${title})` : ""}.
        </Text>

        {joinUrl ? (
          <>
            <Button style={button} href={joinUrl}>
              Set your password and join
            </Button>
            <Text style={small}>
              This link is personal to <strong>{email}</strong>, works for 7 days and is the only
              step you need — it sets your password, confirms your email and opens your workspace.
            </Text>
          </>
        ) : (
          <Button style={button} href={siteUrl}>
            Sign in to {siteName}
          </Button>
        )}

        <Hr style={hr} />

        <Heading style={h2}>What is {siteName}?</Heading>
        <Text style={text}>
          {siteName} is an enterprise recruiting operating system. Everything your team hires with —
          job requisitions and their approvals, the candidate talent pool, CV parsing, explainable
          JD-to-CV matching, interview scheduling and offers — lives in one auditable workspace, so
          every hiring decision carries its own evidence and trail.
        </Text>

        <Section style={stepsBox}>
          <Text style={stepsTitle}>Getting started — three steps</Text>
          <Text style={step}>
            <strong>1. Set your password.</strong> Click the button above, choose a password, and
            you're done — your account is created and your email address is confirmed in the same
            step.
          </Text>
          <Text style={step}>
            <strong>2. You land straight in.</strong> The workspace opens with your {roleLabel}{" "}
            access already applied — nothing to configure, nobody to wait on.
          </Text>
          <Text style={step}>
            <strong>3. Sign in any time.</strong> Visit {siteUrl} and use this email address (
            <strong>{email}</strong>) with the password you created. Forgot it? Use "Forgot your
            password?" on the sign-in screen and a reset link is mailed to you.
          </Text>
        </Section>

        <Heading style={h2}>What you can do once you're in</Heading>
        <Section>
          <Text style={step}>
            <strong>Requisitions.</strong> Raise roles, draft job descriptions and route them for
            approval.
          </Text>
          <Text style={step}>
            <strong>Talent pool.</strong> Upload CVs in bulk; parsing extracts skills, experience,
            education and social profiles.
          </Text>
          <Text style={step}>
            <strong>Matching.</strong> Score candidates against a requisition and shortlist the
            strongest — every score carries its evidence.
          </Text>
          <Text style={step}>
            <strong>Interviews &amp; offers.</strong> Schedule sessions, collect scorecards and move
            candidates through to joining.
          </Text>
        </Section>

        <Hr style={hr} />
        <Text style={small}>
          Already using {siteName} with this address? Simply sign in — this invitation is applied to
          your account automatically.
        </Text>
        <Text style={footer}>
          You received this message because you were added to {orgName} on{" "}
          <Link href={siteUrl} style={link}>
            {siteName}
          </Link>
          . If this looks unexpected, contact your organisation administrator — no account is
          created unless you set a password.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Props) =>
    `You're invited — join ${data["orgName"] ?? "your organisation"} on ATSIQ as ${
      data["roleLabel"] ?? "a team member"
    }`,
  displayName: "Team member invited",
  previewData: {
    siteName: "ATSIQ",
    siteUrl: "https://atsiq.yavar.ai",
    joinUrl: "https://z-atsiq.yavar.ai/join/example-token",
    orgName: "Yavar TechWorks",
    inviteeName: "Saranya",
    inviterName: "Madhu",
    roleLabel: "Recruiter",
    title: "Talent Partner",
    email: "saranya.r@yavar.ai",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const brand = {
  fontSize: "13px",
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "#0f172a",
  fontWeight: "bold",
  margin: "0 0 22px",
};
const h1 = { fontSize: "22px", fontWeight: "bold", color: "#0f172a", margin: "0 0 18px" };
const h2 = { fontSize: "16px", fontWeight: "bold", color: "#0f172a", margin: "24px 0 12px" };
const text = { fontSize: "14px", color: "#45505f", lineHeight: "1.6", margin: "0 0 18px" };
const small = { fontSize: "13px", color: "#45505f", lineHeight: "1.6", margin: "22px 0 0" };
const link = { color: "#1d4ed8", textDecoration: "underline" };
const button = {
  backgroundColor: "#0f172a",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const hr = { borderColor: "#e5e7eb", margin: "28px 0 20px" };
const stepsBox = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "16px 18px",
  margin: "0 0 8px",
};
const stepsTitle = {
  fontSize: "13px",
  fontWeight: "bold",
  color: "#0f172a",
  margin: "0 0 12px",
};
const step = { fontSize: "13px", color: "#45505f", lineHeight: "1.6", margin: "0 0 10px" };
const footer = { fontSize: "12px", color: "#9ca3af", margin: "26px 0 0", lineHeight: "1.6" };

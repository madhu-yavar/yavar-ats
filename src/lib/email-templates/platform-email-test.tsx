import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

import type { TemplateEntry } from "./registry";

interface Props {
  siteName?: string;
  recipient?: string;
}

/** Sent from Integrations → Transactional email ("Send test email") to the requesting super user. */
const Email = ({ siteName = "ATSIQ", recipient }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Transactional email is configured and delivering</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>Email is working</Heading>
        <Text style={text}>
          This test message was sent from the platform console
          {recipient ? (
            <>
              {" "}
              to <strong>{recipient}</strong>
            </>
          ) : null}
          . Registration confirmations, invitations, password resets and candidate notifications
          will now reach their recipients.
        </Text>
        <Button style={button} href="/">
          Open {siteName}
        </Button>
        <Text style={footer}>
          You received this because a platform super user requested a test send. No action is
          needed.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: "Email is working — ATSIQ test send",
  displayName: "Platform email test",
  previewData: { siteName: "ATSIQ", recipient: "admin@yavar.ai" },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const brand = {
  fontSize: "13px",
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "#0f172a",
  fontWeight: "bold" as const,
  margin: "0 0 22px",
};
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#0f172a", margin: "0 0 18px" };
const text = { fontSize: "14px", color: "#45505f", lineHeight: "1.6", margin: "0 0 18px" };
const button = {
  backgroundColor: "#0f172a",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const footer = { fontSize: "12px", color: "#9ca3af", margin: "26px 0 0", lineHeight: "1.6" };

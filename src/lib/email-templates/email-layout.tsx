import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";

interface EmailLayoutProps {
  preview: string;
  orgName: string;
  siteName?: string;
  siteUrl?: string;
  heading: string;
  greeting?: string;
  children?: React.ReactNode;
}

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
const text = { fontSize: "14px", color: "#45505f", lineHeight: "1.6", margin: "0 0 14px" };
const detail = { fontSize: "14px", color: "#45505f", lineHeight: "1.6", margin: "0 0 6px" };
const hr = { borderColor: "#e5e7eb", margin: "28px 0 20px" };
const link = { color: "#1d4ed8", textDecoration: "underline" };
const footer = { fontSize: "12px", color: "#9ca3af", margin: "26px 0 0", lineHeight: "1.6" };

/**
 * Shared layout for candidate-facing templates. Greeting/greeting-name and all
 * variable copy are passed in as strings — dates are formatted at enqueue time.
 */
export function EmailLayout({
  preview,
  orgName,
  siteName = "ATSIQ",
  siteUrl = "https://atsiq.yavar.ai",
  heading,
  greeting,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>
            {orgName} · {siteName}
          </Text>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{greeting ?? "Hello,"}</Text>
          {children}
          <Hr style={hr} />
          <Text style={footer}>
            This message was sent on behalf of {orgName} by{" "}
            <Link href={siteUrl} style={link}>
              {siteName}
            </Link>
            , their recruiting platform. If you were not expecting it, you can safely ignore this
            email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const layoutStyles = { text, detail, link };

import * as React from "react";
import { render } from "@react-email/render";
import { EmailAPIError, sendLovableEmail } from "@lovable.dev/email-js";
import nodemailer from "nodemailer";
import { TEMPLATES, type TemplateData } from "./registry";

// Server-only: reads SMTP_URL (self-hosted) or LOVABLE_API_KEY (Lovable Cloud).
// Never import from client components.

// Configuration baked in at scaffold time
const SITE_NAME = "ATSIQ";
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers. NEVER use the root domain.
const SENDER_DOMAIN = "notify.atsiq.yavar.ai";
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// Can be the root domain when display_from_root is enabled — this is cosmetic only.
const FROM_DOMAIN = "atsiq.yavar.ai";

export type SendTemplateEmailResult =
  { sent: true } | { sent: false; reason: "recipient_suppressed" };

export interface EmailAttachment {
  filename: string;
  contentBase64: string;
  contentType: string;
}

/** Thrown when attachments are requested but the active transport cannot carry them. */
export class EmailAttachmentsUnsupportedError extends Error {
  constructor() {
    super("Attachments are only supported over SMTP — configure SMTP_URL to send them");
    this.name = "EmailAttachmentsUnsupportedError";
  }
}

export interface SendTemplateEmailOptions {
  templateData?: TemplateData;
  /** Dedupes retries of the same logical send; defaults to a random UUID (no dedupe). */
  idempotencyKey?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/**
 * Every send attempt — success or failure — lands in app_logs (source "email")
 * so delivery questions ("did the invite reach them?") are answerable from the
 * observability console instead of pod logs. Dynamic import keeps src/server/**
 * out of any client-reachable graph. Never throws.
 */
function logSend(
  level: "info" | "warn" | "error",
  args: { template: string; to: string; transport: "smtp" | "lovable" | "none"; startedAt: number },
  error?: unknown,
): void {
  void import("../../server/logger")
    .then((m) =>
      m.logApp(level, "email", `send ${args.template} → ${args.to}`, {
        detail: {
          template: args.template,
          to: args.to,
          transport: args.transport,
          durationMs: Date.now() - args.startedAt,
          ...(error == null
            ? {}
            : { error: error instanceof Error ? error.message : String(error) }),
        },
      }),
    )
    .catch(() => {});
}

/**
 * Renders a registered template and sends it through Lovable's managed email
 * API. Suppression, retries, and rate limits are enforced by Lovable
 * server-side. A suppressed recipient is an expected outcome
 * ({ sent: false }); any other failure throws — EmailAPIError exposes
 * .code and .status for branching.
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {},
): Promise<SendTemplateEmailResult> {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(", ")}`,
    );
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to;
  if (!recipient) {
    throw new Error("Recipient is required (the template defines no fixed recipient)");
  }

  const templateData = options.templateData ?? {};
  const element = React.createElement(template.component, templateData);
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof template.subject === "function" ? template.subject(templateData) : template.subject;
  const from = process.env["EMAIL_FROM"] || `${SITE_NAME} <noreply@${FROM_DOMAIN}>`;

  // Self-hosted deployments send over their own SMTP (documented in
  // DEPLOYMENT-GCP.md); the Lovable API path only exists on Lovable Cloud.
  const startedAt = Date.now();
  const smtpUrl = process.env["SMTP_URL"];
  if (smtpUrl) {
    const transporter = nodemailer.createTransport(smtpUrl);
    try {
      await transporter.sendMail({
        from,
        to: recipient,
        subject,
        html,
        text,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.attachments?.length
          ? {
              attachments: options.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.contentBase64, "base64"),
                contentType: a.contentType,
              })),
            }
          : {}),
        headers: { "X-ATSIQ-Idempotency-Key": options.idempotencyKey || crypto.randomUUID() },
      });
    } catch (e) {
      logSend("error", { template: templateName, to: recipient, transport: "smtp", startedAt }, e);
      throw e;
    }
    logSend("info", { template: templateName, to: recipient, transport: "smtp", startedAt });
    return { sent: true };
  }

  if (options.attachments?.length) {
    throw new EmailAttachmentsUnsupportedError();
  }

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    logSend(
      "error",
      { template: templateName, to: recipient, transport: "none", startedAt },
      "Email is not configured: set SMTP_URL (self-hosted) or LOVABLE_API_KEY (Lovable Cloud)",
    );
    throw new Error(
      "Email is not configured: set SMTP_URL (self-hosted) or LOVABLE_API_KEY (Lovable Cloud)",
    );
  }

  try {
    await sendLovableEmail(
      {
        to: recipient,
        from,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: "transactional",
        label: templateName,
        idempotency_key: options.idempotencyKey || crypto.randomUUID(),
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      },
      { apiKey, sendUrl: process.env["LOVABLE_SEND_URL"] },
    );
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === "recipient_suppressed") {
      logSend(
        "warn",
        { template: templateName, to: recipient, transport: "lovable", startedAt },
        "recipient_suppressed by email provider",
      );
      return { sent: false, reason: "recipient_suppressed" };
    }
    logSend(
      "error",
      { template: templateName, to: recipient, transport: "lovable", startedAt },
      error,
    );
    throw error;
  }

  logSend("info", { template: templateName, to: recipient, transport: "lovable", startedAt });
  return { sent: true };
}

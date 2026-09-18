/**
 * Inbound mail endpoint for the per-organisation careers inbox.
 *
 * The mail provider that receives <org>@careers.atsiq.yavar.ai forwards each
 * message here as JSON, signed with the shared inbound secret. The recipient
 * address decides which tenant the applicant belongs to.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** One decoded attachment may not exceed this (base64 inflates ~4/3). */
const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_TOTAL_ATTACHMENT_BYTES = 25_000_000;

const Attachment = z.object({
  filename: z.string().min(1).max(300),
  content: z
    .string()
    .min(1)
    .refine((v) => v.length * 0.75 <= MAX_ATTACHMENT_BYTES, "Attachment too large"),
  contentType: z.string().max(200).optional(),
});

const Mail = z
  .object({
    to: z.string().min(3).max(320),
    from: z.string().min(3).max(320),
    subject: z.string().max(500).nullish(),
    text: z.string().max(500000).nullish(),
    messageId: z.string().max(300).nullish(),
    attachments: z.array(Attachment).max(10).optional(),
  })
  .refine(
    (m) =>
      (m.attachments ?? []).reduce((sum, a) => sum + a.content.length * 0.75, 0) <=
      MAX_TOTAL_ATTACHMENT_BYTES,
    "Attachments exceed the total size limit",
  );

/** Constant-time compare — never leak the secret through timing. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function authorised(request: Request): boolean {
  const secret = process.env["INBOUND_EMAIL_SECRET"];
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/.exec(header)?.[1]?.trim();
  const dedicated = request.headers.get("x-inbound-secret") ?? "";
  // Header-first; the query parameter is legacy and reads only when no header
  // arrived (it leaks into proxy logs, so it must not be the primary path).
  const token = dedicated || bearer || new URL(request.url).searchParams.get("token") || "";
  if (!token) return false;
  return safeEqual(token, secret);
}

async function handle(request: Request) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  let mail: z.infer<typeof Mail>;
  try {
    mail = Mail.parse(await request.json());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message.slice(0, 200) : "Invalid mail payload." },
      { status: 400 },
    );
  }

  try {
    const { receiveMail } = await import("@/lib/local-inbox.server");
    const result = await receiveMail(mail);
    return Response.json(result, { status: result.status === "error" ? 422 : 200 });
  } catch (e) {
    console.error("inbound mail failed", e);
    return Response.json({ error: "Inbound mail could not be processed." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/inbound-email")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});

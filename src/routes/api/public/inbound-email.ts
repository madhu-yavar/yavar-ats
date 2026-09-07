/**
 * Inbound mail endpoint for the per-organisation careers inbox.
 *
 * The mail provider that receives <org>@careers.atsiq.yavar.ai forwards each
 * message here as JSON, signed with the shared inbound secret. The recipient
 * address decides which tenant the applicant belongs to.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Attachment = z.object({
  filename: z.string().min(1).max(300),
  content: z.string().min(1),
  contentType: z.string().max(200).optional(),
});

const Mail = z.object({
  to: z.string().min(3).max(320),
  from: z.string().min(3).max(320),
  subject: z.string().max(500).nullish(),
  text: z.string().max(500000).nullish(),
  messageId: z.string().max(300).nullish(),
  attachments: z.array(Attachment).max(10).optional(),
});

function authorised(request: Request): boolean {
  const secret = process.env["INBOUND_EMAIL_SECRET"];
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/.exec(header)?.[1]?.trim();
  const token = bearer ?? new URL(request.url).searchParams.get("token") ?? "";
  return token.length === secret.length && token === secret;
}

async function handle(request: Request) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  let mail: z.infer<typeof Mail>;
  try {
    mail = Mail.parse(await request.json());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Invalid mail payload." },
      { status: 400 },
    );
  }

  try {
    const { receiveMail } = await import("@/lib/local-inbox.server");
    const result = await receiveMail(mail);
    return Response.json(result, { status: result.status === "error" ? 422 : 200 });
  } catch (e) {
    console.error("inbound mail failed", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Inbound mail could not be processed." },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/inbound-email")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});

/**
 * Capture endpoint for the ATSIQ browser companion.
 *
 * The companion runs in the recruiter's own browser, on a page they are already
 * signed in to, and posts the readable text here with the organisation's
 * capture key. The key decides the tenant; no other credential is involved.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Payload = z.object({
  token: z.string().min(20).max(200),
  kind: z.enum(["cv", "jd"]),
  text: z.string().max(400000).nullish(),
  file: z
    .object({
      filename: z.string().min(1).max(300),
      content: z.string().min(1).max(8000000),
    })
    .nullish(),
  sourceUrl: z.string().max(2000).nullish(),
  title: z.string().max(400).nullish(),
  candidateName: z.string().min(2).max(200).nullish(),
  requisitionId: z.string().uuid().nullish(),
});

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

async function handle(request: Request) {
  let body: z.infer<typeof Payload>;
  try {
    body = Payload.parse(await request.json());
  } catch (e) {
    return Response.json(
      { status: "error", detail: e instanceof Error ? e.message : "Invalid capture payload." },
      { status: 400, headers: cors },
    );
  }

  try {
    const { capture } = await import("@/lib/capture.server");
    const result = await capture({
      token: body.token,
      kind: body.kind,
      text: body.text ?? null,
      file: body.file ?? null,
      sourceUrl: body.sourceUrl ?? null,
      title: body.title ?? null,
      candidateName: body.candidateName ?? null,
      requisitionId: body.requisitionId ?? null,
    });
    return Response.json(result, {
      status: result.status === "error" ? 422 : 200,
      headers: cors,
    });
  } catch (e) {
    console.error("capture failed", e);
    return Response.json(
      { status: "error", detail: e instanceof Error ? e.message : "Capture failed." },
      { status: 500, headers: cors },
    );
  }
}

export const Route = createFileRoute("/api/public/capture")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
    },
  },
});

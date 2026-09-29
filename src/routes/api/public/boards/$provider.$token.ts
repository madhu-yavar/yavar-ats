/**
 * Board application webhook — the endpoint a partner board POSTs applicant
 * deliveries to: /api/public/boards/<provider>/<delivery-token>.
 *
 * Public by necessity (the board is the caller). Authenticity is the URL's
 * per-connection delivery token plus the board's signature header where the
 * contract defines one (Indeed: X-Indeed-Signature, HMAC-SHA256 over the raw
 * body). The raw delivery is stored first, so the response can always be an
 * idempotent 200 except when authentication itself fails — vendors must not
 * retry on processing errors they cannot fix.
 */
import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request, provider: string, token: string): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  // HMAC verification needs the raw, unmodified body.
  const rawBody = await request.text();

  const { processBoardDelivery } = await import("@/server/boards/ingest.server");
  const outcome = await processBoardDelivery({
    provider,
    token,
    headers: request.headers,
    rawBody,
  });

  if (outcome.status === "rejected") {
    // Deliberately generic: no signal which factor failed.
    return Response.json({ error: "Invalid delivery." }, { status: 401 });
  }
  return Response.json({
    status: outcome.status,
    ...(outcome.detail ? { detail: outcome.detail } : {}),
  });
}

export const Route = createFileRoute("/api/public/boards/$provider/$token")({
  server: {
    handlers: {
      POST: ({ request, params }) => handle(request, params.provider, params.token),
      GET: () => Response.json({ error: "POST only" }, { status: 405 }),
    },
  },
});

/** Small helpers shared by the auth HTTP endpoints. */

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function jsonError(detail: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, detail }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function jsonOk(payload: Record<string, unknown>, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/**
 * Caller IP. Only the right-most X-Forwarded-For hops are proxy-set (see the
 * same reasoning in src/server.ts), so trust exactly TRUSTED_PROXY_COUNT.
 */
export function clientIpOf(request: Request): string | null {
  const trusted = Math.max(0, Number(process.env["TRUSTED_PROXY_COUNT"] ?? "1"));
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const idx = hops.length - trusted;
    if (idx >= 0 && hops[idx]) return hops[idx]!;
  }
  return request.headers.get("cf-connecting-ip");
}

/** Public origin for links in email: the configured site URL wins over the request host. */
export function originOf(request: Request): string {
  const configured = process.env["PUBLIC_SITE_URL"];
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

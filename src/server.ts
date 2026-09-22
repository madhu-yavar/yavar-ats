import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- security */

/**
 * In-memory sliding-window limiter. Per-instance by design: sufficient for the
 * single-container deployments this server entry runs in; a multi-instance
 * deployment must move this behind a shared store.
 */
const rateBuckets = new Map<string, number[]>();
const RATE_LIMIT = 60;
/** Credential endpoints (/api/auth/*) get a far tighter per-IP ceiling. */
const AUTH_RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const RATE_MAP_PRUNE_THRESHOLD = 5_000;

/**
 * How many reverse-proxy hops sit in front of this server (GKE L7 LB = 1).
 * Only that many right-most X-Forwarded-For entries are proxy-set; the client
 * controls everything further left, so trusting the left-most value would let
 * any caller rotate IPs past the limiter. Direct (unproxied) deployments have
 * no XFF at all and fall through to the socket-less fallback.
 */
const TRUSTED_PROXY_COUNT = Math.max(0, Number(process.env["TRUSTED_PROXY_COUNT"] ?? "1"));

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    const idx = hops.length - TRUSTED_PROXY_COUNT;
    if (idx >= 0 && hops[idx]) return hops[idx]!;
  }
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

function allowRequest(key: string, limit = RATE_LIMIT): boolean {
  const now = Date.now();
  const recent = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > RATE_MAP_PRUNE_THRESHOLD) {
    for (const [k, stamps] of rateBuckets) {
      if (stamps.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  return true;
}

function isAuthPath(path: string): boolean {
  return path.startsWith("/api/auth/");
}

function isPublicApiPath(path: string): boolean {
  return path === "/api/public" || path.startsWith("/api/public/");
}

/**
 * Server-function RPCs are also public attack surface — the apply endpoint is
 * one — so they are limited per caller per function (the /_serverFn/<id> path
 * already names the function). Without this, the public apply path has no
 * throttle at all and each unauthenticated call can trigger an LLM spend.
 */
function isServerFnPath(path: string): boolean {
  return path === "/_serverFn" || path.startsWith("/_serverFn/");
}

async function applySecurityHeaders(response: Response, request: Request): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);

  // Per-response nonce for inline scripts: stamp every <script> tag in the
  // payload, then allow only self + that nonce. Any injected inline script
  // (XSS) without the nonce is refused by the browser.
  const nonce = generateNonce();
  headers.set(
    "Content-Security-Policy",
    `frame-ancestors 'self'; object-src 'none'; base-uri 'self'; script-src 'self' 'nonce-${nonce}'`,
  );
  headers.set("X-Frame-Options", "SAMEORIGIN");

  if (!response.body) return new Response(null, { status: response.status, statusText: response.statusText, headers });
  return stampNonces(response, nonce, headers);
}

function generateNonce(): string {
  return crypto.getRandomValues(new Uint8Array(16)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"),
    "",
  );
}

async function stampNonces(
  response: Response,
  nonce: string,
  headers: Headers,
): Promise<Response> {
  try {
    const html = await response.text();
    const stamped = html.replace(/<script(?![^>]*\bnonce=)([^>]*)/gi, (_m, attrs: string) => {
      // Self-closing or foreign tags are not a concern here; SSR output is ours.
      return `<script nonce="${nonce}"${attrs}`;
    });
    return new Response(stamped, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // Transform failure must never blank a page: fall back to the
    // script-src-free policy rather than breaking rendering.
    headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

function tooManyRequests(): Response {
  return new Response(
    JSON.stringify({ status: "error", detail: "Too many requests — slow down." }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    },
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (request.method !== "OPTIONS") {
        // Sign-in, sign-up and reset are credential endpoints: a much tighter
        // ceiling than ordinary API traffic, on top of the per-account
        // throttling the auth layer itself applies.
        if (isAuthPath(url.pathname)) {
          if (!allowRequest(`auth:${clientIp(request)}:${url.pathname}`, AUTH_RATE_LIMIT)) {
            return tooManyRequests();
          }
        } else if (isPublicApiPath(url.pathname) || isServerFnPath(url.pathname)) {
          if (!allowRequest(`${clientIp(request)}:${url.pathname}`)) return tooManyRequests();
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(await normalizeCatastrophicSsrResponse(response), request);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

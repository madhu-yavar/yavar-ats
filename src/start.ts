import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { logApp } from "./server/logger";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (request && new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Request observability: one app_logs row per API route / server-fn RPC with
// outcome + duration. Static assets and page renders are skipped (noise).
const httpLogMiddleware = createMiddleware().server(async ({ next, request }) => {
  const startedAt = Date.now();
  try {
    const result = await next();
    try {
      if (request) {
        // next() settles as either a bare Response or the framework's
        // { request, pathname, response } envelope — read the status off both.
        const settled =
          result instanceof Response ? result : (result as { response?: Response })?.response;
        const { pathname } = new URL(request.url);
        const isServerFn = pathname.startsWith("/_serverFn");
        if (isServerFn || pathname.startsWith("/api/")) {
          const status = settled?.status ?? 0;
          logApp(
            status >= 500 ? "error" : status >= 400 ? "warn" : "info",
            isServerFn ? "server-fn" : "http",
            `${request.method} ${pathname} → ${status || "no-response"}`,
            {
              route: `${request.method} ${pathname}`,
              statusCode: status || null,
              durationMs: Date.now() - startedAt,
            },
          );
        }
      }
    } catch {
      // Observability must never break the response path.
    }
    return result;
  } catch (error) {
    try {
      if (request) {
        const { pathname } = new URL(request.url);
        const isServerFn = pathname.startsWith("/_serverFn");
        if (isServerFn || pathname.startsWith("/api/")) {
          logApp("error", isServerFn ? "server-fn" : "http", `${request.method} ${pathname} → throw`, {
            route: `${request.method} ${pathname}`,
            durationMs: Date.now() - startedAt,
            detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
          });
        }
      }
    } catch {
      // Observability must never mask the original error.
    }
    throw error;
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware, csrfMiddleware, httpLogMiddleware],
}));

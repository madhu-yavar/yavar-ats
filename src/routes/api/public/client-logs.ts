/**
 * Ingests browser error reports from client-telemetry.ts into app_logs.
 * Public (errors happen pre-login too) but capped hard: zod-validated batch
 * of at most 20 entries, each field length-capped — and the shared /api/public
 * rate limiter in src/server.ts applies on top. No cookies, no PII beyond
 * whatever the error text itself carries.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { logApp } from "../../../server/logger";

const Entry = z.object({
  level: z.enum(["warn", "error"]),
  message: z.string().max(2_000),
  stack: z.string().max(2_000).optional(),
  path: z.string().max(300).optional(),
  ts: z.number().optional(),
});

const Body = z.object({ entries: z.array(Entry).max(20) });

export const Route = createFileRoute("/api/public/client-logs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response(null, { status: 204 });
        }
        for (const entry of body.entries) {
          logApp(entry.level, "client", entry.message, {
            ...(entry.path ? { route: entry.path } : {}),
            ...(entry.stack ? { detail: entry.stack } : {}),
          });
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});

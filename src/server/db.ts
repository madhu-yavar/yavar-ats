/**
 * Server-only Postgres handle. Every database touch in the app goes through
 * this drizzle client — the browser never talks to Postgres directly.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@db/schema";
import { env } from "./env";

const globalForDb = globalThis as unknown as { __atsiqPgV2?: postgres.Sql };

function createSql(): postgres.Sql {
  if (!globalForDb.__atsiqPgV2) {
    globalForDb.__atsiqPgV2 = postgres(env.DATABASE_URL, {
      // Serverless-safe defaults are unnecessary here (long-lived node process);
      // cap the pool so many concurrent server fns cannot exhaust connections.
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      // Never leave an auth or page request spinning behind a stale socket.
      // Postgres.js discards the failed connection and the next request opens
      // a fresh one; callers can then return a useful 503 promptly.
      max_lifetime: 60 * 30,
      connection: { statement_timeout: 12_000 },
    });
  }
  return globalForDb.__atsiqPgV2;
}

export const sql = createSql();

export const db = drizzle(sql, { schema });

export type Db = typeof db;

export * as tables from "@db/schema";

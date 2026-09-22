/**
 * Server-only Postgres handle. Every database touch in the app goes through
 * this drizzle client — the browser never talks to Postgres directly.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@db/schema";
import { env } from "./env";

const globalForDb = globalThis as unknown as { __atsiqPg?: postgres.Sql };

function createSql(): postgres.Sql {
  if (!globalForDb.__atsiqPg) {
    globalForDb.__atsiqPg = postgres(env.DATABASE_URL, {
      // Serverless-safe defaults are unnecessary here (long-lived node process);
      // cap the pool so many concurrent server fns cannot exhaust connections.
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      // Never leave an auth or page request spinning behind a stale socket.
      // Postgres.js discards the failed connection and the next request opens
      // a fresh one; callers can then return a useful 503 promptly.
      query_timeout: 12,
      max_lifetime: 60 * 30,
    });
  }
  return globalForDb.__atsiqPg;
}

export const sql = createSql();

export const db = drizzle(sql, { schema });

export type Db = typeof db;

export * as tables from "@db/schema";

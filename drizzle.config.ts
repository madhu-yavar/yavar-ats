import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  // Plain-Postgres migrations (Supabase-era SQL retained in drizzle/migrations for reference only)
  out: "./drizzle/pg-migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});

/**
 * Server environment — validated once at import, so a misconfigured deployment
 * fails fast at boot instead of deep inside a request path.
 *
 * Supabase-era variables (SUPABASE_URL, SUPABASE_*_KEY, LOVABLE_*) are
 * deliberately not read anywhere in the plain-Postgres build.
 */
import { z } from "zod";

const schema = z.object({
  // Database (required)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Sessions
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  // Public origin (capture endpoint links, OAuth redirects, emails)
  PUBLIC_SITE_URL: z.string().url().default("https://atsiq.yavar.ai"),

  // AI providers — at least one is required for AI features; the app boots without them
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Social scoring
  GITHUB_TOKEN: z.string().optional(),

  // LinkedIn one-time-connect (org-level OAuth)
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().optional(),
  LINKEDIN_SCOPES: z.string().optional(),
  LINKEDIN_STATE_SECRET: z.string().optional(),

  // Meeting-provider delegated OAuth (one-click Connect on the Integrations page)
  OAUTH_STATE_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: z.string().optional(),
  ZOOM_OAUTH_CLIENT_ID: z.string().optional(),
  ZOOM_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Careers-inbox webhook receiver
  INBOUND_EMAIL_SECRET: z.string().optional(),
  INBOUND_EMAIL_DOMAIN: z.string().optional(),

  // Google OAuth sign-in (optional; password sign-in always available)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Scheduled jobs (in-process cron; bearer for the two /api/public job routes)
  CRON_SECRET: z.string().optional(),

  // SMTP / transactional email
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // CV vault (S3-compatible; MinIO in development compose)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("resumes"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid server environment:\n${missing.join("\n")}`);
}

export const env = parsed.data;

/** True when the org-level LinkedIn connect can run. */
export function linkedinEnvConfigured(): boolean {
  return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
}

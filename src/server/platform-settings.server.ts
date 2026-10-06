import { eq } from "drizzle-orm";

import { db } from "./db";
import { platformSettings } from "@db/schema";
import { decryptSecret } from "./crypto";

/**
 * Deployment-level settings stored by platform super users from the platform
 * console (Integrations → Transactional email). Values are encrypted at rest;
 * readers never throw — a missing, corrupt or undecryptable row simply means
 * "not configured" and the caller falls back to environment variables.
 *
 * Server-only: imported dynamically from src/lib so it never enters a
 * client-reachable graph.
 */

export const TRANSACTIONAL_EMAIL_SETTING = "transactional_email";

export interface TransactionalEmailConfig {
  provider: "resend";
  apiKey: string;
  fromAddress: string;
}

/** The saved transactional-email credential, or null when none is usable. */
export async function readTransactionalEmailConfig(): Promise<TransactionalEmailConfig | null> {
  const [row] = await db
    .select({ valueEncrypted: platformSettings.valueEncrypted })
    .from(platformSettings)
    .where(eq(platformSettings.key, TRANSACTIONAL_EMAIL_SETTING))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(
      decryptSecret(row.valueEncrypted),
    ) as Partial<TransactionalEmailConfig>;
    if (parsed?.provider === "resend" && parsed.apiKey) {
      return { provider: "resend", apiKey: parsed.apiKey, fromAddress: parsed.fromAddress ?? "" };
    }
    return null;
  } catch {
    return null; // wrong SECRET_ENCRYPTION_KEY or tampered row — degrade to env fallback
  }
}

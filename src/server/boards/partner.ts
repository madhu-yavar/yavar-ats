/**
 * Shared plumbing for the config-driven partner boards (Indeed / Naukri).
 * Both vendors provision exact endpoint paths in their onboarding packs, so
 * every path comes from source_integrations.config and a missing path fails
 * with an honest "not provisioned" message instead of a guess.
 */
import { createHash } from "crypto";

import { safeFetch } from "../safe-fetch";
import { assertIntegrationBaseUrl } from "../../lib/integrations.server";
import { boardBaseUrl, integrationConfig, type BoardConnection } from "./types";

/** The stored base_url, validated against the partner-host allowlist. */
export function assertBaseUrl(conn: BoardConnection): string {
  const base = boardBaseUrl(conn);
  if (!base) {
    throw new Error(
      `${conn.provider} is not fully connected yet — add the partner API base URL from your onboarding pack on the Integrations page.`,
    );
  }
  return assertIntegrationBaseUrl(base);
}

/** Fail with the honest, actionable message when a vendor path is not provisioned. */
export function requirePath(conn: BoardConnection, key: string, what: string): string {
  const path = integrationConfig(conn, key);
  if (!path) {
    throw new Error(
      `Your ${conn.provider} contract does not list a ${what} endpoint yet — add "${key}" from your onboarding pack on the Integrations page.`,
    );
  }
  return path.startsWith("/") ? path : `/${path}`;
}

/** Client-credentials token fetch against the board's token endpoint. */
export async function fetchClientToken(conn: BoardConnection): Promise<string> {
  const secrets = conn.secrets;
  const clientId = secrets["client_id"] ?? secrets["api_key"] ?? "";
  const clientSecret = secrets["client_secret"] ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      `${conn.provider} credentials are missing — save them on the Integrations page.`,
    );
  }
  const path = integrationConfig(conn, "token_path") || "/oauth/token";
  const res = await safeFetch(`${assertBaseUrl(conn)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${conn.provider} token endpoint returned ${res.status}.`);
  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) throw new Error(`${conn.provider} did not return an access token.`);
  return parsed.access_token;
}

/**
 * Stable dedupe id for an inbound delivery when the vendor does not send one:
 * the payload id wins, otherwise the raw body hash makes identical
 * redeliveries idempotent.
 */
export function deliveryEventId(payloadId: string | null, rawBody: string): string {
  if (payloadId?.trim()) return payloadId.trim();
  return createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 32);
}

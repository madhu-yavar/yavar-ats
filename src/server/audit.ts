import { db } from "./db";
import { auditLog } from "@db/schema";

/**
 * Privileged-action audit trail (SOC 2 CC6.2/CC7.2). Every role grant/revoke,
 * tenant-admin action, credential change and capture-key rotation must append
 * a row here. Writing is fire-and-forget from the caller's point of view: an
 * audit failure must not break the action it is auditing, but it is logged
 * loudly so the gap is visible.
 */
export async function writeAudit(input: {
  actor: string;
  orgId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      orgId: input.orgId ?? null,
      actorUserId: input.actorUserId ?? null,
      actor: input.actor,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      detail: (input.detail ?? null) as never,
    });
  } catch (e) {
    console.error("[audit] failed to record", input.action, e);
  }
}

/** Redact an email for logs: keep the domain, mask the local part. */
export function redactEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "(redacted)";
  const [, domain] = email.split("@");
  return `***@${domain}`;
}

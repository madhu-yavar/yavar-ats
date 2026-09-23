import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { requisitions } from "@db/schema";

/**
 * Tenant-isolation guard for every ingest path that accepts a client-supplied
 * requisitionId (candidate create, CV intake, capture, referrals). Without it,
 * an attacker org can attach applications to another org's requisition and
 * leak its JD/budget metadata through the scoring pipeline.
 */
export async function assertRequisitionInOrg(requisitionId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: requisitions.id })
    .from(requisitions)
    .where(and(eq(requisitions.id, requisitionId), eq(requisitions.orgId, orgId)))
    .limit(1);
  if (!row) throw new Error("Requisition not found in your organisation.");
}

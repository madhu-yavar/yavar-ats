/**
 * In-house compensation knowledge (server-only helpers).
 *
 * Every figure a recruiter accepts or types over on the market benchmark panel
 * is stored per organisation, so the next research run for the same role is
 * anchored on what this organisation actually pays. Read paths are always
 * predicated on `orgId` — callers pass it from `requireOrg` context.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../server/db";
import { compKnowledge } from "@db/schema";

export type CompKnowledgeEntry = {
  id: string;
  role_key: string;
  title: string;
  location: string | null;
  level_key: string;
  currency: string;
  low: number | null;
  median: number;
  high: number | null;
  experience_min: number | null;
  experience_max: number | null;
  source: string;
  note: string | null;
  created_at: string;
};

/** Grouping key for "what do we pay for this role" — slug of the job title. */
export function roleKey(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const num = (v: string | null) => (v === null ? null : Number(v));

function toEntry(row: typeof compKnowledge.$inferSelect): CompKnowledgeEntry {
  return {
    id: row.id,
    role_key: row.roleKey,
    title: row.title,
    location: row.location,
    level_key: row.levelKey,
    currency: row.currency,
    low: num(row.low),
    median: Number(row.median),
    high: num(row.high),
    experience_min: row.experienceMin,
    experience_max: row.experienceMax,
    source: row.source,
    note: row.note,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

/** Saved figures for one role in this organisation, newest first. */
export async function readRoleKnowledge(
  orgId: string,
  title: string,
  limit = 24,
): Promise<CompKnowledgeEntry[]> {
  const rows = await db
    .select()
    .from(compKnowledge)
    .where(and(eq(compKnowledge.orgId, orgId), eq(compKnowledge.roleKey, roleKey(title))))
    .orderBy(desc(compKnowledge.createdAt))
    .limit(limit);
  return rows.map(toEntry);
}

/** Everything this organisation has saved, newest first (recent-history view). */
export async function readOrgKnowledge(orgId: string, limit = 60): Promise<CompKnowledgeEntry[]> {
  const rows = await db
    .select()
    .from(compKnowledge)
    .where(eq(compKnowledge.orgId, orgId))
    .orderBy(desc(compKnowledge.createdAt))
    .limit(limit);
  return rows.map(toEntry);
}

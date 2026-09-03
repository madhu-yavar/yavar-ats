import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CopilotMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function orgOf(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("You do not belong to an organisation yet.");
  return data.org_id as string;
}

/** The single ongoing copilot conversation for the signed-in user. */
export const copilotHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CopilotMessage[]> => {
    const db = await admin();
    const { data, error } = await db
      .from("copilot_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .order("created_at")
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      createdAt: r.created_at,
    }));
  });

export const clearCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { error } = await db.from("copilot_messages").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Live, org-scoped facts handed to the model so answers are grounded in real data. */
async function snapshot(orgId: string) {
  const db = await admin();
  const [reqs, cands, apps, ivs, offers, depts] = await Promise.all([
    db
      .from("requisitions")
      .select("code, title, status, openings, location, budget_ctc, experience_min, experience_max, must_have_skills")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("candidates").select("id, skills, experience_years, created_at, last_synced_at").eq("org_id", orgId),
    db.from("applications").select("stage, requisition_id, last_activity_at").eq("org_id", orgId),
    db
      .from("interviews")
      .select("level, status, scheduled_at, interviewer")
      .eq("org_id", orgId)
      .order("scheduled_at", { ascending: true })
      .limit(60),
    db.from("offers").select("status, offered_ctc, joining_date").eq("org_id", orgId),
    db.from("departments").select("name, budgeted_headcount, budgeted_cost").eq("org_id", orgId),
  ]);

  const stageCounts: Record<string, number> = {};
  for (const a of apps.data ?? []) stageCounts[a.stage] = (stageCounts[a.stage] ?? 0) + 1;

  const skillCounts: Record<string, number> = {};
  for (const c of cands.data ?? []) for (const s of c.skills ?? []) skillCounts[s] = (skillCounts[s] ?? 0) + 1;
  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return {
    requisitions: reqs.data ?? [],
    departments: depts.data ?? [],
    candidateCount: (cands.data ?? []).length,
    stageCounts,
    topSkills,
    interviews: ivs.data ?? [],
    offers: offers.data ?? [],
  };
}

const SYSTEM = `You are the HR copilot inside a talent-acquisition system (ATS).
You help recruiters, HR heads and the CHRO understand their own live hiring data and
advise on process: requisition approvals, JD quality, JD↔CV matching weights,
interview scheduling, offers and pipeline risk.

Rules:
- Answer ONLY from the DATA SNAPSHOT provided plus general HR expertise. Never invent
  candidate names, numbers or requisitions that are not in the snapshot.
- If the snapshot has no data for the question, say so plainly and suggest the page to use.
- Be concise: short paragraphs or tight bullet lists. Numbers over adjectives.
- Never invent navigation. These are the ONLY pages that exist, use their exact names:
  Dashboard (/), Requisitions (/requisitions), Talent pool (/candidates),
  Matching engine (/matching), Interviews (/interviews), My interviews (/interviews/mine),
  Offers (/offers), IJP (/ijp), Reports (/reports), Users & roles (/team),
  Integrations (/integrations), Master data (/masters).
- User administration lives on Users & roles (/team): the organisation owner can invite
  people, grant or revoke roles, pause (disable) access, and permanently delete a member
  from the row action menu. Deleting removes their membership and roles; pausing keeps
  history intact. Owners cannot be deleted until ownership is transferred.
- Return JSON: { "answer": "markdown-free plain text answer" }.`;

export const askCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ message: z.string().min(1).max(2000) }).parse(data))
  .handler(async ({ data, context }): Promise<{ answer: string }> => {
    const orgId = await orgOf(context.userId);
    const db = await admin();
    const { aiJson } = await import("@/lib/ai-gateway.server");

    await db
      .from("copilot_messages")
      .insert({ user_id: context.userId, org_id: orgId, role: "user", content: data.message });

    const { data: prior } = await db
      .from("copilot_messages")
      .select("role, content")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(12);

    const transcript = (prior ?? [])
      .reverse()
      .map((m) => `${m.role === "user" ? "HR" : "Copilot"}: ${m.content}`)
      .join("\n");

    const facts = await snapshot(orgId);

    const result = await aiJson<{ answer?: string }>({
      system: SYSTEM,
      prompt: `DATA SNAPSHOT (live, this organisation only):\n${JSON.stringify(facts).slice(0, 24000)}\n\nCONVERSATION SO FAR:\n${transcript}\n\nAnswer the latest HR message.`,
    });

    const answer = result.ok
      ? (result.data.answer ?? "").trim() || "I could not produce an answer for that."
      : `I could not reach the AI model: ${result.message}`;

    await db
      .from("copilot_messages")
      .insert({ user_id: context.userId, org_id: orgId, role: "assistant", content: answer });

    return { answer };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently delete candidates and everything attached to them:
 * applications, match scores, interviews, evaluations, offers, assessments,
 * verifications, social profiles (all cascade), plus the stored CV files.
 * capture_events has a restrictive FK, so its candidate link is cleared first.
 */
export const deleteCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ candidateIds: z.array(z.string().uuid()).min(1).max(100) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: rows, error: readErr } = await supabase
      .from("candidates")
      .select("id, full_name, resume_file_path")
      .in("id", data.candidateIds);
    if (readErr) throw new Error(readErr.message);
    const found = rows ?? [];
    if (found.length === 0) throw new Error("No matching candidates found — they may already be deleted.");

    const { error: unlinkErr } = await supabase
      .from("capture_events")
      .update({ candidate_id: null })
      .in("candidate_id", data.candidateIds);
    if (unlinkErr && !/denied|policy/i.test(unlinkErr.message))
      throw new Error(`Could not clear capture history: ${unlinkErr.message}`);

    const paths = found.map((r) => r.resume_file_path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from("resumes").remove(paths);

    const { error: delErr } = await supabase.from("candidates").delete().in("id", data.candidateIds);
    if (delErr) throw new Error(delErr.message);

    return { deleted: found.length, names: found.map((r) => r.full_name).slice(0, 5) };
  });

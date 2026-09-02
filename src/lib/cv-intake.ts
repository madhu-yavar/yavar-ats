/**
 * Shared bulk CV intake used by the Talent pool page and the requisition
 * sourcing panel: read the file in the browser, AI-parse it, upsert the
 * candidate by email, and optionally raise the application for a requisition.
 */
import { supabase } from "@/integrations/supabase/client";
import { extractResumeText } from "@/lib/cv-extract";
import { mapWithLimit } from "@/lib/shortlist";

export type IntakeStatus = {
  file: string;
  state: "pending" | "reading" | "parsing" | "saving" | "ok" | "error";
  message: string;
  candidateId?: string;
};

type ParseFn = (args: {
  data: { resumeText: string };
}) => Promise<{
  full_name: string;
  email: string;
  phone: string | null;
  location: string | null;
  experience_years: number;
  education: string | null;
  skills: string[];
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
}>;

export async function intakeCvs(opts: {
  files: File[];
  parse: ParseFn;
  source: string;
  requisitionId?: string | null;
  concurrency?: number;
  onUpdate: (index: number, patch: Partial<IntakeStatus>) => void;
}) {
  const { files, parse, source, requisitionId } = opts;

  const results = await mapWithLimit(files, opts.concurrency ?? 3, async (file, i) => {
    try {
      opts.onUpdate(i, { state: "reading", message: "Reading file…" });
      const text = await extractResumeText(file);

      opts.onUpdate(i, { state: "parsing", message: "AI parsing…" });
      const p = await parse({ data: { resumeText: text.slice(0, 20000) } });

      opts.onUpdate(i, { state: "saving", message: "Saving to talent pool…" });
      const email = (p.email ?? "").trim().toLowerCase();
      const fallbackName = file.name.replace(/\.[^.]+$/, "");

      const row = {
        full_name: (p.full_name ?? "").trim() || fallbackName,
        email: email || `unknown+${Date.now()}-${i}@import.local`,
        phone: p.phone || null,
        location: p.location || null,
        experience_years: Number(p.experience_years) || 0,
        education: p.education || null,
        skills: p.skills ?? [],
        linkedin_url: p.linkedin_url || null,
        github_url: p.github_url || null,
        website_url: p.website_url || null,
        source,
        resume_text: text,
      };

      // Existing person? Refresh their record instead of failing on the unique email.
      let candidateId: string | null = null;
      let updated = false;
      if (email) {
        const { data: existing } = await supabase
          .from("candidates")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        if (existing?.id) {
          const { error } = await supabase.from("candidates").update(row).eq("id", existing.id);
          if (error) throw new Error(error.message);
          candidateId = existing.id;
          updated = true;
        }
      }

      if (!candidateId) {
        const { data, error } = await supabase.from("candidates").insert(row).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "Could not save the candidate");
        candidateId = data.id;
      }

      if (requisitionId) {
        const { data: existingApp } = await supabase
          .from("applications")
          .select("id")
          .eq("requisition_id", requisitionId)
          .eq("candidate_id", candidateId)
          .maybeSingle();
        if (!existingApp) {
          const { error } = await supabase
            .from("applications")
            .insert({ requisition_id: requisitionId, candidate_id: candidateId, source });
          if (error) throw new Error(error.message);
        }
      }

      opts.onUpdate(i, {
        state: "ok",
        message: `${row.full_name} · ${row.skills.length} skills · ${row.experience_years} yrs${updated ? " (updated)" : ""}`,
        candidateId,
      });
      return { ok: true as const, candidateId };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed";
      // Keep the real error visible for debugging, not just the summarised line.
      console.error(`[cv-intake] ${file.name}:`, e);
      opts.onUpdate(i, { state: "error", message });
      return { ok: false as const, message };
    }
  });

  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    candidateIds: results.flatMap((r) => (r.ok && r.candidateId ? [r.candidateId] : [])),
  };
}

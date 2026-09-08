/**
 * Signed, short-lived download links for the original CV files kept in the
 * private resume vault. The signed URL expires in two minutes and can only be
 * minted by a signed-in member of the organisation that owns the candidate.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getResumeDownloadUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: candidate } = await context.supabase
      .from("candidates")
      .select("id, resume_file_path")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (!candidate?.resume_file_path) {
      return { ok: false as const, error: "No original CV file is stored for this candidate." };
    }
    const { data: signed, error } = await context.supabase.storage
      .from("resumes")
      .createSignedUrl(candidate.resume_file_path, 120);
    if (error || !signed?.signedUrl) {
      return { ok: false as const, error: "That CV file could not be opened." };
    }
    return { ok: true as const, url: signed.signedUrl };
  });

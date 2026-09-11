/**
 * Authenticated CV delivery from the private resume vault. The bytes travel
 * through ATSIQ so browser privacy tools never need to open the vault host.
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
      .select("id, full_name, resume_file_path")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (!candidate?.resume_file_path) {
      return { ok: false as const, error: "No original CV file is stored for this candidate." };
    }
    const { data: file, error } = await context.supabase.storage
      .from("resumes")
      .download(candidate.resume_file_path);
    if (error || !file) {
      return { ok: false as const, error: "That CV file could not be opened." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) {
      return { ok: false as const, error: "That CV is too large to download through ATSIQ." };
    }
    const storedName = candidate.resume_file_path.split("/").pop() ?? "resume.pdf";
    let filename = storedName;
    try {
      filename = decodeURIComponent(storedName);
    } catch {
      // Keep the stored name when it is not URI encoded.
    }
    return {
      ok: true as const,
      base64: Buffer.from(bytes).toString("base64"),
      contentType: file.type || "application/octet-stream",
      filename: filename || `${candidate.full_name || "candidate"}-CV.pdf`,
    };
  });

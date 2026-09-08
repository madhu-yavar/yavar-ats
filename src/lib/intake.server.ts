/**
 * Server-side candidate intake shared by the public apply page and the
 * automatic careers-inbox import: parse a CV, upsert the talent-pool record by
 * email, and raise the application against a requisition.
 */
import { aiJson } from "./ai-gateway.server";

export type ParsedCv = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  experience_years: number | null;
  education: string | null;
  skills: string[] | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  current_employer: string | null;
  employment_history: { company: string | null; title: string | null; start: string | null; end: string | null; level_hint?: string | null }[] | null;
};

export async function parseCv(resumeText: string): Promise<ParsedCv | null> {
  const parsed = await aiJson<ParsedCv>({
    system:
      "Extract structured candidate data from a resume. Return ONLY JSON with keys: full_name, email, phone, " +
       "location, experience_years (number), education, skills (string array), linkedin_url, github_url, website_url, " +
       "current_employer, employment_history (array of {company, title, start, end, level_hint}, newest first). " +
      "Use null when a field is genuinely absent. Never invent values.",
    prompt: resumeText.slice(0, 20000),
  });
  return parsed.ok ? parsed.data : null;
}

export type IngestResult = {
  candidateId: string;
  name: string;
  email: string;
  alreadyApplied: boolean;
  merged: boolean;
  /** True when no email could be read and a placeholder was used. */
  emailMissing?: boolean;
  resumeStored: boolean;
  skills: string[];
  linkedinUrl: string | null;
  githubUrl: string | null;
  websiteUrl: string | null;
};


/**
 * Keep the original CV file in the private `resumes` bucket, one folder per
 * organisation (<org>/<candidate>/<file>), and point the candidate row at it.
 * Never throws — a failed store must not lose the candidate.
 */
export async function storeResumeFile(input: {
  orgId: string | null;
  candidateId: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<string | null> {
  if (!input.orgId || input.bytes.length === 0) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safeName = input.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "resume.pdf";
    const path = `${input.orgId}/${input.candidateId}/${safeName}`;
    const { error } = await supabaseAdmin.storage
      .from("resumes")
      .upload(path, input.bytes, {
        upsert: true,
        contentType: /\.pdf$/i.test(safeName)
          ? "application/pdf"
          : /\.docx$/i.test(safeName)
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : /\.doc$/i.test(safeName)
              ? "application/msword"
              : "text/plain",
      });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("candidates")
      .update({ resume_file_path: path } as never)
      .eq("id", input.candidateId);
    return path;
  } catch (e) {
    console.error("[resumes] could not store CV file:", e);
    return null;
  }
}

/** Upsert the candidate and attach them to the requisition. Admin client only. */
export async function ingestCandidate(input: {
  resumeText: string;
  fileName: string;
  requisitionId: string | null;
  orgId: string | null;
  source: string;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
  parsed?: ParsedCv | null;
  /** Original CV file, kept in the private resume vault when provided. */
  resumeFile?: { filename: string; bytes: Uint8Array } | null;
}): Promise<IngestResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const p = input.parsed ?? (await parseCv(input.resumeText));

  const readName =
    (input.fullName ?? p?.full_name ?? "").trim() || input.fileName.replace(/\.[^.]+$/, "");

  // Some sources (a captured profile page, a CV with only a phone number) carry
  // no email. Rather than losing the person, file them under a placeholder
  // address the recruiter can correct later.
  let email = (input.email ?? p?.email ?? "").trim().toLowerCase();
  let emailMissing = false;
  if (!email) {
    const slug = readName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "candidate";
    email = `${slug}.${Date.now().toString(36)}@no-email.atsiq.local`;
    emailMissing = true;
  }


  const row = {
    full_name: readName,
    email,

    phone: (input.phone ?? p?.phone) || null,
    location: p?.location || null,
    experience_years: Number(p?.experience_years ?? 0) || 0,
    education: p?.education || null,
    skills: p?.skills ?? [],
    linkedin_url: p?.linkedin_url || null,
    github_url: p?.github_url || null,
    website_url: p?.website_url || null,
    current_employer: p?.current_employer || p?.employment_history?.[0]?.company || null,
    employment_history: p?.employment_history ?? [],
    source: input.source,
    resume_text: input.resumeText,
    org_id: input.orgId,
    last_synced_at: new Date().toISOString(),
  };

  const { data: existing } = await supabaseAdmin
    .from("candidates")
    .select("id, skills")
    .eq("email", email)
    .maybeSingle();

  let candidateId: string;
  if (existing) {
    const skills = new Set(
      [...(existing.skills ?? []), ...row.skills].map((s) => s.trim()).filter(Boolean),
    );
    const { error } = await supabaseAdmin
      .from("candidates")
      .update({ ...row, skills: [...skills] } as never)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    candidateId = existing.id;
  } else {
    const { data: created, error } = await supabaseAdmin
      .from("candidates")
      .insert(row as never)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not save the candidate.");
    candidateId = created.id;
  }

  let alreadyApplied = false;
  if (input.requisitionId) {
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("requisition_id", input.requisitionId)
      .maybeSingle();
    alreadyApplied = Boolean(app);
    if (!app) {
      const { error } = await supabaseAdmin.from("applications").insert({
        candidate_id: candidateId,
        requisition_id: input.requisitionId,
        source: input.source,
        org_id: input.orgId,
      } as never);
      if (error) throw new Error(error.message);
    }
  }

  let resumeStored = false;
  if (input.resumeFile?.bytes?.length) {
    resumeStored = Boolean(await storeResumeFile({
      orgId: input.orgId,
      candidateId,
      filename: input.resumeFile.filename,
      bytes: input.resumeFile.bytes,
    }));
  }

  return {
    candidateId,
    name: row.full_name,
    email,
    alreadyApplied,
    merged: Boolean(existing),
    emailMissing,
    resumeStored,
    skills: row.skills,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    websiteUrl: row.website_url,
  };

}

/**
 * Browser-companion capture.
 *
 * The recruiter stays signed in to the job board in their own browser; the
 * ATSIQ companion extension lifts the page they are looking at (a job
 * description, or an attached CV) and posts it here with the organisation's
 * capture token. Nothing on our side pretends to be the recruiter.
 */
import { aiJson } from "./ai-gateway.server";
import { ingestCandidate } from "./intake.server";

export type CaptureKind = "cv" | "jd";

export type CaptureInput = {
  token: string;
  kind: CaptureKind;
  text?: string | null;
  /** base64 file body, for a CV attachment the companion could download. */
  file?: { filename: string; content: string } | null;
  sourceUrl?: string | null;
  publicProfileUrl?: string | null;
  title?: string | null;
  candidateName?: string | null;
  /** Retain validated LinkedIn evidence even when its original CV is still pending. */
  profileOnly?: boolean;
  requisitionId?: string | null;
};

export type CaptureResult = {
  status: "imported" | "updated" | "stored" | "skipped" | "error";
  detail: string;
  candidateId?: string | null;
  requisitionId?: string | null;
  title?: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

type ParsedJd = {
  title: string | null;
  location: string | null;
  must_have_skills: string[] | null;
  good_to_have_skills: string[] | null;
  responsibilities: string | null;
  education_requirement: string | null;
  experience_min: number | null;
  experience_max: number | null;
};

async function parseJd(text: string): Promise<ParsedJd | null> {
  const parsed = await aiJson<ParsedJd>({
    system:
      "Extract a structured job requisition from a job description. Return ONLY JSON with keys: title, location, " +
      "must_have_skills (string array), good_to_have_skills (string array), responsibilities, education_requirement, " +
      "experience_min (number of years), experience_max (number of years). Use null when a field is genuinely absent. " +
      "Never invent requirements.",
    prompt: text.slice(0, 20000),
  });
  return parsed.ok ? parsed.data : null;
}

async function nextCaptureCode(orgId: string): Promise<string> {
  const db = await admin();
  const { count } = await db
    .from("requisitions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  return `CAP-${String((count ?? 0) + 1).padStart(4, "0")}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

/** Resolve the organisation behind a capture token. */
export async function orgForCaptureToken(
  token: string,
): Promise<{ id: string; name: string; status: string } | null> {
  if (!token || token.length < 20) return null;
  const db = await admin();
  const { data } = await db
    .from("organizations")
    .select("id, name, status")
    .eq("capture_token", token)
    .maybeSingle();
  if (!data) return null;
  if (data.status && data.status !== "active") return null;
  return { id: data.id, name: data.name, status: data.status };
}

export async function capture(input: CaptureInput): Promise<CaptureResult> {
  const org = await orgForCaptureToken(input.token);
  if (!org) return { status: "error", detail: "This capture key is not valid any more." };

  const db = await admin();
  const log = async (result: CaptureResult) => {
    await db.from("capture_events").insert({
      org_id: org.id,
      kind: input.kind,
      source_url: input.sourceUrl ?? null,
      title: result.title ?? input.title ?? null,
      status: result.status,
      detail: result.detail,
      candidate_id: result.candidateId ?? null,
      requisition_id: result.requisitionId ?? null,
    } as never);
    return result;
  };

  const pageText = (input.text ?? "").trim();
  let text = pageText;
  let fileName = input.file?.filename ?? "captured.txt";
  let fileBytes: Uint8Array | null = null;

  if (input.file?.content) {
    try {
      const { attachmentText } = await import("./inbox.server");
      fileBytes = base64ToBytes(input.file.content);
      const fromFile = (await attachmentText(input.file.filename, fileBytes)).trim();
      // The attached CV is the better source; the page text stays as a fallback
      // and as extra context when the file yields little.
      text = fromFile.length >= 200 ? fromFile : [fromFile, pageText].filter(Boolean).join("\n\n");
      fileName = input.file.filename;
    } catch (e) {
      return log({
        status: "error",
        detail:
          e instanceof Error
            ? `The downloaded CV could not be read: ${e.message}`
            : "That file could not be read.",
      });
    }
  }

  // No file? Keep the readable profile as evidence rather than losing the person;
  // a later capture of the same profile attaches the CV and re-parses everything.
  const profileOnly = input.kind === "cv" && !fileBytes;


  if (text.length < 80) {
    return log({ status: "skipped", detail: "There was not enough readable text on that page." });
  }

  if (input.kind === "cv") {
    try {
      const ingested = await ingestCandidate({
        resumeText: text,
        fileName,
        requisitionId: input.requisitionId ?? null,
        orgId: org.id,
        source: "browser_capture",
        fullName: input.candidateName ?? null,
        identityKey: input.publicProfileUrl ?? input.sourceUrl ?? null,
        profileUrl: input.publicProfileUrl ?? input.sourceUrl ?? null,
        resumeFile: fileBytes ? { filename: fileName, bytes: fileBytes } : null,
        requireResumeStored: false,
        profileOnly: profileOnly || Boolean(input.profileOnly),
      });
      // A vault problem must never lose the person: keep the parsed profile and
      // say plainly why the original file is still missing.
      const vaultNote =
        fileBytes && !ingested.resumeStored
          ? `original CV could not be saved (${ingested.resumeError ?? "unknown reason"}) — profile kept, file pending`
          : fileBytes
            ? "original CV secured"
            : "LinkedIn profile retained — original CV still pending";


      let verificationNote = "verification queued";
      try {
        const { verifyClaims } = await import("./verification.server");
        const verified = await verifyClaims({
          name: ingested.name,
          resumeText: text,
          skills: ingested.skills,
          linkedinUrl: ingested.linkedinUrl,
          githubUrl: ingested.githubUrl,
          websiteUrl: ingested.websiteUrl,
          linkedinProfileText: pageText || null,
        });
        await db.from("candidate_verifications").insert({
          candidate_id: ingested.candidateId,
          authenticity_score: verified.authenticity_score,
          claims: verified.claims as never,
          red_flags: verified.red_flags,
          evidence: verified.evidence as never,
          summary: verified.summary,
          model: verified.model,
          status: "ok",
          org_id: org.id,
        } as never);
        verificationNote = `verification ${verified.authenticity_score}/100`;
      } catch (e) {
        console.error("capture verification failed", e);
        verificationNote = "verification needs retry";
      }

      let socialNote = "profile analysis needs retry";
      try {
        const { fetchLinkedinSignal } = await import("./social.server");
        let roleTitle = "Candidate profile";
        let jdSkills: string[] = [];
        if (input.requisitionId) {
          const { data: requisition } = await db
            .from("requisitions")
            .select("title, must_have_skills, good_to_have_skills")
            .eq("id", input.requisitionId)
            .maybeSingle();
          roleTitle = requisition?.title ?? roleTitle;
          jdSkills = [
            ...(requisition?.must_have_skills ?? []),
            ...(requisition?.good_to_have_skills ?? []),
          ];
        }
        const linkedin = await fetchLinkedinSignal({
          url: ingested.linkedinUrl,
          jobTitle: roleTitle,
          jdSkills,
          resumeText: text,
          profileText: pageText || null,
        });
        if (linkedin) {
          const { error: socialError } = await db.from("social_profiles").upsert(
            {
              candidate_id: ingested.candidateId,
              org_id: org.id,
              provider: linkedin.provider,
              profile_url: linkedin.profile_url,
              handle: linkedin.handle,
              score: linkedin.score,
              signals: linkedin.signals as never,
              rationale: linkedin.rationale,
              status: linkedin.status,
              fetched_at: new Date().toISOString(),
              last_synced_at: new Date().toISOString(),
            } as never,
            { onConflict: "candidate_id,provider" },
          );
          if (socialError) throw new Error(socialError.message);
          socialNote = `LinkedIn analysis ${linkedin.score}/100`;
        }
      } catch (e) {
        console.error("capture social analysis failed", e);
      }

      if (input.requisitionId) {
        try {
          const { scoreUnscored } = await import("./autoscore.server");
          await scoreUnscored({ orgId: org.id, requisitionId: input.requisitionId, limit: 1 });
        } catch (e) {
          console.error("capture background match failed", e);
        }
      }
      return log({
        status:
          profileOnly || input.profileOnly || !ingested.resumeStored
            ? "stored"
            : ingested.alreadyApplied
              ? "updated"
              : "imported",
        detail: `${ingested.name} (${
          ingested.emailMissing ? "no email on the CV — add it later" : ingested.email
        })${input.requisitionId ? " added to the role" : " filed in the talent pool"}; ${vaultNote}; ${verificationNote}; ${socialNote}.`,
        candidateId: ingested.candidateId,
        requisitionId: input.requisitionId ?? null,
        title: ingested.name,
      });
    } catch (e) {
      return log({
        status: "error",
        detail: e instanceof Error ? e.message : "That CV could not be filed.",
      });
    }
  }

  const p = await parseJd(text);
  const title = (p?.title ?? input.title ?? "").trim() || "Captured role";
  try {
    const { data: created, error } = await db
      .from("requisitions")
      .insert({
        org_id: org.id,
        code: await nextCaptureCode(org.id),
        title,
        status: "draft",
        location: p?.location ?? null,
        must_have_skills: p?.must_have_skills ?? [],
        good_to_have_skills: p?.good_to_have_skills ?? [],
        responsibilities: p?.responsibilities ?? text.slice(0, 8000),
        education_requirement: p?.education_requirement ?? null,
        experience_min: Number(p?.experience_min ?? 0) || 0,
        experience_max: Number(p?.experience_max ?? 0) || 0,
      } as never)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "The role could not be saved.");
    return log({
      status: "imported",
      detail: `"${title}" saved as a draft role for review.`,
      requisitionId: created.id,
      title,
    });
  } catch (e) {
    return log({
      status: "error",
      detail: e instanceof Error ? e.message : "That job description could not be saved.",
      title,
    });
  }
}

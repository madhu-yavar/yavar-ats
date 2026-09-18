/**
 * Shared bulk CV intake used by the Talent pool page and the requisition
 * sourcing panel: read the file in the browser, then hand the extracted text
 * plus the original bytes to the `saveCv` server function, which owns the AI
 * parse, the talent-pool upsert, the CV vault and the optional requisition
 * application — all scoped to the signed-in recruiter's organisation.
 */
import { extractResumeText } from "@/lib/cv-extract";
import { mapWithLimit } from "@/lib/shortlist";
import { saveCv } from "@/lib/intake.functions";

export type IntakeStatus = {
  file: string;
  state: "pending" | "reading" | "parsing" | "saving" | "ok" | "error";
  message: string;
  candidateId?: string;
};

/**
 * Read the original file as base64 so the server can keep it in the private
 * CV vault next to the parsed profile. Oversized files are skipped — a
 * text-only candidate beats a failed upload, and the vault step was never
 * fatal anyway.
 */
async function fileToBase64(file: File): Promise<string | null> {
  if (file.size > 12_000_000) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function intakeCvs(opts: {
  files: File[];
  /** Unused since parsing moved server-side into `saveCv`; kept for call compat. */
  parse?: (args: { data: { resumeText: string } }) => Promise<unknown>;
  source: string;
  requisitionId?: string | null;
  concurrency?: number;
  onUpdate: (index: number, patch: Partial<IntakeStatus>) => void;
}) {
  const { files, source, requisitionId } = opts;

  const results = await mapWithLimit(files, opts.concurrency ?? 3, async (file, i) => {
    try {
      opts.onUpdate(i, { state: "reading", message: "Reading file…" });
      const text = await extractResumeText(file);
      const fileBase64 = await fileToBase64(file);

      opts.onUpdate(i, { state: "parsing", message: "AI parsing…" });
      const res = await saveCv({
        data: {
          fileName: file.name,
          resumeText: text,
          fileBase64,
          requisitionId: requisitionId ?? null,
          source,
        },
      });

      opts.onUpdate(i, {
        state: "ok",
        message: `${res.name} · ${res.skills.length} skills${
          res.merged ? " (existing profile refreshed)" : ""
        }`,
        candidateId: res.candidateId,
      });
      return { ok: true as const, candidateId: res.candidateId };
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

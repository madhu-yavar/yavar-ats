import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import {
  clearSecrets,
  importFromProvider,
  readSecrets,
  testProvider,
  writeSecrets,
  type IntegrationConfig,
  type ProviderId,
} from "./integrations.server";

const PROVIDERS = ["linkedin", "naukri", "indeed", "github", "careers"] as const;

const SaveInput = z.object({
  integrationId: z.string().uuid(),
  provider: z.enum(PROVIDERS),
  enabled: z.boolean(),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Blank values keep whatever is already stored. */
  secrets: z.record(z.string(), z.string()).default({}),
});

/** Persist non-secret config on the row, secrets in the server-only table. */
export const saveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    const keys = await writeSecrets(data.integrationId, data.secrets);
    const { error } = await context.supabase
      .from("source_integrations")
      .update({
        enabled: data.enabled,
        config: data.config as never,
        has_credentials: keys.length > 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.integrationId);
    if (error) throw new Error(error.message);
    return { ok: true, storedKeys: keys };
  });

export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ integrationId: z.string().uuid(), provider: z.enum(PROVIDERS) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("source_integrations")
      .select("config")
      .eq("id", data.integrationId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const secrets = await readSecrets(data.integrationId);
    const outcome = await testProvider(
      data.provider as ProviderId,
      secrets,
      (row?.config as IntegrationConfig) ?? {},
    );

    await context.supabase
      .from("source_integrations")
      .update({
        last_test_status: outcome.status,
        last_test_message: outcome.message,
        last_tested_at: new Date().toISOString(),
      })
      .eq("id", data.integrationId);

    return outcome;
  });

export const disconnectIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ integrationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await clearSecrets(data.integrationId);
    const { error } = await context.supabase
      .from("source_integrations")
      .update({
        enabled: false,
        has_credentials: false,
        last_test_status: "untested",
        last_test_message: "Credentials removed.",
        last_tested_at: null,
      })
      .eq("id", data.integrationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Search a configured board and upsert the results into the talent pool. */
export const importCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        provider: z.enum(PROVIDERS),
        requisitionId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: integration, error: iErr } = await context.supabase
      .from("source_integrations")
      .select("id, config, enabled")
      .eq("provider", data.provider)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!integration) throw new Error("Integration not found.");
    if (!integration.enabled) throw new Error(`${data.provider} is disabled on the Integrations page.`);

    const { data: req, error: rErr } = await context.supabase
      .from("requisitions")
      .select("must_have_skills, good_to_have_skills, experience_min, experience_max, location")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!req) throw new Error("Requisition not found.");

    const secrets = await readSecrets(integration.id);
    const found = await importFromProvider({
      provider: data.provider as ProviderId,
      secrets,
      config: (integration.config as IntegrationConfig) ?? {},
      keywords: [...req.must_have_skills, ...req.good_to_have_skills],
      experienceMin: req.experience_min,
      experienceMax: req.experience_max,
      location: req.location,
      limit: data.limit,
    });

    let imported = 0;
    for (const c of found) {
      const { data: cand, error: cErr } = await context.supabase
        .from("candidates")
        .upsert(
          {
            full_name: c.full_name,
            email: c.email,
            phone: c.phone,
            location: c.location,
            source: data.provider,
            experience_years: c.experience_years,
            education: c.education,
            skills: c.skills,
            resume_text: c.resume_text,
            linkedin_url: c.linkedin_url,
            github_url: c.github_url,
            external_id: c.external_id,
            external_provider: data.provider,
          },
          { onConflict: "external_provider,external_id" },
        )
        .select("id")
        .maybeSingle();
      if (cErr || !cand) continue;

      const { error: aErr } = await context.supabase.from("applications").insert({
        requisition_id: data.requisitionId,
        candidate_id: cand.id,
        source: data.provider,
      });
      if (!aErr) imported += 1;
    }

    return { found: found.length, imported };
  });

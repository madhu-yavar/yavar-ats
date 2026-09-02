import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Provider = z.enum(["lovable", "openai", "anthropic"]);

const SaveInput = z.object({
  provider: Provider,
  model: z.string().min(1).max(120),
  /** Blank keeps the stored key. */
  apiKey: z.string().default(""),
});

/** Current model setting plus which bring-your-own keys are stored. */
export const getAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { DEFAULT_MODEL, hasProviderKey } = await import("./ai-gateway.server");
    const { data } = await context.supabase
      .from("ai_settings")
      .select("provider, model, last_test_status, last_test_message, last_tested_at")
      .limit(1)
      .maybeSingle();

    return {
      provider: (data?.provider ?? "lovable") as z.infer<typeof Provider>,
      model: data?.model ?? DEFAULT_MODEL.lovable,
      last_test_status: data?.last_test_status ?? "untested",
      last_test_message: data?.last_test_message ?? null,
      last_tested_at: data?.last_tested_at ?? null,
      keys: {
        openai: await hasProviderKey("openai"),
        anthropic: await hasProviderKey("anthropic"),
      },
    };
  });

export const saveAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    const { writeProviderKey } = await import("./ai-gateway.server");
    if (data.provider !== "lovable" && data.apiKey.trim()) {
      await writeProviderKey(data.provider, data.apiKey);
    }

    const { data: existing } = await context.supabase.from("ai_settings").select("id").limit(1).maybeSingle();
    const payload = { provider: data.provider, model: data.model.trim(), updated_at: new Date().toISOString() };

    const { error } = existing
      ? await context.supabase.from("ai_settings").update(payload).eq("id", existing.id)
      : await context.supabase.from("ai_settings").insert({ ...payload, singleton: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ provider: Provider }).parse(data))
  .handler(async ({ data }) => {
    const { clearProviderKey } = await import("./ai-gateway.server");
    if (data.provider !== "lovable") await clearProviderKey(data.provider);
    return { ok: true };
  });

/** Fire a tiny real completion at the saved provider/model and record the outcome. */
export const testAiModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { aiJson, resolveAiConfig } = await import("./ai-gateway.server");
    const cfg = await resolveAiConfig();
    const started = Date.now();
    const res = await aiJson<{ ok: boolean }>({
      system: 'Reply with exactly {"ok": true} and nothing else.',
      prompt: "connection test",
      config: cfg,
    });

    const outcome = res.ok
      ? { status: "ok", message: `${cfg.provider} · ${cfg.model} responded in ${Date.now() - started}ms.` }
      : { status: "failed", message: res.message };

    const { data: existing } = await context.supabase.from("ai_settings").select("id").limit(1).maybeSingle();
    if (existing) {
      await context.supabase
        .from("ai_settings")
        .update({
          last_test_status: outcome.status,
          last_test_message: outcome.message,
          last_tested_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return outcome;
  });

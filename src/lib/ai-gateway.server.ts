/**
 * Server-only AI layer.
 *
 * Every AI step in the ATS (JD drafting, resume parsing, JD↔CV mapping, social
 * narrative scoring, AI screening) funnels through `aiJson` so a single setting
 * controls which model does the reasoning.
 *
 * Three providers are supported:
 *   lovable   — built-in Lovable AI gateway (Gemini + OpenAI models, no key)
 *   openai    — your own OpenAI API key
 *   anthropic — your own Anthropic (Claude) API key
 */

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

export type AiProvider = "lovable" | "openai" | "anthropic";

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  lovable: "google/gemini-3.7-flash",
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-5",
};

export type AiConfig = { provider: AiProvider; model: string; apiKey: string | null };

export type AiJsonResult<T> =
  | { ok: true; data: T; model: string; provider: AiProvider }
  | { ok: false; status: number; message: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Read the saved provider/model plus its stored key (service-role only). */
export async function resolveAiConfig(): Promise<AiConfig> {
  const fallback: AiConfig = {
    provider: "lovable",
    model: DEFAULT_MODEL.lovable,
    apiKey: process.env["LOVABLE_API_KEY"] ?? null,
  };
  try {
    const db = await admin();
    const { data } = await db.from("ai_settings").select("provider, model").limit(1).maybeSingle();
    if (!data) return fallback;

    const provider = (["lovable", "openai", "anthropic"] as const).includes(data.provider as AiProvider)
      ? (data.provider as AiProvider)
      : "lovable";
    const model = data.model?.trim() || DEFAULT_MODEL[provider];

    if (provider === "lovable") return { provider, model, apiKey: process.env["LOVABLE_API_KEY"] ?? null };

    const { data: cred } = await db
      .from("ai_provider_credentials")
      .select("api_key")
      .eq("provider", provider)
      .maybeSingle();
    const envKey = provider === "openai" ? process.env["OPENAI_API_KEY"] : process.env["ANTHROPIC_API_KEY"];
    return { provider, model, apiKey: cred?.api_key ?? envKey ?? null };
  } catch {
    return fallback;
  }
}

/** Persist a bring-your-own-key for a provider. Blank value leaves it untouched. */
export async function writeProviderKey(provider: AiProvider, apiKey: string) {
  if (!apiKey.trim()) return;
  const db = await admin();
  const { error } = await db
    .from("ai_provider_credentials")
    .upsert(
      { provider, api_key: apiKey.trim(), updated_at: new Date().toISOString() },
      { onConflict: "provider" },
    );
  if (error) throw new Error(error.message);
}

export async function clearProviderKey(provider: AiProvider) {
  const db = await admin();
  await db.from("ai_provider_credentials").delete().eq("provider", provider);
}

export async function hasProviderKey(provider: AiProvider) {
  const db = await admin();
  const { data } = await db
    .from("ai_provider_credentials")
    .select("provider")
    .eq("provider", provider)
    .maybeSingle();
  return Boolean(data);
}

/* ------------------------------------------------------------- streaming */

/** Read an OpenAI-style SSE stream and concatenate the text deltas. */
async function readOpenAiStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      } catch {
        /* partial frame */
      }
    }
  }
  return text;
}

/** Read an Anthropic SSE stream and concatenate the text deltas. */
async function readAnthropicStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const chunk = JSON.parse(trimmed.slice(5).trim());
        if (chunk?.type === "content_block_delta" && typeof chunk?.delta?.text === "string") {
          text += chunk.delta.text;
        }
      } catch {
        /* partial frame */
      }
    }
  }
  return text;
}

function parseJsonish<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some models wrap JSON in prose — salvage the outermost object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Ask the configured model for a JSON object.
 * Always streams so long analyses are not severed by the platform.
 */
export async function aiJson<T>(opts: {
  system: string;
  prompt: string;
  /** Force a provider/model instead of the saved setting (used by "Test model"). */
  config?: AiConfig;
}): Promise<AiJsonResult<T>> {
  const cfg = opts.config ?? (await resolveAiConfig());

  if (!cfg.apiKey) {
    return {
      ok: false,
      status: 401,
      message:
        cfg.provider === "lovable"
          ? "AI is not configured (missing key)."
          : `No ${cfg.provider} API key saved. Add one on the Integrations page.`,
    };
  }

  const isAnthropic = cfg.provider === "anthropic";
  const endpoint = isAnthropic
    ? ANTHROPIC_ENDPOINT
    : cfg.provider === "openai"
      ? OPENAI_ENDPOINT
      : LOVABLE_GATEWAY;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isAnthropic) {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }

  const body = isAnthropic
    ? {
        model: cfg.model,
        stream: true,
        max_tokens: 4096,
        system: `${opts.system}\nRespond with a single raw JSON object and nothing else.`,
        messages: [{ role: "user", content: opts.prompt }],
      }
    : {
        model: cfg.model,
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
      };

  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, status: 502, message: `AI request failed: ${(e as Error).message}` };
  }

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    let message = raw || `AI request failed (${res.status}).`;
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error?.message ?? parsed?.message ?? message;
    } catch {
      /* plain text error */
    }
    if (res.status === 402) message = `${message} — add AI credits in Lovable to continue.`;
    if (res.status === 429) message = `${message} — rate limited, retry shortly.`;
    return { ok: false, status: res.status, message: `${cfg.provider}: ${message}` };
  }

  const text = isAnthropic ? await readAnthropicStream(res.body) : await readOpenAiStream(res.body);
  const parsed = parseJsonish<T>(text);
  if (!parsed) return { ok: false, status: 502, message: "AI returned a response that could not be parsed." };

  return { ok: true, data: parsed, model: cfg.model, provider: cfg.provider };
}

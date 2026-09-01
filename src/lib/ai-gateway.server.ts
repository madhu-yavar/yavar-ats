const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AiJsonResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/**
 * Calls Lovable AI and parses a JSON object response.
 * Streaming is used so long analyses do not get severed by the platform.
 */
export async function aiJson<T>(opts: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<AiJsonResult<T>> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { ok: false, status: 401, message: "AI is not configured (missing key)." };

  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model ?? "google/gemini-3.7-flash",
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, status: 502, message: `AI request failed: ${(e as Error).message}` };
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: body || `AI request failed (${res.status}).` };
  }

  const reader = res.body.getReader();
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

  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  try {
    return { ok: true, data: JSON.parse(cleaned) as T };
  } catch {
    return { ok: false, status: 502, message: "AI returned a response that could not be parsed." };
  }
}

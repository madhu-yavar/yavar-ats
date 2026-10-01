/**
 * Client-safe error → toast text. Drizzle surfaces driver failures as
 * "Failed query: …" SQL dumps — log those for diagnosis but never show raw
 * SQL to a user; everything else (validation, permissions, plain messages)
 * passes through untouched.
 */
export function errorToastMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  if (/^Failed query/.test(raw)) {
    console.error("server call failed:", raw);
    return fallback;
  }
  return raw || fallback;
}

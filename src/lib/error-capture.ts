// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Expand Error-like args into a string that keeps the
// message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// Wrap console.error/warn so errors logged by any layer — including h3's
// internal unhandled-error logging, which this file cannot hook directly —
// are recorded for consumeLastCapturedError, expanded before serialization,
// and mirrored into the app_logs pipeline (see src/server/logger.ts). The
// logger import stays dynamic: this module must never statically pull in
// src/server/** (import-protection rule for anything reachable client-side).
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

/** First string arg (or expanded error text) — the row's one-line message. */
function headlineOf(expanded: unknown[]): string {
  const first = expanded[0];
  if (typeof first === "string") return first;
  return expanded.filter((a) => typeof a === "string").join(" ") || "console output";
}

function mirrorToAppLogs(level: "error" | "warn", expanded: unknown[]): void {
  void import("../server/logger")
    .then((m) =>
      m.logApp(level, "app", headlineOf(expanded), {
        detail: expanded.map((a) => (isErrorLike(a) ? describeError(a) : a)),
      }),
    )
    .catch(() => {});
}

console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
  mirrorToAppLogs("error", expanded);
};

console.warn = (...args: unknown[]) => {
  originalConsoleWarn(...args);
  mirrorToAppLogs("warn", [...args]);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => {
    const error = (event as ErrorEvent).error ?? event;
    record(error);
    mirrorToAppLogs("error", [describeError(error)]);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    record(reason);
    mirrorToAppLogs("error", [
      "Unhandled rejection",
      isErrorLike(reason) ? describeError(reason) : String(reason),
    ]);
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

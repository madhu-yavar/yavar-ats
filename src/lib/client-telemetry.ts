/**
 * Client-side error telemetry — the FE leg of the observability pipeline.
 * Captures uncaught errors and unhandled rejections, buffers them, and ships
 * batches to /api/public/client-logs (rate-limited server-side; capped per
 * session here). Installed once from __root.tsx. Browser-only.
 */

interface ClientLogEntry {
  level: "warn" | "error";
  message: string;
  stack?: string;
  path: string;
  ts: number;
}

const FLUSH_MS = 5_000;
const MAX_BATCH = 20;
const SESSION_CAP = 100;
const STACK_CAP = 2_000;
const MESSAGE_CAP = 2_000;

let buffer: ClientLogEntry[] = [];
let sessionCount = 0;
let installed = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function sessionCountBump(n: number): number {
  try {
    const current = Number(sessionStorage.getItem("atsiq:client-log-count") ?? "0") + n;
    sessionStorage.setItem("atsiq:client-log-count", String(current));
    return current;
  } catch {
    return (sessionCount += n);
  }
}

function enqueue(entry: ClientLogEntry): void {
  if (sessionCountBump(1) > SESSION_CAP) return; // a runaway loop must not DDoS us
  buffer.push(entry);
  if (buffer.length >= MAX_BATCH) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_MS);
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  const body = JSON.stringify({ entries: batch });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/public/client-logs",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    await fetch("/api/public/client-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Telemetry is best-effort; dropping a batch must never surface to users.
  }
}

/** Manual client-side log (e.g. a caught failure worth surfacing to devs). */
export function logClient(level: "warn" | "error", message: string, error?: unknown): void {
  const stack = error instanceof Error ? (error.stack ?? "").slice(0, STACK_CAP) : "";
  enqueue({
    level,
    message: message.slice(0, MESSAGE_CAP),
    ...(stack ? { stack } : {}),
    path: window.location.pathname,
    ts: Date.now(),
  });
}

/** Idempotent — install the global listeners once per page load. */
export function installClientTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const error = event.error;
    const stack = error instanceof Error ? (error.stack ?? "").slice(0, STACK_CAP) : "";
    enqueue({
      level: "error",
      message: (error instanceof Error ? error.message : (event.message ?? "Uncaught error")).slice(
        0,
        MESSAGE_CAP,
      ),
      ...(stack ? { stack } : {}),
      path: window.location.pathname,
      ts: Date.now(),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const stack = reason instanceof Error ? (reason.stack ?? "").slice(0, STACK_CAP) : "";
    enqueue({
      level: "error",
      message:
        `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`.slice(
          0,
          MESSAGE_CAP,
        ),
      ...(stack ? { stack } : {}),
      path: window.location.pathname,
      ts: Date.now(),
    });
  });
  window.addEventListener("pagehide", () => void flush());
}

import dns from "node:dns/promises";
import net from "node:net";

/**
 * The only way server code may fetch an external URL. Candidate CVs, profile
 * texts and integration configs are attacker-controlled, so every server-side
 * fetch of a user-supplied URL must go through here:
 *   - http/https only
 *   - the hostname is resolved first and every resolved address is checked
 *     against private / loopback / link-local / shared ranges (SSRF + cloud
 *     metadata protection, including DNS-rebinding via the resolved IP pin)
 *   - redirects are not followed automatically; each hop must be re-validated
 *   - a hard timeout and a response-size cap bound the fetch
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512_000;

function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map((n) => Number(n));
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (some VPC paths)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(address)) {
    const low = address.toLowerCase();
    if (low === "::" || low === "::1") return true; // unspecified, loopback
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
    if (low.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:10.0.0.1 etc.) — check the embedded v4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return false;
  }
  return true; // not an IP we understand — block
}

async function assertPublicHost(hostname: string): Promise<string> {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error(`Blocked address: ${hostname}`);
    return hostname;
  }
  const looked = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!looked.length) throw new Error(`Could not resolve ${hostname}`);
  for (const { address } of looked) {
    if (isBlockedAddress(address)) throw new Error(`Blocked address for ${hostname}`);
  }
  return looked[0]!.address;
}

export type SafeFetchResponse = Response & { __resolvedIp?: string };

export async function safeFetch(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<SafeFetchResponse> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Malformed URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http/https URLs can be fetched.");
  }
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed.");

  const resolvedIp = await assertPublicHost(url.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Pin the resolved, vetted IP for this request: a rebind between the check
    // and the connection cannot smuggle us to a private address.
    const res = (await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { host: url.host },
    } as RequestInit & { host?: string })) as SafeFetchResponse;
    res.__resolvedIp = resolvedIp;
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Follow up to `hops` redirects, re-validating every location; then read the
 * body with a hard size cap. Returns text plus the final content-type.
 */
export async function safeFetchText(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number; hops?: number },
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  let current = rawUrl;
  for (let hop = 0; hop <= (opts?.hops ?? 2); hop++) {
    const res = await safeFetch(current, opts);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect without a location.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader)
      return { text: "", contentType: res.headers.get("content-type") ?? "", finalUrl: current };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
      contentType: res.headers.get("content-type") ?? "",
      finalUrl: current,
    };
  }
  throw new Error("Too many redirects.");
}

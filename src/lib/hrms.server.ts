/**
 * Server-only HRMS sync plumbing.
 *
 * Adapters pull the employee master from the organisation's HRMS through
 * safeFetch (SSRF-guarded) with per-provider host allow-lists, map vendor
 * payloads into the shared NormalEmployee shape and cache them in
 * hrms_employees. The HRMS stays the system of record — this is a read-only
 * cache, so syncs upsert and tombstone, never delete.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "../server/db";
import { env } from "../server/env";
import { writeAudit } from "../server/audit";
import { safeFetch } from "../server/safe-fetch";
import { hrmsEmployees, hrmsFieldMappings, hrmsSyncState, sourceIntegrations } from "@db/schema";
import {
  HRMS_PROVIDERS,
  hrmsProviderMeta,
  type EmployeePage,
  type HrmsProviderId,
  type NormalEmployee,
} from "./hrms";
import { readSecrets, type IntegrationConfig, type TestOutcome } from "./integrations.server";

/* ------------------------------------------------------------ connections */

/** Create the HRMS connection rows for an org that are missing (idempotent). */
export async function ensureHrmsConnections(orgId: string): Promise<void> {
  const existing = await db
    .select({ provider: sourceIntegrations.provider })
    .from(sourceIntegrations)
    .where(and(eq(sourceIntegrations.orgId, orgId), eq(sourceIntegrations.category, "hrms")));
  const have = new Set(existing.map((r) => r.provider));
  const missing = HRMS_PROVIDERS.filter((p) => !have.has(p.provider));
  if (!missing.length) return;
  await db
    .insert(sourceIntegrations)
    .values(
      missing.map((p) => ({
        orgId,
        provider: p.provider,
        label: p.label,
        enabled: false,
        category: "hrms",
        config: {},
        credentialFields: p.credentialFields,
      })),
    )
    .onConflictDoNothing();
}

/**
 * HRMS API base URLs are org-member-supplied, so the host must be https and
 * within the provider's allow-list — same reasoning as the sourcing boards
 * in integrations.server.ts, but scoped to each HRMS vendor's real hosts.
 */
export function assertHrmsBaseUrl(provider: HrmsProviderId, rawBaseUrl: string): string {
  const meta = hrmsProviderMeta(provider);
  if (!meta) throw new Error("Unknown HRMS provider.");
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("The API base URL is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("The API base URL must use https.");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed.");
  const extra = (env.INTEGRATION_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allowed = [...meta.allowedHosts, ...extra];
  const host = url.hostname.toLowerCase();
  if (!allowed.includes(host) && !allowed.some((a) => host.endsWith(`.${a}`))) {
    throw new Error(`That API base URL is not an approved ${meta.label} endpoint.`);
  }
  return url.toString().replace(/\/$/, "");
}

/* ---------------------------------------------------------------- testing */

function missingCredentials(
  meta: { credentialFields: string[]; label: string },
  secrets: Record<string, string>,
  needsBaseUrl: boolean,
  config: IntegrationConfig,
): TestOutcome {
  const missing = meta.credentialFields.filter((k) => !secrets[k]);
  if (missing.length)
    return { status: "pending", message: `Missing credential(s): ${missing.join(", ")}.` };
  if (needsBaseUrl && !(typeof config["base_url"] === "string" && config["base_url"].trim()))
    return {
      status: "pending",
      message: "Credentials stored. Add your tenant API base URL to verify the connection.",
    };
  return { status: "ok", message: "" };
}

/** Probe a configured HRMS connection; never throws, mirrors sourcing tests. */
export async function testHrmsProvider(
  provider: HrmsProviderId,
  secrets: Record<string, string>,
  config: IntegrationConfig,
): Promise<TestOutcome> {
  const meta = hrmsProviderMeta(provider);
  if (!meta) return { status: "failed", message: "Unknown HRMS provider." };
  const early = missingCredentials(meta, secrets, meta.needsBaseUrl, config);
  if (early.status !== "ok") return early;
  try {
    const adapter = getAdapter(provider);
    const outcome = await adapter.test(secrets, config);
    return outcome;
  } catch (e) {
    return { status: "failed", message: `${meta.label} test failed: ${(e as Error).message}` };
  }
}

/* --------------------------------------------------------------- adapters */

/**
 * Endpoint paths and payload shapes follow the vendors' public developer
 * references (developers.keka.com, api-docs.greythr.com) as of 2026-09-29;
 * they are constants precisely so a live sandbox credential pass can confirm
 * or correct them in one place.
 */
type HrmsAdapter = {
  test(secrets: Record<string, string>, config: IntegrationConfig): Promise<TestOutcome>;
  listEmployees(
    secrets: Record<string, string>,
    config: IntegrationConfig,
    cursor: Record<string, unknown> | null,
  ): Promise<EmployeePage>;
};

function baseUrlFor(provider: HrmsProviderId, config: IntegrationConfig): string {
  const meta = hrmsProviderMeta(provider);
  const raw = typeof config["base_url"] === "string" ? (config["base_url"] as string).trim() : "";
  const url = raw || (meta?.defaultBaseUrl ?? "");
  if (!url) throw new Error("Add the API base URL for this connection first.");
  return assertHrmsBaseUrl(provider, url);
}

async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  label: string,
): Promise<unknown> {
  const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 2_000_000, ...init });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} returned ${res.status}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s.length ? s : null;
};

/** Keka token grant → bearer; employee list paged by page number. */
const kekaAdapter: HrmsAdapter = {
  async test(secrets, config) {
    await kekaToken(baseUrlFor("keka", config), secrets);
    return { status: "ok", message: "Keka accepted the credentials and issued an access token." };
  },
  async listEmployees(secrets, config, cursor) {
    const base = baseUrlFor("keka", config);
    const token = await kekaToken(base, secrets);
    const page = Number(cursor?.["page"] ?? 1);
    const payload = (await fetchJson(
      `${base}/v1/employees?page[number]=${page}&page[size]=100`,
      { headers: { Authorization: `Bearer ${token}` } },
      "Keka",
    )) as Record<string, unknown>;
    const rows = (payload["data"] ?? payload["employees"] ?? []) as Record<string, unknown>[];
    const employees = rows.map(mapKekaEmployee).filter((e): e is NormalEmployee => e !== null);
    const metaObj = payload["meta"] as Record<string, unknown> | undefined;
    const totalPages = Number(payload["total_pages"] ?? metaObj?.["total_pages"] ?? 0);
    const next = totalPages && page < totalPages ? { page: page + 1 } : null;
    return { employees, cursor: next };
  },
};

async function kekaToken(base: string, secrets: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "employees.read",
    client_id: secrets["client_id"] ?? "",
    client_secret: secrets["client_secret"] ?? "",
    api_key: secrets["api_key"] ?? "",
  });
  const payload = (await fetchJson(
    `${base}/v1/oauth/token`,
    { method: "POST", body: body.toString() },
    "Keka",
  )) as Record<string, unknown>;
  const token = str(payload["access_token"]);
  if (!token) throw new Error("Keka token endpoint returned no access token.");
  return token;
}

function mapKekaEmployee(row: Record<string, unknown>): NormalEmployee | null {
  const externalId = str(row["id"] ?? row["employee_id"]);
  if (!externalId) return null;
  const name = str(row["full_name"] ?? row["name"]) ?? "Unknown";
  const dept = row["department"];
  return {
    externalId,
    fullName: name,
    email: str(row["official_email"] ?? row["work_email"] ?? row["email"]),
    employeeCode: str(row["employee_code"] ?? row["code"]),
    department:
      typeof dept === "object" && dept !== null
        ? str((dept as Record<string, unknown>)["name"])
        : str(dept),
    jobTitle: str(row["job_title"] ?? row["designation"]),
    location: str(row["location"] ?? row["work_location"]),
    managerExternalId: str(
      typeof row["manager"] === "object" && row["manager"] !== null
        ? (row["manager"] as Record<string, unknown>)["id"]
        : row["manager_id"],
    ),
    employmentStatus: (str(row["status"] ?? row["employment_status"]) ?? "active").toLowerCase(),
    joinedOn: str(row["date_of_joining"] ?? row["joined_on"]),
    raw: row,
  };
}

/** greytHR: per-tenant base URL, x-api-key header, page/per_page paging. */
const greythrAdapter: HrmsAdapter = {
  async test(secrets, config) {
    const base = baseUrlFor("greythr", config);
    await fetchJson(
      `${base}/v2/api/employees?page=1&per_page=1`,
      { headers: greythrHeaders(secrets) },
      "greytHR",
    );
    return { status: "ok", message: "greytHR accepted the API key and listed employees." };
  },
  async listEmployees(secrets, config, cursor) {
    const base = baseUrlFor("greythr", config);
    const page = Number(cursor?.["page"] ?? 1);
    const payload = (await fetchJson(
      `${base}/v2/api/employees?page=${page}&per_page=100`,
      { headers: greythrHeaders(secrets) },
      "greytHR",
    )) as Record<string, unknown>;
    const rows = (payload["data"] ?? payload["employees"] ?? []) as Record<string, unknown>[];
    const employees = rows.map(mapGreythrEmployee).filter((e): e is NormalEmployee => e !== null);
    const hasMore = rows.length === 100;
    return { employees, cursor: hasMore ? { page: page + 1 } : null };
  },
};

function greythrHeaders(secrets: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "x-api-key": secrets["api_key"] ?? "" };
  const tenant = str(secrets["tenant_id"]);
  if (tenant) headers["x-tenant-id"] = tenant;
  return headers;
}

function mapGreythrEmployee(row: Record<string, unknown>): NormalEmployee | null {
  const externalId = str(row["employeeId"] ?? row["id"] ?? row["employee_id"]);
  if (!externalId) return null;
  const name = str(row["fullName"] ?? row["name"] ?? row["employeeName"]) ?? "Unknown";
  return {
    externalId,
    fullName: name,
    email: str(row["email"] ?? row["workEmail"] ?? row["officialEmail"]),
    employeeCode: str(row["employeeCode"] ?? row["code"]),
    department: str(row["department"] ?? row["departmentName"]),
    jobTitle: str(row["jobTitle"] ?? row["designation"]),
    location: str(row["location"] ?? row["branch"]),
    managerExternalId: str(row["reportingManagerId"] ?? row["managerId"]),
    employmentStatus: (str(row["employmentStatus"] ?? row["status"]) ?? "active").toLowerCase(),
    joinedOn: str(row["dateOfJoining"] ?? row["joiningDate"]),
    raw: row,
  };
}

function getAdapter(provider: HrmsProviderId): HrmsAdapter {
  switch (provider) {
    case "keka":
      return kekaAdapter;
    case "greythr":
      return greythrAdapter;
  }
}

/* ------------------------------------------------------------ sync engine */

export type HrmsSyncResult = {
  provider: string;
  fetched: number;
  upserted: number;
  pages: number;
  status: "ok" | "failed";
  error?: string;
};

async function mapWithOverrides(
  employee: NormalEmployee,
  overrides: Record<string, string>,
): Promise<NormalEmployee> {
  // Field-mapping overrides: HRMS field path in `raw` → normalised field.
  const pick = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        employee.raw,
      );
  const out = { ...employee };
  for (const [hrmsPath, field] of Object.entries(overrides)) {
    const value = str(pick(hrmsPath));
    if (value === null) continue;
    if (field === "fullName") out.fullName = value;
    else if (field === "email") out.email = value;
    else if (field === "employeeCode") out.employeeCode = value;
    else if (field === "department") out.department = value;
    else if (field === "jobTitle") out.jobTitle = value;
    else if (field === "location") out.location = value;
    else if (field === "managerExternalId") out.managerExternalId = value;
    else if (field === "employmentStatus") out.employmentStatus = value.toLowerCase();
    else if (field === "joinedOn") out.joinedOn = value;
  }
  return out;
}

/**
 * Pull the employee master from one configured HRMS connection. Every run is
 * a full pass (both vendors are small enough that a full pull is safer than
 * trusting incremental cursors); the cursor only paginates within the run.
 */
export async function syncHrmsEmployees(opts: {
  orgId: string;
  integrationId: string;
  /** Safety cap on pages per run (100 employees/page). */
  maxPages?: number;
  actor?: string;
}): Promise<HrmsSyncResult> {
  const [row] = await db
    .select({
      id: sourceIntegrations.id,
      provider: sourceIntegrations.provider,
      enabled: sourceIntegrations.enabled,
    })
    .from(sourceIntegrations)
    .where(
      and(
        eq(sourceIntegrations.id, opts.integrationId),
        eq(sourceIntegrations.orgId, opts.orgId),
        eq(sourceIntegrations.category, "hrms"),
      ),
    )
    .limit(1);
  if (!row) throw new Error("HRMS connection not found.");
  const meta = hrmsProviderMeta(row.provider);
  if (!meta) throw new Error(`Unknown HRMS provider: ${row.provider}.`);
  if (!row.enabled) throw new Error(`${meta.label} is disabled on the Integrations page.`);

  const [state] = await db
    .insert(hrmsSyncState)
    .values({ orgId: opts.orgId, integrationId: row.id, entity: "employees" })
    .onConflictDoUpdate({
      target: [hrmsSyncState.integrationId, hrmsSyncState.entity],
      set: { lastRunStatus: "running", lastError: null, updatedAt: new Date() },
    })
    .returning();

  const result = await runSync(
    opts.orgId,
    row.id,
    row.provider as HrmsProviderId,
    state?.cursor ?? {},
  );

  await db
    .update(hrmsSyncState)
    .set({
      cursor: result.status === "ok" ? {} : (state?.cursor ?? {}),
      lastRunAt: new Date(),
      lastRunStatus: result.status,
      lastError: result.error ?? null,
      lastFullSyncAt: result.status === "ok" ? new Date() : (state?.lastFullSyncAt ?? null),
      stats: { fetched: result.fetched, upserted: result.upserted, pages: result.pages },
      updatedAt: new Date(),
    })
    .where(eq(hrmsSyncState.id, state!.id));

  await writeAudit({
    actor: opts.actor ?? "system",
    orgId: opts.orgId,
    action: result.status === "ok" ? "hrms.sync.completed" : "hrms.sync.failed",
    entityType: "source_integration",
    entityId: row.id,
    detail: { ...result },
  });

  return result;
}

async function runSync(
  orgId: string,
  integrationId: string,
  provider: HrmsProviderId,
  initialCursor: Record<string, unknown>,
): Promise<HrmsSyncResult> {
  const meta = hrmsProviderMeta(provider)!;
  const secrets = await readSecrets(integrationId);
  const [row] = await db
    .select({ config: sourceIntegrations.config })
    .from(sourceIntegrations)
    .where(eq(sourceIntegrations.id, integrationId))
    .limit(1);
  const config = (row?.config as IntegrationConfig) ?? {};
  const mappings = await loadMappings(integrationId);

  const adapter = getAdapter(provider);
  let cursor: Record<string, unknown> | null =
    initialCursor && Object.keys(initialCursor).length ? initialCursor : null;
  let fetched = 0;
  let upserted = 0;
  let pages = 0;
  const maxPages = 50;

  try {
    while (pages < maxPages) {
      const page: EmployeePage = await adapter.listEmployees(secrets, config, cursor);
      pages += 1;
      fetched += page.employees.length;
      for (const raw of page.employees) {
        const employee = await mapWithOverrides(raw, mappings);
        await db
          .insert(hrmsEmployees)
          .values({
            orgId,
            integrationId,
            externalId: employee.externalId,
            fullName: employee.fullName,
            email: employee.email,
            employeeCode: employee.employeeCode,
            department: employee.department,
            jobTitle: employee.jobTitle,
            location: employee.location,
            managerExternalId: employee.managerExternalId,
            employmentStatus: employee.employmentStatus,
            joinedOn: employee.joinedOn,
            raw: employee.raw,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [hrmsEmployees.integrationId, hrmsEmployees.externalId],
            set: {
              fullName: employee.fullName,
              email: employee.email,
              employeeCode: employee.employeeCode,
              department: employee.department,
              jobTitle: employee.jobTitle,
              location: employee.location,
              managerExternalId: employee.managerExternalId,
              employmentStatus: employee.employmentStatus,
              joinedOn: employee.joinedOn,
              raw: employee.raw,
              lastSyncedAt: new Date(),
            },
          });
        upserted += 1;
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return { provider, fetched, upserted, pages, status: "ok" };
  } catch (e) {
    return {
      provider,
      fetched,
      upserted,
      pages,
      status: "failed",
      error: e instanceof Error ? e.message : `${meta.label} sync failed`,
    };
  }
}

async function loadMappings(integrationId: string): Promise<Record<string, string>> {
  const [row] = await db
    .select({ mappings: hrmsFieldMappings.mappings })
    .from(hrmsFieldMappings)
    .where(eq(hrmsFieldMappings.integrationId, integrationId))
    .limit(1);
  return row?.mappings ?? {};
}

/** Cached employee counts per HRMS connection, for the Integrations panel. */
export async function hrmsSyncOverview(orgId: string) {
  const rows = await db
    .select({
      integrationId: sourceIntegrations.id,
      provider: sourceIntegrations.provider,
      state: hrmsSyncState,
      cached: sql<number>`(select count(*)::int from ${hrmsEmployees} where ${hrmsEmployees.integrationId} = ${sourceIntegrations.id})`,
      mappings: hrmsFieldMappings.mappings,
    })
    .from(sourceIntegrations)
    .leftJoin(
      hrmsSyncState,
      and(
        eq(hrmsSyncState.integrationId, sourceIntegrations.id),
        eq(hrmsSyncState.entity, "employees"),
      ),
    )
    .leftJoin(hrmsFieldMappings, eq(hrmsFieldMappings.integrationId, sourceIntegrations.id))
    .where(and(eq(sourceIntegrations.orgId, orgId), eq(sourceIntegrations.category, "hrms")));
  return rows;
}

/** Forget the cached employee master for a disconnected connection. */
export async function forgetHrmsCache(integrationId: string): Promise<void> {
  await db.delete(hrmsEmployees).where(eq(hrmsEmployees.integrationId, integrationId));
  await db
    .delete(hrmsSyncState)
    .where(
      and(eq(hrmsSyncState.integrationId, integrationId), eq(hrmsSyncState.entity, "employees")),
    );
}

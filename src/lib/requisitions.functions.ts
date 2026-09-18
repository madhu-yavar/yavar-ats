/**
 * Org-scoped write layer for requisitions, JD versions, departments and the
 * internal job posting (IJP) apply flow. Every function verifies the caller's
 * organisation (`requireOrg`) and predicates every read/write on it.
 */
import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "../server/db";
import { applications, candidates, departments, jobDescriptions, requisitions } from "@db/schema";
import { assertRole, requireOrg, type AppRole } from "./auth.middleware";

const ReqStatus = z.enum([
  "draft",
  "pending_dh",
  "pending_hr",
  "pending_cbo",
  "approved",
  "rejected",
  "on_hold",
  "closed",
]);

/**
 * The requisition approval chain (DH → HR → CBO) is enforced HERE, not in the
 * UI: each target status names the legal source statuses and the role that may
 * make the hop. Org owners pass every role check (assertRole semantics).
 */
const REQ_TRANSITIONS: Partial<Record<(typeof ReqStatus.options)[number], { from: string[]; role?: AppRole | AppRole[] }>> = {
  draft: { from: ["draft", "rejected", "on_hold"] },
  pending_dh: { from: ["draft", "rejected", "on_hold"] },
  pending_hr: { from: ["pending_dh"], role: "department_head" },
  pending_cbo: { from: ["pending_hr"], role: "hr_head" },
  approved: { from: ["pending_cbo"], role: "president_cbo" },
  rejected: {
    from: ["pending_dh", "pending_hr", "pending_cbo"],
    role: ["department_head", "hr_head", "president_cbo"],
  },
  on_hold: {
    from: ["draft", "pending_dh", "pending_hr", "pending_cbo", "approved"],
    role: ["hr_head", "president_cbo"],
  },
  closed: { from: ["approved", "on_hold"], role: ["hr_head", "president_cbo"] },
};

/* ------------------------------------------------------------- requisitions */

/** Approve/advance a requisition: role-checked status bump, trail rebuilt server-side. */
export const advanceRequisition = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: ReqStatus,
        comment: z.string().max(2000).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const [current] = await db
      .select({ status: requisitions.status, approvalTrail: requisitions.approvalTrail })
      .from(requisitions)
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    if (!current) throw new Error("Requisition not found.");

    const rule = REQ_TRANSITIONS[data.status];
    if (!rule || !rule.from.includes(current.status)) {
      throw new Error(`A requisition cannot move from ${current.status} to ${data.status}.`);
    }
    if (rule.role) {
      await assertRole(context.userId, context.orgId, rule.role);
    }

    // The approval trail is evidence — it is rebuilt server-side and never
    // accepted from the client.
    const prior = Array.isArray(current.approvalTrail) ? current.approvalTrail : [];
    const trail = [
      ...prior,
      {
        from: current.status,
        to: data.status,
        actor: context.memberEmail,
        decision: data.status,
        comment: data.comment ?? null,
        at: new Date().toISOString(),
      },
    ];

    await db
      .update(requisitions)
      .set({ status: data.status, approvalTrail: trail as never })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/** Publish / unpublish an approved requisition on the internal job board. */
export const setRequisitionIjp = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await db
      .update(requisitions)
      .set({
        ijpEnabled: data.enabled,
        ijpPostedAt: data.enabled ? new Date() : null,
      })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/** Employee-facing note shown on the internal job board. */
export const setRequisitionIjpNotes = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().nullish() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await db
      .update(requisitions)
      .set({ ijpNotes: data.notes || null })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/** Persist the six match weights configured for this requisition. */
export const saveRequisitionWeights = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        weights: z.object({
          skills: z.number().int(),
          experience: z.number().int(),
          career: z.number().int(),
          impact: z.number().int(),
          education: z.number().int(),
          social: z.number().int(),
        }),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await db
      .update(requisitions)
      .set({
        weightSkills: data.weights.skills,
        weightExperience: data.weights.experience,
        weightCareer: data.weights.career,
        weightImpact: data.weights.impact,
        weightEducation: data.weights.education,
        weightSocial: data.weights.social,
      })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/** Write budget CTC + band (e.g. chosen from a market benchmark) and the ladder level they came from. */
export const updateRequisitionCompensation = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        budgetCtc: z.string(),
        ctcBandMin: z.string(),
        ctcBandMax: z.string(),
        careerLevel: z.string().nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await db
      .update(requisitions)
      .set({
        budgetCtc: String(Number(data.budgetCtc) || 0),
        ctcBandMin: data.ctcBandMin ? String(Number(data.ctcBandMin)) : null,
        ctcBandMax: data.ctcBandMax ? String(Number(data.ctcBandMax)) : null,
        careerLevel: data.careerLevel || null,
      })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/* ------------------------------------------------------------ JD versions */

const JdVersion = z.object({
  purpose: z.string(),
  responsibilities: z.string(),
  must_have: z.array(z.string()),
  good_to_have: z.array(z.string()),
  qualifications: z.string(),
  success_factors: z.string(),
  reporting_to: z.string(),
  full_text: z.string(),
});

/**
 * File a drafted or imported JD as the next version for Department Head
 * review. The version number is computed server-side so concurrent drafts
 * never collide on the same number.
 */
export const saveJobDescription = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        requisitionId: z.string().uuid(),
        jd: JdVersion,
        /** Content template the draft followed — lineage only, no FK. */
        templateId: z.string().uuid().nullish(),
        templateName: z.string().max(80).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const [requisition] = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(and(eq(requisitions.id, data.requisitionId), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    if (!requisition) throw new Error("Requisition not found");

    const [latest] = await db
      .select({ version: jobDescriptions.version })
      .from(jobDescriptions)
      .where(
        and(
          eq(jobDescriptions.requisitionId, data.requisitionId),
          eq(jobDescriptions.orgId, context.orgId),
        ),
      )
      .orderBy(desc(jobDescriptions.version))
      .limit(1);

    await db.insert(jobDescriptions).values({
      requisitionId: data.requisitionId,
      orgId: context.orgId,
      version: (latest?.version ?? 0) + 1,
      status: "pending_dh",
      purpose: data.jd.purpose,
      responsibilities: data.jd.responsibilities,
      mustHave: data.jd.must_have,
      goodToHave: data.jd.good_to_have,
      qualifications: data.jd.qualifications,
      successFactors: data.jd.success_factors,
      reportingTo: data.jd.reporting_to,
      fullText: data.jd.full_text,
      templateId: data.templateId || null,
      templateName: data.templateName || null,
    });
    return { ok: true as const };
  });

/** Approve a JD version — a department-head-and-above decision. */
export const approveJobDescription = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), fullText: z.string().nullish() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertRole(
      context.userId,
      context.orgId,
      ["department_head", "hr_head", "president_cbo"],
      "Only a department head, HR head or the CBO can approve a job description.",
    );
    const [jd] = await db
      .select({ status: jobDescriptions.status })
      .from(jobDescriptions)
      .where(and(eq(jobDescriptions.id, data.id), eq(jobDescriptions.orgId, context.orgId)))
      .limit(1);
    if (!jd) throw new Error("Job description not found.");
    if (jd.status === "approved") throw new Error("This version is already approved.");
    await db
      .update(jobDescriptions)
      .set({ status: "approved", fullText: data.fullText ?? null })
      .where(and(eq(jobDescriptions.id, data.id), eq(jobDescriptions.orgId, context.orgId)));
    return { ok: true as const };
  });

/**
 * Keep the requisition's scoring baseline in sync with an imported JD. Only
 * the fields the caller sends are written — the blanks-fill-in-never-overwrite
 * policy is decided against the live requisition row before the call.
 */
export const syncRequisitionFromJd = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mustHaveSkills: z.array(z.string()).optional(),
        goodToHaveSkills: z.array(z.string()).optional(),
        experienceMin: z.number().int().optional(),
        experienceMax: z.number().int().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch: Partial<typeof requisitions.$inferInsert> = {};
    if (data.mustHaveSkills) patch.mustHaveSkills = data.mustHaveSkills;
    if (data.goodToHaveSkills) patch.goodToHaveSkills = data.goodToHaveSkills;
    if (data.experienceMin !== undefined) patch.experienceMin = data.experienceMin;
    if (data.experienceMax !== undefined) patch.experienceMax = data.experienceMax;
    if (Object.keys(patch).length === 0) return { ok: true as const };

    await db
      .update(requisitions)
      .set(patch)
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/* ------------------------------------------------------------- applications */

/**
 * Attach talent-pool candidates to a requisition as applications (source
 * defaults to "talent_pool"). A candidate already in the pipeline trips the
 * unique (requisition, candidate) index and the error propagates, exactly as
 * the PostgREST call did.
 */
export const addApplicationsToRequisition = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        requisitionId: z.string().uuid(),
        candidateIds: z.array(z.string().uuid()).min(1).max(200),
        source: z.string().min(1).default("talent_pool"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const [requisition] = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(and(eq(requisitions.id, data.requisitionId), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    if (!requisition) throw new Error("Requisition not found");

    await db.insert(applications).values(
      data.candidateIds.map((candidateId) => ({
        requisitionId: data.requisitionId,
        candidateId,
        orgId: context.orgId,
        source: data.source,
      })),
    );
    return { ok: true as const, added: data.candidateIds.length };
  });

/* -------------------------------------------------------- create requisition */

/**
 * Raise a manpower requisition. The client generates the per-org `code`
 * (REQ-YYYY-NNN from its own list length — kept identical) and the per-org
 * unique index `requisitions_org_code_key` still rejects duplicates with a
 * thrown error the route surfaces as a toast.
 */
export const createRequisition = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        code: z.string().min(1),
        title: z.string().min(1),
        departmentId: z.string().uuid().nullish(),
        location: z.string(),
        openings: z.string(),
        experienceMin: z.string(),
        experienceMax: z.string(),
        budgetCtc: z.string(),
        ctcBandMin: z.string(),
        ctcBandMax: z.string(),
        maxNoticePeriodDays: z.string(),
        workAuthorizationRequired: z.string(),
        hiringManager: z.string(),
        mustHaveSkills: z.array(z.string()),
        goodToHaveSkills: z.array(z.string()),
        responsibilities: z.string(),
        educationRequirement: z.string(),
        billingType: z.string(),
        engagementType: z.string(),
        clientName: z.string(),
        costCenter: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await db.insert(requisitions).values({
      orgId: context.orgId,
      code: data.code,
      title: data.title,
      departmentId: data.departmentId || null,
      location: data.location,
      openings: Number(data.openings) || 1,
      experienceMin: Number(data.experienceMin) || 0,
      experienceMax: Number(data.experienceMax) || 0,
      budgetCtc: String(Number(data.budgetCtc) || 0),
      ctcBandMin: data.ctcBandMin ? String(Number(data.ctcBandMin)) : null,
      ctcBandMax: data.ctcBandMax ? String(Number(data.ctcBandMax)) : null,
      maxNoticePeriodDays: data.maxNoticePeriodDays ? Number(data.maxNoticePeriodDays) : null,
      workAuthorizationRequired: data.workAuthorizationRequired || null,
      hiringManager: data.hiringManager || null,
      mustHaveSkills: data.mustHaveSkills,
      goodToHaveSkills: data.goodToHaveSkills,
      responsibilities: data.responsibilities || null,
      educationRequirement: data.educationRequirement || null,
      billingType: data.billingType,
      engagementType: data.engagementType,
      clientName: data.clientName || null,
      costCenter: data.costCenter || null,
      status: "pending_dh",
    });
    return { ok: true as const };
  });

/* ------------------------------------------------------- job card overrides */

const JobCardZoneInput = z.object({
  slot: z.enum(["role", "skills", "experience", "location", "contact", "org"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
  fontSize: z.number().min(8).max(200),
  align: z.enum(["left", "center", "right"]).default("left"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  mask: z.boolean().optional(),
  fontFamily: z.enum(["system", "serif", "mono"]).nullish(),
});

/**
 * TA-corrected job-card layout and slot values for this requisition. Overrides
 * ride on top of the selected template; empty object = pure template defaults.
 */
export const saveJobCardOverrides = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        zones: z.array(JobCardZoneInput).max(12),
        values: z
          .object({
            role: z.string().max(120).optional(),
            location: z.string().max(160).optional(),
            skills: z.array(z.string().max(60)).max(8).optional(),
            contact: z.string().max(160).optional(),
          })
          .default({}),
        theme: z
          .object({
            overlayOpacity: z.number().int().min(0).max(75).optional(),
            textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            backgroundBrightness: z.number().int().min(50).max(130).optional(),
            accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          })
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await db
      .update(requisitions)
      .set({
        jobCardOverrides: {
          zones: data.zones,
          values: data.values,
          ...(data.theme ? { theme: data.theme } : {}),
        },
      })
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)));
    return { ok: true as const };
  });

/* -------------------------------------------------------------- departments */

/** Quick-add a department straight from the requisition form; returns its id. */
export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ name: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .insert(departments)
      .values({
        orgId: context.orgId,
        name: data.name,
        budgetedHeadcount: 0,
        budgetedCost: "0",
      })
      .returning({ id: departments.id });
    return { id: row?.id ?? null };
  });

/** Add a department to the workforce plan from the budgets panel. */
export const addDepartment = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(1),
        headName: z.string(),
        budgetedHeadcount: z.string(),
        budgetedCost: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await db.insert(departments).values({
      orgId: context.orgId,
      name: data.name.trim(),
      headName: data.headName.trim() || null,
      budgetedHeadcount: Number(data.budgetedHeadcount) || 0,
      budgetedCost: String(Number(data.budgetedCost) || 0),
    });
    return { ok: true as const };
  });

/* ---------------------------------------------------------- IJP apply flow */

/**
 * Employee applies to an internal job posting. The applicant's identity comes
 * from the form (the recruiter surface logs it), while tenancy comes only from
 * the session: the requisition and every write are org-scoped by `requireOrg`.
 * Re-uses an existing candidate with the same work email, otherwise registers
 * one tagged `is_internal`, then raises the IJP application (duplicate
 * applications trip the unique index and the error propagates).
 */
export const applyInternally = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        requisitionId: z.string().uuid(),
        fullName: z.string().min(1),
        email: z.string().min(1),
        employeeId: z.string().min(1),
        currentDepartment: z.string(),
        experienceYears: z.string(),
        skills: z.string(),
        note: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const [requisition] = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(and(eq(requisitions.id, data.requisitionId), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    if (!requisition) throw new Error("Requisition not found");

    const email = data.email.trim();
    const [existing] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(and(eq(candidates.orgId, context.orgId), eq(candidates.email, email)))
      .limit(1);

    let candidateId = existing?.id ?? null;
    if (!candidateId) {
      const [row] = await db
        .insert(candidates)
        .values({
          orgId: context.orgId,
          fullName: data.fullName.trim(),
          email,
          source: "ijp",
          isInternal: true,
          employeeId: data.employeeId.trim(),
          currentDepartment: data.currentDepartment || null,
          experienceYears: String(Number(data.experienceYears) || 0),
          skills: data.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          resumeText: data.note || null,
        })
        .returning({ id: candidates.id });
      if (!row) throw new Error("Could not register the employee");
      candidateId = row.id;
    }

    await db.insert(applications).values({
      requisitionId: data.requisitionId,
      candidateId,
      orgId: context.orgId,
      source: "ijp",
    });
    return { ok: true as const, candidateId };
  });

/**
 * Runtime verification: exercises src/server/db.ts + the drizzle schema against
 * a real (disposable) Postgres. Run:
 *   DATABASE_URL=... SESSION_SECRET=... bun scripts/verify-db.ts
 */
import { and, eq } from "drizzle-orm";

import { db, sql } from "../src/server/db";
import {
  contentTemplates,
  jobDescriptions,
  orgMembers,
  organizations,
  requisitions,
  salaryBenchmarks,
  userRoles,
  users,
} from "../drizzle/schema";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

try {
  // 1. users: insert + select with typed columns
  const [user] = await db
    .insert(users)
    .values({ email: "verify@example.com", fullName: "Verify Bot" })
    .returning({ id: users.id, email: users.email, createdAt: users.createdAt });
  check(
    "users insert/select",
    Boolean(user?.id && user.email === "verify@example.com" && user.createdAt instanceof Date),
  );

  // 2. organizations: defaults + enum-free text status
  const [org1] = await db
    .insert(organizations)
    .values({ name: "Verify Org", slug: `verify-${Date.now()}`, status: "active", currency: "INR" })
    .returning({
      id: organizations.id,
      status: organizations.status,
      fiscalYearStartMonth: organizations.fiscalYearStartMonth,
    });
  check(
    "organizations defaults",
    Boolean(org1?.id && org1.status === "active" && org1.fiscalYearStartMonth === 4),
  );

  // 3. org_members with FK to both sides
  const [member] = await db
    .insert(orgMembers)
    .values({
      orgId: org1!.id,
      userId: user!.id,
      email: "verify@example.com",
      status: "active",
      isOwner: true,
      joinedAt: new Date(),
    })
    .returning({ id: orgMembers.id });
  check("org_members insert (FK org+user)", Boolean(member?.id));

  // 4. unique index: duplicate (org_id, email) must fail
  let duplicateRejected = false;
  try {
    await db
      .insert(orgMembers)
      .values({ orgId: org1!.id, email: "verify@example.com", status: "invited" });
  } catch {
    duplicateRejected = true;
  }
  check("org_members unique(org,email) enforced", duplicateRejected);

  // 5. user_roles + the authz query shape used by assertRole
  await db.insert(userRoles).values({ userId: user!.id, orgId: org1!.id, role: "hr_head" });
  const [role] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, user!.id),
        eq(userRoles.orgId, org1!.id),
        eq(userRoles.role, "president_cbo"),
      ),
    )
    .limit(1);
  const [hrRole] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, user!.id),
        eq(userRoles.orgId, org1!.id),
        eq(userRoles.role, "hr_head"),
      ),
    )
    .limit(1);
  check("authz query shape (role miss/hit)", !role && hrRole?.role === "hr_head");

  // 5b. salary_benchmarks: insert with requisition link, lookup by (org, input_key)
  const [req] = await db
    .insert(requisitions)
    .values({
      orgId: org1!.id,
      code: `VERIFY-${Date.now()}`,
      title: "Verify Role",
      careerLevel: "senior",
    })
    .returning({ id: requisitions.id, careerLevel: requisitions.careerLevel });
  check("requisitions career_level column", Boolean(req?.id && req.careerLevel === "senior"));

  const [bench] = await db
    .insert(salaryBenchmarks)
    .values({
      orgId: org1!.id,
      requisitionId: req!.id,
      inputKey: "verify-key",
      title: "Verify Role",
      experienceMin: 3,
      experienceMax: 6,
      currency: "INR",
      grounded: true,
      confidence: "medium",
      payload: { currency: "INR", grounded: true, levels: [] },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    })
    .returning({ id: salaryBenchmarks.id });
  const [latest] = await db
    .select({ id: salaryBenchmarks.id, grounded: salaryBenchmarks.grounded })
    .from(salaryBenchmarks)
    .where(and(eq(salaryBenchmarks.orgId, org1!.id), eq(salaryBenchmarks.inputKey, "verify-key")))
    .limit(1);
  check(
    "salary_benchmarks insert/lookup",
    Boolean(bench?.id && latest?.id === bench!.id && latest.grounded),
  );

  // 5d. content_templates: kind check, unique (org,kind,name), default swap, cascade
  const [tpl1] = await db
    .insert(contentTemplates)
    .values({
      orgId: org1!.id,
      kind: "linkedin_post",
      name: "Verify default",
      isDefault: true,
      config: { tone: "warm", mustInclude: ["We are hiring!"], hashtags: ["hiring"] },
      instructions: "Always mention {{location}}.",
    })
    .returning({ id: contentTemplates.id });
  const [tpl2] = await db
    .insert(contentTemplates)
    .values({
      orgId: org1!.id,
      kind: "linkedin_post",
      name: "Verify alt",
      config: { tone: "bold" },
    })
    .returning({ id: contentTemplates.id });
  check("content_templates insert", Boolean(tpl1?.id && tpl2?.id));

  let badKindRejected = false;
  try {
    await db.insert(contentTemplates).values({ orgId: org1!.id, kind: "nope", name: "X" });
  } catch {
    badKindRejected = true;
  }
  check("content_templates kind check enforced", badKindRejected);

  // 5d′. job_descriptions lineage columns (before the requisition is deleted)
  const [jdRow] = await db
    .insert(jobDescriptions)
    .values({
      requisitionId: req!.id,
      orgId: org1!.id,
      version: 1,
      status: "draft",
      templateId: tpl1?.id,
      templateName: "Verify default",
      fullText: "# Verify JD",
    })
    .returning({ id: jobDescriptions.id, templateName: jobDescriptions.templateName });
  check(
    "job_descriptions lineage columns",
    Boolean(jdRow?.id && jdRow.templateName === "Verify default"),
  );

  // 5c. requisition delete → benchmark.requisition_id set null
  await db.delete(requisitions).where(eq(requisitions.id, req!.id));
  const [orphanBench] = await db
    .select({ requisitionId: salaryBenchmarks.requisitionId })
    .from(salaryBenchmarks)
    .where(eq(salaryBenchmarks.id, bench!.id))
    .limit(1);
  check("FK set null on requisition delete", orphanBench?.requisitionId === null);

  // Swap the default: clear tpl1, set tpl2 — the partial unique index must hold.
  await db
    .update(contentTemplates)
    .set({ isDefault: false })
    .where(eq(contentTemplates.id, tpl1!.id));
  await db
    .update(contentTemplates)
    .set({ isDefault: true })
    .where(eq(contentTemplates.id, tpl2!.id));
  let secondDefaultRejected = false;
  try {
    await db
      .update(contentTemplates)
      .set({ isDefault: true })
      .where(eq(contentTemplates.id, tpl1!.id));
  } catch {
    secondDefaultRejected = true;
  }
  check("content_templates single default per (org,kind)", secondDefaultRejected);

  // 5e. content_templates source archive columns
  const [tplSrc] = await db
    .update(contentTemplates)
    .set({ sourcePath: `${org1!.id}/branding/source-x.pdf`, sourceName: "brand.pdf" })
    .where(eq(contentTemplates.id, tpl1!.id))
    .returning({ sourceName: contentTemplates.sourceName });
  check("content_templates source columns", tplSrc?.sourceName === "brand.pdf");

  // 6. cascade: deleting the user removes membership + role rows
  await db.delete(users).where(eq(users.id, user!.id));
  const [orphanMember] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, org1!.id), eq(orgMembers.userId, user!.id)))
    .limit(1);
  const orphanRoles = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.userId, user!.id));
  check("FK cascade on user delete", !orphanMember && orphanRoles.length === 0);

  // 7. cleanup org (cascades members)
  await db.delete(organizations).where(eq(organizations.id, org1!.id));
  const remainingMembers = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, org1!.id));
  const remainingBenchmarks = await db
    .select({ id: salaryBenchmarks.id })
    .from(salaryBenchmarks)
    .where(eq(salaryBenchmarks.orgId, org1!.id));
  const remainingTemplates = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.orgId, org1!.id));
  check(
    "FK cascade on org delete",
    remainingMembers.length === 0 &&
      remainingBenchmarks.length === 0 &&
      remainingTemplates.length === 0,
  );
} catch (e) {
  failures += 1;
  console.error("UNEXPECTED ERROR:", e);
} finally {
  await sql.end();
}

console.log(failures === 0 ? "\nALL RUNTIME DB CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

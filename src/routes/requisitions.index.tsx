import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  addMasterItem,
  applicationsQuery,
  byKind,
  departmentsQuery,
  masterItemsQuery,
  requisitionsQuery,
} from "@/lib/data";
import { EmptyState, PageHeader, SkillPills, StatusBadge, inr } from "@/components/ats";
import { CreatableSelect, MasterSelect, TokenPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/requisitions/")({
  head: () => ({
    meta: [
      { title: "Manpower Requisitions & JD Library — ATS" },
      {
        name: "description",
        content:
          "Raise manpower requisitions against budgeted headcount, route them through approvals and generate AI-assisted job descriptions.",
      },
      { property: "og:title", content: "Manpower Requisitions & JD Library" },
      {
        property: "og:description",
        content: "Budget-aware requisitions with DH/HR/CBO approval trail and AI-drafted job descriptions.",
      },
    ],
  }),
  component: Requisitions,
});

function Requisitions() {
  const qc = useQueryClient();
  const reqs = useQuery(requisitionsQuery);
  const depts = useQuery(departmentsQuery);
  const apps = useQuery(applicationsQuery);
  const masters = useQuery(masterItemsQuery);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    department_id: "",
    location: "",
    openings: "1",
    experience_min: "3",
    experience_max: "6",
    budget_ctc: "1800000",
    hiring_manager: "",
    must: [] as string[],
    good: [] as string[],
    responsibilities: "",
    education_requirement: "",
  });

  const requisitions = reqs.data ?? [];
  const departments = depts.data ?? [];
  const skills = byKind(masters.data, "skill");
  const locations = byKind(masters.data, "location");
  const education = byKind(masters.data, "education");

  async function createSkill(name: string) {
    try {
      await addMasterItem("skill", name);
      qc.invalidateQueries({ queryKey: ["master_items"] });
    } catch {
      /* already in the library — the value is still selected */
    }
  }

  async function create() {
    if (!form.title.trim()) {
      toast.error("Role title is required");
      return;
    }
    setSaving(true);
    const code = `REQ-${new Date().getFullYear()}-${String(requisitions.length + 1).padStart(3, "0")}`;
    const { error } = await supabase.from("requisitions").insert({
      code,
      title: form.title,
      department_id: form.department_id || null,
      location: form.location,
      openings: Number(form.openings) || 1,
      experience_min: Number(form.experience_min) || 0,
      experience_max: Number(form.experience_max) || 0,
      budget_ctc: Number(form.budget_ctc) || 0,
      hiring_manager: form.hiring_manager || null,
      must_have_skills: form.must,
      good_to_have_skills: form.good,
      responsibilities: form.responsibilities || null,
      education_requirement: form.education_requirement || null,
      status: "pending_dh",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${code} raised and sent for Department Head approval`);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["requisitions"] });
  }

  return (
    <>
      <PageHeader
        eyebrow="Sourcing"
        title="Manpower requisitions"
        description="Every requisition is checked against budgeted headcount and routed through DH → HR → CBO approvals before sourcing starts."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Raise requisition</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Raise a manpower requisition</DialogTitle>
                <DialogDescription>
                  Skills entered here drive the JD draft and the JD↔CV match scoring.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role title" className="sm:col-span-2">
                  <CreatableSelect
                    options={roleTitles}
                    value={form.title}
                    onChange={(v) => setForm({ ...form, title: v })}
                    onCreate={createRoleTitle}
                    placeholder="Search role titles, or type a new one"
                  />
                </Field>
                <Field label="Department">
                  <CreatableSelect
                    options={departments.map((d) => ({ id: d.id, name: d.name }))}
                    value={departments.find((d) => d.id === form.department_id)?.name ?? ""}
                    onChange={(name) =>
                      setForm({ ...form, department_id: departments.find((d) => d.name === name)?.id ?? "" })
                    }
                    onCreate={createDepartment}
                    placeholder="Search departments, or type a new one"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    New departments start with zero budget — set headcount and cost below.
                  </p>
                </Field>

                <Field label="Location">
                  <MasterSelect
                    options={locations}
                    value={form.location}
                    onChange={(v) => setForm({ ...form, location: v })}
                    placeholder="Select location"
                  />
                </Field>
                <Field label="Openings">
                  <Input
                    type="number"
                    value={form.openings}
                    onChange={(e) => setForm({ ...form, openings: e.target.value })}
                  />
                </Field>
                <Field label="Budget CTC (₹)">
                  <Input
                    type="number"
                    value={form.budget_ctc}
                    onChange={(e) => setForm({ ...form, budget_ctc: e.target.value })}
                  />
                </Field>
                <Field label="Experience min (yrs)">
                  <Input
                    type="number"
                    value={form.experience_min}
                    onChange={(e) => setForm({ ...form, experience_min: e.target.value })}
                  />
                </Field>
                <Field label="Experience max (yrs)">
                  <Input
                    type="number"
                    value={form.experience_max}
                    onChange={(e) => setForm({ ...form, experience_max: e.target.value })}
                  />
                </Field>
                <Field label="Hiring manager" className="sm:col-span-2">
                  <Input
                    value={form.hiring_manager}
                    onChange={(e) => setForm({ ...form, hiring_manager: e.target.value })}
                  />
                </Field>
                <Field label="Must-have skills" className="sm:col-span-2">
                  <TokenPicker
                    options={skills}
                    value={form.must}
                    onChange={(v) => setForm({ ...form, must: v })}
                    onCreate={createSkill}
                    placeholder="Search the skills library…"
                  />
                </Field>
                <Field label="Good-to-have skills" className="sm:col-span-2">
                  <TokenPicker
                    options={skills}
                    value={form.good}
                    onChange={(v) => setForm({ ...form, good: v })}
                    onCreate={createSkill}
                    placeholder="Search the skills library…"
                  />
                </Field>
                <Field label="Education requirement" className="sm:col-span-2">
                  <MasterSelect
                    options={education}
                    value={form.education_requirement}
                    onChange={(v) => setForm({ ...form, education_requirement: v })}
                    placeholder="Select minimum qualification"
                  />
                </Field>
                <Field label="Key responsibilities" className="sm:col-span-2">
                  <Textarea
                    rows={4}
                    value={form.responsibilities}
                    onChange={(e) => setForm({ ...form, responsibilities: e.target.value })}
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={saving}>
                  {saving ? "Raising…" : "Raise & send for approval"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <DepartmentBudgets />

      {requisitions.length === 0 ? (
        <EmptyState title="No requisitions yet" hint="Raise your first requisition to start sourcing." />

      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requisitions.map((r) => {
            const dept = departments.find((d) => d.id === r.department_id);
            const count = (apps.data ?? []).filter((a) => a.requisition_id === r.id).length;
            return (
              <Link
                key={r.id}
                to="/requisitions/$id"
                params={{ id: r.id }}
                className="panel block p-5 transition-colors hover:border-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="num text-xs text-muted-foreground">{r.code}</div>
                    <h3 className="mt-1 text-lg font-semibold">{r.title}</h3>
                    <div className="text-sm text-muted-foreground">
                      {dept?.name ?? "Unassigned"} · {r.location}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <dl className="num mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Openings</dt>
                    <dd className="font-semibold">{r.openings}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Experience</dt>
                    <dd className="font-semibold">
                      {r.experience_min}–{r.experience_max} yrs
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Budget</dt>
                    <dd className="font-semibold">{inr(Number(r.budget_ctc))}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <SkillPills skills={r.must_have_skills.slice(0, 6)} />
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Weights — skills {r.weight_skills} · exp {r.weight_experience} · edu {r.weight_education} ·
                    social {r.weight_social}
                  </span>
                  <span className="num">{count} applicants</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function DepartmentBudgets() {
  const qc = useQueryClient();
  const depts = useQuery(departmentsQuery);
  const [form, setForm] = useState({ name: "", head_name: "", budgeted_headcount: "", budgeted_cost: "" });
  const [saving, setSaving] = useState(false);
  const departments = depts.data ?? [];

  async function addDept() {
    if (!form.name.trim()) {
      toast.error("Department name is required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("departments").insert({
      name: form.name.trim(),
      head_name: form.head_name.trim() || null,
      budgeted_headcount: Number(form.budgeted_headcount) || 0,
      budgeted_cost: Number(form.budgeted_cost) || 0,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${form.name.trim()} added to workforce plan`);
    setForm({ name: "", head_name: "", budgeted_headcount: "", budgeted_cost: "" });
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  return (
    <section className="panel mb-6 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Departments & budgeted headcount</h2>
        <p className="text-xs text-muted-foreground">
          Requisitions are checked against these budgets. Add your real departments before raising requisitions.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <Field label="Department" className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Engineering"
          />
        </Field>
        <Field label="Department head">
          <Input value={form.head_name} onChange={(e) => setForm({ ...form, head_name: e.target.value })} />
        </Field>
        <Field label="Budgeted headcount">
          <Input
            inputMode="numeric"
            value={form.budgeted_headcount}
            onChange={(e) => setForm({ ...form, budgeted_headcount: e.target.value })}
          />
        </Field>
        <Field label="Budgeted cost (₹)">
          <Input
            inputMode="numeric"
            value={form.budgeted_cost}
            onChange={(e) => setForm({ ...form, budgeted_cost: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={addDept} disabled={saving}>
          {saving ? "Adding…" : "Add department"}
        </Button>
      </div>

      {departments.length > 0 && (
        <ul className="mt-4 divide-y border-t text-sm">
          {departments.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{d.name}</span>
              <span className="num text-xs text-muted-foreground">
                {d.head_name ?? "No head assigned"} · {d.budgeted_headcount} roles ·{" "}
                {inr(Number(d.budgeted_cost))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Field({

  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

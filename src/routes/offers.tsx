import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  applicationsQuery,
  candidatesQuery,
  offersQuery,
  requisitionsQuery,
} from "@/lib/data";
import { EmptyState, PageHeader, StatusBadge, inr } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Offers & Approvals — ATS" },
      {
        name: "description",
        content:
          "Raise offers against the requisition budget, route them through HR and CBO approval and track acceptance to joining.",
      },
      { property: "og:title", content: "Offers & Approvals" },
      {
        property: "og:description",
        content: "Budget-checked offer creation with HR/CBO approval trail and acceptance tracking.",
      },
    ],
  }),
  component: Offers,
});

/** Offer approval chain, and the candidate stage each step implies. */
const FLOW: Record<string, { next: string; label: string; stage?: string }> = {
  draft: { next: "pending_hr", label: "Send to HR" },
  pending_hr: { next: "pending_cbo", label: "HR approve" },
  pending_cbo: { next: "approved", label: "CBO approve" },
  approved: { next: "released", label: "Release offer", stage: "offer_released" },
  released: { next: "accepted", label: "Mark accepted", stage: "offer_accepted" },
};

/** A candidate is offer-ready once the final round is cleared or HR pushed them to offer. */
const OFFER_READY = ["l3", "offer", "offer_pending"];

function Offers() {
  const qc = useQueryClient();
  const offers = useQuery(offersQuery);
  const apps = useQuery(applicationsQuery);
  const cands = useQuery(candidatesQuery);
  const reqs = useQuery(requisitionsQuery);

  const [appId, setAppId] = useState("");
  const [ctc, setCtc] = useState("");
  const [joining, setJoining] = useState("");

  const raisedFor = new Set((offers.data ?? []).map((o) => o.application_id));
  const offerStage = (apps.data ?? []).filter((a) => OFFER_READY.includes(a.stage) && !raisedFor.has(a.id));

  async function create() {
    if (!appId || !ctc) {
      toast.error("Pick a candidate and enter the offered CTC");
      return;
    }
    const app = (apps.data ?? []).find((a) => a.id === appId);
    const req = (reqs.data ?? []).find((r) => r.id === app?.requisition_id);
    if (req && Number(ctc) > Number(req.budget_ctc)) {
      toast.warning("Offered CTC exceeds the approved requisition budget — CBO approval will be mandatory");
    }
    const { error } = await supabase.from("offers").insert({
      application_id: appId,
      offered_ctc: Number(ctc),
      joining_date: joining || null,
      status: "pending_hr",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    // Raising the offer is what puts the candidate in "offer pending approval".
    await supabase.from("applications").update({ stage: "offer_pending" }).eq("id", appId);
    setAppId("");
    setCtc("");
    setJoining("");
    toast.success("Offer raised and sent for HR approval");
    qc.invalidateQueries({ queryKey: ["offers"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  }

  async function advance(id: string, status: string, trail: unknown) {
    const step = FLOW[status];
    if (!step) return;
    const next = [
      ...(Array.isArray(trail) ? (trail as unknown[]) : []),
      { from: status, to: step.next, at: new Date().toISOString() },
    ];
    const { error } = await supabase
      .from("offers")
      .update({ status: step.next as never, approval_trail: next as never })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (step.stage) {
      const offer = (offers.data ?? []).find((o) => o.id === id);
      if (offer)
        await supabase.from("applications").update({ stage: step.stage as never }).eq("id", offer.application_id);
    }
    toast.success(`Offer moved to ${step.next.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["offers"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  }


  return (
    <>
      <PageHeader
        eyebrow="Closure"
        title="Offers"
        description="Offers are validated against the approved requisition budget before HR and CBO sign-off."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Offer register</h2>
          </div>
          {(offers.data ?? []).length === 0 ? (
            <div className="p-5">
              <EmptyState title="No offers yet" hint="Candidates reach this stage after an L3 select verdict." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(offers.data ?? []).map((o) => {
                const app = (apps.data ?? []).find((a) => a.id === o.application_id);
                const c = (cands.data ?? []).find((x) => x.id === app?.candidate_id);
                const r = (reqs.data ?? []).find((x) => x.id === app?.requisition_id);
                const step = FLOW[o.status];
                const overBudget = r ? Number(o.offered_ctc) > Number(r.budget_ctc) : false;
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-4 p-5">
                    <div className="min-w-0 flex-1">
                      {app ? (
                        <Link
                          to="/candidates/$id"
                          params={{ id: app.candidate_id }}
                          className="font-medium hover:underline"
                        >
                          {c?.full_name}
                        </Link>
                      ) : (
                        <span className="font-medium">Unknown candidate</span>
                      )}
                      <div className="text-xs text-muted-foreground">{r?.title}</div>
                      <div className="num mt-1 text-sm">
                        {inr(Number(o.offered_ctc))}
                        {overBudget ? (
                          <span className="ml-2 text-xs text-destructive">above requisition budget</span>
                        ) : null}
                        {o.joining_date ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            joins {new Date(o.joining_date).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <StatusBadge status={o.status} />
                    {step ? (
                      <Button size="sm" onClick={() => advance(o.id, o.status, o.approval_trail)}>
                        {step.label}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-semibold">Raise an offer</h2>
          <div className="mt-4 space-y-4">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Candidate at offer stage</Label>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select candidate" />
                </SelectTrigger>
                <SelectContent>
                  {offerStage.map((a) => {
                    const c = (cands.data ?? []).find((x) => x.id === a.candidate_id);
                    return (
                      <SelectItem key={a.id} value={a.id}>
                        {c?.full_name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {offerStage.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No candidate has cleared L3 yet — record a select verdict on the interviews page.
                </p>
              ) : null}
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Offered CTC (₹)</Label>
              <Input type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Joining date</Label>
              <Input type="date" value={joining} onChange={(e) => setJoining(e.target.value)} />
            </div>
            <Button className="w-full" onClick={create}>
              Raise offer
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

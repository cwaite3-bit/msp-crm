"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createSla, updateSla, deleteSla, type SlaInput } from "@/server/actions/slas";
import { HelpTip, LabelWithHelp } from "@/components/help-tip";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import type { slas } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Sla = InferSelectModel<typeof slas>;

const NEW_SLA_DEFAULTS: SlaInput = {
  name: "New SLA",
  description: "",
  isDefault: false,
  coverageHours: "Business Hours",
  criticalResponseMinutes: 30,
  highResponseMinutes: 60,
  mediumResponseMinutes: 240,
  lowResponseMinutes: 480,
  criticalResolutionHours: 4,
  highResolutionHours: 8,
  mediumResolutionHours: 24,
  lowResolutionHours: 40,
  uptimeGuaranteePct: 99.5,
  escalationProcess: "",
  exclusions: "",
};

function toInput(row: Sla): SlaInput {
  return {
    name: row.name,
    description: row.description ?? "",
    isDefault: row.isDefault,
    coverageHours: row.coverageHours,
    criticalResponseMinutes: row.criticalResponseMinutes,
    highResponseMinutes: row.highResponseMinutes,
    mediumResponseMinutes: row.mediumResponseMinutes,
    lowResponseMinutes: row.lowResponseMinutes,
    criticalResolutionHours: row.criticalResolutionHours,
    highResolutionHours: row.highResolutionHours,
    mediumResolutionHours: row.mediumResolutionHours,
    lowResolutionHours: row.lowResolutionHours,
    uptimeGuaranteePct: Number(row.uptimeGuaranteePct),
    escalationProcess: row.escalationProcess ?? "",
    exclusions: row.exclusions ?? "",
  };
}

function NumField({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs text-slate-500">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <Input type="number" min={0} className="h-8" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </div>
  );
}

function SlaCard({ sla, onSaved, onDeleted }: { sla: Sla; onSaved: () => void; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<SlaInput>(toInput(sla));

  function set<K extends keyof SlaInput>(key: K, value: SlaInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      await updateSla(sla.id, form);
      onSaved();
      toast.success(`Saved "${form.name}"`);
    });
  }

  function remove() {
    if (!confirm(`Delete the "${sla.name}" SLA? Any quote currently using it will fall back to no SLA attached. This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteSla(sla.id);
      onDeleted();
      toast.success("SLA deleted");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Input className="h-8 max-w-sm font-medium" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <Textarea
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Short description shown to staff when choosing an SLA for a quote"
            rows={1}
            className="max-w-lg text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          {sla.isDefault && <Badge variant="secondary">Default</Badge>}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={Boolean(form.isDefault)} onChange={(e) => set("isDefault", e.target.checked)} />
        Default SLA for new quotes
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          Coverage hours
          <HelpTip text="When support is available at this SLA — e.g. 'Business Hours', 'Business Hours + Emergency', or '24x7x365'. Free text so you can word it however you like." />
        </span>
        <Input className="h-8" value={form.coverageHours} onChange={(e) => set("coverageHours", e.target.value)} />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          <LabelWithHelp
            label="Response & resolution targets"
            help="Response time = how long before a technician acknowledges the ticket. Resolution time = the target to have it fixed. Both are shown to the customer and referenced in the MSA."
          />
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField label="Critical response (min)" value={form.criticalResponseMinutes} onChange={(v) => set("criticalResponseMinutes", v)} />
          <NumField label="High response (min)" value={form.highResponseMinutes} onChange={(v) => set("highResponseMinutes", v)} />
          <NumField label="Medium response (min)" value={form.mediumResponseMinutes} onChange={(v) => set("mediumResponseMinutes", v)} />
          <NumField label="Low response (min)" value={form.lowResponseMinutes} onChange={(v) => set("lowResponseMinutes", v)} />
          <NumField label="Critical resolution (hrs)" value={form.criticalResolutionHours} onChange={(v) => set("criticalResolutionHours", v)} />
          <NumField label="High resolution (hrs)" value={form.highResolutionHours} onChange={(v) => set("highResolutionHours", v)} />
          <NumField label="Medium resolution (hrs)" value={form.mediumResolutionHours} onChange={(v) => set("mediumResolutionHours", v)} />
          <NumField label="Low resolution (hrs)" value={form.lowResolutionHours} onChange={(v) => set("lowResolutionHours", v)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          Uptime guarantee (%)
          <HelpTip text="Only meaningful for infrastructure fully under your direct control (e.g. a managed firewall or server). Don't guarantee uptime for third-party cloud services outside your control." />
        </span>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.01"
          className="h-8"
          value={form.uptimeGuaranteePct}
          onChange={(e) => set("uptimeGuaranteePct", Math.max(0, Number(e.target.value) || 0))}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          Escalation process
          <HelpTip text="What happens if a ticket isn't resolved in time — who it escalates to and when. Shown in the MSA." />
        </span>
        <Textarea value={form.escalationProcess ?? ""} onChange={(e) => set("escalationProcess", e.target.value)} rows={2} className="text-xs" />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          Exclusions
          <HelpTip text="What these targets don't cover — e.g. third-party vendor outages, client-caused delays. Shown in the MSA." />
        </span>
        <Textarea value={form.exclusions ?? ""} onChange={(e) => set("exclusions", e.target.value)} rows={2} className="text-xs" />
      </div>

      <Button size="sm" className="w-fit" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save SLA"}
      </Button>
    </div>
  );
}

export function SlaPanel({ slas: initial }: { slas: Sla[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  function refresh() {
    router.refresh();
  }

  function addSla() {
    setCreating(true);
    startTransition(async () => {
      await createSla(NEW_SLA_DEFAULTS);
      setCreating(false);
      router.refresh();
      toast.success("New SLA added — edit it below");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Create as many SLAs as you need (e.g. a standard business-hours tier and a faster 24x7 tier) and attach one to
        each quote from that quote&rsquo;s settings — independent of the Bronze/Silver/Gold service plan. The attached
        SLA&rsquo;s targets are shown to the customer on the proposal and summarized in the Master Service Agreement.
      </p>

      <div className="flex flex-col gap-4">
        {initial
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((sla) => (
            <SlaCard key={sla.id} sla={sla} onSaved={refresh} onDeleted={refresh} />
          ))}
      </div>

      {initial.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
          No SLAs yet.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addSla} disabled={pending || creating}>
        <Plus className="h-4 w-4" /> Add SLA
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateAddOns } from "@/server/actions/quotes";
import { toast } from "sonner";
import { EMPTY_ADD_ONS, type AddOnSelections, type BackupProfile, type M365Selection } from "@/server/pricing-rules";
import { formatCurrency } from "@/lib/utils";
import type { M365Plan } from "@/server/pricing-data";
import { Trash2 } from "lucide-react";
import { HelpTip } from "@/components/help-tip";

const BACKUP_PROFILES: BackupProfile[] = ["None", "Endpoint Backup", "Server Backup", "Managed Backup", "Managed BCDR"];

function YesNoSelect({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Select value={value ? "Yes" : "No"} onValueChange={(v) => onChange(v === "Yes")}>
      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="No">No</SelectItem>
        <SelectItem value="Yes">Yes</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function AddOnsForm({
  quoteId,
  addOns: initialAddOns,
  m365Plans,
  totalUsers,
}: {
  quoteId: string;
  addOns: Partial<AddOnSelections> | null;
  // All plans from Settings → Microsoft 365 plans (active and inactive), for
  // the plan picker below. Inactive plans are hidden from the "add a plan"
  // choices but still resolve by id, so a quote already pointing at a
  // retired plan (see activePlans filtering below) keeps rendering correctly.
  m365Plans: M365Plan[];
  // Total headcount from Discovery, shown as a sanity-check hint next to
  // the M365 seat total — M365 seats don't have to match total users (not
  // everyone needs a mailbox license), but a mismatch is worth a glance.
  totalUsers: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOns, setAddOns] = useState<AddOnSelections>({ ...EMPTY_ADD_ONS, ...initialAddOns });

  const activePlans = [...m365Plans].filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);

  function num(key: keyof AddOnSelections, value: string) {
    setAddOns((prev) => ({ ...prev, [key]: Math.max(0, Number(value) || 0) }));
  }

  function setM365Selections(next: M365Selection[]) {
    setAddOns((prev) => ({ ...prev, m365Selections: next }));
  }

  function addM365Row() {
    const usedIds = new Set(addOns.m365Selections.map((s) => s.planId));
    const nextPlan = activePlans.find((p) => !usedIds.has(p.id)) ?? activePlans[0];
    if (!nextPlan) return; // no plans configured at all — nothing to add
    setM365Selections([...addOns.m365Selections, { planId: nextPlan.id, seats: 0 }]);
  }

  function updateM365Row(index: number, patch: Partial<M365Selection>) {
    setM365Selections(addOns.m365Selections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeM365Row(index: number) {
    setM365Selections(addOns.m365Selections.filter((_, i) => i !== index));
  }

  const m365TotalSeats = addOns.m365Selections.reduce((sum, s) => sum + (Number(s.seats) || 0), 0);
  const m365TotalMonthly = addOns.m365Selections.reduce((sum, s) => {
    const plan = m365Plans.find((p) => p.id === s.planId);
    return sum + (plan ? (Number(s.seats) || 0) * plan.sell : 0);
  }, 0);

  function save() {
    startTransition(async () => {
      await updateAddOns(quoteId, addOns);
      router.refresh();
      toast.success("Add-ons saved");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-xs">
            vCIO / strategic planning
            <HelpTip text="Included hours of executive-level IT planning/guidance per month. Hours used beyond this allowance bill at the additional vCIO rate on the rate card." />
          </Label>
          <YesNoSelect value={addOns.vcioEnabled} onChange={(v) => setAddOns((a) => ({ ...a, vcioEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Hours / month</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.vcioHoursPerMonth}
            onChange={(e) => num("vcioHoursPerMonth", e.target.value)} disabled={!addOns.vcioEnabled} />
        </div>
        <div />
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-xs">
            Backup / disaster recovery profile
            <HelpTip text="Endpoint/Server Backup covers file-level backup of that asset type. Managed Backup/BCDR add faster recovery objectives and a base platform fee — see the rate card for what each includes." />
          </Label>
          <Select value={addOns.backupProfile} onValueChange={(v) => setAddOns((a) => ({ ...a, backupProfile: v as BackupProfile }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{BACKUP_PROFILES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Protected workstations</Label>
          <Input type="number" min={0} className="h-8 w-28" value={addOns.protectedWorkstations}
            onChange={(e) => num("protectedWorkstations", e.target.value)} disabled={addOns.backupProfile === "None" || addOns.backupProfile === "Server Backup"} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Protected servers</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.protectedServers}
            onChange={(e) => num("protectedServers", e.target.value)} disabled={addOns.backupProfile === "None" || addOns.backupProfile === "Endpoint Backup"} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Advanced email security</Label>
          <YesNoSelect value={addOns.emailSecurityEnabled} onChange={(v) => setAddOns((a) => ({ ...a, emailSecurityEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Seats</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.emailSecuritySeats}
            onChange={(e) => num("emailSecuritySeats", e.target.value)} disabled={!addOns.emailSecurityEnabled} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Security awareness training</Label>
          <YesNoSelect value={addOns.trainingEnabled} onChange={(v) => setAddOns((a) => ({ ...a, trainingEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Seats</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.trainingSeats}
            onChange={(e) => num("trainingSeats", e.target.value)} disabled={!addOns.trainingEnabled} />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1 text-xs">
            Microsoft 365 licensing (per plan)
            <HelpTip text="Ask how many total users vs. how many need an M365 mailbox/license, then pick a specific plan per group — you can mix e.g. 8 Business Basic + 4 Business Premium seats. Manage plan pricing at Settings → Microsoft 365 plans." />
          </Label>
          {totalUsers > 0 && (
            <span className="text-xs text-slate-400">
              {m365TotalSeats} of {totalUsers} total user{totalUsers === 1 ? "" : "s"} licensed
              {m365TotalSeats > totalUsers ? " — more M365 seats than total users, double-check" : ""}
            </span>
          )}
        </div>

        {addOns.m365Selections.length === 0 && (
          <p className="text-xs text-slate-400">No Microsoft 365 plans selected.</p>
        )}

        {addOns.m365Selections.map((selection, index) => {
          const plan = m365Plans.find((p) => p.id === selection.planId);
          const lineTotal = plan ? (Number(selection.seats) || 0) * plan.sell : 0;
          return (
            <div key={index} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
              <div className="flex flex-col gap-1.5">
                {index === 0 && <Label className="text-xs">Plan</Label>}
                <Select value={selection.planId} onValueChange={(v) => updateM365Row(index, { planId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {formatCurrency(p.sell)}/seat
                      </SelectItem>
                    ))}
                    {/* If this row points at a plan no longer in the active
                        list (retired/inactive, e.g. the legacy migration
                        placeholder), still show it so the row doesn't go
                        blank — but it's not offered for a fresh selection. */}
                    {plan && !activePlans.some((p) => p.id === plan.id) && (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name} — {formatCurrency(plan.sell)}/seat (inactive)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                {index === 0 && <Label className="text-xs">Seats</Label>}
                <Input
                  type="number"
                  min={0}
                  className="h-8 w-20"
                  value={selection.seats}
                  onChange={(e) => updateM365Row(index, { seats: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-right">
                {index === 0 && <Label className="text-xs">Monthly</Label>}
                <span className="h-8 px-1 text-sm leading-8 text-slate-600">{formatCurrency(lineTotal)}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-600"
                onClick={() => removeM365Row(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-1">
          <Button type="button" variant="outline" size="sm" onClick={addM365Row} disabled={activePlans.length === 0}>
            + Add Microsoft 365 plan
          </Button>
          {m365TotalSeats > 0 && (
            <span className="text-sm font-medium text-slate-700">
              {m365TotalSeats} seat{m365TotalSeats === 1 ? "" : "s"} · {formatCurrency(m365TotalMonthly)}/mo
            </span>
          )}
        </div>
        {activePlans.length === 0 && (
          <p className="text-xs text-amber-600">
            No active Microsoft 365 plans are configured. Add pricing at Settings → Microsoft 365 plans.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Included onsite hours / month</Label>
        <Input type="number" min={0} className="h-8 w-24" value={addOns.includedOnsiteHoursPerMonth}
          onChange={(e) => num("includedOnsiteHoursPerMonth", e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Additional monthly add-on (sell)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.customMonthlyAddOnSell}
            onChange={(e) => num("customMonthlyAddOnSell", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Estimated direct cost (internal)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.customMonthlyAddOnCost}
            onChange={(e) => num("customMonthlyAddOnCost", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">One-time project / remediation (sell)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.oneTimeProjectSell}
            onChange={(e) => num("oneTimeProjectSell", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Estimated direct cost of project (internal)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.oneTimeProjectCost}
            onChange={(e) => num("oneTimeProjectCost", e.target.value)} />
        </div>
      </div>

      <Button onClick={save} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save add-ons"}
      </Button>
    </div>
  );
}

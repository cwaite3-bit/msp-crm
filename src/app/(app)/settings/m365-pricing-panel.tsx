"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { updateM365Plans, resetM365PlansToDefault } from "@/server/actions/settings";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import {
  M365_PLAN_CATEGORIES,
  M365_CATEGORY_LABELS,
  type M365Plan,
  type M365PlanCategory,
} from "@/server/pricing-data";

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="h-8 w-24"
    />
  );
}

export function M365PricingPanel({ plans: initial }: { plans: M365Plan[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plans, setPlans] = useState<M365Plan[]>([...initial].sort((a, b) => a.sortOrder - b.sortOrder));

  function setField<K extends keyof M365Plan>(id: string, field: K, value: M365Plan[K]) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  function addPlan() {
    const id = `plan-${Date.now()}`;
    setPlans((prev) => [
      ...prev,
      { id, name: "New plan", category: "core", sell: 0, cost: 0, sortOrder: prev.length, active: true },
    ]);
  }

  function removePlan(id: string) {
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  function save() {
    startTransition(async () => {
      // Re-normalize sortOrder to match on-screen order before saving.
      const ordered = plans.map((p, i) => ({ ...p, sortOrder: i }));
      await updateM365Plans(ordered);
      setPlans(ordered);
      router.refresh();
      toast.success("Microsoft 365 plan pricing saved");
    });
  }

  function reset() {
    startTransition(async () => {
      const defaults = await resetM365PlansToDefault();
      setPlans([...defaults].sort((a, b) => a.sortOrder - b.sortOrder));
      router.refresh();
      toast.success("Reset to Microsoft's published pricing");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        Per-seat pricing for Microsoft 365 / security / identity plans. Quotes reference these by plan so staff
        can mix, e.g., Business Basic seats with Business Premium seats and price each correctly — see the
        &ldquo;Microsoft 365 licensing&rdquo; section on a quote&rsquo;s Optional services &amp; add-ons.
        Inactive plans stay priced for any quote already using them but are hidden from new selections.
      </p>

      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Plan</TableHead>
              <TableHead className="w-36">Category</TableHead>
              <TableHead className="w-28">Sell ($/seat/mo)</TableHead>
              <TableHead className="w-28">Cost ($/seat/mo, internal)</TableHead>
              <TableHead className="w-16">Active</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <Input
                    className="h-8"
                    value={plan.name}
                    onChange={(e) => setField(plan.id, "name", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={plan.category}
                    onValueChange={(v) => setField(plan.id, "category", v as M365PlanCategory)}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {M365_PLAN_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{M365_CATEGORY_LABELS[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <NumInput value={plan.sell} onChange={(v) => setField(plan.id, "sell", v)} />
                </TableCell>
                <TableCell>
                  <NumInput value={plan.cost} onChange={(v) => setField(plan.id, "cost", v)} />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={plan.active}
                    onCheckedChange={(checked) => setField(plan.id, "active", checked === true)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                    onClick={() => removePlan(plan.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Below md: one card per plan instead of a cramped wide table. */}
      <div className="flex flex-col gap-3 md:hidden">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <Input
                className="h-8"
                value={plan.name}
                onChange={(e) => setField(plan.id, "name", e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-red-600"
                onClick={() => removePlan(plan.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Category</span>
                <Select value={plan.category} onValueChange={(v) => setField(plan.id, "category", v as M365PlanCategory)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {M365_PLAN_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{M365_CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 self-end">
                <Checkbox checked={plan.active} onCheckedChange={(checked) => setField(plan.id, "active", checked === true)} />
                <span className="text-xs text-slate-500">Active</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Sell ($/seat/mo)</span>
                <NumInput value={plan.sell} onChange={(v) => setField(plan.id, "sell", v)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Cost ($/seat/mo)</span>
                <NumInput value={plan.cost} onChange={(v) => setField(plan.id, "cost", v)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addPlan}>
        <Plus className="h-4 w-4" /> Add plan
      </Button>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save Microsoft 365 plans"}</Button>
        <Button variant="outline" onClick={reset} disabled={pending}>Reset to Microsoft&rsquo;s published pricing</Button>
      </div>
    </div>
  );
}

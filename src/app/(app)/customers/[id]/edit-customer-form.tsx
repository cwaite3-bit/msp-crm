"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateCustomer } from "@/server/actions/customers";
import { toast } from "sonner";
import type { customers } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { PROSPECT_STAGES, STAGE_LABELS, type ProspectStage } from "@/lib/prospect";

type Customer = InferSelectModel<typeof customers>;

// yyyy-mm-dd, what <input type="date"> wants for its defaultValue.
function toDateInputValue(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function EditCustomerForm({ customer }: { customer: Customer }) {
  const [status, setStatus] = useState(customer.status);
  const [stage, setStage] = useState<ProspectStage>((customer.stage as ProspectStage) || "NEW");
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    formData.set("status", status);
    if (status === "PROSPECT") formData.set("stage", stage);
    startTransition(async () => {
      await updateCustomer(customer.id, formData);
      toast.success("Customer updated");
    });
  }

  return (
    <form action={onSubmit} className="grid grid-cols-2 gap-4">
      <div className="col-span-2 flex flex-col gap-1.5">
        <Label htmlFor="name">Company name</Label>
        <Input id="name" name="name" defaultValue={customer.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as Customer["status"])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LEAD">Lead</SelectItem>
            <SelectItem value="PROSPECT">Prospect</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="FORMER">Former</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source">Lead source</Label>
        <Input id="source" name="source" defaultValue={customer.source ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="industry">Industry</Label>
        <Input id="industry" name="industry" defaultValue={customer.industry ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="employeeCount"># Employees</Label>
        <Input id="employeeCount" name="employeeCount" type="number" min={0} defaultValue={customer.employeeCount ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" defaultValue={customer.phone ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Company email</Label>
        <Input id="email" name="email" type="email" defaultValue={customer.email ?? ""} />
      </div>
      <div className="col-span-2 flex flex-col gap-1.5">
        <Label htmlFor="website">Website</Label>
        <Input id="website" name="website" defaultValue={customer.website ?? ""} />
      </div>

      {status === "PROSPECT" && (
        <div className="col-span-2 rounded-md border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pipeline</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as ProspectStage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROSPECT_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="estimatedMonthlyValue">Est. monthly value</Label>
              <Input
                id="estimatedMonthlyValue"
                name="estimatedMonthlyValue"
                type="number"
                min={0}
                step="0.01"
                defaultValue={customer.estimatedMonthlyValue ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nextFollowUpAt">Next follow-up</Label>
              <Input
                id="nextFollowUpAt"
                name="nextFollowUpAt"
                type="date"
                defaultValue={toDateInputValue(customer.nextFollowUpAt)}
              />
            </div>
            {stage === "LOST" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lostReason">Lost reason</Label>
                <Input id="lostReason" name="lostReason" defaultValue={customer.lostReason ?? ""} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="col-span-2 rounded-md border border-slate-200 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Billing address</p>
        <div className="grid grid-cols-2 gap-3">
          <Input name="billingStreet" placeholder="Street" defaultValue={customer.billingStreet ?? ""} className="col-span-2" />
          <Input name="billingCity" placeholder="City" defaultValue={customer.billingCity ?? ""} />
          <Input name="billingState" placeholder="State" defaultValue={customer.billingState ?? ""} />
          <Input name="billingZip" placeholder="ZIP" defaultValue={customer.billingZip ?? ""} />
        </div>
      </div>

      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

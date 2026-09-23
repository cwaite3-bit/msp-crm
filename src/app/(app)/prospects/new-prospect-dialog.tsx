"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { createCustomer } from "@/server/actions/customers";
import { PROSPECT_STAGES, STAGE_LABELS } from "@/lib/prospect";

// Mirrors NewCustomerDialog (createCustomer is the same action either way —
// a prospect is just a customer row with status=PROSPECT, see the note atop
// the "Prospects" section in customers.ts) but fixes status to PROSPECT and
// swaps in the pipeline fields instead of a status picker.
export function NewProspectDialog() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState("NEW");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button title="New prospect">
          <Plus /> <span className="hidden sm:inline">New prospect</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New prospect</DialogTitle>
          <DialogDescription>Add a sales prospect and its primary contact.</DialogDescription>
        </DialogHeader>
        <form action={createCustomer} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <input type="hidden" name="status" value="PROSPECT" />
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="name">Company name *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stage">Pipeline stage</Label>
              <input type="hidden" name="stage" value={stage} />
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger id="stage">
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
              <Label htmlFor="source">Lead source</Label>
              <Input id="source" name="source" placeholder="Referral, web, cold outreach…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="estimatedMonthlyValue">Est. monthly value</Label>
              <Input id="estimatedMonthlyValue" name="estimatedMonthlyValue" type="number" min={0} step="0.01" placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nextFollowUpAt">Next follow-up</Label>
              <Input id="nextFollowUpAt" name="nextFollowUpAt" type="date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" name="industry" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Company email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="publicEmail">Public email</Label>
              <Input id="publicEmail" name="publicEmail" type="email" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" placeholder="https://" />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Primary contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="contactFirstName" placeholder="First name" />
              <Input name="contactLastName" placeholder="Last name" />
              <Input name="contactTitle" placeholder="Title" />
              <Input name="contactPhone" placeholder="Phone" />
              <Input name="contactEmail" placeholder="Email" type="email" className="col-span-2" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create prospect</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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

export function NewCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("LEAD");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New customer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Add a company and its primary contact.</DialogDescription>
        </DialogHeader>
        <form action={createCustomer} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="name">Company name *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status">Status</Label>
              <input type="hidden" name="status" value={status} />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
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
              <Input id="source" name="source" placeholder="Referral, web, cold outreach…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" name="industry" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="employeeCount"># Employees</Label>
              <Input id="employeeCount" name="employeeCount" type="number" min={0} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Company email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" placeholder="https://" />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Billing address</p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="billingStreet" placeholder="Street" className="col-span-2" />
              <Input name="billingCity" placeholder="City" />
              <Input name="billingState" placeholder="State" />
              <Input name="billingZip" placeholder="ZIP" />
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
            <Button type="submit">Create customer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

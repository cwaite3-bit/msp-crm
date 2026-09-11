"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitCustomerIntake } from "@/server/actions/public-intake";
import { CheckCircle2 } from "lucide-react";

export function IntakeForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitCustomerIntake(formData);
      if (result.ok) {
        setDone(true);
      } else {
        setError(result.error || "Something went wrong — please try again.");
      }
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-[#eaf4fd] px-6 py-10 text-center text-[#024996]">
        <CheckCircle2 className="h-10 w-10" />
        <p className="text-lg font-semibold">Thanks — we&rsquo;ve got it!</p>
        <p className="max-w-sm text-sm text-[#1d5f9e]">
          Your information has been received. Someone from our team will reach out shortly to discuss next steps.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your company</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="companyName">Company name *</Label>
            <Input id="companyName" name="companyName" required />
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
            <Label htmlFor="phone">Company phone</Label>
            <Input id="phone" name="phone" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Company email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="https://" />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Business address</p>
        <div className="grid grid-cols-2 gap-3">
          <Input name="billingStreet" placeholder="Street" className="col-span-2" />
          <Input name="billingCity" placeholder="City" />
          <Input name="billingState" placeholder="State" />
          <Input name="billingZip" placeholder="ZIP" className="col-span-2 sm:col-span-1" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your contact info</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactFirstName">First name *</Label>
            <Input id="contactFirstName" name="contactFirstName" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactLastName">Last name *</Label>
            <Input id="contactLastName" name="contactLastName" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactTitle">Title</Label>
            <Input id="contactTitle" name="contactTitle" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactPhone">Phone</Label>
            <Input id="contactPhone" name="contactPhone" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="contactEmail">Email</Label>
            <Input id="contactEmail" name="contactEmail" type="email" />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">Please provide at least an email or a phone number.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="message">What can we help you with?</Label>
        <Textarea id="message" name="message" rows={3} placeholder="Tell us a little about what you're looking for…" />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Button type="submit" disabled={pending} className="w-fit bg-[#1d98eb] hover:bg-[#1683cc]">
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}

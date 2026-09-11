"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { acceptQuotePublic, rejectQuotePublic } from "@/server/actions/quotes";
import { CheckCircle2, XCircle } from "lucide-react";

export function AcceptRejectPanel({
  token,
  status,
  acceptedByName,
  acceptedAt,
  totalMonthly,
  annualDiscountPct,
  billingFrequency,
}: {
  token: string;
  status: string;
  acceptedByName: string | null;
  acceptedAt: Date | null;
  totalMonthly: string;
  annualDiscountPct: number;
  billingFrequency: "MONTHLY" | "ANNUAL";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "accepting">("idle");
  const [frequency, setFrequency] = useState<"MONTHLY" | "ANNUAL">(billingFrequency);

  const monthlyNum = Number(totalMonthly);
  const annualTotal = monthlyNum * 12 * (1 - annualDiscountPct / 100);
  const hasRecurring = monthlyNum > 0;

  if (status === "ACCEPTED") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-medium">
          Accepted by {acceptedByName} {acceptedAt ? `on ${new Date(acceptedAt).toLocaleDateString()}` : ""}
        </span>
      </div>
    );
  }
  if (status === "REJECTED") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-red-800">
        <XCircle className="h-5 w-5" />
        <span className="text-sm font-medium">This quote was declined.</span>
      </div>
    );
  }

  function accept() {
    if (!name.trim()) return;
    startTransition(async () => {
      await acceptQuotePublic(token, name.trim(), frequency);
      router.refresh();
    });
  }

  function reject() {
    if (!confirm("Decline this quote?")) return;
    startTransition(async () => {
      await rejectQuotePublic(token);
      router.refresh();
    });
  }

  if (mode === "accepting") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        {hasRecurring && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-emerald-900">How would you like to pay for recurring services?</p>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-emerald-200 bg-white p-2.5 text-sm has-[:checked]:border-emerald-500 has-[:checked]:ring-1 has-[:checked]:ring-emerald-500">
              <input
                type="radio"
                name="billingFrequency"
                className="mt-0.5"
                checked={frequency === "MONTHLY"}
                onChange={() => setFrequency("MONTHLY")}
              />
              <span>
                <span className="font-medium text-slate-900">Monthly</span>
                <span className="ml-1.5 text-slate-500">{formatCurrency(monthlyNum)}/mo</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-emerald-200 bg-white p-2.5 text-sm has-[:checked]:border-emerald-500 has-[:checked]:ring-1 has-[:checked]:ring-emerald-500">
              <input
                type="radio"
                name="billingFrequency"
                className="mt-0.5"
                checked={frequency === "ANNUAL"}
                onChange={() => setFrequency("ANNUAL")}
              />
              <span>
                <span className="font-medium text-slate-900">Annual</span>
                <span className="ml-1.5 text-slate-500">{formatCurrency(annualTotal)}/yr billed upfront</span>
                {annualDiscountPct > 0 && (
                  <span className="ml-1.5 font-medium text-emerald-700">Save {annualDiscountPct}%</span>
                )}
              </span>
            </label>
          </div>
        )}
        <p className="text-sm font-medium text-emerald-900">Type your full name to accept this quote</p>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <div className="flex gap-2">
          <Button onClick={accept} disabled={pending || !name.trim()}>
            {pending ? "Submitting…" : "Confirm acceptance"}
          </Button>
          <Button variant="outline" onClick={() => setMode("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setMode("accepting")} className="bg-emerald-600 hover:bg-emerald-500">
        <CheckCircle2 className="h-4 w-4" /> Accept quote
      </Button>
      <Button variant="outline" onClick={reject} disabled={pending}>
        <XCircle className="h-4 w-4" /> Decline
      </Button>
      <Button variant="ghost" onClick={() => window.print()}>
        Save / print as PDF
      </Button>
    </div>
  );
}

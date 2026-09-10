"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateMsaSettings } from "@/server/actions/settings";
import { HelpTip } from "@/components/help-tip";
import { toast } from "sonner";
import type { MsaSettings, LiabilityCapType } from "@/server/pricing-data";

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-xs text-slate-500">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      {children}
    </div>
  );
}

export function MsaSettingsPanel({ settings: initial }: { settings: MsaSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<MsaSettings>(initial);

  function set<K extends keyof MsaSettings>(key: K, value: MsaSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      await updateMsaSettings(form);
      router.refresh();
      toast.success("MSA terms saved");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        These terms populate a generated Master Service Agreement template. This is a starting point, not legal
        advice — have an attorney licensed in your state review and customize the liability, indemnification, and
        termination language before relying on it with a real customer.
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Your business identity</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Legal business name" help="Exactly as it should appear as 'Provider' in the agreement, e.g. 'Lockdown IT, LLC'.">
            <Input value={form.providerLegalName} onChange={(e) => set("providerLegalName", e.target.value)} placeholder="Lockdown IT, LLC" />
          </Field>
          <Field label="Business address">
            <Input value={form.providerAddress} onChange={(e) => set("providerAddress", e.target.value)} />
          </Field>
          <Field label="Authorized signer name" help="Whoever's name/title signs on your behalf — shown in the signature block.">
            <Input value={form.providerSignerName} onChange={(e) => set("providerSignerName", e.target.value)} />
          </Field>
          <Field label="Authorized signer title">
            <Input value={form.providerSignerTitle} onChange={(e) => set("providerSignerTitle", e.target.value)} placeholder="Owner / President" />
          </Field>
          <Field label="Governing law state" help="The state whose law governs disputes — normally where your business is registered/operates.">
            <Input value={form.governingLawState} onChange={(e) => set("governingLawState", e.target.value)} placeholder="e.g. Ohio" />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Term & renewal</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Initial term (months)">
            <Input type="number" min={1} value={form.initialTermMonths} onChange={(e) => set("initialTermMonths", Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Renewal term (months)">
            <Input type="number" min={1} value={form.renewalTermMonths} onChange={(e) => set("renewalTermMonths", Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Non-renewal notice (days)">
            <Input type="number" min={0} value={form.nonRenewalNoticeDays} onChange={(e) => set("nonRenewalNoticeDays", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Auto-renews?">
            <label className="flex h-9 items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} /> Yes
            </label>
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Payment</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Payment due (days)">
            <Input type="number" min={0} value={form.paymentDueDays} onChange={(e) => set("paymentDueDays", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Late fee (% / month)">
            <Input type="number" min={0} step="0.1" value={form.lateFeePct} onChange={(e) => set("lateFeePct", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Annual increase cap (%)" help="0 = no stated cap on price increases at renewal.">
            <Input type="number" min={0} step="0.1" value={form.annualPriceIncreaseCapPct} onChange={(e) => set("annualPriceIncreaseCapPct", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Suspend service after (days past due)" help="Lets you stop work without liability if Client doesn't pay — a standard MSP protection.">
            <Input type="number" min={0} value={form.suspensionForNonPaymentDays} onChange={(e) => set("suspensionForNonPaymentDays", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Termination</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Termination for convenience — who may exercise it" help="'Both' is the most common. 'Provider only' or 'Client only' locks the other side into the term unless there's cause to terminate.">
            <Select value={form.terminationForConvenienceDirection} onValueChange={(v) => set("terminationForConvenienceDirection", v as MsaSettings["terminationForConvenienceDirection"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BOTH">Both parties</SelectItem>
                <SelectItem value="PROVIDER_ONLY">Provider only</SelectItem>
                <SelectItem value="CLIENT_ONLY">Client only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="For convenience, written notice (days)" help="How much advance written notice the terminating side must give — 60 days is typical for MSP contracts.">
            <Input type="number" min={0} value={form.terminationForConvenienceNoticeDays} onChange={(e) => set("terminationForConvenienceNoticeDays", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="For cause, cure period (days)" help="How long the breaching party has to fix the problem before the other side can terminate immediately.">
            <Input type="number" min={0} value={form.terminationForCauseCureDays} onChange={(e) => set("terminationForCauseCureDays", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Provider protections
          <HelpTip text="Standard MSP-industry clauses that protect your business — disclaiming implied warranties, disclaiming guaranteed prevention of cyberattacks, having the client indemnify you for their own misuse, and disclaiming responsibility for third-party vendors. Fully editable." />
        </p>
        <div className="flex flex-col gap-3">
          <Field label="Warranty disclaimer">
            <Textarea rows={2} value={form.warrantyDisclaimerSummary} onChange={(e) => set("warrantyDisclaimerSummary", e.target.value)} />
          </Field>
          <Field label="Security disclaimer" help="Protects you from being treated as a guarantor against every possible breach/ransomware event — one of the most important clauses for an MSP.">
            <Textarea rows={2} value={form.securityDisclaimerSummary} onChange={(e) => set("securityDisclaimerSummary", e.target.value)} />
          </Field>
          <Field label="Client indemnification" help="The client indemnifies you for claims arising from their own data, noncompliance, or misuse of the services.">
            <Textarea rows={2} value={form.clientIndemnitySummary} onChange={(e) => set("clientIndemnitySummary", e.target.value)} />
          </Field>
          <Field label="Third-party products & services disclaimer">
            <Textarea rows={2} value={form.thirdPartyDisclaimerSummary} onChange={(e) => set("thirdPartyDisclaimerSummary", e.target.value)} />
          </Field>
          <Field label="Independent contractor status">
            <Textarea rows={2} value={form.independentContractorSummary} onChange={(e) => set("independentContractorSummary", e.target.value)} />
          </Field>
          <Field label="Subcontractors">
            <Textarea rows={2} value={form.subcontractorsSummary} onChange={(e) => set("subcontractorsSummary", e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Liability</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Cap type">
            <Select value={form.liabilityCapType} onValueChange={(v) => set("liabilityCapType", v as LiabilityCapType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FEES_PAID_MULTIPLE">Multiple of fees paid</SelectItem>
                <SelectItem value="FIXED_AMOUNT">Fixed dollar amount</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.liabilityCapType === "FEES_PAID_MULTIPLE" ? (
            <Field label="Trailing months of fees">
              <Input type="number" min={1} value={form.liabilityCapMonths} onChange={(e) => set("liabilityCapMonths", Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          ) : (
            <Field label="Fixed cap amount ($)">
              <Input type="number" min={0} value={form.liabilityCapFixedAmount} onChange={(e) => set("liabilityCapFixedAmount", Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          )}
          <Field label="Exclude consequential damages?">
            <label className="flex h-9 items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.excludesConsequentialDamages} onChange={(e) => set("excludesConsequentialDamages", e.target.checked)} /> Yes
            </label>
          </Field>
          <Field label="Confidentiality survives (years)">
            <Input type="number" min={0} value={form.confidentialityYears} onChange={(e) => set("confidentialityYears", Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Standard clauses (editable text)</p>
        <div className="flex flex-col gap-3">
          <Field label="Data protection">
            <Textarea rows={2} value={form.dataProtectionSummary} onChange={(e) => set("dataProtectionSummary", e.target.value)} />
          </Field>
          <Field label="Intellectual property">
            <Textarea rows={2} value={form.ipOwnershipSummary} onChange={(e) => set("ipOwnershipSummary", e.target.value)} />
          </Field>
          <Field label="Insurance">
            <Textarea rows={2} value={form.insuranceRequirementSummary} onChange={(e) => set("insuranceRequirementSummary", e.target.value)} />
          </Field>
          <Field label="Dispute resolution">
            <Textarea rows={2} value={form.disputeResolutionSummary} onChange={(e) => set("disputeResolutionSummary", e.target.value)} />
          </Field>
        </div>
      </div>

      <Button className="w-fit" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save MSA terms"}
      </Button>
    </div>
  );
}

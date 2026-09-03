"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateDiscovery } from "@/server/actions/quotes";
import { toast } from "sonner";
import {
  computeRiskAdjustment,
  computeRecommendedTier,
  EMPTY_QUANTITIES,
  DEFAULT_RISK_FACTORS,
  type Quantities,
  type RiskFactors,
  type DocumentationQuality,
  type LegacySystems,
  type AfterHours,
  type Criticality,
  type IncidentHistory,
} from "@/server/pricing-rules";
import { TIER_LABELS, COMPLIANCE_FRAMEWORKS } from "@/server/pricing-data";

const DOC_QUALITY: DocumentationQuality[] = ["Excellent", "Good", "Average", "Poor"];
const LEGACY: LegacySystems[] = ["None", "Some", "Significant"];
const AFTER_HOURS: AfterHours[] = ["Business Hours", "Business Hours + Emergency", "24x7"];
const CRITICALITY: Criticality[] = ["Standard", "High", "Mission Critical"];
const INCIDENT: IncidentHistory[] = ["Normal", "Elevated", "Severe"];
const OVERRIDE_OPTIONS = [0, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2];

const QUANTITY_FIELDS: { key: keyof Quantities; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "workstations", label: "Managed Workstations" },
  { key: "servers", label: "Servers" },
  { key: "locations", label: "Locations" },
  { key: "firewalls", label: "Firewalls" },
  { key: "switches", label: "Managed Switches" },
  { key: "aps", label: "Managed Wireless APs" },
  { key: "otherNetworkDevices", label: "Other Managed Network Devices" },
];

export function DiscoveryForm({
  quoteId,
  quantities: initialQuantities,
  riskFactors: initialRisk,
}: {
  quoteId: string;
  quantities: Partial<Quantities> | null;
  riskFactors: Partial<RiskFactors> | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Quantities>({ ...EMPTY_QUANTITIES, ...initialQuantities });
  const [risk, setRisk] = useState<RiskFactors>({ ...DEFAULT_RISK_FACTORS, ...initialRisk });

  const { pct: riskPct, breakdown } = useMemo(() => computeRiskAdjustment(risk), [risk]);
  const effectivePct = risk.manualOverrideEnabled ? risk.manualOverridePct : riskPct;
  const recommendedTier = useMemo(
    () => computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: false }),
    [risk, quantities.users]
  );

  function setQty(key: keyof Quantities, value: string) {
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, Number(value) || 0) }));
  }

  function save() {
    startTransition(async () => {
      await updateDiscovery(quoteId, { quantities, riskFactors: risk });
      router.refresh();
      toast.success("Discovery saved");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Environment size</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUANTITY_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                min={0}
                value={quantities[f.key]}
                onChange={(e) => setQty(f.key, e.target.value)}
                className="h-8"
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Complexity, risk &amp; support expectations
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Documentation quality</Label>
            <Select value={risk.documentationQuality} onValueChange={(v) => setRisk((r) => ({ ...r, documentationQuality: v as DocumentationQuality }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_QUALITY.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Legacy / end-of-life systems</Label>
            <Select value={risk.legacySystems} onValueChange={(v) => setRisk((r) => ({ ...r, legacySystems: v as LegacySystems }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LEGACY.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Compliance program</Label>
            <Select value={risk.complianceProgram} onValueChange={(v) => setRisk((r) => ({ ...r, complianceProgram: v as RiskFactors["complianceProgram"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COMPLIANCE_FRAMEWORKS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">After-hours requirement</Label>
            <Select value={risk.afterHours} onValueChange={(v) => setRisk((r) => ({ ...r, afterHours: v as AfterHours }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{AFTER_HOURS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Multiple third-party vendors</Label>
            <Select value={risk.multiVendor} onValueChange={(v) => setRisk((r) => ({ ...r, multiVendor: v as "Yes" | "No" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="No">No</SelectItem><SelectItem value="Yes">Yes</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Business criticality</Label>
            <Select value={risk.criticality} onValueChange={(v) => setRisk((r) => ({ ...r, criticality: v as Criticality }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CRITICALITY.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Recent security / stability incident history</Label>
            <Select value={risk.incidentHistory} onValueChange={(v) => setRisk((r) => ({ ...r, incidentHistory: v as IncidentHistory }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INCIDENT.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-md border border-dashed border-slate-200 p-3">
          <input
            type="checkbox"
            id="manual-override"
            checked={risk.manualOverrideEnabled}
            onChange={(e) => setRisk((r) => ({ ...r, manualOverrideEnabled: e.target.checked }))}
            className="h-4 w-4"
          />
          <Label htmlFor="manual-override" className="cursor-pointer">Use manual risk override (normally leave off)</Label>
          {risk.manualOverrideEnabled && (
            <Select
              value={String(risk.manualOverridePct)}
              onValueChange={(v) => setRisk((r) => ({ ...r, manualOverridePct: Number(v) }))}
            >
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OVERRIDE_OPTIONS.map((v) => (
                  <SelectItem key={v} value={String(v)}>{(v * 100).toFixed(1)}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md bg-slate-50 p-3 text-sm">
        <div>
          <span className="text-slate-500">Effective risk adjustment</span>{" "}
          <span className="font-semibold text-slate-900">{(effectivePct * 100).toFixed(1)}%</span>
        </div>
        <div>
          <span className="text-slate-500">Recommended plan</span>{" "}
          <Badge variant="secondary">{TIER_LABELS[recommendedTier]}</Badge>
        </div>
        {!risk.manualOverrideEnabled && breakdown.length > 0 && (
          <div className="w-full text-xs text-slate-500">
            {breakdown.map((b) => `${b.label} (+${(b.pct * 100).toFixed(1)}%)`).join(" · ")}
          </div>
        )}
      </div>

      <Button onClick={save} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save discovery"}
      </Button>
    </div>
  );
}

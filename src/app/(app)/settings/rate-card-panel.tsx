"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { updateRateCard, resetRateCardToDefault } from "@/server/actions/settings";
import { toast } from "sonner";
import {
  TIER_KEYS,
  TIER_LABELS,
  COMPLIANCE_FRAMEWORKS,
  type RateCard,
  type TierRateCard,
  type ComplianceFramework,
} from "@/server/pricing-data";

type FieldFormat = "currency" | "percent" | "number";

const TIER_FIELDS: { key: keyof TierRateCard; label: string; format: FieldFormat; group: string }[] = [
  { key: "workstationMrr", label: "Workstation MRR ($/workstation/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "serverMrr", label: "Server MRR ($/server/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "firewallMrr", label: "Firewall MRR ($/firewall/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "switchMrr", label: "Switch MRR ($/switch/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "apMrr", label: "AP MRR ($/AP/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "locationMrr", label: "Location MRR ($/location/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "userMrr", label: "User MRR ($/user/mo)", format: "currency", group: "Base recurring rate card" },
  { key: "planPriceScale", label: "Plan price scale (1 = 100% of rate card)", format: "number", group: "Base recurring rate card" },
  { key: "minimumMrr", label: "Minimum MRR ($/mo floor)", format: "currency", group: "Base recurring rate card" },
  { key: "targetGrossMarginPct", label: "Target gross margin", format: "percent", group: "Base recurring rate card" },

  { key: "directCostPerWorkstation", label: "Direct cost / workstation ($/mo)", format: "currency", group: "Direct cost (internal)" },
  { key: "directCostPerServer", label: "Direct cost / server ($/mo)", format: "currency", group: "Direct cost (internal)" },
  { key: "directCostPerNetworkDevice", label: "Direct cost / network device ($/mo)", format: "currency", group: "Direct cost (internal)" },
  { key: "directCostPerUser", label: "Direct cost / user ($/mo)", format: "currency", group: "Direct cost (internal)" },
  { key: "directCostPerLocation", label: "Direct cost / location ($/mo)", format: "currency", group: "Direct cost (internal)" },

  { key: "vcioIncludedHoursPerMonth", label: "vCIO included hours / mo", format: "number", group: "vCIO & professional services" },
  { key: "additionalVcioRatePerHour", label: "Additional vCIO rate ($/hr)", format: "currency", group: "vCIO & professional services" },
  { key: "professionalServicesRatePerHour", label: "Professional services rate ($/hr)", format: "currency", group: "vCIO & professional services" },

  { key: "onboardingHoursPerWorkstation", label: "Onboarding hrs / workstation", format: "number", group: "Onboarding" },
  { key: "onboardingHoursPerServer", label: "Onboarding hrs / server", format: "number", group: "Onboarding" },
  { key: "onboardingHoursPerNetworkDevice", label: "Onboarding hrs / network device", format: "number", group: "Onboarding" },
  { key: "onboardingHoursPerLocation", label: "Onboarding hrs / location", format: "number", group: "Onboarding" },
  { key: "onboardingLaborCostPerHour", label: "Onboarding labor cost ($/hr, internal)", format: "currency", group: "Onboarding" },
  { key: "onboardingSellRatePerHour", label: "Onboarding sell rate ($/hr, customer)", format: "currency", group: "Onboarding" },
];

function NumInput({ value, onChange, format }: { value: number; onChange: (v: number) => void; format: FieldFormat }) {
  const display = format === "percent" ? value * 100 : value;
  return (
    <Input
      type="number"
      step={format === "percent" ? 0.1 : format === "currency" ? 1 : 0.05}
      value={display}
      onChange={(e) => {
        const raw = Number(e.target.value) || 0;
        onChange(format === "percent" ? raw / 100 : raw);
      }}
      className="h-8 w-24"
    />
  );
}

export function RateCardPanel({ rateCard: initial }: { rateCard: RateCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rateCard, setRateCard] = useState<RateCard>(initial);

  function setTierField(tierKey: keyof RateCard["tiers"], field: keyof TierRateCard, value: number) {
    setRateCard((prev) => ({
      ...prev,
      tiers: { ...prev.tiers, [tierKey]: { ...prev.tiers[tierKey], [field]: value } },
    }));
  }

  type SellCostKey = Exclude<keyof RateCard["optionalServices"], "vcioOverageDirectCostPerHour">;

  function setOptionalServiceSellCost(key: SellCostKey, value: { sell: number; cost: number }) {
    setRateCard((prev) => ({ ...prev, optionalServices: { ...prev.optionalServices, [key]: value } }));
  }

  function setVcioOverageCost(value: number) {
    setRateCard((prev) => ({
      ...prev,
      optionalServices: { ...prev.optionalServices, vcioOverageDirectCostPerHour: value },
    }));
  }

  function setCompliancePrice(framework: Exclude<ComplianceFramework, "None">, field: "sell" | "cost", value: number) {
    setRateCard((prev) => ({
      ...prev,
      compliance: {
        ...prev.compliance,
        [framework]: { ...(prev.compliance[framework] ?? { sell: 0, cost: 0 }), [field]: value },
      },
    }));
  }

  function save() {
    startTransition(async () => {
      await updateRateCard(rateCard);
      router.refresh();
      toast.success("Rate card saved");
    });
  }

  function reset() {
    startTransition(async () => {
      const defaults = await resetRateCardToDefault();
      setRateCard(defaults);
      router.refresh();
      toast.success("Rate card reset to spreadsheet defaults");
    });
  }

  const groups = Array.from(new Set(TIER_FIELDS.map((f) => f.group)));
  const optionalServiceRows: { key: SellCostKey; label: string }[] = [
    { key: "endpointBackupPerWorkstation", label: "Endpoint backup ($/protected workstation/mo)" },
    { key: "serverBackupPerServer", label: "Server backup ($/protected server/mo)" },
    { key: "managedBcdrBase", label: "Managed BCDR base ($/mo)" },
    { key: "managedBcdrPerServer", label: "Managed BCDR per server ($/protected server/mo)" },
    { key: "advancedEmailSecurityPerUser", label: "Advanced email security ($/user/mo)" },
    { key: "securityAwarenessTrainingPerUser", label: "Security awareness training ($/user/mo)" },
    { key: "microsoft365LicensingPerSeat", label: "Microsoft 365 licensing allowance ($/seat/mo)" },
    { key: "includedOnsiteHours", label: "Included onsite hours ($/hr)" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">{group}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assumption</TableHead>
                {TIER_KEYS.map((t) => (
                  <TableHead key={t}>{TIER_LABELS[t]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {TIER_FIELDS.filter((f) => f.group === group).map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="text-sm text-slate-600">{f.label}</TableCell>
                  {TIER_KEYS.map((t) => (
                    <TableCell key={t}>
                      <NumInput
                        value={rateCard.tiers[t][f.key]}
                        format={f.format}
                        onChange={(v) => setTierField(t, f.key, v)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Optional service pricing (same across all plans)
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Sell</TableHead>
              <TableHead>Direct cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optionalServiceRows.map((row) => {
              const sc = rateCard.optionalServices[row.key];
              return (
                <TableRow key={row.key}>
                  <TableCell className="text-sm text-slate-600">{row.label}</TableCell>
                  <TableCell>
                    <NumInput value={sc.sell} format="currency" onChange={(v) => setOptionalServiceSellCost(row.key, { ...sc, sell: v })} />
                  </TableCell>
                  <TableCell>
                    <NumInput value={sc.cost} format="currency" onChange={(v) => setOptionalServiceSellCost(row.key, { ...sc, cost: v })} />
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell className="text-sm text-slate-600">vCIO overage direct cost ($/hr, internal)</TableCell>
              <TableCell colSpan={2}>
                <NumInput
                  value={rateCard.optionalServices.vcioOverageDirectCostPerHour}
                  format="currency"
                  onChange={setVcioOverageCost}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Compliance management pricing (same across all plans)
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Framework</TableHead>
              <TableHead>Sell ($/mo)</TableHead>
              <TableHead>Direct cost ($/mo)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COMPLIANCE_FRAMEWORKS.filter((f) => f !== "None").map((framework) => {
              const sc = rateCard.compliance[framework] ?? { sell: 0, cost: 0 };
              return (
                <TableRow key={framework}>
                  <TableCell className="text-sm text-slate-600">{framework}</TableCell>
                  <TableCell>
                    <NumInput value={sc.sell} format="currency" onChange={(v) => setCompliancePrice(framework, "sell", v)} />
                  </TableCell>
                  <TableCell>
                    <NumInput value={sc.cost} format="currency" onChange={(v) => setCompliancePrice(framework, "cost", v)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save rate card"}</Button>
        <Button variant="outline" onClick={reset} disabled={pending}>Reset to spreadsheet defaults</Button>
      </div>
    </div>
  );
}

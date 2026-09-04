"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { applyEngineTier, setWaiveMinimumMrr } from "@/server/actions/quotes";
import { cn } from "@/lib/utils";
import { TIER_KEYS, TIER_LABELS, type TierKey } from "@/server/pricing-data";
import type { TierPricingResult } from "@/server/pricing-rules";

function GuardrailBadge({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok === null) return null;
  return (
    <Badge variant={ok ? "success" : "warning"} className="gap-1">
      {label}: {ok ? "OK" : "Review"}
    </Badge>
  );
}

export function PlanComparisonPanel({
  quoteId,
  allTiers,
  recommendedTier,
  selectedTier,
  planFitStatus,
  marginStatus,
  managerApprovalRequired,
  manualRiskOverrideUsed,
  checklistDone,
  checklistTotal,
  waiveMinimumMrr,
}: {
  quoteId: string;
  allTiers: Record<TierKey, TierPricingResult>;
  recommendedTier: TierKey;
  selectedTier: TierKey | null;
  planFitStatus: "OK" | "REVIEW" | null;
  marginStatus: "OK" | "REVIEW" | null;
  managerApprovalRequired: boolean;
  manualRiskOverrideUsed: boolean;
  checklistDone: number;
  checklistTotal: number;
  waiveMinimumMrr: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyTier(tier: TierKey) {
    startTransition(async () => {
      await applyEngineTier(quoteId, tier);
      router.refresh();
      toast.success(`Applied ${TIER_LABELS[tier]} plan to line items`);
    });
  }

  function toggleWaiveMinimum(checked: boolean) {
    startTransition(async () => {
      await setWaiveMinimumMrr(quoteId, checked);
      router.refresh();
      toast.success(checked ? "Minimum monthly engagement waived for this quote" : "Minimum monthly engagement restored");
    });
  }

  const checklistOk = checklistTotal === 0 ? null : checklistDone === checklistTotal;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <GuardrailBadge label="Plan fit" ok={planFitStatus === null ? null : planFitStatus === "OK"} />
        <GuardrailBadge label="Margin" ok={marginStatus === null ? null : marginStatus === "OK"} />
        <GuardrailBadge label="Checklist" ok={checklistOk} />
        <GuardrailBadge label="Risk override" ok={!manualRiskOverrideUsed} />
        {managerApprovalRequired && <Badge variant="destructive">Manager approval required</Badge>}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Checkbox
          id="waive-minimum-mrr"
          checked={waiveMinimumMrr}
          disabled={pending}
          onCheckedChange={(checked) => toggleWaiveMinimum(checked === true)}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor="waive-minimum-mrr" className="cursor-pointer text-sm font-medium text-slate-900">
            Waive minimum monthly engagement for this quote
          </Label>
          <p className="text-xs text-slate-500">
            For a small opportunity where the standard plan minimum doesn&apos;t apply. Skips the minimum-MRR floor
            for all three plans below and removes the adjustment line item. Saved on this quote.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TIER_KEYS.map((tier) => {
          const pricing = allTiers[tier];
          const isRecommended = tier === recommendedTier;
          const isSelected = tier === selectedTier;
          return (
            <div
              key={tier}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-4",
                isSelected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{TIER_LABELS[tier]}</span>
                <div className="flex gap-1">
                  {isRecommended && <Badge variant="secondary">Recommended</Badge>}
                  {isSelected && <Badge>Selected</Badge>}
                </div>
              </div>

              <div>
                <div className="text-2xl font-semibold text-slate-900">{formatCurrency(pricing.finalMrr)}</div>
                <div className="text-xs text-slate-500">per month · {formatCurrency(pricing.annualContractValue)}/yr</div>
              </div>

              <div className="flex flex-col gap-1 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Gross margin</span>
                  <span className={pricing.marginStatus === "OK" ? "text-emerald-700" : "text-amber-700"}>
                    {(pricing.grossMarginPct * 100).toFixed(1)}% (target {(pricing.targetGrossMarginPct * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>One-time onboarding</span>
                  <span>{formatCurrency(pricing.onboardingFeeSell)}</span>
                </div>
                {pricing.minimumMrrAdjustment > 0 && (
                  <div className="flex justify-between">
                    <span>Minimum-MRR floor applied</span>
                    <span>+{formatCurrency(pricing.minimumMrrAdjustment)}</span>
                  </div>
                )}
              </div>

              <Button
                variant={isSelected ? "outline" : "default"}
                size="sm"
                disabled={pending}
                onClick={() => applyTier(tier)}
              >
                {isSelected ? "Re-apply plan" : "Use this plan"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

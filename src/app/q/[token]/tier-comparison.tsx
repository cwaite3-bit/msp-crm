import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { TIER_KEYS, TIER_LABELS, TIER_TAGLINES, TIER_FEATURES, type TierKey } from "@/server/pricing-data";
import type { TierPricingResult } from "@/server/pricing-rules";

export function TierComparison({
  allTiers,
  recommendedTier,
  selectedTier,
}: {
  allTiers: Record<TierKey, TierPricingResult>;
  recommendedTier: TierKey;
  selectedTier: TierKey | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {TIER_KEYS.map((tier) => {
        const pricing = allTiers[tier];
        const isRecommended = tier === recommendedTier;
        const isSelected = tier === selectedTier;
        return (
          <div
            key={tier}
            className={cn(
              "flex flex-col gap-4 rounded-xl border p-5",
              isSelected ? "border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500" : "border-slate-200"
            )}
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{TIER_LABELS[tier]}</p>
                {isRecommended && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-slate-700">{TIER_TAGLINES[tier]}</p>
            </div>

            <div>
              <p className="text-3xl font-bold text-slate-900">{formatCurrency(pricing.finalMrr)}</p>
              <p className="text-xs text-slate-500">per month</p>
            </div>

            <ul className="flex flex-1 flex-col gap-1.5 text-sm text-slate-600">
              {TIER_FEATURES[tier].map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="border-t border-slate-200 pt-3 text-xs text-slate-500">
              {formatCurrency(pricing.onboardingFeeSell)} one-time onboarding
            </div>

            {isSelected && (
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Your plan
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

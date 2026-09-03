import { Check, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCOPE_TERM_DEFINITIONS,
  SCOPE_TERM_VARIANT,
  TIER_KEYS,
  TIER_LABELS,
  type ScopeMatrixRow,
  type TierKey,
} from "@/server/pricing-data";

// Renders the scope matrix as a "brochure" comparison: Bronze's full
// baseline first, then Silver as "everything in Bronze, plus" the rows
// that actually change, then Gold the same way against Silver. A row whose
// value never changes across tiers (e.g. custom development is always
// "Project" work) only ever shows once, under Bronze — which is also an
// honest way of saying "this isn't part of any plan's monthly scope."
// Every status word (Included, Defined, Reasonable, ...) is a hoverable
// term with a plain-English definition, sourced from the Lockdown IT
// Managed Services Coverage Guide.

const TIER_ACCENT: Record<TierKey, string> = {
  bronze: "border-amber-400",
  silver: "border-slate-400",
  gold: "border-yellow-500",
};

const TIER_BADGE: Record<TierKey, string> = {
  bronze: "bg-amber-50 text-amber-800",
  silver: "bg-slate-100 text-slate-700",
  gold: "bg-yellow-50 text-yellow-800",
};

function VariantIcon({ variant }: { variant: "included" | "addon" | "excluded" }) {
  if (variant === "included") return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (variant === "addon") return <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />;
  return <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

function TermBadge({ term }: { term: string }) {
  const definition = SCOPE_TERM_DEFINITIONS[term];
  if (!definition) return <span className="text-slate-700">{term}</span>;
  return (
    <span className="group relative inline-flex cursor-help border-b border-dotted border-slate-400 text-slate-700">
      {term}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {definition}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
      </span>
    </span>
  );
}

function rowsForTier(rows: ScopeMatrixRow[], tier: TierKey, previous: TierKey | null) {
  if (!previous) return rows;
  return rows.filter((r) => r[tier] !== r[previous]);
}

export function ScopeMatrixTable({ rows, selectedTier }: { rows: ScopeMatrixRow[]; selectedTier?: TierKey | null }) {
  const previousTier: Record<TierKey, TierKey | null> = { bronze: null, silver: "bronze", gold: "silver" };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        Hover any underlined term below for what it means. Each plan includes everything in the tier before it.
      </p>

      {TIER_KEYS.map((tier) => {
        const tierRows = rowsForTier(rows, tier, previousTier[tier]);
        const isSelected = tier === selectedTier;

        return (
          <div
            key={tier}
            className={cn(
              "rounded-lg border-l-4 bg-white p-4",
              TIER_ACCENT[tier],
              isSelected ? "ring-1 ring-emerald-500" : "border border-l-4 border-slate-100"
            )}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", TIER_BADGE[tier])}>
                {TIER_LABELS[tier]}
              </span>
              <span className="text-xs text-slate-500">
                {previousTier[tier] ? `Everything in ${TIER_LABELS[previousTier[tier]!]}, plus:` : "The baseline plan:"}
              </span>
              {isSelected && (
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                  Your plan
                </span>
              )}
            </div>

            {tierRows.length === 0 ? (
              <p className="text-sm text-slate-400">No changes from {TIER_LABELS[previousTier[tier]!]}.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {tierRows.map((row) => {
                  const value = row[tier];
                  const variant = SCOPE_TERM_VARIANT[value] ?? "included";
                  return (
                    <li key={row.key} className="flex items-start gap-2 text-sm">
                      <VariantIcon variant={variant} />
                      <span>
                        <span className="font-medium text-slate-900">{row.service}</span>
                        <span className="text-slate-400"> — </span>
                        <TermBadge term={value} />
                        <span className="block text-xs text-slate-500">{row.customerDescription}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-400">
        Items marked Project or Per Incident (printer support, document formatting, training, custom development,
        migrations, office moves, and similar work) are handled as separately scoped or per-incident work at every
        tier — see the Lockdown IT Managed Services Coverage Guide for the full policy.
      </p>
    </div>
  );
}

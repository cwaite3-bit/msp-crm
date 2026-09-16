// A small, fixed palette staff can assign to a service tier (Catalog page
// only, for now) so its badge and its "<Tier> price" column heading are
// visually distinguishable at a glance in a wide pricing table.
//
// Deliberately a closed set of named keys stored on `service_tiers.color`,
// never a raw hex value: Tailwind's build-time scanner can only pick up
// class names that appear literally in source, so a color has to resolve
// to one of these pre-written class strings rather than being assembled
// dynamically (e.g. `bg-${color}-50` would silently not work).
export const TIER_COLOR_KEYS = [
  "slate",
  "blue",
  "violet",
  "fuchsia",
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
  "cyan",
] as const;

export type TierColorKey = (typeof TIER_COLOR_KEYS)[number];

export const TIER_COLOR_LABELS: Record<TierColorKey, string> = {
  slate: "Slate",
  blue: "Blue",
  violet: "Violet",
  fuchsia: "Fuchsia",
  rose: "Rose",
  orange: "Orange",
  amber: "Amber",
  emerald: "Emerald",
  teal: "Teal",
  cyan: "Cyan",
};

// `badge`: full pill styling (border + background + text), matching the
// existing small-badge pattern used elsewhere in this app (e.g. the
// "Addendum" tag in quote-builder.tsx). `heading`/`dot`: just the text/fill
// color, for the table column heading and the swatch shown in the color
// picker.
export const TIER_COLOR_CLASSES: Record<TierColorKey, { badge: string; heading: string; dot: string }> = {
  slate: { badge: "border-slate-300 bg-slate-100 text-slate-700", heading: "text-slate-700", dot: "bg-slate-400" },
  blue: { badge: "border-blue-200 bg-blue-50 text-blue-700", heading: "text-blue-700", dot: "bg-blue-500" },
  violet: { badge: "border-violet-200 bg-violet-50 text-violet-700", heading: "text-violet-700", dot: "bg-violet-500" },
  fuchsia: { badge: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700", heading: "text-fuchsia-700", dot: "bg-fuchsia-500" },
  rose: { badge: "border-rose-200 bg-rose-50 text-rose-700", heading: "text-rose-700", dot: "bg-rose-500" },
  orange: { badge: "border-orange-200 bg-orange-50 text-orange-700", heading: "text-orange-700", dot: "bg-orange-500" },
  amber: { badge: "border-amber-200 bg-amber-50 text-amber-700", heading: "text-amber-700", dot: "bg-amber-500" },
  emerald: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", heading: "text-emerald-700", dot: "bg-emerald-500" },
  teal: { badge: "border-teal-200 bg-teal-50 text-teal-700", heading: "text-teal-700", dot: "bg-teal-500" },
  cyan: { badge: "border-cyan-200 bg-cyan-50 text-cyan-700", heading: "text-cyan-700", dot: "bg-cyan-500" },
};

export const DEFAULT_TIER_COLOR: TierColorKey = "slate";

function isTierColorKey(value: string): value is TierColorKey {
  return (TIER_COLOR_KEYS as readonly string[]).includes(value);
}

// Never throws on a null/unrecognized value (a tier created before this
// column existed, or a stray value) — falls back to the neutral default
// instead, so a bad/missing color can never break rendering.
export function tierColorClasses(color: string | null | undefined) {
  const key = color && isTierColorKey(color) ? color : DEFAULT_TIER_COLOR;
  return TIER_COLOR_CLASSES[key];
}

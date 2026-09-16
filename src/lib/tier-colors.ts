// A small, fixed palette staff can assign to a service tier (Catalog page
// only, for now) so its badge and its "<Tier> price" column heading are
// visually distinguishable at a glance in a wide pricing table.
//
// Deliberately a closed set of named keys stored on `service_tiers.color`,
// never a raw hex value: Tailwind's build-time scanner can only pick up
// class names that appear literally in source, so a color has to resolve
// to one of these pre-written class strings rather than being assembled
// dynamically (e.g. `bg-${color}-50` would silently not work).
//
// Includes three metal-toned options — bronze/silver/gold — specifically
// so the Bronze/Silver/Gold service tiers (this app's actual default
// names) have colors that read as what they're named, rather than staff
// having to approximate "bronze" with a generic orange that ends up
// looking almost identical to "gold" (an earlier version of this palette
// used amber for both — indistinguishable at a glance in the pricing
// table). Bronze is a deep amber-brown, gold a true bright yellow, and
// silver a cool mid-gray distinct from the neutral default (slate).
export const TIER_COLOR_KEYS = [
  "slate",
  "bronze",
  "silver",
  "gold",
  "red",
  "orange",
  "green",
  "emerald",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "rose",
] as const;

export type TierColorKey = (typeof TIER_COLOR_KEYS)[number];

export const TIER_COLOR_LABELS: Record<TierColorKey, string> = {
  slate: "Slate",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  red: "Red",
  orange: "Orange",
  green: "Green",
  emerald: "Emerald",
  teal: "Teal",
  cyan: "Cyan",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  fuchsia: "Fuchsia",
  rose: "Rose",
};

// `badge`: full pill styling (border + light background + colored text),
// matching the existing small-badge pattern used elsewhere in this app
// (e.g. the "Addendum" tag in quote-builder.tsx) — used for the draggable
// tier badge itself.
// `heading`: a solid, opaque background highlight plus white/black text
// (whichever reads clearly against that background) for the "<Tier>
// price" table column heading — the color is the highlight now, not the
// text color, so two similarly-hued tiers (e.g. bronze/gold) are told
// apart by a clearly different background rather than a subtle text-color
// difference that's easy to miss.
// `dot`: just the fill color, for the swatch shown in the color picker.
export const TIER_COLOR_CLASSES: Record<TierColorKey, { badge: string; heading: string; dot: string }> = {
  slate: {
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    heading: "bg-slate-600 text-white",
    dot: "bg-slate-400",
  },
  bronze: {
    badge: "border-amber-300 bg-amber-100 text-amber-900",
    heading: "bg-amber-800 text-white",
    dot: "bg-amber-700",
  },
  silver: {
    badge: "border-zinc-300 bg-zinc-100 text-zinc-700",
    heading: "bg-zinc-400 text-slate-900",
    dot: "bg-zinc-400",
  },
  gold: {
    badge: "border-yellow-300 bg-yellow-100 text-yellow-900",
    heading: "bg-yellow-500 text-slate-900",
    dot: "bg-yellow-500",
  },
  red: {
    badge: "border-red-200 bg-red-50 text-red-700",
    heading: "bg-red-600 text-white",
    dot: "bg-red-500",
  },
  orange: {
    badge: "border-orange-200 bg-orange-50 text-orange-700",
    heading: "bg-orange-600 text-white",
    dot: "bg-orange-500",
  },
  green: {
    badge: "border-green-200 bg-green-50 text-green-700",
    heading: "bg-green-600 text-white",
    dot: "bg-green-500",
  },
  emerald: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    heading: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
  },
  teal: {
    badge: "border-teal-200 bg-teal-50 text-teal-700",
    heading: "bg-teal-700 text-white",
    dot: "bg-teal-500",
  },
  cyan: {
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700",
    heading: "bg-cyan-700 text-white",
    dot: "bg-cyan-500",
  },
  blue: {
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    heading: "bg-blue-600 text-white",
    dot: "bg-blue-500",
  },
  indigo: {
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700",
    heading: "bg-indigo-600 text-white",
    dot: "bg-indigo-500",
  },
  violet: {
    badge: "border-violet-200 bg-violet-50 text-violet-700",
    heading: "bg-violet-600 text-white",
    dot: "bg-violet-500",
  },
  fuchsia: {
    badge: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
    heading: "bg-fuchsia-600 text-white",
    dot: "bg-fuchsia-500",
  },
  rose: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    heading: "bg-rose-600 text-white",
    dot: "bg-rose-500",
  },
};

export const DEFAULT_TIER_COLOR: TierColorKey = "slate";

function isTierColorKey(value: string): value is TierColorKey {
  return (TIER_COLOR_KEYS as readonly string[]).includes(value);
}

// Never throws on a null/unrecognized value (a tier created before this
// column existed, a stray value, or a color key retired in a later version
// of this palette) — falls back to the neutral default instead, so a bad/
// missing color can never break rendering. `service_tiers.color` is a
// free-text column with no foreign key/enum constraint specifically so
// this palette can be revised (as it was here) without a migration — a
// tier still pointing at a retired key just shows the neutral default
// until staff re-pick a color for it from the current palette.
export function tierColorClasses(color: string | null | undefined) {
  const key = color && isTierColorKey(color) ? color : DEFAULT_TIER_COLOR;
  return TIER_COLOR_CLASSES[key];
}

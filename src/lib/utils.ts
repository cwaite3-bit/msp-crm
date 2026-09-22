import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, opts?: { cents?: boolean }) {
  const n = typeof value === "string" ? Number(value) : value;
  const dollars = opts?.cents ? n / 100 : n;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(dollars) ? dollars : 0
  );
}

export function formatDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function formatDateTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// Full US state/territory name → two-letter abbreviation, so "AZ" and
// "Arizona" (e.g. from two different import spreadsheets, one of which
// spelled states out) collapse into a single, filterable value instead of
// showing up as two separate options in the Prospects state filter. Left
// untouched (just trimmed) if it's already a 2-letter code or isn't a
// recognized US state name — free text is still allowed for anything else.
const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", guam: "GU", "american samoa": "AS",
  "u.s. virgin islands": "VI", "virgin islands": "VI",
  "northern mariana islands": "MP",
};

export function normalizeState(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return US_STATE_ABBREVIATIONS[trimmed.toLowerCase()] || trimmed;
}

// Renders whatever billing-address fields are present as a single
// comma-separated line (e.g. "123 Main St, Queen Creek, AZ 85142"), skipping
// any that are missing rather than leaving stray commas — used on the
// Prospects list so a salesperson can see a prospect's location at a glance
// without opening the record.
export function formatAddressLine(address: {
  billingStreet?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
}): string {
  const cityStateZip = [address.billingCity, [address.billingState, address.billingZip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.billingStreet, cityStateZip].filter(Boolean).join(", ");
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

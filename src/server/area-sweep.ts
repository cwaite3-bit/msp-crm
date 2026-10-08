// Pure half of Prospects → "Area sweep" — same "no DB, no network, no side
// effects" shape as prospect-research.ts / ai-review.ts, and safe to import
// from client components (the sweep dialog uses planSearchAreas to preview
// how big a sweep is before anyone spends money on it).
//
// What a sweep is: staff give a center address and a ring (inner–outer
// miles, e.g. 0–10, 10–20, 0–50). The ring is split into "search areas" —
// wedges roughly 10 miles deep and ~12 miles wide — and each area gets one
// Claude + web search call asking for qualified small/mid businesses
// physically inside it. Every business that comes back is geocoded by the
// server (not trusted to the model), measured against the center point, MX-
// checked and duplicate-checked, then shown to staff for approval. Nothing
// becomes a prospect until staff tick it and click Import.
//
// The server half (DB writes, Anthropic/geocoder/DNS calls) is in
// src/server/actions/area-sweep.ts.

import type { ResearchRecord } from "@/server/prospect-research";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const EARTH_RADIUS_MILES = 3958.8;

export type LatLng = { lat: number; lng: number };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

// Great-circle distance in miles.
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial compass bearing from a to b, 0–360 (0 = north, 90 = east).
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// The point `miles` away from `from` along compass `bearing`.
export function destinationPoint(from: LatLng, bearing: number, miles: number): LatLng {
  const δ = miles / EARTH_RADIUS_MILES;
  const θ = toRad(bearing);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: round(toDeg(φ2), 6), lng: round(((toDeg(λ2) + 540) % 360) - 180, 6) };
}

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassLabel(bearing: number): string {
  return COMPASS_16[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Sweep options + search-area planning
// ---------------------------------------------------------------------------

export const RADIUS_PRESETS = [5, 10, 15, 20, 25, 30, 40, 50] as const;
export const MAX_OUTER_MILES = 75;
export const MAX_SEARCH_AREAS = 40;
const BAND_DEPTH_MILES = 10; // each search area is about 10 miles deep…
const MIN_LAST_BAND_MILES = 5; // …and an outermost sliver this thin or thinner joins the band inside it
const TARGET_AREA_SQ_MILES = 120; // …and covers roughly this much ground (≈10 × 12 mi)
const MIN_WEDGES_PER_BAND = 4;

export type SweepOptions = {
  innerMiles: number; // 0 = a full circle around the address
  outerMiles: number;
  perAreaTarget: number; // how many businesses to ask for per search area
  minEmployees: number;
  maxEmployees: number;
  industryFocus: string; // free text; blank = typical MSP-fit industries
  excludeChains: boolean;
};

export const DEFAULT_SWEEP_OPTIONS: SweepOptions = {
  innerMiles: 0,
  outerMiles: 10,
  perAreaTarget: 10,
  minEmployees: 5,
  maxEmployees: 250,
  industryFocus: "",
  excludeChains: true,
};

// Clamps everything coming from the browser into sane bounds. Returns an
// error string instead of options when the ring itself doesn't make sense.
export function normalizeSweepOptions(raw: Partial<SweepOptions>): SweepOptions | { error: string } {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const inner = Math.max(0, round(num(raw.innerMiles, 0), 1));
  const outer = round(num(raw.outerMiles, 10), 1);
  if (outer <= 0) return { error: "Pick an outer radius greater than 0 miles." };
  if (outer > MAX_OUTER_MILES) return { error: `The outer radius can be at most ${MAX_OUTER_MILES} miles.` };
  if (inner >= outer) return { error: "The inner radius has to be smaller than the outer radius." };
  let minE = Math.max(0, Math.round(num(raw.minEmployees, DEFAULT_SWEEP_OPTIONS.minEmployees)));
  let maxE = Math.max(1, Math.round(num(raw.maxEmployees, DEFAULT_SWEEP_OPTIONS.maxEmployees)));
  if (minE > maxE) [minE, maxE] = [maxE, minE];
  return {
    innerMiles: inner,
    outerMiles: outer,
    perAreaTarget: Math.min(20, Math.max(3, Math.round(num(raw.perAreaTarget, DEFAULT_SWEEP_OPTIONS.perAreaTarget)))),
    minEmployees: minE,
    maxEmployees: maxE,
    industryFocus: String(raw.industryFocus ?? "").trim().slice(0, 500),
    excludeChains: raw.excludeChains !== false,
  };
}

export type SearchArea = {
  index: number;
  innerMiles: number;
  outerMiles: number;
  startBearing: number;
  endBearing: number;
  // The middle of the wedge — where the prompt tells Claude to look, and
  // what the server reverse-geocodes into a place-name hint.
  center: LatLng;
  direction: string; // e.g. "NE"
};

// Splits the ring into bands about 10 miles deep (an outermost sliver
// 5 miles or thinner is merged into the band inside it), then each band
// into wedges sized so every search area covers roughly the same ground —
// an outer band gets proportionally more wedges than an inner one. Every
// band gets at least 4. If the total would exceed MAX_SEARCH_AREAS (a 0–50
// mile sweep is ~70 at full detail), every area is scaled up together until
// it fits, so a big sweep trades some thoroughness for a bounded cost
// without any one band getting lopsided.
export function planSearchAreas(center: LatLng, innerMiles: number, outerMiles: number): SearchArea[] {
  const bands: [number, number][] = [];
  for (let start = innerMiles; start < outerMiles - 1e-9; start += BAND_DEPTH_MILES) {
    bands.push([round(start, 1), round(Math.min(outerMiles, start + BAND_DEPTH_MILES), 1)]);
  }
  if (bands.length > 1) {
    const [a, b] = bands[bands.length - 1];
    if (b - a <= MIN_LAST_BAND_MILES) {
      bands.pop();
      bands[bands.length - 1][1] = b;
    }
  }

  const bandArea = ([a, b]: [number, number]) => Math.PI * (b * b - a * a);
  const wedgesFor = (cellArea: number) =>
    bands.map((band) => Math.max(MIN_WEDGES_PER_BAND, Math.round(bandArea(band) / cellArea)));

  let cellArea = TARGET_AREA_SQ_MILES;
  let counts = wedgesFor(cellArea);
  while (counts.reduce((s, n) => s + n, 0) > MAX_SEARCH_AREAS) {
    cellArea *= 1.1;
    counts = wedgesFor(cellArea);
  }

  const areas: SearchArea[] = [];
  bands.forEach(([a, b], bandIdx) => {
    const n = counts[bandIdx];
    const width = 360 / n;
    // Offset alternate bands by half a wedge so wedge seams don't line up
    // ring after ring (a seam is where a business is most likely to be
    // missed by both neighbouring searches).
    const offset = bandIdx % 2 === 1 ? width / 2 : 0;
    // The point splitting the wedge's area in half radially — for a full
    // disk (a = 0) that's ~0.71 of the radius, not the midpoint.
    const midRadius = Math.sqrt((a * a + b * b) / 2);
    for (let i = 0; i < n; i++) {
      const start = (offset + i * width) % 360;
      const mid = (start + width / 2) % 360;
      areas.push({
        index: areas.length,
        innerMiles: a,
        outerMiles: b,
        startBearing: round(start, 1),
        endBearing: round((start + width) % 360, 1),
        center: destinationPoint(center, mid, midRadius),
        direction: compassLabel(mid),
      });
    }
  });
  return areas;
}

// Rough, deliberately conservative planning numbers shown before a sweep
// starts. Real usage (searches + tokens) is recorded per area afterwards.
export const WEB_SEARCHES_PER_AREA = 8;
export const EST_COST_PER_AREA_LOW = 0.3;
export const EST_COST_PER_AREA_HIGH = 1.25;
export const EST_SECONDS_PER_AREA = 75;
export const PARALLEL_AREAS = 2;

export function estimateSweep(areaCount: number, perAreaTarget: number) {
  return {
    areas: areaCount,
    maxWebSearches: areaCount * WEB_SEARCHES_PER_AREA,
    costLow: round(areaCount * EST_COST_PER_AREA_LOW, 2),
    costHigh: round(areaCount * EST_COST_PER_AREA_HIGH, 2),
    minutes: Math.max(1, Math.ceil((areaCount * EST_SECONDS_PER_AREA) / PARALLEL_AREAS / 60)),
    maxBusinesses: areaCount * perAreaTarget,
  };
}

export function ringLabel(innerMiles: number, outerMiles: number): string {
  return innerMiles > 0 ? `${innerMiles}–${outerMiles} mi` : `within ${outerMiles} mi`;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const SWEEP_SYSTEM_PROMPT = `You are a B2B prospecting researcher for Lockdown IT, a managed IT services provider (MSP) that sells managed IT, cybersecurity, and network infrastructure (networks, servers, firewalls, switches, workstations, Microsoft 365, backup) to small and mid-sized businesses.

You are given ONE geographic search area and must find real, currently operating businesses physically located inside it that are a good fit for an MSP. Use web search (business directories, chambers of commerce, Google Business listings, business websites, industry directories, local news). Use up to about 8 searches.

Rules — follow all of them:
- Only businesses with a physical location inside the search area described. Give the street address of THAT location — the server checks every address's real distance, and anything outside the area is thrown away, so don't waste results on businesses elsewhere.
- Qualified = an independent or regional business or practice with staff, computers and data to protect: e.g. medical/dental/veterinary/chiropractic/physical-therapy practices, law firms, accounting/CPA/financial advisors, insurance agencies, title/escrow, real-estate brokerages, property management, engineering/architecture, construction and trades contractors with an office, manufacturers/fabricators, distributors/warehouses, auto dealers and repair groups, private schools/childcare centers, churches and nonprofits with an office, and multi-location local businesses. Follow the size and industry instructions in the request.
- Not qualified: government agencies, public school districts, hospitals belonging to large health systems, big-box and national retail, home-based or one-person businesses, and businesses whose IT is clearly run by a national corporate parent.
- Public BUSINESS information only. Never include anyone's home address, personal cell phone, personal email, or personal social media. A decision-maker's name and title are fine when the business publishes them.
- Never guess. Unknown values are null (or []). Never invent an email from a name pattern. If you can't find a street address for a business, leave it out entirely — an address is required.
- Put values in the right field: mainPhone is a phone number only, website a URL only, publicEmail an email only.
- confidence = how sure you are about the business's size and location: "High" (multiple consistent sources), "Medium" (one good source), "Low" (thin).
- employeeEstimate is a range like "11-50" when evidence supports one.
- Do not repeat any business named in the "already found" list.

Respond with ONLY one JSON object — no markdown fences, no commentary — in exactly this shape:
{
  "businesses": [
    {
      "companyName": string,
      "address": string,                 // street address only, required
      "city": string | null,
      "state": string | null,            // 2-letter code
      "zip": string | null,
      "industry": string | null,
      "mainPhone": string | null,
      "website": string | null,
      "publicEmail": string | null,
      "confidence": "High" | "Medium" | "Low",
      "decisionMaker": string | null,
      "decisionMakerTitle": string | null,
      "employeeEstimate": string | null,
      "employeeEvidence": string | null,
      "businessItSignals": string[],      // short bullets: what their systems/devices/locations say about IT needs
      "securityComplexitySignals": string[],
      "complianceFrameworks": string[],   // e.g. HIPAA, PCI DSS, FTC Safeguards — only with a clear basis
      "existingItProvider": string | null,
      "qualificationNotes": string | null, // one or two sentences on why this is a fit for an MSP
      "talkingPoints": string[],          // 1-2 specific openers
      "primarySource": string | null,
      "sourceUrls": string[]
    }
  ]
}`;

export type SweepPromptInput = {
  centerAddress: string;
  centerPoint: LatLng;
  area: SearchArea;
  placeHint: string | null; // e.g. "near Gilbert, AZ (Maricopa County)"
  options: SweepOptions;
  alreadyFound: string[]; // business names already found elsewhere in this sweep
};

export function buildSweepPrompt(input: SweepPromptInput): string {
  const { area, options } = input;
  const fmt = (p: LatLng) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  const distance =
    area.innerMiles > 0
      ? `between ${area.innerMiles} and ${area.outerMiles} miles from the center`
      : `within ${area.outerMiles} miles of the center`;
  const lines = [
    `Find up to ${options.perAreaTarget} qualified businesses in this search area and return the JSON object.`,
    ``,
    `Center address: ${input.centerAddress} (${fmt(input.centerPoint)})`,
    `Search area: the wedge ${distance}, on compass bearings ${area.startBearing}° to ${area.endBearing}° from the center (roughly ${area.direction} of it).`,
    `The middle of this area is about ${fmt(area.center)}${input.placeHint ? `, ${input.placeHint}` : ""}. Work out which towns, neighborhoods and business corridors fall inside it, and search those.`,
  ];
  if (area.innerMiles > 0) {
    lines.push(`Everything closer than ${area.innerMiles} miles to the center has already been prospected — skip it.`);
  }
  lines.push(
    ``,
    `Size: about ${options.minEmployees}–${options.maxEmployees} employees.`,
    options.industryFocus
      ? `Industry focus (prefer these): ${options.industryFocus}`
      : `Industry focus: any MSP-fit industry from the qualified list.`,
    options.excludeChains
      ? `Exclude franchise locations and chains whose IT is run by a corporate parent.`
      : `Franchise locations are OK if the local owner likely buys their own IT.`
  );
  if (input.alreadyFound.length) {
    lines.push(``, `Already found (do not repeat): ${input.alreadyFound.slice(0, 250).join("; ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parsing the model's answer
// ---------------------------------------------------------------------------

// First balanced {...} that parses as JSON and has a "businesses" array.
// Tolerant of prose or code fences around it and of braces inside strings
// (same scanner shape as extractResearchJson).
export function extractSweepJson(raw: string): Record<string, unknown>[] | null {
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(raw.slice(start, i + 1));
            if (parsed && Array.isArray(parsed.businesses)) {
              return parsed.businesses.filter((b: unknown) => b && typeof b === "object" && !Array.isArray(b));
            }
          } catch {
            // not valid JSON from this start — try the next "{"
          }
          break;
        }
      }
    }
  }
  return null;
}

// Stable within-sweep identity for a business, so the same place found by
// two neighbouring search areas is stored once.
export function candidateKey(r: Pick<ResearchRecord, "companyName" | "address" | "zip">): string {
  const norm = (s: string | null | undefined) =>
    (s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(llc|inc|co|corp|pllc|pc|ltd|the)\b\.?/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const streetNumber = cleanStreetForGeocoding(r.address || "").match(/\d+/)?.[0] ?? "";
  return [norm(r.companyName), streetNumber, (r.zip || "").slice(0, 5)].join("|");
}

// ---------------------------------------------------------------------------
// Geocoding helpers (pure: build query strings, read responses)
// ---------------------------------------------------------------------------

// "22424 E Ellsworth Lp Rd" → "22424 E Ellsworth Loop Rd"; drops suite /
// unit designators wherever they appear, which the Census geocoder can't
// match on.
const UNIT_RE = /(?:#\s*[\w-]+|\b(?:ste|suite|unit|bldg|building|apt|rm|room|floor)\b\.?\s*#?\s*[\w-]+)/gi;

export function cleanStreetForGeocoding(street: string): string {
  return street
    .replace(UNIT_RE, " ")
    .replace(/\bLp\b\.?/gi, "Loop")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

// Cleans every comma-separated part and drops parts that were only a unit
// ("123 Main St, Suite 200, Mesa, AZ" → "123 Main St, Mesa, AZ").
export function cleanAddressLine(line: string): string {
  return line
    .split(",")
    .map((part) => cleanStreetForGeocoding(part))
    .filter(Boolean)
    .join(", ");
}

// "address" = matched to the building/address; "approximate" = only a
// street, town or ZIP could be matched (shown as a warning for the center);
// "manual" = coordinates typed by staff.
export type GeocodeQuality = "address" | "approximate" | "manual";
export type GeocodeStatus = "verified" | "unverified";

export function parseCensusMatch(json: unknown): (LatLng & { matched: string }) | null {
  const matches = (json as { result?: { addressMatches?: { coordinates?: { x?: number; y?: number }; matchedAddress?: string }[] } })
    ?.result?.addressMatches;
  const m = Array.isArray(matches) ? matches[0] : undefined;
  const x = Number(m?.coordinates?.x);
  const y = Number(m?.coordinates?.y);
  if (!m || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: y, lng: x, matched: String(m.matchedAddress || "") };
}

// Nominatim answers even when it can only find the street or the town, so
// how precise the match is matters: place_rank 26+ is a street-level match
// or finer, 30 is a house/building. Anything below 26 is approximate.
export function parseNominatimMatch(json: unknown): (LatLng & { matched: string; precise: boolean }) | null {
  const first = Array.isArray(json)
    ? (json[0] as { lat?: string; lon?: string; display_name?: string; place_rank?: number; addresstype?: string })
    : undefined;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!first || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rank = Number(first.place_rank);
  const precise =
    (Number.isFinite(rank) && rank >= 26) || ["house", "building", "amenity", "shop", "office"].includes(String(first.addresstype));
  return { lat, lng, matched: String(first.display_name || ""), precise };
}

// The ZIP at the end of an address ("…, Queen Creek, AZ 85142"), or right
// after a state code — never a 5-digit street number like "22424 E …".
export function trailingZip(address: string): string | null {
  const m = address.trim().match(/(?:\b[A-Za-z]{2}\s*,?\s*|,\s*)(\d{5})(?:-\d{4})?\s*$/);
  return m ? m[1] : null;
}

// Census "geographies/coordinates" → "near Gilbert, AZ (Maricopa County)".
export function parseCensusPlaceHint(json: unknown): string | null {
  const g = (json as { result?: { geographies?: Record<string, { NAME?: string; BASENAME?: string; STATE?: string }[]> } })?.result
    ?.geographies;
  if (!g) return null;
  const place = g["Incorporated Places"]?.[0]?.NAME || g["Census Designated Places"]?.[0]?.NAME || null;
  const county = g["Counties"]?.[0]?.NAME || null;
  if (!place && !county) return null;
  return `near ${[place, county && `(${county})`].filter(Boolean).join(" ")}`;
}

// The inner edge belongs to the previous ring (so 0–10 then 10–20 never
// double-counts a business at exactly 10 mi) — except for a full circle,
// where a business at the center itself counts.
export function isInRing(distanceMiles: number, innerMiles: number, outerMiles: number): boolean {
  if (distanceMiles > outerMiles) return false;
  return innerMiles === 0 ? distanceMiles >= 0 : distanceMiles > innerMiles;
}

// ---------------------------------------------------------------------------
// Prospect IDs + provenance
// ---------------------------------------------------------------------------

// "SW-0001"… — own prefix, separate from Research a business ("RS-") and
// the spreadsheet sweeps' "QC-" IDs (which only live in import notes).
export const SWEEP_ID_PREFIX = "SW-";

export function nextSweepProspectIds(existing: (string | null)[], count: number): string[] {
  let max = 0;
  for (const id of existing) {
    const m = id?.match(/^SW-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `${SWEEP_ID_PREFIX}${String(max + 1 + i).padStart(4, "0")}`);
}

export const SWEEP_LEAD_SOURCE = "Area sweep";

// Stored on customers.research.sweep (ResearchSnapshot) — also how the
// Prospects page's ?sweep=<id> filter finds "everything this sweep added".
export type SweepProvenance = {
  sweepId: string;
  centerAddress: string;
  center: LatLng;
  innerMiles: number;
  outerMiles: number;
  distanceMiles: number | null;
  direction: string | null;
  geocodeStatus: GeocodeStatus;
};

export function sweepNoteLines(s: SweepProvenance): string[] {
  return [
    s.distanceMiles !== null
      ? `Found by area sweep: ${s.distanceMiles.toFixed(1)} mi ${s.direction ?? ""} of ${s.centerAddress} (ring ${ringLabel(s.innerMiles, s.outerMiles)})`.replace(/\s+/g, " ")
      : `Found by area sweep around ${s.centerAddress} (ring ${ringLabel(s.innerMiles, s.outerMiles)}) — location not verified`,
  ];
}

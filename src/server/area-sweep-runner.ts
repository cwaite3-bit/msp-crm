// Server-only half of Prospects → "Area sweep" that does the slow, paid
// work: geocoding, the per-area Claude + web search call, and reading a
// sweep back for the dialog. Deliberately NOT a "use server" module — the
// per-area run is reached through a Route Handler
// (src/app/api/prospects/sweeps/[sweepId]/areas/[index]/route.ts) rather
// than a Server Action, because Next.js dispatches Server Actions one at a
// time per browser tab: two areas could never really run at once, and
// every other action on the page (review, list) would queue behind a
// call of up to 5 minutes.
//
// Pure logic (geometry, planning, prompt, parsing) is in
// src/server/area-sweep.ts; staff-facing actions (start, review, import)
// are in src/server/actions/area-sweep.ts.

import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { prospectSweepAreas, prospectSweepCandidates, prospectSweeps, users } from "@/server/db/schema";
import { resolveAnthropicModel } from "@/server/anthropic-model";
import { lookupEmailProvider } from "@/server/mx-lookup";
import { businessDomain, coerceResearchRecord, type ResearchRecord } from "@/server/prospect-research";
import {
  SWEEP_SYSTEM_PROMPT,
  WEB_SEARCHES_PER_AREA,
  bearingDegrees,
  buildSweepPrompt,
  candidateKey,
  cleanAddressLine,
  compassLabel,
  extractSweepJson,
  haversineMiles,
  isInRing,
  parseCensusMatch,
  parseCensusPlaceHint,
  parseNominatimMatch,
  trailingZip,
  type GeocodeQuality,
  type LatLng,
  type SearchArea,
  type SweepOptions,
} from "@/server/area-sweep";

// Sweeps are bulk work, so they get their own optional model override —
// e.g. ANTHROPIC_SWEEP_MODEL=<a Sonnet model> to cut cost — falling back to
// the same model as the app's other AI features.
export function sweepModel(): string {
  return process.env.ANTHROPIC_SWEEP_MODEL || resolveAnthropicModel();
}

// Timing inside one area run (the route's maxDuration is 300s): one overall
// deadline, Claude gets most of it, and geocoding/MX get whatever is left —
// anything not geocoded in time just stays "location not verified" rather
// than the whole paid search being lost to a platform timeout.
const RUN_BUDGET_MS = 270_000;
const CLAUDE_RESERVE_MS = 45_000; // kept back from Claude for geocoding + MX
const MAX_TOKENS = 16000;
const MAX_CONTINUATIONS = 4;
// A RUNNING area older than this was abandoned (past the 300s limit).
export const STALE_RUNNING_MS = 330_000;

// What staff get to review: inside the ring, or couldn't be placed on the
// map (their call). Verified-but-outside-the-ring results are kept only so
// a later search area doesn't re-find them.
export const reviewable = or(
  eq(prospectSweepCandidates.inRing, true),
  eq(prospectSweepCandidates.geocodeStatus, "unverified")
);

// ---------------------------------------------------------------------------
// Geocoding
//
// Businesses: US Census geocoder only (free, no key, no volume limits for
// this kind of use). An address it can't match is kept as "location not
// verified" for staff to judge, never silently dropped.
//
// The sweep's center: Census first, then one OpenStreetMap Nominatim lookup
// (much better on brand-new streets, like a lot of Queen Creek). That's a
// single request per sweep, well within Nominatim's usage policy (≤1/s,
// identify the app, credit OpenStreetMap) — which is also why Nominatim is
// not used for the bulk business lookups.
// ---------------------------------------------------------------------------

const CENSUS_BASE = "https://geocoding.geo.census.gov/geocoder";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = `LockdownIT-MSP-CRM/1.0 (prospect area sweep${process.env.NOMINATIM_EMAIL ? `; ${process.env.NOMINATIM_EMAIL}` : ""})`;

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function censusGeocode(line: string, timeoutMs = 8000) {
  const params = new URLSearchParams({ address: line, benchmark: "Public_AR_Current", format: "json" });
  return parseCensusMatch(await fetchJson(`${CENSUS_BASE}/locations/onelineaddress?${params}`, timeoutMs));
}

async function nominatimSearch(params: Record<string, string>) {
  const query = new URLSearchParams({ ...params, countrycodes: "us", format: "jsonv2", limit: "1" });
  if (process.env.NOMINATIM_EMAIL) query.set("email", process.env.NOMINATIM_EMAIL);
  return parseNominatimMatch(await fetchJson(`${NOMINATIM_BASE}?${query}`));
}

async function placeHintFor(point: LatLng): Promise<string | null> {
  const params = new URLSearchParams({
    x: String(point.lng),
    y: String(point.lat),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Incorporated Places,Census Designated Places,Counties",
    format: "json",
  });
  return parseCensusPlaceHint(await fetchJson(`${CENSUS_BASE}/geographies/coordinates?${params}`));
}

const OSM_CREDIT = " (map data © OpenStreetMap contributors)";

export async function geocodeCenter(
  address: string
): Promise<(LatLng & { matched: string; quality: GeocodeQuality }) | null> {
  const cleaned = cleanAddressLine(address);
  const census = await censusGeocode(cleaned);
  if (census) return { ...census, quality: "address" };

  const osm = await nominatimSearch({ q: cleaned });
  if (osm) return { lat: osm.lat, lng: osm.lng, matched: osm.matched + OSM_CREDIT, quality: osm.precise ? "address" : "approximate" };

  // Last resort: the ZIP's center — off by a mile or two, so the dialog
  // warns and offers a map link + manual coordinates.
  const zip = trailingZip(address);
  if (zip) {
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: ≤ 1 request/second
    const z = await nominatimSearch({ postalcode: zip });
    if (z) return { lat: z.lat, lng: z.lng, matched: `Center of ZIP ${zip}${OSM_CREDIT}`, quality: "approximate" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claude call (web search, pause_turn continuation, usage totals)
// ---------------------------------------------------------------------------

type ContentBlock = { type: string; text?: string; [key: string]: unknown };
type ApiResponse = {
  content?: ContentBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
};
export type Usage = { inputTokens: number; outputTokens: number; webSearches: number };

async function askClaude(prompt: string, model: string, apiKey: string, deadline: number): Promise<{ text: string; usage: Usage }> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: prompt }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  let finalText = "";
  let allText = "";

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 15_000) throw new Error("This search area ran out of time — retry it.");
    // max_uses applies per request, so a paused turn's continuation only
    // gets the searches this area hasn't used yet — the setup screen's
    // "up to N web searches" stays true.
    const searchesLeft = Math.max(0, WEB_SEARCHES_PER_AREA - usage.webSearches);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SWEEP_SYSTEM_PROMPT,
        messages,
        ...(searchesLeft > 0
          ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: searchesLeft }] }
          : {}),
      }),
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300) || response.statusText}`);
    }
    const data = (await response.json()) as ApiResponse;
    usage.inputTokens += data.usage?.input_tokens ?? 0;
    usage.outputTokens += data.usage?.output_tokens ?? 0;
    usage.webSearches += data.usage?.server_tool_use?.web_search_requests ?? 0;

    const content = data.content || [];
    // Citation-split text blocks are pieces of one answer — join with "".
    const text = content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("");
    allText += text;
    if (text) finalText = text;

    if (data.stop_reason === "max_tokens") {
      throw new Error("The answer for this area was cut off (output limit) — lower “businesses per area” and retry.");
    }
    if (data.stop_reason === "pause_turn") {
      if (attempt >= MAX_CONTINUATIONS) throw new Error("This search area took too many steps — retry it.");
      messages.push({ role: "assistant", content });
      continue;
    }
    break;
  }
  return { text: extractSweepJson(finalText) ? finalText : allText, usage };
}

// ---------------------------------------------------------------------------
// Reading a sweep back
// ---------------------------------------------------------------------------

export type SweepAreaView = {
  index: number;
  direction: string;
  innerMiles: number;
  outerMiles: number;
  placeHint: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  foundCount: number;
  usage: Usage | null;
};

export type SweepView = {
  id: string;
  centerAddress: string;
  centerMatched: string | null;
  centerQuality: GeocodeQuality;
  center: LatLng;
  innerMiles: number;
  outerMiles: number;
  options: SweepOptions;
  createdAt: string;
  createdByName: string | null;
  importedCount: number;
  candidateCount: number;
  areas: SweepAreaView[];
};

export async function loadSweepView(sweepId: string): Promise<SweepView | null> {
  const [s] = await db
    .select({ sweep: prospectSweeps, createdByName: users.name })
    .from(prospectSweeps)
    .leftJoin(users, eq(prospectSweeps.createdById, users.id))
    .where(eq(prospectSweeps.id, sweepId))
    .limit(1);
  if (!s) return null;
  const [areaRows, [count]] = await Promise.all([
    db.select().from(prospectSweepAreas).where(eq(prospectSweepAreas.sweepId, sweepId)).orderBy(prospectSweepAreas.index),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(prospectSweepCandidates)
      .where(and(eq(prospectSweepCandidates.sweepId, sweepId), reviewable)),
  ]);
  const now = Date.now();
  return {
    id: s.sweep.id,
    centerAddress: s.sweep.centerAddress,
    centerMatched: s.sweep.centerMatched,
    centerQuality: s.sweep.centerQuality as GeocodeQuality,
    center: { lat: Number(s.sweep.centerLat), lng: Number(s.sweep.centerLng) },
    innerMiles: Number(s.sweep.innerMiles),
    outerMiles: Number(s.sweep.outerMiles),
    options: s.sweep.options as SweepOptions,
    createdAt: s.sweep.createdAt.toISOString(),
    createdByName: s.createdByName,
    importedCount: s.sweep.importedCount,
    candidateCount: count?.n ?? 0,
    areas: areaRows.map((a) => {
      const plan = a.plan as SearchArea;
      // An area left RUNNING past the platform time limit reads as FAILED
      // (retryable).
      const stale = a.status === "RUNNING" && a.startedAt && now - a.startedAt.getTime() > STALE_RUNNING_MS;
      return {
        index: a.index,
        direction: plan.direction,
        innerMiles: plan.innerMiles,
        outerMiles: plan.outerMiles,
        placeHint: a.placeHint,
        status: (stale ? "FAILED" : a.status) as SweepAreaView["status"],
        error: stale ? "Interrupted — retry it." : a.error,
        foundCount: a.foundCount,
        usage: (a.usage as Usage | null) ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Run one search area
// ---------------------------------------------------------------------------

export type RunAreaResult = { ok: true; area: SweepAreaView } | { ok: false; error: string; status: number };

export async function runSweepAreaNow(sweepId: string, areaIndex: number): Promise<RunAreaResult> {
  const startedAt = Date.now();
  const deadline = startedAt + RUN_BUDGET_MS;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, status: 503, error: "Area sweep isn't configured yet — add ANTHROPIC_API_KEY in Vercel." };
  if (!Number.isInteger(areaIndex) || areaIndex < 0) return { ok: false, status: 400, error: "Invalid search area." };

  const [sweep] = await db.select().from(prospectSweeps).where(eq(prospectSweeps.id, sweepId)).limit(1);
  if (!sweep) return { ok: false, status: 404, error: "That sweep no longer exists." };

  // Claim the area atomically: only PENDING, FAILED, or abandoned RUNNING
  // areas can start, so a double click or a second tab can't pay for the
  // same area twice.
  const [claimed] = await db
    .update(prospectSweepAreas)
    .set({ status: "RUNNING", startedAt: new Date(startedAt), error: null })
    .where(
      and(
        eq(prospectSweepAreas.sweepId, sweep.id),
        eq(prospectSweepAreas.index, areaIndex),
        or(
          inArray(prospectSweepAreas.status, ["PENDING", "FAILED"]),
          and(eq(prospectSweepAreas.status, "RUNNING"), lt(prospectSweepAreas.startedAt, new Date(startedAt - STALE_RUNNING_MS)))
        )
      )
    )
    .returning();
  const currentArea = async () => (await loadSweepView(sweep.id))?.areas.find((a) => a.index === areaIndex) ?? null;
  if (!claimed) {
    const area = await currentArea();
    return area ? { ok: true, area } : { ok: false, status: 404, error: "That search area doesn't exist." };
  }

  const plan = claimed.plan as SearchArea;
  const options = sweep.options as SweepOptions;
  const center: LatLng = { lat: Number(sweep.centerLat), lng: Number(sweep.centerLng) };
  const innerMiles = Number(sweep.innerMiles);
  const outerMiles = Number(sweep.outerMiles);
  const model = sweepModel();
  const areaWhere = and(eq(prospectSweepAreas.sweepId, sweep.id), eq(prospectSweepAreas.index, plan.index));

  try {
    const records: ResearchRecord[] = [];
    const placeHint = claimed.placeHint ?? (await placeHintFor(plan.center));
    const already = await db
      .select({ name: sql<string>`${prospectSweepCandidates.record}->>'companyName'` })
      .from(prospectSweepCandidates)
      .where(eq(prospectSweepCandidates.sweepId, sweep.id));

    const prompt = buildSweepPrompt({
      centerAddress: sweep.centerAddress,
      centerPoint: center,
      area: plan,
      placeHint,
      options,
      alreadyFound: already.map((r) => r.name).filter(Boolean),
    });
    const { text, usage } = await askClaude(prompt, model, apiKey, deadline - CLAUDE_RESERVE_MS);
    const raw = extractSweepJson(text);
    if (!raw) throw new Error("The answer for this area came back in an unexpected format — retry it.");

    // Sanitize with the same format guards as Research a business, drop
    // anything without a street address (can't be placed on the map), and
    // collapse repeats within this answer.
    const seen = new Set<string>();
    for (const r of raw) {
      const rec = coerceResearchRecord(r);
      if (!rec.companyName || !rec.address) continue;
      const key = candidateKey(rec);
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(rec);
    }

    // Save what Claude found right away, as "not verified yet", and mark
    // the area DONE — the paid part is finished. Geocoding below only
    // upgrades these rows; if the platform cuts us off mid-way, staff
    // still have every result to review.
    let inserted: { id: string; record: unknown }[] = [];
    if (records.length) {
      inserted = await db
        .insert(prospectSweepCandidates)
        .values(
          records.map((rec) => ({
            sweepId: sweep.id,
            areaIndex: plan.index,
            key: candidateKey(rec),
            record: rec,
            geocodeStatus: "unverified",
            inRing: false,
            model,
          }))
        )
        .onConflictDoNothing()
        .returning({ id: prospectSweepCandidates.id, record: prospectSweepCandidates.record });
    }
    await db
      .update(prospectSweepAreas)
      .set({ status: "DONE", placeHint, foundCount: inserted.length, model, usage, error: null, finishedAt: new Date() })
      .where(areaWhere);

    // Place every business ourselves — the model's sense of "inside the
    // ring" is never trusted.
    let reviewableCount = 0;
    await mapLimit(inserted, 4, async (row) => {
      const rec = row.record as ResearchRecord;
      const left = deadline - Date.now();
      if (left < 3000) {
        reviewableCount++; // stays unverified (still reviewable)
        return;
      }
      const line = [rec.address, rec.city, [rec.state, rec.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const point = await censusGeocode(cleanAddressLine(line), Math.min(8000, left - 1000));
      if (!point) {
        reviewableCount++;
        const emailProvider = Date.now() < deadline - 6000 ? await lookupEmailProvider(businessDomain(rec)) : null;
        if (emailProvider) {
          await db.update(prospectSweepCandidates).set({ emailProvider }).where(eq(prospectSweepCandidates.id, row.id));
        }
        return;
      }
      const distance = haversineMiles(center, point);
      const inRing = isInRing(distance, innerMiles, outerMiles);
      if (inRing) reviewableCount++;
      const emailProvider = inRing && Date.now() < deadline - 6000 ? await lookupEmailProvider(businessDomain(rec)) : null;
      await db
        .update(prospectSweepCandidates)
        .set({
          lat: String(point.lat),
          lng: String(point.lng),
          distanceMiles: distance.toFixed(2),
          direction: compassLabel(bearingDegrees(center, point)),
          geocodeStatus: "verified",
          inRing,
          emailProvider,
        })
        .where(eq(prospectSweepCandidates.id, row.id));
    });

    await db.update(prospectSweepAreas).set({ foundCount: reviewableCount }).where(areaWhere);
    const area = await currentArea();
    return area ? { ok: true, area } : { ok: false, status: 404, error: "Sweep was deleted while this area ran." };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "This search area timed out — retry it."
        : err instanceof Error
          ? err.message
          : "This search area failed — retry it.";
    // Only an area whose results were never saved goes back to FAILED.
    await db
      .update(prospectSweepAreas)
      .set({ status: "FAILED", error: message.slice(0, 500), model, finishedAt: new Date() })
      .where(and(areaWhere, eq(prospectSweepAreas.status, "RUNNING")));
    const area = await currentArea();
    return area ? { ok: true, area } : { ok: false, status: 500, error: message };
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

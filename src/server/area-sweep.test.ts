// Run with: npx tsx --test src/server/area-sweep.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SEARCH_AREAS,
  bearingDegrees,
  candidateKey,
  cleanAddressLine,
  cleanStreetForGeocoding,
  compassLabel,
  destinationPoint,
  estimateSweep,
  extractSweepJson,
  haversineMiles,
  isInRing,
  nextSweepProspectIds,
  normalizeSweepOptions,
  parseCensusMatch,
  parseCensusPlaceHint,
  parseNominatimMatch,
  planSearchAreas,
  trailingZip,
  buildSweepPrompt,
  DEFAULT_SWEEP_OPTIONS,
} from "./area-sweep";
import { buildContactRows, buildResearchNote, coerceResearchRecord } from "./prospect-research";

const QUEEN_CREEK = { lat: 33.2487, lng: -111.6343 };

test("haversine: Queen Creek → downtown Phoenix is ~33 miles", () => {
  const phoenix = { lat: 33.4484, lng: -112.074 };
  const d = haversineMiles(QUEEN_CREEK, phoenix);
  assert.ok(d > 28 && d < 32, `got ${d}`);
});

test("destinationPoint round-trips distance and bearing", () => {
  for (const bearing of [0, 45, 135, 200, 315]) {
    const p = destinationPoint(QUEEN_CREEK, bearing, 15);
    assert.ok(Math.abs(haversineMiles(QUEEN_CREEK, p) - 15) < 0.01);
    const b = bearingDegrees(QUEEN_CREEK, p);
    const diff = Math.abs(((b - bearing + 540) % 360) - 180);
    assert.ok(diff < 0.5, `bearing ${bearing} came back ${b}`);
  }
});

test("compassLabel", () => {
  assert.equal(compassLabel(0), "N");
  assert.equal(compassLabel(359), "N");
  assert.equal(compassLabel(90), "E");
  assert.equal(compassLabel(225), "SW");
});

test("isInRing excludes the inner edge, includes the outer", () => {
  assert.equal(isInRing(10, 10, 20), false);
  assert.equal(isInRing(10.01, 10, 20), true);
  assert.equal(isInRing(20, 10, 20), true);
  assert.equal(isInRing(20.1, 10, 20), false);
  assert.equal(isInRing(0.5, 0, 10), true);
  assert.equal(isInRing(0, 0, 10), true); // same building as the center
});

test("planSearchAreas: 10–20 mi ring is one band of 8 wedges covering 360°", () => {
  const areas = planSearchAreas(QUEEN_CREEK, 10, 20);
  assert.equal(areas.length, 8);
  for (const a of areas) {
    assert.equal(a.innerMiles, 10);
    assert.equal(a.outerMiles, 20);
    const d = haversineMiles(QUEEN_CREEK, a.center);
    assert.ok(d > 10 && d < 20, `area center ${d} mi`);
  }
  const widths = areas.map((a) => (a.endBearing - a.startBearing + 360) % 360);
  assert.ok(Math.abs(widths.reduce((s, w) => s + w, 0) - 360) < 0.5);
});

test("planSearchAreas: 0–10 mi is four quadrants with centers inside the circle", () => {
  const areas = planSearchAreas(QUEEN_CREEK, 0, 10);
  assert.equal(areas.length, 4);
  for (const a of areas) assert.ok(haversineMiles(QUEEN_CREEK, a.center) < 10);
});

test("planSearchAreas: 0–50 mi is capped and still covers every band", () => {
  const areas = planSearchAreas(QUEEN_CREEK, 0, 50);
  assert.ok(areas.length <= MAX_SEARCH_AREAS, `${areas.length} areas`);
  const bands = new Set(areas.map((a) => `${a.innerMiles}-${a.outerMiles}`));
  assert.deepEqual([...bands], ["0-10", "10-20", "20-30", "30-40", "40-50"]);
});

test("planSearchAreas: a narrow 5–10 ring", () => {
  const areas = planSearchAreas(QUEEN_CREEK, 5, 10);
  assert.equal(areas.length, 4);
});

test("planSearchAreas: a thin outer sliver merges into the band inside it", () => {
  const areas = planSearchAreas(QUEEN_CREEK, 0, 13);
  assert.deepEqual([...new Set(areas.map((a) => `${a.innerMiles}-${a.outerMiles}`))], ["0-13"]);
  const wide = planSearchAreas(QUEEN_CREEK, 0, 75);
  assert.ok(wide.length <= MAX_SEARCH_AREAS);
  // Outer bands get at least as many areas as inner ones — never lopsided.
  const perBand = new Map<string, number>();
  for (const a of wide) perBand.set(`${a.innerMiles}`, (perBand.get(`${a.innerMiles}`) ?? 0) + 1);
  const counts = [...perBand.values()];
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], JSON.stringify([...perBand]));
});

test("normalizeSweepOptions validates the ring and clamps the rest", () => {
  assert.ok("error" in normalizeSweepOptions({ innerMiles: 20, outerMiles: 10 }));
  assert.ok("error" in normalizeSweepOptions({ innerMiles: 0, outerMiles: 0 }));
  assert.ok("error" in normalizeSweepOptions({ outerMiles: 500 }));
  const o = normalizeSweepOptions({ innerMiles: 10, outerMiles: 20, perAreaTarget: 99, minEmployees: 300, maxEmployees: 10 });
  assert.ok(!("error" in o));
  if ("error" in o) return;
  assert.equal(o.perAreaTarget, 20);
  assert.equal(o.minEmployees, 10);
  assert.equal(o.maxEmployees, 300);
  assert.equal(o.excludeChains, true);
});

test("estimateSweep scales with area count", () => {
  const e = estimateSweep(8, 10);
  assert.equal(e.maxWebSearches, 64);
  assert.equal(e.maxBusinesses, 80);
  assert.ok(e.costLow < e.costHigh);
});

test("buildSweepPrompt mentions the ring, the skip rule and the already-found names", () => {
  const [area] = planSearchAreas(QUEEN_CREEK, 10, 20);
  const p = buildSweepPrompt({
    centerAddress: "22424 E Ellsworth Loop Rd, Queen Creek, AZ 85142",
    centerPoint: QUEEN_CREEK,
    area,
    placeHint: "near Gilbert town, Arizona (Maricopa County)",
    options: { ...DEFAULT_SWEEP_OPTIONS, innerMiles: 10, outerMiles: 20 },
    alreadyFound: ["Acme Dental"],
  });
  assert.match(p, /between 10 and 20 miles/);
  assert.match(p, /closer than 10 miles/);
  assert.match(p, /Acme Dental/);
  assert.match(p, /Gilbert/);
});

test("extractSweepJson tolerates prose, fences and braces inside strings", () => {
  const raw = 'Here you go:\n```json\n{"businesses":[{"companyName":"A {B} Co","address":"1 Main St"},"junk",{"companyName":"C"}]}\n```';
  const out = extractSweepJson(raw);
  assert.equal(out?.length, 2);
  assert.equal(out?.[0].companyName, "A {B} Co");
  assert.equal(extractSweepJson("no json"), null);
  assert.equal(extractSweepJson('{"companyName":"single"}'), null);
});

test("candidateKey collapses formatting differences", () => {
  const a = candidateKey({ companyName: "The Smith Law Firm, PLLC", address: "123 N Main St Ste 4", zip: "85234-1111" });
  const b = candidateKey({ companyName: "Smith Law Firm", address: "123 North Main Street", zip: "85234" });
  assert.equal(a, b);
});

test("street cleanup for the geocoder", () => {
  assert.equal(cleanStreetForGeocoding("22424 E Ellsworth Lp Rd"), "22424 E Ellsworth Loop Rd");
  assert.equal(cleanStreetForGeocoding("1234 S Power Rd Suite 105"), "1234 S Power Rd");
  assert.equal(cleanStreetForGeocoding("50 W Main St #B-2"), "50 W Main St");
  assert.equal(cleanAddressLine("1 Main St Ste 2, Mesa, AZ 85201"), "1 Main St, Mesa, AZ 85201");
  assert.equal(cleanAddressLine("123 Main St, Suite 200, Mesa, AZ 85201"), "123 Main St, Mesa, AZ 85201");
  assert.equal(cleanAddressLine("9 Ocean Dr, Miami, FL 33101"), "9 Ocean Dr, Miami, FL 33101");
});

test("geocoder response parsers", () => {
  assert.deepEqual(
    parseCensusMatch({ result: { addressMatches: [{ matchedAddress: "X", coordinates: { x: -111.7, y: 33.3 } }] } }),
    { lat: 33.3, lng: -111.7, matched: "X" }
  );
  assert.equal(parseCensusMatch({ result: { addressMatches: [] } }), null);
  assert.equal(parseCensusMatch(null), null);
  assert.deepEqual(parseNominatimMatch([{ lat: "33.1", lon: "-111.5", display_name: "Y", place_rank: 30 }]), {
    lat: 33.1,
    lng: -111.5,
    matched: "Y",
    precise: true,
  });
  assert.equal(parseNominatimMatch([{ lat: "33.1", lon: "-111.5", place_rank: 16 }])?.precise, false); // a town
  assert.equal(parseNominatimMatch([]), null);
  assert.equal(
    parseCensusPlaceHint({
      result: { geographies: { "Incorporated Places": [{ NAME: "Gilbert town" }], Counties: [{ NAME: "Maricopa County" }] } },
    }),
    "near Gilbert town (Maricopa County)"
  );
  assert.equal(parseCensusPlaceHint({ result: { geographies: {} } }), null);
});

test("trailingZip never mistakes a street number for a ZIP", () => {
  assert.equal(trailingZip("22424 E Ellsworth Loop Rd, Queen Creek, AZ 85142"), "85142");
  assert.equal(trailingZip("22424 E Ellsworth Loop Rd, Queen Creek AZ"), null);
  assert.equal(trailingZip("Queen Creek AZ 85142-1234"), "85142");
});

test("candidateKey ignores suite numbers", () => {
  assert.equal(
    candidateKey({ companyName: "Acme", address: "Suite 5, 100 Main St", zip: "85201" }),
    candidateKey({ companyName: "Acme", address: "100 Main St", zip: "85201" })
  );
});

test("nextSweepProspectIds continues the SW- series and ignores other prefixes", () => {
  assert.deepEqual(nextSweepProspectIds(["SW-0009", "RS-0040", null, "QC-0100"], 2), ["SW-0010", "SW-0011"]);
  assert.deepEqual(nextSweepProspectIds([], 1), ["SW-0001"]);
});

test("research note carries the sweep line; contact rows pick a primary", () => {
  const record = coerceResearchRecord({
    companyName: "Gilbert Family Dental",
    address: "100 E Main St",
    decisionMaker: "Dr. Jane Roe",
    decisionMakerTitle: "Owner",
    additionalContacts: [{ name: "Jane Roe" }, { name: "Sam Lee", title: "Office Manager" }],
  });
  const rows = buildContactRows(record, "c1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isPrimary, true);
  assert.equal(rows[0].firstName, "Jane");
  assert.equal(rows[1].isPrimary, false);

  const note = buildResearchNote({
    record,
    emailProvider: null,
    model: "m",
    researchedAt: new Date("2026-10-08T12:00:00Z").toISOString(),
    prospectExternalId: "SW-0001",
    researchedById: "u",
    staffContext: null,
    lookupInput: { name: record.companyName, city: "", state: "", website: "", knownInfo: "" },
    sweep: {
      sweepId: "s1",
      centerAddress: "22424 E Ellsworth Loop Rd, Queen Creek, AZ 85142",
      center: QUEEN_CREEK,
      innerMiles: 10,
      outerMiles: 20,
      distanceMiles: 14.25,
      direction: "NW",
      geocodeStatus: "verified",
    },
  });
  assert.match(note, /Prospect ID: SW-0001/);
  assert.match(note, /Found by area sweep: 14\.3 mi NW of 22424 E Ellsworth Loop Rd/);
  assert.match(note, /ring 10–20 mi/);
});

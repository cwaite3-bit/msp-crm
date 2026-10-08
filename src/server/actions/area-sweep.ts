"use server";

// Prospects → "Area sweep". Staff enter a center address and a ring
// (e.g. 10–20 miles); the app splits the ring into search areas, asks
// Claude (Anthropic Messages API + server-side web_search, same hand-rolled
// fetch as ai-review.ts and prospect-research.ts) for qualified businesses
// in each one, then geocodes every address itself, keeps only the ones
// truly inside the ring, MX-checks them and holds them in
// prospect_sweep_candidates. Nothing becomes a prospect until staff tick it
// on the review list and click Import (importSweepCandidates).
//
// The per-area work (Claude call, geocoding) runs through a Route Handler,
// not a Server Action — see src/server/area-sweep-runner.ts for why. Pure
// logic (geometry, planning, prompt, parsing) is in src/server/area-sweep.ts.

import { and, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/server/db";
import {
  contacts,
  customers,
  notes,
  prospectSweepAreas,
  prospectSweepCandidates,
  prospectSweeps,
  users,
} from "@/server/db/schema";
import { getStateAssignments } from "@/server/actions/customers";
import {
  buildContactRows,
  buildResearchNote,
  coerceResearchRecord,
  employeeCountFromEstimate,
  findDuplicateMatches,
  type DuplicateMatch,
  type EmailProviderInfo,
  type ResearchRecord,
  type ResearchSnapshot,
} from "@/server/prospect-research";
import {
  SWEEP_LEAD_SOURCE,
  SWEEP_ID_PREFIX,
  nextSweepProspectIds,
  normalizeSweepOptions,
  planSearchAreas,
  type GeocodeQuality,
  type LatLng,
  type SweepOptions,
  type SweepProvenance,
} from "@/server/area-sweep";
import { geocodeCenter, loadSweepView, reviewable, sweepModel, type SweepView } from "@/server/area-sweep-runner";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

// One import call handles at most this many; the dialog sends bigger
// selections in batches.
const MAX_IMPORT_PER_CALL = 100;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Start a sweep
// ---------------------------------------------------------------------------

export type StartSweepInput = {
  address: string;
  manualLat?: number | null;
  manualLng?: number | null;
  options: Partial<SweepOptions>;
};

export async function startAreaSweep(input: StartSweepInput): Promise<Result<{ sweep: SweepView }>> {
  const user = await requireUser();
  const address = String(input.address || "").trim().slice(0, 300);
  if (!address) return { ok: false, error: "Enter the center address." };
  const options = normalizeSweepOptions(input.options || {});
  if ("error" in options) return { ok: false, error: options.error };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "Area sweep isn't configured yet — add ANTHROPIC_API_KEY in Vercel to enable it." };
  }

  let center: LatLng & { matched: string; quality: GeocodeQuality };
  const lat = Number(input.manualLat);
  const lng = Number(input.manualLng);
  if (input.manualLat != null && input.manualLng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "Those coordinates aren't valid." };
    center = { lat, lng, matched: "Coordinates entered by staff", quality: "manual" };
  } else {
    const found = await geocodeCenter(address);
    if (!found) {
      return {
        ok: false,
        error:
          "Couldn't find that address on the map. Check the spelling, or open “Use exact coordinates” and paste the latitude/longitude from Google Maps (right-click the spot → copy the numbers).",
      };
    }
    center = found;
  }

  const areas = planSearchAreas(center, options.innerMiles, options.outerMiles);
  const sweepId = await db.transaction(async (tx) => {
    const [sweep] = await tx
      .insert(prospectSweeps)
      .values({
        centerAddress: address,
        centerMatched: center.matched || null,
        centerQuality: center.quality,
        centerLat: String(center.lat),
        centerLng: String(center.lng),
        innerMiles: String(options.innerMiles),
        outerMiles: String(options.outerMiles),
        options,
        createdById: user.id,
      })
      .returning({ id: prospectSweeps.id });
    await tx.insert(prospectSweepAreas).values(areas.map((a) => ({ sweepId: sweep.id, index: a.index, plan: a })));
    return sweep.id;
  });

  const sweep = await loadSweepView(sweepId);
  return sweep ? { ok: true, sweep } : { ok: false, error: "Could not start the sweep — try again." };
}

export async function getAreaSweep(sweepId: string): Promise<Result<{ sweep: SweepView }>> {
  await requireUser();
  const sweep = await loadSweepView(String(sweepId));
  return sweep ? { ok: true, sweep } : { ok: false, error: "That sweep no longer exists." };
}

export type SweepSummary = {
  id: string;
  centerAddress: string;
  innerMiles: number;
  outerMiles: number;
  createdAt: string;
  createdByName: string | null;
  areasTotal: number;
  areasDone: number;
  candidateCount: number;
  importedCount: number;
  options: SweepOptions;
};

export async function listAreaSweeps(): Promise<SweepSummary[]> {
  await requireUser();
  const rows = await db
    .select({
      id: prospectSweeps.id,
      centerAddress: prospectSweeps.centerAddress,
      innerMiles: prospectSweeps.innerMiles,
      outerMiles: prospectSweeps.outerMiles,
      createdAt: prospectSweeps.createdAt,
      importedCount: prospectSweeps.importedCount,
      options: prospectSweeps.options,
      createdByName: users.name,
      areasTotal: sql<number>`(select count(*)::int from ${prospectSweepAreas} where ${prospectSweepAreas.sweepId} = ${prospectSweeps.id})`,
      areasDone: sql<number>`(select count(*)::int from ${prospectSweepAreas} where ${prospectSweepAreas.sweepId} = ${prospectSweeps.id} and ${prospectSweepAreas.status} = 'DONE')`,
      candidateCount: sql<number>`(select count(*)::int from ${prospectSweepCandidates} where ${prospectSweepCandidates.sweepId} = ${prospectSweeps.id} and (${prospectSweepCandidates.inRing} or ${prospectSweepCandidates.geocodeStatus} = 'unverified'))`,
    })
    .from(prospectSweeps)
    .leftJoin(users, eq(prospectSweeps.createdById, users.id))
    .orderBy(desc(prospectSweeps.createdAt))
    .limit(10);
  return rows.map((r) => ({
    ...r,
    innerMiles: Number(r.innerMiles),
    outerMiles: Number(r.outerMiles),
    createdAt: r.createdAt.toISOString(),
    options: r.options as SweepOptions,
  }));
}

export async function deleteAreaSweep(sweepId: string): Promise<Result<object>> {
  await requireUser();
  // Cascades to its areas and candidates. Prospects already imported from
  // it are real customers rows and are not touched.
  await db.delete(prospectSweeps).where(eq(prospectSweeps.id, String(sweepId)));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export type SweepCandidateView = {
  id: string;
  record: Pick<
    ResearchRecord,
    | "companyName"
    | "address"
    | "city"
    | "state"
    | "zip"
    | "industry"
    | "mainPhone"
    | "website"
    | "publicEmail"
    | "confidence"
    | "decisionMaker"
    | "decisionMakerTitle"
    | "employeeEstimate"
    | "qualificationNotes"
    | "complianceFrameworks"
    | "existingItProvider"
    | "talkingPoints"
  >;
  emailProvider: string | null;
  distanceMiles: number | null;
  direction: string | null;
  geocodeStatus: "verified" | "unverified";
  inRing: boolean;
  duplicates: DuplicateMatch[];
  importedCustomerId: string | null;
};

async function loadDuplicateCandidates() {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      website: customers.website,
      phone: customers.phone,
      status: customers.status,
      archivedAt: customers.archivedAt,
    })
    .from(customers);
}

export async function getSweepReview(sweepId: string): Promise<Result<{ candidates: SweepCandidateView[] }>> {
  await requireUser();
  const [rows, existing] = await Promise.all([
    db
      .select()
      .from(prospectSweepCandidates)
      .where(
        and(
          eq(prospectSweepCandidates.sweepId, String(sweepId)),
          reviewable
        )
      )
      .orderBy(prospectSweepCandidates.distanceMiles),
    loadDuplicateCandidates(),
  ]);

  const candidates = rows.map((c): SweepCandidateView => {
    const r = c.record as ResearchRecord;
    return {
      id: c.id,
      record: {
        companyName: r.companyName,
        address: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
        industry: r.industry,
        mainPhone: r.mainPhone,
        website: r.website,
        publicEmail: r.publicEmail,
        confidence: r.confidence,
        decisionMaker: r.decisionMaker,
        decisionMakerTitle: r.decisionMakerTitle,
        employeeEstimate: r.employeeEstimate,
        qualificationNotes: r.qualificationNotes,
        complianceFrameworks: r.complianceFrameworks,
        existingItProvider: r.existingItProvider,
        talkingPoints: r.talkingPoints,
      },
      emailProvider: (c.emailProvider as EmailProviderInfo | null)?.provider ?? null,
      distanceMiles: c.distanceMiles !== null ? Number(c.distanceMiles) : null,
      direction: c.direction,
      geocodeStatus: c.geocodeStatus as "verified" | "unverified",
      inRing: c.inRing,
      // Already-imported rows match the prospect they created — that's not
      // a duplicate worth warning about.
      duplicates: findDuplicateMatches(r, existing).filter((d) => d.id !== c.importedCustomerId),
      importedCustomerId: c.importedCustomerId,
    };
  });
  return { ok: true, candidates };
}

// ---------------------------------------------------------------------------
// Import (staff-approved)
// ---------------------------------------------------------------------------

export type ImportSweepInput = {
  sweepId: string;
  candidateIds: string[];
  // Candidates staff confirmed are different businesses despite a match.
  allowDuplicateIds: string[];
  owner: { mode: "territory" } | { mode: "unassigned" } | { mode: "staff"; ownerId: string };
};

export type ImportSweepResponse = Result<{ imported: number; skipped: { name: string; reason: string }[] }>;

export async function importSweepCandidates(input: ImportSweepInput): Promise<ImportSweepResponse> {
  const user = await requireUser();
  const sweepId = String(input.sweepId || "");
  const ids = Array.from(new Set((input.candidateIds || []).map(String)));
  if (!ids.length) return { ok: false, error: "Tick at least one business to import." };
  if (ids.length > MAX_IMPORT_PER_CALL) {
    return { ok: false, error: `Import at most ${MAX_IMPORT_PER_CALL} at a time.` };
  }
  const allowDup = new Set((input.allowDuplicateIds || []).map(String));

  const [sweep] = await db.select().from(prospectSweeps).where(eq(prospectSweeps.id, sweepId)).limit(1);
  if (!sweep) return { ok: false, error: "That sweep no longer exists." };

  let fixedOwner: string | null = null;
  const mode = input.owner?.mode ?? "territory";
  if (mode === "staff") {
    const ownerId = String((input.owner as { ownerId?: string }).ownerId || "");
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, ownerId), eq(users.active, true)))
      .limit(1);
    if (!owner) return { ok: false, error: "That staff member isn't active — pick someone else." };
    fixedOwner = owner.id;
  }
  const territory = mode === "territory" ? await getStateAssignments() : {};

  const rows = await db
    .select()
    .from(prospectSweepCandidates)
    .where(
      and(
        eq(prospectSweepCandidates.sweepId, sweep.id),
        inArray(prospectSweepCandidates.id, ids),
        isNull(prospectSweepCandidates.importedCustomerId)
      )
    )
    .orderBy(prospectSweepCandidates.distanceMiles);

  const existing = await loadDuplicateCandidates();
  const skipped: { name: string; reason: string }[] = [];
  const center: LatLng = { lat: Number(sweep.centerLat), lng: Number(sweep.centerLng) };
  const innerMiles = Number(sweep.innerMiles);
  const outerMiles = Number(sweep.outerMiles);

  const loadSweepIds = async () =>
    (
      await db
        .select({ id: customers.prospectExternalId })
        .from(customers)
        .where(and(isNotNull(customers.prospectExternalId), like(customers.prospectExternalId, `${SWEEP_ID_PREFIX}%`)))
    ).map((r) => r.id);
  let takenIds = await loadSweepIds();

  let imported = 0;
  for (const c of rows) {
    const record = coerceResearchRecord(c.record as Record<string, unknown>);
    if (!record.companyName) continue;
    const dups = findDuplicateMatches(record, existing);
    if (dups.length && !allowDup.has(c.id)) {
      skipped.push({ name: record.companyName, reason: `already in the CRM as ${dups[0].name}` });
      continue;
    }
    const ownerId = mode === "staff" ? fixedOwner : mode === "territory" ? (record.state && territory[record.state]) || null : null;

    const sweepInfo: SweepProvenance = {
      sweepId: sweep.id,
      centerAddress: sweep.centerAddress,
      center,
      innerMiles,
      outerMiles,
      distanceMiles: c.distanceMiles !== null ? Number(c.distanceMiles) : null,
      direction: c.direction,
      geocodeStatus: c.geocodeStatus as "verified" | "unverified",
    };

    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const [prospectExternalId] = nextSweepProspectIds(takenIds, 1);
      const snapshot: ResearchSnapshot = {
        record,
        emailProvider: (c.emailProvider as EmailProviderInfo | null) ?? null,
        model: c.model || sweepModel(),
        researchedAt: c.createdAt.toISOString(),
        prospectExternalId,
        researchedById: user.id,
        staffContext: null,
        lookupInput: { name: record.companyName, city: record.city || "", state: record.state || "", website: "", knownInfo: "" },
        sweep: sweepInfo,
      };
      try {
        const customerId = await db.transaction(async (tx) => {
          // Lock this candidate so two simultaneous imports (two staff, two
          // tabs) can't both turn it into a prospect.
          const [locked] = await tx
            .select({ id: prospectSweepCandidates.id })
            .from(prospectSweepCandidates)
            .where(and(eq(prospectSweepCandidates.id, c.id), isNull(prospectSweepCandidates.importedCustomerId)))
            .for("update");
          if (!locked) return null;
          const [customer] = await tx
            .insert(customers)
            .values({
              name: record.companyName,
              status: "PROSPECT",
              stage: "NEW",
              source: SWEEP_LEAD_SOURCE,
              accountOwnerId: ownerId,
              industry: record.industry,
              website: record.website,
              phone: record.mainPhone,
              publicEmail: record.publicEmail,
              employeeCount: employeeCountFromEstimate(record.employeeEstimate),
              researchConfidence: record.confidence,
              billingStreet: record.address,
              billingCity: record.city,
              billingState: record.state,
              billingZip: record.zip,
              prospectExternalId,
              research: snapshot,
            })
            .returning({ id: customers.id });
          const contactRows = buildContactRows(record, customer.id);
          if (contactRows.length) await tx.insert(contacts).values(contactRows);
          await tx.insert(notes).values({
            customerId: customer.id,
            authorId: user.id,
            type: "NOTE",
            body: buildResearchNote(snapshot),
          });
          await tx
            .update(prospectSweepCandidates)
            .set({ importedCustomerId: customer.id })
            .where(eq(prospectSweepCandidates.id, c.id));
          return customer.id;
        });
        done = true;
        if (!customerId) continue; // another import got to it first
        takenIds.push(prospectExternalId);
        existing.push({
          id: customerId,
          name: record.companyName,
          website: record.website,
          phone: record.mainPhone,
          status: "PROSPECT",
          archivedAt: null,
        });
        imported++;
      } catch (err) {
        const code =
          (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (code === "23505" && attempt < 2) {
          takenIds = await loadSweepIds(); // someone else took that SW- number
          continue;
        }
        skipped.push({ name: record.companyName, reason: err instanceof Error ? err.message.slice(0, 200) : "failed to save" });
        done = true;
      }
    }
  }

  if (imported) {
    await db
      .update(prospectSweeps)
      .set({ importedCount: sql`${prospectSweeps.importedCount} + ${imported}`, importedAt: new Date() })
      .where(eq(prospectSweeps.id, sweep.id));
  }
  revalidatePath("/prospects");
  revalidatePath("/customers");
  return { ok: true, imported, skipped };
}

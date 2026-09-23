"use server";

import { db } from "@/server/db";
import { customers, contacts, notes, users, appSettings, quotes } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, asc, ilike, or, isNull, isNotNull, inArray, gte, lte, sql, exists } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import * as XLSX from "xlsx";
import { PROSPECT_STAGES, SIZE_BUCKETS, type ProspectStage, type SizeBucketValue } from "@/lib/prospect";
import { formatDate, normalizeState } from "@/lib/utils";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

const customerSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  status: z.enum(["LEAD", "PROSPECT", "ACTIVE", "FORMER"]).default("LEAD"),
  stage: z.enum(PROSPECT_STAGES).optional(),
  estimatedMonthlyValue: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
  lostReason: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  publicEmail: z.string().optional(),
  source: z.string().optional(),
  employeeCount: z.coerce.number().int().optional(),
  billingStreet: z.string().optional(),
  billingCity: z.string().optional(),
  billingState: z.string().optional(),
  billingZip: z.string().optional(),
  researchConfidence: z.string().optional(),
  contactFirstName: z.string().optional(),
  contactLastName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  contactTitle: z.string().optional(),
});

export async function createCustomer(formData: FormData) {
  await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerSchema.parse(raw);

  const [customer] = await db
    .insert(customers)
    .values({
      name: parsed.name,
      status: parsed.status,
      stage: parsed.stage || null,
      estimatedMonthlyValue: parsed.estimatedMonthlyValue || null,
      nextFollowUpAt: parsed.nextFollowUpAt ? new Date(parsed.nextFollowUpAt) : null,
      lostReason: parsed.lostReason || null,
      industry: parsed.industry || null,
      website: parsed.website || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      publicEmail: parsed.publicEmail || null,
      source: parsed.source || null,
      employeeCount: parsed.employeeCount || null,
      billingStreet: parsed.billingStreet || null,
      billingCity: parsed.billingCity || null,
      billingState: parsed.billingState ? normalizeState(parsed.billingState) : null,
      billingZip: parsed.billingZip || null,
      researchConfidence: parsed.researchConfidence || null,
    })
    .returning();

  if (parsed.contactFirstName || parsed.contactLastName) {
    await db.insert(contacts).values({
      customerId: customer.id,
      firstName: parsed.contactFirstName || "",
      lastName: parsed.contactLastName || "",
      email: parsed.contactEmail || null,
      phone: parsed.contactPhone || null,
      title: parsed.contactTitle || null,
      isPrimary: true,
    });
  }

  revalidatePath("/customers");
  revalidatePath("/prospects");
  redirect(`/customers/${customer.id}`);
}

export async function updateCustomer(customerId: string, formData: FormData) {
  await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerSchema
    .omit({
      contactFirstName: true,
      contactLastName: true,
      contactEmail: true,
      contactPhone: true,
      contactTitle: true,
    })
    .partial()
    .parse(raw);

  await db
    .update(customers)
    .set({
      ...parsed,
      employeeCount: parsed.employeeCount || null,
      // Tri-state: only touch these when the field was actually present in
      // the submitted form (Drizzle drops undefined-valued keys from the
      // SET clause). Both are only shown on the form while status is
      // PROSPECT, so a plain customer edit must leave already-recorded
      // pipeline data alone instead of clobbering it to null every save.
      estimatedMonthlyValue: parsed.estimatedMonthlyValue !== undefined ? parsed.estimatedMonthlyValue || null : undefined,
      nextFollowUpAt: parsed.nextFollowUpAt ? new Date(parsed.nextFollowUpAt) : parsed.nextFollowUpAt === "" ? null : undefined,
      billingState: parsed.billingState !== undefined ? normalizeState(parsed.billingState) || null : undefined,
      // Tri-state too: researchConfidence isn't on the general edit form, so
      // an edit that doesn't submit it must leave whatever import set alone.
      researchConfidence: parsed.researchConfidence !== undefined ? parsed.researchConfidence || null : undefined,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/prospects");
}

// Scoped to actually-won accounts — ACTIVE now, or FORMER (won, then
// churned) — since Leads and Prospects have their own screen (see
// WORKING_STATUSES below). `showArchived` flips the list rather than
// merging it in — archived customers are meant to be out of the way
// day-to-day, so a search normally excludes them, and asking for the
// archived view shows only those (with a way back via unarchiveCustomer)
// rather than mixing the two together.
const WON_STATUSES = ["ACTIVE", "FORMER"] as const;

export async function searchCustomers(query: string, showArchived = false) {
  await requireUser();
  const trimmed = query.trim();
  const archivedCondition = showArchived ? isNotNull(customers.archivedAt) : isNull(customers.archivedAt);
  const conditions = trimmed
    ? and(
        inArray(customers.status, WON_STATUSES),
        archivedCondition,
        or(
          ilike(customers.name, `%${trimmed}%`),
          ilike(customers.email, `%${trimmed}%`),
          ilike(customers.phone, `%${trimmed}%`),
          ilike(customers.industry, `%${trimmed}%`)
        )
      )
    : and(inArray(customers.status, WON_STATUSES), archivedCondition);

  return db.select().from(customers).where(conditions).orderBy(desc(customers.createdAt)).limit(100);
}

// Counts archived customers so the list page can show "Show archived (3)"
// instead of a bare toggle with no idea what's behind it. Scoped to the same
// won statuses searchCustomers shows, so the count matches what "Archived"
// will actually reveal — an archived Lead/Prospect belongs to (and counts
// on) the Prospects screen's own Archived view instead.
export async function countArchivedCustomers(): Promise<number> {
  await requireUser();
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(inArray(customers.status, WON_STATUSES), isNotNull(customers.archivedAt)));
  return rows.length;
}

// Soft-delete: hides a customer/prospect from the lists without touching
// its data. Deliberately not a real DELETE — a customer with quotes already
// attached would fail on the quotes.customerId foreign key anyway, and even
// for one with no quotes, permanently losing contacts/notes/history is
// rarely what "get this out of my list" actually means. Fully reversible
// via unarchiveCustomer.
export async function archiveCustomer(customerId: string) {
  const user = await requireUser();
  await db.update(customers).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(customers.id, customerId));
  await db.insert(notes).values({ customerId, authorId: user.id, type: "NOTE", body: "Archived." });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/prospects");
}

export async function unarchiveCustomer(customerId: string) {
  const user = await requireUser();
  await db.update(customers).set({ archivedAt: null, updatedAt: new Date() }).where(eq(customers.id, customerId));
  await db.insert(notes).values({ customerId, authorId: user.id, type: "NOTE", body: "Unarchived." });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/prospects");
}

// ---- Prospects ----
// Prospects aren't a separate table — they're just customers with
// status="PROSPECT" or "LEAD" (see customerStatusEnum in schema.ts). That
// means a prospect already gets contacts, notes/activity, and quotes for
// free the moment it needs them, and "converting" one is nothing more than
// changing its status — nothing to copy or migrate. `stage` tracks where in
// the sales pipeline a prospect sits, independent of that status.
//
// LEAD and PROSPECT both mean "hasn't been won yet" and share this same
// screen — LEAD is just the earlier, less-qualified end of the same
// pipeline (e.g. raw inbound interest from the public intake form). Only
// ACTIVE/FORMER — actually won, now or in the past — show on the Customers
// screen instead (see searchCustomers below).
const WORKING_STATUSES = ["LEAD", "PROSPECT"] as const;

export type ProspectFilters = {
  state?: string;
  stage?: ProspectStage;
  industry?: string;
  size?: SizeBucketValue;
  ownerId?: string; // a real users.id, or the sentinel "unassigned"
  sort?: "confidence" | "createdAt";
  dir?: "asc" | "desc";
  // Same show-only-that-view convention as searchCustomers — the Prospects
  // list excludes archived rows unless this is explicitly requested.
  archived?: boolean;
  // "Only ones I can actually reach out to" filters — handy right after an
  // enrichment import (see importProspects' updateExisting) to pull up just
  // the records that now have a phone/email, or conversely still don't.
  // Every write path in this file stores an empty field as null rather than
  // "", so isNotNull is enough here without a separate blank-string check.
  hasEmail?: boolean;
  hasPhone?: boolean;
  // Any quote ever marked Sent for this prospect (quotes.sentAt is set on
  // "Mark as sent" and stays set through Viewed/Accepted/Rejected — only
  // resetQuote clears it back to null). Lets staff pull up who they've
  // already quoted, separate from who's still pre-quote.
  quoteSent?: boolean;
};

// High/Medium/Low doesn't sort meaningfully as text, so rank it numerically
// for ORDER BY — unrecognized/blank values sort last regardless of
// direction, rather than alphabetically wherever "Unknown" would happen to
// fall.
const CONFIDENCE_RANK = sql<number>`case lower(${customers.researchConfidence})
  when 'high' then 3
  when 'medium' then 2
  when 'low' then 1
  else 0
end`;

// Resolves a SIZE_BUCKETS value into the employeeCount range condition it
// represents — "unknown" means no employeeCount was ever recorded (the
// common case for a research import whose size column was qualitative text
// rather than a clean numeric range; see parseEmployeeEstimate below).
function sizeBucketCondition(size: SizeBucketValue) {
  if (size === "unknown") return isNull(customers.employeeCount);
  const bucket = SIZE_BUCKETS.find((b) => b.value === size);
  if (!bucket || bucket.min === null) return undefined;
  return bucket.max !== null
    ? and(gte(customers.employeeCount, bucket.min), lte(customers.employeeCount, bucket.max))
    : gte(customers.employeeCount, bucket.min);
}

export async function searchProspects(query: string, filters: ProspectFilters = {}) {
  await requireUser();
  const trimmed = query.trim();

  const conditions = [
    inArray(customers.status, WORKING_STATUSES),
    filters.archived ? isNotNull(customers.archivedAt) : isNull(customers.archivedAt),
  ];
  if (trimmed) {
    conditions.push(
      or(
        ilike(customers.name, `%${trimmed}%`),
        ilike(customers.email, `%${trimmed}%`),
        ilike(customers.phone, `%${trimmed}%`),
        ilike(customers.industry, `%${trimmed}%`)
      )!
    );
  }
  if (filters.state) conditions.push(eq(customers.billingState, filters.state));
  if (filters.stage) conditions.push(eq(customers.stage, filters.stage));
  if (filters.industry) conditions.push(eq(customers.industry, filters.industry));
  if (filters.size) {
    const sizeCondition = sizeBucketCondition(filters.size);
    if (sizeCondition) conditions.push(sizeCondition);
  }
  if (filters.ownerId === "unassigned") conditions.push(isNull(customers.accountOwnerId));
  else if (filters.ownerId) conditions.push(eq(customers.accountOwnerId, filters.ownerId));
  if (filters.hasEmail) conditions.push(or(isNotNull(customers.email), isNotNull(customers.publicEmail))!);
  if (filters.hasPhone) conditions.push(isNotNull(customers.phone));
  if (filters.quoteSent) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(quotes)
          .where(and(eq(quotes.customerId, customers.id), isNotNull(quotes.sentAt)))
      )
    );
  }

  const orderBy =
    filters.sort === "confidence"
      ? filters.dir === "asc"
        ? asc(CONFIDENCE_RANK)
        : desc(CONFIDENCE_RANK)
      : desc(customers.createdAt);

  return db
    .select({
      id: customers.id,
      name: customers.name,
      stage: customers.stage,
      estimatedMonthlyValue: customers.estimatedMonthlyValue,
      nextFollowUpAt: customers.nextFollowUpAt,
      source: customers.source,
      industry: customers.industry,
      phone: customers.phone,
      billingStreet: customers.billingStreet,
      billingCity: customers.billingCity,
      billingState: customers.billingState,
      billingZip: customers.billingZip,
      researchConfidence: customers.researchConfidence,
      accountOwnerId: customers.accountOwnerId,
      ownerName: users.name,
      archivedAt: customers.archivedAt,
      // Same "any quote ever marked Sent" definition as the quoteSent filter
      // above — drives the "Quote sent" badge on the Prospects list so staff
      // can tell at a glance who's already been quoted, without needing the
      // filter checkbox on.
      quoteSent: sql<boolean>`exists (select 1 from ${quotes} where ${quotes.customerId} = ${customers.id} and ${quotes.sentAt} is not null)`,
    })
    .from(customers)
    .leftJoin(users, eq(customers.accountOwnerId, users.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(200);
}

// Distinct filter-dropdown option values, scoped to actual working (Lead or
// Prospect) rows so the State/Industry filters never offer a choice that
// would return zero results.
export async function listProspectFilterOptions() {
  await requireUser();
  const [states, industries] = await Promise.all([
    db
      .selectDistinct({ value: customers.billingState })
      .from(customers)
      .where(and(inArray(customers.status, WORKING_STATUSES), isNull(customers.archivedAt), isNotNull(customers.billingState))),
    db
      .selectDistinct({ value: customers.industry })
      .from(customers)
      .where(and(inArray(customers.status, WORKING_STATUSES), isNull(customers.archivedAt), isNotNull(customers.industry))),
  ]);
  return {
    states: states.map((s) => s.value).filter((v): v is string => !!v).sort(),
    industries: industries.map((s) => s.value).filter((v): v is string => !!v).sort(),
  };
}

// Assigns (or, passing null, unassigns) which staff member owns working a
// prospect. Kept as its own action — rather than folding into the general
// updateCustomer — so the Prospects list's row-level "Assign to" dropdown
// can reassign in one click without going through the full edit form.
export async function assignProspectOwner(customerId: string, ownerId: string | null) {
  await requireUser();
  await db.update(customers).set({ accountOwnerId: ownerId, updatedAt: new Date() }).where(eq(customers.id, customerId));
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/prospects");
}

// ---- Territory (state → staff) assignment rules ----
// A standing rule, e.g. "AZ → John", so every prospect imported into that
// state is pre-assigned to the right staff member automatically instead of
// landing Unassigned every time (see importProspects). Stored in the
// generic app_settings jsonb store — the same pattern settings.ts uses for
// pricingRateCard/msaSettings/etc. — rather than a dedicated table, since
// it's just a small { state: ownerId } map with no independent lifecycle
// of its own. Keys are normalized 2-letter state codes (see normalizeState).
const STATE_ASSIGNMENTS_KEY = "prospectStateAssignments";

export async function getStateAssignments(): Promise<Record<string, string>> {
  await requireUser();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, STATE_ASSIGNMENTS_KEY)).limit(1);
  return (row?.value as Record<string, string>) || {};
}

export async function updateStateAssignments(assignments: Record<string, string>) {
  await requireUser();
  await db
    .insert(appSettings)
    .values({ key: STATE_ASSIGNMENTS_KEY, value: assignments })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: assignments, updatedAt: new Date() } });
  revalidatePath("/prospects");
}

// Moves along with a territory rule when it *changes* — e.g. AZ was "John",
// now it's "Sarah" (or cleared entirely) — by reassigning only the
// prospects currently owned by the rule's *previous* assignee. That's a
// deliberate middle ground: it undoes what the old rule did (or clearing it
// undoes what it did), but leaves alone any AZ prospect someone reassigned
// to a third person by hand, since those no longer match `fromOwnerId` and
// were never really "owned by the rule" to begin with.
export async function reassignStateOwner(state: string, fromOwnerId: string, toOwnerId: string | null) {
  await requireUser();
  await db
    .update(customers)
    .set({ accountOwnerId: toOwnerId, updatedAt: new Date() })
    .where(
      and(
        inArray(customers.status, WORKING_STATUSES),
        eq(customers.billingState, state),
        eq(customers.accountOwnerId, fromOwnerId)
      )
    );
  revalidatePath("/prospects");
}

// Manual escape hatch for a state whose rule was already "No default owner"
// *before* reassignStateOwner existed — e.g. cleared once with the old
// Save button, which never actually moved anyone. Because the stored rule
// already reads as unassigned, there's no old-vs-new delta left for
// handleSave to react to, so those leftover owners can never un-stick
// themselves through a normal Save. This clears the owner from EVERY
// prospect in the state, including ones assigned by hand — it's an
// explicit, confirmed action for exactly that stuck case, not something
// that runs automatically.
export async function clearStateOwner(state: string): Promise<{ updated: number }> {
  await requireUser();
  const result = await db
    .update(customers)
    .set({ accountOwnerId: null, updatedAt: new Date() })
    .where(and(inArray(customers.status, WORKING_STATUSES), eq(customers.billingState, state)))
    .returning({ id: customers.id });
  revalidatePath("/prospects");
  return { updated: result.length };
}

// Catches up prospects that were imported *before* a territory rule existed
// for their state. Only ever fills in an owner where one isn't already set
// — it never overwrites a prospect someone has already (re)assigned by
// hand, so running this after tweaking the rules is always safe to repeat.
export async function applyStateAssignmentsToExisting(): Promise<{ updated: number }> {
  await requireUser();
  const assignments = await getStateAssignments();
  let updated = 0;
  for (const [state, ownerId] of Object.entries(assignments)) {
    if (!ownerId) continue;
    const result = await db
      .update(customers)
      .set({ accountOwnerId: ownerId, updatedAt: new Date() })
      .where(and(inArray(customers.status, WORKING_STATUSES), eq(customers.billingState, state), isNull(customers.accountOwnerId)))
      .returning({ id: customers.id });
    updated += result.length;
  }
  revalidatePath("/prospects");
  return { updated };
}

// One-time catch-up for prospects imported before researchConfidence
// existed as a real column (see importProspects) — for those, "Confidence:
// High" only ever made it into the free-text research note, never into a
// field the Prospects list can display or sort by. This recovers it by
// reading that exact line back out of each prospect's notes. Safe to
// re-run any time — it only ever looks at prospects with no
// researchConfidence set yet, and never touches ones already filled in
// (by this, by import, or typed in by hand).
export async function backfillConfidenceFromNotes(): Promise<{ updated: number }> {
  await requireUser();
  const candidates = await db
    .select({ id: customers.id })
    .from(customers)
    .where(isNull(customers.researchConfidence));

  let updated = 0;
  for (const { id } of candidates) {
    const customerNotes = await db.select({ body: notes.body }).from(notes).where(eq(notes.customerId, id));
    let confidence: string | null = null;
    for (const note of customerNotes) {
      const match = note.body.match(/^Confidence:\s*(.+)$/m);
      if (match) {
        confidence = match[1].trim();
        break;
      }
    }
    if (confidence) {
      await db.update(customers).set({ researchConfidence: confidence, updatedAt: new Date() }).where(eq(customers.id, id));
      updated++;
    }
  }
  revalidatePath("/prospects");
  return { updated };
}

export type BackfillConfidenceFileResult = {
  ok: boolean;
  updated: number;
  skipped: number;
  errors: string[];
};

// Same recovery problem as backfillConfidenceFromNotes, for the batches
// where that one comes up empty — some early imports never wrote a
// research note at all (they predate that formatting), so there's nothing
// in the database to recover Confidence from. This re-reads the *original*
// spreadsheet instead and matches rows back to existing prospects by
// company name (same normalization importProspects uses for its own
// duplicate check), filling in researchConfidence wherever it's still
// blank. It never creates new prospects and never overwrites a
// researchConfidence that's already set — by import, by
// backfillConfidenceFromNotes, or typed in by hand — so re-running this
// with the same file, or a file covering other states, is always safe.
export async function backfillConfidenceFromFile(formData: FormData): Promise<BackfillConfidenceFileResult> {
  await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, updated: 0, skipped: 0, errors: ["No file was uploaded"] };
  }

  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { ok: false, updated: 0, skipped: 0, errors: ["The file has no sheets"] };
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });
  } catch {
    return { ok: false, updated: 0, skipped: 0, errors: ["Could not read that file — is it a valid .xlsx or .csv?"] };
  }

  const existing = await db
    .select({ id: customers.id, name: customers.name, researchConfidence: customers.researchConfidence })
    .from(customers);
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header is row 1 in the spreadsheet
    const name = pickField(row, ["company", "company name", "name", "business", "business name", "organization", "account name"]);
    const confidence = pickField(row, ["confidence", "research confidence"]);
    if (!name) {
      skipped++;
      continue;
    }
    const match = byName.get(name.trim().toLowerCase());
    if (!match) {
      skipped++;
      errors.push(`Row ${rowNum}: no existing prospect named "${name}" — skipped`);
      continue;
    }
    if (!confidence) {
      skipped++;
      continue;
    }
    if (match.researchConfidence) {
      skipped++; // already has a value — never overwrite
      continue;
    }
    await db.update(customers).set({ researchConfidence: confidence, updatedAt: new Date() }).where(eq(customers.id, match.id));
    updated++;
  }

  revalidatePath("/prospects");
  return { ok: true, updated, skipped, errors };
}

// Moves a prospect through the pipeline. `lostReason` only sticks when the
// stage being set is LOST — moving off Lost later (re-opening a prospect)
// clears whatever reason was recorded, since it no longer applies.
export async function updateProspectStage(customerId: string, stage: ProspectStage, lostReason?: string) {
  await requireUser();
  await db
    .update(customers)
    .set({
      stage,
      lostReason: stage === "LOST" ? lostReason?.trim() || null : null,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/prospects");
}

// The actual "graduate this prospect" action — status is what moves it off
// the Prospects page and onto Leads/Customers; converting to a full
// Customer also marks the pipeline stage WON, since that's what closing the
// deal means. Converting to Lead leaves stage alone (still qualifying, not
// won yet). Logs an activity note so the handoff shows up in that
// customer's own history, the same place staff already look for it.
export async function convertProspectStatus(customerId: string, target: "LEAD" | "ACTIVE") {
  const user = await requireUser();
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) throw new Error("Prospect not found");

  await db
    .update(customers)
    .set({
      status: target,
      ...(target === "ACTIVE" ? { stage: "WON" as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  await db.insert(notes).values({
    customerId,
    authorId: user.id,
    type: "NOTE",
    body: `Converted from Prospect to ${target === "ACTIVE" ? "Customer" : "Lead"}.`,
  });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/prospects");
  revalidatePath("/customers");
}

// Looks up a value in a spreadsheet row by trying several possible header
// spellings, case/whitespace-insensitively — an uploaded prospect list is
// never going to use this app's exact internal field names, so import has
// to be forgiving about "Company", "Company Name", "Business Name", etc.
// all meaning the same thing.
function pickField(row: Record<string, unknown>, aliases: string[]): string {
  const normalizedRow = new Map(Object.keys(row).map((k) => [k.trim().toLowerCase(), row[k]]));
  for (const alias of aliases) {
    const value = normalizedRow.get(alias);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function matchStage(raw: string): ProspectStage {
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const found = PROSPECT_STAGES.find((s) => s === key || key.startsWith(s));
  return found || "NEW";
}

// Best-effort numeric read on a size column that's often qualitative text
// ("Small agency", "Multi-staff practice") rather than a clean range — only
// ever used to bucket prospects for the size filter (see SIZE_BUCKETS in
// lib/prospect.ts), never displayed as if it were a verified headcount. A
// range like "11-50" or "51-200 organization-wide" resolves to its low end
// (conservative, and lines up with the filter buckets' own boundaries); a
// single number or "500+" resolves to that number; anything with no digits
// at all (the majority of rows in a typical research export) returns null,
// which the size filter surfaces as "Unknown size" rather than guessing.
function parseEmployeeEstimate(raw: string): number | null {
  if (!raw) return null;
  const rangeMatch = raw.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)/i);
  if (rangeMatch) return Number(rangeMatch[1].replace(/,/g, ""));
  const singleMatch = raw.match(/(\d[\d,]*)\s*\+?/);
  if (singleMatch) return Number(singleMatch[1].replace(/,/g, ""));
  return null;
}

export type ImportProspectsResult = {
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
};

// Everything importProspects reads out of one spreadsheet row, before it
// decides whether that row becomes a brand-new prospect (insertProspectRow
// path below) or gets merged into an existing one (the updateExisting path).
// Pulled out on its own so both paths parse a row exactly the same way —
// re-running the same file through the "update existing" path should never
// disagree with what a fresh import of it would have created.
type ParsedProspectRow = {
  name: string;
  stage: ProspectStage;
  estimatedValue: string; // digits/decimal only, "" if none on the row
  nextFollowUpAt: Date | null;
  employeeCount: number | null;
  industry: string;
  website: string;
  phone: string;
  email: string;
  publicEmail: string;
  source: string;
  billingStreet: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  researchConfidence: string;
  researchNote: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  contactTitle: string;
};

// First line of every research note the importer writes — also how the
// "update existing" path recognizes a note it wrote itself (see
// importProspects), so it can refresh that note on a re-import without ever
// touching notes staff typed.
const RESEARCH_NOTE_TITLE = "Prospect research (imported)";

// Turns a cell like "Privately owned hospital; CT, ultrasound, lab; 7-day
// operation" into one bullet per point, so a research note reads as a list
// instead of a run-on line. A value with only one point stays plain text.
function asPoints(value: string): string {
  const points = value
    .split(/\s*;\s*|\r?\n/)
    .map((p) => p.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return points.length > 1 ? points.map((p) => `• ${p}`).join("\n") : value.trim();
}

function parseProspectRow(row: Record<string, unknown>, batchResearchedAt: Date | null): ParsedProspectRow {
  // Every alias looked up below is recorded, so any column the importer has
  // no specific use for still lands in the note's "Other details" section
  // instead of being silently dropped.
  const knownHeaders = new Set<string>();
  const pick = (aliases: string[]) => {
    for (const a of aliases) knownHeaders.add(a);
    return pickField(row, aliases);
  };

  const name = pick(["company", "company name", "name", "business", "business name", "organization", "account name"]);
  const stageRaw = pick(["stage", "status", "pipeline stage", "sales stage"]);
  const contactFirstNameRaw = pick(["contact first name", "first name", "contact firstname"]);
  const contactLastNameRaw = pick(["contact last name", "last name", "contact lastname"]);
  const contactFullName = pick(["contact name", "contact", "contact person", "decision maker"]);
  const [splitFirst, ...splitRest] = contactFullName ? contactFullName.split(/\s+/) : [];
  const contactTitle = pick(["contact title", "title", "job title"]);

  const estimatedRaw = pick(["estimated value", "est. value", "est value", "deal size", "value", "estimated mrr", "mrr"]);
  const estimatedValue = estimatedRaw.replace(/[^0-9.]/g, "");
  const followUpRaw = pick(["next follow up", "next follow-up", "follow up date", "follow-up date", "next follow up date"]);
  let nextFollowUpAt: Date | null = null;
  if (followUpRaw) {
    const parsedDate = new Date(followUpRaw);
    if (!Number.isNaN(parsedDate.getTime())) nextFollowUpAt = parsedDate;
  }

  // Columns that map to real fields on the customer/contact.
  const industry = pick(["industry"]);
  const website = pick(["website", "url", "web site"]);
  const phone = pick(["phone", "company phone", "phone number", "main phone"]);
  const email = pick(["email", "company email"]);
  const publicEmail = pick(["public email", "public business email"]);
  const leadSource = pick(["source", "lead source"]);
  const billingStreet = pick(["street", "address", "billing street"]);
  const billingCity = pick(["city", "billing city"]);
  // Normalized so "AZ" and "Arizona" from two different source
  // spreadsheets land as the same filterable value (see normalizeState).
  const billingState = normalizeState(pick(["state", "billing state"]));
  const billingZip = pick(["zip", "zip code", "postal code", "billing zip"]);
  const contactEmail = pick(["contact email"]);
  const contactPhone = pick(["contact phone", "contact phone number"]);

  // Pre-qualification research columns — populated by research-style
  // exports (a prospecting sweep) rather than a plain contact list. There's
  // no dedicated column for any of this (the data model is deliberately
  // just `customers` + `contacts` + `notes`), so it's written as one
  // research note, laid out in titled sections. NotesPanel renders a note
  // with `whitespace-pre-wrap`, so the line breaks display exactly as built.
  const externalId = pick(["prospect id", "external id", "id"]);
  const researchConfidence = pick(["confidence", "research confidence"]);
  const researchSourceUrl = pick(["primary source", "source url", "research source"]);
  const existingItProvider = pick(["existing it provider", "current it provider", "incumbent provider", "incumbent it"]);
  const rowResearchedRaw = pick(["last researched", "research date", "date researched"]);
  let researchedAt = batchResearchedAt;
  if (rowResearchedRaw) {
    const parsedDate = new Date(rowResearchedRaw);
    if (!Number.isNaN(parsedDate.getTime())) researchedAt = parsedDate;
  }
  // Employee Estimate in a research export is typically a range ("11-50"),
  // not a verified count — kept in the note as-is; only its low end feeds
  // the numeric employeeCount used by the size filter.
  const employeeEstimate = pick(["employee estimate", "employee range", "headcount estimate"]);
  const employeeEvidence = pick(["employee evidence"]);
  const businessSignals = pick(["business / it signals", "business/it signals", "business it signals"]);
  const securitySignals = pick(["security / complexity signals", "security/complexity signals"]);
  const decisionMakerNotes = pick(["decision-maker notes", "decision maker notes"]);
  const qualificationNotes = pick(["qualification notes"]);
  const growthIntent = pick(["it / growth intent signal", "it/growth intent signal"]);
  const contactInfoSource = pick(["email/phone source", "email / phone source", "contact info source"]);
  const emailStatus = pick(["email status"]);
  const outreachStatus = pick(["outreach status"]);
  const genericNotes = pick(["notes", "note", "description", "comments"]);

  const sections: [string, string[]][] = [];
  const add = (heading: string, lines: (string | false | null | undefined)[]) => {
    const kept = lines.filter((l): l is string => !!l && !!l.trim());
    if (kept.length) sections.push([heading, kept]);
  };

  // "Confidence: …" must stay at the start of its own line —
  // backfillConfidenceFromNotes reads it back out with /^Confidence:/m.
  add("AT A GLANCE", [
    externalId && `Prospect ID: ${externalId}`,
    researchConfidence && `Confidence: ${researchConfidence}`,
    employeeEstimate && `Employee estimate: ${employeeEstimate}${employeeEvidence ? ` (${employeeEvidence})` : ""}`,
    !employeeEstimate && employeeEvidence && `Employee evidence: ${employeeEvidence}`,
    existingItProvider && `Existing IT provider: ${existingItProvider}`,
    researchedAt && `Researched: ${formatDate(researchedAt)}`,
  ]);
  add("BUSINESS / IT SIGNALS", [businessSignals && asPoints(businessSignals)]);
  add("SECURITY / COMPLEXITY SIGNALS", [securitySignals && asPoints(securitySignals)]);
  add("DECISION-MAKER", [
    (contactFullName || contactTitle) && [contactFullName, contactTitle].filter(Boolean).join(" — "),
    decisionMakerNotes && asPoints(decisionMakerNotes),
  ]);
  add("QUALIFICATION NOTES", [qualificationNotes && asPoints(qualificationNotes)]);
  add("IT / GROWTH INTENT SIGNAL", [growthIntent && asPoints(growthIntent)]);
  add("OUTREACH", [
    emailStatus && `Email status: ${emailStatus}`,
    outreachStatus && `Outreach status: ${outreachStatus}`,
    contactInfoSource && `Email/phone found at: ${contactInfoSource}`,
  ]);
  add("SOURCES", [researchSourceUrl && `Primary source: ${researchSourceUrl}`]);

  // Anything left over: a column this importer doesn't know about yet
  // (skipping blank "__EMPTY" filler columns from unlabeled headers).
  const otherLines: string[] = [];
  for (const [header, raw] of Object.entries(row)) {
    const key = header.trim().toLowerCase();
    if (!key || key.startsWith("__empty") || knownHeaders.has(key)) continue;
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (value) otherLines.push(`${header.trim()}: ${value}`);
  }
  add("OTHER DETAILS", otherLines);
  add("NOTES", [genericNotes]);

  const researchNote = sections.length
    ? [RESEARCH_NOTE_TITLE, ...sections.map(([heading, lines]) => `${heading}\n${lines.join("\n")}`)].join("\n\n")
    : "";

  return {
    name,
    stage: matchStage(stageRaw || "NEW"),
    estimatedValue,
    nextFollowUpAt,
    employeeCount: parseEmployeeEstimate(employeeEstimate),
    industry,
    website,
    phone,
    email,
    publicEmail,
    source: leadSource,
    billingStreet,
    billingCity,
    billingState,
    billingZip,
    researchConfidence,
    researchNote,
    contactFirstName: contactFirstNameRaw || splitFirst || "",
    contactLastName: contactLastNameRaw || splitRest.join(" ") || "",
    contactEmail,
    contactPhone,
    contactTitle,
  };
}

// Bulk-loads a prospect list from an uploaded .xlsx/.csv file. Every newly
// created row lands as a customer with status=PROSPECT (see the note atop
// this section on why that's the whole model) — nothing here is specific to
// a one-time import; staff can keep re-uploading additional batches later
// the same way. Rows that don't even have a company name are skipped
// outright (nothing to create).
//
// A row whose company name matches an existing customer is, by default,
// skipped rather than creating a duplicate — re-running the same file
// shouldn't double up records. Passing `updateExisting: true` (a checkbox in
// the Import dialog) changes that for matched rows only: instead of
// skipping, it fills in whichever of that prospect's fields are currently
// blank from the row's data — company phone/email/public email/website/
// address/source/confidence/estimated value/employee count, plus the primary contact's
// email/phone/title, or adding a first contact if none exists yet. It never
// overwrites a field that already has a value, so re-running an enrichment
// pass (or the same file twice) can't clobber anything staff have since
// edited by hand — the exact same "only fill blanks" rule the Confidence
// backfill tools already use.
export async function importProspects(formData: FormData): Promise<ImportProspectsResult> {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  const updateExisting = formData.get("updateExisting") === "on";
  if (!file || file.size === 0) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ["No file was uploaded"] };
  }

  let rows: Record<string, unknown>[];
  let batchResearchedAt: Date | null = null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ["The file has no sheets"] };
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });

    // Some research-style exports (e.g. a prospecting sweep) include a
    // second "notes" sheet as label/value pairs with a row like
    // "Research date" | "2026-09-21" describing when the whole batch was
    // researched, rather than a per-row date column. If one of the other
    // sheets has that, use it as every imported row's lastResearchedAt
    // unless a per-row column overrides it below.
    for (const sheetName of workbook.SheetNames.slice(1)) {
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1 });
      for (const r of sheetRows) {
        const label = String(r?.[0] ?? "").trim().toLowerCase();
        if (label === "research date" || label === "last researched") {
          const parsed = new Date(String(r?.[1] ?? ""));
          if (!Number.isNaN(parsed.getTime())) batchResearchedAt = parsed;
        }
      }
    }
  } catch {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ["Could not read that file — is it a valid .xlsx or .csv?"] };
  }

  if (rows.length === 0) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ["No rows found in the first sheet"] };
  }

  const existing = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      publicEmail: customers.publicEmail,
      website: customers.website,
      industry: customers.industry,
      source: customers.source,
      billingStreet: customers.billingStreet,
      billingCity: customers.billingCity,
      billingState: customers.billingState,
      billingZip: customers.billingZip,
      estimatedMonthlyValue: customers.estimatedMonthlyValue,
      employeeCount: customers.employeeCount,
      researchConfidence: customers.researchConfidence,
    })
    .from(customers);
  const existingByName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
  const stateAssignments = await getStateAssignments();

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header is row 1 in the spreadsheet

    const parsed = parseProspectRow(row, batchResearchedAt);
    if (!parsed.name) {
      skipped++;
      errors.push(`Row ${rowNum}: no company name — skipped`);
      continue;
    }

    const match = existingByName.get(parsed.name.toLowerCase());
    if (match) {
      if (!updateExisting) {
        skipped++;
        errors.push(`Row ${rowNum}: "${parsed.name}" already exists — skipped`);
        continue;
      }

      try {
        const patch: Partial<typeof customers.$inferInsert> = {};
        const filled: string[] = [];
        if (parsed.phone && !match.phone) { patch.phone = parsed.phone; filled.push("phone"); }
        if (parsed.email && !match.email) { patch.email = parsed.email; filled.push("email"); }
        if (parsed.publicEmail && !match.publicEmail) { patch.publicEmail = parsed.publicEmail; filled.push("public email"); }
        if (parsed.website && !match.website) { patch.website = parsed.website; filled.push("website"); }
        if (parsed.industry && !match.industry) { patch.industry = parsed.industry; filled.push("industry"); }
        if (parsed.source && !match.source) { patch.source = parsed.source; filled.push("source"); }
        if (parsed.billingStreet && !match.billingStreet) { patch.billingStreet = parsed.billingStreet; filled.push("address"); }
        if (parsed.billingCity && !match.billingCity) { patch.billingCity = parsed.billingCity; filled.push("city"); }
        if (parsed.billingState && !match.billingState) { patch.billingState = parsed.billingState; filled.push("state"); }
        if (parsed.billingZip && !match.billingZip) { patch.billingZip = parsed.billingZip; filled.push("zip"); }
        if (parsed.researchConfidence && !match.researchConfidence) {
          patch.researchConfidence = parsed.researchConfidence;
          filled.push("confidence");
        }
        if (parsed.estimatedValue && !match.estimatedMonthlyValue) {
          patch.estimatedMonthlyValue = parsed.estimatedValue;
          filled.push("estimated value");
        }
        if (parsed.employeeCount !== null && match.employeeCount === null) {
          patch.employeeCount = parsed.employeeCount;
          filled.push("employee count");
        }

        if (Object.keys(patch).length) {
          await db.update(customers).set({ ...patch, updatedAt: new Date() }).where(eq(customers.id, match.id));
        }

        // Contact enrichment mirrors the same "only fill blanks" rule: top
        // up the existing primary contact's email/phone/title, or add a
        // first contact if this prospect somehow doesn't have one yet —
        // never create a second contact just because the row has different
        // contact info than the one already on file.
        const hasNewContactInfo = parsed.contactFirstName || parsed.contactLastName || parsed.contactEmail || parsed.contactPhone;
        if (hasNewContactInfo) {
          const [primaryContact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.customerId, match.id), eq(contacts.isPrimary, true)))
            .limit(1);

          if (primaryContact) {
            const contactPatch: Partial<typeof contacts.$inferInsert> = {};
            if (parsed.contactEmail && !primaryContact.email) { contactPatch.email = parsed.contactEmail; filled.push("contact email"); }
            if (parsed.contactPhone && !primaryContact.phone) { contactPatch.phone = parsed.contactPhone; filled.push("contact phone"); }
            if (parsed.contactTitle && !primaryContact.title) { contactPatch.title = parsed.contactTitle; filled.push("contact title"); }
            if (Object.keys(contactPatch).length) {
              await db.update(contacts).set(contactPatch).where(eq(contacts.id, primaryContact.id));
            }
          } else {
            const [anyContact] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.customerId, match.id)).limit(1);
            if (!anyContact) {
              await db.insert(contacts).values({
                customerId: match.id,
                firstName: parsed.contactFirstName || "Primary",
                lastName: parsed.contactLastName,
                email: parsed.contactEmail || null,
                phone: parsed.contactPhone || null,
                title: parsed.contactTitle || null,
                isPrimary: true,
              });
              filled.push("added a contact");
            }
          }
        }

        // The spreadsheet's research note (every column without a field of
        // its own — see parseProspectRow). Unlike the fields above, this
        // note is entirely the importer's own output (notes can't be edited
        // in the app, and staff notes never carry its title/headings), so
        // it's refreshed rather than blank-filled: added if this prospect
        // has no research note yet, replaced in place if the one it has —
        // including the older run-together format — differs from what this
        // file produces now. Audit notes ("Updated via spreadsheet
        // import…") and staff notes are never matched or touched.
        // Re-running the same file is a no-op for notes.
        if (parsed.researchNote) {
          const [existingResearch] = await db
            .select({ id: notes.id, body: notes.body })
            .from(notes)
            .where(
              and(
                eq(notes.customerId, match.id),
                or(
                  ilike(notes.body, `${RESEARCH_NOTE_TITLE}%`),
                  // Older import formats, before the note got its title line.
                  ilike(notes.body, "Prospect ID:%"),
                  ilike(notes.body, "%Business / IT signals:%"),
                  ilike(notes.body, "%Security / complexity signals:%"),
                  ilike(notes.body, "%Decision-maker notes:%"),
                  ilike(notes.body, "%Qualification notes:%")
                )
              )
            )
            .orderBy(asc(notes.createdAt))
            .limit(1);
          if (!existingResearch) {
            await db.insert(notes).values({ customerId: match.id, authorId: user.id, type: "NOTE", body: parsed.researchNote });
            filled.push("research notes");
          } else if (existingResearch.body !== parsed.researchNote) {
            await db.update(notes).set({ body: parsed.researchNote }).where(eq(notes.id, existingResearch.id));
            filled.push("refreshed research notes");
          }
        }

        if (filled.length) {
          await db.insert(notes).values({
            customerId: match.id,
            authorId: user.id,
            type: "NOTE",
            body: `Updated via spreadsheet import: filled in ${filled.join(", ")}.`,
          });
          updated++;
          errors.push(`Row ${rowNum}: "${parsed.name}" already exists — filled in ${filled.join(", ")}`);
        } else {
          skipped++;
          errors.push(`Row ${rowNum}: "${parsed.name}" already exists, nothing new to add — skipped`);
        }
      } catch (err) {
        errors.push(`Row ${rowNum} ("${parsed.name}"): ${err instanceof Error ? err.message : "failed to update"}`);
      }
      continue;
    }

    // If a territory rule has been set for this state (Prospects → Assign
    // by state), the imported prospect starts pre-assigned to that owner
    // instead of Unassigned.
    const assignedOwnerId = parsed.billingState ? stateAssignments[parsed.billingState] : undefined;

    try {
      const [customer] = await db
        .insert(customers)
        .values({
          name: parsed.name,
          status: "PROSPECT",
          stage: parsed.stage,
          estimatedMonthlyValue: parsed.estimatedValue || null,
          nextFollowUpAt: parsed.nextFollowUpAt,
          employeeCount: parsed.employeeCount,
          accountOwnerId: assignedOwnerId || null,
          industry: parsed.industry || null,
          website: parsed.website || null,
          phone: parsed.phone || null,
          email: parsed.email || null,
          publicEmail: parsed.publicEmail || null,
          source: parsed.source || null,
          billingStreet: parsed.billingStreet || null,
          billingCity: parsed.billingCity || null,
          billingState: parsed.billingState || null,
          billingZip: parsed.billingZip || null,
          researchConfidence: parsed.researchConfidence || null,
        })
        .returning();

      if (parsed.contactFirstName || parsed.contactLastName || parsed.contactEmail || parsed.contactPhone) {
        await db.insert(contacts).values({
          customerId: customer.id,
          firstName: parsed.contactFirstName || "Primary",
          lastName: parsed.contactLastName,
          email: parsed.contactEmail || null,
          phone: parsed.contactPhone || null,
          title: parsed.contactTitle || null,
          isPrimary: true,
        });
      }

      if (parsed.researchNote) {
        await db.insert(notes).values({ customerId: customer.id, authorId: user.id, body: parsed.researchNote, type: "NOTE" });
      }

      existingByName.set(parsed.name.toLowerCase(), {
        id: customer.id,
        name: parsed.name,
        phone: parsed.phone || null,
        email: parsed.email || null,
        publicEmail: parsed.publicEmail || null,
        website: parsed.website || null,
        industry: parsed.industry || null,
        source: parsed.source || null,
        billingStreet: parsed.billingStreet || null,
        billingCity: parsed.billingCity || null,
        billingState: parsed.billingState || null,
        billingZip: parsed.billingZip || null,
        estimatedMonthlyValue: parsed.estimatedValue || null,
        employeeCount: parsed.employeeCount,
        researchConfidence: parsed.researchConfidence || null,
      });
      imported++;
    } catch (err) {
      errors.push(`Row ${rowNum} ("${parsed.name}"): ${err instanceof Error ? err.message : "failed to import"}`);
    }
  }

  revalidatePath("/prospects");
  revalidatePath("/customers");
  return { ok: true, imported, updated, skipped, errors };
}

export async function addContact(customerId: string, formData: FormData) {
  await requireUser();
  const firstName = String(formData.get("firstName") || "");
  const lastName = String(formData.get("lastName") || "");
  const email = String(formData.get("email") || "") || null;
  const phone = String(formData.get("phone") || "") || null;
  const title = String(formData.get("title") || "") || null;
  const isPrimary = formData.get("isPrimary") === "on";
  const isBilling = formData.get("isBilling") === "on";

  if (!firstName && !lastName) return;

  // Only one contact per customer can hold each role — same invariant the
  // public intake form relies on (see submitCustomerIntake) — so claiming a
  // role here has to release it from whoever held it before.
  if (isPrimary) await db.update(contacts).set({ isPrimary: false }).where(eq(contacts.customerId, customerId));
  if (isBilling) await db.update(contacts).set({ isBilling: false }).where(eq(contacts.customerId, customerId));

  await db.insert(contacts).values({ customerId, firstName, lastName, email, phone, title, isPrimary, isBilling });
  revalidatePath(`/customers/${customerId}`);
}

export async function deleteContact(customerId: string, contactId: string) {
  await requireUser();
  await db.delete(contacts).where(eq(contacts.id, contactId));
  revalidatePath(`/customers/${customerId}`);
}

// Marks one contact as the customer's Primary or Billing contact, releasing
// that role from whichever contact held it before — each customer has at
// most one of each. Used by the "Make primary" / "Make billing" links on the
// customer's Contacts card, so staff can (re)designate roles on contacts
// added directly in the CRM, not just ones that came through the public
// intake form (which sets these at creation time instead).
export async function setContactRole(customerId: string, contactId: string, role: "primary" | "billing") {
  await requireUser();
  if (role === "primary") {
    await db.update(contacts).set({ isPrimary: false }).where(eq(contacts.customerId, customerId));
    await db.update(contacts).set({ isPrimary: true }).where(eq(contacts.id, contactId));
  } else {
    await db.update(contacts).set({ isBilling: false }).where(eq(contacts.customerId, customerId));
    await db.update(contacts).set({ isBilling: true }).where(eq(contacts.id, contactId));
  }
  revalidatePath(`/customers/${customerId}`);
}

export async function addNote(customerId: string, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("body") || "").trim();
  const type = (String(formData.get("type") || "NOTE") as "NOTE" | "CALL" | "EMAIL" | "MEETING");
  if (!body) return;

  await db.insert(notes).values({ customerId, authorId: user.id, body, type });
  revalidatePath(`/customers/${customerId}`);
}

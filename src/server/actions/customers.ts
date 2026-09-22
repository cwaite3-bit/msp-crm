"use server";

import { db } from "@/server/db";
import { customers, contacts, notes, users, appSettings } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, asc, ilike, or, isNull, isNotNull, gte, lte, sql } from "drizzle-orm";
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

// `showArchived` flips the list rather than merging it in — archived
// customers are meant to be out of the way day-to-day, so a search normally
// excludes them, and asking for the archived view shows only those (with a
// way back via unarchiveCustomer) rather than mixing the two together.
export async function searchCustomers(query: string, showArchived = false) {
  await requireUser();
  const trimmed = query.trim();
  const archivedCondition = showArchived ? isNotNull(customers.archivedAt) : isNull(customers.archivedAt);
  const conditions = trimmed
    ? and(
        archivedCondition,
        or(
          ilike(customers.name, `%${trimmed}%`),
          ilike(customers.email, `%${trimmed}%`),
          ilike(customers.phone, `%${trimmed}%`),
          ilike(customers.industry, `%${trimmed}%`)
        )
      )
    : archivedCondition;

  return db.select().from(customers).where(conditions).orderBy(desc(customers.createdAt)).limit(100);
}

// Counts archived customers so the list page can show "Show archived (3)"
// instead of a bare toggle with no idea what's behind it.
export async function countArchivedCustomers(): Promise<number> {
  await requireUser();
  const rows = await db.select({ id: customers.id }).from(customers).where(isNotNull(customers.archivedAt));
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
// status="PROSPECT" (see customerStatusEnum in schema.ts). That means a
// prospect already gets contacts, notes/activity, and quotes for free the
// moment it needs them, and "converting" one is nothing more than changing
// its status — nothing to copy or migrate. `stage` tracks where in the
// sales pipeline a prospect sits, independent of that status.

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
    eq(customers.status, "PROSPECT"),
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
    })
    .from(customers)
    .leftJoin(users, eq(customers.accountOwnerId, users.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(200);
}

// Distinct filter-dropdown option values, scoped to actual PROSPECT rows so
// the State/Industry filters never offer a choice that would return zero
// results.
export async function listProspectFilterOptions() {
  await requireUser();
  const [states, industries] = await Promise.all([
    db
      .selectDistinct({ value: customers.billingState })
      .from(customers)
      .where(and(eq(customers.status, "PROSPECT"), isNull(customers.archivedAt), isNotNull(customers.billingState))),
    db
      .selectDistinct({ value: customers.industry })
      .from(customers)
      .where(and(eq(customers.status, "PROSPECT"), isNull(customers.archivedAt), isNotNull(customers.industry))),
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
      .where(and(eq(customers.status, "PROSPECT"), eq(customers.billingState, state), isNull(customers.accountOwnerId)))
      .returning({ id: customers.id });
    updated += result.length;
  }
  revalidatePath("/prospects");
  return { updated };
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
  skipped: number;
  errors: string[];
};

// Bulk-loads an initial prospect list from an uploaded .xlsx/.csv file.
// Every imported row lands as a customer with status=PROSPECT (see the
// note atop this section on why that's the whole model) — nothing here is
// specific to a one-time import; staff can keep re-uploading additional
// batches later the same way. Rows that don't even have a company name are
// skipped outright (nothing to create), and a row whose company name
// exactly matches an existing customer is also skipped rather than
// creating a duplicate — re-running an import (or an overlapping list)
// shouldn't double up records.
export async function importProspects(formData: FormData): Promise<ImportProspectsResult> {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, imported: 0, skipped: 0, errors: ["No file was uploaded"] };
  }

  let rows: Record<string, unknown>[];
  let batchResearchedAt: Date | null = null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { ok: false, imported: 0, skipped: 0, errors: ["The file has no sheets"] };
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
    return { ok: false, imported: 0, skipped: 0, errors: ["Could not read that file — is it a valid .xlsx or .csv?"] };
  }

  if (rows.length === 0) {
    return { ok: false, imported: 0, skipped: 0, errors: ["No rows found in the first sheet"] };
  }

  const existing = await db.select({ name: customers.name }).from(customers);
  const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const stateAssignments = await getStateAssignments();

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header is row 1 in the spreadsheet

    const name = pickField(row, ["company", "company name", "name", "business", "business name", "organization", "account name"]);
    if (!name) {
      skipped++;
      errors.push(`Row ${rowNum}: no company name — skipped`);
      continue;
    }
    if (existingNames.has(name.toLowerCase())) {
      skipped++;
      errors.push(`Row ${rowNum}: "${name}" already exists — skipped`);
      continue;
    }

    const stageRaw = pickField(row, ["stage", "status", "pipeline stage", "sales stage"]);
    const contactFirstName = pickField(row, ["contact first name", "first name", "contact firstname"]);
    const contactLastName = pickField(row, ["contact last name", "last name", "contact lastname"]);
    const contactFullName = pickField(row, ["contact name", "contact", "contact person", "decision maker"]);
    const [splitFirst, ...splitRest] = contactFullName ? contactFullName.split(/\s+/) : [];

    const estimatedRaw = pickField(row, ["estimated value", "est. value", "est value", "deal size", "value", "estimated mrr", "mrr"]);
    const estimatedValue = estimatedRaw.replace(/[^0-9.]/g, "");
    const followUpRaw = pickField(row, ["next follow up", "next follow-up", "follow up date", "follow-up date", "next follow up date"]);
    let nextFollowUpAt: Date | null = null;
    if (followUpRaw) {
      const parsedDate = new Date(followUpRaw);
      if (!Number.isNaN(parsedDate.getTime())) nextFollowUpAt = parsedDate;
    }

    // Pre-qualification research fields — populated by research-style
    // exports (a prospecting sweep) rather than a plain contact list.
    // There's no dedicated column for any of this (see the note above the
    // Prospects section on why the data model is deliberately just
    // `customers` + `contacts` + `notes`), so it's logged as one neatly
    // organized activity note on the imported customer instead — a short
    // "at a glance" block of facts, then each longer narrative field under
    // its own heading, blank-line separated rather than run together.
    // NotesPanel renders a note's body with `whitespace-pre-wrap`, so this
    // formatting (line breaks, blank lines) displays exactly as built here.
    const externalId = pickField(row, ["prospect id", "external id", "id"]);
    const researchConfidence = pickField(row, ["confidence", "research confidence"]);
    const researchSourceUrl = pickField(row, ["primary source", "source url", "research source", "source"]);
    const existingItProvider = pickField(row, ["existing it provider", "current it provider", "incumbent provider", "incumbent it"]);
    const rowResearchedRaw = pickField(row, ["last researched", "research date", "date researched"]);
    let researchedAt = batchResearchedAt;
    if (rowResearchedRaw) {
      const parsedDate = new Date(rowResearchedRaw);
      if (!Number.isNaN(parsedDate.getTime())) researchedAt = parsedDate;
    }

    // Employee Estimate in a research export is typically a range ("11-50"),
    // not a single verified count — the field guide explicitly warns not to
    // treat it as exact, so it's folded into the research note below rather
    // than forced into the numeric employeeCount column.
    const employeeEstimate = pickField(row, ["employee estimate", "employee range", "headcount estimate"]);
    const employeeEvidence = pickField(row, ["employee evidence"]);
    const genericNotes = pickField(row, ["notes", "note", "description", "comments"]);

    const factLines: string[] = [];
    if (externalId) factLines.push(`Prospect ID: ${externalId}`);
    if (researchConfidence) factLines.push(`Confidence: ${researchConfidence}`);
    if (existingItProvider) factLines.push(`Existing IT provider: ${existingItProvider}`);
    if (researchSourceUrl) factLines.push(`Source: ${researchSourceUrl}`);
    if (researchedAt) factLines.push(`Researched: ${formatDate(researchedAt)}`);
    if (employeeEstimate) factLines.push(`Employee estimate: ${employeeEstimate}${employeeEvidence ? ` (${employeeEvidence})` : ""}`);

    const narrativeSections: [string, string][] = [
      ["Business / IT signals", pickField(row, ["business / it signals", "business/it signals", "business it signals"])],
      ["Security / complexity signals", pickField(row, ["security / complexity signals", "security/complexity signals"])],
      ["Decision-maker notes", pickField(row, ["decision-maker notes", "decision maker notes"])],
      ["Qualification notes", pickField(row, ["qualification notes"])],
      ["IT / growth intent signal", pickField(row, ["it / growth intent signal", "it/growth intent signal"])],
    ];

    const noteBlocks: string[] = [];
    if (factLines.length) noteBlocks.push(factLines.join("\n"));
    for (const [label, value] of narrativeSections) {
      if (value) noteBlocks.push(`${label}:\n${value}`);
    }
    if (genericNotes) noteBlocks.push(genericNotes);
    const researchNote = noteBlocks.join("\n\n");

    // Normalized so "AZ" and "Arizona" from two different source
    // spreadsheets land as the same filterable value (see normalizeState).
    // If a territory rule has been set for this state (Prospects → Assign
    // by state), the imported prospect starts pre-assigned to that owner
    // instead of Unassigned.
    const billingState = normalizeState(pickField(row, ["state", "billing state"]));
    const assignedOwnerId = billingState ? stateAssignments[billingState] : undefined;

    try {
      const [customer] = await db
        .insert(customers)
        .values({
          name,
          status: "PROSPECT",
          stage: matchStage(stageRaw || "NEW"),
          estimatedMonthlyValue: estimatedValue || null,
          nextFollowUpAt,
          employeeCount: parseEmployeeEstimate(employeeEstimate),
          accountOwnerId: assignedOwnerId || null,
          industry: pickField(row, ["industry"]) || null,
          website: pickField(row, ["website", "url", "web site"]) || null,
          phone: pickField(row, ["phone", "company phone", "phone number", "main phone"]) || null,
          email: pickField(row, ["email", "company email", "public business email"]) || null,
          source: pickField(row, ["source", "lead source"]) || null,
          billingStreet: pickField(row, ["street", "address", "billing street"]) || null,
          billingCity: pickField(row, ["city", "billing city"]) || null,
          billingState: billingState || null,
          billingZip: pickField(row, ["zip", "zip code", "postal code", "billing zip"]) || null,
          researchConfidence: researchConfidence || null,
        })
        .returning();

      const contactEmail = pickField(row, ["contact email"]);
      const contactPhone = pickField(row, ["contact phone", "contact phone number"]);
      const contactTitle = pickField(row, ["contact title", "title", "job title"]);
      const firstName = contactFirstName || splitFirst || "";
      const lastName = contactLastName || splitRest.join(" ") || "";
      if (firstName || lastName || contactEmail || contactPhone) {
        await db.insert(contacts).values({
          customerId: customer.id,
          firstName: firstName || "Primary",
          lastName,
          email: contactEmail || null,
          phone: contactPhone || null,
          title: contactTitle || null,
          isPrimary: true,
        });
      }

      if (researchNote) {
        await db.insert(notes).values({ customerId: customer.id, authorId: user.id, body: researchNote, type: "NOTE" });
      }

      existingNames.add(name.toLowerCase());
      imported++;
    } catch (err) {
      errors.push(`Row ${rowNum} ("${name}"): ${err instanceof Error ? err.message : "failed to import"}`);
    }
  }

  revalidatePath("/prospects");
  revalidatePath("/customers");
  return { ok: true, imported, skipped, errors };
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

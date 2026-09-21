"use server";

import { db } from "@/server/db";
import { customers, contacts, notes } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import * as XLSX from "xlsx";
import { PROSPECT_STAGES, type ProspectStage } from "@/lib/prospect";

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
      billingState: parsed.billingState || null,
      billingZip: parsed.billingZip || null,
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
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/prospects");
}

export async function searchCustomers(query: string) {
  await requireUser();
  const trimmed = query.trim();
  if (!trimmed) {
    return db.select().from(customers).orderBy(desc(customers.createdAt)).limit(100);
  }
  return db
    .select()
    .from(customers)
    .where(
      or(
        ilike(customers.name, `%${trimmed}%`),
        ilike(customers.email, `%${trimmed}%`),
        ilike(customers.phone, `%${trimmed}%`),
        ilike(customers.industry, `%${trimmed}%`)
      )
    )
    .orderBy(desc(customers.createdAt))
    .limit(100);
}

// ---- Prospects ----
// Prospects aren't a separate table — they're just customers with
// status="PROSPECT" (see customerStatusEnum in schema.ts). That means a
// prospect already gets contacts, notes/activity, and quotes for free the
// moment it needs them, and "converting" one is nothing more than changing
// its status — nothing to copy or migrate. `stage` tracks where in the
// sales pipeline a prospect sits, independent of that status.

export async function listProspects() {
  await requireUser();
  return db.select().from(customers).where(eq(customers.status, "PROSPECT")).orderBy(desc(customers.createdAt));
}

export async function searchProspects(query: string) {
  await requireUser();
  const trimmed = query.trim();
  const statusFilter = eq(customers.status, "PROSPECT");
  if (!trimmed) {
    return db.select().from(customers).where(statusFilter).orderBy(desc(customers.createdAt)).limit(200);
  }
  return db
    .select()
    .from(customers)
    .where(
      and(
        statusFilter,
        or(
          ilike(customers.name, `%${trimmed}%`),
          ilike(customers.email, `%${trimmed}%`),
          ilike(customers.phone, `%${trimmed}%`),
          ilike(customers.industry, `%${trimmed}%`)
        )
      )
    )
    .orderBy(desc(customers.createdAt))
    .limit(200);
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
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { ok: false, imported: 0, skipped: 0, errors: ["The file has no sheets"] };
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });
  } catch {
    return { ok: false, imported: 0, skipped: 0, errors: ["Could not read that file — is it a valid .xlsx or .csv?"] };
  }

  if (rows.length === 0) {
    return { ok: false, imported: 0, skipped: 0, errors: ["No rows found in the first sheet"] };
  }

  const existing = await db.select({ name: customers.name }).from(customers);
  const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));

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
    const contactFullName = pickField(row, ["contact name", "contact", "contact person"]);
    const [splitFirst, ...splitRest] = contactFullName ? contactFullName.split(/\s+/) : [];

    const estimatedRaw = pickField(row, ["estimated value", "est. value", "est value", "deal size", "value", "estimated mrr", "mrr"]);
    const estimatedValue = estimatedRaw.replace(/[^0-9.]/g, "");
    const followUpRaw = pickField(row, ["next follow up", "next follow-up", "follow up date", "follow-up date", "next follow up date"]);
    let nextFollowUpAt: Date | null = null;
    if (followUpRaw) {
      const parsedDate = new Date(followUpRaw);
      if (!Number.isNaN(parsedDate.getTime())) nextFollowUpAt = parsedDate;
    }

    try {
      const [customer] = await db
        .insert(customers)
        .values({
          name,
          status: "PROSPECT",
          stage: matchStage(stageRaw || "NEW"),
          estimatedMonthlyValue: estimatedValue || null,
          nextFollowUpAt,
          industry: pickField(row, ["industry"]) || null,
          website: pickField(row, ["website", "url", "web site"]) || null,
          phone: pickField(row, ["phone", "company phone", "phone number"]) || null,
          email: pickField(row, ["email", "company email"]) || null,
          source: pickField(row, ["source", "lead source"]) || null,
          billingStreet: pickField(row, ["street", "address", "billing street"]) || null,
          billingCity: pickField(row, ["city", "billing city"]) || null,
          billingState: pickField(row, ["state", "billing state"]) || null,
          billingZip: pickField(row, ["zip", "zip code", "postal code", "billing zip"]) || null,
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

      const notesText = pickField(row, ["notes", "note", "description", "comments"]);
      if (notesText) {
        await db.insert(notes).values({ customerId: customer.id, authorId: user.id, body: notesText, type: "NOTE" });
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

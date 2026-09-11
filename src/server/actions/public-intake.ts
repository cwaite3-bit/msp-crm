"use server";

// Public, unauthenticated intake form (no login required) — the link you
// hand a prospect so they can fill out their own company info and land
// directly in the CRM as a LEAD, instead of you retyping what they emailed
// or told you over the phone. Deliberately kept separate from
// customers.ts's createCustomer (which requires a staff session and
// redirects into the internal /customers/[id] page on success) since this
// one:
//  - has no auth check at all — reachable by anyone with the link
//  - can't redirect into the authenticated app (the visitor isn't logged in)
//  - always creates a LEAD with source "Website intake form"
//  - fires an admin notification email instead of assuming a staff member
//    is watching the customer list for new rows
//  - returns a { ok, error } result instead of throwing, same reasoning as
//    generateMsa/sendMsaEmail in msa.ts: Next.js redacts a thrown Server
//    Action error's message in production, so validation errors need to
//    come back as data for the public page to actually show the visitor.
import { db } from "@/server/db";
import { customers, contacts, notes } from "@/server/db/schema";
import { notifyNewCustomerLead } from "@/server/notify";
import { z } from "zod";

const intakeSchema = z
  .object({
    companyName: z.string().min(1, "Company name is required"),
    industry: z.string().optional(),
    website: z.string().optional(),
    employeeCount: z.coerce.number().int().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    billingStreet: z.string().optional(),
    billingCity: z.string().optional(),
    billingState: z.string().optional(),
    billingZip: z.string().optional(),
    contactFirstName: z.string().min(1, "Your first name is required"),
    contactLastName: z.string().min(1, "Your last name is required"),
    contactTitle: z.string().optional(),
    contactEmail: z.string().optional(),
    contactPhone: z.string().optional(),
    message: z.string().optional(),
  })
  .refine((v) => Boolean(v.contactEmail?.trim() || v.contactPhone?.trim()), {
    message: "Please provide an email or phone number so we can reach you",
    path: ["contactEmail"],
  });

export async function submitCustomerIntake(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const raw = Object.fromEntries(formData.entries());
    const parsed = intakeSchema.parse(raw);

    const [customer] = await db
      .insert(customers)
      .values({
        name: parsed.companyName,
        status: "LEAD",
        industry: parsed.industry || null,
        website: parsed.website || null,
        phone: parsed.phone || null,
        email: parsed.email || parsed.contactEmail || null,
        source: "Website intake form",
        employeeCount: parsed.employeeCount || null,
        billingStreet: parsed.billingStreet || null,
        billingCity: parsed.billingCity || null,
        billingState: parsed.billingState || null,
        billingZip: parsed.billingZip || null,
      })
      .returning();

    await db.insert(contacts).values({
      customerId: customer.id,
      firstName: parsed.contactFirstName,
      lastName: parsed.contactLastName,
      email: parsed.contactEmail || null,
      phone: parsed.contactPhone || null,
      title: parsed.contactTitle || null,
      isPrimary: true,
    });

    if (parsed.message?.trim()) {
      await db.insert(notes).values({
        customerId: customer.id,
        authorId: null,
        body: `Submitted via the customer intake form:\n\n${parsed.message.trim()}`,
        type: "NOTE",
      });
    }

    const address = [parsed.billingStreet, parsed.billingCity, parsed.billingState, parsed.billingZip]
      .filter(Boolean)
      .join(", ");

    await notifyNewCustomerLead({
      customerId: customer.id,
      companyName: parsed.companyName,
      industry: parsed.industry || null,
      website: parsed.website || null,
      employeeCount: parsed.employeeCount ?? null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      address,
      contactName: `${parsed.contactFirstName} ${parsed.contactLastName}`.trim(),
      contactTitle: parsed.contactTitle || null,
      contactEmail: parsed.contactEmail || null,
      contactPhone: parsed.contactPhone || null,
      message: parsed.message || null,
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message || "Please check the form and try again." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong submitting this form." };
  }
}

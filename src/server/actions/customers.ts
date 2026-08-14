"use server";

import { db } from "@/server/db";
import { customers, contacts, notes } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, desc, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

const customerSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  status: z.enum(["LEAD", "PROSPECT", "ACTIVE", "FORMER"]).default("LEAD"),
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
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

export async function searchCustomers(query: string) {
  await requireUser();
  if (!query) {
    return db.select().from(customers).orderBy(desc(customers.createdAt)).limit(50);
  }
  return db
    .select()
    .from(customers)
    .where(or(ilike(customers.name, `%${query}%`), ilike(customers.email, `%${query}%`)))
    .orderBy(desc(customers.createdAt))
    .limit(50);
}

export async function addContact(customerId: string, formData: FormData) {
  await requireUser();
  const firstName = String(formData.get("firstName") || "");
  const lastName = String(formData.get("lastName") || "");
  const email = String(formData.get("email") || "") || null;
  const phone = String(formData.get("phone") || "") || null;
  const title = String(formData.get("title") || "") || null;

  if (!firstName && !lastName) return;

  await db.insert(contacts).values({ customerId, firstName, lastName, email, phone, title });
  revalidatePath(`/customers/${customerId}`);
}

export async function deleteContact(customerId: string, contactId: string) {
  await requireUser();
  await db.delete(contacts).where(eq(contacts.id, contactId));
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

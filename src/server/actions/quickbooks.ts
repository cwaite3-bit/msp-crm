"use server";

import { db } from "@/server/db";
import { quotes, quoteLineItems, quoteEvents, customers, products, quickbooksConnections } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { findOrCreateQboCustomer, findOrCreateQboItem, createQboInvoice } from "@/server/quickbooks/sync";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function getQuickBooksStatus() {
  await requireAdmin();
  const [row] = await db.select().from(quickbooksConnections).orderBy(desc(quickbooksConnections.createdAt)).limit(1);
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    environment: row.environment,
    realmId: row.realmId,
    connectedAt: row.createdAt,
  };
}

export async function disconnectQuickBooks() {
  await requireAdmin();
  await db.delete(quickbooksConnections);
  revalidatePath("/settings");
}

export async function pushQuoteToQuickBooks(quoteId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();

  try {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) throw new Error("Quote not found");
    if (quote.status !== "ACCEPTED") throw new Error("Only accepted quotes can be invoiced");

    const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
    if (!customer) throw new Error("Customer not found");

    const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
    if (lineItems.length === 0) throw new Error("Quote has no line items");

    // 1. Resolve (or create) the QuickBooks customer.
    let qboCustomerId = customer.quickbooksCustomerId;
    if (!qboCustomerId) {
      qboCustomerId = await findOrCreateQboCustomer({
        displayName: customer.name,
        email: customer.email,
        phone: customer.phone,
        billAddr: {
          Line1: customer.billingStreet || undefined,
          City: customer.billingCity || undefined,
          CountrySubDivisionCode: customer.billingState || undefined,
          PostalCode: customer.billingZip || undefined,
        },
      });
      await db.update(customers).set({ quickbooksCustomerId: qboCustomerId }).where(eq(customers.id, customer.id));
    }

    // 2. Resolve (or create) a QuickBooks Item for every line, caching the
    //    result back onto the catalog Product so future quotes reuse it.
    const resolvedLines = [];
    for (const item of lineItems) {
      let qboItemId: string | null = null;
      if (item.productId) {
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        qboItemId = product?.quickbooksItemId || null;
        if (!qboItemId) {
          qboItemId = await findOrCreateQboItem(item.name);
          await db.update(products).set({ quickbooksItemId: qboItemId }).where(eq(products.id, item.productId));
        }
      } else {
        qboItemId = await findOrCreateQboItem(item.name);
      }
      resolvedLines.push({
        itemId: qboItemId,
        description: `${item.name} (${item.unitLabel})`,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      });
    }

    // 3. Create the invoice. This invoices everything currently on the quote
    //    (one-time fees + first month of recurring services). Ongoing monthly
    //    billing beyond this first invoice needs a recurring mechanism —
    //    see the deployment guide for options.
    const invoice = await createQboInvoice({ customerId: qboCustomerId, lines: resolvedLines });

    await db
      .update(quotes)
      .set({
        quickbooksInvoiceId: invoice.Id,
        quickbooksSyncedAt: new Date(),
        quickbooksSyncError: null,
      })
      .where(eq(quotes.id, quoteId));

    await db.insert(quoteEvents).values({
      quoteId,
      type: "QUICKBOOKS_SYNCED",
      detail: `Invoice ${invoice.DocNumber || invoice.Id}`,
    });

    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(quotes)
      .set({ quickbooksSyncError: message })
      .where(eq(quotes.id, quoteId));
    await db.insert(quoteEvents).values({ quoteId, type: "QUICKBOOKS_SYNC_FAILED", detail: message });
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: false, error: message };
  }
}

"use server";

import { db } from "@/server/db";
import { quotes, quoteLineItems, quoteEvents, customers, products, quickbooksConnections, msaDocuments } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { findOrCreateQboCustomer, findOrCreateQboItem, createQboInvoice } from "@/server/quickbooks/sync";
import { computeSubtotals, applyDiscount } from "@/server/pricing";
import { getMsaSettings, getBillingSettings } from "@/server/actions/settings";
import { notifyQuoteCreator, appUrl } from "@/server/notify";
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

    // The first invoice only goes out once the customer has actually signed
    // the MSA — invoicing off of an accepted-but-unsigned quote would mean
    // billing for a contract that isn't executed yet. See the deployment
    // guide for why this is a staff-triggered button rather than firing
    // automatically the moment the MSA is signed.
    const [msaDoc] = await db
      .select()
      .from(msaDocuments)
      .where(eq(msaDocuments.quoteId, quoteId))
      .orderBy(desc(msaDocuments.createdAt))
      .limit(1);
    if (!msaDoc || msaDoc.status !== "SIGNED") {
      throw new Error("This quote's Master Service Agreement hasn't been signed yet — generate it and get it signed before invoicing.");
    }

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
    //    When the client chose to pay ANNUALLY (Settings → Billing options),
    //    each RECURRING_MONTHLY line's unit price is annualized (×12, less
    //    the annual discount) so this one invoice covers the full year up
    //    front instead of just the first month — ONE_TIME/HOURLY lines are
    //    unaffected either way.
    const billingSettings = await getBillingSettings();
    const isAnnual = quote.billingFrequency === "ANNUAL";
    const annualMultiplier = isAnnual ? 12 * (1 - billingSettings.annualDiscountPct / 100) : 1;

    // Apply the quote's own discount (set in Quote settings — see
    // quote-meta-form.tsx) the same way computeQuoteTotals() does for the
    // staff quote builder and the client-facing quote page: as a single
    // discount applied to each billing bucket's subtotal (recurring+hourly
    // "monthly" bucket, and the one-time bucket), NOT per line item. This
    // was previously ignored entirely when pushing to QuickBooks — every
    // invoice was built from full list-price unitPrice with the discount
    // silently dropped, overcharging on any discounted quote. Converting
    // each bucket's discount to a multiplier and applying it per line
    // (rather than adding a separate invoice-level discount line) keeps
    // this correct for both a flat AMOUNT discount and a PERCENT one, and
    // composes cleanly with the existing annual-prepay multiplier below.
    const { subtotalMonthly, subtotalOneTime } = computeSubtotals(lineItems);
    const discountType = quote.discountType as "PERCENT" | "AMOUNT" | null;
    const discountValue = quote.discountValue ? Number(quote.discountValue) : null;
    const monthlyDiscountMultiplier =
      subtotalMonthly > 0 ? applyDiscount(subtotalMonthly, discountType, discountValue) / subtotalMonthly : 1;
    const oneTimeDiscountMultiplier =
      subtotalOneTime > 0 ? applyDiscount(subtotalOneTime, discountType, discountValue) / subtotalOneTime : 1;
    const hasDiscount = Boolean(discountType && discountValue);
    const round2 = (n: number) => Math.round(n * 100) / 100;

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
      const isRecurring = item.billingType === "RECURRING_MONTHLY";
      const bucketMultiplier = item.billingType === "ONE_TIME" ? oneTimeDiscountMultiplier : monthlyDiscountMultiplier;
      const discountedUnitPrice = Number(item.unitPrice) * bucketMultiplier;
      resolvedLines.push({
        itemId: qboItemId,
        description: `${item.name} (${item.unitLabel})${isRecurring && isAnnual ? " — Annual (12 months)" : ""}${hasDiscount ? " (discount applied)" : ""}`,
        quantity: Number(item.quantity),
        unitPrice: round2(isRecurring ? discountedUnitPrice * annualMultiplier : discountedUnitPrice),
      });
    }

    // 3. Create the invoice. For MONTHLY billing this invoices everything
    //    currently on the quote (one-time fees + first month of recurring
    //    services) — standard MSP practice is to bill recurring managed
    //    services in ADVANCE (for the coming period, not the one just
    //    finished), with one-time/onboarding fees also due at signing. For
    //    ANNUAL billing the recurring lines above already cover the full
    //    12-month prepayment, so this same "one invoice" also fully covers
    //    the year. Ongoing billing beyond what this invoice covers (monthly
    //    renewals, or next year's annual renewal) needs a recurring
    //    mechanism — see the deployment guide for options.
    const msaSettings = await getMsaSettings();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + msaSettings.paymentDueDays);

    const invoice = await createQboInvoice({
      customerId: qboCustomerId,
      lines: resolvedLines,
      dueDate: dueDate.toISOString().slice(0, 10),
      privateNote: `MSP CRM quote #${quote.quoteNumber} — first invoice after signed MSA${isAnnual ? " (annual prepayment)" : ""}${hasDiscount ? ` (${discountType === "PERCENT" ? `${discountValue}% ` : `$${discountValue} `}discount applied)` : ""}.`,
    });

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

    // Confirmation email to whoever created the quote - mostly a paper
    // trail, since the person who clicked this button already knows, but
    // useful when the quote's creator isn't the one who pushed the invoice.
    await notifyQuoteCreator(
      quoteId,
      `First invoice created in QuickBooks — quote #${quote.quoteNumber}`,
      `<p>The first invoice for quote #${quote.quoteNumber}${quote.title ? ` — "${quote.title}"` : ""} (${customer.name}) was created in QuickBooks${invoice.DocNumber ? ` as invoice ${invoice.DocNumber}` : ""}.</p>
<p><a href="${await appUrl()}/quotes/${quoteId}">Open the quote</a></p>`
    );

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

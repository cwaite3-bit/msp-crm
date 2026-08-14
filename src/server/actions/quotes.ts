"use server";

import { db } from "@/server/db";
import {
  quotes,
  quoteLineItems,
  quoteEvents,
  products,
  productTierPrices,
  productCategories,
  serviceTiers,
  customers,
} from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computeQuoteTotals } from "@/server/pricing";
import { headers } from "next/headers";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

async function recalcAndSaveTotals(quoteId: string) {
  const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const totals = computeQuoteTotals(items, {
    discountType: quote?.discountType as "PERCENT" | "AMOUNT" | null,
    discountValue: quote?.discountValue ? Number(quote.discountValue) : null,
    taxRatePct: quote?.taxRatePct ? Number(quote.taxRatePct) : null,
  });
  await db
    .update(quotes)
    .set({
      subtotalMonthly: totals.subtotalMonthly.toFixed(2),
      subtotalOneTime: totals.subtotalOneTime.toFixed(2),
      totalMonthly: totals.totalMonthly.toFixed(2),
      totalOneTime: totals.totalOneTime.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));
}

export async function createQuote(customerId: string, contactId?: string) {
  const user = await requireUser();
  const [defaultTier] = await db.select().from(serviceTiers).where(eq(serviceTiers.isDefault, true)).limit(1);

  const [quote] = await db
    .insert(quotes)
    .values({
      customerId,
      contactId: contactId || null,
      createdById: user.id,
      serviceTierId: defaultTier?.id || null,
    })
    .returning();

  await db.insert(quoteEvents).values({ quoteId: quote.id, type: "CREATED" });
  revalidatePath(`/customers/${customerId}`);
  redirect(`/quotes/${quote.id}`);
}

export async function updateQuoteMeta(
  quoteId: string,
  data: {
    title?: string;
    serviceTierId?: string | null;
    contactId?: string | null;
    notesToClient?: string;
    internalNotes?: string;
    discountType?: "PERCENT" | "AMOUNT" | null;
    discountValue?: string | null;
    taxRatePct?: string | null;
    validUntil?: string | null;
  }
) {
  await requireUser();
  await db
    .update(quotes)
    .set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.serviceTierId !== undefined ? { serviceTierId: data.serviceTierId } : {}),
      ...(data.contactId !== undefined ? { contactId: data.contactId } : {}),
      ...(data.notesToClient !== undefined ? { notesToClient: data.notesToClient } : {}),
      ...(data.internalNotes !== undefined ? { internalNotes: data.internalNotes } : {}),
      ...(data.discountType !== undefined ? { discountType: data.discountType } : {}),
      ...(data.discountValue !== undefined ? { discountValue: data.discountValue } : {}),
      ...(data.taxRatePct !== undefined ? { taxRatePct: data.taxRatePct } : {}),
      ...(data.validUntil !== undefined
        ? { validUntil: data.validUntil ? new Date(data.validUntil) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

// Resolve the unit price for a product at a given service tier: use the
// tier-specific override if one exists, otherwise fall back to the product's
// default price.
async function resolveUnitPrice(productId: string, tierId?: string | null) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) throw new Error("Product not found");
  if (tierId) {
    const overrides = await db
      .select()
      .from(productTierPrices)
      .where(eq(productTierPrices.productId, productId));
    const match = overrides.find((o) => o.tierId === tierId);
    if (match) return { product, unitPrice: match.unitPrice };
  }
  return { product, unitPrice: product.defaultUnitPrice };
}

export async function addLineItemFromProduct(quoteId: string, productId: string, quantity: string = "1") {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const [category, unitPrice] = await Promise.all([
    (async () => {
      const [p] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      const [cat] = await db.select().from(productCategories).where(eq(productCategories.id, p.categoryId)).limit(1);
      return cat?.name || "Other";
    })(),
    resolveUnitPrice(productId, quote?.serviceTierId),
  ]);

  const qty = Number(quantity) || 1;
  const price = Number(unitPrice.unitPrice);

  const existing = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));

  await db.insert(quoteLineItems).values({
    quoteId,
    productId,
    categoryName: category,
    name: unitPrice.product.name,
    description: unitPrice.product.description,
    unitLabel: unitPrice.product.unitLabel,
    billingType: unitPrice.product.billingType,
    quantity: String(qty),
    unitPrice: unitPrice.unitPrice,
    lineTotal: (qty * price).toFixed(2),
    sortOrder: existing.length,
  });

  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function addCustomLineItem(
  quoteId: string,
  data: {
    categoryName: string;
    name: string;
    description?: string;
    unitLabel: string;
    billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
    quantity: string;
    unitPrice: string;
  }
) {
  await requireUser();
  const existing = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  const qty = Number(data.quantity) || 1;
  const price = Number(data.unitPrice) || 0;

  await db.insert(quoteLineItems).values({
    quoteId,
    categoryName: data.categoryName,
    name: data.name,
    description: data.description || null,
    unitLabel: data.unitLabel,
    billingType: data.billingType,
    quantity: String(qty),
    unitPrice: String(price),
    lineTotal: (qty * price).toFixed(2),
    sortOrder: existing.length,
  });

  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function updateLineItem(
  quoteId: string,
  lineItemId: string,
  data: { quantity?: string; unitPrice?: string }
) {
  await requireUser();
  const [item] = await db.select().from(quoteLineItems).where(eq(quoteLineItems.id, lineItemId)).limit(1);
  if (!item) return;
  const qty = data.quantity !== undefined ? Number(data.quantity) : Number(item.quantity);
  const price = data.unitPrice !== undefined ? Number(data.unitPrice) : Number(item.unitPrice);

  await db
    .update(quoteLineItems)
    .set({
      quantity: String(qty),
      unitPrice: String(price),
      lineTotal: (qty * price).toFixed(2),
    })
    .where(eq(quoteLineItems.id, lineItemId));

  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function removeLineItem(quoteId: string, lineItemId: string) {
  await requireUser();
  await db.delete(quoteLineItems).where(eq(quoteLineItems.id, lineItemId));
  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

// Re-price every line item that's tied to a catalog product against the
// quote's current service tier. Useful after switching tiers.
export async function repriceForTier(quoteId: string) {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));

  for (const item of items) {
    if (!item.productId) continue;
    const { unitPrice } = await resolveUnitPrice(item.productId, quote?.serviceTierId);
    const price = Number(unitPrice);
    const qty = Number(item.quantity);
    await db
      .update(quoteLineItems)
      .set({ unitPrice, lineTotal: (qty * price).toFixed(2) })
      .where(eq(quoteLineItems.id, item.id));
  }

  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function setQuoteStatus(quoteId: string, status: "DRAFT" | "SENT" | "REJECTED") {
  await requireUser();
  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "SENT") patch.sentAt = new Date();
  await db.update(quotes).set(patch).where(eq(quotes.id, quoteId));
  await db.insert(quoteEvents).values({ quoteId, type: status === "SENT" ? "SENT" : "REJECTED" });
  revalidatePath(`/quotes/${quoteId}`);
}

export async function deleteQuote(quoteId: string) {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  await db.delete(quotes).where(eq(quotes.id, quoteId));
  revalidatePath("/quotes");
  if (quote) revalidatePath(`/customers/${quote.customerId}`);
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) actions used from the client-facing /q/[token] view
// ---------------------------------------------------------------------------

export async function recordQuoteView(publicToken: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, publicToken)).limit(1);
  if (!quote) return;
  const now = new Date();
  await db
    .update(quotes)
    .set({
      status: quote.status === "SENT" ? "VIEWED" : quote.status,
      firstViewedAt: quote.firstViewedAt ?? now,
      lastViewedAt: now,
    })
    .where(eq(quotes.id, quote.id));
  await db.insert(quoteEvents).values({ quoteId: quote.id, type: "VIEWED" });
}

export async function acceptQuotePublic(publicToken: string, acceptedByName: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, publicToken)).limit(1);
  if (!quote) throw new Error("Quote not found");
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;

  await db
    .update(quotes)
    .set({
      status: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedByName,
      acceptedIp: ip,
    })
    .where(eq(quotes.id, quote.id));

  await db.insert(quoteEvents).values({ quoteId: quote.id, type: "ACCEPTED", detail: acceptedByName });

  // Mark the customer ACTIVE once they've accepted a quote.
  await db.update(customers).set({ status: "ACTIVE" }).where(eq(customers.id, quote.customerId));

  revalidatePath(`/quotes/${quote.id}`);
}

export async function rejectQuotePublic(publicToken: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, publicToken)).limit(1);
  if (!quote) throw new Error("Quote not found");
  await db.update(quotes).set({ status: "REJECTED", rejectedAt: new Date() }).where(eq(quotes.id, quote.id));
  await db.insert(quoteEvents).values({ quoteId: quote.id, type: "REJECTED" });
  revalidatePath(`/quotes/${quote.id}`);
}

export async function listQuotes() {
  await requireUser();
  return db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      title: quotes.title,
      status: quotes.status,
      totalMonthly: quotes.totalMonthly,
      totalOneTime: quotes.totalOneTime,
      createdAt: quotes.createdAt,
      customerId: quotes.customerId,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .orderBy(desc(quotes.createdAt));
}

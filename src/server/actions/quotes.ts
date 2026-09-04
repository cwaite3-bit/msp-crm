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
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computeQuoteTotals } from "@/server/pricing";
import { headers } from "next/headers";
import { getRateCard, getChecklistTemplate } from "@/server/actions/settings";
import {
  computeAddOnLineItems,
  computeRecommendedTier,
  computePlanFitStatus,
  computeManagerApprovalRequired,
  computeTierPricing,
  computeVcioOverageHours,
  effectiveRiskAdjustment,
  EMPTY_QUANTITIES,
  DEFAULT_RISK_FACTORS,
  EMPTY_ADD_ONS,
  type Quantities,
  type RiskFactors,
  type AddOnSelections,
} from "@/server/pricing-rules";
import { TIER_LABELS, tierKeyFromName, type TierKey } from "@/server/pricing-data";

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
  const checklistTemplate = await getChecklistTemplate();

  const [quote] = await db
    .insert(quotes)
    .values({
      customerId,
      contactId: contactId || null,
      createdById: user.id,
      serviceTierId: defaultTier?.id || null,
      checklist: checklistTemplate.map((item) => ({ key: item.key, status: "Review", note: "" })),
    })
    .returning();

  await db.insert(quoteEvents).values({ quoteId: quote.id, type: "CREATED" });
  revalidatePath(`/customers/${customerId}`);
  redirect(`/quotes/${quote.id}`);
}

// ---------------------------------------------------------------------------
// Pricing-engine intake: Discovery (environment + risk), optional add-ons,
// pre-quote checklist, and applying a computed tier to the quote's line
// items. See src/server/pricing-rules.ts for the underlying math.
// ---------------------------------------------------------------------------

function readQuantities(raw: unknown): Quantities {
  return { ...EMPTY_QUANTITIES, ...(raw as Partial<Quantities>) };
}
function readRiskFactors(raw: unknown): RiskFactors {
  return { ...DEFAULT_RISK_FACTORS, ...(raw as Partial<RiskFactors>) };
}
function readAddOns(raw: unknown): AddOnSelections {
  return { ...EMPTY_ADD_ONS, ...(raw as Partial<AddOnSelections>) };
}

// Recomputes and caches the guardrail fields (recommended tier, risk %,
// plan fit, manager-approval flag, margin % / status for the *currently
// selected* tier) — same "compute then cache" pattern as
// recalcAndSaveTotals, so the quotes list and any summary views don't need
// to re-run the engine just to show a status badge.
async function recalcEngineFields(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return;

  const rateCard = await getRateCard();
  const quantities = readQuantities(quote.quantities);
  const risk = readRiskFactors(quote.riskFactors);
  const addOns = readAddOns(quote.addOnSelections);
  const discountPct = quote.discountType === "PERCENT" && quote.discountValue ? Number(quote.discountValue) / 100 : 0;

  const recommendedTier = computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: addOns.vcioEnabled });
  const riskAdjustmentPct = effectiveRiskAdjustment(risk);

  let selectedTierKey: TierKey | null = null;
  if (quote.serviceTierId) {
    const [tierRow] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    selectedTierKey = tierKeyFromName(tierRow?.name);
  }

  let planFitStatus: "OK" | "REVIEW" | null = null;
  let managerApprovalRequired = false;
  let grossMarginPct: number | null = null;
  let marginStatus: "OK" | "REVIEW" | null = null;

  if (selectedTierKey) {
    planFitStatus = computePlanFitStatus(recommendedTier, selectedTierKey);
    managerApprovalRequired = computeManagerApprovalRequired({
      planFitStatus,
      manualRiskOverrideUsed: risk.manualOverrideEnabled,
      discountPct,
    });
    const pricing = computeTierPricing({
      quantities,
      riskAdjustmentPct,
      addOns,
      complianceProgram: risk.complianceProgram,
      rateCard,
      tier: selectedTierKey,
      discountPct,
      waiveMinimumMrr: quote.waiveMinimumMrr,
    });
    grossMarginPct = pricing.grossMarginPct;
    marginStatus = pricing.marginStatus;
  }

  await db
    .update(quotes)
    .set({
      recommendedTier,
      riskAdjustmentPct: riskAdjustmentPct.toFixed(4),
      planFitStatus,
      managerApprovalRequired,
      grossMarginPct: grossMarginPct !== null ? grossMarginPct.toFixed(4) : null,
      marginStatus,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));
}

export async function updateDiscovery(
  quoteId: string,
  data: { quantities: Quantities; riskFactors: RiskFactors }
) {
  await requireUser();
  await db
    .update(quotes)
    .set({ quantities: data.quantities, riskFactors: data.riskFactors, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));
  await recalcEngineFields(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function updateAddOns(quoteId: string, addOnSelections: AddOnSelections) {
  await requireUser();
  await db.update(quotes).set({ addOnSelections, updatedAt: new Date() }).where(eq(quotes.id, quoteId));
  await recalcEngineFields(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function updateChecklistItem(
  quoteId: string,
  key: string,
  patch: { status?: string; note?: string }
) {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return;
  const checklist = (quote.checklist as { key: string; status: string; note?: string }[]) || [];
  const next = checklist.map((item) => (item.key === key ? { ...item, ...patch } : item));
  await db.update(quotes).set({ checklist: next, updatedAt: new Date() }).where(eq(quotes.id, quoteId));
  revalidatePath(`/quotes/${quoteId}`);
}

// One-click "mark all complete" for staff who don't want to click through
// every item individually. Only flips items still sitting at "Review" —
// anything already marked "N/A" (a deliberate call, e.g. a compliance
// question that doesn't apply to this customer) is left as-is rather than
// being overwritten to "Complete", which would misrepresent it.
export async function completeAllChecklistItems(quoteId: string) {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return;
  const checklist = (quote.checklist as { key: string; status: string; note?: string }[]) || [];
  const next = checklist.map((item) => (item.status === "Review" ? { ...item, status: "Complete" } : item));
  await db.update(quotes).set({ checklist: next, updatedAt: new Date() }).where(eq(quotes.id, quoteId));
  revalidatePath(`/quotes/${quoteId}`);
}

// Sets the quote's selected tier and regenerates its ENGINE-sourced line
// items from the pricing engine. Hand-added/"add on the fly" (MANUAL) line
// items are left untouched. Safe to call repeatedly, e.g. after editing
// Discovery or add-ons and wanting the line items to catch up.
export async function applyEngineTier(quoteId: string, tier: TierKey) {
  await requireUser();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) throw new Error("Quote not found");

  const allTiers = await db.select().from(serviceTiers);
  const tierRow = allTiers.find((t) => tierKeyFromName(t.name) === tier);
  if (!tierRow) {
    throw new Error(`No "${TIER_LABELS[tier]}" service tier is configured. Check Settings → Catalog.`);
  }

  const rateCard = await getRateCard();
  const quantities = readQuantities(quote.quantities);
  const risk = readRiskFactors(quote.riskFactors);
  const addOns = readAddOns(quote.addOnSelections);
  const discountPct = quote.discountType === "PERCENT" && quote.discountValue ? Number(quote.discountValue) / 100 : 0;
  const riskAdjustmentPct = effectiveRiskAdjustment(risk);

  const pricing = computeTierPricing({
    quantities,
    riskAdjustmentPct,
    addOns,
    complianceProgram: risk.complianceProgram,
    rateCard,
    tier,
    discountPct,
    waiveMinimumMrr: quote.waiveMinimumMrr,
  });

  await db.update(quotes).set({ serviceTierId: tierRow.id, updatedAt: new Date() }).where(eq(quotes.id, quoteId));

  await db
    .delete(quoteLineItems)
    .where(and(eq(quoteLineItems.quoteId, quoteId), eq(quoteLineItems.source, "ENGINE")));

  const manualItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  let sortOrder = manualItems.length;
  const rows: (typeof quoteLineItems.$inferInsert)[] = [];

  const push = (
    categoryName: string,
    name: string,
    amount: number,
    billingType: "RECURRING_MONTHLY" | "ONE_TIME",
    description?: string
  ) => {
    if (Math.abs(amount) < 0.005) return;
    rows.push({
      quoteId,
      source: "ENGINE",
      categoryName,
      name,
      description: description ?? null,
      unitLabel: "flat",
      billingType,
      quantity: "1",
      unitPrice: amount.toFixed(2),
      lineTotal: amount.toFixed(2),
      sortOrder: sortOrder++,
    });
  };

  push(
    "Managed Services",
    `Managed IT Services — ${TIER_LABELS[tier]} Plan`,
    pricing.baseSubtotal + pricing.riskPremium,
    "RECURRING_MONTHLY",
    pricing.riskPremium > 0
      ? `Includes a ${(riskAdjustmentPct * 100).toFixed(1)}% risk-adjusted premium based on Discovery`
      : undefined
  );

  if (pricing.minimumMrrAdjustment > 0) {
    push(
      "Managed Services",
      "Minimum monthly engagement adjustment",
      pricing.minimumMrrAdjustment,
      "RECURRING_MONTHLY",
      `${TIER_LABELS[tier]} plan minimum is $${rateCard.tiers[tier].minimumMrr.toLocaleString()}/mo`
    );
  }

  for (const item of computeAddOnLineItems(addOns, risk.complianceProgram, rateCard)) {
    push("Add-Ons", item.label, item.amount, "RECURRING_MONTHLY");
  }

  const vcioOverageHours = computeVcioOverageHours(addOns, rateCard.tiers[tier].vcioIncludedHoursPerMonth);
  if (vcioOverageHours > 0) {
    push(
      "Add-Ons",
      `vCIO overage (${vcioOverageHours} hrs beyond plan allowance)`,
      pricing.vcioOverageSell,
      "RECURRING_MONTHLY"
    );
  }

  const onboardingHoursFee = pricing.onboardingFeeSell - addOns.oneTimeProjectSell;
  if (onboardingHoursFee > 0) {
    push("Onboarding", "Onboarding / Stabilization", onboardingHoursFee, "ONE_TIME");
  }
  if (addOns.oneTimeProjectSell > 0) {
    push("Onboarding", "One-Time Project / Remediation", addOns.oneTimeProjectSell, "ONE_TIME");
  }

  if (rows.length) await db.insert(quoteLineItems).values(rows);

  await recalcEngineFields(quoteId);
  await recalcAndSaveTotals(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

// Waives (or restores) the selected tier's minimum-MRR floor for this one
// quote — for a genuinely small opportunity where the standard floor would
// overprice the customer. Persists on the quote itself (not the rate
// card), so it survives refresh and applies every time the plan is
// re-priced. If a tier is already selected, immediately re-applies it so
// the "Minimum monthly engagement adjustment" line item appears/disappears
// without a separate manual re-apply click.
export async function setWaiveMinimumMrr(quoteId: string, waive: boolean) {
  await requireUser();
  await db.update(quotes).set({ waiveMinimumMrr: waive, updatedAt: new Date() }).where(eq(quotes.id, quoteId));

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (quote?.serviceTierId) {
    const [tierRow] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    const tierKey = tierKeyFromName(tierRow?.name);
    if (tierKey) {
      await applyEngineTier(quoteId, tierKey);
      return;
    }
  }

  await recalcEngineFields(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
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
  await recalcEngineFields(quoteId); // discount % feeds the manager-approval/margin guardrails
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

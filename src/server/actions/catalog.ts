"use server";

import { db } from "@/server/db";
import { productCategories, serviceTiers, products, productTierPrices, quotes } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { TIER_COLOR_KEYS, DEFAULT_TIER_COLOR, type TierColorKey } from "@/lib/tier-colors";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function listCatalog() {
  const [categories, tiers, allProducts, allTierPrices] = await Promise.all([
    db.select().from(productCategories).orderBy(productCategories.sortOrder),
    db.select().from(serviceTiers).orderBy(serviceTiers.sortOrder),
    db.select().from(products).where(eq(products.active, true)),
    db.select().from(productTierPrices),
  ]);
  return { categories, tiers, products: allProducts, tierPrices: allTierPrices };
}

// ---- Categories ----

export async function createCategory(name: string) {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name is required");
  const [existing] = await db.select().from(productCategories).where(eq(productCategories.name, trimmed)).limit(1);
  if (existing) return existing;
  const [row] = await db.insert(productCategories).values({ name: trimmed }).returning();
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return row;
}

// ---- Service tiers ----

function isTierColorKey(value: string): value is TierColorKey {
  return (TIER_COLOR_KEYS as readonly string[]).includes(value);
}

export async function createTier(name: string, description?: string, color?: string) {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Tier name is required");

  // New tiers sort to the end and pick the next unused color in rotation
  // by default (so a freshly created tier is already color-coded, not
  // left gray until someone remembers to set it) — but staff can override
  // right there in the "New service tier" dialog.
  const existingTiers = await db.select().from(serviceTiers);
  const nextSortOrder = existingTiers.length
    ? Math.max(...existingTiers.map((t) => t.sortOrder)) + 1
    : 0;
  const resolvedColor =
    color && isTierColorKey(color) ? color : TIER_COLOR_KEYS[existingTiers.length % TIER_COLOR_KEYS.length];

  const [row] = await db
    .insert(serviceTiers)
    .values({ name: trimmed, description, color: resolvedColor, sortOrder: nextSortOrder })
    .returning();
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return row;
}

export async function updateTierColor(tierId: string, color: string) {
  await requireUser();
  const resolvedColor = isTierColorKey(color) ? color : DEFAULT_TIER_COLOR;
  await db.update(serviceTiers).set({ color: resolvedColor }).where(eq(serviceTiers.id, tierId));
  revalidatePath("/catalog");
  revalidatePath("/quotes");
}

// Renames a tier and/or updates its description. Returns a result object
// (rather than throwing) so a duplicate name — `service_tiers.name` is
// unique — comes back as a message the dialog can show inline instead of
// an unhandled rejection.
export async function updateTier(
  tierId: string,
  name: string,
  description?: string
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Tier name is required" };

  const [clash] = await db.select().from(serviceTiers).where(eq(serviceTiers.name, trimmed)).limit(1);
  if (clash && clash.id !== tierId) {
    return { ok: false, error: `A tier named "${trimmed}" already exists` };
  }

  await db
    .update(serviceTiers)
    .set({ name: trimmed, description: description?.trim() || null })
    .where(eq(serviceTiers.id, tierId));
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return { ok: true };
}

// Deletes a tier outright. Guarded against the two ways this could quietly
// break something else: the tier being relied on as the fallback for new
// quotes (`isDefault` — see createQuote in actions/quotes.ts), or an
// existing quote already pointing at it (`quotes.serviceTierId` has no
// cascade, so leaving that unchecked would otherwise surface as a raw
// Postgres foreign-key error instead of a message staff can act on). Its
// per-product prices in `product_tier_prices` DO cascade automatically
// (see the schema) since those are only meaningful alongside the tier.
export async function deleteTier(tierId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const [tier] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, tierId)).limit(1);
  if (!tier) return { ok: false, error: "Tier not found" };

  if (tier.isDefault) {
    return { ok: false, error: "This is the default tier used for new quotes, so it can't be deleted." };
  }

  const quotesUsingTier = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.serviceTierId, tierId));
  if (quotesUsingTier.length > 0) {
    return {
      ok: false,
      error: `${quotesUsingTier.length} quote${quotesUsingTier.length === 1 ? " is" : "s are"} still set to this tier — reassign ${
        quotesUsingTier.length === 1 ? "it" : "them"
      } to a different tier before deleting it.`,
    };
  }

  await db.delete(serviceTiers).where(eq(serviceTiers.id, tierId));
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return { ok: true };
}

// Persists a full new left-to-right order for every tier at once (from
// drag-and-drop reordering on the Catalog page) — `orderedIds` must be
// exactly the current set of tier IDs, just reshuffled, so a stray or
// missing ID (e.g. a tier deleted by someone else mid-drag) is rejected
// rather than silently reassigning sort order to the wrong tiers.
export async function reorderTiers(orderedIds: string[]): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const currentTiers = await db.select().from(serviceTiers);
  const currentIds = new Set(currentTiers.map((t) => t.id));
  const sameSet = orderedIds.length === currentIds.size && orderedIds.every((id) => currentIds.has(id));
  if (!sameSet) {
    return { ok: false, error: "The tier list changed — refresh and try again." };
  }
  await Promise.all(
    orderedIds.map((id, index) => db.update(serviceTiers).set({ sortOrder: index }).where(eq(serviceTiers.id, id))),
  );
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return { ok: true };
}

// ---- Products ----

const productInputSchema = {
  name: (v: FormDataEntryValue | null) => String(v || "").trim(),
};

export async function createProduct(formData: FormData) {
  await requireUser();
  const name = productInputSchema.name(formData.get("name"));
  let categoryId = String(formData.get("categoryId") || "");
  const newCategoryName = String(formData.get("newCategoryName") || "").trim();
  const unitLabel = String(formData.get("unitLabel") || "flat").trim() || "flat";
  const billingType = String(formData.get("billingType") || "RECURRING_MONTHLY") as
    | "RECURRING_MONTHLY"
    | "ONE_TIME"
    | "HOURLY";
  const defaultUnitPrice = String(formData.get("defaultUnitPrice") || "0");
  const cost = String(formData.get("cost") || "") || null;
  const description = String(formData.get("description") || "") || null;

  if (!name) throw new Error("Product name is required");

  if (!categoryId && newCategoryName) {
    const cat = await createCategory(newCategoryName);
    categoryId = cat.id;
  }
  if (!categoryId) throw new Error("A category is required");

  const [row] = await db
    .insert(products)
    .values({ name, categoryId, unitLabel, billingType, defaultUnitPrice, cost, description })
    .returning();

  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return row;
}

export async function updateProduct(productId: string, formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") || "").trim();
  const categoryId = String(formData.get("categoryId") || "");
  const unitLabel = String(formData.get("unitLabel") || "flat").trim() || "flat";
  const billingType = String(formData.get("billingType") || "RECURRING_MONTHLY") as
    | "RECURRING_MONTHLY"
    | "ONE_TIME"
    | "HOURLY";
  const defaultUnitPrice = String(formData.get("defaultUnitPrice") || "0");
  const cost = String(formData.get("cost") || "") || null;
  const description = String(formData.get("description") || "") || null;

  await db
    .update(products)
    .set({ name, categoryId, unitLabel, billingType, defaultUnitPrice, cost, description, updatedAt: new Date() })
    .where(eq(products.id, productId));

  revalidatePath("/catalog");
  revalidatePath("/quotes");
}

export async function archiveProduct(productId: string) {
  await requireUser();
  await db.update(products).set({ active: false }).where(eq(products.id, productId));
  revalidatePath("/catalog");
}

export async function setTierPrice(productId: string, tierId: string, unitPrice: string) {
  await requireUser();
  const existing = await db
    .select()
    .from(productTierPrices)
    .where(eq(productTierPrices.productId, productId));
  const match = existing.find((e) => e.tierId === tierId);
  if (match) {
    await db.update(productTierPrices).set({ unitPrice }).where(eq(productTierPrices.id, match.id));
  } else {
    await db.insert(productTierPrices).values({ productId, tierId, unitPrice });
  }
  revalidatePath("/catalog");
  revalidatePath("/quotes");
}

export async function clearTierPrice(productId: string, tierId: string) {
  await requireUser();
  const existing = await db
    .select()
    .from(productTierPrices)
    .where(eq(productTierPrices.productId, productId));
  const match = existing.find((e) => e.tierId === tierId);
  if (match) await db.delete(productTierPrices).where(eq(productTierPrices.id, match.id));
  revalidatePath("/catalog");
}

// Quick-create used from inside the quote builder ("add on the fly").
export async function quickCreateProduct(input: {
  name: string;
  description?: string;
  categoryId?: string;
  newCategoryName?: string;
  unitLabel: string;
  billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
  defaultUnitPrice: string;
}) {
  await requireUser();
  let categoryId = input.categoryId;
  if (!categoryId && input.newCategoryName) {
    const cat = await createCategory(input.newCategoryName);
    categoryId = cat.id;
  }
  if (!categoryId) throw new Error("A category is required");

  const [row] = await db
    .insert(products)
    .values({
      name: input.name.trim(),
      description: input.description || null,
      categoryId,
      unitLabel: input.unitLabel || "flat",
      billingType: input.billingType,
      defaultUnitPrice: input.defaultUnitPrice,
    })
    .returning();

  revalidatePath("/catalog");
  return row;
}

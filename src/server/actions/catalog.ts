"use server";

import { db } from "@/server/db";
import { productCategories, serviceTiers, products, productTierPrices } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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

export async function createTier(name: string, description?: string) {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Tier name is required");
  const [row] = await db.insert(serviceTiers).values({ name: trimmed, description }).returning();
  revalidatePath("/catalog");
  revalidatePath("/quotes");
  return row;
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
      categoryId,
      unitLabel: input.unitLabel || "flat",
      billingType: input.billingType,
      defaultUnitPrice: input.defaultUnitPrice,
    })
    .returning();

  revalidatePath("/catalog");
  return row;
}

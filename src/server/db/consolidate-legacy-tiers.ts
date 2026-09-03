// One-time cleanup for databases that already had the old Good/Better/Best
// service tiers seeded before the Bronze/Silver/Gold pricing-engine rename.
// `seed.ts`'s upsertTier() only inserts a tier if a row with that exact name
// doesn't already exist — it never renames an existing tier — so re-running
// the updated seed against a database that already had Good/Better/Best
// leaves you with all six tiers side by side (this is what happened on
// production: the catalog page showed "Good price" through "Gold price").
//
// This script merges each legacy tier into its Bronze/Silver/Gold
// counterpart in place: any quotes or product_tier_prices pointing at the
// legacy tier are moved over first (respecting the product_tier_prices
// unique (product, tier) constraint — if the modern tier already has a
// price for a product, the legacy price for that product is dropped rather
// than causing a conflict), then the now-unreferenced legacy tier row is
// deleted. Safe to re-run — if a database is already fully on
// Bronze/Silver/Gold with no Good/Better/Best rows left, this is a no-op
// aside from double-checking sortOrder/isDefault.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { serviceTiers, productTierPrices, quotes } from "./schema";

const LEGACY_TO_MODERN: Record<
  string,
  { name: string; description: string; sortOrder: number; isDefault: boolean }
> = {
  Good: {
    name: "Bronze",
    description: "Managed Foundation — business hours support, standard priority",
    sortOrder: 0,
    isDefault: false,
  },
  Better: {
    name: "Silver",
    description: "Managed Complete — unlimited qualifying help desk, priority response",
    sortOrder: 1,
    isDefault: true,
  },
  Best: {
    name: "Gold",
    description: "Managed Premier — highest priority, vCIO strategic allowance",
    sortOrder: 2,
    isDefault: false,
  },
};

async function main() {
  const allTiers = await db.select().from(serviceTiers);

  for (const [legacyName, target] of Object.entries(LEGACY_TO_MODERN)) {
    const legacy = allTiers.find((t) => t.name === legacyName);
    const modern = allTiers.find((t) => t.name === target.name);

    if (!legacy && !modern) {
      console.log(`No "${legacyName}" or "${target.name}" tier found — skipping.`);
      continue;
    }

    if (legacy && !modern) {
      console.log(`Renaming "${legacyName}" -> "${target.name}" in place (id ${legacy.id}).`);
      await db
        .update(serviceTiers)
        .set({
          name: target.name,
          description: target.description,
          sortOrder: target.sortOrder,
          isDefault: target.isDefault,
        })
        .where(eq(serviceTiers.id, legacy.id));
      continue;
    }

    if (!legacy && modern) {
      console.log(`"${target.name}" already present with no legacy "${legacyName}" row — nothing to merge.`);
      await db
        .update(serviceTiers)
        .set({ description: target.description, sortOrder: target.sortOrder, isDefault: target.isDefault })
        .where(eq(serviceTiers.id, modern.id));
      continue;
    }

    // Both a legacy and a modern row exist — merge legacy into modern.
    console.log(`Merging legacy "${legacyName}" (${legacy!.id}) into "${target.name}" (${modern!.id})…`);

    const movedQuotes = await db
      .update(quotes)
      .set({ serviceTierId: modern!.id })
      .where(eq(quotes.serviceTierId, legacy!.id))
      .returning({ id: quotes.id });
    if (movedQuotes.length) console.log(`  moved ${movedQuotes.length} quote(s) onto "${target.name}"`);

    const legacyPrices = await db.select().from(productTierPrices).where(eq(productTierPrices.tierId, legacy!.id));
    const modernPrices = await db.select().from(productTierPrices).where(eq(productTierPrices.tierId, modern!.id));
    const modernProductIds = new Set(modernPrices.map((p) => p.productId));

    for (const price of legacyPrices) {
      if (modernProductIds.has(price.productId)) {
        console.log(`  product ${price.productId} already has a "${target.name}" price — dropping the legacy "${legacyName}" price`);
        await db.delete(productTierPrices).where(eq(productTierPrices.id, price.id));
      } else {
        await db.update(productTierPrices).set({ tierId: modern!.id }).where(eq(productTierPrices.id, price.id));
      }
    }

    await db.delete(serviceTiers).where(eq(serviceTiers.id, legacy!.id));
    await db
      .update(serviceTiers)
      .set({ description: target.description, sortOrder: target.sortOrder, isDefault: target.isDefault })
      .where(eq(serviceTiers.id, modern!.id));
    console.log(`  done — "${legacyName}" removed, "${target.name}" retained.`);
  }

  // Make sure exactly one tier (Silver) is flagged default.
  const finalTiers = await db.select().from(serviceTiers);
  for (const t of finalTiers) {
    const shouldBeDefault = t.name === "Silver";
    if (t.isDefault !== shouldBeDefault) {
      await db.update(serviceTiers).set({ isDefault: shouldBeDefault }).where(eq(serviceTiers.id, t.id));
    }
  }

  console.log("\nFinal service tiers:");
  console.table(
    (await db.select().from(serviceTiers)).map((t) => ({
      name: t.name,
      sortOrder: t.sortOrder,
      isDefault: t.isDefault,
    }))
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

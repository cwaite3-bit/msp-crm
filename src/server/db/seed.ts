// Seeds an initial admin user, the Bronze/Silver/Gold pricing-engine
// settings (rate card, scope matrix, pre-quote checklist template — ported
// from the Lockdown IT quote-builder spreadsheet, see pricing-data.ts), and
// a starter catalog of a-la-carte products for one-off/manual line items.
// Safe to re-run — it upserts by unique name/key/email.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, productCategories, serviceTiers, products, productTierPrices, appSettings } from "./schema";
import { eq } from "drizzle-orm";
import { DEFAULT_RATE_CARD, DEFAULT_SCOPE_MATRIX, DEFAULT_CHECKLIST_TEMPLATE } from "../pricing-data";

async function upsertUser(name: string, email: string, password: string, role: "ADMIN" | "STAFF") {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];
  const passwordHash = await bcrypt.hash(password, 10);
  const [row] = await db.insert(users).values({ name, email, passwordHash, role }).returning();
  return row;
}

async function upsertCategory(name: string, sortOrder: number) {
  const existing = await db.select().from(productCategories).where(eq(productCategories.name, name)).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(productCategories).values({ name, sortOrder }).returning();
  return row;
}

async function upsertTier(name: string, description: string, sortOrder: number, isDefault = false) {
  const existing = await db.select().from(serviceTiers).where(eq(serviceTiers.name, name)).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(serviceTiers).values({ name, description, sortOrder, isDefault }).returning();
  return row;
}

async function upsertProduct(input: {
  categoryId: string;
  name: string;
  description?: string;
  unitLabel: string;
  billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
  defaultUnitPrice: string;
  cost?: string;
  tierPrices?: { tierId: string; unitPrice: string }[];
}) {
  const existing = await db
    .select()
    .from(products)
    .where(eq(products.name, input.name))
    .limit(1);
  let row = existing[0];
  if (!row) {
    [row] = await db
      .insert(products)
      .values({
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        unitLabel: input.unitLabel,
        billingType: input.billingType,
        defaultUnitPrice: input.defaultUnitPrice,
        cost: input.cost,
      })
      .returning();
  }
  if (input.tierPrices) {
    for (const tp of input.tierPrices) {
      const existingTp = await db
        .select()
        .from(productTierPrices)
        .where(eq(productTierPrices.productId, row.id));
      const already = existingTp.find((e) => e.tierId === tp.tierId);
      if (!already) {
        await db.insert(productTierPrices).values({ productId: row.id, tierId: tp.tierId, unitPrice: tp.unitPrice });
      }
    }
  }
  return row;
}

async function upsertAppSetting(key: string, value: unknown) {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing) return existing;
  const [row] = await db.insert(appSettings).values({ key, value: value as object }).returning();
  return row;
}

async function main() {
  console.log("Seeding admin user…");
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  await upsertUser("Admin", adminEmail, adminPassword, "ADMIN");
  console.log(`  admin login: ${adminEmail} / ${adminPassword} (CHANGE THIS PASSWORD)`);

  console.log("Seeding pricing engine settings (rate card / scope matrix / checklist)…");
  await upsertAppSetting("pricingRateCard", DEFAULT_RATE_CARD);
  await upsertAppSetting("scopeMatrix", DEFAULT_SCOPE_MATRIX);
  await upsertAppSetting("checklistTemplate", DEFAULT_CHECKLIST_TEMPLATE);

  console.log("Seeding service tiers…");
  // Bronze/Silver/Gold, matching the Lockdown IT quote-builder spreadsheet's
  // plans. Silver is the default for a new quote — it's the workbook's own
  // "usual" example scenario.
  const good = await upsertTier("Bronze", "Managed Foundation — business hours support, standard priority", 0);
  const better = await upsertTier("Silver", "Managed Complete — unlimited qualifying help desk, priority response", 1, true);
  const best = await upsertTier("Gold", "Managed Premier — highest priority, vCIO strategic allowance", 2);

  console.log("Seeding product categories…");
  const support = await upsertCategory("Support", 0);
  const network = await upsertCategory("Network", 1);
  const services = await upsertCategory("Services", 2);

  console.log("Seeding catalog items…");
  await upsertProduct({
    categoryId: support.id,
    name: "User support",
    unitLabel: "per user",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "85.00",
    cost: "35.00",
    tierPrices: [
      { tierId: good.id, unitPrice: "75.00" },
      { tierId: better.id, unitPrice: "95.00" },
      { tierId: best.id, unitPrice: "110.00" },
    ],
  });
  await upsertProduct({
    categoryId: support.id,
    name: "Workstation support",
    unitLabel: "per workstation",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "50.00",
    cost: "18.00",
  });
  await upsertProduct({
    categoryId: support.id,
    name: "Server support",
    unitLabel: "per server",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "325.00",
    cost: "140.00",
  });
  await upsertProduct({
    categoryId: support.id,
    name: "Tablet/phone management",
    unitLabel: "per device",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "15.00",
    cost: "5.00",
  });

  await upsertProduct({
    categoryId: network.id,
    name: "Firewall management",
    unitLabel: "per firewall",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "150.00",
    cost: "60.00",
  });
  await upsertProduct({
    categoryId: network.id,
    name: "Switch management",
    unitLabel: "per switch",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "45.00",
    cost: "15.00",
  });
  await upsertProduct({
    categoryId: network.id,
    name: "Access point management",
    unitLabel: "per access point",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "10.00",
    cost: "3.00",
  });

  await upsertProduct({
    categoryId: services.id,
    name: "Email threat protection",
    unitLabel: "per mailbox",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "5.00",
    cost: "1.50",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Mailbox backup",
    unitLabel: "per mailbox",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "6.00",
    cost: "2.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Endpoint detection & response",
    unitLabel: "per workstation",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "10.00",
    cost: "4.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Security awareness training",
    unitLabel: "per user",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "10.00",
    cost: "3.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Workstation backup",
    unitLabel: "per workstation",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "8.00",
    cost: "3.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Server backup — cloud",
    unitLabel: "per server",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "75.00",
    cost: "30.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Server backup — appliance",
    unitLabel: "per server",
    billingType: "RECURRING_MONTHLY",
    defaultUnitPrice: "95.00",
    cost: "40.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "New user onboarding",
    unitLabel: "flat",
    billingType: "ONE_TIME",
    defaultUnitPrice: "150.00",
    cost: "60.00",
  });
  await upsertProduct({
    categoryId: services.id,
    name: "Network assessment",
    unitLabel: "flat",
    billingType: "ONE_TIME",
    defaultUnitPrice: "500.00",
    cost: "150.00",
  });

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

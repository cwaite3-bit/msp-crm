// ============================================================================
// MSP CRM + Quoting — Drizzle schema
// Single-tenant (one company). Postgres (Neon on Vercel in production).
// ============================================================================
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  serial,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const cuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// ---------------------------------------------------------------------------
// App settings: singleton-per-key jsonb store for admin-editable structured
// config that doesn't need its own table (mirrors the jsonb-for-flexible-
// structured-data pattern already used on quotes.quantities/customers.tags).
// Keys in use: "pricingRateCard", "scopeMatrix", "checklistTemplate" — see
// src/server/pricing-data.ts for the shapes and the factory-default values.
// ---------------------------------------------------------------------------

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Auth / staff users
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "STAFF"]);

export const users = pgTable("users", {
  id: cuid(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("STAFF"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// CRM: customers (accounts) + contacts + notes/activity
// ---------------------------------------------------------------------------

export const customerStatusEnum = pgEnum("customer_status", [
  "LEAD",
  "PROSPECT",
  "ACTIVE",
  "FORMER",
]);

export const customers = pgTable(
  "customers",
  {
    id: cuid(),
    name: text("name").notNull(),
    status: customerStatusEnum("status").notNull().default("LEAD"),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    source: text("source"),
    employeeCount: integer("employee_count"),

    billingStreet: text("billing_street"),
    billingCity: text("billing_city"),
    billingState: text("billing_state"),
    billingZip: text("billing_zip"),
    billingCountry: text("billing_country").default("US"),

    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    accountOwnerId: text("account_owner_id").references(() => users.id),

    quickbooksCustomerId: text("quickbooks_customer_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("customers_status_idx").on(t.status)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: cuid(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("contacts_customer_idx").on(t.customerId)]
);

export const noteTypeEnum = pgEnum("note_type", ["NOTE", "CALL", "EMAIL", "MEETING"]);

export const notes = pgTable(
  "notes",
  {
    id: cuid(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id),
    type: noteTypeEnum("type").notNull().default("NOTE"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notes_customer_idx").on(t.customerId)]
);

// ---------------------------------------------------------------------------
// Catalog: categories, service tiers, products/services
// Staff can create a category, tier, or product inline from the quote
// builder ("add on the fly") without leaving the page.
// ---------------------------------------------------------------------------

export const productCategories = pgTable("product_categories", {
  id: cuid(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const serviceTiers = pgTable("service_tiers", {
  id: cuid(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const billingTypeEnum = pgEnum("billing_type", [
  "RECURRING_MONTHLY",
  "ONE_TIME",
  "HOURLY",
]);

export const products = pgTable(
  "products",
  {
    id: cuid(),
    categoryId: text("category_id")
      .notNull()
      .references(() => productCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku").unique(),
    unitLabel: text("unit_label").notNull().default("flat"),
    billingType: billingTypeEnum("billing_type").notNull().default("RECURRING_MONTHLY"),
    defaultUnitPrice: numeric("default_unit_price", { precision: 12, scale: 2 }).notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    quickbooksItemId: text("quickbooks_item_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("products_category_idx").on(t.categoryId)]
);

export const productTierPrices = pgTable(
  "product_tier_prices",
  {
    id: cuid(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tierId: text("tier_id")
      .notNull()
      .references(() => serviceTiers.id, { onDelete: "cascade" }),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("product_tier_unique").on(t.productId, t.tierId)]
);

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export const quoteStatusEnum = pgEnum("quote_status", [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
]);

export const quotes = pgTable(
  "quotes",
  {
    id: cuid(),
    quoteNumber: serial("quote_number").notNull(),

    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    contactId: text("contact_id").references(() => contacts.id),

    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),

    title: text("title").notNull().default("MSP Services Quote"),
    status: quoteStatusEnum("status").notNull().default("DRAFT"),
    serviceTierId: text("service_tier_id").references(() => serviceTiers.id),

    // Quantity inputs that drive the pricing-engine entry screen: users,
    // workstations, servers, locations, firewalls, switches, aps,
    // otherNetworkDevices. Kept as JSON so new quantity fields don't
    // require a migration. Shape: pricing-rules.ts `Quantities`.
    quantities: jsonb("quantities").notNull().default({}),

    // Discovery risk/complexity inputs (documentation quality, legacy
    // systems, compliance program, after-hours, multi-vendor, criticality,
    // incident history, manual risk override). Shape: pricing-rules.ts
    // `RiskFactors`.
    riskFactors: jsonb("risk_factors").notNull().default({}),

    // Optional service selections (vCIO, backup/BCDR, email security,
    // training, M365, onsite hours, custom add-on, one-time project).
    // Shape: pricing-rules.ts `AddOnSelections`.
    addOnSelections: jsonb("add_on_selections").notNull().default({}),

    // Pre-quote checklist state: array of { key, status, note }, defaulted
    // from app_settings["checklistTemplate"] when the quote is created.
    checklist: jsonb("checklist").notNull().default([]),

    // Cached pricing-engine outputs for the *selected* tier, recomputed
    // whenever quantities/riskFactors/addOnSelections/serviceTierId change
    // (same "recompute and cache" pattern as subtotal/total below) — avoids
    // re-running the engine just to show guardrails on the quotes list.
    recommendedTier: text("recommended_tier"), // "bronze" | "silver" | "gold"
    riskAdjustmentPct: numeric("risk_adjustment_pct", { precision: 6, scale: 4 }),
    planFitStatus: text("plan_fit_status"), // "OK" | "REVIEW"
    managerApprovalRequired: boolean("manager_approval_required").notNull().default(false),
    grossMarginPct: numeric("gross_margin_pct", { precision: 6, scale: 4 }),
    marginStatus: text("margin_status"), // "OK" | "REVIEW"

    notesToClient: text("notes_to_client"),
    internalNotes: text("internal_notes"),

    discountType: text("discount_type"), // "PERCENT" | "AMOUNT" | null
    discountValue: numeric("discount_value", { precision: 12, scale: 2 }),
    taxRatePct: numeric("tax_rate_pct", { precision: 5, scale: 2 }),

    // When true, this quote is exempt from the selected tier's minimum-MRR
    // floor (Settings → Rate card). Set per quote for genuinely small
    // opportunities where the standard floor would overprice the customer;
    // skips the floor in the pricing engine and suppresses the "Minimum
    // monthly engagement adjustment" line item. Persists until unset.
    waiveMinimumMrr: boolean("waive_minimum_mrr").notNull().default(false),

    subtotalMonthly: numeric("subtotal_monthly", { precision: 12, scale: 2 }).notNull().default("0"),
    subtotalOneTime: numeric("subtotal_one_time", { precision: 12, scale: 2 }).notNull().default("0"),
    totalMonthly: numeric("total_monthly", { precision: 12, scale: 2 }).notNull().default("0"),
    totalOneTime: numeric("total_one_time", { precision: 12, scale: 2 }).notNull().default("0"),

    validUntil: timestamp("valid_until"),

    publicToken: text("public_token")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID()),

    sentAt: timestamp("sent_at"),
    firstViewedAt: timestamp("first_viewed_at"),
    lastViewedAt: timestamp("last_viewed_at"),
    acceptedAt: timestamp("accepted_at"),
    acceptedByName: text("accepted_by_name"),
    acceptedIp: text("accepted_ip"),
    rejectedAt: timestamp("rejected_at"),

    quickbooksInvoiceId: text("quickbooks_invoice_id"),
    quickbooksEstimateId: text("quickbooks_estimate_id"),
    quickbooksSyncError: text("quickbooks_sync_error"),
    quickbooksSyncedAt: timestamp("quickbooks_synced_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_status_idx").on(t.status),
    uniqueIndex("quotes_quote_number_idx").on(t.quoteNumber),
  ]
);

export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: cuid(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id),

    // "ENGINE" rows are generated by the pricing-rules engine from
    // Discovery/add-on inputs and get replaced wholesale whenever the
    // selected tier or those inputs change; "MANUAL" rows (the pre-existing
    // catalog / "add on the fly" flow) are never touched by that process.
    source: text("source").notNull().default("MANUAL"), // "MANUAL" | "ENGINE"

    categoryName: text("category_name").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unitLabel: text("unit_label").notNull(),
    billingType: billingTypeEnum("billing_type").notNull(),

    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),

    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("quote_line_items_quote_idx").on(t.quoteId)]
);

export const quoteEventTypeEnum = pgEnum("quote_event_type", [
  "CREATED",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "QUICKBOOKS_SYNCED",
  "QUICKBOOKS_SYNC_FAILED",
]);

export const quoteEvents = pgTable(
  "quote_events",
  {
    id: cuid(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    type: quoteEventTypeEnum("type").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("quote_events_quote_idx").on(t.quoteId)]
);

// ---------------------------------------------------------------------------
// QuickBooks Online connection (single company; one active row expected)
// ---------------------------------------------------------------------------

export const quickbooksConnections = pgTable("quickbooks_connections", {
  id: cuid(),
  realmId: text("realm_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  environment: text("environment").notNull().default("sandbox"),
  connectedById: text("connected_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  customersOwned: many(customers),
  notes: many(notes),
  quotesCreated: many(quotes),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  accountOwner: one(users, { fields: [customers.accountOwnerId], references: [users.id] }),
  contacts: many(contacts),
  notes: many(notes),
  quotes: many(quotes),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
  quotes: many(quotes),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  customer: one(customers, { fields: [notes.customerId], references: [customers.id] }),
  author: one(users, { fields: [notes.authorId], references: [users.id] }),
}));

export const productCategoriesRelations = relations(productCategories, ({ many }) => ({
  products: many(products),
}));

export const serviceTiersRelations = relations(serviceTiers, ({ many }) => ({
  tierPrices: many(productTierPrices),
  quotes: many(quotes),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(productCategories, { fields: [products.categoryId], references: [productCategories.id] }),
  tierPrices: many(productTierPrices),
  quoteLineItems: many(quoteLineItems),
}));

export const productTierPricesRelations = relations(productTierPrices, ({ one }) => ({
  product: one(products, { fields: [productTierPrices.productId], references: [products.id] }),
  tier: one(serviceTiers, { fields: [productTierPrices.tierId], references: [serviceTiers.id] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  contact: one(contacts, { fields: [quotes.contactId], references: [contacts.id] }),
  createdBy: one(users, { fields: [quotes.createdById], references: [users.id] }),
  serviceTier: one(serviceTiers, { fields: [quotes.serviceTierId], references: [serviceTiers.id] }),
  lineItems: many(quoteLineItems),
  events: many(quoteEvents),
}));

export const quoteLineItemsRelations = relations(quoteLineItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLineItems.quoteId], references: [quotes.id] }),
  product: one(products, { fields: [quoteLineItems.productId], references: [products.id] }),
}));

export const quoteEventsRelations = relations(quoteEvents, ({ one }) => ({
  quote: one(quotes, { fields: [quoteEvents.quoteId], references: [quotes.id] }),
}));

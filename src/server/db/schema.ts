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

  // Shown to the client on the quote page and the MSA, alongside whichever
  // staff member generated that document (quotes.createdById) — so the
  // client sees a face and a way to reach their actual point of contact
  // instead of a generic company signature. photoUrl is a data: URI (small,
  // client-side-resized JPEG) rather than a file path, matching this app's
  // existing pattern for the Lockdown IT logo — Vercel's serverless
  // filesystem isn't a place to durably store uploaded files. Nullable:
  // accounts with no photo yet just render without one.
  photoUrl: text("photo_url"),
  phone: text("phone"),
  title: text("title"),

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

// Sales-pipeline position while a customer's status is PROSPECT — a finer
// breakdown than the LEAD/PROSPECT/ACTIVE/FORMER status above, which only
// says which of the three broad buckets (Prospects nav page, Leads, real
// Customers) a record shows up in. Kept as its own column rather than
// folded into `status` so it survives a conversion to LEAD/ACTIVE (you keep
// a record of how far it got) and so WON/LOST are real terminal states
// instead of overloading FORMER (which means "used to be an active
// customer," not "never converted").
export const prospectStageEnum = pgEnum("prospect_stage", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "WON",
  "LOST",
]);

export const customers = pgTable(
  "customers",
  {
    id: cuid(),
    name: text("name").notNull(),
    status: customerStatusEnum("status").notNull().default("LEAD"),
    // Nullable: only meaningful while working a prospect through the
    // pipeline — a customer created directly as ACTIVE (or imported before
    // this column existed) just has no stage.
    stage: prospectStageEnum("stage"),
    // Rough deal-size estimate staff enter while working the pipeline —
    // independent of any quote's actual totals, since a prospect usually
    // doesn't have a quote built yet.
    estimatedMonthlyValue: numeric("estimated_monthly_value", { precision: 12, scale: 2 }),
    nextFollowUpAt: timestamp("next_follow_up_at"),
    // Free-text reason captured when a prospect is marked Lost, so "why
    // didn't this one convert" isn't lost to institutional memory.
    lostReason: text("lost_reason"),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    // A separate publicly-listed email (e.g. a "Public Business Email"
    // column from a research-style import) — kept apart from `email` rather
    // than merged in, since a cold-outreach spreadsheet often has both a
    // company/contact email AND a scraped public one, and collapsing them
    // would silently drop whichever one lands second. "Has email" (the
    // Prospects filter) counts a prospect as having an email if either is
    // set.
    publicEmail: text("public_email"),
    source: text("source"),
    employeeCount: integer("employee_count"),
    // High/Medium/Low confidence rating from a research-style prospect
    // import (see importProspects). A plain text column rather than an enum
    // since a spreadsheet's wording can vary — kept structured (unlike the
    // rest of that import's narrative fields, which live in a notes entry)
    // specifically so the Prospects list can display and sort by it.
    researchConfidence: text("research_confidence"),

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

    // Soft-delete: archiving hides a record from the Customers/Prospects
    // lists without touching its data, and — unlike a real delete — never
    // risks a foreign-key failure on a customer that already has quotes.
    // Null means active/visible; set means archived, and is fully
    // reversible by clearing it back to null.
    archivedAt: timestamp("archived_at"),

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
    // Set when this contact is who invoices/billing questions should go to
    // (can be the same person as the primary contact, or a separate
    // accounts-payable contact) — the public intake form's "billing contact
    // is the same person" checkbox is what usually sets this.
    isBilling: boolean("is_billing").notNull().default(false),
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
  // A key into TIER_COLOR_CLASSES (src/lib/tier-colors.ts), e.g. "bronze" —
  // never a raw hex value, so the Catalog page's color-coded badges/column
  // headings can always render from a small fixed set of pre-built,
  // accessible Tailwind class strings rather than generating classes
  // dynamically (which Tailwind can't statically detect/ship). Nullable —
  // an unset or unrecognized value just falls back to the default neutral
  // color rather than erroring.
  color: text("color"),
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

// How the client pays for the recurring services on this quote — same plan
// and services either way, just monthly vs. one annual prepayment at a
// discount (Settings → Billing options sets the discount %). Purely a
// payment-schedule choice; it doesn't change quantities/rate-card pricing,
// which is why it lives on the quote rather than in the pricing engine.
export const billingFrequencyEnum = pgEnum("billing_frequency", ["MONTHLY", "ANNUAL"]);

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
    // Defaults to MONTHLY; the client can switch to ANNUAL (prepaid, at a
    // discount) when accepting on the public quote page, or staff can set
    // it directly from the quote's Settings tab. Reflected in the generated
    // MSA's Fees & Payment Terms section and in what gets invoiced through
    // QuickBooks.
    billingFrequency: billingFrequencyEnum("billing_frequency").notNull().default("MONTHLY"),
    serviceTierId: text("service_tier_id").references(() => serviceTiers.id),
    // Service level agreement attached to this quote — independent of the
    // Bronze/Silver/Gold service tier above. Nullable: older quotes and any
    // quote where staff haven't picked one yet have no SLA attached.
    slaId: text("sla_id").references(() => slas.id, { onDelete: "set null" }),

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

    // For "infrastructure only" / one-off project quotes where showing the
    // Bronze/Silver/Gold managed-services plans would be confusing or
    // irrelevant (e.g. a hardware/network project for a prospect who isn't
    // buying ongoing managed services). When true, the public quote page
    // hides both the tier-comparison cards and the plan comparison & scope
    // matrix table entirely — everything else on the quote (line items,
    // totals, SLA, etc.) is unaffected. Defaults to false so existing
    // behavior (driven by whether Discovery quantities were entered) is
    // unchanged unless staff explicitly opt in.
    hideTierComparison: boolean("hide_tier_comparison").notNull().default(false),

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

    // Staff-only AI review (see src/server/ai-review.ts) — a short,
    // internal-only paragraph flagging things worth reconsidering on this
    // quote (coverage gaps vs. Discovery's risk flags, common bundled
    // services missing for this size/tier, SLA mismatch, etc.), generated
    // on demand by a staff-clicked "Analyze" button and cached here until
    // the underlying quote data changes. Never surfaced to the customer on
    // any public page. aiReviewInputHash is a hash of the exact inputs the
    // review was generated from, so the UI can tell staff "quote data has
    // changed since this was generated" without re-calling the AI just to
    // check staleness.
    aiReviewText: text("ai_review_text"),
    aiReviewGeneratedAt: timestamp("ai_review_generated_at"),
    aiReviewInputHash: text("ai_review_input_hash"),
    aiReviewModel: text("ai_review_model"),
    aiReviewError: text("ai_review_error"),

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

    // Set when this line was merged onto the quote by a signed MSA addendum
    // (see quoteAddendums below) rather than added directly on the quote —
    // lets the quote builder show which items came from which addendum.
    // Nullable/set-null-on-delete: a pre-addendum line item, or one added
    // directly by staff, has no addendum; deleting a draft addendum before
    // it's signed never touches quote_line_items anyway (nothing's merged
    // yet), so this only ever fires for a truly orphaned reference.
    addendumId: text("addendum_id").references(() => quoteAddendums.id, { onDelete: "set null" }),

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

// ---------------------------------------------------------------------------
// Service Level Agreements (Settings → SLAs). Independent of the
// Bronze/Silver/Gold service tier — a tier is "what's included"; an SLA is
// "how fast we respond and fix it." Staff create/edit SLAs here and attach
// one to a quote (quotes.slaId above); the attached SLA's response/
// resolution targets and coverage hours are shown to the client on the
// proposal and folded into the MSA when one is generated.
// ---------------------------------------------------------------------------

export const slas = pgTable("slas", {
  id: cuid(),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),

  // "Business Hours" | "Business Hours + Emergency" | "24x7" — free text so
  // an admin can rename/extend without a migration; mirrors the wording
  // already used for Discovery's afterHours risk factor.
  coverageHours: text("coverage_hours").notNull().default("Business Hours"),

  criticalResponseMinutes: integer("critical_response_minutes").notNull().default(30),
  highResponseMinutes: integer("high_response_minutes").notNull().default(60),
  mediumResponseMinutes: integer("medium_response_minutes").notNull().default(240),
  lowResponseMinutes: integer("low_response_minutes").notNull().default(480),

  criticalResolutionHours: integer("critical_resolution_hours").notNull().default(4),
  highResolutionHours: integer("high_resolution_hours").notNull().default(8),
  mediumResolutionHours: integer("medium_resolution_hours").notNull().default(24),
  lowResolutionHours: integer("low_resolution_hours").notNull().default(40),

  uptimeGuaranteePct: numeric("uptime_guarantee_pct", { precision: 5, scale: 2 }).notNull().default("99.90"),
  escalationProcess: text("escalation_process"),
  exclusions: text("exclusions"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const quoteEventTypeEnum = pgEnum("quote_event_type", [
  "CREATED",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "QUICKBOOKS_SYNCED",
  "QUICKBOOKS_SYNC_FAILED",
  "OWNER_CHANGED",
  "ADDENDUM_SIGNED",
  "ADDENDUM_DECLINED",
  "MSA_COUNTERSIGNED",
  "ADDENDUM_COUNTERSIGNED",
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
// Master Service Agreement documents — generated per-quote once a quote is
// ACCEPTED, summarizing exactly what was agreed to (tier, SLA, line items)
// plus the standing MSA legal terms (Settings → MSA terms). Signable via a
// lightweight typed-name flow at /msa/[signingToken] (same non-legal-
// e-signature pattern as the quote accept flow at /q/[token]), or
// downloadable as a plain PDF to upload to a real e-signature product
// (Adobe Acrobat Sign, DocuSign, etc.) instead.
// ---------------------------------------------------------------------------

export const msaDocumentStatusEnum = pgEnum("msa_document_status", ["DRAFT", "SENT", "SIGNED"]);

export const msaDocuments = pgTable(
  "msa_documents",
  {
    id: cuid(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    status: msaDocumentStatusEnum("status").notNull().default("DRAFT"),

    // Structured snapshot of everything the MSA summarizes, captured at
    // generation time (customer/contact, tier, SLA, line items, and the
    // standing MSA legal terms) — see src/server/msa.ts `MsaContent`. Freely
    // regenerated while DRAFT/SENT (re-running "Generate MSA" overwrites
    // this with the quote's current state); frozen once SIGNED so a later
    // catalog/SLA/terms edit can never silently rewrite an already-signed
    // agreement.
    content: jsonb("content").notNull(),

    signingToken: text("signing_token")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID()),

    sentAt: timestamp("sent_at"),
    sentToEmail: text("sent_to_email"),

    signedAt: timestamp("signed_at"),
    signedByName: text("signed_by_name"),
    signedByTitle: text("signed_by_title"),
    signedIp: text("signed_ip"),
    // Data: URI PNG of the hand-drawn signature captured on the public
    // signing page (see msa-sign-panel.tsx's canvas pad) — same
    // store-directly-on-the-row pattern as users.photoUrl, since there's
    // no durable file storage on Vercel's serverless filesystem.
    signatureImageUrl: text("signature_image_url"),

    // Provider (staff) countersignature — filled in from inside the app,
    // after the customer has already signed, via countersignMsa in
    // src/server/actions/msa.ts. Deliberately additive nullable columns
    // rather than a new document status: `status` stays SIGNED the moment
    // the customer signs (so every existing `status === "SIGNED"` gate —
    // QuickBooks invoicing, addendum eligibility, the public page's "signed"
    // badge — keeps working unchanged), and "fully executed" is just
    // `providerSignedAt !== null` wherever that distinction matters.
    providerSignedAt: timestamp("provider_signed_at"),
    providerSignedByName: text("provider_signed_by_name"),
    providerSignedByTitle: text("provider_signed_by_title"),
    providerSignedByUserId: text("provider_signed_by_user_id").references(() => users.id),
    providerSignatureImageUrl: text("provider_signature_image_url"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("msa_documents_quote_idx").on(t.quoteId)]
);

// ---------------------------------------------------------------------------
// MSA Addendums — for a customer adding services after their MSA is already
// SIGNED, without re-opening (or re-signing) the whole original agreement.
// Staff build up a small set of new/changed line items against an accepted,
// MSA-signed quote (from the catalog or added on the fly, same "MANUAL"
// line-item flow as the quote builder), then generate a short "Addendum
// No. N to the Master Service Agreement" document that references the
// original signed MSA by date and incorporates it by reference — legally
// an amendment, not a fresh contract — and is itself signable via the same
// lightweight typed-name + drawn-signature flow as the MSA
// (/addendum/[signingToken], mirroring /msa/[signingToken]).
//
// Once signed, its line items are copied onto the quote's own
// quote_line_items (tagged with addendumId so the quote builder can show
// where they came from) and the quote's cached totals are recalculated —
// so the quote and its public page always reflect everything the customer
// has actually agreed to, addenda included. A signed addendum can also be
// invoiced to QuickBooks on its own (see pushAddendumToQuickBooks), the
// same staff-triggered, gated-on-signature pattern as the quote's first
// invoice.
// ---------------------------------------------------------------------------

export const addendumStatusEnum = pgEnum("addendum_status", ["DRAFT", "SENT", "SIGNED", "DECLINED"]);

export const quoteAddendums = pgTable(
  "quote_addendums",
  {
    id: cuid(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),

    // Sequential per quote (1, 2, 3, ...) — assigned at creation from the
    // count of addenda already on this quote, purely for display ("Addendum
    // No. 2") and never renumbered even if an earlier draft is deleted.
    number: integer("number").notNull(),

    status: addendumStatusEnum("status").notNull().default("DRAFT"),

    // Staff-facing summary of what's changing (e.g. "Add managed backup for
    // 2 new servers") — shown to staff on the addendum list and folded into
    // the generated document as the description of the amendment.
    note: text("note"),

    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),

    // Structured snapshot (see src/server/addendum.ts `AddendumContent`) of
    // the new line items plus a reference back to the parent quote/MSA,
    // captured at "Generate" time — same freeze-on-generate,
    // lock-once-signed pattern as msaDocuments.content, so a later catalog
    // edit or MSA-terms change can never silently rewrite an addendum
    // that's already out for signature (or already signed).
    content: jsonb("content").notNull().default({}),

    signingToken: text("signing_token")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID()),

    sentAt: timestamp("sent_at"),
    sentToEmail: text("sent_to_email"),

    signedAt: timestamp("signed_at"),
    signedByName: text("signed_by_name"),
    signedByTitle: text("signed_by_title"),
    signedIp: text("signed_ip"),
    signatureImageUrl: text("signature_image_url"),

    // Provider (staff) countersignature — see the identical columns on
    // msaDocuments above for the full rationale; mirrored here so an
    // addendum can be countersigned the same way once the customer has
    // signed it.
    providerSignedAt: timestamp("provider_signed_at"),
    providerSignedByName: text("provider_signed_by_name"),
    providerSignedByTitle: text("provider_signed_by_title"),
    providerSignedByUserId: text("provider_signed_by_user_id").references(() => users.id),
    providerSignatureImageUrl: text("provider_signature_image_url"),

    declinedAt: timestamp("declined_at"),

    // This addendum's own QuickBooks invoice (new/changed items only) —
    // independent of quotes.quickbooksInvoiceId, which only ever covers
    // what was on the quote at first-invoice time.
    quickbooksInvoiceId: text("quickbooks_invoice_id"),
    quickbooksSyncedAt: timestamp("quickbooks_synced_at"),
    quickbooksSyncError: text("quickbooks_sync_error"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("quote_addendums_quote_idx").on(t.quoteId),
    uniqueIndex("quote_addendums_quote_number_idx").on(t.quoteId, t.number),
  ]
);

// The staff-editable working line items for a DRAFT/SENT addendum — mirrors
// quoteLineItems exactly (categoryName/name/description/unitLabel/
// billingType/quantity/unitPrice/lineTotal/sortOrder) so the same catalog
// picker / "add on the fly" UI and pricing.ts totals helpers work unchanged
// against either table. Copied onto quoteLineItems (not moved — this table
// stays as the addendum's own record) once the addendum is signed.
export const quoteAddendumLineItems = pgTable(
  "quote_addendum_line_items",
  {
    id: cuid(),
    addendumId: text("addendum_id")
      .notNull()
      .references(() => quoteAddendums.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id),

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
  (t) => [index("quote_addendum_line_items_addendum_idx").on(t.addendumId)]
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
  sla: one(slas, { fields: [quotes.slaId], references: [slas.id] }),
  lineItems: many(quoteLineItems),
  events: many(quoteEvents),
  msaDocuments: many(msaDocuments),
  addendums: many(quoteAddendums),
}));

export const quoteLineItemsRelations = relations(quoteLineItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLineItems.quoteId], references: [quotes.id] }),
  product: one(products, { fields: [quoteLineItems.productId], references: [products.id] }),
  addendum: one(quoteAddendums, { fields: [quoteLineItems.addendumId], references: [quoteAddendums.id] }),
}));

export const quoteEventsRelations = relations(quoteEvents, ({ one }) => ({
  quote: one(quotes, { fields: [quoteEvents.quoteId], references: [quotes.id] }),
}));

export const slasRelations = relations(slas, ({ many }) => ({
  quotes: many(quotes),
}));

export const msaDocumentsRelations = relations(msaDocuments, ({ one }) => ({
  quote: one(quotes, { fields: [msaDocuments.quoteId], references: [quotes.id] }),
  providerSignedBy: one(users, { fields: [msaDocuments.providerSignedByUserId], references: [users.id] }),
}));

export const quoteAddendumsRelations = relations(quoteAddendums, ({ one, many }) => ({
  quote: one(quotes, { fields: [quoteAddendums.quoteId], references: [quotes.id] }),
  createdBy: one(users, { fields: [quoteAddendums.createdById], references: [users.id] }),
  providerSignedBy: one(users, { fields: [quoteAddendums.providerSignedByUserId], references: [users.id] }),
  lineItems: many(quoteAddendumLineItems),
  mergedLineItems: many(quoteLineItems),
}));

export const quoteAddendumLineItemsRelations = relations(quoteAddendumLineItems, ({ one }) => ({
  addendum: one(quoteAddendums, { fields: [quoteAddendumLineItems.addendumId], references: [quoteAddendums.id] }),
  product: one(products, { fields: [quoteAddendumLineItems.productId], references: [products.id] }),
}));

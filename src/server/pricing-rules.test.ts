// Validates the pricing engine against the live values captured directly
// from Lockdown_IT_Fully_Automated_Quote_Builder_v4's Discovery/CFO Model
// sheets for the workbook's own example scenario (Prospective Client: 100
// users, 100 workstations, 3 servers, 1 location, 1 firewall, 6 switches,
// 12 APs, Average documentation, Some legacy, no compliance program,
// Business Hours + Emergency, multiple vendors, High criticality, Normal
// incident history, 0% recurring discount, no optional add-ons selected).
//
// Run with: npx tsx src/server/pricing-rules.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RATE_CARD, DEFAULT_M365_PLANS } from "./pricing-data";
import {
  computeAllTiers,
  computeRecommendedTier,
  computePlanFitStatus,
  effectiveRiskAdjustment,
  computeM365Mrr,
  computeAddOnMrr,
  computeAddOnLineItems,
  type Quantities,
  type RiskFactors,
  EMPTY_ADD_ONS,
} from "./pricing-rules";

const quantities: Quantities = {
  users: 100,
  workstations: 100,
  servers: 3,
  locations: 1,
  firewalls: 1,
  switches: 6,
  aps: 12,
  otherNetworkDevices: 0,
};

const risk: RiskFactors = {
  documentationQuality: "Average",
  legacySystems: "Some",
  complianceProgram: "None",
  afterHours: "Business Hours + Emergency",
  multiVendor: "Yes",
  criticality: "High",
  incidentHistory: "Normal",
  manualOverrideEnabled: false,
  manualOverridePct: 0,
};

test("risk adjustment matches Discovery!B35/B38 (18.5%)", () => {
  assert.equal(effectiveRiskAdjustment(risk), 0.185);
});

test("recommended tier matches Discovery!B11 (Silver)", () => {
  const tier = computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: false });
  assert.equal(tier, "silver");
});

test("plan fit is OK when selected matches recommended", () => {
  assert.equal(computePlanFitStatus("silver", "silver"), "OK");
});

test("plan fit is REVIEW when selected is below recommended", () => {
  assert.equal(computePlanFitStatus("silver", "bronze"), "REVIEW");
  assert.equal(computePlanFitStatus("gold", "silver"), "REVIEW");
  assert.equal(computePlanFitStatus("gold", "bronze"), "REVIEW");
});

test("Silver tier pricing matches CFO Model column C exactly", () => {
  const all = computeAllTiers({ quantities, risk, addOns: EMPTY_ADD_ONS, rateCard: DEFAULT_RATE_CARD, discountPct: 0 });
  const silver = all.silver;

  assert.equal(silver.baseSubtotal, 17495); // CFO!C13
  assert.equal(silver.riskPremium, 3236.575); // CFO!C14
  assert.equal(silver.grossMrrBeforeDiscount, 20731.575); // CFO!C17
  assert.equal(silver.finalMrr, 20731.575); // CFO!C19
  assert.equal(silver.directCost, 6170); // CFO!C21
  assert.equal(silver.grossProfit, 14561.575); // CFO!C22
  assert.ok(Math.abs(silver.grossMarginPct - 0.7023863358186727) < 1e-9); // CFO!C23
  assert.equal(silver.targetGrossMarginPct, 0.62); // CFO!C24
  assert.equal(silver.marginStatus, "OK"); // CFO!G12
  assert.equal(silver.onboardingFeeSell, 11124.75); // CFO!C26
  assert.equal(silver.onboardingCost, 5419.75); // CFO!C27
  assert.equal(silver.onboardingGrossProfit, 5705); // CFO!C28
});

test("Bronze tier pricing matches CFO Model column B exactly", () => {
  const all = computeAllTiers({ quantities, risk, addOns: EMPTY_ADD_ONS, rateCard: DEFAULT_RATE_CARD, discountPct: 0 });
  const bronze = all.bronze;

  assert.equal(bronze.baseSubtotal, 12025); // CFO!B13
  assert.equal(bronze.riskPremium, 2224.625); // CFO!B14
  assert.equal(bronze.grossMrrBeforeDiscount, 14249.625); // CFO!B17
  assert.equal(bronze.finalMrr, 14249.625); // CFO!B19
  assert.equal(bronze.directCost, 4833); // CFO!B21
  assert.ok(Math.abs(bronze.grossMarginPct - 0.6608331798205216) < 1e-9); // CFO!B23
  assert.equal(bronze.onboardingFeeSell, 8815.25); // CFO!B26
  assert.equal(bronze.onboardingCost, 4526.75); // CFO!B27
});

test("Gold tier pricing matches CFO Model column D exactly", () => {
  const all = computeAllTiers({ quantities, risk, addOns: EMPTY_ADD_ONS, rateCard: DEFAULT_RATE_CARD, discountPct: 0 });
  const gold = all.gold;

  assert.equal(gold.baseSubtotal, 23705); // CFO!D13
  assert.equal(gold.riskPremium, 4385.425); // CFO!D14
  assert.equal(gold.grossMrrBeforeDiscount, 28090.425); // CFO!D17
  assert.equal(gold.finalMrr, 28090.425); // CFO!D19
  assert.equal(gold.directCost, 7965); // CFO!D21
  assert.ok(Math.abs(gold.grossMarginPct - 0.7164514242842535) < 1e-9); // CFO!D23
  assert.equal(gold.onboardingFeeSell, 14364.000000000002); // CFO!D26 (float, matches workbook's own fp noise)
  assert.equal(gold.onboardingCost, 6498.000000000001); // CFO!D27
});

test("minimum MRR floor applies for a tiny environment", () => {
  // 1 workstation and nothing else prices below the Bronze floor
  // ($105 base vs. a $200 minimum), so the floor should kick in.
  const tiny: Quantities = { users: 0, workstations: 1, servers: 0, locations: 0, firewalls: 0, switches: 0, aps: 0, otherNetworkDevices: 0 };
  const flatRisk: RiskFactors = { ...risk, documentationQuality: "Excellent", legacySystems: "None", multiVendor: "No", criticality: "Standard", incidentHistory: "Normal", afterHours: "Business Hours" };
  const all = computeAllTiers({ quantities: tiny, risk: flatRisk, addOns: EMPTY_ADD_ONS, rateCard: DEFAULT_RATE_CARD, discountPct: 0 });
  assert.equal(all.bronze.grossMrrBeforeDiscount, 200); // floored at the Bronze minimum
  assert.ok(all.bronze.minimumMrrAdjustment > 0);
});

// ---------------------------------------------------------------------------
// Microsoft 365 per-plan licensing (Settings → Microsoft 365 plans)
// ---------------------------------------------------------------------------

test("computeM365Mrr sums seats x plan price across multiple plans", () => {
  const result = computeM365Mrr(
    [
      { planId: "business-basic", seats: 8 },
      { planId: "business-premium", seats: 4 },
    ],
    DEFAULT_M365_PLANS
  );
  // 8 x $7.00 Basic + 4 x $32.00 Premium
  assert.equal(result.sell, 8 * 7.0 + 4 * 32.0);
  assert.equal(result.cost, 8 * 6.0 + 4 * 27.0);
  assert.equal(result.totalSeats, 12);
});

test("computeM365Mrr skips a selection whose plan id no longer exists", () => {
  const result = computeM365Mrr(
    [
      { planId: "business-basic", seats: 5 },
      { planId: "deleted-plan", seats: 100 },
    ],
    DEFAULT_M365_PLANS
  );
  assert.equal(result.sell, 5 * 7.0);
  assert.equal(result.totalSeats, 5);
});

test("computeM365Mrr with no selections or no plans contributes $0", () => {
  assert.deepEqual(computeM365Mrr([], DEFAULT_M365_PLANS), { sell: 0, cost: 0, totalSeats: 0 });
  assert.deepEqual(computeM365Mrr([{ planId: "business-basic", seats: 5 }], []), { sell: 0, cost: 0, totalSeats: 0 });
});

test("computeAddOnMrr folds multi-plan M365 selections into the add-on total", () => {
  const addOns = {
    ...EMPTY_ADD_ONS,
    m365Selections: [
      { planId: "business-standard", seats: 10 },
      { planId: "defender-for-business", seats: 10 },
    ],
  };
  const { sell, cost } = computeAddOnMrr(addOns, "None", DEFAULT_RATE_CARD, DEFAULT_M365_PLANS);
  assert.equal(sell, 10 * 23.5 + 10 * 3.0);
  assert.equal(cost, 10 * 20.0 + 10 * 2.5);
});

test("computeAddOnMrr with m365Plans omitted (default []) prices M365 at $0 rather than throwing", () => {
  const addOns = { ...EMPTY_ADD_ONS, m365Selections: [{ planId: "business-standard", seats: 10 }] };
  const { sell } = computeAddOnMrr(addOns, "None", DEFAULT_RATE_CARD);
  assert.equal(sell, 0);
});

test("computeAddOnLineItems emits one line per selected M365 plan", () => {
  const addOns = {
    ...EMPTY_ADD_ONS,
    m365Selections: [
      { planId: "business-basic", seats: 8 },
      { planId: "business-premium", seats: 4 },
      { planId: "entra-id-p1", seats: 0 }, // zero-seat rows are skipped
    ],
  };
  const items = computeAddOnLineItems(addOns, "None", DEFAULT_RATE_CARD, DEFAULT_M365_PLANS);
  const labels = items.map((i) => i.label);
  assert.ok(labels.includes("Microsoft 365 Business Basic (8 seats)"));
  assert.ok(labels.includes("Microsoft 365 Business Premium (4 seats)"));
  assert.equal(items.length, 2);
});

test("computeAllTiers with M365 selections increases finalMrr by the M365 sell total", () => {
  const withoutM365 = computeAllTiers({ quantities, risk, addOns: EMPTY_ADD_ONS, rateCard: DEFAULT_RATE_CARD, discountPct: 0, m365Plans: DEFAULT_M365_PLANS });
  const addOns = { ...EMPTY_ADD_ONS, m365Selections: [{ planId: "business-standard", seats: 20 }] };
  const withM365 = computeAllTiers({ quantities, risk, addOns, rateCard: DEFAULT_RATE_CARD, discountPct: 0, m365Plans: DEFAULT_M365_PLANS });
  assert.ok(Math.abs(withM365.silver.finalMrr - withoutM365.silver.finalMrr - 20 * 23.5) < 1e-9);
});

test("waiveMinimumMrr skips the floor entirely", () => {
  const tiny: Quantities = { users: 0, workstations: 1, servers: 0, locations: 0, firewalls: 0, switches: 0, aps: 0, otherNetworkDevices: 0 };
  const flatRisk: RiskFactors = { ...risk, documentationQuality: "Excellent", legacySystems: "None", multiVendor: "No", criticality: "Standard", incidentHistory: "Normal", afterHours: "Business Hours" };
  const all = computeAllTiers({
    quantities: tiny,
    risk: flatRisk,
    addOns: EMPTY_ADD_ONS,
    rateCard: DEFAULT_RATE_CARD,
    discountPct: 0,
    waiveMinimumMrr: true,
  });
  assert.equal(all.bronze.grossMrrBeforeDiscount, 105); // raw component pricing, floor skipped
  assert.equal(all.bronze.minimumMrrAdjustment, 0);
});

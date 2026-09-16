// Covers the shared quote-totals/discount math in pricing.ts — used by
// both the staff quote builder and the client-facing proposal page, so a
// bug here would silently mis-price (or mis-explain) every quote. See
// quote-builder.tsx and app/q/[token]/page.tsx for the "Discount" line
// this backs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, discountAmount, computeQuoteTotals, computeSubtotals, lineTotal } from "./pricing";

test("lineTotal multiplies quantity by unit price", () => {
  assert.equal(lineTotal({ quantity: "3", unitPrice: "10.50", billingType: "RECURRING_MONTHLY" }), 31.5);
});

test("computeSubtotals buckets ONE_TIME separately from monthly/hourly", () => {
  const { subtotalMonthly, subtotalOneTime } = computeSubtotals([
    { quantity: 1, unitPrice: 100, billingType: "RECURRING_MONTHLY" },
    { quantity: 2, unitPrice: 50, billingType: "HOURLY" },
    { quantity: 1, unitPrice: 500, billingType: "ONE_TIME" },
  ]);
  assert.equal(subtotalMonthly, 200);
  assert.equal(subtotalOneTime, 500);
});

test("applyDiscount with no discountType/discountValue returns the amount unchanged", () => {
  assert.equal(applyDiscount(1000, null, null), 1000);
  assert.equal(applyDiscount(1000, "PERCENT", null), 1000);
});

test("applyDiscount PERCENT takes a percentage off", () => {
  assert.equal(applyDiscount(1000, "PERCENT", 10), 900);
});

test("applyDiscount AMOUNT subtracts a flat dollar amount", () => {
  assert.equal(applyDiscount(1000, "AMOUNT", 150), 850);
});

test("applyDiscount never goes below zero", () => {
  assert.equal(applyDiscount(100, "AMOUNT", 500), 0);
  assert.equal(applyDiscount(100, "PERCENT", 150), 0);
});

test("discountAmount reports exactly what applyDiscount took off", () => {
  assert.equal(discountAmount(1000, "PERCENT", 10), 100);
  assert.equal(discountAmount(1000, "AMOUNT", 150), 150);
  assert.equal(discountAmount(1000, null, null), 0);
});

test("discountAmount is clamped the same way applyDiscount is (never reports more than the subtotal itself)", () => {
  assert.equal(discountAmount(100, "AMOUNT", 500), 100);
});

test("computeQuoteTotals applies the discount before tax", () => {
  const items = [{ quantity: 1, unitPrice: 1000, billingType: "RECURRING_MONTHLY" as const }];
  const totals = computeQuoteTotals(items, { discountType: "PERCENT", discountValue: 10, taxRatePct: 8 });
  assert.equal(totals.subtotalMonthly, 1000);
  // (1000 - 10%) * 1.08 = 900 * 1.08
  assert.equal(Math.round(totals.totalMonthly * 100) / 100, 972);
});

test("computeQuoteTotals with no discount or tax just passes subtotals through as totals", () => {
  const items = [
    { quantity: 2, unitPrice: 200, billingType: "RECURRING_MONTHLY" as const },
    { quantity: 1, unitPrice: 300, billingType: "ONE_TIME" as const },
  ];
  const totals = computeQuoteTotals(items);
  assert.equal(totals.totalMonthly, totals.subtotalMonthly);
  assert.equal(totals.totalOneTime, totals.subtotalOneTime);
  assert.equal(totals.subtotalMonthly, 400);
  assert.equal(totals.subtotalOneTime, 300);
});

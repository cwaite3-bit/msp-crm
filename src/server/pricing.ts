// Pure pricing-engine helpers shared by the quote builder (server actions)
// and the client-facing quote report. No DB access here — just math, so it's
// trivially testable and can't drift between "what staff sees" and "what the
// client sees."

export type LineItemLike = {
  quantity: string | number;
  unitPrice: string | number;
  billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
};

export function lineTotal(item: LineItemLike): number {
  return Number(item.quantity) * Number(item.unitPrice);
}

export function computeSubtotals(items: LineItemLike[]) {
  let subtotalMonthly = 0;
  let subtotalOneTime = 0;
  for (const item of items) {
    const total = lineTotal(item);
    if (item.billingType === "ONE_TIME") subtotalOneTime += total;
    else subtotalMonthly += total; // RECURRING_MONTHLY and HOURLY both bucket into the "monthly" total
  }
  return { subtotalMonthly, subtotalOneTime };
}

export function applyDiscount(
  amount: number,
  discountType: "PERCENT" | "AMOUNT" | null | undefined,
  discountValue: number | null | undefined
) {
  if (!discountType || !discountValue) return amount;
  if (discountType === "PERCENT") return Math.max(0, amount * (1 - discountValue / 100));
  return Math.max(0, amount - discountValue);
}

export function computeQuoteTotals(
  items: LineItemLike[],
  opts: {
    discountType?: "PERCENT" | "AMOUNT" | null;
    discountValue?: number | null;
    taxRatePct?: number | null;
  } = {}
) {
  const { subtotalMonthly, subtotalOneTime } = computeSubtotals(items);
  const discountedMonthly = applyDiscount(subtotalMonthly, opts.discountType, opts.discountValue);
  const discountedOneTime = applyDiscount(subtotalOneTime, opts.discountType, opts.discountValue);
  const taxRate = opts.taxRatePct ? Number(opts.taxRatePct) / 100 : 0;
  const totalMonthly = discountedMonthly * (1 + taxRate);
  const totalOneTime = discountedOneTime * (1 + taxRate);
  return {
    subtotalMonthly,
    subtotalOneTime,
    totalMonthly,
    totalOneTime,
  };
}

export function groupByCategory<T extends { categoryName: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!groups.has(item.categoryName)) groups.set(item.categoryName, []);
    groups.get(item.categoryName)!.push(item);
  }
  return Array.from(groups.entries()).map(([categoryName, items]) => ({ categoryName, items }));
}

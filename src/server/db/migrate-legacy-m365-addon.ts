// One-time backfill for quotes created before Microsoft 365 licensing became
// a per-plan breakdown (Settings → Microsoft 365 plans). Quotes created
// before this change stored a single flat allowance in
// quotes.addOnSelections as { m365Enabled: boolean, m365Seats: number },
// priced at the old app_settings.pricingRateCard.optionalServices.
// microsoft365LicensingPerSeat flat rate ($25/seat sell in the factory
// defaults, or whatever an admin had edited it to).
//
// The new engine only understands addOnSelections.m365Selections: Array<{
// planId, seats }> (see pricing-rules.ts M365Selection) — it no longer reads
// m365Enabled/m365Seats at all. Without this backfill, an old quote's
// *cached* guardrail fields (grossMarginPct, etc.) would quietly drop the
// M365 dollar amount out of the calculation the next time they're
// recomputed, even though its already-generated line items on the quote
// itself are untouched (those are concrete dollar snapshots, not
// re-derived automatically — see quote_line_items in schema.ts).
//
// This script converts every quote's old m365Enabled/m365Seats into an
// equivalent m365Selections row pointing at a synthetic "legacy-m365-flat"
// plan that's appended to app_settings.m365Plans (if not already present)
// priced at the *old* rate card's microsoft365LicensingPerSeat sell/cost —
// so the dollar total staff already quoted the customer does not silently
// change. The synthetic plan is marked inactive (active: false) so it never
// shows up as a choice for new selections in Settings or the quote builder,
// but stays resolvable for any quote still referencing it. Staff can
// manually swap an old quote onto a real Basic/Standard/Premium plan (and
// remove the legacy row) whenever they next touch that quote's add-ons.
//
// Safe to re-run — it only touches quotes that still have the old shape
// (m365Enabled/m365Seats present, no m365Selections yet) and only inserts
// the synthetic plan once.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { quotes, appSettings } from "./schema";
import { DEFAULT_M365_PLANS, DEFAULT_RATE_CARD, type M365Plan, type RateCard } from "../pricing-data";

const LEGACY_PLAN_ID = "legacy-m365-flat";

async function main() {
  const [rateCardRow] = await db.select().from(appSettings).where(eq(appSettings.key, "pricingRateCard")).limit(1);
  const rateCard = (rateCardRow?.value as RateCard | undefined) ?? DEFAULT_RATE_CARD;
  const legacyRate = rateCard.optionalServices.microsoft365LicensingPerSeat;

  const [plansRow] = await db.select().from(appSettings).where(eq(appSettings.key, "m365Plans")).limit(1);
  const plans: M365Plan[] = (plansRow?.value as M365Plan[] | undefined) ?? DEFAULT_M365_PLANS;

  const allQuotes = await db.select().from(quotes);
  const legacyQuotes = allQuotes.filter((q) => {
    const addOns = q.addOnSelections as Record<string, unknown> | null;
    return (
      addOns &&
      typeof addOns === "object" &&
      "m365Enabled" in addOns &&
      !("m365Selections" in addOns) &&
      Boolean(addOns.m365Enabled) &&
      Number(addOns.m365Seats) > 0
    );
  });

  if (legacyQuotes.length === 0) {
    console.log("No quotes with the old flat m365Enabled/m365Seats shape found — nothing to migrate.");
    return;
  }

  const hasLegacyPlan = plans.some((p) => p.id === LEGACY_PLAN_ID);
  if (!hasLegacyPlan) {
    console.log(
      `Adding synthetic "${LEGACY_PLAN_ID}" plan (sell $${legacyRate.sell}/seat, cost $${legacyRate.cost}/seat, inactive) to preserve pre-migration pricing…`
    );
    const nextPlans: M365Plan[] = [
      ...plans,
      {
        id: LEGACY_PLAN_ID,
        name: "Microsoft 365 Licensing (legacy flat rate — review and replace)",
        category: "core",
        sell: legacyRate.sell,
        cost: legacyRate.cost,
        sortOrder: plans.length,
        active: false,
      },
    ];
    await db
      .insert(appSettings)
      .values({ key: "m365Plans", value: nextPlans })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: nextPlans, updatedAt: new Date() } });
  }

  console.log(`Migrating ${legacyQuotes.length} quote(s) onto m365Selections…`);
  for (const quote of legacyQuotes) {
    const addOns = quote.addOnSelections as Record<string, unknown>;
    const seats = Number(addOns.m365Seats) || 0;
    const nextAddOns = {
      ...addOns,
      m365Selections: [{ planId: LEGACY_PLAN_ID, seats }],
    };
    delete (nextAddOns as Record<string, unknown>).m365Enabled;
    delete (nextAddOns as Record<string, unknown>).m365Seats;
    await db.update(quotes).set({ addOnSelections: nextAddOns }).where(eq(quotes.id, quote.id));
    console.log(`  quote #${quote.quoteNumber} (${quote.id}): ${seats} seat(s) -> ${LEGACY_PLAN_ID}`);
  }

  console.log(
    "\nDone. These quotes now price identically to before. Recommended follow-up: open each affected " +
      "quote's Optional services & add-ons and swap the legacy row for the real Basic/Standard/Premium " +
      "plan(s) the customer is actually on, then re-apply the plan to regenerate line items."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import Image from "next/image";
import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, contacts, serviceTiers } from "@/server/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { groupByCategory } from "@/server/pricing";
import { recordQuoteView } from "@/server/actions/quotes";
import { getRateCardPublic, getScopeMatrixPublic } from "@/server/actions/settings";
import { AcceptRejectPanel } from "./accept-reject-panel";
import { TierComparison } from "./tier-comparison";
import { ScopeMatrixTable } from "./scope-matrix-table";
import {
  computeAllTiers,
  computeRecommendedTier,
  EMPTY_QUANTITIES,
  DEFAULT_RISK_FACTORS,
  EMPTY_ADD_ONS,
  type Quantities,
  type RiskFactors,
  type AddOnSelections,
} from "@/server/pricing-rules";
import { tierKeyFromName } from "@/server/pricing-data";

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, token)).limit(1);
  if (!quote) notFound();

  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const contact = quote.contactId
    ? (await db.select().from(contacts).where(eq(contacts.id, quote.contactId)).limit(1))[0]
    : null;
  const lineItems = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quote.id))
    .orderBy(asc(quoteLineItems.sortOrder));

  if (quote.status === "SENT" || quote.status === "VIEWED") {
    await recordQuoteView(token);
  }

  const grouped = groupByCategory(lineItems);
  const isDecided = quote.status === "ACCEPTED" || quote.status === "REJECTED";

  // Bronze/Silver/Gold comparison — sourced fresh from the pricing engine
  // (bundled price per tier, matching the workbook's Customer Proposal
  // sheet), independent of the itemized line items below.
  const rateCard = await getRateCardPublic();
  const scopeMatrix = await getScopeMatrixPublic();
  const quantities: Quantities = { ...EMPTY_QUANTITIES, ...(quote.quantities as Partial<Quantities>) };
  const risk: RiskFactors = { ...DEFAULT_RISK_FACTORS, ...(quote.riskFactors as Partial<RiskFactors>) };
  const addOns: AddOnSelections = { ...EMPTY_ADD_ONS, ...(quote.addOnSelections as Partial<AddOnSelections>) };
  const discountPct = quote.discountType === "PERCENT" && quote.discountValue ? Number(quote.discountValue) / 100 : 0;
  const allTiers = computeAllTiers({ quantities, risk, addOns, rateCard, discountPct });
  const recommendedTier = computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: addOns.vcioEnabled });

  let selectedTierKey = null as ReturnType<typeof tierKeyFromName>;
  if (quote.serviceTierId) {
    const [tierRow] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    selectedTierKey = tierKeyFromName(tierRow?.name);
  }

  const hasDiscoveryData = quantities.workstations > 0 || quantities.servers > 0 || quantities.users > 0;

  const selectedServices: { label: string; value: string }[] = [
    { label: "vCIO / Strategic Planning", value: addOns.vcioEnabled ? `${addOns.vcioHoursPerMonth} hours per month` : "Not selected" },
    { label: "Backup / Disaster Recovery", value: addOns.backupProfile === "None" ? "Not selected" : addOns.backupProfile },
    {
      label: "Security & Microsoft 365 Add-Ons",
      value:
        [
          addOns.emailSecurityEnabled ? "Advanced Email Security" : null,
          addOns.trainingEnabled ? "Security Awareness Training" : null,
          addOns.m365Enabled ? "Microsoft 365 Licensing" : null,
        ]
          .filter(Boolean)
          .join("; ") || "Not selected",
    },
    {
      label: "Onsite / Compliance",
      value:
        [
          addOns.includedOnsiteHoursPerMonth > 0 ? `${addOns.includedOnsiteHoursPerMonth} onsite hours/month` : null,
          risk.complianceProgram !== "None" ? `${risk.complianceProgram} compliance support` : null,
        ]
          .filter(Boolean)
          .join("; ") || "Not selected",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white shadow-lg print:shadow-none">
        {/* Logo strip */}
        <div className="flex items-center justify-center rounded-t-xl border-b border-slate-100 bg-white px-8 py-5">
          <Image src="/lockdown-logo.png" alt="Lockdown IT" width={5052} height={1264} className="h-10 w-auto" priority />
        </div>

        {/* Header */}
        <div className="bg-slate-900 px-8 py-8 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Quote</p>
              <h1 className="mt-1 text-2xl font-semibold">{quote.title}</h1>
              <p className="mt-1 text-sm text-slate-300">Quote #{quote.quoteNumber}</p>
            </div>
            <div className="text-right text-sm text-slate-300">
              <p>Prepared for</p>
              <p className="text-base font-medium text-white">{customer?.name}</p>
              {contact && (
                <p>
                  {contact.firstName} {contact.lastName}
                </p>
              )}
              <p className="mt-2">Created {formatDate(quote.createdAt)}</p>
              {quote.validUntil && <p>Valid until {formatDate(quote.validUntil)}</p>}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-8">
          {hasDiscoveryData && (
            <div className="mb-10">
              <h2 className="mb-1 text-lg font-semibold text-slate-900">Three straightforward ways to engage</h2>
              <p className="mb-4 text-sm text-slate-500">
                Pricing below reflects your discovered environment. Your quote uses the highlighted plan.
              </p>
              <TierComparison allTiers={allTiers} recommendedTier={recommendedTier} selectedTier={selectedTierKey} />
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.categoryName} className="mb-6 last:mb-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{group.categoryName}</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="flex flex-col divide-y divide-slate-100">
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <span className="font-medium text-slate-900">{item.name}</span>
                      <span className="ml-1.5 text-slate-400">
                        ({item.quantity} × {formatCurrency(item.unitPrice)})
                      </span>
                      {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                    </div>
                    <span className="font-medium text-slate-900">{formatCurrency(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Totals */}
          <div className="mt-8 overflow-hidden rounded-lg bg-slate-900 text-white">
            <div className="flex items-center justify-between px-6 py-4">
              <span className="text-sm font-medium text-slate-300">Monthly total</span>
              <span className="text-2xl font-bold text-emerald-400">{formatCurrency(quote.totalMonthly)}</span>
            </div>
            {Number(quote.totalOneTime) > 0 && (
              <div className="flex items-center justify-between border-t border-white/10 px-6 py-3">
                <span className="text-sm font-medium text-slate-300">One-time total</span>
                <span className="text-lg font-semibold">{formatCurrency(quote.totalOneTime)}</span>
              </div>
            )}
          </div>

          {hasDiscoveryData && (
            <div className="mt-8 flex flex-col gap-6">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  What &ldquo;unlimited support&rdquo; means
                </p>
                <p>
                  Unlimited qualifying support means no per-ticket labor charge for routine support of covered
                  users and covered technology within the selected plan. It does not mean unlimited projects,
                  custom development, migrations, consulting, training, major changes, onsite meetings, or
                  strategic planning beyond any purchased vCIO allowance.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Selected optional services
                </p>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {selectedServices.map((s) => (
                    <div key={s.label} className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
                      <span className="text-slate-500">{s.label}</span>
                      <span className="text-right font-medium text-slate-900">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Plan comparison &amp; scope
                </p>
                <ScopeMatrixTable rows={scopeMatrix} selectedTier={selectedTierKey} />
              </div>

              <p className="text-xs text-slate-400">
                Lockdown IT also provides custom application development, scripting/automation, migrations,
                office moves, network redesigns, technology research, management/vendor meetings, and other
                professional services. These are separately scoped or billed at the applicable rate. Final
                scope, SLA, exclusions, licensing, onboarding requirements, and commercial terms are governed
                by the Managed Services Agreement and Statement of Work.
              </p>
            </div>
          )}

          {quote.notesToClient && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
              <p className="whitespace-pre-wrap">{quote.notesToClient}</p>
            </div>
          )}

          {/* Accept / reject */}
          <div className="mt-8 border-t border-slate-200 pt-6 print:hidden">
            <AcceptRejectPanel
              token={token}
              status={quote.status}
              acceptedByName={quote.acceptedByName}
              acceptedAt={quote.acceptedAt}
            />
          </div>

          {isDecided && (
            <p className="mt-6 text-center text-xs text-slate-400">
              {quote.status === "ACCEPTED"
                ? `Accepted by ${quote.acceptedByName} on ${quote.acceptedAt ? formatDate(quote.acceptedAt) : ""}`
                : "This quote was declined."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

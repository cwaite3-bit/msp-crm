import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, contacts, serviceTiers } from "@/server/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { listCatalog } from "@/server/actions/catalog";
import { getRateCard, getChecklistTemplate } from "@/server/actions/settings";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { QuoteBuilder } from "./quote-builder";
import { QuoteMetaForm } from "./quote-meta-form";
import { QuoteActions } from "./quote-actions";
import { DiscoveryForm } from "./discovery-form";
import { AddOnsForm } from "./addons-form";
import { PlanComparisonPanel } from "./plan-comparison-panel";
import { ChecklistPanel } from "./checklist-panel";
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

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!quote) notFound();

  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const customerContacts = await db.select().from(contacts).where(eq(contacts.customerId, quote.customerId));
  const lineItems = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, id))
    .orderBy(asc(quoteLineItems.sortOrder));
  const catalog = await listCatalog();

  const rateCard = await getRateCard();
  const checklistTemplate = await getChecklistTemplate();
  const quantities: Quantities = { ...EMPTY_QUANTITIES, ...(quote.quantities as Partial<Quantities>) };
  const risk: RiskFactors = { ...DEFAULT_RISK_FACTORS, ...(quote.riskFactors as Partial<RiskFactors>) };
  const addOns: AddOnSelections = { ...EMPTY_ADD_ONS, ...(quote.addOnSelections as Partial<AddOnSelections>) };
  const discountPct = quote.discountType === "PERCENT" && quote.discountValue ? Number(quote.discountValue) / 100 : 0;

  const allTiers = computeAllTiers({ quantities, risk, addOns, rateCard, discountPct, waiveMinimumMrr: quote.waiveMinimumMrr });
  const recommendedTier = computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: addOns.vcioEnabled });

  let selectedTierKey = null as ReturnType<typeof tierKeyFromName>;
  if (quote.serviceTierId) {
    const [tierRow] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    selectedTierKey = tierKeyFromName(tierRow?.name);
  }

  const checklist = (quote.checklist as { key: string; status: string; note?: string }[]) || [];
  const checklistDone = checklist.filter((c) => c.status === "Complete" || c.status === "N/A").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/customers/${quote.customerId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> {customer?.name}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-900">
                Quote #{quote.quoteNumber} · {quote.title}
              </h1>
              <StatusBadge status={quote.status} />
            </div>
            <p className="text-sm text-slate-500">Created {formatDate(quote.createdAt)}</p>
          </div>
          <QuoteActions quote={quote} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discovery</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscoveryForm quoteId={quote.id} quantities={quantities} riskFactors={risk} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optional services &amp; add-ons</CardTitle>
        </CardHeader>
        <CardContent>
          <AddOnsForm quoteId={quote.id} addOns={addOns} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanComparisonPanel
            quoteId={quote.id}
            allTiers={allTiers}
            recommendedTier={recommendedTier}
            selectedTier={selectedTierKey}
            planFitStatus={(quote.planFitStatus as "OK" | "REVIEW" | null) ?? null}
            marginStatus={(quote.marginStatus as "OK" | "REVIEW" | null) ?? null}
            managerApprovalRequired={quote.managerApprovalRequired}
            manualRiskOverrideUsed={risk.manualOverrideEnabled}
            checklistDone={checklistDone}
            checklistTotal={checklistTemplate.length}
            waiveMinimumMrr={quote.waiveMinimumMrr}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <QuoteBuilder quote={quote} lineItems={lineItems} catalog={catalog} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-quote checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <ChecklistPanel quoteId={quote.id} template={checklistTemplate} checklist={checklist} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quote settings</CardTitle>
            </CardHeader>
            <CardContent>
              <QuoteMetaForm quote={quote} tiers={catalog.tiers} contacts={customerContacts} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

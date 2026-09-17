import { db } from "@/server/db";
import { quotes, quoteLineItems, quoteEvents, customers, contacts, serviceTiers, quoteAddendumLineItems } from "@/server/db/schema";
import { eq, asc, and, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { listCatalog } from "@/server/actions/catalog";
import { getRateCard, getChecklistTemplate, getM365Plans } from "@/server/actions/settings";
import { listSlas } from "@/server/actions/slas";
import { listUsers } from "@/server/actions/users";
import { getMsaForQuote } from "@/server/actions/msa";
import { listAddendumsForQuote } from "@/server/actions/addendums";
import { isAiReviewStale } from "@/server/actions/ai-review";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { QuoteBuilder } from "./quote-builder";
import { QuoteMetaForm } from "./quote-meta-form";
import { QuoteActions } from "./quote-actions";
import { DiscoveryForm } from "./discovery-form";
import { AddOnsForm } from "./addons-form";
import { PlanComparisonPanel } from "./plan-comparison-panel";
import { ChecklistPanel } from "./checklist-panel";
import { MsaPanel } from "./msa-panel";
import { AddendumsPanel } from "./addendum-panel";
import { AiReviewPanel } from "./ai-review-panel";
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
  // Every open of the public link logs a "VIEWED" quoteEvents row (see
  // recordQuoteView), so counting them gives a repeat-view count for free
  // without a separate counter column — firstViewedAt/lastViewedAt on the
  // quote itself (already set by that same function) cover the "when".
  const viewEvents = quote.firstViewedAt
    ? await db.select({ id: quoteEvents.id }).from(quoteEvents).where(and(eq(quoteEvents.quoteId, id), eq(quoteEvents.type, "VIEWED")))
    : [];

  const rateCard = await getRateCard();
  const checklistTemplate = await getChecklistTemplate();
  const m365Plans = await getM365Plans();
  const slaList = await listSlas();
  const staff = await listUsers();
  const msaDocument = await getMsaForQuote(id);
  const addendums = await listAddendumsForQuote(id);
  const session = await auth();
  // Default name/title for the "countersign" dialogs below — pre-fills with
  // whoever's logged in, since in practice that's almost always the account
  // owner countersigning their own quote. Just a form default; the staff
  // member can still edit it before confirming.
  const currentStaffUser = session?.user?.id ? staff.find((u) => u.id === session.user!.id) ?? null : null;
  const currentUser = currentStaffUser
    ? { name: currentStaffUser.name, title: currentStaffUser.title }
    : session?.user?.name
      ? { name: session.user.name, title: null }
      : null;
  const addendumLineItemRows =
    addendums.length > 0
      ? await db
          .select()
          .from(quoteAddendumLineItems)
          .where(inArray(quoteAddendumLineItems.addendumId, addendums.map((a) => a.id)))
          .orderBy(asc(quoteAddendumLineItems.sortOrder))
      : [];
  const lineItemsByAddendum = Object.fromEntries(
    addendums.map((a) => [a.id, addendumLineItemRows.filter((li) => li.addendumId === a.id)])
  );
  const quantities: Quantities = { ...EMPTY_QUANTITIES, ...(quote.quantities as Partial<Quantities>) };
  const risk: RiskFactors = { ...DEFAULT_RISK_FACTORS, ...(quote.riskFactors as Partial<RiskFactors>) };
  const addOns: AddOnSelections = { ...EMPTY_ADD_ONS, ...(quote.addOnSelections as Partial<AddOnSelections>) };
  const discountPct = quote.discountType === "PERCENT" && quote.discountValue ? Number(quote.discountValue) / 100 : 0;

  const allTiers = computeAllTiers({ quantities, risk, addOns, rateCard, discountPct, waiveMinimumMrr: quote.waiveMinimumMrr, m365Plans });
  const recommendedTier = computeRecommendedTier({ risk, users: quantities.users, vcioEnabled: addOns.vcioEnabled });

  let selectedTierKey = null as ReturnType<typeof tierKeyFromName>;
  if (quote.serviceTierId) {
    const [tierRow] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    selectedTierKey = tierKeyFromName(tierRow?.name);
  }

  const checklist = (quote.checklist as { key: string; status: string; note?: string }[]) || [];
  const checklistDone = checklist.filter((c) => c.status === "Complete" || c.status === "N/A").length;
  const aiReviewStale = quote.aiReviewText ? await isAiReviewStale(quote.id) : false;

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
            {quote.firstViewedAt && (
              <p className="text-sm text-slate-500">
                {viewEvents.length <= 1 ? (
                  <>Viewed {formatDateTime(quote.firstViewedAt)}</>
                ) : (
                  <>
                    Viewed {viewEvents.length} times — first {formatDateTime(quote.firstViewedAt)}
                    {quote.lastViewedAt && <>, last {formatDateTime(quote.lastViewedAt)}</>}
                  </>
                )}
              </p>
            )}
          </div>
          <QuoteActions
            quote={quote}
            msaSigned={msaDocument?.status === "SIGNED"}
            contact={customerContacts.find((c) => c.id === quote.contactId) ?? null}
          />
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
          <AddOnsForm quoteId={quote.id} addOns={addOns} m365Plans={m365Plans} totalUsers={quantities.users} />
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
              <QuoteMetaForm quote={quote} tiers={catalog.tiers} contacts={customerContacts} slaList={slaList} staff={staff} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Master Service Agreement</CardTitle>
            </CardHeader>
            <CardContent>
              <MsaPanel
                quote={quote}
                contact={customerContacts.find((c) => c.id === quote.contactId) ?? null}
                document={msaDocument}
                currentUser={currentUser}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MSA addendums</CardTitle>
            </CardHeader>
            <CardContent>
              <AddendumsPanel
                quoteId={quote.id}
                msaSigned={msaDocument?.status === "SIGNED"}
                addendums={addendums}
                lineItemsByAddendum={lineItemsByAddendum}
                catalog={catalog}
                contact={customerContacts.find((c) => c.id === quote.contactId) ?? null}
                currentUser={currentUser}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            AI review <span className="font-normal text-slate-400">— staff only, never shown to the customer</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AiReviewPanel
            quoteId={quote.id}
            reviewText={quote.aiReviewText}
            generatedAt={quote.aiReviewGeneratedAt}
            model={quote.aiReviewModel}
            error={quote.aiReviewError}
            isStale={aiReviewStale}
          />
        </CardContent>
      </Card>
    </div>
  );
}

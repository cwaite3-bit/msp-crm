import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, contacts } from "@/server/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { listCatalog } from "@/server/actions/catalog";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { QuoteBuilder } from "./quote-builder";
import { QuoteMetaForm } from "./quote-meta-form";
import { QuoteActions } from "./quote-actions";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/customers/${quote.customerId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> {customer?.name}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
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

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <QuoteBuilder quote={quote} lineItems={lineItems} catalog={catalog} />
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

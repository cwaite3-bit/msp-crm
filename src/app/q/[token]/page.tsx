import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, contacts } from "@/server/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { groupByCategory } from "@/server/pricing";
import { recordQuoteView } from "@/server/actions/quotes";
import { AcceptRejectPanel } from "./accept-reject-panel";

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

  return (
    <div className="min-h-screen bg-slate-100 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white shadow-lg print:shadow-none">
        {/* Header */}
        <div className="rounded-t-xl bg-slate-900 px-8 py-8 text-white">
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

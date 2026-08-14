import { db } from "@/server/db";
import { customers, quotes } from "@/server/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { desc, eq, ne, sql } from "drizzle-orm";

export default async function DashboardPage() {
  const [customerCount] = await db.select({ count: sql<number>`count(*)::int` }).from(customers);
  const [openQuotes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotes)
    .where(ne(quotes.status, "REJECTED"));
  const pipelineRows = await db
    .select({ totalMonthly: quotes.totalMonthly })
    .from(quotes)
    .where(sql`${quotes.status} in ('SENT','VIEWED')`);
  const pipelineValue = pipelineRows.reduce((sum, r) => sum + Number(r.totalMonthly), 0);

  const recentQuotes = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      title: quotes.title,
      status: quotes.status,
      totalMonthly: quotes.totalMonthly,
      createdAt: quotes.createdAt,
      customerId: quotes.customerId,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .orderBy(desc(quotes.createdAt))
    .limit(8);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of your customers and quoting pipeline.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-500">Customers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{customerCount?.count ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-500">Open quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{openQuotes?.count ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-500">Pipeline (MRR, sent/viewed)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrency(pipelineValue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent quotes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-slate-100">
          {recentQuotes.length === 0 && <p className="py-4 text-sm text-slate-500">No quotes yet.</p>}
          {recentQuotes.map((q) => (
            <Link
              key={q.id}
              href={`/quotes/${q.id}`}
              className="flex items-center justify-between py-3 text-sm hover:bg-slate-50"
            >
              <div>
                <div className="font-medium text-slate-900">
                  #{q.quoteNumber} · {q.customerName}
                </div>
                <div className="text-slate-500">
                  {q.title} · {formatDate(q.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{formatCurrency(q.totalMonthly)}/mo</span>
                <StatusBadge status={q.status} />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

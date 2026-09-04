import { listQuotes } from "@/server/actions/quotes";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function QuotesPage() {
  const rows = await listQuotes();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Quotes</h1>
        <p className="text-sm text-slate-500">All quotes across every customer.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monthly</TableHead>
                <TableHead>One-time</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Link href={`/quotes/${q.id}`} className="font-medium text-slate-900 hover:underline">
                      #{q.quoteNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {q.customerId ? (
                      <a
                        href={`/customers/${q.customerId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-900 hover:text-slate-600 hover:underline"
                      >
                        {q.customerName}
                      </a>
                    ) : (
                      q.customerName
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    <Link href={`/quotes/${q.id}`} className="hover:text-slate-900 hover:underline">
                      {q.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={q.status} />
                  </TableCell>
                  <TableCell>{formatCurrency(q.totalMonthly)}</TableCell>
                  <TableCell>{formatCurrency(q.totalOneTime)}</TableCell>
                  <TableCell className="text-slate-500">{formatDate(q.createdAt)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    No quotes yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

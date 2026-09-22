import Link from "next/link";
import { searchCustomers, countArchivedCustomers } from "@/server/actions/customers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Archive, ArrowLeft } from "lucide-react";
import { NewCustomerDialog } from "./new-customer-dialog";
import { CustomerSearch } from "./customer-search";
import { CustomerTable } from "./customer-table";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { q, archived } = await searchParams;
  const query = q ?? "";
  const showArchived = archived === "1";

  const [rows, archivedCount] = await Promise.all([
    searchCustomers(query, showArchived),
    showArchived ? Promise.resolve(0) : countArchivedCustomers(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{showArchived ? "Archived customers" : "Customers"}</h1>
          <p className="text-sm text-slate-500">
            {showArchived
              ? "Customers you've archived — restore one to bring it back to the active list."
              : "Accounts that have actually converted — active now, or former. Leads and prospects live on the Prospects screen."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showArchived ? (
            <Button variant="outline" asChild>
              <Link href="/customers">
                <ArrowLeft /> <span className="hidden sm:inline">Back to active</span>
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="outline" asChild title="Archived">
                <Link href="/customers?archived=1">
                  <Archive /> <span className="hidden sm:inline">Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</span>
                  {archivedCount > 0 && <span className="sm:hidden">{archivedCount}</span>}
                </Link>
              </Button>
              <NewCustomerDialog />
            </>
          )}
        </div>
      </div>

      <CustomerSearch initialQuery={query} />

      <Card>
        <CardContent className="p-0">
          <CustomerTable rows={rows} showArchived={showArchived} query={query} />
        </CardContent>
      </Card>
    </div>
  );
}

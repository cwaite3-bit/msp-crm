import { searchProspects } from "@/server/actions/customers";
import { Card, CardContent } from "@/components/ui/card";
import { NewProspectDialog } from "./new-prospect-dialog";
import { ImportProspectsDialog } from "./import-prospects-dialog";
import { ProspectSearch } from "./prospect-search";
import { ProspectTable } from "./prospect-table";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q ?? "";
  const rows = await searchProspects(query);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Prospects</h1>
          <p className="text-sm text-slate-500">Sales prospects, tracked through your pipeline until they convert.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportProspectsDialog />
          <NewProspectDialog />
        </div>
      </div>

      <ProspectSearch initialQuery={query} />

      <Card>
        <CardContent className="p-0">
          <ProspectTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}

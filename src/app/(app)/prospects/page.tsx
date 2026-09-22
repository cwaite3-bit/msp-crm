import { searchProspects, listProspectFilterOptions } from "@/server/actions/customers";
import { listUsers } from "@/server/actions/users";
import { Card, CardContent } from "@/components/ui/card";
import { NewProspectDialog } from "./new-prospect-dialog";
import { ImportProspectsDialog } from "./import-prospects-dialog";
import { ProspectFilterBar } from "./prospect-filter-bar";
import { ProspectTable } from "./prospect-table";
import type { ProspectStage, SizeBucketValue } from "@/lib/prospect";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; stage?: string; industry?: string; size?: string; owner?: string }>;
}) {
  const { q, state, stage, industry, size, owner } = await searchParams;
  const query = q ?? "";

  const [rows, filterOptions, allUsers] = await Promise.all([
    searchProspects(query, {
      state: state || undefined,
      stage: (stage as ProspectStage) || undefined,
      industry: industry || undefined,
      size: (size as SizeBucketValue) || undefined,
      ownerId: owner || undefined,
    }),
    listProspectFilterOptions(),
    listUsers(),
  ]);

  const staff = allUsers.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  const hasFilters = !!(query || state || stage || industry || size || owner);

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

      <ProspectFilterBar
        initial={{
          q: query,
          state: state || "",
          stage: stage || "",
          industry: industry || "",
          size: size || "",
          owner: owner || "",
        }}
        states={filterOptions.states}
        industries={filterOptions.industries}
        staff={staff}
      />

      <Card>
        <CardContent className="p-0">
          <ProspectTable rows={rows} staff={staff} hasFilters={hasFilters} />
        </CardContent>
      </Card>
    </div>
  );
}

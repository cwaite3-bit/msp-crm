import { listCatalog } from "@/server/actions/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogManager } from "./catalog-manager";

export default async function CatalogPage() {
  const catalog = await listCatalog();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Catalog</h1>
        <p className="text-sm text-slate-500">
          Products &amp; services, categories, and service tiers used to build quotes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products &amp; services</CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogManager catalog={catalog} />
        </CardContent>
      </Card>
    </div>
  );
}

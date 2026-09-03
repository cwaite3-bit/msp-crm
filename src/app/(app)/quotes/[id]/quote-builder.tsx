"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { computeQuoteTotals, groupByCategory } from "@/server/pricing";
import {
  addLineItemFromProduct,
  addCustomLineItem,
  updateLineItem,
  removeLineItem,
} from "@/server/actions/quotes";
import { quickCreateProduct, type listCatalog } from "@/server/actions/catalog";
import { toast } from "sonner";
import type { quotes, quoteLineItems } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;
type LineItem = InferSelectModel<typeof quoteLineItems>;
type Catalog = Awaited<ReturnType<typeof listCatalog>>;

const BILLING_LABEL: Record<string, string> = {
  RECURRING_MONTHLY: "/mo",
  ONE_TIME: "one-time",
  HOURLY: "/hr",
};

export function QuoteBuilder({
  quote,
  lineItems,
  catalog,
}: {
  quote: Quote;
  lineItems: LineItem[];
  catalog: Catalog;
}) {
  const [items, setItems] = useState(lineItems);
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);

  // Keep local state in sync whenever the server gives us a fresh line-item
  // list (e.g. after router.refresh() following an add/remove elsewhere).
  useEffect(() => {
    setItems(lineItems);
  }, [lineItems]);

  const totals = useMemo(
    () =>
      computeQuoteTotals(items, {
        discountType: quote.discountType as "PERCENT" | "AMOUNT" | null,
        discountValue: quote.discountValue ? Number(quote.discountValue) : null,
        taxRatePct: quote.taxRatePct ? Number(quote.taxRatePct) : null,
      }),
    [items, quote.discountType, quote.discountValue, quote.taxRatePct]
  );

  const grouped = groupByCategory(items);
  const readOnly = quote.status === "ACCEPTED" || quote.status === "REJECTED";

  function onQuantityChange(item: LineItem, quantity: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, quantity, lineTotal: (Number(quantity) * Number(i.unitPrice)).toFixed(2) } : i))
    );
    startTransition(async () => {
      await updateLineItem(quote.id, item.id, { quantity });
    });
  }

  function onPriceChange(item: LineItem, unitPrice: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, unitPrice, lineTotal: (Number(i.quantity) * Number(unitPrice)).toFixed(2) } : i))
    );
    startTransition(async () => {
      await updateLineItem(quote.id, item.id, { unitPrice });
    });
  }

  function onRemove(item: LineItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    startTransition(async () => {
      await removeLineItem(quote.id, item.id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          No line items yet. Add products/services below.
        </p>
      )}

      {grouped.map((group) => (
        <div key={group.categoryName}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">{group.categoryName}</p>
          <Table>
            <TableBody>
              {group.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="w-[40%]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{item.name}</span>
                      {item.source === "ENGINE" && (
                        <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                          Auto
                        </span>
                      )}
                    </div>
                    {item.description && <div className="text-xs text-slate-500">{item.description}</div>}
                  </TableCell>
                  <TableCell className="w-28">
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      value={item.quantity}
                      disabled={readOnly}
                      onChange={(e) => onQuantityChange(item, e.target.value)}
                      className="h-8"
                    />
                    <div className="mt-0.5 text-[11px] text-slate-400">{item.unitLabel}</div>
                  </TableCell>
                  <TableCell className="w-32">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">$</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice}
                        disabled={readOnly}
                        onChange={(e) => onPriceChange(item, e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{BILLING_LABEL[item.billingType]}</div>
                  </TableCell>
                  <TableCell className="w-28 text-right font-medium">{formatCurrency(item.lineTotal)}</TableCell>
                  <TableCell className="w-10">
                    {!readOnly && (
                      <Button variant="ghost" size="icon" onClick={() => onRemove(item)} disabled={pending}>
                        <Trash2 className="h-4 w-4 text-slate-400" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {!readOnly && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-fit">
              <Plus className="h-4 w-4" /> Add product / service
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add to quote</DialogTitle>
            </DialogHeader>
            <AddItemForm quoteId={quote.id} catalog={catalog} onAdded={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      <div className="mt-2 flex flex-col items-end gap-1 border-t border-slate-200 pt-4 text-sm">
        <div className="flex w-64 justify-between text-slate-500">
          <span>Monthly subtotal</span>
          <span>{formatCurrency(totals.subtotalMonthly)}</span>
        </div>
        <div className="flex w-64 justify-between text-slate-500">
          <span>One-time subtotal</span>
          <span>{formatCurrency(totals.subtotalOneTime)}</span>
        </div>
        <div className="flex w-64 justify-between text-lg font-semibold text-slate-900">
          <span>Monthly total</span>
          <span>{formatCurrency(totals.totalMonthly)}</span>
        </div>
        {totals.totalOneTime > 0 && (
          <div className="flex w-64 justify-between font-semibold text-slate-900">
            <span>One-time total</span>
            <span>{formatCurrency(totals.totalOneTime)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AddItemForm({
  quoteId,
  catalog,
  onAdded,
}: {
  quoteId: string;
  catalog: Catalog;
  onAdded: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- existing product ----
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState("1");

  // ---- new / custom item ----
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [unitLabel, setUnitLabel] = useState("flat");
  const [billingType, setBillingType] = useState<"RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY">("RECURRING_MONTHLY");
  const [unitPrice, setUnitPrice] = useState("0");
  const [saveToCatalog, setSaveToCatalog] = useState(true);
  const [customQty, setCustomQty] = useState("1");

  function addExisting() {
    if (!productId) {
      toast.error("Choose a product first");
      return;
    }
    startTransition(async () => {
      await addLineItemFromProduct(quoteId, productId, quantity);
      router.refresh();
      onAdded();
    });
  }

  function addCustom() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!categoryId && !newCategoryName.trim()) {
      toast.error("Choose or create a category");
      return;
    }
    startTransition(async () => {
      const categoryName =
        catalog.categories.find((c) => c.id === categoryId)?.name || newCategoryName.trim();

      if (saveToCatalog) {
        await quickCreateProduct({
          name,
          categoryId: categoryId || undefined,
          newCategoryName: !categoryId ? newCategoryName : undefined,
          unitLabel,
          billingType,
          defaultUnitPrice: unitPrice,
        });
      }

      await addCustomLineItem(quoteId, {
        categoryName,
        name,
        unitLabel,
        billingType,
        quantity: customQty,
        unitPrice,
      });
      router.refresh();
      onAdded();
    });
  }

  return (
    <Tabs defaultValue="existing">
      <TabsList>
        <TabsTrigger value="existing">From catalog</TabsTrigger>
        <TabsTrigger value="new">Add on the fly</TabsTrigger>
      </TabsList>

      <TabsContent value="existing" className="flex flex-col gap-3">
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a product or service" />
          </SelectTrigger>
          <SelectContent>
            {catalog.categories.map((cat) => (
              <div key={cat.id}>
                {catalog.products
                  .filter((p) => p.categoryId === cat.id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {cat.name} · {p.name} ({formatCurrency(p.defaultUnitPrice)} {p.unitLabel})
                    </SelectItem>
                  ))}
              </div>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Quantity</span>
          <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-24" />
        </div>
        <DialogFooter>
          <Button onClick={addExisting} disabled={pending}>
            {pending ? "Adding…" : "Add to quote"}
          </Button>
        </DialogFooter>
      </TabsContent>

      <TabsContent value="new" className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">
          Create a brand-new product or service right now and add it to this quote.
        </p>
        <Input placeholder="Name (e.g. 'SIEM monitoring')" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="grid grid-cols-2 gap-2">
          <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setNewCategoryName(""); }}>
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {catalog.categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="…or new category name"
            value={newCategoryName}
            onChange={(e) => {
              setNewCategoryName(e.target.value);
              setCategoryId("");
            }}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Unit (per user…)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} />
          <Select value={billingType} onValueChange={(v) => setBillingType(v as typeof billingType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RECURRING_MONTHLY">Monthly</SelectItem>
              <SelectItem value="ONE_TIME">One-time</SelectItem>
              <SelectItem value="HOURLY">Hourly</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" step="0.01" placeholder="Unit price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Quantity</span>
          <Input type="number" min={0} value={customQty} onChange={(e) => setCustomQty(e.target.value)} className="w-24" />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={saveToCatalog} onChange={(e) => setSaveToCatalog(e.target.checked)} />
          Also save this to the catalog for future quotes
        </label>

        <DialogFooter>
          <Button onClick={addCustom} disabled={pending}>
            {pending ? "Adding…" : "Add to quote"}
          </Button>
        </DialogFooter>
      </TabsContent>
    </Tabs>
  );
}

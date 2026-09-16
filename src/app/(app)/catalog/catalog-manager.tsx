"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Plus, Archive, Pencil, GripVertical, Palette, Search, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  createProduct,
  updateProduct,
  archiveProduct,
  createCategory,
  createTier,
  updateTierColor,
  reorderTiers,
  setTierPrice,
  clearTierPrice,
} from "@/server/actions/catalog";
import { toast } from "sonner";
import type { listCatalog } from "@/server/actions/catalog";
import { TIER_COLOR_KEYS, TIER_COLOR_LABELS, tierColorClasses, type TierColorKey } from "@/lib/tier-colors";

type Catalog = Awaited<ReturnType<typeof listCatalog>>;

export function CatalogManager({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Catalog["products"][number] | null>(null);
  const [search, setSearch] = useState("");

  const categoryNameById = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const query = search.trim().toLowerCase();
  // Matches on the product's own name/description, or its category name —
  // typing "backup" finds both a "Backup" category and a product whose
  // name/description mentions backup, without needing separate controls
  // for the two.
  const filteredProducts = query
    ? catalog.products.filter((p) => {
        const categoryName = categoryNameById.get(p.categoryId) ?? "";
        return (
          p.name.toLowerCase().includes(query) ||
          (p.description ?? "").toLowerCase().includes(query) ||
          categoryName.toLowerCase().includes(query)
        );
      })
    : catalog.products;
  const noSearchMatches = query.length > 0 && filteredProducts.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New product/service
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New product / service</DialogTitle>
            </DialogHeader>
            <ProductForm
              catalog={catalog}
              onSubmit={async (fd) => {
                await createProduct(fd);
                router.refresh();
                setAddOpen(false);
                toast.success("Product created");
              }}
            />
          </DialogContent>
        </Dialog>

        <QuickAddCategory />
        <QuickAddTier />

        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products & services…"
            className="pl-8 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <ServiceTierBadges tiers={catalog.tiers} />

      {noSearchMatches && (
        <p className="rounded-md border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
          No products or services match &ldquo;{search.trim()}&rdquo;.
        </p>
      )}

      {catalog.categories.map((cat) => {
        const catProducts = filteredProducts.filter((p) => p.categoryId === cat.id);
        // While searching, a category with no matches is just hidden —
        // that's different from the "no products in this category yet"
        // empty state below, which only applies with no search active.
        if (query && catProducts.length === 0) return null;
        return (
          <div key={cat.id}>
            <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">{cat.name}</p>
            {catProducts.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                No products in this category yet — add one with &ldquo;New product/service&rdquo; above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Default price</TableHead>
                    {catalog.tiers.map((t) => (
                      <TableHead key={t.id} className="font-semibold">
                        <span className={`inline-block rounded-md px-2 py-1 ${tierColorClasses(t.color).heading}`}>
                          {t.name} price
                        </span>
                      </TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catProducts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-slate-900">{p.name}</TableCell>
                      <TableCell className="text-slate-500">{p.unitLabel}</TableCell>
                      <TableCell className="text-slate-500">
                        {p.billingType === "RECURRING_MONTHLY" ? "Monthly" : p.billingType === "ONE_TIME" ? "One-time" : "Hourly"}
                      </TableCell>
                      <TableCell>{formatCurrency(p.defaultUnitPrice)}</TableCell>
                      {catalog.tiers.map((t) => {
                        const tp = catalog.tierPrices.find((x) => x.productId === p.id && x.tierId === t.id);
                        return (
                          <TableCell key={t.id}>
                            <TierPriceInput
                              productId={p.id}
                              tierId={t.id}
                              value={tp?.unitPrice ?? ""}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(p)}>
                            <Pencil className="h-4 w-4 text-slate-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                await archiveProduct(p.id);
                                router.refresh();
                              })
                            }
                          >
                            <Archive className="h-4 w-4 text-slate-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
          </DialogHeader>
          {editing && (
            <ProductForm
              catalog={catalog}
              product={editing}
              onSubmit={async (fd) => {
                await updateProduct(editing.id, fd);
                router.refresh();
                setEditing(null);
                toast.success("Product updated");
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TierPriceInput({ productId, tierId, value }: { productId: string; tierId: string; value: string }) {
  const [val, setVal] = useState(value);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function commit() {
    startTransition(async () => {
      if (val.trim() === "") {
        await clearTierPrice(productId, tierId);
      } else {
        await setTierPrice(productId, tierId, val);
      }
      router.refresh();
    });
  }

  return (
    <Input
      className="h-8 w-24"
      type="number"
      step="0.01"
      placeholder="default"
      value={val}
      disabled={pending}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
    />
  );
}

function ProductForm({
  catalog,
  product,
  onSubmit,
}: {
  catalog: Catalog;
  product?: Catalog["products"][number];
  onSubmit: (fd: FormData) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? catalog.categories[0]?.id ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [billingType, setBillingType] = useState(product?.billingType ?? "RECURRING_MONTHLY");

  return (
    <form
      action={(fd) => {
        fd.set("categoryId", categoryId);
        fd.set("newCategoryName", newCategoryName);
        fd.set("billingType", billingType);
        startTransition(() => onSubmit(fd));
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <Input name="name" defaultValue={product?.name} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Category</Label>
          <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setNewCategoryName(""); }}>
            <SelectTrigger>
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent>
              {catalog.categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>…or new category</Label>
          <Input
            value={newCategoryName}
            onChange={(e) => {
              setNewCategoryName(e.target.value);
              if (e.target.value) setCategoryId("");
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Unit label</Label>
          <Input name="unitLabel" defaultValue={product?.unitLabel ?? "flat"} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Billing</Label>
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Default price</Label>
          <Input name="defaultUnitPrice" type="number" step="0.01" defaultValue={product?.defaultUnitPrice ?? "0"} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Internal cost (optional, never shown to client)</Label>
        <Input name="cost" type="number" step="0.01" defaultValue={product?.cost ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <Input name="description" defaultValue={product?.description ?? ""} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : product ? "Save changes" : "Create product"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// The row of service-tier badges at the top of the Catalog page. Each
// badge is draggable (native HTML5 drag-and-drop — no extra dependency)
// to reorder the tiers, which also reorders their "<Tier> price" columns
// in every product table below (both read `catalog.tiers`, already sorted
// by `sortOrder`). A small palette button on each badge lets staff assign
// it a color, which the matching price column heading also picks up (see
// `tierColorClasses` — same color key, same lookup, everywhere a tier is
// shown).
function ServiceTierBadges({ tiers }: { tiers: Catalog["tiers"] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<Catalog["tiers"][number] | null>(null);

  function handleDrop(targetId: string) {
    setDragOverId(null);
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const ids = tiers.map((t) => t.id);
    const fromIndex = ids.indexOf(dragId);
    const toIndex = ids.indexOf(targetId);
    setDragId(null);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, dragId);
    startTransition(async () => {
      const result = await reorderTiers(reordered);
      if (!result.ok) toast.error(result.error || "Could not reorder tiers");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {tiers.map((t) => {
          const colors = tierColorClasses(t.color);
          return (
            <div
              key={t.id}
              draggable
              onDragStart={() => setDragId(t.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverId !== t.id) setDragOverId(t.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === t.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(t.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOverId(null);
              }}
              className={`group flex cursor-grab items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium active:cursor-grabbing ${colors.badge} ${
                dragOverId === t.id && dragId && dragId !== t.id ? "ring-2 ring-offset-1" : ""
              } ${pending ? "opacity-60" : ""}`}
              title="Drag to reorder"
            >
              <GripVertical className="h-3 w-3 opacity-40" />
              <span>
                {t.name}
                {t.isDefault && " (default)"}
              </span>
              <button
                type="button"
                onClick={() => setColorPickerFor(t)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Change color"
              >
                <Palette className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!colorPickerFor} onOpenChange={(o) => !o && setColorPickerFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Color for &ldquo;{colorPickerFor?.name}&rdquo;</DialogTitle>
          </DialogHeader>
          {colorPickerFor && (
            <ColorSwatchPicker
              value={colorPickerFor.color}
              onChange={(color) => {
                const tier = colorPickerFor;
                setColorPickerFor(null);
                startTransition(async () => {
                  await updateTierColor(tier.id, color);
                  router.refresh();
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ColorSwatchPicker({ value, onChange }: { value: string | null; onChange: (color: TierColorKey) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {TIER_COLOR_KEYS.map((key) => {
        const colors = tierColorClasses(key);
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={TIER_COLOR_LABELS[key]}
            className={`flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] text-slate-600 hover:bg-slate-50 ${
              selected ? "border-slate-400 ring-2 ring-slate-300" : "border-slate-200"
            }`}
          >
            <span className={`h-5 w-5 rounded-full ${colors.dot}`} />
            {TIER_COLOR_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

function QuickAddCategory() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4" /> New category
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cloud, Compliance" />
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                await createCategory(name);
                router.refresh();
                setOpen(false);
                setName("");
              })
            }
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickAddTier() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<TierColorKey | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4" /> New service tier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New service tier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Platinum" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description shown to staff" />
          <div className="flex flex-col gap-1.5">
            <Label>Color (optional — picks one automatically if you skip this)</Label>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                await createTier(name, description, color ?? undefined);
                router.refresh();
                setOpen(false);
                setName("");
                setDescription("");
                setColor(null);
              })
            }
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

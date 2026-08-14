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
import { Badge } from "@/components/ui/badge";
import { Plus, Archive, Pencil } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  createProduct,
  updateProduct,
  archiveProduct,
  createCategory,
  createTier,
  setTierPrice,
  clearTierPrice,
} from "@/server/actions/catalog";
import { toast } from "sonner";
import type { listCatalog } from "@/server/actions/catalog";

type Catalog = Awaited<ReturnType<typeof listCatalog>>;

export function CatalogManager({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Catalog["products"][number] | null>(null);

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
      </div>

      <div className="flex flex-wrap gap-1.5">
        {catalog.tiers.map((t) => (
          <Badge key={t.id} variant="outline">
            {t.name}
            {t.isDefault && " (default)"}
          </Badge>
        ))}
      </div>

      {catalog.categories.map((cat) => {
        const catProducts = catalog.products.filter((p) => p.categoryId === cat.id);
        if (catProducts.length === 0) return null;
        return (
          <div key={cat.id}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat.name}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Default price</TableHead>
                  {catalog.tiers.map((t) => (
                    <TableHead key={t.id}>{t.name} price</TableHead>
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
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                await createTier(name, description);
                router.refresh();
                setOpen(false);
                setName("");
                setDescription("");
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

"use client";

// Staff UI for MSA Addendums — adding services to a quote after its MSA is
// already signed. Deliberately mirrors two existing components rather than
// inventing new patterns: the line-item builder here is a trimmed-down
// AddItemForm from quote-builder.tsx (catalog picker + "add on the fly"),
// and the generate/send/copy-link/download-PDF controls mirror msa-panel.tsx.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { HelpTip } from "@/components/help-tip";
import { formatCurrency } from "@/lib/utils";
import { computeSubtotals, groupByCategory } from "@/server/pricing";
import {
  createAddendum,
  deleteAddendum,
  addAddendumLineItemFromProduct,
  addCustomAddendumLineItem,
  updateAddendumLineItem,
  removeAddendumLineItem,
  generateAddendumDocument,
  markAddendumSent,
  sendAddendumEmail,
  declineAddendumPublic,
} from "@/server/actions/addendums";
import { pushAddendumToQuickBooks } from "@/server/actions/quickbooks";
import { quickCreateProduct, type listCatalog } from "@/server/actions/catalog";
import { toast } from "sonner";
import { Plus, Trash2, FileText, Link2, Download, Mail, CheckCircle2, XCircle, ReceiptText } from "lucide-react";
import type { quoteAddendums, quoteAddendumLineItems, contacts } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Addendum = InferSelectModel<typeof quoteAddendums>;
type AddendumLineItem = InferSelectModel<typeof quoteAddendumLineItems>;
type Contact = InferSelectModel<typeof contacts>;
type Catalog = Awaited<ReturnType<typeof listCatalog>>;

const BILLING_LABEL: Record<string, string> = {
  RECURRING_MONTHLY: "/mo",
  ONE_TIME: "one-time",
  HOURLY: "/hr",
};

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  DRAFT: "secondary",
  SENT: "warning",
  SIGNED: "success",
  DECLINED: "destructive",
};

export function AddendumsPanel({
  quoteId,
  msaSigned,
  addendums,
  lineItemsByAddendum,
  catalog,
  contact,
}: {
  quoteId: string;
  msaSigned: boolean;
  addendums: Addendum[];
  lineItemsByAddendum: Record<string, AddendumLineItem[]>;
  catalog: Catalog;
  contact: Contact | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [note, setNote] = useState("");

  function createNew() {
    startTransition(async () => {
      const result = await createAddendum(quoteId, note.trim() || undefined);
      if (result.ok) {
        setNote("");
        setNewOpen(false);
        router.refresh();
        toast.success("Addendum created — add its line items below");
      } else {
        toast.error(result.error || "Could not create the addendum");
      }
    });
  }

  if (!msaSigned) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-slate-500">
        Available once this quote&rsquo;s Master Service Agreement has been signed — an addendum amends an executed
        agreement. Until then, just edit the quote&rsquo;s line items directly.
        <HelpTip text="Once the MSA card above shows 'Signed', come back here to add services the customer wants after the fact without reopening the whole agreement." />
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        For services added after the MSA is signed. Each addendum is its own short document that references and
        amends the signed MSA — the customer signs just the addendum, not the whole agreement again.
        <HelpTip text="Once signed, an addendum's line items are automatically added to this quote and its totals recalculated. This is a generated starting template, not legal advice." />
      </p>

      {addendums.map((addendum) => (
        <AddendumCard
          key={addendum.id}
          addendum={addendum}
          lineItems={lineItemsByAddendum[addendum.id] || []}
          catalog={catalog}
          contact={contact}
        />
      ))}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-fit">
            <Plus className="h-4 w-4" /> New addendum
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New addendum</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              placeholder="What's changing? (e.g. 'Add managed backup for 2 new servers') — shown to the customer on the addendum."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button onClick={createNew} disabled={pending}>
              {pending ? "Creating…" : "Create addendum"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddendumCard({
  addendum,
  lineItems,
  catalog,
  contact,
}: {
  addendum: Addendum;
  lineItems: AddendumLineItem[];
  catalog: Catalog;
  contact: Contact | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState(contact?.email ?? "");

  const editable = addendum.status === "DRAFT";
  const hasContent = Boolean(addendum.content && Object.keys(addendum.content as object).length > 0);
  const grouped = groupByCategory(lineItems);
  const totals = useMemo(() => computeSubtotals(lineItems), [lineItems]);

  const signingUrl =
    typeof window !== "undefined" ? `${window.location.origin}/addendum/${addendum.signingToken}` : `/addendum/${addendum.signingToken}`;

  function remove() {
    if (!confirm(`Delete draft Addendum #${addendum.number}?`)) return;
    startTransition(async () => {
      const result = await deleteAddendum(addendum.id);
      if (result.ok) {
        router.refresh();
        toast.success("Draft addendum deleted");
      } else {
        toast.error(result.error || "Could not delete this addendum");
      }
    });
  }

  function onQuantityChange(item: AddendumLineItem, quantity: string) {
    startTransition(async () => {
      await updateAddendumLineItem(addendum.id, item.id, { quantity });
      router.refresh();
    });
  }

  function onPriceChange(item: AddendumLineItem, unitPrice: string) {
    startTransition(async () => {
      await updateAddendumLineItem(addendum.id, item.id, { unitPrice });
      router.refresh();
    });
  }

  function onRemoveItem(item: AddendumLineItem) {
    startTransition(async () => {
      await removeAddendumLineItem(addendum.id, item.id);
      router.refresh();
    });
  }

  function generate() {
    startTransition(async () => {
      const result = await generateAddendumDocument(addendum.id);
      if (result.ok) {
        router.refresh();
        toast.success(hasContent ? "Addendum document regenerated" : "Addendum document generated");
      } else {
        toast.error(result.error || "Could not generate the addendum");
      }
    });
  }

  function copyLink() {
    navigator.clipboard.writeText(signingUrl);
    startTransition(async () => {
      await markAddendumSent(addendum.id);
      router.refresh();
    });
    toast.success("Signing link copied");
  }

  function sendEmail() {
    if (!email.trim()) {
      toast.error("Enter an email address first");
      return;
    }
    startTransition(async () => {
      const result = await sendAddendumEmail(addendum.id, email.trim());
      if (result.ok) {
        router.refresh();
        toast.success(`Addendum emailed to ${email.trim()}`);
      } else {
        toast.error(result.error || "Could not send the email");
      }
    });
  }

  function markDeclined() {
    if (!confirm(`Mark Addendum #${addendum.number} as declined by the customer?`)) return;
    startTransition(async () => {
      const result = await declineAddendumPublic(addendum.signingToken);
      if (result.ok) {
        router.refresh();
        toast.success("Addendum marked declined");
      } else {
        toast.error(result.error || "Could not update this addendum");
      }
    });
  }

  function pushToQb() {
    startTransition(async () => {
      const result = await pushAddendumToQuickBooks(addendum.id);
      if (result.ok) {
        toast.success("Addendum invoice created in QuickBooks");
      } else {
        toast.error(result.error || "QuickBooks sync failed");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">Addendum #{addendum.number}</span>
          <Badge variant={STATUS_VARIANT[addendum.status] || "secondary"}>{addendum.status}</Badge>
        </div>
        {editable && (
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending} title="Delete this draft">
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        )}
      </div>

      {addendum.note && <p className="text-sm text-slate-600">{addendum.note}</p>}

      {addendum.status === "SIGNED" && (
        <Badge variant="success" className="w-fit">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Signed by {addendum.signedByName}
          {addendum.signedAt ? ` on ${new Date(addendum.signedAt).toLocaleDateString()}` : ""}
        </Badge>
      )}
      {addendum.status === "DECLINED" && (
        <Badge variant="destructive" className="w-fit">
          <XCircle className="mr-1 h-3 w-3" /> Declined
        </Badge>
      )}

      {grouped.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
          No line items yet.
        </p>
      ) : (
        grouped.map((group) => (
          <div key={group.categoryName}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">{group.categoryName}</p>
            <Table>
              <TableBody>
                {group.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="w-[45%]">
                      <span className="font-medium text-slate-900">{item.name}</span>
                      {item.description && <div className="whitespace-pre-wrap text-xs text-slate-500">{item.description}</div>}
                    </TableCell>
                    <TableCell className="w-24">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={item.quantity}
                        disabled={!editable}
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
                          disabled={!editable}
                          onChange={(e) => onPriceChange(item, e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{BILLING_LABEL[item.billingType]}</div>
                    </TableCell>
                    <TableCell className="w-24 text-right font-medium">{formatCurrency(item.lineTotal)}</TableCell>
                    <TableCell className="w-10">
                      {editable && (
                        <Button variant="ghost" size="icon" onClick={() => onRemoveItem(item)} disabled={pending}>
                          <Trash2 className="h-4 w-4 text-slate-400" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}

      {editable && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-fit">
              <Plus className="h-4 w-4" /> Add product / service
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add to Addendum #{addendum.number}</DialogTitle>
            </DialogHeader>
            <AddAddendumItemForm addendumId={addendum.id} catalog={catalog} onAdded={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      {lineItems.length > 0 && (
        <div className="flex flex-col items-end gap-0.5 border-t border-slate-100 pt-2 text-sm">
          {totals.subtotalMonthly > 0 && (
            <div className="flex w-56 justify-between text-slate-600">
              <span>Adds to monthly</span>
              <span className="font-medium">{formatCurrency(totals.subtotalMonthly)}/mo</span>
            </div>
          )}
          {totals.subtotalOneTime > 0 && (
            <div className="flex w-56 justify-between text-slate-600">
              <span>One-time</span>
              <span className="font-medium">{formatCurrency(totals.subtotalOneTime)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {editable && (
          <Button size="sm" variant="outline" onClick={generate} disabled={pending || lineItems.length === 0}>
            <FileText className="h-4 w-4" /> {hasContent ? "Regenerate document" : "Generate document"}
          </Button>
        )}
        {hasContent && (
          <>
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Link2 className="h-4 w-4" /> Copy signing link
            </Button>
            <a href={`/api/addendum/${addendum.id}/pdf`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </a>
          </>
        )}
        {addendum.status !== "SIGNED" && addendum.status !== "DECLINED" && (
          <Button size="sm" variant="ghost" onClick={markDeclined} disabled={pending}>
            <XCircle className="h-4 w-4" /> Mark declined
          </Button>
        )}
        {addendum.status === "SIGNED" && !addendum.quickbooksInvoiceId && (
          <Button size="sm" onClick={pushToQb} disabled={pending}>
            <ReceiptText className="h-4 w-4" /> Send addendum invoice to QuickBooks
          </Button>
        )}
        {addendum.quickbooksInvoiceId && <span className="text-xs text-emerald-700">Invoiced in QuickBooks ✓</span>}
      </div>

      {hasContent && addendum.status !== "SIGNED" && addendum.status !== "DECLINED" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-200 p-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs text-slate-500">Email to contact</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="h-8" />
          </div>
          <Button size="sm" onClick={sendEmail} disabled={pending}>
            <Mail className="h-4 w-4" /> Send
          </Button>
        </div>
      )}

      {addendum.sentToEmail && (
        <p className="text-xs text-slate-400">
          Last emailed to {addendum.sentToEmail} {addendum.sentAt ? `on ${new Date(addendum.sentAt).toLocaleDateString()}` : ""}
        </p>
      )}
    </div>
  );
}

function AddAddendumItemForm({
  addendumId,
  catalog,
  onAdded,
}: {
  addendumId: string;
  catalog: Catalog;
  onAdded: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState("1");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
      await addAddendumLineItemFromProduct(addendumId, productId, quantity);
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
      const categoryName = catalog.categories.find((c) => c.id === categoryId)?.name || newCategoryName.trim();

      if (saveToCatalog) {
        await quickCreateProduct({
          name,
          description: description || undefined,
          categoryId: categoryId || undefined,
          newCategoryName: !categoryId ? newCategoryName : undefined,
          unitLabel,
          billingType,
          defaultUnitPrice: unitPrice,
        });
      }

      await addCustomAddendumLineItem(addendumId, {
        categoryName,
        name,
        description: description || undefined,
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
            {pending ? "Adding…" : "Add to addendum"}
          </Button>
        </DialogFooter>
      </TabsContent>

      <TabsContent value="new" className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">Create a brand-new product or service right now and add it to this addendum.</p>
        <Input placeholder="Name (e.g. 'SIEM monitoring')" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          placeholder="Client-facing description — what this covers, in plain language. Shown on the addendum."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />

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
            {pending ? "Adding…" : "Add to addendum"}
          </Button>
        </DialogFooter>
      </TabsContent>
    </Tabs>
  );
}

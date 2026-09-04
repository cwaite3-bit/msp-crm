"use client";

import { useState, useTransition, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateQuoteMeta, repriceForTier } from "@/server/actions/quotes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { quotes, serviceTiers, contacts } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;
type Tier = InferSelectModel<typeof serviceTiers>;
type Contact = InferSelectModel<typeof contacts>;

export function QuoteMetaForm({ quote, tiers, contacts }: { quote: Quote; tiers: Tier[]; contacts: Contact[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serviceTierId, setServiceTierId] = useState(quote.serviceTierId ?? "none");
  const [contactId, setContactId] = useState(quote.contactId ?? "none");
  const [discountType, setDiscountType] = useState(quote.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(quote.discountValue ?? "");
  const [taxRatePct, setTaxRatePct] = useState(quote.taxRatePct ?? "");
  const [validUntil, setValidUntil] = useState(
    quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : ""
  );
  const [notesToClient, setNotesToClient] = useState(quote.notesToClient ?? "");
  const [internalNotes, setInternalNotes] = useState(quote.internalNotes ?? "");

  // The service tier can also be changed elsewhere (the Plan Comparison
  // panel's "Use this plan" / "Re-apply plan" buttons), which updates
  // `quote.serviceTierId` via a server action + router.refresh(). Because
  // useState() only reads its initializer on mount, this form's local
  // dropdown would otherwise keep showing whatever tier was selected when
  // the page first loaded, and clicking "Save settings" would silently
  // write that stale value back over the correct one. Resync whenever the
  // prop changes.
  useEffect(() => {
    setServiceTierId(quote.serviceTierId ?? "none");
  }, [quote.serviceTierId]);

  function save(extra: Partial<Parameters<typeof updateQuoteMeta>[1]> = {}) {
    startTransition(async () => {
      await updateQuoteMeta(quote.id, {
        serviceTierId: serviceTierId === "none" ? null : serviceTierId,
        contactId: contactId === "none" ? null : contactId,
        discountType: discountType === "none" ? null : (discountType as "PERCENT" | "AMOUNT"),
        discountValue: discountValue ? String(discountValue) : null,
        taxRatePct: taxRatePct ? String(taxRatePct) : null,
        validUntil: validUntil || null,
        notesToClient,
        internalNotes,
        ...extra,
      });
      router.refresh();
      toast.success("Saved");
    });
  }

  async function onTierChange(value: string) {
    setServiceTierId(value);
    startTransition(async () => {
      await updateQuoteMeta(quote.id, { serviceTierId: value === "none" ? null : value });
      await repriceForTier(quote.id);
      router.refresh();
      toast.success("Re-priced for new service tier");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Service tier</Label>
        <Select value={serviceTierId} onValueChange={onTierChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No tier</SelectItem>
            {tiers.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} {t.description ? `— ${t.description}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {contacts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Contact</Label>
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Discount</Label>
          <Select value={discountType} onValueChange={setDiscountType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="PERCENT">Percent</SelectItem>
              <SelectItem value="AMOUNT">Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>&nbsp;</Label>
          <Input
            type="number"
            step="0.01"
            value={discountValue ?? ""}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={discountType === "none"}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tax rate (%)</Label>
        <Input type="number" step="0.01" value={taxRatePct ?? ""} onChange={(e) => setTaxRatePct(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Valid until</Label>
        <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Notes to client</Label>
        <Textarea value={notesToClient} onChange={(e) => setNotesToClient(e.target.value)} rows={3} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Internal notes (never shown to client)</Label>
        <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
      </div>

      <Button onClick={() => save()} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

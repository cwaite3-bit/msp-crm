"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send, Link2, ExternalLink, Trash2, ReceiptText } from "lucide-react";
import { setQuoteStatus, deleteQuote } from "@/server/actions/quotes";
import { pushQuoteToQuickBooks } from "@/server/actions/quickbooks";
import { toast } from "sonner";
import type { quotes } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;

export function QuoteActions({ quote }: { quote: Quote }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/q/${quote.publicToken}` : `/q/${quote.publicToken}`;

  function copyLink() {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Client link copied");
  }

  function send() {
    startTransition(async () => {
      await setQuoteStatus(quote.id, "SENT");
      router.refresh();
      toast.success("Marked as sent");
    });
  }

  function remove() {
    if (!confirm("Delete this quote? This cannot be undone.")) return;
    startTransition(async () => {
      await deleteQuote(quote.id);
      router.push(`/customers/${quote.customerId}`);
    });
  }

  function pushToQb() {
    startTransition(async () => {
      const result = await pushQuoteToQuickBooks(quote.id);
      if (result.ok) {
        toast.success("Invoice created in QuickBooks");
      } else {
        toast.error(result.error || "QuickBooks sync failed");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={copyLink}>
        <Link2 className="h-4 w-4" /> Copy client link
      </Button>
      <a href={`/q/${quote.publicToken}`} target="_blank" rel="noreferrer">
        <Button variant="outline" size="sm">
          <ExternalLink className="h-4 w-4" /> View as client
        </Button>
      </a>
      {quote.status === "DRAFT" && (
        <Button size="sm" onClick={send} disabled={pending}>
          <Send className="h-4 w-4" /> Mark as sent
        </Button>
      )}
      {quote.status === "ACCEPTED" && !quote.quickbooksInvoiceId && (
        <Button size="sm" onClick={pushToQb} disabled={pending}>
          <ReceiptText className="h-4 w-4" /> Send to QuickBooks
        </Button>
      )}
      {quote.quickbooksInvoiceId && (
        <span className="text-xs text-emerald-700">Invoiced in QuickBooks ✓</span>
      )}
      <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
        <Trash2 className="h-4 w-4 text-slate-400" />
      </Button>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send, Link2, ExternalLink, Trash2, ReceiptText, RotateCcw } from "lucide-react";
import { setQuoteStatus, deleteQuote, resetQuote } from "@/server/actions/quotes";
import { pushQuoteToQuickBooks } from "@/server/actions/quickbooks";
import { toast } from "sonner";
import type { quotes } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;

export function QuoteActions({ quote, msaSigned }: { quote: Quote; msaSigned: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/q/${quote.publicToken}` : `/q/${quote.publicToken}`;

  function copyLink() {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Client link copied");
  }

  function send() {
    startTransition(async () => {
      const result = await setQuoteStatus(quote.id, "SENT");
      router.refresh();
      if (result?.emailSent) {
        toast.success("Marked as sent and emailed to the customer");
      } else {
        toast.success("Marked as sent");
        if (result?.emailError) toast.error(`Email not sent: ${result.emailError}`);
      }
    });
  }

  function remove() {
    const invoicedWarning = quote.quickbooksInvoiceId
      ? " This quote has already been invoiced in QuickBooks — deleting it here will NOT delete or void that invoice, so your QuickBooks records and this CRM will fall out of sync unless you void the invoice there yourself."
      : "";
    if (
      !confirm(
        `Delete quote #${quote.quoteNumber}? This permanently removes it, all of its line items, and its full history (sent/viewed/accepted events).${invoicedWarning} This cannot be undone.`
      )
    )
      return;
    startTransition(async () => {
      await deleteQuote(quote.id);
      router.push(`/customers/${quote.customerId}`);
    });
  }

  function reset() {
    const statusWarning =
      quote.status !== "DRAFT"
        ? ` This quote is currently ${quote.status}, and resetting will revert its status to DRAFT and clear its sent/viewed/accepted/declined record.`
        : "";
    if (
      !confirm(
        `Reset quote #${quote.quoteNumber} to blank? This permanently clears its Discovery inputs, add-ons, and every line item so you can redo it from scratch.${statusWarning} This cannot be undone.`
      )
    )
      return;
    startTransition(async () => {
      try {
        await resetQuote(quote.id);
        router.refresh();
        toast.success("Quote reset — start fresh from Discovery");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not reset this quote");
      }
    });
  }

  function pushToQb() {
    startTransition(async () => {
      const result = await pushQuoteToQuickBooks(quote.id);
      if (result.ok) {
        toast.success("First invoice created in QuickBooks");
      } else {
        toast.error(result.error || "QuickBooks sync failed");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        <Button
          size="sm"
          onClick={pushToQb}
          disabled={pending || !msaSigned}
          title={msaSigned ? undefined : "Available once the customer has signed the Master Service Agreement below"}
        >
          <ReceiptText className="h-4 w-4" /> Send first invoice to QuickBooks
        </Button>
      )}
      {quote.quickbooksInvoiceId && (
        <span className="text-xs text-emerald-700">First invoice sent to QuickBooks ✓</span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={reset}
        disabled={pending || Boolean(quote.quickbooksInvoiceId)}
        title={
          quote.quickbooksInvoiceId
            ? "Already invoiced in QuickBooks — create a new quote instead of resetting this one"
            : "Clear Discovery, add-ons, and every line item and start this quote over from blank"
        }
      >
        <RotateCcw className="h-4 w-4" /> Start over
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={remove}
        disabled={pending}
        title="Delete this quote"
      >
        <Trash2 className="h-4 w-4 text-slate-400" />
      </Button>
    </div>
  );
}

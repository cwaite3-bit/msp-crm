"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Send, Link2, ExternalLink, Trash2, ReceiptText, RotateCcw } from "lucide-react";
import { setQuoteStatus, deleteQuote, resetQuote, resendQuoteEmail } from "@/server/actions/quotes";
import { pushQuoteToQuickBooks } from "@/server/actions/quickbooks";
import { toast } from "sonner";
import type { quotes, contacts } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;
type Contact = InferSelectModel<typeof contacts>;

// Plenty of room for "up to a small paragraph" without inviting someone to
// paste the whole proposal cover letter in here — this is a short personal
// note, not a replacement for the quote's own notes-to-client field.
const SEND_NOTE_MAX_LENGTH = 600;

export function QuoteActions({
  quote,
  msaSigned,
  contact,
}: {
  quote: Quote;
  msaSigned: boolean;
  contact: Contact | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendNote, setSendNote] = useState("");

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/q/${quote.publicToken}` : `/q/${quote.publicToken}`;
  const recipientLabel = contact
    ? `${contact.firstName} ${contact.lastName}${contact.email ? ` <${contact.email}>` : " (no email on file)"}`
    : "no contact selected on this quote";

  function copyLink() {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Client link copied");
  }

  // Emailing the customer is a one-way action — there's no "unsend" — so the
  // dialog itself (opened from the "Mark as sent" button below) states
  // plainly who this is about to email and that it can't be undone, the
  // same way the "Delete" and "Start over" confirm() dialogs below do — a
  // plain confirm() can't also hold the optional note's textarea, so this
  // one is a proper dialog instead.
  function send() {
    startTransition(async () => {
      const note = sendNote.trim();
      const result = await setQuoteStatus(quote.id, "SENT", note ? { message: note } : undefined);
      setSendDialogOpen(false);
      setSendNote("");
      router.refresh();
      if (result?.emailSent) {
        toast.success("Marked as sent and emailed to the customer");
      } else {
        toast.success("Marked as sent");
        if (result?.emailError) toast.error(`Email not sent: ${result.emailError}`);
      }
    });
  }

  // For a quote that's already past Draft — the customer lost the email,
  // asked for it again, or staff wants to nudge them. Deliberately doesn't
  // touch the quote's status (see resendQuoteEmail's own comment).
  function resend() {
    if (
      !confirm(`Re-send quote #${quote.quoteNumber} to ${recipientLabel} now? This emails them the same client link again.`)
    )
      return;
    startTransition(async () => {
      const result = await resendQuoteEmail(quote.id);
      if (result.ok) {
        toast.success("Quote re-sent to the customer");
        router.refresh();
      } else {
        toast.error(result.error || "Could not resend this quote");
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
      const result = await resetQuote(quote.id);
      if (result.ok) {
        router.refresh();
        toast.success("Quote reset — start fresh from Discovery");
      } else {
        toast.error(result.error || "Could not reset this quote");
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
        <Dialog open={sendDialogOpen} onOpenChange={(next) => (!pending ? setSendDialogOpen(next) : null)}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={pending}>
              <Send className="h-4 w-4" /> Mark as sent
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Send quote #{quote.quoteNumber}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <p className="text-xs text-slate-500">
                This emails {recipientLabel} a link to view, accept, or decline this quote, and moves it out of Draft
                status. This cannot be undone.
              </p>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-slate-500">
                  Personal note (optional) — included in the body of the email, above the quote link. Leave it blank
                  to send the standard email as-is.
                </span>
                <Textarea
                  rows={4}
                  maxLength={SEND_NOTE_MAX_LENGTH}
                  value={sendNote}
                  onChange={(e) => setSendNote(e.target.value)}
                  placeholder="e.g. Thanks for walking through your environment with me yesterday — let me know if any of the numbers below need adjusting."
                />
                <span className="self-end text-[11px] text-slate-400">
                  {sendNote.length}/{SEND_NOTE_MAX_LENGTH}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={send} disabled={pending}>
                <Send className="h-4 w-4" /> {pending ? "Sending…" : "Send quote"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {quote.status !== "DRAFT" && (
        <Button
          variant="outline"
          size="sm"
          onClick={resend}
          disabled={pending}
          title={`Re-send this quote's link to ${recipientLabel}`}
        >
          <Send className="h-4 w-4" /> Resend to customer
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/help-tip";
import { generateMsa, sendMsaEmail } from "@/server/actions/msa";
import { toast } from "sonner";
import { FileText, Link2, Download, Mail, CheckCircle2 } from "lucide-react";
import type { quotes, contacts, msaDocuments } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Quote = InferSelectModel<typeof quotes>;
type Contact = InferSelectModel<typeof contacts>;
type MsaDocument = InferSelectModel<typeof msaDocuments>;

export function MsaPanel({ quote, contact, document }: { quote: Quote; contact: Contact | null; document: MsaDocument | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(contact?.email ?? "");

  const signingUrl = document
    ? typeof window !== "undefined"
      ? `${window.location.origin}/msa/${document.signingToken}`
      : `/msa/${document.signingToken}`
    : "";

  function generate() {
    startTransition(async () => {
      try {
        await generateMsa(quote.id);
        router.refresh();
        toast.success(document ? "MSA regenerated from current quote data" : "MSA generated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not generate the MSA");
      }
    });
  }

  function copyLink() {
    navigator.clipboard.writeText(signingUrl);
    toast.success("Signing link copied");
  }

  function sendEmail() {
    if (!document) return;
    if (!email.trim()) {
      toast.error("Enter an email address first");
      return;
    }
    startTransition(async () => {
      try {
        await sendMsaEmail(document.id, email.trim());
        router.refresh();
        toast.success(`MSA emailed to ${email.trim()}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send the email");
      }
    });
  }

  if (quote.status !== "ACCEPTED" && !document) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-slate-500">
        Available once this quote is accepted — the MSA summarizes exactly what the customer agreed to.
        <HelpTip text="Mark the quote Accepted (staff) or have the customer accept it on their client link) — then come back here to generate the MSA." />
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        Summarizes the agreed tier, SLA, and line items into a full agreement — signable in-app or downloadable to
        upload to Adobe Acrobat Sign, DocuSign, or your e-signature provider of choice.
        <HelpTip text="This is a generated starting template, not legal advice. Review the standing terms in Settings → MSA terms, and have an attorney review the language before relying on it." />
      </p>

      {document && (
        <div className="flex items-center gap-2">
          {document.status === "SIGNED" ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Signed by {document.signedByName}
              {document.signedAt ? ` on ${new Date(document.signedAt).toLocaleDateString()}` : ""}
            </Badge>
          ) : (
            <Badge variant="secondary">{document.status}</Badge>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={generate} disabled={pending || document?.status === "SIGNED"}>
          <FileText className="h-4 w-4" /> {document ? "Regenerate MSA" : "Generate MSA"}
        </Button>
        {document && (
          <>
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Link2 className="h-4 w-4" /> Copy signing link
            </Button>
            <a href={`/api/msa/${document.id}/pdf`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </a>
          </>
        )}
      </div>

      {document && document.status !== "SIGNED" && (
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

      {document?.sentToEmail && (
        <p className="text-xs text-slate-400">
          Last emailed to {document.sentToEmail} {document.sentAt ? `on ${new Date(document.sentAt).toLocaleDateString()}` : ""}
        </p>
      )}
    </div>
  );
}

"use client";

// Shared staff "countersign" UI for MSAs and Addendums — the second half of
// the "customer signs, then the account owner signs" flow (see
// countersignMsa / countersignAddendum in src/server/actions). Deliberately
// mirrors the public signing panels (msa-sign-panel.tsx /
// addendum-sign-panel.tsx): same SignaturePad, same name/title inputs, same
// "confirm" button — just gated to logged-in staff and pre-filled with the
// logged-in user's own name/title instead of starting blank.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/signature-pad";
import { PenLine, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function CountersignControl({
  label,
  countersign,
  providerSignedAt,
  providerSignedByName,
  providerSignedByTitle,
  currentUser,
}: {
  /** e.g. "MSA" or "Addendum #2" — used in dialog title and toasts. */
  label: string;
  countersign: (signatureImageDataUri: string | null, name: string, title: string) => Promise<{ ok: boolean; error?: string }>;
  providerSignedAt: Date | null;
  providerSignedByName: string | null;
  providerSignedByTitle: string | null;
  currentUser: { name: string; title: string | null } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentUser?.name ?? "");
  const [title, setTitle] = useState(currentUser?.title ?? "");
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  if (providerSignedAt) {
    return (
      <Badge variant="success" className="w-fit">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Fully executed — countersigned by {providerSignedByName}
        {providerSignedByTitle ? `, ${providerSignedByTitle}` : ""} on {new Date(providerSignedAt).toLocaleDateString()}
      </Badge>
    );
  }

  const canSubmit = Boolean(name.trim() && signatureImage);

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await countersign(signatureImage, name.trim(), title.trim());
      if (result.ok) {
        setOpen(false);
        router.refresh();
        toast.success(`${label} countersigned — fully executed, and a copy has been emailed to the customer`);
      } else {
        toast.error(result.error || `Could not countersign the ${label}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-fit">
          <PenLine className="h-4 w-4" /> Countersign as provider
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Countersign {label}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            The customer has already signed. Add your signature below to fully execute this document in place of
            printing, signing by hand, and storing a paper copy — a fully executed PDF will be emailed to the
            customer and to you.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          </div>
          <SignaturePad onChange={setSignatureImage} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !canSubmit}>
            {pending ? "Submitting…" : "Confirm countersignature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

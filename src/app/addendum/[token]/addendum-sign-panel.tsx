"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signAddendumPublic, declineAddendumPublic } from "@/server/actions/addendums";
import { SignaturePad } from "@/components/signature-pad";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export function AddendumSignPanel({
  token,
  status,
  signedByName,
  signedByTitle,
  signedAt,
}: {
  token: string;
  status: string;
  signedByName: string | null;
  signedByTitle: string | null;
  signedAt: Date | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<"idle" | "signing">("idle");
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  if (status === "SIGNED") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-[#eaf4fd] px-4 py-3 text-[#024996]">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-medium">
          Signed by {signedByName}
          {signedByTitle ? `, ${signedByTitle}` : ""} {signedAt ? `on ${new Date(signedAt).toLocaleDateString()}` : ""}
        </span>
      </div>
    );
  }

  if (status === "DECLINED") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-red-800">
        <XCircle className="h-5 w-5" />
        <span className="text-sm font-medium">This addendum was declined.</span>
      </div>
    );
  }

  const canSubmit = Boolean(name.trim() && agreed && signatureImage);

  function sign() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await signAddendumPublic(token, name.trim(), title.trim(), signatureImage);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.error || "Could not submit your signature");
      }
    });
  }

  function decline() {
    if (!confirm("Decline this addendum?")) return;
    startTransition(async () => {
      const result = await declineAddendumPublic(token);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.error || "Could not decline this addendum");
      }
    });
  }

  if (mode === "signing") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-[#bcdcf7] bg-[#eaf4fd] p-4">
        <p className="text-sm font-medium text-[#024996]">Sign this addendum</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
        </div>
        <SignaturePad onChange={setSignatureImage} />
        <label className="flex items-start gap-2 text-xs text-[#024996]">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read this Addendum and agree to be bound by its terms, which amend the Master Service Agreement
          referenced above, on behalf of the client named there. I understand this typed name and drawn signature
          together are a legally binding electronic signature under applicable e-signature law, though not a
          certified/notarized digital signature product, and that my IP address is logged with this submission.
        </label>
        <div className="flex gap-2">
          <Button onClick={sign} disabled={pending || !canSubmit} className="bg-[#024996] hover:bg-[#023a78]">
            {pending ? "Submitting…" : "Confirm signature"}
          </Button>
          <Button variant="outline" onClick={() => setMode("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
        {!signatureImage && <p className="text-xs text-[#024996]/70">Draw your signature above to enable signing.</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setMode("signing")} className="bg-[#1d98eb] hover:bg-[#1683cc]">
        <CheckCircle2 className="h-4 w-4" /> Sign addendum
      </Button>
      <Button variant="outline" onClick={decline} disabled={pending}>
        <XCircle className="h-4 w-4" /> Decline
      </Button>
      <Button variant="ghost" onClick={() => window.print()}>
        Save / print as PDF
      </Button>
    </div>
  );
}

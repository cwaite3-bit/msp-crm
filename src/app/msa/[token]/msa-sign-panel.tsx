"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signMsaPublic } from "@/server/actions/msa";
import { CheckCircle2 } from "lucide-react";

export function MsaSignPanel({
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

  if (status === "SIGNED") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-medium">
          Signed by {signedByName}
          {signedByTitle ? `, ${signedByTitle}` : ""} {signedAt ? `on ${new Date(signedAt).toLocaleDateString()}` : ""}
        </span>
      </div>
    );
  }

  function sign() {
    if (!name.trim() || !agreed) return;
    startTransition(async () => {
      await signMsaPublic(token, name.trim(), title.trim());
      router.refresh();
    });
  }

  if (mode === "signing") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-900">Type your full name to sign this agreement</p>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
        <label className="flex items-start gap-2 text-xs text-emerald-900">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read this Master Service Agreement and agree to be bound by its terms on behalf of the client
          named above. I understand this typed signature is a legally binding electronic signature under
          applicable e-signature law, though it is not a certified digital signature product.
        </label>
        <div className="flex gap-2">
          <Button onClick={sign} disabled={pending || !name.trim() || !agreed}>
            {pending ? "Submitting…" : "Confirm signature"}
          </Button>
          <Button variant="outline" onClick={() => setMode("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setMode("signing")} className="bg-emerald-600 hover:bg-emerald-500">
        <CheckCircle2 className="h-4 w-4" /> Sign agreement
      </Button>
      <Button variant="ghost" onClick={() => window.print()}>
        Save / print as PDF
      </Button>
    </div>
  );
}

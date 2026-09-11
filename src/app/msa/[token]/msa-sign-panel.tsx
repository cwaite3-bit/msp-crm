"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signMsaPublic } from "@/server/actions/msa";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// Fixed backing resolution for the signature pad canvas — kept small since
// a signature is just black strokes on white, so the resulting PNG is only
// a few KB (stored directly on the msa_documents row, same pattern as
// staff photos). The element is displayed larger via CSS; drawing
// coordinates are scaled from display size to this backing resolution so
// strokes line up correctly regardless of the rendered width.
const PAD_WIDTH = 600;
const PAD_HEIGHT = 180;

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  function ctxOf(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    return ctx;
  }

  function posFromEvent(e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const ctx = ctxOf(canvas);
    if (!ctx) return;
    const { x, y } = posFromEvent(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = ctxOf(canvas);
    if (!ctx) return;
    const { x, y } = posFromEvent(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) {
      setHasInk(true);
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-32 w-full touch-none rounded-md border border-slate-300 bg-white"
        style={{ backgroundColor: "#ffffff" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Draw your signature above with your mouse, stylus, or finger.</span>
        <button type="button" onClick={clear} className="text-xs font-medium text-[#024996] underline">
          Clear
        </button>
      </div>
    </div>
  );
}

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

  const canSubmit = Boolean(name.trim() && agreed && signatureImage);

  function sign() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await signMsaPublic(token, name.trim(), title.trim(), signatureImage);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.error || "Could not submit your signature");
      }
    });
  }

  if (mode === "signing") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-[#bcdcf7] bg-[#eaf4fd] p-4">
        <p className="text-sm font-medium text-[#024996]">Sign this agreement</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
        </div>
        <SignaturePad onChange={setSignatureImage} />
        <label className="flex items-start gap-2 text-xs text-[#024996]">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read this Master Service Agreement and agree to be bound by its terms on behalf of the client
          named above. I understand this typed name and drawn signature together are a legally binding electronic
          signature under applicable e-signature law, though not a certified/notarized digital signature product,
          and that my IP address is logged with this submission.
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
        <CheckCircle2 className="h-4 w-4" /> Sign agreement
      </Button>
      <Button variant="ghost" onClick={() => window.print()}>
        Save / print as PDF
      </Button>
    </div>
  );
}

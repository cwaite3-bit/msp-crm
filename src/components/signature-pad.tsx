"use client";

// A small canvas-based signature pad — extracted from the original MSA
// signing page (msa-sign-panel.tsx) so the new addendum signing page
// (app/addendum/[token]/addendum-sign-panel.tsx) can share it exactly
// instead of re-implementing pointer-drawing logic a second time. No
// behavior changed from the original inline version.
import { useRef, useState } from "react";

// Fixed backing resolution for the signature pad canvas — kept small since
// a signature is just black strokes on white, so the resulting PNG is only
// a few KB (stored directly on the row, same pattern as staff photos). The
// element is displayed larger via CSS; drawing coordinates are scaled from
// display size to this backing resolution so strokes line up correctly
// regardless of the rendered width.
const PAD_WIDTH = 600;
const PAD_HEIGHT = 180;

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
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

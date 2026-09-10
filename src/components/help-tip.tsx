"use client";

// Small "?" affordance for inline help throughout the app — hover or tap to
// see an explanation, without cluttering the layout with permanent help
// text. Self-contained (wraps its own TooltipProvider) so it can be dropped
// next to any label/field/button without touching the page's own tree.
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export function HelpTip({ text, className }: { text: string; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            className={`inline-flex shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${className ?? ""}`}
            aria-label="Help"
            onClick={(e) => e.preventDefault()}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Wraps a field/label row and appends a HelpTip after the label text —
// convenience for the common "Label + help icon" pairing.
export function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <HelpTip text={help} />
    </span>
  );
}

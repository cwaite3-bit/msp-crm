"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/help-tip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateAiQuoteReview } from "@/server/actions/ai-review";
import { toast } from "sonner";
import { Sparkles, ExternalLink, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

// Mirrors AiReviewResult in src/server/ai-review.ts. Duplicated (rather
// than imported) so this client component never pulls in that module's
// node:crypto-based hashing function into the browser bundle — this file
// only ever needs to read the stored JSON back, not build or hash it.
type ParsedOpportunity = {
  title: string;
  type: "catalog" | "custom" | "research";
  rationale: string;
  estimatedMonthly: number | null;
  estimatedOneTime: number | null;
  sourceNote: string | null;
};
type ParsedReview = {
  summary: string;
  opportunities: ParsedOpportunity[];
  sources: { url: string; title: string | null }[];
};

function tryParseReview(raw: string): ParsedReview | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ParsedReview>;
    if (!parsed || !Array.isArray(parsed.opportunities)) return null;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      opportunities: parsed.opportunities,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return null;
  }
}

const TYPE_BADGE: Record<ParsedOpportunity["type"], { label: string; variant: "success" | "warning" | "secondary" }> = {
  catalog: { label: "In your catalog", variant: "success" },
  custom: { label: "Custom / project", variant: "warning" },
  research: { label: "Research-backed", variant: "secondary" },
};

export function AiReviewPanel({
  quoteId,
  reviewText,
  generatedAt,
  model,
  error,
  isStale,
}: {
  quoteId: string;
  reviewText: string | null;
  generatedAt: Date | null;
  model: string | null;
  error: string | null;
  isStale: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rawOpen, setRawOpen] = useState(false);

  function analyze() {
    startTransition(async () => {
      const result = await generateAiQuoteReview(quoteId);
      router.refresh();
      if (result.ok) {
        toast.success("AI review generated");
      } else {
        toast.error(result.error || "AI review failed");
      }
    });
  }

  const parsed = reviewText ? tryParseReview(reviewText) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        Staff-only — a deep-dive pass over this quote&rsquo;s data, your product catalog, and current web research,
        looking for specific revenue opportunities and things worth double-checking before sending it out. Never
        shown to the customer on any page.
        <HelpTip text="Generated on demand — it knows your catalog and can search the web for industry/compliance context. It's cached here and won't update itself; re-run it any time you've changed the quote and want a fresh look. Each run costs a small amount (a stronger model plus a few web searches)." />
      </p>

      {isStale && reviewText && (
        <Badge variant="secondary" className="w-fit">
          Quote data has changed since this was generated
        </Badge>
      )}

      {parsed && (
        <div className="flex flex-col gap-3">
          {parsed.summary && <p className="text-sm text-slate-700">{parsed.summary}</p>}

          {parsed.opportunities.length === 0 && (
            <p className="text-sm text-slate-500">Nothing stood out beyond what&rsquo;s already on this quote.</p>
          )}

          {parsed.opportunities.map((o, i) => {
            const badge = TYPE_BADGE[o.type] ?? TYPE_BADGE.custom;
            const hasEstimate = o.estimatedMonthly || o.estimatedOneTime;
            return (
              <div key={i} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{o.title}</span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                {o.rationale && <p className="mt-1 text-sm text-slate-600">{o.rationale}</p>}
                {Boolean(hasEstimate) && (
                  <p className="mt-1.5 text-xs font-semibold text-emerald-700">
                    {o.estimatedMonthly ? `+${formatCurrency(o.estimatedMonthly)}/mo` : ""}
                    {o.estimatedMonthly && o.estimatedOneTime ? " · " : ""}
                    {o.estimatedOneTime ? `+${formatCurrency(o.estimatedOneTime)} one-time` : ""}
                  </p>
                )}
                {o.sourceNote && <p className="mt-1.5 text-xs text-slate-400">{o.sourceNote}</p>}
              </div>
            );
          })}

          {parsed.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span>Researched:</span>
              {parsed.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  {s.title || new URL(s.url).hostname}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {!parsed && reviewText && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            The AI&rsquo;s answer couldn&rsquo;t be shown as a formatted list this time — its raw response is
            available below if you want to see what it said.
          </p>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setRawOpen(true)}>
            <FileText className="h-4 w-4" /> View raw response
          </Button>
        </div>
      )}

      <Dialog open={rawOpen} onOpenChange={setRawOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Raw AI response</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {reviewText}
          </pre>
        </DialogContent>
      </Dialog>

      {!reviewText && !error && <p className="text-sm text-slate-500">Not analyzed yet.</p>}

      {error && (
        <p className="text-sm text-red-600">
          {reviewText ? "Last attempt to refresh failed: " : ""}
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={analyze} disabled={pending}>
          <Sparkles className="h-4 w-4" /> {pending ? "Analyzing…" : reviewText ? "Re-analyze" : "Analyze quote"}
        </Button>
        {generatedAt && (
          <span className="text-xs text-slate-400">
            Generated {formatDate(generatedAt)}
            {model ? ` · ${model}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

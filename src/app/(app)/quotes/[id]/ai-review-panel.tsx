"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/help-tip";
import { generateAiQuoteReview } from "@/server/actions/ai-review";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { formatDate } from "@/lib/utils";

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

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        Staff-only — an AI pass over this quote&rsquo;s Discovery data, add-ons, and line items, looking for gaps or
        opportunities an experienced MSP would want to double-check before sending it out. Never shown to the
        customer on any page.
        <HelpTip text="Generated on demand from the quote's current data. It's cached here and won't update itself — re-run it any time you've changed the quote and want a fresh look." />
      </p>

      {isStale && reviewText && (
        <Badge variant="secondary" className="w-fit">
          Quote data has changed since this was generated
        </Badge>
      )}

      {reviewText && (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
          {reviewText}
        </p>
      )}

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

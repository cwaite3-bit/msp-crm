"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { backfillConfidenceFromNotes } from "@/server/actions/customers";

// One-time (but safe to re-run) recovery for prospects imported before the
// Confidence column existed — see backfillConfidenceFromNotes. Once every
// existing prospect has been caught up, this will just report "0 found"
// forever, which is fine — new imports write the column directly and never
// need it.
export function BackfillConfidenceButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await backfillConfidenceFromNotes();
      toast.success(
        result.updated > 0
          ? `Recovered confidence for ${result.updated} prospect${result.updated === 1 ? "" : "s"} from their notes`
          : "No prospects needed catching up"
      );
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      Recover confidence from notes
    </Button>
  );
}

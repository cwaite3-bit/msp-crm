"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { backfillConfidenceFromFile, type BackfillConfidenceFileResult } from "@/server/actions/customers";

// For batches where backfillConfidenceFromNotes comes up empty — an early
// import that never wrote a research note at all, so there's nothing in
// the database to recover from. This re-reads the original spreadsheet
// instead and matches rows back to existing prospects by company name,
// filling in Confidence wherever it's still blank. It never creates new
// prospects and never overwrites a Confidence that's already set.
export function BackfillConfidenceFileDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BackfillConfidenceFileResult | null>(null);
  const [fileName, setFileName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await backfillConfidenceFromFile(formData);
      setResult(res);
      if (res.ok && res.updated > 0) router.refresh();
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(null);
      setFileName("");
      formRef.current?.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Backfill confidence from file">
          <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Backfill confidence from file</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Backfill confidence from a spreadsheet</DialogTitle>
          <DialogDescription>
            For prospects whose Confidence never made it into a note (an early import, before that
            existed). Re-upload the original research spreadsheet — rows are matched to your
            existing prospects by company name and only fill in Confidence where it&rsquo;s still
            blank. Nothing new is created, and nothing already set is overwritten.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confidence-file">Spreadsheet</Label>
            <Input
              id="confidence-file"
              name="file"
              type="file"
              accept=".xlsx,.xls,.csv"
              required
              onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
            />
            {fileName && <p className="text-xs text-slate-500">{fileName}</p>}
          </div>

          {result && (
            <div
              className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${
                result.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {result.ok
                  ? `Filled in confidence for ${result.updated} prospect${result.updated === 1 ? "" : "s"}${
                      result.skipped ? `, skipped ${result.skipped}` : ""
                    }.`
                  : "Backfill failed."}
              </div>
              {result.errors.length > 0 && (
                <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-slate-600">
                  {result.errors.slice(0, 25).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 25 && <li>…and {result.errors.length - 25} more</li>}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload &amp; backfill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

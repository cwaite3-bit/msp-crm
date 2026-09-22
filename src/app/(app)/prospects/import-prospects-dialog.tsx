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
import { importProspects, type ImportProspectsResult } from "@/server/actions/customers";

// Bulk-loads an initial (or ongoing) prospect list from an .xlsx/.csv file.
// Called directly (rather than passed as a plain form `action`) because we
// need to read the {imported, skipped, errors} result back to show the
// staff member what happened, instead of just redirecting.
export function ImportProspectsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportProspectsResult | null>(null);
  const [fileName, setFileName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importProspects(formData);
      setResult(res);
      if (res.ok && res.imported > 0) router.refresh();
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
        <Button variant="outline" title="Import spreadsheet">
          <Upload /> <span className="hidden sm:inline">Import spreadsheet</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import prospects</DialogTitle>
          <DialogDescription>
            Upload an .xlsx or .csv file. The first sheet is used, and columns are matched by name
            (e.g. &ldquo;Company&rdquo;, &ldquo;Contact Name&rdquo;, &ldquo;Stage&rdquo;) — order doesn&rsquo;t matter. Rows whose
            company name already exists are skipped so you can re-run an import safely.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">Spreadsheet</Label>
            <Input
              id="file"
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
                  ? `Imported ${result.imported} prospect${result.imported === 1 ? "" : "s"}${
                      result.skipped ? `, skipped ${result.skipped}` : ""
                    }.`
                  : "Import failed."}
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
              Upload &amp; import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

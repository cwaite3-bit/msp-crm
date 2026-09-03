"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { updateScopeMatrix } from "@/server/actions/settings";
import { toast } from "sonner";
import type { ScopeMatrixRow } from "@/server/pricing-data";

export function ScopeMatrixPanel({ scopeMatrix: initial }: { scopeMatrix: ScopeMatrixRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<ScopeMatrixRow[]>(initial);

  function setField(key: string, field: keyof ScopeMatrixRow, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function save() {
    startTransition(async () => {
      await updateScopeMatrix(rows);
      router.refresh();
      toast.success("Scope matrix saved");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        Shown to clients as the feature-by-plan comparison table on the proposal page.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Service</TableHead>
            <TableHead className="w-32">Bronze</TableHead>
            <TableHead className="w-32">Silver</TableHead>
            <TableHead className="w-32">Gold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="text-sm font-medium text-slate-900">{row.service}</TableCell>
              <TableCell><Input className="h-8" value={row.bronze} onChange={(e) => setField(row.key, "bronze", e.target.value)} /></TableCell>
              <TableCell><Input className="h-8" value={row.silver} onChange={(e) => setField(row.key, "silver", e.target.value)} /></TableCell>
              <TableCell><Input className="h-8" value={row.gold} onChange={(e) => setField(row.key, "gold", e.target.value)} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button onClick={save} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save scope matrix"}
      </Button>
    </div>
  );
}

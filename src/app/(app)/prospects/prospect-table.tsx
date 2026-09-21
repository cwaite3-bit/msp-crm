"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, MoreHorizontal, ArrowRight, UserCheck } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PROSPECT_STAGES, STAGE_LABELS, STAGE_BADGE_VARIANT, type ProspectStage } from "@/lib/prospect";
import { updateProspectStage, convertProspectStatus } from "@/server/actions/customers";

export type ProspectRow = {
  id: string;
  name: string;
  stage: string | null;
  estimatedMonthlyValue: string | null;
  nextFollowUpAt: Date | string | null;
  source: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
};

export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleStageChange(row: ProspectRow, stage: ProspectStage) {
    let lostReason: string | undefined;
    if (stage === "LOST") {
      lostReason = window.prompt(`Why is "${row.name}" being marked Lost? (optional)`) || undefined;
    }
    startTransition(async () => {
      await updateProspectStage(row.id, stage, lostReason);
      router.refresh();
    });
  }

  function handleConvert(row: ProspectRow, target: "LEAD" | "ACTIVE") {
    const label = target === "ACTIVE" ? "Customer" : "Lead";
    if (!window.confirm(`Convert "${row.name}" to a ${label}? This moves it off the Prospects list.`)) return;
    startTransition(async () => {
      try {
        await convertProspectStatus(row.id, target);
        toast.success(`${row.name} converted to ${label}`);
        router.refresh();
      } catch {
        toast.error("Could not convert this prospect");
      }
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Est. monthly value</TableHead>
          <TableHead>Next follow-up</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const stage = (row.stage as ProspectStage) || "NEW";
          const followUp = row.nextFollowUpAt ? new Date(row.nextFollowUpAt) : null;
          const overdue = followUp ? followUp < today : false;
          return (
            <TableRow key={row.id} className={pending ? "opacity-70" : undefined}>
              <TableCell>
                <Link href={`/customers/${row.id}`} className="font-medium text-slate-900 hover:underline">
                  {row.name}
                </Link>
                {row.industry && <div className="text-xs text-slate-500">{row.industry}</div>}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center gap-1" disabled={pending}>
                      <Badge variant={STAGE_BADGE_VARIANT[stage]}>{STAGE_LABELS[stage]}</Badge>
                      <ChevronDown className="h-3 w-3 text-slate-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
                    {PROSPECT_STAGES.map((s) => (
                      <DropdownMenuItem key={s} onClick={() => handleStageChange(row, s)} disabled={s === stage}>
                        {STAGE_LABELS[s]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
              <TableCell className="text-slate-500">
                {row.estimatedMonthlyValue ? formatCurrency(row.estimatedMonthlyValue) : "—"}
              </TableCell>
              <TableCell className={overdue ? "font-medium text-red-600" : "text-slate-500"}>
                {followUp ? formatDate(followUp) : "—"}
              </TableCell>
              <TableCell className="text-slate-500">{row.source || "—"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={pending}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleConvert(row, "ACTIVE")}>
                      <UserCheck className="h-4 w-4" /> Convert to Customer
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleConvert(row, "LEAD")}>
                      <ArrowRight className="h-4 w-4" /> Convert to Lead
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={`/customers/${row.id}`}>View details</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-slate-500">
              No prospects yet. Add one or import a spreadsheet to get started.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

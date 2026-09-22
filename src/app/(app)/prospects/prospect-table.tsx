"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
import { ChevronDown, ChevronUp, ArrowUpDown, MoreHorizontal, ArrowRight, UserCheck, UserPlus, Phone, MapPin } from "lucide-react";
import { formatCurrency, formatDate, formatAddressLine } from "@/lib/utils";
import { PROSPECT_STAGES, STAGE_LABELS, STAGE_BADGE_VARIANT, confidenceBadgeVariant, type ProspectStage } from "@/lib/prospect";
import { updateProspectStage, convertProspectStatus, assignProspectOwner } from "@/server/actions/customers";

export type ProspectRow = {
  id: string;
  name: string;
  stage: string | null;
  estimatedMonthlyValue: string | null;
  nextFollowUpAt: Date | string | null;
  source: string | null;
  industry: string | null;
  phone: string | null;
  billingStreet: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  researchConfidence: string | null;
  accountOwnerId: string | null;
  ownerName: string | null;
};

export type StaffOption = { id: string; name: string };

export function ProspectTable({ rows, staff, hasFilters }: { rows: ProspectRow[]; staff: StaffOption[]; hasFilters: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentSort = searchParams.get("sort");
  const currentDir = searchParams.get("dir");

  // Toggles: clicking an unsorted column sorts High→Low first (desc);
  // clicking it again flips to Low→High. Preserves every other filter
  // already in the URL rather than resetting them.
  function sortHref(column: "confidence") {
    const params = new URLSearchParams(searchParams.toString());
    const nextDir = currentSort === column && currentDir === "desc" ? "asc" : "desc";
    params.set("sort", column);
    params.set("dir", nextDir);
    return `${pathname}?${params.toString()}`;
  }

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

  function handleAssign(row: ProspectRow, ownerId: string | null, ownerName: string | null) {
    startTransition(async () => {
      await assignProspectOwner(row.id, ownerId);
      toast.success(ownerId ? `Assigned to ${ownerName}` : `Unassigned ${row.name}`);
      router.refresh();
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
          <TableHead>
            <Link href={sortHref("confidence")} className="inline-flex items-center gap-1 hover:underline">
              Confidence
              {currentSort === "confidence" ? (
                currentDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
              ) : (
                <ArrowUpDown className="h-3 w-3 text-slate-400" />
              )}
            </Link>
          </TableHead>
          <TableHead>Assigned to</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const stage = (row.stage as ProspectStage) || "NEW";
          const followUp = row.nextFollowUpAt ? new Date(row.nextFollowUpAt) : null;
          const overdue = followUp ? followUp < today : false;
          const addressLine = formatAddressLine(row);
          return (
            <TableRow key={row.id} className={pending ? "opacity-70" : undefined}>
              <TableCell>
                <Link href={`/customers/${row.id}`} className="font-medium text-slate-900 hover:underline">
                  {row.name}
                </Link>
                {row.industry && <div className="text-xs text-slate-500">{row.industry}</div>}
                {row.phone && (
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <Phone className="h-3 w-3" /> {row.phone}
                  </div>
                )}
                {addressLine && (
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <MapPin className="h-3 w-3" /> {addressLine}
                  </div>
                )}
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
                {row.researchConfidence ? (
                  <Badge variant={confidenceBadgeVariant(row.researchConfidence)}>{row.researchConfidence}</Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center gap-1 text-sm" disabled={pending}>
                      {row.ownerName ? (
                        <span className="text-slate-700">{row.ownerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <UserPlus className="h-3.5 w-3.5" /> Unassigned
                        </span>
                      )}
                      <ChevronDown className="h-3 w-3 text-slate-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleAssign(row, null, null)} disabled={!row.accountOwnerId}>
                      Unassigned
                    </DropdownMenuItem>
                    {staff.map((s) => (
                      <DropdownMenuItem key={s.id} onClick={() => handleAssign(row, s.id, s.name)} disabled={s.id === row.accountOwnerId}>
                        {s.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
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
            <TableCell colSpan={8} className="py-8 text-center text-slate-500">
              {hasFilters ? "No prospects match these filters." : "No prospects yet. Add one or import a spreadsheet to get started."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

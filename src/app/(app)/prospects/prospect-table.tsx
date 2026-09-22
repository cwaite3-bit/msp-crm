"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  MoreHorizontal,
  ArrowRight,
  UserCheck,
  UserPlus,
  Phone,
  MapPin,
  Map as MapIcon,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { formatCurrency, formatDate, formatAddressLine, googleMapsSearchUrl, googleMapsDirectionsUrl } from "@/lib/utils";
import { PROSPECT_STAGES, STAGE_LABELS, STAGE_BADGE_VARIANT, confidenceBadgeVariant, type ProspectStage } from "@/lib/prospect";
import {
  updateProspectStage,
  convertProspectStatus,
  assignProspectOwner,
  archiveCustomer,
  unarchiveCustomer,
} from "@/server/actions/customers";

// Google Maps' free directions URL supports at most 9 waypoints plus a
// destination (10 addressed stops) when no origin is given — it falls back
// to the visitor's current location as the starting point, which is exactly
// what "plan today's visits" wants.
const MAX_MAP_STOPS = 10;

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
  archivedAt: Date | string | null;
};

export type StaffOption = { id: string; name: string };

// What to hand Google as the location text for one prospect — the street
// address when we have one, falling back to city/state, and the company
// name folded in so a bare "123 Main St" resolves to the right business
// rather than just the nearest point on the map.
function mapQuery(row: ProspectRow): string | null {
  const address = formatAddressLine(row);
  const location = address || [row.billingCity, row.billingState].filter(Boolean).join(", ");
  if (!location) return null;
  return `${row.name}, ${location}`;
}

// The row-level interactive bits (stage/owner dropdowns, the "..." actions
// menu) are shared verbatim between the desktop table row and the mobile
// card below — factored out here so the two layouts can't quietly drift
// apart from each other as they get edited over time.

function StageMenu({
  row,
  pending,
  onChange,
}: {
  row: ProspectRow;
  pending: boolean;
  onChange: (row: ProspectRow, stage: ProspectStage) => void;
}) {
  const stage = (row.stage as ProspectStage) || "NEW";
  return (
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
          <DropdownMenuItem key={s} onClick={() => onChange(row, s)} disabled={s === stage}>
            {STAGE_LABELS[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OwnerMenu({
  row,
  staff,
  pending,
  onChange,
}: {
  row: ProspectRow;
  staff: StaffOption[];
  pending: boolean;
  onChange: (row: ProspectRow, ownerId: string | null, ownerName: string | null) => void;
}) {
  return (
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
        <DropdownMenuItem onClick={() => onChange(row, null, null)} disabled={!row.accountOwnerId}>
          Unassigned
        </DropdownMenuItem>
        {staff.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => onChange(row, s.id, s.name)} disabled={s.id === row.accountOwnerId}>
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({
  row,
  pending,
  showArchived,
  onConvert,
  onArchive,
  onUnarchive,
}: {
  row: ProspectRow;
  pending: boolean;
  showArchived: boolean;
  onConvert: (row: ProspectRow, target: "LEAD" | "ACTIVE") => void;
  onArchive: (row: ProspectRow) => void;
  onUnarchive: (row: ProspectRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showArchived ? (
          <DropdownMenuItem onClick={() => onUnarchive(row)}>
            <ArchiveRestore className="h-4 w-4" /> Restore
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => onConvert(row, "ACTIVE")}>
              <UserCheck className="h-4 w-4" /> Convert to Customer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onConvert(row, "LEAD")}>
              <ArrowRight className="h-4 w-4" /> Convert to Lead
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onArchive(row)}>
              <Archive className="h-4 w-4" /> Archive
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/customers/${row.id}`}>View details</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NameBlock({ row }: { row: ProspectRow }) {
  const addressLine = formatAddressLine(row);
  const query = mapQuery(row);
  return (
    <div>
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
          {query && (
            <a
              href={googleMapsSearchUrl(query)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-slate-400 underline hover:text-slate-600"
            >
              Map it
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function ProspectTable({
  rows,
  staff,
  hasFilters,
  showArchived = false,
}: {
  rows: ProspectRow[];
  staff: StaffOption[];
  hasFilters: boolean;
  showArchived?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mappableRows = useMemo(() => rows.filter((r) => mapQuery(r)), [rows]);
  const allMappableSelected = mappableRows.length > 0 && mappableRows.every((r) => selected.has(r.id));

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(mappableRows.map((r) => r.id)) : new Set());
  }

  function handleMapRoute() {
    let selectedRows = rows.filter((r) => selected.has(r.id) && mapQuery(r));
    if (selectedRows.length > MAX_MAP_STOPS) {
      toast.warning(`Google Maps allows ${MAX_MAP_STOPS} stops at once — mapping the first ${MAX_MAP_STOPS} selected.`);
      selectedRows = selectedRows.slice(0, MAX_MAP_STOPS);
    }
    const queries = selectedRows.map((r) => mapQuery(r)!);
    if (queries.length === 1) {
      window.open(googleMapsSearchUrl(queries[0]), "_blank", "noopener");
    } else {
      window.open(googleMapsDirectionsUrl(queries), "_blank", "noopener");
    }
  }

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

  // Archiving is reversible (see archiveCustomer), so this is a light
  // heads-up rather than the harder confirmation a real delete would need —
  // it still asks, since it's a click buried in a dropdown menu.
  function handleArchive(row: ProspectRow) {
    if (!window.confirm(`Archive "${row.name}"? It'll disappear from the Prospects list, but you can restore it anytime from Archived.`)) {
      return;
    }
    startTransition(async () => {
      await archiveCustomer(row.id);
      toast.success(`${row.name} archived`);
      router.refresh();
    });
  }

  function handleUnarchive(row: ProspectRow) {
    startTransition(async () => {
      await unarchiveCustomer(row.id);
      toast.success(`${row.name} restored`);
      router.refresh();
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const emptyMessage = hasFilters
    ? "No prospects match these filters."
    : "No prospects yet. Add one or import a spreadsheet to get started.";

  return (
    <div>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <span className="text-sm text-slate-600">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={handleMapRoute}>
              <MapIcon className="h-4 w-4" /> Map route
            </Button>
          </div>
        </div>
      )}

      {/* Desktop / tablet: the full table, sm breakpoint and up. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allMappableSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  disabled={mappableRows.length === 0}
                  aria-label="Select all mappable prospects"
                />
              </TableHead>
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
              const followUp = row.nextFollowUpAt ? new Date(row.nextFollowUpAt) : null;
              const overdue = followUp ? followUp < today : false;
              const query = mapQuery(row);
              return (
                <TableRow key={row.id} className={pending ? "opacity-70" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                      disabled={!query}
                      aria-label={`Select ${row.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <NameBlock row={row} />
                  </TableCell>
                  <TableCell>
                    <StageMenu row={row} pending={pending} onChange={handleStageChange} />
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
                    <OwnerMenu row={row} staff={staff} pending={pending} onChange={handleAssign} />
                  </TableCell>
                  <TableCell>
                    <RowMenu
                      row={row}
                      pending={pending}
                      showArchived={showArchived}
                      onConvert={handleConvert}
                      onArchive={handleArchive}
                      onUnarchive={handleUnarchive}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Phone: a stacked card per prospect instead of a horizontally-
          scrolling table — every field that matters fits without sideways
          scrolling, and the two dropdowns / actions menu are the exact same
          components as the desktop table's, just laid out vertically. */}
      <div className="divide-y divide-slate-100 sm:hidden">
        {rows.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-500">
            <Checkbox
              checked={allMappableSelected}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              disabled={mappableRows.length === 0}
              aria-label="Select all mappable prospects"
            />
            Select all
          </div>
        )}
        {rows.map((row) => {
          const followUp = row.nextFollowUpAt ? new Date(row.nextFollowUpAt) : null;
          const overdue = followUp ? followUp < today : false;
          const query = mapQuery(row);
          return (
            <div key={row.id} className={`flex flex-col gap-3 p-4 ${pending ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                    disabled={!query}
                    aria-label={`Select ${row.name}`}
                    className="mt-1"
                  />
                  <NameBlock row={row} />
                </div>
                <RowMenu
                  row={row}
                  pending={pending}
                  showArchived={showArchived}
                  onConvert={handleConvert}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 text-sm">
                <StageMenu row={row} pending={pending} onChange={handleStageChange} />
                {row.researchConfidence ? (
                  <Badge variant={confidenceBadgeVariant(row.researchConfidence)}>{row.researchConfidence}</Badge>
                ) : null}
                <OwnerMenu row={row} staff={staff} pending={pending} onChange={handleAssign} />
              </div>

              {(row.estimatedMonthlyValue || followUp || row.source) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 pl-8 text-xs text-slate-500">
                  {row.estimatedMonthlyValue && <span>{formatCurrency(row.estimatedMonthlyValue)}/mo</span>}
                  {followUp && (
                    <span className={overdue ? "font-medium text-red-600" : undefined}>
                      Follow up {formatDate(followUp)}
                    </span>
                  )}
                  {row.source && <span>Source: {row.source}</span>}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <div className="py-8 text-center text-sm text-slate-500">{emptyMessage}</div>}
      </div>
    </div>
  );
}

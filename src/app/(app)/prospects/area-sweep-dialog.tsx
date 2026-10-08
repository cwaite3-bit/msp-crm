"use client";

// Prospects → "Area sweep": an address + a ring (e.g. 10–20 mi) → Claude
// finds qualified businesses in each search area → staff tick the ones they
// want → Import. See src/server/actions/area-sweep.ts for how each step
// works server-side, and src/server/area-sweep.ts for the pure logic.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Loader2,
  MapPin,
  Play,
  Radar,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  deleteAreaSweep,
  getAreaSweep,
  getSweepReview,
  importSweepCandidates,
  listAreaSweeps,
  startAreaSweep,
  type SweepCandidateView,
  type SweepSummary,
} from "@/server/actions/area-sweep";
import type { RunAreaResult, SweepAreaView, SweepView } from "@/server/area-sweep-runner";
import {
  DEFAULT_SWEEP_OPTIONS,
  MAX_OUTER_MILES,
  PARALLEL_AREAS,
  RADIUS_PRESETS,
  estimateSweep,
  normalizeSweepOptions,
  planSearchAreas,
  ringLabel,
  type SweepOptions,
} from "@/server/area-sweep";
import { confidenceBadgeVariant } from "@/lib/prospect";
import { googleMapsSearchUrl, formatDate } from "@/lib/utils";

type Step = "home" | "setup" | "running" | "review";
const TERRITORY = "__territory__";
const UNASSIGNED = "unassigned";

const INNER_CHOICES = [0, ...RADIUS_PRESETS];

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 });
}

export function AreaSweepDialog({ staff }: { staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("home");
  const [error, setError] = useState<string | null>(null);

  // Home
  const [history, setHistory] = useState<SweepSummary[] | null>(null);

  // Setup
  const [address, setAddress] = useState("");
  const [options, setOptions] = useState<SweepOptions>(DEFAULT_SWEEP_OPTIONS);
  const [useCoords, setUseCoords] = useState(false);
  const [coords, setCoords] = useState("");
  const [starting, setStarting] = useState(false);

  // Running
  const [sweep, setSweep] = useState<SweepView | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const runToken = useRef(0);

  // Review
  const [candidates, setCandidates] = useState<SweepCandidateView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [owner, setOwner] = useState<string>(TERRITORY);
  const [importing, setImporting] = useState(false);

  const normalized = useMemo(() => normalizeSweepOptions(options), [options]);
  const preview = useMemo(() => {
    if ("error" in normalized) return null;
    // Area count doesn't depend on where the center is, only on the ring.
    const n = planSearchAreas({ lat: 33, lng: -111 }, normalized.innerMiles, normalized.outerMiles).length;
    return estimateSweep(n, normalized.perAreaTarget);
  }, [normalized]);

  async function refreshHistory() {
    try {
      setHistory(await listAreaSweeps());
    } catch {
      setHistory([]);
    }
  }

  function goHome() {
    setError(null);
    setStep("home");
    setHistory(null);
    void refreshHistory();
  }

  function resetAll() {
    stopRef.current = true;
    runToken.current++;
    setStep("home");
    setError(null);
    setSweep(null);
    setRunning(false);
    setCandidates(null);
    setSelected(new Set());
    setExpanded(null);
    setShowAll(false);
    setStarting(false);
    setImporting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next && running && !confirm("Searches already running will finish in the background; the rest pause until you resume. Close?")) {
      return;
    }
    setOpen(next);
    if (!next) resetAll();
    else goHome();
  }

  function newSweep(prefill?: { address: string; inner: number; outer: number; options?: SweepOptions }) {
    setError(null);
    if (prefill) {
      setAddress(prefill.address);
      setOptions({ ...(prefill.options ?? options), innerMiles: prefill.inner, outerMiles: prefill.outer });
    }
    setStep("setup");
  }

  // ---- Running the search areas ----

  async function runAreas(target: SweepView, retryFailed: boolean) {
    const token = ++runToken.current;
    stopRef.current = false;
    setRunning(true);
    setError(null);
    const queue = target.areas.filter((a) => a.status === "PENDING" || (retryFailed && a.status === "FAILED")).map((a) => a.index);

    const update = (area: SweepAreaView) =>
      setSweep((prev) => (prev ? { ...prev, areas: prev.areas.map((a) => (a.index === area.index ? area : a)) } : prev));

    const worker = async () => {
      while (queue.length && !stopRef.current && token === runToken.current) {
        const index = queue.shift()!;
        setSweep((prev) =>
          prev ? { ...prev, areas: prev.areas.map((a) => (a.index === index ? { ...a, status: "RUNNING", error: null } : a)) } : prev
        );
        let res: RunAreaResult | null = null;
        try {
          const response = await fetch(`/api/prospects/sweeps/${encodeURIComponent(target.id)}/areas/${index}`, {
            method: "POST",
          });
          res = (await response.json().catch(() => null)) as RunAreaResult | null;
        } catch {
          res = null;
        }
        if (token !== runToken.current) return;
        if (res?.ok) update(res.area);
        else if (res && !res.ok && res.status !== 500) {
          // Not configured / sweep deleted / not logged in — no point going on.
          setError(res.error);
          stopRef.current = true;
        } else {
          // Dropped connection or a platform timeout: the server may still
          // have saved this area, so read back what it actually has.
          const fresh = await getAreaSweep(target.id).catch(() => null);
          const area = fresh?.ok ? fresh.sweep.areas.find((a) => a.index === index) : undefined;
          if (token !== runToken.current) return;
          if (area) update(area);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_AREAS }, worker));
    if (token !== runToken.current) return;
    setRunning(false);
    const fresh = await getAreaSweep(target.id).catch(() => null);
    if (fresh?.ok && token === runToken.current) setSweep(fresh.sweep);
  }

  async function handleStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if ("error" in normalized) return;
    let manualLat: number | null = null;
    let manualLng: number | null = null;
    if (useCoords) {
      const parts = coords.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
      if (parts.length !== 2) {
        setError("Paste coordinates as “latitude, longitude”, e.g. 33.2487, -111.6343.");
        return;
      }
      [manualLat, manualLng] = parts;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await startAreaSweep({ address, manualLat, manualLng, options: normalized });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSweep(res.sweep);
      setStep("running");
      void runAreas(res.sweep, false);
    } catch {
      setError("Couldn't start the sweep — check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  async function openSweep(id: string, then: "running" | "review") {
    setError(null);
    const res = await getAreaSweep(id).catch(() => null);
    if (!res?.ok) {
      setError(res ? res.error : "Couldn't load that sweep.");
      return;
    }
    setSweep(res.sweep);
    if (then === "review") await loadReview(res.sweep);
    else setStep("running");
  }

  async function handleDelete(s: SweepSummary) {
    const extra = s.importedCount ? ` The ${s.importedCount} prospects it already imported stay.` : "";
    if (!confirm(`Delete this sweep and its un-imported results?${extra}`)) return;
    await deleteAreaSweep(s.id);
    void refreshHistory();
  }

  // ---- Review + import ----

  const defaultPick = (c: SweepCandidateView) =>
    !c.importedCustomerId && c.inRing && c.geocodeStatus === "verified" && c.duplicates.length === 0;

  async function loadReview(target: SweepView) {
    setError(null);
    const res = await getSweepReview(target.id).catch(() => null);
    if (!res?.ok) {
      setError(res ? res.error : "Couldn't load the results.");
      return;
    }
    setCandidates(res.candidates);
    setSelected(new Set(res.candidates.filter(defaultPick).map((c) => c.id)));
    setStep("review");
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const visible = useMemo(
    () => (candidates ?? []).filter((c) => showAll || (c.inRing && c.geocodeStatus === "verified" && !c.duplicates.length && !c.importedCustomerId)),
    [candidates, showAll]
  );
  const hiddenCount = (candidates?.length ?? 0) - visible.length;
  const visibleIds = useMemo(() => new Set(visible.map((c) => c.id)), [visible]);
  const hiddenSelected = [...selected].filter((id) => !visibleIds.has(id)).length;

  async function handleImport() {
    if (!sweep || !candidates) return;
    const ids = candidates.filter((c) => selected.has(c.id) && !c.importedCustomerId).map((c) => c.id);
    if (!ids.length) return;
    const allowDuplicateIds = candidates.filter((c) => ids.includes(c.id) && c.duplicates.length).map((c) => c.id);
    setImporting(true);
    setError(null);
    try {
      const ownerChoice =
        owner === TERRITORY
          ? ({ mode: "territory" } as const)
          : owner === UNASSIGNED
            ? ({ mode: "unassigned" } as const)
            : ({ mode: "staff", ownerId: owner } as const);
      let imported = 0;
      const skipped: { name: string; reason: string }[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const res = await importSweepCandidates({
          sweepId: sweep.id,
          candidateIds: batch,
          allowDuplicateIds: allowDuplicateIds.filter((id) => batch.includes(id)),
          owner: ownerChoice,
        });
        if (!res.ok) {
          setError(imported ? `${res.error} (${imported} were already imported before this.)` : res.error);
          return;
        }
        imported += res.imported;
        skipped.push(...res.skipped);
      }
      toast.success(
        `Imported ${imported} prospect${imported === 1 ? "" : "s"}` +
          (skipped.length ? ` · ${skipped.length} skipped (${skipped[0].name}: ${skipped[0].reason}${skipped.length > 1 ? "…" : ""})` : "")
      );
      const id = sweep.id;
      setOpen(false);
      resetAll();
      router.push(`/prospects?sweep=${encodeURIComponent(id)}`);
    } catch {
      setError("The import request failed — nothing after the failure was saved. Try again.");
    } finally {
      setImporting(false);
    }
  }

  // ---- Render ----

  const areas = sweep?.areas ?? [];
  const doneCount = areas.filter((a) => a.status === "DONE").length;
  const failedCount = areas.filter((a) => a.status === "FAILED").length;
  const pendingCount = areas.filter((a) => a.status === "PENDING").length;
  const runningCount = areas.filter((a) => a.status === "RUNNING").length;
  const foundTotal = areas.reduce((s, a) => s + a.foundCount, 0);
  const searchesUsed = areas.reduce((s, a) => s + (a.usage?.webSearches ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" title="Area sweep">
          <Radar /> <span className="hidden sm:inline">Area sweep</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Area sweep</DialogTitle>
          <DialogDescription>
            {step === "review"
              ? "Tick the businesses you want, choose who they're assigned to, then import. Nothing is added until you click Import."
              : "Find qualified businesses within a ring around an address. Every result is placed on the map by the app, checked against the CRM, and waits for your approval."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------- Home: past sweeps ---------------- */}
        {step === "home" && (
          <div className="flex flex-col gap-4">
            {history === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading past sweeps…
              </div>
            ) : history.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                No sweeps yet. Start one below — the next ring out is one click after that.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
                {history.map((s) => {
                  const width = s.outerMiles - s.innerMiles;
                  const unfinished = s.areasDone < s.areasTotal;
                  return (
                    <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{s.centerAddress}</div>
                        <div className="text-xs text-slate-500">
                          {ringLabel(s.innerMiles, s.outerMiles)} · {formatDate(s.createdAt)}
                          {s.createdByName ? ` · ${s.createdByName}` : ""} · {s.areasDone}/{s.areasTotal} areas · {s.candidateCount} found ·{" "}
                          {s.importedCount} imported
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {unfinished && (
                          <Button size="sm" variant="outline" onClick={() => openSweep(s.id, "running")}>
                            <Play /> Resume
                          </Button>
                        )}
                        {s.candidateCount > 0 && (
                          <Button size="sm" variant="outline" onClick={() => openSweep(s.id, "review")}>
                            Review
                          </Button>
                        )}
                        {s.importedCount > 0 && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/prospects?sweep=${encodeURIComponent(s.id)}`} onClick={() => handleOpenChange(false)}>
                              Imported
                            </Link>
                          </Button>
                        )}
                        {s.outerMiles < MAX_OUTER_MILES && (
                          <Button
                            size="sm"
                            title={`Sweep ${s.outerMiles}–${Math.min(MAX_OUTER_MILES, s.outerMiles + width)} mi around the same address`}
                            onClick={() =>
                              newSweep({
                                address: s.centerAddress,
                                inner: s.outerMiles,
                                outer: Math.min(MAX_OUTER_MILES, s.outerMiles + width),
                                options: s.options,
                              })
                            }
                          >
                            Next ring <ChevronRight />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" title="Delete sweep" onClick={() => handleDelete(s)} className="h-8 w-8">
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={() => newSweep()}>
                <Radar /> New sweep
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ---------------- Setup ---------------- */}
        {step === "setup" && (
          <form onSubmit={handleStart} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="as-address">Center address *</Label>
              <Input
                id="as-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 22424 E Ellsworth Loop Rd, Queen Creek, AZ 85142"
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="as-inner">From (miles)</Label>
                <Select
                  value={String(options.innerMiles)}
                  onValueChange={(v) => setOptions({ ...options, innerMiles: Number(v) })}
                >
                  <SelectTrigger id="as-inner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...INNER_CHOICES, options.innerMiles]
                      .filter((m, i, all) => all.indexOf(m) === i)
                      .sort((a, b) => a - b)
                      .map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m === 0 ? "0 (the address)" : `${m} mi`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="as-outer">To (miles)</Label>
                <Select
                  value={String(options.outerMiles)}
                  onValueChange={(v) => setOptions({ ...options, outerMiles: Number(v) })}
                >
                  <SelectTrigger id="as-outer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...RADIUS_PRESETS, 60, 75, options.outerMiles]
                      .filter((m, i, all) => all.indexOf(m) === i)
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m} mi
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="as-per">Businesses per area</Label>
                <Input
                  id="as-per"
                  type="number"
                  min={3}
                  max={20}
                  value={options.perAreaTarget}
                  onChange={(e) => setOptions({ ...options, perAreaTarget: Number(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Employees</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    aria-label="Minimum employees"
                    type="number"
                    min={0}
                    value={options.minEmployees}
                    onChange={(e) => setOptions({ ...options, minEmployees: Number(e.target.value) })}
                  />
                  <span className="text-slate-400">–</span>
                  <Input
                    aria-label="Maximum employees"
                    type="number"
                    min={1}
                    value={options.maxEmployees}
                    onChange={(e) => setOptions({ ...options, maxEmployees: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="as-focus">Industry focus (optional)</Label>
              <Textarea
                id="as-focus"
                rows={2}
                value={options.industryFocus}
                onChange={(e) => setOptions({ ...options, industryFocus: e.target.value })}
                placeholder="Leave blank for any MSP-fit industry — or e.g. dental and medical practices, law firms, CPAs, manufacturers"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="as-chains"
                  checked={options.excludeChains}
                  onCheckedChange={(v) => setOptions({ ...options, excludeChains: v === true })}
                />
                <Label htmlFor="as-chains" className="cursor-pointer font-normal">
                  Skip chains and franchise locations
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="as-coords" checked={useCoords} onCheckedChange={(v) => setUseCoords(v === true)} />
                <Label htmlFor="as-coords" className="cursor-pointer font-normal">
                  Use exact coordinates for the center
                </Label>
              </div>
            </div>
            {useCoords && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="as-latlng">Latitude, longitude</Label>
                <Input id="as-latlng" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="33.2487, -111.6343" />
                <p className="text-xs text-slate-500">
                  In Google Maps, right-click the spot and click the numbers at the top of the menu to copy them.
                </p>
              </div>
            )}

            {"error" in normalized ? (
              <p className="text-sm text-red-700">{normalized.error}</p>
            ) : (
              preview && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">
                    {ringLabel(normalized.innerMiles, normalized.outerMiles)} → {preview.areas} search area{preview.areas === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-slate-600">
                    Up to ~{preview.maxBusinesses} businesses · up to {preview.maxWebSearches} web searches · roughly{" "}
                    {money(preview.costLow)}–{money(preview.costHigh)} in Anthropic usage · about {preview.minutes} min. You can close this
                    window and resume later.
                  </div>
                </div>
              )
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={goHome} disabled={starting}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" disabled={starting || !address.trim() || "error" in normalized}>
                {starting ? <Loader2 className="animate-spin" /> : <Radar />} Start sweep
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ---------------- Running ---------------- */}
        {step === "running" && sweep && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm">
              <div className="font-medium text-slate-900">
                {ringLabel(sweep.innerMiles, sweep.outerMiles)} around {sweep.centerAddress}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <a
                  href={googleMapsSearchUrl(`${sweep.center.lat},${sweep.center.lng}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  <MapPin className="h-3 w-3" /> Check center on map
                </a>
                {sweep.centerMatched && <span>Matched: {sweep.centerMatched}</span>}
              </div>
              {sweep.centerQuality === "approximate" && (
                <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The exact address wasn&rsquo;t on the map, so this sweep is centered on the nearest match (the street, town or ZIP).
                  Check it on the map — if it&rsquo;s too far off, stop, delete this sweep, and start again with “Use exact coordinates”.
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>
                  {doneCount} of {areas.length} areas done · {foundTotal} businesses found
                  {searchesUsed ? ` · ${searchesUsed} web searches used` : ""}
                </span>
                {failedCount > 0 && <span className="text-red-700">{failedCount} failed</span>}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${areas.length ? (doneCount / areas.length) * 100 : 0}%` }} />
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {areas.map((a) => (
                <li key={a.index} className="flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                  {a.status === "DONE" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : a.status === "RUNNING" ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
                  ) : a.status === "FAILED" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                  )}
                  <div className="min-w-0">
                    <div className="text-slate-800">
                      {a.direction} · {a.innerMiles}–{a.outerMiles} mi
                      {a.placeHint ? <span className="text-slate-500"> · {a.placeHint.replace(/^near /, "")}</span> : null}
                      {a.status === "DONE" ? <span className="text-slate-500"> · {a.foundCount} found</span> : null}
                    </div>
                    {a.status === "FAILED" && a.error && <div className="text-red-700">{a.error}</div>}
                  </div>
                </li>
              ))}
            </ul>

            <DialogFooter className="flex-wrap">
              <Button type="button" variant="outline" onClick={goHome} disabled={running}>
                <ArrowLeft /> All sweeps
              </Button>
              {running ? (
                <Button type="button" variant="outline" onClick={() => (stopRef.current = true)}>
                  <Square /> Stop after current areas
                </Button>
              ) : (
                (pendingCount > 0 || failedCount > 0) && (
                  <Button type="button" variant="outline" onClick={() => runAreas(sweep, true)}>
                    {pendingCount > 0 ? <Play /> : <RotateCcw />}
                    {pendingCount > 0 ? "Resume" : "Retry failed"}
                  </Button>
                )
              )}
              {!running && runningCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const fresh = await getAreaSweep(sweep.id).catch(() => null);
                    if (fresh?.ok) setSweep(fresh.sweep);
                  }}
                >
                  <RotateCcw /> Refresh
                </Button>
              )}
              <Button type="button" onClick={() => loadReview(sweep)} disabled={doneCount === 0}>
                Review {foundTotal} result{foundTotal === 1 ? "" : "s"} <ChevronRight />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ---------------- Review ---------------- */}
        {step === "review" && sweep && candidates && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">{selected.size}</span> of {candidates.length} selected
                {hiddenSelected > 0 ? ` (${hiddenSelected} hidden by the filter)` : ""} ·{" "}
                {ringLabel(sweep.innerMiles, sweep.outerMiles)} around {sweep.centerAddress}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set(candidates.filter(defaultPick).map((c) => c.id)))}>
                  Select recommended
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>

            {hiddenCount > 0 && (
              <button
                type="button"
                className="self-start text-xs text-slate-600 underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? "Hide already-in-CRM, imported, and unverified-location results"
                  : `Show ${hiddenCount} more (already in the CRM, already imported, or location couldn't be verified)`}
              </button>
            )}

            {visible.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Nothing new to review{hiddenCount ? " — everything found is hidden by the filter above" : ""}.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
                {visible.map((c) => {
                  const r = c.record;
                  const imported = !!c.importedCustomerId;
                  const location = [r.address, r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
                  return (
                    <li key={c.id} className={`flex gap-3 p-3 ${imported ? "opacity-60" : ""}`}>
                      <Checkbox
                        className="mt-0.5"
                        aria-label={`Import ${r.companyName}`}
                        checked={selected.has(c.id)}
                        disabled={imported}
                        onCheckedChange={(v) => toggle(c.id, v === true)}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="text-left text-sm font-medium text-slate-900 hover:underline"
                            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                          >
                            {r.companyName}
                          </button>
                          {r.confidence && <Badge variant={confidenceBadgeVariant(r.confidence)}>{r.confidence}</Badge>}
                          {c.distanceMiles !== null ? (
                            <Badge variant="outline">
                              {c.distanceMiles.toFixed(1)} mi {c.direction}
                            </Badge>
                          ) : (
                            <Badge variant="warning">Location not verified</Badge>
                          )}
                          {imported && <Badge variant="success">Imported</Badge>}
                        </div>
                        <div className="text-xs text-slate-600">
                          {[r.industry, r.employeeEstimate && `${r.employeeEstimate} employees`].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          <a href={googleMapsSearchUrl(location)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {location}
                          </a>
                          {r.mainPhone && <span>{r.mainPhone}</span>}
                          {r.publicEmail && <span>{r.publicEmail}</span>}
                          {r.website && (
                            <a href={r.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                              website <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {c.emailProvider && <span>Email: {c.emailProvider}</span>}
                        </div>
                        {c.duplicates.length > 0 && (
                          <div className="text-xs text-amber-800">
                            May already be in the CRM:{" "}
                            {c.duplicates.map((d, i) => (
                              <span key={d.id}>
                                {i > 0 ? ", " : ""}
                                <Link href={`/customers/${d.id}`} target="_blank" className="underline">
                                  {d.name}
                                </Link>
                              </span>
                            ))}{" "}
                            — ticking it imports it anyway.
                          </div>
                        )}
                        {expanded === c.id && (
                          <div className="mt-1 flex flex-col gap-1 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                            {r.qualificationNotes && <p>{r.qualificationNotes}</p>}
                            {(r.decisionMaker || r.decisionMakerTitle) && (
                              <p>Decision maker: {[r.decisionMaker, r.decisionMakerTitle].filter(Boolean).join(" — ")}</p>
                            )}
                            {r.existingItProvider && <p>Current IT provider: {r.existingItProvider}</p>}
                            {r.complianceFrameworks.length > 0 && <p>Compliance: {r.complianceFrameworks.join(", ")}</p>}
                            {r.talkingPoints.length > 0 && (
                              <ul className="list-disc pl-4">
                                {r.talkingPoints.map((t, i) => (
                                  <li key={i}>{t}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-100 bg-white pt-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1.5 sm:w-64">
                <Label htmlFor="as-owner">Assign to</Label>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger id="as-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TERRITORY}>By state (Assign by state rules)</SelectItem>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("running")} disabled={importing}>
                  <ArrowLeft /> Search areas
                </Button>
                <Button type="button" onClick={handleImport} disabled={importing || selected.size === 0}>
                  {importing && <Loader2 className="animate-spin" />}
                  Import {selected.size} as prospect{selected.size === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

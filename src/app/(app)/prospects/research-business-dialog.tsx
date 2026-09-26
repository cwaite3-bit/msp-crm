"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sparkles, Loader2, AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import { researchBusiness, saveResearchedProspect } from "@/server/actions/prospect-research";
import type { DuplicateMatch, ResearchLookupInput, ResearchRecord, ResearchResult } from "@/server/prospect-research";

const UNASSIGNED = "unassigned"; // same sentinel the Prospects owner filter uses
const NO_CONFIDENCE = "__none__"; // Radix Select can't use "" as an item value

type Step = "lookup" | "researching" | "review";

const EMPTY_LOOKUP: ResearchLookupInput = { name: "", city: "", state: "", website: "", knownInfo: "" };

// Editable subset of the record shown on the review step — everything that
// lands in a real customers/contacts column. The rest of the research
// (signals, talking points, sources…) is shown read-only and goes into the
// activity note + customers.research as returned.
type EditableField =
  | "companyName"
  | "address"
  | "city"
  | "state"
  | "zip"
  | "industry"
  | "mainPhone"
  | "website"
  | "publicEmail"
  | "decisionMaker"
  | "decisionMakerTitle";

const REASON_LABEL: Record<DuplicateMatch["reasons"][number], string> = {
  name: "same name",
  website: "same website",
  phone: "same phone",
};

function Findings({ result }: { result: ResearchResult }) {
  const r = result.record;
  const lines: [string, string][] = [];
  if (result.emailProvider) lines.push(["Email provider", `${result.emailProvider.provider} (${result.emailProvider.domain})`]);
  if (r.existingItProvider) lines.push(["Existing IT provider", r.existingItProvider]);
  if (r.employeeEstimate) lines.push(["Employees", r.employeeEstimate]);
  if (r.complianceFrameworks.length) lines.push(["Compliance", r.complianceFrameworks.join(", ")]);
  if (r.ownershipType) lines.push(["Ownership", r.ownershipType]);
  if (r.locationCount !== null) lines.push(["Locations", String(r.locationCount)]);
  if (r.googleRating !== null) {
    lines.push(["Google", `${r.googleRating}★${r.googleReviewCount !== null ? ` · ${r.googleReviewCount} reviews` : ""}`]);
  }
  if (r.additionalContacts.length) {
    lines.push(["Other contacts", r.additionalContacts.map((c) => [c.name, c.title].filter(Boolean).join(" — ")).join("; ")]);
  }

  const lists: [string, string[]][] = [
    ["Talking points", r.talkingPoints],
    ["Business / IT signals", r.businessItSignals],
    ["Security / complexity signals", r.securityComplexitySignals],
    ["IT hiring signals", r.itHiringSignals],
    ["Recent news", r.recentNews],
  ];

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      {lines.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.qualificationNotes && <p className="text-slate-700">{r.qualificationNotes}</p>}
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([heading, items]) => (
          <div key={heading}>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{heading}</div>
            <ul className="list-disc pl-5 text-slate-700">
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      {r.sourceUrls.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500">
            Sources ({r.sourceUrls.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {r.sourceUrls.map((url) => (
              <li key={url} className="truncate">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-slate-600 underline hover:text-slate-900">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-slate-400">
        All of this is saved to the prospect&rsquo;s activity notes when you add it.
      </p>
    </div>
  );
}

export function ResearchBusinessDialog({
  staff,
  currentUserId,
}: {
  staff: { id: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("lookup");
  const [lookup, setLookup] = useState<ResearchLookupInput>(EMPTY_LOOKUP);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [ownerId, setOwnerId] = useState<string>(
    staff.some((s) => s.id === currentUserId) ? currentUserId : UNASSIGNED
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Closing the dialog mid-lookup can't cancel the server action, so each
  // run gets a token and a stale result is simply ignored.
  const runRef = useRef(0);

  function reset() {
    runRef.current++;
    setStep("lookup");
    setLookup(EMPTY_LOOKUP);
    setResult(null);
    setDuplicates([]);
    setAllowDuplicate(false);
    setOwnerId(staff.some((s) => s.id === currentUserId) ? currentUserId : UNASSIGNED);
    setError(null);
    setSaving(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleResearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lookup.name.trim()) return;
    const run = ++runRef.current;
    setError(null);
    setStep("researching");
    try {
      const res = await researchBusiness(lookup);
      if (run !== runRef.current) return;
      if (!res.ok) {
        setError(res.error);
        setStep("lookup");
        return;
      }
      setResult(res.result);
      setDuplicates(res.duplicates);
      setAllowDuplicate(false);
      setStep("review");
    } catch {
      if (run !== runRef.current) return;
      setError("The research request failed — check your connection and try again.");
      setStep("lookup");
    }
  }

  function updateRecord(field: EditableField, value: string) {
    // companyName stays a string (the save action requires it); every
    // other editable field stores a cleared input as null, not "".
    setResult((prev) =>
      prev ? { ...prev, record: { ...prev.record, [field]: field === "companyName" ? value : value || null } } : prev
    );
  }

  function updateConfidence(value: string) {
    setResult((prev) =>
      prev
        ? { ...prev, record: { ...prev.record, confidence: value === NO_CONFIDENCE ? null : (value as ResearchRecord["confidence"]) } }
        : prev
    );
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const owner = ownerId === UNASSIGNED ? null : ownerId;
      const res = await saveResearchedProspect({ result, lookup, ownerId: owner, allowDuplicate });
      if (!res.ok) {
        setError(res.error);
        if (res.duplicates) setDuplicates(res.duplicates);
        setSaving(false);
        return;
      }
      toast.success(`${res.name} added as a prospect (${res.prospectExternalId})`);
      const params = new URLSearchParams({
        owner: res.ownerId ?? UNASSIGNED,
        q: res.name,
        highlight: res.id,
      });
      setOpen(false);
      reset();
      router.push(`/prospects?${params.toString()}`);
    } catch {
      setError("Could not save this prospect — try again.");
      setSaving(false);
    }
  }

  const record = result?.record;
  const blockedByDuplicate = duplicates.length > 0 && !allowDuplicate;

  const field = (id: EditableField, label: string, opts?: { className?: string; required?: boolean }) => (
    <div className={`flex flex-col gap-1.5 ${opts?.className ?? ""}`}>
      <Label htmlFor={`rb-${id}`}>
        {label}
        {opts?.required ? " *" : ""}
      </Label>
      <Input
        id={`rb-${id}`}
        value={(record?.[id] as string | null) ?? ""}
        onChange={(e) => updateRecord(id, e.target.value)}
        required={opts?.required}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" title="Research a business">
          <Sparkles /> <span className="hidden sm:inline">Research a business</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Research a business</DialogTitle>
          <DialogDescription>
            {step === "review"
              ? "Check what was found, fix anything that's off, pick who it's assigned to, then add it."
              : "Claude searches the public web for this business and fills in a prospect record for you to review. Nothing is saved until you click Add."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "lookup" && (
          <form onSubmit={handleResearch} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="rb-lookup-name">Business name *</Label>
                <Input
                  id="rb-lookup-name"
                  value={lookup.name}
                  onChange={(e) => setLookup({ ...lookup, name: e.target.value })}
                  placeholder="e.g. Queen Creek Veterinary Clinic"
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rb-lookup-city">City</Label>
                <Input id="rb-lookup-city" value={lookup.city} onChange={(e) => setLookup({ ...lookup, city: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rb-lookup-state">State</Label>
                <Input
                  id="rb-lookup-state"
                  value={lookup.state}
                  onChange={(e) => setLookup({ ...lookup, state: e.target.value })}
                  placeholder="AZ"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="rb-lookup-website">Website (optional)</Label>
                <Input
                  id="rb-lookup-website"
                  value={lookup.website}
                  onChange={(e) => setLookup({ ...lookup, website: e.target.value })}
                  placeholder="Helps pin down the right business"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="rb-lookup-known">What we already know (optional)</Label>
                <Textarea
                  id="rb-lookup-known"
                  value={lookup.knownInfo}
                  onChange={(e) => setLookup({ ...lookup, knownInfo: e.target.value })}
                  placeholder="e.g. Met the office manager at a chamber event; they mentioned slow Wi-Fi."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!lookup.name.trim()}>
                <Sparkles className="h-4 w-4" /> Research
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "researching" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            <div className="text-sm font-medium text-slate-800">Researching {lookup.name.trim()}…</div>
            <p className="max-w-sm text-xs text-slate-500">
              Searching the web, checking the email domain, and looking for duplicates. This usually takes 30–90
              seconds — keep this window open.
            </p>
          </div>
        )}

        {step === "review" && result && record && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
            {duplicates.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> This may already be in the CRM
                </div>
                <ul className="flex flex-col gap-1">
                  {duplicates.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/customers/${d.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 font-medium underline"
                      >
                        {d.name} <ExternalLink className="h-3 w-3" />
                      </Link>
                      <span className="text-xs text-amber-800">
                        {d.status.toLowerCase()}
                        {d.archived ? ", archived" : ""} — {d.reasons.map((r) => REASON_LABEL[r]).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rb-allow-duplicate"
                    checked={allowDuplicate}
                    onCheckedChange={(checked) => setAllowDuplicate(checked === true)}
                  />
                  <Label htmlFor="rb-allow-duplicate" className="cursor-pointer font-normal">
                    This is a different business — add it anyway
                  </Label>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {field("companyName", "Company name", { className: "col-span-2", required: true })}
              {field("address", "Street address", { className: "col-span-2" })}
              {field("city", "City")}
              <div className="grid grid-cols-2 gap-4">
                {field("state", "State")}
                {field("zip", "ZIP")}
              </div>
              {field("industry", "Industry")}
              {field("mainPhone", "Main phone")}
              {field("website", "Website")}
              {field("publicEmail", "Public email")}
              {field("decisionMaker", "Decision maker")}
              {field("decisionMakerTitle", "Title")}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rb-confidence">Confidence</Label>
                <Select value={record.confidence ?? NO_CONFIDENCE} onValueChange={updateConfidence}>
                  <SelectTrigger id="rb-confidence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value={NO_CONFIDENCE}>Not set</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rb-owner">Assign to</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger id="rb-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.id === currentUserId ? " (me)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              {record.confidence && <Badge variant="outline">{record.confidence} confidence</Badge>}
              <span>Stage: New · Source: Prospect Research</span>
            </div>

            <Findings result={result} />

            <DialogFooter className="sticky bottom-0 bg-white pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setStep("lookup");
                }}
                disabled={saving}
              >
                <ArrowLeft className="h-4 w-4" /> Search again
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || blockedByDuplicate || !record.companyName?.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Add as prospect
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

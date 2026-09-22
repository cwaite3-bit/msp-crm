"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Search, Loader2, X } from "lucide-react";
import { PROSPECT_STAGES, STAGE_LABELS, SIZE_BUCKETS } from "@/lib/prospect";

const ALL = "__all__"; // sentinel: Radix Select can't use "" as an item value

export type ProspectFilterValues = {
  q: string;
  state: string;
  stage: string;
  industry: string;
  size: string;
  owner: string;
};

export function ProspectFilterBar({
  initial,
  states,
  industries,
  staff,
}: {
  initial: ProspectFilterValues;
  states: string[];
  industries: string[];
  staff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync if the URL changes some other way (e.g.
  // back/forward navigation) — adjusted during render rather than in an
  // effect, same pattern as ProspectSearch/CustomerSearch's initialQuery sync.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (
    initial.q !== prevInitial.q ||
    initial.state !== prevInitial.state ||
    initial.stage !== prevInitial.stage ||
    initial.industry !== prevInitial.industry ||
    initial.size !== prevInitial.size ||
    initial.owner !== prevInitial.owner
  ) {
    setPrevInitial(initial);
    setValues(initial);
  }

  function pushParams(next: ProspectFilterValues) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.state) params.set("state", next.state);
    if (next.stage) params.set("stage", next.stage);
    if (next.industry) params.set("industry", next.industry);
    if (next.size) params.set("size", next.size);
    if (next.owner) params.set("owner", next.owner);
    startTransition(() => {
      router.replace(params.toString() ? `${pathname}?${params}` : pathname);
    });
  }

  function updateSelect(key: keyof ProspectFilterValues, value: string) {
    const next = { ...values, [key]: value === ALL ? "" : value };
    setValues(next);
    pushParams(next);
  }

  function updateSearch(next: string) {
    const nextValues = { ...values, q: next };
    setValues(nextValues);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams(nextValues), 250);
  }

  function clearAll() {
    const cleared: ProspectFilterValues = { q: "", state: "", stage: "", industry: "", size: "", owner: "" };
    setValues(cleared);
    pushParams(cleared);
  }

  const hasFilters = !!(values.q || values.state || values.stage || values.industry || values.size || values.owner);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={values.q}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search prospects by name, email, phone, industry…"
          className="pl-8 pr-8"
        />
        {pending && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      <Select value={values.state || ALL} onValueChange={(v) => updateSelect("state", v)}>
        <SelectTrigger className="w-32"><SelectValue placeholder="State" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All states</SelectItem>
          {states.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={values.stage || ALL} onValueChange={(v) => updateSelect("stage", v)}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Stage" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All stages</SelectItem>
          {PROSPECT_STAGES.map((s) => (
            <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={values.industry || ALL} onValueChange={(v) => updateSelect("industry", v)}>
        <SelectTrigger className="w-44"><SelectValue placeholder="Industry" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All industries</SelectItem>
          {industries.map((i) => (
            <SelectItem key={i} value={i}>{i}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={values.size || ALL} onValueChange={(v) => updateSelect("size", v)}>
        <SelectTrigger className="w-44"><SelectValue placeholder="Company size" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any size</SelectItem>
          {SIZE_BUCKETS.map((b) => (
            <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={values.owner || ALL} onValueChange={(v) => updateSelect("owner", v)}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Assigned to" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Everyone</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {staff.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="h-3.5 w-3.5" /> Clear filters
        </Button>
      )}
    </div>
  );
}

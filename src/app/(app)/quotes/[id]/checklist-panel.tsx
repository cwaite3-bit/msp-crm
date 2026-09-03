"use client";

import { useState, useTransition } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateChecklistItem } from "@/server/actions/quotes";
import type { ChecklistTemplateItem } from "@/server/pricing-data";

type ChecklistItemState = { key: string; status: string; note?: string };

const STATUSES = ["Review", "Complete", "N/A"];

export function ChecklistPanel({
  quoteId,
  template,
  checklist,
}: {
  quoteId: string;
  template: ChecklistTemplateItem[];
  checklist: ChecklistItemState[];
}) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<ChecklistItemState[]>(() => {
    const byKey = new Map(checklist.map((c) => [c.key, c]));
    return template.map((t) => byKey.get(t.key) ?? { key: t.key, status: "Review", note: "" });
  });

  const done = items.filter((i) => i.status === "Complete" || i.status === "N/A").length;

  function patch(key: string, patchValue: { status?: string; note?: string }) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patchValue } : i)));
    startTransition(async () => {
      await updateChecklistItem(quoteId, key, patchValue);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {done} of {template.length} complete
        </p>
        <Badge variant={done === template.length ? "success" : "warning"}>
          {done === template.length ? "Ready" : "Review needed"}
        </Badge>
      </div>

      <div className="flex flex-col divide-y divide-slate-100">
        {template.map((t) => {
          const state = items.find((i) => i.key === t.key)!;
          return (
            <div key={t.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 pr-4">
                <p className="text-sm font-medium text-slate-900">{t.question}</p>
                <p className="text-xs text-slate-400">{t.category} · {t.whyItMatters}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  placeholder="Note"
                  value={state.note ?? ""}
                  onChange={(e) => patch(t.key, { note: e.target.value })}
                  className="h-8 w-40"
                  disabled={pending}
                />
                <Select value={state.status} onValueChange={(v) => patch(t.key, { status: v })}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

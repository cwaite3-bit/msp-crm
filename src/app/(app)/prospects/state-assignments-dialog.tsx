"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { MapPin, Loader2 } from "lucide-react";
import { updateStateAssignments, applyStateAssignmentsToExisting, reassignStateOwner } from "@/server/actions/customers";

const UNASSIGNED = "__unassigned__";

export function StateAssignmentsDialog({
  states,
  staff,
  initialAssignments,
}: {
  states: string[];
  staff: { id: string; name: string }[];
  initialAssignments: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [pending, startTransition] = useTransition();
  const [applying, startApplying] = useTransition();

  function handleSave() {
    startTransition(async () => {
      // Drop "unassigned" entries entirely rather than storing an empty
      // string owner — an absent key and an unassigned rule mean the same
      // thing to importProspects, so there's no reason to keep the row.
      const cleaned = Object.fromEntries(Object.entries(assignments).filter(([, v]) => v));

      // A rule that changed owner (or got cleared to "No default owner")
      // should move the prospects it already assigned along with it —
      // otherwise "unassign AZ" leaves everyone it previously assigned
      // sitting with that owner forever, which is exactly the bug this
      // guards against. Only prospects still owned by the OLD assignee are
      // touched, so anyone reassigned to a third person by hand in the
      // meantime is left alone.
      for (const state of states) {
        const oldOwner = initialAssignments[state] || "";
        const newOwner = assignments[state] || "";
        if (oldOwner && oldOwner !== newOwner) {
          await reassignStateOwner(state, oldOwner, newOwner || null);
        }
      }

      await updateStateAssignments(cleaned);
      // Saving a rule only controls *future* imports on its own — it never
      // touches prospects already sitting in the system. Rolling the
      // catch-up into Save (rather than leaving it to the separate "Apply
      // now" button below) means the common case — "assign AZ to John" then
      // expecting AZ prospects to show up under John right away — actually
      // works, instead of silently doing nothing until that second button
      // is clicked. This only ever fills in prospects with no owner yet, so
      // it's safe to run every time.
      const result = await applyStateAssignmentsToExisting();
      toast.success(
        result.updated > 0
          ? `Territory assignments saved — assigned ${result.updated} existing prospect${result.updated === 1 ? "" : "s"}`
          : "Territory assignments saved"
      );
      router.refresh();
    });
  }

  function handleApplyNow() {
    startApplying(async () => {
      const result = await applyStateAssignmentsToExisting();
      toast.success(
        result.updated > 0
          ? `Assigned ${result.updated} existing prospect${result.updated === 1 ? "" : "s"}`
          : "No unassigned prospects matched a rule"
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <MapPin /> Assign by state
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign staff by state</DialogTitle>
          <DialogDescription>
            Set a default owner per state. Saving assigns it to matching prospects that don&rsquo;t already
            have an owner (including ones you already have) and every future import into that state.
            Use &ldquo;Apply now&rdquo; below if you add prospects some other way later and want to catch them up
            without changing these rules.
          </DialogDescription>
        </DialogHeader>

        {states.length === 0 ? (
          <p className="text-sm text-slate-500">No prospects have a state on file yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {states.map((state) => (
              <div key={state} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{state}</span>
                <Select
                  value={assignments[state] || UNASSIGNED}
                  onValueChange={(v) => setAssignments((prev) => ({ ...prev, [state]: v === UNASSIGNED ? "" : v }))}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>No default owner</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleApplyNow} disabled={applying || states.length === 0}>
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply now to existing unassigned prospects
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={handleSave} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

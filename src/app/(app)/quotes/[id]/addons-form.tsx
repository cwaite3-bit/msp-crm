"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { updateAddOns } from "@/server/actions/quotes";
import { toast } from "sonner";
import { EMPTY_ADD_ONS, type AddOnSelections, type BackupProfile } from "@/server/pricing-rules";

const BACKUP_PROFILES: BackupProfile[] = ["None", "Endpoint Backup", "Server Backup", "Managed Backup", "Managed BCDR"];

function YesNoSelect({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Select value={value ? "Yes" : "No"} onValueChange={(v) => onChange(v === "Yes")}>
      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="No">No</SelectItem>
        <SelectItem value="Yes">Yes</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function AddOnsForm({
  quoteId,
  addOns: initialAddOns,
}: {
  quoteId: string;
  addOns: Partial<AddOnSelections> | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOns, setAddOns] = useState<AddOnSelections>({ ...EMPTY_ADD_ONS, ...initialAddOns });

  function num(key: keyof AddOnSelections, value: string) {
    setAddOns((prev) => ({ ...prev, [key]: Math.max(0, Number(value) || 0) }));
  }

  function save() {
    startTransition(async () => {
      await updateAddOns(quoteId, addOns);
      router.refresh();
      toast.success("Add-ons saved");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">vCIO / strategic planning</Label>
          <YesNoSelect value={addOns.vcioEnabled} onChange={(v) => setAddOns((a) => ({ ...a, vcioEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Hours / month</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.vcioHoursPerMonth}
            onChange={(e) => num("vcioHoursPerMonth", e.target.value)} disabled={!addOns.vcioEnabled} />
        </div>
        <div />
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Backup / disaster recovery profile</Label>
          <Select value={addOns.backupProfile} onValueChange={(v) => setAddOns((a) => ({ ...a, backupProfile: v as BackupProfile }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{BACKUP_PROFILES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Protected workstations</Label>
          <Input type="number" min={0} className="h-8 w-28" value={addOns.protectedWorkstations}
            onChange={(e) => num("protectedWorkstations", e.target.value)} disabled={addOns.backupProfile === "None" || addOns.backupProfile === "Server Backup"} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Protected servers</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.protectedServers}
            onChange={(e) => num("protectedServers", e.target.value)} disabled={addOns.backupProfile === "None" || addOns.backupProfile === "Endpoint Backup"} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Advanced email security</Label>
          <YesNoSelect value={addOns.emailSecurityEnabled} onChange={(v) => setAddOns((a) => ({ ...a, emailSecurityEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Seats</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.emailSecuritySeats}
            onChange={(e) => num("emailSecuritySeats", e.target.value)} disabled={!addOns.emailSecurityEnabled} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Security awareness training</Label>
          <YesNoSelect value={addOns.trainingEnabled} onChange={(v) => setAddOns((a) => ({ ...a, trainingEnabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Seats</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.trainingSeats}
            onChange={(e) => num("trainingSeats", e.target.value)} disabled={!addOns.trainingEnabled} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Microsoft 365 licensing included</Label>
          <YesNoSelect value={addOns.m365Enabled} onChange={(v) => setAddOns((a) => ({ ...a, m365Enabled: v }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Seats</Label>
          <Input type="number" min={0} className="h-8 w-24" value={addOns.m365Seats}
            onChange={(e) => num("m365Seats", e.target.value)} disabled={!addOns.m365Enabled} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Included onsite hours / month</Label>
        <Input type="number" min={0} className="h-8 w-24" value={addOns.includedOnsiteHoursPerMonth}
          onChange={(e) => num("includedOnsiteHoursPerMonth", e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Additional monthly add-on (sell)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.customMonthlyAddOnSell}
            onChange={(e) => num("customMonthlyAddOnSell", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Estimated direct cost (internal)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.customMonthlyAddOnCost}
            onChange={(e) => num("customMonthlyAddOnCost", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">One-time project / remediation (sell)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.oneTimeProjectSell}
            onChange={(e) => num("oneTimeProjectSell", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Estimated direct cost of project (internal)</Label>
          <Input type="number" min={0} step="0.01" className="h-8" value={addOns.oneTimeProjectCost}
            onChange={(e) => num("oneTimeProjectCost", e.target.value)} />
        </div>
      </div>

      <Button onClick={save} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save add-ons"}
      </Button>
    </div>
  );
}

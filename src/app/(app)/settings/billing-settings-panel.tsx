"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/help-tip";
import { updateBillingSettings } from "@/server/actions/settings";
import { toast } from "sonner";
import type { BillingSettings } from "@/server/pricing-data";

export function BillingSettingsPanel({ settings: initial }: { settings: BillingSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [annualDiscountPct, setAnnualDiscountPct] = useState(initial.annualDiscountPct);

  function save() {
    startTransition(async () => {
      await updateBillingSettings({ annualDiscountPct });
      router.refresh();
      toast.success("Billing options saved");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label className="flex items-center gap-1.5">
          Annual prepay discount (%)
          <HelpTip text="How much cheaper it is for a client to pay for a full year of recurring services upfront instead of monthly. 0 = no discount, just 12 months billed at once. Shown to the client as a choice when they accept a quote." />
        </Label>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.5"
          value={annualDiscountPct}
          onChange={(e) => setAnnualDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
        />
      </div>
      <Button className="w-fit" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save billing options"}
      </Button>
    </div>
  );
}

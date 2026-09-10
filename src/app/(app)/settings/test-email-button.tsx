"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { sendTestEmail } from "@/server/actions/test-email";
import { toast } from "sonner";

export function TestEmailButton() {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendTestEmail();
      if (result.sent) {
        toast.success(`Test email sent to ${result.to} — check your inbox (and spam folder)`);
      } else {
        toast.error(result.error || "Failed to send the test email");
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={send} disabled={pending}>
      <Mail className="h-4 w-4" /> Send test email
    </Button>
  );
}

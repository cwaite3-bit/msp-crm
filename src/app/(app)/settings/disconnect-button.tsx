"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { disconnectQuickBooks } from "@/server/actions/quickbooks";

export function DisconnectButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!confirm("Disconnect QuickBooks?")) return;
        startTransition(async () => {
          await disconnectQuickBooks();
          router.refresh();
        });
      }}
    >
      Disconnect
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveCustomer, unarchiveCustomer } from "@/server/actions/customers";

// Archiving is reversible (see archiveCustomer in server/actions/customers),
// so restoring needs no confirmation — only the archive direction, since
// it's a one-click hide-from-lists action and the person should know it's
// undoable rather than a real delete before they commit to it.
export function ArchiveCustomerButton({
  customerId,
  name,
  archived,
}: {
  customerId: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (archived) {
      startTransition(async () => {
        await unarchiveCustomer(customerId);
        toast.success(`${name} restored`);
        router.refresh();
      });
      return;
    }
    if (
      !window.confirm(
        `Archive "${name}"? It'll disappear from the Customers/Prospects lists, but you can restore it anytime from Archived.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await archiveCustomer(customerId);
      toast.success(`${name} archived`);
      router.refresh();
    });
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={pending}>
      {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}

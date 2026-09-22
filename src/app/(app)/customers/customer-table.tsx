"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Archive, ArchiveRestore } from "lucide-react";
import { archiveCustomer, unarchiveCustomer } from "@/server/actions/customers";

export type CustomerRow = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  phone: string | null;
  email: string | null;
};

export function CustomerTable({
  rows,
  showArchived,
  query,
}: {
  rows: CustomerRow[];
  showArchived: boolean;
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Reversible (see archiveCustomer), so this is a light heads-up rather
  // than the harder confirmation a real delete would need.
  function handleArchive(row: CustomerRow) {
    if (
      !window.confirm(
        `Archive "${row.name}"? It'll disappear from the Customers list, but you can restore it anytime from Archived.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await archiveCustomer(row.id);
      toast.success(`${row.name} archived`);
      router.refresh();
    });
  }

  function handleUnarchive(row: CustomerRow) {
    startTransition(async () => {
      await unarchiveCustomer(row.id);
      toast.success(`${row.name} restored`);
      router.refresh();
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Industry</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id} className={pending ? "opacity-70" : undefined}>
            <TableCell>
              <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:underline">
                {c.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className="capitalize">
                {c.status.toLowerCase()}
              </Badge>
            </TableCell>
            <TableCell className="text-slate-500">{c.industry || "—"}</TableCell>
            <TableCell className="text-slate-500">{c.phone || "—"}</TableCell>
            <TableCell className="text-slate-500">{c.email || "—"}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={pending}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showArchived ? (
                    <DropdownMenuItem onClick={() => handleUnarchive(c)}>
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => handleArchive(c)}>
                      <Archive className="h-4 w-4" /> Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={`/customers/${c.id}`}>View details</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-slate-500">
              {query
                ? `No customers match "${query}".`
                : showArchived
                  ? "No archived customers."
                  : "No customers yet. Add your first one to get started."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

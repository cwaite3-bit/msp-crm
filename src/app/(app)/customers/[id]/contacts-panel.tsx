"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { addContact, deleteContact } from "@/server/actions/customers";
import { Trash2, Plus } from "lucide-react";
import type { contacts } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Contact = InferSelectModel<typeof contacts>;

export function ContactsPanel({ customerId, contacts: initial }: { customerId: string; contacts: Contact[] }) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {initial.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
          <div>
            <div className="flex items-center gap-2 font-medium text-slate-900">
              {c.firstName} {c.lastName}
              {c.isPrimary && <Badge variant="secondary">Primary</Badge>}
            </div>
            <div className="text-sm text-slate-500">
              {c.title ? `${c.title} · ` : ""}
              {c.email || "no email"} {c.phone ? `· ${c.phone}` : ""}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={() => startTransition(() => deleteContact(customerId, c.id))}
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </div>
      ))}
      {initial.length === 0 && <p className="text-sm text-slate-500">No contacts yet.</p>}

      {adding ? (
        <form
          action={(fd) => {
            startTransition(async () => {
              await addContact(customerId, fd);
              setAdding(false);
            });
          }}
          className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-3"
        >
          <Input name="firstName" placeholder="First name" required />
          <Input name="lastName" placeholder="Last name" required />
          <Input name="title" placeholder="Title" />
          <Input name="phone" placeholder="Phone" />
          <Input name="email" placeholder="Email" type="email" className="col-span-2" />
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Add contact
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add contact
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { addNote } from "@/server/actions/customers";
import { formatDate } from "@/lib/utils";

type Note = {
  id: string;
  body: string;
  type: string;
  createdAt: Date;
  authorName: string | null;
};

export function NotesPanel({ customerId, notes }: { customerId: string; notes: Note[] }) {
  const [type, setType] = useState("NOTE");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <form
        action={(fd) => {
          fd.set("type", type);
          startTransition(async () => {
            await addNote(customerId, fd);
          });
        }}
        className="flex flex-col gap-2 rounded-md border border-slate-200 p-3"
      >
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NOTE">Note</SelectItem>
              <SelectItem value="CALL">Call</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="MEETING">Meeting</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea name="body" placeholder="Log a note, call, or meeting…" required />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Log activity"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col divide-y divide-slate-100">
        {notes.map((n) => (
          <div key={n.id} className="py-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Badge variant="outline" className="capitalize">
                {n.type.toLowerCase()}
              </Badge>
              <span>{n.authorName || "Unknown"}</span>
              <span>·</span>
              <span>{formatDate(n.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{n.body}</p>
          </div>
        ))}
        {notes.length === 0 && <p className="py-4 text-sm text-slate-500">No activity logged yet.</p>}
      </div>
    </div>
  );
}

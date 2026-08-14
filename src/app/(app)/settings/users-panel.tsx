"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { createStaffUser, setUserActive } from "@/server/actions/users";
import { toast } from "sonner";

type UserRow = { id: string; name: string; email: string; role: "ADMIN" | "STAFF"; active: boolean };

export function UsersPanel({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("STAFF");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {users.map((u) => (
        <div key={u.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
          <div>
            <div className="flex items-center gap-2 font-medium text-slate-900">
              {u.name}
              <Badge variant="secondary">{u.role}</Badge>
              {!u.active && <Badge variant="destructive">Inactive</Badge>}
            </div>
            <div className="text-sm text-slate-500">{u.email}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setUserActive(u.id, !u.active);
                router.refresh();
              })
            }
          >
            {u.active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit">
            <Plus className="h-4 w-4" /> Add staff user
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff user</DialogTitle>
          </DialogHeader>
          <form
            action={(fd) => {
              fd.set("role", role);
              startTransition(async () => {
                try {
                  await createStaffUser(fd);
                  toast.success("User created");
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to create user");
                }
              });
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Temporary password</Label>
              <Input name="password" type="password" minLength={8} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STAFF">Staff</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

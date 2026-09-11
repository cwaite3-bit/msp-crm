"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Camera, X } from "lucide-react";
import { createStaffUser, setUserActive, updateStaffContactInfo, updateStaffPhoto } from "@/server/actions/users";
import { toast } from "sonner";

type StartTransition = ReturnType<typeof useTransition>[1];

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  active: boolean;
  photoUrl: string | null;
  phone: string | null;
  title: string | null;
};

// Resizes/crops an uploaded image to a small square JPEG data: URI entirely
// in the browser (canvas), so there's no server-side image library to
// install and no file ever needs to leave the browser as anything but the
// final small string this app stores directly on the user row (see
// updateStaffPhoto). 256px/0.85 quality keeps this comfortably under ~40KB
// for a typical headshot — plenty for the small avatar this renders as.
async function resizeImageToDataUrl(file: File, size = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // Cover-crop to a centered square so a wide/tall photo doesn't get squashed.
  const srcSize = Math.min(img.width, img.height);
  const sx = (img.width - srcSize) / 2;
  const sy = (img.height - srcSize) / 2;
  ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", 0.85);
}

function StaffRow({ user, pending, startTransition }: { user: UserRow; pending: boolean; startTransition: StartTransition }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [title, setTitle] = useState(user.title ?? "");
  const [uploading, setUploading] = useState(false);

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await updateStaffPhoto(user.id, dataUrl);
      router.refresh();
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update photo");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto() {
    startTransition(async () => {
      await updateStaffPhoto(user.id, null);
      router.refresh();
    });
  }

  function saveContactInfo() {
    startTransition(async () => {
      await updateStaffContactInfo(user.id, { phone, title });
      router.refresh();
      toast.success("Saved");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {user.photoUrl ? (
            <Image src={user.photoUrl} alt={user.name} width={48} height={48} className="h-12 w-12 rounded-full object-cover" unoptimized />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
              {initials || "?"}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload photo"
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-900 text-white"
          >
            <Camera className="h-3 w-3" />
          </button>
          {user.photoUrl && (
            <button
              type="button"
              onClick={removePhoto}
              disabled={pending}
              title="Remove photo"
              className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-600 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            {user.name}
            <Badge variant="secondary">{user.role}</Badge>
            {!user.active && <Badge variant="destructive">Inactive</Badge>}
          </div>
          <div className="text-sm text-slate-500">{user.email}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Owner)" className="h-8 w-40 text-sm" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="h-8 w-36 text-sm" />
            <Button variant="outline" size="sm" onClick={saveContactInfo} disabled={pending}>
              Save
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Photo, title, and phone show up alongside this person on client-facing quotes and MSAs.</p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setUserActive(user.id, !user.active);
            router.refresh();
          })
        }
      >
        {user.active ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  );
}

export function UsersPanel({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("STAFF");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {users.map((u) => (
        <StaffRow key={u.id} user={u} pending={pending} startTransition={startTransition} />
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

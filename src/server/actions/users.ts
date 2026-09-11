"use server";

import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Admin access required");
  return session.user;
}

// Lets a staff member manage their OWN contact info/photo even if they're
// not an admin — an admin can still edit anyone. Only one login exists
// today, but this keeps the door open for more staff without needing a
// separate "edit my profile" surface later.
async function requireAdminOrSelf(userId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  if (session.user.role !== "ADMIN" && session.user.id !== userId) {
    throw new Error("You can only edit your own profile");
  }
  return session.user;
}

export async function listUsers() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      photoUrl: users.photoUrl,
      phone: users.phone,
      title: users.title,
    })
    .from(users);
}

export async function createStaffUser(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const role = (String(formData.get("role") || "STAFF") as "ADMIN" | "STAFF");

  if (!name || !email || password.length < 8) {
    throw new Error("Name, email, and an 8+ character password are required");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(users).values({ name, email, passwordHash, role });
  revalidatePath("/settings");
}

export async function setUserActive(userId: string, active: boolean) {
  await requireAdmin();
  await db.update(users).set({ active }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

// Phone/title shown alongside this person's photo wherever they're the
// account contact on a client-facing quote or MSA (see
// src/components/account-contact-card.tsx).
export async function updateStaffContactInfo(userId: string, data: { phone: string; title: string }) {
  await requireAdminOrSelf(userId);
  await db
    .update(users)
    .set({ phone: data.phone.trim() || null, title: data.title.trim() || null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  revalidatePath("/settings");
}

// photoDataUri is a small, client-side-resized JPEG data: URI (see the
// upload control in users-panel.tsx) — pass null to remove the photo.
// Stored directly in the row rather than a file/blob store, matching this
// app's existing pattern for the Lockdown IT logo: Vercel's serverless
// filesystem isn't a place to durably keep uploaded files.
export async function updateStaffPhoto(userId: string, photoDataUri: string | null) {
  await requireAdminOrSelf(userId);
  if (photoDataUri && !photoDataUri.startsWith("data:image/")) {
    throw new Error("Invalid image data");
  }
  await db.update(users).set({ photoUrl: photoDataUri, updatedAt: new Date() }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

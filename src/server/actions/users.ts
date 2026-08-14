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

export async function listUsers() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users);
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

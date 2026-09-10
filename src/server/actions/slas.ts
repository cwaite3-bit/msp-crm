"use server";

import { db } from "@/server/db";
import { slas, quotes } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Admin access required");
  return user;
}

export async function listSlas() {
  await requireUser();
  return db.select().from(slas).orderBy(slas.sortOrder);
}

// No-auth read for the public client-facing quote page (/q/[token]) and the
// public MSA signing page (/msa/[token]) — same "public getter" pattern as
// getRateCardPublic in settings.ts. Only reachable by a specific id a quote
// already points to, never listed.
export async function getSlaPublic(id: string) {
  const [row] = await db.select().from(slas).where(eq(slas.id, id)).limit(1);
  return row ?? null;
}

export type SlaInput = {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  coverageHours: string;
  criticalResponseMinutes: number;
  highResponseMinutes: number;
  mediumResponseMinutes: number;
  lowResponseMinutes: number;
  criticalResolutionHours: number;
  highResolutionHours: number;
  mediumResolutionHours: number;
  lowResolutionHours: number;
  uptimeGuaranteePct: number;
  escalationProcess?: string | null;
  exclusions?: string | null;
};

async function clearOtherDefaults(exceptId?: string) {
  const all = await db.select().from(slas);
  for (const row of all) {
    if (row.id !== exceptId && row.isDefault) {
      await db.update(slas).set({ isDefault: false }).where(eq(slas.id, row.id));
    }
  }
}

export async function createSla(input: SlaInput) {
  await requireAdmin();
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("SLA name is required");
  const existing = await db.select().from(slas);
  const [row] = await db
    .insert(slas)
    .values({
      name: trimmed,
      description: input.description || null,
      isDefault: Boolean(input.isDefault),
      sortOrder: existing.length,
      coverageHours: input.coverageHours,
      criticalResponseMinutes: input.criticalResponseMinutes,
      highResponseMinutes: input.highResponseMinutes,
      mediumResponseMinutes: input.mediumResponseMinutes,
      lowResponseMinutes: input.lowResponseMinutes,
      criticalResolutionHours: input.criticalResolutionHours,
      highResolutionHours: input.highResolutionHours,
      mediumResolutionHours: input.mediumResolutionHours,
      lowResolutionHours: input.lowResolutionHours,
      uptimeGuaranteePct: String(input.uptimeGuaranteePct),
      escalationProcess: input.escalationProcess || null,
      exclusions: input.exclusions || null,
    })
    .returning();
  if (row.isDefault) await clearOtherDefaults(row.id);
  revalidatePath("/settings");
  revalidatePath("/quotes");
  return row;
}

export async function updateSla(id: string, input: SlaInput) {
  await requireAdmin();
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("SLA name is required");
  await db
    .update(slas)
    .set({
      name: trimmed,
      description: input.description || null,
      isDefault: Boolean(input.isDefault),
      coverageHours: input.coverageHours,
      criticalResponseMinutes: input.criticalResponseMinutes,
      highResponseMinutes: input.highResponseMinutes,
      mediumResponseMinutes: input.mediumResponseMinutes,
      lowResponseMinutes: input.lowResponseMinutes,
      criticalResolutionHours: input.criticalResolutionHours,
      highResolutionHours: input.highResolutionHours,
      mediumResolutionHours: input.mediumResolutionHours,
      lowResolutionHours: input.lowResolutionHours,
      uptimeGuaranteePct: String(input.uptimeGuaranteePct),
      escalationProcess: input.escalationProcess || null,
      exclusions: input.exclusions || null,
      updatedAt: new Date(),
    })
    .where(eq(slas.id, id));
  if (input.isDefault) await clearOtherDefaults(id);
  revalidatePath("/settings");
  revalidatePath("/quotes");
}

export async function reorderSlas(orderedIds: string[]) {
  await requireAdmin();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(slas).set({ sortOrder: i }).where(eq(slas.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

export async function deleteSla(id: string) {
  await requireAdmin();
  // Quotes referencing this SLA fall back to no SLA rather than blocking
  // the delete — quotes.slaId is ON DELETE SET NULL at the DB level, so
  // this is just making that visible/intentional rather than surprising.
  const inUse = await db.select().from(quotes).where(eq(quotes.slaId, id));
  await db.delete(slas).where(eq(slas.id, id));
  revalidatePath("/settings");
  revalidatePath("/quotes");
  return { detachedFromQuotes: inUse.length };
}

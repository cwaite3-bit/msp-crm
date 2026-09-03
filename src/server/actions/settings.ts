"use server";

import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_RATE_CARD,
  DEFAULT_SCOPE_MATRIX,
  DEFAULT_CHECKLIST_TEMPLATE,
  type RateCard,
  type ScopeMatrixRow,
  type ChecklistTemplateItem,
} from "@/server/pricing-data";

const RATE_CARD_KEY = "pricingRateCard";
const SCOPE_MATRIX_KEY = "scopeMatrix";
const CHECKLIST_TEMPLATE_KEY = "checklistTemplate";

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

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return fallback;
  return row.value as T;
}

async function setSetting(key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as object, updatedAt: new Date() } });
}

// ---- Rate card ----

export async function getRateCard(): Promise<RateCard> {
  await requireUser();
  return getSetting(RATE_CARD_KEY, DEFAULT_RATE_CARD);
}

// No-auth read for the public client-facing quote page (/q/[token]), which
// is only reachable via an unguessable token, not a login. Server-side
// only — the page must be careful to render sell-side numbers (final MRR,
// onboarding fee) and never the cost/margin fields this also returns.
export async function getRateCardPublic(): Promise<RateCard> {
  return getSetting(RATE_CARD_KEY, DEFAULT_RATE_CARD);
}

export async function updateRateCard(rateCard: RateCard) {
  await requireAdmin();
  await setSetting(RATE_CARD_KEY, rateCard);
  revalidatePath("/settings");
  revalidatePath("/quotes");
}

export async function resetRateCardToDefault() {
  await requireAdmin();
  await setSetting(RATE_CARD_KEY, DEFAULT_RATE_CARD);
  revalidatePath("/settings");
  revalidatePath("/quotes");
  return DEFAULT_RATE_CARD;
}

// ---- Scope matrix ----

export async function getScopeMatrix(): Promise<ScopeMatrixRow[]> {
  await requireUser();
  return getSetting(SCOPE_MATRIX_KEY, DEFAULT_SCOPE_MATRIX);
}

// No-auth read for the public client-facing quote page — see
// getRateCardPublic above for why this exists as a separate function.
export async function getScopeMatrixPublic(): Promise<ScopeMatrixRow[]> {
  return getSetting(SCOPE_MATRIX_KEY, DEFAULT_SCOPE_MATRIX);
}

export async function updateScopeMatrix(rows: ScopeMatrixRow[]) {
  await requireAdmin();
  await setSetting(SCOPE_MATRIX_KEY, rows);
  revalidatePath("/settings");
  revalidatePath("/quotes");
}

// ---- Checklist template ----

export async function getChecklistTemplate(): Promise<ChecklistTemplateItem[]> {
  await requireUser();
  return getSetting(CHECKLIST_TEMPLATE_KEY, DEFAULT_CHECKLIST_TEMPLATE);
}

export async function updateChecklistTemplate(items: ChecklistTemplateItem[]) {
  await requireAdmin();
  await setSetting(CHECKLIST_TEMPLATE_KEY, items);
  revalidatePath("/settings");
}

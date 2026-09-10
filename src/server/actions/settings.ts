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
  DEFAULT_M365_PLANS,
  DEFAULT_MSA_SETTINGS,
  type RateCard,
  type ScopeMatrixRow,
  type ChecklistTemplateItem,
  type M365Plan,
  type MsaSettings,
} from "@/server/pricing-data";

const RATE_CARD_KEY = "pricingRateCard";
const SCOPE_MATRIX_KEY = "scopeMatrix";
const CHECKLIST_TEMPLATE_KEY = "checklistTemplate";
const M365_PLANS_KEY = "m365Plans";
const MSA_SETTINGS_KEY = "msaSettings";

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

// ---- Microsoft 365 / security / identity plan catalog ----

export async function getM365Plans(): Promise<M365Plan[]> {
  await requireUser();
  return getSetting(M365_PLANS_KEY, DEFAULT_M365_PLANS);
}

// No-auth read for the public client-facing quote page — see
// getRateCardPublic above for why this exists as a separate function. Note
// this returns `cost` too (needed for the tier-comparison math server-side);
// the public page must only ever render sell-side aggregates, never these
// rows directly.
export async function getM365PlansPublic(): Promise<M365Plan[]> {
  return getSetting(M365_PLANS_KEY, DEFAULT_M365_PLANS);
}

export async function updateM365Plans(plans: M365Plan[]) {
  await requireAdmin();
  await setSetting(M365_PLANS_KEY, plans);
  revalidatePath("/settings");
  revalidatePath("/quotes");
}

export async function resetM365PlansToDefault() {
  await requireAdmin();
  await setSetting(M365_PLANS_KEY, DEFAULT_M365_PLANS);
  revalidatePath("/settings");
  revalidatePath("/quotes");
  return DEFAULT_M365_PLANS;
}

// ---- MSA standing terms ----

export async function getMsaSettings(): Promise<MsaSettings> {
  await requireUser();
  const stored = await getSetting(MSA_SETTINGS_KEY, DEFAULT_MSA_SETTINGS);
  // Merge over defaults so a field added after a customer already saved
  // settings (e.g. a future new MSA field) doesn't come back undefined.
  return { ...DEFAULT_MSA_SETTINGS, ...stored };
}

// No-auth read — the rendered MSA (staff preview, public signing page, and
// the generated PDF) needs these terms without requiring a login.
export async function getMsaSettingsPublic(): Promise<MsaSettings> {
  const stored = await getSetting(MSA_SETTINGS_KEY, DEFAULT_MSA_SETTINGS);
  return { ...DEFAULT_MSA_SETTINGS, ...stored };
}

export async function updateMsaSettings(settings: MsaSettings) {
  await requireAdmin();
  await setSetting(MSA_SETTINGS_KEY, settings);
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

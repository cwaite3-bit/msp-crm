"use server";

// Staff-only "AI review" for a quote — see src/server/ai-review.ts for the
// prompt/content builder this wraps. Deliberately a hand-rolled fetch to
// the Anthropic Messages API rather than pulling in the @anthropic-ai/sdk
// package, matching this app's existing QuickBooks integration
// (hand-rolled OAuth2 + REST, "no heavy SDK dependency" — see the
// architecture doc's Stack section).
//
// Manual trigger only (a staff-clicked "Analyze" button), never automatic
// on every edit — this costs a small amount per call and quote data
// changes constantly while staff are building a quote, so auto-firing on
// every keystroke would be both expensive and distracting. The result is
// cached on the quote (aiReviewText/aiReviewGeneratedAt/aiReviewModel)
// until the underlying data changes, at which point isAiReviewStale below
// flags it so staff know to re-run it — without spending another AI call
// just to check.
import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, slas, serviceTiers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { buildAiReviewPrompt, hashAiReviewInput, AI_REVIEW_SYSTEM_PROMPT, type AiReviewInput } from "@/server/ai-review";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

async function loadReviewInput(quoteId: string): Promise<AiReviewInput | null> {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return null;

  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const lineItemRows = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));

  let slaName: string | null = null;
  let slaCoverageHours: string | null = null;
  if (quote.slaId) {
    const [sla] = await db.select().from(slas).where(eq(slas.id, quote.slaId)).limit(1);
    slaName = sla?.name ?? null;
    slaCoverageHours = sla?.coverageHours ?? null;
  }

  let serviceTierName: string | null = null;
  if (quote.serviceTierId) {
    const [tier] = await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1);
    serviceTierName = tier?.name ?? null;
  }

  return {
    customerName: customer?.name ?? "Unknown customer",
    customerIndustry: customer?.industry ?? null,
    customerEmployeeCount: customer?.employeeCount ?? null,
    quoteTitle: quote.title ?? null,
    serviceTierName,
    slaName,
    slaCoverageHours,
    quantities: (quote.quantities as Record<string, unknown>) ?? {},
    riskFactors: (quote.riskFactors as Record<string, unknown>) ?? {},
    addOnSelections: (quote.addOnSelections as Record<string, unknown>) ?? {},
    lineItems: lineItemRows.map((li) => ({
      categoryName: li.categoryName,
      name: li.name,
      description: li.description,
      billingType: li.billingType,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
      source: li.source,
    })),
    totalMonthly: quote.totalMonthly,
    totalOneTime: quote.totalOneTime,
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxRatePct: quote.taxRatePct,
  };
}

// Returns a result object rather than throwing — same reasoning as
// resetQuote/pushQuoteToQuickBooks elsewhere in this app: Next.js redacts
// a thrown Server Action error's message in production, and this needs to
// surface "not configured yet" / API errors back to the panel as data.
export async function generateAiQuoteReview(quoteId: string): Promise<{ ok: boolean; error?: string; text?: string }> {
  await requireUser();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "AI review isn't configured yet — add ANTHROPIC_API_KEY in Vercel to enable this.",
    };
  }

  const input = await loadReviewInput(quoteId);
  if (!input) return { ok: false, error: "Quote not found" };

  const hash = hashAiReviewInput(input);
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: AI_REVIEW_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildAiReviewPrompt(input) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300) || response.statusText}`);
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The AI returned an empty response");

    await db
      .update(quotes)
      .set({
        aiReviewText: text,
        aiReviewGeneratedAt: new Date(),
        aiReviewInputHash: hash,
        aiReviewModel: model,
        aiReviewError: null,
      })
      .where(eq(quotes.id, quoteId));
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI review failed";
    await db.update(quotes).set({ aiReviewError: message }).where(eq(quotes.id, quoteId));
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: false, error: message };
  }
}

// Called from the quote detail page (a server component) to decide whether
// to show a "quote data has changed since this was generated" note next to
// an already-cached review — without spending an AI call just to check.
export async function isAiReviewStale(quoteId: string): Promise<boolean> {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote?.aiReviewText || !quote.aiReviewInputHash) return false;
  const input = await loadReviewInput(quoteId);
  if (!input) return false;
  return hashAiReviewInput(input) !== quote.aiReviewInputHash;
}

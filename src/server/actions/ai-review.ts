"use server";

// Staff-only "AI review" for a quote — see src/server/ai-review.ts for the
// prompt/content builder this wraps. Deliberately a hand-rolled fetch to
// the Anthropic Messages API rather than pulling in the @anthropic-ai/sdk
// package, matching this app's existing QuickBooks integration
// (hand-rolled OAuth2 + REST, "no heavy SDK dependency" — see the
// architecture doc's Stack section).
//
// This is a deep-dive revenue-opportunity review: the model gets this
// MSP's own product catalog (priced at this quote's tier) so it can name
// specific things staff already sell that aren't on this quote, plus
// Anthropic's server-side web_search tool so it can ground a
// recommendation in the customer's actual industry/compliance/threat
// landscape. web_search is a *server-side* tool — Anthropic's own
// infrastructure executes the search and the full result (searches +
// final answer) comes back from a single fetch call, no client-side
// tool-result loop required.
//
// Manual trigger only (a staff-clicked "Analyze" button), never automatic
// on every edit — this costs real money per call (a stronger model, up to
// a handful of web searches, and a longer structured answer) and quote
// data changes constantly while staff are still building it out. The
// result is cached on the quote (aiReviewText, as a JSON string —
// aiReviewGeneratedAt/aiReviewModel) until the underlying data changes, at
// which point isAiReviewStale below flags it so staff know to re-run it —
// without spending another AI call just to check.
import { db } from "@/server/db";
import { quotes, quoteLineItems, customers, slas, serviceTiers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { listCatalog } from "@/server/actions/catalog";
import {
  buildAiReviewPrompt,
  hashAiReviewInput,
  parseAiReviewText,
  AI_REVIEW_SYSTEM_PROMPT,
  type AiReviewInput,
  type AiReviewResult,
  type AiReviewSource,
} from "@/server/ai-review";

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
  const onQuoteProductIds = new Set(lineItemRows.map((li) => li.productId).filter((id): id is string => Boolean(id)));

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

  // Catalog priced at this quote's tier — same tier-override-else-default
  // logic as resolveUnitPrice in quotes.ts, done here against the
  // already-fetched catalog rather than N extra queries per product.
  const catalog = await listCatalog();
  const categoryNameById = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const catalogItems = catalog.products.map((p) => {
    const override = quote.serviceTierId
      ? catalog.tierPrices.find((tp) => tp.productId === p.id && tp.tierId === quote.serviceTierId)
      : undefined;
    return {
      categoryName: categoryNameById.get(p.categoryId) ?? "Other",
      name: p.name,
      description: p.description,
      unitLabel: p.unitLabel,
      billingType: p.billingType,
      priceAtThisTier: override?.unitPrice ?? p.defaultUnitPrice,
      alreadyOnQuote: onQuoteProductIds.has(p.id),
    };
  });

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
    catalogItems,
    totalMonthly: quote.totalMonthly,
    totalOneTime: quote.totalOneTime,
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxRatePct: quote.taxRatePct,
  };
}

// Shape of the bits of the Anthropic Messages API response this action
// actually reads. Deliberately loose/partial — we only read text and
// citation blocks, and ignore server_tool_use / web_search_tool_result
// blocks (Anthropic's own record of what it searched for/found), since we
// don't need to re-display the search process itself, only its citations.
type AnthropicContentBlock = {
  type: string;
  text?: string;
  citations?: { type: string; url?: string; title?: string }[];
};
type AnthropicMessageResponse = { content?: AnthropicContentBlock[] };

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
  // Opus is the default here (not the cheaper Sonnet default used
  // elsewhere) because this is a deliberately deep, manually-triggered,
  // low-volume analysis — worth the stronger model. Override with
  // ANTHROPIC_MODEL if you'd rather trade quality for cost.
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";

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
        max_tokens: 2000,
        system: AI_REVIEW_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildAiReviewPrompt(input) }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300) || response.statusText}`);
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const textBlocks = (data.content || []).filter((block) => block.type === "text" && block.text);
    const combinedText = textBlocks.map((block) => block.text).join("\n").trim();
    if (!combinedText) throw new Error("The AI returned an empty response");

    // Real citation URLs Claude actually visited, not self-reported by the
    // model — collected from every text block's citations, deduped by URL.
    const sourceMap = new Map<string, AiReviewSource>();
    for (const block of textBlocks) {
      for (const citation of block.citations || []) {
        if (citation.type === "web_search_result_location" && citation.url && !sourceMap.has(citation.url)) {
          sourceMap.set(citation.url, { url: citation.url, title: citation.title || null });
        }
      }
    }

    const parsed = parseAiReviewText(combinedText);
    let textToStore: string;
    if (parsed) {
      const result: AiReviewResult = { ...parsed, sources: Array.from(sourceMap.values()) };
      textToStore = JSON.stringify(result);
    } else {
      // Couldn't find valid JSON in the response — fall back to storing
      // the raw text so nothing is silently lost; the panel renders this
      // as plain prose when it isn't parseable JSON.
      textToStore = combinedText;
    }

    await db
      .update(quotes)
      .set({
        aiReviewText: textToStore,
        aiReviewGeneratedAt: new Date(),
        aiReviewInputHash: hash,
        aiReviewModel: model,
        aiReviewError: null,
      })
      .where(eq(quotes.id, quoteId));
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, text: textToStore };
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

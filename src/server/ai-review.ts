// Pure content-builder for the staff-only "AI review" panel on the quote
// detail page — same "no DB access, no side effects" shape as msa.ts and
// addendum.ts. Building the review's input and hashing it is split out
// here so both the server action that actually calls the AI (needs the
// full input, to build a prompt) and the quote detail page (a server
// component that just needs to know whether a *stored* review is stale)
// can share the exact same input shape and hash, without the page having
// to make a network call just to check staleness.
//
// This is a "deep dive" revenue-opportunity review, not just a sanity
// check: it's given the quote's own data, this MSP's full product catalog
// (so it can name specific things already sold that aren't on this quote),
// and web search (so it can ground a recommendation in the customer's
// actual industry/compliance/threat landscape rather than generic MSP
// advice). Output is structured JSON (see AiReviewResult) rather than
// prose, so the panel can render a scannable list of opportunities with
// dollar estimates instead of a paragraph to parse by eye.
//
// This is entirely staff-internal: the resulting review is never rendered
// on any public/customer-facing page (/q/[token], /msa/[token],
// /addendum/[token]), only on the staff quote detail page.

import crypto from "node:crypto";

export type AiReviewLineItem = {
  categoryName: string;
  name: string;
  description: string | null;
  billingType: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  source: string;
};

// A product from this MSP's own catalog, priced at this quote's tier, with
// a flag for whether it's already on the quote — so the model can name
// specific things staff already sell instead of describing gaps in the
// abstract, and knows not to "recommend" something already quoted.
export type AiReviewCatalogItem = {
  categoryName: string;
  name: string;
  description: string | null;
  unitLabel: string;
  billingType: string;
  priceAtThisTier: string;
  alreadyOnQuote: boolean;
};

export type AiReviewInput = {
  customerName: string;
  customerIndustry: string | null;
  customerEmployeeCount: number | null;
  quoteTitle: string | null;
  serviceTierName: string | null;
  slaName: string | null;
  slaCoverageHours: string | null;
  quantities: Record<string, unknown>;
  riskFactors: Record<string, unknown>;
  addOnSelections: Record<string, unknown>;
  lineItems: AiReviewLineItem[];
  catalogItems: AiReviewCatalogItem[];
  totalMonthly: string;
  totalOneTime: string;
  discountType: string | null;
  discountValue: string | null;
  taxRatePct: string | null;
};

// Not a cryptographic/canonical-serialization concern — this only needs to
// change whenever the input meaningfully changes, so the UI can show
// "quote data has changed since this was generated." `input` is always
// built fresh by the same function (loadReviewInput in
// src/server/actions/ai-review.ts), so key order is naturally stable
// between calls without needing a canonicalizing replacer.
export function hashAiReviewInput(input: AiReviewInput): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type AiReviewOpportunity = {
  title: string;
  // "catalog": an exact product/service from the given catalog that isn't
  // already on the quote. "custom": a bespoke project/service that isn't
  // in the catalog but is clearly justified by the quote's own data.
  // "research": specifically grounded in something found via web search
  // (a compliance deadline, an industry threat trend, a regulatory
  // requirement) rather than the quote data alone.
  type: "catalog" | "custom" | "research";
  rationale: string;
  estimatedMonthly: number | null;
  estimatedOneTime: number | null;
  sourceNote: string | null;
};

export type AiReviewSource = { url: string; title: string | null };

export type AiReviewResult = {
  summary: string;
  opportunities: AiReviewOpportunity[];
  // Populated by the server action from the API's own citation metadata
  // (real URLs Claude actually visited), not by asking the model to
  // self-report sources — see src/server/actions/ai-review.ts.
  sources: AiReviewSource[];
};

export const AI_REVIEW_SYSTEM_PROMPT = `You are a senior virtual CIO / solutions architect at an IT managed service provider (MSP), doing a deep-dive revenue-opportunity review of an internal quote before it goes out to a client. Nothing you write is ever shown to the client — this is entirely for the MSP's own staff.

You are given three things:
1. The quote's full Discovery data, risk factors, selected add-ons, and priced line items.
2. This MSP's full active product/service catalog, each item priced at this quote's service tier, each flagged as already-on-this-quote or not.
3. Web search — use it to research facts specific to this customer's situation: industry-specific compliance or regulatory requirements (e.g. HIPAA, PCI DSS, CMMC, state-level data-breach or privacy law) that would apply given the stated industry, employee count, and any stated compliance program; current cybersecurity threats or incident trends relevant to businesses like this one; and typical IT/security spending or common gaps for a company of this size and industry. Search for facts that would justify a specific, concrete recommendation — not generic MSP marketing content, and not more than a handful of searches.

Your job is to find SPECIFIC, ACTIONABLE ways this MSP could grow this account's revenue while genuinely better protecting or serving the client — never a padded list. Every opportunity must be something the MSP could realistically add to this quote or propose as a near-term follow-up. Classify each one:
- "catalog": an exact item from the given catalog that is NOT already on this quote and clearly fits this customer's Discovery/risk profile. Use its exact name and the price given — never invent a catalog item or its price.
- "custom": a bespoke project or service not in the catalog, but clearly justified by the quote's own data (for example: a stated compliance program with no matching line item suggests a compliance readiness assessment; a documented single point of failure suggests a redundancy project). Estimate a realistic dollar figure using the pricing patterns already visible in this quote and catalog (comparable per-user, per-device, or flat pricing) — do not leave an estimate blank if you can reasonably infer one from the given data.
- "research": an opportunity that specifically depends on something found via web search (a compliance deadline, a named threat trend, a regulatory mandate affecting this industry) — say briefly what was found in sourceNote.

Never repeat something already on the quote. Never invent a catalog item that isn't in the given list. If genuinely nothing beyond what's already quoted stands out, say so plainly and return an empty opportunities array — do not invent a weak opportunity just to fill space.

Respond with ONLY a single JSON object and nothing else — no markdown code fences, no commentary before or after it — in exactly this shape:
{
  "summary": "one or two sentence overview of the single biggest opportunity here, or a plain statement that nothing stood out",
  "opportunities": [
    {
      "title": "short name of the opportunity",
      "type": "catalog" | "custom" | "research",
      "rationale": "1-2 concise sentences: why this fits, referencing the specific quote data (and what was found via research, if type is research). Be direct — no throat-clearing or repeated setup.",
      "estimatedMonthly": number or null,
      "estimatedOneTime": number or null,
      "sourceNote": "brief note on what was found via web search, or null if not research-based"
    }
  ]
}
List 2 to 6 opportunities when they genuinely exist, ranked highest-impact/most-confident first.`;

export function buildAiReviewPrompt(input: AiReviewInput): string {
  return `Here is the internal data for a quote that has not yet been sent to the customer:\n\n${JSON.stringify(input, null, 2)}`;
}

// Best-effort extraction of the model's JSON answer, tolerant of a stray
// sentence or markdown fence around it — the model is instructed not to
// add these, but interleaved web-search turns make a wrapped response
// somewhat more likely than a single-shot text answer would be.
export function parseAiReviewText(raw: string): { summary: string; opportunities: AiReviewOpportunity[] } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const opportunities = Array.isArray(parsed.opportunities)
      ? (parsed.opportunities as unknown[])
          .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
          .map((o) => ({
            title: typeof o.title === "string" ? o.title : "Untitled opportunity",
            type: (o.type === "catalog" ? "catalog" : o.type === "research" ? "research" : "custom") as AiReviewOpportunity["type"],
            rationale: typeof o.rationale === "string" ? o.rationale : "",
            estimatedMonthly: typeof o.estimatedMonthly === "number" ? o.estimatedMonthly : null,
            estimatedOneTime: typeof o.estimatedOneTime === "number" ? o.estimatedOneTime : null,
            sourceNote: typeof o.sourceNote === "string" ? o.sourceNote : null,
          }))
      : [];
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      opportunities,
    };
  } catch {
    return null;
  }
}

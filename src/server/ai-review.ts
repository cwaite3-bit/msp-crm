// Pure content-builder for the staff-only "AI review" panel on the quote
// detail page — same "no DB access, no side effects" shape as msa.ts and
// addendum.ts. Building the review's input and hashing it is split out
// here so both the server action that actually calls the AI (needs the
// full input, to build a prompt) and the quote detail page (a server
// component that just needs to know whether a *stored* review is stale)
// can share the exact same input shape and hash, without the page having
// to make a network call just to check staleness.
//
// This is entirely staff-internal: the resulting text is never rendered
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

export const AI_REVIEW_SYSTEM_PROMPT = `You are a senior virtual CIO / solutions architect at an IT managed service provider (MSP), reviewing an internal quote before it goes out to a client. You are writing ONLY for the MSP's own staff — nothing you write will ever be shown to the client.

Given the quote's Discovery data (environment counts, risk factors), selected add-ons, and the actual line items and pricing on the quote, write exactly ONE short paragraph (3 to 6 sentences, plain prose, no bullet points, no headers, no markdown formatting) flagging anything an experienced MSP would want to double-check or consider before sending this quote out. Examples of the kind of thing worth flagging: a service commonly bundled for an environment/risk profile like this one that isn't on the quote (e.g. no backup line despite servers being present, no email security add-on despite a normal-or-higher risk profile, no compliance-related item despite a stated compliance program), an SLA that looks mismatched to the stated criticality or after-hours coverage need, a Discovery answer (legacy systems, incident history, documentation quality) that suggests more onboarding/stabilization scope than what's quoted, or a natural upsell/expansion opportunity that fits this customer's profile but isn't quoted.

Be specific to the actual numbers and answers given in the data below — never give generic advice like "consider your client's needs." If nothing stands out as a real gap or concern, say so briefly in one sentence rather than inventing one. Do not comment on internal margin or cost figures beyond what's given, do not suggest wording changes to the customer-facing document itself, and do not simply restate the quote's line items or totals back — synthesize a genuine observation, don't summarize the input.`;

export function buildAiReviewPrompt(input: AiReviewInput): string {
  return `Here is the internal data for a quote that has not yet been sent to the customer:\n\n${JSON.stringify(input, null, 2)}`;
}

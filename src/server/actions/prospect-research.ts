"use server";

// Prospects → "Research a business". Staff type a business name (+ city/
// state, optional website and "what we already know"); researchBusiness
// asks Claude — with Anthropic's server-side web_search tool — for one
// structured record, runs a live MX lookup on the business's domain, and
// checks for duplicates. Nothing is written until staff review the result
// and click Add, which calls saveResearchedProspect.
//
// Hand-rolled fetch to the Messages API rather than the SDK, same as the AI
// quote review (src/server/actions/ai-review.ts) — see that file's header.
// Content-building (prompt, parser, guards, note) is in
// src/server/prospect-research.ts.
//
// A lookup takes 30–90s. Server Actions inherit the calling page's duration
// limit, which is why src/app/(app)/prospects/page.tsx sets maxDuration.
import { db } from "@/server/db";
import { customers, contacts, notes, users } from "@/server/db/schema";
import { auth } from "@/auth";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resolveAnthropicModel } from "@/server/anthropic-model";
import { lookupEmailProvider } from "@/server/mx-lookup";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchPrompt,
  parseResearchText,
  coerceResearchRecord,
  businessDomain,
  findDuplicateMatches,
  buildResearchNote,
  employeeCountFromEstimate,
  buildContactRows,
  nextResearchId,
  RESEARCH_ID_PREFIX,
  type DuplicateMatch,
  type ResearchLookupInput,
  type ResearchResult,
  type ResearchSnapshot,
} from "@/server/prospect-research";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

// Same lead-source label on every record this feature creates, so the
// Prospects "Source" column (and any future filter) can tell them apart
// from spreadsheet imports.
const LEAD_SOURCE = "Prospect Research";

// Anthropic caps: up to 10 web searches (~$0.10 in search fees) per lookup,
// and at most a few pause_turn continuations — a long multi-search turn can
// come back paused, and the documented fix is to send it straight back.
const MAX_WEB_SEARCHES = 10;
const MAX_CONTINUATIONS = 4;
const MAX_TOKENS = 8000;

type AnthropicContentBlock = {
  type: string;
  text?: string;
  citations?: { type: string; url?: string; title?: string }[];
  [key: string]: unknown;
};
type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
};

async function loadDuplicateCandidates() {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      website: customers.website,
      phone: customers.phone,
      status: customers.status,
      archivedAt: customers.archivedAt,
    })
    .from(customers);
}

export type ResearchBusinessResponse =
  | { ok: true; result: ResearchResult; duplicates: DuplicateMatch[] }
  | { ok: false; error: string };

// Returns data instead of throwing — Next.js redacts a thrown Server Action
// error's message in production, and the dialog needs to show the real one.
export async function researchBusiness(input: ResearchLookupInput): Promise<ResearchBusinessResponse> {
  await requireUser();

  const lookup: ResearchLookupInput = {
    name: String(input.name || "").trim().slice(0, 200),
    city: String(input.city || "").trim().slice(0, 100),
    state: String(input.state || "").trim().slice(0, 50),
    website: String(input.website || "").trim().slice(0, 300),
    knownInfo: String(input.knownInfo || "").trim().slice(0, 4000),
  };
  if (!lookup.name) return { ok: false, error: "Enter a business name to research." };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Prospect research isn't configured yet — add ANTHROPIC_API_KEY in Vercel to enable it.",
    };
  }

  const model = resolveAnthropicModel();
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: buildResearchPrompt(lookup) },
  ];
  const allTextBlocks: AnthropicContentBlock[] = [];
  let finalTextBlocks: AnthropicContentBlock[] = [];

  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: RESEARCH_SYSTEM_PROMPT,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
        }),
        signal: AbortSignal.timeout(280_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300) || response.statusText}`);
      }

      const data = (await response.json()) as AnthropicMessageResponse;
      const content = data.content || [];
      const textBlocks = content.filter((b) => b.type === "text" && b.text);
      allTextBlocks.push(...textBlocks);
      if (textBlocks.length) finalTextBlocks = textBlocks;

      if (data.stop_reason === "max_tokens") {
        throw new Error("The research response was cut off before it finished (hit the output length limit) — try again.");
      }
      if (data.stop_reason === "pause_turn") {
        if (attempt >= MAX_CONTINUATIONS) {
          throw new Error("The research took too many steps to finish — try again, or add the website to narrow it down.");
        }
        // Send the paused turn straight back so Claude picks up where it
        // left off (Anthropic's documented pause_turn handling).
        messages.push({ role: "assistant", content });
        continue;
      }
      break;
    }
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "The research lookup timed out — try again."
        : err instanceof Error
          ? err.message
          : "Research failed";
    return { ok: false, error: message };
  }

  // Citation-split text blocks are pieces of one continuous answer, so
  // join with "" (a "\n" could land inside a JSON string and break it).
  const finalText = finalTextBlocks.map((b) => b.text).join("");
  const record =
    parseResearchText(finalText, lookup.name) || parseResearchText(allTextBlocks.map((b) => b.text).join(""), lookup.name);
  if (!record) {
    return { ok: false, error: "The research came back in an unexpected format — try again." };
  }

  // Real URLs Claude actually cited (from the API's citation metadata, not
  // self-reported), merged with the ones the model listed.
  const cited = allTextBlocks.flatMap((b) =>
    (b.citations || []).filter((c) => c.type === "web_search_result_location" && c.url).map((c) => c.url as string)
  );
  record.sourceUrls = Array.from(new Set([...record.sourceUrls, ...cited]));
  if (!record.primarySource && record.sourceUrls[0]) record.primarySource = record.sourceUrls[0];

  const [emailProvider, candidates] = await Promise.all([
    lookupEmailProvider(businessDomain(record)),
    loadDuplicateCandidates(),
  ]);

  return {
    ok: true,
    result: { record, emailProvider, model, researchedAt: new Date().toISOString() },
    duplicates: findDuplicateMatches(record, candidates),
  };
}

export type SaveResearchedProspectInput = {
  result: ResearchResult;
  lookup: ResearchLookupInput;
  ownerId: string | null;
  allowDuplicate: boolean;
};

export type SaveResearchedProspectResponse =
  | { ok: true; id: string; name: string; ownerId: string | null; prospectExternalId: string }
  | { ok: false; error: string; duplicates?: DuplicateMatch[] };

export async function saveResearchedProspect(input: SaveResearchedProspectInput): Promise<SaveResearchedProspectResponse> {
  const user = await requireUser();

  // Everything from the browser is re-sanitized — the dialog lets staff
  // edit the record, so it can't be trusted as-is.
  const record = coerceResearchRecord((input.result?.record ?? {}) as Record<string, unknown>);
  if (!record.companyName) return { ok: false, error: "Company name is required." };

  // A manually chosen owner always wins. The territory rule ("Assign by
  // state") only runs inside importProspects and
  // applyStateAssignmentsToExisting — which only fills NULL owners — so it
  // never overwrites the owner set here. Picking "Unassigned" leaves it
  // NULL, which lets a later "apply to existing" fill it from the rule.
  let ownerId: string | null = input.ownerId || null;
  if (ownerId) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, ownerId), eq(users.active, true)))
      .limit(1);
    if (!owner) return { ok: false, error: "That staff member isn't active — pick someone else." };
    ownerId = owner.id;
  }

  // Checked again at save time: someone may have added the same business
  // while this dialog was open.
  const duplicates = findDuplicateMatches(record, await loadDuplicateCandidates());
  if (duplicates.length && !input.allowDuplicate) {
    return {
      ok: false,
      error: "This looks like a business that's already in the CRM. Tick “different business, add it anyway” to add it.",
      duplicates,
    };
  }

  const emailProvider = input.result?.emailProvider ?? null;
  const researchedAt = input.result?.researchedAt && !Number.isNaN(Date.parse(input.result.researchedAt))
    ? input.result.researchedAt
    : new Date().toISOString();
  const lookup: ResearchLookupInput = {
    name: String(input.lookup?.name || ""),
    city: String(input.lookup?.city || ""),
    state: String(input.lookup?.state || ""),
    website: String(input.lookup?.website || ""),
    knownInfo: String(input.lookup?.knownInfo || ""),
  };

  // RS-#### allocation: next number after the highest existing one. The
  // unique index on prospect_external_id turns a simultaneous save into a
  // conflict instead of a duplicate ID, so retry a couple of times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existingIds = await db
      .select({ id: customers.prospectExternalId })
      .from(customers)
      .where(and(isNotNull(customers.prospectExternalId), like(customers.prospectExternalId, `${RESEARCH_ID_PREFIX}%`)));
    const prospectExternalId = nextResearchId(existingIds.map((r) => r.id));

    const snapshot: ResearchSnapshot = {
      record,
      emailProvider,
      model: String(input.result?.model || resolveAnthropicModel()),
      researchedAt,
      prospectExternalId,
      researchedById: user.id,
      staffContext: lookup.knownInfo.trim() || null,
      lookupInput: lookup,
    };

    try {
      const created = await db.transaction(async (tx) => {
        const [customer] = await tx
          .insert(customers)
          .values({
            name: record.companyName,
            status: "PROSPECT",
            stage: "NEW",
            source: LEAD_SOURCE,
            accountOwnerId: ownerId,
            industry: record.industry,
            website: record.website,
            phone: record.mainPhone,
            publicEmail: record.publicEmail,
            employeeCount: employeeCountFromEstimate(record.employeeEstimate),
            researchConfidence: record.confidence,
            billingStreet: record.address,
            billingCity: record.city,
            billingState: record.state,
            billingZip: record.zip,
            prospectExternalId,
            research: snapshot,
          })
          .returning({ id: customers.id });

        const contactRows = buildContactRows(record, customer.id);
        if (contactRows.length) await tx.insert(contacts).values(contactRows);

        await tx.insert(notes).values({
          customerId: customer.id,
          authorId: user.id,
          type: "NOTE",
          body: buildResearchNote(snapshot),
        });

        return customer;
      });

      revalidatePath("/prospects");
      revalidatePath("/customers");
      return { ok: true, id: created.id, name: record.companyName, ownerId, prospectExternalId };
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code === "23505" && attempt < 2) continue; // unique violation on the RS id — take the next number
      return { ok: false, error: err instanceof Error ? err.message : "Could not save this prospect." };
    }
  }
  return { ok: false, error: "Could not allocate a prospect ID — try again." };
}

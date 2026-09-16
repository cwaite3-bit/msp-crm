"use server";

// Server actions for MSA Addendums — adding services to a quote whose MSA is
// already SIGNED, without reopening or re-signing the original agreement.
// See src/server/db/schema.ts (quoteAddendums / quoteAddendumLineItems) and
// src/server/addendum.ts (the content builder / section renderer) for the
// data model and document text. This file is the DB-touching counterpart of
// those, following the exact same "use server" / {ok, error} result-object
// conventions as src/server/actions/msa.ts and quotes.ts — see msa.ts's own
// comment on why validation errors come back as data rather than thrown
// (Next.js redacts thrown Server Action errors to an opaque digest in
// production builds).
import { db } from "@/server/db";
import {
  quotes,
  customers,
  contacts,
  quoteAddendums,
  quoteAddendumLineItems,
  quoteLineItems,
  quoteEvents,
  msaDocuments,
  productCategories,
} from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, asc, desc, and } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { buildAddendumContent, type AddendumContent } from "@/server/addendum";
import { renderAddendumPdf } from "@/server/addendum-pdf";
import type { MsaSignatureInfo } from "@/server/msa-pdf";
import { getMsaSettingsPublic } from "@/server/actions/settings";
import { sendEmail } from "@/server/email";
import { notifyQuoteCreator, appUrl } from "@/server/notify";
import { recalcAndSaveTotals, resolveUnitPrice } from "@/server/actions/quotes";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

async function latestSignedMsa(quoteId: string) {
  const [doc] = await db
    .select()
    .from(msaDocuments)
    .where(and(eq(msaDocuments.quoteId, quoteId), eq(msaDocuments.status, "SIGNED")))
    .orderBy(desc(msaDocuments.createdAt))
    .limit(1);
  return doc ?? null;
}

export async function listAddendumsForQuote(quoteId: string) {
  await requireUser();
  return db.select().from(quoteAddendums).where(eq(quoteAddendums.quoteId, quoteId)).orderBy(asc(quoteAddendums.number));
}

export async function getAddendumWithLineItems(addendumId: string) {
  await requireUser();
  const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
  if (!addendum) return null;
  const lineItems = await db
    .select()
    .from(quoteAddendumLineItems)
    .where(eq(quoteAddendumLineItems.addendumId, addendumId))
    .orderBy(asc(quoteAddendumLineItems.sortOrder));
  return { addendum, lineItems };
}

// Creates a new blank (DRAFT) addendum against a quote. Gated to quotes
// whose MSA is already SIGNED — if it isn't signed yet, there's no
// executed agreement to amend, so staff should just edit the quote's own
// line items directly instead (they're still open at that point anyway).
export async function createAddendum(quoteId: string, note?: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await requireUser();
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) return { ok: false, error: "Quote not found" };
    if (quote.status !== "ACCEPTED") {
      return { ok: false, error: "Addendums are for quotes that have already been accepted and signed." };
    }
    const signedMsa = await latestSignedMsa(quoteId);
    if (!signedMsa) {
      return {
        ok: false,
        error: "This quote's Master Service Agreement hasn't been signed yet — edit the quote's line items directly until it is.",
      };
    }

    const user = await requireUser();
    const existing = await db.select().from(quoteAddendums).where(eq(quoteAddendums.quoteId, quoteId));
    const [row] = await db
      .insert(quoteAddendums)
      .values({
        quoteId,
        number: existing.length + 1,
        note: note?.trim() || null,
        createdById: user.id,
      })
      .returning();

    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the addendum" };
  }
}

// Only a DRAFT addendum can be deleted — once it's been sent (or signed),
// staff should decline/replace it deliberately rather than have it vanish
// out from under a link that may already be in the customer's inbox.
export async function deleteAddendum(addendumId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser();
    const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
    if (!addendum) return { ok: false, error: "Addendum not found" };
    if (addendum.status !== "DRAFT") {
      return { ok: false, error: "Only a draft addendum can be deleted — this one has already been sent." };
    }
    await db.delete(quoteAddendums).where(eq(quoteAddendums.id, addendumId));
    revalidatePath(`/quotes/${addendum.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the addendum" };
  }
}

async function requireEditableAddendum(addendumId: string) {
  const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
  if (!addendum) throw new Error("Addendum not found");
  if (addendum.status !== "DRAFT") {
    throw new Error("This addendum has already been sent to the customer — its line items are locked. Delete it and start a new one if it needs to change.");
  }
  return addendum;
}

export async function addAddendumLineItemFromProduct(addendumId: string, productId: string, quantity: string = "1") {
  await requireUser();
  const addendum = await requireEditableAddendum(addendumId);
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, addendum.quoteId)).limit(1);

  const { product, unitPrice } = await resolveUnitPrice(productId, quote?.serviceTierId);
  const [category] = await db.select().from(productCategories).where(eq(productCategories.id, product.categoryId)).limit(1);

  const qty = Number(quantity) || 1;
  const price = Number(unitPrice);
  const existing = await db.select().from(quoteAddendumLineItems).where(eq(quoteAddendumLineItems.addendumId, addendumId));

  await db.insert(quoteAddendumLineItems).values({
    addendumId,
    productId,
    categoryName: category?.name || "Other",
    name: product.name,
    description: product.description,
    unitLabel: product.unitLabel,
    billingType: product.billingType,
    quantity: String(qty),
    unitPrice,
    lineTotal: (qty * price).toFixed(2),
    sortOrder: existing.length,
  });

  revalidatePath(`/quotes/${addendum.quoteId}`);
}

export async function addCustomAddendumLineItem(
  addendumId: string,
  data: {
    categoryName: string;
    name: string;
    description?: string;
    unitLabel: string;
    billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
    quantity: string;
    unitPrice: string;
  }
) {
  await requireUser();
  const addendum = await requireEditableAddendum(addendumId);
  const existing = await db.select().from(quoteAddendumLineItems).where(eq(quoteAddendumLineItems.addendumId, addendumId));
  const qty = Number(data.quantity) || 1;
  const price = Number(data.unitPrice) || 0;

  await db.insert(quoteAddendumLineItems).values({
    addendumId,
    categoryName: data.categoryName,
    name: data.name,
    description: data.description || null,
    unitLabel: data.unitLabel,
    billingType: data.billingType,
    quantity: String(qty),
    unitPrice: String(price),
    lineTotal: (qty * price).toFixed(2),
    sortOrder: existing.length,
  });

  revalidatePath(`/quotes/${addendum.quoteId}`);
}

export async function updateAddendumLineItem(
  addendumId: string,
  lineItemId: string,
  data: { quantity?: string; unitPrice?: string; description?: string }
) {
  await requireUser();
  const addendum = await requireEditableAddendum(addendumId);
  const [item] = await db.select().from(quoteAddendumLineItems).where(eq(quoteAddendumLineItems.id, lineItemId)).limit(1);
  if (!item) return;
  const qty = data.quantity !== undefined ? Number(data.quantity) : Number(item.quantity);
  const price = data.unitPrice !== undefined ? Number(data.unitPrice) : Number(item.unitPrice);

  await db
    .update(quoteAddendumLineItems)
    .set({
      quantity: String(qty),
      unitPrice: String(price),
      lineTotal: (qty * price).toFixed(2),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
    })
    .where(eq(quoteAddendumLineItems.id, lineItemId));

  revalidatePath(`/quotes/${addendum.quoteId}`);
}

export async function removeAddendumLineItem(addendumId: string, lineItemId: string) {
  await requireUser();
  const addendum = await requireEditableAddendum(addendumId);
  await db.delete(quoteAddendumLineItems).where(eq(quoteAddendumLineItems.id, lineItemId));
  revalidatePath(`/quotes/${addendum.quoteId}`);
}

async function buildContentForAddendum(addendumId: string): Promise<AddendumContent> {
  const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
  if (!addendum) throw new Error("Addendum not found");
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, addendum.quoteId)).limit(1);
  if (!quote) throw new Error("Quote not found");
  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  if (!customer) throw new Error("Customer not found");
  const contact = quote.contactId ? (await db.select().from(contacts).where(eq(contacts.id, quote.contactId)).limit(1))[0] ?? null : null;
  const lineItems = await db
    .select()
    .from(quoteAddendumLineItems)
    .where(eq(quoteAddendumLineItems.addendumId, addendumId))
    .orderBy(asc(quoteAddendumLineItems.sortOrder));
  const msaSettings = await getMsaSettingsPublic();
  const signedMsa = await latestSignedMsa(addendum.quoteId);

  return buildAddendumContent({
    addendumNumber: addendum.number,
    quote: { quoteNumber: quote.quoteNumber, title: quote.title, totalMonthly: quote.totalMonthly },
    customer: {
      name: customer.name,
      billingStreet: customer.billingStreet,
      billingCity: customer.billingCity,
      billingState: customer.billingState,
      billingZip: customer.billingZip,
    },
    contact: contact ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email } : null,
    note: addendum.note,
    lineItems: lineItems.map((li) => ({
      categoryName: li.categoryName,
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unitLabel: li.unitLabel,
      billingType: li.billingType,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
    })),
    parentMsa: signedMsa
      ? {
          quoteNumber: quote.quoteNumber,
          signedAt: signedMsa.signedAt ? signedMsa.signedAt.toISOString() : signedMsa.createdAt.toISOString(),
          signedByName: signedMsa.signedByName || "",
          signedByTitle: signedMsa.signedByTitle,
        }
      : null,
    msaSettings,
  });
}

// Generates (or regenerates, while not yet signed) the addendum's document
// snapshot from its current line items. Mirrors generateMsa in msa.ts.
export async function generateAddendumDocument(addendumId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser();
    const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
    if (!addendum) return { ok: false, error: "Addendum not found" };
    if (addendum.status === "SIGNED") {
      return { ok: false, error: "This addendum has already been signed and is locked." };
    }
    if (addendum.status === "DECLINED") {
      return { ok: false, error: "This addendum was declined by the customer." };
    }
    const lineItemCount = (await db.select().from(quoteAddendumLineItems).where(eq(quoteAddendumLineItems.addendumId, addendumId))).length;
    if (lineItemCount === 0) {
      return { ok: false, error: "Add at least one line item before generating the addendum document." };
    }

    const content = await buildContentForAddendum(addendumId);
    await db.update(quoteAddendums).set({ content, updatedAt: new Date() }).where(eq(quoteAddendums.id, addendumId));
    revalidatePath(`/quotes/${addendum.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not generate the addendum" };
  }
}

export async function markAddendumSent(addendumId: string) {
  await requireUser();
  const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
  if (!addendum) throw new Error("Addendum not found");
  if (addendum.status === "DRAFT") {
    await db.update(quoteAddendums).set({ status: "SENT", sentAt: new Date() }).where(eq(quoteAddendums.id, addendumId));
    revalidatePath(`/quotes/${addendum.quoteId}`);
  }
}

export async function renderAddendumDocumentPdf(addendumId: string): Promise<Buffer> {
  const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
  if (!addendum) throw new Error("Addendum not found");
  const content = addendum.content as AddendumContent;
  const signature: MsaSignatureInfo | null =
    addendum.status === "SIGNED" && addendum.signedAt
      ? {
          signedByName: addendum.signedByName || "",
          signedByTitle: addendum.signedByTitle,
          signedAt: addendum.signedAt.toISOString(),
          signedIp: addendum.signedIp,
          signatureImageUrl: addendum.signatureImageUrl,
        }
      : null;
  return renderAddendumPdf(content, signature);
}

export async function sendAddendumEmail(addendumId: string, toEmail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser();
    const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, addendumId)).limit(1);
    if (!addendum) return { ok: false, error: "Addendum not found" };
    if (!addendum.content || Object.keys(addendum.content as object).length === 0) {
      return { ok: false, error: "Generate the addendum document before sending it." };
    }
    const content = addendum.content as AddendumContent;

    const pdf = await renderAddendumDocumentPdf(addendumId);
    const signingUrl = `${await appUrl()}/addendum/${addendum.signingToken}`;

    await sendEmail({
      to: toEmail,
      subject: `Addendum No. ${content.addendumNumber} to your Master Service Agreement — ${content.customerName} (Quote #${content.quoteNumber})`,
      html: `<p>Hi${content.contactName ? ` ${content.contactName}` : ""},</p>
<p>Attached is Addendum No. ${content.addendumNumber} to your Master Service Agreement, adding the items below to your existing agreement (Quote #${content.quoteNumber}).</p>
<p>You can review and sign it online here: <a href="${signingUrl}">${signingUrl}</a></p>
<p>Or reply to this email if you have any questions.</p>`,
      attachments: [{ filename: `Addendum-${content.addendumNumber}-Quote-${content.quoteNumber}.pdf`, content: pdf }],
    });

    await db
      .update(quoteAddendums)
      .set({ status: addendum.status === "DRAFT" ? "SENT" : addendum.status, sentAt: new Date(), sentToEmail: toEmail })
      .where(eq(quoteAddendums.id, addendumId));

    revalidatePath(`/quotes/${addendum.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send the email" };
  }
}

export async function getAddendumByToken(token: string) {
  const [doc] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.signingToken, token)).limit(1);
  if (!doc) return null;
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, doc.quoteId)).limit(1);
  return { doc, quote };
}

// Merges a signed addendum's line items onto the quote's own line items and
// recalculates the quote's cached totals — see the schema comment on
// quoteAddendums for why this happens here rather than lazily wherever the
// quote is displayed: the quote and its public page should always reflect
// everything the customer has actually agreed to, addenda included, without
// every reader needing to know to also check for signed addenda.
async function mergeAddendumOntoQuote(addendumId: string, quoteId: string) {
  const addendumLines = await db
    .select()
    .from(quoteAddendumLineItems)
    .where(eq(quoteAddendumLineItems.addendumId, addendumId))
    .orderBy(asc(quoteAddendumLineItems.sortOrder));
  const existing = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));

  for (const [i, item] of addendumLines.entries()) {
    await db.insert(quoteLineItems).values({
      quoteId,
      productId: item.productId,
      source: "MANUAL",
      addendumId,
      categoryName: item.categoryName,
      name: item.name,
      description: item.description,
      unitLabel: item.unitLabel,
      billingType: item.billingType,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      sortOrder: existing.length + i,
    });
  }

  await recalcAndSaveTotals(quoteId);
}

// signatureImageDataUri is a PNG data: URI from the canvas signature pad —
// same pattern as signMsaPublic in msa.ts. Returns a result object rather
// than throwing for the same reason documented there (thrown Server Action
// errors are redacted to an opaque digest in production).
export async function signAddendumPublic(
  token: string,
  signedByName: string,
  signedByTitle: string,
  signatureImageDataUri?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.signingToken, token)).limit(1);
    if (!addendum) return { ok: false, error: "Addendum not found" };
    if (addendum.status === "SIGNED") return { ok: true };
    if (addendum.status === "DECLINED") {
      return { ok: false, error: "This addendum was already declined. Contact your account manager if you'd like to proceed after all." };
    }
    if (!signedByName.trim()) return { ok: false, error: "Name is required" };
    if (signatureImageDataUri && !signatureImageDataUri.startsWith("data:image/")) {
      return { ok: false, error: "Invalid signature image" };
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
    const signedAt = new Date();

    await db
      .update(quoteAddendums)
      .set({
        status: "SIGNED",
        signedAt,
        signedByName,
        signedByTitle: signedByTitle || null,
        signedIp: ip,
        signatureImageUrl: signatureImageDataUri || null,
      })
      .where(eq(quoteAddendums.id, addendum.id));

    await mergeAddendumOntoQuote(addendum.id, addendum.quoteId);

    await db.insert(quoteEvents).values({
      quoteId: addendum.quoteId,
      type: "ADDENDUM_SIGNED",
      detail: `Addendum #${addendum.number} signed by ${signedByName}`,
    });

    const content = addendum.content as AddendumContent;

    // Best-effort signed-PDF attachment, same "never lose the notification
    // over a PDF render hiccup" reasoning as signMsaPublic.
    let signedPdf: Buffer | null = null;
    try {
      signedPdf = await renderAddendumPdf(content, {
        signedByName,
        signedByTitle: signedByTitle || null,
        signedAt: signedAt.toISOString(),
        signedIp: ip,
        signatureImageUrl: signatureImageDataUri || null,
      });
    } catch (err) {
      console.error(`signAddendumPublic: failed to render signed PDF for addendum ${addendum.id}:`, err);
    }

    await notifyQuoteCreator(
      addendum.quoteId,
      `Addendum #${addendum.number} signed — quote #${content.quoteNumber}`,
      `<p><strong>${signedByName}</strong>${signedByTitle ? ` (${signedByTitle})` : ""} just signed Addendum No. ${addendum.number} for quote #${content.quoteNumber} — ${content.customerName}. Its line items have been added to the quote and the quote's totals updated. You can now send this addendum's invoice to QuickBooks from the quote.</p>
<p>The fully signed copy is attached${signedPdf ? "" : " — it couldn't be generated automatically this time, but you can download it from the quote"}.</p>
<p><a href="${await appUrl()}/quotes/${addendum.quoteId}">Open the quote</a></p>`,
      signedPdf ? [{ filename: `Signed-Addendum-${addendum.number}-Quote-${content.quoteNumber}.pdf`, content: signedPdf }] : undefined
    );

    revalidatePath(`/quotes/${addendum.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit signature" };
  }
}

export async function declineAddendumPublic(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const [addendum] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.signingToken, token)).limit(1);
    if (!addendum) return { ok: false, error: "Addendum not found" };
    if (addendum.status === "SIGNED") return { ok: false, error: "This addendum has already been signed." };
    if (addendum.status === "DECLINED") return { ok: true };

    await db.update(quoteAddendums).set({ status: "DECLINED", declinedAt: new Date() }).where(eq(quoteAddendums.id, addendum.id));
    await db.insert(quoteEvents).values({ quoteId: addendum.quoteId, type: "ADDENDUM_DECLINED", detail: `Addendum #${addendum.number}` });

    const [quote] = await db.select().from(quotes).where(eq(quotes.id, addendum.quoteId)).limit(1);
    const [customer] = quote ? await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1) : [null];
    await notifyQuoteCreator(
      addendum.quoteId,
      `Addendum #${addendum.number} declined${customer ? ` — ${customer.name}` : ""}`,
      `<p>Addendum No. ${addendum.number}${quote ? ` for quote #${quote.quoteNumber}` : ""}${customer ? ` (${customer.name})` : ""} was declined by the customer.</p>
<p><a href="${await appUrl()}/quotes/${addendum.quoteId}">Open the quote</a></p>`
    );

    revalidatePath(`/quotes/${addendum.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not decline the addendum" };
  }
}

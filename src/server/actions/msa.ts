"use server";

import { db } from "@/server/db";
import { quotes, customers, contacts, serviceTiers, slas, quoteLineItems, msaDocuments, users } from "@/server/db/schema";
import { auth } from "@/auth";
import { eq, desc } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { buildMsaContent, type MsaContent } from "@/server/msa";
import { renderMsaPdf } from "@/server/msa-pdf";
import { getMsaSettingsPublic, getBillingSettingsPublic } from "@/server/actions/settings";
import { sendEmail } from "@/server/email";
import { notifyQuoteCreator, appUrl } from "@/server/notify";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

async function loadContentInputs(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) throw new Error("Quote not found");
  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  if (!customer) throw new Error("Customer not found");
  const contact = quote.contactId ? (await db.select().from(contacts).where(eq(contacts.id, quote.contactId)).limit(1))[0] ?? null : null;
  const tier = quote.serviceTierId ? (await db.select().from(serviceTiers).where(eq(serviceTiers.id, quote.serviceTierId)).limit(1))[0] ?? null : null;
  const sla = quote.slaId ? (await db.select().from(slas).where(eq(slas.id, quote.slaId)).limit(1))[0] ?? null : null;
  const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  const msaSettings = await getMsaSettingsPublic();
  const billingSettings = await getBillingSettingsPublic();
  const creator = (await db.select().from(users).where(eq(users.id, quote.createdById)).limit(1))[0] ?? null;

  return { quote, customer, contact, tier, sla, lineItems, msaSettings, billingSettings, creator };
}

async function buildContentForQuote(quoteId: string): Promise<MsaContent> {
  const { quote, customer, contact, tier, sla, lineItems, msaSettings, billingSettings, creator } = await loadContentInputs(quoteId);
  return buildMsaContent({
    quote: {
      quoteNumber: quote.quoteNumber,
      title: quote.title,
      totalMonthly: quote.totalMonthly,
      totalOneTime: quote.totalOneTime,
      validUntil: quote.validUntil,
      notesToClient: quote.notesToClient,
      billingFrequency: quote.billingFrequency,
    },
    customer: {
      name: customer.name,
      billingStreet: customer.billingStreet,
      billingCity: customer.billingCity,
      billingState: customer.billingState,
      billingZip: customer.billingZip,
    },
    contact: contact ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email } : null,
    tier: tier ? { name: tier.name, description: tier.description } : null,
    sla: sla
      ? {
          name: sla.name,
          description: sla.description,
          coverageHours: sla.coverageHours,
          uptimeGuaranteePct: sla.uptimeGuaranteePct,
          criticalResponseMinutes: sla.criticalResponseMinutes,
          highResponseMinutes: sla.highResponseMinutes,
          mediumResponseMinutes: sla.mediumResponseMinutes,
          lowResponseMinutes: sla.lowResponseMinutes,
          criticalResolutionHours: sla.criticalResolutionHours,
          highResolutionHours: sla.highResolutionHours,
          mediumResolutionHours: sla.mediumResolutionHours,
          lowResolutionHours: sla.lowResolutionHours,
          escalationProcess: sla.escalationProcess,
          exclusions: sla.exclusions,
        }
      : null,
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
    msaSettings,
    annualDiscountPct: billingSettings.annualDiscountPct,
    accountContact: creator
      ? { name: creator.name, title: creator.title, email: creator.email, phone: creator.phone, photoUrl: creator.photoUrl }
      : null,
  });
}

async function latestMsaDocument(quoteId: string) {
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.quoteId, quoteId)).orderBy(desc(msaDocuments.createdAt)).limit(1);
  return doc ?? null;
}

export async function getMsaForQuote(quoteId: string) {
  await requireUser();
  return latestMsaDocument(quoteId);
}

// Generates (or regenerates, while not yet signed) the MSA snapshot for a
// quote. Gated to ACCEPTED quotes — the whole point of the MSA here is to
// summarize what the customer actually agreed to, so generating one against
// a quote that's still being negotiated would just get regenerated (and
// potentially disagree with what a customer already signed) the moment
// anything on the quote changes.
// Returns a result object rather than throwing. Next.js redacts a thrown
// Server Action error's message in production builds (replacing it with a
// generic "Server Components render" digest, shown to the user as
// "Minified React error #441") — so an expected/validation error like
// these needs to come back as data for the client to actually see it,
// matching the {ok, error} pattern already used by pushQuoteToQuickBooks
// and setQuoteStatus. See the caller in msa-panel.tsx.
export async function generateMsa(quoteId: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await requireUser();
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) return { ok: false, error: "Quote not found" };
    if (quote.status !== "ACCEPTED") {
      return { ok: false, error: "Generate the MSA after the customer has accepted this quote — it summarizes what they agreed to." };
    }

    const existing = await latestMsaDocument(quoteId);
    if (existing?.status === "SIGNED") {
      return { ok: false, error: "This quote's MSA has already been signed and is locked. Start a new quote if the agreement needs to change." };
    }

    const content = await buildContentForQuote(quoteId);

    if (existing) {
      await db.update(msaDocuments).set({ content, updatedAt: new Date() }).where(eq(msaDocuments.id, existing.id));
      revalidatePath(`/quotes/${quoteId}`);
      return { ok: true, id: existing.id };
    }

    const [row] = await db.insert(msaDocuments).values({ quoteId, content, status: "DRAFT" }).returning();
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not generate the MSA" };
  }
}

export async function getMsaByToken(token: string) {
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.signingToken, token)).limit(1);
  if (!doc) return null;
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, doc.quoteId)).limit(1);
  return { doc, quote };
}

export async function markMsaSent(docId: string) {
  await requireUser();
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.id, docId)).limit(1);
  if (!doc) throw new Error("MSA not found");
  if (doc.status === "DRAFT") {
    await db.update(msaDocuments).set({ status: "SENT", sentAt: new Date() }).where(eq(msaDocuments.id, docId));
    revalidatePath(`/quotes/${doc.quoteId}`);
  }
}

// signatureImageDataUri is a PNG data: URI captured from the canvas
// signature pad on the public signing page (msa-sign-panel.tsx) — same
// "store the data: URI directly on the row" pattern as staff photos, since
// there's no durable file storage on Vercel's serverless filesystem.
// Returned as a result object (rather than thrown) because this runs from
// an unauthenticated public page and a thrown Server Action error gets
// redacted to an opaque digest in production — the client needs to be able
// to show *why* signing failed (e.g. a corrupt signature image).
export async function signMsaPublic(
  token: string,
  signedByName: string,
  signedByTitle: string,
  signatureImageDataUri?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.signingToken, token)).limit(1);
    if (!doc) return { ok: false, error: "Agreement not found" };
    if (doc.status === "SIGNED") return { ok: true };
    if (!signedByName.trim()) return { ok: false, error: "Name is required" };
    if (signatureImageDataUri && !signatureImageDataUri.startsWith("data:image/")) {
      return { ok: false, error: "Invalid signature image" };
    }

    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;

    await db
      .update(msaDocuments)
      .set({
        status: "SIGNED",
        signedAt: new Date(),
        signedByName,
        signedByTitle: signedByTitle || null,
        signedIp: ip,
        signatureImageUrl: signatureImageDataUri || null,
      })
      .where(eq(msaDocuments.id, doc.id));

    const content = doc.content as MsaContent;
    await notifyQuoteCreator(
      doc.quoteId,
      `MSA signed — quote #${content.quoteNumber}`,
      `<p><strong>${signedByName}</strong>${signedByTitle ? ` (${signedByTitle})` : ""} just signed the Master Service Agreement for quote #${content.quoteNumber} — ${content.customerName}. You can now send the first invoice to QuickBooks.</p>
<p><a href="${await appUrl()}/quotes/${doc.quoteId}">Open the quote</a></p>`
    );

    revalidatePath(`/quotes/${doc.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit signature" };
  }
}

// Generates the PDF for a given MSA document — signed layout if the
// document is already signed, otherwise the plain unsigned layout that's
// safe to upload to Adobe Acrobat Sign, DocuSign, or any other
// e-signature product.
export async function renderMsaDocumentPdf(docId: string): Promise<Buffer> {
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.id, docId)).limit(1);
  if (!doc) throw new Error("MSA not found");
  const content = doc.content as MsaContent;
  const signature =
    doc.status === "SIGNED" && doc.signedAt
      ? {
          signedByName: doc.signedByName || "",
          signedByTitle: doc.signedByTitle,
          signedAt: doc.signedAt.toISOString(),
          signedIp: doc.signedIp,
          signatureImageUrl: doc.signatureImageUrl,
        }
      : null;
  return renderMsaPdf(content, signature);
}

// Returns a result object rather than throwing — see generateMsa above for
// why. This is the action behind the "Send" button in msa-panel.tsx; its
// most common failure (RESEND_API_KEY not configured) needs to reach the
// user as readable text, not a redacted digest.
export async function sendMsaEmail(docId: string, toEmail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser();
    const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.id, docId)).limit(1);
    if (!doc) return { ok: false, error: "MSA not found" };
    const content = doc.content as MsaContent;

    const pdf = await renderMsaDocumentPdf(docId);
    // Was built straight off process.env.NEXT_PUBLIC_APP_URL, which is unset
    // in this deployment — that produced a bare relative link ("/msa/token",
    // no domain) in the email, which opens to a blank page from any mail
    // client since there's nothing to resolve it against. appUrl() falls
    // back to the actual request's Host header when the env var is missing.
    const signingUrl = `${await appUrl()}/msa/${doc.signingToken}`;

    await sendEmail({
      to: toEmail,
      subject: `Master Service Agreement — ${content.customerName} (Quote #${content.quoteNumber})`,
      html: `<p>Hi${content.contactName ? ` ${content.contactName}` : ""},</p>
<p>Attached is the Master Service Agreement summarizing the services agreed to in Quote #${content.quoteNumber}.</p>
<p>You can review and sign it online here: <a href="${signingUrl}">${signingUrl}</a></p>
<p>Or reply to this email if you have any questions.</p>`,
      attachments: [{ filename: `MSA-Quote-${content.quoteNumber}.pdf`, content: pdf }],
    });

    await db
      .update(msaDocuments)
      .set({ status: doc.status === "DRAFT" ? "SENT" : doc.status, sentAt: new Date(), sentToEmail: toEmail })
      .where(eq(msaDocuments.id, docId));

    revalidatePath(`/quotes/${doc.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send the email" };
  }
}

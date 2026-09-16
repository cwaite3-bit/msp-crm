// ============================================================================
// MSA Addendum generation — pure functions, no DB access (same split as
// msa.ts / pricing-rules.ts). Builds a structured snapshot (AddendumContent)
// from a quote's parent (signed) MSA + a set of new/changed line items, then
// renders that snapshot into plain sections shared by the staff preview,
// the public signing page, and the PDF export.
//
// An addendum is deliberately NOT a full re-issue of the MSA: it's a short
// document that (a) references the original signed Agreement by quote
// number and signing date, (b) states that it amends and is incorporated
// into that Agreement, and (c) itemizes only what's new or changing. The
// original MSA's terms (liability cap, termination, confidentiality, etc.)
// are untouched and still govern — see the "General" section of
// src/server/msa.ts's renderMsaSections, which already says this Agreement
// "may only be amended in a writing signed by both parties." This document
// is that writing.
//
// IMPORTANT: same disclaimer as msa.ts — this is a STARTING TEMPLATE, not
// legal advice. Have an attorney review before relying on it with a real
// customer.
// ============================================================================

import type { MsaSettings } from "./pricing-data";
import type { MsaLineItemSnapshot, MsaAccountContactSnapshot } from "./msa";
import { money } from "./msa";

export type AddendumParentMsaSnapshot = {
  quoteNumber: number;
  signedAt: string; // ISO timestamp
  signedByName: string;
  signedByTitle: string | null;
};

export type AddendumContent = {
  generatedAt: string; // ISO timestamp
  addendumNumber: number;
  quoteNumber: number;
  quoteTitle: string;
  customerName: string;
  customerAddress: string;
  contactName: string | null;
  contactEmail: string | null;
  note: string | null;
  lineItems: MsaLineItemSnapshot[];
  addedMonthly: string;
  addedOneTime: string;
  priorTotalMonthly: string;
  newTotalMonthly: string;
  parentMsa: AddendumParentMsaSnapshot | null;
  msaSettings: MsaSettings;
  accountContact: MsaAccountContactSnapshot | null;
};

export function buildAddendumContent(input: {
  addendumNumber: number;
  quote: { quoteNumber: number; title: string; totalMonthly: string };
  customer: { name: string; billingStreet: string | null; billingCity: string | null; billingState: string | null; billingZip: string | null };
  contact: { firstName: string; lastName: string; email: string | null } | null;
  note: string | null;
  lineItems: MsaLineItemSnapshot[];
  parentMsa: AddendumParentMsaSnapshot | null;
  msaSettings: MsaSettings;
  accountContact?: MsaAccountContactSnapshot | null;
}): AddendumContent {
  const { addendumNumber, quote, customer, contact, note, lineItems, parentMsa, msaSettings, accountContact = null } = input;

  const addressParts = [customer.billingStreet, customer.billingCity, customer.billingState, customer.billingZip].filter(Boolean);

  let addedMonthly = 0;
  let addedOneTime = 0;
  for (const li of lineItems) {
    const total = Number(li.lineTotal);
    if (li.billingType === "ONE_TIME") addedOneTime += total;
    else addedMonthly += total; // RECURRING_MONTHLY and HOURLY both fold into "monthly" here, same bucketing as pricing.ts
  }

  const priorTotalMonthly = Number(quote.totalMonthly);

  return {
    generatedAt: new Date().toISOString(),
    addendumNumber,
    quoteNumber: quote.quoteNumber,
    quoteTitle: quote.title,
    customerName: customer.name,
    customerAddress: addressParts.join(", "),
    contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
    contactEmail: contact?.email ?? null,
    note,
    lineItems,
    addedMonthly: addedMonthly.toFixed(2),
    addedOneTime: addedOneTime.toFixed(2),
    priorTotalMonthly: priorTotalMonthly.toFixed(2),
    newTotalMonthly: (priorTotalMonthly + addedMonthly).toFixed(2),
    parentMsa,
    msaSettings,
    accountContact,
  };
}

export type AddendumSection = {
  heading: string;
  paragraphs: string[];
  table?: { headers: string[]; rows: string[][] };
};

export function renderAddendumSections(content: AddendumContent): AddendumSection[] {
  const s = content.msaSettings;
  const providerName = s.providerLegalName || "[Provider legal name — set in Settings, MSA terms]";
  const governingState = s.governingLawState || "[Governing law state — set in Settings, MSA terms]";
  const effectiveDate = new Date(content.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const sections: AddendumSection[] = [];

  const parentReference = content.parentMsa
    ? `the Master Service Agreement entered into between ${providerName} ("Provider") and ${content.customerName} ("Client") in connection with Quote #${content.parentMsa.quoteNumber}, signed by ${content.parentMsa.signedByName}${content.parentMsa.signedByTitle ? `, ${content.parentMsa.signedByTitle}` : ""} on ${new Date(content.parentMsa.signedAt).toLocaleDateString()} (the "Agreement")`
    : `the Master Service Agreement referencing Quote #${content.quoteNumber} between ${providerName} ("Provider") and ${content.customerName} ("Client") (the "Agreement")`;

  sections.push({
    heading: `Addendum No. ${content.addendumNumber} to the Master Service Agreement`,
    paragraphs: [
      `This Addendum No. ${content.addendumNumber} ("Addendum"), effective as of ${effectiveDate} ("Addendum Effective Date"), amends and is incorporated into ${parentReference}.`,
      "This Addendum modifies the Agreement only to the extent set out below. All other terms and conditions of the Agreement — including its liability cap, confidentiality, termination, and dispute-resolution provisions — remain unchanged and in full force and effect. Capitalized terms not defined in this Addendum have the meaning given to them in the Agreement.",
    ],
  });

  sections.push({
    heading: "What's Changing",
    paragraphs: [
      ...(content.note ? [content.note] : []),
      "Effective as of the Addendum Effective Date, the following services/items are added to the scope of the Agreement:",
    ],
    table:
      content.lineItems.length > 0
        ? {
            headers: ["Item", "Description", "Qty", "Unit price", "Total"],
            rows: content.lineItems.map((li) => [
              li.name,
              li.description || "—",
              `${li.quantity} ${li.unitLabel}`,
              `${money(li.unitPrice)}${li.billingType === "RECURRING_MONTHLY" ? "/mo" : li.billingType === "HOURLY" ? "/hr" : ""}`,
              money(li.lineTotal),
            ]),
          }
        : undefined,
  });

  const monthlyDelta = Number(content.addedMonthly);
  const oneTimeDelta = Number(content.addedOneTime);
  const feesParagraphs: string[] = [];
  if (monthlyDelta > 0) {
    feesParagraphs.push(
      `This Addendum adds ${money(content.addedMonthly)}/month to Client's recurring fees under the Agreement, bringing Client's total recurring fee to ${money(content.newTotalMonthly)}/month going forward.`
    );
  }
  if (oneTimeDelta > 0) {
    feesParagraphs.push(`This Addendum also adds a one-time fee of ${money(content.addedOneTime)}, due per the Agreement's existing payment terms.`);
  }
  if (feesParagraphs.length === 0) {
    feesParagraphs.push("This Addendum does not change Client's fees under the Agreement.");
  }
  feesParagraphs.push(
    `All fees under this Addendum are billed under the same payment terms, due dates, and late-fee provisions already set out in the Agreement (invoices due within ${s.paymentDueDays} days of the invoice date).`
  );

  sections.push({
    heading: "Updated Fees",
    paragraphs: feesParagraphs,
  });

  sections.push({
    heading: "Governing Agreement",
    paragraphs: [
      `Except as expressly modified by this Addendum, the Agreement remains unchanged and in full force and effect, and is governed by the laws of the State of ${governingState}, without regard to its conflict-of-laws principles. In the event of a conflict between this Addendum and the Agreement, this Addendum controls solely with respect to the changes described above.`,
    ],
  });

  sections.push({
    heading: "Signatures",
    paragraphs: ["By signing below, each party's representative confirms they are authorized to bind that party to this Addendum."],
  });

  return sections.map((section, i) => ({ ...section, heading: `${i + 1}. ${section.heading}` }));
}

// Fabricated placeholder content for a "Preview" affordance, mirroring
// buildSampleMsaContent in msa.ts — not currently wired to a UI button, but
// kept available/exported for consistency and possible future use (e.g. a
// "Preview addendum" button in Settings). Never written to the database.
export function buildSampleAddendumContent(msaSettings: MsaSettings): AddendumContent {
  return {
    generatedAt: new Date().toISOString(),
    addendumNumber: 1,
    quoteNumber: 1000,
    quoteTitle: "Sample Managed Services Quote",
    customerName: "Sample Customer, Inc.",
    customerAddress: "123 Main St, Anytown, ST 00000",
    contactName: "Jane Doe",
    contactEmail: "jane.doe@samplecustomer.com",
    note: "Add managed backup for 2 new servers.",
    lineItems: [
      {
        categoryName: "Managed Services",
        name: "Managed Backup — Server",
        description: "Daily backup, monitoring, and quarterly restore test.",
        quantity: "2",
        unitLabel: "server",
        billingType: "RECURRING_MONTHLY",
        unitPrice: "35.00",
        lineTotal: "70.00",
      },
    ],
    addedMonthly: "70.00",
    addedOneTime: "0.00",
    priorTotalMonthly: "1575.00",
    newTotalMonthly: "1645.00",
    parentMsa: {
      quoteNumber: 1000,
      signedAt: new Date().toISOString(),
      signedByName: "Jane Doe",
      signedByTitle: "Operations Manager",
    },
    msaSettings,
    accountContact: null,
  };
}

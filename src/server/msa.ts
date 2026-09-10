// ============================================================================
// Master Service Agreement generation — pure functions, no DB access (same
// "engine has no DB access, callers wire it to data" split as pricing-rules.ts
// / pricing-data.ts). Builds a structured snapshot (MsaContent) from a
// quote + its tier/SLA/line items + the standing MSA terms (Settings → MSA
// terms), then renders that snapshot into plain sections shared by the
// staff preview, the public signing page, and the PDF export — one source
// of text, three renderers.
//
// IMPORTANT: this produces a STARTING TEMPLATE, not legal advice. The
// clauses below (liability cap, indemnification, termination, etc.) are
// typical of real MSP agreements but must be reviewed by an attorney
// licensed in your state before you rely on them with an actual customer.
// The generated document and every page that shows it says so explicitly.
// ============================================================================

import type { MsaSettings, SeverityLevel } from "./pricing-data";
import { SEVERITY_LABELS, SEVERITY_LEVELS } from "./pricing-data";

export type MsaLineItemSnapshot = {
  categoryName: string;
  name: string;
  description: string | null;
  quantity: string;
  unitLabel: string;
  billingType: "RECURRING_MONTHLY" | "ONE_TIME" | "HOURLY";
  unitPrice: string;
  lineTotal: string;
};

export type MsaSlaSnapshot = {
  name: string;
  description: string | null;
  coverageHours: string;
  uptimeGuaranteePct: string;
  severities: { level: SeverityLevel; label: string; responseMinutes: number; resolutionHours: number }[];
  escalationProcess: string | null;
  exclusions: string | null;
};

export type MsaContent = {
  generatedAt: string; // ISO timestamp
  quoteNumber: number;
  quoteTitle: string;
  customerName: string;
  customerAddress: string;
  contactName: string | null;
  contactEmail: string | null;
  tierName: string | null;
  tierDescription: string | null;
  sla: MsaSlaSnapshot | null;
  lineItems: MsaLineItemSnapshot[];
  totalMonthly: string;
  totalOneTime: string;
  validUntil: string | null;
  notesToClient: string | null;
  msaSettings: MsaSettings;
};

export function buildMsaContent(input: {
  quote: { quoteNumber: number; title: string; totalMonthly: string; totalOneTime: string; validUntil: Date | null; notesToClient: string | null };
  customer: { name: string; billingStreet: string | null; billingCity: string | null; billingState: string | null; billingZip: string | null };
  contact: { firstName: string; lastName: string; email: string | null } | null;
  tier: { name: string; description: string | null } | null;
  sla:
    | {
        name: string;
        description: string | null;
        coverageHours: string;
        uptimeGuaranteePct: string;
        criticalResponseMinutes: number;
        highResponseMinutes: number;
        mediumResponseMinutes: number;
        lowResponseMinutes: number;
        criticalResolutionHours: number;
        highResolutionHours: number;
        mediumResolutionHours: number;
        lowResolutionHours: number;
        escalationProcess: string | null;
        exclusions: string | null;
      }
    | null;
  lineItems: MsaLineItemSnapshot[];
  msaSettings: MsaSettings;
}): MsaContent {
  const { quote, customer, contact, tier, sla, lineItems, msaSettings } = input;

  const addressParts = [customer.billingStreet, customer.billingCity, customer.billingState, customer.billingZip].filter(Boolean);

  const severities = sla
    ? SEVERITY_LEVELS.map((level) => {
        const responseMinutes =
          level === "critical" ? sla.criticalResponseMinutes : level === "high" ? sla.highResponseMinutes : level === "medium" ? sla.mediumResponseMinutes : sla.lowResponseMinutes;
        const resolutionHours =
          level === "critical" ? sla.criticalResolutionHours : level === "high" ? sla.highResolutionHours : level === "medium" ? sla.mediumResolutionHours : sla.lowResolutionHours;
        return { level, label: SEVERITY_LABELS[level], responseMinutes, resolutionHours };
      })
    : [];

  return {
    generatedAt: new Date().toISOString(),
    quoteNumber: quote.quoteNumber,
    quoteTitle: quote.title,
    customerName: customer.name,
    customerAddress: addressParts.join(", "),
    contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
    contactEmail: contact?.email ?? null,
    tierName: tier?.name ?? null,
    tierDescription: tier?.description ?? null,
    sla: sla
      ? {
          name: sla.name,
          description: sla.description,
          coverageHours: sla.coverageHours,
          uptimeGuaranteePct: sla.uptimeGuaranteePct,
          severities,
          escalationProcess: sla.escalationProcess,
          exclusions: sla.exclusions,
        }
      : null,
    lineItems,
    totalMonthly: quote.totalMonthly,
    totalOneTime: quote.totalOneTime,
    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
    notesToClient: quote.notesToClient,
    msaSettings,
  };
}

export type MsaSection = {
  heading: string;
  paragraphs: string[];
  table?: { headers: string[]; rows: string[][] };
};

function money(v: string | number) {
  const n = Number(v);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMinutes(m: number) {
  if (m < 60) return `${m} minutes`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? "" : "s"}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtHours(h: number) {
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  if (h % 24 === 0) return `${h / 24} business day${h / 24 === 1 ? "" : "s"}`;
  return `${h} hours`;
}

function liabilityCapText(content: MsaContent) {
  const s = content.msaSettings;
  if (s.liabilityCapType === "FIXED_AMOUNT") {
    return money(s.liabilityCapFixedAmount);
  }
  return `an amount equal to the fees paid by Client to Provider in the ${s.liabilityCapMonths} month${s.liabilityCapMonths === 1 ? "" : "s"} immediately preceding the event giving rise to the claim`;
}

// Renders the MSA's substantive text into sections shared by the staff
// preview page, the public signing page, and the PDF export. Provider
// identity/state fields left blank in Settings render as bracketed
// placeholders so a generated document is never silently missing them.
export function renderMsaSections(content: MsaContent): MsaSection[] {
  const s = content.msaSettings;
  const providerName = s.providerLegalName || "[Provider legal name — set in Settings, MSA terms]";
  const providerAddress = s.providerAddress || "[Provider address — set in Settings, MSA terms]";
  const governingState = s.governingLawState || "[Governing law state — set in Settings, MSA terms]";
  const effectiveDate = new Date(content.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  // Headings are pushed WITHOUT a leading number — numbers are assigned by
  // position after the full list is built (see the numbering pass below),
  // so a section can be inserted or removed without hand-renumbering every
  // section after it.
  const sections: MsaSection[] = [];

  sections.push({
    heading: "Parties & Effective Date",
    paragraphs: [
      `This Master Service Agreement ("Agreement") is entered into as of ${effectiveDate} ("Effective Date") between ${providerName} ("Provider"), located at ${providerAddress}, and ${content.customerName} ("Client")${content.customerAddress ? `, located at ${content.customerAddress}` : ""}.`,
      `This Agreement incorporates by reference Quote #${content.quoteNumber} (${content.quoteTitle}) and any attached Statement(s) of Work, which together set out the specific services, quantities, and pricing Client has agreed to.`,
    ],
  });

  sections.push({
    heading: "Term & Renewal",
    paragraphs: [
      `This Agreement begins on the Effective Date and continues for an initial term of ${s.initialTermMonths} month${s.initialTermMonths === 1 ? "" : "s"} ("Initial Term").`,
      s.autoRenew
        ? `Following the Initial Term, this Agreement automatically renews for successive ${s.renewalTermMonths}-month terms unless either party gives written notice of non-renewal at least ${s.nonRenewalNoticeDays} days before the end of the then-current term.`
        : `This Agreement does not automatically renew. Continued service beyond the Initial Term requires a new written agreement between the parties.`,
    ],
  });

  const tierLine = content.tierName ? `Client's selected service plan is ${content.tierName}${content.tierDescription ? ` (${content.tierDescription})` : ""}.` : null;
  sections.push({
    heading: "Services & Scope",
    paragraphs: [
      "Provider will provide the managed services, licensing, and other items described in Quote #" + content.quoteNumber + ", summarized below. Services not itemized in the quote are outside the scope of this Agreement and, if requested, will be separately scoped and quoted as additional work.",
      ...(tierLine ? [tierLine] : []),
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

  sections.push({
    heading: "Fees & Payment Terms",
    paragraphs: [
      `Client agrees to pay the recurring monthly fee of ${money(content.totalMonthly)}${Number(content.totalOneTime) > 0 ? `, plus one-time fees of ${money(content.totalOneTime)}` : ""}, as itemized above.`,
      `Invoices are due within ${s.paymentDueDays} days of the invoice date. Amounts not paid when due accrue a late fee of ${s.lateFeePct}% per month on the outstanding balance, or the maximum rate permitted by law, whichever is lower.`,
      s.annualPriceIncreaseCapPct > 0
        ? `Provider may increase recurring fees effective at each renewal term, not to exceed ${s.annualPriceIncreaseCapPct}% per year, on at least 30 days' written notice.`
        : `Provider may increase recurring fees effective at each renewal term on at least 30 days' written notice.`,
      `If any amount remains unpaid more than ${s.suspensionForNonPaymentDays} days past its due date, Provider may suspend the services (in whole or in part) upon written notice to Client, without liability to Provider, until the account is brought current.`,
    ],
  });

  if (content.sla) {
    const sla = content.sla;
    sections.push({
      heading: "Service Level Agreement",
      paragraphs: [
        `Provider will respond to and work to resolve support requests according to the "${sla.name}" service level${sla.description ? ` — ${sla.description}` : ""}.`,
        `Coverage hours: ${sla.coverageHours}. Uptime guarantee for Provider-managed infrastructure under Provider's direct control: ${sla.uptimeGuaranteePct}%.`,
        ...(sla.escalationProcess ? [`Escalation process: ${sla.escalationProcess}`] : []),
        ...(sla.exclusions ? [`Exclusions: ${sla.exclusions}`] : []),
      ],
      table: {
        headers: ["Severity", "Definition", "Target response time", "Target resolution time"],
        rows: sla.severities.map((sev) => [sev.label, "", fmtMinutes(sev.responseMinutes), fmtHours(sev.resolutionHours)]),
      },
    });
  }

  sections.push({
    heading: "Client Responsibilities",
    paragraphs: [
      "Client will provide Provider with reasonable access to Client's systems, personnel, and information necessary to deliver the services; designate a primary point of contact authorized to make decisions on Client's behalf; maintain appropriate licensing for any third-party software not provided by Provider; and use the services in compliance with applicable law. Delays caused by Client's failure to provide required access or information do not count against any response or resolution target above.",
    ],
  });

  sections.push({
    heading: "Third-Party Products & Services",
    paragraphs: [s.thirdPartyDisclaimerSummary],
  });

  sections.push({
    heading: "Confidentiality",
    paragraphs: [
      `Each party will protect the other's confidential information with the same degree of care it uses for its own confidential information of similar importance, and will not disclose it to third parties except as needed to perform this Agreement or as required by law. This obligation survives termination of this Agreement for ${s.confidentialityYears} year${s.confidentialityYears === 1 ? "" : "s"}.`,
    ],
  });

  sections.push({
    heading: "Data Protection & Security",
    paragraphs: [s.dataProtectionSummary],
  });

  sections.push({
    heading: "Intellectual Property",
    paragraphs: [s.ipOwnershipSummary],
  });

  sections.push({
    heading: "Insurance",
    paragraphs: [s.insuranceRequirementSummary],
  });

  sections.push({
    heading: "Warranties & Disclaimer",
    paragraphs: [s.warrantyDisclaimerSummary],
  });

  sections.push({
    heading: "Security Disclaimer",
    paragraphs: [s.securityDisclaimerSummary],
  });

  sections.push({
    heading: "Limitation of Liability",
    paragraphs: [
      `EXCEPT FOR EACH PARTY'S INDEMNIFICATION OBLIGATIONS AND BREACHES OF CONFIDENTIALITY, EACH PARTY'S TOTAL LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT WILL NOT EXCEED ${liabilityCapText(content).toUpperCase()}.`,
      ...(s.excludesConsequentialDamages
        ? [
            "NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, OR LOST BUSINESS OPPORTUNITY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.",
          ]
        : []),
    ],
  });

  sections.push({
    heading: "Indemnification",
    paragraphs: [
      "Each party will indemnify, defend, and hold harmless the other party from third-party claims arising from its own gross negligence, willful misconduct, or infringement of a third party's intellectual property rights.",
      s.clientIndemnitySummary,
    ],
  });

  const terminationForConvenienceParagraph =
    s.terminationForConvenienceDirection === "PROVIDER_ONLY"
      ? `Provider may terminate this Agreement for convenience on at least ${s.terminationForConvenienceNoticeDays} days' written notice to Client. Client may not terminate this Agreement for convenience; Client may still terminate for cause as described below.`
      : s.terminationForConvenienceDirection === "CLIENT_ONLY"
        ? `Client may terminate this Agreement for convenience on at least ${s.terminationForConvenienceNoticeDays} days' written notice to Provider. Provider may not terminate this Agreement for convenience; Provider may still terminate for cause as described below.`
        : `Either party may terminate this Agreement for convenience on at least ${s.terminationForConvenienceNoticeDays} days' written notice to the other party.`;

  sections.push({
    heading: "Termination",
    paragraphs: [
      terminationForConvenienceParagraph,
      `Either party may terminate this Agreement immediately for cause if the other party materially breaches this Agreement and fails to cure that breach within ${s.terminationForCauseCureDays} days of written notice describing the breach.`,
      "Upon termination, Client remains responsible for all fees accrued through the termination date, and Provider will reasonably cooperate with an orderly transition of services at Client's request and expense, at Provider's then-current professional services rate unless otherwise agreed in writing.",
    ],
  });

  sections.push({
    heading: "Force Majeure",
    paragraphs: [
      "Neither party is liable for any failure or delay in performance caused by events beyond its reasonable control, including natural disaster, act of government, labor dispute, internet or utility failure, or act of a third-party vendor.",
    ],
  });

  sections.push({
    heading: "Dispute Resolution & Governing Law",
    paragraphs: [s.disputeResolutionSummary, `This Agreement is governed by the laws of the State of ${governingState}, without regard to its conflict-of-laws principles.`],
  });

  sections.push({
    heading: "General",
    paragraphs: [
      s.independentContractorSummary,
      s.subcontractorsSummary,
      "Neither party may assign this Agreement without the other's written consent, except to a successor in a merger, acquisition, or sale of substantially all assets. Neither party will, during the term of this Agreement and for one year after, solicit for hire the other party's employees who were directly involved in performing this Agreement, without that party's written consent. All notices under this Agreement must be in writing and delivered to the addresses above (or a designated contact's email address on file). If any provision of this Agreement is held unenforceable, the remaining provisions remain in full effect. This Agreement, together with the referenced Quote and any Statement(s) of Work, is the entire agreement between the parties regarding its subject matter and supersedes all prior discussions or agreements on that subject. It may only be amended in a writing signed by both parties.",
    ],
  });

  sections.push({
    heading: "Signatures",
    paragraphs: [
      "By signing below, each party's representative confirms they are authorized to bind that party to this Agreement.",
    ],
  });

  return sections.map((section, i) => ({ ...section, heading: `${i + 1}. ${section.heading}` }));
}

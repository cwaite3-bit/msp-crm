// Run with: npx tsx --test src/server/msa.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMsaContent, renderMsaSections } from "./msa";
import { DEFAULT_MSA_SETTINGS } from "./pricing-data";

const baseQuote = {
  quoteNumber: 42,
  title: "MSP Services Quote",
  totalMonthly: "1500.00",
  totalOneTime: "500.00",
  validUntil: null,
  notesToClient: null,
};

const baseCustomer = {
  name: "Acme Corp",
  billingStreet: "123 Main St",
  billingCity: "Springfield",
  billingState: "OH",
  billingZip: "45501",
};

const baseSla = {
  name: "Priority (Business Hours + Emergency)",
  description: "Faster targets with 24x7 emergency coverage.",
  coverageHours: "Business Hours + 24x7 Emergency",
  uptimeGuaranteePct: "99.90",
  criticalResponseMinutes: 15,
  highResponseMinutes: 30,
  mediumResponseMinutes: 120,
  lowResponseMinutes: 240,
  criticalResolutionHours: 4,
  highResolutionHours: 6,
  mediumResolutionHours: 16,
  lowResolutionHours: 24,
  escalationProcess: "Escalates to a senior engineer if unresolved within target.",
  exclusions: "Third-party vendor outages excluded.",
};

test("buildMsaContent maps SLA severities in critical/high/medium/low order with the right minutes/hours", () => {
  const content = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
    tier: { name: "Silver", description: "Managed Complete" },
    sla: baseSla,
    lineItems: [],
    msaSettings: DEFAULT_MSA_SETTINGS,
  });

  assert.equal(content.sla?.severities.length, 4);
  assert.deepEqual(
    content.sla?.severities.map((s) => s.level),
    ["critical", "high", "medium", "low"]
  );
  assert.equal(content.sla?.severities[0].responseMinutes, 15);
  assert.equal(content.sla?.severities[0].resolutionHours, 4);
  assert.equal(content.sla?.severities[3].responseMinutes, 240);
  assert.equal(content.contactName, "Jane Doe");
  assert.equal(content.customerAddress, "123 Main St, Springfield, OH, 45501");
});

test("buildMsaContent with no SLA/tier/contact produces null fields, not throwing", () => {
  const content = buildMsaContent({
    quote: baseQuote,
    customer: { name: "Acme Corp", billingStreet: null, billingCity: null, billingState: null, billingZip: null },
    contact: null,
    tier: null,
    sla: null,
    lineItems: [],
    msaSettings: DEFAULT_MSA_SETTINGS,
  });

  assert.equal(content.sla, null);
  assert.equal(content.tierName, null);
  assert.equal(content.contactName, null);
  assert.equal(content.customerAddress, "");
});

test("renderMsaSections includes an SLA section with a 4-row severity table only when an SLA is attached", () => {
  const withSla = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: null,
    tier: null,
    sla: baseSla,
    lineItems: [],
    msaSettings: DEFAULT_MSA_SETTINGS,
  });
  const withoutSla = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: null,
    tier: null,
    sla: null,
    lineItems: [],
    msaSettings: DEFAULT_MSA_SETTINGS,
  });

  const slaSection = renderMsaSections(withSla).find((s) => s.heading.includes("Service Level Agreement"));
  assert.ok(slaSection, "expected an SLA section when a quote has an SLA attached");
  assert.equal(slaSection?.table?.rows.length, 4);

  const noSlaSection = renderMsaSections(withoutSla).find((s) => s.heading.includes("Service Level Agreement"));
  assert.equal(noSlaSection, undefined);
});

test("renderMsaSections' limitation-of-liability section reflects a fixed-amount cap", () => {
  const content = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: null,
    tier: null,
    sla: null,
    lineItems: [],
    msaSettings: { ...DEFAULT_MSA_SETTINGS, liabilityCapType: "FIXED_AMOUNT", liabilityCapFixedAmount: 10000 },
  });
  const section = renderMsaSections(content).find((s) => s.heading.includes("Limitation of Liability"));
  assert.ok(section?.paragraphs[0].includes("$10,000.00"));
});

test("renderMsaSections' liability section reflects a fees-paid multiple when that cap type is used", () => {
  const content = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: null,
    tier: null,
    sla: null,
    lineItems: [],
    msaSettings: { ...DEFAULT_MSA_SETTINGS, liabilityCapType: "FEES_PAID_MULTIPLE", liabilityCapMonths: 6 },
  });
  const section = renderMsaSections(content).find((s) => s.heading.includes("Limitation of Liability"));
  assert.ok(section?.paragraphs[0].toUpperCase().includes("6 MONTHS"));
});

test("renderMsaSections' termination section reflects the configured direction", () => {
  const both = renderMsaSections(
    buildMsaContent({ quote: baseQuote, customer: baseCustomer, contact: null, tier: null, sla: null, lineItems: [], msaSettings: DEFAULT_MSA_SETTINGS })
  ).find((s) => s.heading.includes("Termination"));
  assert.ok(both?.paragraphs[0].startsWith("Either party may terminate"));

  const providerOnly = renderMsaSections(
    buildMsaContent({
      quote: baseQuote,
      customer: baseCustomer,
      contact: null,
      tier: null,
      sla: null,
      lineItems: [],
      msaSettings: { ...DEFAULT_MSA_SETTINGS, terminationForConvenienceDirection: "PROVIDER_ONLY" },
    })
  ).find((s) => s.heading.includes("Termination"));
  assert.ok(providerOnly?.paragraphs[0].startsWith("Provider may terminate"));
  assert.ok(providerOnly?.paragraphs[0].includes("Client may not terminate"));

  const clientOnly = renderMsaSections(
    buildMsaContent({
      quote: baseQuote,
      customer: baseCustomer,
      contact: null,
      tier: null,
      sla: null,
      lineItems: [],
      msaSettings: { ...DEFAULT_MSA_SETTINGS, terminationForConvenienceDirection: "CLIENT_ONLY" },
    })
  ).find((s) => s.heading.includes("Termination"));
  assert.ok(clientOnly?.paragraphs[0].startsWith("Client may terminate"));
  assert.ok(clientOnly?.paragraphs[0].includes("Provider may not terminate"));
});

test("renderMsaSections includes the Provider-protection sections (warranty/security disclaimers, client indemnity, third-party disclaimer)", () => {
  const content = buildMsaContent({ quote: baseQuote, customer: baseCustomer, contact: null, tier: null, sla: null, lineItems: [], msaSettings: DEFAULT_MSA_SETTINGS });
  const sections = renderMsaSections(content);

  const warranty = sections.find((s) => s.heading.includes("Warranties & Disclaimer"));
  assert.ok(warranty?.paragraphs[0].includes("DISCLAIMS ALL OTHER WARRANTIES"));

  const security = sections.find((s) => s.heading.includes("Security Disclaimer"));
  assert.ok(security?.paragraphs[0].includes("does not guarantee"));

  const thirdParty = sections.find((s) => s.heading.includes("Third-Party Products"));
  assert.ok(thirdParty?.paragraphs[0].includes("not responsible for the acts, omissions"));

  const indemnification = sections.find((s) => s.heading.includes("Indemnification"));
  assert.equal(indemnification?.paragraphs.length, 2);
  assert.ok(indemnification?.paragraphs[1].includes("Client will indemnify"));

  const general = sections.find((s) => s.heading.includes("General"));
  assert.ok(general?.paragraphs.some((p) => p.includes("independent contractor")));
  assert.ok(general?.paragraphs.some((p) => p.includes("subcontractors")));
});

test("renderMsaSections numbers sections sequentially by position, so inserting a new section never collides with another's number", () => {
  const content = buildMsaContent({ quote: baseQuote, customer: baseCustomer, contact: null, tier: null, sla: baseSla, lineItems: [], msaSettings: DEFAULT_MSA_SETTINGS });
  const sections = renderMsaSections(content);
  const numbers = sections.map((s) => Number(s.heading.split(".")[0]));
  assert.deepEqual(numbers, sections.map((_, i) => i + 1));
  assert.equal(sections[sections.length - 1].heading.includes("Signatures"), true);
});

test("renderMsaSections' services table lists every line item with its total", () => {
  const content = buildMsaContent({
    quote: baseQuote,
    customer: baseCustomer,
    contact: null,
    tier: null,
    sla: null,
    lineItems: [
      { categoryName: "Support", name: "User support", description: "Help desk", quantity: "10", unitLabel: "per user", billingType: "RECURRING_MONTHLY", unitPrice: "85.00", lineTotal: "850.00" },
      { categoryName: "Network", name: "Firewall management", description: null, quantity: "1", unitLabel: "per firewall", billingType: "RECURRING_MONTHLY", unitPrice: "150.00", lineTotal: "150.00" },
    ],
    msaSettings: DEFAULT_MSA_SETTINGS,
  });
  const servicesSection = renderMsaSections(content).find((s) => s.heading.includes("Services & Scope"));
  assert.equal(servicesSection?.table?.rows.length, 2);
  assert.ok(servicesSection?.table?.rows[0].includes("$850.00"));
});

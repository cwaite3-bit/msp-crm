// ============================================================================
// Default pricing rate card, scope matrix, and pre-quote checklist template.
//
// Ported verbatim from "Lockdown IT | Internal Pricing Assumptions",
// "Scope Matrix", and "Pre-Quote Checklist" — the sheets in
// Lockdown_IT_Fully_Automated_Quote_Builder_v4_Price_Scaling_MASTER.xlsx.
// These are the values seeded into `app_settings` on first run; from then
// on the live values in the database (editable from Settings → Rate card /
// Scope matrix) are the source of truth, not this file. Keep this file as
// the documented "factory reset" baseline.
// ============================================================================

export const TIER_KEYS = ["bronze", "silver", "gold"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_LABELS: Record<TierKey, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

// Maps a service_tiers.name value back to a rate-card tier key, e.g. for
// resolving which pricing-engine tier a quote's selected serviceTierId
// corresponds to. Case-insensitive; returns null for anything that isn't
// one of the 3 Bronze/Silver/Gold tiers (e.g. a custom tier an admin added).
export function tierKeyFromName(name: string | null | undefined): TierKey | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return (TIER_KEYS as readonly string[]).includes(normalized) ? (normalized as TierKey) : null;
}

export type TierRateCard = {
  // $/unit/month sell price for the base recurring plan
  workstationMrr: number;
  serverMrr: number;
  firewallMrr: number;
  switchMrr: number;
  apMrr: number;
  locationMrr: number;
  userMrr: number;

  // $/unit/month direct (internal) cost, for margin math
  directCostPerWorkstation: number;
  directCostPerServer: number;
  directCostPerNetworkDevice: number; // covers firewalls+switches+APs+other network devices
  directCostPerUser: number;
  directCostPerLocation: number;

  vcioIncludedHoursPerMonth: number;
  additionalVcioRatePerHour: number;
  professionalServicesRatePerHour: number;

  targetGrossMarginPct: number; // 0-1
  minimumMrr: number; // floor after scaling
  planPriceScale: number; // 1 = 100% of rate card; master control per tier

  onboardingHoursPerWorkstation: number;
  onboardingHoursPerServer: number;
  onboardingHoursPerNetworkDevice: number;
  onboardingHoursPerLocation: number;
  onboardingLaborCostPerHour: number; // internal cost
  onboardingSellRatePerHour: number; // customer-facing rate
};

// Sell + direct-cost pair, shared across all 3 tiers (the workbook does not
// scale these by plan — only the base recurring plan is tier-scaled).
export type SellCost = { sell: number; cost: number };

export type OptionalServiceRateCard = {
  endpointBackupPerWorkstation: SellCost; // $/protected workstation/mo
  serverBackupPerServer: SellCost; // $/protected server/mo
  managedBcdrBase: SellCost; // $/month base platform fee
  managedBcdrPerServer: SellCost; // $/protected server/mo
  advancedEmailSecurityPerUser: SellCost; // $/user/mo
  securityAwarenessTrainingPerUser: SellCost; // $/user/mo
  microsoft365LicensingPerSeat: SellCost; // $/seat/mo (placeholder allowance)
  includedOnsiteHours: SellCost; // $/hour
  // Hardcoded 95/hr internal cost the workbook adds for vCIO overage hours,
  // independent of the "additional vCIO rate" sell price and independent of
  // tier. Kept editable here rather than hardcoded in the engine.
  vcioOverageDirectCostPerHour: number;
};

export const COMPLIANCE_FRAMEWORKS = [
  "None",
  "HIPAA",
  "PCI DSS",
  "CMMC",
  "FINRA / SEC",
  "SOC 2",
  "NIST",
  "Other",
] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

export type CompliancePricing = Partial<Record<Exclude<ComplianceFramework, "None">, SellCost>>;

export type RateCard = {
  tiers: Record<TierKey, TierRateCard>;
  optionalServices: OptionalServiceRateCard;
  compliance: CompliancePricing;
};

export const DEFAULT_RATE_CARD: RateCard = {
  tiers: {
    bronze: {
      workstationMrr: 105,
      serverMrr: 250,
      firewallMrr: 175,
      switchMrr: 35,
      apMrr: 20,
      locationMrr: 150,
      userMrr: 0,
      directCostPerWorkstation: 38,
      directCostPerServer: 85,
      directCostPerNetworkDevice: 12,
      directCostPerUser: 5,
      directCostPerLocation: 50,
      vcioIncludedHoursPerMonth: 0,
      additionalVcioRatePerHour: 250,
      professionalServicesRatePerHour: 225,
      targetGrossMarginPct: 0.58,
      minimumMrr: 200,
      planPriceScale: 1,
      onboardingHoursPerWorkstation: 0.3,
      onboardingHoursPerServer: 2,
      onboardingHoursPerNetworkDevice: 0.35,
      onboardingHoursPerLocation: 5,
      onboardingLaborCostPerHour: 95,
      onboardingSellRatePerHour: 185,
    },
    silver: {
      workstationMrr: 135,
      serverMrr: 325,
      firewallMrr: 225,
      switchMrr: 45,
      apMrr: 25,
      locationMrr: 225,
      userMrr: 20,
      directCostPerWorkstation: 46,
      directCostPerServer: 105,
      directCostPerNetworkDevice: 15,
      directCostPerUser: 9,
      directCostPerLocation: 70,
      vcioIncludedHoursPerMonth: 0,
      additionalVcioRatePerHour: 250,
      professionalServicesRatePerHour: 225,
      targetGrossMarginPct: 0.62,
      minimumMrr: 600,
      planPriceScale: 1,
      onboardingHoursPerWorkstation: 0.35,
      onboardingHoursPerServer: 2.5,
      onboardingHoursPerNetworkDevice: 0.45,
      onboardingHoursPerLocation: 6,
      onboardingLaborCostPerHour: 95,
      onboardingSellRatePerHour: 195,
    },
    gold: {
      workstationMrr: 175,
      serverMrr: 425,
      firewallMrr: 300,
      switchMrr: 60,
      apMrr: 35,
      locationMrr: 350,
      userMrr: 35,
      directCostPerWorkstation: 57,
      directCostPerServer: 130,
      directCostPerNetworkDevice: 20,
      directCostPerUser: 14,
      directCostPerLocation: 95,
      vcioIncludedHoursPerMonth: 2,
      additionalVcioRatePerHour: 250,
      professionalServicesRatePerHour: 225,
      targetGrossMarginPct: 0.65,
      minimumMrr: 1000,
      planPriceScale: 1,
      onboardingHoursPerWorkstation: 0.4,
      onboardingHoursPerServer: 3,
      onboardingHoursPerNetworkDevice: 0.6,
      onboardingHoursPerLocation: 8,
      onboardingLaborCostPerHour: 95,
      onboardingSellRatePerHour: 210,
    },
  },
  optionalServices: {
    endpointBackupPerWorkstation: { sell: 15, cost: 6 },
    serverBackupPerServer: { sell: 110, cost: 45 },
    managedBcdrBase: { sell: 600, cost: 250 },
    managedBcdrPerServer: { sell: 175, cost: 75 },
    advancedEmailSecurityPerUser: { sell: 6, cost: 2.5 },
    securityAwarenessTrainingPerUser: { sell: 4, cost: 1.5 },
    microsoft365LicensingPerSeat: { sell: 25, cost: 22 },
    includedOnsiteHours: { sell: 225, cost: 95 },
    vcioOverageDirectCostPerHour: 95,
  },
  compliance: {
    HIPAA: { sell: 500, cost: 150 },
    "PCI DSS": { sell: 400, cost: 125 },
    CMMC: { sell: 1000, cost: 350 },
    "FINRA / SEC": { sell: 750, cost: 250 },
    "SOC 2": { sell: 750, cost: 250 },
    NIST: { sell: 500, cost: 150 },
    Other: { sell: 500, cost: 150 },
  },
};

// Customer-facing plan names and feature bullets — ported from the
// "Customer Proposal" sheet (A14/D14/G14 taglines, A18/D18/G18 bullets).
export const TIER_TAGLINES: Record<TierKey, string> = {
  bronze: "Managed Foundation",
  silver: "Managed Complete",
  gold: "Managed Premier",
};

export const TIER_FEATURES: Record<TierKey, string[]> = {
  bronze: [
    "Monitoring & patching",
    "Endpoint security",
    "Managed network infrastructure",
    "Defined user support",
    "Standard priority",
    "Core documentation",
  ],
  silver: [
    "Everything in Bronze",
    "Unlimited qualifying help desk",
    "Priority response",
    "Microsoft 365 administration",
    "Backup monitoring",
    "Vendor coordination",
    "Emergency after-hours response",
  ],
  gold: [
    "Everything in Silver",
    "Highest support priority",
    "Enhanced security response",
    "Technology roadmap",
    "vCIO strategic allowance",
    "Executive-level IT guidance",
  ],
};

// ---------------------------------------------------------------------------
// Microsoft 365 licensing catalog — admin-editable list of M365/security/
// identity plans (Settings → Microsoft 365 plans), seeded from Microsoft's
// published per-user pricing. Replaces the old flat "one M365 seat rate for
// everyone" placeholder (microsoft365LicensingPerSeat, above) with a real
// per-plan price list so a quote can mix e.g. 8 Business Basic + 4 Business
// Premium seats and price each seat at its actual plan's rate. Stored in
// app_settings under key "m365Plans"; a quote's addOnSelections.m365Selections
// (see pricing-rules.ts) references these by id.
// ---------------------------------------------------------------------------

export const M365_PLAN_CATEGORIES = ["core", "security", "identity", "addon"] as const;
export type M365PlanCategory = (typeof M365_PLAN_CATEGORIES)[number];

export const M365_CATEGORY_LABELS: Record<M365PlanCategory, string> = {
  core: "Core productivity suite",
  security: "Security",
  identity: "Identity",
  addon: "Add-on",
};

export type M365Plan = {
  id: string;
  name: string;
  category: M365PlanCategory;
  sell: number; // $/seat/month, customer-facing
  cost: number; // $/seat/month, internal acquisition cost (for margin math)
  sortOrder: number;
  active: boolean; // inactive plans are hidden from new selections but keep pricing history intact
};

export function m365PlanById(plans: M365Plan[], id: string): M365Plan | undefined {
  return plans.find((p) => p.id === id);
}

// Seeded from Microsoft's published Microsoft 365 business pricing as of
// September 2026 (microsoft.com/en-us/microsoft-365/business pricing pages).
// These are starting points, not contractual — edit freely from
// Settings → Microsoft 365 plans; Microsoft's list prices change often and
// what you actually pay through CSP/partner pricing may differ from retail.
export const DEFAULT_M365_PLANS: M365Plan[] = [
  { id: "business-basic", name: "Microsoft 365 Business Basic", category: "core", sell: 7.0, cost: 6.0, sortOrder: 0, active: true },
  { id: "business-standard", name: "Microsoft 365 Business Standard", category: "core", sell: 23.5, cost: 20.0, sortOrder: 1, active: true },
  { id: "business-premium", name: "Microsoft 365 Business Premium", category: "core", sell: 32.0, cost: 27.0, sortOrder: 2, active: true },
  { id: "apps-for-business", name: "Microsoft 365 Apps for Business", category: "core", sell: 10.0, cost: 8.5, sortOrder: 3, active: true },
  { id: "defender-for-business", name: "Microsoft Defender for Business", category: "security", sell: 3.0, cost: 2.5, sortOrder: 4, active: true },
  { id: "entra-id-p1", name: "Microsoft Entra ID P1", category: "identity", sell: 7.0, cost: 6.0, sortOrder: 5, active: true },
  { id: "entra-id-p2", name: "Microsoft Entra ID P2", category: "identity", sell: 10.0, cost: 8.5, sortOrder: 6, active: true },
  { id: "copilot", name: "Microsoft 365 Copilot", category: "addon", sell: 18.0, cost: 15.0, sortOrder: 7, active: true },
];

// ---------------------------------------------------------------------------
// Scope matrix: Service/Responsibility x tier, plus customer-facing copy.
// Ported from the "Scope Matrix" sheet.
// ---------------------------------------------------------------------------

export type ScopeMatrixRow = {
  key: string;
  service: string;
  bronze: string;
  silver: string;
  gold: string;
  customerDescription: string;
  scopeNote: string;
};

export const DEFAULT_SCOPE_MATRIX: ScopeMatrixRow[] = [
  { key: "monitoring", service: "24x7 Monitoring", bronze: "Included", silver: "Included", gold: "Included", customerDescription: "Continuous monitoring of covered systems.", scopeNote: "After-hours dispatch depends on plan/SLA." },
  { key: "patching", service: "Patch Management", bronze: "Included", silver: "Included", gold: "Included", customerDescription: "Routine patching of supported covered systems.", scopeNote: "Vendor limitations apply." },
  { key: "edr", service: "Endpoint Security / EDR", bronze: "Included", silver: "Included", gold: "Included", customerDescription: "Managed endpoint protection.", scopeNote: "Stack defined in SOW." },
  { key: "network_mgmt", service: "Firewall / Network Management", bronze: "Included", silver: "Included", gold: "Included", customerDescription: "Management of covered firewall, switching, and Wi-Fi.", scopeNote: "Only listed managed assets." },
  { key: "m365_admin", service: "Microsoft 365 Administration", bronze: "Basic", silver: "Included", gold: "Included", customerDescription: "Routine administration of covered tenant.", scopeNote: "Licensing may be separate." },
  { key: "help_desk", service: "User Help Desk", bronze: "Defined", silver: "Unlimited Qualifying", gold: "Unlimited Qualifying", customerDescription: "Remote support for covered users and technology.", scopeNote: "Unlimited does not include projects/consulting." },
  { key: "support_priority", service: "Support Priority", bronze: "Standard", silver: "Priority", gold: "Highest", customerDescription: "Prioritized support based on plan and impact.", scopeNote: "Targets defined in SLA." },
  { key: "afterhours_emergency", service: "After-Hours Emergency Response", bronze: "Optional", silver: "Emergency Included", gold: "Enhanced", customerDescription: "Critical incident response outside business hours.", scopeNote: "Non-emergency work may be billable." },
  { key: "backup_monitoring", service: "Backup Monitoring", bronze: "Optional", silver: "Included", gold: "Included", customerDescription: "Monitoring of covered backups.", scopeNote: "Storage/software may be separate." },
  { key: "security_alert_response", service: "Security Alert Response", bronze: "Included", silver: "Included", gold: "Enhanced", customerDescription: "Investigation of managed security alerts.", scopeNote: "Major remediation may be project work." },
  { key: "vendor_coordination", service: "Vendor Coordination", bronze: "Reasonable", silver: "Included", gold: "Included", customerDescription: "Coordination with covered technology vendors.", scopeNote: "Vendor performance not guaranteed." },
  { key: "documentation", service: "Documentation", bronze: "Core", silver: "Enhanced", gold: "Enhanced", customerDescription: "Documentation required to support the environment.", scopeNote: "Business documentation excluded." },
  { key: "roadmap", service: "Technology Roadmap", bronze: "Not Included", silver: "Optional", gold: "Included", customerDescription: "Lifecycle/security/capacity planning.", scopeNote: "Defined strategic allowance." },
  { key: "vcio_planning", service: "vCIO Strategic Planning", bronze: "Add-On", silver: "Add-On", gold: "Included Allowance", customerDescription: "Executive IT planning and guidance.", scopeNote: "Extra hours billed separately." },
  { key: "mgmt_meetings", service: "Management / Client Meetings", bronze: "Billable", silver: "Billable / vCIO", gold: "vCIO Allowance", customerDescription: "IT participation in planning/vendor meetings.", scopeNote: "Three-hour meetings are not automatically included." },
  { key: "custom_dev", service: "Custom Program / App Development", bronze: "Project", silver: "Project", gold: "Project", customerDescription: "Applications, databases, scripts, automations.", scopeNote: "Separately scoped and quoted." },
  { key: "migrations", service: "Major Migrations / Implementations", bronze: "Project", silver: "Project", gold: "Project", customerDescription: "Cloud/server/tenant/application migrations.", scopeNote: "Separately scoped and quoted." },
  { key: "office_moves", service: "Office Moves / Network Redesign", bronze: "Project", silver: "Project", gold: "Project", customerDescription: "Material environment changes.", scopeNote: "Separately scoped and quoted." },
  { key: "printer_support", service: "Printer / Specialty Peripheral Support", bronze: "Per Incident", silver: "Per Incident", gold: "Per Incident", customerDescription: "Available on request.", scopeNote: "Unless specifically covered." },
  { key: "office_formatting", service: "Word / Excel Formatting", bronze: "Per Incident", silver: "Per Incident", gold: "Per Incident", customerDescription: "Application assistance available.", scopeNote: "Not managed infrastructure support." },
  { key: "training_tutoring", service: "Training / Tutoring", bronze: "Per Incident", silver: "Per Incident", gold: "Per Incident", customerDescription: "User/group training available separately.", scopeNote: "Not unlimited help desk." },
];

// Plain-English definitions for every status term used in the scope matrix
// above, shown as a hover tooltip on the client-facing proposal so terms
// like "Defined" or "Reasonable" aren't left unexplained. Wording is drawn
// from "Lockdown IT Managed Services Coverage Guide" (what "managed" means,
// per-incident vs. project work, the unlimited-support caveat, etc.) so the
// proposal page and the coverage guide describe things the same way.
export const SCOPE_TERM_DEFINITIONS: Record<string, string> = {
  Included: "Provided as part of this plan at no additional charge, within the agreed scope.",
  Basic: "Routine administration is included. Larger configuration or change work may be billed separately.",
  Defined: "Covered up to the support allowance defined in your plan — not unlimited.",
  "Unlimited Qualifying": "No per-ticket charge for routine support of covered users and technology. Doesn't include projects, custom development, consulting, or work outside the managed environment.",
  Standard: "Handled in normal queue order, based on business impact.",
  Priority: "Moved ahead of standard-tier requests, per this plan's response targets.",
  Highest: "Top-priority handling under this plan's response targets.",
  Optional: "Not included by default at this tier — available to add for an additional fee.",
  "Emergency Included": "Genuine after-hours emergencies are covered. Non-emergency after-hours work may still be billable.",
  Enhanced: "A deeper level of this service than the tier below provides.",
  Reasonable: "We coordinate with the vendor as practical, but can't guarantee their response time, availability, or resolution.",
  Core: "The baseline documentation needed to support your environment — not general business documentation.",
  "Not Included": "Not part of this plan. Available as separately scoped, per-incident, or project work.",
  "Add-On": "Available for an additional monthly fee.",
  "Included Allowance": "A defined number of hours per month is included; time beyond that is billed at the applicable rate.",
  Billable: "Not part of the monthly plan — billed as time-and-materials when it comes up.",
  "Billable / vCIO": "Billable unless you have vCIO hours available to apply toward it.",
  "vCIO Allowance": "Drawn from this plan's included vCIO hours; time beyond the allowance is billed at the consulting rate.",
  Project: "Treated as project work — scoped and quoted separately from the monthly plan, regardless of tier.",
  "Per Incident": "Available on request and billed per incident — not included in the monthly plan, regardless of tier.",
};

// Coarse grouping of the same terms, used to pick an icon/color for the
// term badge: "included" (green check), "addon" (amber, costs extra),
// or "excluded" (muted, not part of the managed plan at any tier).
export const SCOPE_TERM_VARIANT: Record<string, "included" | "addon" | "excluded"> = {
  Included: "included",
  Basic: "included",
  Defined: "included",
  "Unlimited Qualifying": "included",
  Standard: "included",
  Priority: "included",
  Highest: "included",
  Optional: "addon",
  "Emergency Included": "included",
  Enhanced: "included",
  Reasonable: "included",
  Core: "included",
  "Not Included": "excluded",
  "Add-On": "addon",
  "Included Allowance": "included",
  Billable: "excluded",
  "Billable / vCIO": "addon",
  "vCIO Allowance": "included",
  Project: "excluded",
  "Per Incident": "excluded",
};

// ---------------------------------------------------------------------------
// Service Level Agreements (Settings → SLAs) — response/resolution targets
// by severity, coverage hours, uptime guarantee, escalation path, and
// exclusions. Independent of Bronze/Silver/Gold: a tier says what's
// included, an SLA says how fast it's responded to and fixed. Staff attach
// one SLA to a quote (separate from the service tier); the client sees the
// attached SLA's targets on the proposal, and it's folded into the MSA.
//
// Seed values below reflect typical MSP industry practice (severity-based
// response/resolution tiers, business-hours vs. 24x7 coverage, uptime
// guarantees in the 99.5–99.95% range) — they are starting points, not
// commitments you've made to anyone; review and adjust every field from
// Settings → SLAs before relying on them in a real agreement.
// ---------------------------------------------------------------------------

export const SEVERITY_LEVELS = ["critical", "high", "medium", "low"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_DESCRIPTIONS: Record<SeverityLevel, string> = {
  critical: "Business-down: service outage or security incident affecting all/most users with no workaround.",
  high: "Major function impaired for multiple users, or one user fully unable to work; workaround limited.",
  medium: "Single user or non-critical system impaired; a workaround exists.",
  low: "Minor issue, cosmetic defect, or general how-to request with no material business impact.",
};

export type SlaDefaults = {
  name: string;
  description: string;
  isDefault: boolean;
  sortOrder: number;
  coverageHours: string;
  criticalResponseMinutes: number;
  highResponseMinutes: number;
  mediumResponseMinutes: number;
  lowResponseMinutes: number;
  criticalResolutionHours: number;
  highResolutionHours: number;
  mediumResolutionHours: number;
  lowResolutionHours: number;
  uptimeGuaranteePct: number;
  escalationProcess: string;
  exclusions: string;
};

const STANDARD_EXCLUSIONS =
  "Response and resolution targets apply only to covered systems, software, and users under active management. " +
  "They do not apply to: issues caused by third-party vendor outages or acts/omissions of the client or its users; " +
  "hardware or software outside the managed environment; force majeure events; or periods where the client has not " +
  "provided reasonably requested access or information. Time spent waiting on a required client response or a " +
  "third-party vendor does not count against the resolution target.";

// Seeded into the `slas` table on first run (see seed.ts) — from then on the
// live rows in the database are the source of truth, same pattern as
// DEFAULT_RATE_CARD / DEFAULT_M365_PLANS above.
export const DEFAULT_SLAS: SlaDefaults[] = [
  {
    name: "Standard (Business Hours)",
    description: "Our baseline SLA for business-hours support with next-business-day handling for lower-severity items.",
    isDefault: true,
    sortOrder: 0,
    coverageHours: "Business Hours (Mon–Fri, 8:00 AM–5:00 PM local time), excluding observed holidays",
    criticalResponseMinutes: 30,
    highResponseMinutes: 60,
    mediumResponseMinutes: 240,
    lowResponseMinutes: 480,
    criticalResolutionHours: 4,
    highResolutionHours: 8,
    mediumResolutionHours: 24,
    lowResolutionHours: 40,
    uptimeGuaranteePct: 99.5,
    escalationProcess:
      "Tier 1 support engineer triages on receipt. If a Critical or High severity issue is not resolved within its resolution target, it is automatically escalated to a senior/Tier 2 engineer. Any Critical issue still open at 2x its resolution target is escalated to a service delivery manager, who will contact the client directly with a status update and revised estimate.",
    exclusions: STANDARD_EXCLUSIONS,
  },
  {
    name: "Priority (Business Hours + Emergency)",
    description: "Faster targets across the board, plus 24x7 coverage for business-down Critical issues only.",
    isDefault: false,
    sortOrder: 1,
    coverageHours: "Business Hours for all severities, plus 24x7x365 emergency coverage for Critical issues",
    criticalResponseMinutes: 15,
    highResponseMinutes: 30,
    mediumResponseMinutes: 120,
    lowResponseMinutes: 240,
    criticalResolutionHours: 4,
    highResolutionHours: 6,
    mediumResolutionHours: 16,
    lowResolutionHours: 24,
    uptimeGuaranteePct: 99.9,
    escalationProcess:
      "Tier 1 support engineer triages on receipt, 24x7 for Critical issues. Critical and High severity issues not resolved within their resolution target automatically escalate to a senior/Tier 2 engineer. Any Critical issue still open at 1.5x its resolution target escalates to a service delivery manager for direct client contact and a revised estimate.",
    exclusions: STANDARD_EXCLUSIONS,
  },
  {
    name: "Premier (24x7)",
    description: "Our fastest targets with full round-the-clock coverage at every severity level.",
    isDefault: false,
    sortOrder: 2,
    coverageHours: "24x7x365 for all severities",
    criticalResponseMinutes: 10,
    highResponseMinutes: 20,
    mediumResponseMinutes: 60,
    lowResponseMinutes: 240,
    criticalResolutionHours: 2,
    highResolutionHours: 4,
    mediumResolutionHours: 8,
    lowResolutionHours: 24,
    uptimeGuaranteePct: 99.95,
    escalationProcess:
      "Tier 1 support engineer triages on receipt, 24x7 for all severities. Any issue not resolved within its resolution target automatically escalates to a senior/Tier 2 engineer; any Critical issue still open at 1.5x its resolution target escalates immediately to a service delivery manager and the assigned vCIO for direct client contact and a revised estimate.",
    exclusions: STANDARD_EXCLUSIONS,
  },
];

// ---------------------------------------------------------------------------
// Master Service Agreement — standing legal/commercial terms (Settings →
// MSA terms), merged with a quote's tier/SLA/line items when an MSA is
// generated (src/server/msa.ts). Everything here is a starting template,
// NOT legal advice — have an attorney licensed in your state review and
// customize this before relying on it in a real agreement with a customer.
// ---------------------------------------------------------------------------

export type LiabilityCapType = "FEES_PAID_MULTIPLE" | "FIXED_AMOUNT";

// Who may exercise the "termination for convenience" clause (Section 13).
// terminationForConvenienceNoticeDays (below) is the notice period either
// side must give — this only controls which side(s) get the right at all.
export type TerminationDirection = "BOTH" | "PROVIDER_ONLY" | "CLIENT_ONLY";

export type MsaSettings = {
  providerLegalName: string;
  providerAddress: string;
  providerSignerName: string;
  providerSignerTitle: string;

  initialTermMonths: number;
  autoRenew: boolean;
  renewalTermMonths: number;
  nonRenewalNoticeDays: number;

  paymentDueDays: number;
  lateFeePct: number; // per month, on overdue balances
  annualPriceIncreaseCapPct: number; // 0 = no stated cap
  suspensionForNonPaymentDays: number; // days past due before Provider may suspend services without liability

  terminationForConvenienceDirection: TerminationDirection;
  terminationForConvenienceNoticeDays: number;
  terminationForCauseCureDays: number;

  liabilityCapType: LiabilityCapType;
  liabilityCapMonths: number; // used when liabilityCapType === FEES_PAID_MULTIPLE
  liabilityCapFixedAmount: number; // used when liabilityCapType === FIXED_AMOUNT
  excludesConsequentialDamages: boolean;

  confidentialityYears: number;
  dataProtectionSummary: string;
  ipOwnershipSummary: string;
  insuranceRequirementSummary: string;
  disputeResolutionSummary: string;
  governingLawState: string;

  // Additional protections for the Provider side — all editable text so
  // wording can be adjusted, but seeded with standard MSP-industry language.
  warrantyDisclaimerSummary: string; // disclaims implied warranties beyond what's explicitly promised
  securityDisclaimerSummary: string; // no guarantee against all cyberattacks/breaches despite reasonable safeguards
  clientIndemnitySummary: string; // client indemnifies Provider for claims from client's own data/noncompliance/misuse
  thirdPartyDisclaimerSummary: string; // not liable for third-party vendor/software/ISP failures
  independentContractorSummary: string; // Provider is an independent contractor, not Client's employee/agent/partner
  subcontractorsSummary: string; // Provider may use qualified subcontractors and remains responsible for their work
};

export const DEFAULT_MSA_SETTINGS: MsaSettings = {
  providerLegalName: "",
  providerAddress: "",
  providerSignerName: "",
  providerSignerTitle: "",

  initialTermMonths: 12,
  autoRenew: true,
  renewalTermMonths: 12,
  nonRenewalNoticeDays: 60,

  paymentDueDays: 15,
  lateFeePct: 1.5,
  annualPriceIncreaseCapPct: 0,
  suspensionForNonPaymentDays: 10,

  terminationForConvenienceDirection: "BOTH",
  terminationForConvenienceNoticeDays: 60,
  terminationForCauseCureDays: 15,

  liabilityCapType: "FEES_PAID_MULTIPLE",
  liabilityCapMonths: 6,
  liabilityCapFixedAmount: 25000,
  excludesConsequentialDamages: true,

  confidentialityYears: 3,
  dataProtectionSummary:
    "Provider will implement and maintain commercially reasonable administrative, technical, and physical safeguards designed to protect client data encountered while delivering the services, and will not access, use, or disclose client data except as needed to deliver the services or as required by law.",
  ipOwnershipSummary:
    "Client retains ownership of its own data, accounts, and pre-existing intellectual property. Provider retains ownership of its own pre-existing tools, scripts, documentation templates, and methodologies, and grants client a non-exclusive license to use any deliverables created specifically for client under this agreement.",
  insuranceRequirementSummary:
    "Provider will maintain commercially reasonable general liability, professional liability (errors & omissions), and cyber liability insurance for the duration of this agreement, and will provide a certificate of insurance on reasonable request.",
  disputeResolutionSummary:
    "The parties will first attempt to resolve any dispute through good-faith negotiation between designated representatives. Unresolved disputes will be subject to the exclusive jurisdiction of the state and federal courts located in the governing law state below.",
  governingLawState: "",

  warrantyDisclaimerSummary:
    "Provider warrants that services will be performed in a professional and workmanlike manner consistent with generally accepted industry standards. EXCEPT AS EXPRESSLY STATED IN THIS AGREEMENT, PROVIDER DISCLAIMS ALL OTHER WARRANTIES, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. Provider does not warrant that the services will be uninterrupted or error-free.",
  securityDisclaimerSummary:
    "Provider will implement and maintain the security measures described in this Agreement and the attached Statement of Work using commercially reasonable efforts. Client acknowledges that no IT environment can be made completely secure, and that Provider does not guarantee that any system will be free from cyberattack, unauthorized access, malware, ransomware, or data breach. Provider's obligations following a security incident are limited to the incident response services, if any, described in the Statement of Work; Provider is not a guarantor or insurer of Client's data or systems.",
  clientIndemnitySummary:
    "Client will indemnify, defend, and hold harmless Provider from and against third-party claims, damages, and reasonable expenses (including attorneys' fees) arising out of: (a) Client's data, content, or business operations; (b) Client's breach of this Agreement or violation of applicable law; (c) Client's use of the services in combination with equipment, software, or data not provided by Provider; or (d) instructions given by Client that Provider implemented in good faith.",
  thirdPartyDisclaimerSummary:
    "Some services rely on third-party hardware, software, cloud platforms, or connectivity (e.g., internet service providers, software publishers, cloud vendors) that Provider does not own or control. Provider is not responsible for the acts, omissions, outages, price changes, or discontinuation of any third-party product or service, and passes through only the warranties (if any) that the applicable third party provides.",
  independentContractorSummary:
    "Provider is an independent contractor. Nothing in this Agreement creates an employment, agency, joint venture, or partnership relationship between the parties. Provider is solely responsible for its own employees, subcontractors, taxes, benefits, and insurance.",
  subcontractorsSummary:
    "Provider may use qualified subcontractors to perform portions of the services and remains responsible for the performance of the services as a whole.",
};

// ---------------------------------------------------------------------------
// Pre-quote checklist template. Ported from "Pre-Quote CFO Checklist".
// ---------------------------------------------------------------------------

export type ChecklistTemplateItem = {
  key: string;
  category: string;
  question: string;
  whyItMatters: string;
};

export const DEFAULT_CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  { key: "inventory", category: "Inventory", question: "All users, endpoints, servers, firewalls, switches, APs, and locations counted?", whyItMatters: "Missing assets destroy margin." },
  { key: "documentation", category: "Documentation", question: "Current network/admin documentation quality confirmed?", whyItMatters: "Poor documentation increases onboarding risk." },
  { key: "lifecycle", category: "Lifecycle", question: "End-of-life systems identified and remediation plan defined?", whyItMatters: "Unsupported technology can create hidden liability." },
  { key: "security", category: "Security", question: "Required endpoint/security stack defined and licensed?", whyItMatters: "Never quote security without knowing tool cost." },
  { key: "backup", category: "Backup", question: "Backup scope, retention, storage, and recovery expectations defined?", whyItMatters: "Recovery expectations can materially change cost." },
  { key: "after_hours", category: "After Hours", question: "Business-hours vs emergency vs true 24x7 expectation confirmed?", whyItMatters: "24x7 support requires premium staffing." },
  { key: "applications", category: "Applications", question: "Critical line-of-business applications and vendors documented?", whyItMatters: "Third-party dependencies drive support load." },
  { key: "compliance", category: "Compliance", question: "Compliance obligations validated with customer?", whyItMatters: "Compliance changes process, tooling, and documentation." },
  { key: "onboarding", category: "Onboarding", question: "Onboarding/stabilization labor and one-time remediation identified?", whyItMatters: "Do not give stabilization labor away." },
  { key: "projects", category: "Projects", question: "Migrations, upgrades, office moves, and redesigns separately quoted?", whyItMatters: "Projects are not recurring support." },
  { key: "meetings", category: "Meetings", question: "Recurring management/vendor meeting expectations addressed via vCIO or billing?", whyItMatters: "Avoid unlimited free consulting." },
  { key: "development", category: "Development", question: "Custom programming/scripting/reporting/workflow expectations excluded or quoted?", whyItMatters: "Professional services, not help desk." },
  { key: "onsite", category: "Onsite", question: "Expected onsite hours/travel requirements explicitly defined?", whyItMatters: "Onsite labor materially affects margin." },
  { key: "licensing", category: "Licensing", question: "Microsoft 365 and third-party licensing inclusion/exclusion clearly stated?", whyItMatters: "Avoid licensing ambiguity." },
  { key: "scope", category: "Scope", question: "Printer/peripheral/training/business-content support treatment clearly stated?", whyItMatters: "Prevents 'everything IT is included' disputes." },
  { key: "sla", category: "SLA", question: "Response targets and priority definitions match the selected plan?", whyItMatters: "Sets realistic expectations." },
  { key: "margin", category: "Margin", question: "Selected plan clears target gross margin after discount and add-ons?", whyItMatters: "CFO approval before proposal." },
  { key: "plan_fit", category: "Plan Fit", question: "Selected plan is not below automated recommended level without approval?", whyItMatters: "Protects service quality and margin." },
  { key: "contract", category: "Contract", question: "Term, price increases, payment terms, termination, and limitation language in MSA/SOW?", whyItMatters: "Commercial risk belongs in signed documents." },
  { key: "assumptions", category: "Assumptions", question: "All proposal assumptions and exclusions are written into SOW?", whyItMatters: "Prevents scope disputes later." },
];

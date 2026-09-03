// ============================================================================
// Pricing rules engine — port of the Discovery / Internal Assumptions / CFO
// Model sheets from Lockdown_IT_Fully_Automated_Quote_Builder_v4 (Excel).
//
// Pure functions, no DB access — same philosophy as src/server/pricing.ts:
// a single source of truth for the numbers so the staff-facing plan
// comparison panel and the client-facing 3-tier proposal can never drift
// apart. Every formula here has a comment naming the spreadsheet cell it
// replaces so a future edit can be checked against the workbook directly.
//
// Where behavior looks surprising, it's intentional — a faithful port of
// what the workbook actually does, not a "fix." Notably:
//   - "Other Managed Network Devices" counts toward direct cost and
//     onboarding hours, but has no sell-side MRR line of its own (the
//     workbook's Base Plan Subtotal only prices firewalls/switches/APs).
//   - The vCIO overage direct-cost rate ($95/hr) is a flat internal cost
//     independent of tier and independent of the "additional vCIO rate"
//     sell price, exactly as hardcoded in the workbook's CFO Model.
// ============================================================================

import {
  type RateCard,
  type TierKey,
  type ComplianceFramework,
  TIER_KEYS,
} from "./pricing-data";

export type Quantities = {
  users: number;
  workstations: number;
  servers: number;
  locations: number;
  firewalls: number;
  switches: number;
  aps: number;
  otherNetworkDevices: number;
};

export const EMPTY_QUANTITIES: Quantities = {
  users: 0,
  workstations: 0,
  servers: 0,
  locations: 0,
  firewalls: 0,
  switches: 0,
  aps: 0,
  otherNetworkDevices: 0,
};

export type DocumentationQuality = "Excellent" | "Good" | "Average" | "Poor";
export type LegacySystems = "None" | "Some" | "Significant";
export type AfterHours = "Business Hours" | "Business Hours + Emergency" | "24x7";
export type Criticality = "Standard" | "High" | "Mission Critical";
export type IncidentHistory = "Normal" | "Elevated" | "Severe";

export type RiskFactors = {
  documentationQuality: DocumentationQuality;
  legacySystems: LegacySystems;
  complianceProgram: ComplianceFramework;
  afterHours: AfterHours;
  multiVendor: "Yes" | "No";
  criticality: Criticality;
  incidentHistory: IncidentHistory;
  manualOverrideEnabled: boolean;
  manualOverridePct: number; // 0-1, used only when manualOverrideEnabled
};

export const DEFAULT_RISK_FACTORS: RiskFactors = {
  documentationQuality: "Average",
  legacySystems: "None",
  complianceProgram: "None",
  afterHours: "Business Hours",
  multiVendor: "No",
  criticality: "Standard",
  incidentHistory: "Normal",
  manualOverrideEnabled: false,
  manualOverridePct: 0,
};

export type BackupProfile = "None" | "Endpoint Backup" | "Server Backup" | "Managed Backup" | "Managed BCDR";

export type AddOnSelections = {
  vcioEnabled: boolean;
  vcioHoursPerMonth: number;
  backupProfile: BackupProfile;
  protectedWorkstations: number;
  protectedServers: number;
  emailSecurityEnabled: boolean;
  emailSecuritySeats: number;
  trainingEnabled: boolean;
  trainingSeats: number;
  m365Enabled: boolean;
  m365Seats: number;
  includedOnsiteHoursPerMonth: number;
  customMonthlyAddOnSell: number;
  customMonthlyAddOnCost: number;
  oneTimeProjectSell: number;
  oneTimeProjectCost: number;
};

export const EMPTY_ADD_ONS: AddOnSelections = {
  vcioEnabled: false,
  vcioHoursPerMonth: 0,
  backupProfile: "None",
  protectedWorkstations: 0,
  protectedServers: 0,
  emailSecurityEnabled: false,
  emailSecuritySeats: 0,
  trainingEnabled: false,
  trainingSeats: 0,
  m365Enabled: false,
  m365Seats: 0,
  includedOnsiteHoursPerMonth: 0,
  customMonthlyAddOnSell: 0,
  customMonthlyAddOnCost: 0,
  oneTimeProjectSell: 0,
  oneTimeProjectCost: 0,
};

// ---------------------------------------------------------------------------
// Risk adjustment — Discovery!B35, weights documented on the Settings sheet
// ("AUTOMATION RULES USED BY THE MODEL").
// ---------------------------------------------------------------------------

export type RiskBreakdownItem = { label: string; pct: number };

export function computeRiskAdjustment(risk: RiskFactors): { pct: number; breakdown: RiskBreakdownItem[] } {
  const breakdown: RiskBreakdownItem[] = [];
  const add = (label: string, pct: number) => {
    if (pct > 0) breakdown.push({ label, pct });
    return pct;
  };

  let pct = 0;
  switch (risk.documentationQuality) {
    case "Poor":
      pct += add("Poor documentation", 0.06);
      break;
    case "Average":
      pct += add("Average documentation", 0.03);
      break;
    case "Good":
      pct += add("Good documentation", 0.01);
      break;
    default:
      break; // Excellent: +0%
  }

  switch (risk.legacySystems) {
    case "Significant":
      pct += add("Significant legacy/EOL systems", 0.08);
      break;
    case "Some":
      pct += add("Some legacy/EOL systems", 0.03);
      break;
    default:
      break;
  }

  if (risk.complianceProgram !== "None") {
    pct += add("Compliance program in place", 0.05);
  }

  switch (risk.afterHours) {
    case "24x7":
      pct += add("24x7 requirement", 0.2);
      break;
    case "Business Hours + Emergency":
      pct += add("Emergency after-hours", 0.075);
      break;
    default:
      break;
  }

  if (risk.multiVendor === "Yes") {
    pct += add("Multiple third-party vendors", 0.02);
  }

  switch (risk.criticality) {
    case "Mission Critical":
      pct += add("Mission Critical", 0.07);
      break;
    case "High":
      pct += add("High criticality", 0.03);
      break;
    default:
      break;
  }

  switch (risk.incidentHistory) {
    case "Severe":
      pct += add("Severe incident history", 0.07);
      break;
    case "Elevated":
      pct += add("Elevated incident history", 0.03);
      break;
    default:
      break;
  }

  return { pct, breakdown };
}

export function effectiveRiskAdjustment(risk: RiskFactors): number {
  // Discovery!B38: manual override replaces the automatic calculation
  // entirely (it does not stack on top of it).
  if (risk.manualOverrideEnabled) return risk.manualOverridePct;
  return computeRiskAdjustment(risk).pct;
}

// ---------------------------------------------------------------------------
// Recommended plan — Discovery!B11
// ---------------------------------------------------------------------------

export function computeRecommendedTier(input: {
  risk: RiskFactors;
  users: number;
  vcioEnabled: boolean;
}): TierKey {
  const { risk, users, vcioEnabled } = input;

  const goldTriggers =
    risk.afterHours === "24x7" ||
    risk.criticality === "Mission Critical" ||
    risk.incidentHistory === "Severe" ||
    risk.legacySystems === "Significant" ||
    risk.complianceProgram === "CMMC" ||
    vcioEnabled;
  if (goldTriggers) return "gold";

  const silverTriggers =
    users >= 25 ||
    risk.afterHours === "Business Hours + Emergency" ||
    risk.legacySystems === "Some" ||
    risk.multiVendor === "Yes" ||
    risk.complianceProgram !== "None";
  if (silverTriggers) return "silver";

  return "bronze";
}

// ---------------------------------------------------------------------------
// Plan fit / manager approval — Discovery!B39 / B40
// ---------------------------------------------------------------------------

export type PlanFitStatus = "OK" | "REVIEW";

export function computePlanFitStatus(recommended: TierKey, selected: TierKey): PlanFitStatus {
  const belowRecommended =
    (recommended === "gold" && selected !== "gold") ||
    (recommended === "silver" && selected === "bronze");
  return belowRecommended ? "REVIEW" : "OK";
}

export function planFitMessage(status: PlanFitStatus): string {
  return status === "REVIEW"
    ? "REVIEW: selected plan is below recommended level"
    : "OK: selected plan fits discovery";
}

export function computeManagerApprovalRequired(input: {
  planFitStatus: PlanFitStatus;
  manualRiskOverrideUsed: boolean;
  discountPct: number;
}): boolean {
  return (
    input.planFitStatus === "REVIEW" ||
    input.manualRiskOverrideUsed ||
    input.discountPct >= 0.1
  );
}

// ---------------------------------------------------------------------------
// Optional add-ons — Discovery!B59 (sell) and the cost terms folded into
// CFO Model!B21 (cost). Not tier-scaled.
// ---------------------------------------------------------------------------

function backupSellCost(addOns: AddOnSelections, rateCard: RateCard) {
  const { endpointBackupPerWorkstation: ep, serverBackupPerServer: sv, managedBcdrBase: base, managedBcdrPerServer: bcdrSv } =
    rateCard.optionalServices;
  const ws = addOns.protectedWorkstations;
  const srv = addOns.protectedServers;
  switch (addOns.backupProfile) {
    case "Endpoint Backup":
      return { sell: ws * ep.sell, cost: ws * ep.cost };
    case "Server Backup":
      return { sell: srv * sv.sell, cost: srv * sv.cost };
    case "Managed Backup":
      return { sell: ws * ep.sell + srv * sv.sell, cost: ws * ep.cost + srv * sv.cost };
    case "Managed BCDR":
      return { sell: base.sell + srv * bcdrSv.sell, cost: base.cost + srv * bcdrSv.cost };
    default:
      return { sell: 0, cost: 0 };
  }
}

function complianceSellCost(program: ComplianceFramework, rateCard: RateCard) {
  if (program === "None") return { sell: 0, cost: 0 };
  const pricing = rateCard.compliance[program];
  if (!pricing) return { sell: 0, cost: 0 };
  return pricing;
}

export function computeAddOnMrr(
  addOns: AddOnSelections,
  complianceProgram: ComplianceFramework,
  rateCard: RateCard
): { sell: number; cost: number } {
  const backup = backupSellCost(addOns, rateCard);
  const { advancedEmailSecurityPerUser, securityAwarenessTrainingPerUser, microsoft365LicensingPerSeat, includedOnsiteHours } =
    rateCard.optionalServices;
  const compliance = complianceSellCost(complianceProgram, rateCard);

  const emailSell = addOns.emailSecurityEnabled ? addOns.emailSecuritySeats * advancedEmailSecurityPerUser.sell : 0;
  const emailCost = addOns.emailSecurityEnabled ? addOns.emailSecuritySeats * advancedEmailSecurityPerUser.cost : 0;

  const trainingSell = addOns.trainingEnabled ? addOns.trainingSeats * securityAwarenessTrainingPerUser.sell : 0;
  const trainingCost = addOns.trainingEnabled ? addOns.trainingSeats * securityAwarenessTrainingPerUser.cost : 0;

  const m365Sell = addOns.m365Enabled ? addOns.m365Seats * microsoft365LicensingPerSeat.sell : 0;
  const m365Cost = addOns.m365Enabled ? addOns.m365Seats * microsoft365LicensingPerSeat.cost : 0;

  const onsiteSell = addOns.includedOnsiteHoursPerMonth * includedOnsiteHours.sell;
  const onsiteCost = addOns.includedOnsiteHoursPerMonth * includedOnsiteHours.cost;

  const sell =
    backup.sell + emailSell + trainingSell + m365Sell + onsiteSell + compliance.sell + addOns.customMonthlyAddOnSell;
  const cost =
    backup.cost + emailCost + trainingCost + m365Cost + onsiteCost + compliance.cost + addOns.customMonthlyAddOnCost;

  return { sell, cost };
}

// Itemized breakdown of the selected add-ons, for generating readable line
// items (the client-facing proposal does NOT use this — it shows one
// bundled price per tier, matching the workbook's Customer Proposal sheet).
export type AddOnLineItem = { label: string; amount: number };

export function computeAddOnLineItems(
  addOns: AddOnSelections,
  complianceProgram: ComplianceFramework,
  rateCard: RateCard
): AddOnLineItem[] {
  const items: AddOnLineItem[] = [];
  const backup = backupSellCost(addOns, rateCard);
  if (backup.sell > 0) {
    const detail =
      addOns.backupProfile === "Server Backup"
        ? `${addOns.protectedServers} servers protected`
        : addOns.backupProfile === "Endpoint Backup"
          ? `${addOns.protectedWorkstations} workstations protected`
          : `${addOns.protectedWorkstations} workstations, ${addOns.protectedServers} servers protected`;
    items.push({ label: `${addOns.backupProfile} (${detail})`, amount: backup.sell });
  }
  if (addOns.emailSecurityEnabled && addOns.emailSecuritySeats > 0) {
    items.push({
      label: `Advanced Email Security (${addOns.emailSecuritySeats} seats)`,
      amount: addOns.emailSecuritySeats * rateCard.optionalServices.advancedEmailSecurityPerUser.sell,
    });
  }
  if (addOns.trainingEnabled && addOns.trainingSeats > 0) {
    items.push({
      label: `Security Awareness Training (${addOns.trainingSeats} seats)`,
      amount: addOns.trainingSeats * rateCard.optionalServices.securityAwarenessTrainingPerUser.sell,
    });
  }
  if (addOns.m365Enabled && addOns.m365Seats > 0) {
    items.push({
      label: `Microsoft 365 Licensing Allowance (${addOns.m365Seats} seats)`,
      amount: addOns.m365Seats * rateCard.optionalServices.microsoft365LicensingPerSeat.sell,
    });
  }
  if (addOns.includedOnsiteHoursPerMonth > 0) {
    items.push({
      label: `Included Onsite Hours (${addOns.includedOnsiteHoursPerMonth} hrs/mo)`,
      amount: addOns.includedOnsiteHoursPerMonth * rateCard.optionalServices.includedOnsiteHours.sell,
    });
  }
  const compliance = complianceSellCost(complianceProgram, rateCard);
  if (compliance.sell > 0) {
    items.push({ label: `Compliance Management — ${complianceProgram}`, amount: compliance.sell });
  }
  if (addOns.customMonthlyAddOnSell > 0) {
    items.push({ label: "Additional Monthly Add-On", amount: addOns.customMonthlyAddOnSell });
  }
  return items;
}

// ---------------------------------------------------------------------------
// vCIO overage — CFO Model!B16/C16/D16 (sell), flat $95/hr cost term folded
// into CFO Model!B21/C21/D21 (cost).
// ---------------------------------------------------------------------------

export function computeVcioOverageHours(addOns: AddOnSelections, tierIncludedHours: number): number {
  if (!addOns.vcioEnabled) return 0;
  return Math.max(0, addOns.vcioHoursPerMonth - tierIncludedHours);
}

// ---------------------------------------------------------------------------
// Full per-tier pricing — CFO Model rows 6-28
// ---------------------------------------------------------------------------

export type TierPricingResult = {
  tier: TierKey;
  baseSubtotal: number; // CFO!B13
  riskPremium: number; // CFO!B14
  addOnMrr: number; // CFO!B15
  vcioOverageSell: number; // CFO!B16
  grossMrrBeforeDiscount: number; // CFO!B17 (already floored at minimum MRR)
  minimumMrrAdjustment: number; // amount added by the minimum-MRR floor, 0 if not applied
  discountAmount: number; // CFO!B18
  finalMrr: number; // CFO!B19
  annualContractValue: number; // CFO!B20
  directCost: number; // CFO!B21
  grossProfit: number; // CFO!B22
  grossMarginPct: number; // CFO!B23
  targetGrossMarginPct: number; // CFO!B24
  marginVariancePct: number; // CFO!B25
  marginStatus: "OK" | "REVIEW";
  onboardingFeeSell: number; // CFO!B26
  onboardingCost: number; // CFO!B27
  onboardingGrossProfit: number; // CFO!B28
};

export function computeTierPricing(input: {
  quantities: Quantities;
  riskAdjustmentPct: number;
  addOns: AddOnSelections;
  complianceProgram: ComplianceFramework;
  rateCard: RateCard;
  tier: TierKey;
  discountPct: number;
}): TierPricingResult {
  const { quantities: q, riskAdjustmentPct, addOns, complianceProgram, rateCard, tier, discountPct } = input;
  const t = rateCard.tiers[tier];
  const scale = t.planPriceScale;
  const totalNetworkDevices = q.firewalls + q.switches + q.aps + q.otherNetworkDevices;

  const baseSubtotal =
    q.workstations * t.workstationMrr * scale +
    q.servers * t.serverMrr * scale +
    q.firewalls * t.firewallMrr * scale +
    q.switches * t.switchMrr * scale +
    q.aps * t.apMrr * scale +
    q.locations * t.locationMrr * scale +
    q.users * t.userMrr * scale;

  const riskPremium = baseSubtotal * riskAdjustmentPct;
  const { sell: addOnMrr, cost: addOnCost } = computeAddOnMrr(addOns, complianceProgram, rateCard);

  const vcioOverageHours = computeVcioOverageHours(addOns, t.vcioIncludedHoursPerMonth);
  const vcioOverageSell = vcioOverageHours * t.additionalVcioRatePerHour;
  const vcioOverageCost = vcioOverageHours * rateCard.optionalServices.vcioOverageDirectCostPerHour;

  const grossMrrBeforeFloor = baseSubtotal + riskPremium + addOnMrr + vcioOverageSell;
  const grossMrrBeforeDiscount = Math.max(t.minimumMrr, grossMrrBeforeFloor);
  const minimumMrrAdjustment = grossMrrBeforeDiscount - grossMrrBeforeFloor;

  const discountAmount = grossMrrBeforeDiscount * discountPct;
  const finalMrr = grossMrrBeforeDiscount - discountAmount;
  const annualContractValue = finalMrr * 12;

  const directCost =
    q.workstations * t.directCostPerWorkstation +
    q.servers * t.directCostPerServer +
    totalNetworkDevices * t.directCostPerNetworkDevice +
    q.users * t.directCostPerUser +
    q.locations * t.directCostPerLocation +
    addOnCost +
    vcioOverageCost;

  const grossProfit = finalMrr - directCost;
  const grossMarginPct = finalMrr > 0 ? grossProfit / finalMrr : 0;
  const targetGrossMarginPct = t.targetGrossMarginPct;
  const marginVariancePct = grossMarginPct - targetGrossMarginPct;
  const marginStatus: "OK" | "REVIEW" = grossMarginPct >= targetGrossMarginPct ? "OK" : "REVIEW";

  const onboardingHours =
    q.workstations * t.onboardingHoursPerWorkstation +
    q.servers * t.onboardingHoursPerServer +
    totalNetworkDevices * t.onboardingHoursPerNetworkDevice +
    q.locations * t.onboardingHoursPerLocation;

  const onboardingFeeSell = onboardingHours * t.onboardingSellRatePerHour + addOns.oneTimeProjectSell;
  const onboardingCost = onboardingHours * t.onboardingLaborCostPerHour + addOns.oneTimeProjectCost;
  const onboardingGrossProfit = onboardingFeeSell - onboardingCost;

  return {
    tier,
    baseSubtotal,
    riskPremium,
    addOnMrr,
    vcioOverageSell,
    grossMrrBeforeDiscount,
    minimumMrrAdjustment,
    discountAmount,
    finalMrr,
    annualContractValue,
    directCost,
    grossProfit,
    grossMarginPct,
    targetGrossMarginPct,
    marginVariancePct,
    marginStatus,
    onboardingFeeSell,
    onboardingCost,
    onboardingGrossProfit,
  };
}

export function computeAllTiers(input: {
  quantities: Quantities;
  risk: RiskFactors;
  addOns: AddOnSelections;
  rateCard: RateCard;
  discountPct: number;
}): Record<TierKey, TierPricingResult> {
  const riskAdjustmentPct = effectiveRiskAdjustment(input.risk);
  const result = {} as Record<TierKey, TierPricingResult>;
  for (const tier of TIER_KEYS) {
    result[tier] = computeTierPricing({
      quantities: input.quantities,
      riskAdjustmentPct,
      addOns: input.addOns,
      complianceProgram: input.risk.complianceProgram,
      rateCard: input.rateCard,
      tier,
      discountPct: input.discountPct,
    });
  }
  return result;
}

// Sales Dashboard!G15 — "Total Contract Value" = MRR * contract term
// (months) + the one-time onboarding fee. Distinct from the 12-month ACV.
export function computeTotalContractValue(finalMrr: number, termMonths: number, onboardingFeeSell: number): number {
  return finalMrr * termMonths + onboardingFeeSell;
}

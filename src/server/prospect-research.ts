// Pure content-builder for Prospects → "Research a business" — same "no DB
// access, no side effects" shape as ai-review.ts / msa.ts. Everything here is
// deterministic and testable on its own: the prompt, the JSON parser and its
// format guards, the duplicate-matching normalizers, the MX → email-provider
// classifier, and the activity-note builder. The server action that actually
// calls Claude, does the live MX lookup and writes to the database lives in
// src/server/actions/prospect-research.ts.
//
// Field mapping mirrors the ChatGPT prospecting-sweep spreadsheet that
// importProspects already understands (Company Name, Address, City, State,
// ZIP, Industry, Main Phone, Website, Public Email, Confidence, Decision
// Maker, Title, Employee Estimate/Evidence, Business / IT Signals, Security /
// Complexity Signals, Decision-Maker Notes, Qualification Notes, Primary
// Source, Email/Phone Source, Email Status, Outreach Status), plus the extra
// fields listed on ResearchRecord below.

import { normalizeState, formatDate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResearchContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
};

export type ResearchConfidence = "High" | "Medium" | "Low";

// One researched business, as returned by the model (after format guards).
// Every field is nullable/empty rather than guessed — see the system prompt.
export type ResearchRecord = {
  // Spreadsheet-equivalent fields
  companyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  industry: string | null;
  mainPhone: string | null;
  website: string | null;
  publicEmail: string | null;
  confidence: ResearchConfidence | null;
  decisionMaker: string | null;
  decisionMakerTitle: string | null;
  employeeEstimate: string | null;
  employeeEvidence: string | null;
  businessItSignals: string[];
  securityComplexitySignals: string[];
  decisionMakerNotes: string | null;
  qualificationNotes: string | null;
  primarySource: string | null;
  emailPhoneSource: string | null;
  emailStatus: string | null;
  outreachStatus: string | null;

  // Added fields
  existingItProvider: string | null;
  existingItProviderEvidence: string | null;
  complianceFrameworks: string[];
  linkedinUrl: string | null;
  socialLinks: string[];
  yearFounded: string | null;
  ownershipType: string | null;
  locationCount: number | null;
  otherLocations: string[];
  hours: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  itHiringSignals: string[];
  recentNews: string[];
  additionalContacts: ResearchContact[];
  talkingPoints: string[];
  sourceUrls: string[];
};

export type EmailProviderInfo = {
  domain: string;
  provider: string; // e.g. "Microsoft 365", "Google Workspace", "Behind Proofpoint (…)", "No MX records found"
  mxHosts: string[];
};

// What researchBusiness hands back to the dialog, and what the dialog sends
// back (possibly edited) to saveResearchedProspect.
export type ResearchResult = {
  record: ResearchRecord;
  emailProvider: EmailProviderInfo | null;
  model: string;
  researchedAt: string; // ISO
};

// Stored as-is in customers.research (jsonb).
export type ResearchSnapshot = ResearchResult & {
  prospectExternalId: string;
  researchedById: string;
  staffContext: string | null;
  lookupInput: ResearchLookupInput;
};

export type ResearchLookupInput = {
  name: string;
  city: string;
  state: string;
  website: string;
  knownInfo: string;
};

export type DuplicateMatch = {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  reasons: ("name" | "website" | "phone")[];
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const RESEARCH_SYSTEM_PROMPT = `You are a B2B sales researcher for an IT managed service provider (MSP) that sells managed IT, cybersecurity, and network infrastructure services to small and mid-sized businesses. Staff give you one business name (usually with a city/state) and you research it on the public web, then return ONE structured record that will be added to the MSP's CRM as a prospect.

Use web search. Good sources: the business's own website (About, Contact, Team, Careers pages), its Google Business Profile, LinkedIn company page, state corporation filings, local news, industry directories, and job postings. Use up to about 8 searches; stop when the record is reasonably complete.

Rules — follow all of them:
- Public BUSINESS information only. Never include anyone's home address, personal cell phone, personal email, date of birth, family details, or personal (non-business) social media. A decision-maker's name and job title are fine when the business itself publishes them (website, LinkedIn company page, press). Only include a person's email or phone if it is published by the business for business use.
- Never guess. If you could not find a value, use null (or [] for lists). Do not invent email addresses from a name pattern, and do not infer a phone number.
- Make sure you have the RIGHT business: match the name AND the city/state given. If several businesses share the name, pick the one in the given location and say so in qualificationNotes. If you cannot confidently identify the business at all, return companyName exactly as given, set confidence to "Low", and explain in qualificationNotes.
- Put each value in its correct field: mainPhone is a phone number only; website is a URL only (never a phone number or email); publicEmail is an email address only.
- confidence is how sure you are that this record is accurate AND that this is a reasonable managed-IT prospect: "High" (identity confirmed on the business's own site/profile, key fields verified), "Medium" (identity likely, some fields unverified), or "Low".
- employeeEstimate is a range such as "11-50" when evidence supports one; employeeEvidence says what it's based on.
- existingItProvider: an MSP / IT company the business appears to use (e.g. a "website by"/"IT by" credit, a case study or testimonial on an MSP's site, a job post mentioning one). Null if not found. Explain in existingItProviderEvidence.
- complianceFrameworks: frameworks that likely apply given the industry (e.g. HIPAA for medical/dental/veterinary-with-human-data, PCI DSS for card payments, GLBA/FTC Safeguards for financial and auto dealers, CMMC/NIST 800-171 for defense contractors). Only include ones with a clear basis.
- businessItSignals / securityComplexitySignals / itHiringSignals / recentNews / talkingPoints: short plain-English bullet strings. talkingPoints are 2-4 specific, non-generic openers an MSP salesperson could use, grounded in what you found.
- emailStatus describes what you found for publicEmail (e.g. "Published on website", "Contact form only", "Not found"). outreachStatus is always "Not contacted".
- primarySource is the single most useful URL. sourceUrls lists every URL you relied on.
- additionalContacts: other named staff the business publishes (office manager, practice administrator, IT contact, owners), same privacy rules.

Respond with ONLY a single JSON object — no markdown fences, no commentary before or after — in exactly this shape:
{
  "companyName": string,
  "address": string | null,            // street address only
  "city": string | null,
  "state": string | null,              // 2-letter code
  "zip": string | null,
  "industry": string | null,
  "mainPhone": string | null,
  "website": string | null,
  "publicEmail": string | null,
  "confidence": "High" | "Medium" | "Low",
  "decisionMaker": string | null,      // full name
  "decisionMakerTitle": string | null,
  "employeeEstimate": string | null,
  "employeeEvidence": string | null,
  "businessItSignals": string[],
  "securityComplexitySignals": string[],
  "decisionMakerNotes": string | null,
  "qualificationNotes": string | null,
  "primarySource": string | null,
  "emailPhoneSource": string | null,
  "emailStatus": string | null,
  "outreachStatus": "Not contacted",
  "existingItProvider": string | null,
  "existingItProviderEvidence": string | null,
  "complianceFrameworks": string[],
  "linkedinUrl": string | null,
  "socialLinks": string[],             // business social profiles only
  "yearFounded": string | null,
  "ownershipType": string | null,      // e.g. "Independent / owner-operated", "Private equity-backed group", "Franchise", "Public company subsidiary"
  "locationCount": number | null,
  "otherLocations": string[],
  "hours": string | null,
  "googleRating": number | null,
  "googleReviewCount": number | null,
  "itHiringSignals": string[],
  "recentNews": string[],
  "additionalContacts": [{ "name": string, "title": string | null, "email": string | null, "phone": string | null, "source": string | null }],
  "talkingPoints": string[],
  "sourceUrls": string[]
}`;

export function buildResearchPrompt(input: ResearchLookupInput): string {
  const lines = [
    `Research this business and return the JSON record:`,
    ``,
    `Business name: ${input.name.trim()}`,
    `Location: ${[input.city.trim(), input.state.trim()].filter(Boolean).join(", ") || "(not given)"}`,
  ];
  if (input.website.trim()) lines.push(`Website (given by staff): ${input.website.trim()}`);
  if (input.knownInfo.trim()) {
    lines.push(``, `What our staff already know (treat as a lead to verify, not as fact):`, input.knownInfo.trim());
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON extraction + format guards
// ---------------------------------------------------------------------------

// Finds the first balanced {...} in `raw` that parses as JSON and has a
// companyName key. Tolerant of prose or markdown fences around the object,
// and of braces inside JSON strings.
export function extractResearchJson(raw: string): Record<string, unknown> | null {
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(raw.slice(start, i + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "companyName" in parsed) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // not valid JSON from this start — try the next "{"
          }
          break;
        }
      }
    }
  }
  return null;
}

const EMPTY_WORDS = new Set(["", "null", "none", "n/a", "na", "unknown", "not found", "not available", "-", "—", "tbd"]);

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return EMPTY_WORDS.has(s.toLowerCase()) ? null : s;
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter((s): s is string => !!s);
  const single = str(v);
  if (!single) return [];
  // A model occasionally returns "a; b; c" instead of an array.
  return single.split(/\s*;\s*|\r?\n/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = str(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s.match(/\d/) ? n : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

function looksLikePhone(s: string): boolean {
  if (/[a-z@]/i.test(s.replace(/\b(ext|x)\b\.?/gi, ""))) return false;
  const d = digitsOf(s);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

function looksLikeUrl(s: string): boolean {
  if (EMAIL_RE.test(s)) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(s.trim());
}

export function formatPhone(raw: string): string {
  const d = digitsOf(raw);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw.trim();
}

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function normalizeConfidence(v: unknown): ResearchConfidence | null {
  const s = (str(v) || "").toLowerCase();
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med")) return "Medium";
  if (s.startsWith("low")) return "Low";
  return null;
}

function contactList(v: unknown): ResearchContact[] {
  if (!Array.isArray(v)) return [];
  const out: ResearchContact[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = str(o.name);
    if (!name) continue;
    const email = str(o.email);
    const phone = str(o.phone);
    out.push({
      name,
      title: str(o.title),
      email: email && EMAIL_RE.test(email) ? email : null,
      phone: phone && looksLikePhone(phone) ? formatPhone(phone) : null,
      source: str(o.source),
    });
  }
  return out.slice(0, 10);
}

// Turns an untrusted object (model output, or a record edited in the
// browser and sent back to the save action) into a clean ResearchRecord.
// Format guards swap values that landed in the wrong field — e.g. a phone
// number in Website, which happened in rows like QC-0002 of the ChatGPT
// sweep — and drop values that aren't the right shape rather than store
// garbage.
export function coerceResearchRecord(o: Record<string, unknown>, fallbackName = ""): ResearchRecord {
  let website = str(o.website);
  let mainPhone = str(o.mainPhone);
  let publicEmail = str(o.publicEmail);

  // Phone in the Website field → Main Phone (if empty), website cleared.
  if (website && looksLikePhone(website)) {
    if (!mainPhone) mainPhone = website;
    website = null;
  }
  // Email in the Website field → Public Email (if empty).
  if (website && EMAIL_RE.test(website)) {
    if (!publicEmail) publicEmail = website;
    website = null;
  }
  // URL or email in the Main Phone field → move it.
  if (mainPhone && !looksLikePhone(mainPhone)) {
    if (EMAIL_RE.test(mainPhone) && !publicEmail) publicEmail = mainPhone;
    else if (looksLikeUrl(mainPhone) && !website) website = mainPhone;
    mainPhone = null;
  }
  // URL in the Public Email field → Website (if empty).
  if (publicEmail && !EMAIL_RE.test(publicEmail)) {
    if (looksLikeUrl(publicEmail) && !website) website = publicEmail;
    publicEmail = null;
  }
  if (website && !looksLikeUrl(website)) website = null;

  const stateRaw = str(o.state);
  const zipRaw = str(o.zip);
  const zipMatch = zipRaw?.match(/\d{5}(?:-\d{4})?/);
  const linkedin = str(o.linkedinUrl);

  return {
    companyName: str(o.companyName) || fallbackName.trim(),
    address: str(o.address),
    city: str(o.city),
    state: stateRaw ? normalizeState(stateRaw) : null,
    zip: zipMatch ? zipMatch[0] : null,
    industry: str(o.industry),
    mainPhone: mainPhone ? formatPhone(mainPhone) : null,
    website: website ? normalizeUrl(website) : null,
    publicEmail: publicEmail ? publicEmail.toLowerCase() : null,
    confidence: normalizeConfidence(o.confidence),
    decisionMaker: str(o.decisionMaker),
    decisionMakerTitle: str(o.decisionMakerTitle),
    employeeEstimate: str(o.employeeEstimate),
    employeeEvidence: str(o.employeeEvidence),
    businessItSignals: strList(o.businessItSignals),
    securityComplexitySignals: strList(o.securityComplexitySignals),
    decisionMakerNotes: str(o.decisionMakerNotes),
    qualificationNotes: str(o.qualificationNotes),
    primarySource: str(o.primarySource),
    emailPhoneSource: str(o.emailPhoneSource),
    emailStatus: str(o.emailStatus),
    outreachStatus: str(o.outreachStatus) || "Not contacted",
    existingItProvider: str(o.existingItProvider),
    existingItProviderEvidence: str(o.existingItProviderEvidence),
    complianceFrameworks: strList(o.complianceFrameworks),
    linkedinUrl: linkedin && looksLikeUrl(linkedin) ? normalizeUrl(linkedin) : null,
    socialLinks: strList(o.socialLinks).filter(looksLikeUrl).map(normalizeUrl),
    yearFounded: str(o.yearFounded),
    ownershipType: str(o.ownershipType),
    locationCount: num(o.locationCount),
    otherLocations: strList(o.otherLocations),
    hours: str(o.hours),
    googleRating: num(o.googleRating),
    googleReviewCount: num(o.googleReviewCount),
    itHiringSignals: strList(o.itHiringSignals),
    recentNews: strList(o.recentNews),
    additionalContacts: contactList(o.additionalContacts),
    talkingPoints: strList(o.talkingPoints),
    sourceUrls: Array.from(new Set(strList(o.sourceUrls).filter(looksLikeUrl).map(normalizeUrl))),
  };
}

export function parseResearchText(raw: string, fallbackName: string): ResearchRecord | null {
  const json = extractResearchJson(raw);
  return json ? coerceResearchRecord(json, fallbackName) : null;
}

// ---------------------------------------------------------------------------
// Duplicate-check normalizers
// ---------------------------------------------------------------------------

const COMPANY_SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|co|company|corp|corporation|ltd|limited|pllc|pc|p\.c|pa|lp|llp|dba)\b\.?/g;

// "The Queen Creek Veterinary Clinic, LLC" and "Queen Creek Veterinary
// Clinic" compare equal.
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

// "https://www.QCvet.com/contact" → "qcvet.com"
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "cox.net", "att.net", "sbcglobal.net", "proton.me",
  "protonmail.com", "gmx.com", "zoho.com",
]);

// The business's own email domain — from the website, else from a public
// email that isn't a free-mail address (a gmail.com MX lookup says nothing
// about the business).
export function businessDomain(record: Pick<ResearchRecord, "website" | "publicEmail">): string | null {
  const fromSite = domainFromUrl(record.website);
  if (fromSite) return fromSite;
  const emailDomain = record.publicEmail?.split("@")[1]?.toLowerCase();
  if (emailDomain && !FREEMAIL_DOMAINS.has(emailDomain)) return emailDomain;
  return null;
}

// Last 10 digits, so "+1 (480) 555-0100" and "480.555.0100" match.
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = digitsOf(phone);
  return d.length >= 10 ? d.slice(-10) : null;
}

export function findDuplicateMatches(
  record: Pick<ResearchRecord, "companyName" | "website" | "mainPhone">,
  candidates: { id: string; name: string; website: string | null; phone: string | null; status: string; archivedAt: Date | null }[]
): DuplicateMatch[] {
  const name = normalizeCompanyName(record.companyName);
  const domain = domainFromUrl(record.website);
  const phone = normalizePhone(record.mainPhone);
  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    const reasons: DuplicateMatch["reasons"] = [];
    if (name && normalizeCompanyName(c.name) === name) reasons.push("name");
    if (domain && domainFromUrl(c.website) === domain) reasons.push("website");
    if (phone && normalizePhone(c.phone) === phone) reasons.push("phone");
    if (reasons.length) matches.push({ id: c.id, name: c.name, status: c.status, archived: !!c.archivedAt, reasons });
  }
  return matches.slice(0, 10);
}

// ---------------------------------------------------------------------------
// MX → email provider
// ---------------------------------------------------------------------------

const MX_PROVIDERS: [RegExp, string][] = [
  [/\.mail\.protection\.outlook\.com$|\.outlook\.com$/, "Microsoft 365"],
  [/(^|\.)(aspmx\.l\.google\.com|googlemail\.com|google\.com|smtp\.google\.com)$/, "Google Workspace"],
  [/\.secureserver\.net$/, "GoDaddy email"],
  [/\.zoho\.(com|eu|in)$/, "Zoho Mail"],
  [/\.emailsrvr\.com$/, "Rackspace Email"],
  [/\.mail\.icloud\.com$/, "iCloud Mail"],
  [/\.yahoodns\.net$/, "Yahoo Mail"],
  [/\.messagingengine\.com$/, "Fastmail"],
  [/\.protonmail\.ch$/, "Proton Mail"],
];

// Secure email gateways sit in front of the real mailbox provider, so the
// MX record can't tell us what's behind them — still a useful signal (they
// already pay for email security).
const MX_GATEWAYS: [RegExp, string][] = [
  [/\.pphosted\.com$|\.ppe-hosted\.com$/, "Proofpoint"],
  [/\.mimecast\.com$|\.mimecast-offshore\.com$/, "Mimecast"],
  [/\.barracudanetworks\.com$/, "Barracuda"],
  [/\.iphmx\.com$/, "Cisco Secure Email"],
  [/\.messagelabs\.com$/, "Broadcom / Symantec Email Security"],
  [/\.sophos\.com$|\.hydra\.sophos\.com$/, "Sophos Email"],
  [/\.trendmicro\.com$|\.tmes\.trendmicro\.com$/, "Trend Micro Email Security"],
  [/\.arsmtp\.com$|\.appriver\.com$/, "Zix / AppRiver"],
  [/\.mailanyone\.net$/, "SpamTitan"],
  [/\.securence\.com$/, "Securence"],
];

export function classifyMx(domain: string, hosts: string[]): EmailProviderInfo {
  const clean = hosts.map((h) => h.toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (clean.length === 0) return { domain, provider: "No MX records found", mxHosts: [] };
  for (const [re, label] of MX_PROVIDERS) {
    if (clean.some((h) => re.test(h))) return { domain, provider: label, mxHosts: clean };
  }
  for (const [re, label] of MX_GATEWAYS) {
    if (clean.some((h) => re.test(h))) {
      return { domain, provider: `Behind ${label} (email security gateway — underlying provider not visible)`, mxHosts: clean };
    }
  }
  return { domain, provider: `Other / self-hosted (${clean[0]})`, mxHosts: clean };
}

// ---------------------------------------------------------------------------
// Employee estimate → employeeCount (same rule as importProspects'
// parseEmployeeEstimate: low end of a range, a single number, or null).
// ---------------------------------------------------------------------------

export function employeeCountFromEstimate(raw: string | null): number | null {
  if (!raw) return null;
  const rangeMatch = raw.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)/i);
  if (rangeMatch) return Number(rangeMatch[1].replace(/,/g, ""));
  const singleMatch = raw.match(/(\d[\d,]*)\s*\+?/);
  if (singleMatch) return Number(singleMatch[1].replace(/,/g, ""));
  return null;
}

export function splitPersonName(full: string): { firstName: string; lastName: string } {
  const cleaned = full.replace(/^(dr|mr|mrs|ms|miss)\.?\s+/i, "").trim();
  const [first, ...rest] = cleaned.split(/\s+/);
  return { firstName: first || cleaned || "Primary", lastName: rest.join(" ") };
}

// ---------------------------------------------------------------------------
// Activity note
// ---------------------------------------------------------------------------

// First line of every note this feature writes (the spreadsheet importer
// uses "Prospect research (imported)" for its own).
export const RESEARCH_NOTE_TITLE = "Prospect research (AI lookup)";

function bullets(items: string[]): string | null {
  const kept = items.map((s) => s.trim()).filter(Boolean);
  return kept.length ? kept.map((s) => `• ${s}`).join("\n") : null;
}

export function buildResearchNote(snapshot: ResearchSnapshot): string {
  const r = snapshot.record;
  const sections: [string, string[]][] = [];
  const add = (heading: string, lines: (string | null | false | undefined)[]) => {
    const kept = lines.filter((l): l is string => !!l && !!l.trim());
    if (kept.length) sections.push([heading, kept]);
  };

  const googleLine =
    r.googleRating !== null
      ? `Google rating: ${r.googleRating}${r.googleReviewCount !== null ? ` (${r.googleReviewCount} reviews)` : ""}`
      : r.googleReviewCount !== null
        ? `Google reviews: ${r.googleReviewCount}`
        : null;

  // "Confidence: …" must stay at the start of its own line —
  // backfillConfidenceFromNotes reads it back out with /^Confidence:/m.
  add("AT A GLANCE", [
    `Prospect ID: ${snapshot.prospectExternalId}`,
    r.confidence && `Confidence: ${r.confidence}`,
    r.employeeEstimate && `Employee estimate: ${r.employeeEstimate}${r.employeeEvidence ? ` (${r.employeeEvidence})` : ""}`,
    !r.employeeEstimate && r.employeeEvidence && `Employee evidence: ${r.employeeEvidence}`,
    snapshot.emailProvider &&
      `Email provider: ${snapshot.emailProvider.provider} — live MX lookup on ${snapshot.emailProvider.domain}${
        snapshot.emailProvider.mxHosts.length ? ` (${snapshot.emailProvider.mxHosts.slice(0, 3).join(", ")})` : ""
      }`,
    r.existingItProvider
      ? `Existing IT provider: ${r.existingItProvider}${r.existingItProviderEvidence ? ` (${r.existingItProviderEvidence})` : ""}`
      : r.existingItProviderEvidence && `Existing IT provider: not identified (${r.existingItProviderEvidence})`,
    r.complianceFrameworks.length > 0 && `Compliance: ${r.complianceFrameworks.join(", ")}`,
    r.ownershipType && `Ownership: ${r.ownershipType}`,
    r.yearFounded && `Founded: ${r.yearFounded}`,
    r.locationCount !== null && `Locations: ${r.locationCount}`,
    r.hours && `Hours: ${r.hours}`,
    googleLine,
    `Researched: ${formatDate(new Date(snapshot.researchedAt))} (${snapshot.model})`,
  ]);
  add("OTHER LOCATIONS", [bullets(r.otherLocations)]);
  add("BUSINESS / IT SIGNALS", [bullets(r.businessItSignals)]);
  add("SECURITY / COMPLEXITY SIGNALS", [bullets(r.securityComplexitySignals)]);
  add("IT HIRING SIGNALS", [bullets(r.itHiringSignals)]);
  add("DECISION-MAKER", [
    (r.decisionMaker || r.decisionMakerTitle) && [r.decisionMaker, r.decisionMakerTitle].filter(Boolean).join(" — "),
    r.decisionMakerNotes,
  ]);
  add(
    "ADDITIONAL CONTACTS",
    r.additionalContacts.map((c) =>
      [
        [c.name, c.title].filter(Boolean).join(" — "),
        [c.email, c.phone].filter(Boolean).join(" · "),
        c.source && `(${c.source})`,
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
  add("QUALIFICATION NOTES", [r.qualificationNotes]);
  add("TALKING POINTS", [bullets(r.talkingPoints)]);
  add("RECENT NEWS", [bullets(r.recentNews)]);
  add("OUTREACH", [
    r.emailStatus && `Email status: ${r.emailStatus}`,
    r.outreachStatus && `Outreach status: ${r.outreachStatus}`,
    r.emailPhoneSource && `Email/phone found at: ${r.emailPhoneSource}`,
  ]);
  add("ONLINE PRESENCE", [r.linkedinUrl && `LinkedIn: ${r.linkedinUrl}`, ...r.socialLinks]);
  add("STAFF-PROVIDED CONTEXT", [snapshot.staffContext]);
  add("SOURCES", [
    r.primarySource && `Primary source: ${r.primarySource}`,
    ...r.sourceUrls.filter((u) => u !== r.primarySource),
  ]);

  return [RESEARCH_NOTE_TITLE, ...sections.map(([heading, lines]) => `${heading}\n${lines.join("\n")}`)].join("\n\n");
}

// "RS-0007" → next is "RS-0008". Width grows past 9999 rather than wrapping.
export const RESEARCH_ID_PREFIX = "RS-";

export function nextResearchId(existing: (string | null)[]): string {
  let max = 0;
  for (const id of existing) {
    const m = id?.match(/^RS-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${RESEARCH_ID_PREFIX}${String(max + 1).padStart(4, "0")}`;
}

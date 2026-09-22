// Shared prospect-pipeline constants used by both the server actions
// (src/server/actions/customers.ts) and client UI (the /prospects page and
// its dialogs). Kept out of customers.ts because that file has a top-level
// "use server" directive — Next.js only allows async function exports from
// a Server Actions module, so plain constants/types can't live there.
export const PROSPECT_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const STAGE_LABELS: Record<ProspectStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal sent",
  WON: "Won",
  LOST: "Lost",
};

export const STAGE_BADGE_VARIANT: Record<ProspectStage, "secondary" | "outline" | "warning" | "default" | "success" | "destructive"> = {
  NEW: "secondary",
  CONTACTED: "outline",
  QUALIFIED: "warning",
  PROPOSAL: "default",
  WON: "success",
  LOST: "destructive",
};

// Company-size filter buckets, keyed off `customers.employeeCount` (a rough
// single number — see parseEmployeeEstimate in customers.ts for how that
// gets populated from an imported range like "11-50"). "unknown" covers
// prospects with no parseable employee count at all (a very common case —
// most research-style imports describe size qualitatively, e.g. "Small
// agency", rather than with a clean numeric range).
export const SIZE_BUCKETS = [
  { value: "1-10", label: "1–10 employees", min: 1, max: 10 },
  { value: "11-50", label: "11–50 employees", min: 11, max: 50 },
  { value: "51-200", label: "51–200 employees", min: 51, max: 200 },
  { value: "201-500", label: "201–500 employees", min: 201, max: 500 },
  { value: "500+", label: "500+ employees", min: 501, max: null },
  { value: "unknown", label: "Unknown size", min: null, max: null },
] as const;
export type SizeBucketValue = (typeof SIZE_BUCKETS)[number]["value"];

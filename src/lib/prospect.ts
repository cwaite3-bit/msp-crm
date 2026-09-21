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

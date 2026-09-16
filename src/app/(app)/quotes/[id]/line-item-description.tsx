"use client";

import { useState } from "react";

// Shared by the main quote-builder's read-only line items view and the MSA
// addendum panel — a product/service description can run to a full
// paragraph (the catalog's own long-form copy, e.g. "User Support" or
// "Workstation Support"), and rendering that in full inline, every time,
// is what was pushing the whole quote page (and the addendum sidebar card)
// way down whenever such an item was on the quote. Auto-generated
// (`source: 'ENGINE'`) and hand-typed descriptions tend to be short
// one-liners and render exactly as before; only descriptions long enough
// to actually need it get collapsed with a toggle.
const LONG_DESCRIPTION_THRESHOLD = 90;

export function LineItemDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > LONG_DESCRIPTION_THRESHOLD;

  return (
    <div className="text-xs text-slate-500">
      <div className={expanded || !isLong ? "whitespace-pre-wrap" : "line-clamp-2 whitespace-pre-wrap"}>{text}</div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 font-medium text-emerald-700 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

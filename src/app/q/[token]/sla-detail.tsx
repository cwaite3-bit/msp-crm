import { SEVERITY_LEVELS, SEVERITY_LABELS, SEVERITY_DESCRIPTIONS } from "@/server/pricing-data";
import type { slas } from "@/server/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Sla = InferSelectModel<typeof slas>;

const RESPONSE_FIELD = {
  critical: "criticalResponseMinutes",
  high: "highResponseMinutes",
  medium: "mediumResponseMinutes",
  low: "lowResponseMinutes",
} as const;

const RESOLUTION_FIELD = {
  critical: "criticalResolutionHours",
  high: "highResolutionHours",
  medium: "mediumResolutionHours",
  low: "lowResolutionHours",
} as const;

function fmtMinutes(m: number) {
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} hr${m / 60 === 1 ? "" : "s"}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtHours(h: number) {
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"}`;
  if (h % 24 === 0) return `${h / 24} business day${h / 24 === 1 ? "" : "s"}`;
  return `${h} hrs`;
}

export function SlaDetail({ sla }: { sla: Sla }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Service level agreement</p>
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="font-medium text-slate-900">{sla.name}</span>
          <span className="text-xs text-slate-500">Coverage: {sla.coverageHours}</span>
        </div>
        {sla.description && <p className="mb-3 text-sm text-slate-600">{sla.description}</p>}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Severity</th>
                <th className="py-1.5 pr-3 font-medium">Target response</th>
                <th className="py-1.5 pr-3 font-medium">Target resolution</th>
              </tr>
            </thead>
            <tbody>
              {SEVERITY_LEVELS.map((level) => (
                <tr key={level} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-slate-800" title={SEVERITY_DESCRIPTIONS[level]}>
                    {SEVERITY_LABELS[level]}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{fmtMinutes(sla[RESPONSE_FIELD[level]])}</td>
                  <td className="py-1.5 pr-3 text-slate-600">{fmtHours(sla[RESOLUTION_FIELD[level]])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">Uptime guarantee: {Number(sla.uptimeGuaranteePct)}%</p>
      </div>
    </div>
  );
}

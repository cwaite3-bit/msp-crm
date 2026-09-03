import type { ScopeMatrixRow } from "@/server/pricing-data";

export function ScopeMatrixTable({ rows }: { rows: ScopeMatrixRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Service / responsibility</th>
            <th className="py-2 px-3">Bronze</th>
            <th className="py-2 px-3">Silver</th>
            <th className="py-2 px-3">Gold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2 pr-3">
                <p className="font-medium text-slate-900">{row.service}</p>
                <p className="text-xs text-slate-500">{row.customerDescription}</p>
              </td>
              <td className="py-2 px-3 text-slate-600">{row.bronze}</td>
              <td className="py-2 px-3 text-slate-600">{row.silver}</td>
              <td className="py-2 px-3 text-slate-600">{row.gold}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import Image from "next/image";
import { notFound } from "next/navigation";
import { getMsaByToken } from "@/server/actions/msa";
import { renderMsaSections, type MsaContent } from "@/server/msa";
import { MsaSignPanel } from "./msa-sign-panel";

export default async function MsaSigningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getMsaByToken(token);
  if (!result) notFound();
  const { doc } = result;
  const content = doc.content as MsaContent;
  const sections = renderMsaSections(content);

  return (
    <div className="min-h-screen bg-slate-100 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white shadow-lg print:shadow-none">
        <div className="flex items-center justify-center rounded-t-xl border-b border-slate-100 bg-white px-8 py-5">
          <Image src="/lockdown-logo.png" alt="Lockdown IT" width={5052} height={1264} className="h-10 w-auto" priority />
        </div>

        <div className="bg-slate-900 px-8 py-8 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Master Service Agreement</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {content.customerName} · Quote #{content.quoteNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-300">Generated {new Date(content.generatedAt).toLocaleDateString()}</p>
        </div>

        <div className="px-8 py-8">
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 print:hidden">
            This document was generated from the referenced quote and this provider&rsquo;s standard terms. It is a
            template provided for convenience and is not a substitute for independent legal advice.
          </div>

          <div className="flex flex-col gap-6 text-sm text-slate-700">
            {sections.map((section) => (
              <div key={section.heading}>
                <h2 className="mb-1.5 text-sm font-semibold text-slate-900">{section.heading}</h2>
                {section.paragraphs.map((p, i) => (
                  <p key={i} className="mb-1.5 leading-relaxed">
                    {p}
                  </p>
                ))}
                {section.table && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-300 text-left">
                          {section.table.headers.map((h) => (
                            <th key={h} className="py-1.5 pr-3 font-semibold text-slate-600">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-100">
                            {row.map((cell, ci) => (
                              <td key={ci} className="py-1.5 pr-3 align-top text-slate-600">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6 print:hidden">
            <MsaSignPanel
              token={token}
              status={doc.status}
              signedByName={doc.signedByName}
              signedByTitle={doc.signedByTitle}
              signedAt={doc.signedAt}
            />
            <p className="mt-3 text-xs text-slate-400">
              Prefer to sign with Adobe Acrobat Sign, DocuSign, or another e-signature product instead?{" "}
              <a href={`/api/msa/token/${token}/pdf`} target="_blank" rel="noreferrer" className="underline">
                Download this agreement as a PDF
              </a>{" "}
              to upload there instead of signing here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Public download (no login) — GET /api/msa/token/{signingToken}/pdf — the
// same unguessable-token pattern as the client quote page (/q/[token]).
// Lets a customer save/print the MSA as a PDF from the signing page,
// signed or not.
import { db } from "@/server/db";
import { msaDocuments } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { renderMsaDocumentPdf } from "@/server/actions/msa";
import type { MsaContent } from "@/server/msa";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.signingToken, token)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = await renderMsaDocumentPdf(doc.id);
  const content = doc.content as MsaContent;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MSA-Quote-${content.quoteNumber}.pdf"`,
    },
  });
}

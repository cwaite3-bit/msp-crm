// Staff-facing download: GET /api/msa/{docId}/pdf — requires login. Used
// from the quote detail page's MSA card ("Download PDF" — the file you'd
// upload to Adobe Acrobat Sign, DocuSign, etc. if you'd rather route
// signature through one of those instead of this app's own signing link).
import { auth } from "@/auth";
import { db } from "@/server/db";
import { msaDocuments } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { renderMsaDocumentPdf } from "@/server/actions/msa";
import type { MsaContent } from "@/server/msa";

export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not authenticated", { status: 401 });

  const { docId } = await params;
  const [doc] = await db.select().from(msaDocuments).where(eq(msaDocuments.id, docId)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = await renderMsaDocumentPdf(docId);
  const content = doc.content as MsaContent;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MSA-Quote-${content.quoteNumber}.pdf"`,
    },
  });
}

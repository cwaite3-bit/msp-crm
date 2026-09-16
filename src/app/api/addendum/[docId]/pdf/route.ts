// Staff-facing download: GET /api/addendum/{docId}/pdf — requires login.
// Mirrors /api/msa/[docId]/pdf exactly, for an MSA addendum instead of the
// MSA itself.
import { auth } from "@/auth";
import { db } from "@/server/db";
import { quoteAddendums } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { renderAddendumDocumentPdf } from "@/server/actions/addendums";
import type { AddendumContent } from "@/server/addendum";

export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not authenticated", { status: 401 });

  const { docId } = await params;
  const [doc] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.id, docId)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = await renderAddendumDocumentPdf(docId);
  const content = doc.content as AddendumContent;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Addendum-${content.addendumNumber ?? doc.number}-Quote-${content.quoteNumber ?? ""}.pdf"`,
    },
  });
}

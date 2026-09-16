// Public download (no login) — GET /api/addendum/token/{signingToken}/pdf —
// same unguessable-token pattern as /api/msa/token/[token]/pdf. Lets a
// customer save/print the addendum as a PDF from the signing page, signed
// or not.
import { db } from "@/server/db";
import { quoteAddendums } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { renderAddendumDocumentPdf } from "@/server/actions/addendums";
import type { AddendumContent } from "@/server/addendum";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [doc] = await db.select().from(quoteAddendums).where(eq(quoteAddendums.signingToken, token)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = await renderAddendumDocumentPdf(doc.id);
  const content = doc.content as AddendumContent;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Addendum-${content.addendumNumber ?? doc.number}-Quote-${content.quoteNumber ?? ""}.pdf"`,
    },
  });
}

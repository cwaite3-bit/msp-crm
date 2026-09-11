// Staff-facing live preview: GET /api/msa/preview/pdf — requires login.
// Renders the MSA using the CURRENTLY SAVED Settings → MSA terms plus
// fabricated sample customer/quote data, so an admin can see exactly what a
// generated MSA will look like without walking a real quote through
// Accepted -> Generate MSA first. Used by the "Preview MSA" button on the
// MSA terms settings panel. Nothing here is persisted.
import { auth } from "@/auth";
import { getMsaSettings } from "@/server/actions/settings";
import { buildSampleMsaContent } from "@/server/msa";
import { renderMsaPdf } from "@/server/msa-pdf";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Not authenticated", { status: 401 });

  const msaSettings = await getMsaSettings();
  const content = buildSampleMsaContent(msaSettings);
  const pdf = await renderMsaPdf(content);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MSA-Preview.pdf"`,
    },
  });
}

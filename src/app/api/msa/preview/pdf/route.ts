// Staff-facing live preview: GET /api/msa/preview/pdf — requires login.
// Renders the MSA using the CURRENTLY SAVED Settings → MSA terms plus
// fabricated sample customer/quote data, so an admin can see exactly what a
// generated MSA will look like without walking a real quote through
// Accepted -> Generate MSA first. Used by the "Preview MSA" button on the
// MSA terms settings panel. Nothing here is persisted.
import { auth } from "@/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getMsaSettings, getBillingSettings } from "@/server/actions/settings";
import { buildSampleMsaContent } from "@/server/msa";
import { renderMsaPdf } from "@/server/msa-pdf";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Not authenticated", { status: 401 });

  const msaSettings = await getMsaSettings();
  const billingSettings = await getBillingSettings();
  // Preview it with the logged-in staff member's own contact card, so
  // whoever clicks "Preview MSA" sees exactly what a client would see on a
  // document they generated — not a placeholder name.
  const [me] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const content = buildSampleMsaContent(msaSettings, {
    annualDiscountPct: billingSettings.annualDiscountPct,
    accountContact: me ? { name: me.name, title: me.title, email: me.email, phone: me.phone, photoUrl: me.photoUrl } : null,
  });
  const pdf = await renderMsaPdf(content);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MSA-Preview.pdf"`,
    },
  });
}

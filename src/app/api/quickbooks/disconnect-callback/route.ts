import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { quickbooksConnections } from "@/server/db/schema";

// Intuit's "Disconnect URL" (set in the app's Production settings) — the
// browser is redirected here if QuickBooks itself is what disconnects this
// app (e.g. the customer clicks "Disconnect" from inside QuickBooks' own
// Apps menu), as opposed to using our own "Disconnect" button in Settings
// (see disconnect-button.tsx / disconnectQuickBooks()). Without this route,
// that path would leave a stale, now-invalid connection row in our
// database — the next "Send invoice to QuickBooks" click would fail with a
// confusing 401 instead of a clear "not connected" state. Deliberately
// public (see src/proxy.ts) and unauthenticated, since Intuit's redirect
// may not carry this app's own session cookie; the only effect of hitting
// it is clearing the stored connection, which is low-stakes to expose and
// harmless if hit more than once.
export async function GET(req: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL || req.nextUrl.origin;
  await db.delete(quickbooksConnections);
  return NextResponse.redirect(new URL("/settings?qbo_disconnected=1", baseUrl));
}

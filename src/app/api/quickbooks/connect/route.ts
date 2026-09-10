import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { QBO_AUTHORIZE_URL, QBO_SCOPE, getQboEnv } from "@/server/quickbooks/config";

export async function GET(req: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL || req.nextUrl.origin;

  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/settings", baseUrl));
  }

  // getQboEnv() throws when QBO_CLIENT_ID / QBO_CLIENT_SECRET /
  // QBO_REDIRECT_URI aren't set in this environment's env vars - catch that
  // here and send the admin back to Settings with a clear message (the page
  // already renders `qbo_error`, same as the OAuth callback route below),
  // instead of letting it fall through as an unhandled 500 with no
  // explanation of what actually went wrong.
  let clientId: string;
  let redirectUri: string;
  try {
    ({ clientId, redirectUri } = getQboEnv());
  } catch (err) {
    const message = err instanceof Error ? err.message : "QuickBooks is not configured.";
    return NextResponse.redirect(new URL(`/settings?qbo_error=${encodeURIComponent(message)}`, baseUrl));
  }

  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("qbo_oauth_state", state, { httpOnly: true, secure: true, maxAge: 600, sameSite: "lax" });

  const url = new URL(QBO_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}

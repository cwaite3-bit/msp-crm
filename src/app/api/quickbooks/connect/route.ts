import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { QBO_AUTHORIZE_URL, QBO_SCOPE, getQboEnv } from "@/server/quickbooks/config";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/settings", process.env.APP_BASE_URL || "http://localhost:3000"));
  }

  const { clientId, redirectUri } = getQboEnv();
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

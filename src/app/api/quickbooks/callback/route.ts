import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { quickbooksConnections } from "@/server/db/schema";
import { auth } from "@/auth";
import { QBO_TOKEN_URL, getQboEnv } from "@/server/quickbooks/config";

export async function GET(req: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL || req.nextUrl.origin;
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/settings?qbo_error=${encodeURIComponent(error)}`, baseUrl));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("qbo_oauth_state")?.value;
  cookieStore.delete("qbo_oauth_state");

  if (!code || !realmId || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings?qbo_error=invalid_state", baseUrl));
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  const { clientId, clientSecret, redirectUri, environment } = getQboEnv();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return NextResponse.redirect(
      new URL(`/settings?qbo_error=${encodeURIComponent("token_exchange_failed: " + body.slice(0, 200))}`, baseUrl)
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };

  // Single-company app: replace any existing connection.
  await db.delete(quickbooksConnections);
  await db.insert(quickbooksConnections).values({
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000),
    environment,
    connectedById: session.user.id,
  });

  return NextResponse.redirect(new URL("/settings?qbo_connected=1", baseUrl));
}

import { db } from "@/server/db";
import { quickbooksConnections } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { QBO_TOKEN_URL, qboApiBase, QBO_MINOR_VERSION, getQboEnv } from "./config";

export class QuickBooksNotConnectedError extends Error {
  constructor() {
    super("QuickBooks is not connected. Connect it from Settings first.");
  }
}

async function getConnectionRow() {
  const [row] = await db
    .select()
    .from(quickbooksConnections)
    .orderBy(desc(quickbooksConnections.createdAt))
    .limit(1);
  if (!row) throw new QuickBooksNotConnectedError();
  return row;
}

async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getQboEnv();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuickBooks token refresh failed (${res.status}): ${body}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };
}

// Returns a valid access token + realmId + environment, refreshing (and
// persisting the new tokens) if the current access token has expired.
async function getValidConnection() {
  let row = await getConnectionRow();
  const now = new Date();

  if (row.accessTokenExpiresAt.getTime() - now.getTime() < 60_000) {
    const tokens = await refreshAccessToken(row.refreshToken);
    const [updated] = await db
      .update(quickbooksConnections)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(quickbooksConnections.id, row.id))
      .returning();
    row = updated;
  }

  return row;
}

export async function qboFetch(path: string, init: RequestInit = {}) {
  const conn = await getValidConnection();
  const base = qboApiBase(conn.environment);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}/v3/company/${conn.realmId}${path}${sep}minorversion=${QBO_MINOR_VERSION}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuickBooks API error (${res.status}) on ${path}: ${body}`);
  }
  return res.json();
}

export async function qboQuery<T = unknown>(query: string): Promise<T[]> {
  const data = (await qboFetch(`/query?query=${encodeURIComponent(query)}`)) as {
    QueryResponse?: Record<string, unknown>;
  };
  const qr = data.QueryResponse || {};
  // The QueryResponse key matching the entity name holds the array, e.g. "Customer": [...]
  const entries = Object.entries(qr).find(([k]) => k !== "startPosition" && k !== "maxResults");
  return (entries?.[1] as T[]) || [];
}

export async function isQuickBooksConnected() {
  try {
    await getConnectionRow();
    return true;
  } catch {
    return false;
  }
}

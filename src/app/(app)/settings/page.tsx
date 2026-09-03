import { auth } from "@/auth";
import { getQuickBooksStatus } from "@/server/actions/quickbooks";
import { listUsers } from "@/server/actions/users";
import { getRateCard, getScopeMatrix } from "@/server/actions/settings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { UsersPanel } from "./users-panel";
import { DisconnectButton } from "./disconnect-button";
import { RateCardPanel } from "./rate-card-panel";
import { ScopeMatrixPanel } from "./scope-matrix-panel";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qbo_connected?: string; qbo_error?: string }>;
}) {
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";
  const { qbo_error } = await searchParams;

  const qbo = await getQuickBooksStatus();
  const allUsers = isAdmin ? await listUsers() : [];
  const rateCard = await getRateCard();
  const scopeMatrix = await getScopeMatrix();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">QuickBooks connection and staff accounts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>QuickBooks Online</CardTitle>
          <CardDescription>Accepted quotes are invoiced through this connection.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {qbo_error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Connection failed: {decodeURIComponent(qbo_error)}
            </p>
          )}
          {qbo.connected ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">Connected</Badge>
                  <span className="text-sm text-slate-500 capitalize">{qbo.environment}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Realm ID {qbo.realmId} · connected {formatDate(qbo.connectedAt)}
                </p>
              </div>
              {isAdmin && <DisconnectButton />}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Not connected.</p>
              {isAdmin ? (
                <a href="/api/quickbooks/connect">
                  <Button>Connect to QuickBooks</Button>
                </a>
              ) : (
                <p className="text-sm text-slate-400">Ask an admin to connect QuickBooks.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Staff accounts</CardTitle>
            <CardDescription>Internal users who can log into the CRM.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsersPanel users={allUsers} />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Rate card</CardTitle>
            <CardDescription>
              Drives the Discovery pricing engine on every quote — the same numbers as the Bronze/Silver/Gold
              plans in the old quote-builder spreadsheet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RateCardPanel rateCard={rateCard} />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Scope matrix</CardTitle>
            <CardDescription>The feature-by-plan comparison table shown on client proposals.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScopeMatrixPanel scopeMatrix={scopeMatrix} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

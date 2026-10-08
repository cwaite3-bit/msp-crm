// POST /api/prospects/sweeps/{sweepId}/areas/{index} — runs one search area
// of a Prospects → Area sweep (Claude + web search, then geocoding). Staff
// login required. A Route Handler rather than a Server Action on purpose:
// Next.js runs a tab's Server Actions one at a time, so this is the only
// way the dialog can run two areas at once without blocking the rest of
// the page. See src/server/area-sweep-runner.ts.
import { auth } from "@/auth";
import { runSweepAreaNow } from "@/server/area-sweep-runner";

// One area is a 30–150s Claude + web search call plus geocoding.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ sweepId: string; index: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  // Same-origin only (this spends money) — the session cookie alone isn't
  // proof the request came from this app's own page.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (!host || new URL(origin).host !== host) {
      return Response.json({ ok: false, error: "Cross-origin request refused" }, { status: 403 });
    }
  }

  const { sweepId, index } = await params;
  const result = await runSweepAreaNow(String(sweepId), Number(index));
  return Response.json(result, { status: result.ok ? 200 : result.status });
}

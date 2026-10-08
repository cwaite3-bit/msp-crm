// Live MX lookup → email provider (Microsoft 365, Google Workspace, behind
// Proofpoint, …). Server-only (node:dns). Shared by Prospects → Research a
// business and Prospects → Area sweep; the hostname → provider mapping
// itself is the pure classifyMx in src/server/prospect-research.ts.
import { resolveMx } from "node:dns/promises";
import { classifyMx, type EmailProviderInfo } from "@/server/prospect-research";

export async function lookupEmailProvider(domain: string | null): Promise<EmailProviderInfo | null> {
  if (!domain) return null;
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    const hosts = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    return classifyMx(domain, hosts);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // ENODATA / ENOTFOUND: the domain answers but has no MX, or doesn't
    // resolve at all — both are real findings worth recording.
    if (code === "ENODATA" || code === "ENOTFOUND") return classifyMx(domain, []);
    return null; // timeout / resolver failure — just leave it out
  }
}

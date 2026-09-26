// Which Claude model the app's staff-only AI features call (AI quote review,
// Prospects → Research a business). One place so both features always use
// the same model and the same ANTHROPIC_MODEL override in Vercel — set that
// env var to a Sonnet model to trade some quality for lower cost.
//
// Opus is the default because both features are manually triggered,
// low-volume, deep-dive analyses where the stronger model is worth it.
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export function resolveAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

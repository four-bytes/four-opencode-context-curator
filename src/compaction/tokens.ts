/**
 * Token estimator — adapted from four-opencode-token-budget-guard.
 * Uses chars/4 heuristic. Cheap, no native deps.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an opencode message (sum over text parts).
 */
export function estimateMessageTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return 0;
  let total = 0;
  for (const part of parts) {
    if (part && typeof part === "object") {
      const text = (part as { text?: string }).text;
      if (typeof text === "string") total += estimateTokens(text);
    }
  }
  return total;
}

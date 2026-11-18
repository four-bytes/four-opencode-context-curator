export interface CompactionSignal {
  advice: "no_compact" | "compact_soon" | "compact_now";
  reason: string;
  safeToCompact: string[];
}

export function parseCompactionSignal(text: string): CompactionSignal | null {
  const adviceMatch = text.match(/compaction_advice:\s*(no_compact|compact_soon|compact_now)/i);
  if (!adviceMatch) return null;

  // Guard: signal block must be at/near end of text (not mid-echo from file reads)
  if (adviceMatch.index !== undefined && adviceMatch.index < text.length - Math.max(300, Math.ceil(text.length * 0.2))) return null;
  const adviceRaw = adviceMatch[1].toLowerCase();
  if (adviceRaw !== "no_compact" && adviceRaw !== "compact_soon" && adviceRaw !== "compact_now") {
    return null;
  }
  const advice = adviceRaw as CompactionSignal["advice"];

  const reasonMatch = text.match(/reason:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : "";

  const safeMatch = text.match(/safe_to_compact:\s*(.+)/i);
  const safeToCompact = safeMatch
    ? safeMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return { advice, reason, safeToCompact };
}

/** Strip compaction_advice block from text (for testing). */
export function stripCompactionSignal(text: string): string {
  // Index-based instead of a regex: the old `/\n*compaction_advice:.*[\s\S]*$/i`
  // backtracks polynomially on inputs with many '\n' (ReDoS, CWE-1333).
  // `indexOf` on the lowercased text is linear and case-insensitive equivalent.
  const idx = text.toLowerCase().indexOf("compaction_advice:");
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}

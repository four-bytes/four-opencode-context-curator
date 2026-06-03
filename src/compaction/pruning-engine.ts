import {
  getCompactionState,
  markAppliedPruning,
  wasAppliedPruning,
  addEvent,
} from "./state.js";
import { writeDiaryEntry } from "./diary.js";

export interface PruningConfig {
  /** Max lines before truncation kicks in */
  maxToolLogLines: number;
  /** Lines to keep at top */
  headerLines: number;
  /** Lines to keep at bottom */
  footerLines: number;
  /** Minimum completed blocks before pruning activates */
  minCompletedBlocks: number;
  /** Session ID for session-fenced state (default: env OPENDOC_SESSION_ID or "default") */
  sessionID?: string;
}

export interface PruningStats {
  originalLines: number;
  prunedLines: number;
  blocksCondensed: number;
  duplicatesRemoved: number;
}

const DEFAULT_CONFIG: PruningConfig = {
  maxToolLogLines: 50,
  headerLines: 10,
  footerLines: 10,
  minCompletedBlocks: 1,
};

/**
 * Truncate a text block if it exceeds maxLines.
 * Keeps header (first 10) + footer (last 10) + truncation marker.
 */
export function truncateToolLogs(
  text: string,
  maxLines: number = DEFAULT_CONFIG.maxToolLogLines,
): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;

  const header = lines.slice(0, DEFAULT_CONFIG.headerLines).join("\n");
  const footer = lines.slice(-DEFAULT_CONFIG.footerLines).join("\n");
  const truncated = lines.length - DEFAULT_CONFIG.headerLines - DEFAULT_CONFIG.footerLines;

  return `${header}\n… [${truncated} lines truncated] …\n${footer}`;
}

/**
 * Remove duplicate content blocks within a single turn.
 * Replaces duplicates with a reference marker.
 * Uses simple hash-based detection.
 */
export function deduplicateToolOutputs(
  contents: string[],
): { contents: string[]; duplicatesRemoved: number } {
  const seen = new Map<string, number>();
  const result: string[] = [];
  let duplicatesRemoved = 0;

  for (const content of contents) {
    const hash = simpleHash(content);
    if (seen.has(hash)) {
      const blockIndex = seen.get(hash)!;
      result.push(`↑ see above (block ${blockIndex + 1})`);
      duplicatesRemoved++;
    } else {
      seen.set(hash, result.length);
      result.push(content);
    }
  }

  return { contents: result, duplicatesRemoved };
}

/**
 * Condense a completed issue slice to a 1-line summary.
 * Only condenses if safe_to_compact includes a matching issue block.
 */
export function condenseIssueSlice(
  content: string,
  safeToCompact: string[],
): string {
  if (safeToCompact.length === 0) return content;
  if (!content.includes("ACTIVE ISSUE:")) return content;

  const issueMatch = content.match(/ACTIVE ISSUE:\s*#(\d+)/);
  if (!issueMatch) return content;

  const issueNr = issueMatch[1];
  const isCompleted = safeToCompact.some((b) =>
    b.toLowerCase().includes(`issue_${issueNr}`),
  );

  if (!isCompleted) return content;

  // Extract title from gh issue output (JSON)
  const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
  const title = titleMatch ? titleMatch[1] : "";

  const now = new Date().toISOString().split("T")[0];
  return `Issue #${issueNr}: ${title} — COMPLETED (${now})`;
}

/**
 * Main pruning entry point.
 * Applies all three heuristics: truncate, dedupe, condense.
 * Returns modified contents + stats.
 * No-op if no signal, no_compact, or no new blocks.
 */
export function applyPruning(
  layerContents: string[],
  config: Partial<PruningConfig> = {},
): { contents: string[]; stats: PruningStats } {
  const cfg: PruningConfig = { ...DEFAULT_CONFIG, ...config };
  const sessionID = cfg.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sessionID);
  const signal = state.lastSignal;

  const stats: PruningStats = {
    originalLines: layerContents.reduce(
      (sum, c) => sum + c.split("\n").length,
      0,
    ),
    prunedLines: 0,
    blocksCondensed: 0,
    duplicatesRemoved: 0,
  };

  // Guard: no signal, no_compact, or not enough blocks → no-op
  // UNLESS CC_COMPACTION_TRIGGER is set → apply generic heuristics
  const triggered = process.env.CC_COMPACTION_TRIGGER === "true";
  if (!triggered) {
    if (!signal || signal.advice === "no_compact" || signal.safeToCompact.length < cfg.minCompletedBlocks) {
      stats.prunedLines = stats.originalLines;
      return { contents: layerContents, stats };
    }
  }

  // Guard: already applied for all requested blocks (skip if trigger-only, no signal)
  if (signal) {
    const newBlocks = signal.safeToCompact.filter((b) => !wasAppliedPruning(sessionID, b));
    if (newBlocks.length === 0 && !triggered) {
      stats.prunedLines = stats.originalLines;
      return { contents: layerContents, stats };
    }
  }

  // Step 1: Truncate long tool outputs
  const truncated = layerContents.map((c) =>
    truncateToolLogs(c, cfg.maxToolLogLines),
  );

  // Step 2: Deduplicate repeated outputs
  const { contents: deduped, duplicatesRemoved } =
    deduplicateToolOutputs(truncated);
  stats.duplicatesRemoved = duplicatesRemoved;

  // Step 3: Condense completed issue slices (skip if no signal — trigger-only mode)
  const safeToCompact = signal?.safeToCompact ?? [];
  const condensed = deduped.map((c) => {
    const condensedContent = condenseIssueSlice(c, safeToCompact);
    if (condensedContent !== c) stats.blocksCondensed++;
    return condensedContent;
  });

  stats.prunedLines = condensed.reduce(
    (sum, c) => sum + c.split("\n").length,
    0,
  );

  // Mark all safe_to_compact blocks as applied (skip if trigger-only)
  if (signal) {
    for (const block of safeToCompact) {
      markAppliedPruning(sessionID, block);
    }
  }

  // Record event
  addEvent(sessionID, {
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: stats.blocksCondensed,
  });

  // Write diary entry
  const reductionPct =
    stats.originalLines > 0
      ? Math.round(
          ((stats.originalLines - stats.prunedLines) / stats.originalLines) * 100,
        )
      : 0;

  writeDiaryEntry({
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: stats.blocksCondensed,
    duplicatesRemoved: stats.duplicatesRemoved,
    linesBefore: stats.originalLines,
    linesAfter: stats.prunedLines,
    reductionPct,
    sessionId: process.env.OPENDOC_SESSION_ID || "unknown",
    triggered: process.env.CC_COMPACTION_TRIGGER === "true",
  });

  // eslint-disable-next-line no-console
  console.warn(
    `[four-cc:pruning] COMPACTED: ${stats.originalLines}→${stats.prunedLines} lines ` +
      `(${stats.blocksCondensed} blocks, ${stats.duplicatesRemoved} dups) — ${signal?.reason ?? "triggered"}`,
  );

  return { contents: condensed, stats };
}

/** Simple 32-bit string hash for dedup detection (not crypto). */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return String(hash);
}

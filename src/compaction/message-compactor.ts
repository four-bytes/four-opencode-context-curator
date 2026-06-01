import { getCompactionState, clearSignal, markApplied, wasApplied, addEvent } from "./state.js";
import { writeDiaryEntry } from "./diary.js";
import type { CompactionSignal } from "./signal-parser.js";

export interface Part {
  type: string;
  text?: string;
}

export interface MessageItem {
  info: { role?: string; [key: string]: unknown };
  parts: Part[];
}

export interface CompactionResult {
  messagesBefore: number;
  messagesAfter: number;
  charsBefore: number;
  charsAfter: number;
  reductionPct: number;
  applied: boolean;
}

const MAX_TOOL_LINES = 50;
const HEADER_LINES = 10;
const FOOTER_LINES = 10;

/**
 * Count total characters across all message parts.
 */
function countChars(messages: MessageItem[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        total += part.text.length;
      }
    }
  }
  return total;
}

/**
 * Truncate long text parts within messages.
 */
export function truncateMessageParts(messages: MessageItem[]): number {
  let truncations = 0;

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const lines = part.text.split("\n");
        if (lines.length > MAX_TOOL_LINES) {
          part.text = [
            ...lines.slice(0, HEADER_LINES),
            `… [${lines.length - HEADER_LINES - FOOTER_LINES} lines truncated] …`,
            ...lines.slice(-FOOTER_LINES),
          ].join("\n");
          truncations++;
        }
      }
    }
  }

  return truncations;
}

/**
 * Deduplicate repeated text parts across messages.
 * Replaces duplicates with a reference to the first occurrence.
 */
export function deduplicateMessageParts(messages: MessageItem[]): number {
  const seen = new Map<string, number>();
  let duplicates = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    for (const part of msg.parts) {
      if (part.type === "text" && part.text && part.text.length > 20) {
        const hash = simpleHash(part.text);
        if (seen.has(hash)) {
          const firstMsgIdx = seen.get(hash)!;
          part.text = `↑ see above (message ${firstMsgIdx + 1})`;
          duplicates++;
        } else {
          seen.set(hash, msgIdx);
        }
      }
    }
  }

  return duplicates;
}

/**
 * Main entry point: apply heuristics to reduce message context.
 * Returns compaction statistics.
 */
export function compactMessageHistory(messages: MessageItem[]): CompactionResult {
  const state = getCompactionState();
  const signal = state.lastSignal;

  if (!signal || signal.advice === "no_compact" || signal.safeToCompact.length === 0) {
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: countChars(messages),
      charsAfter: countChars(messages),
      reductionPct: 0,
      applied: false,
    };
  }

  // Check if already applied for these blocks
  const newBlocks = signal.safeToCompact.filter((b) => !wasApplied(b));
  if (newBlocks.length === 0) {
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: countChars(messages),
      charsAfter: countChars(messages),
      reductionPct: 0,
      applied: false,
    };
  }

  const charsBefore = countChars(messages);
  const messagesBefore = messages.length;

  // Step 1: Truncate long tool outputs
  const truncations = truncateMessageParts(messages);

  // Step 2: Deduplicate repeated outputs
  const duplicates = deduplicateMessageParts(messages);

  const charsAfter = countChars(messages);
  const reductionPct =
    charsBefore > 0
      ? Math.round(((charsBefore - charsAfter) / charsBefore) * 100)
      : 0;

  // Mark blocks as applied
  for (const block of signal.safeToCompact) {
    markApplied(block);
  }

  // Record event
  addEvent({
    ts: Date.now(),
    advice: signal.advice,
    reason: signal.reason,
    blocksCondensed: truncations + duplicates,
  });

  // Write diary
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal.advice,
    reason: signal.reason,
    blocksCondensed: truncations + duplicates,
    duplicatesRemoved: duplicates,
    linesBefore: charsBefore,
    linesAfter: charsAfter,
    reductionPct,
    sessionId: process.env.OPENDOC_SESSION_ID || "unknown",
    triggered: process.env.CC_COMPACTION_TRIGGER === "true",
  });

  // eslint-disable-next-line no-console
  console.error(
    `[four-cc:compaction] messages.transform: ${messagesBefore} msgs, ${charsBefore}→${charsAfter} chars ` +
      `(${reductionPct}% reduction, ${truncations} truncations, ${duplicates} dups) — ${signal.reason}`,
  );

  clearSignal();

  return {
    messagesBefore,
    messagesAfter: messages.length,
    charsBefore,
    charsAfter,
    reductionPct,
    applied: true,
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return String(hash);
}

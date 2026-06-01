import { getCompactionState, clearSignal, markApplied, wasApplied, addEvent } from "./state.js";
import { writeDiaryEntry } from "./diary.js";

export interface Part {
  type: string;
  text?: string;
}

export interface MessageItem {
  info: { role?: string; sessionID?: string; [key: string]: unknown };
  parts: Part[];
}

export interface CompactionResult {
  messagesBefore: number;
  messagesAfter: number;
  charsBefore: number;
  charsAfter: number;
  reductionPct: number;
  applied: boolean;
  sessionId: string;
}

const MAX_TOOL_LINES = 50;
const HEADER_LINES = 10;
const FOOTER_LINES = 10;
const KEEP_RECENT = 15;

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

function extractSessionId(messages: MessageItem[]): string {
  // Try to find sessionID from message info
  for (const msg of messages) {
    if (msg.info.sessionID) return msg.info.sessionID as string;
  }
  return process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
}

/**
 * Main entry point: aggressive message history compaction.
 * On compact_now: keeps only last KEEP_RECENT messages + truncates + deduplicates.
 * On compact_soon: truncates + deduplicates only, no message removal.
 */
export function compactMessageHistory(messages: MessageItem[]): CompactionResult {
  const state = getCompactionState();
  const signal = state.lastSignal;

  if (!signal || signal.advice === "no_compact") {
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: countChars(messages),
      charsAfter: countChars(messages),
      reductionPct: 0,
      applied: false,
      sessionId: extractSessionId(messages),
    };
  }

  const newBlocks = signal.safeToCompact.filter((b) => !wasApplied(b));
  if (signal.safeToCompact.length > 0 && newBlocks.length === 0) {
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: countChars(messages),
      charsAfter: countChars(messages),
      reductionPct: 0,
      applied: false,
      sessionId: extractSessionId(messages),
    };
  }

  const charsBefore = countChars(messages);
  const messagesBefore = messages.length;
  const sessionId = extractSessionId(messages);

  // Step 1: Drop old messages on compact_now (keep only last KEEP_RECENT)
  let removed = 0;
  if (signal.advice === "compact_now" && messages.length > KEEP_RECENT) {
    removed = messages.length - KEEP_RECENT;
    // Mutate array in-place: remove oldest messages
    messages.splice(0, removed);
  }

  // Step 2: Truncate long tool outputs
  const truncations = truncateMessageParts(messages);

  // Step 3: Deduplicate repeated outputs
  const duplicates = deduplicateMessageParts(messages);

  const charsAfter = countChars(messages);
  const messagesAfter = messages.length;
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
    blocksCondensed: removed + truncations + duplicates,
  });

  // Write diary
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal.advice,
    reason: signal.reason,
    blocksCondensed: removed + truncations + duplicates,
    duplicatesRemoved: duplicates,
    linesBefore: charsBefore,
    linesAfter: charsAfter,
    reductionPct,
    sessionId,
    triggered: process.env.CC_COMPACTION_TRIGGER === "true",
  });

  // eslint-disable-next-line no-console
  console.warn(
    `[four-cc:compaction] messages.transform: ${messagesBefore}→${messagesAfter} msgs ` +
      `(${removed} dropped), ${charsBefore}→${charsAfter} chars ` +
      `(${reductionPct}% reduction, ${truncations} trunc, ${duplicates} dups) — ${signal.advice}: ${signal.reason} ` +
      `[session: ${sessionId}]`,
  );

  clearSignal();

  return {
    messagesBefore,
    messagesAfter,
    charsBefore,
    charsAfter,
    reductionPct,
    applied: true,
    sessionId,
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
import { getCompactionState, markAppliedMessages, addEvent } from "./state.js";
import { writeDiaryEntry } from "./diary.js";
import { logDebugEvent } from "../debug-logger.js";
import { simpleHash } from "./hash.js";

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
    // NEVER truncate user messages — they contain task prompts/instructions
    if (msg.info.role === "user") continue;
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
    // NEVER deduplicate user messages — they contain unique prompts
    if (msg.info.role === "user") continue;
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
 * Main entry point: always applies truncation + dedup hygiene.
 * Message removal is handled by native session.summarize(), not here.
 * Only skips when no_compact signal is active.
 */
export function compactMessageHistory(messages: MessageItem[], sessionID?: string): CompactionResult {
  const sid = sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sid);
  const signal = state.lastSignal;

  // Always apply truncation + dedup hygiene (no signal gate anymore).
  // Message removal is handled by native session.summarize(), not here.
  // Only skip if no_compact signal explicitly says so.
  if (signal?.advice === "no_compact") {
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

  // Step 1: Truncate long tool outputs
  const truncations = truncateMessageParts(messages);

  // Step 2: Deduplicate repeated outputs
  const duplicates = deduplicateMessageParts(messages);

  const charsAfter = countChars(messages);
  const messagesAfter = messages.length;
  const reductionPct =
    charsBefore > 0
      ? Math.round(((charsBefore - charsAfter) / charsBefore) * 100)
      : 0;

  // Mark blocks as applied
  if (signal) {
    for (const block of signal.safeToCompact) {
      markAppliedMessages(sid, block);
    }
  }

  // Record event
  addEvent(sid, {
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: truncations + duplicates,
  });

  // Write diary
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: truncations + duplicates,
    duplicatesRemoved: duplicates,
    linesBefore: charsBefore,
    linesAfter: charsAfter,
    reductionPct,
    sessionId,
    triggered: false,
  });

  logDebugEvent("compaction.applied", {
    messagesBefore,
    messagesAfter,
    removed: 0,
    charsBefore,
    charsAfter,
    reductionPct,
    truncations,
    duplicates,
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    sessionId,
  });

  const didWork = truncations > 0 || duplicates > 0;

  return {
    messagesBefore,
    messagesAfter,
    charsBefore,
    charsAfter,
    reductionPct,
    applied: didWork,
    sessionId,
  };
}



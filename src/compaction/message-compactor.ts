import { getCompactionState, markAppliedMessages, addEvent } from "./state.js";
import { writeDiaryEntry } from "./diary.js";
import { logDebugEvent } from "../debug-logger.js";
import { simpleHash } from "./hash.js";

export interface Part {
  type: string;
  text?: string;
  tool?: string;
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

// Configurable thresholds — read from env vars with sensible defaults.
// These are read inside truncateMessageParts() where they're used.

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
  // Layer 1: Configurable Thresholds from env vars
  const maxToolLines = parseInt(process.env.CC_MAX_TOOL_LINES || "200", 10) || 200;
  const headerLines = parseInt(process.env.CC_TOOL_HEADER_LINES || "20", 10) || 20;
  const footerLines = parseInt(process.env.CC_TOOL_FOOTER_LINES || "20", 10) || 20;

  // Layer 2: Freshness Guard — determine turn indices (turn = user message boundary)
  const messageTurns: number[] = [];
  let currentTurn = -1;
  for (const msg of messages) {
    if (msg.info.role === "user") currentTurn++;
    messageTurns.push(currentTurn);
  }
  const maxTurn = currentTurn;
  // preserve last 2 turns (current and previous)
  // When maxTurn < 0 (no user messages), freshness guard is not applied
  const freshnessThreshold = maxTurn - 1;

  let truncations = 0;
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];

    // NEVER truncate user messages — they contain task prompts/instructions
    if (msg.info.role === "user") continue;

    // Layer 2: Freshness Guard — skip messages in the last 2 turns
    // maxTurn < 0 (no user messages) → guard not applied
    // maxTurn = 0 (1 turn) → all preserved (freshnessThreshold = -1)
    // maxTurn = 1 (2 turns) → all preserved (freshnessThreshold = 0)
    if (maxTurn >= 0 && messageTurns[msgIdx] >= freshnessThreshold) continue;

    // Layer 3: Per-Tool-Type Thresholds
    let toolThreshold = maxToolLines;
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "task") {
        toolThreshold = Math.round(maxToolLines * 2.5);
        break;
      }
    }

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const lines = part.text.split("\n");
        if (lines.length > toolThreshold) {
          part.text = [
            ...lines.slice(0, headerLines),
            `… [${lines.length - headerLines - footerLines} lines truncated] …`,
            ...lines.slice(-footerLines),
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



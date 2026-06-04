import { getCompactionState, markAppliedMessages, wasAppliedMessages, addEvent, isCompacting } from "./state.js";
import { writeDiaryEntry } from "./diary.js";
import { logDebugEvent } from "../debug-logger.js";

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
 * Main entry point: aggressive message history compaction.
 * On compact_now: keeps only last KEEP_RECENT messages + truncates + deduplicates.
 * On compact_soon: truncates + deduplicates only, no message removal.
 */
export function compactMessageHistory(messages: MessageItem[], sessionID?: string): CompactionResult {
  const sid = sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sid);
  const signal = state.lastSignal;

  const triggered = isCompacting(sid);

  if (!triggered && (!signal || signal.advice === "no_compact")) {
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

  // In trigger-only mode (no signal), still apply generic pruning
  // but skip block-based condensing
  const newBlocks = signal ? signal.safeToCompact.filter((b) => !wasAppliedMessages(sid, b)) : [];
  const skipBlockMarking = signal && signal.safeToCompact.length > 0 && newBlocks.length === 0 && !triggered;

  const charsBefore = countChars(messages);
  const messagesBefore = messages.length;
  const sessionId = extractSessionId(messages);

  // Step 1: Drop old messages on compact_now or trigger-only (keep only last KEEP_RECENT)
  // BUT never drop user messages — they contain task prompts/instructions
  let removed = 0;
  if ((signal?.advice === "compact_now" || triggered) && messages.length > KEEP_RECENT) {
    const toRemove = messages.length - KEEP_RECENT;
    // Remove oldest non-user messages first
    let removedCount = 0;
    let idx = 0;
    while (removedCount < toRemove && idx < messages.length) {
      if (messages[idx].info.role !== "user") {
        messages.splice(idx, 1);
        removedCount++;
        // Don't increment idx — splice shifts elements
      } else {
        idx++;
      }
    }
    removed = removedCount;

    // Warn when removal was expected but no messages could be removed
    // (e.g. all messages are user-role — they contain task instructions and are preserved)
    if (removedCount > 0) {
      logDebugEvent("compaction.remove.applied", { removed: removedCount, messagesBefore, sessionId });
    } else if (toRemove > 0) {
      logDebugEvent("compaction.remove.stalled", {
        reason: "all messages are user-role or non-removable",
        toRemove,
        messagesBefore,
        sessionId,
      });
    }
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

  // Mark blocks as applied (skip if all blocks already applied, or in trigger-only mode)
  if (signal && !skipBlockMarking) {
    for (const block of signal.safeToCompact) {
      markAppliedMessages(sid, block);
    }
  }

  // Record event
  addEvent(sid, {
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: removed + truncations + duplicates,
  });

  // Write diary
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: removed + truncations + duplicates,
    duplicatesRemoved: duplicates,
    linesBefore: charsBefore,
    linesAfter: charsAfter,
    reductionPct,
    sessionId,
    triggered: isCompacting(sid),
  });

  logDebugEvent("compaction.applied", {
    messagesBefore,
    messagesAfter,
    removed,
    charsBefore,
    charsAfter,
    reductionPct,
    truncations,
    duplicates,
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    sessionId,
  });

  const didWork = removed > 0 || truncations > 0 || duplicates > 0;

  return {
    messagesBefore,
    messagesAfter,
    charsBefore,
    charsAfter,
    reductionPct,
    applied: !skipBlockMarking || didWork,
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
import { getCompactionState, markAppliedMessages, addEvent } from "./state.js";
import { writeDiaryEntry } from "./diary.js";
import { logDebugEvent } from "../debug-logger.js";
import { simpleHash } from "./hash.js";

export interface Part {
  type: string;
  text?: string;
  tool?: string;
  /** Tool-call result state (opencode ToolPart). output holds the tool log text. */
  state?: {
    status?: string;
    output?: string;
    input?: Record<string, unknown>;
  };
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

// ---------------------------------------------------------------------------
// Content classification
//
// Assistant prose and tool logs are truncated under different policies.
// Prose that carries instructions, decisions or actionable errors is never
// truncated; tool logs keep a bounded excerpt of critical lines (instructions,
// decisions, actionable errors) from the omitted middle section. Patterns are
// line-local and linear — no nested quantifiers (see #157: no ReDoS).
// ---------------------------------------------------------------------------

const INSTRUCTION_DECISION_PATTERNS: RegExp[] = [
  /\b(?:must|shall|required|mandatory|never|always|do not|don't|ensure)\b/i,
  /\b(?:important|warning|note|hinweis|wichtig|achtung)\b/i,
  /\b(?:muss|darf nicht|niemals|immer|erforderlich)\b/i,
  /\b(?:decision|decided|we (?:will|chose|agreed)|chosen|agreed|beschlossen|entschieden)\b/i,
];

const ACTIONABLE_ERROR_PATTERNS: RegExp[] = [
  /\b(?:error|exception|failed|failure|fatal|panic|traceback|stack trace|aborted|denied|refused|not found|timed out|timeout)\b/i,
  /\b[A-Za-z_][A-Za-z0-9_]*(?:Error|Exception)\b/,
  /\b(?:TS|PHP|E)[0-9]{3,5}\b/,
  /\bat\s+[\w.$<>]+\s*\(?[^\s)]*:\d+/,
];

const CRITICAL_LINE_PATTERNS = [...INSTRUCTION_DECISION_PATTERNS, ...ACTIONABLE_ERROR_PATTERNS];

const MAX_PRESERVED_CRITICAL_LINES = 100;

function matchesAny(line: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(line)) return true;
  }
  return false;
}

/**
 * True when assistant prose contains an instruction, a decision, or an
 * actionable error. Such prose must never be truncated.
 */
export function isProtectedAssistantProse(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    if (matchesAny(line, INSTRUCTION_DECISION_PATTERNS)) return true;
    if (matchesAny(line, ACTIONABLE_ERROR_PATTERNS)) return true;
  }
  return false;
}

/**
 * Collect up to MAX_PRESERVED_CRITICAL_LINES critical lines from a range.
 * The excerpt is always bounded: a log with more critical lines is still
 * truncated deterministically instead of bypassing truncation entirely.
 */
function collectCriticalLines(lines: string[], start: number, end: number): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    if (!matchesAny(line, CRITICAL_LINE_PATTERNS)) continue;
    const key = line.trim();
    if (seen.has(key)) continue;
    if (collected.length >= MAX_PRESERVED_CRITICAL_LINES) break;
    seen.add(key);
    collected.push(line);
  }
  return collected;
}

// Configurable thresholds — read from env vars with sensible defaults.
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  // Reject partial parses ("200oops" -> 200): only a string of digits counts.
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

interface TruncateSettings {
  maxToolLines: number;
  maxAssistantLines: number;
  headerLines: number;
  footerLines: number;
}

function readTruncateSettings(): TruncateSettings {
  return {
    // Tool logs (part.type === "tool", part.state.output)
    maxToolLines: envPositiveInt("CC_MAX_TOOL_LINES", 200),
    // Assistant prose (part.type === "text", role !== "user")
    maxAssistantLines: envPositiveInt("CC_MAX_ASSISTANT_LINES", 400),
    headerLines: envPositiveInt("CC_TOOL_HEADER_LINES", 20),
    footerLines: envPositiveInt("CC_TOOL_FOOTER_LINES", 20),
  };
}

function truncateWithPreserved(
  lines: string[],
  headerLines: number,
  footerLines: number,
  preserved: string[],
): string {
  const omitted = lines.length - headerLines - footerLines;
  const output = lines.slice(0, headerLines);
  output.push(`… [${omitted} lines truncated] …`);
  if (preserved.length > 0) {
    output.push(`… [${preserved.length} critical lines preserved] …`, ...preserved);
  }
  output.push(...lines.slice(-footerLines));
  return output.join("\n");
}

/**
 * Character accounting for a message history.
 *
 * Tool output lives on `part.state.output`, not on `part.text`. It is
 * truncated by `truncateMessageParts()`, so it must be measured here as well —
 * otherwise the reported reduction stays at 0% for tool-heavy sessions.
 */
export function countChars(messages: MessageItem[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        total += part.text.length;
      }
      if (part.type === "tool" && typeof part.state?.output === "string") {
        total += part.state.output.length;
      }
    }
  }
  return total;
}

export interface ToolStat {
  linesBefore: number;
  linesAfter: number;
  occurrences: number;
}

export interface TruncationResult {
  count: number;
  perTool: Map<string, ToolStat>;
}

/**
 * Which messages the freshness guard protects: the newest turn and the one
 * before it (turn = user-message boundary). Truncation leaves them whole, so
 * dedup consults the same predicate — pointing a protected message at an older
 * copy would lose the full output once that copy is truncated (cubic P1).
 * No user messages → nothing is protected.
 */
function freshnessProtected(messages: MessageItem[]): boolean[] {
  const messageTurns: number[] = [];
  let currentTurn = -1;
  for (const msg of messages) {
    if (msg.info.role === "user") currentTurn++;
    messageTurns.push(currentTurn);
  }
  const maxTurn = currentTurn;
  const freshnessThreshold = maxTurn - 1;
  return messageTurns.map((turn) => maxTurn >= 0 && turn >= freshnessThreshold);
}

function truncateMessagePartsInternal(messages: MessageItem[]): TruncationResult {
  const settings = readTruncateSettings();
  const minThreshold = settings.headerLines + settings.footerLines + 1;

  // Layer 2: Freshness Guard — preserve the last 2 turns (current and previous)
  const fresh = freshnessProtected(messages);

  let truncations = 0;
  const perTool = new Map<string, ToolStat>();

  const addStat = (tool: string, originalLines: number, keptLines: number): void => {
    const existing = perTool.get(tool) ?? { linesBefore: 0, linesAfter: 0, occurrences: 0 };
    existing.linesBefore += originalLines;
    existing.linesAfter += keptLines;
    existing.occurrences += 1;
    perTool.set(tool, existing);
  };

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];

    // NEVER truncate user messages — they contain task prompts/instructions
    if (msg.info.role === "user") continue;

    // Layer 2: Freshness Guard — skip messages in the last 2 turns.
    if (fresh[msgIdx]) continue;

    // Layer 3: Per-Tool-Type Thresholds. `task` subagent logs get 2.5x.
    let toolThreshold = Math.max(settings.maxToolLines, minThreshold);
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "task") {
        toolThreshold = Math.max(Math.round(settings.maxToolLines * 2.5), minThreshold);
        break;
      }
    }

    // Assistant prose: separate threshold, never touch protected content.
    const assistantThreshold = Math.max(settings.maxAssistantLines, minThreshold);
    for (const part of msg.parts) {
      if (part.type !== "text" || !part.text) continue;
      const lines = part.text.split("\n");
      if (lines.length <= assistantThreshold) continue;
      if (isProtectedAssistantProse(part.text)) continue;
      part.text = truncateWithPreserved(lines, settings.headerLines, settings.footerLines, []);
      truncations++;
      addStat("text", lines.length, part.text.split("\n").length);
    }

    // Tool-log truncation: opencode stores tool output on ToolPart
    // ({ type: "tool", tool, state: { status, output } }), NOT on text parts.
    for (const part of msg.parts) {
      const st = part.state;
      if (
        part.type !== "tool" ||
        !st ||
        st.status !== "completed" ||
        typeof st.output !== "string" ||
        st.output.length === 0
      ) {
        continue;
      }
      const lines = st.output.split("\n");
      if (lines.length <= toolThreshold) continue;

      const middleStart = settings.headerLines;
      const middleEnd = lines.length - settings.footerLines;
      const preserved = collectCriticalLines(lines, middleStart, middleEnd);

      st.output = truncateWithPreserved(
        lines,
        settings.headerLines,
        settings.footerLines,
        preserved,
      );
      truncations++;
      addStat(part.tool ?? "unknown-tool", lines.length, st.output.split("\n").length);
    }
  }
  return { count: truncations, perTool };
}

export function truncateMessageParts(messages: MessageItem[]): number {
  return truncateMessagePartsInternal(messages).count;
}

const REPLACEMENT_MARKER_PREFIX = "↑ see above (message ";
const TRUNCATION_MARKER_PATTERN = /… \[\d+ lines truncated\] …/;

/**
 * Markers written by a previous pass are pointers, not payload. Hashing them
 * again would rewrite identical markers, inflate `duplicates` and keep
 * reporting work on every transform even though nothing changed.
 */
function isReplacementMarker(content: string): boolean {
  return content.startsWith(REPLACEMENT_MARKER_PREFIX);
}

/**
 * Truncated content is the curated excerpt, not the original log. Two distinct
 * logs can share the same retained head and tail, so hashing the excerpt would
 * collapse them into a misleading pointer. Already-truncated parts are skipped
 * instead; genuine duplicates were collapsed on the pass that saw the originals.
 */
function isTruncatedContent(content: string): boolean {
  return TRUNCATION_MARKER_PATTERN.test(content);
}

function dedupeCandidate(part: Part): string | null {
  if (part.type === "text" && part.text && part.text.length > 20) {
    // Assistant prose carrying instructions/decisions is never replaced by a
    // pointer — the same protection applies as in truncation.
    if (isProtectedAssistantProse(part.text)) return null;
    if (isReplacementMarker(part.text) || isTruncatedContent(part.text)) return null;
    return part.text;
  }
  // Repeat reads: identical completed tool output is referenced, not repeated.
  if (
    part.type === "tool" &&
    part.state?.status === "completed" &&
    typeof part.state.output === "string" &&
    part.state.output.length > 20
  ) {
    if (isReplacementMarker(part.state.output) || isTruncatedContent(part.state.output)) {
      return null;
    }
    return part.state.output;
  }
  return null;
}

export function deduplicateMessageParts(messages: MessageItem[]): number {
  // Dedup runs before truncation and replays on the ORIGINAL content. A message
  // the freshness guard keeps whole must never be replaced by a pointer to an
  // older copy that truncation then cuts to an excerpt — the full output would
  // vanish from context (cubic P1). Skip those messages entirely.
  const fresh = freshnessProtected(messages);
  // Store the content next to the index: a 32-bit hash collision must never
  // cause two different outputs to be treated as duplicates (information loss).
  const seen = new Map<string, { msgIdx: number; content: string }>();
  let duplicates = 0;
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    // NEVER deduplicate user messages — they contain unique prompts
    if (msg.info.role === "user") continue;
    if (fresh[msgIdx]) continue;
    for (const part of msg.parts) {
      const content = dedupeCandidate(part);
      if (content === null) continue;
      const hash = simpleHash(content);
      const first = seen.get(hash);
      if (first && first.content === content) {
        const marker = `${REPLACEMENT_MARKER_PREFIX}${first.msgIdx + 1})`;
        if (part.type === "text") {
          part.text = marker;
        } else if (part.state) {
          part.state.output = marker;
        }
        duplicates++;
      } else if (!first) {
        seen.set(hash, { msgIdx, content });
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
export function compactMessageHistory(messages: MessageItem[], sessionID?: string, agent?: string): CompactionResult {
  const sid = sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sid);
  const signal = state.lastSignal;

  // Always apply truncation + dedup hygiene (no signal gate anymore).
  // Message removal is handled by native session.summarize(), not here.
  // Only skip if no_compact signal explicitly says so.
  if (signal?.advice === "no_compact") {
    const chars = countChars(messages);
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: chars,
      charsAfter: chars,
      reductionPct: 0,
      applied: false,
      sessionId: extractSessionId(messages),
    };
  }

  const charsBefore = countChars(messages);
  const messagesBefore = messages.length;
  const sessionId = extractSessionId(messages);

  // Step 1: Deduplicate repeated outputs on their ORIGINAL content. Truncation
  // must not run first: distinct logs sharing the same retained head and tail
  // would otherwise be collapsed into a pointer (information loss).
  const duplicates = deduplicateMessageParts(messages);

  // Step 2: Truncate long tool outputs + assistant prose (separate policies)
  const { count: truncations, perTool } = truncateMessagePartsInternal(messages);

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

  // Write diary — per-tool attribution so the report can answer
  // "which tool produced the most pruned lines".
  for (const [tool, stat] of perTool.entries()) {
    writeDiaryEntry({
      ts: Date.now(),
      advice: signal?.advice ?? "triggered",
      reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
      blocksCondensed: stat.occurrences,
      duplicatesRemoved: 0,
      linesBefore: stat.linesBefore,
      linesAfter: stat.linesAfter,
      reductionPct:
        stat.linesBefore > 0
          ? Math.round(((stat.linesBefore - stat.linesAfter) / stat.linesBefore) * 100)
          : 0,
      sessionId,
      triggered: false,
      agent,
      tool,
    });
  }

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

import type { CompactionSignal } from "./signal-parser.js";

export interface CompactionEvent {
  ts: number;
  advice: string;
  reason: string;
  blocksCondensed: number;
}

export interface LastUserModel {
  providerID: string | undefined;
  modelID: string | undefined;
}

export interface CompactionState {
  lastSignal: CompactionSignal | null;
  appliedForPruning: Set<string>;
  appliedForMessages: Set<string>;
  history: CompactionEvent[];
  lastUserModel: LastUserModel;
  lastTokenEstimate: number;
  compactingActive: boolean;
  turnsSinceCompaction: number;
  instructionSent: boolean;
  /** Most recently observed agent name (tracked from messages.transform). */
  lastAgent: string | null;
  /** Per-turn token estimate history (appended on every setLastTokenEstimate). */
  tokenHistory: number[];
  /**
   * Per-real-session user-turn trackers. Keyed by the `info.sessionID` carried
   * by the messages so parent and subagent turns cannot advance each other's
   * cooldown when messages interleave under the shared "default" state key.
   */
  userTurnsBySession: Map<string, UserTurnTracker>;
}

export interface UserTurnTracker {
  /** ID of the newest user message seen for this session, null when it carried no ID. */
  lastUserMessageId: string | null;
  /** Number of user messages in the last observed history (fallback when IDs are absent). */
  lastUserMessageCount: number;
}

const sessionStates = new Map<string, CompactionState>();

function getSessionState(sessionID: string = "default"): CompactionState {
  let s = sessionStates.get(sessionID);
  if (!s) {
    s = {
      lastSignal: null,
      appliedForPruning: new Set(),
      appliedForMessages: new Set(),
      history: [],
      lastUserModel: { providerID: undefined, modelID: undefined },
      lastTokenEstimate: 0,
      compactingActive: false,
      turnsSinceCompaction: 0,
      instructionSent: false,
      lastAgent: null,
      tokenHistory: [],
      userTurnsBySession: new Map(),
    };
    sessionStates.set(sessionID, s);
  }
  return s;
}

export function getCompactionState(sessionID: string = "default"): CompactionState {
  return getSessionState(sessionID);
}

/**
 * Mark whether a native summarize is currently in flight for this session.
 * Reads of this flag gate every auto-trigger so the summarizer's own request
 * cannot re-enter messages.transform and start a second summarize.
 */
export function setCompactingActive(sessionID: string, active: boolean): void {
  getSessionState(sessionID).compactingActive = active;
}

export function setLastSignal(sessionID: string, signal: CompactionSignal): void {
  getSessionState(sessionID).lastSignal = signal;
}

export function clearSignal(sessionID: string = "default"): void {
  const s = getSessionState(sessionID);
  s.lastSignal = null;
  s.appliedForPruning.clear();
  s.appliedForMessages.clear();
}

export function markAppliedPruning(sessionID: string, block: string): void {
  getSessionState(sessionID).appliedForPruning.add(block);
}

export function wasAppliedPruning(sessionID: string, block: string): boolean {
  return getSessionState(sessionID).appliedForPruning.has(block);
}

export function markAppliedMessages(sessionID: string, block: string): void {
  getSessionState(sessionID).appliedForMessages.add(block);
}

export function clearTransformState(sessionID: string = "default"): void {
  const s = getSessionState(sessionID);
  s.appliedForPruning.clear();
  s.appliedForMessages.clear();
}

export function addEvent(sessionID: string, event: CompactionEvent): void {
  const state = getSessionState(sessionID);
  state.history.push(event);
  if (state.history.length > 100) {
    state.history = state.history.slice(-50);
  }
}

export function setLastUserModel(sessionID: string, providerID: string | undefined, modelID: string | undefined): void {
  getSessionState(sessionID).lastUserModel = { providerID, modelID };
}


export function setLastTokenEstimate(sessionID: string, n: number): void {
  const state = getSessionState(sessionID);
  state.lastTokenEstimate = n;
  state.tokenHistory.push(n);
  // Cap history to avoid unbounded growth; trend only needs the last ~10 values.
  if (state.tokenHistory.length > 1000) {
    state.tokenHistory = state.tokenHistory.slice(-500);
  }
}

/**
 * Track the most recent agent name observed in messages.transform.
 * Used by system.transform to resolve per-agent pruning config.
 */
export function setLastAgent(sessionID: string, agent: string): void {
  getSessionState(sessionID).lastAgent = agent;
}

export function getLastAgent(sessionID: string = "default"): string | null {
  return getSessionState(sessionID).lastAgent;
}

export function getTokenHistory(sessionID: string = "default"): number[] {
  return getSessionState(sessionID).tokenHistory;
}

const compactionCooldowns = new Map<string, number>();


export function decrementCompactionCooldown(sessionID: string): void {
  const current = compactionCooldowns.get(sessionID) ?? 0;
  if (current > 0) compactionCooldowns.set(sessionID, current - 1);
}

export function getCompactionCooldownRemaining(sessionID: string): number {
  return compactionCooldowns.get(sessionID) ?? 0;
}

export function setCompactionCooldown(sessionID: string, turns: number = 3): void {
  compactionCooldowns.set(sessionID, turns);
}

export function incrementTurnsSinceCompaction(sessionID: string = "default"): void {
  getSessionState(sessionID).turnsSinceCompaction++;
}

export function resetTurnsSinceCompaction(sessionID: string = "default"): void {
  getSessionState(sessionID).turnsSinceCompaction = 0;
}

export function getTurnsSinceCompaction(sessionID: string = "default"): number {
  return getSessionState(sessionID).turnsSinceCompaction;
}

export interface UserTurnMessage {
  info?: { role?: string; id?: unknown; sessionID?: unknown };
}

/**
 * Register a user turn exactly once per user message.
 *
 * `experimental.chat.messages.transform` fires multiple times per user turn
 * (one per tool loop). Counting transform invocations makes both
 * `turnsSinceCompaction` and the compaction cooldown run several times too
 * fast. Returns true only when a new user message was observed.
 */
const USER_TURN_KEY_NO_AGENT = "\u0000none";

/**
 * Real session id carried by the messages. `messages.transform` receives an
 * empty input object, so its `sessionID` argument is the shared "default"
 * state key — the per-session identity must come from the message info.
 */
function extractMessageSessionId(messages: UserTurnMessage[]): string | null {
  for (const msg of messages) {
    const id = msg.info?.sessionID;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export function observeUserTurn(
  sessionID: string,
  messages: UserTurnMessage[],
  agent?: string | null,
): boolean {
  const state = getSessionState(sessionID);

  // Track per REAL session, never per shared state key: parent and subagent
  // messages interleave under "default", so one tracker would make every
  // switch look like a new turn and advance the cooldown too fast. Fall back
  // to the agent (then the state key) when messages carry no session id.
  const realSessionId = extractMessageSessionId(messages);
  const agentKey = agent && agent.length > 0 ? agent : USER_TURN_KEY_NO_AGENT;
  const trackerKey =
    realSessionId !== null ? `session\u0000${realSessionId}` : `${sessionID}\u0000${agentKey}`;

  let tracker = state.userTurnsBySession.get(trackerKey);
  if (!tracker) {
    tracker = { lastUserMessageId: null, lastUserMessageCount: 0 };
    state.userTurnsBySession.set(trackerKey, tracker);
  }

  let userCount = 0;
  for (const msg of messages) {
    if (msg.info?.role !== "user") continue;
    userCount++;
  }

  // Only the NEWEST user message identifies the turn. An older ID must never
  // linger: if the newest user message carries no ID, clear the tracker and
  // fall back to counting instead of comparing against a stale ID.
  let newestUserId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info;
    if (info?.role !== "user") continue;
    const id = info.id;
    if (typeof id === "string" && id.length > 0) newestUserId = id;
    break;
  }

  const isNewTurn =
    newestUserId !== null && tracker.lastUserMessageId !== null
      ? newestUserId !== tracker.lastUserMessageId
      : userCount > tracker.lastUserMessageCount;

  tracker.lastUserMessageId = newestUserId;
  tracker.lastUserMessageCount = userCount;
  return isNewTurn;
}

export function isInstructionSent(sessionID: string = "default"): boolean {
  return getSessionState(sessionID).instructionSent;
}

export function markInstructionSent(sessionID: string = "default"): void {
  getSessionState(sessionID).instructionSent = true;
}



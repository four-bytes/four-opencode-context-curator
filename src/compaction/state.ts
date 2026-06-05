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
    };
    sessionStates.set(sessionID, s);
  }
  return s;
}

export function getCompactionState(sessionID: string = "default"): CompactionState {
  return getSessionState(sessionID);
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
  getSessionState(sessionID).history.push(event);
}

export function setLastUserModel(sessionID: string, providerID: string | undefined, modelID: string | undefined): void {
  getSessionState(sessionID).lastUserModel = { providerID, modelID };
}


export function setLastTokenEstimate(sessionID: string, n: number): void {
  getSessionState(sessionID).lastTokenEstimate = n;
}

export function setCompacting(sessionID: string, active: boolean): void {
  getSessionState(sessionID).compactingActive = active;
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

export function isInstructionSent(sessionID: string = "default"): boolean {
  return getSessionState(sessionID).instructionSent;
}

export function markInstructionSent(sessionID: string = "default"): void {
  getSessionState(sessionID).instructionSent = true;
}



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
  appliedFor: Set<string>;
  appliedForPruning: Set<string>;
  appliedForMessages: Set<string>;
  history: CompactionEvent[];
  lastUserModel: LastUserModel;
  lastTokenEstimate: number;
}

const sessionStates = new Map<string, CompactionState>();

function getSessionState(sessionID: string = "default"): CompactionState {
  let s = sessionStates.get(sessionID);
  if (!s) {
    s = {
      lastSignal: null,
      appliedFor: new Set(),
      appliedForPruning: new Set(),
      appliedForMessages: new Set(),
      history: [],
      lastUserModel: { providerID: undefined, modelID: undefined },
      lastTokenEstimate: 0,
    };
    sessionStates.set(sessionID, s);
  }
  return s;
}

export function getSessionIDs(): string[] {
  return Array.from(sessionStates.keys());
}

export function removeSession(sessionID: string): void {
  sessionStates.delete(sessionID);
  triggerCooldowns.delete(sessionID);
  compactionCooldowns.delete(sessionID);
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

export function markApplied(sessionID: string, block: string): void {
  getSessionState(sessionID).appliedFor.add(block);
}

export function wasApplied(sessionID: string, block: string): boolean {
  return getSessionState(sessionID).appliedFor.has(block);
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

export function wasAppliedMessages(sessionID: string, block: string): boolean {
  return getSessionState(sessionID).appliedForMessages.has(block);
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

export function getLastUserModel(sessionID: string = "default"): LastUserModel {
  return getSessionState(sessionID).lastUserModel;
}

export function setLastTokenEstimate(sessionID: string, n: number): void {
  getSessionState(sessionID).lastTokenEstimate = n;
}

export function getLastTokenEstimate(sessionID: string = "default"): number {
  return getSessionState(sessionID).lastTokenEstimate;
}

const triggerCooldowns = new Map<string, number>();

export function canTriggerCompaction(sessionID: string, cooldownMs: number = 30000): boolean {
  const now = Date.now();
  const lastTriggered = triggerCooldowns.get(sessionID) ?? 0;
  if (now - lastTriggered < cooldownMs) return false;
  triggerCooldowns.set(sessionID, now);
  return true;
}

const compactionCooldowns = new Map<string, number>();

export function startCompactionCooldown(sessionID: string, turns: number = 3): void {
  const current = compactionCooldowns.get(sessionID) ?? 0;
  compactionCooldowns.set(sessionID, Math.max(current, turns));
}

export function decrementCompactionCooldown(sessionID: string): void {
  const current = compactionCooldowns.get(sessionID) ?? 0;
  if (current > 0) compactionCooldowns.set(sessionID, current - 1);
}

export function isInCompactionCooldown(sessionID: string): boolean {
  return (compactionCooldowns.get(sessionID) ?? 0) > 0;
}

export function getCompactionCooldownRemaining(sessionID: string): number {
  return compactionCooldowns.get(sessionID) ?? 0;
}

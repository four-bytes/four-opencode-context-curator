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

const state: CompactionState = {
  lastSignal: null,
  appliedFor: new Set(),
  appliedForPruning: new Set(),
  appliedForMessages: new Set(),
  history: [],
  lastUserModel: { providerID: undefined, modelID: undefined },
  lastTokenEstimate: 0,
};

export function getCompactionState(): CompactionState {
  return state;
}

export function setLastSignal(signal: CompactionSignal): void {
  state.lastSignal = signal;
}

export function clearSignal(): void {
  state.lastSignal = null;
  state.appliedForPruning.clear();
  state.appliedForMessages.clear();
}

export function markApplied(block: string): void {
  state.appliedFor.add(block);
}

export function wasApplied(block: string): boolean {
  return state.appliedFor.has(block);
}

export function markAppliedPruning(block: string): void {
  state.appliedForPruning.add(block);
}

export function wasAppliedPruning(block: string): boolean {
  return state.appliedForPruning.has(block);
}

export function markAppliedMessages(block: string): void {
  state.appliedForMessages.add(block);
}

export function wasAppliedMessages(block: string): boolean {
  return state.appliedForMessages.has(block);
}

export function clearTransformState(): void {
  state.appliedForPruning.clear();
  state.appliedForMessages.clear();
}

export function addEvent(event: CompactionEvent): void {
  state.history.push(event);
}

export function setLastUserModel(providerID: string | undefined, modelID: string | undefined): void {
  state.lastUserModel = { providerID, modelID };
}

export function getLastUserModel(): LastUserModel {
  return state.lastUserModel;
}

export function setLastTokenEstimate(n: number): void {
  state.lastTokenEstimate = n;
}

export function getLastTokenEstimate(): number {
  return state.lastTokenEstimate;
}

let lastTriggeredAt = 0;

export function canTriggerCompaction(cooldownMs: number = 30000): boolean {
  const now = Date.now();
  if (now - lastTriggeredAt < cooldownMs) return false;
  lastTriggeredAt = now;
  return true;
}

let compactionCooldownRemaining = 0;

export function startCompactionCooldown(turns: number = 3): void {
  compactionCooldownRemaining = Math.max(compactionCooldownRemaining, turns);
}

export function decrementCompactionCooldown(): void {
  if (compactionCooldownRemaining > 0) compactionCooldownRemaining--;
}

export function isInCompactionCooldown(): boolean {
  return compactionCooldownRemaining > 0;
}

export function getCompactionCooldownRemaining(): number {
  return compactionCooldownRemaining;
}

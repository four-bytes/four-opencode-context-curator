import type { CompactionSignal } from "./signal-parser.js";

export interface CompactionEvent {
  ts: number;
  advice: string;
  reason: string;
  blocksCondensed: number;
}

export interface CompactionState {
  lastSignal: CompactionSignal | null;
  appliedFor: Set<string>;
  appliedForPruning: Set<string>;
  appliedForMessages: Set<string>;
  history: CompactionEvent[];
}

const state: CompactionState = {
  lastSignal: null,
  appliedFor: new Set(),
  appliedForPruning: new Set(),
  appliedForMessages: new Set(),
  history: [],
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

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
  history: CompactionEvent[];
}

const state: CompactionState = {
  lastSignal: null,
  appliedFor: new Set(),
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
}

export function markApplied(block: string): void {
  state.appliedFor.add(block);
}

export function wasApplied(block: string): boolean {
  return state.appliedFor.has(block);
}

export function addEvent(event: CompactionEvent): void {
  state.history.push(event);
}

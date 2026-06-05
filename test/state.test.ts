import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { clearSignal, getCompactionState, setLastSignal, incrementTurnsSinceCompaction, resetTurnsSinceCompaction, getTurnsSinceCompaction, isInstructionSent, markInstructionSent } from "../src/compaction/state.js";

describe("setLastSignal / getCompactionState / clearSignal", () => {
  afterEach(() => {
    clearSignal("test-session");
  });

  it("stores and retrieves a compaction signal", () => {
    const signal = { advice: "compact_now" as const, reason: "test", safeToCompact: ["a"] };
    setLastSignal("test-session", signal);
    const state = getCompactionState("test-session");
    expect(state?.lastSignal?.advice).toBe("compact_now");
    expect(state?.lastSignal?.reason).toBe("test");
    expect(state?.lastSignal?.safeToCompact).toEqual(["a"]);
  });

  it("returns state with null signal for unknown session", () => {
    const state = getCompactionState("nonexistent");
    expect(state).toBeDefined();
    expect(state.lastSignal).toBeNull();
  });

  it("clears signal for a session", () => {
    setLastSignal("test-session", { advice: "compact_soon" as const, reason: "growing" });
    clearSignal("test-session");
    const state = getCompactionState("test-session");
    expect(state?.lastSignal).toBeNull();
  });

  it("handles multiple sessions independently", () => {
    setLastSignal("session-a", { advice: "compact_now" as const, reason: "a" });
    setLastSignal("session-b", { advice: "no_compact" as const, reason: "b" });

    expect(getCompactionState("session-a")?.lastSignal?.advice).toBe("compact_now");
    expect(getCompactionState("session-b")?.lastSignal?.advice).toBe("no_compact");

    clearSignal("session-a");
    expect(getCompactionState("session-a")?.lastSignal).toBeNull();
    expect(getCompactionState("session-b")?.lastSignal?.advice).toBe("no_compact");
  });
});

describe("turnsSinceCompaction", () => {
  it("starts at 0", () => {
    expect(getTurnsSinceCompaction("turns-test")).toBe(0);
  });
  it("increments", () => {
    incrementTurnsSinceCompaction("turns-test");
    expect(getTurnsSinceCompaction("turns-test")).toBe(1);
    incrementTurnsSinceCompaction("turns-test");
    expect(getTurnsSinceCompaction("turns-test")).toBe(2);
  });
  it("resets to 0", () => {
    incrementTurnsSinceCompaction("turns-test");
    resetTurnsSinceCompaction("turns-test");
    expect(getTurnsSinceCompaction("turns-test")).toBe(0);
  });
});

describe("instructionSent", () => {
  it("starts as false", () => {
    expect(isInstructionSent("instr-test")).toBe(false);
  });
  it("can be marked sent", () => {
    markInstructionSent("instr-test");
    expect(isInstructionSent("instr-test")).toBe(true);
  });
});

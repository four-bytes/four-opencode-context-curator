import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { clearSignal, getCompactionState, setLastSignal, setCompactingActive, incrementTurnsSinceCompaction, resetTurnsSinceCompaction, getTurnsSinceCompaction, isInstructionSent, markInstructionSent, setCompactionCooldown, getCompactionCooldownRemaining, extractMessageSessionId } from "../src/compaction/state.js";

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

describe("compactingActive", () => {
  it("starts as false", () => {
    expect(getCompactionState("active-test").compactingActive).toBe(false);
  });
  it("can be set and reset", () => {
    setCompactingActive("active-test", true);
    expect(getCompactionState("active-test").compactingActive).toBe(true);
    setCompactingActive("active-test", false);
    expect(getCompactionState("active-test").compactingActive).toBe(false);
  });
  it("is tracked per session", () => {
    setCompactingActive("active-a", true);
    expect(getCompactionState("active-a").compactingActive).toBe(true);
    expect(getCompactionState("active-b").compactingActive).toBe(false);
    setCompactingActive("active-a", false);
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

describe("real session ids get fully independent state", () => {
  const sessionA = "real-session-a";
  const sessionB = "real-session-b";

  it("does not leak lastSignal or compactingActive between sessions", () => {
    clearSignal(sessionA);
    clearSignal(sessionB);
    setCompactingActive(sessionA, false);
    setCompactingActive(sessionB, false);

    setLastSignal(sessionA, { advice: "compact_now" as const, reason: "a is full" });
    setCompactingActive(sessionA, true);
    setCompactionCooldown(sessionA, 4);
    incrementTurnsSinceCompaction(sessionA);

    // Everything set under A must stay invisible to B.
    expect(getCompactionState(sessionB).lastSignal).toBeNull();
    expect(getCompactionState(sessionB).compactingActive).toBe(false);
    expect(getCompactionCooldownRemaining(sessionB)).toBe(0);
    expect(getTurnsSinceCompaction(sessionB)).toBe(0);

    // And A keeps exactly what was set.
    expect(getCompactionState(sessionA).lastSignal?.advice).toBe("compact_now");
    expect(getCompactionState(sessionA).compactingActive).toBe(true);
    expect(getCompactionCooldownRemaining(sessionA)).toBe(4);
    expect(getTurnsSinceCompaction(sessionA)).toBe(1);

    setCompactingActive(sessionA, false);
    resetTurnsSinceCompaction(sessionA);
    clearSignal(sessionA);
  });
});

describe("extractMessageSessionId", () => {
  it("returns the real session id carried by the messages", () => {
    const messages = [
      { info: { role: "user", sessionID: "real-session" } },
      { info: { role: "assistant" } },
    ];
    expect(extractMessageSessionId(messages)).toBe("real-session");
  });

  it("returns null when no message carries a session id", () => {
    expect(extractMessageSessionId([{ info: { role: "user" } }])).toBeNull();
    expect(extractMessageSessionId([{ info: { role: "user", sessionID: "" } }])).toBeNull();
  });
});

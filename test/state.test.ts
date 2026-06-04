import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { clearSignal, getCompactionState, setLastSignal } from "../src/compaction/state.js";

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

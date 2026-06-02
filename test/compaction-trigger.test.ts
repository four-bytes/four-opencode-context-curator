import { test, expect } from "bun:test";
import { triggerCompaction } from "../src/compaction/trigger.js";
import { clearSignal } from "../src/compaction/state.js";

test("calls session.compact when available", async () => {
  let callCount = 0;
  let calledWith: unknown = undefined;

  const client = {
    session: {
      compact: async (args: unknown) => {
        callCount++;
        calledWith = args;
      },
    },
  };

  const result = await triggerCompaction(client, "sid1");
  expect(result).toBe(true);
  expect(callCount).toBe(1);
  expect(calledWith).toEqual({ sessionID: "sid1" });
});

test("returns false for empty client", async () => {
  const result = await triggerCompaction({}, "sid1");
  expect(result).toBe(false);
});

test("returns false for missing sessionID", async () => {
  const client = {
    session: {
      compact: async () => {},
    },
  };
  const result = await triggerCompaction(client, "");
  expect(result).toBe(false);
});

test("does not throw when method rejects", async () => {
  const client = {
    session: {
      compact: async (_args: unknown) => {
        throw new Error("Netzwerkfehler");
      },
    },
  };

  let threw = false;
  let result = false;
  try {
    result = await triggerCompaction(client, "sid2");
  } catch {
    threw = true;
  }

  expect(threw).toBe(false);
  // compact wirft → zählt als gescheitert → Kandidaten durch → false
  expect(result).toBe(false);
});

test("calls compact with sessionID only", async () => {
  let callCount = 0;
  let calledWith: unknown = undefined;
  const client = {
    session: {
      compact: async (args: unknown) => {
        callCount++;
        calledWith = args;
      },
    },
  };

  const result = await triggerCompaction(client, "sid3");
  expect(callCount).toBe(1);
  expect(calledWith).toEqual({ sessionID: "sid3" });
  expect(result).toBe(true);
});

test("returns false for null client", async () => {
  const result = await triggerCompaction(null, "sid5");
  expect(result).toBe(false);
});

test("calls v2.session.compact as primary candidate", async () => {
  let v2CallCount = 0;
  let sessionCallCount = 0;
  let v2CalledWith: unknown = undefined;

  const client = {
    v2: {
      session: {
        compact: async (args: unknown) => {
          v2CallCount++;
          v2CalledWith = args;
        },
      },
    },
    session: {
      compact: async () => {
        sessionCallCount++;
      },
    },
  };

  const result = await triggerCompaction(client, "sid-v2");
  expect(result).toBe(true);
  expect(v2CallCount).toBe(1);
  expect(v2CalledWith).toEqual({ sessionID: "sid-v2" });
  // legacy fallback should NOT be called since v2 succeeds
  expect(sessionCallCount).toBe(0);
});

test("trigger-only mode (no signal) applies generic pruning", async () => {
  // Set trigger but no signal
  process.env.CC_COMPACTION_TRIGGER = "true";
  clearSignal();

  const { applyPruning } = await import("../src/compaction/pruning-engine.js");
  const longText = Array(100).fill("repeated debug line").join("\n");
  const input = [
    "Some normal content",
    longText,
  ];

  const originalLines = input.reduce((sum, c) => sum + c.split("\n").length, 0);
  const { contents, stats } = applyPruning(input);

  // Should have applied truncation (longText > 50 lines)
  expect(stats.prunedLines).toBeLessThan(originalLines);
  // Should NOT have condensed issues (no signal → no safe_to_compact)
  expect(contents.some((c: string) => c.includes("COMPLETED"))).toBe(false);

  delete process.env.CC_COMPACTION_TRIGGER;
  clearSignal();
});

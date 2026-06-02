import { test, expect } from "bun:test";
import { triggerCompaction } from "../src/compaction/trigger.js";
import { clearSignal } from "../src/compaction/state.js";

const origProviderID = process.env.CC_COMPACTION_PROVIDER_ID;
const origModelID = process.env.CC_COMPACTION_MODEL_ID;

test("calls session.summarize when available with env vars", async () => {
  process.env.CC_COMPACTION_PROVIDER_ID = "test-provider";
  process.env.CC_COMPACTION_MODEL_ID = "test-model";
  let callCount = 0;
  let calledWith: unknown = undefined;

  const client = {
    session: {
      summarize: async (args: unknown) => {
        callCount++;
        calledWith = args;
      },
    },
  };

  const result = await triggerCompaction(client, "sid1");
  expect(result).toBe(true);
  expect(callCount).toBe(1);
  expect(calledWith).toEqual({
    body: { providerID: "test-provider", modelID: "test-model" },
    path: { id: "sid1" },
  });
});

test("returns false for empty client", async () => {
  const result = await triggerCompaction({}, "sid1");
  expect(result).toBe(false);
});

test("returns false for missing sessionID", async () => {
  const client = {
    session: {
      summarize: async () => {},
    },
  };
  const result = await triggerCompaction(client, "");
  expect(result).toBe(false);
});

test("does not throw when method rejects", async () => {
  process.env.CC_COMPACTION_PROVIDER_ID = "test-provider";
  process.env.CC_COMPACTION_MODEL_ID = "test-model";

  const client = {
    session: {
      summarize: async (_args: unknown) => {
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
  // summarize wirft → zählt als gescheitert → Kandidaten durch → false
  expect(result).toBe(false);
});

test("calls summarize without body when env vars are missing", async () => {
  delete process.env.CC_COMPACTION_PROVIDER_ID;
  delete process.env.CC_COMPACTION_MODEL_ID;

  let callCount = 0;
  let calledWith: unknown = undefined;
  const client = {
    session: {
      summarize: async (args: unknown) => {
        callCount++;
        calledWith = args;
      },
    },
  };

  const result = await triggerCompaction(client, "sid3");
  expect(callCount).toBe(1);
  expect(calledWith).toEqual({ path: { id: "sid3" } });
  expect(result).toBe(true);
});

test("returns false for null client", async () => {
  const result = await triggerCompaction(null, "sid5");
  expect(result).toBe(false);
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

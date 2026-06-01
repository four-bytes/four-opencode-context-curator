import { test, expect } from "bun:test";
import { triggerCompaction } from "../src/compaction/trigger.js";

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
    body: { providerID: "test-provider", modelID: "test-model", auto: true },
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

test("skips summarize when env vars are missing", async () => {
  delete process.env.CC_COMPACTION_PROVIDER_ID;
  delete process.env.CC_COMPACTION_MODEL_ID;

  let summarizeCalled = false;
  const client = {
    session: {
      summarize: async () => {
        summarizeCalled = true;
      },
    },
  };

  const result = await triggerCompaction(client, "sid3");
  expect(summarizeCalled).toBe(false);
  // kein HTTP serverUrl, kein CC_COMPACTION_COMMAND → false
  expect(result).toBe(false);
});

test("returns false for null client", async () => {
  const result = await triggerCompaction(null, "sid5");
  expect(result).toBe(false);
});

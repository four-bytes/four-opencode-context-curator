import { test, expect } from "bun:test";
import { triggerCompaction } from "../src/compaction/trigger.js";

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
  expect(calledWith).toEqual({ path: { sessionID: "sid1" } });
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
  // compact wirft → zählt als gescheitert → nächster Kandidat (session.compact mit {sessionID}) wirft auch
  // → alle Kandidaten scheitern → false
  expect(result).toBe(false);
});

test("falls back to v2.session.compact when session.compact missing", async () => {
  let callCount = 0;

  const client = {
    v2: {
      session: {
        compact: async (_args: unknown) => {
          callCount++;
        },
      },
    },
  };

  const result = await triggerCompaction(client, "sid3");
  expect(result).toBe(true);
  expect(callCount).toBe(1);
});

test("falls back to postSessionCompact when nested paths missing", async () => {
  let callCount = 0;

  const client = {
    postSessionCompact: async (_args: unknown) => {
      callCount++;
    },
  };

  const result = await triggerCompaction(client, "sid4");
  expect(result).toBe(true);
  expect(callCount).toBe(1);
});

test("returns false for null client", async () => {
  const result = await triggerCompaction(null, "sid5");
  expect(result).toBe(false);
});

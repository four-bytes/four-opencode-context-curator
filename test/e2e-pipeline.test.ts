import { describe, it, expect, beforeAll, beforeEach, afterEach, mock } from "bun:test";
import { FourContextCuratorPlugin } from "../src/four-opencode-context-curator";
import {
  clearSignal,
  clearTransformState,
  getCompactionState,
  setCompactionCooldown,
  setCompactingActive,
  setLastSignal,
  getCompactionCooldownRemaining,
  getTurnsSinceCompaction,
} from "../src/compaction/state";

const mockSummarize = mock().mockResolvedValue(undefined);
const mockGet = mock().mockResolvedValue({ data: {} });
const mockClient = { session: { summarize: mockSummarize, get: mockGet } };

let systemTransform: any;
let messagesTransform: any;
let sessionCompacting: any;

beforeAll(async () => {
  const hooks = await FourContextCuratorPlugin({ client: mockClient } as any);
  systemTransform = hooks["experimental.chat.system.transform"];
  messagesTransform = hooks["experimental.chat.messages.transform"];
  sessionCompacting = hooks["experimental.session.compacting"];
});

describe("E2E Harness Smoke Test", () => {
  beforeEach(() => {
    clearSignal("e2e");
    clearTransformState("e2e");
    mockSummarize.mockClear();
  });

  afterEach(() => {
    delete process.env.CC_COMPACTION_TRIGGER;
    delete process.env.CC_DEBUG;
    delete process.env.GH_ISSUE;
    delete process.env.OPENDOC_TASK;
    delete process.env.OPENDOC_SESSION_ID;
  });
  it("plugin loads and returns all 3 hooks", () => {
    expect(systemTransform).toBeDefined();
    expect(typeof systemTransform).toBe("function");
    expect(messagesTransform).toBeDefined();
    expect(typeof messagesTransform).toBe("function");
    expect(sessionCompacting).toBeDefined();
    expect(typeof sessionCompacting).toBe("function");
  });

  it("mock client session.summarize is callable", async () => {
    await mockClient.session.summarize({ path: { id: "e2e" }, query: { directory: process.cwd() } });
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledWith({ path: { id: "e2e" }, query: { directory: process.cwd() } });
  });
  it("system.transform returns global rules + compaction layer", async () => {
    const input = { sessionID: "e2e" };
    const output = { system: [] as string[] };
    await systemTransform(input, output);
    expect(output.system.length).toBeGreaterThanOrEqual(2);
    expect(output.system[0]).toBeDefined();
    const lastIdx = output.system.length - 1;
    expect(output.system[lastIdx]).toContain("COMPACTION");
    for (const entry of output.system) {
      expect(entry).not.toContain("</function_call>");
      expect(entry).not.toContain("</response>");
    }
  });

  it("messages.transform strips compaction signal + triggers summarize", async () => {
    const input = { sessionID: "e2e" };
    const output = {
      messages: [
        { info: { role: "user", model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "Hello" }] },
        { info: { role: "assistant", providerID: "test-provider", modelID: "test-model" }, parts: [{ type: "text", text: "Hi there\n\ncompaction_advice: compact_now\nreason: Test" }] },
      ],
    };
    await messagesTransform(input, output);
    expect(output.messages[1].parts[0].text).toBe("Hi there");
    expect(output.messages[1].parts[0].text).not.toContain("compaction_advice");
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const callArg = mockSummarize.mock.calls[0][0];
    const expectedSessionID = process.env.OPENDOC_SESSION_ID ?? "unknown";
    expect(callArg.path.id).toBe(expectedSessionID);
    expect(callArg.query.directory).toBeDefined();
  });

  it("injects placeholder when assistant message is only a compaction signal", async () => {
    const input = { sessionID: "e2e" };
    const output = {
      messages: [
        { info: { role: "user", model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "Hello" }] },
        { info: { role: "assistant", providerID: "test-provider", modelID: "test-model" }, parts: [{ type: "text", text: "… [compacted: reason]" }] },
        { info: { role: "user", model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "Next prompt" }] },
      ],
    };

    messagesTransform(input, output);
    expect(output.messages[1].parts).toHaveLength(1);
    expect(output.messages[1].parts[0].text).toBe("… [compacted: reason]");
  });
});

describe("E2E session.compacting", () => {
  it("strips signal and sets prompt", async () => {
    setLastSignal("e2e", { advice: "compact_now", reason: "session full", safeToCompact: ["b1"] });
    const input = { sessionID: "e2e" };
    const output: any = { context: [], prompt: undefined };
    await sessionCompacting(input, output);
    expect(output.prompt).toBeDefined();
    expect(String(output.prompt)).toContain("Compacting session");
    expect(getCompactionState("e2e").lastSignal).not.toBeNull();
  });
});

describe("messages.transform turn accounting + native compaction", () => {
  const TURN_ENV = [
    "CC_AUTO_TOKEN_THRESHOLD",
    "CC_AUTO_TURN_THRESHOLD",
    "CC_COMPACTION_COOLDOWN_TURNS",
  ] as const;

  beforeEach(() => {
    mockSummarize.mockClear();
  });

  afterEach(() => {
    for (const key of TURN_ENV) delete process.env[key];
    mockSummarize.mockClear();
  });

  function history(sid: string, userIds: string[], assistantText = "ok") {
    const messages: any[] = [];
    for (const id of userIds) {
      messages.push({ info: { role: "user", id, sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "prompt" }] });
      messages.push({ info: { role: "assistant", id: `a-${id}`, sessionID: sid, providerID: "test-provider", modelID: "test-model" }, parts: [{ type: "text", text: assistantText }] });
    }
    return messages;
  }

  it("auto-triggers once per user turn, not once per transform invocation", async () => {
    const sid = "e2e-turn-once";
    clearSignal(sid);
    clearTransformState(sid);
    process.env.CC_AUTO_TOKEN_THRESHOLD = "1";
    process.env.CC_AUTO_TURN_THRESHOLD = "1";
    process.env.CC_COMPACTION_COOLDOWN_TURNS = "5";

    const output = { messages: history(sid, ["u1"], "a".repeat(100)) };

    await messagesTransform({ sessionID: sid }, output);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(getCompactionCooldownRemaining(sid)).toBe(5);
    expect(getTurnsSinceCompaction(sid)).toBe(0); // reset after compaction

    // Same user turn, tool loops → transforms repeat.
    await messagesTransform({ sessionID: sid }, output);
    await messagesTransform({ sessionID: sid }, output);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(getCompactionCooldownRemaining(sid)).toBe(5);
  });

  it("counts tool output when deciding to auto-trigger", async () => {
    const sid = "e2e-tool-accounting";
    clearSignal(sid);
    clearTransformState(sid);
    process.env.CC_AUTO_TOKEN_THRESHOLD = "10";
    process.env.CC_AUTO_TURN_THRESHOLD = "1";

    // Prose is tiny; only the 4000-char tool output crosses the token threshold.
    const output = {
      messages: [
        { info: { role: "user", id: "u1", sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "go" }] },
        {
          info: { role: "assistant", id: "a1", sessionID: sid, providerID: "test-provider", modelID: "test-model" },
          parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: "x".repeat(4000) } }],
        },
      ],
    };

    await messagesTransform({ sessionID: sid }, output);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
  });

  it("decrements the cooldown only when a new user turn arrives", async () => {
    const sid = "e2e-turn-cooldown";
    clearSignal(sid);
    clearTransformState(sid);
    process.env.CC_AUTO_TOKEN_THRESHOLD = "999999";
    setCompactionCooldown(sid, 3);

    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1"]) });
    // First transform is a new user turn: 3 → 2.
    expect(getCompactionCooldownRemaining(sid)).toBe(2);
    expect(getTurnsSinceCompaction(sid)).toBe(1);

    // Tool loops within turn 1 must not consume cooldown or turns.
    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1"]) });
    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1"]) });
    expect(getCompactionCooldownRemaining(sid)).toBe(2);
    expect(getTurnsSinceCompaction(sid)).toBe(1);

    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1", "u2"]) });
    expect(getCompactionCooldownRemaining(sid)).toBe(1);
    expect(getTurnsSinceCompaction(sid)).toBe(2);

    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1", "u2", "u3"]) });
    expect(getCompactionCooldownRemaining(sid)).toBe(0);
    expect(getTurnsSinceCompaction(sid)).toBe(3);
  });

  it("does not count a shrinking (natively compacted) history as a new turn", async () => {
    const sid = "e2e-turn-shrink";
    clearSignal(sid);
    clearTransformState(sid);
    process.env.CC_AUTO_TOKEN_THRESHOLD = "999999";

    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u1", "u2"]) });
    expect(getTurnsSinceCompaction(sid)).toBe(1);

    // Native compaction summarized u1 away; u2 is still the newest user message.
    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u2"]) });
    expect(getTurnsSinceCompaction(sid)).toBe(1);

    await messagesTransform({ sessionID: sid }, { messages: history(sid, ["u2", "u3"]) });
    expect(getTurnsSinceCompaction(sid)).toBe(2);
    expect(mockSummarize).not.toHaveBeenCalled();
  });
});

// ============================================================
// P2a: system.transform E2E tests will be added here
// ============================================================

// ============================================================
// P2b: messages.transform E2E tests will be added here
// ============================================================

// ============================================================
// P2c: session.compacting E2E tests will be added here
// ============================================================

// ============================================================
// Native compaction must only ever run for the ROOT session.
// Child/subagent sessions are marked by a non-null `parentID`.
// ============================================================
describe("native compaction is root-session only", () => {
  beforeEach(() => {
    mockSummarize.mockClear();
    mockGet.mockClear();
    mockGet.mockResolvedValue({ data: {} });
  });

  function compactNowHistory(sid: string) {
    return [
      { info: { role: "user", id: "u1", sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "go" }] },
      {
        info: { role: "assistant", id: "a1", sessionID: sid, providerID: "test-provider", modelID: "test-model" },
        parts: [{ type: "text", text: "done\n\ncompaction_advice: compact_now\nreason: done" }],
      },
    ];
  }

  // Turn accounting advances only on a NEW user message (#164), so three turns
  // need three distinct user ids — not the same history transformed thrice.
  function growingTurns(sid: string, count: number) {
    const messages: any[] = [];
    for (let i = 1; i <= count; i++) {
      messages.push({ info: { role: "user", id: `u${i}`, sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "go" }] });
      messages.push({
        info: { role: "assistant", id: `a${i}`, sessionID: sid, providerID: "test-provider", modelID: "test-model" },
        parts: [{ type: "text", text: i === count ? "x".repeat(300_000) : "ok" }],
      });
    }
    return messages;
  }

  it("skips compact_now for a child (subagent) session", async () => {
    const sid = "e2e-child-signal";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValueOnce({ data: { parentID: "e2e-root" } });

    const output = { messages: compactNowHistory(sid) };
    await messagesTransform({ sessionID: sid }, output);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toEqual({
      path: { id: sid },
      query: { directory: process.cwd() },
      throwOnError: true,
    });
    expect(mockSummarize).not.toHaveBeenCalled();
    // Signal is still stripped from visible output.
    expect(output.messages[1].parts[0].text).toBe("done");
  });

  it("skips the auto-trigger for a child session", async () => {
    const sid = "e2e-child-auto";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValue({ data: { parentID: "e2e-root" } });

    // > 50k estimated tokens (chars/4) and >= 3 distinct turns since compaction.
    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 1) });
    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 2) });
    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 3) });

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("positive control: the same history DOES auto-trigger for the root session", async () => {
    const sid = "e2e-root-auto";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValue({ data: { parentID: undefined } });

    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 1) });
    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 2) });
    await messagesTransform({ sessionID: sid }, { messages: growingTurns(sid, 3) });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize.mock.calls[0][0].path.id).toBe(sid);
  });

  it("still summarizes the root session (no parentID)", async () => {
    const sid = "e2e-root-signal";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValueOnce({ data: { parentID: undefined } });

    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize.mock.calls[0][0].path.id).toBe(sid);
    // Generated v1 SDK signature: summarize(options) — one object, no second arg.
    expect(mockSummarize.mock.calls[0]).toHaveLength(1);
    expect(mockSummarize.mock.calls[0][0].throwOnError).toBe(true);
  });

  it("caches the parent lookup per session", async () => {
    const sid = "e2e-child-cache";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValue({ data: { parentID: "e2e-root" } });

    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });
    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("falls back to root when the parent lookup fails, without caching it", async () => {
    const sid = "e2e-lookup-fail";
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockRejectedValueOnce(new Error("lookup failed"));

    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });
    expect(mockGet).toHaveBeenCalledTimes(1);
    // Lookup failure → preserve root behaviour.
    expect(mockSummarize).toHaveBeenCalledTimes(1);

    // Failure must not be cached: a second trigger looks up again.
    setCompactionCooldown(sid, 0);
    clearSignal(sid);
    clearTransformState(sid);
    mockGet.mockResolvedValueOnce({ data: {} });
    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockSummarize).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// Re-entrancy: the summarizer's own request passes through
// messages.transform while summarize is still pending. A second
// trigger there is the reported /compact deadlock (#168).
// ============================================================
describe("compaction re-entrancy guard", () => {
  beforeEach(() => {
    mockSummarize.mockReset();
    mockSummarize.mockResolvedValue(undefined);
    mockGet.mockClear();
    mockGet.mockResolvedValue({ data: {} });
  });

  function compactNowHistory(sid: string) {
    return [
      { info: { role: "user", id: "u1", sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "go" }] },
      {
        info: { role: "assistant", id: "a1", sessionID: sid, providerID: "test-provider", modelID: "test-model" },
        parts: [{ type: "text", text: "done\n\ncompaction_advice: compact_now\nreason: done" }],
      },
    ];
  }

  function hugeHistory(sid: string) {
    return [
      { info: { role: "user", id: "u1", sessionID: sid, model: { providerID: "test-provider", modelID: "test-model" } }, parts: [{ type: "text", text: "go" }] },
      {
        info: { role: "assistant", id: "a1", sessionID: sid, providerID: "test-provider", modelID: "test-model" },
        parts: [{ type: "text", text: "x".repeat(300_000) }],
      },
    ];
  }

  it("skips a second compact_now while the first summarize is in flight", async () => {
    const sid = "e2e-reentrancy-compact-now";
    clearSignal(sid);
    clearTransformState(sid);
    setCompactionCooldown(sid, 0);
    setCompactingActive(sid, false);

    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockSummarize.mockImplementationOnce(() => inFlight);

    const first = messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });
    // Flush the async parent lookup so summarize is actually pending.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(getCompactionState(sid).compactingActive).toBe(true);

    // The summarizer's own request re-enters the transform here.
    await messagesTransform({ sessionID: sid }, { messages: compactNowHistory(sid) });
    expect(mockSummarize).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(getCompactionState(sid).compactingActive).toBe(false);
  });

  it("skips the auto-trigger while compactingActive is true", async () => {
    const sid = "e2e-reentrancy-auto";
    clearSignal(sid);
    clearTransformState(sid);
    setCompactionCooldown(sid, 0);
    setCompactingActive(sid, true);

    const output = { messages: hugeHistory(sid) };
    await messagesTransform({ sessionID: sid }, output);
    await messagesTransform({ sessionID: sid }, output);
    await messagesTransform({ sessionID: sid }, output);

    expect(mockSummarize).not.toHaveBeenCalled();
    setCompactingActive(sid, false);
  });
});

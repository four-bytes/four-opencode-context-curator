import { describe, it, expect, beforeAll, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { FourContextCuratorPlugin } from "../src/four-opencode-context-curator.js";
import { clearSignal, clearTransformState, getCompactionState, setLastSignal, removeSession } from "../src/compaction/state.js";

const mockSummarize = mock().mockResolvedValue(undefined);
const mockClient = { session: { summarize: mockSummarize } };

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
  let tmpDir: string;
  let origCwd: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "e2e-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    clearSignal("e2e");
    clearTransformState("e2e");
    mockSummarize.mockClear();
    try { rmSync(join(homedir(), ".cache", "opencode", "four-opencode-context-curator"), { recursive: true, force: true }); } catch {}
  });

  afterEach(() => {
    process.chdir(origCwd);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    delete process.env.CC_COMPACTION_TRIGGER;
    delete process.env.CC_DEBUG;
    delete process.env.GH_ISSUE;
    delete process.env.OPENDOC_TASK;
    delete process.env.OPENDOC_SESSION_ID;
    removeSession("e2e");
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
    const output = { system: [] };
    await systemTransform(input, output);
    expect(output.system.length).toBeGreaterThanOrEqual(2);
    expect(output.system[0]).toContain("CONTEXT CURATOR");
    const lastIdx = output.system.length - 1;
    expect(output.system[lastIdx]).toContain("compaction_advice");
    for (const entry of output.system) {
      expect(entry).not.toContain("</function_call>");
      expect(entry).not.toContain("</response>");
    }
  });

  it("messages.transform strips compaction signal + triggers summarize", async () => {
    const input = { sessionID: "e2e" };
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "Hello" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Hi there\n\ncompaction_advice: compact_now\nreason: Test" }] },
      ],
    };
    await messagesTransform(input, output);
    expect(output.messages[1].parts[0].text).toBe("Hi there");
    expect(output.messages[1].parts[0].text).not.toContain("compaction_advice");
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const callArg = mockSummarize.mock.calls[0][0];
    const expectedSessionID = process.env.OPENDOC_SESSION_ID ?? "unknown";
    expect(callArg.sessionID).toBe(expectedSessionID);
    expect(callArg.directory).toBeDefined();
  });

  it("injects placeholder when assistant message is only a compaction signal", async () => {
    const input = { sessionID: "e2e" };
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "Hello" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "… [compacted: reason]" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "Next prompt" }] },
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
    expect(String(output.prompt)).toContain("compacting an AI");
    expect(output.context[0]).toContain("Compaction advice");
    expect(output.context[1]).toContain("Safe to compact");
    expect(getCompactionState("e2e").lastSignal).not.toBeNull();
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

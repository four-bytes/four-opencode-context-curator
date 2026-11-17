import { describe, it, expect, afterAll, afterEach } from "bun:test";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { compactMessageHistory, type MessageItem } from "../src/compaction/message-compactor.js";
import { applyPruning } from "../src/compaction/pruning-engine.js";
import { setLastSignal, clearSignal } from "../src/compaction/state.js";
import { getDiaryCacheDir, readDiaryEntries } from "../src/compaction/diary.js";

function removeDiaryFiles(sessionId: string): void {
  const dir = getDiaryCacheDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (file.startsWith(`compaction-events-${sessionId}-`) && file.endsWith(".jsonl")) {
      try { unlinkSync(join(dir, file)); } catch { /* ok */ }
    }
  }
}

describe("diary attribution", () => {
  afterEach(() => {
    clearSignal("attr-mc");
    clearSignal("attr-pe");
  });

  afterAll(() => {
    delete process.env.OPENDOC_SESSION_ID;
  });

  it("message-compactor truncation writes per-tool diary entries with agent (real ToolPart)", () => {
    const sid = "attr-mc";
    removeDiaryFiles(sid);
    process.env.OPENDOC_SESSION_ID = sid;

    const longOutput = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "q1" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "run_tests", state: { status: "completed", output: longOutput } }],
      },
      { info: { role: "user" }, parts: [{ type: "text", text: "q2" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r2" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "q3" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r3" }] },
    ];

    compactMessageHistory(messages, sid, "architect");

    const entries = readDiaryEntries(sid);
    expect(entries.length).toBeGreaterThan(0);

    const runTests = entries.find((e) => e.tool === "run_tests");
    expect(runTests).toBeDefined();
    expect(runTests!.agent).toBe("architect");
    expect(runTests!.linesBefore).toBeGreaterThan(runTests!.linesAfter);

    // The tool output itself was actually truncated.
    expect(messages[1].parts[0].state!.output).toContain("truncated");
    expect(messages[1].parts[0].state!.output).toContain("line1");
    expect(messages[1].parts[0].state!.output).toContain("line250");
  });

  it("message-compactor attributes tool parts without a name as unknown-tool", () => {
    const sid = "attr-mc";
    removeDiaryFiles(sid);
    process.env.OPENDOC_SESSION_ID = sid;

    const longOutput = Array.from({ length: 250 }, (_, i) => `raw${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "q1" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", state: { status: "completed", output: longOutput } }],
      },
      { info: { role: "user" }, parts: [{ type: "text", text: "q2" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r2" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "q3" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r3" }] },
    ];

    compactMessageHistory(messages, sid, "developer");

    const entries = readDiaryEntries(sid);
    const unknownTool = entries.find((e) => e.tool === "unknown-tool");
    expect(unknownTool).toBeDefined();
    expect(unknownTool!.agent).toBe("developer");
  });

  it("message-compactor attributes text-part truncation as text", () => {
    const sid = "attr-mc";
    removeDiaryFiles(sid);
    process.env.OPENDOC_SESSION_ID = sid;

    const longText = Array.from({ length: 250 }, (_, i) => `txt${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "q1" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: longText }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "q2" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r2" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "q3" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "r3" }] },
    ];

    compactMessageHistory(messages, sid, "developer");

    const entries = readDiaryEntries(sid);
    const textEntry = entries.find((e) => e.tool === "text");
    expect(textEntry).toBeDefined();
    expect(textEntry!.agent).toBe("developer");
  });

  it("pruning-engine writes per-layer diary entries with agent + tool", () => {
    const sid = "attr-pe";
    removeDiaryFiles(sid);
    process.env.OPENDOC_SESSION_ID = sid;

    setLastSignal(sid, { advice: "compact_now", reason: "r", safeToCompact: [] });

    applyPruning(
      ["content layer one", "content layer two"],
      { sessionID: sid, agent: "architect" },
      ["repo_profile", "task_slice"],
    );

    const entries = readDiaryEntries(sid);
    expect(entries.length).toBe(2);

    const tools = entries.map((e) => e.tool).sort();
    expect(tools).toEqual(["repo_profile", "task_slice"]);
    for (const entry of entries) {
      expect(entry.agent).toBe("architect");
    }
  });

  it("readDiaryEntries is backward-tolerant (legacy entries without agent/tool)", () => {
    const sid = "attr-legacy";
    removeDiaryFiles(sid);
    process.env.OPENDOC_SESSION_ID = sid;

    setLastSignal(sid, { advice: "compact_now", reason: "legacy", safeToCompact: [] });
    // No tools array → legacy single aggregate entry (no tool, agent undefined)
    applyPruning(["legacy content"], { sessionID: sid });

    const entries = readDiaryEntries(sid);
    expect(entries.length).toBe(1);
    expect(entries[0].tool).toBeUndefined();
    expect(entries[0].agent).toBeUndefined();
  });
});

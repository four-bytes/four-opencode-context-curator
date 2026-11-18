import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  compactMessageHistory,
  countChars,
  deduplicateMessageParts,
  truncateMessageParts,
  type MessageItem,
  type Part,
} from "../src/compaction/message-compactor.js";
import { estimateMessageTokens } from "../src/compaction/tokens.js";
import { observeUserTurn, clearSignal } from "../src/compaction/state.js";
import { getDiaryCacheDir } from "../src/compaction/diary.js";

// compactMessageHistory writes a persistent diary entry keyed on the session
// id found in the messages. A test-specific session id plus cleanup keeps
// repeated runs from polluting the real diary cache.
const TEST_SESSION = "accounting-truncation-test";
const REPLACEMENT_MARKER = "↑ see above (message ";

function removeDiaryEntries(sessionId: string): void {
  const dir = getDiaryCacheDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (file.startsWith(`compaction-events-${sessionId}-`) && file.endsWith(".jsonl")) {
      rmSync(join(dir, file), { force: true });
    }
  }
}

function text(text: string): Part {
  return { type: "text", text };
}

function toolOutput(tool: string, output: string): Part {
  return { type: "tool", tool, state: { status: "completed", output } };
}

function msg(role: string, parts: Part[], id?: string): MessageItem {
  return { info: { role, ...(id ? { id } : {}) }, parts };
}

afterEach(() => {
  clearSignal("accounting");
  clearSignal("dedup");
  removeDiaryEntries(TEST_SESSION);
});

describe("global accounting", () => {
  it("countChars includes tool state.output", () => {
    const output = "x".repeat(4000);
    const messages: MessageItem[] = [msg("assistant", [toolOutput("bash", output)])];
    expect(countChars(messages)).toBe(4000);
  });

  it("compactMessageHistory reports real reduction for truncated tool output", () => {
    const output = Array.from({ length: 500 }, (_, i) => `tool log line ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      msg("user", [text("run it")], "u1"),
      msg("assistant", [toolOutput("bash", output)], "a1"),
      msg("user", [text("next")], "u2"),
      msg("assistant", [text("ok")], "a2"),
      msg("user", [text("again")], "u3"),
      msg("assistant", [text("done")], "a3"),
    ];
    for (const m of messages) m.info.sessionID = TEST_SESSION;

    const before = countChars(messages);
    expect(before).toBeGreaterThan(output.length); // tool output + prose

    const result = compactMessageHistory(messages, "accounting");
    const truncatedOutput = messages[1].parts[0].state!.output!;

    expect(truncatedOutput).toContain("lines truncated");
    expect(result.charsBefore).toBe(before);
    expect(result.charsAfter).toBe(countChars(messages));
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
    // The reported reduction is exactly the tool output that was removed.
    expect(result.charsBefore - result.charsAfter).toBe(output.length - truncatedOutput.length);
    expect(result.reductionPct).toBeGreaterThan(0);
  });

  it("estimateMessageTokens includes tool output", () => {
    const m = { parts: [{ type: "tool", state: { status: "completed", output: "y".repeat(4000) } }] };
    expect(estimateMessageTokens(m)).toBe(1000);
  });

  it("estimateMessageTokens still counts text parts", () => {
    const m = { parts: [{ type: "text", text: "z".repeat(800) }] };
    expect(estimateMessageTokens(m)).toBe(200);
  });
});

describe("truncation never drops instructions, decisions or actionable errors", () => {
  it("never truncates user messages, even very long ones", () => {
    const prompt = Array.from({ length: 5000 }, (_, i) => `user line ${i + 1}`).join("\n");
    const messages: MessageItem[] = [msg("user", [text(prompt)])];
    expect(truncateMessageParts(messages)).toBe(0);
    expect(messages[0].parts[0].text).toBe(prompt);
  });

  it("does not truncate assistant prose carrying a decision", () => {
    const prose = Array.from({ length: 800 }, (_, i) => `status ${i + 1}`).join("\n");
    const original = `${prose}\nDecision: keep the legacy endpoint until v2.`;
    const messages: MessageItem[] = [msg("assistant", [text(original)])];
    expect(truncateMessageParts(messages)).toBe(0);
    expect(messages[0].parts[0].text).toBe(original);
  });

  it("keeps instructions, decisions and actionable errors from a truncated tool log", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    lines[250] = "ERROR: migration failed: relation \"users\" does not exist";
    lines[251] = "IMPORTANT: do not re-run the migration manually";
    lines[252] = "Decision: roll back to schema 42";
    const messages: MessageItem[] = [msg("assistant", [toolOutput("bash", lines.join("\n"))])];
    expect(truncateMessageParts(messages)).toBe(1);
    const out = messages[0].parts[0].state!.output!;
    expect(out).toContain("migration failed");
    expect(out).toContain("do not re-run the migration");
    expect(out).toContain("roll back to schema 42");
    expect(out).toContain("critical lines preserved");
  });
});

describe("repeat reads", () => {
  it("collapses identical completed tool output to a reference", () => {
    const output = Array.from({ length: 30 }, (_, i) => `identical read ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      msg("assistant", [toolOutput("read", output)]),
      msg("assistant", [toolOutput("read", output)]),
    ];

    expect(deduplicateMessageParts(messages)).toBe(1);
    // First occurrence is untouched — no information loss.
    expect(messages[0].parts[0].state!.output).toBe(output);
    expect(messages[1].parts[0].state!.output).toContain("↑ see above (message 1)");
  });

  it("does not collapse unique tool output", () => {
    const messages: MessageItem[] = [
      msg("assistant", [toolOutput("read", "first unique read output")]),
      msg("assistant", [toolOutput("read", "second unique read output")]),
    ];
    expect(deduplicateMessageParts(messages)).toBe(0);
    expect(messages[1].parts[0].state!.output).toBe("second unique read output");
  });
});

describe("observeUserTurn", () => {
  it("counts a new user message once, not every transform invocation", () => {
    const turn = (id: string) => ({ info: { role: "user", id } });
    expect(observeUserTurn("turn-test-a", [turn("u1")])).toBe(true);
    // Tool loop: same messages transformed again.
    expect(observeUserTurn("turn-test-a", [turn("u1")])).toBe(false);
    expect(observeUserTurn("turn-test-a", [turn("u1")])).toBe(false);
    // Next user turn.
    expect(observeUserTurn("turn-test-a", [turn("u1"), turn("u2")])).toBe(true);
    expect(observeUserTurn("turn-test-a", [turn("u1"), turn("u2")])).toBe(false);
  });

  it("falls back to user-message count when IDs are absent", () => {
    const noId = { info: { role: "user" } };
    expect(observeUserTurn("turn-test-b", [noId])).toBe(true);
    expect(observeUserTurn("turn-test-b", [noId])).toBe(false);
    expect(observeUserTurn("turn-test-b", [noId, noId])).toBe(true);
  });

  it("does not advance on an assistant-only transform", () => {
    expect(observeUserTurn("turn-test-c", [{ info: { role: "assistant" } }])).toBe(false);
  });
});

describe("dedup respects protected assistant prose", () => {
  it("never replaces repeated protected assistant text with a pointer", () => {
    const prose = "You must not re-run the migration before the backup completes.";
    const messages: MessageItem[] = [
      msg("assistant", [text(prose)]),
      msg("assistant", [text(prose)]),
    ];
    expect(deduplicateMessageParts(messages)).toBe(0);
    expect(messages[1].parts[0].text).toBe(prose);
  });

  it("still collapses repeated ordinary assistant text", () => {
    const plain = "Here is a plain summary of the changes applied so far.";
    const messages: MessageItem[] = [
      msg("assistant", [text(plain)]),
      msg("assistant", [text(plain)]),
    ];
    expect(deduplicateMessageParts(messages)).toBe(1);
    expect(messages[1].parts[0].text).toContain("\u2191 see above (message 1)");
  });
});

describe("observeUserTurn per-agent tracking", () => {
  const turn = (id: string) => ({ info: { role: "user", id } });
  const noId = { info: { role: "user" } };

  it("clears a stale id when the newest user message has no id", () => {
    const sid = "turn-test-stale";
    expect(observeUserTurn(sid, [turn("u1")])).toBe(true);
    // Newest user message carries no ID: the old u1 must not be reused.
    expect(observeUserTurn(sid, [turn("u1"), noId])).toBe(true);
    expect(observeUserTurn(sid, [turn("u1"), noId])).toBe(false);
  });

  it("keeps parent and subagent turns apart", () => {
    const sid = "turn-test-agents";
    expect(observeUserTurn(sid, [turn("p1")], "parent")).toBe(true);
    expect(observeUserTurn(sid, [turn("s1")], "subagent")).toBe(true);
    // The parent transform in the same turn must not count again just because
    // the subagent ran in between and advanced the shared tracker.
    expect(observeUserTurn(sid, [turn("p1")], "parent")).toBe(false);
    expect(observeUserTurn(sid, [turn("s1")], "subagent")).toBe(false);

    const sidNoIds = "turn-test-agents-noids";
    expect(observeUserTurn(sidNoIds, [noId], "parent")).toBe(true);
    expect(observeUserTurn(sidNoIds, [noId], "subagent")).toBe(true);
  });
});

describe("dedup is terminal and does not collapse curated excerpts", () => {
  it("never rewrites or recounts its own replacement markers", () => {
    const output = Array.from({ length: 30 }, (_, i) => `identical read ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      msg("assistant", [toolOutput("read", output)]),
      msg("assistant", [toolOutput("read", output)]),
    ];

    expect(deduplicateMessageParts(messages)).toBe(1);
    const marker = messages[1].parts[0].state!.output!;
    expect(marker).toContain(REPLACEMENT_MARKER);

    // A second pass must not hash the marker again.
    expect(deduplicateMessageParts(messages)).toBe(0);
    expect(messages[1].parts[0].state!.output).toBe(marker);
  });

  it("does not collapse distinct logs that only share the retained head and tail", () => {
    const head = Array.from({ length: 20 }, (_, i) => `head ${i + 1}`);
    const tail = Array.from({ length: 20 }, (_, i) => `tail ${i + 1}`);
    const middle = (tag: string) => Array.from({ length: 460 }, (_, i) => `${tag} ${i + 1}`);
    const messages: MessageItem[] = [
      msg("assistant", [toolOutput("read", [...head, ...middle("alpha"), ...tail].join("\n"))]),
      msg("assistant", [toolOutput("read", [...head, ...middle("beta"), ...tail].join("\n"))]),
    ];
    for (const m of messages) m.info.sessionID = TEST_SESSION;

    const first = compactMessageHistory(messages, "dedup-order");
    expect(first.applied).toBe(true);
    expect(messages[1].parts[0].state!.output).not.toContain(REPLACEMENT_MARKER);

    // Excerpts of two distinct logs are identical now; a later pass must not
    // mistake them for duplicates.
    const second = compactMessageHistory(messages, "dedup-order");
    expect(second.applied).toBe(false);
    expect(messages[1].parts[0].state!.output).not.toContain(REPLACEMENT_MARKER);
  });

  it("bounds critical-line preservation instead of leaving oversized logs whole", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    for (let i = 100; i < 300; i++) lines[i] = `ERROR: failure ${i}`;
    const messages: MessageItem[] = [msg("assistant", [toolOutput("bash", lines.join("\n"))])];

    expect(truncateMessageParts(messages)).toBe(1);
    const out = messages[0].parts[0].state!.output!;
    expect(out).toContain("lines truncated");
    expect(out).toContain("[100 critical lines preserved]");
  });
});

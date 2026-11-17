import { describe, it, expect, afterEach } from "bun:test";
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

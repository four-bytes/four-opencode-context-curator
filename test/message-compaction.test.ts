import { describe, it, expect, afterEach } from "bun:test";
import {
  truncateMessageParts,
  deduplicateMessageParts,
  compactMessageHistory,
} from "../src/compaction/message-compactor.js";
import type { MessageItem, Part } from "../src/compaction/message-compactor.js";
import { setLastSignal, clearSignal, getCompactionState } from "../src/compaction/state.js";

function makeTextPart(text: string): Part {
  return { type: "text", text };
}

function makeToolPart(text: string): Part {
  return { type: "tool_result", text };
}

function makeToolCallPart(tool: string): Part {
  return { type: "tool", tool };
}

function makeMsg(parts: Part[], role = "assistant"): MessageItem {
  return { info: { role }, parts };
}

describe("truncateMessageParts", () => {
  it("truncates long text parts", () => {
    const longText = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeTextPart(longText)]),
    ];

    const count = truncateMessageParts(messages);
    expect(count).toBe(1);
    expect(messages[0].parts[0].text).toContain("truncated");
    expect(messages[0].parts[0].text).toContain("line1");
    expect(messages[0].parts[0].text).toContain("line250");
  });

  it("leaves short text parts unchanged", () => {
    const messages: MessageItem[] = [
      makeMsg([makeTextPart("short message")]),
    ];
    const count = truncateMessageParts(messages);
    expect(count).toBe(0);
    expect(messages[0].parts[0].text).toBe("short message");
  });

  it("handles multiple messages", () => {
    const longText = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeTextPart(longText)]),
      makeMsg([makeTextPart(longText)]),
    ];
    expect(truncateMessageParts(messages)).toBe(2);
  });

  // --- Layer 1 Tests: Configurable Thresholds ---

  it("preserves at least header+footer lines when truncating long subagent output", () => {
    // task tool gets 2.5x multiplier on 200 = 500, so 600 lines triggers truncation
    const longText = Array.from({ length: 600 }, (_, i) => `detail line ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeToolCallPart("task"), makeTextPart(longText)]),
    ];
    const count = truncateMessageParts(messages);
    expect(count).toBe(1);
    // Header lines visible
    expect(messages[0].parts[1].text).toContain("detail line 1");
    expect(messages[0].parts[1].text).toContain("detail line 20");
    // Truncation notice present
    expect(messages[0].parts[1].text).toContain("truncated");
    // Footer lines visible
    expect(messages[0].parts[1].text).toContain("detail line 581");
    expect(messages[0].parts[1].text).toContain("detail line 600");
  });

  // --- Layer 2 Tests: Freshness Guard ---

  it("applies freshness guard (preserves last 2 turns, truncates older)", () => {
    const longText = Array.from({ length: 250 }, (_, i) => `data ${i + 1}`).join("\n");
    // Need 3+ turns to observe truncation; last 2 turns (1, 2) are always preserved
    // Turn 0: user → assistant (old → truncated)
    // Turn 1: user → assistant (fresh → preserved)
    // Turn 2: user → assistant (freshest → preserved)
    const messages: MessageItem[] = [
      makeMsg([makeTextPart("q1")], "user"),
      makeMsg([makeTextPart(longText)]),    // turn 0 → truncated
      makeMsg([makeTextPart("q2")], "user"),
      makeMsg([makeTextPart(longText)]),    // turn 1 → preserved
      makeMsg([makeTextPart("q3")], "user"),
      makeMsg([makeTextPart(longText)]),    // turn 2 → preserved
    ];
    const count = truncateMessageParts(messages);
    expect(count).toBe(1);
    // Old turn (index 1) is truncated
    expect(messages[1].parts[0].text).toContain("truncated");
    // Fresh turns (indices 3, 5) are preserved
    expect(messages[3].parts[0].text).not.toContain("truncated");
    expect(messages[5].parts[0].text).not.toContain("truncated");
    expect(messages[3].parts[0].text).toContain("data 250");
    expect(messages[5].parts[0].text).toContain("data 250");
  });

  // --- Layer 3 Tests: Per-Tool-Type Thresholds ---

  it("allows task tool output at 400 lines through (2.5x multiplier = 500 threshold)", () => {
    // task tool threshold = 200 * 2.5 = 500; 400 < 500, so NOT truncated
    const longText = Array.from({ length: 400 }, (_, i) => `task result ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeToolCallPart("task"), makeTextPart(longText)]),
    ];
    const count = truncateMessageParts(messages);
    expect(count).toBe(0);
    expect(messages[0].parts[1].text).not.toContain("truncated");
    expect(messages[0].parts[1].text).toContain("task result 400");
  });

  it("truncates non-task tool output at 250 lines (exceeds 200 default)", () => {
    // Non-task tools use default threshold of 200; 250 > 200, so truncated
    const longText = Array.from({ length: 250 }, (_, i) => `read output ${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeToolCallPart("Read"), makeTextPart(longText)]),
    ];
    const count = truncateMessageParts(messages);
    expect(count).toBe(1);
    expect(messages[0].parts[1].text).toContain("truncated");
    // Header lines are preserved
    expect(messages[0].parts[1].text).toContain("read output 1");
    // Footer lines are preserved
    expect(messages[0].parts[1].text).toContain("read output 250");
  });

  // --- Env Var Tests ---

  it("respects CC_MAX_TOOL_LINES env var", () => {
    const prev = process.env.CC_MAX_TOOL_LINES;
    process.env.CC_MAX_TOOL_LINES = "100";
    try {
      // With threshold 100, 150 lines triggers truncation
      const longText = Array.from({ length: 150 }, (_, i) => `env line ${i + 1}`).join("\n");
      const messages: MessageItem[] = [
        makeMsg([makeTextPart(longText)]),
      ];
      const count = truncateMessageParts(messages);
      expect(count).toBe(1);
      expect(messages[0].parts[0].text).toContain("truncated");
    } finally {
      process.env.CC_MAX_TOOL_LINES = prev;
      if (!process.env.CC_MAX_TOOL_LINES) delete process.env.CC_MAX_TOOL_LINES;
    }
  });

  it("respects CC_TOOL_HEADER_LINES env var", () => {
    const prev = process.env.CC_TOOL_HEADER_LINES;
    process.env.CC_TOOL_HEADER_LINES = "5";
    try {
      const longText = Array.from({ length: 250 }, (_, i) => `header line ${i + 1}`).join("\n");
      const messages: MessageItem[] = [
        makeMsg([makeTextPart(longText)]),
      ];
      const count = truncateMessageParts(messages);
      expect(count).toBe(1);
      // With headerLines=5, line6 should NOT appear in the truncated output
      // (lines are preserved as "header line 1" through "header line 5" only)
      expect(messages[0].parts[0].text).toContain("header line 1");
      expect(messages[0].parts[0].text).toContain("header line 5");
      // The 6th original line should be gone (only 5 header lines kept)
      expect(messages[0].parts[0].text).not.toContain("header line 6\n");
      // But footer lines should still be there
      expect(messages[0].parts[0].text).toContain("header line 250");
    } finally {
      process.env.CC_TOOL_HEADER_LINES = prev;
      if (!process.env.CC_TOOL_HEADER_LINES) delete process.env.CC_TOOL_HEADER_LINES;
    }
  });
});

describe("deduplicateMessageParts", () => {
  it("replaces duplicate text with reference", () => {
    const dup = "this is a repeated tool output which is long enough";
    const messages: MessageItem[] = [
      makeMsg([makeTextPart("unique content"), makeTextPart(dup)]),
      makeMsg([makeTextPart(dup)]),
    ];
    const count = deduplicateMessageParts(messages);
    expect(count).toBe(1);
    expect(messages[1].parts[0].text).toContain("↑ see above");
  });

  it("does not deduplicate short texts", () => {
    const messages: MessageItem[] = [
      makeMsg([makeTextPart("hi")]),
      makeMsg([makeTextPart("hi")]),
    ];
    expect(deduplicateMessageParts(messages)).toBe(0);
  });
});

describe("compactMessageHistory", () => {
  afterEach(() => {
    clearSignal("test");
  });

  it("applies truncation/dedup even without signal (always-on hygiene)", () => {
    const longText = Array.from({ length: 250 }, (_, i) => `log${i + 1}`).join("\n");
    const messages: MessageItem[] = [makeMsg([makeTextPart(longText)])];
    const result = compactMessageHistory(messages, "test");
    // Always-on truncation applies
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
    expect(result.applied).toBe(true);
  });

  it("no-op when no_compact signal", () => {
    setLastSignal("test", {
      advice: "no_compact",
      reason: "debugging",
      safeToCompact: ["block1"],
    });
    const messages: MessageItem[] = [makeMsg([makeTextPart("hello")])];
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(false);
  });

  it("applies truncation/dedup with compact_now signal (no message removal)", () => {
    setLastSignal("test", {
      advice: "compact_now",
      reason: "session cleanup",
      safeToCompact: ["block_old_logs"],
    });
    const longText = Array.from({ length: 250 }, (_, i) => `log${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeTextPart(longText)]),
      makeMsg([makeTextPart(longText)]),
    ];
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
    expect(messages.length).toBe(2); // No message removal
  });

  it("two calls both apply always-on hygiene", () => {
    // First call with short messages — no truncation/dedup work
    const shortMsgs: MessageItem[] = [makeMsg([makeTextPart("hello")])];
    setLastSignal("test", { advice: "compact_now", reason: "r1", safeToCompact: ["b1"] });
    const first = compactMessageHistory(shortMsgs, "test");
    expect(first.applied).toBe(false); // no work to do

    // Second call with long messages — truncation applies
    const longText = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join("\n");
    const longMsgs: MessageItem[] = [makeMsg([makeTextPart(longText)])];
    setLastSignal("test", { advice: "compact_now", reason: "r2", safeToCompact: ["b2"] });
    const second = compactMessageHistory(longMsgs, "test");
    expect(second.applied).toBe(true);
    expect(second.charsAfter).toBeLessThan(second.charsBefore);
  });

  it("compact_soon applies truncation/dedup but no message removal", () => {
    setLastSignal("test", {
      advice: "compact_soon",
      reason: "growing but ok",
      safeToCompact: ["block1"],
    });
    const longText = Array.from({ length: 250 }, (_, i) => `logline${i + 1}`).join("\n");
    const messages: MessageItem[] = Array.from({ length: 20 }, (_, i) =>
      makeMsg([makeTextPart(longText)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(20); // No dropping
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
  });

  it("compact_soon applies truncation/dedup", () => {
    const longText = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join("\n");
    setLastSignal("test", {
      advice: "compact_soon",
      reason: "test",
      safeToCompact: [],
    });
    const messages: MessageItem[] = Array.from({ length: 5 }, (_, i) =>
      makeMsg([makeTextPart(longText)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
    expect(messages.length).toBe(5); // No message removal
  });
});

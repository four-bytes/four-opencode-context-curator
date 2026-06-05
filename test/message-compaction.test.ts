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

function makeMsg(parts: Part[], role = "assistant"): MessageItem {
  return { info: { role }, parts };
}

describe("truncateMessageParts", () => {
  it("truncates long text parts", () => {
    const longText = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeTextPart(longText)]),
    ];

    const count = truncateMessageParts(messages);
    expect(count).toBe(1);
    expect(messages[0].parts[0].text).toContain("truncated");
    expect(messages[0].parts[0].text).toContain("line1");
    expect(messages[0].parts[0].text).toContain("line100");
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
    const longText = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n");
    const messages: MessageItem[] = [
      makeMsg([makeTextPart(longText)]),
      makeMsg([makeTextPart(longText)]),
    ];
    expect(truncateMessageParts(messages)).toBe(2);
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
    const longText = Array.from({ length: 80 }, (_, i) => `log${i + 1}`).join("\n");
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
    const longText = Array.from({ length: 80 }, (_, i) => `log${i + 1}`).join("\n");
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
    const longText = Array.from({ length: 80 }, (_, i) => `line${i + 1}`).join("\n");
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
    const longText = Array.from({ length: 80 }, (_, i) => `logline${i + 1}`).join("\n");
    const messages: MessageItem[] = Array.from({ length: 20 }, (_, i) =>
      makeMsg([makeTextPart(longText)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(20); // No dropping
    expect(result.charsAfter).toBeLessThan(result.charsBefore);
  });

  it("compact_soon applies truncation/dedup", () => {
    const longText = Array.from({ length: 80 }, (_, i) => `line${i + 1}`).join("\n");
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

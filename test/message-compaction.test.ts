import { describe, it, expect, afterEach } from "bun:test";
import {
  truncateMessageParts,
  deduplicateMessageParts,
  compactMessageHistory,
} from "../src/compaction/message-compactor.js";
import type { MessageItem, Part } from "../src/compaction/message-compactor.js";
import { setLastSignal, clearSignal, getCompactionState } from "../src/compaction/state.js";
import type { CompactionSignal } from "../src/compaction/signal-parser.js";

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
    getCompactionState("test").appliedFor.clear();
  });

  it("no-op when no signal", () => {
    const messages: MessageItem[] = [makeMsg([makeTextPart("hello")])];
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(false);
    expect(result.charsBefore).toBe(result.charsAfter);
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

  it("applies compaction with compact_now signal and long messages", () => {
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
    expect(result.reductionPct).toBeGreaterThan(0);
  });

  it("does not re-apply for already applied blocks", () => {
    const signal: CompactionSignal = {
      advice: "compact_now",
      reason: "done",
      safeToCompact: ["block1"],
    };
    setLastSignal("test", signal);
    const messages: MessageItem[] = [makeMsg([makeTextPart("content")])];

    const first = compactMessageHistory(messages, "test");
    expect(first.applied).toBe(true);

    setLastSignal("test", signal);
    const second = compactMessageHistory(messages, "test");
    expect(second.applied).toBe(false);
  });

  it("drops old messages on compact_now (aggressive)", () => {
    setLastSignal("test", {
      advice: "compact_now",
      reason: "session too large",
      safeToCompact: ["block_trim"],
    });
    // 25 messages — should keep only 15
    const messages: MessageItem[] = Array.from({ length: 25 }, (_, i) =>
      makeMsg([makeTextPart(`message ${i + 1}`)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(15); // 25 - 10 dropped
    expect(result.messagesBefore).toBe(25);
    expect(result.messagesAfter).toBe(15);
    expect(result.reductionPct).toBeGreaterThan(0);
  });

  it("does not drop messages on compact_soon", () => {
    setLastSignal("test", {
      advice: "compact_soon",
      reason: "growing but ok",
      safeToCompact: ["block1"],
    });
    const messages: MessageItem[] = Array.from({ length: 20 }, (_, i) =>
      makeMsg([makeTextPart(`msg ${i}`)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(20); // No dropping on compact_soon
  });

  it("compact_now with empty safe_to_compact still drops to KEEP_RECENT", () => {
    setLastSignal("test", {
      advice: "compact_now",
      reason: "test",
      safeToCompact: [],
    });
    const messages: MessageItem[] = Array.from({ length: 25 }, (_, i) =>
      makeMsg([makeTextPart(`message ${i + 1}`)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(15);
  });

  it("compact_soon with empty safe_to_compact truncates but does not drop", () => {
    setLastSignal("test", {
      advice: "compact_soon",
      reason: "test",
      safeToCompact: [],
    });
    const messages: MessageItem[] = Array.from({ length: 20 }, (_, i) =>
      makeMsg([makeTextPart(`msg ${i}`)]),
    );
    const result = compactMessageHistory(messages, "test");
    expect(result.applied).toBe(true);
    expect(messages.length).toBe(20);
  });

  // reproducer for GH-82: compact_now with only user messages → removed=0
  describe("removed:0 edge case (GH-82)", () => {
    it("logs stall when all messages are user-role on compact_now", () => {
      const msgs: MessageItem[] = [];
      for (let i = 0; i < 20; i++) {
        msgs.push({ info: { role: "user" }, parts: [{ type: "text", text: `task prompt ${i}` }] });
      }
      clearSignal("gh82");
      setLastSignal("gh82", { advice: "compact_now", reason: "test", safeToCompact: ["block1"] });
      const result = compactMessageHistory(msgs, "gh82");
      // All messages are user-role → nothing removed, but should not crash or hang
      expect(result.messagesAfter).toBe(20); // user messages preserved
      expect(result.applied).toBe(true);
      expect(result.reductionPct).toBe(0); // no change since all user-role
    });

    it("removes non-user messages on compact_now with mixed roles", () => {
      const msgs: MessageItem[] = [];
      // 5 user messages
      for (let i = 0; i < 5; i++) {
        msgs.push({ info: { role: "user" }, parts: [{ type: "text", text: `task ${i}` }] });
      }
      // 15 assistant messages (old)
      for (let i = 0; i < 15; i++) {
        msgs.push({ info: { role: "assistant" }, parts: [{ type: "text", text: `response ${i}` }] });
      }
      // 5 more user messages (recent)
      for (let i = 5; i < 10; i++) {
        msgs.push({ info: { role: "user" }, parts: [{ type: "text", text: `task ${i}` }] });
      }
      clearSignal("gh82-mixed");
      setLastSignal("gh82-mixed", { advice: "compact_now", reason: "mixed", safeToCompact: ["b1"] });
      const result = compactMessageHistory(msgs, "gh82-mixed");
      // KEEP_RECENT=15, oldest non-user (assistant) messages removed first
      expect(result.messagesAfter).toBeGreaterThanOrEqual(15);
      expect(result.messagesAfter).toBeLessThan(25);
      expect(result.applied).toBe(true);
    });
  });
});

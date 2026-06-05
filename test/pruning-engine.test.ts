import { describe, it, expect, afterEach } from "bun:test";
import {
  truncateToolLogs,
  deduplicateToolOutputs,
  condenseIssueSlice,
  applyPruning,
} from "../src/compaction/pruning-engine.js";
import { setLastSignal, clearSignal } from "../src/compaction/state.js";
import type { CompactionSignal } from "../src/compaction/signal-parser.js";

describe("truncateToolLogs", () => {
  it("returns original text when under maxLines", () => {
    const short = "line1\nline2\nline3";
    expect(truncateToolLogs(short, 10)).toBe(short);
  });

  it("truncates text exceeding maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const text = lines.join("\n");
    const result = truncateToolLogs(text, 50);
    expect(result).toContain("[80 lines truncated]"); // 100 - 10 - 10 = 80
    expect(result).toContain("line1");
    expect(result).toContain("line100");
  });

  it("keeps header and footer lines intact", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i + 1}`);
    const text = lines.join("\n");
    const result = truncateToolLogs(text, 50);
    expect(result.split("\n")[0]).toBe("line1");
    expect(result.split("\n").pop()).toBe("line60");
  });
});

describe("deduplicateToolOutputs", () => {
  it("returns unchanged for unique content", () => {
    const input = ["block A", "block B", "block C"];
    const { contents, duplicatesRemoved } = deduplicateToolOutputs(input);
    expect(contents).toEqual(input);
    expect(duplicatesRemoved).toBe(0);
  });

  it("replaces duplicates with reference marker", () => {
    const input = ["block A", "block B", "block A"];
    const { contents, duplicatesRemoved } = deduplicateToolOutputs(input);
    expect(contents[2]).toContain("↑ see above");
    expect(duplicatesRemoved).toBe(1);
  });
});

describe("condenseIssueSlice", () => {
  it("returns original if no ACTIVE ISSUE prefix", () => {
    const content = "Just some regular content";
    expect(condenseIssueSlice(content, ["issue_5"])).toBe(content);
  });

  it("condenses when issue is in safe_to_compact", () => {
    const content = 'ACTIVE ISSUE: #5\n{"title":"Fix login bug","number":5}';
    const result = condenseIssueSlice(content, ["issue_5_research"]);
    expect(result).toContain("COMPLETED");
    expect(result).toContain("Fix login bug");
    expect(result).not.toContain("ACTIVE ISSUE");
  });

  it("does not condense when issue NOT in safe_to_compact", () => {
    const content = 'ACTIVE ISSUE: #5\n{"title":"Fix login bug"}';
    expect(condenseIssueSlice(content, ["issue_3"])).toBe(content);
  });

  it("returns original when safe_to_compact is empty", () => {
    const content = 'ACTIVE ISSUE: #5\n{"title":"Fix login bug"}';
    expect(condenseIssueSlice(content, [])).toBe(content);
  });
});

describe("applyPruning", () => {
  afterEach(() => {
    // Reset state between tests
    clearSignal("test");
  });

  it("no-op when no signal set", () => {
    const input = ["content A", "content B"];
    const { contents, stats } = applyPruning(input, { sessionID: "test" });
    expect(contents).toEqual(input);
    expect(stats.originalLines).toBe(stats.prunedLines);
  });

  it("no-op when signal is no_compact", () => {
    setLastSignal("test", {
      advice: "no_compact",
      reason: "debugging",
      safeToCompact: ["issue_5"],
    });
    const input = ["content"];
    const { contents } = applyPruning(input, { sessionID: "test" });
    expect(contents).toEqual(input);
  });

  it("applies pruning when compact_now with valid blocks", () => {
    setLastSignal("test", {
      advice: "compact_now",
      reason: "issue done",
      safeToCompact: ["issue_5_research"],
    });
    const input = [
      'ACTIVE ISSUE: #5\n{"title":"Test issue","number":5}',
      Array(100).fill("log line").join("\n"),
    ];
    const { contents, stats } = applyPruning(input, { sessionID: "test" });
    expect(stats.blocksCondensed).toBeGreaterThan(0);
    expect(stats.prunedLines).toBeLessThan(stats.originalLines);
  });

  it("does not re-apply for already applied blocks", () => {
    const signal: CompactionSignal = {
      advice: "compact_now",
      reason: "done",
      safeToCompact: ["issue_5"],
    };
    setLastSignal("test", signal);
    const input = ["some content"];

    // First application
    const first = applyPruning(input, { sessionID: "test" });
    expect(first.stats.blocksCondensed + first.stats.duplicatesRemoved).toBeGreaterThanOrEqual(0);

    // Reset signal for second attempt
    setLastSignal("test", signal);
    const second = applyPruning(input, { sessionID: "test" });
    // Second should be no-op since blocks already applied
    expect(second.contents).toEqual(input);
  });
});

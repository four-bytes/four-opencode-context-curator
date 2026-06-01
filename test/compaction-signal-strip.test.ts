import { describe, it, expect } from "bun:test";
import { stripCompactionSignal } from "../src/compaction/signal-parser.js";

describe("stripCompactionSignal", () => {
  it("removes no_compact block from end of text", () => {
    const text = `Here is the answer to your question.

compaction_advice: no_compact
reason: Single question, no work blocks completed.`;
    
    const result = stripCompactionSignal(text);
    expect(result).toBe("Here is the answer to your question.");
    expect(result).not.toContain("compaction_advice");
  });

  it("removes compact_now block with safe_to_compact from end", () => {
    const text = `All tests pass ✅

compaction_advice: compact_now
reason: Issue #5 complete, logs accumulated
safe_to_compact: issue_5_research, tool_logs_turn_10-20`;
    
    const result = stripCompactionSignal(text);
    expect(result).toBe("All tests pass ✅");
    expect(result).not.toContain("compact_now");
    expect(result).not.toContain("safe_to_compact");
  });

  it("removes compact_soon block", () => {
    const text = `Still working on the refactor.

compaction_advice: compact_soon
reason: Context growing but still manageable.`;
    
    const result = stripCompactionSignal(text);
    expect(result).toBe("Still working on the refactor.");
  });

  it("returns unchanged text when no signal present", () => {
    const text = "Just a normal response with no signal.";
    expect(stripCompactionSignal(text)).toBe(text);
  });

  it("handles signal at very end with no trailing newline", () => {
    const text = "Done.\n\ncompaction_advice: no_compact\nreason: done";
    const result = stripCompactionSignal(text);
    expect(result).toBe("Done.");
  });

  it("is case-insensitive", () => {
    const text = "Result.\nCOMPACTION_ADVICE: no_compact\nREASON: ok";
    const result = stripCompactionSignal(text);
    expect(result).toBe("Result.");
    expect(result).not.toContain("COMPACTION_ADVICE");
  });
});

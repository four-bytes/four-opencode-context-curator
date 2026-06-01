import { describe, it, expect } from "bun:test";
import { parseCompactionSignal } from "../src/compaction/signal-parser.js";
import { createCompactionInstruction } from "../src/compaction/signal-injector.js";

describe("createCompactionInstruction", () => {
  it("returns a non-empty string", () => {
    const inst = createCompactionInstruction();
    expect(inst.length).toBeGreaterThan(0);
  });

  it("contains compaction_advice keywords", () => {
    const inst = createCompactionInstruction();
    expect(inst).toContain("compaction_advice");
    expect(inst).toContain("compact_now");
    expect(inst).toContain("compact_soon");
    expect(inst).toContain("no_compact");
  });
});

describe("parseCompactionSignal", () => {
  it("parses compact_now with reason and safe_to_compact", () => {
    const text = `
Some code output here...

compaction_advice: compact_now
reason: Issue #5 research complete, logs accumulated
safe_to_compact: issue_5_research, tool_logs_turn_10-20
`;
    const signal = parseCompactionSignal(text);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("compact_now");
    expect(signal!.reason).toBe("Issue #5 research complete, logs accumulated");
    expect(signal!.safeToCompact).toEqual(["issue_5_research", "tool_logs_turn_10-20"]);
  });

  it("parses compact_now without safe_to_compact line (returns empty array)", () => {
    const text = "compaction_advice: compact_now\nreason: wrapping up";
    const signal = parseCompactionSignal(text);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("compact_now");
    expect(signal!.safeToCompact).toEqual([]);
  });

  it("parses compact_soon without safe_to_compact", () => {
    const text = "compaction_advice: compact_soon\nreason: Context growing but stable";
    const signal = parseCompactionSignal(text);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("compact_soon");
    expect(signal!.reason).toBe("Context growing but stable");
    expect(signal!.safeToCompact).toEqual([]);
  });

  it("parses no_compact", () => {
    const text = "compaction_advice: no_compact\nreason: Active debugging in progress";
    const signal = parseCompactionSignal(text);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("no_compact");
  });

  it("is case-insensitive", () => {
    const text = "COMPACTION_ADVICE: COMPACT_NOW\nreason: done";
    const signal = parseCompactionSignal(text);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("compact_now");
  });

  it("returns null when no signal present", () => {
    expect(parseCompactionSignal("just some text")).toBeNull();
    expect(parseCompactionSignal("")).toBeNull();
  });

  it("returns null for unknown advice value", () => {
    expect(parseCompactionSignal("compaction_advice: maybe_later\nreason: huh")).toBeNull();
  });

  it("parseCompactionSignal works after stripping", () => {
    const raw = "Answer.\n\ncompaction_advice: compact_now\nreason: done";
    const stripped = raw.replace(/\n*compaction_advice:.*[\s\S]*$/i, "").trimEnd();
    expect(stripped).toBe("Answer.");
    const signal = parseCompactionSignal(raw);
    expect(signal).not.toBeNull();
    expect(signal!.advice).toBe("compact_now");
  });
});

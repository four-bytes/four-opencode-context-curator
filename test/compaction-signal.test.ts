import { describe, it, expect, afterEach } from "bun:test";
import { parseCompactionSignal } from "../src/compaction/signal-parser.js";
import { createCompactionInstruction } from "../src/compaction/signal-injector.js";
import { clearSignal, getCompactionState, setLastSignal } from "../src/compaction/state.js";

describe("createCompactionInstruction", () => {
  it("returns a non-empty string", () => {
    const inst = createCompactionInstruction();
    expect(inst.length).toBeGreaterThan(0);
  });

  it("contains minimal instruction keywords", () => {
    const inst = createCompactionInstruction();
    expect(inst).toContain("COMPACTION");
    expect(inst).toContain("Summarize");
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

describe("parseCompactionSignal → setLastSignal (direct flow, no event hook)", () => {
  afterEach(() => {
    clearSignal("test-session");
  });

  it("parses compact_now + setLastSignal", () => {
    const text = "Answer.\n\ncompaction_advice: compact_now\nreason: test\nsafe_to_compact: a, b";
    const result = parseCompactionSignal(text);
    expect(result).not.toBeNull();
    expect(result!.advice).toBe("compact_now");
    expect(result!.reason).toBe("test");
    expect(result!.safeToCompact).toEqual(["a", "b"]);

    setLastSignal("test-session", result!);
    const state = getCompactionState("test-session");
    expect(state?.lastSignal?.advice).toBe("compact_now");
    expect(state?.lastSignal?.reason).toBe("test");
  });

  it("parses compact_soon + setLastSignal", () => {
    const text = "compaction_advice: compact_soon\nreason: growing\nsafe_to_compact: x";
    const result = parseCompactionSignal(text);
    expect(result).not.toBeNull();
    expect(result!.advice).toBe("compact_soon");
    expect(result!.safeToCompact).toEqual(["x"]);

    setLastSignal("test-session", result!);
    const state = getCompactionState("test-session");
    expect(state?.lastSignal?.advice).toBe("compact_soon");
  });

  it("parses no_compact + setLastSignal", () => {
    const text = "compaction_advice: no_compact\nreason: debug active";
    const result = parseCompactionSignal(text);
    expect(result).not.toBeNull();
    expect(result!.advice).toBe("no_compact");

    setLastSignal("test-session", result!);
    const state = getCompactionState("test-session");
    expect(state?.lastSignal?.advice).toBe("no_compact");
  });

  it("overwrites previous signal on second call", () => {
    const first = "compaction_advice: no_compact\nreason: first";
    const second = "compaction_advice: compact_now\nreason: second\nsafe_to_compact: done";

    setLastSignal("test-session", parseCompactionSignal(first)!);
    setLastSignal("test-session", parseCompactionSignal(second)!);

    const state = getCompactionState("test-session");
    expect(state?.lastSignal?.advice).toBe("compact_now");
    expect(state?.lastSignal?.reason).toBe("second");
    expect(state?.lastSignal?.safeToCompact).toEqual(["done"]);
  });

  it("returns null for text without signal", () => {
    const result = parseCompactionSignal("Just a normal response.");
    expect(result).toBeNull();
  });
});

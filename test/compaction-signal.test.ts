import { describe, it, expect, afterEach } from "bun:test";
import { parseCompactionSignal, createCompactionSignalHook } from "../src/compaction/signal-parser.js";
import { createCompactionInstruction } from "../src/compaction/signal-injector.js";
import { clearSignal, getCompactionState } from "../src/compaction/state.js";

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

describe("createCompactionSignalHook (event-based)", () => {
  afterEach(() => {
    clearSignal();
  });

  it("parses compact_now from message.part.updated event and calls onSignal", async () => {
    const signals: Array<{ signal: unknown; sessionID: string }> = [];
    const hook = createCompactionSignalHook((signal, sessionID) => {
      signals.push({ signal, sessionID });
    });

    const text = [
      "Here is the answer.",
      "",
      "compaction_advice: compact_now",
      "reason: Issue #5 research complete",
      "safe_to_compact: issue_5_research, tool_logs",
      "",
    ].join("\n");

    await hook({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "session-abc",
          part: {
            id: "part-1",
            sessionID: "session-abc",
            messageID: "msg-1",
            type: "text",
            text,
          },
          time: Date.now(),
        },
      },
    });

    const state = getCompactionState();
    expect(state.lastSignal).not.toBeNull();
    expect(state.lastSignal!.advice).toBe("compact_now");
    expect(state.lastSignal!.reason).toBe("Issue #5 research complete");
    expect(state.lastSignal!.safeToCompact).toEqual(["issue_5_research", "tool_logs"]);
    expect(signals.length).toBe(1);
    expect(signals[0].sessionID).toBe("session-abc");
  });

  it("ignores non-message.part.updated events", async () => {
    let fired = false;
    const hook = createCompactionSignalHook(() => { fired = true; });

    await hook({
      event: {
        type: "session.next.text.ended",
        properties: { sessionID: "s1", text: "compaction_advice: compact_now\nreason: x", timestamp: 1 },
      },
    });

    expect(fired).toBe(false);
    expect(getCompactionState().lastSignal).toBeNull();
  });

  it("ignores non-text parts", async () => {
    let fired = false;
    const hook = createCompactionSignalHook(() => { fired = true; });

    await hook({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            callID: "c1",
            tool: "bash",
            state: { status: "running", input: {}, raw: "ls", time: { start: 1 } },
          },
          time: 1,
        },
      },
    });

    expect(fired).toBe(false);
    expect(getCompactionState().lastSignal).toBeNull();
  });

  it("ignores text without compaction signal", async () => {
    let fired = false;
    const hook = createCompactionSignalHook(() => { fired = true; });

    await hook({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "text",
            text: "Just a normal response without signal.",
          },
          time: 1,
        },
      },
    });

    expect(fired).toBe(false);
    expect(getCompactionState().lastSignal).toBeNull();
  });

  it("never throws on malformed input", async () => {
    const hook = createCompactionSignalHook();

    // Missing properties entirely
    await hook({ event: { type: "message.part.updated", properties: {} } as never });
    await hook({ event: { type: "message.part.updated" } } as never);
    await hook({ event: { type: "unknown" } } as never);
    await hook({ event: {} } as never);
    await hook({} as never);

    expect(getCompactionState().lastSignal).toBeNull();
  });
});

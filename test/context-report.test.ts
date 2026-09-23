import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { buildContextReport, type ContextReportInput } from "../src/compaction/context-report.js";
import {
  getDiaryCacheDir,
  readDiaryEntries,
  writeDiaryEntry,
  type DiaryEntry,
} from "../src/compaction/diary.js";

function removeDiaryFiles(sessionId: string): void {
  const dir = getDiaryCacheDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (file.startsWith(`compaction-events-${sessionId}-`) && file.endsWith(".jsonl")) {
      try { unlinkSync(join(dir, file)); } catch { /* ok */ }
    }
  }
}

function makeEntry(tool: string, linesBefore: number, linesAfter: number, agent = "architect"): DiaryEntry {
  return {
    ts: Date.now(),
    advice: "triggered",
    reason: "CC_COMPACTION_TRIGGER",
    blocksCondensed: 1,
    duplicatesRemoved: 0,
    linesBefore,
    linesAfter,
    reductionPct: linesBefore > 0 ? Math.round(((linesBefore - linesAfter) / linesBefore) * 100) : 0,
    sessionId: "sess",
    triggered: false,
    agent,
    tool,
  };
}

describe("buildContextReport", () => {
  it("produces a report under 10 lines with top sources", () => {
    const input: ContextReportInput = {
      sessionId: "session-abcdef",
      agent: "architect",
      tokenHistory: [100000, 101000, 102000],
      entries: [
        makeEntry("run_tests", 100, 0),
        makeEntry("explore", 60, 0),
        makeEntry("git_diff", 40, 0),
      ],
    };

    const report = buildContextReport(input);
    const lines = report.split("\n");

    expect(lines.length).toBeLessThanOrEqual(10);
    expect(report).toContain("CONTEXT — session sess…, agent architect");
    expect(report).toContain("turns          3");
    expect(report).toContain("avg 101k · max 102k");
    expect(report).toContain("pruned         200 lines total");
    // top sources sorted desc: run_tests 50% · explore 30% · git_diff 20%
    expect(report).toContain("run_tests 50% · explore 30% · git_diff 20%");
  });

  it("returns a one-line message when no diary exists", () => {
    const report = buildContextReport({
      sessionId: "empty-session",
      agent: null,
      tokenHistory: [1000, 2000],
      entries: [],
    });
    expect(report.split("\n").length).toBe(1);
    expect(report).toContain("No compaction diary for session empty-session.");
  });

  it("shows n/a trend and input when token history is insufficient", () => {
    const report = buildContextReport({
      sessionId: "short",
      agent: "build",
      tokenHistory: [500],
      entries: [makeEntry("run_tests", 10, 5, "build")],
    });
    expect(report).toContain("turns          1");
    expect(report).toContain("trend n/a");
  });

  it("shows n/a input/turn when no token history", () => {
    const report = buildContextReport({
      sessionId: "noturns",
      agent: "build",
      tokenHistory: [],
      entries: [makeEntry("run_tests", 10, 5, "build")],
    });
    expect(report).toContain("turns          0");
    expect(report).toContain("input/turn     n/a");
  });

  it("groups legacy entries without tool under 'other'", () => {
    const legacy: DiaryEntry = {
      ...makeEntry("ignored", 20, 0),
      tool: undefined,
    };
    const report = buildContextReport({
      sessionId: "legacy",
      agent: "architect",
      tokenHistory: [],
      entries: [legacy],
    });
    expect(report).toContain("other 100%");
  });

  it("reads diary written via writeDiaryEntry using the entry's own sessionId (no env)", () => {
    const sid = "real-write-path-test";
    delete process.env.OPENDOC_SESSION_ID;
    delete process.env.SESSION_ID;
    removeDiaryFiles(sid);

    writeDiaryEntry({
      ts: Date.now(),
      advice: "triggered",
      reason: "CC_COMPACTION_TRIGGER",
      blocksCondensed: 1,
      duplicatesRemoved: 0,
      linesBefore: 100,
      linesAfter: 40,
      reductionPct: 60,
      sessionId: sid,
      triggered: false,
      agent: "architect",
      tool: "run_tests",
    });

    const entries = readDiaryEntries(sid);
    expect(entries.length).toBe(1);
    expect(entries[0].tool).toBe("run_tests");

    const report = buildContextReport({ sessionId: sid, agent: "architect", entries, tokenHistory: [] });
    expect(report).toContain("run_tests 100%");

    removeDiaryFiles(sid);
  });
});

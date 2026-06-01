import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { applyPruning } from "../src/compaction/pruning-engine.js";
import { setLastSignal, clearSignal, getCompactionState } from "../src/compaction/state.js";
import { writeDiaryEntry } from "../src/compaction/diary.js";
import type { CompactionSignal } from "../src/compaction/signal-parser.js";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".cache", "opencode", "four-opencode-context-curator");

describe("Compaction Integration", () => {
  let diaryPath: string;

  beforeAll(() => {
    // Ensure cache dir exists
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const date = new Date().toISOString().split("T")[0];
    diaryPath = join(CACHE_DIR, `compaction-events-${date}.jsonl`);
    // Remove existing diary to start fresh
    try { unlinkSync(diaryPath); } catch {}
  });

  afterEach(() => {
    clearSignal();
    getCompactionState().appliedFor.clear();
  });

  afterAll(() => {
    try { unlinkSync(diaryPath); } catch {}
  });

  it("writes diary entry after pruning", () => {
    setLastSignal({
      advice: "compact_now",
      reason: "multi-turn test",
      safeToCompact: ["issue_99"],
    });

    const input = [
      'ACTIVE ISSUE: #99\n{"title":"Test compaction diary","number":99}',
      Array(100).fill("repeated log line").join("\n"),
    ];

    applyPruning(input);

    // Check diary file was written
    expect(existsSync(diaryPath)).toBe(true);
    const content = readFileSync(diaryPath, "utf-8");
    expect(content).toContain("compact_now");
    expect(content).toContain("linesBefore");
    expect(content).toContain("reductionPct");
  });

  it("multi-turn simulation: signal → compact → verify reduction", () => {
    // Turn 1: Signal received
    setLastSignal({
      advice: "compact_now",
      reason: "issue 42 complete",
      safeToCompact: ["issue_42"],
    });

    // Simulated layer contents (growing over turns)
    const layerContents = [
      "ACTIVE ISSUE: #42\n" + '{"title":"Fix memory leak in cache module","number":42}\n' + "Status: Done, tests passing\n",
      "Tool output: " + Array(80).fill("debug: processing chunk").join("\n"),
      Array(60).fill("npm test output line").join("\n"),
      "Some other content",
    ];

    const originalLines = layerContents.reduce((sum, c) => sum + c.split("\n").length, 0);

    const { contents, stats } = applyPruning(layerContents);

    // Should have condensed the issue
    expect(contents.some((c) => c.includes("COMPLETED"))).toBe(true);

    // Should have reduced total lines
    expect(stats.prunedLines).toBeLessThan(stats.originalLines);

    // Reduction must be measurable
    const reductionPct =
      ((originalLines - stats.prunedLines) / originalLines) * 100;
    expect(reductionPct).toBeGreaterThan(0);

    // Stats should be consistent
    expect(stats.blocksCondensed).toBeGreaterThanOrEqual(0);
    expect(stats.duplicatesRemoved).toBeGreaterThanOrEqual(0);
  });

  it("no diary entry when pruning is no-op", () => {
    // No signal set → no-op
    const input = ["just some content"];

    try { unlinkSync(diaryPath); } catch {}

    applyPruning(input);

    // Diary should NOT be created (or be empty) for no-op
    if (existsSync(diaryPath)) {
      const content = readFileSync(diaryPath, "utf-8");
      expect(content.trim()).toBe(""); // should be empty since no write happened
    }
  });
});

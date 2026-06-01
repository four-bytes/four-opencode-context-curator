import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DiaryEntry {
  ts: number;
  advice: string;
  reason: string;
  blocksCondensed: number;
  duplicatesRemoved: number;
  linesBefore: number;
  linesAfter: number;
  reductionPct: number;
  sessionId: string;
  triggered: boolean;
}

const CACHE_DIR = join(homedir(), ".cache", "opencode", "four-opencode-context-curator");

function getDiaryPath(): string {
  // Use OPENDOC_SESSION_ID or fallback to "unknown"
  const sessionId = process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
  const date = new Date().toISOString().split("T")[0];
  return join(CACHE_DIR, `compaction-events-${date}.jsonl`);
}

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function writeDiaryEntry(entry: DiaryEntry): void {
  try {
    ensureDir();
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(getDiaryPath(), line, "utf-8");
  } catch {
    // Silent — never throw from diary
  }
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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
  downgraded?: boolean;
  /** Agent name that produced this entry (absent on entries written before attribution). */
  agent?: string;
  /** Tool / layer source that produced the pruned block (absent on legacy entries). */
  tool?: string;
}

const CACHE_DIR = join(homedir(), ".cache", "opencode", "four-opencode-context-curator");

function getDiaryPath(sessionId: string): string {
  const date = new Date().toISOString().split("T")[0];
  return join(CACHE_DIR, `compaction-events-${sessionId}-${date}.jsonl`);
}

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function writeDiaryEntry(entry: DiaryEntry): void {
  try {
    ensureDir();
    // Key the file on the entry's own sessionId so the reader (context_report,
    // which uses ctx.sessionID) and the writer always agree. Env is only a last
    // resort for legacy entries that lack a sessionId.
    const sessionId =
      entry.sessionId || process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(getDiaryPath(sessionId), line, "utf-8");
  } catch {
    // Silent — never throw from diary
  }
}

export function getDiaryCacheDir(): string {
  return CACHE_DIR;
}

/**
 * Read all diary entries for a session (all compaction-events-<sessionId>-*.jsonl
 * files in the cache dir). Backward-tolerant: legacy entries without agent/tool
 * parse fine. Never throws — returns [] on any failure.
 */
export function readDiaryEntries(sessionId: string): DiaryEntry[] {
  try {
    if (!existsSync(CACHE_DIR)) return [];
    const files = readdirSync(CACHE_DIR).filter(
      (f) => f.startsWith(`compaction-events-${sessionId}-`) && f.endsWith(".jsonl"),
    );
    const entries: DiaryEntry[] = [];
    for (const file of files) {
      let raw: string;
      try {
        raw = readFileSync(join(CACHE_DIR, file), "utf-8");
      } catch {
        continue;
      }
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as DiaryEntry);
        } catch {
          // skip malformed line
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

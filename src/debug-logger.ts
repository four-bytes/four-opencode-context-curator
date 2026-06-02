import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DebugEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

function getCacheDir(): string {
  return join(homedir(), ".cache", "opencode", "four-opencode-context-curator");
}

function getLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return join(getCacheDir(), `debug-${date}.jsonl`);
}

function ensureDir(): void {
  const dir = getCacheDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Writes a JSON debug event to a daily JSONL file.
 * No-op unless CC_DEBUG === "true". Never throws.
 */
export function logDebugEvent(
  type: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.CC_DEBUG !== "true") return;

  try {
    ensureDir();
    const event: DebugEvent = { ts: Date.now(), type, ...payload };
    const line = JSON.stringify(event) + "\n";
    appendFileSync(getLogPath(), line, "utf-8");
  } catch {
    // Silent — never throw from debug logger
  }
}

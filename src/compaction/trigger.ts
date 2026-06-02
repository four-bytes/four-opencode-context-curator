/**
 * Aktiver Compaction-Trigger: ruft den opencode compact-Endpoint via SDK client.v2.session.compact() auf.
 * Fallback: client.session.compact() (legacy SDK), HTTP POST, CC_COMPACTION_COMMAND.
 * NIE werfen — alle Fehler werden geschluckt.
 */

import { logDebugEvent } from "../debug-logger.js";

type AnyFn = (...args: unknown[]) => unknown;

function isFn(v: unknown): v is AnyFn {
  return typeof v === "function";
}

async function tryCall(fn: AnyFn, ...args: unknown[]): Promise<boolean> {
  try {
    await fn(...args);
    return true;
  } catch {
    return false;
  }
}

export async function triggerCompaction(
  client: unknown,
  sessionID: string,
  serverUrl?: string,
): Promise<boolean> {
  if (!client || !sessionID) return false;

  const c = client as Record<string, unknown>;

  // Kandidaten als async-Closures
  const candidates: Array<{ name: string; fn: () => Promise<boolean> }> = [
    // #1 client.v2.session.compact({ sessionID }) — primary SDK path
    {
      name: "v2.session.compact",
      fn: async () => {
        const v2 = c["v2"] as Record<string, unknown> | undefined;
        const compact = (v2?.["session"] as Record<string, unknown> | undefined)?.["compact"];
        if (!isFn(compact)) return false;
        const parent = v2?.["session"] as Record<string, unknown> | undefined;
        return tryCall(compact.bind(parent), { sessionID });
      },
    },
    // #2 client.session.compact({ sessionID }) — legacy fallback
    {
      name: "session.compact",
      fn: async () => {
        const compact = (c["session"] as Record<string, unknown> | undefined)?.["compact"];
        if (!isFn(compact)) return false;
        return tryCall(compact.bind(c["session"]), { sessionID });
      },
    },
  ];

  for (const { name, fn } of candidates) {
    try {
      const ok = await fn();
      logDebugEvent("compaction.trigger.candidate", { name, ok });
      if (ok) return true;
    } catch {
      logDebugEvent("compaction.trigger.candidate", { name, ok: false });
      // weiter
    }
  }

  // HTTP-Fallback: POST /api/session/{sessionID}/compact via fetch (Bun built-in)
  if (serverUrl) {
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/compact`;
      const response = await fetch(url, { method: "POST" });
      logDebugEvent("compaction.trigger.http", {
        url,
        status: response.status,
        ok: response.ok,
      });
      if (response.ok) return true;
    } catch {
      // fall through
    }
  } else {
    logDebugEvent("compaction.trigger.http.skipped", { reason: "no serverUrl" });
  }

  // Fallback: CC_COMPACTION_COMMAND env var
  const cmd = process.env.CC_COMPACTION_COMMAND;
  if (!cmd) return false;

  try {
    const interpolated = cmd.replace(/\{sessionID\}/g, sessionID);
    const proc = Bun.spawn(["sh", "-c", interpolated], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    logDebugEvent("compaction.trigger.cmd", { ok: exitCode === 0, exitCode });
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Aktiver Compaction-Trigger: ruft den opencode compact-Endpoint via SDK client.session.compact() auf.
 * HTTP-Fallback und CC_COMPACTION_COMMAND als weitere Fallbacks.
 * NIE werfen — alle Fehler werden geschluckt.
 */

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
  const candidates: Array<() => Promise<boolean>> = [
    // 1. client.session.compact({ sessionID })
    // Uses opencode's SDK method — no env vars needed for model selection.
    async () => {
      const compact = (c["session"] as Record<string, unknown> | undefined)?.["compact"];
      if (!isFn(compact)) return false;
      return tryCall(compact.bind(c["session"]), { sessionID });
    },
  ];

  for (const candidate of candidates) {
    try {
      const ok = await candidate();
      if (ok) return true;
    } catch {
      // weiter
    }
  }

  // HTTP-Fallback: POST /api/session/{sessionID}/compact via fetch (Bun built-in)
  if (serverUrl) {
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/compact`;
      const response = await fetch(url, { method: "POST" });
      if (response.ok) return true;
    } catch {
      // fall through
    }
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
    return exitCode === 0;
  } catch {
    return false;
  }
}

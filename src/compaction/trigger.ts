/**
 * Aktiver Compaction-Trigger: ruft den opencode compact-Endpoint via SDK summarize() oder HTTP-Fallback auf.
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
    // 1. client.session.summarize({ body: { providerID, modelID, auto: true }, path: { id: sessionID } })
    // Uses CC_COMPACTION_PROVIDER_ID / CC_COMPACTION_MODEL_ID env vars for model selection
    async () => {
      const providerID = process.env.CC_COMPACTION_PROVIDER_ID;
      const modelID = process.env.CC_COMPACTION_MODEL_ID;
      if (!providerID || !modelID) return false;
      const summarize = (c["session"] as Record<string, unknown> | undefined)?.["summarize"];
      if (!isFn(summarize)) return false;
      return tryCall(summarize.bind(c["session"]), {
        body: { providerID, modelID, auto: true },
        path: { id: sessionID },
      });
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

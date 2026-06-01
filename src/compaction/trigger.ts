/**
 * Aktiver Compaction-Trigger: ruft den opencode compact-Endpoint via SDK-Client auf.
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

export async function triggerCompaction(client: unknown, sessionID: string): Promise<boolean> {
  if (!client || !sessionID) return false;

  const c = client as Record<string, unknown>;

  // Kandidaten als async-Closures
  const candidates: Array<() => Promise<boolean>> = [
    // 1a. client.session.compact({ path: { sessionID } })
    async () => {
      const compact = (c["session"] as Record<string, unknown> | undefined)?.["compact"];
      if (!isFn(compact)) return false;
      return tryCall(compact.bind(c["session"]), { path: { sessionID } });
    },
    // 1b. client.session.compact({ sessionID })
    async () => {
      const compact = (c["session"] as Record<string, unknown> | undefined)?.["compact"];
      if (!isFn(compact)) return false;
      return tryCall(compact.bind(c["session"]), { sessionID });
    },
    // 2a. client.v2.session.compact({ path: { sessionID } })
    async () => {
      const v2 = c["v2"] as Record<string, unknown> | undefined;
      const compact = (v2?.["session"] as Record<string, unknown> | undefined)?.["compact"];
      if (!isFn(compact)) return false;
      return tryCall(compact.bind(v2?.["session"]), { path: { sessionID } });
    },
    // 2b. client.v2.session.compact({ sessionID })
    async () => {
      const v2 = c["v2"] as Record<string, unknown> | undefined;
      const compact = (v2?.["session"] as Record<string, unknown> | undefined)?.["compact"];
      if (!isFn(compact)) return false;
      return tryCall(compact.bind(v2?.["session"]), { sessionID });
    },
    // 3. client.postSessionCompact({ path: { sessionID } })
    async () => {
      const fn = c["postSessionCompact"];
      if (!isFn(fn)) return false;
      return tryCall(fn.bind(client), { path: { sessionID } });
    },
    // Generischer Fallback: client.POST
    async () => {
      const fn = c["POST"];
      if (!isFn(fn)) return false;
      return tryCall(fn.bind(client), "/api/session/{sessionID}/compact", {
        params: { path: { sessionID } },
      });
    },
    // Generischer Fallback: client.request
    async () => {
      const fn = c["request"];
      if (!isFn(fn)) return false;
      return tryCall(fn.bind(client), "/api/session/{sessionID}/compact", {
        params: { path: { sessionID } },
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

  return false;
}

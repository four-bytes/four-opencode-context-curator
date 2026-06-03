/**
 * Aktiver Compaction-Trigger: ruft den opencode compact-Endpoint via SDK client.v2.session.compact() auf.
 * Fallback: client.session.compact() (legacy SDK), HTTP POST, CC_COMPACTION_COMMAND.
 * NIE werfen — alle Fehler werden geschluckt.
 */

import { logDebugEvent } from "../debug-logger.js";
import { getLastUserModel, startCompactionCooldown } from "./state.js";

type AnyFn = (...args: unknown[]) => unknown;

function isFn(v: unknown): v is AnyFn {
  return typeof v === "function";
}

async function tryCall(name: string, fn: AnyFn, ...args: unknown[]): Promise<boolean> {
  try {
    await fn(...args);
    return true;
  } catch (e) {
    logDebugEvent("compaction.trigger.error", {
      name,
      err: String(e),
      stack: (e as Error)?.stack ?? null,
    });
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

  const v2Raw = c["v2"];
  const v2 = (v2Raw && typeof v2Raw === "object") ? v2Raw as Record<string, unknown> : undefined;
  const v2Session = v2?.["session"];
  const v2SessionObj = (v2Session && typeof v2Session === "object") ? v2Session as Record<string, unknown> : undefined;
  const sessionRaw = c["session"];
  const sessionObj = (sessionRaw && typeof sessionRaw === "object") ? sessionRaw as Record<string, unknown> : undefined;
  logDebugEvent("compaction.trigger.shape", {
    hasClient: !!c,
    clientKeys: Object.keys(c),
    hasV2: !!v2,
    v2Keys: v2 ? Object.keys(v2) : [],
    hasV2Session: !!v2SessionObj,
    v2SessionKeys: v2SessionObj ? Object.keys(v2SessionObj) : [],
    hasV2Compact: isFn(v2SessionObj?.["compact"]),
    hasSession: !!sessionObj,
    sessionKeys: sessionObj ? Object.keys(sessionObj) : [],
    hasLegacyCompact: isFn(sessionObj?.["compact"]),
  });

  const internalClient = (c["_client"] ?? (c["session"] as Record<string, unknown> | undefined)?.["_client"]) as Record<string, unknown> | undefined;
  logDebugEvent("compaction.trigger.internal.shape", {
    hasTopLevel_client: !!c["_client"],
    topLevel_clientKeys: c["_client"] && typeof c["_client"] === "object" ? Object.keys(c["_client"] as object) : [],
    hasSession_client: !!((c["session"] as Record<string, unknown> | undefined)?.["_client"]),
    session_clientKeys: ((c["session"] as Record<string, unknown> | undefined)?.["_client"] && typeof (c["session"] as Record<string, unknown>)["_client"] === "object") ? Object.keys((c["session"] as Record<string, unknown>)["_client"] as object) : [],
    hasPost: isFn(internalClient?.["post"]),
    hasRequest: isFn(internalClient?.["request"]),
    hasFetch: isFn(internalClient?.["fetch"]),
  });

  const lastModel = getLastUserModel(sessionID);
  let providerID = lastModel.providerID;
  let modelID = lastModel.modelID;
  let source: "state" | "env" | "none" = "state";
  if (!providerID || !modelID) {
    providerID = process.env.CC_COMPACT_PROVIDER;
    modelID = process.env.CC_COMPACT_MODEL;
    source = providerID || modelID ? "env" : "none";
  }
  logDebugEvent("compaction.trigger.summarize.config", {
    source,
    provider: providerID ?? null,
    model: modelID ?? null,
  });

  // Kandidaten als async-Closures
  const candidates: Array<{ name: string; fn: () => Promise<boolean> }> = [
    // #0a summarize.via_internal.post — persistent server-side compaction via v1 summarize endpoint
    {
      name: "summarize.via_internal.post",
      fn: async () => {
        if (!internalClient) return false;
        const post = internalClient["post"];
        if (!isFn(post)) return false;
        if (!providerID || !modelID) return false;
        return tryCall("summarize.via_internal.post", async () => {
          const result = await (post as AnyFn).call(internalClient, {
            url: `/session/{id}/summarize`,
            path: { id: sessionID },
            body: { providerID, modelID, auto: true },
          });
          if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
            throw new Error(`Hey-API error: ${JSON.stringify((result as { error?: unknown }).error)}`);
          }
        });
      },
    },
    // #0b summarize.via_internal.post.legacy — raw absolute path
    {
      name: "summarize.via_internal.post.legacy",
      fn: async () => {
        if (!internalClient) return false;
        const post = internalClient["post"];
        if (!isFn(post)) return false;
        if (!providerID || !modelID) return false;
        return tryCall("summarize.via_internal.post.legacy", async () => {
          const result = await (post as AnyFn).call(internalClient, {
            url: `/api/session/${encodeURIComponent(sessionID)}/summarize`,
            body: { providerID, modelID, auto: true },
          });
          if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
            throw new Error(`Hey-API error: ${JSON.stringify((result as { error?: unknown }).error)}`);
          }
        });
      },
    },
    // #0c internal._client.post — Hey-API client with URL template + path params
    {
      name: "internal._client.post",
      fn: async () => {
        if (!internalClient) return false;
        const post = internalClient["post"];
        if (!isFn(post)) return false;
        // Hey-API client signature: post({ url, body?, ... }) returns { data, error, response }
        return tryCall("internal._client.post", async () => {
          const result = await (post as AnyFn).call(internalClient, {
            url: `/session/{sessionID}/compact`,
            path: { sessionID },
          });
          // Check for error in Hey-API response shape
          if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
            throw new Error(`Hey-API error: ${JSON.stringify((result as { error?: unknown }).error)}`);
          }
        });
      },
    },
    // #0d internal._client.post.legacy — raw absolute path
    {
      name: "internal._client.post.legacy",
      fn: async () => {
        if (!internalClient) return false;
        const post = internalClient["post"];
        if (!isFn(post)) return false;
        return tryCall("internal._client.post.legacy", async () => {
          const result = await (post as AnyFn).call(internalClient, {
            url: `/api/session/${encodeURIComponent(sessionID)}/compact`,
          });
          if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
            throw new Error(`Hey-API error: ${JSON.stringify((result as { error?: unknown }).error)}`);
          }
        });
      },
    },
    // #1 client.v2.session.compact({ sessionID }) — primary SDK path
    {
      name: "v2.session.compact",
      fn: async () => {
        const v2 = c["v2"] as Record<string, unknown> | undefined;
        const compact = (v2?.["session"] as Record<string, unknown> | undefined)?.["compact"];
        if (!isFn(compact)) return false;
        const parent = v2?.["session"] as Record<string, unknown> | undefined;
        return tryCall("v2.session.compact", compact.bind(parent), { sessionID });
      },
    },
    // #2 client.session.compact({ sessionID }) — legacy fallback
    {
      name: "session.compact",
      fn: async () => {
        const compact = (c["session"] as Record<string, unknown> | undefined)?.["compact"];
        if (!isFn(compact)) return false;
        return tryCall("session.compact", compact.bind(c["session"]), { sessionID });
      },
    },
  ];

  for (const { name, fn } of candidates) {
    try {
      const ok = await fn();
      logDebugEvent("compaction.trigger.candidate", { name, ok });
      if (ok) { startCompactionCooldown(sessionID, 3); return true; }
    } catch {
      logDebugEvent("compaction.trigger.candidate", { name, ok: false });
      // weiter
    }
  }

  // HTTP-Fallback: POST /api/session/{sessionID}/compact via fetch (Bun built-in)
  // Disabled by default in TUI mode (no TCP listener). Enable via CC_ENABLE_HTTP_FALLBACK=true
  if (process.env.CC_ENABLE_HTTP_FALLBACK !== "true") {
    logDebugEvent("compaction.trigger.http.disabled", { reason: "CC_ENABLE_HTTP_FALLBACK not set" });
  } else if (serverUrl) {
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/compact`;
      const response = await fetch(url, { method: "POST" });
      logDebugEvent("compaction.trigger.http", {
        url,
        status: response.status,
        ok: response.ok,
      });
      if (response.ok) { startCompactionCooldown(sessionID, 3); return true; }
    } catch (e) {
      logDebugEvent("compaction.trigger.http.error", {
        url: `${serverUrl.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/compact`,
        err: String(e),
      });
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

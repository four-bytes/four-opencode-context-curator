import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipelineWithSources } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";
import { createCompactionInstruction } from "./compaction/signal-injector.js";
import { parseCompactionSignal, stripCompactionSignal } from "./compaction/signal-parser.js";
import { applyPruning } from "./compaction/pruning-engine.js";
import { getCompactionState, clearSignal, clearTransformState, setLastSignal, setLastUserModel, setLastTokenEstimate, setLastAgent, getLastAgent, getCompactionCooldownRemaining, setCompactionCooldown, setCompactingActive, decrementCompactionCooldown, incrementTurnsSinceCompaction, resetTurnsSinceCompaction, getTurnsSinceCompaction, observeUserTurn, isInstructionSent, markInstructionSent } from "./compaction/state.js";
import { compactMessageHistory } from "./compaction/message-compactor.js";
import { estimateMessageTokens } from "./compaction/tokens.js";
import { loadPruningConfig, PruningConfigResolver, loadCompactionConfig, CompactionConfigResolver, applyCompactionEnvOverrides, type CompactionConfig } from "./compaction/config-resolver.js";
import { contextReportTool } from "./compaction/context-report.js";
import { logDebugEvent } from "./debug-logger.js";

/**
 * Curates system prompt context via layered cacheable prefixes.
 * Wave P4a (BIG WIN): 4 Cache-Layer + Compaction-Modul.
 */
export const FourContextCuratorPlugin: Plugin = async (ctx) => {
  // Startup log — once per plugin init (stderr, never stdout to protect LLM streams)
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
    let version = "unknown";
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      version = pkg.version ?? "unknown";
    } catch {}
    const ccDebug = process.env.CC_DEBUG ?? "unset";
    const pid = process.pid;
    process.stderr.write(`[four-opencode-context-curator] v${version} loaded (pid=${pid}, CC_DEBUG=${ccDebug})\n`);
    logDebugEvent("compaction.plugin.loaded", { version, pid, ccDebug });
  } catch {
    // never throw from startup log
  }

  const layers: Layer[] = [
    new RepoProfileLayer(),
    new TaskSliceLayer(),
    new IssueSliceLayer(),
  ];

  const hookCtx = createHookContext(DEFAULT_LAYERS, layers);
  const client = ctx.client; // Capture client for summarize() call

  // Per-agent pruning config (opencode.json / opencode.jsonc → context_curator.pruning).
  const directory = (ctx as { directory?: string }).directory;
  const configResolver = new PruningConfigResolver(loadPruningConfig(directory), (agent) => {
    logDebugEvent("pruning.config.unknown_agent", { agent });
  });
  const compactionConfigResolver = new CompactionConfigResolver(loadCompactionConfig(directory));

  // Child/subagent sessions carry a non-null `parentID` (opencode creates them
  // with `parentID: context.sessionID`). Native compaction kills the child, so
  // summarize may only run for the ROOT session. The transform input is `{}`
  // and message info exposes only `sessionID` (no parent pointer), so we
  // resolve it once per session via `session.get` and cache the result —
  // `parentID` never changes for a session.
  const childSessionCache = new Map<string, boolean>();

  async function isChildSession(realSessionID: string): Promise<boolean> {
    // No resolvable session id → leave existing (root) behaviour untouched.
    if (!realSessionID || realSessionID === "unknown" || realSessionID === "default") {
      return false;
    }
    const cached = childSessionCache.get(realSessionID);
    if (cached !== undefined) return cached;
    try {
      // `throwOnError` makes HTTP failures throw instead of returning them in
      // `res.error`, so a failed lookup lands in the catch below and is never
      // cached as "root". This SDK's generated method takes a single options
      // object (see `OpencodeClient#session.get`), not a second options arg.
      const res = await client.session.get({
        path: { id: realSessionID },
        query: { directory: process.cwd() },
        throwOnError: true,
      });
      const parentID = (res as { data?: { parentID?: string | null } }).data?.parentID;
      const isChild = typeof parentID === "string" && parentID.length > 0;
      childSessionCache.set(realSessionID, isChild);
      return isChild;
    } catch (err) {
      // Unknown target → preserve existing behaviour rather than block the
      // root session. Not cached, so a later lookup can still succeed.
      logDebugEvent("compaction.summarize.parent_lookup_error", {
        sessionID: realSessionID,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Trigger native opencode session compaction (same as /compact slash command).
   * Uses provider/model from the last user message for the summarization agent.
   */
  async function triggerNativeCompaction(
    realSessionID: string,
    stateSessionID: string,
    cooldownTurns: number,
  ): Promise<void> {
    // Never compact a child/subagent session — native summarize would kill it.
    if (await isChildSession(realSessionID)) {
      logDebugEvent("compaction.summarize.skipped_child", { sessionID: realSessionID });
      return;
    }
    // Provider/model and cooldown use the plugin's state key (messages.transform
    // receives an empty input object, so state is keyed independently of the
    // real session id).
    const userModel = getCompactionState(stateSessionID).lastUserModel;
    logDebugEvent("compaction.summarize.triggered", {
      sessionID: realSessionID,
      stateSessionID,
      providerID: userModel.providerID,
      modelID: userModel.modelID,
      cooldownTurns,
    });
    // Set BEFORE the request: the summarizer's own LLM request re-enters
    // messages.transform while this promise is still pending. Without this
    // flag that re-entry sees no cooldown and starts a second summarize.
    setCompactingActive(realSessionID, true);
    try {
      // Generated SDK signature: summarize(options) — one options object.
      // `throwOnError` belongs INSIDE it; a second argument is silently ignored.
      const body =
        userModel.providerID && userModel.modelID
          ? { providerID: userModel.providerID, modelID: userModel.modelID }
          : undefined;
      await client.session.summarize({
        path: { id: realSessionID },
        query: { directory: process.cwd() },
        body,
        throwOnError: true,
      });
      setCompactionCooldown(stateSessionID, cooldownTurns);
      logDebugEvent("compaction.summarize.completed", {
        sessionID: realSessionID,
        stateSessionID,
        cooldown: cooldownTurns,
      });
    } catch (err) {
      const msg = `\x1b[31m[four-opencode-context-curator] ❌ compaction request failed (session=${realSessionID}): ${String(err)}\x1b[0m`;
      process.stderr.write(msg + "\n");
      logDebugEvent("compaction.summarize.error", {
        error: String(err),
        sessionID: realSessionID,
      });
    } finally {
      setCompactingActive(realSessionID, false);
    }
  }

  /**
   * A trigger is blocked while a summarize is in flight or the cooldown runs.
   * The transform input's session id may be "default"/"unknown" (opencode
   * passes an empty input object), while state is keyed by the real session id
   * taken from the messages — so both keys must be checked.
   */
  function isCompactionBlocked(stateKey: string, realSessionID: string): boolean {
    return (
      getCompactionState(stateKey).compactingActive ||
      getCompactionState(realSessionID).compactingActive ||
      getCompactionCooldownRemaining(stateKey) > 0 ||
      getCompactionCooldownRemaining(realSessionID) > 0
    );
  }

  return {
    tool: {
      context_report: contextReportTool,
    },
    "experimental.chat.system.transform": async (_input, output) => {
      const sessionID = (_input as any)?.sessionID ?? "default";
      const agent = getLastAgent(sessionID);
      const resolved = configResolver.resolve(agent);
      const layerContents = await runLayerPipelineWithSources(hookCtx);
      logDebugEvent("compaction.system.transform", { layerCount: layerContents.length, agent });

      if (layerContents.length > 0) {
        const sanitized = layerContents.map((lc) => sanitizeLayerContent(lc.content));
        const sources = layerContents.map((lc) => lc.source ?? lc.id);
        const pruned = applyPruning(sanitized, { ...resolved, sessionID, agent: agent ?? undefined }, sources);
        const prefix = pruned.contents.join("\n\n");
        output.system.push(prefix);
      }

      if (!isInstructionSent(sessionID)) {
        output.system.push(createCompactionInstruction(sessionID));
        markInstructionSent(sessionID);
      }
    },
    "experimental.session.compacting": async (input, output) => {
      const sessionID = (input as any)?.sessionID ?? "default";
      try {
        const state = getCompactionState(sessionID);
        const signal = state.lastSignal;

        logDebugEvent("compaction.compacting", {
          advice: signal?.advice ?? "none",
        });

        if (signal?.advice === "no_compact") return;

        const lines: string[] = [
          "Compacting session. Preserve: active task, user instructions, decisions, actionable errors, recent 5 turns.",
          "Condense: completed issues. Truncate: long tool logs, never assistant instructions.",
        ];
        if (signal) {
          lines.push(`Signal: ${signal.advice}`);
        }
        output.prompt = lines.join("\n");
      } catch {
        // Non-blocking
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = (_input as any)?.sessionID ?? "default";
      try {
        logDebugEvent("compaction.messages.transform", { messageCount: output.messages.length });

        // Track the current agent from message info (each message carries info.agent).
        // Most recent non-empty agent wins; system.transform resolves config from it.
        let lastAgent: string | null = null;
        for (let i = output.messages.length - 1; i >= 0; i--) {
          const info = (output.messages[i] as { info?: { agent?: unknown } }).info;
          if (info && typeof info.agent === "string" && info.agent.trim().length > 0) {
            lastAgent = info.agent;
            break;
          }
        }
        if (lastAgent !== null) {
          setLastAgent(sessionID, lastAgent);
        }

        const msgs = output.messages as Array<{
          info?: { role?: string; sessionID?: string; id?: string };
          parts?: Array<{ type: string; text?: string }>;
        }>;

        // Compaction thresholds/cooldown: agent config → default → env overrides.
        const compactionSettings: CompactionConfig = applyCompactionEnvOverrides(
          compactionConfigResolver.resolve(lastAgent ?? getLastAgent(sessionID)),
        );

        // messages.transform runs multiple times per user turn (tool loops).
        // Only a new user message advances the turn counter and the cooldown.
        if (observeUserTurn(sessionID, msgs)) {
          decrementCompactionCooldown(sessionID);
          incrementTurnsSinceCompaction(sessionID);
        }

        // Derive provider/model from last user message for summarize candidate
        let lastUserMsg: (typeof output.messages)[number] | undefined;
        for (let i = output.messages.length - 1; i >= 0; i--) {
          const m = output.messages[i] as { info?: { role?: string } };
          if (m.info?.role === "user") {
            lastUserMsg = output.messages[i];
            break;
          }
        }
        if (lastUserMsg) {
          const info = (lastUserMsg as { info?: Record<string, unknown> }).info;
          if (info) {
            let providerID: string | undefined;
            let modelID: string | undefined;
            let path: string | undefined;
            if (typeof info.providerID === "string" && typeof info.modelID === "string") {
              providerID = info.providerID;
              modelID = info.modelID;
              path = "info";
            } else if (
              typeof info.agent === "object" &&
              info.agent !== null &&
              typeof (info.agent as Record<string, unknown>).providerID === "string" &&
              typeof (info.agent as Record<string, unknown>).modelID === "string"
            ) {
              providerID = (info.agent as Record<string, unknown>).providerID as string;
              modelID = (info.agent as Record<string, unknown>).modelID as string;
              path = "info.agent";
            } else if (
              typeof info.model === "object" &&
              info.model !== null &&
              typeof (info.model as Record<string, unknown>).providerID === "string" &&
              typeof (info.model as Record<string, unknown>).modelID === "string"
            ) {
              providerID = (info.model as Record<string, unknown>).providerID as string;
              modelID = (info.model as Record<string, unknown>).modelID as string;
              path = "info.model";
            }
            if (path) {
              setLastUserModel(sessionID, providerID, modelID);
              logDebugEvent("compaction.user_model.updated", { providerID, modelID, path });
            } else {
              logDebugEvent("compaction.user_model.shape_unknown", { keys: Object.keys(info) });
            }
          }
        }

        // Parse compaction signal from LAST assistant message in history
        // (the LLM's previous response contains compaction_advice at the end)
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.info?.role !== "assistant") continue;
          if (!Array.isArray(m.parts)) continue;
          for (const part of m.parts) {
            if (part.type !== "text" || !part.text) continue;
            const signal = parseCompactionSignal(part.text);
            if (signal) {
              setLastSignal(sessionID, signal);
              logDebugEvent("compaction.signal.parsed", { advice: signal.advice, reason: signal.reason, sessionID });

              // Trigger native session compaction on compact_now — same as /compact slash command.
              // Guard: 3-turns cooldown prevents double-trigger during nested compaction flows.
              // Extract sessionID from messages (every message carries session's ID)
              const signalMsg = msgs.find(m => m.info?.sessionID);
              const realSessionID = signalMsg?.info?.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "unknown";
              const inCooldown = isCompactionBlocked(sessionID, realSessionID);
              if (signal.advice === "compact_now" && !inCooldown) {
                await triggerNativeCompaction(realSessionID, sessionID, compactionSettings.cooldownTurns);
                resetTurnsSinceCompaction(sessionID);
                clearSignal(sessionID); // skip plugin compaction — native summarize handles it
              } else if (signal.advice === "compact_now" && inCooldown) {
                logDebugEvent("compaction.summarize.cooldown_skipped", {
                  sessionID: realSessionID,
                  cooldownRemaining: Math.max(
                    getCompactionCooldownRemaining(sessionID),
                    getCompactionCooldownRemaining(realSessionID),
                  ),
                  compactingActive:
                    getCompactionState(sessionID).compactingActive ||
                    getCompactionState(realSessionID).compactingActive,
                });
                clearSignal(sessionID); // still clear to avoid plugin compaction
              }
              break;
            }
          }
          break; // Only process the most recent assistant message
        }

        compactMessageHistory(
          output.messages as Array<{
            info: { role?: string };
            parts: Array<{ type: string; text?: string }>;
          }>,
          sessionID,
          lastAgent ?? undefined,
        );

        // Estimate total tokens after compaction
        let totalTokens = 0;
        for (const m of output.messages) {
          totalTokens += estimateMessageTokens(m);
        }
        setLastTokenEstimate(sessionID, totalTokens);
        logDebugEvent("compaction.tokens.estimated", { totalTokens, messageCount: output.messages.length });

        // Auto-trigger: token threshold AND user-turn threshold (configurable).
        const turnsSince = getTurnsSinceCompaction(sessionID);
        const signalMsg2 = msgs.find(m => m.info?.sessionID);
        const realSid2 = signalMsg2?.info?.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "unknown";
        const inCooldown = isCompactionBlocked(sessionID, realSid2);

        if (
          totalTokens > compactionSettings.autoTokenThreshold &&
          turnsSince >= compactionSettings.autoTurnThreshold &&
          !inCooldown
        ) {
          logDebugEvent("compaction.auto_trigger", {
            totalTokens,
            turnsSince,
            autoTokenThreshold: compactionSettings.autoTokenThreshold,
            autoTurnThreshold: compactionSettings.autoTurnThreshold,
            sessionID: realSid2,
          });
          await triggerNativeCompaction(realSid2, sessionID, compactionSettings.cooldownTurns);
          resetTurnsSinceCompaction(sessionID);
        }

        // Strip compaction_signal from visible output
        for (let msgIdx = 0; msgIdx < output.messages.length; msgIdx++) {
          const m = output.messages[msgIdx] as {
            info?: { role?: string };
            parts?: Array<{ type: string; text?: string }>;
          };
          if (!Array.isArray(m.parts)) continue;
          for (const part of m.parts) {
            if (part.type === "text" && typeof part.text === "string") {
              part.text = stripCompactionSignal(part.text);
            }
          }
          // Guard: assistant message must not be empty after stripping
          const role = m.info?.role;
          const hasNonEmptyText = m.parts.some(
            (p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0,
          );
          const hasToolCall = m.parts.some((p) => p.type === "tool-call" || p.type === "tool_call");
          if (role === "assistant" && !hasNonEmptyText && !hasToolCall) {
            const state = getCompactionState(sessionID);
            const reason = state.lastSignal?.reason ?? "";
            m.parts.push({ type: "text", text: reason ? `\u2026 [compacted: ${reason}]` : "\u2026 [compacted]" });
            logDebugEvent("compaction.guard.placeholder_injected", { partCount: m.parts.length });
          }
        }

        // Clear signal and transform state after all have consumed it
        clearSignal(sessionID);
        clearTransformState(sessionID);
      } catch {
        // Non-blocking
      }
    },
  };
};

export default FourContextCuratorPlugin;

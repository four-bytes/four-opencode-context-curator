import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipeline } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";
import { createCompactionInstruction } from "./compaction/signal-injector.js";
import { parseCompactionSignal, stripCompactionSignal } from "./compaction/signal-parser.js";
import { applyPruning } from "./compaction/pruning-engine.js";
import { getCompactionState, clearSignal, clearTransformState, setLastSignal, setLastUserModel, setLastTokenEstimate, getCompactionCooldownRemaining, setCompactionCooldown, decrementCompactionCooldown, incrementTurnsSinceCompaction, resetTurnsSinceCompaction, getTurnsSinceCompaction, isInstructionSent, markInstructionSent } from "./compaction/state.js";
import { compactMessageHistory } from "./compaction/message-compactor.js";
import { estimateMessageTokens } from "./compaction/tokens.js";
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

  /**
   * Trigger native opencode session compaction (same as /compact slash command).
   * Uses provider/model from the last user message for the summarization agent.
   */
  async function triggerNativeCompaction(realSessionID: string): Promise<void> {
    const userModel = getCompactionState(realSessionID).lastUserModel;
    logDebugEvent("compaction.summarize.triggered", {
      sessionID: realSessionID,
      providerID: userModel.providerID,
      modelID: userModel.modelID,
    });
    try {
      await (client.session.summarize as any)(
        {
          path: { id: realSessionID },
          query: { directory: process.cwd() },
          body: {
            ...(userModel.providerID ? { providerID: userModel.providerID } : {}),
            ...(userModel.modelID ? { modelID: userModel.modelID } : {}),
          },
        },
        { throwOnError: true },
      );
      setCompactionCooldown(realSessionID, 3);
      logDebugEvent("compaction.summarize.completed", {
        sessionID: realSessionID,
        cooldown: 3,
      });
    } catch (err) {
      const msg = `\x1b[31m[four-opencode-context-curator] ❌ compaction request failed (session=${realSessionID}): ${String(err)}\x1b[0m`;
      process.stderr.write(msg + "\n");
      logDebugEvent("compaction.summarize.error", {
        error: String(err),
        sessionID: realSessionID,
      });
    }
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const sessionID = (_input as any)?.sessionID ?? "default";
      const layerContents = await runLayerPipeline(hookCtx);
      logDebugEvent("compaction.system.transform", { layerCount: layerContents.length });

      if (layerContents.length > 0) {
        const sanitized = layerContents.map(sanitizeLayerContent);
        const pruned = applyPruning(sanitized, { sessionID });
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
          "Compacting session. Preserve: active task, user instructions, recent 5 turns.",
          "Condense: completed issues. Truncate: >50-line tool logs.",
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
        const msgs = output.messages as Array<{
          info?: { role?: string; sessionID?: string };
          parts?: Array<{ type: string; text?: string }>;
        }>;
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
              const inCooldown = (getCompactionState(sessionID).compactingActive) ||
                ((getCompactionCooldownRemaining(sessionID) > 0));
              if (signal.advice === "compact_now" && !inCooldown) {
                await triggerNativeCompaction(realSessionID);
                clearSignal(sessionID); // skip plugin compaction — native summarize handles it
              } else if (signal.advice === "compact_now" && inCooldown) {
                logDebugEvent("compaction.summarize.cooldown_skipped", {
                  sessionID: realSessionID,
                  cooldownRemaining: getCompactionCooldownRemaining(sessionID),
                  compactingActive: getCompactionState(sessionID).compactingActive,
                });
                clearSignal(sessionID); // still clear to avoid plugin compaction
              }
              break;
            }
          }
          break; // Only process the most recent assistant message
        }

        // Decrement turns-based compaction cooldown each messages.transform
        decrementCompactionCooldown(sessionID);
        incrementTurnsSinceCompaction(sessionID);

        compactMessageHistory(
          output.messages as Array<{
            info: { role?: string };
            parts: Array<{ type: string; text?: string }>;
          }>,
          sessionID,
        );

        // Estimate total tokens after compaction
        let totalTokens = 0;
        for (const m of output.messages) {
          totalTokens += estimateMessageTokens(m);
        }
        setLastTokenEstimate(sessionID, totalTokens);
        logDebugEvent("compaction.tokens.estimated", { totalTokens, messageCount: output.messages.length });

        // Auto-trigger: tokens > 50k AND 3+ turns since last compaction → compact_now
        const AUTO_TOKEN_THRESHOLD = 50000;
        const AUTO_TURN_THRESHOLD = 3;
        const turnsSince = getTurnsSinceCompaction(sessionID);
        const inCooldown = getCompactionState(sessionID).compactingActive || (getCompactionCooldownRemaining(sessionID) > 0);

        if (totalTokens > AUTO_TOKEN_THRESHOLD && turnsSince >= AUTO_TURN_THRESHOLD && !inCooldown) {
          const signalMsg2 = msgs.find(m => m.info?.sessionID);
          const realSid2 = signalMsg2?.info?.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "unknown";
          logDebugEvent("compaction.auto_trigger", { totalTokens, turnsSince, sessionID: realSid2 });
          await triggerNativeCompaction(realSid2);
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

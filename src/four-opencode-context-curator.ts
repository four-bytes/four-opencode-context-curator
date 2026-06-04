import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipeline } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { CorePrefixLayer } from "./layers/core-prefix.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";
import { createCompactionInstruction } from "./compaction/signal-injector.js";
import { parseCompactionSignal, stripCompactionSignal } from "./compaction/signal-parser.js";
import { applyPruning } from "./compaction/pruning-engine.js";
import { getCompactionState, clearSignal, clearTransformState, setLastSignal, setLastUserModel, setLastTokenEstimate, getLastTokenEstimate, isInCompactionCooldown, decrementCompactionCooldown } from "./compaction/state.js";
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
    new CorePrefixLayer(),
    new RepoProfileLayer(),
    new TaskSliceLayer(),
    new IssueSliceLayer(),
  ];

  const hookCtx = createHookContext(DEFAULT_LAYERS, layers);
  const client = ctx.client; // Capture client for summarize() call

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const sessionID = (_input as any)?.sessionID ?? "default";
      const layerContents = await runLayerPipeline(hookCtx);
      logDebugEvent("compaction.system.transform", { layerCount: layerContents.length });

      if (layerContents.length > 0) {
        const sanitized = layerContents.map(sanitizeLayerContent);
        const pruned = applyPruning(sanitized, { sessionID });
        const prefix = [
          "── CONTEXT CURATOR (Layered Cacheable Prefixes) ──",
          ...pruned.contents,
        ].join("\n\n");
        output.system.push(prefix);
      }

      output.system.push(createCompactionInstruction(sessionID));
    },
    "experimental.session.compacting": async (input, output) => {
      try {
        const sessionID = (input as any)?.sessionID ?? "default";
        const state = getCompactionState(sessionID);
        const signal = state.lastSignal;
        const triggered = process.env.CC_COMPACTION_TRIGGER === "true";

        process.env.CC_COMPACTION_TRIGGER = "true";

        logDebugEvent("compaction.compacting", {
          triggered: true,
          advice: signal?.advice ?? "none",
        });

        if (!triggered && (!signal || signal.advice === "no_compact")) {
          return;
        }

        if (signal && signal.safeToCompact.length > 0) {
          output.context.push(
            `Compaction advice: ${signal.advice} — ${signal.reason}`,
            `Safe to compact: ${signal.safeToCompact.join(", ")}`,
          );
        }

        if (triggered || signal?.advice === "compact_now") {
          const lines: string[] = [
            "You are compacting an AI coding assistant session.",
            "PRIORITY ORDER (preserve first, condense later):",
            "1. Active task context and current issue details — KEEP INTACT",
            "2. User instructions and architectural decisions — KEEP INTACT",
            "3. Recent tool outputs (last 5 turns) — KEEP",
            "4. Completed issue resolutions — CONDENSE to 1-line summary",
            "5. Duplicate tool outputs — REMOVE, reference first occurrence",
            "6. Tool logs >50 lines — TRUNCATE to header+footer",
          ];
          if (signal) {
            lines.push(`Signal: ${signal.advice} — ${signal.reason}`);
          }
          if (signal?.safeToCompact.length) {
            lines.push(`Completed blocks: ${signal.safeToCompact.join(", ")}`);
          }
          output.prompt = lines.join("\n");
        }
      } catch {
        // Non-blocking
      } finally {
        // Clear signal after compaction has been processed
        clearSignal(sessionID);
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        const sessionID = (_input as any)?.sessionID ?? "default";
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
          info?: { role?: string };
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

              // Trigger native session compaction on compact_now
              if (signal.advice === "compact_now") {
                const userModel = getCompactionState(sessionID).lastUserModel;
                client.session.summarize({
                  sessionID,
                  directory: process.cwd(),
                  ...(userModel.providerID && userModel.modelID
                    ? { providerID: userModel.providerID, modelID: userModel.modelID }
                    : {}),
                }).then(() => {
                  logDebugEvent("compaction.summarize.completed", { sessionID });
                }).catch((err: unknown) => {
                  logDebugEvent("compaction.summarize.error", { error: String(err), sessionID });
                });
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
        );

        // Estimate total tokens after compaction
        let totalTokens = 0;
        for (const m of output.messages) {
          totalTokens += estimateMessageTokens(m);
        }
        setLastTokenEstimate(sessionID, totalTokens);
        logDebugEvent("compaction.tokens.estimated", { totalTokens, messageCount: output.messages.length });

        // Strip compaction_signal from visible output
        for (const msg of output.messages) {
          const m = msg as {
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
            m.parts.push({ type: "text", text: "\u2026" });
            logDebugEvent("compaction.guard.placeholder_injected", { partCount: m.parts.length });
          }
        }

        // Clear signal after both transforms have had their chance
        clearTransformState(sessionID);
      } catch {
        // Non-blocking
      } finally {
        // Clean up trigger flag after both transforms have run
        delete process.env.CC_COMPACTION_TRIGGER;
      }
    },
  };
};

export default FourContextCuratorPlugin;

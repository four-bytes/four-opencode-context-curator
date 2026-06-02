import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipeline } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { CorePrefixLayer } from "./layers/core-prefix.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";
import { createCompactionInstruction } from "./compaction/signal-injector.js";
import { createCompactionSignalHook, stripCompactionSignal } from "./compaction/signal-parser.js";
import { applyPruning } from "./compaction/pruning-engine.js";
import { getCompactionState, clearSignal } from "./compaction/state.js";
import { compactMessageHistory } from "./compaction/message-compactor.js";
import { triggerCompaction } from "./compaction/trigger.js";
import { logDebugEvent } from "./debug-logger.js";

/**
 * Curates system prompt context via layered cacheable prefixes.
 * Wave P4a (BIG WIN): 4 Cache-Layer + Compaction-Modul.
 */
export const FourContextCuratorPlugin: Plugin = async (ctx) => {
  const layers: Layer[] = [
    new CorePrefixLayer(),
    new RepoProfileLayer(),
    new TaskSliceLayer(),
    new IssueSliceLayer(),
  ];

  const hookCtx = createHookContext(DEFAULT_LAYERS, layers);

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const layerContents = await runLayerPipeline(hookCtx);
      logDebugEvent("compaction.system.transform", { layerCount: layerContents.length });

      if (layerContents.length > 0) {
        const sanitized = layerContents.map(sanitizeLayerContent);
        const pruned = applyPruning(sanitized);
        const prefix = [
          "── CONTEXT CURATOR (Layered Cacheable Prefixes) ──",
          ...pruned.contents,
        ].join("\n\n");
        output.system.push(prefix);
      }

      output.system.push(createCompactionInstruction());
    },
    event: createCompactionSignalHook((signal, sessionID) => {
      // Write diary entry for EVERY signal (fire-and-forget)
      try {
        (async () => {
          const { writeDiaryEntry } = await import("./compaction/diary.js");
          writeDiaryEntry({
            ts: Date.now(),
            advice: signal.advice,
            reason: signal.reason,
            blocksCondensed: signal.safeToCompact.length,
            duplicatesRemoved: 0,
            linesBefore: 0,
            linesAfter: 0,
            reductionPct: 0,
            sessionId: sessionID ?? "",
            triggered: signal.advice === "compact_now",
          });
        })().catch(() => {});
      } catch {}

      // Only trigger actual compaction for compact_now with a valid session
      if (signal.advice === "compact_now" && sessionID) {
        const sid = sessionID;
        const serverUrlStr = ctx.serverUrl?.toString();
        if (!serverUrlStr) {
          logDebugEvent("compaction.trigger.serverUrl.missing", {});
        } else {
          logDebugEvent("compaction.trigger.serverUrl.present", { serverUrl: serverUrlStr });
        }
        triggerCompaction(ctx.client, sid, serverUrlStr).then((found) => {
          logDebugEvent("compaction.trigger.invoked", { sessionID: sid, found });
        }).catch(() => {});

        logDebugEvent("compaction.signal", {
          advice: signal.advice,
          reason: signal.reason,
          safeToCompact: signal.safeToCompact,
          sessionID: sid,
        });
      }
    }),
    "experimental.session.compacting": async (input, output) => {
      try {
        const state = getCompactionState();
        const signal = state.lastSignal;
        const triggered = process.env.CC_COMPACTION_TRIGGER === "true";

        // Set trigger flag so subsequent transforms (system.transform, messages.transform)
        // will apply pruning. Don't clear here — transforms handle cleanup.
        process.env.CC_COMPACTION_TRIGGER = "true";

        logDebugEvent("compaction.compacting", {
          triggered: true,
          advice: signal?.advice ?? "none",
        });

        if (!triggered && (!signal || signal.advice === "no_compact")) {
          // Even for no_compact: keep CC_COMPACTION_TRIGGER set for generic pruning
          // (truncation + dedup) in transforms
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
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        logDebugEvent("compaction.messages.transform", { messageCount: output.messages.length });
        compactMessageHistory(
          output.messages as Array<{
            info: { role?: string };
            parts: Array<{ type: string; text?: string }>;
          }>,
        );

        // Strip compaction_signal from visible output
        for (const msg of output.messages) {
          const m = msg as { parts?: Array<{ type: string; text?: string }> };
          if (!Array.isArray(m.parts)) continue;
          for (const part of m.parts) {
            if (part.type === "text" && typeof part.text === "string") {
              part.text = stripCompactionSignal(part.text);
            }
          }
        }

        // Clear signal after both transforms have had their chance
        clearSignal();
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

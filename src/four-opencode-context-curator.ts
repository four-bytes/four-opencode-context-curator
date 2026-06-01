import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipeline } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { CorePrefixLayer } from "./layers/core-prefix.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";
import { createCompactionInstruction } from "./compaction/signal-injector.js";
import { createCompactionSignalHook } from "./compaction/signal-parser.js";
import { applyPruning } from "./compaction/pruning-engine.js";
import { getCompactionState } from "./compaction/state.js";
import { compactMessageHistory } from "./compaction/message-compactor.js";

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

  // Deferred compaction trigger (avoids deadlock in hook)
  let pendingCompaction: string | null = null;

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const layerContents = await runLayerPipeline(hookCtx);

      if (layerContents.length > 0) {
        const sanitized = layerContents.map(sanitizeLayerContent);
        const pruned = applyPruning(sanitized);
        const prefix = [
          "── CONTEXT CURATOR (Layered Cacheable Prefixes) ──",
          ...pruned.contents,
        ].join("\n\n");
        output.system.push(prefix);
      }

      // Inject compaction signal instruction (always)
      output.system.push(createCompactionInstruction());

      // Trigger deferred compaction after prompt assembly
      if (pendingCompaction) {
        const sid = pendingCompaction;
        pendingCompaction = null;
        // Defer to next tick to avoid blocking current prompt
        setTimeout(() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx.client as any).v2?.session
              ?.compact({ sessionID: sid })
              .then(() => {
                // eslint-disable-next-line no-console
                console.error(`[four-cc:compaction] opencode compact triggered for session ${sid}`);
              })
              .catch((err: unknown) => {
                // eslint-disable-next-line no-console
                console.error(`[four-cc:compaction] compact API call failed:`, err);
              });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[four-cc:compaction] compact trigger failed:`, err);
          }
        }, 50);
      }
    },
    "chat.message": createCompactionSignalHook((signal, sessionID) => {
      // When compact_now or compact_soon with blocks, queue compaction
      if (
        (signal.advice === "compact_now" || signal.advice === "compact_soon") &&
        signal.safeToCompact.length > 0
      ) {
        pendingCompaction = sessionID;
      }
    }),
    "experimental.session.compacting": async (input, output) => {
      try {
        const state = getCompactionState();
        const signal = state.lastSignal;
        const triggered = process.env.CC_COMPACTION_TRIGGER === "true";

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

        if (triggered) {
          delete process.env.CC_COMPACTION_TRIGGER;
        }

        // eslint-disable-next-line no-console
        console.error(
          `[four-cc:compaction] session.compacting: tbg=${triggered}, signal=${signal?.advice ?? "none"}`,
        );
      } catch {
        // Non-blocking
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        compactMessageHistory(
          output.messages as Array<{
            info: { role?: string };
            parts: Array<{ type: string; text?: string }>;
          }>,
        );
      } catch {
        // Non-blocking
      }
    },
  };
};

export default FourContextCuratorPlugin;

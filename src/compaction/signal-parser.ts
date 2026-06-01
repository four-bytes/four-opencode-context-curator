import { setLastSignal } from "./state.js";

export interface CompactionSignal {
  advice: "no_compact" | "compact_soon" | "compact_now";
  reason: string;
  safeToCompact: string[];
}

/**
 * Extracts text content from a message object ({ info, parts } shape).
 */
function extractText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;

  const msg = message as Record<string, unknown>;
  const parts = msg.parts;
  if (!Array.isArray(parts)) return null;

  return parts
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .filter(p => p.type === "text")
    .map(p => String(p.text ?? ""))
    .join("\n")
    .trim() || null;
}

export function parseCompactionSignal(text: string): CompactionSignal | null {
  const adviceMatch = text.match(/compaction_advice:\s*(no_compact|compact_soon|compact_now)/i);
  if (!adviceMatch) return null;

  const adviceRaw = adviceMatch[1].toLowerCase();
  if (adviceRaw !== "no_compact" && adviceRaw !== "compact_soon" && adviceRaw !== "compact_now") {
    return null;
  }
  const advice = adviceRaw as CompactionSignal["advice"];

  const reasonMatch = text.match(/reason:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : "";

  const safeMatch = text.match(/safe_to_compact:\s*(.+)/i);
  const safeToCompact = safeMatch
    ? safeMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return { advice, reason, safeToCompact };
}

export type CompactionHookHandler = (input: unknown, output: unknown) => Promise<void>;

export type CompactionSignalCallback = (signal: CompactionSignal) => void;

export function createCompactionSignalHook(onSignal?: CompactionSignalCallback): CompactionHookHandler {
  return async (input: unknown, output: unknown) => {
    try {
      const message = (input as { message?: unknown }).message;
      if (!message || typeof message !== "object") return;

      const info = (message as { info?: { role?: string } } | undefined)?.info;
      if (!info || info.role !== "assistant") return;

      const text = extractText(message);
      if (!text) return;

      const signal = parseCompactionSignal(text);
      if (signal) {
        setLastSignal(signal);

        // Notify caller (for proactive compaction trigger)
        if (onSignal) {
          onSignal(signal);
        }

        // Strip compaction signal from output parts (not user-visible)
        const outputObj = output as {
          parts?: Array<{ type: string; text?: string }>;
        };
        if (outputObj.parts) {
          for (const part of outputObj.parts) {
            if (part.type === "text" && part.text) {
              // Remove compaction_advice block from end of text
              part.text = part.text
                .replace(/\n*compaction_advice:.*[\s\S]*$/i, "")
                .trimEnd();
            }
          }
        }

        // eslint-disable-next-line no-console
        console.error(
          `[four-cc:compaction] SIGNAL: ${signal.advice} — ${signal.reason}${signal.safeToCompact.length ? ` (safe: ${signal.safeToCompact.join(", ")})` : ""}`,
        );
      }
    } catch {
      // Silent — never throw from hook
    }
  };
}

/** Strip compaction_advice block from text (for testing). */
export function stripCompactionSignal(text: string): string {
  return text.replace(/\n*compaction_advice:.*[\s\S]*$/i, "").trimEnd();
}

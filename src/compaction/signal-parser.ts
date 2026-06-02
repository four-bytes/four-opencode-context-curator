import { setLastSignal } from "./state.js";

export interface CompactionSignal {
  advice: "no_compact" | "compact_soon" | "compact_now";
  reason: string;
  safeToCompact: string[];
}

export function parseCompactionSignal(text: string): CompactionSignal | null {
  const adviceMatch = text.match(/compaction_advice:\s*(no_compact|compact_soon|compact_now)/i);
  if (!adviceMatch) return null;

const n = text.length;  // Guard: signal block must be at/near end of text (not mid-echo from file reads)
  if (adviceMatch.index !== undefined && adviceMatch.index < text.length - Math.max(300, Math.ceil(text.length * 0.2))) return null;
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

export type CompactionSignalCallback = (signal: CompactionSignal, sessionID: string) => void;

/**
 * Loose structural type matching the EventMessagePartUpdated shape
 * from @opencode-ai/sdk (transitive dep, not directly importable).
 */
interface TextPartPayload {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  [key: string]: unknown;
}

interface PartUpdatedEvent {
  type: "message.part.updated";
  properties: {
    sessionID: string;
    part: TextPartPayload;
    time: number;
  };
}

export function createCompactionSignalHook(onSignal?: CompactionSignalCallback) {
  return async (input: { event: { type: string; properties: Record<string, unknown> } }): Promise<void> => {
    try {
      const ev = input.event;
      if (ev.type !== "message.part.updated") return;

      const props = ev.properties as PartUpdatedEvent["properties"];
      const part = props.part;
      if (!part || part.type !== "text") return;

      const text = part.text;
      if (!text) return;

      const signal = parseCompactionSignal(text);
      if (!signal) return;

      setLastSignal(signal);
      const sid = props.sessionID || "";

      if (onSignal) {
        onSignal(signal, sid);
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

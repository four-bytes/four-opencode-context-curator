import { tool } from "@opencode-ai/plugin";
import { readDiaryEntries, type DiaryEntry } from "./diary.js";
import { getLastAgent, getTokenHistory } from "./state.js";

export interface ContextReportInput {
  sessionId: string;
  agent: string | null;
  entries: DiaryEntry[];
  tokenHistory: number[];
}

/** Humanize a count: 162000 → "162k", 1400 → "1.4k", 47 → "47". */
function humanize(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${sign}${rounded}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Least-squares slope (tokens/turn) over the provided series. */
function linearSlope(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  if (den === 0) return null;
  return num / den;
}

function formatTrend(slope: number): string {
  const prefix = slope >= 0 ? "+" : "";
  return `${prefix}${humanize(slope)}/turn`;
}

/**
 * Build the human-readable context report (≤10 lines).
 * Never throws.
 */
export function buildContextReport(input: ContextReportInput): string {
  const { sessionId, agent, entries, tokenHistory } = input;

  if (entries.length === 0) {
    return `No compaction diary for session ${sessionId}.`;
  }

  const shortId = sessionId.length > 4 ? `${sessionId.slice(0, 4)}…` : sessionId;
  const agentLabel = agent ?? "unknown";

  const turns = tokenHistory.length;

  let inputTurn: string;
  if (turns === 0) {
    inputTurn = "n/a";
  } else {
    const avg = tokenHistory.reduce((a, b) => a + b, 0) / turns;
    const max = tokenHistory.reduce((a, b) => Math.max(a, b), 0);
    const slope = linearSlope(tokenHistory.slice(-10));
    const trend = slope === null ? "n/a" : formatTrend(slope);
    inputTurn = `avg ${humanize(avg)} · max ${humanize(max)} · trend ${trend}`;
  }

  let totalPruned = 0;
  const byTool = new Map<string, number>();
  for (const entry of entries) {
    const pruned = Math.max(0, (entry.linesBefore ?? 0) - (entry.linesAfter ?? 0));
    totalPruned += pruned;
    const tool = entry.tool && entry.tool.length > 0 ? entry.tool : "other";
    byTool.set(tool, (byTool.get(tool) ?? 0) + pruned);
  }

  const lines: string[] = [
    `CONTEXT — session ${shortId}, agent ${agentLabel}`,
    `  turns          ${turns}`,
    `  input/turn     ${inputTurn}`,
    `  pruned         ${humanize(totalPruned)} lines total`,
  ];

  const top = [...byTool.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (top.length > 0 && totalPruned > 0) {
    const parts = top.map(([toolName, v]) => {
      const pct = Math.round((v / totalPruned) * 100);
      return `${toolName} ${pct}%`;
    });
    lines.push(`  top sources    ${parts.join(" · ")}`);
  }

  return lines.slice(0, 10).join("\n");
}

export const contextReportTool = tool({
  description:
    "Report context compaction stats for a session (turns, input/turn trend, pruned lines, top pruned sources). Read-only, under 10 lines.",

  args: {
    session: tool.schema
      .string()
      .optional()
      .describe("Session ID (defaults to the current session)"),
  },

  async execute(args, ctx) {
    const sessionId =
      ctx.sessionID ??
      (args.session as string | undefined) ??
      process.env.OPENDOC_SESSION_ID ??
      "unknown";

    const agent = getLastAgent(sessionId) ??
      (typeof ctx.agent === "string" && ctx.agent.length > 0 ? ctx.agent : null);

    const entries = readDiaryEntries(sessionId);
    const tokenHistory = getTokenHistory(sessionId);

    return {
      title: "Context report",
      output: buildContextReport({ sessionId, agent, entries, tokenHistory }),
    };
  },
});

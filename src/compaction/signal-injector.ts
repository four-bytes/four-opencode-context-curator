import { isInCompactionCooldown, getCompactionCooldownRemaining } from "./state.js";

export function createCompactionInstruction(sessionID: string = "default"): string {
  const base = `── COMPACTION SIGNAL ──

After completing a major work phase (issue done, research block finished, debug session closed), evaluate whether the session context would benefit from compaction. Output EXACTLY ONE of these signals at the end of your response:

compaction_advice: no_compact
reason: <one sentence why>

compaction_advice: compact_soon
reason: <one sentence why>

compaction_advice: compact_now
reason: <one sentence why>
safe_to_compact: <comma-separated list of completed blocks>

RULES:
- compact_now: only when completed work blocks, repeated logs, or dead side-paths dominate the context AND the current task is complete
- compact_soon: when context is growing but still manageable, compact after next task
- no_compact: during active debugging, open investigations, or when critical state is fragile
- NEVER signal compact_now during an open debug session
- safe_to_compact: list only completed/stale blocks (e.g. "issue_5_research, tool_logs_turn_10-20")`;

  if (isInCompactionCooldown(sessionID)) {
    return base + `\n\nCOMPACTION-COOLDOWN ACTIVE (${getCompactionCooldownRemaining(sessionID)} turns remaining): A compaction was just triggered. Output \`no_compact\` unless a substantial NEW work block completed in this turn.`;
  }
  return base;
}

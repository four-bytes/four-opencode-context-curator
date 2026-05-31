import type { Layer, LayerConfig, LayerContent } from "../layers.js";

export class CorePrefixLayer implements Layer {
  config: LayerConfig;

  constructor() {
    this.config = {
      id: "core_prefix",
      order: 1,
      enabled: true,
    };
  }

  async generate(): Promise<LayerContent> {
    const now = Date.now();

    const content = [
      "GLOBAL RULES (stable — never changes per session)",
      "",
      "## Stop-Mode for Agents",
      "- Max 15 Tool-Calls (mini: 8)",
      "- Same tool >2× → STOP",
      "- Same file >3× edit → STOP",
      "- 5 calls without diff → STOP",
      "- When spec unclear → SCOPE-PROPOSAL block, never improvise",
      "",
      "## Search Discipline",
      "- Default = rag_search. grep/glob only as fallback.",
      "- rag_search for multi-file discovery, symbol lookup, pattern search",
      "- grep only when rag_search 0 results OR exact filename known",
      "- Never rag_search + grep in parallel for same query",
      "- read 3+ times in one turn → delegate to @reader",
      "",
      "## Quality Gates (for Reviewer)",
      "Hard Gates: Tests green, Security clean, Lint/Types clean",
      "Soft Score: ≥90% Auto-Merge, 70-89% User-Freigabe, <70% Nachbesserung",
      "",
      "## Minimal Output (HARD)",
      "/complete: 2 lines max",
      "Subagents: 3 lines max — file path(s) + line(s) + ✅/❌",
      "Architect summary after subagent: 1 sentence max",
      "",
      `Source: ~/.personal-config/ai-shared/AGENTS.md`,
    ].join("\n");

    return {
      content,
      updatedAt: now,
      source: "~/.personal-config/ai-shared/AGENTS.md",
    };
  }
}

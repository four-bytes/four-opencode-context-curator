import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG, type PruningConfig } from "./pruning-engine.js";

export type AgentPruningConfig = Partial<PruningConfig>;
export type PruningConfigMap = Record<string, AgentPruningConfig>;

/**
 * Strip JSONC comments (// line and /* block) without touching string literals.
 * Keeps everything else intact so JSON.parse can run afterwards.
 */
export function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        result += ch;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        result += ch + (next ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

/**
 * Numeric pruning fields that may come from JSON. Non-numeric / negative values
 * are silently ignored so they can never produce NaN truncation at runtime.
 */
const NUMERIC_KEYS = ["maxToolLogLines", "headerLines", "footerLines", "minCompletedBlocks"] as const;

function sanitizeAgentConfig(value: unknown): AgentPruningConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const out: AgentPruningConfig = {};
  for (const key of NUMERIC_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Parse a JSONC string into a per-agent pruning config map.
 * Returns null on any failure (malformed JSON, missing context_curator.pruning, etc.).
 */
export function parsePruningConfig(raw: string): PruningConfigMap | null {
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cc = (parsed as Record<string, unknown>).context_curator;
    if (!cc || typeof cc !== "object" || Array.isArray(cc)) return null;
    const pruning = (cc as Record<string, unknown>).pruning;
    if (!pruning || typeof pruning !== "object" || Array.isArray(pruning)) return null;

    const map: PruningConfigMap = {};
    for (const [key, value] of Object.entries(pruning as Record<string, unknown>)) {
      const sanitized = sanitizeAgentConfig(value);
      if (sanitized) {
        map[key] = sanitized;
      }
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Load per-agent pruning config from opencode.json (and opencode.jsonc if present)
 * in the project directory. Never throws — returns {} on any failure.
 */
export function loadPruningConfig(directory: string | undefined): PruningConfigMap {
  if (!directory) return {};
  const merged: PruningConfigMap = {};
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(directory, name), "utf-8");
    } catch {
      continue;
    }
    const parsed = parsePruningConfig(raw);
    if (parsed) Object.assign(merged, parsed);
  }
  return merged;
}

/**
 * Resolves a per-agent pruning config with the order:
 * agent entry → `default` entry → built-in DEFAULT_CONFIG.
 * Unknown agent names fall back silently and notify `onUnknownAgent` once per name.
 */
export class PruningConfigResolver {
  private readonly configs: PruningConfigMap;
  private readonly unknownAgents = new Set<string>();
  private readonly onUnknownAgent: (agent: string) => void;

  constructor(configs: PruningConfigMap, onUnknownAgent?: (agent: string) => void) {
    this.configs = configs;
    this.onUnknownAgent = onUnknownAgent ?? (() => {});
  }

  resolve(agent?: string | null): PruningConfig {
    if (
      agent &&
      agent !== "default" &&
      !Object.hasOwn(this.configs, agent) &&
      !this.unknownAgents.has(agent)
    ) {
      this.unknownAgents.add(agent);
      this.onUnknownAgent(agent);
    }

    const entry =
      agent && Object.hasOwn(this.configs, agent) ? this.configs[agent] : this.configs.default;
    return { ...DEFAULT_CONFIG, ...(entry ?? {}) };
  }
}

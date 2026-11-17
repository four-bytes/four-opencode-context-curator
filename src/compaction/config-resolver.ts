import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG, type PruningConfig } from "./pruning-engine.js";

export type AgentPruningConfig = Partial<PruningConfig>;
export type PruningConfigMap = Record<string, AgentPruningConfig>;

/**
 * Auto-compaction thresholds and cooldown. Resolution order is
 * agent entry → `default` entry → DEFAULT_COMPACTION_CONFIG, with optional
 * `CC_AUTO_TOKEN_THRESHOLD` / `CC_AUTO_TURN_THRESHOLD` /
 * `CC_COMPACTION_COOLDOWN_TURNS` env overrides on top.
 */
export interface CompactionConfig {
  /** Estimated token count above which native compaction may trigger. */
  autoTokenThreshold: number;
  /** User turns since the last compaction required before auto-triggering. */
  autoTurnThreshold: number;
  /** User turns to wait after a compaction before triggering again. */
  cooldownTurns: number;
}

export type AgentCompactionConfig = Partial<CompactionConfig>;
export type CompactionConfigMap = Record<string, AgentCompactionConfig>;

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  autoTokenThreshold: 50000,
  autoTurnThreshold: 3,
  cooldownTurns: 3,
};

const COMPACTION_NUMERIC_KEYS = [
  "autoTokenThreshold",
  "autoTurnThreshold",
  "cooldownTurns",
] as const;

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

function sanitizeCompactionAgentConfig(value: unknown): AgentCompactionConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const out: AgentCompactionConfig = {};
  for (const key of COMPACTION_NUMERIC_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Parse `context_curator.compaction` from a JSONC string into a per-agent map.
 * Returns null on any failure.
 */
export function parseCompactionConfig(raw: string): CompactionConfigMap | null {
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cc = (parsed as Record<string, unknown>).context_curator;
    if (!cc || typeof cc !== "object" || Array.isArray(cc)) return null;
    const compaction = (cc as Record<string, unknown>).compaction;
    if (!compaction || typeof compaction !== "object" || Array.isArray(compaction)) return null;

    const map: CompactionConfigMap = {};
    for (const [key, value] of Object.entries(compaction as Record<string, unknown>)) {
      const sanitized = sanitizeCompactionAgentConfig(value);
      if (sanitized) {
        map[key] = sanitized;
      }
    }
    return map;
  } catch {
    return null;
  }
}

/** Load `context_curator.compaction` from opencode.json / opencode.jsonc. Never throws. */
export function loadCompactionConfig(directory: string | undefined): CompactionConfigMap {
  if (!directory) return {};
  const merged: CompactionConfigMap = {};
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(directory, name), "utf-8");
    } catch {
      continue;
    }
    const parsed = parseCompactionConfig(raw);
    if (parsed) Object.assign(merged, parsed);
  }
  return merged;
}

/** Resolve compaction settings for an agent: agent → default → built-in defaults. */
export class CompactionConfigResolver {
  private readonly configs: CompactionConfigMap;

  constructor(configs: CompactionConfigMap) {
    this.configs = configs;
  }

  resolve(agent?: string | null): CompactionConfig {
    const entry =
      agent && Object.hasOwn(this.configs, agent) ? this.configs[agent] : this.configs.default;
    return { ...DEFAULT_COMPACTION_CONFIG, ...(entry ?? {}) };
  }
}

function envNonNegativeInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Apply env overrides (highest precedence). Pure — useful in tests. */
export function applyCompactionEnvOverrides(
  config: CompactionConfig,
  env: Record<string, string | undefined> = process.env,
): CompactionConfig {
  return {
    autoTokenThreshold: envNonNegativeInt(env, "CC_AUTO_TOKEN_THRESHOLD", config.autoTokenThreshold),
    autoTurnThreshold: envNonNegativeInt(env, "CC_AUTO_TURN_THRESHOLD", config.autoTurnThreshold),
    cooldownTurns: envNonNegativeInt(env, "CC_COMPACTION_COOLDOWN_TURNS", config.cooldownTurns),
  };
}

import { describe, it, expect } from "bun:test";
import {
  stripJsoncComments,
  stripTrailingCommas,
  parsePruningConfig,
  loadPruningConfig,
  PruningConfigResolver,
  parseCompactionConfig,
  loadCompactionConfig,
  CompactionConfigResolver,
  applyCompactionEnvOverrides,
  DEFAULT_COMPACTION_CONFIG,
  type PruningConfigMap,
} from "../src/compaction/config-resolver.js";
import { DEFAULT_CONFIG } from "../src/compaction/pruning-engine.js";

describe("stripJsoncComments", () => {
  it("strips line comments", () => {
    expect(stripJsoncComments('{"a": 1} // trailing\n')).toBe('{"a": 1} \n');
  });

  it("strips block comments", () => {
    expect(stripJsoncComments('{ /* block */ "a": 1 }')).toBe('{  "a": 1 }');
  });

  it("does not strip comment markers inside strings", () => {
    expect(stripJsoncComments('{"url": "http://example.com/*x*/"}')).toBe(
      '{"url": "http://example.com/*x*/"}',
    );
  });
});

describe("parsePruningConfig", () => {
  it("parses a valid context_curator.pruning shape", () => {
    const raw = JSON.stringify({
      context_curator: {
        pruning: {
          default: { maxToolLogLines: 40 },
          architect: { maxToolLogLines: 8, minCompletedBlocks: 2 },
          build: { maxToolLogLines: 8 },
        },
      },
    });
    const map = parsePruningConfig(raw);
    expect(map).not.toBeNull();
    expect(map!["architect"]).toEqual({ maxToolLogLines: 8, minCompletedBlocks: 2 });
    expect(map!["default"]).toEqual({ maxToolLogLines: 40 });
  });

  it("parses JSONC with comments", () => {
    const raw = `
    {
      // pruning config
      "context_curator": {
        "pruning": {
          /* agent overrides */
          "default": { "maxToolLogLines": 40 }
        }
      }
    }`;
    const map = parsePruningConfig(raw);
    expect(map).not.toBeNull();
    expect(map!["default"]).toEqual({ maxToolLogLines: 40 });
  });

  it("returns null for malformed JSON", () => {
    expect(parsePruningConfig("{ not json")).toBeNull();
  });

  it("returns null when context_curator.pruning is missing", () => {
    expect(parsePruningConfig('{"other": 1}')).toBeNull();
    expect(parsePruningConfig('{"context_curator": {"not_pruning": 1}}')).toBeNull();
  });

  it("ignores non-numeric pruning values", () => {
    const raw = JSON.stringify({
      context_curator: {
        pruning: {
          architect: { maxToolLogLines: "abc", minCompletedBlocks: 2 },
          build: { maxToolLogLines: -5 },
        },
      },
    });
    const map = parsePruningConfig(raw);
    expect(map).not.toBeNull();
    // "abc" is ignored; 2 is kept
    expect(map!["architect"]).toEqual({ minCompletedBlocks: 2 });
    // negative is ignored entirely
    expect(map!["build"]).toEqual({});
  });
});

describe("loadPruningConfig", () => {
  it("returns empty map for missing directory", () => {
    expect(loadPruningConfig(undefined)).toEqual({});
  });

  it("returns empty map when no config files exist", () => {
    expect(loadPruningConfig("/nonexistent/dir/for/cc-test")).toEqual({});
  });
});

describe("PruningConfigResolver.resolve", () => {
  const configs: PruningConfigMap = {
    default: { maxToolLogLines: 40 },
    architect: { maxToolLogLines: 8, minCompletedBlocks: 2 },
    build: { maxToolLogLines: 8 },
  };

  it("resolves agent entry first", () => {
    const resolver = new PruningConfigResolver(configs);
    expect(resolver.resolve("architect")).toEqual({
      ...DEFAULT_CONFIG,
      maxToolLogLines: 8,
      minCompletedBlocks: 2,
    });
  });

  it("falls back to default entry for unknown agent", () => {
    const resolver = new PruningConfigResolver(configs);
    expect(resolver.resolve("nonexistent-agent")).toEqual({
      ...DEFAULT_CONFIG,
      maxToolLogLines: 40,
    });
  });

  it("falls back to DEFAULT_CONFIG when no default entry", () => {
    const resolver = new PruningConfigResolver({ architect: { maxToolLogLines: 8 } });
    expect(resolver.resolve("build")).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to DEFAULT_CONFIG for null/undefined agent", () => {
    const resolver = new PruningConfigResolver({});
    expect(resolver.resolve(null)).toEqual(DEFAULT_CONFIG);
    expect(resolver.resolve(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it("notifies unknown agent exactly once per name", () => {
    const seen: string[] = [];
    const resolver = new PruningConfigResolver(configs, (agent) => seen.push(agent));
    resolver.resolve("mystery");
    resolver.resolve("mystery");
    resolver.resolve("mystery");
    resolver.resolve("other-mystery");
    expect(seen).toEqual(["mystery", "other-mystery"]);
  });
});

describe("parseCompactionConfig", () => {
  it("parses context_curator.compaction with per-agent entries", () => {
    const raw = JSON.stringify({
      context_curator: {
        compaction: {
          default: { autoTokenThreshold: 40000, cooldownTurns: 2 },
          architect: { autoTurnThreshold: 5 },
        },
      },
    });
    expect(parseCompactionConfig(raw)).toEqual({
      default: { autoTokenThreshold: 40000, cooldownTurns: 2 },
      architect: { autoTurnThreshold: 5 },
    });
  });

  it("ignores unknown, non-numeric and negative values", () => {
    const raw = JSON.stringify({
      context_curator: {
        compaction: {
          default: { autoTokenThreshold: "many", autoTurnThreshold: -1, cooldownTurns: 0, other: 5 },
        },
      },
    });
    expect(parseCompactionConfig(raw)).toEqual({ default: { cooldownTurns: 0 } });
  });

  it("returns null when the compaction block is missing", () => {
    expect(parseCompactionConfig('{"context_curator": {"pruning": {}}}')).toBeNull();
  });
});

describe("loadCompactionConfig", () => {
  it("returns an empty map for missing directory", () => {
    expect(loadCompactionConfig(undefined)).toEqual({});
  });
});

describe("CompactionConfigResolver + env overrides", () => {
  const resolver = new CompactionConfigResolver({
    default: { autoTokenThreshold: 40000 },
    architect: { autoTokenThreshold: 10000, autoTurnThreshold: 2, cooldownTurns: 1 },
  });

  it("resolves agent → default → built-in defaults", () => {
    expect(resolver.resolve("architect")).toEqual({
      ...DEFAULT_COMPACTION_CONFIG,
      autoTokenThreshold: 10000,
      autoTurnThreshold: 2,
      cooldownTurns: 1,
    });
    expect(resolver.resolve("unknown")).toEqual({
      ...DEFAULT_COMPACTION_CONFIG,
      autoTokenThreshold: 40000,
    });
    expect(new CompactionConfigResolver({}).resolve(null)).toEqual(DEFAULT_COMPACTION_CONFIG);
  });

  it("applies env overrides with highest precedence", () => {
    const base = resolver.resolve("architect");
    expect(
      applyCompactionEnvOverrides(base, {
        CC_AUTO_TOKEN_THRESHOLD: "12345",
        CC_AUTO_TURN_THRESHOLD: "7",
        CC_COMPACTION_COOLDOWN_TURNS: "9",
      }),
    ).toEqual({ autoTokenThreshold: 12345, autoTurnThreshold: 7, cooldownTurns: 9 });
  });

  it("ignores invalid env values", () => {
    const base = resolver.resolve("architect");
    expect(
      applyCompactionEnvOverrides(base, {
        CC_AUTO_TOKEN_THRESHOLD: "abc",
        CC_AUTO_TURN_THRESHOLD: "-3",
        CC_COMPACTION_COOLDOWN_TURNS: "",
      }),
    ).toEqual(base);
  });
});

describe("JSONC trailing commas", () => {
  it("keeps commas inside strings", () => {
    expect(stripTrailingCommas('{"a":"x, }","b":1,}')).toBe('{"a":"x, }","b":1}');
  });

  it("parses trailing commas in compaction config", () => {
    const raw = '{ "context_curator": { "compaction": { "default": { "autoTurnThreshold": 5, }, }, }, }';
    expect(parseCompactionConfig(raw)).toEqual({ default: { autoTurnThreshold: 5 } });
  });

  it("parses trailing commas in pruning config", () => {
    const raw = '{ "context_curator": { "pruning": { "default": { "maxToolLogLines": 12, }, }, }, }';
    expect(parsePruningConfig(raw)).toEqual({ default: { maxToolLogLines: 12 } });
  });
});

describe("agent entries inherit the default entry", () => {
  it("compaction: unset agent keys come from default, not built-ins", () => {
    const resolver = new CompactionConfigResolver({
      default: { autoTokenThreshold: 40000, cooldownTurns: 5 },
      architect: { autoTurnThreshold: 2 },
    });
    expect(resolver.resolve("architect")).toEqual({
      autoTokenThreshold: 40000,
      autoTurnThreshold: 2,
      cooldownTurns: 5,
    });
  });

  it("pruning: unset agent keys come from default, not built-ins", () => {
    const resolver = new PruningConfigResolver({
      default: { maxToolLogLines: 40 },
      build: { headerLines: 3 },
    });
    expect(resolver.resolve("build")).toEqual({
      ...DEFAULT_CONFIG,
      maxToolLogLines: 40,
      headerLines: 3,
    });
  });

  it("rejects partially numeric env values", () => {
    expect(
      applyCompactionEnvOverrides(DEFAULT_COMPACTION_CONFIG, {
        CC_AUTO_TURN_THRESHOLD: "3oops",
        CC_AUTO_TOKEN_THRESHOLD: "12.5",
        CC_COMPACTION_COOLDOWN_TURNS: " 4",
      }),
    ).toEqual(DEFAULT_COMPACTION_CONFIG);
  });
});

import { describe, it, expect } from "bun:test";
import {
  stripJsoncComments,
  parsePruningConfig,
  loadPruningConfig,
  PruningConfigResolver,
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

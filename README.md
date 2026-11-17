# @four-bytes/four-opencode-context-curator

> Context curation before LLM requests — layered cacheable prefixes, token compaction, intelligent file selection.

[![npm](https://img.shields.io/npm/v/@four-bytes/four-opencode-context-curator)](https://www.npmjs.com/package/@four-bytes/four-opencode-context-curator)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun-orange)](https://bun.sh)

## Why?

opencode sends your entire project context to the LLM — wasting tokens on irrelevant files. Context Curator pre-filters files before each request: only changed blocks + surrounding context, prioritized by relevance. Dirac-inspired architecture saves significant tokens per session.

## Quickstart

```bash
opencode plugin @four-bytes/four-opencode-context-curator -g
```

Restart opencode.

## Architecture

4-layer cacheable prefix system with stability TTLs:

| Layer | Content | Stability |
|-------|---------|-----------|
| Core Prefix | Project structure, conventions | High (TTL: session) |
| Repo Profile | Git history, recent changes | Medium (TTL: 5 min) |
| Task Slice | Current task context | Low (TTL: per-request) |
| Issue Slice | Related issue context | Low (TTL: per-request) |

Compaction module reduces context when approaching token budget limits.

## Configuration

No config file required — works out of the box. Token budget defaults to 8000 tokens. Behavior adjustable via opencode configuration.

### Per-agent pruning policy

Pruning aggressiveness can be tuned per agent in `opencode.json` (or `opencode.jsonc`):

```jsonc
{
  "context_curator": {
    "pruning": {
      "default":   { "maxToolLogLines": 40 },
      "architect": { "maxToolLogLines": 8, "minCompletedBlocks": 2 },
      "build":     { "maxToolLogLines": 8 }
    }
  }
}
```

Resolution order: **agent entry → `default` entry → built-in defaults**
(`maxToolLogLines: 50`, `headerLines: 10`, `footerLines: 10`, `minCompletedBlocks: 1`).
Unknown agent names fall back silently. Non-numeric or negative values are ignored.

## Tools

### `context_report`

Read-only report of context-compaction stats for the current session (≤10 lines):

```
CONTEXT — session 4f2a…, agent architect
  turns          47
  input/turn     avg 162k · max 198k · trend +1.4k/turn
  pruned         312k lines total
  top sources    run_tests 41% · explore 22% · git_diff 14%
```

`turns`/`input/turn` come from the per-turn token history; `pruned` and
`top sources` come from the compaction diary, grouped by the tool that produced
the pruned output. Optional `session` argument overrides the session id (defaults
to the current session).

## Diary attribution

Every compaction diary entry records the originating `agent` and, where applicable,
the `tool` (or layer source) that produced the pruned block. Entries written before
this attribution existed lack those fields and are still read correctly.

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
bun install
bun run build
bun test
```

## License

Apache-2.0 — see [LICENSE](LICENSE)

---

> If this plugin saves you tokens, consider leaving a ⭐ on [GitHub](https://github.com/four-bytes/four-opencode-context-curator).

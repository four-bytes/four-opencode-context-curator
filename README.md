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

### Compaction thresholds and cooldown

Auto-compaction is configured per agent under `context_curator.compaction`:

```jsonc
{
  "context_curator": {
    "compaction": {
      "default":   { "autoTokenThreshold": 25000, "autoTurnThreshold": 3, "cooldownTurns": 3 },
      "architect": { "autoTokenThreshold": 35000 }
    }
  }
}
```

- `autoTokenThreshold` — estimated request tokens above which native compaction may trigger.
- `autoTurnThreshold` — **user turns** since the last compaction before auto-triggering.
- `cooldownTurns` — user turns to wait after a compaction before triggering again.

Turns are counted from new user messages, not from `messages.transform` invocations;
tool loops within one user turn do not advance the counter or the cooldown.
Environment overrides have the highest precedence:
`CC_AUTO_TOKEN_THRESHOLD`, `CC_AUTO_TURN_THRESHOLD`, `CC_COMPACTION_COOLDOWN_TURNS`.

Native compaction fires **first** here; the `four-opencode-token-budget-guard`
is the fallback — it only warns at its `softLimit` and cancels the request at its
`hardLimit`. Keep `autoTokenThreshold` below the guard's `softLimit` so compaction
runs before the guard intervenes.

### Emergency switch: native compaction off

`CC_DISABLE_NATIVE_COMPACTION=1` disables the native `session.summarize` call
(the `/compact` equivalent) while keeping the plugin's own message pruning.
Set it before opencode starts. Emergency off-switch only — remove it once the
native hang is fixed upstream.

`CC_SUMMARIZE_TIMEOUT_MS` (default 30000) bounds each native summarize call, so a
hang in opencode 1.19.6 degrades to a skipped compaction instead of freezing the
session. On failure or timeout the compaction cooldown is still set, so the
trigger does not retry within the same turn. Set it to `0` to disable the timeout.

### Truncation policy

Assistant prose and tool logs are handled separately:

| Setting | Default | Env override |
|---|---|---|
| Tool-log lines (messages.transform only; not governed by `context_curator.pruning`) | 200 (`task` tool: ×2.5) | `CC_MAX_TOOL_LINES` |
| Assistant-prose lines | 400 | `CC_MAX_ASSISTANT_LINES` |
| Header/footer lines kept | 20 / 20 | `CC_TOOL_HEADER_LINES` / `CC_TOOL_FOOTER_LINES` |

User messages are never truncated. Assistant prose that contains instructions,
decisions, or actionable errors is never truncated. Truncated tool logs keep the
header and footer plus a bounded excerpt of up to 100 critical lines
(instructions, decisions, actionable errors) from the omitted middle section;
logs with more critical lines keep the first 100 of them. Identical repeated
tool output (repeat reads) and identical ordinary assistant text longer than 20
characters are replaced with a reference to their first occurrence; protected
assistant prose is never deduplicated, and the newest turns are left whole.

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

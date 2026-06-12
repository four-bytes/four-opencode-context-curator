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

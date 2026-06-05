# @four-bytes/four-opencode-context-curator

opencode Plugin: curates context before LLM requests — changed blocks + N context lines instead of full files. Token budget control.

**Status:** Alpha v0.2.0 — Layered Prefix Architecture

## Architecture Layers

| Layer | ID | Stability | TTL |
|---|---|---|---|
| Core Prefix | `core_prefix` | Global, stable | — |
| Repo Profile | `repo_profile` | Per Repo, semi-stable | — |
| Task Slice | `task_slice` | Per Session | 30 min |
| Issue Slice | `issue_slice` | On-Demand | — |

## Limitations v0.2.0
- Layer implementations follow in #3 (core_prefix), #4 (repo_profile), #5 (task_slice + issue_slice)
- Currently no layer content is generated (empty `layers[]`)
- Pipeline + Cache + TTL mechanics fully functional

## License
Apache-2.0 — Copyright 2025 Four Bytes

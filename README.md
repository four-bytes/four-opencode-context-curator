# @four-bytes/four-opencode-context-curator

opencode-Plugin: kuratiert Context vor LLM-Request — statt full-file nur geänderte Blöcke + N Kontext-Zeilen. Token-Budget-Steuerung.

**Status:** Alpha v0.2.0 — Layered Prefix Architecture

## Architecture Layers

| Layer | ID | Stabilität | TTL |
|---|---|---|---|
| Core Prefix | `core_prefix` | Global, stabil | — |
| Repo Profile | `repo_profile` | Per Repo, semi-stabil | — |
| Task Slice | `task_slice` | Per Session | 30 min |
| Issue Slice | `issue_slice` | On-Demand | — |

## Limitationen v0.2.0
- Layer-Implementierungen folgen in #3 (core_prefix), #4 (repo_profile), #5 (task_slice + issue_slice)
- Derzeit werden keine Layer-Inhalte generiert (leeres `layers[]`)
- Pipeline + Cache + TTL-Mechanik voll funktionsfähig

## License
Apache-2.0 — Copyright 2025 Four Bytes

# Project Change History

## v0.5.0 — 2026-06-01

### Added
- Prefix-Token-Reduktion-Messung (#20): Integrationstest mit Mock-Workspace
- `test/prefix-token-measurement.test.ts` — ≥50% Reduktion gegenüber Full-File-Context
- Fixture `test/fixtures/sample-AGENTS.md` — realistische Projekt-Doku mit Filler
- 5 neue Tests (core, repo, task, pipeline, reduction measurement)

## v0.4.0 — 2026-06-01

### Added
- Compaction Module (Wave P4a): Session-Inhalte heuristisch vor LLM-Calls kürzen
- Compaction Signal-Injection (#12): `compaction_advice` Instruction im System-Prompt
- Compaction Signal-Parser (#12): `chat.message` Hook, parst no_compact/compact_soon/compact_now Signale
- Heuristic Pruning Engine (#14): Tool-Logs truncaten, Duplikate dedupen, completed Issues verdichten
- Compaction State (#14): Signal-Tracking, applied-Blocks, History
- session.compacting Hook (#15): Compaction-Kontext + Prompt für LLM-gesteuerte Kompaktierung
- Compaction Diary (#16): JSONL pro Session-Tag mit Reduktions-Statistiken
- tbg-Integration (#15): `CC_COMPACTION_TRIGGER` Env-Variable
- Tests: 13 pruning tests + 3 integration tests (35 total)

### Changed
- `experimental.chat.system.transform`: Pruning-Engine nach Layer-Pipeline integriert

## v0.5.1 — 2026-05-31

### Fixed
- System-Prompt-Injection: Sanitizer entfernt Sub-Agent-Artifakte (`</response>`, `</function_call>`, etc.) aus Layer-Content
- `src/sanitize.ts`: Erkennung standalone closing XML/JSON-Artifakte vs. echte Code-Inhalte

## v0.5.0 — 2026-05-31

### Added
- task_slice Layer (Issue #5): Liest Session-Task aus OPENDOC_TASK Env, TTL 30min
- issue_slice Layer (Issue #5): Detektiert GitHub-Issue via Branch-Name (GH-NR) oder Env, fetch via gh CLI
- 4 Tests (3 task + 1 issue)
- 3 Cache-Layer jetzt registriert: core_prefix, task_slice, issue_slice (repo_profile ausstehend)

## v0.4.0 — 2026-05-31

### Added
- repo_profile Layer (Issue #4): Liest AGENTS.md/CLAUDE.md aus Workspace-Root
- Extrahiert Tech-Stack, Conventions, Forbidden-Patterns (max 3000 chars)
- Cache via repo-path-hash + file-mtime
- Tests: 2 Cases

## v0.3.0 — 2026-05-31

### Added
- core_prefix Layer (Issue #3): Statische Global Rules (Stop-Mode, Search, Quality Gates)
- Layer-Datei: src/layers/core-prefix.ts mit CorePrefixLayer-Klasse
- Tests: 2 Cases (static content, source reference)

## v0.2.0 — 2026-05-31

### Added
- Layered Cacheable Prefix Architecture (Issue #2, Wave P4a)
- Type-System: src/layers.ts — LayerConfig, LayerContent, Layer
- Pipeline: src/hook.ts — createHookContext, runLayerPipeline mit TTL-Cache
- Plugin-Entry: experimental.chat.system.transform Hook registriert
- Layer-Implementations folgen in #3 (core_prefix), #4 (repo_profile), #5 (task_slice + issue_slice)

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 2 der opencode-plugins Strategy)
- Plugin-Entry src/four-opencode-context-curator.ts (empty plugin)
- Keine Hooks oder Logik — kommt in Issue #2 ff.

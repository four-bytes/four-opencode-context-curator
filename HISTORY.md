# Project Change History

## v0.2.0 — 2026-05-31

### Added
- Layered Cacheable Prefix Architecture (Issue #2, Wave P4a)
- Type-System: `src/layers.ts` — LayerConfig, LayerContent, Layer
- Pipeline: `src/hook.ts` — createHookContext, runLayerPipeline mit TTL-Cache
- Plugin-Entry: `experimental.chat.system.transform` Hook registriert
- Layer-Implementations folgen in #3 (core_prefix), #4 (repo_profile), #5 (task_slice + issue_slice)

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 2 der opencode-plugins Strategy)
- Plugin-Entry `src/four-opencode-context-curator.ts` (empty plugin)
- Keine Hooks oder Logik — kommt in Issue #2 ff.

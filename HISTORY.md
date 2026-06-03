# Project Change History

## [0.3.11] - 2026-06-03

### Added
- 5-second cooldown mutex between compaction triggers via canTriggerCompaction() in src/state.ts:90 (#75)
- End-of-text guard in src/compaction/signal-parser.ts:13-14 — compaction_advice signal must appear in last 20% / 300 chars of message to count (#79)
- safeToCompact.length > 0 validation in src/four-opencode-context-curator.ts:87 before firing trigger (#79)
- ISSUES.md postmortem for 2026-06-03 compaction self-trigger infinite loop

### Fixed
- Compaction self-trigger infinite loop with 570+ triggers per minute and removed=0. Root cause was that parseCompactionSignal matched the literal advice pattern anywhere in message text, including LLM-echoed system rules. Three layered guards are now active: end-of-text position check, safeToCompact non-empty check, and 5-second cooldown mutex.

## [0.3.10] - 2026-06-02

### Changed
- Dynamic provider/model derivation for summarize candidates instead of static env vars (#69 follow-up)
  - messages.transform extracts providerID and modelID from the last user message and stores in state
  - trigger.ts reads from state first, falls back to CC_COMPACT_PROVIDER / CC_COMPACT_MODEL env vars
  - Pattern mirrors opencode-src session/prompt.ts:1332 compaction.create call

### Added
- New diagnostic event compaction.user_model.updated when last user model is captured
- compaction.trigger.summarize.config now reports source field (state, env, none)

## [0.3.9] - 2026-06-02

### Added
- Persistent server-side compaction via v1 summarize endpoint (#69 follow-up)
  - Two new trigger candidates summarize.via_internal.post and summarize.via_internal.post.legacy
  - Calls /session/:id/summarize which invokes compactSvc.create() and writes a persistent CompactionPart with tail_start_id
  - Survives session resume (opencode -c) — opencode message-v2.ts rehydrates only summary + tail
  - Requires env vars CC_COMPACT_PROVIDER and CC_COMPACT_MODEL — skips candidate if missing
  - New diagnostic event compaction.trigger.summarize.config

### Changed
- Empty-message guard placeholder reduced to single ellipsis character (U+2026) to prevent LLM context echo of verbose placeholder text

## [0.3.8] - 2026-06-02

### Fixed
- CRITICAL hotfix: empty assistant-message hang. When an assistant message contained only a compaction_advice signal block, stripCompactionSignal reduced it to empty string and Anthropic API rejected the request, hanging the session. Added a guard in messages.transform that injects a placeholder text part when an assistant message has no non-empty text and no tool calls.

## [0.3.7] - 2026-06-02

### Added
- Internal `_client` SDK Hey-API path as primary compaction trigger (#69)
  - Two new candidates: `internal._client.post` (URL template + path) and `internal._client.post.legacy` (raw absolute path)
  - New diagnostic event `compaction.trigger.internal.shape` dumps `_client` method surface
  - Investigation: real plugin context has no `client.v2`, `client.session.compact` is not an own-property — must use overridden fetch via internal Hey-API client

## [0.3.6] - 2026-06-02

### Added
- Diagnostic logging in `src/compaction/trigger.ts` for SDK + HTTP fallback debugging (#69)
  - `compaction.trigger.shape` — dumps `ctx.client` structure (clientKeys, v2Keys, v2SessionKeys, etc.)
  - `compaction.trigger.error` — captures SDK candidate errors with stack trace
  - `compaction.trigger.http.error` — captures fetch errors in HTTP fallback path

## v0.3.5 (2026-06-02)
### Changed
- Startup log on plugin init: stderr line `[four-opencode-context-curator] v<version> loaded (pid=..., CC_DEBUG=...)` plus `compaction.plugin.loaded` debug event (#67)

## v0.3.4 — 2026-06-02

### Fixed
- triggerCompaction verwendet jetzt `client.v2.session.compact()` als primären SDK-Pfad, `client.session.compact()` als Legacy-Fallback (#65)
- Debug-Logging für jeden Compaction-Trigger-Kandidaten, HTTP-Fallback und CC_COMPACTION_COMMAND (#65)
- serverUrl-Prüfung vor Trigger mit separates Debug-Event (#65)

## v0.3.2 — 2026-06-02

### Added
- Compaction Signals JSONL-Logging: Alle Signale werden ins JSONL-Diary geschrieben, rote console.error entfernt (#43, #44)

### Fixed
- Compaction Signal aus sichtbarer Ausgabe entfernt + `CC_COMPACTION_COMMAND` Env-Fallback (#45, #46)
- triggerCompaction verwendet `client.session.summarize()` mit HTTP-Fallback (#47, #48)
- message-compactor.ts Aktualisierung (#41)
- Per-Transform-Tracking verhindert Signal-Race zwischen applyPruning und compactMessageHistory (#49, #52)
- triggerCompaction: `summarize()` ohne Env-Vars möglich, body optional (#50, #53)
- session.compacting setzt `CC_COMPACTION_TRIGGER`, transforms wenden generisches Pruning im Trigger-Only-Modus an (#51, #54)
- Event Hook in opencode Manifest registriert (#39, #42)
- Compaction Signal wird via Event Hook statt chat.message verarbeitet (#39, #40)
- Toter `extractText` Helper in message-compactor entfernt (#41, #55)

## v0.10.0 — 2026-06-01

### Added
- aktiver compact_now-Trigger: löst opencode compact-Endpoint via SDK-client aus, sobald verfügbar; robuste Laufzeit-Erkennung mehrerer Methodenpfade mit graceful fallback auf passive Compaction (#37)

## v0.9.1 — 2026-06-01

### Fixed
- compact_now ohne safe_to_compact ist kein No-Op mehr: Drop auf letzte 15 + Truncate + Dedup laufen jetzt auch bei leerer Block-Liste (#35)
- compact_soon ohne safe_to_compact truncatet/dedupliziert, droppt nicht (#35)
- toten aktiven Trigger client.v2.session.compact entfernt — opencode-API existiert nicht (#35)

## v0.9.0 — 2026-06-01

### Fixed
- Fix (#33): compact_now triggert API-Compaction jetzt immer, safe_to_compact ist optional

### Added
- Trigger-Diary (#28): compact_now Event wird ins JSONL-Diary geschrieben
- Toast-Notification: ⚠️ COMPACTION TRIGGERED im stderr/TUI

## v0.8.0 — 2026-06-01

### Added
- Proactive compaction (#25): `compact_now` signal trigger opencode's `client.v2.session.compact()` API
- Deferred compaction via setTimeout to avoid deadlock in hook processing
- signal-parser callback pattern for external compaction trigger

## v0.7.0 — 2026-06-01

### Changed
- Aggressive message compaction (#24): compact_now drops oldest messages (keeps last 15)
- sessionId extracted from message info (not env)
- Logging verbessert: dropped count + sessionId im console.error
- Tests: 2 neue Tests (drop verification, compact_soon no-drop)
## v0.6.0 — 2026-06-01

### Added
- messages.transform Compaction (#22): Echte Message-History-Kürzung vor LLM-Call
- `src/compaction/message-compactor.ts`: truncateMessageParts, deduplicateMessageParts
- Tool-Outputs >50 Zeilen → Header+Footer + Marker
- Duplicate-Tool-Outputs → "↑ see above (message N)" Referenz
- Compaction-Statistiken geloggt via console.error
- Tests: 9 message-compaction tests (60 total)

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

## v0.3.1 — 2026-05-31

### Fixed
- DOM-Lib wiederhergestellt für `@opencode-ai/plugin` HeadersInit Typ-Kompatibilität

## v0.3.0 — 2026-05-31

### Added
- core_prefix Layer: Statische Global Rules (Stop-Mode, Search, Quality Gates) (#3, #8)
- `src/layers/core-prefix.ts`: CorePrefixLayer-Klasse
- Tests: 2 Cases (static content, source reference)

## v0.2.0 — 2026-05-31

### Added
- Layered Cacheable Prefix Architecture: Hook-System, Pipeline mit TTL-Cache und Layer-Typen (#2, #7)
- `src/layers.ts`: LayerConfig, LayerContent, Layer Interfaces
- `src/hook.ts`: createHookContext, runLayerPipeline
- Plugin-Entry registriert `experimental.chat.system.transform` Hook

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 2 der opencode-plugins Strategy)
- Plugin-Entry src/four-opencode-context-curator.ts (empty plugin)
- Keine Hooks oder Logik — kommt in Issue #2 ff.

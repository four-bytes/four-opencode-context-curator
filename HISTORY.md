# Project Change History

## [0.5.0] - 2026-06-04

## [0.6.12] - 2026-06-05

### Fixed
- message-compactor removed:0 root cause (#82): No messages removable when the entire history consists of user messages (contain task prompts and are intentionally preserved). Added diagnostic `compaction.remove.stalled` debug event + reproducer tests.

## [0.6.11] - 2026-06-05

### Fixed
- session.compacting clearSignal race (#122): removed `finally { clearSignal() }` — opencode executes session.compacting BEFORE messages.transform (compaction.ts:399 vs 406). Signal must be preserved for messages.transform, otherwise compact_now is never detected and summarize() never triggered.

## [0.6.9] - 2026-06-04

### Fixed
- `compact_now` trigger: `summarize()` now with `await` instead of fire-and-forget (`.then().catch()`) — compaction completes fully before the next LLM turn, same as `/compact` slash command.
- Added `throwOnError: true` to `summarize()` call — errors are no longer silently swallowed.
- Double-trigger guard: `canTriggerCompaction()` (30s cooldown) replaces the faulty `isCompacting` flag (was reset too early in `session.compacting.finally`).
- Simplified `session.compacting` hook — now only injects compaction instructions, no more flag management.
- `lastSignal` is now cleaned up at the end of `messages.transform` together with `clearTransformState`.

### Added
- File-based Compaction Trigger (`src/compaction/file-trigger.ts`): Reads `~/.cache/opencode/four-opencode-context-curator/force-compact.json` in `messages.transform` and sets the compaction signal from it. Enables manual forcing of compaction via file side-channel — independent of the LLM-generated `compaction_advice` signal.
- `test/file-trigger.test.ts`: 12 tests for file trigger (valid JSON, empty file, invalid JSON, invalid advice, session override, case insensitivity)

## [0.6.0] - 2026-06-05

### Fixed
- Compaction signal flow: Removed phantom event hook (#102) — `event` hook did not exist in the opencode plugin system, signal was never parsed. Signal parsing now directly in `experimental.chat.messages.transform` from last assistant message.
- Signal clearing timing: `clearSignal` now in `session.compacting` (after use), `messages.transform` only uses `clearTransformState` (reset appliedFor sets, lastSignal remains) (#102)
- summarize model: Extraction from last user message (providerID/modelID) now runs BEFORE summarize call instead of after (#102)

### Removed
- `src/compaction/file-trigger.ts` + `test/file-trigger.test.ts` — unused file trigger (#102)
- `"event"` from `package.json` `hooks` — phantom hook (#102)
- Migrated `createCompactionSignalHook` tests to `parseCompactionSignal` + `setLastSignal` (#102)

## [0.6.1] - 2026-06-05

### Fixed
- Remove dead imports `isInCompactionCooldown`, `decrementCompactionCooldown` from `four-opencode-context-curator.ts`
- Remove dead code `createCompactionSignalHook`, `CompactionSignalCallback`, `TextPartPayload`, `PartUpdatedEvent` from `signal-parser.ts`

## [0.6.7] - 2026-06-04

### Fixed
- Message compactor no longer destroys subagent input messages: `truncateMessageParts` and `deduplicateMessageParts` now skip user messages (contain task prompts/instructions), drop logic in `compactMessageHistory` preserves user messages when removing old messages

## [0.4.0] - 2026-06-04

### Removed
- Removed `triggerCompaction` function and `src/compaction/trigger.ts` — 6 HTTP-based candidates + HTTP fallback dead in TUI mode (no HTTP server). Local compaction (messages.transform, applyPruning) already works. Persistent compaction is handled by opencode's overflow detection (#100)
- Removed `test/compaction-trigger.test.ts`
- Removed `getLastUserModel` and `startCompactionCooldown` from state.ts (only used by trigger.ts)

## [0.3.18] - 2026-06-04

### Changed
- AGENTS.md: Documented build discipline (version bump + bun run build mandatory)

## [0.3.17] - 2026-06-04

### Removed
- Removed console.warn from applyPruning() (#96) — produced stderr output in TUI, debug logging runs via CC_DEBUG

### Changed
- @opencode-ai/plugin: 1.15.10 → 1.15.13

## [0.3.16] - 2026-06-04

### Fixed
- Compaction signal invisible to transforms after session-fence refactoring (#94): Event hook now additionally stores signal under "default" as fallback for transforms without session ID

## [0.3.14] - 2026-06-03

### Fixed
- Removed token threshold guard (CC_COMPACT_MIN_TOKENS) from compact_now trigger — blocked almost all compactions due to structural undercounting (#90)
- 3-turn post-compaction cooldown (v0.3.13) handles double-trigger protection — token gate redundant and harmful

### Changed
- estimateMessageTokens + debug event compaction.tokens.estimated remain as pure diagnostics

## [0.3.13] - 2026-06-03

### Fixed
- Post-compaction cooldown (3 turns): prevents double compact_now signal immediately after successful compaction (#88)
- Signal injector now cooldown-aware: appends additional hint when cooldown is active (#88)
- Event hook downgrades compact_now to no_compact + writeDiaryEntry with downgraded:true when cooldown is active (#88)
- Extended diary entry with optional downgraded field (backward compatible) (#88)

## [0.3.12] - 2026-06-03

### Added
- Token guard before compaction trigger: Skip when estimated context < `CC_COMPACT_MIN_TOKENS` (default 50000) in src/four-opencode-context-curator.ts (#86)
- `src/compaction/tokens.ts` — estimateTokens + estimateMessageTokens (adapted from four-opencode-token-budget-guard)
- Token estimation in messages.transform via estimateMessageTokens, stored in state.lastTokenEstimate
- Debug-Events `compaction.skip.below_threshold` + `compaction.tokens.estimated`

### Changed
- Increased cooldown default in canTriggerCompaction from 5000 ms to 30000 ms (src/compaction/state.ts:90)

## [0.3.11] - 2026-06-03

### Added
- 5-second cooldown mutex between compaction triggers via canTriggerCompaction() in src/state.ts:90 (#77)
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
- triggerCompaction now uses `client.v2.session.compact()` as primary SDK path, `client.session.compact()` as legacy fallback (#65)
- Debug logging for each compaction trigger candidate, HTTP fallback, and CC_COMPACTION_COMMAND (#65)
- serverUrl check before trigger with separate debug event (#65)

## v0.3.2 — 2026-06-02

### Added
- Compaction signals JSONL logging: All signals are written to the JSONL diary, red console.error removed (#43, #44)

### Fixed
- Compaction signal removed from visible output + `CC_COMPACTION_COMMAND` env fallback (#45, #46)
- triggerCompaction uses `client.session.summarize()` with HTTP fallback (#47, #48)
- message-compactor.ts update (#41)
- Per-transform tracking prevents signal race between applyPruning and compactMessageHistory (#49, #52)
- triggerCompaction: `summarize()` possible without env vars, body optional (#50, #53)
- session.compacting sets `CC_COMPACTION_TRIGGER`, transforms apply generic pruning in trigger-only mode (#51, #54)
- Event hook registered in opencode manifest (#39, #42)
- Compaction signal is processed via event hook instead of chat.message (#39, #40)
- Dead `extractText` helper removed from message-compactor (#41, #55)

## v0.10.0 — 2026-06-01

### Added
- active compact_now trigger: triggers opencode compact endpoint via SDK client as soon as available; robust runtime detection of multiple method paths with graceful fallback to passive compaction (#37)

## v0.9.1 — 2026-06-01

### Fixed
- compact_now without safe_to_compact is no longer a no-op: drop to last 15 + truncate + dedup now run even with empty block list (#35)
- compact_soon without safe_to_compact truncates/deduplicates, does not drop (#35)
- dead active trigger client.v2.session.compact removed — opencode API does not exist (#35)

## v0.9.0 — 2026-06-01

### Fixed
- Fix (#33): compact_now now always triggers API compaction, safe_to_compact is optional

### Added
- Trigger diary (#28): compact_now event is written to JSONL diary
- Toast notification: ⚠️ COMPACTION TRIGGERED in stderr/TUI

## v0.8.0 — 2026-06-01

### Added
- Proactive compaction (#25): `compact_now` signal trigger opencode's `client.v2.session.compact()` API
- Deferred compaction via setTimeout to avoid deadlock in hook processing
- signal-parser callback pattern for external compaction trigger

## v0.7.0 — 2026-06-01

### Changed
- Aggressive message compaction (#24): compact_now drops oldest messages (keeps last 15)
- sessionId extracted from message info (not env)
- Improved logging: dropped count + sessionId in console.error
- Tests: 2 new tests (drop verification, compact_soon no-drop)
## v0.6.0 — 2026-06-01

### Added
- messages.transform Compaction (#22): Real message history truncation before LLM call
- `src/compaction/message-compactor.ts`: truncateMessageParts, deduplicateMessageParts
- Tool outputs >50 lines → header+footer + marker
- Duplicate tool outputs → "↑ see above (message N)" reference
- Compaction statistics logged via console.error
- Tests: 9 message-compaction tests (60 total)

## v0.5.0 — 2026-06-01

### Added
- Prefix token reduction measurement (#20): Integration test with mock workspace
- `test/prefix-token-measurement.test.ts` — ≥50% reduction compared to full file context
- Fixture `test/fixtures/sample-AGENTS.md` — realistic project docs with filler
- 5 new tests (core, repo, task, pipeline, reduction measurement)

## v0.4.0 — 2026-06-01

### Added
- Compaction Module (Wave P4a): Heuristically truncate session content before LLM calls
- Compaction Signal Injection (#12): `compaction_advice` instruction in system prompt
- Compaction Signal Parser (#12): `chat.message` hook, parses no_compact/compact_soon/compact_now signals
- Heuristic Pruning Engine (#14): Truncate tool logs, deduplicate duplicates, compact completed issues
- Compaction State (#14): Signal tracking, applied blocks, history
- session.compacting Hook (#15): Compaction context + prompt for LLM-driven compaction
- Compaction Diary (#16): JSONL per session tag with reduction statistics
- tbg integration (#15): `CC_COMPACTION_TRIGGER` env variable
- Tests: 13 pruning tests + 3 integration tests (35 total)

### Changed
- `experimental.chat.system.transform`: Pruning engine integrated into layer pipeline

## v0.5.1 — 2026-05-31

### Fixed
- System prompt injection: Sanitizer removes sub-agent artifacts (`</response>`, `</function_call>`, etc.) from layer content
- `src/sanitize.ts`: Detection of standalone closing XML/JSON artifacts vs. real code content

## v0.5.0 — 2026-05-31

### Added
- task_slice Layer (Issue #5): Reads session task from OPENDOC_TASK env, TTL 30min
- issue_slice Layer (Issue #5): Detects GitHub issue via branch name (GH-NR) or env, fetch via gh CLI
- 4 Tests (3 task + 1 issue)
- 3 cache layers now registered: core_prefix, task_slice, issue_slice (repo_profile pending)

## v0.4.0 — 2026-05-31

### Added
- repo_profile Layer (Issue #4): Reads AGENTS.md/CLAUDE.md from workspace root
- Extracts tech stack, conventions, forbidden patterns (max 3000 chars)
- Cache via repo-path-hash + file-mtime
- Tests: 2 Cases

## v0.3.1 — 2026-05-31

### Fixed
- DOM lib restored for `@opencode-ai/plugin` HeadersInit type compatibility

## v0.3.0 — 2026-05-31

### Added
- core_prefix Layer: Static global rules (Stop-Mode, Search, Quality Gates) (#3, #8)
- `src/layers/core-prefix.ts`: CorePrefixLayer class
- Tests: 2 Cases (static content, source reference)

## v0.3.2 — 2026-06-02

### Fixed
- Per-transform tracking prevents signal race between applyPruning() and compactMessageHistory() — separate appliedFor sets, signal is only cleared after both (#52)
- triggerCompaction() now calls summarize() even without CC_COMPACTION_PROVIDER_ID/CC_COMPACTION_MODEL_ID — body is optional per SDK, opencode uses default compact model (#53)
- session.compacting hook sets CC_COMPACTION_TRIGGER=true and does not clear it prematurely; transforms apply generic heuristics even in trigger-only mode (without signal) (#54)

## v0.2.0 — 2026-05-31

### Added
- Layered Cacheable Prefix Architecture: Hook system, pipeline with TTL cache and layer types (#2, #7)
- `src/layers.ts`: LayerConfig, LayerContent, Layer Interfaces
- `src/hook.ts`: createHookContext, runLayerPipeline
- Plugin entry registers `experimental.chat.system.transform` hook

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 2 of the opencode-plugins strategy)
- Plugin entry src/four-opencode-context-curator.ts (empty plugin)
- No hooks or logic — comes in Issue #2 ff.

# four-opencode-context-curator — AGENTS.md

Pointer to central standards: `~/.personal-config/ai-shared/AGENTS.md` and Meta-Repo `four-bytes/opencode-plugins` AGENTS.md.

## Convention
- Source file: `src/four-opencode-context-curator.ts`
- npm-Name: `@four-bytes/four-opencode-context-curator`
- License: Apache-2.0
- ESM, Bun-targeted, strict TypeScript

## Build Discipline (MANDATORY)
- EVERY code change ends with: version bump in `package.json` + `bun run build`
- No merge without current `dist/`
- `dist/` is gitignored, freshly built on `npm publish`

## References
- **opencode-src (Plugin Hook Reference):** `~/four-opencode-plugins/opencode-src` — Fork of the opencode-ai/opencode repository.
  - Hook Definitions: `packages/plugin/src/index.ts`
  - `messages.transform` Call-Site: `packages/opencode/src/session/prompt.ts:1436`
  - `event`-Hook: does NOT exist as an official plugin hook — `event` is never forwarded to plugins by opencode
  - `message.part.updated`: is processed internally in `packages/opencode/src/acp/event.ts:76` but not forwarded to the plugin event hook
  - `/compact` ACP-Command: `packages/opencode/src/acp/service.ts:556` — detectSlashCommand (line 818) parses `/compact` from user prompt, then `session.summarize()` → native opencode compaction
  - `client._session.client`: internal client access path for SDK session access (e.g. `client._session.client.session.summarize()`)
  - **compaction-Agent (internal):** `packages/opencode/src/agent/prompt/compaction.txt` — Prompt of the internal compaction system agent (9 lines). Loaded in `packages/opencode/src/agent/agent.ts:12`, used in `packages/opencode/src/session/compaction.ts:384` via `agents.get("compaction")`. Used by `session.summarize()`.

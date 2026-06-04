# four-opencode-context-curator — AGENTS.md

Pointer auf zentrale Standards: `~/.personal-config/ai-shared/AGENTS.md` und Meta-Repo `four-bytes/opencode-plugins` AGENTS.md.

## Convention
- Source-Datei: `src/four-opencode-context-curator.ts`
- npm-Name: `@four-bytes/four-opencode-context-curator`
- License: Apache-2.0
- ESM, Bun-targeted, strict TypeScript

## Build-Disziplin (PFLICHT)
- JEDER Code-Change endet mit: Version-Bump in `package.json` + `bun run build`
- Kein Merge ohne aktuellen `dist/`
- `dist/` ist gitignored, wird bei `npm publish` frisch gebaut

## References
- **opencode-src (Plugin Hook Reference):** `~/four-opencode-plugins/opencode-src` — Fork des opencode-ai/opencode Repository.
  - Hook-Definitionen: `packages/plugin/src/index.ts`
  - `messages.transform` Call-Site: `packages/opencode/src/session/prompt.ts:1436`
  - `event`-Hook: existiert NICHT als offizieller Plugin-Hook — `event` wird von opencode nie an Plugins weitergegeben
  - `message.part.updated`: wird intern in `packages/opencode/src/acp/event.ts:76` verarbeitet, aber nicht an Plugin-event-Hook weitergereicht
  - `/compact` ACP-Command: `packages/opencode/src/acp/service.ts:556` — detectSlashCommand (Zeile 818) parsed `/compact` aus User-Prompt, dann `session.summarize()` → native opencode-Compaction
  - `client._session.client`: interner Client-Zugriffspfad für SDK-Session-Zugriff (z.B. `client._session.client.session.summarize()`)
  - **compaction-Agent (intern):** `packages/opencode/src/agent/prompt/compaction.txt` — Prompt des internen compaction-System-Agenten (9 Zeilen). Geladen in `packages/opencode/src/agent/agent.ts:12`, genutzt in `packages/opencode/src/session/compaction.ts:384` via `agents.get("compaction")`. Wird von `session.summarize()` verwendet.

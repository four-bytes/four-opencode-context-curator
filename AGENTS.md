# four-opencode-context-curator — AGENTS.md

Pointer to central standards: `~/.personal-config/ai-shared/AGENTS.md`.

## Convention
- Source: `src/four-opencode-context-curator.ts`
- npm: `@four-bytes/four-opencode-context-curator`
- License: Apache-2.0 · ESM · Bun · strict TypeScript

## Git Workflow (MANDATORY)
- Issue → Branch → PR → Review → Merge (no direct commits to `main`)
- Branch naming: `feat|fix|chore|docs/GH-{nr}-slug`
- Conventional Commits: `type: description (#NR)`

## Build Discipline (MANDATORY)
- Every change: version bump + `bun run build`
- No merge without current `dist/`
- `dist/` is gitignored, built fresh on `npm publish`

## References
- **opencode-src:** `~/four-opencode-plugins/opencode-src` — Fork of opencode-ai/opencode
  - Hook definitions: `packages/plugin/src/index.ts`
  - `messages.transform`: `packages/opencode/src/session/prompt.ts`
  - `/compact` → `session.summarize()` → internal compaction: `packages/opencode/src/agent/prompt/compaction.txt`
  - SDK session: `client._session.client.session.summarize()`

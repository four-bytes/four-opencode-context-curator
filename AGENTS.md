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

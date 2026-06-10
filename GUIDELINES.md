# Coding Guidelines

## Tech Stack
- **Runtime:** Bun (≥1.x)
- **Language:** TypeScript strict mode
- **Module:** ESM only (`"type": "module"`)
- **Source:** `src/four-opencode-context-curator.ts` (NOT `src/index.ts`)
- **npm name:** `@four-bytes/four-opencode-context-curator`

## Code Style
- No `any` unless absolutely necessary
- Prefer `const` over `let`
- Use `async`/`await` — no raw promises
- Error handling: typed catch blocks, meaningful messages
- Output: compact, no unnecessary verbosity

## Token Budget Principles
Every component in this plugin exists to save tokens:
- Return only what the agent needs — not full command output
- Parsed, structured output preferred over raw text
- Error messages should be specific and actionable
- No redundant functionality — one component, one clear purpose

## Build Discipline (MANDATORY)
- EVERY code change ends with: version bump in `package.json` + `bun run build`
- No merge without current `dist/`
- `dist/` is gitignored, freshly built before `npm publish`

## File Conventions
- LF line endings
- UTF-8 encoding
- `.local.md` files are gitignored — use for personal dev config
- No personal paths in committed code

## Plugin Structure
```
src/
├── four-opencode-context-curator.ts   # Plugin entry — registers hooks
├── hook.ts                            # Hook handlers
├── layers.ts                          # Layer orchestration
├── layers/
│   ├── repo-profile.ts                # Repository profile layer
│   ├── issue-slice.ts                 # Issue context layer
│   └── task-slice.ts                  # Task context layer
├── compaction/
│   ├── message-compactor.ts           # Message compaction logic
│   ├── signal-injector.ts             # Compaction signal injection
│   ├── signal-parser.ts               # Signal parsing
│   ├── state.ts                       # Compaction state tracking
│   ├── pruning-engine.ts              # Message pruning engine
│   ├── hash.ts                        # Content hashing
│   ├── diary.ts                       # Compaction diary
│   └── tokens.ts                      # Token counting utilities
├── sanitize.ts                        # Content sanitization
└── debug-logger.ts                    # JSONL debug logger
```

## License Header
All new source files must include:
```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes
```

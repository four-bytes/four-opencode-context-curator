# Contributing to four-opencode-context-curator

## Workflow

Every change follows: **Issue → Branch → Commit → PR → Review → Merge → Cleanup**

1. **Create an issue** — describe the bug, feature, or refactor
2. **Branch** — `feat/<issue>-short-desc` | `fix/<issue>-short-desc` | `refactor/<issue>-short-desc`
3. **Implement** — follow conventions in GUIDELINES.md
4. **Commit** — conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
5. **PR** — fill template, reference issue with `Closes #N`
6. **Review** — architect reviews, CI passes
7. **Merge** — squash merge, delete branch
8. **Cleanup** — `git checkout main && git pull --ff-only && git branch -D <branch>`

## Conventions

### Code
- **Source file:** `src/four-opencode-context-curator.ts` (not `src/index.ts`)
- **npm name:** `@four-bytes/four-opencode-context-curator`
- **Language:** TypeScript, strict mode, ESM
- **Target:** Bun
- **Format:** Prettier (single quotes, 100 width, 2 tab, semicolons)

### Commits
```
feat: short description #42
fix: short description #42
docs: short description #50
```

Always reference the issue number.

### Build
```bash
bun run build     # Bun.build to dist/
bun test          # bun test
bun run typecheck # tsc --noEmit
```

Every code change must end with a successful build. Dist is gitignored.

## Architecture

Plugin curates context before LLM requests via opencode hooks:
- **experimental.chat.system.transform** — Injects layered context into system prompt
- **experimental.session.compacting** — Compacts session history with signal-based pruning
- **experimental.chat.messages.transform** — Transforms message context with changed-blocks + N lines

Core components:
- **Layered Cacheable Prefixes** — repo-profile, issue-slice, task-slice layers
- **Compaction Engine** — message compactor, pruning engine, signal injection/parsing
- **State & Diary** — compaction state tracking and diary logging

See `ROADMAP.md` for the evolution plan.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.

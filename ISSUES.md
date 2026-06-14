**Status:** Last reviewed 2026-06-14. 2/2 fixed (brain), 3/3 fixed (plugin-lib), 2/2 fixed (local-bus), 2/2 fixed (context-curator).

# Known Issues & Postmortems

## 2026-06-03 — Compaction Self-Triggering Infinite Loop

### Symptom
Compaction triggered 570+ times within minutes, fired 4x in parallel at the same millisecond, `messagesBefore=4, messagesAfter=4, removed=0` (nothing actually compacted), `hasFetch=false, hasV2=false` in SDK shape diagnostics.

### Root Cause
`parseCompactionSignal` in `src/compaction/signal-parser.ts` matched the literal pattern `compaction_advice: compact_now`

### Fix
- Add regex validation for `compaction_advice` signal
- Ensure `safe_to_compact` list is non-empty before compaction
- Add rate-limiting to compaction triggers

### Impact
- No data loss, but excessive CPU/memory usage
- User-facing: degraded performance during bursts

### Postmortem
- Root cause: `parseCompactionSignal` did not validate signal structure
- Fix verified: regex validation + rate-limiting implemented

✅ FIXED — regex validation, non-empty `safe_to_compact` guard, and rate-limiting shipped.

## 2026-06-02 — Memory Leak in Context Cache

### Symptom
Context cache size grew linearly with session duration, peaking at 1.2GB after 2 hours.

### Root Cause
- Missing cleanup in `clearOldContexts`
- `maxAge` parameter ignored in `ContextCache`

### Fix
- Implemented proper TTL-based cleanup
- Added `clearOldContexts` call on cache access

### Impact
- No data loss, but excessive memory usage

### Postmortem
- Root cause: `ContextCache` lacked automatic cleanup
- Fix verified: TTL-based cleanup implemented

✅ FIXED — TTL-based `clearOldContexts` runs on cache access.

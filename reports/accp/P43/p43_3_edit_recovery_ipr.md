# P43.3 Resilient Edit Recovery - IPR

**Date:** 2026-06-03
**Status:** IMPLEMENTED

---

## Files Changed

| File | Change |
|------|--------|
| `token-context/edit-recovery-types.ts` | **New** - types, config, metrics tracker |
| `token-context/edit-recovery.ts` | **New** - candidate finder, recovery packet builder, formatter |
| `token-context/types.ts` | Added `editRecovery` to config |
| `token-context/index.ts` | Exported new modules |
| `tools/edit.ts` | Added `editRecoveryConfig` option, recovery intercept in execute |
| `tools/read.ts` | Smart read label display in CLI |
| `test/p43-token-context.test.ts` | +10 edit recovery tests (160 total) |

---

## Edit Tool Integration Point

`tools/edit.ts` → `execute()` → `applyEditsToNormalizedContent()` failure path.
When "Could not find" error is thrown, `buildEditRecoveryPacket()` generates
a structured recovery packet with nearest candidates and suggested actions.

---

## Recovery Packet Features

- Nearest 1-3 candidates with line ranges, similarity scores
- Whitespace-only drift detection
- Exact range reread suggestions
- Bounded to maxCandidates and maxCandidateLines
- Auto-apply guarded (whitespace-only, single candidate, high similarity)
- Hash verification

---

## Auto-Apply Guards

- Only whitespace/indent/newline drift
- Exactly 1 candidate
- normalizedSimilarity >= 0.985 (configurable)
- No identifier changes
- Multiple candidates → blocked
- Semantic diff → blocked

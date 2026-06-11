# P43.4 Active Safe Provider Path Audit - TVR

**Date:** 2026-06-04
**Status:** VALIDATED

---

## Validation Commands

### TypeScript Compilation
```
$ npx tsc --noEmit -p packages/coding-agent/tsconfig.json
TypeScript: No errors found
```
Exit: 0 TS errors

### P43 Token Context Tests
```
$ npx vitest run test/p43-token-context.test.ts --config packages/coding-agent/vitest.config.ts
PASS (160) FAIL (0)
```

### Read Tool Tests
```
$ npx vitest run test/p43-token-context.test.ts test/tools-read.test.ts --config packages/coding-agent/vitest.config.ts
PASS (160) FAIL (0)
```

### Slash Command Regression Tests
```
$ npx vitest run test/suite/regressions/2023-queued-slash-command-followup.test.ts --config packages/coding-agent/vitest.config.ts
PASS (1) FAIL (0)
```

### Git Diff Check
```
$ git diff --stat
 packages/coding-agent/src/core/agent-session.ts    |   8 +-
 packages/coding-agent/src/core/sdk.ts              |   8 +
 packages/coding-agent/src/core/token-context/runtime.ts | 472 +++++++--
 packages/coding-agent/src/core/tools/read.ts       |  38 +-
 packages/coding-agent/src/modes/interactive/interactive-mode.ts |  67 ++-
 5 files changed (our changes)
```

## Provider Path Evidence

| Check | Result |
|-------|--------|
| Settings `active_safe` reaches runtime | PASS - verified in `_initTokenContextRuntime()` |
| `beforeRead` called on read path | PASS - called unconditionally when `tcRuntime` exists |
| `beforeReadIntercept` false on first read | EXPECTED - no snapshot exists, cache miss |
| `trySmartRead` called after read | PASS - new code path in `read.ts` |
| SmartReadCore produces outline | PASS - language adapters registered, generic fallback available |
| Compact result replaces raw content | PASS - `content` variable overwritten in read tool |
| Hash cache intercept on re-read | PASS - existing path preserved, tests pass |
| `observe_only` returns raw | PASS - no interception, `estimatedSaving: 0` reported |
| `disabled` preserves legacy behavior | PASS - early return in `beforeRead` |

## False-Positive Guards

- `tinyFileThresholdBytes: 64` prevents interception for tiny files
- `mutationSafe: false` on all smart read outputs
- `isFallback` flag preserved on fallback adapters
- Fail-open on adapter errors (I008)
- Session-scoped savings default prevents old persistent events from inflating current report

## CWD
`/Users/hootie/src/pi`

## Validation Satisfied
YES - All targeted tests pass, TypeScript compiles clean, no regressions detected in read tool or slash command tests.

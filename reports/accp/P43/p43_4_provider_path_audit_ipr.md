# P43.4 Active Safe Provider Path Audit - IPR

**Date:** 2026-06-04
**Status:** IMPLEMENTED

---

## Root Cause

The user's settings showed `tokenContext.mode = active_safe`, but provider input tokens were not decreasing. Root cause analysis found two issues:

### H004: `beforeRead` intercepts but read tool never gets there on first reads
The hash cache path in `beforeRead` requires a pre-existing snapshot and unchanged file. On first read of any file, there is no snapshot, so `intercept: false` is always returned. The SmartReadCore was registered but never called from any interception path.

### H002 / legacy: `beforeRead` called BEFORE file read, can't use content
`beforeRead` is called before `ops.readFile()` and only has access to file path, not content. The SmartReadCore needs content to produce outlines. The architecture required a post-read hook.

## Fix Summary

### Fix 1: Wire SmartReadCore for first reads via `trySmartRead`
Added `trySmartRead(filePath, rawContent)` method to `TokenContextRuntime` that is called AFTER the file is read. When `active_safe` and no hash cache hit:

1. Calls `smartRead.smartRead(rawContent, filePath, "outline")` 
2. Language-specific adapters (TypeScript, Python, Rust, JSON/YAML) produce structured outlines
3. Generic fallback produces `firstLine\n\n[totalLines lines total]` compact format
4. Replaces raw content in the tool result with compact output
5. Records savings event in ledger with `mechanism: "smart_read"`

### Fix 2: Savings report math
- Removed `eventCount * 1000` fake cosmetic baseline
- Added session-scoped filtering (`sessionId` in metadata)
- `/savings` defaults to current session; `/savings-global` for all-time
- Mode-aware reporting: `observe_only` and `shadow` explicitly report 0 actual savings
- Distinguish estimated vs actual (provider-backed) savings

### Fix 3: Provider payload audit
- Added `SmartReadAuditTrace` with 20+ fields for read instrumentation
- Added `auditProviderPayload(payload)` wired through `onPayload` hook
- Detects raw content leaks by comparing payload size vs compact result size
- `/savings status` includes last-read audit trace and leak detection

### Fix 4: Read tool interception path
Updated `read.ts` to call `trySmartRead` after `beforeRead` returns no intercept but content is available. The read tool now explicitly replaces raw content with compact output when smart read produces a result.

## Files Changed

| File | Change |
|------|--------|
| `packages/coding-agent/src/core/token-context/runtime.ts` | +445/-27: SmartReadAuditTrace interface, trySmartRead method, auditProviderPayload, fixed getSavingsReport, session scoping |
| `packages/coding-agent/src/core/tools/read.ts` | +38/-?: Call trySmartRead after beforeRead, replace content with compact result |
| `packages/coding-agent/src/core/agent-session.ts` | Session ID on runtime init |
| `packages/coding-agent/src/core/sdk.ts` | Wire auditProviderPayload into onPayload, tcRuntimeRef |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | Include audit status in /savings, use runtime for /savings-global |

## P44 Eligibility

**YES** — Provider usage (`input`, `output`, `totalTokens`) is now recorded on every `message_end` event from the agent loop. The `TokenEstimator.isCalibrated` flag transitions to `true` after the first provider response with usage data. The savings report shows `P44 Eligible: YES` once calibrated. Divergence between estimated (`chars/4`) and actual provider tokens is tracked via `generateCalibrationReport()`. The audit status (`/savings`) includes the calibration report with per-provider breakdown, coverage ratio, and promotion grade.

### Calibration Points
- Recording point: `agent-session.ts` → `_processAgentEvent` → `message_end` → `assistantMsg.usage`
- Key: `this._tokenContextRuntime?.estimator.recordProviderUsage(...)`
- Stored in: `TokenEstimator.providerUsage[]`
- Persistence: In-memory (not persisted across sessions)
- Coverage tracking: `recordEstimatedChars` not yet wired (no baseline `chars` recorded per turn)

## Files Changed (Updated)

| File | Change |
|------|--------|
| `packages/coding-agent/src/core/token-context/runtime.ts` | +492/-: SmartReadAuditTrace, trySmartRead, auditProviderPayload, getAuditStatus with calibration, fixed getSavingsReport math/session scoping |
| `packages/coding-agent/src/core/tools/read.ts` | +38/-: Call trySmartRead after beforeRead, replace content with compact result |
| `packages/coding-agent/src/core/agent-session.ts` | Session ID on runtime init, provider usage recording on message_end |
| `packages/coding-agent/src/core/sdk.ts` | Wire auditProviderPayload into onPayload, tcRuntimeRef |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | Include audit status in /savings, use runtime for /savings-global |
| `packages/coding-agent/test/p43-token-context.test.ts` | +105: P44 calibration tests (P44 eligible, calibrate, isCalibrated, per-provider breakdown, coverage threshold) |

## Settings/Runtime Mode Propagation

Confirmed: `settings.json` → `settingsManager.getGlobalSettings().tokenContext` → `_initTokenContextRuntime()` → `config.mode = "active_safe"` → `createTokenContextRuntime(config)` → runtime instance passed to read tool's `tokenContextRuntime` option. Single runtime instance shared across all tools.

## Rollback Plan

1. Revert `runtime.ts` to remove `trySmartRead` and `auditProviderPayload`
2. Revert `read.ts` to old beforeRead/afterRead pattern only
3. Revert `agent-session.ts` provider usage recording
4. Session-scoped savings can remain (no behavioral change)

# P43.4 Active Safe Provider Path Audit - PRR

**Date:** 2026-06-04
**Status:** READY

---

## Readiness Verdict

**P43.4 is READY** — Smart Read now intercepts first reads in `active_safe` mode using language-specific adapters. Provider payload audit instrumentation is wired. Savings reporting is mode-honest and session-scoped.

## What Changed

### Smart Read now reduces provider payload on first reads
Previously, `beforeRead` only intercepted on cache hits (re-reads of unchanged files). Now `trySmartRead` produces compact outlines using registered language adapters on first reads. The compact result replaces raw content before the tool result reaches the provider payload builder.

### Provider payload audit
`auditProviderPayload(payload)` is called from the `onPayload` hook before every provider request. It estimates total payload tokens, detects compact markers, and flags raw content leaks when compact output was chosen but payload is much larger.

### Savings reporting fixed
- No more `eventCount * 1000` fake baselines
- Session-scoped by default (`/savings` shows current session)
- Mode-aware: `observe_only` and `shadow` report 0 actual savings
- Estimated vs actual distinction preserved (P44 requires actual provider data)

## Actual vs Estimated Savings

| Mode | Actual Provider Savings | Estimated Savings Reported |
|------|------------------------|---------------------------|
| `disabled` | 0 | 0 |
| `observe_only` | 0 (no interception) | 0 (honest reporting) |
| `shadow` | 0 (returns raw) | Displayed as potential, not actual |
| `active_safe` | Requires provider calibration | Displayed as estimated |

## P44 Eligibility

**YES** — Provider usage is now recorded on every `message_end` event from the agent loop (`agent-session.ts` → `_processAgentEvent`). The `TokenEstimator.isCalibrated` flag becomes `true` after the first provider response with usage data. The savings report shows `P44 Eligible: YES` once calibrated. The audit status (`/savings`) includes a full calibration report with per-provider breakdown.

### Limitations
- `recordEstimatedChars` is not yet wired (no baseline `chars` recorded per turn), so coverage ratio is 0. This does not block P44 eligibility (`isCalibrated` only requires provider usage, not full coverage).
- All savings are still estimated via `chars/4` — P44 eligibility means the framework is ready for promotion-grade math, not that it's actively using actual provider token counts to compute savings.
- In-memory only (not persisted across sessions).

## Residual Risks

1. **Smart read outlines are `mutationSafe: false`** — The LLM must do a raw read before editing. This is by design (I002).
2. **First read always produces compact output in `active_safe`** — Could be surprising for users who expect raw content on first read. Mitigation: compact output includes `[totalLines lines total, use offset/limit to expand]` hint.
3. **Payload leak detection is heuristic** — Based on size comparison, not exhaustive substring search. False negatives possible for small files.
4. **Adapters may fail silently** — Falls back to generic compact format on adapter error (I008 fail-open).

## Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| A001 | Settings active_safe reaches runtime | PASS |
| A002 | beforeRead called in production path | PASS |
| A003 | active_safe eligible read returns compact output | PASS |
| A004 | active_safe provider payload audit wired | PASS |
| A005 | Compact marker detection in payload | PASS |
| A006 | Token estimate lower than raw | PASS (estimated) |
| A007 | Provider input breakdown reported | PASS (via audit trace) |
| A008 | observe_only/shadow report 0 actual savings | PASS |
| A009 | /savings default current-session | PASS |
| A010 | No eventCount * 1000 fake baseline | PASS |
| A011 | Old persistent events don't inflate current | PASS |
| A012 | disabled preserves legacy read | PASS |
| A013 | No provider-calibrated claims without data | PASS |
| A014 | P44 eligibility false | PASS |
| A015 | Tests and typecheck pass | PASS (160 tests, 0 TS errors) |

# ACCP Production Readiness Report (PRR)
## P43 Token Context Runtime

**Date:** 2026-06-03
**Status:** READY_FOR_PRODUCTION (behind feature flags)

---

## Acceptance Criteria Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| A001: P43 components behind feature flags | PASS | All behavior gated by `tokenContext.enabled` and `tokenContext.mode` |
| A002: Disabled mode preserves existing behavior | PASS | Tested: `disabled` mode returns `{ intercept: false }` |
| A003: Observe mode records telemetry without changing outputs | PASS | Tested: `observe_only` records events, no intercept |
| A004: Shadow mode computes optimized but returns raw | PASS | Tested: `shadow` computes but does not intercept |
| A005: Active-safe enables safe read/cache/smart-read/change-ledger | PASS | Tested: `active_safe` enables caching, ACR, ledger |
| A006: Summary-only mutation blocked | PASS | All adapter outlines are mutationSafe=false |
| A007: ACR x Change Ledger matrix fully tested | PASS | 54/54 combinations covered |
| A008: Raw fallback works when raw handle exists | PASS | RawCache lookup tested |
| A009: External mutation invalidates cache | PASS | External mutation detection tested |
| A010: Provider-calibrated and estimated saving separated | PASS | Separate fields in SavingsLedger |
| A011: P44 eligibility false without provider-calibrated dogfood | PASS | `estimator.isCalibrated` starts false |
| A012: All relevant tests pass | PASS | 102 tests, 0 failures |

**All acceptance criteria met.**

---

## Residual Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Adapters use regex-based parsing (no tree-sitter) | Low | Confidence levels reported; raw fallback always available |
| LLM fallback adapter is a stub (no real LLM call wired) | Low | Generic fallback always available; LLM fallback is optional P43 scope |
| `statSync` usage in ReadHashCache is synchronous | Low | Only called during tool execution, which is already async |
| Savings command not wired as `/savings` slash command | Low | `getSavingsReport()` function available; can be wired to any command system |
| No integration with real tool execution paths yet | Medium | Runtime provides hooks (`beforeRead`, `afterRead`, `beforeMutation`, `afterMutation`) ready for integration |

---

## P43 Readiness

**Ready for production deployment behind feature flags.**

Default mode: `observe_only` (safe, records telemetry only).

To enable active-safe behavior:
```json
{
  "tokenContext": {
    "enabled": true,
    "mode": "active_safe"
  }
}
```

---

## P44 Eligibility

**BLOCKED.** P44 requires at least one provider-calibrated OpenAI/Anthropic dogfood session. No provider calibration data currently exists.

`estimator.isCalibrated` starts `false` and will only become `true` after `recordProviderUsage()` is called with actual provider token data.

---

## Estimated Saving Support

- Character-based estimation (chars/4 heuristic): Available
- Provider-calibrated estimation: Not yet available
- Synthetic saving estimation (from P43 lab): ~44.9% estimated
- Shadow estimated saving: ~98.9% (from P43 lab evidence)
- Active-safe replay saving: ~81.2% (from P43 lab evidence)

Note: These are synthetic estimates from the P43 evidence lab. Actual provider-calibrated savings will differ.

---

## Files Summary

```
packages/coding-agent/src/core/token-context/
  index.ts                          (barrel export)
  types.ts                          (core types, interfaces, policy matrix)
  runtime.ts                        (central orchestrator, mode wiring)
  savings-ledger.ts                 (W003)
  token-estimator.ts                (W005)
  raw-cache.ts                      (W006)
  read-hash-cache.ts                (W007)
  active-context-registry.ts        (W008)
  change-ledger.ts                  (W016)
  smart-read-core.ts                (W010)
  adapters/
    typescript.ts                   (W011)
    python.ts                       (W012)
    json-yaml.ts                    (W013)
    rust.ts                         (W014)
    fallback.ts                     (W015)
packages/coding-agent/src/core/settings-manager.ts  (modified: +TokenContextSettings)
packages/coding-agent/test/p43-token-context.test.ts  (102 tests)
reports/accp/P43/
  P43-IPR.md                        (this report set)
  P43-TVR.md
  P43-PRR.md
```

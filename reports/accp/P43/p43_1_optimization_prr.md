# P43.1 Token Saving Optimization Hotfix - PRR

**Date:** 2026-06-03
**Status:** READY

---

## P43.1 Verdict: IMPLEMENTED

All 8 P43.1 workstreams complete. 145 tests pass. 0 type errors.
Gauntlet average saving improved from 31.8% to 48.2%.

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| A001: All existing P43 tests still pass | PASS (145 tests, 0 failures) |
| A002: TS adapter range accuracy improved | PASS (10 new edge case tests) |
| A003: Tiny-file passthrough exists | PASS (64-byte threshold, separate counter) |
| A004: ACR × Change Ledger matrix 100% | PASS (54/54) |
| A005: No stale cache escapes | PASS |
| A006: No missed hash mismatches | PASS |
| A007: No summary-only mutation | PASS (mutationSafe=false enforced) |
| A008: Change Ledger checkpoint works | PASS |
| A009: Gauntlet saving improved | PASS (31.8% → 48.2%) |
| A010: RTK hook status visible | PASS (in /savings report) |
| A011: P44 eligibility false | PASS (no provider calibration) |

---

## P43 Readiness: READY

All 20 P43 + 8 P43.1 workstreams complete behind feature flags.

## P44 Eligibility: FALSE

Blocked pending provider-calibrated OpenAI/Anthropic dogfood session.

---

## RTK Hook Status

Current: `unknown` (RTK not detected in PATH)

To enable automatic bash compression:
1. Install RTK: follow RTK installation docs
2. Run `rtk init -g` or `rtk init -g --agent pi`
3. Restart Pi session
4. `/savings` will show `hook_installed`

---

## Top Remaining Token-Saving Opportunities

| Priority | Opportunity | Expected Impact |
|----------|-------------|-----------------|
| 1 | Install RTK hook for bash compression | 85-99% bash output saving |
| 2 | Provider-calibrated dogfood session | Validates estimates, unlocks P44 |
| 3 | Wire runtime into AgentSession tool paths | Collects real session data |
| 4 | Tree-sitter-enhanced adapters | Better symbol precision |
| 5 | no_full_rewrite estimation for edits | Edit/write token savings |

---

## Residual Risks

| Risk | Status |
|------|--------|
| TS adapter uses regex (not tree-sitter) | Acceptable - confidence reported, raw fallback |
| RTK not installed | Detected and reported in /savings |
| Savings are estimated (chars/4) | Labeled "estimated", P44 blocked |
| Runtime not integrated into AgentSession | Behind feature flags, default observe_only |
| Long edit sessions show 0% savings | Correct behavior - edits invalidate cache |

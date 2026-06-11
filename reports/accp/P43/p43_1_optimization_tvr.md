# P43.1 Token Saving Optimization Hotfix - TVR

**Date:** 2026-06-03
**Commit:** pending

---

## Validation Commands

| Command | Exit | Result |
|---------|------|--------|
| `npx vitest run test/p43-token-context.test.ts` | 0 | **145 tests, 0 failures** |
| `npx tsc --noEmit` | 0 | No type errors |

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| SavingsLedger | 6 | PASS |
| TokenEstimator | 4 | PASS |
| RawCache | 5 | PASS |
| ReadHashCache | 6 | PASS |
| ActiveContextRegistry | 7 | PASS |
| ACR × Change Ledger Policy | 9 | PASS |
| SmartReadCore | 7 | PASS |
| TypeScriptAdapter | 8 | PASS |
| P43.1 TS Edge Cases | 10 | PASS |
| PythonAdapter | 5 | PASS |
| JsonYamlAdapter | 6 | PASS |
| RustAdapter | 6 | PASS |
| Generic/LLM Fallback | 7 | PASS |
| ChangeLedger | 8 | PASS |
| Mode Wiring | 8 | PASS |
| Core Invariants | 4 | PASS |
| Summary Mutation Blocked | 1 | PASS |
| Full Matrix (54/54) | 1 | PASS |
| P43.00 Contract | 6 | PASS |
| P43.03 Calibration | 5 | PASS |
| P43.14 Grammar | 5 | PASS |
| P43.01/17 Lab/Gauntlet | 13 | PASS |
| P43.1 Tiny-File | 1 | PASS |
| P43.1 RTK Detection | 2 | PASS |
| P43.1 New Gauntlet Fixtures | 4 | PASS |
| **Total** | **145** | **PASS** |

---

## Gauntlet Results

| Fixture | Saving | Verdict |
|---------|--------|---------|
| ts-small-project | 90.0% | GOOD_SAVINGS |
| py-class-hierarchy | 95.9% | GOOD_SAVINGS |
| json-config-large | 98.2% | GOOD_SAVINGS |
| rust-structs-enums | 0% | LOW_SAVINGS (no repeated reads) |
| mixed-project-many-reads | 0% | LOW_SAVINGS (tiny files) |
| unknown-language-fallback | 0% | LOW_SAVINGS (no repeats) |
| external-mutation-detection | 0% | LOW_SAVINGS (no repeats) |
| ts-edge-symbol-ranges | 97.9% | GOOD_SAVINGS |
| large-repeated-read | 99.6% | GOOD_SAVINGS |
| long-edit-session | 0% | LOW_SAVINGS (edits invalidate cache) |
| **Average** | **48.2%** | |

---

## Safety Verification

| Check | Status |
|-------|--------|
| ACR × Change Ledger matrix 100% covered | YES (54/54) |
| No stale cache escapes | YES |
| No missed hash mismatches | YES |
| No summary-only mutation allowed | YES (mutationSafe=false for all outlines) |
| Change Ledger long-chain checkpoint works | YES |
| Tiny-file passthrough does not claim savings | YES |
| RTK detection does not install anything | YES |
| P44 eligibility remains false | YES |

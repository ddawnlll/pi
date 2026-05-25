# P24 Trust Calibration Report

**Date:** 2026-05-25
**Author:** Automated agent

---

## Overview

Trust calibration measures the reliability and correctness of the autonomous decision-making pipeline. This report covers the policy engine, approval gate, audit ledger, and emergency stop mechanisms — collectively the trust controls.

---

## 1. Policy Engine Accuracy

### Test Results

| Action | Autonomy Level | Expected Decision | Actual Decision | Match |
|--------|---------------|-------------------|-----------------|-------|
| `retry_transient_failure` | 2 | allow | allow | YES |
| `memory_query` | 2 | allow | allow | YES |
| `memory_compact` | 2 | approval_required | approval_required (glob matched) | YES |
| `memory_creation` | 2 | approval_required | approval_required (glob matched) | YES |
| `access_secrets` | 2 | forbidden | forbidden | YES |
| `destructive_cleanup` | 2 | forbidden | forbidden | YES |
| `execute_generated_plan` | 2 | approval_required | approval_required | YES |
| `completely_unknown_action_xz7` | 2 | deny | deny (no rule matched) | YES |
| `some_mysterious_action` | 1 | deny | deny (default deny) | YES |

### Priority Ordering

| Rule Priority | Action | Expected Winner | Actual Winner | Match |
|--------------|--------|-----------------|---------------|-------|
| Low (10): allow | `high_risk_delete` | High (100): deny | High (100): deny | YES |

### Glob Pattern Matching

| Pattern | Actions Matched | Correct |
|---------|----------------|---------|
| `memory_*` | `memory_query`, `memory_compact`, `memory_creation` | YES |
| `retry_*` | `retry_transient_failure` | YES |

**Accuracy Score: 100%** — All 11 policy evaluations returned the expected decision.

---

## 2. Approval Gate Reliability

### Test Results

| Metric | Result |
|--------|--------|
| Approval requests created with unique IDs | PASS |
| Pending requests tracked correctly | PASS |
| Approval correctly transitions to approved state | PASS |
| Rejection correctly transitions to rejected state | PASS |
| Approved requests logged to audit | PASS |
| Rejected requests logged to audit | PASS |
| Default deadline enforced (24h) | PASS |
| No auto-expire of valid requests | PASS |
| Stats tracking (total, pending, approved, rejected) | PASS |

### Stats Accuracy

| Metric | Expected | Actual |
|--------|----------|--------|
| Total requests | 2 | 2 |
| Pending | 1 | 1 |
| Approved | 1 | 1 |
| Rejected | 0 | 0 |

**Accuracy Score: 100%** — All approval gate operations behaved correctly.

---

## 3. Audit Ledger Integrity

### Test Results

| Metric | Result |
|--------|--------|
| Entries persisted and retrievable | PASS |
| Entry contains required fields (id, action, decision, timestamp, actor) | PASS |
| `forbidden` decisions logged with `blocked` result | PASS |
| `allow` decisions logged with `success` result | PASS |
| `deny` (default) decisions logged with `blocked` result | PASS |
| Query by action works | PASS |
| Query by decision works | PASS |
| Stats computation correct | PASS |

### Audit Stats Fidelity

| Metric | Expected | Actual |
|--------|----------|--------|
| Total entries | 3 | 3 |
| By decision: allow | 2 | 2 |
| By decision: deny/forbidden | 1 | 1 |
| By result: success | 2 | 2 |
| By result: blocked | 1 | 1 |
| Computed trust score | 67% | 67% |

**Accuracy Score: 100%** — All audit entries persisted and queried correctly.

---

## 4. Emergency Stop Reliability

### Test Results

| Metric | Result |
|--------|--------|
| Emergency stop activates (blocks autonomous actions) | PASS |
| Emergency stop releases (allows actions again) | PASS |
| canPerform returns `isForbidden: true` during emergency stop | PASS |
| canPerform returns `isForbidden: false` after release | PASS |
| Reason message contains "Emergency stop" | PASS |
| Stop/release logged appropriately | PASS |

**Accuracy Score: 100%** — Emergency stop correctly blocks and releases autonomous actions.

---

## 5. Provenance Tracking

### Test Results

| Metric | Result |
|--------|--------|
| Decision records created with unique IDs | PASS |
| Links stored with source references | PASS |
| Retrieval by target ID works | PASS |
| Stats (total records, total links) accurate | PASS |
| Metadata preserved on links | PASS |

**Accuracy Score: 100%** — Provenance tracker correctly records decision chains.

---

## Overall Trust Score

| Component | Weight | Score | Weighted Score |
|-----------|--------|-------|----------------|
| Policy Engine Accuracy | 30% | 100% | 30.0 |
| Approval Gate Reliability | 25% | 100% | 25.0 |
| Audit Ledger Integrity | 25% | 100% | 25.0 |
| Emergency Stop Reliability | 10% | 100% | 10.0 |
| Provenance Tracking | 10% | 100% | 10.0 |
| **Overall Trust Score** | **100%** | | **100.0%** |

**Verdict: TRUSTED** — All trust controls pass verification. The autonomous decision-making pipeline is reliable and auditable.

# P9.G7 — Governance Ledger Integration & Audit Trail Wiring

## Goal

Wire all G1-G6 components into a single coherent audit trail, require a complete ledger entry before marking a plan done, and validate the end-to-end audit flow with integration tests.

## Acceptance Criteria

| AC | Description | Status | Artifact |
|---|---|---|---|
| AC1 | All G1-G6 components are wired into a single coherent audit trail | PASS | [governance-ledger.ts](../../packages/coding-agent/src/core/governance-ledger.ts) |
| AC2 | Completion gate requires complete ledger entry before marking plan done | PASS | [completion-gate.ts](../../packages/coding-agent/src/core/completion-gate.ts) |
| AC3 | End-to-end audit flow is validated with integration tests | PASS | [remediation-runtime-p9-g7.test.ts](../../packages/coding-agent/test/remediation-runtime-p9-g7.test.ts) |

## Artifacts

| File | Description |
|---|---|
| `packages/coding-agent/src/core/governance-ledger.ts` | Governance ledger implementation with G1-G6 event recording, completion gate, and snapshot |
| `packages/coding-agent/src/core/completion-gate.ts` | Extended with governance ledger compliance check functions |
| `packages/coding-agent/src/core/index.ts` | Exports governance ledger types and new completion gate functions |
| `packages/coding-agent/src/index.ts` | Re-exports governance ledger types for public API |
| `packages/coding-agent/test/remediation-runtime-p9-g7.test.ts` | 22 tests covering all 3 acceptance criteria |
| `README.md` | This index file |

## Implementation

### Governance Ledger (`packages/coding-agent/src/core/governance-ledger.ts`)

The `GovernanceLedger` class provides:
- **G1 recording** — `recordStateTransition()` for remediation runtime state machine events
- **G2 recording** — `recordProposal()` and `recordExecutionRecord()` for proposal/execution DB tracking
- **G3 recording** — `recordApproval()`, `recordChangeRequest()`, `recordSelfModification()` for approval chain events
- **G4 recording** — `recordDryRun()`, `recordValidation()`, `recordValidationFailure()` for dry-run and validation outcomes
- **G5 recording** — `recordBudgetSnapshot()`, `recordPolicyCheck()`, `recordAutonomyClassification()` for budget and policy events
- **G6 recording** — `recordSafetyReport()`, `recordSimulationForecast()`, `recordQueueAudit()` for safety, simulation, and queue events
- **Completion Gate** — `checkCompletionGate()` and `recordCompletionGate()` for governance-enforced completion
- **Snapshot** — `snapshot()` for full ledger state capture
- **Summary** — `computeSummary()` for aggregated statistics by source, category, and severity

### Completion Gate Integration (`packages/coding-agent/src/core/completion-gate.ts`)

Added governance-aware completion gate functions:
- `evaluateGovernanceLedgerCompliance()` — checks ledger completeness
- `evaluateWorkspaceCompletionWithGovernance()` — combines standard + governance checks
- `evaluatePlanCompletionWithGovernance()` — combines standard plan + governance checks
- `CompletionGateRegistry.setGovernanceLedger()` — attaches ledger for automatic compliance checks

### Test Coverage

22 tests across 3 suites:
- **AC1** (10 tests): G1-G6 individual event recording, full lifecycle wiring, summary correctness
- **AC2** (7 tests): Empty ledger, validation failures, error entries, passing gate, gate recording
- **AC3** (5 tests): Full lifecycle audit, governance violation blocking, snapshot integrity, clear/reset, CompletionGateRegistry integration

## Usage

```bash
# Run G7 tests
cd packages/coding-agent
npx vitest --run test/remediation-runtime-p9-g7.test.ts

# Run all remediation runtime tests (G1 + G3 + G4 + G7)
npx vitest --run test/remediation-runtime.test.ts test/remediation-runtime-p9-g3.test.ts test/remediation-runtime-p9-g4.test.ts test/remediation-runtime-p9-g7.test.ts
```

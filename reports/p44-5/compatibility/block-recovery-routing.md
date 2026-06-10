# Block Recovery Routing — P44.5

## Decision

`stage_failure_routes_to_state`

## Frozen Routing Table

This table is authoritative. Every CompletionGate vNext stage failure maps to exactly
one recovery state, one report type, and one retry policy. Implementation must not deviate.

| Stage                           | Failure                           | Recovery State        | Report  | Retry Policy                     |
|---------------------------------|-----------------------------------|-----------------------|---------|----------------------------------|
| DeclaredOutputExistenceStage    | missing_declared_output           | NEEDS_REPAIR          | FPR     | allowed_after_repair             |
| EvidenceLedgerStage             | missing_or_stale_evidence         | NEEDS_REPAIR          | FPR     | allowed_after_evidence_added     |
| ValidationStage                 | test_failed_or_command_invalid    | NEEDS_REPAIR_OR_RAR   | RAR_or_FPR | allowed_after_fix            |
| ScopeAndWriteSetStage           | unauthorized_mutation             | NEEDS_HIR             | HIR     | not_allowed_without_authority    |
| CommitExecutionStage            | transient_git_failure             | RETRYABLE_BLOCKED     | none_or_HIR_after_retry_budget | bounded_retry_allowed |
| CommitExecutionStage            | non_transient_commit_failure      | NEEDS_REPAIR          | FPR     | allowed_after_fix                |
| PostCommitVerificationStage     | commit_missing_expected_files     | NEEDS_REPAIR          | FPR     | allowed_after_repair             |
| CommitMessageComposerStage      | timeout_or_invalid_message        | FALLBACK_MESSAGE_USED | none    | not_needed                       |
| DestructiveOperationGuard       | unpreserved_output_at_risk        | NEEDS_HIR             | HIR     | not_allowed_without_preservation |

## Recovery State Definitions

| State               | Meaning                                                          |
|---------------------|------------------------------------------------------------------|
| NEEDS_REPAIR        | Agent must fix the issue and re-run the completion gate.         |
| NEEDS_REPAIR_OR_RAR | Try repair up to 2 times. If still failing, emit RAR and pause.  |
| NEEDS_HIR           | Human authority required. Emit HIR and pause immediately.        |
| RETRYABLE_BLOCKED   | Transient failure. Retry with bounded budget. After exhausted, HIR. |
| FALLBACK_MESSAGE_USED | LLM failed, deterministic fallback used. Do not block.         |

## Report Type Definitions

| Report | Meaning                                                   |
|--------|-----------------------------------------------------------|
| FPR    | Fix, Proceed, Re-evaluate — agent fixed the issue.        |
| HIR    | Human Intervention Required — cannot proceed without human.|
| RAR    | Regression Assessment Report — validation regression detected. |

## Implementation

In `packages/coding-agent/src/core/completion/completion-recovery-router.ts` (P44.5.08),
implement a deterministic function:

```typescript
function routeStageFailure(
  stage: CompletionGateStageName,
  failure: StageFailureKind,
): RecoveryRoute {
  // Returns { recoveryState, reportType, retryPolicy }
}
```

The implementation must cover all nine rows of the routing table. If a stage/failure
combination is not in the table, return NEEDS_HIR by default (fail-safe).

## Integration

- `CompletionGateVNext` (P44.5.02) calls the recovery router after each stage's verdict.
- `TransitionRouter` (P44.5.08) uses recovery routes to transition workspace state.
- Dashboard/Read Model (P44.5.09) exposes recovery state in WorkspaceTruthStatus.

# Rollout Migration Plan — P44.5 Completion Gate vNext

## Decision

`warn_then_block` — phased rollout with retroactive backfill

## Rollout Mode Sequence

| Mode                  | Behavior                                                          |
|-----------------------|-------------------------------------------------------------------|
| `off`                 | CompletionGate vNext disabled. Legacy completion gate used.       |
| `shadow`              | vNext verdicts computed and logged but do not affect completion.  |
| `warn`                | Dashboard/read model show warnings, completion remains legacy.    |
| `block_strict_plans`  | P44/P45/stable_3 strict plans block on vNext failures.            |
| `block_all_stable_3`  | All stable_3 plans use vNext blocking semantics.                  |

## Initial Mode and Promotion

- **Initial mode**: `shadow`
- **Promotion mode**: `block_strict_plans`
- **Transition gates**: Each mode transition requires:
  1. At least one completed plan execution in the current mode
  2. No P0 or P1 issues discovered in shadow/warn phases
  3. Dashboard truth fields showing correct state

## Mode Transition Path

```
off → shadow → warn → block_strict_plans → block_all_stable_3
          ↑        ↑              ↑                   ↑
      P44.5.13   (after       (after validation     (long-term
      initial    several       confirms no false     target)
      deploy)    plans)        positives)
```

## Retroactive Backfill

### Purpose

Legacy COMPLETE workspaces (completed before P44.5 deployment) have no commit hash,
no post-commit verification, and no durability status. Without backfill, the dashboard
would show `verifiedComplete: unknown` for all historical workspaces.

### Policy

- **Mutates historical state**: NO — backfill is a read-model projection only.
- **Output**: `verifiedCompleteBackfillStatus` field on workspace read model.
- **Values**:
  - `verifiedComplete: null` and `backfillStatus: "legacy_no_commit_data"` for workspaces
    completed before P44.5 that have no commit hash in their state.
  - `backfillStatus: "legacy_commit_present"` for workspaces with a commit hash but
    no post-commit verification data.

### Implementation

`packages/coding-agent/src/core/completion/verified-complete-backfill.ts` (P44.5.11):

```typescript
function computeBackfillStatus(
  workspaceState: WorkspaceState,
  completionDate: Date,
): VerifiedCompleteBackfillStatus {
  // If workspace has commitHash and postCommitVerification, no backfill needed
  // If workspace has commitHash but no postCommitVerification, return "legacy_commit_present"
  // If workspace has no commitHash, return "legacy_no_commit_data"
  // Never mutates workspaceState — pure read-model projection
}
```

## Dashboard Integration

The Dashboard `WorkspaceTruthStatus` component (P44.5.09) must:

1. Show separate fields: runtimeStatus, implementationStatus, validationStatus,
   durabilityStatus, verifiedComplete.
2. Never show `verifiedComplete: true` from runtime complete alone.
3. Display `backfillStatus` for legacy workspaces with an explicit "legacy data" indicator.
4. Show block recovery state when workspace is in a recovery state.

## Migration Monitoring

During shadow and warn phases, the read model collects:

- Count of workspaces that would have been blocked in strict mode
- Count of workspaces with missing commit hash
- Count of workspaces with failed post-commit verification
- Recovery route distribution (NEEDS_REPAIR, NEEDS_HIR, etc.)

These metrics are exposed via the query handler for monitoring dashboards.

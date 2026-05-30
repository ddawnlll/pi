# Recovery Instructions

## Recover the currently broken P37 run

1. Restart the server/executor process so old in-memory worker promises and stale active registry entries are gone.
2. Open the P37 run in the dashboard and inspect the new Execution Stability / Control Plane Health panel.
3. Preserve logs before retrying:
   - `.pi/execution-<planExecId>.log`
   - execution journal for the plan
   - worker transcript/log files under `.pi/executions/<planExecId>/`
   - this report directory
4. Use the dashboard Continue/Rerun action for the failed/stopped/cancelled run.
5. Verify completed workspaces remain Complete.
6. Verify only failed, blocked, pending, or stranded active workspaces are reset/rerun.

## Safely reset only affected failed/blocked workspaces

Use the supported Continue/Rerun path only:

- Dashboard: Rerun/Continue button on failed/stopped/cancelled plan.
- API: `POST /api/projects/:projectId/plans/:planExecId/rerun`.

Do not directly update workspace rows to Pending. The supported path preserves completed workspaces, terminalizes stranded active work, rebuilds executor state, and emits diagnostics.

## Avoid manual DB mutation

Manual DB mutation is not required for normal recovery after this fix. Do not edit production DB state automatically.

If supported Continue fails, first check whether queue snapshot or plan metadata is missing. The API now returns an actionable error for that case.

## If queue snapshot is missing

1. Check for `.pi/<planExecId>.workspace-queue.json`.
2. Check for `.pi/<planExecId>.meta.json`.
3. Check whether the meta file points to an existing plan file under `.pi/plans/`.
4. If either the queue snapshot exists or meta can locate the plan file, Continue should reconstruct recovery.
5. If both queue snapshot and plan metadata are missing, rerun from the original plan file. Completed workspace history may not be safely recoverable without manual reconstruction.

## If manual SQL is absolutely required

Do not run SQL automatically. If all supported recovery paths fail and a maintainer approves manual intervention, use a transaction, target only the affected plan execution, and preserve a DB backup first. Manual mutation risks corrupting attempt history and should only be used after queue/metadata recovery is impossible.

High-level shape only, not to run blindly:

```sql
BEGIN;
-- Inspect plan/workspace state for the affected plan_execution_id.
-- Update only failed/blocked workspaces caused by stale completion bugs.
-- Preserve complete workspaces.
-- Do not mark Pending -> Complete or bypass attempt FSM semantics.
COMMIT;
```

## Logs to preserve

- Full server stdout/stderr around stop/continue.
- Execution journal rows/events for the plan.
- Worker transcript events showing `worker_decision_summary COMPLETE`, validation, lock release, and stale/illegal events.
- Queue snapshot and meta file if present.
- Dashboard API responses for failed Continue/Rerun.

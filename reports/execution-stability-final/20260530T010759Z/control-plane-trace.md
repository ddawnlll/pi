# Control Plane Trace

## Stop button trace

Stop writes a control request/state transition, runner reloads DB state, active workspaces are drained, agents are aborted, plan-scoped processes are killed, locks are released, and stop events are written to the journal.

## Continue button trace

Dashboard rerun endpoint checks status/resettable work/queue metadata, calls continuePlanExecution, which recovers the execution with allowTerminal and preserves complete workspaces.

## Rerun/recover trace

recoverSingleExecution creates a fresh AutonomousExecutor and calls adoptExistingExecution(..., { allowTerminal: true }). Active/failed/blocked workspaces are reset through recovery; completed workspaces remain complete.

## State transition trace

Pending -> Active -> Complete/Failed/Blocked remains the legal path. Pending -> Complete/Succeeded is still illegal and guarded before TransitionRouter.

## Old executor stale completion trace

Old executor completion reloads DB state. If workspace is Pending/stopped/cancelled or attempt mismatches, stale_attempt_completion_ignored is emitted and no router transition is attempted.

## DB vs cache truth comparison

DB state is authoritative at runner loop top and stale completion checks. In-memory registry disagreement emits active_registry_db_mismatch.

## Active registry vs DB truth comparison

Registry stopped/cancelled cannot override DB running truth; DB stopped/cancelled drains and exits even when registry disagrees.

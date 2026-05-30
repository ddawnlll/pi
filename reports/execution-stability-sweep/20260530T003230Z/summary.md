# P37.STABILITY Execution Control Plane Reliability Sweep

## Executive summary

The execution control plane had a real stop/continue race. Stop could update PostgreSQL plan state and wake the runner without forcing the active executor path through the drain/terminalize code. Continue could then reset failed or stranded workspaces while old worker promises were still able to complete. A stale completion could therefore reach the TransitionRouter as a completion for a workspace that PostgreSQL now showed as Pending, causing the correct FSM rejection: `PENDING -> SUCCEEDED`.

This pass keeps the FSM strict and fixes the executor/runner paths that tried to act on stale in-memory state.

## What was broken

- Stop API wrote stopped DB state and signalled the bus, but the runner could return from the DB-stopped or wait-signal path without terminalizing active workspaces.
- Crash recovery deleted queue/meta snapshots for failed/stopped/cancelled executions, making later Continue return: `Execution could not be continued. It may be complete or missing its queue snapshot/plan metadata.`
- Stale completion protection existed in one completion-gate path but not before all completion transitions, including lead-role completion.
- Active registry state could disagree with PostgreSQL and the runner did not surface that mismatch.
- Dashboard showed plan/workspace data but not control-plane health, stale connection state, or continue/stop recovery diagnostics.

## What was fixed

- Added DB-truth stale completion guard before any workspace completion transition.
- Added stale completion journal events and `illegal_transition_prevented_before_router` diagnostics.
- Added a public runner drain entrypoint that aborts executors, waits for in-flight promises with timeout, kills plan-scoped processes, releases locks, and terminalizes Active workspaces to Failed.
- Runner now drains active work when PostgreSQL says stopped/cancelled and emits `active_registry_db_mismatch` and `runner_stopped_by_db_state`.
- Runner now drains active work when a stop signal arrives while waiting on active workers.
- Recovery no longer deletes queue/meta snapshots for failed/stopped/cancelled executions.
- Continue route now reports queue/metadata missing and no resettable workspaces with actionable errors and journal events.
- Dashboard now shows an Execution Stability / Control Plane Health panel with connection status, last event timestamp, real queue counts, stale ignored completions, last control event, and critical stability events.
- Worker detail now has a Pi CLI tab that mirrors the raw workspace agent log stream instead of the summarized transcript.
- Dashboard control commands now have an in-flight guard and invalidate backend state after control actions.

## What was not fixed

- No large scheduler rewrite or service split was performed.
- No event-sourcing migration was performed.
- No patch transaction architecture expansion was performed.
- Existing missing queue snapshots from prior cleanup cannot always be reconstructed automatically; see recovery.md.

## Issue table

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| P37-001 | P0 | fixed | Stop could be cosmetic when DB stopped state bypassed executor drain. |
| P37-002 | P0 | fixed | Late stale worker completion could attempt completion after Continue reset workspace to Pending. |
| P37-003 | P0 | fixed | Crash recovery deleted queue/meta for stopped/failed/cancelled executions, blocking Continue. |
| P37-004 | P0 | fixed | Active registry could silently diverge from PostgreSQL stopped/cancelled state. |
| P37-005 | P1 | fixed | Dashboard did not show control-plane health or stale event stream state. |
| P37-006 | P1 | fixed | Continue/rerun errors were too generic for queue-missing/no-resettable cases. |
| P37-007 | P2 | reported | Full scheduler/service split remains out of scope. |

## Root cause details

The FSM correctly rejects `PENDING -> SUCCEEDED`. The illegal transition came from an executor path acting on stale assumptions. PostgreSQL had already been changed by Stop/Continue, but an old workspace promise retained enough local context to finish validation and try a completion transition.

The runner worsened this by allowing stop handling to short-circuit: when DB status was already stopped/cancelled, it called `stopAllActiveWorkspaces()` and returned. That method aborted executors/processes but did not terminalize Active workspaces through the stop drain path. Continue could then see resettable work and reset to Pending while the old worker path still existed.

## Code paths traced

- Stop button: `App.tsx` -> `sendControlCommand("stop")` -> `POST /api/executions/:planExecId/control` -> `stateStore.stopPlan()` + `writeControlRequest("stop")` + `signalExecutionEvent("stop")`.
- Continue button: `App.tsx` rerun dialog -> `POST /api/projects/:projectId/plans/:planExecId/rerun` -> `continuePlanExecution()` -> `recoverSingleExecution(... allowTerminal: true)` -> `AutonomousExecutor.adoptExistingExecution()`.
- Stale completion: `executeWorkspace()` old promise resolves -> completion-gate/lead path -> previously could call `transitionWorkspace(... Complete)` while DB workspace was Pending.
- DB vs cache truth: `isAttemptStale()` now reloads state from stateStore before completion transition.

## Files changed

- `packages/coding-agent/src/core/autonomous-executor.ts`
- `packages/coding-agent/src/core/plan-state.ts`
- `packages/coding-agent/test/execution/stop-continue-race.test.ts`
- `packages/web-server/src/plan-runner.ts`
- `packages/web-server/src/index.ts`
- `packages/web-ui/dashboard/src/App.tsx`
- `packages/web-ui/dashboard/src/hooks/usePlanEvents.ts`
- `packages/web-ui/dashboard/src/components/WorkerDetail.tsx`
- `packages/coding-agent/src/core/workspace-agent-executor.ts`

## Tests added/updated

- Added `packages/coding-agent/test/execution/stale-attempt-completion.test.ts`.
- Added `packages/coding-agent/test/execution/stop-drain-active-workers.test.ts`.
- Added `packages/coding-agent/test/execution/continue-failed-plan.test.ts`.
- Added `packages/coding-agent/test/execution/stop-idempotency.test.ts`.
- Updated `packages/coding-agent/test/execution/stop-continue-race.test.ts` for current Workspace typing and stop/continue race coverage.

Server and dashboard route/component tests are still recommended follow-up; this pass used focused low-memory core regressions plus full type/lint validation.

## Test results

- `NODE_OPTIONS=--max-old-space-size=1024 npx vitest run packages/coding-agent/test/execution/stop-continue-race.test.ts --maxWorkers=1` — passed, 15 tests.
- `NODE_OPTIONS=--max-old-space-size=1024 npx vitest run packages/coding-agent/test/execution/stale-attempt-completion.test.ts packages/coding-agent/test/execution/stop-drain-active-workers.test.ts packages/coding-agent/test/execution/continue-failed-plan.test.ts packages/coding-agent/test/execution/stop-idempotency.test.ts --maxWorkers=1` — passed, 4 tests.
- `npm run check` — passed before the later Pi CLI visibility addendum.
- `cd packages/web-ui && npm run check` — passed after the Pi CLI tab change.
- Later root `npm run check` was blocked by unrelated pre-existing/untracked patch-coordinator warnings/errors under `packages/coding-agent/src/core/execution/patch/`.

## Dashboard visibility changes

The run view now includes `Execution Stability / Control Plane Health` showing:

- DB plan status.
- SSE connection status and last event timestamp.
- Stale stream warning.
- Ready/active/blocked/failed/complete counts.
- Stale ignored completion count.
- Last stop/continue control event.
- Recent critical stability events.
- Last visible control error.

Worker detail now includes a `Pi CLI` tab that shows the raw workspace agent log stream with live assistant text chunks, status lines, tool events, and auto-scroll controls. This is separate from the sanitized transcript tab.

## Manual recovery instructions

See `recovery.md` in this report directory.

## Remaining risks

- If a prior process already deleted both queue snapshot and plan metadata, Continue may still fail. The route now reports this clearly.
- Existing active work that was spawned before this code is deployed must be stopped by restarting the server/executor process.
- Some process cleanup is best-effort where process ownership metadata is incomplete.

## Follow-up recommendations

- Add dedicated server-route tests for the new queue-missing/no-resettable Continue errors.
- Add dashboard component tests for button state and stability panel rendering.
- Persist richer attempt identity metadata for stronger stale-attempt ownership checks.
- Replace old inline dynamic imports opportunistically in a separate cleanup pass.

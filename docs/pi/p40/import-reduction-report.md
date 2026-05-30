# P40.1E — Import Reduction Report

**Date:** 2026-05-30

## Before / After Counts

| Import Target | Before | After | Delta |
|---|---|---|---|
| execution-kernel (direct) | 20 | 19 | -1 |
| execution-core (consumers) | 6 | 7 | +1 |
| execution-service (callers) | 0 | 8 | +8 |
| worker-adapter (direct imports) | 3 | 4 | +1 |
| state-store (mutation APIs) | 2 | 2 | unchanged |

## Imports Migrated

1. `index.ts` — `AttemptState, StateAuthorityToken` now re-exported through `execution-core/index.js` instead of direct from `execution-kernel/types.js`

## New Runtime Callers Added

1. `autonomous-executor.ts` — imports and calls `handleExecutionCommand` from `execution-service/command-handler.js` in stop handling path
2. `autonomous-executor.ts` — auto-creates `LocalPiWorkerAdapter` from `worker-adapter/local-pi-worker-adapter.js` as default adapter
3. `autonomous-executor.ts` — imports `WorkerAdapter, WorkerRunRequest` types from `worker-adapter/types.js`

## Remaining Legacy Direct Imports

| File | Import | Reason |
|---|---|---|
| `execution-kernel/transition-router.ts` | `IStateStore` | Deeply coupled, not safe to move |
| `cli/plan-commands.ts` | `createStateStore` | File-based CLI path, stable |
| `execution-kernel/index.ts` | (re-exports) | Gradual migration |
| `observability/collectors/` | event-schema types | Observability layer, low risk |
| `brain/v5/` | ActorEvent types | Type-only, low risk |
| `core/execution-profile.ts` | deriver, normalizer | Deeply coupled |
| `core/cleanup-review.ts` | admission-gate | Deeply coupled |
| `core/workspace-agent-executor.ts` | ActorEventSink | Type-only |
| `core/lease-monitor.ts` | ActorEventSink | Type-only |
| `core/validation-runner.ts` | ActorEventSink | Type-only |
| `failure/retry-router.ts` | ActorEvent | Type-only |

## execution-core Real Consumers

1. `execution-service/command-handler.ts` — imports `ExecutionCommand`
2. `execution-service/query-handler.ts` — imports read model types
3. `brain/boundary.ts` — imports `BrainProposal, ExecutionReadModel`
4. `brain/execution-read-client.ts` — imports read model types
5. `brain/proposal-contract.ts` — imports `BrainProposal, ExecutionCommand`
6. `index.ts` — re-exports `AttemptState, StateAuthorityToken`
7. `execution-service/index.ts` — re-exports types

## execution-service Real Callers

1. `autonomous-executor.ts` — calls `handleExecutionCommand` in stop handling
2. `index.ts` — exports `handleExecutionCommand, createExecutionReadModel`

## WorkerAdapter Runtime Usage

1. `autonomous-executor.ts` — auto-creates `LocalPiWorkerAdapter` as default adapter
2. `autonomous-executor.ts` — uses adapter's `run()` method for workspace execution
3. `autonomous-executor.ts` — passes `abortSignal` through WorkerRunRequest
4. `worker-adapter/local-pi-worker-adapter.ts` — wraps `WorkspaceAgentExecutor`

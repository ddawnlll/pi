# P40 Migration Notes

## Current Phase: P40.1 — Physical Package Extraction

**Corrected direction:** The P40.0 scaffold created internal folders under `packages/coding-agent/src/`. This is NOT sufficient. P40.1 physically extracts execution contracts into separate workspace packages.

## New Packages Created

- `packages/execution-core/` (`@earendil-works/pi-execution-core`) — Canonical execution contracts
- `packages/execution-service/` (`@earendil-works/pi-execution-service`) — Command/query facades
- `packages/worker-adapters/` (`@earendil-works/pi-worker-adapters`) — Worker adapter implementations

## Old Scaffold Paths → Compatibility Shims

The old internal-boundary scaffold paths become compatibility shims re-exporting from the new packages:

- `packages/coding-agent/src/execution-core/index.ts` → re-exports from `@earendil-works/pi-execution-core`
- `packages/coding-agent/src/execution-service/index.ts` → re-exports from `@earendil-works/pi-execution-service`
- `packages/coding-agent/src/worker-adapter/index.ts` → re-exports from `@earendil-works/pi-worker-adapters`

## Dependency Rules

- `packages/execution-core` must NOT import `packages/coding-agent`
- `packages/execution-service` must NOT permanently depend on `packages/coding-agent` (temporary bridge must be marked)
- `packages/worker-adapters` may import `packages/coding-agent` internals (bridge role)
- `packages/coding-agent` may import `@earendil-works/pi-execution-core` contracts

## Backward Compatibility

- Old import paths (`../execution-core/`, `../execution-service/`, `../worker-adapter/`) continue to work via shims
- AutonomousExecutor without workerAdapter → falls back to direct construction
- All existing entrypoints continue to work

## Not Changing

- `execution-kernel/` — deeply coupled, stays in coding-agent
- `core/state-store.ts` — stays in coding-agent
- `core/completion-gate.ts` — stays in coding-agent
- `core/workspace-agent-executor.ts` — stays in coding-agent
- `core/autonomous-executor.ts` — stays in coding-agent (imports from new packages)

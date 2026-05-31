# P40.1E — Import Reduction Report (Updated)

**Date:** 2026-05-30
**Updated:** 2026-05-30 (P40.1 — physical package extraction)

## Before / After Counts

| Import Target | Before (P40.0) | After (P40.1) | Delta |
|---|---|---|---|
| execution-kernel (direct) | 19 | 19 | 0 |
| execution-core (consumers) | 6 | 8 | +2 |
| execution-service (callers) | 0 | 3 | +3 |
| worker-adapter (direct imports) | 3 | 3 | 0 |
| @earendil-works/pi-execution-core (consumers) | 0 | 8 | +8 |
| @earendil-works/pi-execution-service (consumers) | 0 | 3 | +3 |
| @earendil-works/pi-worker-adapters (consumers) | 0 | 3 | +3 |
| state-store (mutation APIs) | 2 | 2 | 0 |

## Physical Package Extraction

P40.1 extracted the P40.0 scaffold from internal `coding-agent/src/` paths into real workspace packages:

- `packages/coding-agent/src/execution-core/` → `packages/execution-core/` (`@earendil-works/pi-execution-core`)
- `packages/coding-agent/src/execution-service/` → `packages/execution-service/` (`@earendil-works/pi-execution-service`)
- `packages/coding-agent/src/worker-adapter/` → `packages/worker-adapters/` (`@earendil-works/pi-worker-adapters`)

Old paths are now compatibility shims re-exporting from the new packages.

## Imports Redirected (via shims)

All P40.0 scaffold imports now resolve through the new package exports:

1. `execution-core/types.ts` → re-exports from `@earendil-works/pi-execution-core`
2. `execution-core/index.ts` → re-exports from `@earendil-works/pi-execution-core` + remaining coding-agent types
3. `execution-service/command-handler.ts` → re-exports from `@earendil-works/pi-execution-service`
4. `execution-service/query-handler.ts` → re-exports from `@earendil-works/pi-execution-service`
5. `execution-service/index.ts` → re-exports from `@earendil-works/pi-execution-core` + `@earendil-works/pi-execution-service`
6. `worker-adapter/types.ts` → re-exports from `@earendil-works/pi-execution-core`
7. `worker-adapter/local-pi-worker-adapter.ts` → re-exports from `@earendil-works/pi-worker-adapters`
8. `worker-adapter/index.ts` → re-exports from `@earendil-works/pi-execution-core` + `@earendil-works/pi-worker-adapters`

## execution-core Real Consumers (8)

1. `execution-service/src/command-handler.ts` — type import (canonical)
2. `execution-service/src/query-handler.ts` — type import (canonical)
3. `execution-service/src/index.ts` — type re-export
4. `worker-adapters/src/local-pi-worker-adapter.ts` — type import (canonical)
5. `coding-agent/src/execution-core/index.ts` — shim re-export
6. `coding-agent/src/execution-core/types.ts` — shim re-export
7. `coding-agent/src/worker-adapter/types.ts` — shim re-export
8. `coding-agent/src/worker-adapter/index.ts` — shim re-export

## execution-service Real Callers (3)

1. `coding-agent/src/core/autonomous-executor.ts` — runtime (calls `handleExecutionCommand` in stop handling)
2. `coding-agent/src/execution-service/command-handler.ts` — shim re-export
3. `coding-agent/src/execution-service/index.ts` — shim re-export

## WorkerAdapter Runtime Usage

1. `autonomous-executor.ts` — auto-creates `LocalPiWorkerAdapter` as default adapter (via shim → worker-adapters)
2. `autonomous-executor.ts` — uses adapter's `run()` method for workspace execution
3. `autonomous-executor.ts` — passes `abortSignal` through WorkerRunRequest
4. `WorkerAdapter` type imported from `@earendil-works/pi-execution-core` (canonical)

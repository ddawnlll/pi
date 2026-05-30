# P40 Migration Notes

## New Boundary Modules

- `worker-adapter/` — WorkerAdapter interface and LocalPiWorkerAdapter
- `execution-core/` — Canonical execution types
- `execution-service/` — Command/query facades
- `brain/boundary.ts` — BrainBoundary class
- `brain/execution-read-client.ts` — BrainExecutionReadClient
- `brain/proposal-contract.ts` — Proposal creation helpers

## Backward Compatibility

- AutonomousExecutor without workerAdapter → falls back to direct construction
- All existing entrypoints continue to work

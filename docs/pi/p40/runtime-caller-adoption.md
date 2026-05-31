# P40 Runtime Caller Adoption

**Date:** 2026-05-30
**Status:** Partial

## execution-service Callers

### Active (P40.1)

1. **AutonomousExecutor stop handling** — calls `handleExecutionCommand` in `checkControlRequest()`
   - Path: `core/autonomous-executor.ts` → `../execution-service/command-handler.js` (shim) → `@earendil-works/pi-execution-service`

### Deferred (P41)

1. **Web server control endpoint** — use `handleExecutionCommand` for stop/pause/resume
2. **CLI commands** — use `handleExecutionCommand` for stop/cancel
3. **Read model** — wire `createExecutionReadModel` in web server query endpoints

## WorkerAdapter Runtime Usage

Active (P40.1):
1. **AutonomousExecutor** — auto-creates `LocalPiWorkerAdapter` as default
2. **AutonomousExecutor** — uses `adapter.run()` for workspace execution
3. **AutonomousExecutor** — passes `abortSignal` through `WorkerRunRequest`

All WorkerAdapter types imported from `@earendil-works/pi-execution-core` (canonical).

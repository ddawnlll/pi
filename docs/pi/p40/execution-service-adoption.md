# P40.1D — execution-service Adoption

**Date:** 2026-05-30

## Routes Migrated

1. **AutonomousExecutor.stop handling** — routes stop_plan through `handleExecutionCommand` from execution-service
   - File: `core/autonomous-executor.ts`
   - Path: `checkControlRequest() → case "stop" → handleExecutionCommand`

## Routes NOT Migrated (Deferred)

1. **Web server control endpoint** (`POST /api/executions/:planExecId/control`)
   - Reason: Web server is a separate package, uses `@earendil-works/pi-coding-agent` public API
   - execution-service now exported from public API — available for P41 adoption
   
2. **CLI stop/pause/cancel commands**
   - Reason: File-based CLI (no planExecutionId), uses PlanControlManager directly
   - Potentially migratable in P41

## Adapter Wired

execution-service command-handler is called at runtime by AutonomousExecutor when handling stop requests. The call passes the stop command with planExecutionId and adapts the state store's `writeControlRequest` method as the PlanControlManager dependency.

## Status

- execution-service has real runtime callers ✅
- PACKAGE EXPORTED (available for web server P41 adoption)
- CLI deferred to P41

# P40.1D — execution-service Adoption

**Date:** 2026-05-30
**Updated:** 2026-05-30 (P40.1 — physical package extraction)

## Routes Migrated

1. **AutonomousExecutor.stop handling** — routes stop_plan through `handleExecutionCommand` from execution-service
   - File: `core/autonomous-executor.ts`
   - Path: `checkControlRequest() → case "stop" → handleExecutionCommand`
   - Note: Now resolves via compatibility shim → `@earendil-works/pi-execution-service`

## Package Status

execution-service has been extracted to **`packages/execution-service/`** (`@earendil-works/pi-execution-service`).

The old internal scaffold path `packages/coding-agent/src/execution-service/` is now a compatibility shim re-exporting from the new package.

## Routes NOT Migrated (Deferred)

1. **Web server control endpoint** (`POST /api/executions/:planExecId/control`)
   - Reason: Web server is a separate package, uses `@earendil-works/pi-coding-agent` public API
   - `@earendil-works/pi-execution-service` now available — ready for P41 adoption
   
2. **CLI stop/pause/cancel commands**
   - Reason: File-based CLI (no planExecutionId), uses PlanControlManager directly
   - Potentially migratable in P41

## Status

- execution-service has real runtime callers ✅
- execution-service is a real workspace package ✅
- PACKAGE EXPORTED (available for web server P41 adoption) ✅
- CLI deferred to P41

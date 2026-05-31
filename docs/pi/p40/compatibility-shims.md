# P40 Compatibility Shims

**Date:** 2026-05-30
**Status:** Active

## Purpose

Compatibility shims ensure backward compatibility during the physical package extraction. Old import paths under `packages/coding-agent/src/execution-core/`, `packages/coding-agent/src/execution-service/`, and `packages/coding-agent/src/worker-adapter/` continue to work by re-exporting from the new package locations.

## Shim Inventory

### execution-core

| File | Re-exports from | Notes |
|---|---|---|
| `src/execution-core/types.ts` | `@earendil-works/pi-execution-core` | Clean re-export |
| `src/execution-core/index.ts` | `@earendil-works/pi-execution-core` + `../execution-kernel/types.js` + `../core/lead-agent/types.js` | Partial — some types still in coding-agent |

### execution-service

| File | Re-exports from | Notes |
|---|---|---|
| `src/execution-service/command-handler.ts` | `@earendil-works/pi-execution-service` | Clean re-export |
| `src/execution-service/query-handler.ts` | `@earendil-works/pi-execution-service` | Clean re-export |
| `src/execution-service/index.ts` | `@earendil-works/pi-execution-core` + `@earendil-works/pi-execution-service` | Partial re-export |

### worker-adapter

| File | Re-exports from | Notes |
|---|---|---|
| `src/worker-adapter/types.ts` | `@earendil-works/pi-execution-core` | Clean re-export |
| `src/worker-adapter/local-pi-worker-adapter.ts` | `@earendil-works/pi-worker-adapters` | Clean re-export |
| `src/worker-adapter/index.ts` | `@earendil-works/pi-execution-core` + `@earendil-works/pi-worker-adapters` | Partial re-export |

## Removal Criteria

Shims can be removed when:
1. All importers use canonical package paths directly
2. `coding-agent/src/index.ts` exports from canonical packages
3. Brain boundary files import from canonical packages
4. Execution-kernel types are no longer re-exported through execution-core shim

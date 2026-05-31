# P40 Boundary Audit — Current System State

**Date:** 2026-05-30
**Updated:** 2026-05-30 (P40.1 — physical package extraction)
**Baseline:** P39 stable_3 golden path

## Key Coupling Points

1. **AutonomousExecutor → WorkspaceAgentExecutor** — direct construction (now has adapter path)
2. **Brain → execution-kernel** — only type imports (ActorEventSink)
3. **Web Server → state-store-provider** — uses public API (acceptable)
4. **Dashboard** — already decoupled via HTTP/WebSocket

## Corrected Assessment

The P40.0 scaffold created internal boundary files under `packages/coding-agent/src/`. This is **insufficient** for physical separation. The following must be extracted to workspace packages outside `packages/coding-agent`:

- `packages/coding-agent/src/execution-core/` → `packages/execution-core/`
- `packages/coding-agent/src/execution-service/` → `packages/execution-service/`
- `packages/coding-agent/src/worker-adapter/` → `packages/worker-adapters/`

## Boundary Extraction Order

1. WorkerAdapter boundary — physical extraction to packages/execution-core and packages/worker-adapters
2. Execution core boundary — physical extraction to packages/execution-core
3. Execution service boundary — physical extraction to packages/execution-service
4. Brain boundary enforcement — remains via type imports from @earendil-works/pi-execution-core

## Remaining Couplings (Deferred from P40)

- `coding-agent/src/execution-kernel/` — deeply coupled to DB/Postgres, stays
- `coding-agent/src/core/state-store.ts` — IStateStore interface, stays
- `coding-agent/src/core/completion-gate.ts` — P37-stabilized, stays
- `coding-agent/src/core/autonomous-executor.ts` — runtime orchestrator, stays
- `coding-agent/src/core/workspace-agent-executor.ts` — worker implementation, stays
- `web-server/src/` — uses @earendil-works/pi-coding-agent public API

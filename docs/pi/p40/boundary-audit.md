# P40 Boundary Audit — Current System State

**Date:** 2026-05-30
**Baseline:** P39 stable_3 golden path

## Key Coupling Points

1. **AutonomousExecutor → WorkspaceAgentExecutor** — direct construction (now has adapter path)
2. **Brain → execution-kernel** — only type imports (ActorEventSink)
3. **Web Server → state-store-provider** — uses public API (acceptable)
4. **Dashboard** — already decoupled via HTTP/WebSocket

## Boundary Extraction Order

1. WorkerAdapter boundary ✅
2. Execution core boundary ✅
3. Execution service boundary ✅
4. Brain boundary enforcement ✅

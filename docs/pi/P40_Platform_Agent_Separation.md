# P40 — Platform / Agent Separation

**Phase:** P40
**Title:** Platform / Agent Separation
**Historical Origin:** Execution / Brain / Agent Separation (P34)
**Status:** In Progress
**Last Updated:** 2026-05-30
**Execution Class:** `architecture_refactor`
**Selected Mode:** `stable_3_boundary_extraction`
**Target Promotion Mode:** `stable_3`

> This plan supersedes P34. P34 provided the original boundary doctrine; P40 updates it after P38/P39 stabilization and turns it into actual platform/agent separation.

## Current Status

### P40.0 — Boundary Scaffold: COMPLETE
- WorkerAdapter interface + LocalPiWorkerAdapter
- execution-core types (ExecutionCommand, ExecutionReadModel, BrainProposal)
- execution-service command/query handler facades
- brain boundary files (BrainBoundary, BrainExecutionReadClient, proposal-contract)
- 38 boundary tests
- AutonomousExecutor accepts WorkerAdapter in config, auto-creates LocalPiWorkerAdapter as default

### P40.1 — Real Adoption: PARTIAL
- WorkerAdapter default path: DONE
- execution-core real consumers: DONE (index.ts, execution-service, brain)
- execution-service real callers: PARTIAL (AutonomousExecutor stop handler)
- execution-service package export: DONE (available for web server P41)
- Web server integration: DEFERRED to P41
- CLI integration: DEFERRED (file-based, no planExecutionId)

## Remaining Legacy Coupling
- 19 execution-kernel direct imports (deeply coupled modules)
- 2 state-store mutation imports (acceptable - transition-router, CLI)
- Web server uses direct state-store access (P41 target)
- CLI uses PlanControlManager directly (P41 target)

## Gates
- make test: PASS
- make test-full: PASS
- stable_3: default, unchanged
- patch_transaction: non-default
- worktree: not required

# P40.2C — Dependency Injection Ports

**Date:** 2026-05-30

## Interfaces Added to `@earendil-works/pi-execution-core`

| Interface | Purpose | Used By |
|---|---|---|
| `GovernanceLedgerLike` | Plan/workspace approval checks | completion-gate.ts |
| `FailureDetectorLike` | Log-based failure signal detection | completion-gate.ts |
| `FailureSignalLike` | Failure signal data model | completion-gate.ts |
| `WatchModeGuardLike` | Watch-mode command detection | completion-gate.ts |
| `StateStoreBackendFactoryLike` | DB vs JSON backend factory | state-store.ts |
| `BudgetPolicyLike` | Workspace budget enforcement | workspace-schema.ts |
| `CompletionGateDeps` | Bundled deps for completion-gate extraction | completion-gate.ts |
| `AgentRuntime` (P40.2 Phase 1) | Worker execution abstraction | autonomous-executor.ts |
| `GovernanceProvider` (P40.2 Phase 1) | Governance check abstraction | completion-gate.ts |
| `StorageProvider` (P40.2 Phase 1) | State persistence abstraction | state-store.ts |
| `InfrastructureProvider` (P40.2 Phase 1) | SDK/session/settings abstraction | cleanup-review.ts |
| `SkillProvider` (P40.2 Phase 1) | Skill registry abstraction | safety-doctor.ts |

## 12 total dependency inversion interfaces in execution-core

All implementations remain in coding-agent. No runtime behavior changed. Zero new TS errors.

## Dirty Files Status After P40.2C

| File | Blockers Before | Interfaces Available | Extraction Ready? |
|---|---|---|---|
| completion-gate.ts | governance-ledger, log-failure-detector, watch-mode-guard | CompletionGateDeps bundle | Needs injection wiring |
| state-store.ts | database-state-store, json-state-store | StateStoreBackendFactoryLike | Needs injection wiring |
| workspace-schema.ts | budget-enforcer, execution-profile, retry-handler | BudgetPolicyLike | Needs injection wiring |
| retry-handler.ts | plan-state, workspace-schema | (types not yet extractable) | Deferred |
| plan-control.ts | state-store | IStateStore (already in execution-core) | Could extract now |
| autonomous-executor.ts | WorkspaceAgentExecutor ctor | AgentRuntime, WorkerAdapter | Partial |

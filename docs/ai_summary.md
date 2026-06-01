# P40 Platform / Agent Separation — AI Summary

## What Was Built

P40 physically extracted the execution platform from `packages/coding-agent` into independent workspace packages.
The old internal scaffold approach (folders inside coding-agent) was insufficient — real package boundaries were required.

## Packages Created (5)

| Package | npm Name | Role |
|---|---|---|
| `packages/execution-core/` | `@earendil-works/pi-execution-core` | Canonical contracts: types, commands, read-model, WorkerAdapter, PiLogger, dependency inversion interfaces |
| `packages/execution-service/` | `@earendil-works/pi-execution-service` | Command/query facades, runtime modules (git-runner, failure-classifier, retry-router) |
| `packages/worker-adapters/` | `@earendil-works/pi-worker-adapters` | LocalPiWorkerAdapter bridge (WorkerAdapter → WorkspaceAgentExecutor) |
| `packages/execution-kernel/` | `@earendil-works/pi-execution-kernel` | State machine, admission, FSM, attempt lifecycle, transition-router (24 files) |
| `packages/brain/` | `@earendil-works/pi-brain` | Brain advisory module (boundary, execution-read-client, proposal-contract) |

## Dependency Rules Enforced

- `execution-core` has **zero** coding-agent imports
- `execution-service` has **zero** permanent coding-agent imports
- `worker-adapters` bridges execution-core contracts to coding-agent worker (intentional)
- `execution-kernel` depends only on execution-core + pi-db + kysely
- `brain` depends only on execution-core
- No circular workspace dependencies

## Files Extracted From coding-agent

| Batch | Files | Phase |
|---|---|---|
| Contracts/types/WorkerAdapter | ~10 files → execution-core | P40.1 |
| Command/query facades | 4 files → execution-service | P40.1 |
| LocalPiWorkerAdapter | 1 file → worker-adapters | P40.1 |
| Execution kernel | 24 files → execution-kernel | P41 |
| Brain module | 3 files → brain | P40.2B |
| Worker concurrency | 1 file → execution-core | P40.2A |
| Git runner | 1 file → execution-service | P40.2A |
| Failure classifier | 1 file → execution-service | P40.2A |
| Worktree types | 1 file → execution-core | P40.2A |
| **Total** | **~45 files** | |

## Compatibility Shims (Deprecated Re-exports in coding-agent)

8 old scaffold paths under `packages/coding-agent/src/` are now `@deprecated` re-export shims:
`execution-core/*`, `execution-service/*`, `worker-adapter/*`, `brain/*`

## Dependency Inversion Interfaces (12 in execution-core)

- `AgentRuntime`, `AgentRuntimeConfig`, `AgentRuntimeResult`
- `GovernanceProvider`, `GovernanceLedgerLike`, `CompletionGateDeps`
- `StorageProvider`, `StateStoreBackendFactoryLike`
- `InfrastructureProvider`, `SkillProvider`, `BudgetPolicyLike`
- `FailureDetectorLike`, `FailureSignalLike`, `WatchModeGuardLike`
- `IStateStore`, `WorkspaceStage`

## What Stays in coding-agent

| Category | Files | Reason |
|---|---|---|
| Worker-owned | workspace-agent-executor, worktree-workspace-executor, role-packets | IS the Pi worker implementation |
| Dirty runtime (needs injection) | completion-gate, state-store, workspace-schema, retry-handler, plan-control, execution-profile, auto-commit, validation-runner, lease-monitor, lead-agent/* (~30 files) | Blocked by coding-agent infrastructure deps |
| Test infra | execution-gauntlet/* (~20 files) | Test infrastructure |
| Shims | execution-core/*, execution-service/*, worker-adapter/*, brain/*, execution-kernel/dogfood-harness (10 files) | Backward compat re-exports |

## Test Results

- Unit tests: **120/120 pass** (gauntlet + boundary + integration)
- Gauntlet plans: **12/12 pass** (stable_3 + patch_transaction)
- Monte Carlo: **0 failures** in 5 iterations
- TypeScript: **0 new errors** (only pre-existing execution-gauntlet index-signature mismatches)
- stable_3 remains default
- patch_transaction remains non-default
- worktree not required

## Key Reports

| Report | Path |
|---|---|
| Completion certification | `reports/p40-platform-agent-separation/2026-05-30/p40-completion-certification.md` |
| Summary | `reports/p40-platform-agent-separation/2026-05-30/summary.md` |
| Remaining extraction manifest | `docs/pi/p40/remaining-runtime-extraction-manifest.md` |
| P40.2A immediate candidate audit | `docs/pi/p40/p40-2a-immediate-candidate-audit.md` |
| Dependency injection ports | `docs/pi/p40/dependency-injection-ports.md` |
| P40 plan | `docs/P40_Platform_Agent_Separation.md` |

## Completion Status

| Layer | % Complete |
|---|---|
| Contracts, types, interfaces | **100%** |
| Execution kernel (FSM, admission, attempt lifecycle) | **96%** (24/25 files) |
| Command/query facades | **100%** |
| Worker adapter bridge | **100%** |
| Brain advisory module | **100%** |
| Self-contained runtime modules | **100%** (4/4 eligible) |
| Tightly-coupled runtime (completion-gate, state-store, etc.) | **0%** — requires P42 injection wiring |
| **Overall P40 extraction goal** | **~40%** |

## Next Phase (P42)

Required to complete the remaining ~30 dirty runtime files:
1. Wire dependency inversion interfaces into constructor parameters
2. Extract completion-gate, state-store, workspace-schema, autonomous-executor
3. Extract lead-agent/*, retry-handler, plan-control, validation-runner
4. Extract auto-commit, execution-profile, lease-monitor

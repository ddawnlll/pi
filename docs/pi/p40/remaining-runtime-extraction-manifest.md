# P40/P41 Remaining Runtime Extraction Manifest

**Date:** 2026-05-30
**Purpose:** Document every execution-platform file still in `packages/coding-agent/src/` after P40.1 + P41 extraction

---

## Summary

P40.1 extracted contracts, facades, and adapters. P41 extracted execution-kernel (24/25 files).
~45 files remain. This manifest categorizes each and prescribes an extraction strategy.

---

## Remaining Files by Category

### execution-kernel (1 file — shim)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `execution-kernel/dogfood-harness.ts` | compatibility-shim | workspace-scheduler, state-store | leave as shim in coding-agent | leave in coding-agent | low | P42 |

### execution-runtime / orchestration (19 files)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `core/autonomous-executor.ts` | execution-runtime | workspace-agent-executor (Pi worker constructor), 15 core deps | execution-runtime or coding-agent | dependency injection (AgentRuntime interface) | high | P42 |
| `core/workspace-agent-executor.ts` | worker-implementation | agent-session-runtime, tools, config | coding-agent should keep it | never — stays worker-owned | none | never |
| `core/state-store.ts` | execution-runtime | database-state-store.js, json-state-store.js | execution-service | storage provider interface injection | medium | P42 |
| `core/completion-gate.ts` | execution-runtime | governance-ledger.js, log-failure-detector.js, watch-mode-guard.js | execution-service | interface injection (governance, log-failure, watch-mode) | medium | P42 |
| `core/workspace-schema.ts` | execution-runtime | budget-enforcer.js | execution-core (pure types) + execution-service (validation) | split: pure schema to execution-core, budget logic stays | medium | P42 |
| `core/workspace-scheduler.ts` | execution-runtime | workspace-schema, state-store | execution-service | direct copy after workspace-schema split | medium | P42 |
| `core/retry-handler.ts` | execution-runtime | none (self-contained) | execution-runtime or execution-service | direct copy | low | P40.2 |
| `core/plan-state.ts` | execution-runtime | edit-audit-events.js | execution-service | split: types to execution-core, impl to execution-service | medium | P42 |
| `core/plan-control.ts` | execution-runtime | none (self-contained, interface) | execution-service | direct copy | low | P40.2 |
| `core/role-packets.ts` | execution-runtime | context-packet.js | worker-adapters or coding-agent | keep worker-owned or create worker-packet contract | medium | P42 |
| `core/worker-concurrency.ts` | execution-runtime | none (self-contained) | execution-core or execution-service | direct copy | low | P40.2 |
| `core/execution-profile.ts` | execution-runtime | none (self-contained) | execution-service | direct copy | low | P40.2 |
| `core/cleanup-review.ts` | execution-runtime | sdk.js, session-manager.js, settings-manager.js | execution-service | interface injection (sdk, session, settings) | high | P42 |
| `core/validation-runner.ts` | execution-runtime | none (self-contained) | execution-service | direct copy | low | P40.2 |
| `core/lease-monitor.ts` | execution-runtime | none (self-contained) | execution-service | direct copy | low | P40.2 |
| `core/auto-commit.ts` | execution-runtime | none (self-contained) | execution-runtime | direct copy | low | P40.2 |
| `core/git-runner.ts` | execution-runtime | none (self-contained) | execution-runtime | direct copy | low | P40.2 |
| `core/production-readiness-doctor.ts` | execution-runtime | skill-registry.js | execution-service | interface injection (skill-registry) | medium | P42 |
| `core/safety-doctor.ts` | execution-runtime | dag-analyzer.js, execution-simulator.js, safety-profile.js, skill-registry.js | execution-service | interface injection (4 deps) | high | P42 |

### lead-agent (6 files)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `core/lead-agent/index.ts` | execution-runtime | autonomous-executor, completion-gate | execution-service | direct copy (after deps extracted) | medium | P42 |
| `core/lead-agent/types.ts` | execution-runtime | none (pure types) | execution-core | direct copy | low | P40.2 |
| `core/lead-agent/directive-handler.ts` | execution-runtime | autonomous-executor | execution-service | direct copy (after autonomous-extraction) | medium | P42 |
| `core/lead-agent/escalation-handler.ts` | execution-runtime | autonomous-executor | execution-service | direct copy | medium | P42 |
| `core/lead-agent/failure-classifier.ts` | execution-runtime | none | execution-service | direct copy | low | P40.2 |
| `core/lead-agent/classification-rules.ts` | execution-runtime | none | execution-service | direct copy | low | P40.2 |

### failure (2 files)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `failure/retry-router.ts` | execution-runtime | execution-kernel types | execution-service | direct copy (dep already extracted) | low | P40.2 |
| `failure/failure-classifier.ts` | execution-runtime | lead-agent types | execution-service | direct copy (after lead-agent types extracted) | low | P40.2 |

### worktree (4 files)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `worktree/worktree-types.ts` | execution-runtime | none (pure types) | execution-core | direct copy | low | P40.2 |
| `worktree/worktree-manager.ts` | execution-runtime | workspace-schema | execution-service | direct copy (after schema split) | medium | P42 |
| `worktree/worktree-workspace-executor.ts` | execution-runtime | workspace-agent-executor.js | coding-agent should keep it | leave in coding-agent (Pi worker) | low | never |
| `worktree/worktree-cleanup.ts` | execution-runtime | worktree-manager | execution-service | direct copy (after manager) | medium | P42 |

### brain (3 files — P40.0 scaffold, already importing from canonical packages)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `brain/boundary.ts` | brain | none (imports from execution-core) | packages/brain/ | direct copy | low | P42 |
| `brain/execution-read-client.ts` | brain | none (imports from execution-core) | packages/brain/ | direct copy | low | P42 |
| `brain/proposal-contract.ts` | brain | none (imports from execution-core) | packages/brain/ | direct copy | low | P42 |

### execution-gauntlet (19 files — test infra)

| File | Category | Blocked By | Should Move To | Strategy | Risk | Phase |
|---|---|---|---|---|---|---|
| `core/execution-gauntlet/*` (19 files) | test/gauntlet | execution-runtime, workspace-schema | coding-agent or test package | leave in coding-agent (test infra) | low | P45 |

---

## Category Summary

| Category | Count | Recommended Phase |
|---|---|---|
| **Ready for P40.2 (direct copy, low risk)** | 14 | P40.2 |
| **Needs P42 (interface injection or dep extraction)** | 15 | P42 |
| **Stays worker-owned (never moves)** | 3 | never |
| **Test infra (leave)** | 19 | P45 |
| **Brain (already importing from canonical packages)** | 3 | P42 |
| **Shim/legacy** | 1 | P42 |

---

## P40.2 Immediate Candidates (14 files — direct copy, zero deps)

| File | Move To |
|---|---|
| `core/retry-handler.ts` | execution-service |
| `core/plan-control.ts` | execution-service |
| `core/worker-concurrency.ts` | execution-core |
| `core/execution-profile.ts` | execution-service |
| `core/validation-runner.ts` | execution-service |
| `core/lease-monitor.ts` | execution-service |
| `core/auto-commit.ts` | execution-service |
| `core/git-runner.ts` | execution-service |
| `core/lead-agent/types.ts` | execution-core |
| `core/lead-agent/failure-classifier.ts` | execution-service |
| `core/lead-agent/classification-rules.ts` | execution-service |
| `failure/retry-router.ts` | execution-service |
| `failure/failure-classifier.ts` | execution-service |
| `worktree/worktree-types.ts` | execution-core |

## Never Moves (worker-owned)

| File | Reason |
|---|---|
| `core/workspace-agent-executor.ts` | IS the local Pi worker — agent-session, tools, config |
| `worktree/worktree-workspace-executor.ts` | Uses WorkspaceAgentExecutor directly |
| `core/role-packets.ts` | Depends on context-packet.js — agent infra |

## Needs Interface Injection (P42)

| File | Interfaces Needed |
|---|---|
| `core/autonomous-executor.ts` | AgentRuntime (replaces WorkspaceAgentExecutor ctor) |
| `core/completion-gate.ts` | GovernanceLedger, LogFailureDetector, WatchModeGuard |
| `core/state-store.ts` | StorageProvider (replaces DB/json impls) |
| `core/cleanup-review.ts` | SdkProvider, SessionManager, SettingsManager |
| `core/safety-doctor.ts` | DagAnalyzer, ExecutionSimulator, SafetyProfile, SkillRegistry |
| `core/production-readiness-doctor.ts` | SkillRegistry |
| `core/workspace-schema.ts` | BudgetEnforcer (split pure types from budget logic) |
| `core/plan-state.ts` | EditAuditEvents (split types from impl) |

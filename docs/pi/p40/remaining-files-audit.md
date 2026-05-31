# P40 Execution Platform Separation Audit — Remaining Files

**Date:** 2026-05-30
**Baseline:** P40.1 physical package extraction complete
**Comparison:** vs original repo `https://github.com/earendil-works/pi/tree/main/packages/coding-agent`

---

## Summary

P40.1 extracted the **contract layer** (types, interfaces, facades, WorkerAdapter) into 3 new packages. The **runtime layer** (~70 files, ~25,000 LoC) remains inside `packages/coding-agent/src/`. This audit documents every file that still needs extraction for full platform/agent separation.

---

## Already Extracted (P40.1)

| Package | Files | Status |
|---|---|---|
| `@earendil-works/pi-execution-core` | 6 source files | **Extracted** — types, commands, read-model, events, WorkerAdapter |
| `@earendil-works/pi-execution-service` | 4 source files | **Extracted** — command/query facades |
| `@earendil-works/pi-worker-adapters` | 2 source files | **Extracted** — LocalPiWorkerAdapter |

---

## Still in `packages/coding-agent/src/` — By Layer

### 1. execution-kernel/ (25 files) — State machine, admission, FSM

| File | Internal Deps | Complexity |
|---|---|---|
| `actor-events.ts` | 0 | LOW — pure types |
| `actor-permissions.ts` | 0 | LOW |
| `admission-gate.ts` | 0 | LOW |
| `admission-guard.ts` | 0 | LOW |
| `attempt-event-journal.ts` | 0 | LOW |
| `attempt-fsm.ts` | 0 | LOW |
| `completion-predicate.ts` | 0 | LOW |
| `controller-leadership.ts` | 0 | LOW |
| `deadline-watchdog.ts` | 0 | LOW |
| `dogfood-harness.ts` | 4 | HIGH — imports state-store, workspace-schema |
| `event-schema.ts` | 0 | LOW — pure types |
| `execution-profile-deriver.ts` | 0 | LOW |
| `handoff-queue.ts` | 0 | LOW |
| `index.ts` | 0 | LOW — re-exports |
| `legacy-normalizer.ts` | 0 | LOW |
| `legacy-write-adapter.ts` | 0 | LOW |
| `plan-supervisor.ts` | 0 | LOW |
| `preflight.ts` | 0 | LOW |
| `replay-comparator.ts` | 0 | LOW |
| `shadow-attempt-journal.ts` | 0 | LOW |
| `state-authority.ts` | 0 | LOW — pure types |
| `state-writer.ts` | 0 | LOW |
| `transition-router.ts` | 4 | HIGH — imports state-store, workspace-schema, workspace-scheduler, plan-state |
| `types.ts` | 0 | LOW — pure types |
| `workspace-attempt-controller.ts` | 0 | LOW |

**Key insight:** 21 of 25 execution-kernel files have ZERO internal coding-agent deps. Only 4 files (dogfood-harness, transition-router) depend on core/ modules. This makes execution-kernel the **most extractable** layer.

### 2. core/ Execution Orchestration (19 files, ~16,000 LoC)

| File | LoC | Internal Deps | Role |
|---|---|---|---|
| `autonomous-executor.ts` | 2747 | 16 | **Central orchestrator** — creates workers, runs execution loop, handles stop/continue/retry |
| `workspace-agent-executor.ts` | 1647 | 2 | Worker implementation (runs agent session per workspace) |
| `workspace-scheduler.ts` | 1007 | 2 | Dependency-aware workspace scheduling and batching |
| `state-store.ts` | 708 | 0 | IStateStore interface + implementations (JSON, Postgres) |
| `completion-gate.ts` | 1208 | 2 | Plan completion validation and gate logic |
| `retry-handler.ts` | 305 | 1 | Retry decision logic |
| `plan-state.ts` | 1434 | 2 | Plan state management |
| `plan-control.ts` | 206 | 0 | PlanControlManager |
| `role-packets.ts` | 322 | 2 | Worker packet generation (HashedPacket) |
| `worker-concurrency.ts` | 297 | 0 | Worker count resolution |
| `workspace-schema.ts` | 1365 | 0 | Workspace/queue schema types (WorkspaceStage, etc.) |
| `execution-profile.ts` | 136 | 1 | Execution profile deriver |
| `cleanup-review.ts` | 725 | 2 | Post-execution cleanup |
| `validation-runner.ts` | 400 | 1 | Final validation |
| `lease-monitor.ts` | 624 | 1 | Lease monitoring |
| `auto-commit.ts` | 407 | 0 | Auto-commit logic |
| `git-runner.ts` | 625 | 0 | Git operations |
| `production-readiness-doctor.ts` | 708 | 2 | Doctor checks |
| `safety-doctor.ts` | 1354 | 1 | Safety validation |

### 3. lead-agent/ (6 files)

| File | Role |
|---|---|
| `index.ts` | Lead agent orchestrator |
| `types.ts` | LeadAgent interface, LeadDirective, UserEscalation types |
| `directive-handler.ts` | Directive processing |
| `escalation-handler.ts` | Escalation management |
| `failure-classifier.ts` | Failure classification |
| `classification-rules.ts` | Classification rules |

### 4. Other Execution Modules

| Directory | Files | Role |
|---|---|---|
| `failure/` | 2 | Retry routing |
| `worktree/` | 4 | Worktree isolation and executor |
| `execution-gauntlet/` | 19 | Test infrastructure |

---

## Dependency Cluster Map

```
autonomous-executor.ts ←— THE ORCHESTRATOR
  ├── execution-kernel/transition-router.ts
  │   └── core/state-store.ts
  │   └── core/workspace-schema.ts
  │   └── core/workspace-scheduler.ts
  │   └── core/plan-state.ts
  ├── core/workspace-agent-executor.ts
  ├── core/workspace-scheduler.ts
  │   └── core/workspace-schema.ts
  ├── core/completion-gate.ts
  ├── core/state-store.ts (IStateStore interface)
  ├── core/plan-state.ts
  ├── core/plan-control.ts
  ├── core/retry-handler.ts
  ├── core/role-packets.ts
  ├── core/worker-concurrency.ts
  ├── core/workspace-schema.ts
  ├── core/lead-agent/
  ├── failure/retry-router.ts
  ├── worktree/
  └── core/auto-commit.ts, core/git-runner.ts
```

**17 files form a single tightly-coupled cluster.** Extracting one requires extracting all.

---

## Proposed Extraction Phases

### Phase P41a — Low-Hanging Fruit (21 execution-kernel files)

Extract 21 execution-kernel files with ZERO internal deps into `packages/execution-kernel/`:

- All files except transition-router.ts, dogfood-harness.ts
- These are pure state machines, event schemas, FSM logic with no coding-agent coupling
- `types.ts` already re-exported through execution-core shim
- Risk: LOW (no runtime changes, just file movement)
- Time: ~30 min

### Phase P41b — Core Type Extraction (4 files)

Extract foundational interfaces into `@earendil-works/pi-execution-core`:

- `workspace-schema.ts` → execution-core types (WorkspaceStage, Workspace, WorkspaceQueue)
- `state-store.ts` → `IStateStore` interface to execution-core
- `plan-state.ts` → PlanState types to execution-core
- `plan-control.ts` → PlanControlManager interface to execution-core

Risk: MEDIUM (IStateStore changes propagate everywhere)
Time: ~45 min

### Phase P41c — Execution Runtime Package (17 files)

Create `packages/execution-runtime/` with the full orchestration layer:

- `autonomous-executor.ts`
- `workspace-agent-executor.ts`
- `workspace-scheduler.ts`
- `completion-gate.ts`
- `state-store.ts` (implementations)
- `plan-state.ts` (implementation)
- `retry-handler.ts`
- `role-packets.ts`
- `worker-concurrency.ts`
- `lead-agent/`
- `failure/`
- `worktree/`
- `auto-commit.ts`
- `git-runner.ts`

Risk: HIGH (massive import migration, ~200+ import changes across entire codebase)
Time: ~2 hours

### Phase P41d — Remaining extraction

- `execution-kernel/transition-router.ts` (after P41b deps extracted)
- `cleanup-review.ts`, `validation-runner.ts`, `lease-monitor.ts`, `execution-profile.ts`
- `production-readiness-doctor.ts`, `safety-doctor.ts`
- `execution-gauntlet/` (test infra)

---

## What Would Stay in coding-agent After Full Extraction

```
packages/coding-agent/src/
  agent-session*.ts       — Agent session management (local Pi worker implementation)
  brain/                  — Advisory brain (consumes execution-core contracts)
  brain-workers/          — Brain worker pool
  cli/                    — CLI interface
  modes/                  — Interactive/TUI modes
  hooks/                  — Extension hooks
  settings/               — Settings/configuration
  extensions/             — Extension system
  tools/                  — Read/bash/edit/write tools
  utils/                  — Utilities (logger, shell, etc.)
  session/                — Session persistence
  observability/          — Metrics/telemetry
  core/hooks/             — Hook infrastructure
  core/extensions/        — Extension registry
  core/export-html/       — HTML export
  core/self-modification-firewall.ts
  core/auth-*.ts          — Auth
```

**coding-agent becomes solely:** agent session runtime + CLI + tools + extensions + brain consumers. All execution state management, scheduling, completion, retry, and worktree logic lives in execution-* packages.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `IStateStore` extraction breaks 30+ importers | HIGH | Extract interface first, keep implementation, migrate importers gradually |
| `autonomous-executor.ts` circular dep with coding-agent after extraction | HIGH | Needs code-introduced WorkerAdapter abstraction; already partially done in P40.1 |
| Execution gauntlet tests break | MEDIUM | Test infra is isolated; migrate alongside runtime extraction |
| TypeScript path resolution for new packages | LOW | Same pattern as P40.1 packages — root tsconfig + vitest aliases |

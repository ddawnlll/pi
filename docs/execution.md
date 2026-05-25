# Execution System (Post-P26 Recovery)

## Overview

The execution system runs workspaces (tasks) generated from a plan. Each workspace is a self-contained unit of work with a goal, acceptance criteria, file permissions, and output contract. The system schedules them respecting dependencies, runs each inside an isolated git worktree via an AI agent, and tracks state through a persistent store with atomic writes.

This document describes the system **after** the P26 execution correctness recovery (14 workstreams A-N). See [What Changed](#what-changed) for a summary of fixes and improvements.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         plan-commands.ts                                 │
│                                                                          │
│  ┌─────────────────┐     ┌──────────────────────┐                        │
│  │  Plan Parser     │────▶│  WorkspaceQueue       │                       │
│  │  (plan-parser.ts)│     │  (workspace-schema.ts)│                       │
│  └─────────────────┘     └──────────┬───────────┘                        │
│                                     │                                     │
│  ┌──────────────────────────────────▼─────────────────────────────────┐  │
│  │               AutonomousExecutor                                    │  │
│  │               (autonomous-executor.ts)                              │  │
│  │                                                                     │  │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │  │
│  │  │ StateStore    │  │ WorkspaceScheduler│  │ RetryHandler         │  │  │
│  │  │ (PlanStateStore)│ │ (dep graph +     │  │ (escalation policy)  │  │  │
│  │  │ atomic writes │  │  file locks)     │  │                      │  │  │
│  │  └──────────────┘  └──────────────────┘  └──────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │      activeAgentExecutors: Map<string, WorkspaceAgentExecutor>│  │  │
│  │  │      (PER-WORKSPACE isolation, no longer a singleton)         │  │  │
│  │  │                                                                │  │  │
│  │  │  ┌─────────────────┐  ┌──────────────────────────────────┐   │  │  │
│  │  │  │ execute()        │─▶│ executeInWorktree()              │   │  │  │
│  │  │  │ (entry point)    │  │                                  │   │  │  │
│  │  │  └─────────────────┘  │  ┌────────────────────────────┐  │   │  │  │
│  │  │                       │  │WorktreeWorkspaceExecutor    │  │   │  │  │
│  │  │                       │  │(worktree-workspace-        │  │   │  │  │
│  │  │                       │  │ executor.ts)               │  │   │  │  │
│  │  │                       │  │                            │  │   │  │  │
│  │  │                       │  │ 1. Acquire worktree mutex  │  │   │  │  │
│  │  │                       │  │ 2. Git operations (locked) │  │   │  │  │
│  │  │                       │  │ 3. Create git worktree     │  │   │  │  │
│  │  │                       │  │ 4. Create INNER executor   │  │   │  │  │
│  │  │                       │  │ 5. executeAgentInPlace()   │  │   │  │  │
│  │  │                       │  └────────────────────────────┘  │   │  │  │
│  │  │                       └──────────────────────────────────┘   │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │           ContinuousExecutor                                          │  │
│  │           (continuous-executor.ts)                                   │  │
│  │                                                                      │  │
│  │  Concurrency pool (configurable per scale mode)                      │  │
│  │  Fill → Drain/Refill → Wait for all done                             │  │
│  │                                                                      │  │
│  │  Slot 1 ──▶ executor.executeWorkspace(ws_A, false, signal)           │  │
│  │  Slot 2 ──▶ executor.executeWorkspace(ws_B, false, signal)          │  │
│  │  Slot 3 ──▶ executor.executeWorkspace(ws_C, false, signal)          │  │
│  │  ...                                                                 │  │
│  │                                                                      │  │
│  │  When a slot frees → dispatch next ready workspace                   │  │
│  │  AbortSignal forwarded from caller → in-flight abort                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Execution Flow (Detailed)

```
Plan Upload
    │
    ▼
Plan Parser (plan-parser.ts)
    │  Parses plan.md → WorkspaceQueue
    │  Sets worktree: { enabled: true }
    │  Sets scale mode (configurable per plan or CLI)
    │  Runs SafetyDoctor checks:
    │    • Repair-mode detection (autonomousExecutionEnabled)
    │    • Promotion gate validation (stable_3/stable_6)
    │    • Anti-stall DAG analysis (P26.M)
    │    • Validation lane backpressure check (P26.I)
    │
    ▼
Plan Commands (plan-commands.ts)
    │  createAutonomousExecutor(cwd, workers, retryPolicy, worktreeConfig)
    │     Creates JsonStateStore + AutonomousExecutor
    │     AutonomousExecutor constructor:
    │       Creates empty activeAgentExecutors Map
    │       No singleton — each workspace gets its own executor
    │
    ▼
ContinuousExecutor.executeAll()
    │  Phase 1: Fill — dispatch N workspaces concurrently (N = concurrency)
    │  Phase 2: Drain/Refill — on each completion, dispatch next ready
    │  AbortSignal passed to executeWorkspace for in-flight abort
    │
    ▼ (per workspace, concurrent — fully isolated)
AutonomousExecutor.executeWorkspace(ws, false, signal?)
    │  Creates a NEW WorkspaceAgentExecutor per call
    │  Stores it in activeAgentExecutors<workspaceId>
    │
    ├─ Memory guard check (worker-memory-guard.ts)
    ├─ Transition workspace → Active (atomic state write)
    ├─ Acquire file locks (scheduler)
    ├─ Build role packet (worker/lead/flash/reviewer)
    ├─ Create snapshot directory
    │
    ▼
    freshExecutor.execute(packet, workspaceId, { signal, logPath, attemptNo })  
    │     signal wired to executor.abort(); logPath and attemptNo passed as options
    │
    ▼
WorkspaceAgentExecutor.execute()
    │
    ├─ Create ExecutionContext with:
    │    • abortController ← from external signal + timer timeout
    │    • logPath, worktreeState, attemptNo
    │    • All mutable state lives in context, not instance fields
    │
    ├─ isWorktreeModeEnabled? YES
    │     │
    │     ▼
    │   executeInWorktree()
    │     │
    │     ├─ Create attempt-scoped WorktreeWorkspaceExecutor for this ExecutionContext
    │     │     │
    │     │     ├─ acquireWorktreeMutex()  [NO safety timeout bypass]
    │     │     ├─ git rev-parse HEAD      [base commit]
    │     │     ├─ ensureBranch()          [attempt-scoped branch name]
    │     │     │     ├─ Write .pi/worktree-branch-locks/<planExecId>.lock
    │     │     │     ├─ git worktree prune
    │     │     │     ├─ git branch [--list, --force]
    │     │     │     └─ Release lock
    │     │     ├─ git worktree add --checkout <dir> <branch>
    │     │     └─ releaseWorktreeMutex()
    │     │
    │     ├─ Branch and worktree path include attemptNo:
    │     │   branch:  worktree/<planExecId>/<workspaceId>/attempt-<N>
    │     │   path:    .pi/worktrees/<planExecId>/<workspaceId>/attempt-<N>
    │     │
    │     ├─ Create INNER WorkspaceAgentExecutor
    │     │     scoped to worktree path
    │     │     _skipWorktreeCheck: true (bypass recursion)
    │     │
    │     └─ Inner executor.execute() → executeAgentInPlace()
    │           │
    │           ▼
    │       executeAgentInPlace()
    │           │
    │           ├─ Budget check
    │           ├─ Create SessionManager
    │           ├─ Create SettingsManager
    │           ├─ Load extensions, adapt tools
    │           ├─ Create agent session (sdk.ts)
    │           ├─ Subscribe to agent events
    │           │     ├─ LLM idle watchdog (5 min timeout, per-workspace)
    │           │     │   Circuit breaker: 3 consecutive failures → abort
    │           │     ├─ Tool execution tracking
    │           │     ├─ State store logging (atomic writes via write queue)
    │           │     └─ Verdict extraction (COMPLETE/BLOCKED/FAILED)
    │           ├─ session.prompt(prompt)
    │           └─ Wait for completionPromise (respects abort)
    │
    ▼
    Process result:
    ├─ Completion gate evaluation + writeSet drift check (P26.L)
    ├─ Transition workspace (Complete/Failed/Blocked) — atomic
    ├─ Auto-commit (if enabled)
    ├─ Release file locks
    ├─ Kill orphaned child processes
    │  (via ValidationRunner process group kill, P26.H)
    └─ Remove from activeAgentExecutors Map
```

## State Persistence

```
.pi/
├── plan-state.json            ← Full execution state (PlanState)
├── execution-journal.ndjson   ← Journal events (append-only, atomic)
├── plan-control.json          ← Pause/stop/resume control requests
├── workspaces/
│   └── <workspaceId>/
│       ├── packet.json         ← Current role packet
│       ├── report.md           ← Execution report
│       └── retries/
│           └── packet-attempt-<N>.json
├── sessions/
│   └── <workspaceId>/          ← Agent session files
├── worktrees/
│   └── <planExecId>/
│       └── <workspaceId>/
│           └── attempt-<N>/    ← Git worktree (attempt-scoped)
├── worktree-branch-locks/
│   └── <planExecId>.lock       ← Branch creation lock file
├── projects.json               ← Project tracking
└── executions/
    └── <planExecId>/
        └── worktrees/
            └── <workspaceId>-<attemptNo>.patch  ← Diff artifact (attached)
        └── quarantine/
            └── <planExecId>-<workspaceId>-<attemptNo>-<timestamp>.json
              ← Quarantine snapshot (lease monitor, P26.K)
```

## Key Files & Responsibilities

| File | Role |
|------|------|
| `src/core/promotion-gates.ts` | **NEW** — Promotion gate records for each P26 workstream, blocks stable_3/stable_6 until all gates pass |
| `src/core/validation-runner.ts` | **NEW** — Managed validation runner with deadline, process group kill, stdin close, output caps, CI env |
| `src/core/autonomous-executor.ts` | **REFACTORED** — `activeAgentExecutors: Map<string, WorkspaceAgentExecutor>` replaces singleton; `stopAllActiveWorkspaces()` aborts all; creates per-workspace executors |
| `src/core/workspace-agent-executor.ts` | **REFACTORED** — `WorkspaceExecutionContext` interface with `abortController`, `logPath`, `worktreeState`, `attemptNo`; all mutable state in context not instance fields; LLM circuit breaker; external abort signal support |
| `src/core/continuous-executor.ts` | **ENHANCED** — Forwards `AbortSignal` from caller to `executeWorkspace()` callback |
| `src/core/completion-gate.ts` | **ENHANCED** — `checkWriteSetDrift()` and `WriteSetDriftResult` for empirical drift detection |
| `src/core/safety-doctor.ts` | **ENHANCED** — `safeEffectiveParallelism`, `AntiStallDiagnostics`, `detectAntiStallIssues()`, new issue types: FullySerializedDag, LongSerializedTail, BroadConflictScope |
| `src/core/state-store.ts` | **REFACTORED** — `IStateStore` interface cleanup, atomic journal writes |
| `src/core/json-state-store.ts` | **REFACTORED** — Write queue + atomic temp+rename pattern for persistence |
| `src/core/plan-state.ts` | **ENHANCED** — `PlanStateStore` with `journalMutex` for thread-safe log appends |
| `src/core/lease-monitor.ts` | **ENHANCED** — Quarantine snapshot with lease state/worktree state/recovery decision; `planExecId` and `snapshotPath` in `QuarantineResult` |
| `src/core/retry-handler.ts` | Unchanged from pre-P26 |
| `src/core/role-packets.ts` | Unchanged from pre-P26 |
| `src/core/auto-commit.ts` | Unchanged from pre-P26 |
| `src/core/workspace-schema.ts` | **ENHANCED** — `conflictScope` field, `WorktreeState.attemptNo` |
| `src/core/workspace-scheduler.ts` | Unchanged from pre-P26 |
| `src/core/worker-concurrency.ts` | **ENHANCED** — Validates experimental mode prerequisites |
| `src/core/worker-memory-guard.ts` | Unchanged from pre-P26 |
| `src/core/budget-enforcer.ts` | Unchanged from pre-P26 |
| `src/cli/plan-commands.ts` | **ENHANCED** — Forwards AbortSignal to executeWorkspace; repair-mode detection on plan start |
| `src/cli/plan-parser.ts` | **ENHANCED** — Repair-mode lockdown integration; promotion gate validation |
| `src/worktree/worktree-types.ts` | **ENHANCED** — `WorktreeListEntry` includes `attemptNo`; `abandoned` status |
| `src/worktree/worktree-manager.ts` | **ENHANCED** — Attempt-scoped worktree path/branch; abandoned worktree cleanup |
| `src/worktree/worktree-workspace-executor.ts` | **REFACTORED** — No 5-second mutex auto-release bypass; branch lock acquisition throws on failure; attempt-scoped branch names; all git ops run through GitRunner-repo-wide mutation scope |

## Worktree Isolation Design

Each workspace execution attempt runs inside its own git worktree:

```
Main checkout (workspaceRoot)
  .pi/worktrees/<planExecId>/<workspaceId>/attempt-1/    ← Attempt 1
  .pi/worktrees/<planExecId>/<workspaceId>/attempt-2/    ← Retry attempt 2
  .pi/worktrees/<planExecId>/<workspaceId-B>/attempt-1/  ← Different workspace
```

- Base commit: `HEAD` of main checkout at creation time
- Branch: `worktree/<planExecId>/<workspaceId>/attempt-<N>`
- Attempt number ensures retries get a fresh branch and worktree path
- Branch locks use `<planExecId>.lock` to prevent cross-plan collisions
- Worktree is preserved after execution (not auto-removed)
- Abandoned worktrees have `abandoned` status for cleanup
- Inner executor scoped to worktree path has `_skipWorktreeCheck: true`

## Concurrent Execution Model

```
ContinuousExecutor (configurable slots)
   │
   ├─ Slot 1: AutonomousExecutor.executeWorkspace(ws_A)
   │             │
   │             └─ new WorkspaceAgentExecutor()    ← fresh per workspace!
   │
   ├─ Slot 2: AutonomousExecutor.executeWorkspace(ws_B)
   │             │
   │             └─ new WorkspaceAgentExecutor()    ← different instance!
   │
   ├─ Slot 3: AutonomousExecutor.executeWorkspace(ws_C)
   │             │
   │             └─ new WorkspaceAgentExecutor()    ← different instance!
   │
   └─ All slots wired with AbortSignal from ContinuousExecutor
```

## Promotion Gates System

The `PromotionGates` class (P26.N) tracks which P26 workstream gates have passed:

- 15 gates registered across P26.A–N
- `isModePermitted("stable_3")` requires all gates to pass
- `isModePermitted("stable_6")` requires all gates + stress gates to pass
- Records persisted to `.pi/promotion-gates.json`
- SafetyDoctor checks promotion gates before allowing execution

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PromotionGates                                                         │
│                                                                         │
│  repair_mode_lockdown     ████████████  PASSED                         │
│  executor_isolation       ████████████  PASSED                         │
│  execution_context        ████████████  PASSED                         │
│  abort_chain              ████████████  PASSED                         │
│  git_serialization         ████████████  PASSED                         │
│  attempt_scoped_worktrees ████████████  PASSED                         │
│  state_store_concurrency  ████████████  PASSED                         │
│  validation_runner        ████████████  PASSED                         │
│  validation_lane          ████████████  PASSED                         │
│  llm_watchdog             ████████████  PASSED                         │
│  lease_monitor            ████████████  PASSED                         │
│  integration_queue        ████████████  PASSED                         │
│  anti_stall_analysis      ████████████  PASSED                         │
│  stable_3_dogfood         ████████████  PASSED   ← req'd by stable_3  │
│  stable_6_stress          ████████████  PASSED   ← req'd by stable_6  │
└─────────────────────────────────────────────────────────────────────────┘
```

## What Changed

### P26.A — Repair-Mode Lockdown and Promotion Guard

- SafetyDoctor detects `autonomousExecutionEnabled: false` in workspace config and raises a critical issue blocking execution
- Promotion gate validation: `stable_3` requires all core correctness gates plus `stable_3_dogfood` gate; `stable_6` requires all `stable_3` gates plus `stable_6_stress` gate
- Repair-mode plans are blocked from autonomous execution before scheduling
- Worker concurrency validates experimental mode prerequisites

### P26.B — Per-Workspace Executor Isolation

- **BEFORE**: `AutonomousExecutor` held a single `WorkspaceAgentExecutor` singleton instance; concurrent workspace calls shared and corrupted its mutable state fields
- **AFTER**: `AutonomousExecutor.activeAgentExecutors: Map<string, WorkspaceAgentExecutor>` creates a fresh executor per workspace execution; `stopAllActiveWorkspaces()` iterates all and calls `abort()` on each
- Eliminates the race condition on `abortController`, `timeoutHandle`, `llmIdleHandle`, `worktreeExecutor`, and `logPath` fields

### P26.C — WorkspaceExecutionContext Refactor

- **BEFORE**: All mutable state (abortController, timeoutHandle, worktreeState, logPath) were instance fields on `WorkspaceAgentExecutor`, overwritten by concurrent calls
- **AFTER**: `execute()` creates a `WorkspaceExecutionContext` with `abortController`, `abortSignal`, `logPath`, `worktreeState`, `attemptNo`; passed as parameter to downstream methods; getters read from `currentContext`
- `logPath` is a per-call option (not a config field)
- Eliminates shared mutable state across concurrent executions

### P26.D — Abort Signal Correctness

- **BEFORE**: `executeWorkspace()` callback received `_signal` parameter but ignored it; abort only took effect on next scheduling round
- **AFTER**: `ContinuousExecutor` forwards `AbortSignal` to each slot; `AutonomousExecutor.executeWorkspace()` accepts optional `AbortSignal` parameter; signal is wired to the workspace executor's `abort()` via event listener
- In-flight workspaces now respect pause/stop within 1s

### P26.E — GitRunner Serialization

- **BEFORE**: `acquireWorktreeMutex()` had a 5-second safety timeout that bypassed the mutex, allowing concurrent git operations to race
- **AFTER**: No auto-release bypass; branch lock acquisition throws on failure; all worktree git operations (branch creation, worktree add) route through GitRunner's repo-wide mutation scope
- Prevents git ref locking errors and duplicate worktree creation

### P26.F — Attempt-Scoped Worktrees

- **BEFORE**: Branch names derived from `planExecId/workspaceId` only; retries used `-rN` suffix
- **AFTER**: Branch `worktree/<planExecId>/<workspaceId>/attempt-<N>` and worktree path `worktrees/<planExecId>/<workspaceId>/attempt-<N>/` include attempt number; `abandoned` status for cleanup tracking
- Ensures retries get a completely fresh branch and worktree, eliminating stale-state collisions

### P26.G — StateStore Atomicity

- **BEFORE**: `JsonStateStore` used direct `fs.writeFile` and `fs.appendFile` without synchronization; concurrent writes could interleave and corrupt data
- **AFTER**: Write queue in `JsonStateStore` serializes all mutations; atomic temp+rename pattern prevents partial writes; `PlanStateStore` has `journalMutex` for thread-safe log appends
- Eliminates journal interleaving and state corruption under concurrency

### P26.H — Validation Runner

- **NEW**: `ValidationRunner` class with managed process lifecycle:
  - Deadline enforcement (configurable timeout)
  - `stdin` closed to prevent hanging on interactive prompts
  - CI environment variables set automatically
  - Output caps prevent unbounded memory from verbose output
  - Process group tracking for reliable child-kill
  - Watch/dev-server blocking prevents stuck validation runs

### P26.I — Validation Lane Backpressure

- SafetyDoctor detects validation lane saturation via `detectValidationLaneIssues()`
- Default limits: 1 heavy slot, 3 targeted slots
- Scheduler defers workspaces when validation lanes are saturated
- Information-level issues reported for planning

### P26.J — LLM Provider Watchdog

- **NEW**: Circuit breaker for LLM provider failures:
  - Tracks consecutive failures per provider
  - After 3 consecutive failures, circuit opens and aborts the workspace
  - Transient provider blips don't waste the entire timeout window
- Idle watchdog is workspace-local (scoped to `ExecutionContext`), not global

### P26.K — Lease Monitor

- **ENHANCED**: Quarantine snapshots include:
  - Lease state (acquired, expiring, expired)
  - Worktree state (branch, path, attempt)
  - Recovery decision (requeue, abort, ignore)
- `QuarantineResult` includes `planExecId` and `snapshotPath` for traceability

### P26.L — Integration Queue WriteSet Drift

- `Workspace` gains `conflictScope` field (alias for `writeSet`)
- `checkWriteSetDrift()` compares `git diff` output against declared conflict scope
- Returns categorized diff files (in scope, out of scope, untracked) with glob matching
- Integrated into completion gate evaluation

### P26.M — Plan-Intake Anti-Stall Analysis

- `ParallelismDiagnostics.safeEffectiveParallelism` distinguishes DAG parallelism from conflict-resolved parallelism
- `AntiStallDiagnostics` interface and `detectAntiStallIssues()` on SafetyDoctor:
  - Flags fully serialized DAGs (all batches width-1)
  - Flags long serialized tails (consecutive single-width batches at end)
  - Flags broad conflict scopes
  - Flags validation lane bottlenecks
  - Provides actionable recommendations

### P26.N — Promotion Gates

- **NEW**: `PromotionGates` class with 15 gates across all P26 workstreams
- `stable_3` requires all non-stress P26 gates plus `stable_3_dogfood`
- `stable_6` requires all stable_3 gates plus `stable_6_stress`
- Persistent JSON-backed gate records with load/save
- Integration with SafetyDoctor for scale mode permission checks
- `createP26PromotionGates()` factory for standard gate set

### Promotion Mode Matrix

The following table summarises which scale mode requires which promotion gates:

| Mode | Allowed? | Required Gates |
|------|----------|----------------|
| `manual_1` | Always allowed | None |
| `stable_1` | After core isolation | executor isolation, execution context, abort chain |
| `stable_3` | After core reliability | git serialization, attempt-scoped worktrees, state store concurrency, validation runner, validation lane, llm watchdog, lease monitor, integration queue, anti-stall, stable_3 dogfood |
| `stable_6` | After stress | all stable_3 gates + stable_6 stress |

## Observability

### Dashboard/Doctor Fields

Each active workspace execution tracks:

| Field | Source |
|-------|--------|
| `workspaceId` | WorkspaceQueue |
| `attemptId` | ExecutionContext.attemptNo |
| `executorId` | activeAgentExecutors map key |
| `worktreePath` | WorktreeState.path |
| `branchName` | WorktreeState.branch |
| `activeTimers` | AbortController + timeout handles |
| `abortStatus` | AbortSignal.aborted |
| `validationLaneState` | ValidationRunner state |
| `blockedReason` | SafetyDoctor issue details |

## Test Coverage

| File | Workstream | Tests |
|------|------------|-------|
| `test/p26a-repair-mode-lockdown.test.ts` | P26.A | 16 |
| `test/p26b-executor-isolation.test.ts` | P26.B | 8 |
| `test/p26c-execution-context.test.ts` | P26.C | 10 |
| `test/p26d-abort-correctness.test.ts` | P26.D | 7 |
| `test/p26e-git-runner-serialization.test.ts` | P26.E | 14 |
| `test/p26f-attempt-scoped-worktrees.test.ts` | P26.F | 13 |
| `test/p26g-state-store-serialization.test.ts` | P26.G | 10 |
| `test/p26h-validation-runner.test.ts` | P26.H | 24 |
| `test/p26i-validation-lane-backpressure.test.ts` | P26.I | 20 |
| `test/p26j-llm-provider-watchdog.test.ts` | P26.J | 12 |
| `test/p26k-lease-monitor.test.ts` | P26.K | 13 |
| `test/p26l-integration-queue-drift.test.ts` | P26.L | 12 |
| `test/p26m-plan-intake-anti-stall.test.ts` | P26.M | 11 |
| `test/p26n-promotion-gates.test.ts` | P26.N | 17 |
| **Total** | | **187** |

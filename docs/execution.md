# Auto Execution Architecture

## Overview

The execution system runs workspaces (tasks) generated from a plan (master template). Each workspace is a self-contained unit of work with a goal, acceptance criteria, file permissions, and output contract. The system schedules them respecting dependencies, runs each inside an isolated git worktree via an AI agent, and tracks state through a persistent store.

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
│  │  │ (IStateStore) │  │ (dep graph +     │  │ (escalation policy)  │  │  │
│  │  │              │  │  file locks)     │  │                      │  │  │
│  │  └──────────────┘  └──────────────────┘  └──────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │           WorkspaceAgentExecutor (SINGLETON)                  │  │  │
│  │  │           (workspace-agent-executor.ts)                       │  │  │
│  │  │                                                                │  │  │
│  │  │  ┌─────────────────┐  ┌──────────────────────────────────┐   │  │  │
│  │  │  │ execute()        │─▶│ executeInWorktree()              │   │  │  │
│  │  │  │ (entry point)    │  │                                  │   │  │  │
│  │  │  └─────────────────┘  │  ┌────────────────────────────┐  │   │  │  │
│  │  │                       │  │WorktreeWorkspaceExecutor    │  │   │  │  │
│  │  │                       │  │(worktree-workspace-        │  │   │  │  │
│  │  │                       │  │ executor.ts)               │  │   │  │  │
│  │  │                       │  │                            │  │   │  │  │
│  │  │                       │  │ 1. Create git worktree     │  │   │  │  │
│  │  │                       │  │ 2. Create INNER executor   │  │   │  │  │
│  │  │                       │  │ 3. executeAgentInPlace()   │  │   │  │  │
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
│  │  Concurrency pool (default: 6 slots)                                 │  │
│  │  Fill → Drain/Refill → Wait for all done                             │  │
│  │                                                                      │  │
│  │  Slot 1 ──▶ executor.executeWorkspace(ws_A)                          │  │
│  │  Slot 2 ──▶ executor.executeWorkspace(ws_B)   ◄── CONCURRENT!        │  │
│  │  Slot 3 ──▶ executor.executeWorkspace(ws_C)                          │  │
│  │  ...                                                                 │  │
│  │                                                                      │  │
│  │  When a slot frees → dispatch next ready workspace                   │  │
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
    │  Always sets worktree: { enabled: true } (P22.C)
    │  Always sets scale: { selectedMode: "experimental_6" }
    │
    ▼
Plan Commands (plan-commands.ts)
    │  createAutonomousExecutor(cwd, workers, retryPolicy, worktreeConfig)
    │     Creates JsonStateStore + AutonomousExecutor
    │     AutonomousExecutor constructor:
    │       Creates WorkspaceAgentExecutor singleton
    │         with worktree: { enabled: true }
    │
    ▼
ContinuousExecutor.executeAll()
    │  Phase 1: Fill — dispatch N workspaces concurrently (N = concurrency)
    │  Phase 2: Drain/Refill — on each completion, dispatch next ready
    │  No batch barrier — slots fill immediately
    │
    ▼ (per workspace, concurrent)
AutonomousExecutor.executeWorkspace(ws)
    │
    ├─ Memory guard check (worker-memory-guard.ts)
    ├─ Transition workspace → Active
    ├─ Acquire file locks (scheduler)
    ├─ Build role packet (worker/lead/flash/reviewer)
    ├─ Create snapshot directory
    │
    ▼
    agentExecutor.setLogPath(...)
    agentExecutor.execute(packet, workspaceId)
    │
    ▼
WorkspaceAgentExecutor.execute()
    │
    ├─ Create AbortController, set timeout
    │
    ├─ isWorktreeModeEnabled? YES (always true in P22.C)
    │     │
    │     ▼
    │   executeInWorktree()
    │     │
    │     ├─ Create/reuse WorktreeWorkspaceExecutor
    │     │     │
    │     │     ├─ acquireWorktreeMutex()   [global mutex]
    │     │     ├─ git rev-parse HEAD       [base commit]
    │     │     ├─ ensureBranch()           [git branch + file lock]
    │     │     │     ├─ Write .pi/worktree-branch-locks/<id>.lock
    │     │     │     ├─ git worktree prune
    │     │     │     ├─ git branch [--list, --force]
    │     │     │     └─ Release lock
    │     │     ├─ git worktree add --checkout <dir> <branch>
    │     │     └─ releaseWorktreeMutex()
    │     │
    │     ├─ Create INNER WorkspaceAgentExecutor
    │     │     scoped to worktree path
    │     │     worktree: { enabled: true }
    │     │     (but passes _skipWorktreeCheck to bypass recursion)
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
    │           │     ├─ LLM idle watchdog (5 min timeout)
    │           │     ├─ Tool execution tracking
    │           │     ├─ State store logging
    │           │     └─ Verdict extraction (COMPLETE/BLOCKED/FAILED)
    │           ├─ session.prompt(prompt)
    │           └─ Wait for completionPromise
    │
    ▼
    Process result:
    ├─ Completion gate evaluation
    ├─ Transition workspace (Complete/Failed/Blocked)
    ├─ Auto-commit (if enabled)
    ├─ Release file locks
    └─ Kill orphaned child processes
```

## State Persistence

```
.pi/
├── plan-state.json            ← Full execution state (PlanState)
├── execution-journal.ndjson   ← Journal events (append-only)
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
│       └── <workspaceId>/      ← Git worktree (actual checkout)
├── worktree-branch-locks/
│   └── <planExecId>.lock       ← Branch creation lock file
├── projects.json               ← Project tracking
└── executions/
    └── <planExecId>/
        └── worktrees/
            └── <workspaceId>.patch  ← Diff artifact
```

## Key Files & Responsibilities

| File | Role |
|------|------|
| `src/cli/plan-commands.ts` | CLI entry point: plan start/resume/rerun. Creates executors, runs the outer loop. |
| `src/core/plan-parser.ts` | Parses plan.md → WorkspaceQueue. Always forces `worktree: { enabled: true }`. |
| `src/core/autonomous-executor.ts` | Orchestrator: scheduling, packet building, retry, workspace lifecycle, state transitions. Creates the singleton `WorkspaceAgentExecutor`. |
| `src/core/workspace-agent-executor.ts` | Agent execution: creates worktrees, runs agents, extracts verdicts. **THE stateful singleton at the center of the concurrency bug.** |
| `src/core/continuous-executor.ts` | Concurrent executor: fills N slots, drains/refills continuously. Calls back into `AutonomousExecutor.executeWorkspace()`. |
| `src/worktree/worktree-workspace-executor.ts` | Git worktree create/remove lifecycle. Global `worktreeMutex` for serialization. |
| `src/core/workspace-scheduler.ts` | Dependency-aware scheduling: topological sort, file lock management, batch assignments. |
| `src/core/workspace-schema.ts` | Types for Workspace, WorkspaceQueue, PlanExecutionConfig, validation rules. |
| `src/core/plan-state.ts` | PlanState store: loads/saves `.pi/plan-state.json` and journal. |
| `src/core/json-state-store.ts` | `IStateStore` implementation wrapping `PlanStateStore`. Used by `AutonomousExecutor`. |
| `src/core/state-store.ts` | `IStateStore` interface: state transitions, journal, control requests, worker status. |
| `src/core/retry-handler.ts` | Retry policy, escalation stages (normal → flash → reviewer). |
| `src/core/role-packets.ts` | Builds worker/lead/flash/reviewer packets from workspace + state. |
| `src/core/completion-gate.ts` | Validates workspace completeness (target commands, tests, etc.) before marking Complete. |
| `src/core/auto-commit.ts` | Git commits per workspace (stages only canEdit files). |
| `src/core/worker-concurrency.ts` | Resolves effective worker count from `WorkerConcurrencySettings`. |
| `src/core/worker-memory-guard.ts` | Memory limit guard — waits for available memory before starting new workers. |
| `src/core/budget-enforcer.ts` | Token budget checks before agent execution. |

## Worktree Isolation Design

Each workspace runs inside its own git worktree:

```
Main checkout (workspaceRoot)
  .pi/worktrees/<planExecId>/<workspaceId-A>/    ← Workspace A's isolated tree
  .pi/worktrees/<planExecId>/<workspaceId-B>/    ← Workspace B's isolated tree
```

- Base commit: `HEAD` of main checkout at creation time
- Branch: `worktree/<planExecId>/<workspaceId>[-r<N>]`
- Worktree is preserved after execution (not auto-removed)
- Inner executor (scoped to worktree path) has `_skipWorktreeCheck: true` to avoid recursion

## Concurrent Execution Model

```
ContinuousExecutor (6 slots)
   │
   ├─ Slot 1: AutonomousExecutor.executeWorkspace(ws_A)
   │             │
   │             └─ agentExecutor.execute(packet, "A")  ← shared singleton!
   │
   ├─ Slot 2: AutonomousExecutor.executeWorkspace(ws_B)
   │             │
   │             └─ agentExecutor.execute(packet, "B")  ← SAME INSTANCE!
   │
   ├─ Slot 3: AutonomousExecutor.executeWorkspace(ws_C)
   │             │
   │             └─ agentExecutor.execute(packet, "C")  ← SAME INSTANCE!
   │
   └─ ...
```

## Identified Bugs & Risks

### BUG 1 — Singleton Agent Executor Race (CRITICAL)

**Severity**: Critical — causes data corruption, wrong abort targets, mixed log output.

**Root Cause**: `AutonomousExecutor` holds a single `WorkspaceAgentExecutor` instance (`this.agentExecutor`). The `ContinuousExecutor` calls `executeWorkspace()` concurrently for N workspaces, and each call re-enters the same agent executor. The agent executor's instance fields are all overwritten by concurrent calls:

| Field | Concurrent Access Pattern |
|-------|--------------------------|
| `this.abortController` | Created in `execute()`, overwritten by each concurrent call |
| `this.timeoutHandle` | Created in `execute()`, overwritten by each concurrent call |
| `this.llmIdleHandle` | Created in `executeAgentInPlace()`, overwritten by each concurrent call |
| `this.worktreeExecutor` | Created in `executeInWorktree()`, overwritten by each concurrent call |
| `this.logPath` | Set by `setLogPath()` right before `execute()` — race condition |
| `this.lastLLMEventTime` | Read/written in `executeAgentInPlace()` — interleaved by concurrent calls |

**Consequences**:
- AbortController A is overwritten by call B → call A cannot be aborted (targets B instead)
- Timeout for workspace A is cleared by workspace B's timeout setup
- LLM idle watchdog for workspace A is cleared by workspace B's calls
- `worktreeExecutor` state is overwritten — `saveWorktreeArtifactsBeforeStop()` references wrong worktree
- Log paths interleave — writing to wrong file or mixing log output

**Location**: `autonomous-executor.ts` line 245 (singleton creation), `workspace-agent-executor.ts` lines 227-237 (shared instance fields)

**Fix needed**: Either (a) create a new `WorkspaceAgentExecutor` per workspace execution call, or (b) make the agent executor stateless by passing all mutable state as method arguments rather than instance fields, or (c) add a mutex to serialize access.

### BUG 2 — Worktree Mutex Safety Timeout (MODERATE)

**Severity**: Moderate — can cause concurrent `git worktree add` operations to race.

**Root Cause**: The global `worktreeMutex` has a 5-second safety timeout (`setTimeout` in `acquireWorktreeMutex()`). If the mutex holder takes longer than 5 seconds (e.g., slow disk, large repo), subsequent workers bypass the mutex and race on `git worktree add` / `git branch`.

**Location**: `worktree-workspace-executor.ts` lines 52-68 (safety timeout in `acquireWorktreeMutex()`)

**Consequences**: Git ref locking errors, worktree creation failures, duplicate branches, crashed worktree state.

### BUG 3 — Branch Name Collision on Concurrent Workspaces (MODERATE)

**Severity**: Moderate — branch conflict errors during concurrent execution.

**Root Cause**: Multiple workspaces in the same plan use branch names derived from `planExecutionId` + `workspaceId`. When workspaces are concurrent, the `ensureBranch()` method uses a file lock, but the retry-to-unique-name fallback (`-rN` suffix) can still race:

```
Worker A: ensureBranch("worktree/execId/ws-A") → creates branch
Worker B: ensureBranch("worktree/execId/ws-A") → sees branch exists
Worker B: force-reset or create "worktree/execId/ws-A-r1"
```

If both workers see the branch as existing simultaneously (lock release race), both may try `--force` reset, or both may try to create `-r1`.

**Location**: `worktree-workspace-executor.ts` lines 194-242 (`ensureBranch()`)

### BUG 4 — StateStore Concurrent Access (MODERATE)

**Severity**: Moderate — journal interleaving, partial writes.

**Root Cause**: `JsonStateStore` delegates to `PlanStateStore` which uses file I/O (`fs.appendFile` for journal, `fs.writeFile` for state). Multiple concurrent workspace executions call `appendJournal`, `appendWorkspaceLog`, `emitWorkerStatus` etc. on the same store instance concurrently. File writes can interleave, producing malformed NDJSON lines or corrupted plan-state.json.

**Location**: `json-state-store.ts` — all state mutations used concurrently from multiple workspace executions.

**Consequences**: Corrupted journal, lost events, parse errors on recovery, state inconsistency.

### BUG 5 — ContinuousExecutor Callback Does Not Use AbortSignal (MODERATE)

**Severity**: Moderate — abort signal exists but is ignored.

**Root Cause**: In `plan-commands.ts` lines 953-955, the `executeWorkspace` callback receives an `AbortSignal` parameter (`_signal`) but ignores it. The `ContinuousExecutor` passes the signal to each slot, expecting the executor to detect abort and resolve promptly. Because it's ignored, abort only takes effect on the *next* scheduling round (when `getReadyWorkspaces` returns empty due to pause/stop detection), not on in-flight workspaces.

**Location**: `plan-commands.ts` line 953 (`async (ws, _signal) => { return await executor.executeWorkspace(ws); }`)

### BUG 6 — Worktree Dir for Inner Executor Lacks planExecutionId (LOW)

**Severity**: Low — log persistence may silently fail.

**Root Cause**: When `executeInWorktree()` creates the inner `WorkspaceAgentExecutor`, it passes `planExecutionId: this.planExecutionId` but the inner executor's `execute()` method with `_skipWorktreeCheck: true` goes directly to `executeAgentInPlace()`, which uses `this.stateStore` and `this.planExecutionId` for log persistence. The inner executor copies these from the outer, which is fine for the first concurrent call, but if the outer's `planExecutionId` were to change (via `setPlanExecutionId`), the inner executor would still hold the old reference.

**Location**: `workspace-agent-executor.ts` line 1018 (inner executor creation)

### BUG 7 — Crash Recovery Reuses Same Worktree Path (LOW)

**Severity**: Low — potential stale worktree on crash recovery.

**Root Cause**: When `adoptExistingExecution()` resets stranded Active workspaces to Pending, the next execution of that workspace will try to create a worktree at the same path. The existing worktree directory detection in `createWorktree()` checks for a valid `.git` file. If the worktree was partially cleaned up (e.g., .git file missing but directory exists), the stale directory removal might fail, causing a "fatal: '<path>' already exists" error.

**Location**: `worktree-workspace-executor.ts` lines 270-303 (stale worktree detection)

### BUG 8 — No Cross-Plan Worktree Conflict Prevention (LOW)

**Severity**: Low — two plans running concurrently on the same repo can collide.

**Root Cause**: The worktree mutex is process-global (module-level variable in `worktree-workspace-executor.ts`), not cross-process. Two separate plan executions (e.g., from two terminal sessions) can create worktrees that race on git ref operations. This also means the file-based branch lock (`worktree-branch-locks/<planExecId>.lock`) only covers branches for the same planExecId — different plan execution IDs can still race.

**Location**: `worktree-workspace-executor.ts` lines 32-68 (global mutex)

## Summary of Bug Severity

| # | Bug | Severity | Impact |
|---|-----|----------|--------|
| 1 | Singleton Agent Executor Race | **CRITICAL** | Concurrent workspaces corrupt each other's execution state |
| 2 | Worktree Mutex Safety Timeout | MODERATE | Rare concurrent git worktree add races |
| 3 | Branch Name Collision | MODERATE | Branch creation errors under high concurrency |
| 4 | StateStore Concurrent Access | MODERATE | Corrupted journal/state under concurrency |
| 5 | Ignored AbortSignal | MODERATE | Abort doesn't stop in-flight workspaces |
| 6 | Inner Executor planExecutionId | LOW | Log persistence edge case |
| 7 | Crash Recovery Stale Worktree | LOW | Rare failure on crash recovery |
| 8 | Cross-Plan Worktree Conflict | LOW | Two concurrent plans on same repo |

## Next Steps

1. **Bug 1 (CRITICAL)**: Fix the singleton `WorkspaceAgentExecutor` — either instantiate per-workspace or make it stateless/pass-through with all mutable state as method parameters.
2. **Bug 4 (MODERATE)**: Add mutex or queue to `IStateStore` operations, or switch to a proper database backend (PostgreSQL) with transaction support.
3. **Bug 5 (MODERATE)**: Wire the `AbortSignal` through to `agentExecutor.abort()` so in-flight workspaces respect abort/pause.
4. **Bug 2 (MODERATE)**: Increase the safety timeout or remove it in favor of a proper timeout on the actual worktree creation operation.

# Pi Monorepo — File Analysis Summary

**Date:** 2026-05-14  
**Scope:** `packages/ai/`, `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`, reference docs  
**Purpose:** Understand what every file does across the autonomous execution system, prompt cache architecture, P6 large-project scale reliability, performance telemetry, and cleanup/review pipeline

---

## Recent Commits (last 10, oldest to newest)

### 1. `fix: log failure reason when completion gate blocks workspace` (0ed9e1ff)

Completion gate block reasons are now written into workspace state as the `error` field, making them visible in the dashboard and logs. Previously only `console.warn` was emitted.

- **Files:** `packages/coding-agent/src/core/autonomous-executor.ts`

### 2. `feat(ui): show clear failure reason when workspace fails or blocked` (cddc31b5)

Updated `WorkerDetail` component: failed/blocked banner with icons, "Failure Reason" section (red), "Workspace State Error" section (amber), full-text attempt history errors, separate display for `worker.error` vs `workspace.error`.

- **Files:** `packages/web-ui/dashboard/src/components/WorkerDetail.tsx`

### 3. `feat(p4.6.3): abort in-flight agent execution on stop` (2ec81452)

Stop/pause signals can now cancel in-flight workspace executions. Added `AbortController` per execution in `WorkspaceAgentExecutor` — when abort fires, `session.agent.abort()` is called, which aborts the ongoing LLM API call. `AutonomousExecutor.stopAllActiveWorkspaces()` calls `agentExecutor.abort()` then waits via `Promise.allSettled`. PlanRunner calls `stopAllActiveWorkspaces()` on stop control signal.

- **Files:** `packages/coding-agent/src/core/autonomous-executor.ts`, `packages/coding-agent/src/core/workspace-agent-executor.ts`, `packages/web-server/src/plan-runner.ts`

### 4. `feat(pP2): complete workspace 5.5.G — Performance telemetry dashboard` (c581733e)

Added performance metrics hooks and panel components for the dashboard: `PerformancePanel.tsx`, `usePerformanceMetrics.ts`, `performance-routes.test.ts`.

- **Files:** 3 files in `packages/web-server/test/` and `packages/web-ui/dashboard/src/`

### 5. `feat(pP2): complete workspace 5.5.A — Prompt cache architecture` (6341d538)

Documentation-only commit: `docs/pi/performance/prompt-cache-architecture.md` — describes the prompt cache design.

- **Files:** `docs/pi/performance/prompt-cache-architecture.md`

### 6. `feat(p5.5): prompt cache architecture, worker live status, cleanup review, and dashboard animations` (f047aa15)

Major cross-cutting commit:
- **Backend:** `WorkspaceAgentExecutor` emits live `worker_status` events for full agent lifecycle (thinking, executing, deciding, compacting, retry)
- **Backend:** Cleanup/review worker runs after all plan workspaces complete — reviews changes, runs tests, catches bugs, auto-commits fixes
- **Backend:** Fixed plan auto-completion — when all workspaces pass + cleanup passes, plan auto-commits and marks complete
- **Backend:** Added `plan_summary` and `cleanup_workspace` journal event types
- **Backend:** Fixed pre-existing build error in `context-budget.ts` (re-export `TokenRole`)
- **API:** `GET /api/projects/:projectId/plans/:planExecId/summary` endpoint
- **Dashboard:** `ThinkingAnimation` component (animated brain/wrench icons, pulsing dots, live-writing text)
- **Dashboard:** `WorkerDetail` overview tab shows live agent state from transcript
- **Dashboard:** `LiveLogTerminal` log lines with fade-in animation, CPU spinner + thinking dots
- **Dashboard:** `PlanSummaryPanel` showing cleanup verdict, changed files, issues, test results
- **Dashboard:** `PlanSummaryPanel` in right sidebar below alerts

- **Files:** 13 files across `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 7. `feat(p5.5): complete workspaces 5.5.A-H — Performance, Cache & Retrieval Acceleration` (0c50ffbe)

Completes 8 workspaces:
- **5.5.A:** Prompt cache architecture — `PromptCachePolicy`, `PromptAssembler`, cacheable prefix/dynamic suffix split, stable prefix hash
- **5.5.B:** Static/dynamic context split — `ContextSection` classification, cacheability rules (static/semi-static/dynamic), budget enforcement
- **5.5.C:** Cacheable workspace packet format — Deterministic contract hashing, state separated from contract, `WorkspacePacket` type
- **5.5.D:** Local repo retrieval — `LocalRepoIndex` for snippet-level search, `RetrievalService` for relevant context fetching
- **5.5.E:** Execution memory — `ExecutionMemoryStore` for prior run reuse, summarization, relevance scoring
- **5.5.F:** Targeted validation planning — `ValidationPlanner` with decision tree: targetCommand → high-risk full validation → targeted file tests → fallback
- **5.5.G:** Performance telemetry dashboard — `CachePerformanceMetrics`, `WorkspacePerformanceMetrics`, `ValidationLockMetrics`, token split visualization, burn rate display
- **5.5.H:** Stability report & dogfood — E2E validation, 68% avg validation time reduction, 59% cache hit rate, no safety regressions

Key metrics: cacheable prefix ~5,200 tokens, dynamic suffix 1,800-3,200 tokens, avg cache hit rate 59.0%, validation time reduction 68% (102s → 33s avg).

- **Files:** 29 files across `packages/ai/`, `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 8. `feat(cleanup): review fixes and improvements` (387c3696)

Lint/cleanup fixes:
- `validation-lock`: add `reset()` method to `AsyncLock` for private field access
- `execution-memory`: string concat → template literals
- `local-repo-index`: remove unused `getLanguageFromExtension()` and `ig` field
- `validation-planner`: remove unused `deletedFiles` variable
- `repo-symbol-graph`: add missing config property declaration with lint suppression
- `context-section.test`: fix Message type compliance
- Various test files: remove unused imports, variables; fix biome lint warnings

- **Files:** 10 files across `packages/coding-agent/`

### 9. `feat(cleanup): review fixes and improvements` (197af512)

Large-scale P6 commit introducing the full large-project scale reliability architecture:
- **Worktree isolation:** `worktree-manager.ts`, `worktree-cleanup.ts`, `worktree-types.ts`, `worktree-workspace-executor.ts`
- **Dynamic scheduler:** `dynamic-scheduler.ts`, `scale-mode-policy.ts`
- **Integration queue:** `integration-queue.ts`, `integration-branch.ts`, `merge-conflict-handoff.ts`
- **Validation:** `test-impact-analyzer.ts`, `validation-planner.ts`
- **Failure handling:** `failure-classifier.ts`, `retry-router.ts`
- **Repo graph:** `repo-graph-builder.ts`
- **Dashboard:** `IntegrationQueuePanel`, `MergeConflictPanel`, `ScaleModeSettings`, `WorktreeStatusPanel`, `useScaleStatus` hook, `scale-routes.ts`
- **Scale readiness doctor:** `scale-readiness-doctor.ts`
- **Removed `packages/db/`** (entire PostgreSQL database package — deprecated)

60 files changed, 17340 additions, 1819 deletions. This is a major architecture addition for P6 large-project scale reliability.

### 10. `fix(ai): capture LLM cache usage data and compute cache hit rate in execution statistics` (e4df5440)

Previously `cache_hit_rate` was hardcoded as 0 with `known=false`. Now each assistant `message_end` event extracts `usage.cacheRead/input` from `AssistantMessage` and persists it as a `cache_usage` journal event. `getStatistics()` aggregates these events to compute `cache_hit_rate = cacheRead / (cacheRead + input)`.

Also fixes:
- `plan-summary.json` now scoped per plan execution: `.pi/executions/{planExecId}/plan-summary.json`
- `PlanSummaryPanel` sidebar container made scrollable
- P6 phase plan dependency graph flattened to reduce serial bottlenecks
- Thinking streaming buffers deltas until newline before logging

- **Files:** 6 files across `packages/coding-agent/`, `packages/web-server/`

---

## Reference Documents

| File | Purpose |
|---|---|
| `docs/llm-implementation-agent-master-template.md` | **Canonical plan template v2.1.0** — Defines the 4-part structure (Phase Plan, Agent Brief, Machine-Readable Execution Contract, Machine-Readable Summary) used by Pi to execute plans autonomously. Introduces PostgreSQL-backed multi-project execution, state backends (postgres/json), dashboard enablement, safety gates, and control model. |
| `docs/pi_autonomous_multiagent_plan_executor.md` | **Phase P2 plan** — Concrete instance of the master template describing the full scope: plan parser, workspace schema, state store, DAG scheduler, packet builders, autonomous execution loop, 3-worker scheduler, retry loop, auto-commit, doctor/safety, CLI commands, and an E2E dry run. |
| `docs/pi/performance/prompt-cache-architecture.md` | **Prompt cache architecture** (workspace 5.5.A) — Describes cacheable prefix / dynamic suffix split, stable prefix hashing, version bump strategy. |
| `docs/pi/stability/p5-5-performance-cache-report.md` | **P5.5 stability report & dogfood** (workspace 5.5.H) — E2E validation metrics, cache hit rates, validation time reduction, safety assurance. |
| `docs/phase_p_6_large_project_scale_reliability.md` | **Phase P6 plan** — Large project scale reliability: worktree isolation, dynamic scheduling, integration queue, merge conflict resolution, test impact analysis, failure classification. |
| `docs/pi/scale/worktree-isolation.md` | **Worktree isolation design** — How Pi uses git worktrees to isolate workspace executions and prevent cross-contamination. |
| `docs/pi/stability/p6-large-project-scale-report.md` | **P6 stability report** — Dogfood results for large-project scale mode. |

---

## File Tree — `packages/ai`

```
packages/ai/
  src/
    prompt-cache.ts                # PromptCachePolicy — cacheable prefix/dynamic suffix split, prefix hashing, assembly
    index.ts                       # Re-exports prompt-cache.ts in addition to existing exports
    models.generated.ts            # Updated model data: OpenAI GPT-4.1 pricing, DeepSeek V4 Flash (free), GLM-4.6V maxTokens fix, OSS model maxTokens bump
  test/
    prompt-cache-policy.test.ts    # 450-line exhaustive test suite for prompt cache policy
```

### Key additions

#### `src/prompt-cache.ts` — Prompt Cache Architecture

Core prompt caching logic separating cacheable prefix from dynamic suffix:

| Export | Purpose |
|---|---|
| `CACHE_PREFIX_VERSION` | Current prefix version constant (v1) — bump when safety/policy rules change |
| `PromptAssembly` | Result type: version + prefix (cacheable) + suffix (dynamic messages) |
| `PromptPrefix` | Cacheable portion: systemPrompt, tools, pinnedMessages |
| `assemblePrompt(context, options)` | Splits context into prefix/suffix based on pinnedMessageCount |
| `computePrefixHash(prefix)` | Stable hash of prefix content (deterministic, order-independent for tools) |
| `computeContextPrefixHash(context, options)` | Hash directly from Context |
| `prefixHashStableAcrossSuffixChange(a, b)` | Verify hash stability across suffix-only changes |

---

## File Tree — `packages/coding-agent`

```
packages/coding-agent/src/
  context/
    context-builder.ts             # Static/dynamic context split, context section classification, budget enforcement
    context-section.ts             # ContextSection types + cacheability rules (static/semi-static/dynamic)
    workspace-packet.ts            # WorkspacePacket — deterministic contract hashing, state separated from contract
  core/
    cleanup-review.ts              # Cleanup/review worker — runs after all plan workspaces complete, reviews changes, runs tests, auto-commits fixes. Writes plan-summary.json per execution.
    context-budget.ts              # Context budget limits per role, fixed re-export of TokenRole
    autonomous-executor.ts         # AutonomousExecutor — tracks in-flight executions, supports abortAll/stopAllActiveWorkspaces, error state for completion gate blocks
    workspace-agent-executor.ts    # WorkspaceAgentExecutor — per-execution AbortController for in-flight LLM abort, cache_usage journal events, live worker_status events, thinking buffer logging
    database-state-store.ts        # DatabaseStateStore — getStatistics() computes cache_hit_rate from cache_usage journal events
    json-state-store.ts            # JsonStateStore — same cache_hit_rate computation from journal events
    plan-state.ts                  # Added cache_usage and cleanup/review journal event types
    validation-lock.ts             # AsyncLock with reset() method for test cleanup
  memory/
    execution-memory.ts            # ExecutionMemory — relevance scoring, string concat → template literals cleanup
    execution-memory-store.ts      # ExecutionMemoryStore — prior run reuse, summarization, scoring
  retrieval/
    local-repo-index.ts            # LocalRepoIndex — snippet-level search, removed unused getLanguageFromExtension()
    retrieval-service.ts           # RetrievalService — fetches relevant context from local repo
  repo-graph/
    repo-symbol-graph.ts           # RepoSymbolGraph — maps files to tests, tracks import/export, conflict detection
    repo-graph-builder.ts          # Builds the symbol graph from repository source
  scheduler/
    dynamic-scheduler.ts           # P6 dynamic scheduler — multi-workspace scheduling with dependency resolution
    scale-mode-policy.ts           # P6 scale mode policy — decides when to parallelize vs serialize
  integration/
    integration-queue.ts           # P6 integration queue — manages merge order of parallel workspaces
    integration-branch.ts          # P6 integration branch — temporary branch for merging workspace changes
    merge-conflict-handoff.ts      # P6 merge conflict resolution — detects and resolves conflicts between workspaces
  validation/
    validation-planner.ts          # ValidationPlanner — decision tree for targeted test selection, removed unused deletedFiles
    test-impact-analyzer.ts        # P6 test impact analysis — determines which tests to run from changed files
  worktree/
    worktree-manager.ts            # P6 worktree manager — creates/manages git worktrees for workspace isolation
    worktree-cleanup.ts            # P6 worktree cleanup — removes worktrees after execution
    worktree-types.ts              # P6 worktree type definitions
    worktree-workspace-executor.ts # P6 worktree workspace executor — runs workspaces in isolated worktrees
  failure/
    failure-classifier.ts          # P6 failure classifier — categorizes failures for retry routing
    retry-router.ts                # P6 retry router — decides retry strategy based on failure category
  doctor/
    scale-readiness-doctor.ts      # P6 scale readiness doctor — checks if project is ready for scale mode
test/
  dynamic-scheduler.test.ts        # 801 lines
  failure-classifier.test.ts       # 497 lines
  integration-queue.test.ts        # 871 lines
  merge-conflict-handoff.test.ts   # 656 lines
  p6-large-project-dogfood.test.ts # 829 lines
  repo-symbol-graph.test.ts        # 695 lines
  scale-mode-policy.test.ts        # 584 lines
  test-impact-analyzer.test.ts     # 436 lines
  worktree-manager.test.ts         # 665 lines
  worktree-workspace-executor.test.ts  # 908 lines
  autonomous-executor.test.ts      # 161 lines
  context-section.test.ts          # 781 lines — fixed Message type compliance
  execution-memory.test.ts         # 622 lines
  local-repo-index.test.ts         # 764 lines
  p55-performance-dogfood.test.ts  # 850 lines
  validation-planner.test.ts       # 655 lines
  workspace-packet.test.ts         # 469 lines
```

### Key Files

#### `core/cleanup-review.ts`

Post-execution review agent that runs after all plan workspaces complete. Reviews code changes, runs tests, catches bugs, and auto-commits fixes. Writes cleanup summary to `.pi/executions/{planExecId}/plan-summary.json`.

Key changes:
- Summary path scoped per plan execution (was global `.pi/plan-summary.json`)
- Emits `plan_summary` and `cleanup_workspace` journal events

#### `core/workspace-agent-executor.ts`

Central workspace execution engine with significant additions:

| Feature | Detail |
|---|---|
| AbortController | Per-execution `AbortController` — `abort()` cancels in-flight LLM API call, returns clean FAILED |
| Cache usage capture | Extracts `usage.cacheRead/input` from `AssistantMessage.message_end`, persists as `cache_usage` journal event |
| Worker status events | Emits `worker_status` events for lifecycle: thinking, executing, deciding, compacting, retry |
| Thinking buffer logging | Buffers thinking deltas until newline before logging (no character-by-character noise) |

#### `core/autonomous-executor.ts`

Orchestrates multiple workspace executions:

| Feature | Detail |
|---|---|
| `stopAllActiveWorkspaces()` | Calls `agentExecutor.abort()` for each in-flight execution, waits via `Promise.allSettled` |
| Completion gate | Block reasons written to workspace state as `error` field (visible in dashboard) |
| In-flight tracking | Tracks execution promises per workspace ID |

#### `context/` — Cacheable Context Architecture

| File | Key Exports |
|---|---|
| `context-section.ts` | `ContextSection` classification (static/semi-static/dynamic), cacheability rules |
| `context-builder.ts` | Static/dynamic context split, budget enforcement |
| `workspace-packet.ts` | `WorkspacePacket` — deterministic contract hashing, state separated from contract |

#### `memory/execution-memory.ts`

| Feature | Detail |
|---|---|
| Relevance scoring | Tokenizes goal + acceptance criteria, compares with stored entries via Jaccard similarity |
| Prior run reuse | `ExecutionMemoryStore` provides summarization and relevance scoring for reusing past runs |

#### `retrieval/local-repo-index.ts`

| Feature | Detail |
|---|---|
| Snippet-level search | Indexes repository files for snippet-level content search |
| Removed unused | `getLanguageFromExtension()` and `ig` field removed |

#### `validation/validation-planner.ts`

| Feature | Detail |
|---|---|
| Decision tree | `targetCommand` → high-risk check → full validation → targeted file tests → fallback |
| Removed unused | `deletedFiles` variable |

---

## File Tree — `packages/web-server`

```
packages/web-server/
  src/
    index.ts                       # Fastify server — added GET /api/projects/:projectId/plans/:planExecId/summary endpoint
    plan-runner.ts                 # Background plan execution — abort on stop control signal
    scale-routes.ts                # P6 scale routes — API endpoints for scale mode, worktree status, integration queue
  test/
    scale-routes.test.ts           # 423 lines
    performance-routes.test.ts     # 508 lines — workspace 5.5.G performance telemetry dashboard routes
    log-buffer.test.ts             # 164 lines
```

### Key Changes

#### `src/index.ts`

New endpoint:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:projectId/plans/:planExecId/summary` | Returns cleanup review summary, scoped to `.pi/executions/{planExecId}/plan-summary.json` |

#### `src/plan-runner.ts`

- `executePlanInBackground()` calls `executor.stopAllActiveWorkspaces()` on stop control signal (aborts in-flight LLM calls)

#### `src/scale-routes.ts` (new)

P6 scale mode API routes: worktree status, dynamic scheduling control, integration queue monitoring.

---

## File Tree — `packages/web-ui/dashboard`

```
packages/web-ui/dashboard/src/
  App.tsx                          # Updated imports for new components
  app.css                          # Animations for ThinkingAnimation, fade-in log lines
  types.ts                         # Added PerformanceMetric types
  components/
    PlanSummaryPanel.tsx           # New — cleanup verdict, changed files, issues, test results; scrollable sidebar
    ThinkingAnimation.tsx          # New — animated brain/wrench icons, pulsing dots, live-writing text
    LiveLogTerminal.tsx            # Updated — fade-in animation, active worker CPU spinner + thinking dots footer
    WorkerDetail.tsx               # Updated — live agent state from transcript, failed/blocked banners, worker.error vs workspace.error display
    IntegrationQueuePanel.tsx      # New — P6 integration queue status
    MergeConflictPanel.tsx         # New — P6 merge conflict display
    ScaleModeSettings.tsx          # New — P6 scale mode configuration
    WorktreeStatusPanel.tsx        # New — P6 worktree status display
    PerformancePanel.tsx           # New — cache performance metrics, workspace performance metrics, token split visualization, burn rate display
  hooks/
    useScaleStatus.ts              # New — P6 scale status hook (worktree, integration queue, merge conflicts)
    usePerformanceMetrics.ts       # New — fetches performance telemetry from /api/performance/*
```

### Key Components

#### `PlanSummaryPanel.tsx`

Displays cleanup review results in the right sidebar below alerts:
- Cleanup verdict (pass/fail)
- Changed files list
- Issues found
- Test results
- Scrollable container (fixed overflow issue)

#### `WorkerDetail.tsx`

Updated with:
- Failed/Blocked banner with icons at top when stage is terminal-unhealthy
- "Failure Reason" section with red background showing exact error
- "Workspace State Error" section in amber for additional context
- Full-text attempt history errors (not truncated)
- Separate display for `worker.error` vs `workspace.error`
- Live agent state from transcript (thinking, executing, deciding, etc.)

#### `ThinkingAnimation.tsx`

Animated component showing agent thinking state:
- Animated brain/wrench icons cycling
- Pulsing dots
- Live-writing text with cursor
- Used in WorkerDetail to show active agent state

---

## Architecture Overview

```
Browser (Dashboard UI — React + Vite)
  │
  ├── HTTP polling (5-10s intervals)
  ├── SSE streams (real-time events + logs)
  └── WebSocket (live workspace logs)
        │
        ▼
Web Server (Fastify on :3000)
  │
  ├── REST API endpoints
  ├── SSE endpoint handlers
  ├── WebSocket handler
  ├── Scale Mode API routes (scale-routes.ts)
  │
  ├── Background Plan Runner (plan-runner.ts)
  │   ├── Now supports abort on stop control signal
  │   ├── Cleanup/review worker runs after all workspaces complete
  │   └── Auto-commit on successful plan + cleanup
  │
  ├── State Store Provider (singleton)
  │   ├── IStateStore (PostgreSQL or JSON fallback)
  │   ├── getStatistics() now computes real cache_hit_rate from cache_usage journal events
  │   └── SettingsManager
  │
  └── Reads/Writes
      ├── .pi/plan-state.json (legacy)
      ├── .pi/execution-journal.ndjson (legacy)
      ├── .pi/workspaces/{id}/attempts/{n}/*.log (legacy)
      ├── .pi/plans/*.md (saved plans)
      ├── .pi/{execId}.workspace-queue.json (crash recovery)
      ├── .pi/executions/{planExecId}/plan-summary.json (cleanup review — per execution)
      └── PostgreSQL (when backend=postgres, removed in P6)

Coding Agent (packages/coding-agent/)
  │
  ├── Context Layer
  │   ├── Prompt cache (ai/src/prompt-cache.ts) — cacheable prefix/dynamic suffix
  │   ├── Context sections (context/) — static/semi-static/dynamic classification
  │   └── Workspace packets — deterministic contract hashing
  │
  ├── Execution Layer
  │   ├── AutonomousExecutor — orchestrates workspaces, abort support
  │   ├── WorkspaceAgentExecutor — per-workspace LLM execution, cache tracking, live status
  │   └── Cleanup review — post-execution code review + test + auto-commit
  │
  ├── Memory & Retrieval
  │   ├── ExecutionMemory — prior run reuse + relevance scoring
  │   ├── LocalRepoIndex — snippet-level content search
  │   └── RetrievalService — context fetching
  │
  ├── P6 Scale Mode
  │   ├── DynamicScheduler — multi-workspace scheduling
  │   ├── IntegrationQueue/Branch/MergeConflict — parallel workspace merging
  │   ├── WorktreeManager — git worktree isolation
  │   ├── TestImpactAnalyzer — targeted test selection
  │   ├── RepoSymbolGraph — file-to-test mapping
  │   ├── FailureClassifier/RetryRouter — categorized retry logic
  │   └── ScaleReadinessDoctor — pre-flight checks
  │
  └── Validation
      └── ValidationPlanner — decision tree: full test → targeted → fallback

```

## Data Flow — Plan Upload to Completion

1. **User uploads plan** via `PlanUploadDialog` → `usePlanRunner` validates via POST `/api/projects/:id/plans/validate` → safety doctor check
2. **User confirms** → POST `/api/projects/:id/plans/run` → `runPlan()` in `plan-runner.ts`
3. **Plan is parsed**, queue validated, safety doctor runs, plan file saved to `.pi/plans/`
4. **AutonomousExecutor** created → `initialize()` → `executePlanInBackground()`
5. **Execution loop**: `getNextWorkspaces()` → `executeWorkspace()` for each → abort if stop/pause signal → live `worker_status` events → cache usage tracked via `cache_usage` journal events → thinking stream buffered
6. **Dashboard polls** `/api/projects/:id/plans/:execId` every 5s, SSE pushes real-time events, WebSocket streams live logs
7. **On all workspaces complete**: cleanup/review worker runs → reviews changes, runs tests, catches bugs → auto-commits fixes → writes `plan-summary.json` to `.pi/executions/{planExecId}/`
8. **On completion**: plan auto-commits and marks complete (no more stuck `awaiting_handoff`)
9. **On stop signal**: `executor.stopAllActiveWorkspaces()` → each in-flight `WorkspaceAgentExecutor.abort()` → `session.agent.abort()` → ongoing LLM call aborted → clean FAILED state
10. **On crash**: `resumeStrandedExecutions()` scans `.pi/` for queue snapshots at server startup and resumes

## Key Metrics (from P5.5 dogfood report)

| Metric | Value |
|---|---|
| Cacheable prefix tokens | ~5,200 tokens stable across workspace calls |
| Dynamic suffix tokens | 1,800-3,200 tokens per workspace |
| Avg cache hit rate | 59.0% |
| Validation time reduction | 68% (102s → 33s avg) |
| Prefix hash stability | 100% stable within session, 0 false cache invalidations |
| Cache unknown vs 0% | Clearly distinguished in UI (was hardcoded, now real data) |

## Removed

- **`packages/db/`** — Entire PostgreSQL database package removed in P6 cleanup. The JSON state store is now the primary backend.

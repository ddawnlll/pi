# Autonomous Execution System — File Analysis Summary

**Date:** 2026-05-12  
**Scope:** `packages/web-ui/dashboard/`, `packages/web-server/`, reference docs  
**Purpose:** Understand what every file does for the P2 autonomous multi-agent plan executor system

---

## Reference Documents

| File | Purpose |
|---|---|
| `docs/llm-implementation-agent-master-template.md` | **Canonical plan template v2.1.0** — Defines the 4-part structure (Phase Plan, Agent Brief, Machine-Readable Execution Contract, Machine-Readable Summary) used by Pi to execute plans autonomously. Introduces PostgreSQL-backed multi-project execution, state backends (postgres/json), dashboard enablement, safety gates, and control model. |
| `docs/pi_autonomous_multiagent_plan_executor.md` | **Phase P2 plan** — Concrete instance of the master template describing the full scope: plan parser, workspace schema, state store, DAG scheduler, packet builders, autonomous execution loop, 3-worker scheduler, retry loop, auto-commit, doctor/safety, CLI commands, and an E2E dry run. |

---

## File Tree — `packages/web-server`

```
packages/web-server/
  package.json                  # Fastify server deps (fastify, cors, websocket, static)
  tsconfig.json                 # ESNext module, ES2022 target, strict
  src/
    index.ts                    # Web server entry point — all REST/SSE/WS endpoints
    plan-runner.ts              # Background plan execution manager (AutonomousExecutor)
    state-store-provider.ts     # Singleton state store + settings manager provider
  dist/                         # Compiled JS output
```

### File-by-File Breakdown

#### `src/index.ts` — Web Server Entry Point

**Role:** Fastify HTTP/WS server that hosts the REST API for the plan dashboard.

**Legacy Endpoints (backward compatible, file-based):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/plan-state` | Poll legacy `plan-state.json` file |
| GET | `/api/events` | SSE stream of `execution-journal.ndjson` |
| GET | `/api/logs/:workspaceId/:attempt/:stream` | SSE stream of worker log files |
| POST | `/api/control` | Write control command to `plan-control.json` |

**Multi-Project Endpoints (P2 Phase 1):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a new project |
| PATCH | `/api/projects/:id` | Update project name/rootPath |
| GET | `/api/projects/:id/plans` | List plan executions for a project |
| GET | `/api/projects/:id/plans/:execId` | Get plan execution detail |
| GET | `/api/projects/:id/plans/:execId/events` | SSE stream of plan events (LISTEN/NOTIFY or file watch) |
| GET | `/api/projects/:id/plans/:execId/stats` | Plan execution statistics |
| GET | `/api/projects/:id/plans/:execId/journal` | Paginated execution journal |
| GET | `/api/projects/:id/plans/:execId/workspaces` | List workspace executions |
| GET | `/api/projects/:id/plans/:execId/workspaces/:wsId` | Get workspace detail |
| GET | `/api/projects/:id/plans/:execId/workspaces/:wsId/logs` | Recent workspace logs |
| POST | `/api/projects/:id/plans/validate` | Validate plan content |
| POST | `/api/projects/:id/plans/run` | Upload, validate, and run a plan |
| GET | `/api/projects/:id/active` | Get active executions for a project |

**Execution Control & Logging:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/executions/:planExecId/control` | Pause/stop/cancel/resume a specific execution |
| GET | `/api/executions/:planExecId` | Get a specific active execution |
| GET | `/api/executions/:planExecId/log` | Get execution log file content |
| GET | `/api/logs/:planExecId/:workspaceId/recent` | Recent workspace logs |
| WS | `/api/ws/logs/:planExecId/:workspaceId` | WebSocket live log streaming |

**Settings & AI Models:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Merged global + project settings |
| PUT | `/api/settings` | Update global settings |
| GET | `/api/settings/global` | Global-only settings |
| GET | `/api/settings/project` | Project-only settings |
| PUT | `/api/settings/project` | Update project settings |
| GET | `/api/settings/context-budgets` | Context budget settings |
| GET | `/api/ai-models` | List all providers + models |
| GET | `/api/health` | Health check |

---

#### `src/plan-runner.ts` — Background Plan Runner

**Role:** Manages `AutonomousExecutor` instances in the background so plan execution runs asynchronously through the web API.

| Export | Type | Purpose |
|---|---|---|
| `ActiveExecution` | Interface | Tracks running/completed/failed execution metadata |
| `RunPlanOptions` | Interface | Input to start a plan (content, project, workspace root) |
| `RunPlanResult` | Interface | Return value from starting a plan |
| `getActiveExecutions(projectId)` | Function | List active executions for a project |
| `getActiveExecution(planExecId)` | Function | Get a specific active execution |
| `runPlan(options)` | Function | Parse, validate, doctor-check, save plan file, create executor, start background loop |
| `executePlanInBackground(...)` | Async function | Core loop: iterate workspaces, schedule, execute, retry, check control, log |
| `persistWorkspaceQueue(...)` | Async function | Save queue snapshot to `.pi/` for crash recovery |
| `resumeStrandedExecutions(...)` | Async function | Server startup recovery — scan for queue snapshots, adopt existing state, resume |
| `generateExecutionSummary(...)` | Function | Text summary of completed execution |

---

#### `src/state-store-provider.ts` — State Store Singleton

**Role:** Provides a single shared `IStateStore` instance and `SettingsManager` for all web-server modules.

| Export | Type | Purpose |
|---|---|---|
| `getWorkspaceRoot()` | Function | Resolve workspace root from env `PI_WORKSPACE_ROOT` or cwd |
| `getStateStore()` | Function | Singleton state store — detects backend (postgres/json) |
| `getSettingsManager()` | Function | Singleton settings manager with `FileSettingsStorage` |
| `getJsonStateStore()` | Function | Legacy `JsonStateStore` wrapper for file-based access |

---

## File Tree — `packages/web-ui/dashboard`

```
packages/web-ui/dashboard/
  package.json                  # Vite + React 18 + TanStack Query + Framer Motion
  tsconfig.json                 # ES2022, DOM, strict, jsx-react
  vite.config.ts                # Vite config — proxies /api → :3000, node stubs
  index.html                    # HTML entry point
  QUICKSTART.md                 # Setup guide for running dashboard + mock data
  src/
    main.tsx                    # App bootstrap: ReactDOM + QueryClientProvider
    App.tsx                     # Root component: layout, state management, routing
    types.ts                    # All TypeScript interfaces
    tailwind.css                # Tailwind CSS with Tailwind v4
    index.css                   # Base styles
    app.css                     # App-specific styles
    utils/
      format.ts                 # formatElapsed(), getStatusColorClass()
    stubs/                      # Browser stubs for Node modules (Vite alias)
      child_process.ts
      crypto.ts
      fs.ts
      fs-promises.ts
      os.ts
      path.ts
    hooks/
      usePlanState.ts           # Legacy: poll /api/plan-state every 5s
      useLogStream.ts           # Legacy: SSE log stream per workspace/attempt
      useJournalStream.ts       # Legacy: SSE journal stream from /api/events
      useProjects.ts            # Query + create projects via /api/projects
      usePlanExecutions.ts      # Query plan executions, details, stats, journal pages
      usePlanEvents.ts          # SSE event stream for a specific plan execution
      usePlanRunner.ts          # Validate, run, and check active plan executions
      useSettings.ts            # Read/write settings, context budgets, AI models
      useWorkspaceLogStream.ts  # WebSocket live log streaming for a workspace
    components/
      Header.tsx                # Top bar: "Pi Plan Dashboard" title + status badge + control buttons
      ControlButtons.tsx        # Pause/Stop/Cancel/Resume with confirmation popover
      PlanSummary.tsx           # Legacy card: plan title, phase, status, elapsed
      QueuePanel.tsx            # Legacy card: pending/active/blocked/complete/failed counts
      WorkerList.tsx            # Grouped worker list (active, pending, blocked, completed, failed)
      WorkerDetail.tsx          # Selected workspace detail + live WebSocket log viewer
      LogViewer.tsx             # Legacy monospace terminal log viewer with stream tabs
      EventFeed.tsx             # Right sidebar: real-time event feed with filter
      ProjectList.tsx           # Left sidebar: list of projects + new project button
      PlanHistory.tsx           # Left sidebar: list of past plan executions per project
      OpenProjectDialog.tsx     # Modal: create new project or select existing
      PlanUploadDialog.tsx      # Modal: paste plan content, validate, run with confirmation
      SettingsDialog.tsx        # Modal: 4-tab settings (General, Budgets, Project, Advanced)
      ExecutionLogViewer.tsx    # Modal: view full execution log with auto-refresh
  dist/
    index.html                  # Built output
    assets/
      main-*.js                 # Bundled JS
      main-*.css                # Bundled CSS
```

### File-by-File Breakdown

#### Entry Points

| File | Purpose |
|---|---|
| `index.html` | Loads `main-*.js` and `main-*.css`, mounts React at `<div id="root">` |
| `src/main.tsx` | Creates `QueryClient`, renders `<App>` inside `<QueryClientProvider>` |
| `src/App.tsx` | **Root component** — 3-panel layout: left sidebar (projects + plan history), center (execution info + workers + logs), right sidebar (event feed). Manages all state: project selection, plan execution selection, worker selection, log streams, dialogs. Handles both legacy (single-plan) and new (multi-project) modes. |

#### Types (`src/types.ts`)

| Type | Purpose |
|---|---|
| `PlanState` | Legacy plan state from `plan-state.json` |
| `WorkerInfo` | Legacy worker metadata (id, stage, attempt, retries) |
| `ExecutionEvent` | Legacy journal event |
| `ControlRequest` / `ControlResponse` | Legacy control API types |
| `LogStream` | Union: "stdout" \| "stderr" \| "test" \| "error" |
| `Project` | Multi-project: id, name, description, rootPath, createdAt |
| `PlanExecution` | Plan execution summary (id, project, phase, title, status, timestamps) |
| `PlanExecutionStatus` | Union of all statuses |
| `PlanExecutionDetail` | Full detail with workspace summaries |
| `WorkspaceSummary` | Workspace within an execution (id, stage, attempts, error, timestamps) |
| `WorkspaceDetail` | Workspace with owned files |
| `JournalEvent` | New SSE journal event |
| `ExecutionStats` | Counts per status |
| `JournalPage` | Paginated journal response |

#### Stubs (`src/stubs/`)

Browser-safe replacements for Node built-in modules. Used by Vite's `resolve.alias` to prevent bundling Node modules in the browser:

| File | Purpose |
|---|---|
| `child_process.ts` | Stub — returns empty/noop |
| `crypto.ts` | Stub — returns empty/noop |
| `fs.ts` | Stub — returns empty/noop |
| `fs-promises.ts` | Stub — returns empty/noop |
| `os.ts` | Stub — returns empty/noop |
| `path.ts` | Stub — returns empty/noop |

#### Hooks

| Hook | Purpose |
|---|---|
| `usePlanState()` | Legacy: polls `/api/plan-state` every 5s via TanStack Query |
| `useLogStream(workspaceId, attempt, stream)` | Legacy: SSE connection to `/api/logs/:id/:attempt/:stream`, collects lines |
| `useJournalStream()` | Legacy: SSE connection to `/api/events`, collects last 50 events |
| `useProjects()` | Lists projects via `/api/projects`, provides `createProject()` |
| `usePlanExecutions(projectId)` | Lists executions for a project (poll 10s) |
| `usePlanExecutionDetail(projectId, planExecId)` | Fetches execution detail (poll 5s) |
| `usePlanStats(projectId, planExecId)` | Fetches execution stats (poll 5s) |
| `useJournalPage(projectId, planExecId)` | Paginated journal (poll 10s) |
| `usePlanEvents({projectId, planExecId})` | SSE event stream for a specific execution via `/api/.../events` |
| `usePlanRunner(projectId)` | Manages validate/run lifecycle for plan upload |
| `useSettings()` | Reads merged settings, context budgets, AI models; provides update mutations |
| `useProjectMeta()` | PATCH `/api/projects/:id` for name/rootPath updates |
| `useWorkspaceLogStream(planExecId, workspaceId)` | WebSocket connection to `/api/ws/logs/:planExecId/:workspaceId` for real-time logs |

#### Components

| Component | Purpose |
|---|---|
| `Header` | Top bar with title, animated status badge, and control buttons |
| `ControlButtons` | Pause/Stop/Cancel/Resume buttons with animated confirmation popover |
| `PlanSummary` | Legacy card showing plan title, phase, status, elapsed time |
| `QueuePanel` | Legacy card showing queue breakdown (pending/active/blocked/complete/failed) |
| `WorkerList` | Animated grouped list of workers by stage (active, pending, blocked, complete, failed) |
| `WorkerDetail` | Selected worker's metadata (id, stage, attempts, error) + live logs section |
| `LogViewer` | Legacy terminal-style log viewer with stdout/stderr/error stream tabs, auto-scroll |
| `EventFeed` | Right sidebar — real-time execution events with all/errors filter |
| `ProjectList` | Left sidebar — list of projects with selection + "New" button |
| `PlanHistory` | Left sidebar — plan executions per project with status badges |
| `OpenProjectDialog` | Modal for creating new project or selecting existing one |
| `PlanUploadDialog` | Modal for pasting plan content, validating, and running with confirmation |
| `SettingsDialog` | 4-tab settings modal: General (provider/model/theme/mode), Context Budgets (token limits per role), Project (name/path/shell/quiet), Advanced (shell/telemetry/skills) |
| `ExecutionLogViewer` | Modal showing full execution log with auto-refresh every 2s |

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
  │
  ├── Background Plan Runner (plan-runner.ts)
  │   ├── Parses plans
  │   ├── Creates AutonomousExecutor
  │   ├── Runs executePlanInBackground loop
  │   └── Handles crash recovery
  │
  ├── State Store Provider (singleton)
  │   ├── IStateStore (PostgreSQL or JSON fallback)
  │   └── SettingsManager
  │
  └── Reads/Writes
      ├── .pi/plan-state.json (legacy)
      ├── .pi/execution-journal.ndjson (legacy)
      ├── .pi/workspaces/{id}/attempts/{n}/*.log (legacy)
      ├── .pi/plans/*.md (saved plans)
      ├── .pi/{execId}.workspace-queue.json (crash recovery)
      └── PostgreSQL (when backend=postgres)

```

## Data Flow — Plan Upload to Completion

1. **User uploads plan** via `PlanUploadDialog` → `usePlanRunner` validates via POST `/api/projects/:id/plans/validate` → safety doctor check
2. **User confirms** → POST `/api/projects/:id/plans/run` → `runPlan()` in `plan-runner.ts`
3. **Plan is parsed**, queue validated, safety doctor runs, plan file saved to `.pi/plans/`
4. **AutonomousExecutor** is created with shared state store → `initialize()` → `executePlanInBackground()`
5. **Execution loop**: calls `getNextWorkspaces()`, runs `executeWorkspace()` for each, checks control requests, logs via state store
6. **Dashboard polls** `/api/projects/:id/plans/:execId` every 5s for detail, SSE stream pushes real-time events
7. **WebSocket** `/api/ws/logs/:planExecId/:workspaceId` streams live workspace logs to `WorkerDetail`
8. **On completion**: summary generated, plan finalized, execution marked complete
9. **On crash**: `resumeStrandedExecutions()` scans `.pi/` for queue snapshots at server startup and resumes

# Phase P22 — Project Hub: Project-Centric Architecture & Worktree Workspace

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-23  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-23

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P22`  
**Title:** `Project Hub`  
**One-line goal:** Restructure the entire platform around projects as the top-level entity — project-centric dashboard, per-project brains, worktree-only execution, file explorer for live worktree viewing, and plan/phase renaming.  
**Why now:** The current hierarchy is flat (4-tab sidebar, global brain, plans floating outside projects). Every feature (brain, tasks, plans) should live under a project. Worktree mode `experimental_6` is mature enough to be the default and only mode.  
**Blast radius:** `packages/web-ui/dashboard/` (full sidebar + layout rewrite), `packages/web-server/src/` (brain routes become project-scoped), `packages/coding-agent/src/` (remove stable_3 mode), `packages/web-ui/dashboard/src/components/` (new FileExplorer component).  
**Rollback path:** Feature flags for new sidebar, old brain routes kept as legacy parallel, stable_3 config flag.  
**Scale mode:** `experimental_6` (only mode — stable_3 removed)  
**Worktree isolation:** `Required`  
**Integration queue:** `Required`

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P22` |
| Title | `Project Hub: Project-Centric Architecture & Worktree Workspace` |
| Status | `Authoritative Implementation` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Architecture restructuring (UI + backend), worktree-only execution, file explorer` |
| Scale mode | `experimental_6` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P22.A — Project-Centric Sidebar & Navigation | Pi Worker Agent | User | Reviewer | User |
| P22.B — Per-Project Brain Architecture | Pi Worker Agent | User | Reviewer | User |
| P22.C — Worktree-Only Execution Mode | Pi Worker Agent | User | Reviewer | User |
| P22.D — File Explorer for Live Worktrees | Pi Worker Agent | User | Reviewer | User |
| P22.E — Phase/Plan Naming & Task Creation | Pi Worker Agent | User | Reviewer | User |
| P22.F — Multi-DAG Viewer | Pi Worker Agent | User | Reviewer | User |

---

## 2. Purpose

The current platform has grown organically and accumulated architectural debt:

1. **Flat sidebar confusion** — 4 tabs (Projects, Runs, Tasks, Platform) with no clear hierarchy. Projects should be the root, not one of four equal options.
2. **Global brain, not per-project** — Brain features (state, memory, reflections, overnight, goals, trust) are global to the entire pi instance. Each project should have its own brain with dedicated thinking/working systems.
3. **Two execution modes** — `stable_3` and `experimental_6` coexist, adding complexity. Worktree mode is production-ready and should be the only mode.
4. **No worktree visibility** — When a workspace runs in worktree isolation, there's no way to see what files are being written. A file explorer is needed for live monitoring.
5. **Auto-generated phase names** — Plans default to "Untitled Phase" when the markdown header is missing or malformed. Users should be able to set/rename phases at upload time.

### 2.1 Validation Scenarios

| # | Scenario | Description | Autonomy Level | Expected Outcome |
|---|----------|-------------|:---:|:---:|
| 1 | Sidebar shows project as top entity | No 4-tab system; project selector at top, then project-scoped Brain + Tasks sections | 3 | Clean hierarchy |
| 2 | Project selection persists across reload | Selected project ID saved to localStorage, restored on page load | 3 | Same project selected after refresh |
| 3 | Brain data is project-scoped | Each project has its own state, memory, reflections, goals (stored under project directory) | 3 | Isolated per-project brain |
| 4 | Plan execution uses worktree isolation only | No `stable_3` option; `experimental_6` is the default and only mode | 3 | All plans run in worktrees |
| 5 | File explorer shows worktree files | Live view of files in active worktree directories | 3 | See files being written |
| 6 | Plans have user-assignable names | Upload dialog allows setting phase name; shown throughout dashboard | 3 | No "Untitled Phase" |
| 7 | Phase naming propagates to all views | Runs list, detail view, event log show the user-set phase name | 3 | Consistent naming |
| 8 | Project rename works | `PATCH /api/projects/:id` updates name in listing and sidebar | 3 | Name reflects immediately |
| 9 | Brain toggle hides/shows brain section | Disabling brain hides brain nav and returns 404 from brain APIs | 3 | Clean toggle |
| 10 | Task creation replaces plan upload as primary flow | Sidebar shows "Create task" CTA, plan upload is inside task context | 3 | Task-first UX |
| 11 | Multi-DAG viewer renders dependency graphs | Shows multiple plan DAGs for a task with interactive zoom/pan | 3 | Visual DAG browsing |
| 12 | Project-level settings available | Model, parallelism, brain toggle stored per-project in `project.json` | 3 | Per-project config |
| 13 | Project activity feed scoped to project | Right sidebar shows only events for the active project | 3 | Scoped feed |
| 14 | Plan archiving works | Archived plans hidden from default Runs list; filter toggle shows them | 3 | Clean Runs list |
| 15 | DAG clicking opens file explorer | Running phase node click shows worktree files for that workspace | 3 | Cross-tool navigation |

---

## 3. Implementation

### 3.A — Project-Centric Sidebar & Navigation

**Files:** `packages/web-ui/dashboard/src/App.tsx`, `packages/web-ui/dashboard/src/components/sidebar/Sidebar.tsx`

**Changes:**

1. **Remove 4-tab system** (`leftTab` state, `TAB_LABELS` map, 4-tab bar rendering)
   - Replace with a single left sidebar that has:
     - **Project selector** at top (current project name + dropdown to switch)
     - **Brain section** (per-project brain navigation — State, Memory, Reflections, Goals, Overnight, Trust)
     - **Tasks section** (per-project task list)
     - **Runs section** (per-project run history, filtered to current project)
   - Platform-level items (Autonomy, Plan Intake, Extensions, Policy, Registry) move to a settings gear or lower section

2. **Persist project selection in browser**
   - Use `localStorage` key: `pi_selected_project_id`
   - On app mount, load from localStorage. If project still exists and is valid, auto-select it
   - On project switch, save to localStorage

3. **Project CRUD endpoints**
   - `POST /api/projects` — Create a new project directory under `.pi/projects/{projectId}/` with `project.json` (name, id, createdAt)
   - `DELETE /api/projects/:projectId` — Remove project from dashboard listing only (does NOT delete files on disk). Guard with confirmation if project has active executions.
   - `PATCH /api/projects/:projectId` — Rename project (updates `project.json` name field)
   - Without these, the sidebar dropdown has nothing to populate for new users

4. **Project settings: brain toggle**
   - Each project's `project.json` has a `brainEnabled: boolean` field (default: true)
   - Toggle in sidebar or project settings to enable/disable the per-project brain
   - When disabled, brain section is hidden from sidebar and brain API calls return 404
   - Allows users to opt out of brain features for simple projects

5. **Task creation as primary action**
   - The main CTA in the sidebar changes from "Upload plan" to "Create task"
   - Tasks hold multiple plans (phases) — task creation wizard replaces plan upload as the entry point
   - Plan upload still accessible inside a task, but tasks are what users create first
   - Task creation dialog: name, description, optional initial plan file

6. **Project-level execution settings**
   - Each `project.json` stores default execution config:
     - `defaultModel: string` — model ID to use for plan executions (overrides global default)
     - `maxParallelWorkspaces: number` — default parallelism for this project
     - `brainEnabled: boolean` — brain toggle (moved here)
   - New settings panel accessible from the project section header (gear icon)
   - `PATCH /api/projects/:projectId/settings` — batch-update these settings
   - Frontend: project settings dialog with model selector, parallelism slider, brain toggle

7. **Project activity feed**
   - Right sidebar event feed scoped to the currently active project (not global)
   - Shows: plan started/completed, task created, brain events for that project
   - Filters out events from other projects
   - Backend: `GET /api/projects/:projectId/events` — SSE stream of project-scoped events
   - Frontend: `useProjectEvents(projectId)` hook replaces the global `useJournalStream`

6. **Collapsible sections with project context**
   - Brain section shows `🧠 [Project Name] Brain` (only visible when brain is enabled for this project)
   - Tasks section shows project-scoped task list
   - Runs section shows only executions for the current project

```typescript
// New sidebar structure (Sidebar.tsx)
export const PROJECT_SECTIONS = (projectId: string): SidebarSection[] => [
  {
    id: "brain",
    title: "Brain",
    type: "brain",
    projectId,
    items: [
      { id: "brain_state", label: "State / Overview", icon: Activity },
      { id: "brain_memory", label: "Memory Explorer", icon: Database },
      { id: "brain_reflections", label: "Reflections", icon: Lightbulb },
      { id: "brain_overnight", label: "Overnight", icon: Moon },
      { id: "brain_goals", label: "Goals", icon: Target },
      { id: "brain_trust", label: "Trust", icon: Eye },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    type: "tasks",
    projectId,
    items: [], // Populated dynamically from API
  },
  {
    id: "runs",
    title: "Runs",
    type: "runs",
    projectId,
    items: [], // Populated dynamically from API
  },
];
```

### 3.B — Per-Project Brain Architecture

**Files:** `packages/web-server/src/index.ts`, `packages/web-server/src/routes/brain/*.ts`

**Changes:**

1. **Scope brain routes under projects**

> **Fastify trap:** When registering brain routes as a Fastify plugin with a dynamic prefix like `/api/projects/:projectId/brain`, the plugin MUST access `request.params.projectId` explicitly inside each handler. Do **not** rely on `params` being inherited from the outer scope — it will be `undefined` at runtime.
>
> ```typescript
> // CORRECT — read projectId inside each handler:
> fastify.get("/state", async (request) => {
>   const { projectId } = request.params as { projectId: string };
>   // ...
> });
>
> // WRONG — silently undefined:
> fastify.get("/state", async (request) => {
>   const { projectId } = request.params;
>   // projectId is undefined!
> });
> ```
   - `/api/brain/state` → `/api/projects/:projectId/brain/state`
   - `/api/brain/memory` → `/api/projects/:projectId/brain/memory`
   - `/api/brain/reflections` → `/api/projects/:projectId/brain/reflections`
   - `/api/brain/overnight` → `/api/projects/:projectId/brain/overnight`
   - `/api/brain/goals` → `/api/projects/:projectId/brain/goals`
   - `/api/brain/trust` → `/api/projects/:projectId/brain/trust`
   - `/api/brain/proposals` → `/api/projects/:projectId/brain/proposals`

2. **Brain storage per-project**
   - Brain data stored under `{workspaceRoot}/.pi/projects/{projectId}/brain/`
   - GoalStore, MemoryStore, ReflectionEngine all instantiated per-project
   - ProposalStore, ApprovalGate scoped to project

3. **Register brain routes as Fastify plugins with prefix**
   ```typescript
   // Instead of:
   await registerBrainStateRoutes(fastify);
   // Use:
   await fastify.register(async (scoped) => {
     await registerBrainStateRoutes(scoped);
     // ...other brain routes
   }, { prefix: "/api/projects/:projectId/brain" });
   ```

4. **Frontend hooks update**
   - `useBrainState()`, `useBrainMemory()`, etc. accept `projectId` param
   - All API calls scoped to `projectId`

### 3.C — Worktree-Only Execution Mode

**Files:** `packages/coding-agent/src/core/workspace-schema.ts`, `packages/coding-agent/src/core/workspace-agent-executor.ts`, `packages/coding-agent/src/core/autonomous-executor.ts`, `packages/web-server/src/plan-runner.ts`

**Changes:**

1. **Remove `stable_3` scale mode**
   - Remove `"stable_3"` from `ScaleMode` type union
   - Remove all `isStableMode` / `stable_3` branching in executor
   - Default to `experimental_6` (worktree) for all plans

2. **Force worktree mode on all executions**
   - `worktree.enabled` is always `true` — cannot be disabled
   - Remove the `worktreeConfig` option from plan configs
   - Simplify `execute()` in `workspace-agent-executor.ts` — always go through `executeInWorktree()`

3. **Clean up removed codepaths**
   - Remove `executeInPlace()` method (no longer needed)
   - Remove non-worktree state tracking
   - Update all tests to use worktree mode

### 3.D — File Explorer for Live Worktrees

**Files:** `packages/web-ui/dashboard/src/components/FileExplorer.tsx` (new), `packages/web-server/src/file-explorer-routes.ts` (new)

**New backend routes:**

```
GET /api/projects/:projectId/plans/:planExecId/worktrees — List active worktrees
GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files — List files in a worktree
GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/:path — Get file content
GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff — Get diff for worktree
```

**New frontend component:**

```typescript
// FileExplorer.tsx — Tree view of worktree files
interface FileExplorerProps {
  planExecId: string;
  workspaceId: string;
  onFileSelect?: (path: string) => void;
}

// Features:
// - Directory tree navigation (collapsible folders)
// - File content preview (read-only syntax highlighting)
// - Diff view (shows changes from HEAD)
// - Auto-refresh (poll every 5s for new/modified files)
// - Search within worktree files
```

**Polling mechanism:**
- Use `setInterval` with 5-second poll
- Compare file list hashes to detect changes
- Show "live" indicator when files are being actively modified
- Visual feedback for new files (highlight animation)

### 3.E — Phase/Plan Naming & Task Creation

**Files:** `packages/coding-agent/src/core/plan-parser.ts`, `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/PlanUploadDialog.tsx`, `packages/web-ui/dashboard/src/components/TaskCreateDialog.tsx` (new)

**Changes:**

1. **Task creation as primary onboarding action**
   - New `TaskCreateDialog` replaces plan upload as the main CTA
   - Task fields: name, description, optional initial plan file (markdown)
   - After creating a task, user can add plans (phases) to it
   - Plan upload becomes a secondary action inside the task detail view

2. **Allow user to set phase name in upload dialog**
   - Add "Phase name" text input to PlanUploadDialog (also accessible from inside a task)
   - Default: parsed from plan markdown header, but editable
   - Stored in plan execution meta as `phaseTitle`

3. **Propagate phase name throughout system**
   - Store in `plan-execution.meta.json` as `phaseTitle`
   - Show in Runs list, execution detail view, event log
   - Fall back to parsed title, then "Untitled Phase"

4. **Add rename endpoint**
   ```typescript
   PATCH /api/projects/:projectId/plans/:planExecId/rename
   Body: { title: string }
   ```
   - Updates the plan execution title in the state store
   - Events emitted with renamed title

5. **Plan archiving / status filtering**
   - Archived plans hidden from default Runs list
   - Toggle filter: "Active" / "Archived" / "All"
   - `PATCH /api/projects/:projectId/plans/:planExecId/archive` — archive a plan
   - Archived plans can be unarchived
   - Stored in `plan-execution.meta.json` as `archived: boolean`
   - Runs list shows active plans by default, with toggle to show archived

### 3.F — Multi-DAG Viewer

**Files:** `packages/web-ui/dashboard/src/components/MultiDagViewer.tsx` (new)

**Changes:**

1. **Interactive DAG renderer**
   - Visual dependency graph showing multiple plans (phases) within a task
   - Nodes = plan phases, edges = dependencies between them
   - Color-coded by status (pending, running, complete, failed)
   - Click a node to navigate to that plan's execution detail

2. **Zoom & pan controls**
   - Mouse wheel zoom in/out
   - Click-drag to pan
   - Fit-to-view button
   - Mini-map for orientation with large DAGs

3. **Data source**
   - Fetches task phases data from `GET /api/projects/:projectId/tasks/:taskId`
   - Phases array provides id, title, dependencies, status
   - Auto-refreshes every 10s while any phase is running

```typescript
// MultiDagViewer.tsx — Interactive DAG
interface DagNode {
  id: string;          // Phase ID (e.g. "p22-a")
  label: string;       // Phase title
  status: "pending" | "running" | "complete" | "failed" | "blocked";
  startTime?: number;
  endTime?: number;
}

interface DagEdge {
  source: string;      // Depends on this phase
  target: string;      // This phase
}
```

4. **DAG → file explorer linking**
   - Clicking a **running** phase node navigates to that workspace's file explorer view
   - Clicking a **completed** phase node shows its diff summary (from worktree git diff)
   - Running phases get a small "view files" icon in the DAG node
   - Bridges P22.D and P22.F: the DAG becomes a navigation tool to explore worktree content

5. **Integration with task detail view**
   - TaskDetailView shows the DAG at the top when the task has multiple phases
   - Single-phase tasks show a simplified view (single node)
   - DAG view replaces the flat phase list

---

## 4. Dependencies

| Workstream | Depends On | Blocking |
|---|---|---|
| P22.A — Sidebar | None | P22.B, P22.D, P22.E |
| P22.B — Per-Project Brain | P22.A | None |
| P22.C — Worktree-Only | None | P22.D |
| P22.D — File Explorer | P22.C | None |
| P22.E — Task Creation & Naming | P22.A | None |
| P22.F — Multi-DAG Viewer | P22.E | None |

---

## 5. Rollback Strategy

| Component | Rollback Method |
|---|---|
| Sidebar | Keep old 4-tab code behind `LEGACY_SIDEBAR` flag (stored in state) |
| Brain routes | Keep global brain routes as fallback; remove after phase validated |
| Worktree-only | Keep `stable_3` config enum but mark deprecated |
| File Explorer | New component, no rollback needed |

---

## 6. Acceptance Criteria

- [ ] Sidebar shows project as the top-level entity with Brain, Tasks, Runs sections
- [ ] Project selection persists across page reloads (localStorage)
- [ ] Brain data is isolated per-project (testing with 2 projects shows different data)
- [ ] All plan executions use worktree isolation (no `stable_3` option)
- [ ] File explorer shows files from active worktrees with live refresh
- [ ] Plans can be renamed at upload time and post-execution
- [ ] Projects can be renamed via `PATCH /api/projects/:id`
- [ ] Projects can be deleted from dashboard listing (files not removed)
- [ ] Brain toggle per-project hides/shows brain section and blocks brain APIs when disabled
- [ ] Task creation is the primary CTA in the sidebar (not plan upload)
- [ ] Multi-DAG viewer renders dependency graphs with zoom/pan
- [ ] DAG node click on running phase opens file explorer for that workspace
- [ ] DAG node click on completed phase shows diff summary
- [ ] Project-level execution settings (model, parallelism, brain toggle) stored and editable per-project
- [ ] Right sidebar event feed scoped to active project only
- [ ] Plan archiving hides plans from default Runs list; filter toggle shows archived
- [ ] No "Untitled Phase" appears anywhere in the dashboard
- [ ] All existing tests pass with worktree-only mode
- [ ] Per-project brain routes respond correctly with 404 for unknown project

# P42 Baseline Audit — Dashboard and Backend Surfaces

**Date:** 2026-06-01
**Author:** Worker agent (P42.00)
**Target:** Audit of current dashboard (web-ui/dashboard) and backend surfaces against V3 interface map (`docs/pi/p42/proposed_interface_map_v3.md`)
**Source docs:** `proposed_interface_map_v3.md`, `pi_cockpit_v3_final_mockup.html`, `README.md`
**Data sources examined:**
- `packages/web-ui/dashboard/src/App.tsx` (1364 lines — monolithic)
- `packages/web-ui/dashboard/src/components/sidebar/Sidebar.tsx` (300+ lines)
- `packages/web-ui/dashboard/src/components/right-sidebar/RightSidebar.tsx` (271 lines)
- `packages/web-ui/dashboard/src/components/topbar/Topbar.tsx` (458 lines)
- `packages/web-ui/dashboard/src/components/WorkerDetail.tsx` (~1048 lines)
- `packages/web-ui/dashboard/src/components/WorkerList.tsx`
- `packages/web-ui/dashboard/src/components/CockpitPanels.tsx` (~223 lines)
- `packages/web-ui/dashboard/src/components/FileExplorer.tsx` (~783 lines)
- `packages/web-ui/dashboard/src/components/DiffViewer.tsx` (~300+ lines)
- `packages/web-ui/dashboard/src/components/LiveLogTerminal.tsx` (~369 lines)
- `packages/web-ui/dashboard/src/components/LeadEscalationPanel.tsx`
- `packages/web-ui/dashboard/src/types.ts` (1025 lines)
- `packages/execution-core/src/read-model.ts` (execution read model interfaces)
- `packages/execution-core/src/events.ts` (42 event types)
- `packages/execution-service/src/query-handler.ts` (read model implementation — 6 stubs)
- `packages/execution-service/src/execution-service.ts` (command/query facade)
- `packages/execution-service/src/command-handler.ts`
- `packages/web-server/src/worker-context-routes.ts`
- `packages/web-server/src/file-explorer-routes.ts`
- `packages/web-server/src/human-directive-routes.ts`
- `packages/web-server/src/index.ts` (route registrations)

---

## 1. App Shell and Layout

### 1.1 Current State

| Dimension | Current | V3 Target | Gap |
|---|---|---|---|
| App.tsx | ~1364 lines | <100 lines (shell + router + providers) | **CRITICAL** — monolithic |
| Left sidebar | 320px animated sidebar with Sidebar component | 230px fixed task/run tree | Width mismatch; tree structure exists in Sidebar but contains tabs, not task/run tree |
| Right sidebar | Permanent 300px (RightSidebar — events, alerts, PlanSummaryPanel) | Removed by default; contextual drawer (360px) only | **CRITICAL** — permanent right sidebar blocks center surface |
| Center column | `flex-1` with `flex flex-col` runtime switching | `flex-1` with tab bar (Overview, Workspaces, Files, Logs, Escalations) | Current center has no tab bar; uses `activeView` conditional rendering |
| Status bar | Not present | 24px fixed status bar showing run ID, workspace counts, cost, tokens | **MISSING** |
| Topbar | Topbar component with brain mode, settings, stop/pause/rerun | 48px breadcrumb + health pill + actions | Current topbar is close in spirit but lacks breadcrumb navigation |
| Mobile responsive | Overlay sidebar, some breakpoints | Tablet/mobile reduction strategy | Partial — right sidebar not responsive |

### 1.2 Key Findings

1. **App.tsx is a monolith** at 1364 lines. It contains:
   - All state management (30+ useState hooks)
   - All data fetching orchestration (useEffects, callbacks)
   - Layout rendering (3-panel grid)
   - Dialog management (12+ dialog toggles)
   - Control action dispatch
   - Error banner management
   - Legacy mode / project mode switching
   - Git dialog component (inline GitContent)

2. **No tab bar exists.** The center column switches between `activeView.type` values (`run`, `task`, `platform`, `empty`) instead of tabs.

3. **No router is used.** Navigation is simulated via `activeView` state + conditional rendering. URL-based routing does not exist.

4. **Right sidebar is always visible by default** (`rightOpen` default is `true`), consuming 300px.

5. **Sidebar width is 320px**, not 230px as specified in V3.

---

## 2. Navigation and Routing

### 2.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| URL routes | None (`/api/*` endpoints only) | `/projects/:id/tasks/:id/runs/:id/*` | **MISSING** — all nav via state |
| Route guards | None | `projectExists`, `taskExists`, `executionExists`, `workspaceExists`, `filePathSafe` | **MISSING** |
| Last-visited route persistence | Custom localStorage keys (`SELECTED_PROJECT_KEY`, `SELECTED_EXEC_KEY`, `SELECTED_VIEW_KEY`, `SELECTED_TASK_KEY`) | `useLastVisitedRoute()` hook | Partial — V3 specifies localStorage-based persistence, current impl has similar |
| Command palette | Not implemented | Cmd/Ctrl+K with full action set | **MISSING** |
| Breadcrumb | Not implemented | Clickable Project > Task > Run | **MISSING** |
| Keyboard shortcuts | None | Full shortcut map (see §19 of interface map) | **MISSING** |

### 2.2 Key Findings

1. **Zero URL-based routing.** The dashboard is a single-page app with no React Router integration. Navigation is entirely state-driven, making it impossible to:
   - Bookmark a specific workspace or execution
   - Share links to specific views
   - Use browser back/forward buttons effectively
   - Implement route guards

2. **Navigation model** uses a `PlatformNavItem` type for sidebar items and `ActiveView` union type for center column switching. This is a custom router that duplicates React Router functionality.

3. **Last-visited route persistence** exists via localStorage but uses 4 separate keys that are not URL-aware.

---

## 3. Execution Overview (Mission Control)

### 3.1 Current State

| Component | Current | V3 Target | Gap |
|---|---|---|---|
| Hero section | No dedicated hero component | `MissionControlHero.tsx` with 7 states (onTrack, blocked, stalled, failed, paused, complete, stopped) | **MISSING** |
| Metrics strip | 7 StatCards in a grid (cost, tokens in/out, burn rate, cache hit, tok/workspace, tok/percent%) | 6-metric compact strip (progress, cost, tokens in/out, burn rate, cache hit) | Partial — current has 7 metrics, but no progress metric |
| Workspace preview | WorkerCard list (max-h-48 scrollable) | `WorkspacePreview.tsx` with compact card grid | Current is a flat scrollable list, not a card grid |
| Priority feed | Raw event feed in right sidebar + ExecutionStabilityPanel | `PriorityFeed.tsx` with ATTENTION/ACTIVE/RECENT sections | Current shows raw events (all 39 types) with basic error filtering |
| Next action card | Not present | `NextActionCard.tsx` | **MISSING** |
| Queue strip | `QueueStrip` component shows pending/active/blocked/failed/complete counts | Not in V3 (merged into metrics/status bar) | Current has a strip that would be absorbed |
| Execution stability panel | Custom panel showing control plane health, stale stream detection, issue events | Not in V3 (folded into priority feed or debug mode) | Over-engineered for V3 |

### 3.2 Key Findings

1. **No Mission Control Hero exists.** The current overview shows StatCards, WarningBanner, ExecutionStabilityPanel, SchedulerStatusPanel, and CockpitPanels — but no high-level hero summarizing state and next action.

2. **Metrics are full-width stat cards** (7 columns), not a compact strip. The burn rate and token metrics are present but displayed with more visual weight than V3 requires.

3. **Priority feed does not exist.** Events are displayed raw in the right sidebar via `EventLine` components with a basic "all" / "errors" filter.

4. **The run view is a vertical stack** of components (WarningBanner → StatCards → QueueStrip → StabilityPanel → SchedulerStatusPanel → CockpitPanels → WorkerCard list → WorkerDetail/LiveLogTerminal). This is content-heavy with no information hierarchy.

---

## 4. Workspace Board and Detail

### 4.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Workspace board | WorkerCard list (flat, chronological) | `WorkspaceBoard.tsx` with grouped cards by status (Attention/Running/Ready/Completed/Failed) | Current has no grouping |
| Workspace card | `WorkerCard` component shows worker ID, stage, attempts, error | `WorkspaceCard.tsx` with phase, command, retry count, heartbeat, files, blocks, model, provider | Current card is minimal |
| Workspace detail | `WorkerDetail.tsx` with 9 tabs (Overview, Pi CLI, Tokens, Performance, Git, Commands, Logs, Transcript, P6 Lifecycle) | `WorkspaceDetailPage.tsx` with dedicated route /workspaces/:workspaceId and 9 panels (Header, CurrentState, ContextSummary, CommandHistory, WorkspaceFiles, Transcript, ValidationEvidence, AttemptHistory, EscalationPanel) | Current is tab-based, V3 is panel-based on a dedicated page |
| Workspace click | Opens inline in center column (replaces LiveLogTerminal with WorkerDetail) | Navigates to `/workspaces/:workspaceId` | Current is inline, not a route |

### 4.2 Key Findings

1. **WorkerDetail.tsx** has 9 tabs, many overlapping with V3 workspace detail panels. However:
   - It's rendered inline (replacing the live log view), not as a dedicated route
   - It uses tab navigation (Overview, Pi CLI, Tokens, etc.) instead of a single-page panel layout
   - Some tabs (P6 Lifecycle, Pi CLI) are not in V3 scope

2. **No workspace grouping exists.** Workspaces are rendered as a flat scrollable list ordered by appearance, not grouped by status (Attention/Running/Ready/Completed/Failed).

3. **Workspace cards are minimal.** They show id, stage, attempts, and error only. V3 requires phase, current command, retry count, heartbeat, files touched, blocking info, model, and provider.

4. **WorkerList component** (100+ lines) is deprecated by V3 but still imported.

---

## 5. Files and Diff View

### 5.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| File explorer | `FileExplorer.tsx` — tree view of worktree files, reads filesystem directly | `ExecutionFileTree.tsx` — execution-aware file tree from read model | Current reads filesystem, not read model |
| Diff viewer | `DiffViewer.tsx` — accepts `GitFilePatch[]`, renders unified diff | `FileDiffView.tsx` — unified diff from read model | Current uses git endpoints (`/git-diff`) |
| File content | Reads filesystem in `FileExplorer` | `FilePreview.tsx` from read model `getFileContent()` | Current bypasses read model |
| File evidence panel | Not present | `FileEvidencePanel.tsx` with related workspace/command/validation | **MISSING** |
| Files tab | Not a tab; file explorer is embedded in CockpitPanels | First-class tab (keyboard shortcut `F`) | **MISSING** |

### 5.2 Key Findings

1. **FileExplorer.tsx reads the filesystem directly** via the worktree routes (`/api/projects/.../worktrees/.../files`). It does not use the `ExecutionReadModel.getFileTree()` or `getFileContent()` methods.

2. **DiffViewer.tsx receives patches from git endpoints** (`/api/projects/_/plans/.../workspaces/.../git-diff?format=patch`). It does not use `ExecutionReadModel.getFileDiff()`.

3. **The file explorer is hidden inside CockpitPanels**, not a top-level tab. Users must scroll past plan summary, worker context, live logs, and escalations to reach it.

4. **File status colors** (green/amber/red/orange) match V3 spec.

---

## 6. Logs / Command Timeline

### 6.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Logs tab | Not a tab; logs are shown in LiveLogTerminal or WorkerDetail | First-class tab with CommandTimeline | **MISSING** |
| Command timeline | `LiveLogTerminal` with worker tabs, channel filters, raw line output | `CommandTimeline.tsx` with command list (workspace, command, duration, exit code, status) | Current shows raw log lines, not structured command entries |
| Command detail | No dedicated detail view | `CommandDetail.tsx` with stdout/stderr, metadata, links | **MISSING** |
| Raw output | Default view in LiveLogTerminal | Toggle/expandable raw output behind "Show raw output" switch | Current shows raw output by default |
| Command history read model | `getCommandHistory()` returns `[]` (stub) | Real data from state store command event log | **STUBBED** |

### 6.2 Key Findings

1. **There is no Logs/Command Timeline tab.** Log viewing is done through:
   - `LiveLogTerminal` (worker tabs + raw log lines)
   - `CommandsPanel` (dialog overlay from topbar)
   - `WorkerDetail` (Commands/Logs tabs)

2. **LiveLogTerminal** shows raw log lines from SSE streams with channel filtering (API, WORKER, SYSTEM, ERROR, TOOL, HEARTBEAT). This is closer to the V3 "raw log mode" than the default command timeline view.

3. **`getCommandHistory()` is a stub** that always returns `[]`. The ExecutionReadModel interface has the method but the query-handler returns an empty array.

---

## 7. Escalations

### 7.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Escalations tab | Not a tab | First-class tab (keyboard shortcut `E`) | **MISSING** |
| Escalation cards | `LeadEscalationPanel.tsx` in CockpitPanels | `EscalationCard.tsx` with root cause, impact, evidence, recommended actions | Current is minimal |
| Escalation center | No dedicated page | `EscalationCenter.tsx` with active escalations, deadlock dependencies, human directive input | **MISSING** |
| Deadlock deps | Not present | `DeadlockDependencies.tsx` | **MISSING** |
| Read model | `getLeadEscalations()` returns `[]` (stub) | Real data from state store | **STUBBED** |
| Read model | `getLeadDirectives()` returns `[]` (stub) | Real data from state store | **STUBBED** |

### 7.2 Key Findings

1. **Escalations have no dedicated view.** `LeadEscalationPanel.tsx` is a small section inside CockpitPanels, competing with 6 other panels.

2. **Both `getLeadEscalations()` and `getLeadDirectives()` are stubs** returning empty arrays. The human-directive-routes in web-server read state store directly as a workaround, bypassing the read model.

3. **Web-server human-directive-routes** handle directive issuing, listing, escalation resolving, and workspace intervention directly, bypassing `execution-service`.

---

## 8. Read Model Status

### 8.1 Method-by-Method Audit

| Method | Current Status | Returns | V3 Priority | Notes |
|---|---|---|---|---|
| `getPlanSummary()` | **REAL** | Data from state store | — | Used by Mission Control Hero |
| `getWorkspaceSummary()` | **REAL** | Data from state store | — | Used by Workspace Board |
| `listJournalEvents()` | **REAL** | Data from state store, paginated | — | Used by priority feed |
| `getWorkerContext()` | **REAL** | State store + archive | — | Web-server has separate impl |
| `getChangedFiles()` | **REAL** | Extracts from `worker_completed` journal events | — | Used by file tree |
| `getFileTree()` | **REAL** | Calls `getChangedFiles()` then `buildFileTreeFromEntries()` | — | Used by File Explorer |
| `getCommandHistory()` | **STUB** | `[]` | HIGH | No state store backing |
| `getLeadDirectives()` | **STUB** | `[]` | HIGH | Web-server bypasses |
| `getLeadEscalations()` | **STUB** | `[]` | HIGH | Web-server bypasses |
| `getFinalValidationStatus()` | **STUB** | `{ required: true, passed: null, blocked: false, blockReasons: [] }` | MEDIUM | Completion gate not wired |
| `getFileContent()` | **STUB** | `null` | MEDIUM | Web-server bypasses via filesystem |
| `getFileDiff()` | **STUB** | `[]` | MEDIUM | Web-server bypasses via git |

**Summary: 6 of 12 read model methods are stubs.** This matches the V3 interface map claim.

### 8.2 Bypasses

| Bypass | Location | What It Does | V3 Fix |
|---|---|---|---|
| Worktree filesystem reads | `web-server/file-explorer-routes.ts` | Reads `.pi/worktrees/` directly | Use `getFileTree()` + `getFileContent()` |
| Git diff | `web-server/file-explorer-routes.ts` (diff endpoint) | Runs git commands against worktree | Use `getFileDiff()` |
| State store direct access (directives) | `web-server/human-directive-routes.ts` | Reads/writes state store directly for directives and escalations | Use `getLeadDirectives()` + `getLeadEscalations()` via execution-service |
| State store direct access (control) | `dashboard/App.tsx` `sendControlCommand()` | POSTs to `/api/executions/:eid/control` | Use execution-service `handleExecutionCommand()` |
| Git info | `dashboard/App.tsx` `GitContent` component | Fetches `/api/git-info` | Replace with read model |
| Git diff (workspace) | `dashboard/App.tsx` `GitContent` component | Fetches `/api/projects/_/plans/.../git-diff` | Replace with read model |

---

## 9. Component Sizes and Monoliths

### 9.1 Components Over 200 Lines

| Component | Lines | V3 Action | Notes |
|---|---|---|---|
| `App.tsx` | 1364 | Split into App.tsx + AppShell.tsx + routes.tsx + providers.tsx | **Highest priority** |
| `WorkerDetail.tsx` | ~1048 | Split into 9+ sub-components in `workspace-detail/` | Deep tabs, many concerns |
| `FileExplorer.tsx` | ~783 | Refactor into ExecutionFileTree.tsx + FilePreview.tsx | Must switch to read model |
| `LeadAgentDashboard.tsx` | ~758 | Split into LeadAgentStatus.tsx, DirectiveHistory.tsx, EscalationHistory.tsx | Feature, not part of core cockpit |
| `LiveLogTerminal.tsx` | ~369 | Refactor into CommandTimeline.tsx + RawLogView.tsx | Raw log dominates; needs structured view |
| `DiffViewer.tsx` | ~300+ | Refactor into FileDiffView.tsx + FileEvidencePanel.tsx | Must switch to read model |
| `CockpitPanels.tsx` | ~223 | Distributed into `execution/` sub-components | Temporary container — V3 eliminates it |
| `Topbar.tsx` | ~458 | Slim down; split out breadcrumb, health pill, dropdown menus | Already sizable |
| `Sidebar` (sidebar/) | ~300+ | Refactor into TaskRunTree.tsx + nav groups | Needs task/run tree structure |
| `RightSidebar.tsx` | ~271 | Remove (permanent) → replace with contextual drawer | **High priority** — permanent right sidebar removed |
| `BatchOSDashboard.tsx` | ~300+ | Split into BatchOverview, BatchTimeline, BatchControls | Feature component |
| `ObservabilityCockpit.tsx` | 400+ | Split into PerformanceMetrics, ResourceUsage, Timeline | Feature component |

### 9.2 Components to Deprecate in V3

| Component | V3 Replacement | Reason |
|---|---|---|
| `ControlButtons.tsx` | Contextual controls in Topbar + WorkspaceDetail | Controls belong to objects |
| `Header.tsx` | `Topbar.tsx` | Legacy duplicate |
| `WorkerList.tsx` | `WorkspaceBoard.tsx` | Flat list → grouped board |
| `LogViewer.tsx` | `CommandTimeline.tsx` + `RawLogView.tsx` | Raw log → structured timeline |
| `QueuePanel.tsx` | Merged into Execution Overview status bar | Duplicate visualization |
| `PlanSummary.tsx` | Merged into Mission Control Hero | Duplicate visualization |
| `EventFeed.tsx` | `PriorityFeed.tsx` | Raw feed → priority feed |
| `CockpitPanels.tsx` | Distributed into `execution/` components | Temporary container |
| `ExecutionLogViewer.tsx` | Absorbed into `logs/` components | Single responsibility |
| `ForceKillDialog.tsx` | Absorbed into `Modal.tsx` confirmation pattern | No validation logic |

---

## 10. Event System

### 10.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Event source | SSE endpoint `/api/projects/:id/plans/:eid/events` | SSE + WebSocket | Current uses SSE only (V3 allows either) |
| Event types | 42 types (Plan, Workspace, Worker, Command, Brain, Governance, Lead Agent, Human, System) | 42 types (same catalog) | Aligned |
| Event consumption | `usePlanEvents` hook (SSE, max 200 events) | Hooks per component: `useExecutionSummary`, `useWorkpaces`, `useWorkspaceDetail`, etc. | Current has one giant hook |
| Priority feed | No priority feed | ATTENTION/ACTIVE/RECENT sections | **MISSING** |
| Raw events | Visible in right sidebar by default (all types) | Hidden behind debug toggle | Current shows all events, which is V3 anti-pattern |
| Event filtering | Basic all/errors filter | By severity, workspace, type | Current filter is minimal |

### 10.2 Key Findings

1. **Event system is functional** but displays all event types in the right sidebar without prioritization.
2. **No priority feed exists** — events are not categorized into Attention/Active/Recent.
3. **SSE connection management** is solid (`usePlanEvents` handles connecting, reconnecting, stale detection) but couples all events into a single hook.
4. **Event types align with V3 catalog** (42 types listed in V3 match current usage).

---

## 11. Control Actions

### 11.1 Current State

| Action | Current Routing | V3 Target | Gap |
|---|---|---|---|
| Pause | `POST /api/executions/:eid/control` with `{ action: "pause" }` | `POST /api/execution/:eid/control/pause` | Different endpoint shape |
| Stop | Same endpoint with `{ action: "stop" }` | `POST /api/execution/:eid/control/stop` | Different endpoint shape |
| Cancel | Same endpoint with `{ action: "cancel" }` | `POST /api/execution/:eid/control/cancel` | Different endpoint shape |
| Resume | Same endpoint with `{ action: "resume" }` | `POST /api/execution/:eid/control/resume` | Different endpoint shape |
| Force kill | Same endpoint with `{ action: "force-kill" }` | `POST /api/execution/:eid/control/force-kill` | Different endpoint shape |
| Rerun | `sendRerunCommand()` to `/api/projects/:pid/plans/:eid/rerun` | `POST /api/execution/:eid/control/rerun` | Different |
| Intervene (workspace) | `POST /api/human/intervene/:peid/:wsId` | `POST /api/execution/:eid/workspaces/:wsId/retry` (or cancel) | Alias (V3 keeps both during migration) |
| Directive | `POST /api/human/directive` | `POST /api/execution/:eid/workspaces/:wsId/directive` | Different |
| Resolve escalation | `POST /api/human/escalations/:escId/resolve` | `POST /api/execution/:eid/escalations/:escId/resolve` | Different |

### 11.2 Key Findings

1. **Control endpoint paths are different** from V3 spec. The current API uses `/api/executions/:eid/control` with JSON body action selection. V3 specifies per-action endpoints (`/api/execution/:eid/control/pause`).

2. **Control actions are dispatched directly from App.tsx** via `sendControlCommand()`. This function POSTs to the execution endpoint but the UI layer handles the entire flow. V3 wants controls to be contextual components.

3. **Confirmation dialogs** exist for force kill (`ForceKillDialog`) and stop (via `controlDisabled` logic + confirm). Rerun has a dialog (`RerunDialog`). But V3 has a more comprehensive confirmation system with impact summaries for all dangerous actions.

4. **No workspace-level controls** (retry, cancel, send directive) exist in the control action flow. The `handleControl()` function only handles plan-level actions.

---

## 12. Brain and Platform

### 12.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Brain pages | 10+ pages (BrainState, BrainMemory, BrainReflections, BrainTrust, BrainOvernight, BrainInbox, Digest, GoalBoard, ProposalInbox, etc.) | Brain dropdown in topbar + sidebar section | Currently Brain pages are rendered as platform screens with `activeView.type === "platform"` |
| Platform pages | 7+ pages (Autonomy, Observability, Extensions, Skills, PlanIntake, PolicyAudit, Registry, Trust) | Settings dropdown in topbar | Currently rendered as platform screens |
| Sidebar nav | Brain and Platform items in sidebar `sect` elements | No Brain/Platform in sidebar; moved to topbar dropdowns | Current sidebar has Brain and Platform sections |

### 12.2 Key Findings

1. **Brain and Platform are cluttering the sidebar.** The sidebar has 4 sections: Active Tasks, Brain, Platform, and Quick Actions. V3 wants only the task/run tree in the sidebar.

2. **Brain pages are feature-complete** (10+ dedicated pages). This is fine — V3 doesn't remove functionality, just relocates it.

3. **The sidebar's Brain/Platform sections compete with execution context** for user attention. V3's solution is to move them to topbar dropdowns.

---

## 13. Contextual Drawers and Dialogs

### 13.1 Current State

| Feature | Current | V3 Target | Gap |
|---|---|---|---|
| Drawers | Brain context panel (320px), artifacts overlay (480px), chat panel | Transcript snippet (360px), artifact preview (480px), event detail (360px), command output (480px) | Some exist, but not the V3 set |
| Confirmation dialogs | ForceKillDialog, RerunDialog, git dialog, commands dialog | Confirm stop, confirm cancel, confirm force kill, send directive, resolve escalation | Current dialogs lack impact summaries |

### 13.2 Key Findings

1. **Current "drawers" are actually animated side panels** (BrainContextPanel, ArtifactBrowser, ChatPanel) controlled by boolean state. V3 wants a unified `RightDrawer` component.

2. **No unified drawer/dialog system exists.** Each dialog is a separate component with its own rendering logic.

---

## 14. Component Architecture

### 14.1 Current Folder Structure Issues

| V3 Folder | Current Equivalent | Gap |
|---|---|---|
| `app/` (App.tsx < 100 lines, AppShell, routes, providers) | Flat structure inside App.tsx (1364 lines) | **MISSING** |
| `components/primitives/` | Not present (plain divs with inline style tokens) | **MISSING** — V3 wants shadcn-based primitives |
| `components/shell/` | Topbar.tsx exists but not in shell folder | Partial |
| `components/execution/` | CockpitPanels.tsx (temporary container) | **MISSING** — no MissionControlHero, MetricsStrip, etc. |
| `components/workspace-detail/` | WorkerDetail.tsx (tab-based, inline) | **MISSING** — V3 wants panel-based page |
| `components/files/` | FileExplorer.tsx + DiffViewer.tsx | Partial — files exist but need refactoring |
| `components/logs/` | LiveLogTerminal.tsx | **MISSING** — no CommandTimeline, CommandDetail |
| `components/escalations/` | LeadEscalationPanel.tsx (minimal) | **MISSING** |
| `contexts/` | Not present | **MISSING** — V3 wants ProjectContext, ExecutionContext, WorkspaceContext |
| `api/` | No dedicated API client | **MISSING** — current fetches are inline in hooks |
| `types/` | Single `types.ts` (1025 lines) | V3 wants split into execution.ts, workspace.ts, events.ts |

### 14.2 Key Findings

1. **No primitives library.** All components use inline Tailwind-style classes with shared token variables (`SURF`, `BORD`, `MUT`, `TXT`, `BG`). V3 wants shadcn-based primitives.

2. **Single types file** at 1025 lines. V3 wants split types by domain.

3. **No context providers** for project/execution/workspace state. Current state is passed via props through App.tsx.

4. **No dedicated API client.** Each hook calls fetch() directly with inline URL construction.

---

## 15. Testing Status

| Test Category | Current Coverage | V3 Target | Gap |
|---|---|---|---|
| Unit tests (hooks, utilities) | `dashboard-hooks.test.ts`, `dashboard-bugs.test.ts` | 80-100 tests | Insufficient |
| Component tests (RTL) | Some (`batch-os-dashboard.test.tsx`) | 40-60 component/hook tests | Minimal |
| E2E tests (Playwright) | None | 10-15 critical flows | **MISSING** |
| Fake data detection tests | None | Dedicated test suite | **MISSING** |

---

## 16. Summary of Critical Gaps

### Tier 1: Must Fix for V3 (Blocking)

| # | Gap | Area | Impact |
|---|---|---|---|
| 1 | **App.tsx is 1364 lines monolithic** | Shell | Blocks all V3 restructuring |
| 2 | **No URL-based routing** | Navigation | No shareable URLs, no route guards |
| 3 | **6/12 read model methods are stubs** | Read model | `getCommandHistory()`, `getLeadDirectives()`, `getLeadEscalations()`, `getFinalValidationStatus()`, `getFileContent()`, `getFileDiff()` all return empty/null |
| 4 | **Web-server bypasses read model** (filesystem, git, state store) | Architecture | Dashboard and API bypass execution-service read model |
| 5 | **No Mission Control Hero** | Execution Overview | Users don't see high-level state summary |
| 6 | **Permanent right sidebar (300px)** | Layout | Consumes center width; V3 removes it |
| 7 | **No tab bar** (Overview, Workspaces, Files, Logs, Escalations) | Layout | No structured view switching |
| 8 | **Workspace opens inline** not as dedicated route | Workspace Detail | Cannot bookmark or share workspace views |

### Tier 2: Must Fix for V3 (High Priority)

| # | Gap | Area | Impact |
|---|---|---|---|
| 9 | **No workspace grouping by status** | Workspace Board | Current is flat list |
| 10 | **Workspace cards are minimal** | Workspace Board | Missing phase, command, heartbeat, files, blocks, model |
| 11 | **No command timeline** (structured view) | Logs | Current shows raw log lines only |
| 12 | **No priority feed** | Execution Overview | Raw events visible by default |
| 13 | **No escalation center page** | Escalations | Only minimal panel in CockpitPanels |
| 14 | **Control actions use old endpoint pattern** | Control | `/api/executions/:eid/control` not per-action endpoints |
| 15 | **Brain/Platform clutter sidebar** | Navigation | Compete with execution context |
| 16 | **No command palette** | Navigation | Cmd/Ctrl+K not available |

### Tier 3: Should Fix for V3 (Medium Priority)

| # | Gap | Area | Impact |
|---|---|---|---|
| 17 | **No status bar** | Shell | Missing 24px status strip |
| 18 | **No breadcrumb navigation** | Topbar | No clickable hierarchy |
| 19 | **No keyboard shortcuts** | Accessibility | Power users slowed |
| 20 | **No ARIA labels/roles** | Accessibility | Screen reader support weak |
| 21 | **No drawer/dialog system** | UX | Inconsistent dialog implementation |
| 22 | **Large components not split** | Architecture | `WorkerDetail.tsx` (1048), `FileExplorer.tsx` (783), `LeadAgentDashboard.tsx` (758) |
| 23 | **Single types file (1025 lines)** | Code Quality | maintenance burden |
| 24 | **No context providers** | Architecture | State passed via App.tsx props |
| 25 | **Inline API calls in hooks** | Architecture | No typed API client |

---

## 17. Alignment with V3 Mockup

### 17.1 Mockup Elements Present vs Missing

| Mockup Element | Present? | Implementation |
|---|---|---|
| Topbar with logo | ✅ | Topbar component |
| Breadcrumb | ❌ | Not implemented |
| Health pill | ❌ | Not implemented (StatusBadge exists, not health pill) |
| Pause/Stop buttons | ✅ | In Topbar |
| Cmd/Ctrl+K palette | ❌ | Not implemented |
| Brain button with badge | ❌ | Not implemented (brain mode toggle exists) |
| Settings button | ✅ | Gear icon in Topbar |
| Left sidebar (232px) | ❌ | 320px, different structure |
| Task/run tree | ❌ | Tabs-based sidebar, not tree |
| Tab bar (5 tabs) | ❌ | No tab bar |
| Mission Control Hero | ❌ | Not implemented |
| Metrics strip | ✅ | StatCards (7, not 6) |
| Workspace preview grid | ❌ | Scrollable list |
| Priority feed | ❌ | Raw events in right sidebar |
| Next action card | ❌ | Not implemented |
| Workspace board (grouped) | ❌ | Flat list |
| Workspace detail (page) | ❌ | Inline tabbed component |
| File/IDE view | ❌ | In CockpitPanels, not tab |
| Command timeline | ❌ | Raw logs only |
| Escalation center | ❌ | Minimal panel |
| Status bar | ❌ | Not implemented |
| Confirmation dialogs | ✅ | Partial (ForceKill, Rerun) |
| Contextual drawers | ❌ | BrainContextPanel exists but not unified |

### 17.2 Mockup Design Token Alignment

| Token | Mockup | Current | Match |
|---|---|---|---|
| `--bg` | `#f5f3ee` | Dynamic (light/dark via theme) | No fixed color match |
| `--surface` | `#fffdf8` | `bg-white dark:bg-[#1E1E1E]` | Similar |
| `--text` | `#22201c` | `text-stone-800 dark:text-stone-200` | Similar |
| `--muted` | `#726f66` | `text-stone-400 dark:text-stone-500` | Similar |
| `--blue` | `#185fa5` | Blue-600 / blue-400 (Tailwind) | Similar |
| `--green` | `#5d8f20` | Emerald-500 / emerald-400 | Similar |
| `--amber` | `#b87614` | Amber-600 / amber-400 | Similar |
| `--red` | `#d94343` | Red-600 / red-400 | Similar |
| `--radius` | `14px` | `rounded-lg` (8px) | Different |
| Monospace font | `SFMono-Regular, Consolas, monospace` | `font-mono` (Tailwind) | Similar |
| Sans font | `Inter, ui-sans-serif, system-ui, sans-serif` | `DM Sans, ui-sans-serif, system-ui, sans-serif` | Different font family |

---

## 18. Recommendations

### 18.1 Immediate (Phase 0 — Before P42.01)

1. **Define the read model stub fix plan** (WS-1 per interface map) — fix `getCommandHistory()`, `getLeadDirectives()`, `getLeadEscalations()` as these block Workspace Detail and Escalation Center.
2. **Define the unified control path** (WS-2) — consolidate all control actions through `execution-service`.

### 18.2 Phase 1 (P42.01 — Shell and Navigation)

1. Extract App.tsx into AppShell.tsx, routes.tsx, providers.tsx (<100 lines goal).
2. Add React Router with V3 route map.
3. Create LeftSidebar with task/run tree (230px), removing Brain/Platform sections.
4. Remove permanent right sidebar; add `RightDrawer` component.
5. Add status bar.
6. Add breadcrumb to Topbar.

### 18.3 Phase 2 (P42.02 — Mission Control)

1. Create `MissionControlHero` with all 7 states.
2. Replace StatCards with compact `MetricsStrip`.
3. Create `PriorityFeed` with ATTENTION/ACTIVE/RECENT sections.
4. Create `WorkspacePreview` with compact card grid.
5. Create `NextActionCard`.
6. Add tab bar (Overview, Workspaces, Files, Logs, Escalations).

### 18.4 Phase 3 (P42.03 — Workspace Board and Detail)

1. Create grouped `WorkspaceBoard` with `WorkspaceGroup` and `WorkspaceCard` (V3 fields).
2. Create dedicated `WorkspaceDetailPage` with panel-based layout (not tabs).
3. Add route `/workspaces/:workspaceId`.

### 18.5 Phase 4 (P42.04 — Files/Diff and Logs)

1. Refactor `FileExplorer` to use read model (not filesystem).
2. Refactor `DiffViewer` to use read model (not git).
3. Create `CommandTimeline` with structured command list.
4. Replace `LiveLogTerminal` as default with structured timeline; keep raw as toggle.

### 18.6 Phase 5 (P42.05 — Escalation Center)

1. Create dedicated `EscalationCenter` page.
2. Create full `EscalationCard` with root cause, impact, evidence, actions.
3. Create `HumanDirectiveBox` for directive input.

### 18.7 Phase 6 (P42.06 — Brain/Platform)

1. Move Brain pages to topbar dropdown.
2. Move Platform/Settings pages to topbar dropdown.
3. Remove Brain/Platform from sidebar.

### 18.8 Phase 7 (P42.08 — QA)

1. Add keyboard shortcuts.
2. Add ARIA labels and roles.
3. Implement focus management.
4. Write E2E and integration tests.
5. Run fake data detection tests.
6. Run react-doctor audit.

---

## 19. Appendix: File Inventory

### 19.1 Components to Create (New)

| Component | Suggested Location | Estimated Lines |
|---|---|---|
| `AppShell.tsx` | `app/AppShell.tsx` | 80 |
| `routes.tsx` | `app/routes.tsx` | 120 |
| `providers.tsx` | `app/providers.tsx` | 50 |
| `LeftSidebar.tsx` | `components/shell/LeftSidebar.tsx` | 120 |
| `StatusBar.tsx` | `components/shell/StatusBar.tsx` | 60 |
| `RightDrawer.tsx` | `components/shell/RightDrawer.tsx` | 80 |
| `TaskRunTree.tsx` | `components/navigation/TaskRunTree.tsx` | 150 |
| `CommandPalette.tsx` | `components/navigation/CommandPalette.tsx` | 200 |
| `MissionControlHero.tsx` | `components/execution/MissionControlHero.tsx` | 180 |
| `MetricsStrip.tsx` | `components/execution/MetricsStrip.tsx` | 80 |
| `WorkspacePreview.tsx` | `components/execution/WorkspacePreview.tsx` | 80 |
| `PriorityFeed.tsx` | `components/execution/PriorityFeed.tsx` | 150 |
| `NextActionCard.tsx` | `components/execution/NextActionCard.tsx` | 60 |
| `WorkspaceBoard.tsx` | `components/workspaces/WorkspaceBoard.tsx` | 120 |
| `WorkspaceGroup.tsx` | `components/workspaces/WorkspaceGroup.tsx` | 60 |
| `WorkspaceCard.tsx` | `components/workspaces/WorkspaceCard.tsx` | 100 |
| `WorkspaceDetailPage.tsx` | `components/workspace-detail/WorkspaceDetailPage.tsx` | 120 |
| `WorkspaceHeader.tsx` | `components/workspace-detail/WorkspaceHeader.tsx` | 80 |
| `CurrentState.tsx` | `components/workspace-detail/CurrentState.tsx` | 80 |
| `ContextSummary.tsx` | `components/workspace-detail/ContextSummary.tsx` | 80 |
| `CommandHistory.tsx` | `components/workspace-detail/CommandHistory.tsx` | 100 |
| `WorkspaceFiles.tsx` | `components/workspace-detail/WorkspaceFiles.tsx` | 80 |
| `WorkspaceTranscript.tsx` | `components/workspace-detail/WorkspaceTranscript.tsx` | 80 |
| `ValidationEvidence.tsx` | `components/workspace-detail/ValidationEvidence.tsx` | 80 |
| `AttemptHistory.tsx` | `components/workspace-detail/AttemptHistory.tsx` | 60 |
| `EscalationPanel.tsx` | `components/workspace-detail/EscalationPanel.tsx` | 80 |
| `ExecutionFileTree.tsx` | `components/files/ExecutionFileTree.tsx` | 150 |
| `FileDiffView.tsx` | `components/files/FileDiffView.tsx` | 120 |
| `FilePreview.tsx` | `components/files/FilePreview.tsx` | 80 |
| `FileEvidencePanel.tsx` | `components/files/FileEvidencePanel.tsx` | 80 |
| `CommandTimeline.tsx` | `components/logs/CommandTimeline.tsx` | 150 |
| `CommandDetail.tsx` | `components/logs/CommandDetail.tsx` | 120 |
| `LogFilters.tsx` | `components/logs/LogFilters.tsx` | 60 |
| `RawLogView.tsx` | `components/logs/RawLogView.tsx` | 100 |
| `EscalationCenter.tsx` | `components/escalations/EscalationCenter.tsx` | 120 |
| `EscalationCard.tsx` | `components/escalations/EscalationCard.tsx` | 120 |
| `DeadlockDependencies.tsx` | `components/escalations/DeadlockDependencies.tsx` | 100 |
| `HumanDirectiveBox.tsx` | `components/escalations/HumanDirectiveBox.tsx` | 80 |
| `EscalationEmpty.tsx` | `components/escalations/EscalationEmpty.tsx` | 40 |

### 19.2 Components to Deprecate

| Component | Replacement | When |
|---|---|---|
| `ControlButtons.tsx` | Contextual controls | Phase 1-2 |
| `Header.tsx` | Topbar.tsx | Phase 1 |
| `WorkerList.tsx` | WorkspaceBoard.tsx | Phase 3 |
| `LogViewer.tsx` | CommandTimeline.tsx | Phase 4 |
| `QueuePanel.tsx` | Execution overview | Phase 2 |
| `PlanSummary.tsx` | Mission Control Hero | Phase 2 |
| `EventFeed.tsx` | PriorityFeed.tsx | Phase 2 |
| `CockpitPanels.tsx` | Distributed | Phase 2-5 |
| `ExecutionLogViewer.tsx` | logs/ components | Phase 4 |
| `ForceKillDialog.tsx` | Modal.tsx pattern | Phase 1 |

---

## 20. Component State Machines Compliance (V3 §20)

### 20.1 Current State

| State Machine | V3 Spec | Current Implementation | Gap |
|---|---|---|---|
| MissionControlHero | 8 states: loading, onTrack, blocked, stalled, failed, paused, complete, stopped, timeCritical, error | No hero component | **MISSING** — entire state machine not implemented |
| WorkspaceCard | 9 states: loading, pending, running, blocked, failed, complete, cancelled, timedOut, ready | `WorkerCard` has basic stage display via `stageMeta` map | Partial — status colors exist but no state-driven actions |
| ControlAction Confirmation | 6 states: idle, showingConfirm, confirm, cancel, editReason, executing, success, error, timeout | `ForceKillDialog` and `RerunDialog` exist but not unified | Partial — no unified state machine |
| Drawer/Dialog | 5 states: closed, opening, open, submitting, closing | Individual dialog components with independent state | **MISSING** — no unified drawer/dialog state machine |
| Workspace Card actions | Per-state action availability (pending→cancel, running→pause/stop, blocked→detail/directive, failed→retry/detail) | No per-state action buttons on `WorkerCard` | **MISSING** |

### 20.2 Key Findings

1. **No component state machine implementations exist.** The V3 spec defines formal state machines for MissionControlHero, WorkspaceCard, ControlAction confirmation, and drawer/dialog. None are implemented.

2. **Status display is manual.** The `WorkerCard` uses a manual `stageMeta` record to map stages to colors. This works for display but doesn't drive per-state actions.

3. **Control action flow is ad-hoc.** The `handleControl()` callback in App.tsx doesn't follow the V3 confirmation flow (idle → showingConfirm → confirm/cancel/editReason → executing → success/error). Each action handles it differently.

4. **Drawer/dialog states are not managed.** Each dialog has its own boolean open/close state with no opening/closing/submitting/error substates.

---

## 21. Frontend Skill Usage Compliance (V3 §21)

### 21.1 Current State

| Skill | V3 Recommendation | Current Implementation | Gap |
|---|---|---|---|
| shadcn | Component primitives (Button, Card, Modal, Dropdown, Tabs, Tooltip, Toast) | Custom Tailwind-based components with inline style tokens | **MISSING** — no shadcn dependency in dashboard |
| web-design-guidelines | Layout, accessibility, empty/loading/error states | Basic error states exist but no systematic approach | Partial — some empty/loading states exist |
| vercel-composition-patterns | Component decomposition, compound components | Monolithic components (App.tsx 1364, WorkerDetail 1048, FileExplorer 783) | **MISSING** — no systematic composition |
| vercel-react-best-practices | State/effects, performance optimization | Many `useEffect` hooks, some stale closure patterns | Partial — basic patterns followed |
| react-doctor | Final audit: lint, a11y, bundle, architecture | Not run | **MISSING** |

### 21.2 Key Findings

1. **No shadcn dependency** exists in dashboard `package.json` or imports. All components use custom CSS with Tailwind utility classes.

2. **No systematic empty/loading/error state pattern** exists across components. Some handle loading (skeleton), some don't.

3. **Composition patterns are not used.** Large components are not decomposed into smaller focused sub-components.

---

## 22. Migration Plan Gap Analysis (V3 §23)

### 22.1 Phase Readiness

| Phase | Title | Status | Risk | Dependencies Met? |
|---|---|---|---|---|
| 1 | Shell and Navigation Cleanup | **NOT STARTED** | LOW | No blockers |
| 2 | Mission Control / Execution Cockpit | **NOT STARTED** | MEDIUM | Needs Phase 1 |
| 3 | Workspace Board and Detail Route | **NOT STARTED** | HIGH | Needs Phase 1 + WS-1 (read model stubs) |
| 4 | Files/Diff and Logs/Command Timeline | **NOT STARTED** | HIGH | Needs Phase 1 + WS-1 (read model stubs) |
| 5 | Escalation Center | **NOT STARTED** | MEDIUM | Needs Phase 3 + WS-2 (control path) |
| 6 | Brain/Platform Regrouping | **NOT STARTED** | LOW | Needs Phase 1 |
| 7 | QA, A11y, React Doctor Audit | **NOT STARTED** | LOW | All phases |

### 22.2 Key Findings

1. **The entire migration plan is unimplemented.** No V3 components exist yet.

2. **WS-1 (read model stubs) is a blocking dependency** for Phases 3-4. The 6 stubbed read model methods must be implemented before or in parallel with UI work.

3. **WS-2 (unified control path) is a blocking dependency** for Phase 5. Control actions must go through `execution-service` before the Escalation Center can dispatch actions.

4. **Phase 1 is ready to start immediately** as it has no dependencies on read model or control path fixes.

---

## 23. What Not To Build Yet Compliance (V3 §25)

### 23.1 Out of Scope Features Currently Present

| Feature | V3 Decision | Current Status | Action |
|---|---|---|---|
| Side-by-side diff | P43 | Not present | ✅ Already deferred |
| Before/after file comparison | P43 | Not present | ✅ Already deferred |
| Full Monaco editor | P44 | Not present | ✅ Already deferred |
| Execution timeline Gantt | P43 | Not present | ✅ Already deferred |
| Execution comparison | P44 | Not present | ✅ Already deferred |
| Execution replay | P44 | Not present | ✅ Already deferred |
| Execution scheduling | P44 | Not present | ✅ Already deferred |
| Multi-execution view | P44 | Not present | ✅ Already deferred |
| Execution webhooks | P44 | Not present | ✅ Already deferred |
| Email/Slack notifications | P44 | Not present | ✅ Already deferred |
| Workspace chat/commenting | P45 | Chat panel exists | ⚠️ ChatPanel exists but is a separate feature, not in cockpit scope |
| Execution templates | P44 | Not present | ✅ Already deferred |
| Performance dashboard (historical) | P43 | PerformancePanel exists | ⚠️ Should be moved to Platform/Observability |
| External worker marketplace | P45 | Not present | ✅ Already deferred |
| Unrestricted browser shell | P45 | Not present | ✅ Already deferred |
| Advanced animations | P43 | Framer Motion used for sidebar/drawer animations | ✅ Acceptable, used for transitions only |
| Full mobile-perfect UI | P43 | Basic responsive exists | ✅ Acceptable for P42 |

### 23.2 Deferred Features (V3 §25.2) Compliance

| Feature | V3 Priority | Current Status | Compliance |
|---|---|---|---|
| Command palette (Cmd/Ctrl+K) | HIGH for P42.5/P43 | Not implemented | ✅ Deferred correctly |
| Execution timeline Gantt | MEDIUM for P43 | Not implemented | ✅ Deferred correctly |
| Side-by-side diff | MEDIUM for P43 | Not implemented | ✅ Deferred correctly |
| Before/after file comparison | MEDIUM for P43 | Not implemented | ✅ Deferred correctly |
| Historical performance | LOW for P43 | PerformancePanel exists | ⚠️ Consider moving to Platform |

### 23.3 Key Findings

1. **Most out-of-scope features are not built yet**, which is good.
2. **ChatPanel** exists but is a separate troubleshooting feature, not a core cockpit component. Should be retained.
3. **PerformancePanel** and related observability features should be grouped under Platform/Observability, not in the core cockpit view.

---

## 24. Acceptance Criteria Compliance Status (V3 §26)

### 24.1 Must-Have Criteria (P42 Shipped)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Workspace click opens a dedicated detail route | ❌ **NOT MET** | Inline rendering, no route |
| 2 | Controls are contextual, not a standalone tab | ❌ **NOT MET** | ControlButtons exist, no contextual controls |
| 3 | Mission Control Hero shows state, risk, next action | ❌ **NOT MET** | No hero component |
| 4 | Files/Diff from real read models (not git) | ❌ **NOT MET** | Uses git/worktree endpoints |
| 5 | Logs show command timeline by default with raw toggle | ❌ **NOT MET** | Raw logs are default |
| 6 | Escalations show root cause, impact, evidence, action | ❌ **NOT MET** | Minimal panel in CockpitPanels |
| 7 | Brain/Platform not competing with execution nav | ❌ **NOT MET** | Sidebar has Brain/Platform sections |
| 8 | App.tsx decomposed (<100 lines, shell+router+providers) | ❌ **NOT MET** | 1364 line monolith |
| 9 | No production panel relies on fake/static data | ❌ **NOT MET** | 6 read model stubs, 4+ bypasses |
| 10 | All mutation controls go through execution-service | ❌ **NOT MET** | Bypasses in human-directive-routes, App.tsx |
| 11 | Critical flows keyboard accessible | ❌ **NOT MET** | No keyboard shortcuts |
| 12 | React Doctor audit run with no critical issues | ❌ **NOT MET** | Not run |
| 13 | E2E tests pass for 10+ critical flows | ❌ **NOT MET** | No E2E tests |

**Summary: 0 of 13 must-have criteria are met.**

### 24.2 Nice-to-Have Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Command palette (Cmd/Ctrl+K) | ❌ Not implemented |
| 2 | Execution timeline Gantt chart | ❌ Not implemented |
| 3 | Side-by-side diff view | ❌ Not implemented |
| 4 | Before/after file snapshot comparison | ❌ Not implemented |
| 5 | Historical performance metrics | Partial — PerformancePanel exists |
| 6 | Full mobile-responsive layout | Partial — basic responsive overlay menus |

---

## 25. V3 Event Payload Alignment (V3 §17)

### 25.1 Current State

| Event Type | V3 Spec | Current Events | Gap |
|---|---|---|---|
| Total event types | 42 (Plan 7 + Workspace 9 + Worker 5 + Command 3 + Brain 3 + Governance 4 + Lead Agent 5 + Human 3 + System 3) | 42 types in `events.ts` | ✅ Aligned |
| Event payload interfaces | Defined in V3 §17.1 | Defined in `events.ts` | ✅ Payloads match |
| Event categorization helpers | `isPlanEventType()`, `isWorkspaceEventType()`, etc. | Present in `events.ts` | ✅ Implemented |
| Event to stage mapping | `mapWorkspaceStageToExecutionStage()`, `workspaceStageToEventType()` | Present in `events.ts` | ✅ Implemented |
| Journal event envelope | `JournalEventEnvelope` (seq, eventId, planExecId, workspaceId, eventType, payload, createdAt) | Present in `read-model.ts` and `events.ts` | ✅ Aligned |

### 25.2 Key Findings

1. **Event system is fully aligned with V3 spec.** All 42 event types, payload interfaces, categorization helpers, and workspace stage mappings exist in `packages/execution-core/src/events.ts`.

2. **Event persistence is functional.** Journal events are stored and accessible via `listJournalEvents()`.

3. **Transcript event types** (V3 §12.3) align with current worker transcript types in the dashboard types.

---

## 26. Web-Server Endpoint Audit (V3 §13, §16)

### 26.1 Execution Endpoints

| Endpoint | Current | V3 Target | Gap |
|---|---|---|---|
| `GET /api/execution/:eid/summary` | Not present | `GET /api/projects/:pid/tasks/:tid/runs/:rid` | **MISSING** — V3 nested route pattern |
| `GET /api/execution/:eid/workspaces` | Not present | `GET /api/projects/:pid/tasks/:tid/runs/:rid/workspaces` | **MISSING** — V3 nested route pattern |
| `POST /api/execution/:eid/control/pause` | Uses `/api/executions/:eid/control` with JSON body | Per-action endpoints | Different pattern |
| `POST /api/execution/:eid/control/stop` | Same legacy endpoint | Per-action endpoint | Different pattern |
| `POST /api/execution/:eid/workspaces/:wsId/retry` | Uses `/api/human/intervene/:peid/:wsId` | New endpoint | **MISSING** — uses legacy alias |
| `POST /api/execution/:eid/escalations/:escId/resolve` | Uses `/api/human/escalations/:escId/resolve` | New endpoint | **MISSING** — uses legacy alias |

### 26.2 Read Model Endpoints

| Endpoint | Current | V3 Target | Gap |
|---|---|---|---|
| `GET .../commands` | Not present (only per-workspace `/api/human/directives/...`) | `GET .../runs/:rid/workspaces/:wsId/commands` | **MISSING** — `getCommandHistory()` is stub anyway |
| `GET .../directives` | `GET /api/human/directives/:eid/:wsId` (bypasses read model) | `GET .../runs/:rid/workspaces/:wsId/directives` | Bypassed |
| `GET .../escalations` | `GET /api/human/escalations/:eid/:wsId` (bypasses read model) | `GET .../runs/:rid/escalations` | Bypassed |
| `GET .../files` | `GET .../worktrees/:wsId/files` (filesystem) | `GET .../runs/:rid/files` | **MISSING** — uses filesystem |
| `GET .../files/:path/diff` | `GET .../git-diff?format=patch` (git) | `GET .../runs/:rid/files/:path/diff` | **MISSING** — uses git |
| `GET .../validation` | Not present | `GET .../runs/:rid/validation` | **MISSING** — stubbed |
| `GET .../stats` | `/api/projects/:pid/plans/:eid/stats` | `GET .../runs/:rid/stats` | Exists but different path |
| `GET .../dependencies` | Not present | `GET .../runs/:rid/dependencies` | **MISSING** |

### 26.3 Key Findings

1. **All web-server routes use flat path patterns** (`/api/executions/:eid/...`, `/api/human/...`), not the nested V3 pattern (`/api/projects/:pid/tasks/:tid/runs/:rid/...`).

2. **No read model endpoints exist in web-server** — the read model is embedded in `execution-service` and not exposed as HTTP endpoints. The web-server has its own separate routes that access state store, filesystem, and git directly.

3. **6 read model methods are stubs** (confirmed by code examination of `query-handler.ts`).

4. **4 bypasses exist** where web-server reads data directly instead of going through the read model.

---

*End of Baseline Audit*

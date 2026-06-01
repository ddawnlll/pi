# P42 Proposed Interface Map V3 — Autonomous Coding IDE Cockpit

**Date:** 2026-06-01
**Phase:** P42
**Status:** Proposed Interface Map / Implementation Reference
**Input Baseline:** Dashboard Summary, Proposed Dashboard V2, Pi Cockpit V3 no-right-sidebar prototype, P42 Interface Map (current state)
**Target Quality:** 10/10 product direction, implementation-ready without rewriting the whole platform

---

## Table of Contents

0. [Executive Verdict](#0-executive-verdict)
1. [Product Vision](#1-product-vision)
2. [V3 Design Principles](#2-v3-design-principles)
3. [Current Problems Solved by V3](#3-current-problems-solved-by-v3)
4. [Proposed App Shell](#4-proposed-app-shell)
5. [Route Map](#5-route-map)
6. [Navigation Model](#6-navigation-model)
7. [Primary Views](#7-primary-views)
8. [Workspace Detail — Nested Page](#8-workspace-detail--nested-page)
9. [Files — IDE Diff Workspace](#9-files--ide-diff-workspace)
10. [Logs — Command Timeline](#10-logs--command-timeline)
11. [Escalations — Root Cause / Action Center](#11-escalations--root-cause--action-center)
12. [Storage / Artifacts / Transcripts View](#12-storage--artifacts--transcripts-view)
13. [Control Actions Matrix](#13-control-actions-matrix)
14. [Contextual Drawers and Dialogs](#14-contextual-drawers-and-dialogs)
15. [State Ownership and Data Flow](#15-state-ownership-and-data-flow)
16. [Read Model API Contract Map](#16-read-model-api-contract-map)
17. [Event Type Catalog](#17-event-type-catalog)
18. [Component Architecture](#18-component-architecture)
19. [Accessibility and Keyboard UX](#19-accessibility-and-keyboard-ux)
20. [Component State Machines](#20-component-state-machines)
21. [Frontend Skill Usage](#21-frontend-skill-usage)
22. [Testing Strategy](#22-testing-strategy)
23. [Migration Plan](#23-migration-plan)
24. [Implementation Workspace Details](#24-implementation-workspace-details)
25. [What Not To Build Yet](#25-what-not-to-build-yet)
26. [Acceptance Criteria](#26-acceptance-criteria)

---

## 0. Executive Verdict

The existing dashboard should evolve into an **Autonomous Coding IDE Cockpit**.

The V2/V3 direction is correct: it moved away from a noisy three-panel data dashboard and toward a center-first execution cockpit. V3 removed the permanent right sidebar, reduced sidebar width, introduced a task-to-run tree, added a system hero, workspace cards, and primary tabs.

This V3 map upgrades that direction with **four architecture decisions**:

1. **Workspace click opens a dedicated nested workspace detail route, not a dialog.**
2. **Controls are not a tab; they are contextual actions attached to plan/workspace/escalation objects.**
3. **Files/Diff and Logs/Command Timeline become first-class IDE views.**
4. **Escalations become a root-cause/action center, not just an alert list.**

The goal is no longer "show all data."
The goal is: **tell the user what is happening, what changed, what is blocked, and what to do next.**

### 0.1 V3 vs Current State Comparison

| Dimension | Current State (V1) | V2 Proposal | V3 Target |
|---|---|---|---|
| Right sidebar | Permanent 300px (events, alerts, summary) | Removable drawer | Removed by default; contextual drawer only |
| Workspace interaction | Click opens WorkerDetail inline in center column | — | Click opens dedicated `/workspaces/:workspaceId` route |
| Controls | Scattered across Topbar, CockpitPanels, dialogs | Own "Controls" tab | Contextual actions on the object they affect |
| Events | Raw event feed in right sidebar (all 39 types) | — | Priority feed (Attention/Active/Recent); raw debug mode |
| Files | Secondary view, uses git directly | First-class tab | First-class IDE view with read model |
| Logs | LiveLogTerminal (raw stream) | — | Command timeline + raw detail toggle |
| Brain/Platform | Sidebar navigation items competing with execution | Dropdown menus | Secondary namespace; contextual support |
| App.tsx | 1364 lines monolithic | Not addressed | <100 lines shell + router + providers |
| Read model usage | 6/12 methods are stubs; dashboard bypasses | Identified stubs | All read model methods real; no bypasses |
| Control path | 3 different paths; 2 bypass execution-service | Identified fragmentation | Single path through execution-service |
| Fake/static data | 5 read model stubs, git bypass, archive fallbacks | Identified | Zero fake data in production UI |

---

## 1. Product Vision

### 1.1 Name

**Pi Execution Cockpit V3**
_Subtitle: Autonomous Coding IDE Cockpit_

### 1.2 User Promise

Within 3 seconds, the user must know:

- **What is happening?** (Plan status, active workspaces, next action)
- **Where is the risk?** (Blocked workspaces, failing commands, exhausted retries)
- **What changed?** (File diffs, command output, validation results)
- **What evidence proves it?** (Transcripts, logs, artifacts, test results)
- **What is the safest next action?** (Recommended action with one-click execution)

### 1.3 Primary Object Model

```
Project
  └── Task
        └── Plan Execution  ← PRIMARY LIVE OBJECT
              ├── Workspace (unit of work)
              │     ├── Worker Attempt (agent execution instance)
              │     │     ├── Command (bash/shell execution)
              │     │     ├── File Change (created/modified/deleted)
              │     │     ├── Transcript (structured event stream)
              │     │     ├── Log (stdout/stderr output)
              │     │     └── Validation Evidence (test results, lints, gates)
              │     ├── Artifact (snapshot, report, patch)
              │     ├── Event (lifecycle event)
              │     └── Escalation (Lead Agent diagnosis + user intervention)
              ├── Plan Artifacts (plan document, parsed contract, workspace queue)
              ├── Event Stream (SSE/WebSocket)
              └── Control Action (pause/stop/cancel/retry/directive)
```

### 1.4 Design Philosophy

Old design:
```
Show every data source.
```

New design:
```
Prioritize decisions, evidence, and safe intervention.
```

### 1.5 Key User Personas

| Persona | Primary Use Case | Secondary Use Case | Power Feature |
|---|---|---|---|
| **Operator** | Upload plan, watch execution, intervene when blocked | Review escalations, send directives | Keyboard shortcuts, command palette |
| **Reviewer** | Review completed execution, check diffs, validate output | Examine worker transcripts, command history | File-by-file diff walkthrough |
| **Developer** | Debug failed workspaces, inspect logs, identify root cause | Inspect worker context, retry with directives | Command timeline, raw log mode |
| **Manager** | Monitor multiple executions, track cost/tokens | Review brain insights, policy audits | Dashboard overview, metrics |

---

## 2. V3 Design Principles

| # | Principle | Meaning | UI Consequence |
|---|---|---|---|
| 1 | **Execution-first** | Active plan execution is the main surface | Execution overview is the default route; Brain/Platform are secondary |
| 2 | **Decision hierarchy** | Show next action before raw data | Mission Control Hero owns the top of the page with recommended next action |
| 3 | **Evidence-driven** | Every COMPLETE/BLOCKED state must link to evidence | Commands, logs, diffs, transcripts are first-class views with evidence links |
| 4 | **Contextual controls** | Controls belong to the object they affect | No generic "Controls" tab; controls appear on plan header, workspace card, escalation card |
| 5 | **Progressive disclosure** | Start with summary, drill into detail | Workspace cards → workspace detail route; command list → command detail |
| 6 | **Event-sourced visibility** | UI consumes event/read-model truth, not fake/static data | Every panel backed by ExecutionReadModel; stubs are fixed before UI ships |
| 7 | **Safety by design** | Dangerous actions require confirmation | Stop/cancel/force-kill have explicit confirmation dialogs with impact summary |
| 8 | **Keyboard-first cockpit** | Power users need fast navigation | Command palette is a first-class feature (Cmd/Ctrl+K); all actions have shortcuts |
| 9 | **Calm but alive** | Running state should feel live, not chaotic | Micro animations (heartbeat, subtle progress), no flashing/spinning |
| 10 | **Responsive by reduction** | Mobile hides panels, not content meaning | Center-first layout; drawers for side context; never hide critical info |
| 11 | **Zero fake data** | Production UI must not rely on static/demo data | Every value comes from a real API call or read model; empty states are explicit |
| 12 | **Single mutation path** | All control actions go through execution-service | No direct state store access, no control file writes from web-server |

### 2.1 Design Principle Conflicts

| Conflict | Resolution |
|---|---|
| Progressive disclosure vs Keyboard-first | Default view shows summary; keyboard shortcuts reveal detail without extra clicks |
| Calm but alive vs Real-time updates | Micro-animations for state changes (not polling); SSE pushes updates |
| Safety by design vs One-click actions | Common safe actions (retry, pause) need one click; dangerous actions (stop, cancel) need confirmation |
| Zero fake data vs Fast development | Fix read model stubs first (WS-1); parallelize UI development with mocked API layer |

---

## 3. Current Problems Solved by V3

### 3.1 Information Hierarchy

**Problem:** Stats, worker cards, logs, and events have equal visual weight. Users cannot distinguish primary from secondary information.

**V3 fix:** 
- Mission Control Hero summarizes state, risk, and next action at the top
- Metrics strip shows cost/tokens/burn rate in a compact bar (not 7-grid stat cards)
- Workspace board shows execution units grouped by status
- Events move to priority feed (Attention/Active/Recent) in the overview tab only

### 3.2 Layout Overload

**Problem:** 320px left sidebar + 300px right sidebar leave too little room for actual work content. The center column gets compressed between two fixed-width panels.

**V3 fix:**
- No permanent right sidebar (removed by default)
- Left sidebar reduced to 230px with a single context tree (no tabs)
- Right-side information becomes a contextual drawer or tab
- Center work surface gets maximum width for content

### 3.3 Tab Chaos

**Problem:** Projects, Runs, Tasks, Platform, Brain, Observability, Scale — all competing nav models in the sidebar.

**V3 fix:**
- One task/run tree in the left sidebar (hierarchical, not tabbed)
- Brain is a secondary namespace (accessible via topbar or sidebar section)
- Platform/Settings is an admin namespace (accessible via gear icon)
- Scale/Observability/Policy are platform pages, not execution views

### 3.4 Event Spam

**Problem:** Raw event feed in the right sidebar shows all 39 event types. Users cannot find the events that matter.

**V3 fix:**
- Priority feed: **Attention** (blocked, failed, escalated), **Active** (running, started), **Recent** (completed, finished)
- Raw events move to debug mode (toggle in settings or per-session)
- Event filtering by severity, workspace, type

### 3.5 Workspace Blindness

**Problem:** Workspace cards show ID, stage, attempt count — not what the worker is actually doing.

**V3 fix:**
- Workspace cards show: phase, current command, retry count, last heartbeat, touched files count, blockers
- Each card has a recommended next action (View Detail, Send Directive, Retry, etc.)
- Status is color-coded with clear visual hierarchy

### 3.6 Weak IDE Feeling

**Problem:** File/log/diff surfaces are secondary views. Users have to navigate away from the execution view to find them.

**V3 fix:**
- Files and Logs are primary tabs in the execution view
- Files tab shows an execution-aware file tree (not a raw filesystem browser)
- Logs tab shows a command timeline (not a raw terminal dump)
- Both views link back to related workspaces and validation commands

### 3.7 Unsafe Control Placement

**Problem:** Controls scattered across Topbar (pause/stop/cancel), CockpitPanels (retry/intervene), and separate dialogs (ForceKill). Two of three control paths bypass execution-service.

**V3 fix:**
- Controls are contextual and attached to the object they affect
- Plan-level controls (pause/stop/cancel) in Topbar
- Workspace-level controls (retry/cancel/directive) on workspace card and detail page
- All controls go through execution-service via `POST /api/human/intervene/:peid/:wsId`
- Dangerous actions show confirmation dialogs with impact summary

### 3.8 Fake/Static Data Risk

**Problem:** 6 read model methods return stubs (`[]` or `null`). Dashboard bypasses read model for file tree, diff, and context data. Archive artifacts may not exist for all executions.

**V3 fix:**
- All read model methods return real data before UI redesign
- File tree and diff use read model, not git commands
- Context data shows explicit "not available" state when archive artifacts are missing
- Zero fake/static/demo data in production UI

### 3.9 Component Monoliths

**Problem:** App.tsx is 1364 lines. ObservabilityCockpit, LeadAgentDashboard, BatchOSDashboard are each 300-400+ lines.

**V3 fix:**
- App.tsx becomes a thin shell (<100 lines: AppShell + Router + Providers)
- Monolithic components are split into focused sub-components
- Components follow the proposed folder structure (see §18)

---

## 4. Proposed App Shell

### 4.1 Layout Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Topbar (48px):                                                        │
│ [Pi Logo] [breadcrumb: Project > Task > Run #4]                      │
│ [Health Pill: Running] [3 active · est. 6 min]                       │
│                              [Pause] [Stop]  [🧠Brain][⚙️Settings][🔍]│
├──────────────┬───────────────────────────────────────────────────────┤
│ Left Sidebar │ Center Work Surface                                   │
│ 230px        │                                                       │
│              │ [Overview|Workspaces|Files|Logs|Escalations]  ← Tabs  │
│ Task tree    │                                                       │
│   active run │ Mission Control / Selected Route Content              │
│ Brain        │                                                       │
│ Platform     │                                                       │
│ Quick Actions│                                                       │
│              │ Contextual drawer (right, collapsed by default)       │
├──────────────┴───────────────────────────────────────────────────────┤
│ Status Bar (24px):                                                    │
│ [run #4] Running · 3/12 workspaces · 2 blocked · ~$0.84 · 24k tokens│
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Layout Dimensions

| Region | Desktop (>1200px) | Tablet (768-1200px) | Mobile (<768px) |
|--------|-------------------|---------------------|-----------------|
| Topbar | 48px fixed | 48px fixed | 48px fixed |
| Left sidebar | 230px fixed | Collapsible to icon bar | Drawer overlay |
| Center | `flex-1` | `flex-1` | `flex-1` (full width) |
| Right drawer | 0 (hidden by default) | 0 (hidden by default) | 0 (hidden by default) |
| Right drawer (when open) | 360px | 360px (overlay) | Full screen overlay |
| Status bar | 24px fixed | 24px fixed | 0 (hidden) |

### 4.3 What Changed from V3 Prototype

| Area | V3 Prototype | V3 Final Recommendation |
|---|---|---|
| Right sidebar | Removed | Keep removed by default; add contextual drawer (360px) opened via action |
| Tabs | Overview, Workspaces, Feed, Logs, Files, Escalations, Controls | Overview, Workspaces, Files, Logs, Escalations (5 tabs, no Controls/Feed tab) |
| Controls | Own tab | Contextual actions on plan header, workspace cards, escalation cards |
| Workspace click | Inline detail in same tab | Dedicated nested route: `/workspaces/:workspaceId` |
| Events | "Live Feed" tab | Priority feed in Overview; raw events in debug mode |
| Files | Present but secondary | First-class IDE view with diff/evidence |
| Logs | Terminal stream | Command timeline (default) + raw terminal (toggle) |
| Brain | Sidebar section | Contextual support + secondary namespace + topbar dropdown |
| Command palette | Not specified | First-class feature; Cmd/Ctrl+K opens searchable palette |

### 4.4 Layout Behavior Rules

| Rule | Behavior |
|---|---|
| Default tab selection | If execution is running → Overview; if completed → Workspaces (or last visited tab) |
| Right drawer trigger | Workspace file click, escalation card action, transcript view command |
| Right drawer close | Escape key, click outside drawer, or drawer close button |
| Sidebar collapse | Collapses to icon bar on hover; full width on click or hover |
| Status bar content | Execution status, workspace counts, blocked count, estimated cost, token count |
| Breadcrumb click | Each level is clickable (Project, Task, Run) |

---

## 5. Route Map

### 5.1 Primary Routes

| Route | View | Purpose | Route Params |
|---|---|---|---|
| `/` | Redirect | Redirect to last active execution or project list | — |
| `/projects/:projectId` | Project Detail | Project overview with active executions | `projectId: string` |
| `/projects/:projectId/tasks/:taskId` | Task Detail | Task overview with execution history | `projectId, taskId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId` | Execution Overview | Mission control for active run | `projectId, taskId, runId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/workspaces` | Workspace Board | Kanban/grouped execution board | `projectId, taskId, runId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId` | Workspace Detail | Dedicated workspace/worker detail page | `projectId, taskId, runId, workspaceId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/files` | Files/Diff View | Execution-aware file tree and diffs | `projectId, taskId, runId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/files/:filePath` | File Detail | File preview + diff + related workspace evidence | `projectId, taskId, runId, filePath: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/logs` | Logs/Commands View | Command timeline + stdout/stderr | `projectId, taskId, runId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/escalations` | Escalation Center | Root cause / action center | `projectId, taskId, runId: string` |
| `/projects/:projectId/tasks/:taskId/runs/:runId/artifacts` | Artifact Browser | Execution artifacts (snapshots, reports, patches) | `projectId, taskId, runId: string` |

### 5.2 Secondary Routes

| Namespace | Routes | Placement | Visibility |
|---|---|---|---|
| **Brain** | `/brain/proposals`, `/brain/memory`, `/brain/digest`, `/brain/reflections`, `/brain/overnight`, `/brain/inbox` | Topbar Brain dropdown + sidebar section | Secondary (contextual) |
| **Platform** | `/platform/observability`, `/platform/policy`, `/platform/trust`, `/platform/extensions`, `/platform/skills`, `/platform/settings` | Topbar Settings dropdown | Admin only |
| **History** | `/history/executions`, `/history/tasks`, `/history/brain` | Topbar History dropdown | Archive |

### 5.3 Route Parameter Specifications

| Parameter | Type | Validated? | Source | Notes |
|---|---|---|---|---|
| `projectId` | UUID string | Yes (exists in state store) | URL path | Validated by route guard |
| `taskId` | UUID string | Yes (belongs to project) | URL path | Validated by route guard |
| `runId` | UUID string | Yes (belongs to task) | URL path | Validated by route guard |
| `workspaceId` | UUID string | Yes (belongs to run) | URL path | Validated by route guard |
| `filePath` | URL-encoded path string | Yes (path traversal blocked) | URL path | Must be within workspace root; null byte and `..` blocked |
| `escalationId` | UUID string | Yes (belongs to run) | URL query or body | Used in POST endpoints |

### 5.4 Route Guards

| Guard | Purpose | Behavior When Fails |
|---|---|---|
| `projectExists` | Verify project ID exists | Redirect to `/projects` with toast |
| `taskExists` | Verify task ID belongs to project | Redirect to project detail |
| `executionExists` | Verify execution ID belongs to task | Redirect to task detail |
| `workspaceExists` | Verify workspace ID belongs to execution | Redirect to workspace board |
| `filePathSafe` | Verify file path is within workspace root (no traversal) | Show error toast |

### 5.5 URL State Persistence

```typescript
// Hook for persisting and restoring last-visited route
function useLastVisitedRoute() {
  const setLastRoute = (route: string) => {
    localStorage.setItem('p42_last_route', route);
  };
  
  const getLastRoute = (): string | null => {
    return localStorage.getItem('p42_last_route');
  };
  
  return { setLastRoute, getLastRoute };
}

// Example: restore last route on dashboard load
function AppShell() {
  const { getLastRoute } = useLastVisitedRoute();
  const navigate = useNavigate();
  
  useEffect(() => {
    const lastRoute = getLastRoute();
    if (lastRoute) {
      navigate(lastRoute, { replace: true });
    }
  }, []);
  
  // ...
}
```

---

## 6. Navigation Model

### 6.1 Left Sidebar — Context Tree

The left sidebar should be a **context tree**, not tabs. No more "Browse/Queue/Chat" tab grouping.

```
▼ my-project

  ▶ Active tasks
      auth module
        run #4    running ← SELECTED
        run #3    done
        run #2    failed
      session mgmt
        run #1    blocked

  ▶ Completed tasks
      db-migration
      user-model

  Brain
    Proposals     2
    Morning digest
    Memory

  Platform
    Policy & audit
    Observability
    Extensions

  Quick actions
    [+ Upload plan]
    [+ New task]
```

#### 6.1.1 Sidebar Node Types

| Node Type | Icon | Behavior | Example |
|---|---|---|---|
| Project | 📁 | Expand/collapse; click navigates to project detail | `my-project` |
| Task | 📋 | Expand/collapse; click navigates to task detail | `auth module` |
| Run | ▶ (running) / ✅ (done) / ❌ (failed) | Click navigates to execution overview | `run #4` |
| Section header | — | Non-interactive; groups related items | `Active tasks` |
| Leaf action | + | Click triggers action | `[+ Upload plan]` |
| Brain item | 🧠 | Click navigates to brain page | `Proposals` |
| Platform item | ⚙️ | Click navigates to platform page | `Policy & audit` |

### 6.2 Topbar

Topbar stays slim at 48px.

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Pi]  my-project > auth module > run #4    ● Running    3 active    │
│                                    est. 6 min      [Pause] [Stop]   │
│                                                    [🧠] [⚙️] [🔍]  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.2.1 Topbar Elements

| Element | Position | Behavior |
|---|---|---|
| Pi logo | Left | Click → navigate to `/` (last active execution or project list) |
| Breadcrumb | Left-center | Clickable segments: Project > Task > Run |
| Health pill | Center-right | Shows current execution status with color-coded dot |
| Status text | Center-right | Shows brief status: `3 active · est. 6 min` |
| Pause button | Right | Pauses current execution (only when running) |
| Stop button | Right | Stops current execution (requires confirmation) |
| Brain dropdown | Right | Opens brain page navigation |
| Settings dropdown | Right | Opens platform/settings page navigation |
| Search icon | Right | Opens command palette (Cmd/Ctrl+K) |

#### 6.2.2 Breadcrumb Behavior

```typescript
interface Breadcrumb {
  label: string;
  route: string;
  onClick?: () => void;
}

// Breadcrumb segments are dynamic based on current route
// /projects/p1/tasks/t1/runs/r1
// → [Pi] [p1] [t1] [r1]
// Each segment is clickable and navigates to that level
```

### 6.3 Command Palette

`Cmd+K` / `Ctrl+K` opens the command palette.

#### 6.3.1 Required Commands

| Command | Action | Keyboard Shortcut | Requires Confirmation? |
|---|---|---|---|
| `Pause execution` | Pause current plan | `P` (from overview) | No |
| `Stop execution` | Stop current plan | `S` (from overview) | Yes |
| `Retry workspace` | Retry selected workspace | `R` (from workspace detail) | No |
| `Cancel workspace` | Cancel selected workspace | `C` (from workspace detail) | Yes |
| `Send directive` | Issue human directive to workspace | `D` (from workspace detail) | No |
| `Open blocked workspaces` | Navigate to Escalation Center | `B` | No |
| `Open files changed` | Navigate to Files tab | `F` | No |
| `Open command timeline` | Navigate to Logs tab | `L` | No |
| `Open latest transcript` | Open transcript drawer | `T` (from workspace detail) | No |
| `Run validation` | Rerun validation for workspace | `V` (from workspace detail) | No |
| `Show escalations` | Navigate to Escalations tab | `E` | No |
| `Open artifact browser` | Navigate to Artifacts tab | `A` | No |
| `Search` | Search projects, tasks, runs, workspaces | `/` | No |

#### 6.3.2 Command Palette UX

```typescript
interface CommandPaletteAction {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  shortcut?: string;
  icon: React.ComponentType;
  action: () => void;
  requiresContext?: boolean; // true if workspace/execution must be selected
  danger?: boolean; // true if confirmation dialog required
}

// Command palette states:
// - closed (default)
// - open (focused on search input)
// - searching (results filtered by query)
// - selected (action executed)
// - error (action failed)

// Example command implementation:
const COMMANDS: CommandPaletteAction[] = [
  {
    id: 'pause-execution',
    label: 'Pause Execution',
    description: 'Pause the current plan execution',
    keywords: ['pause', 'stop', 'halt', 'freeze'],
    shortcut: 'P',
    icon: PauseIcon,
    action: () => executeCommand('pause'),
    requiresContext: true,
  },
  {
    id: 'stop-execution',
    label: 'Stop Execution',
    description: 'Stop the current plan execution (requires confirmation)',
    keywords: ['stop', 'cancel', 'terminate', 'kill'],
    shortcut: 'S',
    icon: StopIcon,
    action: () => showConfirmationThenExecute('stop'),
    requiresContext: true,
    danger: true,
  },
  // ... more commands
];
```

---

## 7. Primary Views

### 7.1 Overview — Mission Control

**Purpose:** Answer "what is happening and what should I do?"

#### 7.1.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ MISSION CONTROL HERO                                                 │
│ ● Running — 3 workers active — on track, est. 6 min                 │
│ [Open bottleneck] [Send directive] [View evidence]                   │
├─────────────────────────────────────────────────────────────────────┤
│ METRICS STRIP                                                        │
│ Progress: 3/12 (25%) · Cost: $0.84 ($2.00 budget)                   │
│ Tokens: 24k (100k budget) · Burn: 4k/min · Cache hit: 72%          │
├─────────────────────────────────────────────────────────────────────┤
│ WORKSPACE PREVIEW                                                    │
│ [Running x3] [Blocked x2] [Ready x2] [Done x5]                     │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                   │
│ │ws-01│ │ws-02│ │ws-03│ │ws-04│ │ws-05│ │ws-06│                   │
│ │run  │ │run  │ │blk  │ │blk  │ │rdy  │ │done │                   │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                   │
│                          [View all workspaces →]                    │
├─────────────────────────────────────────────────────────────────────┤
│ PRIORITY FEED                                                        │
│                                                                      │
│ ATTENTION                                                            │
│ ⚠️ ws-04 — Retry budget exhausted — escalation #12                 │
│ ⚠️ ws-03 — Dependency on ws-01 (still running)                     │
│                                                                      │
│ ACTIVE                                                               │
│ 🔄 ws-01 — Running: npm run build (14s, exit pending)              │
│ 🔄 ws-02 — Running: npx vitest --run (3s, 5 tests passed)          │
│                                                                      │
│ RECENT                                                               │
│ ✅ ws-05 — Complete — 8 files changed, all tests passed             │
│ ✅ ws-06 — Complete — 3 files changed, 2 warnings                   │
│                                                                      │
│ [Show raw events ▾]                                                  │
├─────────────────────────────────────────────────────────────────────┤
│ NEXT ACTION CARD                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ 🎯 Resolve escalation for ws-04                               │   │
│ │ Retry budget exhausted after 3 attempts. Lead Agent diagnosis │   │
│ │ available.                                                     │   │
│ │ [Resolve Now →]                                                │   │
│ └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.1.2 Hero States

| Plan State | Hero Color | Hero Tone | Message Example | Action Buttons |
|---|---|---|---|---|
| Running (healthy) | Green | Calm | `● Running — 3 workers active — on track, est. 6 min` | [Open bottleneck] [Send directive] |
| Running (blocked) | Amber | Alert | `● Blocked — 2 workspaces blocked — impacts 3 downstream` | [View blockers] [Send directive] |
| Running (stalled) | Amber pulse | Warning | `● Stalled — No heartbeat from ws-04 for 122s` | [Investigate] [Force retry] |
| Failed | Red | Urgent | `● Failed — Plan failed: final validation missing evidence` | [View evidence] [Rerun] |
| Paused | Blue | Informational | `● Paused — 2 active workspaces paused` | [Resume] [Stop] |
| Complete | Green | Success | `✅ Complete — 12/12 workspaces, all tests passed` | [View summary] [View artifacts] |
| Stopped | Gray | Neutral | `■ Stopped — Plan stopped by user` | [Rerun] [View partial results] |

#### 7.1.3 Metrics Strip Content

| Metric | Source | Format | Update Frequency |
|---|---|---|---|
| Progress | `getPlanStats().progress` | `X/Y workspaces (N%)` | Per workspace completion |
| Cost | `getPlanStats().estimatedCostUsd` | `$X.XX ($Y.YY budget)` | Per workspace completion |
| Tokens in | `getPlanStats().totalTokensIn` | `Nk (Mk budget)` | Per command output |
| Tokens out | `getPlanStats().totalTokensOut` | `Nk` | Per command output |
| Burn rate | `getPlanStats().burnRatePerMin` | `Nk/min` | Every 10s during active execution |
| Cache hit | `getPlanStats().cacheHitRate` | `N%` | Per workspace completion |

#### 7.1.4 Priority Feed Rules

| Category | Source | Max Items | Filter |
|---|---|---|---|
| ATTENTION | Escalated workspaces, failed workspaces, blocked workspaces | 5 | Severity >= HIGH |
| ACTIVE | Running workspaces, just-started workspaces | 5 | Status = running |
| RECENT | Just-completed workspaces, just-failed workspaces | 10 | Last 10 events |

Raw events are available via a "Show raw events" expandable section below the priority feed. Raw events show all 39 event types with workspace and timestamp filters.

#### 7.1.5 Next Action Card Rules

| Condition | Next Action | Priority |
|---|---|---|
| Active escalations | Resolve highest-severity escalation | HIGH |
| Blocked workspaces with Lead Agent diagnosis | Review and retry with directive | HIGH |
| Failed workspaces within retry budget | Retry workspace | MEDIUM |
| Completed execution | View summary and artifacts | LOW |
| Paused execution | Resume | HIGH |
| Stalled execution | Investigate (force retry or stop) | HIGH |

---

### 7.2 Workspaces — Board

**Purpose:** Browse and select execution units.

#### 7.2.1 Group Definitions

| Group | Status | Color | Sort Order | Max Visible |
|---|---|---|---|---|
| Attention / Blocked | blocked, failed, escalated | Amber/Red | By severity (highest first) | 20 (show all) |
| Running | running, active | Green | By start time (oldest first) | 20 (show all) |
| Ready | pending, queued | Blue | By dependency order | 20 (show all) |
| Completed | complete, done | Gray | By completion time (newest first) | 10 (show more link) |
| Failed | failed, stopped | Red (dim) | By failure time (newest first) | 10 (show more link) |

#### 7.2.2 Card Required Fields

```
┌──────────────────────────────────────────────────────────────────┐
│ ws-04                                    ● Blocked   🔴 FAILED  │
│ ───────────────────────────────────────────────────────────────── │
│ Phase: Building · Command: npm run build (14s, exit 1)          │
│ Attempt: 3/3 · Last heartbeat: 12s ago                         │
│ Files: 3 touched · Blocks: ws-09, ws-10                        │
│ Model: claude-3-opus · Provider: anthropic                      │
│                                                                  │
│ [View Detail →]  [Send Directive]  [Retry]                      │
└──────────────────────────────────────────────────────────────────┘
```

| Field | Source | Format | Required | Notes |
|---|---|---|---|---|
| Workspace ID | `getWorkspaceSummary().workspaceId` | Truncated UUID | Always | Click navigates to `/workspaces/:workspaceId` |
| Status | `getWorkspaceSummary().stage` | Color-coded badge | Always | |
| Phase | `getWorkerContext().phase` | Text | When available | "Building", "Testing", "Validating", etc. |
| Current command | `getCommandHistory().last()` | Truncated command | When available | Shows command name + duration |
| Retry count | `getWorkspaceSummary().attempts` | `N/M` format | Always | M = max retries from plan definition |
| Last heartbeat | `getWorkerContext().lastHeartbeat` | Relative time | When available | "12s ago", "never" if no heartbeat |
| Files touched | `getChangedFiles().length` | Count | When available | |
| Blocks / Blocked by | `getDependencyGraph()` | Workspace IDs | When blocked | |
| Model | `getWorkerContext().model` | Text | When available | |
| Provider | `getWorkerContext().provider` | Text | When available | |

#### 7.2.3 Empty States

| Group | Empty State Message | Suggested Action |
|---|---|---|
| Attention / Blocked | "No blocked or failed workspaces" | — |
| Running | "No running workspaces" | [Start execution] |
| Ready | "No pending workspaces" | — |
| Completed | "No completed workspaces yet" | — |
| Failed | "No failed workspaces" | — |

#### 7.2.4 Card Click Behavior

| Click Target | Navigation Action |
|---|---|
| Card body (anywhere except buttons) | Navigate to `/workspaces/:workspaceId` |
| [View Detail →] button | Navigate to `/workspaces/:workspaceId` |
| [Send Directive] button | Opens directive dialog (contextual to workspace) |
| [Retry] button | Executes retry with confirmation if dangerous |

---

## 8. Workspace Detail — Nested Page

**Purpose:** Deep investigation and intervention into a single workspace.

### 8.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Workspace Detail — ws-04                                             │
│ breadcrumb: Project > Task > Run #4 > ws-04                         │
│ ● Running · Attempt 2/3 · Agent: pi-worker-3 · Model: claude-3-opus│
│ [Pause] [Stop] [Cancel] [Retry] [Send Directive]                    │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Current State                                                    │ │
│ │ Phase: Building                                                 │ │
│ │ Current Command: npm run build (14s, exit pending)              │ │
│ │ Last Heartbeat: 5s ago · Connection: active                     │ │
│ │ Goal: "Implement user authentication module with JWT and 2FA"   │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Prompt / Context Summary                                         │ │
│ │ "You are a senior TypeScript developer implementing the user    │ │
│ │  authentication module for the Pi dashboard. Focus on...        │ │
│ │  [View full prompt →]                                            │ │
│ │                                                                  │ │
│ │ Allowed files: src/auth/*, tests/auth/*                         │ │
│ │ Touched files:                                                   │ │
│ │   🟢 src/auth/login.ts (created)                                │ │
│ │   🟡 src/auth/utils.ts (modified)                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Command History                                                   │ │
│ │ # │ Command              │ Duration │ Exit │ Status              │ │
│ │ ──┼──────────────────────┼──────────┼──────┼───────────────────  │ │
│ │ 1 │ npm install          │ 8s       │ 0    │ ✅ Done             │ │
│ │ 2 │ npm run build        │ 14s      │ 2    │ ❌ Failed (view →) │ │
│ │ 3 │ npm run typecheck    │ 2s       │ 1    │ ❌ Failed (view →) │ │
│ │ 4 │ npm run build --fix  │ —        │ —    │ 🔄 Running          │ │
│ │                                                                  │ │
│ │ [View full command timeline →]                                   │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ File Changes                                                     │ │
│ │ 📁 src/auth/                                                     │ │
│ │   🟡 login.ts (modified) [+12 -3]  [View diff →]               │ │
│ │   🟢 register.ts (created) [+47 -0] [View diff →]              │ │
│ │   🟢 utils.ts (created) [+23 -0]   [View diff →]               │ │
│ │                                                                  │ │
│ │ [View all files →]                                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Transcript                                                       │ │
│ │ [14:23:01] Worker started                                       │ │
│ │ [14:23:05] Running: npm install                                 │ │
│ │ [14:23:13] Command completed (exit 0) — "Dependencies installed"│ │
│ │ [14:23:14] Running: npm run build                               │ │
│ │ [14:23:28] Command failed (exit 2) — "TypeScript errors in 3   │ │
│ │           files"                                                │ │
│ │                                                                  │ │
│ │ [View full transcript →]                                         │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Validation Evidence                                               │ │
│ │ ✅ Plan validation: passed                                      │ │
│ │ ⚠️ Workspace validation: 2 warnings                             │ │
│ │    - Missing JSDoc comments in src/auth/login.ts                │ │
│ │    - Test coverage: 78% (target: 80%)                           │ │
│ │ ❌ Build validation: failed (TypeScript errors)                  │ │
│ │                                                                  │ │
│ │ [View validation details →]                                      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Attempt History                                                   │ │
│ │ Attempt 1 — Failed — "TypeScript compilation errors"             │ │
│ │   Lead Agent: Issued directive to fix type errors               │ │
│ │ Attempt 2 — (current) — Running                                  │ │
│ │                                                                  │ │
│ │ [View attempt details →]                                         │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Escalations / Directives                                         │ │
│ │ 📋 Active escalation: none                                      │ │
│ │ 📋 Last directive (attempt 1): "Fix TypeScript errors in        │ │
│ │    auth module. Focus on strict type checking."                  │ │
│ │                                                                  │ │
│ │ [Issue new directive →]                                          │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 Required Panels

| # | Panel | Data Source | Priority | Notes |
|---|---|---|---|---|
| 1 | **Header** | `getWorkerContext()` | HIGH | Workspace ID, status, attempt, agent, model |
| 2 | **Current State** | `getWorkerContext()` + `ICommandLogStream` | HIGH | Phase, current command, heartbeat, goal |
| 3 | **Prompt/Context Summary** | `getWorkerContext()` | HIGH | Role packet summary, allowed/touched files |
| 4 | **Command History** | `getCommandHistory()` | HIGH | Table of commands with duration, exit code, status |
| 5 | **File Changes** | `getChangedFiles()` + `getFileDiff()` | HIGH | File tree with change status, diff links |
| 6 | **Transcript** | `IWorkerTranscriptStore.readTranscriptEvents()` | MEDIUM | Structured event stream with timestamps |
| 7 | **Validation Evidence** | `getFinalValidationStatus()` | MEDIUM | Plan validation, workspace validation results |
| 8 | **Attempt History** | `getWorkspaceSummary()` | MEDIUM | List of attempts with status and error |
| 9 | **Escalations/Directives** | `getLeadEscalations()` + `getLeadDirectives()` | HIGH | Active escalations, recent directive history |

### 8.3 Controls

| Control | Action | Confirmation Required? | Goes Through Execution-Service? |
|---|---|---|---|
| Pause | `intervene_workspace` (pause) | No | ✅ |
| Stop | `intervene_workspace` (stop) | Yes | ✅ |
| Cancel | `intervene_workspace` (cancel) | Yes | ✅ |
| Retry | `intervene_workspace` (retry) | No | ✅ |
| Send Directive | `issue_human_directive` | No | ✅ |

### 8.4 Empty/Loading/Error States

| State | Behavior |
|---|---|
| **Loading** | Skeleton placeholders for each panel (header, command list, file tree) |
| **Workspace not found** | "Workspace not found" message with [Back to workspaces] button |
| **Command history empty** | "No commands executed yet" message in Command History panel |
| **File changes empty** | "No files changed yet" message in File Changes panel |
| **Transcript empty** | "No transcript events available" message with link to raw logs |
| **Validation not run** | "Validation not yet run" message |
| **Escalations empty** | "No escalations" with [View all escalations] link |
| **API error** | Error banner with retry button for each failed panel |

---

## 9. Files — IDE Diff Workspace

**Purpose:** Answer "what changed?"

### 9.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ FILES                                                                │
├───────────────────────────────────────────────────────────────── ────┤
│ ┌──────────────────────────────┬──────────────────────────────────┐  │
│ │ FILE TREE (left, 280px)      │ FILE PREVIEW / DIFF (center)    │  │
│ │                              │                                  │  │
│ │ 📁 src/                      │ src/auth/login.ts                │  │
│ │   📁 auth/                   │ Status: 🟡 Modified              │  │
│ │     📄 login.ts  🟡 M        │ Last writer: ws-04 (attempt 2)   │  │
│ │     📄 register.ts 🟢 A      │ Related workspace: ws-04         │  │
│ │     📄 utils.ts   🟢 A       │ Related command: npm run build   │  │
│ │   📁 components/             │                                  │  │
│ │     📄 header.tsx ⚪ U       │ ┌─ UNIFIED DIFF ───────────────┐ │  │
│ │ 📁 tests/                    │ │  10 │ function login(       │ │  │
│ │   📁 auth/                   │ │  11 │   email: string,      │ │  │
│ │     📄 login.test.ts 🟢 A    │ │  12 │   password: string    │ │  │
│ │     📄 utils.test.ts 🟢 A    │ │  13 │ ) {                  │ │  │
│ │                              │ │  14 │   const user =       │ │  │
│ │                              │ │  15 │-   const hashed =    │ │  │
│ │                              │ │  16 │+   const hashed =    │ │  │
│ │                              │ │  17 │   // verify auth     │ │  │
│ │                              │ │  18 │   if (!user) {       │ │  │
│ │                              │ │     └──────────────────────┘ │  │
│ │ Legend: 🟢 Added 🟡 Modified│                                  │  │
│ │         🔴 Deleted ⚪ Unchgd│ [+12 -3]  [View full file]       │  │
│ │         🔒 Locked by ws-01  │                                  │  │
│ └──────────────────────────────┴──────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│ FILE EVIDENCE (context drawer, right, 360px, opens on demand)        │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ Related Workspace: ws-04                                      │   │
│ │ Related Command: npm run build (exit 2)                       │   │
│ │ Related Validation: TypeScript compilation check              │   │
│ │ Artifact: .pi/executions/.../patches/login.ts.patch           │   │
│ │ [Open in workspace detail →] [Open in logs →]                 │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 File Status Colors

| Status | Color | Icon | Description |
|---|---|---|---|
| Created | Green | 🟢 | File did not exist before execution |
| Modified | Amber | 🟡 | File content changed during execution |
| Deleted | Red | 🔴 | File removed during execution |
| Unchanged | Gray | ⚪ | File exists but was not changed |
| Locked | Orange | 🔒 | File is locked by another workspace |

### 9.3 File Metadata

| Field | Source | Format |
|---|---|---|
| Path | `getChangedFiles().path` | Relative path from workspace root |
| Name | `getChangedFiles().name` | Basename |
| Status | `getChangedFiles().status` | `created`, `modified`, `deleted`, `renamed`, `copied`, `unmerged` |
| Additions | `getFileDiff().additions` | Integer |
| Deletions | `getFileDiff().deletions` | Integer |
| Last writer | `getWorkerContext().workspaceId` | Workspace ID |
| Related workspace | `getWorkerContext().workspaceId` | Workspace ID |
| Related command | `getCommandHistory().find(cmd => cmd.changedFiles?.includes(path))` | Command name |
| Related validation | `getFinalValidationStatus().validations?.find(v => v.file === path)` | Validation name |
| Diff available | `getFileDiff(path) !== null` | Boolean |
| Artifact path | `getSnapshotArtifact(path)?.patchPath` | File path or null |

### 9.4 Diff View Requirements

| Feature | Required? | Notes |
|---|---|---|
| Unified diff | ✅ | Default view; lines with `+`/`-` prefix |
| Syntax highlighting | ✅ | Language detected from file extension |
| Line numbers | ✅ | Left gutter |
| Collapse unchanged sections | ✅ | Context lines configurable (default: 3) |
| Side-by-side diff | 🟡 | Future enhancement (P43) |
| Before/after file view | 🟡 | Future enhancement (P43) |
| Related workspace link | ✅ | Links to workspace detail page |
| Related command link | ✅ | Links to command detail in Logs tab |
| Related validation link | ✅ | Highlights validation evidence |
| Copy diff button | ✅ | Copies diff to clipboard |
| Download patch button | ✅ | Downloads `.patch` file |

### 9.5 File Tree Empty State

```
📁 No files changed
All files in the workspace remain unchanged.
No file was created, modified, or deleted during this workspace execution.
```

---

## 10. Logs — Command Timeline

**Purpose:** Answer "what ran and what happened?"

### 10.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ LOGS                                                                  │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ FILTERS                                                           │ │
│ │ Workspace: [All ▼]  Command: [All ▼]  Status: [All ▼]           │ │
│ │ [✓ Target commands only]  [Show raw output ▾]                   │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ COMMAND TIMELINE                                                   │ │
│ │                                                                   │ │
│ │ ws-01  npm install          8s       exit 0    ✅ Done           │ │
│ │ ws-01  npm run build        15s      exit 0    ✅ Done           │ │
│ │ ws-01  npm test             12s      exit 0    ✅ Done           │ │
│ │ ws-02  npm run lint         5s       exit 0    ✅ Done           │ │
│ │ ws-04  npm install          8s       exit 0    ✅ Done           │ │
│ │ ws-04  npm run build        14s      exit 2    ❌ Failed  ◀────│ │
│ │ ws-04  npm run typecheck    2s       exit 1    ❌ Failed        │ │
│ │ ws-04  npm run build --fix  —        —         🔄 Running       │ │
│ │                                                                   │ │
│ │ [Click any command to see detail]                                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ COMMAND DETAIL (opens when command clicked)                       │ │
│ │                                                                   │ │
│ │ Command: npm run build                                            │ │
│ │ Workspace: ws-04 · Attempt: 2                                     │ │
│ │ Duration: 14.2s · Exit code: 2                                    │ │
│ │ Is target command? Yes · Matched validation: build check          │ │
│ │                                                                   │ │
│ │ ┌─ STDOUT ─────────────────────────────────────────────────────┐ │ │
│ │ │ > build                                                      │ │ │
│ │ │ > tsc && vite build                                          │ │ │
│ │ │                                                              │ │ │
│ │ │ src/auth/login.ts:42:3 - error TS2322: Type 'string' is     │ │ │
│ │ │ not assignable to type 'number'.                             │ │ │
│ │ │                                                              │ │ │
│ │ │ 42   const port = process.env.PORT ?? 3000;                  │ │ │
│ │ │        ~~~~                                                   │ │ │
│ │ │                                                              │ │ │
│ │ │ Found 3 errors in 2 files.                                   │ │ │
│ │ │                                                              │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │ ┌─ STDERR ─────────────────────────────────────────────────────┐ │ │
│ │ │ (empty)                                                      │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │                                                                   │ │
│ │ [View in workspace detail →]  [View related files →]             │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.2 Command Timeline

| Column | Source | Format | Width |
|---|---|---|---|
| Workspace | `getCommandHistory().workspaceId` | Truncated ID | 80px |
| Command | `getCommandHistory().command` | Truncated command | flex |
| Duration | `getCommandHistory().duration` | `Ns` or `N.Ms` | 70px |
| Exit code | `getCommandHistory().exitCode` | `exit N` or `—` (running) | 60px |
| Status | Derived from exit code + running state | Color-coded icon | 50px |

### 10.3 Command Detail

| Section | Content |
|---|---|
| **Header** | Command name, workspace, attempt, duration, exit code |
| **Metadata** | Is target command, matched validation, matched accepted equivalent |
| **stdout** | Raw stdout output (monospace, scrollable, capped at 500 lines) |
| **stderr** | Raw stderr output (monospace, scrollable, red-tinted) |
| **Links** | View in workspace detail, view related files, view related diff |

### 10.4 Raw Terminal Mode

When "Show raw output" is toggled, the command timeline is replaced by a raw terminal view:

```
┌──────────────────────────────────────────────────────────────────────┐
│ RAW OUTPUT [Collapse]                                                 │
│                                                                       │
│ [14:23:01] [ws-01] npm install                                       │
│ added 142 packages in 8s                                             │
│                                                                       │
│ [14:23:13] [ws-01] npm run build                                     │
│ ✓ 47 modules transformed.                                            │
│ dist/index.html                  0.42 kB                             │
│ ✓ built in 1.23s                                                    │
│                                                                       │
│ [14:23:29] [ws-04] npm run build                                     │
│ src/auth/login.ts:42:3 - error TS2322: Type 'string' is not          │
│ assignable to type 'number'.                                         │
│                                                                       │
│ Found 3 errors in 2 files.                                           │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.5 Filters

| Filter | Type | Options | Default |
|---|---|---|---|
| Workspace | Dropdown | All, or specific workspace ID | All |
| Command name | Text input | Partial match | Empty (show all) |
| Status | Dropdown | All, Done, Failed, Running | All |
| Target commands only | Toggle | On/Off | Off |
| Show raw output | Toggle | On/Off | Off (timeline view) |

---

## 11. Escalations — Root Cause / Action Center

**Purpose:** Answer "what needs intervention?"

### 11.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ESCALATIONS                                                           │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Active Escalations (2)                                            │ │
│ │                                                                   │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ ⚠️ ws-04 — Retry budget exhausted    Severity: HIGH          │ │ │
│ │ │ ────────────────────────────────────────────────────────────  │ │ │
│ │ │ Root cause: Transient provider failure (anthropic API 503)    │ │ │
│ │ │ Impact: Blocks ws-09, ws-10 (3 downstream workspaces)        │ │ │
│ │ │ Evidence: 3/3 attempts failed with 503 errors                 │ │ │
│ │ │ Retry budget: 3/3 exhausted                                   │ │ │
│ │ │                                                               │ │ │
│ │ │ Lead Agent Diagnosis:                                         │ │ │
│ │ │ "All 3 attempts failed with provider 503 errors. The code     │ │ │
│ │ │ changes are correct based on the partial build output.        │ │ │
│ │ │ Recommend: 1) Increase retry budget to 5, 2) Retry with       │ │ │
│ │ │ directive to skip provider calls during test."                │ │ │
│ │ │                                                               │ │ │
│ │ │ ┌─ RECOMMENDED ACTIONS ─────────────────────────────────┐   │ │ │
│ │ │ │ 1. [Increase budget to 5 and retry]                    │   │ │ │
│ │ │ │ 2. [Retry with directive]                               │   │ │ │
│ │ │ │ 3. [Skip workspace — continue with others]              │   │ │ │
│ │ │ └────────────────────────────────────────────────────────┘   │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │                                                                   │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ ⚠️ ws-03 — Blocked by dependency    Severity: MEDIUM         │ │ │
│ │ │ ────────────────────────────────────────────────────────────  │ │ │
│ │ │ Root cause: ws-03 depends on ws-01 (still running)            │ │ │
│ │ │ Impact: No downstream blockers yet                            │ │ │
│ │ │                                                               │ │ │
│ │ │ Lead Agent Diagnosis:                                         │ │ │
│ │ │ "Natural dependency wait. No action needed — ws-01 is 60%    │ │ │
│ │ │  through execution."                                          │ │ │
│ │ │                                                               │ │ │
│ │ │ Recommended action: [Wait for ws-01 to complete]              │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ DEADLOCK DEPENDENCIES                                             │ │
│ │                                                                   │ │
│ │ ws-01 ──→ ws-03 (blocked)                                         │ │
│ │ ws-01 ──→ ws-05 (blocked)                                         │ │
│ │ ws-04 ──→ ws-09 (blocked)                                         │ │
│ │ ws-04 ──→ ws-10 (blocked)                                         │ │
│ │                                                                   │ │
│ │ No circular dependencies detected.                                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ HUMAN DIRECTIVE INPUT                                             │ │
│ │                                                                   │ │
│ │ Target workspace: [ws-04 ▼]                                       │ │
│ │ Severity: [MEDIUM ▼]                                              │ │
│ │                                                                   │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ Type your directive here...                                  │ │ │
│ │ │                                                              │ │ │
│ │ │ Example: "Focus on fixing the TypeScript errors in           │ │ │
│ │ │ src/auth/login.ts. Do not modify other files. Skip           │ │ │
│ │ │ provider-dependent tests by using --runInBand."              │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │                                                                   │ │
│ │ [Send Directive]                                                   │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 11.2 Escalation Card Required Fields

| Field | Source | Format | Required |
|---|---|---|---|
| Workspace ID | `getLeadEscalations().workspaceId` | Text | Always |
| Severity | `getLeadEscalations().severity` | LOW/MEDIUM/HIGH/BLOCKING with color badge | Always |
| Root cause | `getLeadEscalations().whatHappened` | Text paragraph | Always |
| Impact | `getDependencyGraph()` | List of downstream dependencies | When blocked |
| Evidence | `getLeadEscalations().evidenceRefs` | List of file paths or event references | When available |
| Retry budget | `getLeadEscalations().retryBudget` | `X/Y` format | When applicable |
| Lead Agent diagnosis | `getLeadEscalations().leadDiagnosis` | Text paragraph | When available |
| Recommended actions | `getLeadEscalations().options` | List of action objects with id/label/risk/description | Always |

### 11.3 Escalation States

| State | Description | Actions Available |
|---|---|---|
| `awaiting_user` | User needs to respond | Resolve with option, issue directive, skip |
| `user_responded` | User has responded | View response, acknowledge |
| `resolved` | Escalation has been resolved | View resolution details |
| `expired` | Escalation timed out | View details, re-escalate |

### 11.4 Recommended Actions

| Action | Trigger | Confirmation Required? |
|---|---|---|
| Increase budget and retry | Escalation card → [Increase budget to 5 and retry] | No |
| Retry with directive | Escalation card → [Retry with directive] | No (directive dialog opens) |
| Skip workspace | Escalation card → [Skip workspace] | Yes (confirms skip) |
| Wait for dependency | Escalation card → [Wait for dependency] | No |
| Resolve escalation | Escalation card → any action that resolves | No |

---

## 12. Storage / Artifacts / Transcripts View

### 12.1 Execution Archive Artifacts

| Artifact | Path | Format | Producer | Dashboard Consumer |
|---|---|---|---|---|
| Original plan | `.pi/executions/:peid/original-plan.md` | Markdown | Plan runner | Artifact browser |
| Parsed contract | `.pi/executions/:peid/parsed-contract.json` | JSON | Plan runner | Artifact browser |
| Doctor report | `.pi/executions/:peid/doctor-report.json` | JSON | Safety doctor | Artifact browser |
| Dry-run report | `.pi/executions/:peid/dry-run-report.json` | JSON | Dry-run engine | Artifact browser |
| Workspace DAG | `.pi/executions/:peid/workspace-dag.json` | JSON | Plan runner | Dependency graph |
| Safety policy | `.pi/executions/:peid/safety-policy.json` | JSON | Safety doctor | Artifact browser |
| Commits | `.pi/executions/:peid/commits.json` | JSON | Plan runner | Artifact browser |
| Workspace packet | `.pi/executions/:peid/workspaces/:wsId/packet.md` | Markdown | Executor | Workspace detail |
| Raw log | `.pi/executions/:peid/workspaces/:wsId/raw.log` | Plain text | Executor | Logs |
| Structured log | `.pi/executions/:peid/workspaces/:wsId/structured.ndjson` | NDJSON | Executor | Transcript |
| Tool calls | `.pi/executions/:peid/workspaces/:wsId/tool-calls.ndjson` | NDJSON | Executor | Workspace detail |
| Events | `.pi/executions/:peid/workspaces/:wsId/events.ndjson` | NDJSON | Executor | Event stream |
| Decisions | `.pi/executions/:peid/workspaces/:wsId/decisions.ndjson` | NDJSON | Executor | Workspace detail |
| Narrative | `.pi/executions/:peid/workspaces/:wsId/narrative.ndjson` | NDJSON | Executor | Transcript |
| Audit | `.pi/executions/:peid/workspaces/:wsId/audit.ndjson` | NDJSON | Executor | Event stream |
| Files touched | `.pi/executions/:peid/workspaces/:wsId/files-touched.json` | JSON | Executor | File tree |
| Diff patch | `.pi/executions/:peid/workspaces/:wsId/diff.patch` | Patch | Executor | Diff viewer |
| Reviewer verdict | `.pi/executions/:peid/workspaces/:wsId/reviewer-verdict.md` | Markdown | Executor | Workspace detail |

### 12.2 Snapshot Artifact Store

The `ISnapshotArtifactStore` interface must be exposed as a web endpoint:

```
GET /api/projects/:projectId/tasks/:taskId/runs/:runId/snapshots
  → Returns list of snapshot artifacts for the run
  → Uses ISnapshotArtifactStore.list(planExecutionId)

GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/snapshots
  → Returns list of snapshot artifacts for the workspace
  → Uses ISnapshotArtifactStore.list(planExecutionId).filter(workspaceId)

GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/snapshots/:attemptNumber
  → Returns specific snapshot artifact with pre/post snapshots and diffs
  → Uses ISnapshotArtifactStore.get(planExecutionId, workspaceId, attemptNumber)
```

### 12.3 Transcript View

The transcript is a structured event stream derived from journal events but with private chain-of-thought stripped:

```
GET /api/transcript/:planExecId/:workspaceId (SSE)
  → Returns sanitized WorkerTranscriptEvent stream
  → Uses IWorkerTranscriptStore.readTranscriptEvents()
```

Transcript event types:
- `worker_status` — Worker heartbeat/status update
- `worker_decision_summary` — Worker made a decision
- `validation` — Validation check passed/failed
- `blocker` — Worker hit a blocker
- `tool_call` — Worker invoked a tool
- `workspace_start` — Workspace started
- `workspace_complete` — Workspace completed
- `workspace_failed` — Workspace failed
- `workspace_blocked` — Workspace blocked
- `retry_attempt` — Retry attempt started
- `plan_summary` — Plan summary event

---

## 13. Control Actions Matrix

### 13.1 All Control Actions

| Action | Object | Endpoint | ES Command | Event Emitted | Confirmation Required? | Goes Through ES? |
|---|---|---|---|---|---|---|
| Pause | Plan | `POST /api/execution/:eid/control/pause` | `stop_plan` (with pause reason) | `plan_paused` | No | ✅ |
| Resume | Plan | `POST /api/execution/:eid/control/resume` | `continue_plan` | `plan_resumed` | No | ✅ |
| Stop | Plan | `POST /api/execution/:eid/control/stop` | `stop_plan` | `plan_stopped` | Yes (impact summary) | ✅ |
| Cancel | Plan | `POST /api/execution/:eid/control/cancel` | `stop_plan` (with cancel reason) | `plan_cancelled` | Yes (impact summary) | ✅ |
| Rerun | Plan | `POST /api/execution/:eid/control/rerun` | `rerun_plan` | New plan execution | Yes (creates new execution) | ✅ |
| Force Kill | Plan | `POST /api/execution/:eid/control/force-kill` | `intervene_workspace` (force kill) | `plan_stopped` | Yes (double confirm) | ✅ |
| Retry | Workspace | `POST /api/execution/:eid/workspaces/:wsId/retry` | `intervene_workspace` (retry) | `human_intervention_requested` | No | ✅ |
| Cancel | Workspace | `POST /api/execution/:eid/workspaces/:wsId/cancel` | `intervene_workspace` (cancel) | `human_intervention_requested` | Yes | ✅ |
| Send Directive | Workspace | `POST /api/execution/:eid/workspaces/:wsId/directive` | `issue_human_directive` | `human_directive_issued` | No | ✅ |
| Increase Budget | Workspace | `POST /api/execution/:eid/workspaces/:wsId/increase-budget` | (modifies retry budget) | — | No | ✅ |
| Skip | Workspace | `POST /api/execution/:eid/workspaces/:wsId/skip` | `intervene_workspace` (cancel with skip reason) | `workspace_skipped` | Yes | ✅ |
| Rerun Validation | Workspace | `POST /api/execution/:eid/workspaces/:wsId/rerun-validation` | (triggers validation) | — | No | ✅ |
| Resolve Escalation | Escalation | `POST /api/execution/:eid/escalations/:escId/resolve` | `resolve_escalation` | `lead_agent_escalation_resolved` | No | ✅ |
| Acknowledge Escalation | Escalation | `POST /api/execution/:eid/escalations/:escId/ack` | `acknowledge_directive` | `lead_agent_directive_acknowledged` | No | ✅ |

### 13.2 Confirmation Dialog Specifications

```
┌─────────────────────────────────────────────────────────────────────┐
│ Confirm: Stop Execution                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Are you sure you want to stop execution `run #4`?                   │
│                                                                      │
│ This will:                                                           │
│ • Stop all running workers (2 active)                               │
│ • Mark all pending workspaces as cancelled (7 pending)              │
│ • Preserve partial results from completed workspaces (3/12 done)    │
│                                                                      │
│ This action cannot be undone.                                        │
│                                                                      │
│ Reason (optional):                                                   │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │                                                                  ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ [Cancel]                                      [Confirm Stop]        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.3 Control Action Flow Diagram

```
User clicks [Stop] on workspace ws-04
  ↓
Check: Is this dangerous?
  ↓ Yes
Show confirmation dialog with impact summary:
  "This will stop ws-04. Partial results from attempt 2 will be preserved."
  ↓ User confirms
POST /api/human/intervene/:peid/:wsId
  Body: { action: "stop", reason: "user requested" }
  ↓
execution-service.handleExecutionCommand({
  type: "intervene_workspace",
  planExecutionId: peid,
  workspaceId: ws-04,
  action: "stop",
  reason: "user requested"
})
  ↓
State store transitions workspace to "stopped"
  ↓
ExecutionService emits event: human_intervention_requested
  ↓
SSE pushes event to dashboard
  ↓
Dashboard React Query invalidates workspace data
  ↓
Dashboard updates UI: ws-04 status = "stopped"
  ↓
Show toast: "✅ ws-04 stopped successfully"
```

### 13.4 Source Endpoints (deprecated in V3)

These endpoints exist in the current codebase and are being replaced:

| Endpoint | Replacement | Migration |
|---|---|---|
| `POST /api/control` (legacy) | `POST /api/execution/:eid/control/pause\|stop\|cancel\|resume` | Remove after migration |
| `POST /api/executions/:eid/control` | `POST /api/execution/:eid/control/pause\|stop\|cancel\|resume` | Redirect to new pattern |
| `POST /api/human/intervene/:peid/:wsId` | `POST /api/execution/:eid/workspaces/:wsId/cancel\|retry` | Alias (keep both during migration) |
| `POST /api/human/directive` | `POST /api/execution/:eid/workspaces/:wsId/directive` | Alias (keep both during migration) |
| `POST /api/human/escalations/:escId/resolve` | `POST /api/execution/:eid/escalations/:escId/resolve` | Alias (keep both during migration) |

---

## 14. Contextual Drawers and Dialogs

### 14.1 When to Use What

| UI Pattern | Use When | Examples |
|---|---|---|
| **Dedicated page** | Rich object with multiple panels and controls | Workspace detail, file detail, escalation center |
| **Tab** | Multiple related views for same object | Overview, Workspaces, Files, Logs |
| **Drawer** | Contextual information without leaving current page | Transcript snippet, artifact preview, event detail |
| **Dialog** | Short action with confirmation | Confirm stop, confirm cancel, send directive |
| **Toast** | Transient feedback after action | "Execution paused", "Directive sent", "Workspace retried" |

### 14.2 Drawer Specifications

| Drawer | Width | Content | Trigger | Close Behavior |
|---|---|---|---|---|
| Transcript snippet | 360px | Last 20 transcript events with timestamp | Click "View transcript" button | Escape, click outside, close button |
| Artifact preview | 480px | Artifact content with metadata | Click artifact link | Escape, click outside, close button |
| Event detail | 360px | Event type, timestamp, payload, workspace | Click event in priority feed | Escape, click outside, close button |
| Command output detail | 480px | Full stdout/stderr with metadata | Click command in timeline | Escape, click outside, close button |

### 14.3 Dialog Specifications

| Dialog | Width | Content | Actions |
|---|---|---|---|
| Confirm stop plan | 480px | Impact summary, reason input | [Cancel] [Confirm Stop] |
| Confirm cancel workspace | 480px | Impact summary, reason input | [Cancel] [Confirm Cancel] |
| Confirm force kill | 480px | Warning text (double confirm) | [Cancel] [Type "KILL" to confirm] [Confirm Force Kill] |
| Send directive | 480px | Target workspace, severity, directive text | [Cancel] [Send Directive] |
| Resolve escalation | 480px | Escalation summary, option selection | [Cancel] [Resolve with Option] |

### 14.4 Drawer/Dialog State Machine

```
closed
  ↓ (user triggers action)
opening
  ↓ (animation completes)
open
  ↓ (user interacts)
  ├── (submits action) → submitting → (success) → toast → closed
  │                                   → (error)  → error banner → open
  ├── (closes via escape/click outside) → closing → closed
  └── (closes via close button) → closing → closed
```

---

## 15. State Ownership and Data Flow

### 15.1 State Ownership Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ STATE OWNERSHIP                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ execution-core (contracts — owns type definitions)                   │
│ ├── ExecutionReadModel (12 query methods)                           │
│ ├── ExecutionCommand (11 command types)                             │
│ ├── ExecutionEvent (39 event types, 9 categories)                   │
│ ├── ICommandLogStream (live command output pub/sub)                 │
│ ├── IWorkerTranscriptStore (structured event stream persistence)    │
│ ├── ISnapshotArtifactStore (file snapshot persistence)              │
│ └── WorkerAdapter (agent execution contract)                        │
│                                                                      │
│ execution-service (facade — owns routing to state)                   │
│ ├── handleExecutionCommand() (command dispatcher → state store)     │
│ ├── createExecutionReadModel() (read model factory → state store)   │
│ └── getCommandLogStream() (log stream accessor)                     │
│                                                                      │
│ web-server (API layer — owns HTTP concerns only)                    │
│ ├── Transforms API requests into read model queries                 │
│ ├── Transforms API requests into execution-service commands         │
│ └── Streams SSE/WebSocket events to dashboard                       │
│                                                                      │
│ dashboard (UI layer — owns presentation only)                       │
│ ├── React Query (server state cache and invalidation)               │
│ ├── Local state (UI state: selected tab, open drawer, etc.)         │
│ ├── Context (shared state: current project/execution/workspace)     │
│ └── Hooks (data fetching + transformation from API)                │
│                                                                      │
│ NO LAYER OWNS EXECUTION TRUTH EXCEPT EXECUTION RUNTIME              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 15.2 Data Flow Diagram

```
                    ┌─────────────────────────────┐
                    │  Execution Runtime          │
                    │  (coding-agent plan runner) │
                    └──────────┬──────────────────┘
                               │ emits ExecutionEvent
                               ▼
                    ┌─────────────────────────────┐
                    │  State Store                │
                    │  (JsonStateStore/DbStore)   │
                    └──────────┬──────────────────┘
                               │ persists + serves
                               ▼
            ┌──────────────────────────────────────────┐
            │  execution-service                        │
            │  ┌──────────────────┐  ┌───────────────┐  │
            │  │ handleExecCmd()  │  │ getReadModel()│  │
            │  └────────┬─────────┘  └──────┬────────┘  │
            └───────────┼───────────────────┼───────────┘
                        │                   │
                        ▼                   ▼
            ┌──────────────────────────────────────────┐
            │  web-server                               │
            │  ┌──────────────────┐  ┌───────────────┐  │
            │  │ POST endpoints   │  │ GET endpoints │  │
            │  │ (control)        │  │ (read model)  │  │
            │  └────────┬─────────┘  └──────┬────────┘  │
            │           │                    │           │
            │  ┌────────┴─────────┐  ┌──────┴────────┐  │
            │  │ SSE/WebSocket    │  │ REST JSON     │  │
            │  └────────┬─────────┘  └──────┬────────┘  │
            └───────────┼───────────────────┼───────────┘
                        │                   │
                        ▼                   ▼
            ┌──────────────────────────────────────────┐
            │  dashboard                                │
            │  ┌──────────────────┐  ┌───────────────┐  │
            │  │ React Query      │  │ Hooks         │  │
            │  │ (cache/inval)    │  │ (fetch/transform│ │
            │  └────────┬─────────┘  └──────┬────────┘  │
            │           │                    │           │
            │           ▼                    ▼           │
            │  ┌──────────────────────────────────────┐  │
            │  │ Components                           │  │
            │  └──────────────────────────────────────┘  │
            └──────────────────────────────────────────┘
```

### 15.3 React Query Strategy

```typescript
// Query keys (hierarchical for automatic invalidation)
const queryKeys = {
  projects: {
    all: ['projects'] as const,
    detail: (id: string) => ['projects', id] as const,
  },
  tasks: {
    list: (projectId: string) => ['projects', projectId, 'tasks'] as const,
    detail: (projectId: string, taskId: string) => 
      ['projects', projectId, 'tasks', taskId] as const,
  },
  executions: {
    list: (taskId: string) => ['tasks', taskId, 'executions'] as const,
    detail: (taskId: string, runId: string) => 
      ['tasks', taskId, 'executions', runId] as const,
    stats: (runId: string) => ['executions', runId, 'stats'] as const,
  },
  workspaces: {
    list: (runId: string) => ['executions', runId, 'workspaces'] as const,
    detail: (runId: string, wsId: string) => 
      ['executions', runId, 'workspaces', wsId] as const,
    context: (runId: string, wsId: string) => 
      ['executions', runId, 'workspaces', wsId, 'context'] as const,
    commands: (runId: string, wsId: string) => 
      ['executions', runId, 'workspaces', wsId, 'commands'] as const,
  },
  files: {
    tree: (runId: string) => ['executions', runId, 'files'] as const,
    content: (runId: string, path: string) => 
      ['executions', runId, 'files', path] as const,
    diff: (runId: string, path: string) => 
      ['executions', runId, 'files', path, 'diff'] as const,
  },
  escalations: {
    list: (runId: string) => ['executions', runId, 'escalations'] as const,
  },
  validation: {
    status: (runId: string) => ['executions', runId, 'validation'] as const,
  },
};

// Invalidation strategy
function useExecutionEventInvalidation(runId: string) {
  const queryClient = useQueryClient();
  
  // SSE event handler
  const onExecutionEvent = useCallback((event: ExecutionEvent) => {
    // Optimistic: invalidate only affected data
    switch (event.type) {
      case 'plan_completed':
      case 'plan_failed':
      case 'plan_paused':
        queryClient.invalidateQueries({ queryKey: ['executions', runId] });
        break;
      case 'workspace_completed':
      case 'workspace_failed':
      case 'workspace_blocked':
        queryClient.invalidateQueries({ queryKey: ['executions', runId, 'workspaces'] });
        queryClient.invalidateQueries({ queryKey: ['executions', runId, 'stats'] });
        break;
      case 'command_output':
      case 'command_finished':
        // Lightweight: just invalidate command data for the workspace
        if (event.payload.workspaceId) {
          queryClient.invalidateQueries({ 
            queryKey: ['executions', runId, 'workspaces', event.payload.workspaceId, 'commands'] 
          });
        }
        break;
      case 'lead_agent_escalation_initiated':
      case 'lead_agent_escalation_resolved':
        queryClient.invalidateQueries({ queryKey: ['executions', runId, 'escalations'] });
        break;
      default:
        // Fallback: invalidate everything for this execution
        queryClient.invalidateQueries({ queryKey: ['executions', runId] });
    }
  }, [runId, queryClient]);
  
  return { onExecutionEvent };
}
```

### 15.4 Context Providers

```typescript
// Execution context — provides current execution state to all child components
interface ExecutionContextValue {
  projectId: string;
  taskId: string;
  runId: string;
  summary: PlanExecutionSummary;
  stats: PlanExecutionStats;
  workspaces: WorkspaceExecutionSummary[];
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string | null) => void;
  
  // Control actions
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: (workspaceId: string) => Promise<void>;
  sendDirective: (workspaceId: string, directive: string, severity: string) => Promise<void>;
}

// Workspace context — provides current workspace state
interface WorkspaceContextValue {
  workspaceId: string;
  summary: WorkspaceExecutionSummary;
  context: WorkerContextView;
  commands: CommandHistoryView[];
  changedFiles: ChangedFileEntry[];
  fileDiffs: Map<string, FileDiffView>;
  transcript: WorkerTranscriptEvent[];
  validationStatus: FinalValidationView;
  
  // Control actions
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  sendDirective: (directive: string, severity: string) => Promise<void>;
}
```

---

## 16. Read Model API Contract Map

### 16.1 Current Read Model Methods

#### 16.1.1 getPlanSummary()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId
// Returns: PlanExecutionSummary

interface PlanExecutionSummary {
  id: string;                    // UUID
  projectId: string;             // UUID
  phase: string;                 // Phase string from plan
  title: string;                 // Plan title
  status: PlanStatus;            // "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff"
  startedAt: string;             // ISO 8601
  completedAt: string | null;    // ISO 8601 or null
}

// Status: ✅ IMPLEMENTED (real data from state store)
// Used by: Mission Control Hero, Topbar breadcrumb
```

#### 16.1.2 getWorkspaceSummary()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces
// Returns: WorkspaceExecutionSummary[]

interface WorkspaceExecutionSummary {
  id: string;                    // UUID (workspace execution ID)
  planExecutionId: string;       // UUID (run ID)
  workspaceId: string;           // UUID (workspace definition ID)
  stage: WorkspaceExecutionStage; // "Pending" | "Running" | "Complete" | "Failed" | "Blocked" | "Cancelled" | "Skipped" | "Paused" | "TimedOut"
  attempts: number;              // Current attempt number
  startedAt?: string;            // ISO 8601
  completedAt?: string;          // ISO 8601
  error?: string;                // Error message if failed
  reportPath?: string;           // Path to report file
}

// Status: ✅ IMPLEMENTED (real data from state store)
// Used by: Workspace Board, Workspace cards
```

#### 16.1.3 listJournalEvents()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/journal
// Returns: JournalEventEnvelope[]

interface JournalEventEnvelope {
  seq: string;                   // Sequence number
  eventId: string;               // Event UUID
  planExecutionId: string;       // UUID
  workspaceId?: string;          // Workspace UUID (optional)
  eventType: string;             // Event type string
  payload: Record<string, unknown> | null;
  createdAt: string;             // ISO 8601
}

// Status: ✅ IMPLEMENTED (real data from state store, paginated)
// Used by: Priority Feed, raw events debug mode
```

#### 16.1.4 getWorkerContext()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/context
// Returns: WorkerContextView

interface WorkerContextView {
  workspaceId: string;
  planExecutionId: string;
  
  // Workspace state
  stage: string;
  attempts: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  
  // Goal & Role
  goal?: string;
  role?: string;
  
  // Packets
  rolePacketContent?: string;
  contextPacketSummary?: string;
  
  // File access
  allowedFiles: string[];
  touchedFiles: Array<{ path: string; change: "created" | "modified" | "deleted" }>;
  
  // Command history
  lastCommand?: string;
  logSummary?: string;
  
  // Lead Agent state
  activeDirectives: LeadDirectiveView[];
  activeEscalations: LeadEscalationView[];
  humanDirective?: string;
  
  // Transcript link
  transcriptUrl: string;
}

// Status: ✅ IMPLEMENTED (web-server worker-context-routes reads state store + archive)
// Note: Query handler version uses same types but web-server bypasses with direct state store access
// V3: Must consolidate into single implementation through execution-service
// Used by: Workspace Detail, Worker Header, Context panel
```

#### 16.1.5 getChangedFiles()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/files
// Returns: ChangedFileEntry[]

interface ChangedFileEntry {
  path: string;                  // Relative path
  name: string;                  // Basename
  ext: string;                   // Extension (lowercase)
  status: FileChangeStatus;      // "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged"
  additions?: number;            // Lines added
  deletions?: number;            // Lines deleted
  size?: number;                 // File size in bytes
}

// Status: ✅ IMPLEMENTED (extracts from worker_completed journal events)
// Used by: File Tree, File Changes panel
```

#### 16.1.6 getFileTree()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/files
// Returns: FileTreeNode[]

interface FileTreeNode {
  path: string;                  // Relative path
  name: string;                  // File/directory name
  ext: string;                   // Extension ("" for directories)
  status: FileChangeStatus;      // Change status
  isDir: boolean;                // Whether this is a directory
  additions?: number;            // Lines added (aggregated for dirs)
  deletions?: number;            // Lines deleted (aggregated for dirs)
  children?: FileTreeNode[];     // Child nodes (directories only)
}

// Status: ✅ IMPLEMENTED (calls getChangedFiles() then buildFileTreeFromEntries())
// V3: Dashboard must USE this method instead of git commands
// Used by: File Explorer (file tree panel)
```

#### 16.1.7 getCommandHistory()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/commands
// Returns: CommandHistoryView[]

interface CommandHistoryView {
  command: string;               // Command string
  cwd: string;                   // Working directory
  exitCode: number | null;       // Exit code (null if running)
  startedAt: number;             // Timestamp (ms)
  finishedAt: number;            // Timestamp (ms)
  outputSummary?: string;        // Brief output summary
  isTargetCommand?: boolean;     // Whether this is a target/validation command
}

// Status: ❌ STUB — always returns []
// Fix required: State store must expose command history from command events or execution archive
// Used by: Workspace Detail (Command History panel), Logs (Command Timeline)
// P42 priority: HIGH
```

#### 16.1.8 getLeadDirectives()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId/directives
// Returns: LeadDirectiveView[]

interface LeadDirectiveView {
  workspaceId: string;
  directiveId: string;
  directiveType: string;
  attemptNumber: number;
  severity: "low" | "medium" | "high" | "blocking";
  summary: string;
  directive: string;
  allowedActions: string[];
  forbiddenActions: string[];
  retryBudget: number;
  escalateAfter: number;
  status: "issued" | "acknowledged" | "resolved" | "escalated" | "expired";
  escalationOption?: string;
  createdAt: string;             // ISO 8601
}

// Status: ❌ STUB — always returns []
// Fix required: State store must persist and expose lead directive events
// Used by: Workspace Detail (Escalation/Directive panel)
// P42 priority: HIGH
```

#### 16.1.9 getLeadEscalations()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/escalations
// Returns: LeadEscalationView[]

interface LeadEscalationView {
  escalationId: string;
  planExecutionId: string;
  workspaceId: string;
  severity: "low" | "medium" | "high" | "blocking";
  title: string;
  summary: string;
  whatHappened: string;
  whyStuck: string;
  options: Array<{ id: string; label: string; risk: string; description?: string }>;
  recommendedOptionId: string;
  evidenceRefs: string[];
  logsToInspect: string[];
  status: "awaiting_user" | "user_responded" | "resolved" | "expired";
  userChoice?: string;
  userResponse?: string;
  createdAt: string;             // ISO 8601
  resolvedAt?: string;           // ISO 8601
}

// Status: ❌ STUB — always returns []
// Note: web-server human-directive-routes reads state store directly as workaround
// Fix required: State store must persist and expose lead escalation events
// Used by: Escalation Center, Workspace Detail (Escalation panel)
// P42 priority: HIGH
```

#### 16.1.10 getFinalValidationStatus()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/validation
// Returns: FinalValidationView

interface FinalValidationView {
  required: boolean;
  passed: boolean | null;
  blocked: boolean;
  blockReasons: string[];
}

// Status: ❌ STUB — always returns { required: true, passed: null, blocked: false, blockReasons: [] }
// Fix required: State store must expose completion gate state
// Used by: Execution Overview (Validation Status panel), Workspace Detail (Validation Evidence panel)
// P42 priority: MEDIUM
```

#### 16.1.11 getFileContent()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/files/:filePath
// Returns: FileContentView | null

interface FileContentView {
  path: string;                  // Relative path
  content: string | null;        // File content (null for binary)
  base64Content?: string | null; // Base64 for binary files
  isBinary: boolean;             // Whether file is binary
  size: number;                  // File size in bytes
  language?: string;             // Detected programming language
  truncated?: boolean;           // Whether content was truncated
}

// Status: ❌ STUB — always returns null
// Note: web-server file-explorer-routes reads filesystem directly as workaround
// Fix required: Inject filesystem adapter or use snapshot artifact store
// Used by: File Explorer (file content panel)
// P42 priority: MEDIUM
```

#### 16.1.12 getFileDiff()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/files/:filePath/diff
// Returns: FileDiffView[]

interface FileDiffView {
  path: string;                  // Relative path
  status: FileChangeStatus;      // Change status
  diff: string;                  // Unified diff content
  additions: number;             // Lines added
  deletions: number;             // Lines deleted
  truncated?: boolean;           // Whether diff was truncated
}

// Status: ❌ STUB — always returns []
// Note: web-server git-diff endpoint runs git commands directly as workaround
// Fix required: Implement diff computation in read model (git or snapshot comparison)
// Used by: Diff Viewer
// P42 priority: MEDIUM
```

### 16.2 New Read Model Methods Required

The following methods are NOT in the current read model but are needed for V3:

#### 16.2.1 getDependencyGraph()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/dependencies
// Returns: DependencyGraphView

interface DependencyEdge {
  from: string;                  // Workspace UUID (depends on)
  to: string;                    // Workspace UUID (blocked)
  type: "dependency" | "validation" | "resource";
}

interface DependencyGraphView {
  edges: DependencyEdge[];
  workspaces: string[];          // All workspace UUIDs in execution
  batches: string[][];           // Topological batches (for parallelism)
  effectiveParallelism: number;  // Max parallel workspaces
  warnings: string[];            // DAG warnings
  errors: string[];              // DAG errors (e.g., circular dependencies)
}

// Status: 🟡 PARTIAL (batch-plan endpoint exists in web-server but not in read model)
// V3: Must expose through ExecutionReadModel
// Used by: Mission Control Hero (bottleneck), Escalation Center (impact graph)
// P42 priority: LOW (nice to have)
```

#### 16.2.2 getPlanStats()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/stats
// Returns: PlanStatsView

interface PlanStatsView {
  estimatedCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  burnRatePerMin: number;
  cacheHitRate: number;
  cacheHitRateKnown: boolean;
  tokensPerWorkspace: number;
  tokensPerPercent: number;
  progressRatio: number;         // 0.0 to 1.0
}

// Status: ✅ IMPLEMENTED (web-server stats endpoint exists)
// V3: Must move into execution-service read model
// Used by: Metrics Strip
// P42 priority: MEDIUM
```

#### 16.2.3 getActiveEscalationsSummary()

```typescript
// Endpoint: GET /api/projects/:projectId/tasks/:taskId/runs/:runId/escalations/summary
// Returns: EscalationSummaryView

interface EscalationSummaryView {
  totalActive: number;
  bySeverity: { low: number; medium: number; high: number; blocking: number };
  highestSeverity: "low" | "medium" | "high" | "blocking" | null;
  oldestEscalation: LeadEscalationView | null;
  recommendedAction: string;     // Pre-computed next action text
}

// Status: ❌ MISSING
// V3: Must create as composite of getLeadEscalations()
// Used by: Mission Control Hero (next action), Escalation Center (header)
// P42 priority: LOW (nice to have)
```

### 16.3 Read Model Stub Fix Plan

| Method | Fix | Depends On | Effort | Priority |
|---|---|---|---|---|
| `getCommandHistory()` | State store must collect command events into queryable buffer | State store implements command event log | 2-3 days | HIGH |
| `getLeadDirectives()` | State store must persist lead_agent_directive_* events | State store implements directive event log | 1-2 days | HIGH |
| `getLeadEscalations()` | State store must persist lead_agent_escalation_* events | State store implements escalation event log | 1-2 days | HIGH |
| `getFinalValidationStatus()` | State store must expose completion gate state | Completion gate writes state to store | 2-3 days | MEDIUM |
| `getFileContent()` | Add filesystem adapter or snapshot store integration | Snapshot store capture during execution | 2-3 days | MEDIUM |
| `getFileDiff()` | Add git diff adapter or snapshot comparison | Snapshot store pre/post capture | 2-3 days | MEDIUM |

---

## 17. Event Type Catalog

### 17.1 All Event Types

| # | Event Type | Category | Payload Interface | Producer | Consumer | Persistent? |
|---|---|---|---|---|---|---|
| 1 | `plan_started` | Plan | `PlanStartedPayload` | Plan runner | Execution Overview | ✅ State store |
| 2 | `plan_completed` | Plan | `PlanCompletedPayload` | Plan runner | Execution Overview | ✅ State store |
| 3 | `plan_failed` | Plan | `PlanFailedPayload` | Plan runner | Execution Overview | ✅ State store |
| 4 | `plan_paused` | Plan | `PlanPausedPayload` | Plan runner/control | Execution Overview | ✅ State store |
| 5 | `plan_resumed` | Plan | `PlanResumedPayload` | Plan runner/control | Execution Overview | ✅ State store |
| 6 | `plan_cancelled` | Plan | `PlanCancelledPayload` | Plan runner/control | Execution Overview | ✅ State store |
| 7 | `plan_stopped` | Plan | `PlanStoppedPayload` | Plan runner/control | Execution Overview | ✅ State store |
| 8 | `workspace_pending` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 9 | `workspace_running` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 10 | `workspace_completed` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 11 | `workspace_failed` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 12 | `workspace_blocked` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 13 | `workspace_cancelled` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 14 | `workspace_skipped` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 15 | `workspace_paused` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 16 | `workspace_timed_out` | Workspace | `WorkspaceStageChangedPayload` | Transition router | Workspace Board | ✅ State store |
| 17 | `worker_started` | Worker | `WorkerStartedPayload` | Worker adapter | Workspace Detail | ✅ State store |
| 18 | `worker_completed` | Worker | `WorkerCompletedPayload` | Worker adapter | Workspace Detail, File Tree | ✅ State store |
| 19 | `worker_failed` | Worker | `WorkerFailedPayload` | Worker adapter | Workspace Detail | ✅ State store |
| 20 | `worker_timed_out` | Worker | `WorkerTimedOutPayload` | Worker adapter | Workspace Detail | ✅ State store |
| 21 | `worker_cancelled` | Worker | `WorkerCancelledPayload` | Worker adapter | Workspace Detail | ✅ State store |
| 22 | `command_started` | Command | `CommandStartedPayload` | Command executor | Logs, Command History | ✅ State store |
| 23 | `command_finished` | Command | `CommandFinishedPayload` | Command executor | Logs, Command History | ✅ State store |
| 24 | `command_output` | Command | `CommandOutputPayload` | Command executor | Live Logs | ✅ ICommandLogStream (in-memory) |
| 25 | `brain_proposed` | Brain | `BrainProposedPayload` | Brain (Lead Agent) | Brain Inbox | ✅ State store |
| 26 | `brain_approved` | Brain | `BrainApprovedPayload` | Brain/User | Brain Inbox | ✅ State store |
| 27 | `brain_rejected` | Brain | `BrainRejectedPayload` | Brain/User | Brain Inbox | ✅ State store |
| 28 | `governance_check_started` | Governance | `GovernanceCheckStartedPayload` | Completion gate | Validation panels | ✅ State store |
| 29 | `governance_approved` | Governance | `GovernanceApprovedPayload` | Completion gate | Validation panels | ✅ State store |
| 30 | `governance_rejected` | Governance | `GovernanceRejectedPayload` | Completion gate | Validation panels | ✅ State store |
| 31 | `governance_escalated` | Governance | `GovernanceEscalatedPayload` | Completion gate | Validation panels | ✅ State store |
| 32 | `lead_agent_review_started` | Lead Agent | `LeadAgentReviewStartedPayload` | Lead Agent | Escalation Center | ✅ State store |
| 33 | `lead_agent_directive_issued` | Lead Agent | `LeadAgentDirectiveIssuedPayload` | Lead Agent | Escalation Center, Workspace Detail | ✅ State store |
| 34 | `lead_agent_directive_acknowledged` | Lead Agent | `LeadAgentDirectiveAcknowledgedPayload` | Worker agent | Escalation Center | ✅ State store |
| 35 | `lead_agent_escalation_initiated` | Lead Agent | `LeadAgentEscalationInitiatedPayload` | Lead Agent | Escalation Center | ✅ State store |
| 36 | `lead_agent_escalation_resolved` | Lead Agent | `LeadAgentEscalationResolvedPayload` | User via resolve action | Escalation Center | ✅ State store |
| 37 | `human_directive_issued` | Human | `HumanDirectiveIssuedPayload` | Human via directive endpoint | Workspace Detail | ✅ State store |
| 38 | `human_directive_acknowledged` | Human | `HumanDirectiveAcknowledgedPayload` | Worker agent | Workspace Detail | ✅ State store |
| 39 | `human_intervention_requested` | Human | `HumanInterventionRequestedPayload` | Human via intervene endpoint | Workspace Detail | ✅ State store |
| 40 | `system_error` | System | `SystemErrorPayload` | Any system component | Event feed | ✅ State store |
| 41 | `system_warning` | System | `SystemWarningPayload` | Any system component | Event feed | ✅ State store |
| 42 | `system_info` | System | `SystemInfoPayload` | Any system component | Event feed | ✅ State store |

### 17.2 Event Flow by Component

| Component | Listens to Events | Via | Purpose |
|---|---|---|---|
| Execution Overview | `plan_*`, `workspace_*`, `lead_agent_escalation_initiated` | SSE endpoint | Update hero state, metrics, priority feed |
| Workspace Board | `workspace_*`, `worker_*` | SSE endpoint | Update workspace cards |
| Workspace Detail | `worker_*`, `command_*`, `command_output` | SSE endpoint + WebSocket | Update worker state, command history, transcript |
| File Explorer | `worker_completed` (changedFiles) | SSE endpoint | Update file tree |
| Logs | `command_*`, `command_output` | SSE endpoint + WebSocket | Update command timeline |
| Escalation Center | `lead_agent_*`, `human_*` | SSE endpoint | Update escalation cards |

---

## 18. Component Architecture

### 18.1 Proposed Folder Structure

```
packages/web-ui/dashboard/src/
│
├── app/
│   ├── App.tsx                     (thin shell — <100 lines)
│   ├── AppShell.tsx                (Topbar + LeftSidebar + Center + RightDrawer + StatusBar)
│   ├── routes.tsx                  (Route definitions with guards)
│   └── providers.tsx               (QueryClient, Theme, ExecutionContext, etc.)
│
├── components/
│   ├── primitives/
│   │   ├── Button.tsx              (shadcn-based)
│   │   ├── Card.tsx                (shadcn-based)
│   │   ├── Badge.tsx               (StatusBadge replacement)
│   │   ├── Modal.tsx               (ConfirmationDialog, Dialog)
│   │   ├── Drawer.tsx              (ContextualDrawer)
│   │   ├── Tabs.tsx                (Tab bar component)
│   │   ├── Dropdown.tsx            (Menu dropdown)
│   │   ├── Tooltip.tsx             (Tooltip component)
│   │   ├── Toast.tsx               (Toast notification)
│   │   ├── Skeleton.tsx           (Loading skeleton)
│   │   └── EmptyState.tsx          (Empty state with message + action)
│   │
│   ├── shell/
│   │   ├── Topbar.tsx              (Breadcrumb, health pill, dropdown menus, search)
│   │   ├── LeftSidebar.tsx         (Task tree, quick actions)
│   │   ├── StatusBar.tsx           (Execution status, metrics)
│   │   └── RightDrawer.tsx         (Contextual drawer)
│   │
│   ├── navigation/
│   │   ├── TaskRunTree.tsx         (Project → Task → Run tree)
│   │   ├── BrainNavGroup.tsx       (Brain pages group)
│   │   ├── PlatformNavGroup.tsx    (Platform pages group)
│   │   ├── SidebarNode.tsx         (Single tree node)
│   │   └── CommandPalette.tsx      (Cmd/Ctrl+K search/action palette)
│   │
│   ├── execution/
│   │   ├── MissionControlHero.tsx  (Hero state, tone, actions)
│   │   ├── MetricsStrip.tsx        (Progress, cost, tokens, burn rate)
│   │   ├── WorkspacePreview.tsx    (Compact workspace card grid)
│   │   ├── PriorityFeed.tsx        (Attention/Active/Recent events)
│   │   ├── NextActionCard.tsx      (Recommended next action)
│   │   └── WorkspaceSummary.tsx    (Aggregated workspace stats)
│   │
│   ├── workspaces/
│   │   ├── WorkspaceBoard.tsx      (Grouped workspace cards)
│   │   ├── WorkspaceGroup.tsx      (Single status group)
│   │   ├── WorkspaceCard.tsx       (Single workspace card)
│   │   └── WorkspaceBoardEmpty.tsx (Empty state for board)
│   │
│   ├── workspace-detail/
│   │   ├── WorkspaceDetailPage.tsx (Main workspace detail page)
│   │   ├── WorkspaceHeader.tsx     (Workspace ID, status, controls)
│   │   ├── CurrentState.tsx        (Phase, command, heartbeat, goal)
│   │   ├── ContextSummary.tsx      (Prompt, allowed/touched files)
│   │   ├── CommandHistory.tsx      (Command table)
│   │   ├── WorkspaceFiles.tsx      (File changes with diff links)
│   │   ├── WorkspaceTranscript.tsx (Transcript event list)
│   │   ├── ValidationEvidence.tsx  (Validation results)
│   │   ├── AttemptHistory.tsx      (Attempt list)
│   │   └── EscalationPanel.tsx     (Active escalations, directives)
│   │
│   ├── files/
│   │   ├── ExecutionFileTree.tsx   (Execution-aware file tree)
│   │   ├── FileDiffView.tsx        (Unified diff with syntax highlight)
│   │   ├── FilePreview.tsx         (File content preview)
│   │   └── FileEvidencePanel.tsx   (Related workspace, command, validation)
│   │
│   ├── logs/
│   │   ├── CommandTimeline.tsx     (Command list with status icons)
│   │   ├── CommandDetail.tsx       (Full command output + metadata)
│   │   ├── LogFilters.tsx          (Workspace, command, status filters)
│   │   └── RawLogView.tsx          (Raw terminal output)
│   │
│   └── escalations/
│       ├── EscalationCenter.tsx     (Main escalation page)
│       ├── EscalationCard.tsx       (Single escalation with actions)
│       ├── DeadlockDependencies.tsx (Dependency graph visualization)
│       ├── HumanDirectiveBox.tsx    (Directive input form)
│       └── EscalationEmpty.tsx      (Empty state)
│
├── hooks/
│   ├── useExecutionSummary.ts      (Plan summary + stats)
│   ├── useWorkpaces.ts            (Workspace list + board data)
│   ├── useWorkspaceDetail.ts      (Workspace + context + commands)
│   ├── useExecutionFiles.ts       (File tree + status)
│   ├── useFileDiff.ts             (File diff for single file)
│   ├── useCommandTimeline.ts      (All commands for run)
│   ├── useEscalations.ts          (Escalation list + details)
│   ├── useControlActions.ts       (Control action dispatch + state)
│   ├── usePriorityFeed.ts         (Filtered event feed)
│   ├── useCommandPalette.ts       (Command palette state + actions)
│   └── useKeyboardShortcuts.ts    (Global keyboard shortcut handler)
│
├── contexts/
│   ├── ProjectContext.tsx          (Current project ID)
│   ├── ExecutionContext.tsx        (Current execution + workspaces + controls)
│   └── WorkspaceContext.tsx        (Current workspace + context + controls)
│
├── api/
│   ├── executionClient.ts         (Execution read + command API calls)
│   ├── brainClient.ts             (Brain API calls)
│   └── platformClient.ts          (Platform/settings API calls)
│
├── types/
│   ├── execution.ts               (Execution types)
│   ├── workspace.ts               (Workspace types)
│   └── events.ts                  (Event types)
│
├── utils/
│   ├── format.ts                  (Format cost, tokens, percent, time)
│   ├── date.ts                    (Relative time, duration formatting)
│   └── constants.ts               (Style tokens, status colors, etc.)
│
└── features/                       (Legacy features, migrated one by one)
    ├── brain/
    ├── platform/
    └── ...
```

### 18.2 Component Decomposition Plan

| Current Component | Lines | Action | New Components | Reason |
|---|---|---|---|---|
| `App.tsx` | 1364 | Split | `App.tsx`, `AppShell.tsx`, `routes.tsx`, `providers.tsx` | Monolithic shell |
| `ObservabilityCockpit.tsx` | 400+ | Split | `PerformanceMetrics.tsx`, `ResourceUsage.tsx`, `Timeline.tsx` | Single responsibility |
| `LeadAgentDashboard.tsx` | 400+ | Split | `LeadAgentStatus.tsx`, `DirectiveHistory.tsx`, `EscalationHistory.tsx` | Single responsibility |
| `BatchOSDashboard.tsx` | 300+ | Split | `BatchOverview.tsx`, `BatchTimeline.tsx`, `BatchControls.tsx` | Single responsibility |
| `WorkerDetail.tsx` | 300+ | Split | See 9 sub-components in `workspace-detail/` | Single responsibility |
| `CockpitPanels.tsx` | 200+ | Migrate | Distributed into `execution/` sub-components | Temporary container |
| `FileExplorer.tsx` | 300+ | Refactor | `ExecutionFileTree.tsx`, `FilePreview.tsx` | Must use read model |
| `DiffViewer.tsx` | 200+ | Refactor | `FileDiffView.tsx`, `FileEvidencePanel.tsx` | Must use read model |
| `ExecutionLogViewer.tsx` | 200+ | Refactor | Absorbed into `logs/` components | Single responsibility |
| `ForceKillDialog.tsx` | 80+ | Migrate | Absorbed into `Modal.tsx` confirmation pattern | No validation logic |
| `ControlButtons.tsx` | 100+ | Deprecate | Replaced by contextual controls in Topbar + WorkspaceDetail | Legacy |
| `Header.tsx` | 200+ | Deprecate | Replaced by `Topbar.tsx` | Legacy |
| `WorkerList.tsx` | 100+ | Deprecate | Replaced by `WorkspaceBoard.tsx` | Legacy |
| `LogViewer.tsx` | 150+ | Deprecate | Replaced by `CommandTimeline.tsx` + `RawLogView.tsx` | Legacy |
| `QueuePanel.tsx` | 100+ | Deprecate | Merged into Execution Overview | Duplicate |
| `PlanSummary.tsx` | 100+ | Deprecate | Merged into Execution Overview | Duplicate |
| `EventFeed.tsx` | 200+ | Deprecate | Replaced by `PriorityFeed.tsx` | Duplicate |

### 18.3 Component Prop Interfaces

```typescript
// Example: WorkspaceCard
interface WorkspaceCardProps {
  workspace: WorkspaceCardData;
  onSelect: (workspaceId: string) => void;
  onRetry: (workspaceId: string) => void;
  onSendDirective: (workspaceId: string) => void;
}

interface WorkspaceCardData {
  id: string;
  status: WorkspaceExecutionStage;
  phase?: string;
  currentCommand?: string;
  currentCommandDuration?: number;
  retryCount: number;
  maxRetries: number;
  lastHeartbeat?: number;        // timestamp
  touchedFilesCount: number;
  blocks: string[];               // workspace IDs blocked by this workspace
  blockedBy: string[];            // workspace IDs blocking this workspace
  model?: string;
  provider?: string;
}

// Example: MissionControlHero
interface MissionControlHeroProps {
  planStatus: PlanStatus;
  activeWorkerCount: number;
  blockedWorkerCount: number;
  estimatedTimeRemaining?: number; // minutes
  lastHeartbeat?: number;          // timestamp
  hasActiveEscalations: boolean;
  onOpenBottleneck: () => void;
  onSendDirective: () => void;
  onViewEvidence: () => void;
}

// Example: CommandTimeline
interface CommandTimelineProps {
  runId: string;
  workspaceFilter?: string;
  commandFilter?: string;
  statusFilter?: CommandStatus;
  targetCommandsOnly?: boolean;
  onCommandSelect: (commandId: string) => void;
}

type CommandStatus = 'running' | 'done' | 'failed' | 'all';

// Example: EscalationCard
interface EscalationCardProps {
  escalation: LeadEscalationView;
  dependencyImpact: string[];
  onResolve: (escalationId: string, optionId: string) => void;
  onSendDirective: (workspaceId: string) => void;
  onSkip: (workspaceId: string) => void;
}
```

---

## 19. Accessibility and Keyboard UX

### 19.1 Keyboard Shortcuts

| Shortcut | Action | Scope | Context Required |
|---|---|---|---|
| `Cmd/Ctrl + K` | Open command palette | Global | None |
| `Cmd/Ctrl + /` | Focus search bar | Global | None |
| `Cmd/Ctrl + .` | Toggle right drawer | Global | Execution view |
| `Cmd/Ctrl + ,` | Open settings | Global | None |
| `Escape` | Close dialog/drawer/palette | Modal | Dialog/drawer/palette open |
| `1` | Switch to Overview tab | Tab bar | Execution view |
| `2` | Switch to Workspaces tab | Tab bar | Execution view |
| `3` | Switch to Files tab | Tab bar | Execution view |
| `4` | Switch to Logs tab | Tab bar | Execution view |
| `5` | Switch to Escalations tab | Tab bar | Execution view |
| `←`/`→` | Previous/next workspace | Workspace board | Workspace selected |
| `↑`/`↓` | Navigate workspace list | Workspace board | Workspace board active |
| `P` | Pause execution | Execution | Execution selected |
| `S` | Stop execution | Execution | Execution selected + confirmation |
| `R` | Retry workspace | Workspace detail | Workspace selected |
| `C` | Cancel workspace | Workspace detail | Workspace selected + confirmation |
| `D` | Send directive to workspace | Workspace detail | Workspace selected |
| `B` | Open blocked workspaces (Escalation Center) | Tab bar | Execution view |
| `F` | Open Files tab | Tab bar | Execution view |
| `L` | Open Logs tab | Tab bar | Execution view |
| `E` | Open Escalations tab | Tab bar | Execution view |
| `T` | Open transcript for workspace | Workspace detail | Workspace selected |
| `V` | Rerun validation | Workspace detail | Workspace selected |
| `A` | Open artifact browser | Tab bar | Execution view |
| `/` | Focus filter/search input | Per-panel | Panel with search |

### 19.2 ARIA Roles and Labels

| Component | ARIA Role | ARIA Label | Live Region |
|---|---|---|---|
| Topbar | `banner` | "Top navigation" | No |
| Left sidebar | `navigation` | "Project navigation" | No |
| Center column | `main` | "Execution workspace" | No |
| Right drawer | `complementary` | "Context information" | No |
| Status bar | `status` | "Execution status" | `polite` |
| Mission Control Hero | `region` | "Execution overview" | `polite` |
| Workspace Board | `region` | "Workspaces" | No |
| Workspace card | `article` | `Workspace ${id}` | No |
| Priority Feed | `region` | "Priority events" | `polite` |
| Command Timeline | `region` | "Command timeline" | `polite` |
| Escalation Card | `article` | `Escalation for ${workspaceId}` | No |
| File Tree | `tree` | "File tree" | No |
| Diff View | `region` | "File diff" | No |

### 19.3 Focus Management

```typescript
// Focus trap hook for dialogs and drawers
function useFocusTrap(containerRef: RefObject<HTMLElement>, isActive: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  
  useEffect(() => {
    if (!isActive) {
      // Restore focus when dialog/drawer closes
      previousFocusRef.current?.focus();
      return;
    }
    
    // Store currently focused element
    previousFocusRef.current = document.activeElement as HTMLElement;
    
    // Focus first focusable element
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const container = containerRef.current;
    if (!container) return;
    
    const firstFocusable = container.querySelector(focusableSelector) as HTMLElement;
    firstFocusable?.focus();
    
    // Trap focus
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      const focusableElements = container.querySelectorAll(focusableSelector);
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, containerRef]);
}
```

### 19.4 Color Contrast

```css
/* WCAG AA Compliance */

:root {
  /* Light mode */
  --color-text: #1C1917;            /* stone-900 — 15.7:1 on white */
  --color-text-secondary: #57534E;  /* stone-600 — 8.3:1 on white */
  --color-text-muted: #78716C;      /* stone-500 — 6.4:1 on white */
  --color-text-inverse: #FFFFFF;
  --color-background: #FFFFFF;
  --color-surface: #F5F5F4;        /* stone-100 */
  --color-border: #D6D3D1;         /* stone-300 */
  --color-accent: #2563EB;         /* blue-600 — 6.8:1 on white */
  --color-danger: #DC2626;         /* red-600 — 5.6:1 on white */
  --color-success: #16A34A;        /* green-600 — 5.9:1 on white */
  --color-warning: #D97706;        /* amber-600 — 5.4:1 on white */
}

.dark {
  --color-text: #E7E5E4;           /* stone-200 — 14.1:1 on #1E1E1E */
  --color-text-secondary: #A8A29E; /* stone-400 — 7.2:1 on #1E1E1E */
  --color-text-muted: #78716C;     /* stone-500 — 4.6:1 on #1E1E1E */
  --color-text-inverse: #1C1917;
  --color-background: #161616;
  --color-surface: #1E1E1E;
  --color-border: #333333;
  --color-accent: #60A5FA;         /* blue-400 — 7.1:1 on #1E1E1E */
  --color-danger: #F87171;         /* red-400 — 6.9:1 on #1E1E1E */
  --color-success: #4ADE80;         /* green-400 — 7.3:1 on #1E1E1E */
  --color-warning: #FBBF24;        /* amber-400 — 6.5:1 on #1E1E1E */
}
```

### 19.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  
  /* Keep heartbeat ping visible but static */
  .status-ping {
    animation: none !important;
    opacity: 1 !important;
  }
}
```

---

## 20. Component State Machines

### 20.1 Generic Component States

Every component should handle these states:

```
[loading] → [empty] → [data] → [refreshing]
    ↓          ↓         ↓
 [error]    [error]   [error]
```

### 20.2 MissionControlHero States

```
┌─────────────────────────────────────────────────────────────────────┐
│ MISSION CONTROL HERO STATE MACHINE                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  loading ──────→ onTrack ──────→ blocked ──────→ failed            │
│    │                 │               │               │              │
│    │                 ▼               ▼               ▼              │
│    │            stalled ──────→ paused ──────→ complete            │
│    │               │               ▼               │                │
│    │               ▼          stopped              │                │
│    │            timeCritical    │                   │                │
│    │               │           ▼                    │                │
│    └──── any state ←─────── error ←────────────────┘               │
│                                                                      │
│ State transitions:                                                   │
│   onTrack: Running, no blocked workspaces, heartbeat < 30s          │
│   blocked: Running, any workspace blocked                           │
│   stalled: Running, any workspace heartbeat > 30s                   │
│   failed: Plan failed                                                 │
│   paused: Plan paused                                                 │
│   stopped: Plan stopped                                               │
│   complete: Plan completed successfully                              │
│   timeCritical: Running, estimated time remaining > budget          │
│   error: API error, connection lost                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 20.3 WorkspaceCard States

```
┌─────────────────────────────────────────────────────────────────────┐
│ WORKSPACE CARD STATE MACHINE                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  loading ──────→ pending ──────→ running ──────→ complete          │
│    │                 │               │               │              │
│    │                 ▼               ▼               │              │
│    │            ready ──────→ blocked ──────→ failed               │
│    │                 │               │               │              │
│    │                 ▼               ▼               ▼              │
│    └──── any state ←─────── cancelled ←────────────────┘           │
│                                       │                             │
│                                       ▼                             │
│                                    timedOut                         │
│                                                                      │
│ Card actions available per state:                                    │
│   pending/ready: [Cancel]                                            │
│   running: [Pause] [Stop]                                            │
│   blocked: [View Detail] [Send Directive]                           │
│   failed: [Retry] [View Detail] [Send Directive]                    │
│   complete: [View Detail]                                            │
│   cancelled/timedOut: [Retry] [View Detail]                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 20.4 ControlAction Confirmation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ CONTROL ACTION CONFIRMATION FLOW                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  idle ──── user clicks dangerous action ──────> showingConfirm      │
│   ↑                                            │                   │
│   │                                            ▼                   │
│   │                                    user reviews impact          │
│   │                                            │                   │
│   │                                   ┌────────┼────────┐          │
│   │                                   │        │        │          │
│   │                                   ▼        ▼        ▼          │
│   │                              confirm  cancel   editReason      │
│   │                                   │        │        │          │
│   │                                   ▼        │        ▼          │
│   │                              executing ────┘   showingConfirm  │
│   │                                   │                          │
│   │                                   │                          │
│   │                          ┌────────┼────────┐                  │
│   │                          │        │        │                  │
│   │                          ▼        ▼        ▼                  │
│   │                       success  error   timeout                │
│   │                          │        │        │                  │
│   └──────────────────────────┴────────┴────────┘                  │
│                                                                    │
│ Confirmation dialog content per action:                            │
│   Stop: "This will stop {workspaceId}. Partial results from        │
│          attempt {N} will be preserved."                           │
│   Cancel: "This will cancel {workspaceId}. No results will be     │
│            preserved."                                              │
│   Force Kill: "This will forcefully terminate all workers.         │
│                Unsaved changes may be lost. Type KILL to confirm." │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 21. Frontend Skill Usage

| Skill | Use Case | When to Use | When NOT to Use |
|---|---|---|---|
| **shadcn** | Component primitives (Button, Card, Modal, Dropdown, Tabs, Tooltip, Toast) | All component creation | Don't use as a substitute for domain component design |
| **web-design-guidelines** | Layout, accessibility, empty/loading/error states, forms | Every new component | Don't override for custom design |
| **vercel-composition-patterns** | Component decomposition, render props, compound components | Complex panels with multiple sub-components | Don't over-abstract simple components |
| **vercel-react-best-practices** | State/effects, performance optimization, React patterns | After component implementation, during review | Don't use as a design-time substitute |
| **react-doctor** | Final audit: lint, a11y, bundle, architecture | After Phase 6 implementation | Don't use as a replacement for design thinking |
| **deploy-to-vercel** | Deployment | Never (not relevant for P42) | — |
| **vercel-cli-with-tokens** | CLI tokens | Never (not relevant for P42) | — |
| **vercel-react-native-skills** | React Native | Never (web dashboard only) | — |

### 21.1 shadcn Component Mapping

| Dashboard Component | shadcn Base | Customizations |
|---|---|---|
| `Button` | `Button` | Add danger variant, loading state |
| `Card` | `Card` | Add interactive variant, compact variant |
| `Badge` | `Badge` | Add status colors (green/amber/red/blue/gray) |
| `Modal` | `Dialog` | Add confirmation variant, impact summary |
| `Drawer` | `Sheet` | Add context panel variant |
| `Tabs` | `Tabs` | Add icon variant |
| `Dropdown` | `DropdownMenu` | Standard |
| `Tooltip` | `Tooltip` | Standard |
| `Toast` | `Toast` | Add action variant, undo support |
| `Skeleton` | `Skeleton` | Add panel variant |
| `CommandPalette` | `Command` | Add context-aware actions |

---

## 22. Testing Strategy

### 22.1 Test Pyramid

```
┌──────────────────────────────────────────────────────────────────────┐
│ E2E Tests (Playwright)                                                │
│ 10-15 critical user flows                                             │
├──────────────────────────────────────────────────────────────────────┤
│ Integration Tests (React Testing Library)                             │
│ 40-60 component/hook tests with mocked API                            │
├──────────────────────────────────────────────────────────────────────┤
│ Unit Tests (Vitest)                                                    │
│ 80-100 utility/hook/state tests                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 22.2 E2E Test Scenarios (Playwright)

| # | Scenario | Steps | Assertions |
|---|---|---|---|
| 1 | **Execution Overview loads** | Navigate to execution route → Wait for data | Hero shows correct status, workspace cards render, metrics display |
| 2 | **Workspace Board groups correctly** | Navigate to Workspaces tab | Workspaces grouped by status (Running, Blocked, Ready, etc.) |
| 3 | **Workspace Detail opens** | Click workspace card → Navigate to detail route | Header shows workspace ID, status, controls; panels render |
| 4 | **File Tree renders** | Navigate to Files tab | File tree shows files with status colors; clicking file shows content |
| 5 | **Diff Viewer shows unified diff** | Click file with changes → Click "View Diff" | Unified diff renders with +/ - lines; syntax highlighting works |
| 6 | **Command Timeline shows commands** | Navigate to Logs tab | Commands listed with workspace, duration, exit code, status |
| 7 | **Command Detail opens** | Click command in timeline | stdout/stderr sections render; metadata shows; links work |
| 8 | **Escalation Center shows escalations** | Navigate to Escalations tab | Escalation cards render with severity, root cause, recommended actions |
| 9 | **Control Action: Pause** | Click Pause button → No confirmation needed | Toast appears "Execution paused"; button changes to Resume |
| 10 | **Control Action: Stop (with confirmation)** | Click Stop button → Confirm dialog → Confirm | Confirmation dialog appears; impact summary shown; on confirm, toast appears |
| 11 | **Control Action: Cancel workspace (with confirmation)** | Select workspace → Click Cancel → Confirm | Confirmation appears; on confirm, workspace status changes |
| 12 | **Send Directive to workspace** | Select workspace → Click Send Directive → Enter text → Send | Toast appears; directive appears in workspace detail |
| 13 | **Command Palette opens** | Press Cmd/Ctrl+K | Command palette opens; typing filters commands; selecting executes action |
| 14 | **Keyboard shortcut: Tab switching** | Press 1/2/3/4/5 | Tab switches to Overview/Workspaces/Files/Logs/Escalations |
| 15 | **Keyboard shortcut: Workspace navigation** | Press ↑/↓ in workspace board | Selection moves between workspaces |
| 16 | **Empty state renders correctly** | Navigate to execution with no workspaces | Workspace Board shows "No workspaces" empty state; Suggested action button present |
| 17 | **Error state renders correctly** | Mock API failure → Navigate to execution | Error banner appears with retry button |
| 18 | **Accessibility: Tab navigation** | Tab through interactive elements | Focus moves in logical order; focus indicators visible; skip-link present |

### 22.3 Integration Test Scenarios (RTL)

| # | Component/ Hook | Scenario | Mocks | Assertions |
|---|---|---|---|---|
| 1 | `MissionControlHero` | Renders onTrack state | `useExecutionSummary` → healthy data | Hero shows "on track" message, 3 active workers |
| 2 | `MissionControlHero` | Renders blocked state | `useExecutionSummary` → blocked workspaces | Hero shows "blocked" message, 2 blocked workers |
| 3 | `MissionControlHero` | Renders failed state | `useExecutionSummary` → failed plan | Hero shows "Failed" message, red color |
| 4 | `WorkspaceCard` | Renders running workspace | Mock workspace data | Status badge shows Running, current command shows, retry count visible |
| 5 | `WorkspaceCard` | Click triggers navigation | Mock `onSelect` | `onSelect` called with workspace ID |
| 6 | `WorkspaceBoard` | Groups workspaces correctly | Mock workspace list | Running group has N items, Blocked group has M items |
| 7 | `CommandTimeline` | Renders command list | Mock command data | Each command row shows workspace, command, duration, exit code |
| 8 | `CommandDetail` | Renders command output | Mock stdout/stderr | stdout section shows text, stderr section shows text |
| 9 | `EscalationCard` | Renders escalation with recommended actions | Mock escalation data | Severity badge correct, root cause visible, recommended action buttons |
| 10 | `ExecutionFileTree` | Renders file tree from read model | `useExecutionFiles` → file tree data | Files shown with correct status icons; clicking file triggers content load |
| 11 | `FileDiffView` | Renders unified diff | `useFileDiff` → diff data | Lines with +/- highlighted; additions/deletions counts correct |
| 12 | `useControlActions` | Dispatches pause action | Mock fetch | POST called with correct endpoint and body |
| 13 | `useControlActions` | Dispatches stop action with confirmation | Mock fetch | Confirmation dialog shown; on confirm, POST called |
| 14 | `PriorityFeed` | Filters events correctly | Mock event list | Attention section shows high-severity events; Active shows running events |
| 15 | `CommandPalette` | Filters commands by search | Mock command list | Typing "pause" shows only pause-related commands |

### 22.4 Fake Data Detection Tests

```typescript
// Test: No component renders fake/static data
test('ExecutionOverview does not contain fake data', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ExecutionOverview projectId="test-project" taskId="test-task" runId="test-run" />
    </QueryClientProvider>
  );
  
  // Wait for data to load
  await waitFor(() => {
    expect(screen.getByTestId('mission-hero')).toBeInTheDocument();
  });
  
  // Assert no hardcoded values (indicators of fake/static data)
  expect(screen.queryByText('Sample Plan')).not.toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  expect(screen.queryByText('0/0 workspaces')).not.toBeInTheDocument();
  expect(screen.queryByText('TBD')).not.toBeInTheDocument();
  expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  expect(screen.queryByText('Lorem ipsum')).not.toBeInTheDocument();
});

// Test: Component uses read model, not git/filesystem
test('FileExplorer uses ExecutionReadModel.getFileTree()', async () => {
  const mockGetFileTree = vi.fn().mockResolvedValue(mockFileTreeData);
  vi.spyOn(executionClient, 'getFileTree').mockImplementation(mockGetFileTree);
  
  render(
    <QueryClientProvider client={queryClient}>
      <ExecutionFileTree projectId="test" taskId="test" runId="test" />
    </QueryClientProvider>
  );
  
  await waitFor(() => {
    expect(mockGetFileTree).toHaveBeenCalledWith('test', 'test', 'test');
  });
  
  // Assert no git-related strings in component
  const treeContainer = screen.getByTestId('file-tree');
  expect(treeContainer.textContent).not.toContain('git');
  expect(treeContainer.textContent).not.toContain('diff');
});

// Test: Read model stub detection
test('WorkspaceDetail does not use stub read model methods', async () => {
  // If getCommandHistory is still a stub, this test will catch it
  vi.spyOn(executionClient, 'getCommandHistory').mockImplementation(
    () => Promise.resolve([]) // Stub returns empty array
  );
  
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceDetailPage projectId="test" taskId="test" runId="test" workspaceId="ws-1" />
    </QueryClientProvider>
  );
  
  await waitFor(() => {
    // Command history panel should show empty state, not "No commands" generic message
    expect(screen.getByTestId('command-history-panel')).toBeInTheDocument();
    // If stub returns [], the panel should show an explicit "no commands" state
    expect(screen.getByTestId('command-history-empty')).toBeInTheDocument();
  });
});
```

---

## 23. Migration Plan

### 23.1 Phase Overview

| Phase | Title | Weeks | Dependencies | Risk |
|---|---|---|---|---|
| 1 | Shell and Navigation Cleanup | 2 | None (read model stubs can be parallel) | LOW |
| 2 | Mission Control / Execution Cockpit | 2 | Phase 1 | MEDIUM |
| 3 | Workspace Board and Detail Route | 2 | Phase 1 + read model stubs (WS-1) | HIGH |
| 4 | Files/Diff and Logs/Command Timeline | 2 | Phase 1 + read model stubs (WS-1) | HIGH |
| 5 | Escalation Center | 2 | Phase 3 + unified control path (WS-2) | MEDIUM |
| 6 | Brain/Platform Regrouping | 1 | Phase 1 | LOW |
| 7 | QA, A11y, React Doctor Audit | 1 | All previous phases | LOW |

### 23.2 Phase 1: Shell and Navigation Cleanup (Week 1-2)

**Goal:** Replace the old 3-tab sidebar with a task/run tree; create AppShell; remove permanent right sidebar.

**Tasks:**
1. Create `AppShell.tsx` — top-level layout container
2. Create `Topbar.tsx` — breadcrumb, health pill, dropdown menus, search icon
3. Create `LeftSidebar.tsx` — task/run tree, quick actions
4. Create `StatusBar.tsx` — execution status, metrics
5. Create `RightDrawer.tsx` — contextual drawer (collapsed by default)
6. Refactor `App.tsx` from 1364 lines to <100 lines (Shell + Router + Providers)
7. Replace old sidebar tabs (Browse/Queue/Chat) with task/run tree
8. Remove permanent right sidebar
9. Keep old routes reachable during migration (parallel routes)

**Files to create/modify:**
- `app/AppShell.tsx` (NEW)
- `app/Topbar.tsx` (NEW)
- `app/LeftSidebar.tsx` (NEW)
- `app/StatusBar.tsx` (NEW)
- `app/RightDrawer.tsx` (NEW)
- `app/App.tsx` (MODIFY — thin shell)
- `app/routes.tsx` (NEW)
- `app/providers.tsx` (NEW)
- `navigation/TaskRunTree.tsx` (NEW)
- `navigation/CommandPalette.tsx` (NEW — skeleton only)

**Validation:**
- Dashboard renders with new shell layout
- Old routes still work (reachable by URL)
- Left sidebar shows task/run tree
- Right drawer is collapsed by default, opens on action
- Status bar shows correct execution data
- App.tsx is <100 lines

### 23.3 Phase 2: Mission Control / Execution Cockpit (Week 3-4)

**Goal:** Replace the current stats/queue/event center column with Mission Control Overview.

**Tasks:**
1. Create `MissionControlHero.tsx` — all hero states with actions
2. Create `MetricsStrip.tsx` — progress, cost, tokens, burn rate
3. Create `WorkspacePreview.tsx` — compact workspace card grid
4. Create `PriorityFeed.tsx` — Attention/Active/Recent events
5. Create `NextActionCard.tsx` — recommended next action
6. Create tab bar component (Overview | Workspaces | Files | Logs | Escalations)
7. Wire tab bar to route segments
8. Connect Overview components to read model hooks

**Files to create/modify:**
- `execution/MissionControlHero.tsx` (NEW)
- `execution/MetricsStrip.tsx` (NEW)
- `execution/WorkspacePreview.tsx` (NEW)
- `execution/PriorityFeed.tsx` (NEW)
- `execution/NextActionCard.tsx` (NEW)
- `primitives/Tabs.tsx` (NEW — shadcn-based)
- `components/shell/CenterColumn.tsx` (NEW — tab bar + active tab)

**Validation:**
- Execution Overview renders as the default tab
- Hero shows correct state (running/blocked/failed/etc.)
- Metrics strip shows real data
- Priority feed shows ATTENTION > ACTIVE > RECENT
- Next action card shows when actionable
- Tab switching works with URL persistence

### 23.4 Phase 3: Workspace Board and Detail Route (Week 5-6)

**Goal:** Replace inline workspace list with dedicated Workspace Board and Workspace Detail route.

**Prerequisites:** Read model stubs for `getCommandHistory()`, `getLeadDirectives()`, `getLeadEscalations()` must be fixed (WS-1 from interface-map.md).

**Tasks:**
1. Create `WorkspaceBoard.tsx` — grouped workspace cards by status
2. Create `WorkspaceGroup.tsx` — group header + card list
3. Create `WorkspaceCard.tsx` — card with all required fields
4. Create `WorkspaceDetailPage.tsx` — full workspace detail with 9 panels
5. Create `WorkspaceHeader.tsx` — workspace identity + controls
6. Create `CurrentState.tsx` — phase, command, heartbeat, goal
7. Create `ContextSummary.tsx` — prompt, allowed/touched files
8. Create `CommandHistory.tsx` — command table
9. Create `WorkspaceFiles.tsx` — file changes with diff links
10. Create `WorkspaceTranscript.tsx` — transcript events
11. Create `ValidationEvidence.tsx` — validation results
12. Create `AttemptHistory.tsx` — attempt list
13. Create `EscalationPanel.tsx` — escalations/directives
14. Add route: `/workspaces/:workspaceId`

**Files to create:**
- All files under `components/workspaces/` and `components/workspace-detail/`

**Validation:**
- Workspace Board shows workspaces grouped by status
- Workspace card shows all required fields
- Clicking workspace card navigates to `/workspaces/:workspaceId`
- Workspace Detail page renders all 9 panels
- Panels with real data show real data
- Panels with stub data show explicit empty/loading states
- Controls on workspace detail page dispatch to execution-service

### 23.5 Phase 4: Files/Diff and Logs/Command Timeline (Week 7-8)

**Goal:** Replace git-powered file/diff views with read-model-powered IDE views.

**Prerequisites:** Read model stubs for `getFileTree()`, `getFileContent()`, `getFileDiff()` must be fixed. Log streaming must be consolidated.

**Tasks:**
1. Create `ExecutionFileTree.tsx` — file tree with execution status
2. Create `FileDiffView.tsx` — unified diff with syntax highlighting
3. Create `FilePreview.tsx` — file content view
4. Create `FileEvidencePanel.tsx` — related workspace/command/validation
5. Create `CommandTimeline.tsx` — command list with status
6. Create `CommandDetail.tsx` — full command output + metadata
7. Create `LogFilters.tsx` — workspace/command/status filters
8. Create `RawLogView.tsx` — raw terminal output (toggle)
9. Refactor old FileExplorer and DiffViewer to use read model
10. Add routes: `/files/:filePath`, `/logs`

**Files to create:**
- All files under `components/files/` and `components/logs/`

**Validation:**
- File tree shows files with correct status icons
- File tree sources from read model, not git
- Clicking file shows content preview
- Diff view shows unified diff with line numbers
- Diff view sources from read model, not git
- Command timeline shows all commands for execution
- Command detail shows stdout/stderr
- Raw log mode available behind toggle
- Filtering works correctly

### 23.6 Phase 5: Escalation Center (Week 9-10)

**Goal:** Create dedicated Escalation Center with root cause analysis and action controls.

**Prerequisites:** Read model stubs for `getLeadEscalations()`, `getLeadDirectives()` must be fixed. Unified control path must be implemented (WS-2).

**Tasks:**
1. Create `EscalationCenter.tsx` — main escalation page
2. Create `EscalationCard.tsx` — full escalation with actions
3. Create `DeadlockDependencies.tsx` — dependency graph visualization
4. Create `HumanDirectiveBox.tsx` — directive input form
5. Create `EscalationEmpty.tsx` — empty state
6. Wire escalation controls to execution-service
7. Implement confirmation dialogs for dangerous escalation actions
8. Add route: `/escalations`

**Files to create:**
- All files under `components/escalations/`

**Validation:**
- Escalation Center shows active escalations
- Each escalation card shows root cause, impact, evidence, recommended actions
- Resolving escalation dispatches to execution-service
- Sending directive dispatches to execution-service
- Confirmation dialogs show for dangerous actions
- Empty state renders when no escalations

### 23.7 Phase 6: Brain/Platform Regrouping (Week 11)

**Goal:** Move Brain and Platform pages to secondary namespaces; remove from sidebar.

**Tasks:**
1. Move Brain pages to `features/brain/` directory
2. Move Platform pages to `features/platform/` directory
3. Create Brain dropdown menu in Topbar
4. Create Settings dropdown menu in Topbar
5. Create History dropdown menu in Topbar
6. Remove Brain/Platform items from sidebar navigation
7. Update routes to reflect new namespace structure
8. Ensure old Brain/Platform URLs redirect to new paths

**Files to modify:**
- Move 7+ Brain page files
- Move 5+ Platform page files
- Modify `navigation/SidebarTree.tsx`
- Modify `app/Topbar.tsx` (add dropdown menus)

**Validation:**
- Brain pages accessible via Brain dropdown menu
- Platform pages accessible via Settings dropdown menu
- History pages accessible via History dropdown menu
- No Brain/Platform items in sidebar
- Old URLs redirect to new paths
- All Brain/Platform functionality preserved

### 23.8 Phase 7: QA, A11y, React Doctor Audit (Week 12)

**Goal:** Final quality pass before shipping P42.

**Tasks:**
1. Implement keyboard shortcuts (global + per-panel)
2. Add ARIA labels and roles to all interactive components
3. Implement focus management (trap in dialogs, restore on close)
4. Add reduced motion support
5. Run react-doctor audit
6. Fix all lint, accessibility, performance, and bundle issues
7. Write E2E tests for 10-15 critical flows
8. Write integration tests for 40-60 component/hook scenarios
9. Run fake data detection tests
10. Perform final review of all empty/loading/error states

**Validation:**
- All keyboard shortcuts work
- All ARIA labels and roles are correct
- Focus management works correctly
- Color contrast meets WCAG AA
- Reduced motion respected
- react-doctor audit passes (all categories)
- E2E tests pass for all critical flows
- Integration tests pass for all scenarios
- No fake/static data in production UI

---

## 24. Implementation Workspace Details

### 24.1 Workspace Dependency Graph

```
                    ┌───────────────────┐
                    │  P42.01 Shell/Nav │
                    └────┬──────────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
    ┌──────────────┐ ┌──────────┐ ┌────────────────┐
    │ P42.02 Cockp.│ │P42.06 BP│ │ P42.07 Arch.   │
    │ (phase 2)    │ │(phase 6) │ │ (legacy files) │
    └──────┬───────┘ └──────────┘ └────────────────┘
           │
    ┌──────┴───────┐
    ▼              ▼
┌───────────┐ ┌───────────┐
│ P42.03    │ │ P42.04    │
│ Wrk Board │ │ Files/Logs│
│ (phase 3) │ │ (phase 4) │
└─────┬─────┘ └───────────┘
      │
      ▼
┌───────────┐
│ P42.05    │
│ Esc Center│
│ (phase 5) │
└─────┬─────┘
      │
      ▼
┌───────────┐
│ P42.08 QA │
│ (phase 7) │
└───────────┘
```

### 24.2 Workspace Risk Assessment

| ID | Title | Risk | Why | Mitigation |
|---|---|---|---|---|
| P42.01 | Shell/Navigation | LOW | Refactoring existing code; old routes reachable | Run existing tests after each component split |
| P42.02 | Mission Control | MEDIUM | Depends on read model; hero state machine is complex | Mock read model during development; test all hero states |
| P42.03 | Workspace Board/Detail | HIGH | Depends on 3 read model stubs being fixed | Fix WS-1 before starting; develop with mocks; add stub detection tests |
| P42.04 | Files/Diff/Logs | HIGH | Depends on 3 read model stubs; replaces git commands | Same as P42.03; test that git commands are no longer called |
| P42.05 | Escalation Center | MEDIUM | Depends on unified control path (WS-2) | Implement WS-2 first; test with mocked execution-service |
| P42.06 | Brain/Platform Regrouping | LOW | Just moving files and updating routes | Test all moved routes work; no functional changes |
| P42.07 | Archive/Deprecate Legacy | LOW | Deleting deprecated components | Verify no imports remain; run full test suite |
| P42.08 | QA/A11y/Doctor | LOW | Final polish pass | Run react-doctor early (phase 2) to catch issues early |

### 24.3 Workspace Parallelization

| Workspace | Can Parallelize With | Cannot Parallelize With |
|---|---|---|
| P42.01 | WS-1 (read model stubs, separate package) | Nothing (blocking dependency) |
| P42.02 | P42.06 (Brain/Platform, separate concerns) | P42.01 (needs shell) |
| P42.03 | P42.04 (Files/Logs), P42.06, WS-1 | P42.01, P42.02 |
| P42.04 | P42.03, P42.06, WS-1 | P42.01, P42.02 |
| P42.05 | P42.06 | P42.03 (needs workspace board), P42.02, P42.01 |
| P42.06 | P42.02, P42.03, P42.04, P42.07 | P42.01 (needs shell) |
| P42.07 | P42.06, P42.08 | P42.01 (needs shell) |
| P42.08 | P42.07 | All others (final phase) |

### 24.4 Total Effort Estimate

| Workspace | Engineering Days | QA Days | Total Days |
|---|---|---|---|
| WS-1 (read model stubs, separate) | 10-15 | 3 | 13-18 |
| WS-2 (control path, separate) | 5-8 | 2 | 7-10 |
| P42.01 Shell/Navigation | 10-12 | 3 | 13-15 |
| P42.02 Mission Control | 8-10 | 2 | 10-12 |
| P42.03 Workspace Board/Detail | 12-15 | 3 | 15-18 |
| P42.04 Files/Diff/Logs | 10-12 | 3 | 13-15 |
| P42.05 Escalation Center | 8-10 | 2 | 10-12 |
| P42.06 Brain/Platform Regroup | 3-5 | 1 | 4-6 |
| P42.07 Archive/Deprecate Legacy | 3-5 | 1 | 4-6 |
| P42.08 QA/A11y/Doctor | 5-8 | 5 | 10-13 |
| **Total** | **74-100** | **25** | **99-125** |

---

## 25. What Not To Build Yet

### 25.1 Out of Scope for P42

| Feature | Reason | Possible Future Phase |
|---|---|---|
| Side-by-side diff view (split pane) | Requires diff library integration; unified diff is sufficient | P43 |
| Before/after file comparison | Requires snapshot store integration; can be added later | P43 |
| Full Monaco editor integration | Not needed — we show diffs, not edit files | P44 |
| Execution timeline Gantt chart | Rich visualization library needed; nice-to-have | P43 |
| Execution comparison (A/B) | Requires significant backend work | P44 |
| Execution replay (video-like) | Requires event playback infrastructure | P44 |
| Execution scheduling | Requires job scheduler | P44 |
| Multi-execution view | Adds complexity without clear use case | P44 |
| Execution webhooks | Requires webhook infrastructure | P44 |
| Email/Slack notifications | Requires notification infrastructure | P44 |
| Workspace chat/commenting | Requires real-time messaging | P45 |
| Execution templates | Requires template storage and instantiation | P44 |
| Performance dashboard (historical) | Requires time-series DB | P43 |
| External worker marketplace | Not relevant for P42 | P45 |
| Unrestricted browser shell | Security implications; not needed for P42 | P45 |
| Advanced animations | Core flows first, then polish | P43 |
| Full mobile-perfect UI | Desktop first; tablet acceptable; mobile basic | P43 |

### 25.2 Deferred to P43

| Feature | Priority | Notes |
|---|---|---|
| Command palette (Cmd/Ctrl+K) | HIGH | Create skeleton in P42, full implementation in P43 |
| Execution timeline Gantt chart | MEDIUM | Nice visualization, not critical for P42 |
| Side-by-side diff | MEDIUM | Unified diff is sufficient for P42 |
| Before/after file comparison | MEDIUM | Requires snapshot store integration |
| Historical performance dashboard | LOW | Requires collecting time-series data |

---

## 26. Acceptance Criteria

### 26.1 Must-Have (P42 Shipped)

- [ ] **Workspace click opens a dedicated detail route**, not a dialog or inline view
- [ ] **Controls are contextual**, attached to plan/workspace/escalation objects, not a standalone tab
- [ ] **Mission Control Hero always shows current state**, risk level, and recommended next action
- [ ] **Files/Diff view can answer "what changed?"** from real read models (not git commands)
- [ ] **Logs view shows command timeline** by default, with raw output toggle
- [ ] **Escalations show root cause, impact, evidence, and recommended action**
- [ ] **Brain/Platform no longer compete** with active execution in the main navigation
- [ ] **App.tsx is decomposed** into shell (<100 lines), routes, and providers
- [ ] **No production dashboard panel relies on fake/static data** (stub detection tests pass)
- [ ] **All mutation controls go through execution-service** (no direct state store or control file writes)
- [ ] **Critical flows are keyboard accessible** (tab order, focus indicators, ARIA labels)
- [ ] **React Doctor audit is run** before final handoff with no critical issues
- [ ] **E2E tests pass** for 10+ critical user flows

### 26.2 Nice-to-Have (P42.5 or P43)

- [ ] Command palette (Cmd/Ctrl+K) with full action set
- [ ] Execution timeline Gantt chart visualization
- [ ] Side-by-side diff view
- [ ] Before/after file snapshot comparison
- [ ] Historical performance metrics
- [ ] Full mobile-responsive layout

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Plan Execution** | Runtime instance of a parsed plan. Contains workspaces, workers, events. |
| **Workspace** | Unit of work within a plan execution. Represents a single task for an agent. |
| **Worker** | Agent instance executing a workspace. Can have multiple attempts. |
| **Attempt** | Single execution attempt of a workspace. Failures trigger retries. |
| **Command** | Shell command executed by a worker during an attempt. |
| **Transcript** | Sanitized, structured event stream from a worker's execution. |
| **Escalation** | User-facing notification when a workspace is stuck and needs intervention. |
| **Directive** | Human or Lead Agent instruction to a worker about what to do/not do. |
| **Hero** | Top section of the Execution Overview showing current state and next action. |
| **Execution-service** | The canonical command/query facade at `packages/execution-service`. |
| **Mission Control** | The primary execution supervision view (Overview tab). |

## Appendix B: Related Documents

| Document | Location | Relationship |
|---|---|---|
| P42 Interface Map (current state) | `docs/pi/p42/interface-map.md` | Baseline for V3 proposal |
| Proposed Dashboard V2 | `docs/pi/p42/proposed-dashboard-v2.md` | V2 design (predecessor to V3) |
| P41 Visibility Baseline Audit | `docs/pi/p41/visibility-baseline-audit.md` | Visibility/control audit |
| Design Summary | `docs/design_summary.md` | Current UI architecture analysis |
| Dashboard Bugs | `docs/dashboard_bugs.md` | Known bugs in current dashboard |
| Frontend Skillset Status | `docs/pi/p42/frontend-skillset-status.md` | Frontend skill policy |

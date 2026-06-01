# P42 Proposed Dashboard V2 — Execution Cockpit Redesign

**Date:** 2026-06-01  
**Phase:** P42  
**Status:** Design Proposal (Read-Only)  
**Author:** Premium Design Architect Agent

---

## Executive Summary

### The Problem

The Pi dashboard has grown organically across P1-P41, accumulating **81 component files** in the components directory, **10 feature directories**, **50+ hooks**, and **multiple overlapping navigation concepts**. The result is a powerful but fragmented interface where:

- **Project/Run/Task** hierarchy is unclear to users
- **Platform vs Brain** pages duplicate functionality
- **Execution supervision** (the primary use case) competes with secondary features
- **Right sidebar** mixes events, alerts, and summaries without clear priority
- **Control actions** (pause/stop/retry) are scattered across multiple components
- **Fake/static data** exists in 5 read model stubs, risking operational confusion

### The Solution

Redesign the dashboard as an **Autonomous Coding Cockpit** — a focused execution supervision tool where:

1. **Primary object** = Plan Execution (what's running, what's blocked, what's next)
2. **Secondary objects** = Workspaces, Workers, Files, Commands, Events, Escalations
3. **Supporting objects** = Brain insights, Platform settings, Artifacts, Transcripts
4. **Every panel** connects to real execution read models (no fake data)
5. **Every control** goes through execution-service (no direct state mutations)

### The Outcome

A dashboard where users can answer four questions in <3 seconds:
- **What is happening?** (Execution Overview + Workspace Board)
- **Why is it happening?** (Worker Detail + Logs + Transcript)
- **What changed?** (File Explorer + Diff Viewer)
- **How do I intervene?** (Escalation Center + Control Actions)

---

## 1. Current Dashboard Diagnosis

### 1.1 Structural Problems

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT DASHBOARD LAYOUT                      │
├─────────────────────────────────────────────────────────────────┤
│ Topbar (48px)                                                   │
│ [toggle] [Planner ▲ StatusBadge] [Upload] [Git] [Commands]      │
│ [Chat] [Brain] [Artifacts] [Execution Log] [Settings]           │
├──────────┬──────────────────────────────────────┬───────────────┤
│ Left     │ Center                               │ Right         │
│ Sidebar  │                                      │ Sidebar       │
│ (320px)  │ [Toolbar]                            │ (300px)       │
│          │ [Error Banner]                       │               │
│ Tabs:    │ [Stats Grid (7 cols)]                │ Events Feed   │
│ • Browse │ [Queue Strip]                        │ Alerts        │
│ • Queue  │ [Scheduler Status]                   │ Plan Summary  │
│ • Chat   │ [Cockpit Panels] ← P41.12            │               │
│          │ [Worker List]                        │               │
│          │ [Worker Detail / Live Logs]          │               │
│          │                                      │               │
├──────────┴──────────────────────────────────────┴───────────────┤
│ Dialogs: Settings, Git, Commands, Log Viewer, Artifacts         │
└─────────────────────────────────────────────────────────────────┘

Problems:
❌ Topbar has 8+ buttons competing for attention
❌ Left sidebar mixes Projects, Executions, Tasks, and Chat in tabs
❌ Center column stacks 7+ sections vertically (stats → queue → scheduler → cockpit → workers → detail)
❌ Right sidebar mixes events, alerts, and summary without clear priority
❌ No clear "primary view" — everything is always visible
❌ Platform pages (Autonomy, Observability, Policy Audit, etc.) are buried in sidebar navigation
❌ Brain pages (State, Memory, Reflections, Trust, Overnight, Digest, Inbox) are separate from execution
```

### 1.2 Information Architecture Problems

| Problem | Evidence | Impact |
|---------|----------|--------|
| **Project/Run/Task hierarchy unclear** | Sidebar shows Projects → Executions, but Tasks are a separate tab in TaskCreationStudio | Users don't understand when to use Tasks vs Plans |
| **Platform vs Brain duplication** | Autonomy Center, Observability Cockpit, Policy Audit Center, Trust Dashboard, Brain State Page, Brain Memory Page, Brain Reflections Page all exist separately | Users can't find related features |
| **Execution supervision competes with secondary features** | Cockpit Panels (P41.12) are squeezed between stats grid and worker list | Primary use case (watching execution) is not the visual focus |
| **Right sidebar event noise** | Events feed shows all 39 event types without filtering or grouping | Users can't find the events that matter |
| **Observability vs Execution Events unclear** | Observability Cockpit (separate page) vs Execution Events (right sidebar) | Duplicate functionality, unclear ownership |
| **Inconsistent Brain page frames** | Brain pages use different layouts, some with sidebars, some full-width | Visual inconsistency, cognitive load |
| **Large monolithic components** | ObservabilityCockpit.tsx (400+ lines), LeadAgentDashboard.tsx (400+ lines) | Hard to maintain, hard to test |
| **Control actions scattered** | ControlButtons in Topbar, ControlActionsPanel in Cockpit, HumanDirectivePanel in Cockpit, ForceKillDialog separate | Users can't find the control they need |
| **Fake/static data risk** | 5 read model stubs return `[]` or `null` | Dashboard may show empty state even when data exists |
| **Insufficient worker/file/log/diff prioritization** | Worker Detail, File Explorer, Diff Viewer, Live Logs are all secondary views | Primary execution artifacts are not prominent |

### 1.3 Component Architecture Problems

```
packages/web-ui/dashboard/src/
├── App.tsx                          (1364 lines) ← TOO LARGE
├── components/
│   ├── CockpitPanels.tsx            ← P41.12 container (good)
│   ├── ControlActionsPanel.tsx      ← Control actions (good)
│   ├── HumanDirectivePanel.tsx      ← Human directives (good)
│   ├── LeadEscalationPanel.tsx      ← Escalations (good)
│   ├── WorkerContextInspector.tsx   ← Worker context (good)
│   ├── LiveLogTerminal.tsx          ← Live logs (good)
│   ├── FileExplorer.tsx             ← File tree (bypasses read model)
│   ├── DiffViewer.tsx               ← Diff viewer (bypasses read model)
│   ├── ObservabilityCockpit.tsx     (400+ lines) ← MONOLITHIC
│   ├── LeadAgentDashboard.tsx       (400+ lines) ← MONOLITHIC
│   ├── BatchOSDashboard.tsx         (300+ lines) ← MONOLITHIC
│   ├── ExecutionLogViewer.tsx       (200+ lines) ← OK
│   ├── WorkerDetail.tsx             (300+ lines) ← OK
│   ├── ... (70+ more components)
├── features/
│   ├── autonomy/                    ← Autonomy Center (separate page)
│   ├── observability/               ← Observability Cockpit (separate page)
│   ├── policy-audit/                ← Policy Audit Center (separate page)
│   ├── trust/                       ← Trust Dashboard (separate page)
│   ├── brain-workers/               ← Brain Worker Inbox (separate page)
│   ├── plan-intake/                 ← Plan Intake (good)
│   ├── proposal-inbox/              ← Proposal Inbox (good)
│   ├── memory/                      ← Memory Cockpit (separate page)
│   ├── settings/                    ← Settings (good)
├── hooks/                           (50+ hooks)
│   ├── useWorkerContext.ts          ← Good
│   ├── useHumanDirectives.ts        ← Good
│   ├── useEscalations.ts            ← Good
│   ├── useLiveLogTerminal.ts        ← Good
│   ├── usePlanEvents.ts             ← Good
│   ├── useObservability.ts          ← Duplicate with execution events?
│   ├── useBrainStatus.ts            ← Duplicate with execution state?
│   ├── ... (45+ more hooks)
└── pages/
    ├── BrainStatePage.tsx           ← Separate page
    ├── BrainMemoryPage.tsx          ← Separate page
    ├── BrainReflectionsPage.tsx     ← Separate page
    ├── BrainTrustPage.tsx           ← Separate page
    ├── BrainOvernightPage.tsx       ← Separate page
    ├── DigestPage.tsx               ← Separate page
    ├── BrainInboxPage.tsx           ← Separate page
```

**Key findings:**
- App.tsx is **1364 lines** (too large, needs decomposition)
- **3 monolithic components** (400+ lines each) need splitting
- **7 Brain pages** exist as separate pages, duplicating execution context
- **4 Platform features** exist as separate pages, competing with execution
- **File Explorer and Diff Viewer** bypass read model (use git directly)

### 1.4 Control Action Problems

```
CONTROL ACTIONS IN CURRENT DASHBOARD:

┌─────────────────────────────────────────────────────────────────┐
│ Topbar                                                          │
│ [Pause] [Stop] [Cancel] [Resume] [Rerun] [Force Kill]           │
│   ↓                                                             │
│   POST /api/control OR /api/executions/:peid/control            │
│   ❌ Bypasses execution-service (writes control file directly)  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Cockpit Panels (P41.12)                                         │
│ ControlActionsPanel                                             │
│   [Stop] [Pause] [Cancel] [Retry] (per workspace)               │
│   ↓                                                             │
│   POST /api/human/intervene/:peid/:wsId                         │
│   ✅ Goes through execution-service                             │
├─────────────────────────────────────────────────────────────────┤
│ HumanDirectivePanel                                             │
│ [Issue Directive] (per workspace)                               │
│   ↓                                                             │
│   POST /api/human/directive                                     │
│   ✅ Goes through execution-service                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ForceKillDialog (separate dialog)                               │
│ [Confirm Force Kill]                                            │
│   ↓                                                             │
│   POST /api/control (force-kill)                                │
│   ❌ Bypasses execution-service                                 │
└─────────────────────────────────────────────────────────────────┘

Problems:
❌ Two different control paths (legacy + execution-service)
❌ Topbar controls apply to entire plan, cockpit controls apply to workspace
❌ Force Kill is a separate dialog, not integrated into control flow
❌ No confirmation for dangerous actions (cancel, force kill)
❌ No feedback on control action result
```

### 1.5 Navigation Problems

```
CURRENT NAVIGATION STRUCTURE:

Left Sidebar:
├── Projects (list)
│   └── Executions (list per project)
│       └── Click → Select execution → Show in center
├── Tasks (separate concept)
│   └── Click → TaskDetailView (separate page)
└── Platform Pages (sidebar navigation)
    ├── Autonomy
    ├── Observability
    ├── Extensions & Skills
    ├── Plan Intake
    ├── Policy Audit
    ├── Registry Settings
    ├── Pi Inbox
    └── Brain Pages (7 separate pages)

Problems:
❌ Projects → Executions is 2 levels deep (too many clicks)
❌ Tasks are a separate concept, unclear relationship to Plans
❌ Platform pages are buried in sidebar (not discoverable)
❌ Brain pages are separate from execution context
❌ No breadcrumb trail (users get lost)
❌ No "back to execution" button from platform pages
```

---

## 2. Core Product Vision

### 2.1 The Autonomous Coding Cockpit

The dashboard is not a "SaaS dashboard" or a "project management tool." It is an **execution cockpit** for supervising autonomous coding agents.

**Primary use case:** User uploads a plan, watches it execute, intervenes when needed, reviews results.

**Secondary use cases:**
- User manages multiple projects and plans
- User reviews brain insights and proposals
- User configures platform settings
- User explores artifacts and transcripts

### 2.2 Object Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│ OBJECT HIERARCHY                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Project                                                         │
│  ├── Plan (uploaded markdown)                                   │
│  │   ├── Plan Execution (runtime instance)  ← PRIMARY OBJECT    │
│  │   │   ├── Workspace (unit of work)                           │
│  │   │   │   ├── Worker (agent instance)                        │
│  │   │   │   │   ├── Command (bash/shell execution)             │
│  │   │   │   │   ├── File Change (created/modified/deleted)     │
│  │   │   │   │   ├── Log (stdout/stderr)                        │
│  │   │   │   │   └── Transcript (structured event stream)       │
│  │   │   │   ├── Event (lifecycle event)                        │
│  │   │   │   └── Escalation (Lead Agent diagnosis)              │
│  │   │   ├── Artifact (snapshot, report, validation)            │
│  │   │   └── Control Action (pause/stop/cancel/retry)           │
│  │   └── ...                                                    │
│  └── ...                                                        │
│                                                                  │
│  Brain (supporting)                                              │
│  ├── Proposal (brain suggestion)                                │
│  ├── Memory (brain knowledge)                                   │
│  ├── Reflection (brain analysis)                                │
│  └── ...                                                        │
│                                                                  │
│  Platform (supporting)                                           │
│  ├── Settings (configuration)                                   │
│  ├── Policy (audit rules)                                       │
│  ├── Trust (safety metrics)                                     │
│  └── ...                                                        │
└─────────────────────────────────────────────────────────────────┘

PRIMARY OBJECT: Plan Execution
- What is running?
- What is blocked?
- What is next?

SECONDARY OBJECTS:
- Workspace: unit of work within a plan
- Worker: agent instance executing a workspace
- Command: bash/shell execution within a workspace
- File Change: created/modified/deleted file
- Event: lifecycle event (plan_started, workspace_completed, etc.)
- Escalation: Lead Agent diagnosis and recommendation

SUPPORTING OBJECTS:
- Brain: proposals, memories, reflections, insights
- Platform: settings, policies, trust, observability
- Artifacts: snapshots, reports, validation results
- Transcripts: structured event streams
```

### 2.3 User Mental Model

Users think in terms of:
1. **"What's running?"** → Show me active executions
2. **"What's blocked?"** → Show me blocked workspaces and why
3. **"What changed?"** → Show me file diffs and validation results
4. **"What should I do?"** → Show me escalations and recommendations
5. **"How do I intervene?"** → Show me control actions (pause/stop/retry)

The dashboard must answer these questions in <3 seconds.

---

## 3. New Information Architecture

### 3.1 View Classification

Every current view falls into one of five categories:

| Category | Description | Examples | Placement |
|----------|-------------|----------|-----------|
| **Primary Cockpit** | Execution supervision views | Execution Overview, Workspace Board, Worker Detail, File Explorer, Diff Viewer, Live Logs, Escalation Center | Center column (always visible) |
| **Contextual Support** | Execution-adjacent views | Transcript Inspector, Artifacts Browser, Plan Summary | Right sidebar or overlay panel |
| **Brain Support** | Brain insights and proposals | Proposal Inbox, Memory Browser, Reflections | Secondary navigation (accessible but not prominent) |
| **Platform Settings** | Configuration and admin | Settings, Policy Audit, Trust Dashboard, Observability | Settings/Admin area (accessible via gear icon) |
| **Archive** | Historical data | Execution History, Task History, Brain History | Archive area (accessible via history icon) |

### 3.2 View Inventory

```
PRIMARY COCKPIT (center column):
├── Execution Overview          ← Plan status, progress, bottlenecks
├── Workspace Board             ← Grouped workspaces by state
├── Worker Detail               ← Worker context, commands, files
├── File Explorer               ← Project file tree with execution status
├── Diff Viewer                 ← Before/after file diffs
├── Live Logs / Terminal        ← Live command output
├── Transcript / Context        ← Structured event stream
└── Escalation Center           ← Blocked workspaces, Lead Agent diagnosis

CONTEXTUAL SUPPORT (right sidebar or overlay):
├── Event Stream                ← Filtered execution events
├── Plan Summary                ← Plan metadata, cost, tokens
├── Artifact Browser            ← Snapshots, reports, validation
└── Control Actions             ← Pause/stop/cancel/retry (per workspace)

BRAIN SUPPORT (secondary navigation):
├── Proposal Inbox              ← Brain suggestions
├── Memory Browser              ← Brain knowledge
├── Reflections                 ← Brain analysis
├── Overnight Runs              ← Scheduled brain runs
├── Digest                      ← Morning digest
└── Brain Inbox                 ← All brain notifications

PLATFORM SETTINGS (gear icon menu):
├── Settings                    ← Configuration
├── Policy Audit                ← Audit rules
├── Trust Dashboard             ← Safety metrics
├── Observability               ← Performance metrics
├── Autonomy Center             ← Brain autonomy settings
└── Extensions & Skills         ← Plugin management

ARCHIVE (history icon menu):
├── Execution History           ← Past executions
├── Task History                ← Past tasks
└── Brain History               ← Past brain runs
```

### 3.3 Navigation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ NEW NAVIGATION STRUCTURE                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Topbar:                                                         │
│ [Logo] [Project Selector ▼] [Execution Selector ▼]              │
│ [Brain Icon (badge)] [History Icon] [Settings Icon]             │
│ [Help Icon]                                                     │
│                                                                  │
│ Left Sidebar:                                                   │
│ ├── Projects (expandable)                                       │
│ │   ├── Project A                                               │
│ │   │   ├── Active Executions (list)                            │
│ │   │   │   ├── exec-123 (running) ← Click → Center column      │
│ │   │   │   └── exec-124 (paused)                               │
│ │   │   └── Recent Executions (list)                            │
│ │   └── Project B                                               │
│ ├── Tasks (expandable)                                          │
│ │   └── Task List (if using task mode)                          │
│ └── Quick Actions                                               │
│     ├── Upload Plan                                             │
│     └── New Task                                                │
│                                                                  │
│ Center Column:                                                  │
│ [Execution Overview | Workspace Board | File Explorer | Logs]   │
│ ← Tab bar to switch between primary views                       │
│                                                                  │
│ Right Sidebar:                                                  │
│ ├── Events (filtered)                                           │
│ ├── Control Actions (per workspace)                             │
│ └── Context (transcript, artifacts)                             │
│                                                                  │
│ Secondary Navigation (via topbar icons):                        │
│ [Brain Icon] → Dropdown menu:                                   │
│   ├── Proposal Inbox                                            │
│   ├── Memory Browser                                            │
│   ├── Reflections                                               │
│   ├── Overnight Runs                                            │
│   ├── Digest                                                    │
│   └── Brain Inbox                                               │
│                                                                  │
│ [Settings Icon] → Dropdown menu:                                │
│   ├── Settings                                                  │
│   ├── Policy Audit                                              │
│   ├── Trust Dashboard                                           │
│   ├── Observability                                             │
│   ├── Autonomy Center                                           │
│   └── Extensions & Skills                                       │
│                                                                  │
│ [History Icon] → Dropdown menu:                                 │
│   ├── Execution History                                         │
│   ├── Task History                                              │
│   └── Brain History                                             │
└─────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Project → Execution is 1 click (not 2)
✅ Platform pages are in Settings menu (not competing with execution)
✅ Brain pages are in Brain menu (accessible but not prominent)
✅ Primary views are tabbed in center column (clear focus)
✅ No sidebar tabs (Browse/Queue/Chat) — simpler navigation
```

---

## 4. Proposed Layout

### 4.1 Layout Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Topbar (56px)                                                           │
│ [Logo] [Project: Pi ▼] [Execution: exec-123 ▼]                         │
│ [🧠 Brain (3)] [📜 History] [⚙️ Settings] [❓ Help]                     │
├────────────┬─────────────────────────────────────────┬──────────────────┤
│ Left       │ Center                                  │ Right            │
│ Sidebar    │                                         │ Sidebar          │
│ (280px)    │ [Tab Bar]                               │ (320px)          │
│            │ [Overview|Workspaces|Files|Logs]        │                  │
│ Projects   │                                         │ Events           │
│ ├─ Pi      │ [Primary View]                          │ (filtered)       │
│ │  ├─ exec-123 (running) ← SELECTED                  │ ├─ Errors only   │
│ │  └─ exec-124 (paused)                             │ ├─ Workspace: *  │
│ └─ Other   │                                         │ └─ Auto-scroll   │
│            │                                         │                  │
│ Quick      │                                         │ Control Actions  │
│ Actions    │                                         │ (if workspace    │
│ [Upload]   │                                         │  selected)       │
│ [New Task] │                                         │ [Pause] [Stop]   │
│            │                                         │ [Cancel] [Retry] │
│            │                                         │                  │
│            │                                         │ Context          │
│            │                                         │ [Transcript]     │
│            │                                         │ [Artifacts]      │
│            │                                         │ [Plan Summary]   │
├────────────┴─────────────────────────────────────────┴──────────────────┤
│ Status Bar (24px)                                                        │
│ [exec-123] Running · 3/5 workspaces · 2 blocked · $0.42 · 12k tokens    │
└─────────────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Topbar has 5 buttons (not 8+)
✅ Left sidebar is simple (Projects + Quick Actions)
✅ Center column has tabbed primary views (clear focus)
✅ Right sidebar has clear sections (Events + Controls + Context)
✅ Status bar shows key metrics (always visible)
✅ Brain/Settings/History are dropdown menus (not competing with execution)
```

### 4.2 Responsive Behavior

```
DESKTOP (>1200px):
┌────────┬──────────────────────────────┬──────────┐
│ Left   │ Center                       │ Right    │
│ 280px  │ flex-1                       │ 320px    │
└────────┴──────────────────────────────┴──────────┘

TABLET (768px - 1200px):
┌────────┬──────────────────────────────┐
│ Left   │ Center                       │
│ 240px  │ flex-1                       │
│        │ [Toggle Right Sidebar]       │
└────────┴──────────────────────────────┘
Right sidebar collapses to overlay panel

MOBILE (<768px):
┌──────────────────────────────────────┐
│ Center                               │
│ flex-1                               │
│ [Hamburger Menu] [Toggle Panels]     │
└──────────────────────────────────────┘
Left and right sidebars collapse to overlay panels
```

---

## 5. Route Map

### 5.1 Proposed Routes

| Route | View | Description |
|-------|------|-------------|
| `/` | Redirect | Redirect to `/projects` or last selected project |
| `/projects` | Project List | List all projects with active executions |
| `/projects/:projectId` | Project Detail | Show project with active executions |
| `/projects/:projectId/executions/:planExecId` | Execution Overview | Primary execution view |
| `/projects/:projectId/executions/:planExecId/workspaces` | Workspace Board | Grouped workspaces by state |
| `/projects/:projectId/executions/:planExecId/workspaces/:workspaceId` | Worker Detail | Worker context, commands, files |
| `/projects/:projectId/executions/:planExecId/files` | File Explorer | Project file tree with execution status |
| `/projects/:projectId/executions/:planExecId/files/:filePath` | Diff Viewer | Before/after diff for specific file |
| `/projects/:projectId/executions/:planExecId/logs` | Live Logs | Live command output |
| `/projects/:projectId/executions/:planExecId/escalations` | Escalation Center | Blocked workspaces, Lead Agent diagnosis |
| `/projects/:projectId/tasks` | Task List | List tasks for project |
| `/projects/:projectId/tasks/:taskId` | Task Detail | Task detail with linked executions |
| `/brain/proposals` | Proposal Inbox | Brain suggestions |
| `/brain/memory` | Memory Browser | Brain knowledge |
| `/brain/reflections` | Reflections | Brain analysis |
| `/brain/overnight` | Overnight Runs | Scheduled brain runs |
| `/brain/digest` | Digest | Morning digest |
| `/brain/inbox` | Brain Inbox | All brain notifications |
| `/settings` | Settings | Configuration |
| `/settings/policy` | Policy Audit | Audit rules |
| `/settings/trust` | Trust Dashboard | Safety metrics |
| `/settings/observability` | Observability | Performance metrics |
| `/settings/autonomy` | Autonomy Center | Brain autonomy settings |
| `/settings/extensions` | Extensions & Skills | Plugin management |
| `/history/executions` | Execution History | Past executions |
| `/history/tasks` | Task History | Past tasks |
| `/history/brain` | Brain History | Past brain runs |

### 5.2 Route Hierarchy

```
/
├── /projects
│   └── /projects/:projectId
│       ├── /projects/:projectId/executions/:planExecId  ← PRIMARY
│       │   ├── /workspaces
│       │   │   └── /:workspaceId
│       │   ├── /files
│       │   │   └── /:filePath
│       │   ├── /logs
│       │   └── /escalations
│       └── /projects/:projectId/tasks
│           └── /:taskId
├── /brain
│   ├── /proposals
│   ├── /memory
│   ├── /reflections
│   ├── /overnight
│   ├── /digest
│   └── /inbox
├── /settings
│   ├── /policy
│   ├── /trust
│   ├── /observability
│   ├── /autonomy
│   └── /extensions
└── /history
    ├── /executions
    ├── /tasks
    └── /brain
```

---

## 6. Panel Hierarchy

### 6.1 Execution Overview Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ Execution Overview                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Plan Header                                                  │ │
│ │ Plan: P42 Execution Cockpit                                  │ │
│ │ Status: Running · Started: 2 min ago · Est. completion: 8m  │ │
│ │ [Pause] [Stop] [Cancel]                                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌──────────────┬──────────────┬──────────────┬────────────────┐ │
│ │ Progress     │ Cost         │ Tokens       │ Burn Rate      │ │
│ │ 3/5 (60%)    │ $0.42        │ 12.4k        │ 2.1k/min       │ │
│ │ ▓▓▓▓▓▓░░░░   │ Budget: $2.00│ Budget: 100k │                │ │
│ └──────────────┴──────────────┴──────────────┴────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Workspace Summary                                            │ │
│ │                                                              │ │
│ │ Running (2)    Blocked (2)    Ready (1)    Done (0)          │ │
│ │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │ │
│ │ │ws-1 │ │ws-2 │ │ws-3 │ │ws-4 │ │ws-5 │ │ws-6 │ │ws-7 │   │ │
│ │ │run  │ │run  │ │blk  │ │blk  │ │rdy  │ │     │ │     │   │ │
│ │ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │ │
│ │                                                              │ │
│ │ [View All Workspaces →]                                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Current Bottleneck                                           │ │
│ │                                                              │ │
│ │ ⚠️ 2 workspaces blocked by dependency: ws-3 depends on ws-1 │ │
│ │                                                              │ │
│ │ Latest Escalation:                                           │ │
│ │ ws-4: "Test suite failing, retry budget exhausted"           │ │
│ │ [View Escalation →]                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Validation Status                                            │ │
│ │                                                              │ │
│ │ ✅ Plan parsed successfully                                  │ │
│ │ ✅ Safety doctor passed                                      │ │
│ │ ⚠️ 2 workspaces have failing validation commands            │ │
│ │ [View Validation Details →]                                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Next Action                                                  │ │
│ │                                                              │ │
│ │ 🎯 Resolve escalation for ws-4                               │ │
│ │ [Resolve Now →]                                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- Plan Header: ExecutionReadModel.getPlanSummary()
- Progress/Cost/Tokens: ExecutionReadModel.getPlanStats()
- Workspace Summary: ExecutionReadModel.getWorkspaceSummary()
- Current Bottleneck: ExecutionReadModel.getDependencyGraph() + getBlockedWorkspaces()
- Latest Escalation: ExecutionReadModel.getLeadEscalations()
- Validation Status: ExecutionReadModel.getFinalValidationStatus()
```

### 6.2 Workspace Board Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ Workspace Board                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Running (2)                                                  │ │
│ │ ┌─────────────────┐ ┌─────────────────┐                     │ │
│ │ │ ws-1            │ │ ws-2            │                     │ │
│ │ │ Worker: agent-1 │ │ Worker: agent-2 │                     │ │
│ │ │ Model: claude-3 │ │ Model: claude-3 │                     │ │
│ │ │ Attempt: 1      │ │ Attempt: 1      │                     │ │
│ │ │ Started: 2m ago │ │ Started: 1m ago │                     │ │
│ │ │                 │ │                 │                     │ │
│ │ │ Files: 3        │ │ Files: 1        │                     │ │
│ │ │ Commands: 12    │ │ Commands: 5     │                     │ │
│ │ │                 │ │                 │                     │ │
│ │ │ [View Detail →] │ │ [View Detail →] │                     │ │
│ │ └─────────────────┘ └─────────────────┘                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Blocked (2)                                                  │ │
│ │ ┌─────────────────┐ ┌─────────────────┐                     │ │
│ │ │ ws-3            │ │ ws-4            │                     │ │
│ │ │ Reason:         │ │ Reason:         │                     │ │
│ │ │ Dependency on   │ │ Test suite      │                     │ │
│ │ │ ws-1            │ │ failing         │                     │ │
│ │ │                 │ │                 │                     │ │
│ │ │ Retry: 0/3      │ │ Retry: 3/3 ⚠️  │                     │ │
│ │ │                 │ │                 │                     │ │
│ │ │ [View Detail →] │ │ [Escalation →]  │                     │ │
│ │ └─────────────────┘ └─────────────────┘                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Ready (1)                                                    │ │
│ │ ┌─────────────────┐                                         │ │
│ │ │ ws-5            │                                         │ │
│ │ │ Waiting for     │                                         │ │
│ │ │ worker slot     │                                         │ │
│ │ │                 │                                         │ │
│ │ │ Dependencies:   │                                         │ │
│ │ │ ws-1, ws-2      │                                         │ │
│ │ └─────────────────┘                                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Completed (0)                                                │ │
│ │ (empty state)                                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Failed (0)                                                   │ │
│ │ (empty state)                                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- Workspace cards: ExecutionReadModel.getWorkspaceSummary()
- Worker info: ExecutionReadModel.getWorkerContext()
- Files/Commands: ExecutionReadModel.getCommandHistory()
- Blocked reason: ExecutionReadModel.getDependencyGraph()
- Retry count: ExecutionReadModel.getWorkspaceSummary().retryCount
- Escalation link: ExecutionReadModel.getLeadEscalations()
```

---

## 7. Execution Cockpit View

### 7.1 Execution Overview Component

```typescript
// Proposed component structure
interface ExecutionOverviewProps {
  projectId: string;
  planExecId: string;
}

const ExecutionOverview: React.FC<ExecutionOverviewProps> = ({ projectId, planExecId }) => {
  const planSummary = usePlanSummary(planExecId);
  const planStats = usePlanStats(planExecId);
  const workspaces = useWorkspaces(planExecId);
  const escalations = useLeadEscalations(planExecId);
  const validationStatus = useFinalValidationStatus(planExecId);

  return (
    <div className="space-y-6">
      <PlanHeader summary={planSummary} />
      <MetricsGrid stats={planStats} />
      <WorkspaceSummary workspaces={workspaces} />
      <CurrentBottleneck workspaces={workspaces} />
      <LatestEscalation escalations={escalations} />
      <ValidationStatus status={validationStatus} />
      <NextAction escalations={escalations} validationStatus={validationStatus} />
    </div>
  );
};
```

### 7.2 Sub-components

```
ExecutionOverview/
├── PlanHeader.tsx
│   - Plan name, status, start time, estimated completion
│   - [Pause] [Stop] [Cancel] buttons
├── MetricsGrid.tsx
│   - Progress bar (X/Y workspaces)
│   - Cost (current vs budget)
│   - Tokens (current vs budget)
│   - Burn rate (tokens/min)
├── WorkspaceSummary.tsx
│   - Visual grid of workspace cards grouped by state
│   - [View All Workspaces →] link
├── CurrentBottleneck.tsx
│   - Dependency blockers
│   - Resource constraints
├── LatestEscalation.tsx
│   - Most recent escalation
│   - [View Escalation →] link
├── ValidationStatus.tsx
│   - Plan validation results
│   - Workspace validation results
└── NextAction.tsx
    - Recommended next action (resolve escalation, review validation, etc.)
    - [Action →] button
```

---

## 8. Worker Detail View

### 8.1 Worker Detail Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Worker Detail: ws-3                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Worker Header                                                │ │
│ │ Workspace: ws-3 · Worker: agent-1 · Model: claude-3-opus    │ │
│ │ Status: Running · Attempt: 1 · Started: 2 min ago           │ │
│ │ [Pause] [Stop] [Cancel] [Retry]                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Current Phase                                                │ │
│ │                                                              │ │
│ │ Phase: Executing commands                                    │ │
│ │ Heartbeat: 5s ago ✅                                         │ │
│ │ Current Command: npm test                                    │ │
│ │ Duration: 12s · Exit Code: (running)                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Context                                                      │ │
│ │                                                              │ │
│ │ Goal: "Implement user authentication module"                 │ │
│ │                                                              │ │
│ │ Prompt Summary:                                              │ │
│ │ You are implementing the user authentication module for...   │ │
│ │ (truncated, [View Full Prompt →])                            │ │
│ │                                                              │ │
│ │ Allowed Files:                                               │ │
│ │ • src/auth/*                                                 │ │
│ │ • tests/auth/*                                               │ │
│ │                                                              │ │
│ │ Touched Files:                                               │ │
│ │ • src/auth/login.ts (modified)                               │ │
│ │ • src/auth/register.ts (created)                             │ │
│ │ • tests/auth/login.test.ts (created)                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Command History                                              │ │
│ │                                                              │ │
│ │ # Command                  Duration  Exit   Status           │ │
│ │ ───────────────────────────────────────────────────────────  │ │
│ │ 1 npm install              8s        0      ✅ Done          │ │
│ │ 2 npm run build            15s       0      ✅ Done          │ │
│ │ 3 npm test                 12s       -      🔄 Running       │ │
│ │                                                              │ │
│ │ [View All Commands →]                                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Transcript                                                   │ │
│ │                                                              │ │
│ │ [14:23:01] Worker started                                    │ │
│ │ [14:23:05] Running: npm install                              │ │
│ │ [14:23:13] Command completed (exit 0)                        │ │
│ │ [14:23:14] Running: npm run build                            │ │
│ │ [14:23:29] Command completed (exit 0)                        │ │
│ │ [14:23:30] Running: npm test                                 │ │
│ │ [14:23:42] (running...)                                      │ │
│ │                                                              │ │
│ │ [View Full Transcript →]                                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Validation Evidence                                          │ │
│ │                                                              │ │
│ │ ✅ Plan validation: passed                                   │ │
│ │ ⚠️ Workspace validation: 2 warnings                         │ │
│ │   - Missing JSDoc comments in src/auth/login.ts             │ │
│ │   - Test coverage: 78% (target: 80%)                        │ │
│ │                                                              │ │
│ │ [View Validation Details →]                                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Retry / Escalation History                                   │ │
│ │                                                              │ │
│ │ Attempt 1 (current):                                         │ │
│ │   Started: 14:23:01                                          │ │
│ │   Status: Running                                            │ │
│ │   Escalations: 0                                             │ │
│ │                                                              │ │
│ │ (No previous attempts)                                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- Worker Header: ExecutionReadModel.getWorkerContext()
- Current Phase: ExecutionReadModel.getWorkerContext() + ICommandLogStream
- Context: ExecutionReadModel.getWorkerContext()
- Command History: ExecutionReadModel.getCommandHistory()
- Transcript: IWorkerTranscriptStore.readTranscriptEvents()
- Validation Evidence: ExecutionReadModel.getFinalValidationStatus()
- Retry/Escalation History: ExecutionReadModel.getWorkspaceSummary() + getLeadEscalations()
```

### 8.2 Sub-components

```
WorkerDetail/
├── WorkerHeader.tsx
│   - Workspace ID, worker ID, model, status, attempt, start time
│   - [Pause] [Stop] [Cancel] [Retry] buttons
├── CurrentPhase.tsx
│   - Current phase (planning/executing/validating)
│   - Heartbeat (last seen)
│   - Current command (name, duration, exit code)
├── Context.tsx
│   - Goal (from packet)
│   - Prompt summary (truncated)
│   - Allowed files
│   - Touched files
├── CommandHistory.tsx
│   - Table of commands (command, duration, exit code, status)
│   - [View All Commands →] link
├── Transcript.tsx
│   - Scrollable transcript events
│   - [View Full Transcript →] link
├── ValidationEvidence.tsx
│   - Plan validation results
│   - Workspace validation results
│   - Warnings and errors
└── RetryEscalationHistory.tsx
    - List of attempts
    - Escalations per attempt
```

---

## 9. File Tree / Diff View

### 9.1 File Explorer Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ File Explorer                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ File Tree (left)                    │ File Content (right)  │ │
│ │                                     │                       │ │
│ │ 📁 src                              │ login.ts              │ │
│ │   📁 auth                           │                       │ │
│ │     📄 login.ts 🟡 modified         │ export function login │ │
│ │     📄 register.ts 🟢 created       │ (email: string, pass  │ │
│ │   📁 utils                          │ word: string) {       │ │
│ │     📄 hash.ts (unchanged)          │   // hash password    │ │
│ │ 📁 tests                            │   const hashed = awai │ │
│ │   📁 auth                           │ t bcrypt.hash(passwor │ │
│ │     📄 login.test.ts 🟢 created     │ d, 10);               │ │
│ │     📄 register.test.ts 🟢 created  │   // ...              │ │
│ │ 📁 docs                             │ }                     │ │
│ │   📄 README.md (unchanged)          │                       │ │
│ │                                     │ [+12 -3]              │ │
│ │                                     │                       │ │
│ │                                     │ [View Diff →]         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ File Status Legend                                           │ │
│ │ 🟢 created  🟡 modified  🔴 deleted  ⚪ unchanged          │ │
│ │ 🔒 locked by ws-1  🔓 unlocked                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- File Tree: ExecutionReadModel.getFileTree()
- File Content: ExecutionReadModel.getFileContent()
- File Status: ExecutionReadModel.getChangedFiles()
- File Locks: ExecutionReadModel.getWorkspaceSummary() (which workspace owns file)
```

### 9.2 Diff Viewer Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Diff Viewer: src/auth/login.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ File Info                                                    │ │
│ │ File: src/auth/login.ts                                      │ │
│ │ Status: modified                                             │ │
│ │ Last Writer: ws-1 (agent-1)                                  │ │
│ │ Related Workspace: ws-1                                      │ │
│ │ Related Validation: npm test                                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Unified Diff                                                 │ │
│ │                                                              │ │
│ │  1 │ export function login(email: string, password: string) { │ │
│ │  2 │   // hash password                                      │ │
│ │  3 │-  const hashed = password;                              │ │
│ │  4 │+  const hashed = await bcrypt.hash(password, 10);       │ │
│ │  5 │   // verify credentials                                 │ │
│ │  6 │   const user = await db.users.findOne({ email });       │ │
│ │  7 │-  if (user.password !== hashed) {                       │ │
│ │  8 │+  if (!await bcrypt.compare(password, user.password)) { │ │
│ │  9 │     throw new Error('Invalid credentials');             │ │
│ │ 10 │   }                                                     │ │
│ │                                                              │ │
│ │ [+12 -3]                                                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Actions                                                      │ │
│ │ [View Full File] [View Snapshot] [Copy Diff]                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- File Info: ExecutionReadModel.getFileContent() + getChangedFiles()
- Unified Diff: ExecutionReadModel.getFileDiff()
- Last Writer: ExecutionReadModel.getWorkspaceSummary()
- Related Validation: ExecutionReadModel.getFinalValidationStatus()
```

---

## 10. Logs / Terminal / Transcript View

### 10.1 Live Logs Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Live Logs                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Filters                                                      │ │
│ │ Worker: [All ▼]  Workspace: [All ▼]  Command: [All ▼]       │ │
│ │ Stream: [stdout ▼]  Severity: [All ▼]                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Terminal Output                                              │ │
│ │                                                              │ │
│ │ [14:23:01] ws-1 agent-1 npm install                          │ │
│ │ added 142 packages in 8s                                     │ │
│ │                                                              │ │
│ │ [14:23:13] ws-1 agent-1 npm run build                        │ │
│ │ > pi-dashboard@1.0.0 build                                   │ │
│ │ > tsc && vite build                                          │ │
│ │                                                              │ │
│ │ vite v5.0.0 building for production...                       │ │
│ │ ✓ 47 modules transformed.                                    │ │
│ │ dist/index.html                  0.42 kB │ gzip:  0.28 kB   │ │
│ │ dist/assets/index-abc123.css     8.51 kB │ gzip:  2.74 kB   │ │
│ │ dist/assets/index-def456.js    142.83 kB │ gzip: 46.21 kB   │ │
│ │ ✓ built in 1.23s                                             │ │
│ │                                                              │ │
│ │ [14:23:29] ws-1 agent-1 npm test                             │ │
│ │ > pi-dashboard@1.0.0 test                                    │ │
│ │ > vitest run                                                 │ │
│ │                                                              │ │
│ │  RUN  v1.0.0                                                  │ │
│ │                                                              │ │
│ │  ✓ tests/auth/login.test.ts (3)                              │ │
│ │  ✓ tests/auth/register.test.ts (2)                           │ │
│ │                                                              │ │
│ │ Test Files  2 passed (2)                                     │ │
│ │      Tests  5 passed (5)                                     │ │
│ │   Duration  1.45s                                            │ │
│ │                                                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Command Summary                                              │ │
│ │                                                              │ │
│ │ npm install     8s   exit 0  ✅ Done                         │ │
│ │ npm run build   15s  exit 0  ✅ Done                         │ │
│ │ npm test        12s  exit 0  ✅ Done                         │ │
│ │                                                              │ │
│ │ Total: 3 commands · 35s · 0 failures                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Links                                                        │ │
│ │ [View Transcript →]  [View Artifacts →]  [Download Logs →]   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- Terminal Output: ICommandLogStream (live) or ExecutionReadModel.getCommandHistory() (historical)
- Command Summary: ExecutionReadModel.getCommandHistory()
- Filters: Local state (no API needed)
```

---

## 11. Escalation / Lead Agent View

### 11.1 Escalation Center Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Escalation Center                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Active Escalations (2)                                       │ │
│ │                                                              │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Escalation 1: ws-4                                      │ │ │
│ │ │                                                          │ │ │
│ │ │ Title: Test suite failing, retry budget exhausted        │ │ │
│ │ │ Severity: HIGH                                           │ │ │
│ │ │                                                          │ │ │
│ │ │ What happened:                                           │ │ │
│ │ │ The test suite is failing with 3 errors related to       │ │ │
│ │ │ database connection timeouts. All 3 retry attempts have  │ │ │
│ │ │ been exhausted.                                          │ │ │
│ │ │                                                          │ │ │
│ │ │ Why stuck:                                               │ │ │
│ │ │ The database connection pool is not being properly       │ │ │
│ │ │ closed between tests, causing connection exhaustion.     │ │ │
│ │ │                                                          │ │ │
│ │ │ Lead Agent Diagnosis:                                    │ │ │
│ │ │ The issue is in tests/setup.ts - the afterAll hook is    │ │ │
│ │ │ not closing the database connection pool.                │ │ │
│ │ │                                                          │ │ │
│ │ │ Recommended Actions:                                     │ │ │
│ │ │ 1. Add pool.close() to afterAll hook in tests/setup.ts  │ │ │
│ │ │ 2. Increase retry budget to 5 attempts                   │ │ │
│ │ │ 3. Skip this workspace and continue with others          │ │ │
│ │ │                                                          │ │ │
│ │ │ [Retry with Directive] [Increase Budget] [Skip]          │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                              │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Escalation 2: ws-6                                      │ │ │
│ │ │                                                          │ │ │
│ │ │ Title: Merge conflict with ws-2                          │ │ │
│ │ │ Severity: MEDIUM                                         │ │ │
│ │ │                                                          │ │ │
│ │ │ What happened:                                           │ │ │
│ │ │ ws-6 modified src/utils/hash.ts, but ws-2 also modified │ │ │
│ │ │ the same file. Git merge failed with conflicts.          │ │ │
│ │ │                                                          │ │ │
│ │ │ Why stuck:                                               │ │ │
│ │ │ Both workspaces are in the same batch and cannot be      │ │ │
│ │ │ automatically merged.                                    │ │ │
│ │ │                                                          │ │ │
│ │ │ Lead Agent Diagnosis:                                    │ │ │
│ │ │ The changes are in different functions (ws-2 modified    │ │ │
│ │ │ hashPassword, ws-6 modified verifyPassword). Manual      │ │ │
│ │ │ merge is straightforward.                                │ │ │
│ │ │                                                          │ │ │
│ │ │ Recommended Actions:                                     │ │ │
│ │ │ 1. Manually resolve merge conflict                       │ │ │
│ │ │ 2. Retry ws-6 after ws-2 completes                       │ │ │
│ │ │ 3. Skip ws-6 and handle manually later                   │ │ │
│ │ │                                                          │ │ │
│ │ │ [Resolve Conflict] [Retry After ws-2] [Skip]             │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Deadlock Dependencies                                        │ │
│ │                                                              │ │
│ │ ws-3 ← ws-1 (dependency blocker)                             │ │
│ │ ws-5 ← ws-1, ws-2 (dependency blocker)                       │ │
│ │                                                              │ │
│ │ No circular dependencies detected.                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Human Directive Input                                        │ │
│ │                                                              │ │
│ │ [Issue Directive to ws-4 ▼]                                  │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Type your directive here...                              │ │ │
│ │ │                                                          │ │ │
│ │ │ Example: "Focus on fixing the database connection pool   │ │ │
│ │ │ in tests/setup.ts. Do not modify other files."           │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │ [Send Directive]                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data sources:
- Active Escalations: ExecutionReadModel.getLeadEscalations()
- Lead Agent Diagnosis: ExecutionReadModel.getLeadEscalations().diagnosis
- Recommended Actions: ExecutionReadModel.getLeadEscalations().recommendedActions
- Deadlock Dependencies: ExecutionReadModel.getDependencyGraph()
- Human Directive Input: Local state → POST /api/human/directive
```

---

## 12. Control Actions UX

### 12.1 Control Action Principles

1. **All mutations go through execution-service** (no direct state mutations)
2. **Dangerous controls require confirmation** (cancel, force kill)
3. **Every control emits an event** (for audit trail)
4. **Controls show result state** (success/failure feedback)
5. **Controls are context-aware** (plan-level vs workspace-level)

### 12.2 Control Action Inventory

```
PLAN-LEVEL CONTROLS (apply to entire execution):
┌─────────────────────────────────────────────────────────────────┐
│ Control        │ Dangerous? │ Confirmation? │ Event Emitted     │
├────────────────┼────────────┼───────────────┼───────────────────┤
│ Pause          │ No         │ No            │ plan_paused       │
│ Resume         │ No         │ No            │ plan_resumed      │
│ Stop           │ Yes        │ Yes           │ plan_stopped      │
│ Cancel         │ Yes        │ Yes           │ plan_cancelled    │
│ Rerun          │ Yes        │ Yes           │ plan_rerun        │
│ Force Kill     │ Yes        │ Yes (double)  │ plan_force_killed │
└─────────────────────────────────────────────────────────────────┘

WORKSPACE-LEVEL CONTROLS (apply to single workspace):
┌─────────────────────────────────────────────────────────────────┐
│ Control            │ Dangerous? │ Confirmation? │ Event Emitted │
├────────────────────┼────────────┼───────────────┼───────────────┤
│ Pause              │ No         │ No            │ ws_paused     │
│ Resume             │ No         │ No            │ ws_resumed    │
│ Stop               │ Yes        │ Yes           │ ws_stopped    │
│ Cancel             │ Yes        │ Yes           │ ws_cancelled  │
│ Retry              │ No         │ No            │ ws_retried    │
│ Retry w/ Directive │ No         │ No            │ ws_retried    │
│ Increase Budget    │ No         │ No            │ ws_budget++   │
│ Skip               │ Yes        │ Yes           │ ws_skipped    │
│ Issue Directive    │ No         │ No            │ ws_directive  │
│ Resolve Escalation │ No         │ No            │ ws_resolved   │
└─────────────────────────────────────────────────────────────────┘
```

### 12.3 Confirmation Dialog

```
┌─────────────────────────────────────────────────────────────────┐
│ Confirm: Cancel Execution                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Are you sure you want to cancel execution exec-123?             │
│                                                                  │
│ This will:                                                      │
│ • Stop all running workers immediately                          │
│ • Mark all pending workspaces as cancelled                      │
│ • Prevent any further execution                                 │
│                                                                  │
│ This action cannot be undone.                                   │
│                                                                  │
│ [Cancel]                                          [Confirm]     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 12.4 Control Action Flow

```
User clicks [Stop] on ws-3
  ↓
Check: Is this dangerous?
  ↓ Yes
Show confirmation dialog
  ↓ User confirms
POST /api/human/intervene/:peid/:wsId
  Body: { action: "stop", reason: "user requested" }
  ↓
execution-service.handleExecutionCommand({
  type: "intervene_workspace",
  planExecutionId: peid,
  workspaceId: wsId,
  action: "stop",
  reason: "user requested"
})
  ↓
Execution-service emits event: ws_stopped
  ↓
Dashboard receives event via SSE
  ↓
Dashboard updates UI: ws-3 status = "stopped"
  ↓
Show toast: "✅ ws-3 stopped successfully"
```

---

## 13. Brain / Platform / Project Areas

### 13.1 Brain Support Strategy

**Principle:** Brain should be **contextual and supportive**, not the main execution cockpit.

```
BRAIN PAGES (accessible via 🧠 icon in topbar):

┌─────────────────────────────────────────────────────────────────┐
│ 🧠 Brain Menu                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Proposal Inbox (3)                                               │
│   - Brain suggestions for current execution                     │
│   - Accept/Reject/Correct proposals                             │
│                                                                  │
│ Memory Browser                                                   │
│   - Brain knowledge base                                        │
│   - Search/browse memories                                      │
│                                                                  │
│ Reflections                                                      │
│   - Brain analysis of past executions                           │
│   - Insights and recommendations                                │
│                                                                  │
│ Overnight Runs                                                   │
│   - Scheduled brain runs                                        │
│   - Queue new overnight run                                     │
│                                                                  │
│ Digest                                                           │
│   - Morning digest                                              │
│   - Summary of overnight activity                               │
│                                                                  │
│ Brain Inbox                                                      │
│   - All brain notifications                                     │
│   - Observations, signals, proposals                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Brain pages are accessible but not prominent
✅ Brain pages are contextual (show current execution context where relevant)
✅ Proposal Inbox is the primary brain page (most actionable)
✅ Memory/Reflections/Overnight/Digest are secondary (historical/analytical)
```

### 13.2 Platform Settings Strategy

**Principle:** Platform pages should move to **Settings/Admin area** unless directly relevant to active execution.

```
PLATFORM PAGES (accessible via ⚙️ icon in topbar):

┌─────────────────────────────────────────────────────────────────┐
│ ⚙️ Settings Menu                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Settings                                                         │
│   - General configuration                                       │
│   - Worker concurrency                                          │
│   - Safety profiles                                             │
│                                                                  │
│ Policy Audit                                                     │
│   - Audit rules                                                 │
│   - Policy violations                                           │
│                                                                  │
│ Trust Dashboard                                                  │
│   - Safety metrics                                              │
│   - Trust scores                                                │
│                                                                  │
│ Observability                                                    │
│   - Performance metrics                                         │
│   - Resource usage                                              │
│                                                                  │
│ Autonomy Center                                                  │
│   - Brain autonomy settings                                     │
│   - Autonomy levels                                             │
│                                                                  │
│ Extensions & Skills                                              │
│   - Plugin management                                           │
│   - Skill configuration                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Platform pages are in Settings menu (not competing with execution)
✅ Settings is the primary platform page (most frequently used)
✅ Policy/Trust/Observability/Autonomy are secondary (admin/analytical)
✅ Extensions & Skills are tertiary (rarely used)
```

### 13.3 Project Area Strategy

**Principle:** Projects are the **entry point** to executions, not a separate concept.

```
PROJECT AREA (left sidebar):

┌─────────────────────────────────────────────────────────────────┐
│ Projects                                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ▼ Pi                                                             │
│   Active Executions:                                             │
│   • exec-123 (running) ← SELECTED                               │
│   • exec-124 (paused)                                           │
│                                                                  │
│   Recent Executions:                                             │
│   • exec-122 (completed)                                        │
│   • exec-121 (failed)                                           │
│                                                                  │
│ ▼ Other Project                                                  │
│   Active Executions:                                             │
│   • exec-200 (running)                                          │
│                                                                  │
│ Quick Actions:                                                   │
│ [+ Upload Plan]                                                  │
│ [+ New Task]                                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Projects → Executions is 1 click (not 2)
✅ Active executions are prominent (not buried in history)
✅ Quick actions are visible (upload plan, new task)
✅ No separate "Browse" tab (simpler navigation)
```

---

## 14. Right Sidebar Strategy

### 14.1 Right Sidebar Sections

```
┌─────────────────────────────────────────────────────────────────┐
│ Right Sidebar (320px)                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Events (filtered)                                            │ │
│ │                                                              │ │
│ │ Filter: [Errors only ▼]  Workspace: [All ▼]                 │ │
│ │                                                              │ │
│ │ [14:23:42] ws-1 agent-1 npm test (exit 0) ✅                 │ │
│ │ [14:23:29] ws-1 agent-1 npm run build (exit 0) ✅            │ │
│ │ [14:23:13] ws-1 agent-1 npm install (exit 0) ✅              │ │
│ │ [14:23:05] ws-4 test suite failing ⚠️                        │ │
│ │ [14:23:01] ws-3 started 🟢                                   │ │
│ │                                                              │ │
│ │ Auto-scroll: ON                                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Control Actions (if workspace selected)                      │ │
│ │                                                              │ │
│ │ Selected: ws-3                                               │ │
│ │                                                              │ │
│ │ [Pause] [Stop] [Cancel] [Retry]                              │ │
│ │                                                              │ │
│ │ [Issue Directive →]                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Context                                                      │ │
│ │                                                              │ │
│ │ [Transcript] [Artifacts] [Plan Summary]                      │ │
│ │                                                              │ │
│ │ Transcript:                                                  │ │
│ │ [14:23:01] Worker started                                    │ │
│ │ [14:23:05] Running: npm install                              │ │
│ │ [14:23:13] Command completed (exit 0)                        │ │
│ │ [14:23:14] Running: npm run build                            │ │
│ │ [14:23:29] Command completed (exit 0)                        │ │
│ │ [14:23:30] Running: npm test                                 │ │
│ │ [14:23:42] (running...)                                      │ │
│ │                                                              │ │
│ │ [View Full Transcript →]                                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Key improvements:
✅ Events are filtered (errors only by default, workspace filter available)
✅ Control Actions appear only when workspace is selected (context-aware)
✅ Context section shows transcript/artifacts/summary (quick access)
✅ No alerts section (alerts are shown in Escalation Center)
✅ No Plan Summary duplicate (summary is in Execution Overview)
```

---

## 15. Navigation Strategy

### 15.1 Navigation Principles

1. **Primary views are tabbed** (Overview | Workspaces | Files | Logs)
2. **Secondary views are dropdown menus** (Brain | Settings | History)
3. **No sidebar tabs** (Browse/Queue/Chat removed)
4. **Breadcrumb trail** (Project > Execution > Workspace)
5. **Quick actions always visible** (Upload Plan, New Task)

### 15.2 Navigation Flow

```
User lands on dashboard
  ↓
Redirect to /projects (or last selected project)
  ↓
User sees Project List with active executions
  ↓
User clicks execution (e.g., exec-123)
  ↓
URL: /projects/:projectId/executions/:planExecId
  ↓
Center column shows Execution Overview (default tab)
  ↓
User can switch tabs:
  [Overview] [Workspaces] [Files] [Logs]
  ↓
User clicks workspace card (e.g., ws-3)
  ↓
URL: /projects/:projectId/executions/:planExecId/workspaces/:workspaceId
  ↓
Center column shows Worker Detail
  ↓
Right sidebar shows Control Actions for ws-3
  ↓
User can navigate back:
  [← Back to Workspaces] or breadcrumb [Pi > exec-123 > ws-3]
```

### 15.3 Keyboard Navigation

```
KEYBOARD SHORTCUTS:

Global:
  Cmd/Ctrl + K        → Command palette (search projects, executions, workspaces)
  Cmd/Ctrl + /        → Focus search bar
  Cmd/Ctrl + .        → Toggle right sidebar
  Cmd/Ctrl + ,        → Open settings
  Escape              → Close dialog/panel

Navigation:
  1                   → Switch to Overview tab
  2                   → Switch to Workspaces tab
  3                   → Switch to Files tab
  4                   → Switch to Logs tab
  ←/→                 → Previous/next workspace (when workspace selected)
  ↑/↓                 ↑ Previous/next execution (when execution selected)

Control Actions:
  P                   → Pause (when execution/workspace selected)
  S                   → Stop (when execution/workspace selected, requires confirmation)
  C                   → Cancel (when execution/workspace selected, requires confirmation)
  R                   → Retry (when workspace selected)

Accessibility:
  Tab                 → Move focus to next element
  Shift+Tab           → Move focus to previous element
  Enter/Space         → Activate focused element
  Arrow keys          → Navigate within focused component
```

---

## 16. State Ownership and Data Flow

### 16.1 State Ownership

```
┌─────────────────────────────────────────────────────────────────┐
│ STATE OWNERSHIP                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ execution-core (contracts)                                       │
│ ├── ExecutionReadModel (12 query methods)                       │
│ ├── ExecutionCommand (11 command types)                         │
│ ├── ExecutionEvent (39 event types)                             │
│ ├── ICommandLogStream (live command output)                     │
│ ├── IWorkerTranscriptStore (structured event stream)            │
│ ├── ISnapshotArtifactStore (file snapshots)                     │
│ └── WorkerAdapter (agent execution)                             │
│                                                                  │
│ execution-service (facade)                                       │
│ ├── handleExecutionCommand() (command dispatcher)               │
│ ├── createExecutionReadModel() (read model factory)             │
│ └── getCommandLogStream() (log stream accessor)                 │
│                                                                  │
│ web-server (API layer)                                           │
│ ├── REST endpoints (GET/POST/PATCH/DELETE)                      │
│ ├── SSE endpoints (event streams)                               │
│ ├── WebSocket endpoints (live logs)                             │
│ └── State store access (JsonStateStore / DbStateStore)          │
│                                                                  │
│ dashboard (UI layer)                                             │
│ ├── React Query (server state)                                  │
│ ├── Local state (UI state)                                      │
│ ├── Context (shared state)                                      │
│ └── Hooks (data fetching + transformations)                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ DATA FLOW                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Plan Runner (coding-agent)                                       │
│   ↓                                                              │
│   emits ExecutionEvent                                           │
│   ↓                                                              │
│ State Store (JsonStateStore / DbStateStore)                      │
│   ↓                                                              │
│   persists event                                                 │
│   ↓                                                              │
│ ExecutionReadModel (execution-service)                           │
│   ↓                                                              │
│   queries state store                                            │
│   ↓                                                              │
│ Web Server (REST/SSE/WebSocket)                                  │
│   ↓                                                              │
│   serves data to dashboard                                       │
│   ↓                                                              │
│ Dashboard (React Query + hooks)                                  │
│   ↓                                                              │
│   renders UI                                                     │
│   ↓                                                              │
│ User interacts                                                   │
│   ↓                                                              │
│ Dashboard dispatches action                                      │
│   ↓                                                              │
│ POST /api/human/intervene/:peid/:wsId                            │
│   ↓                                                              │
│ execution-service.handleExecutionCommand()                       │
│   ↓                                                              │
│ State Store (mutates state)                                      │
│   ↓                                                              │
│ emits ExecutionEvent                                             │
│   ↓                                                              │
│ SSE/WebSocket pushes event to dashboard                          │
│   ↓                                                              │
│ Dashboard updates UI                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 16.3 React Query Strategy

```typescript
// Proposed React Query keys
const queryKeys = {
  projects: ['projects'] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  executions: (projectId: string) => ['projects', projectId, 'executions'] as const,
  execution: (projectId: string, planExecId: string) => 
    ['projects', projectId, 'executions', planExecId] as const,
  workspaces: (planExecId: string) => ['executions', planExecId, 'workspaces'] as const,
  workspace: (planExecId: string, workspaceId: string) => 
    ['executions', planExecId, 'workspaces', workspaceId] as const,
  workerContext: (planExecId: string, workspaceId: string) => 
    ['executions', planExecId, 'workspaces', workspaceId, 'context'] as const,
  commandHistory: (planExecId: string, workspaceId: string) => 
    ['executions', planExecId, 'workspaces', workspaceId, 'commands'] as const,
  fileTree: (planExecId: string) => ['executions', planExecId, 'files'] as const,
  fileContent: (planExecId: string, filePath: string) => 
    ['executions', planExecId, 'files', filePath] as const,
  fileDiff: (planExecId: string, filePath: string) => 
    ['executions', planExecId, 'files', filePath, 'diff'] as const,
  leadEscalations: (planExecId: string) => 
    ['executions', planExecId, 'escalations'] as const,
  validationStatus: (planExecId: string) => 
    ['executions', planExecId, 'validation'] as const,
};

// Invalidation strategy
// When execution event received via SSE:
queryClient.invalidateQueries({ queryKey: ['executions', planExecId] });
// This invalidates all nested queries (workspaces, commands, files, etc.)
```

---

## 17. API / Read Model Requirements

### 17.1 Read Model Gaps (from interface-map.md)

| Read Model Method | Current Status | Required For | Priority |
|-------------------|----------------|--------------|----------|
| `getCommandHistory()` | Stub (returns `[]`) | Worker Detail - Command History | HIGH |
| `getLeadDirectives()` | Stub (returns `[]`) | Worker Detail - Retry/Escalation History | HIGH |
| `getLeadEscalations()` | Stub (returns `[]`) | Escalation Center - Active Escalations | HIGH |
| `getFinalValidationStatus()` | Stub (returns default) | Execution Overview - Validation Status | MEDIUM |
| `getFileContent()` | Stub (returns `null`) | File Explorer - File Content | MEDIUM |
| `getFileDiff()` | Stub (returns `[]`) | Diff Viewer - Unified Diff | MEDIUM |

### 17.2 API Endpoint Requirements

```
REQUIRED ENDPOINTS (already exist, need to use read model):

GET /api/projects/:projectId/executions/:planExecId
  → Should use ExecutionReadModel.getPlanSummary()
  → Currently reads state store directly

GET /api/projects/:projectId/executions/:planExecId/workspaces
  → Should use ExecutionReadModel.getWorkspaceSummary()
  → Currently reads state store directly

GET /api/projects/:projectId/executions/:planExecId/workspaces/:workspaceId
  → Should use ExecutionReadModel.getWorkerContext()
  → Currently reads state store directly

GET /api/projects/:projectId/executions/:planExecId/files
  → Should use ExecutionReadModel.getFileTree()
  → Currently uses git directly

GET /api/projects/:projectId/executions/:planExecId/files/:filePath
  → Should use ExecutionReadModel.getFileContent()
  → Currently reads filesystem directly

GET /api/projects/:projectId/executions/:planExecId/files/:filePath/diff
  → Should use ExecutionReadModel.getFileDiff()
  → Currently uses git directly

POST /api/projects/:projectId/executions/:planExecId/control
  → Should use execution-service.handleExecutionCommand()
  → Currently writes control file directly

POST /api/projects/:projectId/executions/:planExecId/workspaces/:workspaceId/control
  → Should use execution-service.handleExecutionCommand()
  → Currently writes control file directly
```

### 17.3 New API Endpoints Needed

```
NEW ENDPOINTS (for new features):

GET /api/projects/:projectId/executions/:planExecId/bottlenecks
  → Returns current bottlenecks (dependency blockers, resource constraints)
  → Uses ExecutionReadModel.getDependencyGraph() + getBlockedWorkspaces()

GET /api/projects/:projectId/executions/:planExecId/dependency-graph
  → Returns workspace dependency graph (for visualization)
  → Uses ExecutionReadModel.getDependencyGraph()

POST /api/projects/:projectId/executions/:planExecId/workspaces/:workspaceId/directive
  → Issues human directive to workspace
  → Uses execution-service.handleExecutionCommand({ type: "issue_human_directive" })

POST /api/projects/:projectId/executions/:planExecId/workspaces/:workspaceId/escalation/:escalationId/resolve
  → Resolves escalation
  → Uses execution-service.handleExecutionCommand({ type: "resolve_escalation" })

GET /api/projects/:projectId/executions/:planExecId/artifacts
  → Returns list of artifacts (snapshots, reports, validation)
  → Uses ISnapshotArtifactStore.list()

GET /api/projects/:projectId/executions/:planExecId/artifacts/:artifactId
  → Returns specific artifact
  → Uses ISnapshotArtifactStore.get()
```

---

## 18. Component Refactor Strategy

### 18.1 Component Inventory

```
COMPONENTS TO KEEP (as-is):
├── CockpitPanels.tsx              (P41.12 container - good)
├── ControlActionsPanel.tsx        (control actions - good)
├── HumanDirectivePanel.tsx        (human directives - good)
├── LeadEscalationPanel.tsx        (escalations - good)
├── WorkerContextInspector.tsx     (worker context - good)
├── LiveLogTerminal.tsx            (live logs - good)
├── StatusBadge.tsx                (status badge - good)
├── StatCard.tsx                   (stat card - good)
├── IconBtn.tsx                    (icon button - good)
├── LabeledBtn.tsx                 (labeled button - good)
└── SectionHeader.tsx              (section header - good)

COMPONENTS TO SPLIT:
├── App.tsx (1364 lines)
│   → Split into: Shell.tsx, Layout.tsx, Navigation.tsx, Routes.tsx
├── ObservabilityCockpit.tsx (400+ lines)
│   → Split into: PerformanceMetrics.tsx, ResourceUsage.tsx, Timeline.tsx
├── LeadAgentDashboard.tsx (400+ lines)
│   → Split into: LeadAgentStatus.tsx, DirectiveHistory.tsx, EscalationHistory.tsx
└── BatchOSDashboard.tsx (300+ lines)
    → Split into: BatchOverview.tsx, BatchTimeline.tsx, BatchControls.tsx

COMPONENTS TO MOVE:
├── FileExplorer.tsx
│   → Move to features/file-explorer/
│   → Refactor to use ExecutionReadModel.getFileTree()
├── DiffViewer.tsx
│   → Move to features/diff-viewer/
│   → Refactor to use ExecutionReadModel.getFileDiff()
├── BrainStatePage.tsx
│   → Move to features/brain/state/
├── BrainMemoryPage.tsx
│   → Move to features/brain/memory/
├── BrainReflectionsPage.tsx
│   → Move to features/brain/reflections/
├── BrainTrustPage.tsx
│   → Move to features/brain/trust/
├── BrainOvernightPage.tsx
│   → Move to features/brain/overnight/
├── DigestPage.tsx
│   → Move to features/brain/digest/
├── BrainInboxPage.tsx
│   → Move to features/brain/inbox/
├── PolicyAuditCenter.tsx
│   → Move to features/platform/policy/
├── TrustDashboard.tsx
│   → Move to features/platform/trust/
├── AutonomyCenter.tsx
│   → Move to features/platform/autonomy/
└── ExtensionsManager.tsx
    → Move to features/platform/extensions/

COMPONENTS TO DEPRECATE:
├── Header.tsx (legacy - replaced by Topbar)
├── WorkerList.tsx (legacy - replaced by WorkspaceBoard)
├── ControlButtons.tsx (legacy - replaced by ControlActionsPanel)
├── LogViewer.tsx (legacy - replaced by LiveLogTerminal)
├── PlanSummary.tsx (duplicate - merged into ExecutionOverview)
├── QueuePanel.tsx (duplicate - merged into ExecutionOverview)
└── EventFeed.tsx (duplicate - merged into RightSidebar Events section)

COMPONENTS TO CREATE:
├── Shell.tsx
│   - Top-level layout container
│   - Manages sidebar visibility
│   - Renders Topbar, LeftSidebar, CenterColumn, RightSidebar
├── Topbar.tsx
│   - Logo, project selector, execution selector
│   - Brain/Settings/History dropdown menus
│   - Help button
├── LeftSidebar.tsx
│   - Project list with active executions
│   - Quick actions (Upload Plan, New Task)
├── CenterColumn.tsx
│   - Tab bar (Overview | Workspaces | Files | Logs)
│   - Renders active tab content
├── RightSidebar.tsx
│   - Events section (filtered)
│   - Control Actions section (context-aware)
│   - Context section (Transcript, Artifacts, Plan Summary)
├── ExecutionOverview.tsx
│   - Plan header, metrics grid, workspace summary
│   - Current bottleneck, latest escalation
│   - Validation status, next action
├── WorkspaceBoard.tsx
│   - Grouped workspace cards (Running, Blocked, Ready, Completed, Failed)
│   - Workspace card shows worker, model, attempt, files, commands
├── WorkerDetail.tsx (refactored)
│   - Worker header, current phase, context
│   - Command history, transcript
│   - Validation evidence, retry/escalation history
├── FileExplorer.tsx (refactored)
│   - File tree (left), file content (right)
│   - Uses ExecutionReadModel.getFileTree()
├── DiffViewer.tsx (refactored)
│   - File info, unified diff
│   - Uses ExecutionReadModel.getFileDiff()
├── EscalationCenter.tsx
│   - Active escalations, deadlock dependencies
│   - Human directive input
├── StatusBar.tsx
│   - Execution status, workspace counts, cost, tokens
└── CommandPalette.tsx
    - Search projects, executions, workspaces
    - Keyboard shortcut: Cmd/Ctrl + K
```

### 18.2 Proposed Folder Structure

```
packages/web-ui/dashboard/src/
├── App.tsx                          (entry point, minimal)
├── Shell.tsx                        (top-level layout)
├── Topbar.tsx                       (top navigation bar)
├── LeftSidebar.tsx                  (left navigation)
├── CenterColumn.tsx                 (center content)
├── RightSidebar.tsx                 (right context panel)
├── StatusBar.tsx                    (bottom status bar)
├── CommandPalette.tsx               (search/command palette)
│
├── components/
│   ├── primitives/                  (reusable UI primitives)
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Dropdown.tsx
│   │   ├── Tabs.tsx
│   │   ├── Tooltip.tsx
│   │   └── ...
│   │
│   ├── execution/                   (execution-related components)
│   │   ├── ExecutionOverview/
│   │   │   ├── PlanHeader.tsx
│   │   │   ├── MetricsGrid.tsx
│   │   │   ├── WorkspaceSummary.tsx
│   │   │   ├── CurrentBottleneck.tsx
│   │   │   ├── LatestEscalation.tsx
│   │   │   ├── ValidationStatus.tsx
│   │   │   └── NextAction.tsx
│   │   ├── WorkspaceBoard/
│   │   │   ├── WorkspaceCard.tsx
│   │   │   └── WorkspaceGroup.tsx
│   │   ├── WorkerDetail/
│   │   │   ├── WorkerHeader.tsx
│   │   │   ├── CurrentPhase.tsx
│   │   │   ├── Context.tsx
│   │   │   ├── CommandHistory.tsx
│   │   │   ├── Transcript.tsx
│   │   │   ├── ValidationEvidence.tsx
│   │   │   └── RetryEscalationHistory.tsx
│   │   ├── ControlActions/
│   │   │   ├── ControlActionsPanel.tsx
│   │   │   ├── HumanDirectivePanel.tsx
│   │   │   └── ConfirmationDialog.tsx
│   │   └── EscalationCenter/
│   │       ├── EscalationCard.tsx
│   │       ├── DeadlockDependencies.tsx
│   │       └── HumanDirectiveInput.tsx
│   │
│   ├── files/                       (file-related components)
│   │   ├── FileExplorer/
│   │   │   ├── FileTree.tsx
│   │   │   ├── FileContent.tsx
│   │   │   └── FileStatusLegend.tsx
│   │   └── DiffViewer/
│   │       ├── FileInfo.tsx
│   │       └── UnifiedDiff.tsx
│   │
│   ├── logs/                        (log-related components)
│   │   ├── LiveLogTerminal/
│   │   │   ├── TerminalOutput.tsx
│   │   │   ├── CommandSummary.tsx
│   │   │   └── Filters.tsx
│   │   └── Transcript/
│   │       └── TranscriptEvents.tsx
│   │
│   ├── brain/                       (brain-related components)
│   │   ├── ProposalInbox/
│   │   │   ├── ProposalCard.tsx
│   │   │   └── ProposalActions.tsx
│   │   ├── MemoryBrowser/
│   │   │   ├── MemoryCard.tsx
│   │   │   └── MemorySearch.tsx
│   │   └── Reflections/
│   │       └── ReflectionCard.tsx
│   │
│   └── platform/                    (platform-related components)
│       ├── Settings/
│       │   ├── GeneralSettings.tsx
│       │   ├── WorkerConcurrency.tsx
│       │   └── SafetyProfiles.tsx
│       ├── PolicyAudit/
│       │   └── AuditRules.tsx
│       ├── TrustDashboard/
│       │   └── TrustMetrics.tsx
│       └── Observability/
│           ├── PerformanceMetrics.tsx
│           └── ResourceUsage.tsx
│
├── hooks/                           (data fetching + transformations)
│   ├── useProjects.ts
│   ├── useExecutions.ts
│   ├── useWorkspaces.ts
│   ├── useWorkerContext.ts
│   ├── useCommandHistory.ts
│   ├── useFileTree.ts
│   ├── useFileContent.ts
│   ├── useFileDiff.ts
│   ├── useLeadEscalations.ts
│   ├── useValidationStatus.ts
│   ├── useControlActions.ts
│   ├── useHumanDirectives.ts
│   ├── useLiveLogs.ts
│   ├── useTranscript.ts
│   ├── useEvents.ts
│   ├── useBrainProposals.ts
│   ├── useBrainMemories.ts
│   ├── useBrainReflections.ts
│   └── ...
│
├── contexts/                        (shared state)
│   ├── ProjectContext.tsx
│   ├── ExecutionContext.tsx
│   └── WorkspaceContext.tsx
│
├── routes/                          (route definitions)
│   ├── index.tsx
│   ├── projects.tsx
│   ├── executions.tsx
│   ├── brain.tsx
│   ├── settings.tsx
│   └── history.tsx
│
├── features/                        (feature modules)
│   ├── file-explorer/
│   ├── diff-viewer/
│   ├── brain/
│   │   ├── state/
│   │   ├── memory/
│   │   ├── reflections/
│   │   ├── trust/
│   │   ├── overnight/
│   │   ├── digest/
│   │   └── inbox/
│   └── platform/
│       ├── policy/
│       ├── trust/
│       ├── autonomy/
│       └── extensions/
│
├── styles/                          (global styles)
│   ├── globals.css
│   └── tokens.css
│
└── utils/                           (utilities)
    ├── format.ts
    ├── date.ts
    └── constants.ts
```

---

## 19. Accessibility and Keyboard UX

### 19.1 Accessibility Principles

1. **Keyboard navigable** (all interactions possible via keyboard)
2. **Screen reader friendly** (ARIA labels, roles, live regions)
3. **Focus visible** (clear focus indicators)
4. **Color contrast** (WCAG AA minimum)
5. **Reduced motion** (respect prefers-reduced-motion)

### 19.2 ARIA Strategy

```typescript
// Example: ExecutionOverview component
<div role="region" aria-label="Execution Overview">
  <h2>Execution Overview</h2>
  
  <div role="group" aria-label="Plan Information">
    <h3>Plan: {planName}</h3>
    <p>Status: {status}</p>
  </div>
  
  <div role="group" aria-label="Metrics">
    <div role="status" aria-live="polite">
      Progress: {progress}%
    </div>
    <div role="status" aria-live="polite">
      Cost: ${cost}
    </div>
  </div>
  
  <div role="group" aria-label="Workspaces">
    <h3>Workspaces</h3>
    <ul role="list">
      {workspaces.map(ws => (
        <li role="listitem" key={ws.id}>
          <button
            aria-label={`Workspace ${ws.id}, status ${ws.status}`}
            onClick={() => selectWorkspace(ws.id)}
          >
            {ws.id} - {ws.status}
          </button>
        </li>
      ))}
    </ul>
  </div>
</div>
```

### 19.3 Focus Management

```typescript
// Example: Modal focus trap
useEffect(() => {
  if (isOpen) {
    // Store previously focused element
    previousFocusRef.current = document.activeElement;
    
    // Focus first focusable element in modal
    const firstFocusable = modalRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
    
    // Trap focus within modal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements?.[0];
        const lastElement = focusableElements?.[focusableElements.length - 1];
        
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
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  } else {
    // Restore focus when modal closes
    previousFocusRef.current?.focus();
  }
}, [isOpen]);
```

### 19.4 Color Contrast

```css
/* Ensure WCAG AA compliance (4.5:1 for normal text, 3:1 for large text) */

/* Light mode */
:root {
  --color-text: #1C1917;        /* stone-900 */
  --color-text-muted: #78716C;  /* stone-500 - 4.6:1 on white */
  --color-background: #FFFFFF;
  --color-surface: #F7F6F3;
}

/* Dark mode */
.dark {
  --color-text: #E7E5E4;        /* stone-200 */
  --color-text-muted: #A8A29E;  /* stone-400 - 4.7:1 on #1E1E1E */
  --color-background: #161616;
  --color-surface: #1E1E1E;
}
```

### 19.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 20. Testing Strategy

### 20.1 Test Pyramid

```
┌─────────────────────────────────────────────────────────────────┐
│ E2E Tests (Playwright)                                           │
│ - Critical user flows                                           │
│ - Cross-browser compatibility                                    │
│ - Accessibility audit                                            │
├─────────────────────────────────────────────────────────────────┤
│ Integration Tests (React Testing Library)                        │
│ - Component interactions                                         │
│ - API integration                                                │
│ - State management                                               │
├─────────────────────────────────────────────────────────────────┤
│ Unit Tests (Vitest)                                              │
│ - Utility functions                                              │
│ - Hooks                                                          │
│ - Reducers                                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 20.2 Test Coverage Requirements

| Component Type | Unit Tests | Integration Tests | E2E Tests |
|----------------|------------|-------------------|-----------|
| Primitives (Button, Card, etc.) | ✅ Required | ❌ Optional | ❌ Optional |
| Execution components (Overview, Workspace Board, etc.) | ✅ Required | ✅ Required | ✅ Required |
| Control actions (Pause, Stop, Cancel, etc.) | ✅ Required | ✅ Required | ✅ Required |
| Brain components (Proposal Inbox, Memory, etc.) | ✅ Required | ✅ Required | ❌ Optional |
| Platform components (Settings, Policy, etc.) | ✅ Required | ✅ Required | ❌ Optional |
| Hooks (useProjects, useExecutions, etc.) | ✅ Required | ✅ Required | ❌ Optional |
| Utilities (format, date, etc.) | ✅ Required | ❌ Optional | ❌ Optional |

### 20.3 Critical Test Scenarios

```
E2E TESTS (Playwright):

1. Execution Overview Flow
   - User lands on dashboard
   - User selects project
   - User selects execution
   - User sees Execution Overview with correct data
   - User clicks workspace card
   - User sees Worker Detail with correct data

2. Control Action Flow
   - User selects workspace
   - User clicks [Stop] button
   - Confirmation dialog appears
   - User confirms
   - Workspace status updates to "stopped"
   - Success toast appears

3. File Explorer Flow
   - User navigates to Files tab
   - User sees file tree with correct status (created/modified/deleted)
   - User clicks file
   - User sees file content
   - User clicks [View Diff]
   - User sees unified diff

4. Escalation Resolution Flow
   - User navigates to Escalation Center
   - User sees active escalation
   - User clicks [Retry with Directive]
   - User enters directive
   - User clicks [Send]
   - Escalation status updates to "resolved"

5. Accessibility Audit
   - All interactive elements are keyboard accessible
   - All images have alt text
   - Color contrast meets WCAG AA
   - Focus indicators are visible
   - Screen reader announces dynamic content

INTEGRATION TESTS (React Testing Library):

1. ExecutionOverview renders correct data
   - Mock API responses
   - Render component
   - Assert plan name, status, metrics are displayed
   - Assert workspace cards are rendered
   - Assert bottleneck and escalation are shown

2. ControlActionsPanel dispatches correct action
   - Mock API
   - Render component with workspace selected
   - Click [Stop] button
   - Assert confirmation dialog appears
   - Click [Confirm]
   - Assert POST /api/human/intervene called with correct body
   - Assert success toast appears

3. FileExplorer uses read model
   - Mock ExecutionReadModel.getFileTree()
   - Render component
   - Assert file tree is rendered from read model (not git)
   - Click file
   - Mock ExecutionReadModel.getFileContent()
   - Assert file content is rendered from read model

UNIT TESTS (Vitest):

1. format.ts functions
   - formatCost(0.42) → "$0.42"
   - formatTokens(12400) → "12.4k"
   - formatPercent(0.78) → "78%"

2. date.ts functions
   - formatRelativeTime(Date.now() - 120000) → "2 min ago"
   - formatDuration(35000) → "35s"

3. useWorkspaces hook
   - Mock API response
   - Call hook
   - Assert workspaces are returned
   - Assert loading state
   - Assert error state
```

### 20.4 Fake/Static Data Detection

```typescript
// Test to detect fake/static data in components
test('ExecutionOverview does not use fake data', () => {
  const { container } = render(<ExecutionOverview planExecId="exec-123" />);
  
  // Assert no hardcoded values
  expect(container.textContent).not.toContain('Sample Plan');
  expect(container.textContent).not.toContain('$0.00');
  expect(container.textContent).not.toContain('0/0 workspaces');
  
  // Assert data comes from API
  expect(screen.getByText(/P42 Execution Cockpit/)).toBeInTheDocument();
  expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
  expect(screen.getByText(/3\/5 workspaces/)).toBeInTheDocument();
});

test('WorkerDetail does not use stub read model methods', () => {
  // Mock read model methods
  const mockGetCommandHistory = vi.fn().mockResolvedValue([
    { command: 'npm install', duration: 8000, exitCode: 0, status: 'done' },
  ]);
  
  vi.mocked(ExecutionReadModel.getCommandHistory).mockImplementation(mockGetCommandHistory);
  
  render(<WorkerDetail planExecId="exec-123" workspaceId="ws-1" />);
  
  // Assert getCommandHistory was called
  expect(mockGetCommandHistory).toHaveBeenCalledWith('exec-123', 'ws-1');
  
  // Assert command history is rendered
  expect(screen.getByText(/npm install/)).toBeInTheDocument();
  expect(screen.getByText(/8s/)).toBeInTheDocument();
  expect(screen.getByText(/exit 0/)).toBeInTheDocument();
});
```

---

## 21. Migration Plan

### 21.1 Phase Overview

```
Phase 1: Shell and Navigation Cleanup (Week 1-2)
  - Create Shell, Topbar, LeftSidebar, CenterColumn, RightSidebar, StatusBar
  - Refactor App.tsx into smaller components
  - Implement new navigation structure
  - Remove sidebar tabs (Browse/Queue/Chat)

Phase 2: Execution Cockpit Core (Week 3-4)
  - Create ExecutionOverview component
  - Create WorkspaceBoard component
  - Implement tabbed center column
  - Connect to read model (where available)

Phase 3: Worker/File/Log/Detail Views (Week 5-6)
  - Refactor WorkerDetail component
  - Refactor FileExplorer to use read model
  - Refactor DiffViewer to use read model
  - Refactor LiveLogTerminal

Phase 4: Escalation/Control UX (Week 7-8)
  - Create EscalationCenter component
  - Refactor ControlActionsPanel
  - Implement confirmation dialogs
  - Connect control actions to execution-service

Phase 5: Brain/Platform Regrouping (Week 9-10)
  - Move Brain pages to features/brain/
  - Move Platform pages to features/platform/
  - Implement dropdown menus for Brain/Settings
  - Remove duplicate Brain/Platform pages from sidebar

Phase 6: Polish, Accessibility, React-Doctor Audit (Week 11-12)
  - Implement keyboard navigation
  - Add ARIA labels and roles
  - Run react-doctor audit
  - Fix accessibility issues
  - Write E2E tests for critical flows
```

### 21.2 Phase 1: Shell and Navigation Cleanup

```
TASKS:

1. Create Shell.tsx
   - Top-level layout container
   - Manages sidebar visibility
   - Renders Topbar, LeftSidebar, CenterColumn, RightSidebar, StatusBar
   - Estimated: 2 days

2. Create Topbar.tsx
   - Logo, project selector, execution selector
   - Brain/Settings/History dropdown menus
   - Help button
   - Estimated: 3 days

3. Create LeftSidebar.tsx
   - Project list with active executions
   - Quick actions (Upload Plan, New Task)
   - Estimated: 2 days

4. Create CenterColumn.tsx
   - Tab bar (Overview | Workspaces | Files | Logs)
   - Renders active tab content
   - Estimated: 2 days

5. Create RightSidebar.tsx
   - Events section (filtered)
   - Control Actions section (context-aware)
   - Context section (Transcript, Artifacts, Plan Summary)
   - Estimated: 3 days

6. Create StatusBar.tsx
   - Execution status, workspace counts, cost, tokens
   - Estimated: 1 day

7. Refactor App.tsx
   - Split into Shell, Routes, Navigation
   - Remove 1000+ lines of layout/navigation code
   - Estimated: 3 days

8. Remove sidebar tabs
   - Remove Browse/Queue/Chat tabs
   - Move Queue to ExecutionOverview
   - Move Chat to overlay panel (optional)
   - Estimated: 2 days

TOTAL: 18 days (2.5 weeks)

DEPENDENCIES: None
RISK: Low (refactoring existing code)
VALIDATION:
  - Dashboard renders with new shell
  - Navigation works (project selector, execution selector, dropdown menus)
  - No regressions in existing functionality
```

### 21.3 Phase 2: Execution Cockpit Core

```
TASKS:

1. Create ExecutionOverview component
   - PlanHeader (plan name, status, start time, estimated completion)
   - MetricsGrid (progress, cost, tokens, burn rate)
   - WorkspaceSummary (visual grid of workspace cards)
   - CurrentBottleneck (dependency blockers, resource constraints)
   - LatestEscalation (most recent escalation)
   - ValidationStatus (plan and workspace validation)
   - NextAction (recommended next action)
   - Estimated: 5 days

2. Create WorkspaceBoard component
   - WorkspaceCard (worker, model, attempt, files, commands)
   - WorkspaceGroup (grouped by state: Running, Blocked, Ready, Completed, Failed)
   - Estimated: 3 days

3. Implement tabbed center column
   - Tab bar component
   - Tab switching logic
   - URL-based tab state (for deep linking)
   - Estimated: 2 days

4. Connect to read model
   - Use ExecutionReadModel.getPlanSummary()
   - Use ExecutionReadModel.getWorkspaceSummary()
   - Use ExecutionReadModel.getLeadEscalations() (stub for now)
   - Use ExecutionReadModel.getFinalValidationStatus() (stub for now)
   - Estimated: 3 days

TOTAL: 13 days (2 weeks)

DEPENDENCIES: Phase 1 complete
RISK: Medium (depends on read model stubs being fixed in parallel)
VALIDATION:
  - ExecutionOverview renders with correct data
  - WorkspaceBoard shows grouped workspaces
  - Tab switching works
  - URL reflects active tab (deep linking)
```

### 21.4 Phase 3: Worker/File/Log/Detail Views

```
TASKS:

1. Refactor WorkerDetail component
   - Split into sub-components (WorkerHeader, CurrentPhase, Context, CommandHistory, Transcript, ValidationEvidence, RetryEscalationHistory)
   - Use ExecutionReadModel.getWorkerContext()
   - Use ExecutionReadModel.getCommandHistory() (stub for now)
   - Use IWorkerTranscriptStore.readTranscriptEvents()
   - Estimated: 4 days

2. Refactor FileExplorer to use read model
   - Move to features/file-explorer/
   - Use ExecutionReadModel.getFileTree()
   - Use ExecutionReadModel.getFileContent() (stub for now)
   - Estimated: 3 days

3. Refactor DiffViewer to use read model
   - Move to features/diff-viewer/
   - Use ExecutionReadModel.getFileDiff() (stub for now)
   - Estimated: 2 days

4. Refactor LiveLogTerminal
   - Split into sub-components (TerminalOutput, CommandSummary, Filters)
   - Use ICommandLogStream (live) or ExecutionReadModel.getCommandHistory() (historical)
   - Estimated: 2 days

TOTAL: 11 days (1.5 weeks)

DEPENDENCIES: Phase 2 complete
RISK: High (depends on read model stubs being fixed)
VALIDATION:
  - WorkerDetail renders with correct data
  - FileExplorer uses read model (not git)
  - DiffViewer uses read model (not git)
  - LiveLogTerminal shows live command output
```

### 21.5 Phase 4: Escalation/Control UX

```
TASKS:

1. Create EscalationCenter component
   - EscalationCard (title, severity, what happened, why stuck, Lead Agent diagnosis, recommended actions)
   - DeadlockDependencies (dependency graph visualization)
   - HumanDirectiveInput (textarea + send button)
   - Estimated: 4 days

2. Refactor ControlActionsPanel
   - Context-aware controls (plan-level vs workspace-level)
   - Confirmation dialogs for dangerous actions
   - Result feedback (success/failure toast)
   - Estimated: 3 days

3. Implement confirmation dialogs
   - ConfirmationDialog component (title, message, actions, cancel/confirm buttons)
   - Used for Stop, Cancel, Force Kill
   - Estimated: 2 days

4. Connect control actions to execution-service
   - POST /api/human/intervene/:peid/:wsId
   - POST /api/human/directive
   - POST /api/human/escalations/:escId/resolve
   - All go through execution-service.handleExecutionCommand()
   - Estimated: 3 days

TOTAL: 12 days (2 weeks)

DEPENDENCIES: Phase 3 complete
RISK: Medium (control actions already work, just need refactoring)
VALIDATION:
  - EscalationCenter shows active escalations
  - Control actions dispatch to execution-service
  - Confirmation dialogs appear for dangerous actions
  - Result feedback (toast) appears after control action
```

### 21.6 Phase 5: Brain/Platform Regrouping

```
TASKS:

1. Move Brain pages to features/brain/
   - BrainStatePage → features/brain/state/
   - BrainMemoryPage → features/brain/memory/
   - BrainReflectionsPage → features/brain/reflections/
   - BrainTrustPage → features/brain/trust/
   - BrainOvernightPage → features/brain/overnight/
   - DigestPage → features/brain/digest/
   - BrainInboxPage → features/brain/inbox/
   - Estimated: 3 days

2. Move Platform pages to features/platform/
   - PolicyAuditCenter → features/platform/policy/
   - TrustDashboard → features/platform/trust/
   - AutonomyCenter → features/platform/autonomy/
   - ExtensionsManager → features/platform/extensions/
   - Estimated: 2 days

3. Implement dropdown menus for Brain/Settings
   - Brain dropdown menu in Topbar
   - Settings dropdown menu in Topbar
   - History dropdown menu in Topbar
   - Estimated: 3 days

4. Remove duplicate Brain/Platform pages from sidebar
   - Remove Brain pages from sidebar navigation
   - Remove Platform pages from sidebar navigation
   - Estimated: 1 day

TOTAL: 9 days (1.5 weeks)

DEPENDENCIES: Phase 4 complete
RISK: Low (just moving files and updating routes)
VALIDATION:
  - Brain pages accessible via dropdown menu
  - Platform pages accessible via Settings dropdown
  - No duplicate pages in sidebar
  - All routes still work
```

### 21.7 Phase 6: Polish, Accessibility, React-Doctor Audit

```
TASKS:

1. Implement keyboard navigation
   - Keyboard shortcuts (Cmd/Ctrl + K for command palette, 1/2/3/4 for tabs, etc.)
   - Focus management (trap focus in modals, restore focus on close)
   - Arrow key navigation within components
   - Estimated: 3 days

2. Add ARIA labels and roles
   - role="region" for major sections
   - role="group" for related controls
   - role="list" and role="listitem" for lists
   - role="button" for interactive elements
   - aria-label for non-text elements
   - aria-live for dynamic content
   - Estimated: 2 days

3. Run react-doctor audit
   - Lint checks
   - Accessibility checks
   - Performance checks
   - Bundle size checks
   - Estimated: 1 day

4. Fix accessibility issues
   - Color contrast (WCAG AA)
   - Focus indicators
   - Reduced motion
   - Screen reader announcements
   - Estimated: 2 days

5. Write E2E tests for critical flows
   - Execution Overview flow
   - Control Action flow
   - File Explorer flow
   - Escalation Resolution flow
   - Accessibility audit
   - Estimated: 4 days

TOTAL: 12 days (2 weeks)

DEPENDENCIES: Phase 5 complete
RISK: Low (polish and testing)
VALIDATION:
  - All interactive elements are keyboard accessible
  - All ARIA labels and roles are correct
  - react-doctor audit passes
  - Color contrast meets WCAG AA
  - E2E tests pass
```

---

## 22. What Not To Build Yet

### 22.1 Out of Scope for P42

```
DO NOT BUILD:

1. Multi-execution view
   - Viewing multiple executions side-by-side
   - Reason: Adds complexity without clear use case
   - Revisit in P43 if users request it

2. Execution comparison
   - Comparing two executions (metrics, workspaces, files)
   - Reason: Requires significant backend work (diff algorithm)
   - Revisit in P43 after P42 stabilizes

3. Execution replay
   - Replaying execution from transcript/events
   - Reason: Requires video-like playback infrastructure
   - Revisit in P44 if users need debugging tools

4. Execution export
   - Exporting execution data (JSON, CSV, PDF)
   - Reason: Requires export infrastructure
   - Revisit in P43 if users need reporting

5. Execution sharing
   - Sharing execution with other users (read-only link)
   - Reason: Requires authentication/authorization infrastructure
   - Revisit in P44 if multi-user support is needed

6. Execution comments
   - Adding comments to workspaces/files/events
   - Reason: Requires comment storage and notification system
   - Revisit in P44 if collaboration features are needed

7. Execution annotations
   - Drawing annotations on file diffs
   - Reason: Requires canvas/drawing library
   - Revisit in P44 if code review features are needed

8. Execution chat
   - Chatting with worker during execution
   - Reason: Requires real-time messaging infrastructure
   - Revisit in P44 if interactive debugging is needed

9. Execution templates
   - Saving execution as template for reuse
   - Reason: Requires template storage and instantiation
   - Revisit in P43 if users need repeatability

10. Execution scheduling
    - Scheduling execution to run at specific time
    - Reason: Requires job scheduler infrastructure
    - Revisit in P43 if users need automation
```

### 22.2 Deferred Features

```
DEFERRED TO P43:

1. Command palette (Cmd/Ctrl + K)
   - Search projects, executions, workspaces
   - Reason: Nice-to-have, not critical for P42
   - Implement in P43 after P42 stabilizes

2. Execution timeline visualization
   - Gantt chart of workspace execution
   - Reason: Requires timeline library
   - Implement in P43 if users need better visualization

3. Execution metrics dashboard
   - Historical metrics (cost, tokens, duration over time)
   - Reason: Requires time-series database
   - Implement in P43 if users need trend analysis

4. Execution notifications
   - Email/Slack notifications for execution events
   - Reason: Requires notification infrastructure
   - Implement in P43 if users need alerts

5. Execution webhooks
   - Webhook callbacks for execution events
   - Reason: Requires webhook infrastructure
   - Implement in P43 if users need integration
```

---

## 23. P42 Implementation Workspace Proposal

### 23.1 Workspace Overview

```
8 WORKSPACES FOR P42 IMPLEMENTATION:

WS-1: Read Model Stub Fixes
  - Fix 6 read model stubs (getCommandHistory, getLeadDirectives, getLeadEscalations, getFinalValidationStatus, getFileContent, getFileDiff)
  - Risk: HIGH (blocks all other workspaces)
  - Dependencies: None
  - Validation: All read model methods return real data
  - Estimated: 5 days

WS-2: Unified Control Path
  - Migrate all control actions to execution-service
  - Remove direct control file writes from web-server
  - Risk: HIGH (control actions must work)
  - Dependencies: None
  - Validation: All control actions go through execution-service
  - Estimated: 4 days

WS-3: Shell and Navigation Refactor (Phase 1)
  - Create Shell, Topbar, LeftSidebar, CenterColumn, RightSidebar, StatusBar
  - Refactor App.tsx into smaller components
  - Implement new navigation structure
  - Risk: LOW (refactoring existing code)
  - Dependencies: WS-1, WS-2 (nice-to-have, not blocking)
  - Validation: Dashboard renders with new shell, navigation works
  - Estimated: 18 days

WS-4: Execution Cockpit Core (Phase 2)
  - Create ExecutionOverview component
  - Create WorkspaceBoard component
  - Implement tabbed center column
  - Connect to read model
  - Risk: MEDIUM (depends on read model stubs being fixed)
  - Dependencies: WS-1 (required), WS-3 (required)
  - Validation: ExecutionOverview and WorkspaceBoard render with correct data
  - Estimated: 13 days

WS-5: Worker/File/Log/Detail Views (Phase 3)
  - Refactor WorkerDetail component
  - Refactor FileExplorer to use read model
  - Refactor DiffViewer to use read model
  - Refactor LiveLogTerminal
  - Risk: HIGH (depends on read model stubs being fixed)
  - Dependencies: WS-1 (required), WS-4 (required)
  - Validation: WorkerDetail, FileExplorer, DiffViewer, LiveLogTerminal work correctly
  - Estimated: 11 days

WS-6: Escalation/Control UX (Phase 4)
  - Create EscalationCenter component
  - Refactor ControlActionsPanel
  - Implement confirmation dialogs
  - Connect control actions to execution-service
  - Risk: MEDIUM (control actions already work, just need refactoring)
  - Dependencies: WS-2 (required), WS-5 (required)
  - Validation: EscalationCenter shows active escalations, control actions dispatch to execution-service
  - Estimated: 12 days

WS-7: Brain/Platform Regrouping (Phase 5)
  - Move Brain pages to features/brain/
  - Move Platform pages to features/platform/
  - Implement dropdown menus for Brain/Settings
  - Remove duplicate Brain/Platform pages from sidebar
  - Risk: LOW (just moving files and updating routes)
  - Dependencies: WS-3 (required)
  - Validation: Brain/Platform pages accessible via dropdown menus, no duplicates in sidebar
  - Estimated: 9 days

WS-8: Polish, Accessibility, Testing (Phase 6)
  - Implement keyboard navigation
  - Add ARIA labels and roles
  - Run react-doctor audit
  - Fix accessibility issues
  - Write E2E tests for critical flows
  - Risk: LOW (polish and testing)
  - Dependencies: WS-4, WS-5, WS-6, WS-7 (all required)
  - Validation: All accessibility checks pass, E2E tests pass
  - Estimated: 12 days

TOTAL: 84 days (12 weeks) for all workspaces
```

### 23.2 Workspace Dependencies

```
DEPENDENCY GRAPH:

WS-1 (Read Model Stub Fixes)
  ↓
  ├─→ WS-4 (Execution Cockpit Core)
  │     ↓
  │     └─→ WS-5 (Worker/File/Log/Detail Views)
  │           ↓
  │           └─→ WS-6 (Escalation/Control UX)
  │                 ↓
  │                 └─→ WS-8 (Polish, Accessibility, Testing)
  │
  └─→ WS-5 (Worker/File/Log/Detail Views)

WS-2 (Unified Control Path)
  ↓
  └─→ WS-6 (Escalation/Control UX)

WS-3 (Shell and Navigation Refactor)
  ↓
  ├─→ WS-4 (Execution Cockpit Core)
  └─→ WS-7 (Brain/Platform Regrouping)

PARALLELIZATION OPPORTUNITIES:

Week 1-2:
  - WS-1 (Read Model Stub Fixes) ← SERIAL (blocks everything)
  - WS-2 (Unified Control Path) ← SERIAL (blocks WS-6)

Week 3-4:
  - WS-3 (Shell and Navigation Refactor) ← SERIAL (blocks WS-4, WS-7)

Week 5-6:
  - WS-4 (Execution Cockpit Core) ← SERIAL (blocks WS-5)

Week 7-8:
  - WS-5 (Worker/File/Log/Detail Views) ← SERIAL (blocks WS-6)

Week 9-10:
  - WS-6 (Escalation/Control UX) ← SERIAL (blocks WS-8)
  - WS-7 (Brain/Platform Regrouping) ← CAN PARALLELIZE with WS-6

Week 11-12:
  - WS-8 (Polish, Accessibility, Testing) ← SERIAL (final phase)
```

### 23.3 Workspace Risk Assessment

```
RISK MATRIX:

Workspace │ Risk  │ Impact │ Mitigation
──────────┼───────┼────────┼──────────────────────────────────────
WS-1      │ HIGH  │ HIGH   │ Fix read model stubs first, validate
          │       │        │ each method returns real data
──────────┼───────┼────────┼──────────────────────────────────────
WS-2      │ HIGH  │ HIGH   │ Test all control actions end-to-end,
          │       │        │ ensure no regressions
──────────┼───────┼────────┼──────────────────────────────────────
WS-3      │ LOW   │ MEDIUM │ Refactoring existing code, run tests
          │       │        │ after each component split
──────────┼───────┼────────┼──────────────────────────────────────
WS-4      │ MEDIUM│ HIGH   │ Depends on WS-1, validate read model
          │       │        │ integration before proceeding
──────────┼───────┼────────┼──────────────────────────────────────
WS-5      │ HIGH  │ HIGH   │ Depends on WS-1, validate FileExplorer
          │       │        │ and DiffViewer use read model (not git)
──────────┼───────┼────────┼──────────────────────────────────────
WS-6      │ MEDIUM│ MEDIUM │ Control actions already work, just need
          │       │        │ refactoring and confirmation dialogs
──────────┼───────┼────────┼──────────────────────────────────────
WS-7      │ LOW   │ LOW    │ Just moving files and updating routes,
          │       │        │ low risk of breaking functionality
──────────┼───────┼────────┼──────────────────────────────────────
WS-8      │ LOW   │ MEDIUM │ Polish and testing, low risk but high
          │       │        │ impact on user experience
```

### 23.4 Workspace Validation Criteria

```
VALIDATION CHECKLIST:

WS-1: Read Model Stub Fixes
  □ getCommandHistory() returns real command history from state store
  □ getLeadDirectives() returns real lead directives from state store
  □ getLeadEscalations() returns real lead escalations from state store
  □ getFinalValidationStatus() returns real validation status from completion gate
  □ getFileContent() returns real file content from filesystem or archive
  □ getFileDiff() returns real file diff from git or snapshot comparison
  □ All methods have unit tests
  □ All methods have integration tests with mocked state store

WS-2: Unified Control Path
  □ POST /api/control removed or redirected to execution-service
  □ POST /api/executions/:peid/control uses execution-service
  □ All control actions go through handleExecutionCommand()
  □ All control actions emit events
  □ All control actions show result feedback
  □ No direct control file writes from web-server
  □ All control actions have integration tests

WS-3: Shell and Navigation Refactor
  □ App.tsx split into Shell, Topbar, LeftSidebar, CenterColumn, RightSidebar, StatusBar
  □ App.tsx reduced to <100 lines
  □ Navigation structure matches proposed design
  □ Project selector works
  □ Execution selector works
  □ Brain/Settings/History dropdown menus work
  □ No regressions in existing functionality
  □ All navigation components have unit tests

WS-4: Execution Cockpit Core
  □ ExecutionOverview renders with correct data
  □ WorkspaceBoard shows grouped workspaces
  □ Tab bar works (Overview | Workspaces | Files | Logs)
  □ URL reflects active tab (deep linking)
  □ ExecutionOverview uses ExecutionReadModel.getPlanSummary()
  □ ExecutionOverview uses ExecutionReadModel.getWorkspaceSummary()
  □ ExecutionOverview uses ExecutionReadModel.getLeadEscalations()
  □ ExecutionOverview uses ExecutionReadModel.getFinalValidationStatus()
  □ All components have unit tests
  □ All components have integration tests

WS-5: Worker/File/Log/Detail Views
  □ WorkerDetail renders with correct data
  □ WorkerDetail uses ExecutionReadModel.getWorkerContext()
  □ WorkerDetail uses ExecutionReadModel.getCommandHistory()
  □ WorkerDetail uses IWorkerTranscriptStore.readTranscriptEvents()
  □ FileExplorer uses ExecutionReadModel.getFileTree() (not git)
  □ FileExplorer uses ExecutionReadModel.getFileContent() (not filesystem)
  □ DiffViewer uses ExecutionReadModel.getFileDiff() (not git)
  □ LiveLogTerminal shows live command output
  □ All components have unit tests
  □ All components have integration tests

WS-6: Escalation/Control UX
  □ EscalationCenter shows active escalations
  □ EscalationCenter uses ExecutionReadModel.getLeadEscalations()
  □ ControlActionsPanel dispatches to execution-service
  □ Confirmation dialogs appear for dangerous actions (Stop, Cancel, Force Kill)
  □ Result feedback (toast) appears after control action
  □ All control actions have integration tests
  □ All confirmation dialogs have unit tests

WS-7: Brain/Platform Regrouping
  □ Brain pages moved to features/brain/
  □ Platform pages moved to features/platform/
  □ Brain dropdown menu in Topbar works
  □ Settings dropdown menu in Topbar works
  □ History dropdown menu in Topbar works
  □ No duplicate Brain/Platform pages in sidebar
  □ All routes still work
  □ All dropdown menus have unit tests

WS-8: Polish, Accessibility, Testing
  □ All interactive elements are keyboard accessible
  □ Keyboard shortcuts work (Cmd/Ctrl + K, 1/2/3/4, etc.)
  □ Focus management works (trap focus in modals, restore focus on close)
  □ All ARIA labels and roles are correct
  □ Color contrast meets WCAG AA
  □ Focus indicators are visible
  □ Reduced motion respected (prefers-reduced-motion)
  □ Screen reader announces dynamic content (aria-live)
  □ react-doctor audit passes
  □ E2E tests pass for critical flows:
    □ Execution Overview flow
    □ Control Action flow
    □ File Explorer flow
    □ Escalation Resolution flow
    □ Accessibility audit
```

---

## Summary

This proposal transforms the Pi dashboard from a fragmented, organically-grown interface into a focused **Autonomous Coding Cockpit** where users can supervise execution, intervene when needed, and review results.

**Key changes:**
1. **Execution Overview** becomes the primary view (not buried in sidebar)
2. **Workspace Board** shows grouped workspaces by state (not just a list)
3. **Worker Detail** shows full context (commands, files, transcript, validation)
4. **File Explorer / Diff Viewer** use read model (not git directly)
5. **Escalation Center** shows blocked workspaces and Lead Agent diagnosis
6. **Control Actions** go through execution-service (not direct state mutations)
7. **Brain/Platform** pages move to dropdown menus (not competing with execution)
8. **Right Sidebar** shows filtered events and context-aware controls (not everything)

**Implementation plan:**
- 8 workspaces over 12 weeks
- WS-1 and WS-2 are critical (fix read model stubs, unify control path)
- WS-3 through WS-7 are sequential (shell → cockpit → detail → escalation → regrouping)
- WS-8 is polish and testing (accessibility, keyboard, E2E tests)

**Success criteria:**
- Users can answer "What's running? What's blocked? What changed? How do I intervene?" in <3 seconds
- All panels connect to real execution read models (no fake data)
- All control actions go through execution-service (no direct state mutations)
- All interactive elements are keyboard accessible (WCAG AA compliance)
- E2E tests pass for critical flows (Execution Overview, Control Action, File Explorer, Escalation Resolution)

---

**Document prepared by:** Premium Design Architect Agent  
**Date:** 2026-06-01  
**Status:** Proposal (read-only, no code changes)  
**Next step:** Review by architect, then create P42 implementation plan

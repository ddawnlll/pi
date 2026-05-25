# Dashboard Summary — Pi Platform UI

> Kapsamli ASCII semalari ve dosya sorumluluklari ile tum dashboard mimarisi.
> Hedef: Bir AI'in tek okuyusta tum dashboard'i anlayabilmesi.

---

## 1. Ust Duzey Yerlesim (3-Panel Layout)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Topbar: [Nav] [Planner] [StatusBadge] ── [Resume] [Pause] [Stop] [⚙] [Nav] │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│  LEFT SIDEBAR │       CENTER COLUMN                  │  RIGHT SIDEBAR        │
│  (320px)      │      (flex-1)                        │  (300px)              │
│               │                                       │                       │
│  [Proj|Runs|  │  Contextual toolbar                   │  Events               │
│   Tasks|Plat] │  [Upload] [Git] [Cmd] [Chat] [Artf]  │  [All|Errors] filter  │
│               │                                       │  ────────             │
│  ── Projects  │  Content area (view-switched):        │  Event lines          │
│  │ Project1   │                                       │  · workspace created  │
│  │ Project2   │  RUN view:                            │  · tool call start    │
│  │ +Open...   │  ┌─ WarningBanner ─────────────────┐  │  · edit applied       │
│               │  │  Cost|Tokens|Cache|Burn etc.    │  │                       │
│  ── Runs      │  ├─ QueueStrip ────────────────────┤  │  Alerts               │
│  │ Exec1      │  │ Pending|Active|Blocked|Done|Fail│  │  [failed] [conflict]  │
│  │ Exec2      │  ├─ SchedulerStatusPanel ──────────┤  │  [blocked] badges     │
│  │ Exec3      │  ├─ WorkerCard[] ──────────────────┤  │                       │
│  │ +Upload    │  │ [worker1] [worker2] [worker3]   │  │  PlanSummaryPanel     │
│               │  ├─ WorkerDetail / LiveLogTerminal  │  │  (cleanup review)     │
│  ── Tasks     │  │  (tabbed: overview|tools|logs)  │  │                       │
│  │ task1      │  └─────────────────────────────────┘  │                       │
│  │ task2      │                                       │                       │
│               │  TASK view:                           │                       │
│  ── Platform  │  TaskDetailView                       │                       │
│  │ Autonomy   │  (phase plans, timeline, logs)        │                       │
│  │ Plan Intake│                                       │                       │
│  │ Extensions │  PLATFORM / BRAIN views (30+ pages):  │                       │
│  │ Memory     │  · AutonomyCenter                     │                       │
│  │ PolicyAudt │  · PlanIntakePanel                    │                       │
│  │ Trust Dsh  │  · ExtensionsManager                  │                       │
│  │ BrainState │  · SkillsManager                      │                       │
│  │ BrainMem   │  · MemoryCockpit                      │                       │
│  │ Reflectns  │  · PolicyAuditCenter                  │                       │
│  │ Overnight  │  · TrustDashboard                     │                       │
│  │ Goals      │  · GoalBoard                          │                       │
│  │ Proposals  │  · ProposalInbox                      │                       │
│               │  · BrainStatePage                     │                       │
│               │  · BrainMemoryPage                    │                       │
│               │  · BrainReflectionsPage               │                       │
│               │  · BrainOvernightPage                 │                       │
│               │                                       │                       │
│               │  EMPTY view:                          │                       │
│               │  "No execution selected" + Upload btn │                       │
├───────────────┴──────────────────────────────────────┴───────────────────────┤
│  Dialogs: OpenProject | PlanUpload | Settings | ExecLogView | Rerun         │
│  Overlays: ChatPanel | ArtifactBrowser | GitDialog | CommandsDialog         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Topbar

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [☰] [◀]  Planner  [●running] — Plan Title       [▶] [⏸] [■] [↻] [⚙] [▶] │
│  ^hamburger ^collapse          ^status      ^plan name  ^ctrl btns  ^settings ^collapse
│  mobile     left               badge                    Resume              right
│             sidebar                                     Pause               sidebar
│                                                          Stop
│                                                          Restart
└──────────────────────────────────────────────────────────────────────────────┘
```

**Responsible files:**
| Component | File | Responsibility |
|---|---|---|
| Topbar (header) | `App.tsx` (inline) | Plan status badge, Resume/Pause/Stop/Restart buttons, Settings gear, sidebar collapse toggles |

---

## 3. Left Sidebar — Tabbed Navigation

```
┌─────────────────────────────────┐
│ [PROJECTS] [RUNS] [TASKS] [PLATFORM] │  ← 4-tab bar
├─────────────────────────────────┤
│                                 │
│  ── PLATFORM tab ──            │
│  Platform                       │  ← PlatformSectionHeader
│  ┌─────────────────────────────┐│
│  │ Autonomy              🖥   ││  ← LeftNav (PLATFORM_NAV_ENTRIES[])
│  │ Proposal Inbox       📥   ││     P11 entries
│  │ Goals                🎯   ││
│  │ Plan Intake          📜   ││
│  │ Extensions & Skills  📦   ││
│  │ Memory               🗄   ││
│  │ Policy & Audit       🛡   ││
│  │ Trust Dashboard      🛡   ││
│  │ Registry Settings    🎛   ││
│  ├─────────────────────────────┤│
│  │ Brain (P19)          🧠   ││  ← NEW: separate Brain section header
│  │ Brain State          🖥   ││     P19 brain entries
│  │ Memory Explorer      🗄   ││
│  │ Reflections          🔄   ││
│  │ Overnight            🌙   ││
│  │ Goals                🎯   ││
│  │ Proposals            📥   ││
│  │ Trust Dashboard      🛡   ││
│  └─────────────────────────────┘│
│                                 │
│  ── RUNS tab ──                │
│  Runs                           │  ← SectionHeader
│  ┌─────────────────────────────┐│
│  │ Run 1 (2024-03-15)    ●  ││  ← HistoryItem[]
│  │ Run 2 (2024-03-14)    ✓  ││
│  │ Run 3 (2024-03-13)    ✗  ││
│  └─────────────────────────────┘│
│  [+ Upload plan...]             │
│                                 │
│  ── PROJECTS tab ──            │
│  Projects                       │
│  ┌─────────────────────────────┐│
│  │ My Project                  ││  ← ProjectItem[]
│  │ Another Project             ││
│  └─────────────────────────────┘│
│  [+ Open project...]            │
│                                 │
│  ── TASKS tab ──               │
│  TaskList component             │  ← TaskList
└─────────────────────────────────┘
```

### LeftNav Entry Detail

| id | Label | Icon | Description | Origin |
|---|---|---|---|---|
| `autonomy` | Autonomy | `Cpu` | Orchestrator health, proposals, self-improvement triggers | P11.S |
| `proposal_inbox` | Proposal Inbox | `Inbox` | Top-ranked proposals with recommendations | P11.S |
| `goals` | Goals | `Target` | Goal board, milestones, drift alerts | P11.S |
| `plan_intake` | Plan Intake | `ScrollText` | Plan analysis, DAG diff, optimization approval | P11.S |
| `extensions_skills` | Extensions & Skills | `Package` | Manage extensions, skills, and their lifecycle | P11.S |
| `memory` | Memory | `Database` | Memory health, provenance, compaction | P11.S |
| `policy_audit` | Policy & Audit | `ShieldAlert` | Permissions, approvals, audit timeline | P11.S |
| `trust_dashboard` | Trust Dashboard | `Shield` | Trust metrics, safety, approvals, audit health | P11.S |
| `registry_settings` | Registry Settings | `Sliders` | Local/remote registries, channels, update policy | P11.S |
| `brain_state` | Brain State | `Cpu` | Daemon status, observations, signals, timeline | P19 |
| `brain_inbox` | Proposal Inbox | `Inbox` | Top-ranked proposals with recommendations | P19 |
| `brain_memory` | Memory Explorer | `Database` | Full memory CRUD, search, filters | P19 |
| `brain_reflections` | Reflections | `RotateCw` | Post-plan reflections, worked/failed, suggestions | P19 |
| `brain_overnight` | Overnight | `Moon` | Queue overnight runs, schedule, history | P19 |

**Responsible files:**
| File | Purpose |
|---|---|
| `components/LeftNav.tsx` | Defines `PlatformNavItem` type, `PLATFORM_NAV_ENTRIES[]` array, `LeftNav` component (renders entry list), `PlatformSectionHeader` |
| `App.tsx` (lines ~540-560) | Wires LeftNav into the Platform tab, renders PlatformSectionHeader, manages `activeView` state, handles `navigateToPlatform` callback |

---

## 4. P22.A — Project-Centric Sidebar

The new P22.A sidebar (`components/sidebar/Sidebar.tsx`) replaces the 4-tab system with a project-centric hierarchy:

```
┌─ Sidebar (320px) ─────────────────────────────────┐
│  ┌─ Project Selector ──────────────────────────┐   │
│  │ [📁 my-project        ▼]                    │   │
│  │  ┌─ Dropdown ──────────────────────────┐    │   │
│  │  │ 📁 project-1                    ✎ ✕ │    │   │
│  │  │ 📁 project-2  (active)           ✎ ✕ │    │   │
│  │  │ ─────────────────────                │    │   │
│  │  │ + New project...                     │    │   │
│  │  └──────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  🧠 my-project Brain  [ON]  ▼                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ ● State / Overview                           │    │
│  │ ● Memory Explorer                            │    │
│  │ ● Reflections                                │    │
│  │ ● Overnight                                  │    │
│  │ ● Goals                                      │    │
│  │ ● Trust                                      │    │
│  └─────────────────────────────────────────────┘    │
│  ────────────────────────────────────────────        │
│  TASKS                              ▼               │
│  ┌─────────────────────────────────────────────┐    │
│  │ + Create task                                │    │
│  │ ○ Implement auth (running)                   │    │
│  │ ○ Add tests (complete)                       │    │
│  └─────────────────────────────────────────────┘    │
│  ────────────────────────────────────────────        │
│  RUNS                               ▼               │
│  ┌─────────────────────────────────────────────┐    │
│  │ + Upload plan...                             │    │
│  │ [Show archived runs]                        │    │
│  │ ○ auth-flow   (complete)                    │    │
│  │ ○ test-suite  (failed)                      │    │
│  │ ○ refactor    (running)                     │    │
│  └─────────────────────────────────────────────┘    │
│  ────────────────────────────────────────────        │
│  PLATFORM                            ▼              │
│  ┌─────────────────────────────────────────────┐    │
│  │ ● Autonomy                                   │    │
│  │ ● Plan Intake                                │    │
│  │ ● Extensions & Skills                        │    │
│  │ ● Proposals                                  │    │
│  │ ● Registry Settings                          │    │
│  └─────────────────────────────────────────────┘    │
│  ────────────────────────────────────────────        │
│  [⚙ Project settings]                                │
└─────────────────────────────────────────────────────┘
```

**Key features:**
- Project selector dropdown at top: switch projects, rename, delete, create
- Per-project brain section with ON/OFF toggle
- Tasks section with inline create and status badges
- Runs section with upload CTA, archive toggle, inline rename/archive per run
- Platform items at bottom (collapsible, off by default)
- Settings gear at bottom
- Responsive: section headers collapse/expand with chevron animation
- P22.E: Archive toggle and inline plan rename

**Responsible files:**
| File | Purpose |
|---|---|
| `components/sidebar/Sidebar.tsx` | Full sidebar implementation |
| `components/sidebar/index.ts` | Barrel export |
| `App.tsx` | Sidebar integration, wiring |


## 5. Center Column — View Router

The center column switches content based on `activeView.type`:

```
activeView.type ──┬── "run"      → Plan execution dashboard
                  ├── "task"      → TaskDetailView
                  ├── "platform"  → Platform/Brain feature pages (switched by activeView.screen)
                  └── "empty"     → "No execution selected" placeholder
```

### 5a. RUN View (activeView.type === "run")

```
┌── Contextual Toolbar ──────────────────────────────────────────────────────┐
│ [Upload] | [Git] [Commands] [Chat] [Artifacts] [Exec log]                  │
├── Stat Cards (7-column grid) ──────────────────────────────────────────────┤
│ [Est.cost] [Tokens in] [Tokens out] [Burn rate] [Cache hit] [T/W] [T/%]   │
├── QueueStrip ──────────────────────────────────────────────────────────────┤
│ [Pending: 0] [Active: 2] [Blocked: 1] [Done: 5] [Failed: 1]              │
├── SchedulerStatusPanel ────────────────────────────────────────────────────┤
│ [Scheduling diagnostics: avgWait, throughput, slotUtilization, ...]       │
├── WorkerCard[] (scrollable, max-h-48) ─────────────────────────────────────┤
│ [ws-1 ■ active · attempt 1] [ws-2 ▲ pending] [ws-3 ✗ failed]             │
│ [ws-4 ● blocked · conflict]                                                │
├── WorkerDetail / LiveLogTerminal ──────────────────────────────────────────┤
│ (When worker selected: shows WorkerDetail with tabs)                      │
│ (When no worker selected: LiveLogTerminal with all logs)                  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Stat Cards (7 columns):**
| Stat | Hook/Data Source | Calculation |
|---|---|---|
| Est. cost | `planStats.estimated_cost_usd` | From backend execution tracking |
| Tokens in | `planStats.total_tokens_in` | Sum of all prompt tokens |
| Tokens out | `planStats.total_tokens_out` | Sum of all completion tokens |
| Burn rate | `planStats.burn_rate_per_min` | `total_tokens / elapsed_minutes` |
| Cache hit | `planStats.cache_hit_rate` | Cache hit percentage |
| Tok/workspace | `planStats.tokens_per_workspace` | `total_tokens / workspace_count` |
| Tok/progress% | `planStats.tokens_per_percent` | Tokens per 1% progress |

**Responsible files (RUN view):**
| Component | File | Lines | Purpose |
|---|---|---|---|
| View switch | `App.tsx` | ~580-760 | Switch on activeView to render components |
| StatCards | `components/StatCard.tsx` | — | Metric display card with icon, label, value |
| QueueStrip | `App.tsx` (inline) | ~155-173 | Pending/Active/Blocked/Done/Failed bar |
| SchedulerStatusPanel | `components/SchedulerStatusPanel.tsx` | — | Scheduler diagnostics display |
| WorkerCard | `App.tsx` (inline) | ~110-148 | Clickable worker row with stage badge |
| WorkerDetail | `components/WorkerDetail.tsx` | — | Worker detail with tabs (overview, tools, logs, transcript, diffs) |
| LiveLogTerminal | `components/LiveLogTerminal.tsx` | — | Real-time log stream display |
| WarningBanner | `components/WarningBanner.tsx` | — | Cost/budget/policy warnings |

### 5b. PLATFORM / BRAIN View (activeView.type === "platform")

When `activeView.screen` matches a platform nav item, the corresponding feature page is rendered:

```typescript
showRegistrySettings ? <RegistrySettings />
showPlanIntake       ? <PlanIntakePanel />
showMemory           ? <MemoryCockpit />
showPolicyAudit      ? <PolicyAuditCenter />
showTrustDashboard   ? <TrustDashboard />
showExtensions       ? <ExtensionsManager />
showSkills           ? <SkillsManager />
showGoals            ? <GoalBoard />
showAutonomy         ? <AutonomyCenter />
showProposalInbox    ? <ProposalInbox />
showBrainState       ? <BrainStatePage />
showBrainInbox       ? <ProposalInbox />        // reuses P11 component
showBrainMemory      ? <BrainMemoryPage />
showBrainReflections ? <BrainReflectionsPage />
showBrainOvernight   ? <BrainOvernightPage />
```

### 5c. Navigation State Persistence (P22 local storage)

The dashboard persists selected state across page reloads via localStorage:

| Key | Stored Value | Purpose |
|---|---|---|
| `pi_selected_project_id` | string \| null | Last selected project |
| `pi_selected_exec_id` | string \| null | Last selected plan execution |
| `pi_selected_view` | JSON (ActiveView) | Last active view (run/task/platform) |
| `pi_selected_task_id` | string \| null | Last selected task |

On reload, the dashboard restores the project, execution, and view so the user lands exactly where they left off.

---

## 6. Brain Pages — Detailed View

### 6a. BrainStatePage (`pages/BrainStatePage.tsx`)

```
┌─ Brain State ─────────────────────────────────────────────────────────────┐
│ ● Daemon running  [Brain Prompt] [Auto-refresh ◼] [↻ Refresh]           │
├─ DaemonStatusCard ─────────────────────────────────────────────────────────┤
│ State: running | Uptime: 2h 34m | Observations: 47                      │
│ [Start daemon] [Stop daemon] [Resume] (context-dependent buttons)        │
│ ─── Action buttons appear based on state:                                │
│     Stopped/Error → "Start daemon"                                       │
│     Running       → "Stop daemon"                                        │
│     Paused        → "Resume" + "Stop daemon"                            │
├─ ObservationStats ────────────────────────────────────────────────────────┤
│ [Info: 12] [Warning: 3] [Critical: 1]                                   │
├─ SignalSummaryCards (severity cards) ──────────────────────────────────────┤
│ Signals summary                                                          │
├─ 2-column grid ───────────────────────────────────────────────────────────┤
│ ┌─ Live Daemon Activity ───┐  ┌─ Brain Prompt ────────────────┐         │
│ │ [🟢 Live] 47 events      │  │ System Prompt                  │         │
│ │                          │  │ "You are Pi's brain..."        │         │
│ │ [12:34:05] [#2] Scan...  │  │                                │         │
│ │ [12:34:02] Git status... │  │ Observation Rules (5)          │         │
│ │ [12:33:58] Proposal...   │  │ · Scan git status...           │         │
│ │ ...                      │  │ · Detect code quality...       │         │
│ └──────────────────────────┘  │ [+2 more]                     │         │
│                               └────────────────────────────────┘         │
├─ TimelineList ─────────────────────────────────────────────────────────────┤
│ [12:34:05] workspace ws-4 completed  ─── info                            │
│ [12:33:12] memory pressure detected    ─── warning                       │
│ ...                                                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Sub-components:** `DaemonStatusCard`, `SignalSummaryCards`, `ObservationStats`, `TimelineList`, `LiveDaemonActivity`, `BrainPromptEditor`
**Hooks:** `useBrainStatus` — fetches daemon state, observations, signals, timeline from `/api/brain/state`
**API client:** `BrainClient.getState()`, `BrainClient.getObservations()`, `BrainClient.getSignals()`, `BrainClient.getTimeline()`

### 6b. DaemonStatusCard (`components/brain/overview/DaemonStatusCard.tsx`)

Shows daemon state with color-coded dot + label, real uptime (from orchestrator health.json), and observation count. Includes action buttons:

| Daemon State | Dot Color | Label | Buttons |
|---|---|---|---|
| `running` | 🟢 emerald | Running | Stop daemon |
| `stopped` | 🔴 red | Stopped | Start daemon |
| `paused` | 🟡 amber | Paused | Resume + Stop daemon |
| `error` | 🟠 amber | Error | Start daemon |

### 6c. LiveDaemonActivity (`components/brain/overview/LiveDaemonActivity.tsx`)

SSE-based live stream of daemon activity (connects to `GET /api/orchestrator/activity/stream`):
- Color-coded log lines (info/warn/error/debug) with timestamps
- Scan cycle number `[#N]` prefix
- Live/disconnected indicator dot
- Auto-scrolls to newest entries
- Caps at 200 entries, newest first

### 6d. BrainPromptEditor (`components/brain/overview/BrainPromptEditor.tsx`)

View and edit the brain prompt config via `GET/PUT /api/orchestrator/brain-prompt`:
- **Read-only mode**: Shows system prompt (truncated), observation rule count, scan priority tags
- **Edit mode**: Textarea for system prompt, dynamic add/remove input rows for rules and priorities, Save/Cancel buttons with loading states
- Prompt persisted as JSON at `.pi/orchestrator/brain-prompt.json`

### 6e. BrainMemoryPage (`pages/BrainMemoryPage.tsx`)

```
┌─ Memory Explorer ─────────────────────────────────────────────────────────┐
│ [🔍 Search...] [Type ▼] [Tier ▼] [Sort ▼]  [+ New Memory]              │
├── Memory Stats ────────────────────────────────────────────────────────────┤
│ Total: 342 | High: 12 | Medium: 180 | Low: 150 | Archived: 85            │
├── MemoryList (scrollable) ────────────────────────────────────────────────┤
│ ┌─ MemoryCard ──────────────────────────────────────────────────────────┐ │
│ │ ★ High | 📂 failure_memory | 2024-03-15                               │ │
│ │ "Workspace timeout in plan X: root cause was dependency conflict..."   │ │
│ │ [Edit] [Delete] [Promote]                                             │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ┌─ MemoryCard ──────────────────────────────────────────────────────────┐ │
│ │ ◆ Medium | 📂 success_pattern | 2024-03-14                            │ │
│ │ "Parallel workspace pattern Y consistently reduces latency by 40%..."  │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ...                                                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Sub-components:** `MemoryList`, `MemoryCard`, `MemoryEditForm`, `MemoryDetailModal`
**Hooks:** `useMemoryRecords` — CRUD operations via `BrainClient`
**API client:** `BrainClient.getMemories()`, `BrainClient.createMemory()`, `BrainClient.updateMemory()`, `BrainClient.deleteMemory()`

### 6f. BrainReflectionsPage (`pages/BrainReflectionsPage.tsx`)

```
┌─ Reflections ─────────────────────────────────────────────────────────────┐
│ Stats: 47 reports | 32 suggestions | 87% avg confidence                 │
├── ReflectionTimeline ──────────────────────────────────────────────────────┤
│ ┌─ ReflectionCard (Mar 15) ─────────────────────────────────────────────┐ │
│ │ Plan: "Implement search feature"  ● Completed                        │ │
│ │ What worked: test-first approach (confidence 0.85)                    │ │
│ │ What failed: edit strategy timeout (confidence 0.62)                  │ │
│ │ [View details] [Generate proposal from reflection]                    │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ReflectionCard (Mar 14) ─────────────────────────────────────────────┐ │
│ │ Plan: "Bug fix sprint"  ✗ Partial                                    │ │
│ │ ...                                                                   │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Sub-components:** `ReflectionCard`, `ReflectionTimeline`, `ReflectionDetail`
**Hooks:** `useReflections` — fetch reflections, generate proposals from reflections
**API client:** `BrainClient.getReflections()`, `BrainClient.generateProposalFromReflection()`

### 6g. BrainOvernightPage (`pages/BrainOvernightPage.tsx`)

```
┌─ Overnight ──────────────────────────────────────────────────────────────┐
│ [Start Overnight] [Schedule ▼] [Morning Report]                         │
├── Current Session ────────────────────────────────────────────────────────┤
│ Status: ● Running | Started: 23:00 | Duration: 2h 15m                    │
│ Plans executed: 3 | Workspaces: 12/15 completed                         │
├── RunHistoryTable ────────────────────────────────────────────────────────┤
│ [Mar 14] ✅ Complete | 5 plans | 23 workspaces | 0 failures             │
│ [Mar 13] ⚠ Partial  | 3 plans | 15 workspaces | 2 failures             │
│ [Mar 12] ✅ Complete | 6 plans | 28 workspaces | 1 failure             │
│ [Mar 11] ❌ Failed    | 1 plan  |  4 workspaces | 4 failures            │
├── Morning Report ─────────────────────────────────────────────────────────┤
│ (Generated report with overnight execution summary)                      │
└────────────────────────────────────────────────────────────────────────────┘
```

**Sub-components:** `RunHistoryTable`, `MorningReport` (from `brain/overnight/morning-report.ts`)
**Hooks:** `useOvernight` — start/stop/pause/resume sessions, fetch history
**API client:** `BrainClient.startSession()`, `BrainClient.stopSession()`, `BrainClient.getSessions()`, `BrainClient.getReport()`

### Other Brain Sub-pages

| Page | File | Key Sub-components | Hooks |
|---|---|---|---|
| Goals | `components/brain/goals/GoalBoard.tsx` | `GoalCard`, `GoalDetail`, `MilestoneTracker` | `useGoals`, `useGoalBoard` |
| Proposals | `features/proposal-inbox/ProposalInbox.tsx` | `ProposalCard`, `CorrectForm` | `useBrainProposals` |
| Trust Dashboard | `features/trust/TrustDashboard.tsx` | `PolicyRuleTable` | `useTrust` |

---

## 7. Right Sidebar

```
┌─ Events ──────────────────────────────────────────────────────────────────┐
│ [All] [Errors Filter]                                                     │
├── EventLine[] ─────────────────────────────────────────────────────────────┤
│ [worker ws-1] workspace created              12:34:05                     │
│ [system] tool call start: read              12:34:02                     │
│ [worker ws-2] edit applied: src/foo.ts      12:33:58                     │
│ [system] LLM response received               12:33:55                     │
│ ...                                                                       │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ 🔔 Alerts  [3]                                                            │
├── Alert entries ───────────────────────────────────────────────────────────┤
│ ⚠ ws-3 failed            (red bg)                                        │
│ ▲ ws-4 conflict           (amber bg)                                      │
│ ● ws-7 blocked            (amber bg)                                      │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ PlanSummaryPanel (cleanup review results)                                 │
│ ┌──────────────────────────────────────────────────────────────────────┐  │
│ │ Cleanup Review #plan-exec-id                                        │  │
│ │ Changes: 3 files | Tests: 12 pass, 0 fail | Coverage: 87%           │  │
│ │ [View diff] [Rerun cleanup]                                         │  │
│ └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Responsible files:**
| Component | File | Purpose |
|---|---|---|
| Event sidebar container | `App.tsx` (lines ~770-850) | AnimatePresence wrapper, All/Errors filter, renders EventLine[] |
| EventLine | `components/EventLine.tsx` | Single event display row |
| Alert entries | `App.tsx` (inline) | Filtered failed/conflict/blocked workspace entries |
| PlanSummaryPanel | `components/PlanSummaryPanel.tsx` | Cleanup review results, rerun button |

---

## 8. Dialogs & Overlays

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Dialogs:                                                                    │
│  ┌─ OpenProjectDialog ───┐  ┌─ PlanUploadDialog ───┐  ┌─ SettingsDialog ───┐ │
│  │ New or existing proj   │  │ Upload plan file      │  │ Budget, model,     │ │
│  │ (createProject fn)     │  │ (validate, confirm)   │  │ provider settings  │ │
│  └────────────────────────┘  └───────────────────────┘  └───────────────────┘ │
│  ┌─ ExecutionLogViewer ──┐  ┌─ RerunDialog ─────────┐                        │
│  │ Full plan execution    │  │ Confirm rerun of       │                        │
│  │ log viewer             │  │ selected execution     │                        │
│  └────────────────────────┘  └───────────────────────┘                        │
│                                                                               │
│  Overlays (slide-in from right):                                              │
│  ┌─ ChatPanel ────────────────────────────────────────────────────────────┐  │
│  │ Centered dialog (max-w-4xl) with thread sidebar, markdown rendering,   │  │
│  │ tool badges, thinking animation, provider/model selector, context      │  │
│  │ meter, @-triggered file search, message editing, regeneration, code    │  │
│  │ copy, fullscreen, timestamps, scroll-to-bottom                         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ ArtifactBrowser ─────────────────────────────────────────────────────┐  │
│  │ Browse plan execution artifacts (files generated during execution)    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ┌─ GitDialog ──┐  ┌─ CommandsDialog ──┐                                  │
│  │ Git status    │  │ Slash commands    │                                  │
│  └───────────────┘  └───────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Data Flow Architecture

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────────┐
│ Component │───>│   Hook   │───>│ API Client│───>│ Backend API  │
│ (tsx)     │<───│ (ts)     │<───│ (ts)      │<───│ (web-server) │
└──────────┘    └──────────┘    └───────────┘    └──────────────┘
                                                    │
                                                    v
                                            ┌──────────────┐
                                            │ Brain Modules │
                                            │ (coding-agent)│
                                            └──────────────┘
```

**REST API endpoints consumed by dashboard:**

| Endpoint | Method | Hook | Purpose |
|---|---|---|---|
| `/api/brain/state` | GET | `useBrainStatus` | Daemon status, observation/signal stats |
| `/api/brain/timeline` | GET | `useBrainStatus` | Timeline events (paginated) |
| `/api/brain/observations` | GET | `useBrainStatus` | Raw observations list |
| `/api/brain/signals` | GET | `useBrainStatus` | Active/resolved signals |
| `/api/brain/memories` | GET/POST/DELETE | `useMemoryRecords` | Memory CRUD |
| `/api/brain/reflections` | GET | `useReflections` | Reflection reports |
| `/api/brain/overnight/sessions` | GET/POST | `useOvernight` | Overnight session lifecycle |
| `/api/brain/policy/rules` | GET | `useTrust` | Policy rules |
| `/api/brain/audit` | GET | `useTrust` | Audit entries |
| `/api/brain/autonomy` | GET | `useBrainStatus` | Autonomy profile |
| `/api/brain/goals` | GET | `useGoals` | Goal index |
| `/api/brain/proposals` | GET | `useBrainProposals` | Proposals |
| `/api/orchestrator/health` | GET | — | Orchestrator daemon health snapshot |
| `/api/orchestrator/health/stream` | GET (SSE) | — | Live health updates |
| `/api/orchestrator/activity/stream` | GET (SSE) | `LiveDaemonActivity` | Live daemon activity log stream |
| `/api/orchestrator/brain-prompt` | GET/PUT | `BrainPromptEditor` | Read/write brain prompt config |
| `/api/orchestrator/control` | POST | `BrainStatePage` | Pause/resume/request-scan daemon control |
| `/api/orchestrator/health` | GET | `useOrchestratorHealth` | Orchestrator health snapshot |
| `/api/orchestrator/proposals` | GET | — | Orchestrator-generated proposals |
| `/api/orchestrator/seed-proposals` | POST | — | Seed demo proposals |
| `/api/orchestrator/run-lead-agent` | POST | — | Trigger lead agent analysis |
| `/api/orchestrator/lead-agent/stream` | GET (SSE) | — | Lead agent thinking transcript |
| `/api/orchestrator/lead-agent/control` | POST | — | Pause/resume/stop lead agent |
| `/api/projects` | GET | `useProjects` | List projects |
| `/api/projects/:pid/plans` | GET | `usePlanExecutions` | List plan executions |
| `/api/projects/:pid/plans/:eid` | GET | `usePlanExecutionDetail` | Single execution detail |
| `/api/projects/:pid/plans/:eid/stats` | GET | `usePlanStats` | Cost/token/burn rate stats |
| `/api/projects/:pid/plans/validate` | POST | `usePlanRunner` | Validate plan before run |
| `/api/projects/:pid/plans/run` | POST | `usePlanRunner` | Start plan execution |
| `/api/chat/history` | GET | (`ChatPanel`) | Chat thread list |
| `/api/chat` | POST | (`ChatPanel`) | Send message |
| `/api/ai-models` | GET | (`ChatPanel`) | Provider/model list |
| `/api/chat/compact` | POST | (`ChatPanel`) | Compact context |
| `/api/extensions/*` | GET/POST | `useExtensions` | Extension lifecycle |
| `/api/skills/*` | GET/POST | `useSkills` | Skill lifecycle |

---

## 10. Orkestrator Daemon Activity & Brain Prompt

### 10a. Live Daemon Activity Stream

The daemon writes activity entries to `.pi/orchestrator/health.json` during scans. The dashboard connects via SSE to `GET /api/orchestrator/activity/stream` which polls health.json every 2 seconds and pushes new entries to connected clients.

```
SSE event format:
data: { "type": "activity", "entry": { "timestamp": 1712345678000, "level": "info", "message": "Scan #3 starting", "scanCycle": 3 } }

data: { "type": "heartbeat", "ts": 1712345678000 }
```

Activity entry fields:
| Field | Type | Description |
|---|---|---|
| `timestamp` | number | Unix ms timestamp |
| `level` | string | `info` / `warn` / `error` / `debug` |
| `message` | string | Human-readable activity description |
| `scanCycle` | number (optional) | Scan cycle number when applicable |

### 10b. Brain Prompt Config

Stored as JSON at `.pi/orchestrator/brain-prompt.json`:
```json
{
  "systemPrompt": "You are Pi's brain — a continuous improvement orchestrator...",
  "observationRules": [
    "Scan git status for uncommitted changes and suggest commits",
    "Detect code quality issues: missing tests, large files, duplicated code"
  ],
  "scanPriorities": [
    "security_critical",
    "performance_regression",
    "code_quality"
  ]
}
```

### 10c. Daemon Health → Brain State Bridge

The brain state API (`/api/brain/state`) now reads orchestrator health data from `.pi/orchestrator/health.json` to get real daemon status (running/stopped/error) and uptime, instead of hardcoding `running` + `0s`.

### 10d. Brain State API Response Wrapper Fixes

Several brain API routes wrap responses in `{ success: true, ... }` which broke the frontend `apiFetch` calls that expected the raw type. Fixed in `api/brain.ts`:

| Method | Response Shape | Fix |
|---|---|---|
| `getReflections()` | `{ success, reflections, total }` | Unwrap `.reflections` |
| `getReflection()` | `{ success, reflection }` | Unwrap `.reflection` |
| `getReflectionStats()` | `{ success, stats }` | Unwrap `.stats` |
| `getGoals()` | `{ success, goals, count }` | Unwrap `.goals` |
| `getGoal()` | `{ success, goal }` | Unwrap `.goal` |
| `getGoalStats()` | `{ success, stats }` | Unwrap `.stats`, map keys |
| `getDriftReports()` | `{ success, reports, count }` | Unwrap `.reports` |
| `createGoal()` | `{ success, goal }` | Unwrap `.goal` |
| `updateGoal()` | `{ success, goal }` | Unwrap `.goal` |
| `completeGoal()` | `{ success, goal }` | Unwrap `.goal` |

---

## 11. Component File Responsibility Table

### Core Layout

| File | Lines (approx) | Purpose |
|---|---|---|
| `App.tsx` | ~1100 | Main app shell: 3-panel layout, view routing, state management, topbar, left/right pane toggles, worker rendering, event list, alerts, dialogs, overlays |
| `main.tsx` | ~10 | React entry point — renders `<App />` |
| `app.css` | — | Global styles: animations (ThinkingAnimation, fade-in), theme variables |

### Left Navigation

| File | Lines | Purpose |
|---|---|---|
| `components/LeftNav.tsx` | ~120 | `PlatformNavItem` type, `PLATFORM_NAV_ENTRIES[]`, `LeftNav` component, `PlatformSectionHeader` |
| `components/sidebar/Sidebar.tsx` | ~400 | P22.A project-centric sidebar: project selector, brain/tasks/runs/platform sections |
| `components/ProjectItem.tsx` | ~30 | Single project row in Projects tab |
| `components/HistoryItem.tsx` | ~40 | Single execution row in Runs tab (status badge, title, date) |
| `components/TaskList.tsx` | ~80 | Task list and tree view in Tasks tab |

### Center Column — Plan Execution

| File | Lines | Purpose |
|---|---|---|
| `components/StatCard.tsx` | ~40 | Metric display card (icon, label, value, accent) |
| `components/StatusBadge.tsx` | ~30 | Plan status badge (running, paused, failed, complete) |
| `components/WarningBanner.tsx` | ~60 | Cost/budget/policy warning strip |
| `components/SchedulerStatusPanel.tsx` | ~80 | Scheduler diagnostics display |
| `components/WorkerDetail.tsx` | ~300 | Worker detail with tabs: overview, tools, logs, transcript, diffs |
| `components/LiveLogTerminal.tsx` | ~200 | Real-time streaming log display |
| `components/PlanSummaryPanel.tsx` | ~100 | Cleanup review results with rerun button (in right sidebar) |

### Center Column — Platform / Brain Pages

| File | Lines | Purpose |
|---|---|---|
| `features/autonomy/AutonomyCenter.tsx` | ~300 | P11 Autonomy: orchestrator health, proposals, self-improvement triggers |
| `features/plan-intake/PlanIntakePanel.tsx` | ~430 | P11 Plan intake: analyzer results, DAG diff, optimization approval |
| `features/memory/MemoryCockpit.tsx` | ~390 | P11 Memory cockpit: health metrics, provenance, compaction |
| `features/policy-audit/PolicyAuditCenter.tsx` | ~380 | P11 Policy & audit: permissions, approvals, audit timeline |
| `features/trust/TrustDashboard.tsx` | ~300 | P11 Trust dashboard: trust metrics, safety, approvals |
| `features/proposal-inbox/ProposalInbox.tsx` | ~200 | P11 Proposal inbox: ranked proposals with recommendations |
| `components/ExtensionsManager.tsx` | ~200 | P11 Extension management UI |
| `components/SkillsManager.tsx` | ~200 | P11 Skill management UI |
| `components/brain/goals/GoalBoard.tsx` | ~250 | P15 Goal board: cards, detail, milestone tracker, drift |
| `components/brain/goals/GoalCard.tsx` | ~60 | Single goal card |
| `components/brain/goals/GoalDetail.tsx` | ~100 | Goal detail modal |
| `components/brain/goals/MilestoneTracker.tsx` | ~50 | Milestone progress display |
| `features/settings/RegistrySettings.tsx` | ~150 | Registry settings: local/remote registries, update policy |

### Brain Pages

| File | Lines | Purpose |
|---|---|---|
| `pages/BrainStatePage.tsx` | ~150 | P19 Brain state: daemon status, observations, signals, timeline, live activity, prompt editor |
| `pages/BrainMemoryPage.tsx` | ~150 | P19 Memory explorer: full CRUD, search, filters |
| `pages/BrainReflectionsPage.tsx` | ~150 | P19 Reflections: post-plan reflections, suggestions |
| `pages/BrainOvernightPage.tsx` | ~150 | P19 Overnight: queue runs, schedule, history |
| `pages/BrainTrustPage.tsx` | ~100 | P19 Trust: policy rules, audit entries |
| `pages/BrainGoalsPage.tsx` | ~100 | P19 Goals: goal board integration |

### Brain Sub-components

| File | Lines | Purpose |
|---|---|---|
| `components/brain/overview/DaemonStatusCard.tsx` | ~80 | Daemon running/stopped/paused/error state card with Start/Stop/Resume buttons |
| `components/brain/overview/SignalSummaryCards.tsx` | ~60 | Signal severity summary (info/warning/critical) |
| `components/brain/overview/TimelineList.tsx` | ~70 | Timeline event list with severity badges |
| `components/brain/overview/LiveDaemonActivity.tsx` | ~90 | SSE-based live daemon activity log stream |
| `components/brain/overview/BrainPromptEditor.tsx` | ~200 | Read/edit brain prompt config (system prompt, rules, priorities) |
| `components/brain/overview/index.ts` | ~10 | Barrel re-exports |
| `components/brain/memory/MemoryList.tsx` | ~80 | Memory list with search/filter |
| `components/brain/memory/MemoryCard.tsx` | ~50 | Single memory entry card |
| `components/brain/memory/MemoryEditForm.tsx` | ~80 | Memory create/edit form |
| `components/brain/memory/MemoryDetailModal.tsx` | ~60 | Memory detail modal |
| `components/brain/reflections/ReflectionCard.tsx` | ~60 | Single reflection report card |
| `components/brain/reflections/ReflectionTimeline.tsx` | ~50 | Timeline of reflections |
| `components/brain/reflections/ReflectionDetail.tsx` | ~80 | Reflection detail view |
| `components/brain/proposals/ProposalCard.tsx` | ~60 | Single proposal card |
| `components/brain/proposals/CorrectForm.tsx` | ~50 | Proposal correction form |
| `components/brain/proposals/ProposalInbox.tsx` | ~60 | Proposal inbox sub-component |
| `components/brain/overnight/RunHistoryTable.tsx` | ~60 | Overnight run history table |
| `components/brain/trust/PolicyRuleTable.tsx` | ~50 | Policy rules display table |
| `components/brain/common/SeverityBadge.tsx` | ~20 | Shared severity badge |
| `components/brain/common/index.ts` | ~30 | Barrel re-exports for LoadingSkeleton, ErrorState, etc. |

### Chat

| File | Lines | Purpose |
|---|---|---|
| `components/ChatPanel.tsx` | ~600 | Full chat dialog: threads, messaging, markdown, file search, model selector |
| `components/ThinkingAnimation.tsx` | ~40 | Animated dots during LLM thinking |

### Hooks

| File | Purpose | Key Functions |
|---|---|---|
| `hooks/useBrainStatus.ts` | Brain daemon state, observations, signals, timeline | `fetchState()`, `fetchObservations()`, `fetchSignals()`, auto-refresh |
| `hooks/useMemoryRecords.ts` | Memory CRUD operations | `fetchMemories()`, `createMemory()`, `updateMemory()`, `deleteMemory()` |
| `hooks/useReflections.ts` | Reflection reports | `fetchReflections()`, `generateProposalFromReflection()` |
| `hooks/useOvernight.ts` | Overnight session lifecycle | `startSession()`, `stopSession()`, `getSessions()` |
| `hooks/useGoals.ts` | Goal index | `fetchGoals()`, `createGoal()`, `updateGoal()` |
| `hooks/useGoalBoard.ts` | Goal board display | `fetchGoalBoard()`, milestone tracking |
| `hooks/useBrainProposals.ts` | Brain proposals | `fetchProposals()`, `approveProposal()`, `rejectProposal()` |
| `hooks/useTrust.ts` | Trust/policy data | `fetchPolicyRules()`, `fetchAuditEntries()` |
| `hooks/useUnreadCount.ts` | Unread notification count | — |
| `hooks/usePlanState.ts` | Legacy plan state (non-project mode) | — |
| `hooks/usePlanExecutions.ts` | Project-mode plan executions | `usePlanExecutions()`, `usePlanExecutionDetail()`, `usePlanStats()` |
| `hooks/usePlanEvents.ts` | Real-time plan events | SSE/WebSocket event stream |
| `hooks/usePlanRunner.ts` | Plan upload/validate/run | `validatePlan()`, `runPlan()` |
| `hooks/useProjects.ts` | Project CRUD | `fetchProjects()`, `createProject()` |
| `hooks/useSettings.ts` | User settings | `fetchSettings()`, `updateSettings()` |
| `hooks/useScaleStatus.ts` | Scale mode + integration queue | — |
| `hooks/useExtensions.ts` | Extension lifecycle | `listExtensions()`, `installExtension()`, etc. |
| `hooks/useSkills.ts` | Skill lifecycle | `listSkills()`, `invokeSkill()`, etc. |
| `hooks/useMemoryMetrics.ts` | P11 memory cockpit metrics | — |
| `hooks/useOptimizerApproval.ts` | P11 optimizer approval | — |
| `hooks/useOrchestratorHealth.ts` | P11 orchestrator health | — |
| `hooks/useProposals.ts` | P11 proposals | — |
| `hooks/usePerformanceMetrics.ts` | P5.5 performance telemetry | — |
| `hooks/useTheme.ts` | Dark/light theme | — |
| `hooks/useAuth.ts` | Authentication | — |
| `hooks/useToolCallEvents.ts` | Tool call stream | — |
| `hooks/useJournalStream.ts` | Legacy journal stream | — |
| `hooks/usePlanQueue.ts` | Plan queue status | — |

### API Layer

| File | Purpose |
|---|---|
| `api/brain.ts` | `BrainClient` class — 30+ typed methods for all brain API endpoints (state, timeline, observations, signals, memories, goals, proposals, reflections, overnight, policy, audit, approvals) |
| (inline fetch calls in App.tsx) | Control commands (pause/stop/resume), rerun, project operations |

### Types

| File | Purpose |
|---|---|
| `types.ts` | Core types: WorkerInfo, WorkspaceSummary, GitFilePatch, PlanExecution, PlanStats, PerformanceMetric, chat types |
| `types-brain.ts` | Brain-specific types: BrainStateData, BrainObservation, BrainSignal, TimelineEvent, MemoryRecord, GoalRecord, Proposal, ReflectionReport, OvernightSession, PolicyRule, AuditEntry, ApprovalRequest, DaemonStatus |

### Styles

| File | Purpose |
|---|---|
| `app.css` | Animations for ThinkingAnimation, fade-in/slide-up, colored tool badges, log line animations |

---

## 12. Current Issues & Improvement Ideas

### Issue 1: Brain Section Missing from LeftNav

**Problem:** P19 brain entries are currently mixed into the same flat list as P11 platform entries under a single "Platform" section header. Users can't visually distinguish between platform features and brain features.

### Issue 2: Duplicate Entries

**Problem:** "Proposal Inbox" and "Memory/Memory Explorer" appear twice (once in P11, once in P19). This is confusing.

### Issue 3: Brain Page Consistency

Some brain pages are full-page components (BrainStatePage, BrainMemoryPage, etc.) while others are feature components (MemoryCockpit, GoalBoard, etc.). The brain pages need a consistent frame/container (max-w-5xl, padding, responsive).

### Issue 4: Navigation State Persistence

When navigating between platform and brain views, there's no breadcrumb or back button. User has to click sidebar items to switch views.

---

## 13. File Dependency Graph

```
App.tsx
  ├── components/LeftNav.tsx (PlatformNavItem, PLATFORM_NAV_ENTRIES, LeftNav, PlatformSectionHeader)
  ├── components/sidebar/Sidebar.tsx
  ├── components/StatCard.tsx
  ├── components/StatusBadge.tsx
  ├── components/WarningBanner.tsx
  ├── components/SchedulerStatusPanel.tsx
  ├── components/WorkerDetail.tsx
  ├── components/LiveLogTerminal.tsx
  ├── components/PlanSummary.tsx (legacy)
  ├── components/QueuePanel.tsx (legacy)
  ├── components/EventLine.tsx
  ├── components/PlanSummaryPanel.tsx
  ├── features/
  │   ├── autonomy/AutonomyCenter.tsx
  │   ├── memory/MemoryCockpit.tsx
  │   ├── plan-intake/PlanIntakePanel.tsx
  │   ├── policy-audit/PolicyAuditCenter.tsx
  │   ├── trust/TrustDashboard.tsx
  │   ├── proposal-inbox/ProposalInbox.tsx
  │   └── settings/RegistrySettings.tsx
  ├── components/ExtensionsManager.tsx
  ├── components/SkillsManager.tsx
  ├── components/brain/goals/GoalBoard.tsx
  ├── pages/
  │   ├── BrainStatePage.tsx
  │   ├── BrainMemoryPage.tsx
  │   ├── BrainReflectionsPage.tsx
  │   ├── BrainOvernightPage.tsx
  │   └── BrainTrustPage.tsx
  ├── components/ChatPanel.tsx
  ├── components/ArtifactBrowser.tsx
  ├── components/brain/overview/
  │   ├── DaemonStatusCard.tsx
  │   ├── LiveDaemonActivity.tsx
  │   ├── BrainPromptEditor.tsx
  │   ├── SignalSummaryCards.tsx
  │   ├── TimelineList.tsx
  │   └── index.ts
  ├── hooks/ (30+ hooks)
  ├── api/brain.ts
  └── types.ts / types-brain.ts
```

---

## 14. Key Architecture Decisions

1. **Single ActiveView state**: The entire center column is driven by one `activeView` state variable (`{ type: "run" | "task" | "platform" | "empty", screen?: PlatformNavItem }`). This keeps the routing simple and avoids React Router dependency.

2. **AnimatePresence sidebars**: Left and right sidebars use framer-motion `AnimatePresence` with width animation. Mobile uses absolute positioning with overlay. Desktop uses relative positioning with collapsible width.

3. **TanStack Query for data fetching**: All API calls go through React Query (`useQuery` / `useMutation`) for caching, background refetch, and optimistic updates.

4. **Brain API is a standalone Client class**: `BrainClient` in `api/brain.ts` encapsulates all brain endpoint calls with full type safety. Hooks wrap the client with React Query integration.

5. **Legacy vs Project mode**: The dashboard supports two modes:
   - **Legacy mode** (`!hasProjects`): Uses `usePlanState` and `useJournalStream` hooks, renders `PlanSummary` + `QueuePanel`
   - **Project mode** (`hasProjects`): Uses `usePlanExecutions` + `usePlanExecutionDetail` + `usePlanStats`, renders the full dashboard with stat cards, scheduler, worker detail, etc.

6. **Platform nav items are extensible**: The `PlatformNavItem` type union and `PLATFORM_NAV_ENTRIES[]` array make it easy to add new pages without modifying the routing logic — just add to the array and create a ternary in the render section.

7. **Daemon health via file-based bridge**: The orchestrator daemon (running in pi interactive mode) writes its health and activity to `.pi/orchestrator/health.json`. The web-server reads this file for brain state and live activity streams. The dashboard's "Start/Stop/Resume" buttons write control requests to `.pi/orchestrator/control-request.json` which the daemon picks up asynchronously.

8. **SSE for real-time updates**: Both health and daemon activity use Server-Sent Events (SSE) for push-based updates to the dashboard, polling health.json for changes every 2-10 seconds.
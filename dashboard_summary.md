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
| Topbar | `components/topbar/Topbar.tsx` | Extracted topbar: plan status badge, Resume/Pause/Stop/Restart buttons, Settings gear, sidebar collapse toggles, contextual toolbar |
| ContextualToolbar | `components/topbar/Topbar.tsx` | Upload, Git, Commands, Chat, Artifacts, Exec log buttons |

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

### LeftNav / PlatformNavItem Type

The `PlatformNavItem` union type now includes two named export arrays from `LeftNav.tsx`:

```typescript
export type PlatformNavItem =
  // P11 Platform
  | "autonomy" | "goals" | "observability" | "proposal_inbox" | "pi_inbox"
  | "plan_intake" | "extensions_skills" | "memory" | "policy_audit"
  | "trust_dashboard" | "registry_settings"
  // P19 Brain
  | "brain_digest" | "brain_state" | "brain_memory" | "brain_reflections"
  | "brain_overnight" | "brain_goals" | "brain_proposals" | "brain_trust";
```

#### P11 Platform Entries (`PLATFORM_NAV_ENTRIES[]`)

| id | Label | Icon | Description | Origin |
|---|---|---|---|---|
| `autonomy` | Autonomy | `Cpu` | Orchestrator health, proposals, self-improvement triggers | P11.S |
| `observability` | Observability | `Activity` | Telemetry events, stats, errors, time-series | P25 |
| `proposal_inbox` | Proposal Inbox | `Inbox` | Top-ranked proposals with recommendations | P11.S |
| `goals` | Goals | `Target` | Goal board, milestones, drift alerts | P11.S |
| `plan_intake` | Plan Intake | `ScrollText` | Plan analysis, DAG diff, optimization approval | P11.S |
| `extensions_skills` | Extensions & Skills | `Package` | Manage extensions, skills, and their lifecycle | P11.S |
| `memory` | Memory | `Database` | Memory health, provenance, compaction | P11.S |
| `policy_audit` | Policy & Audit | `ShieldAlert` | Permissions, approvals, audit timeline | P11.S |
| `trust_dashboard` | Trust Dashboard | `Shield` | Trust metrics, safety, approvals, audit health | P11.S |
| `pi_inbox` | Pi Inbox | `Bell` | Message center, system notifications, alerts | P24 |
| `registry_settings` | Registry Settings | `Sliders` | Local/remote registries, channels, update policy | P11.S |

#### P19 Brain Entries (`BRAIN_NAV_ENTRIES[]`)

| id | Label | Icon | Description | Origin |
|---|---|---|---|---|
| `brain_digest` | Morning Digest | `Sunrise` | Morning overview, top signals, pending proposals, goal progress | P24 |
| `brain_state` | Brain State | `Cpu` | Daemon status, observations, signals, timeline | P19 |
| `brain_memory` | Memory Explorer | `Database` | Full memory CRUD, search, filters | P19 |
| `brain_reflections` | Reflections | `RotateCw` | Post-plan reflections, worked/failed, suggestions | P19 |
| `brain_proposals` | Proposals | `Inbox` | Top-ranked proposals with recommendations | P19 |
| `brain_goals` | Goals | `Target` | Goal board, milestones, drift alerts | P19 |
| `brain_trust` | Trust Dashboard | `Shield` | Trust metrics, safety, approvals, audit health | P19 |
| `brain_overnight` | Overnight | `Moon` | Queue overnight runs, schedule, history | P19 |

**Responsible files:**
| File | Purpose |
|---|---|
| `components/LeftNav.tsx` | Defines `PlatformNavItem` type, `PLATFORM_NAV_ENTRIES[]`, `BRAIN_NAV_ENTRIES[]`, `LeftNav` component (renders platform + brain sections), `PlatformSectionHeader` |
| `App.tsx` | Wires LeftNav into sidebar, renders Platform + Brain sections, manages `activeView` state |



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
| `components/sidebar/BrainNudgeCard.tsx` | Brain nudge with observation/proposal/approval counts (P24.F) |
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

| Screen ID | Component | Origin | File |
|---|---|---|---|
| `autonomy` | `<AutonomyCenter />` | P11.S | `features/autonomy/AutonomyCenter.tsx` |
| `observability` | `<ObservabilityCockpit />` | P25.H | `features/observability/ObservabilityCockpit.tsx` |
| `proposal_inbox` | `<ProposalInbox />` | P11.S | `features/proposal-inbox/ProposalInbox.tsx` |
| `goals` | `<GoalBoard />` | P15 | `components/brain/goals/GoalBoard.tsx` |
| `plan_intake` | `<PlanIntakePanel />` | P11.S | `features/plan-intake/PlanIntakePanel.tsx` |
| `extensions_skills` | `<ExtensionsManager />` / `<SkillsManager />` | P11.S | `components/ExtensionsManager.tsx` / `SkillsManager.tsx` |
| `memory` | `<MemoryCockpit />` | P11.S | `features/memory/MemoryCockpit.tsx` |
| `policy_audit` | `<PolicyAuditCenter />` | P11.S | `features/policy-audit/PolicyAuditCenter.tsx` |
| `trust_dashboard` | `<TrustDashboard />` | P11.S | `features/trust/TrustDashboard.tsx` |
| `pi_inbox` | `<PiInbox />` | P24.M | `components/inbox/PiInbox.tsx` |
| `registry_settings` | `<RegistrySettings />` | P11.S | `features/settings/RegistrySettings.tsx` |
| `brain_digest` | `<DigestPage />` | P24.A | `pages/DigestPage.tsx` |
| `brain_state` | `<BrainStatePage />` | P19 | `pages/BrainStatePage.tsx` |
| `brain_memory` | `<BrainMemoryPage />` | P19 | `pages/BrainMemoryPage.tsx` |
| `brain_reflections` | `<BrainReflectionsPage />` | P19 | `pages/BrainReflectionsPage.tsx` |
| `brain_overnight` | `<BrainOvernightPage />` | P19 | `pages/BrainOvernightPage.tsx` |
| `brain_goals` | `<BrainGoalsPage />` | P19 | `pages/BrainGoalsPage.tsx` |
| `brain_proposals` | `<ProposalInbox />` (brain variant) | P19 | `features/proposal-inbox/ProposalInbox.tsx` |
| `brain_trust` | `<BrainTrustPage />` | P19 | `pages/BrainTrustPage.tsx` |

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
│  ┌─ ExecutionLogViewer ──┐  ┌─ RerunDialog ─────────┐  ┌─ ForceKillDialog ─┐ │
│  │ Full plan execution    │  │ Confirm rerun of       │  │ Force-kill all     │ │
│  │ log viewer             │  │ selected execution     │  │ active workers     │ │
│  └────────────────────────┘  └───────────────────────┘  └───────────────────┘ │
│  ┌─ TaskCreateDialog ───┐  ┌─ WorktreeCleanupDialog ──┐                       │
│  │ Create new task with  │  │ Scoped worktree cleanup  │                       │
│  │ name, description,    │  │ with branch selection    │                       │
│  │ execution mode        │  │                          │                       │
│  └───────────────────────┘  └──────────────────────────┘                       │
│                                                                               │
│  Overlays (slide-in from right / center):                                     │
│  ┌─ BrainContextPanel ──────────────────────────────────────────────────────┐ │
│  │ Slide-in panel showing project brain context: memories, reflections,     │ │
│  │ signals for the currently selected project (P24.D)                       │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
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
| `/api/digest` | GET | `useDigest` | Morning digest data (P24.A) |
| `/api/digest/feedback` | POST | `useDigestFeedback` | Submit feedback on digest items (P24.J) |
| `/api/digest/quick-actions` | GET | `useDigestActions` | Quick action suggestions (P24.K) |
| `/api/activity/timeline` | GET | `useActivityTimeline` | Unified activity feed (P24.L) |
| `/api/pi/inbox` | GET | `usePiInbox` | System messages & alerts (P24.M) |
| `/api/pi/inbox/read` | POST | `useMarkRead` | Mark message as read |
| `/api/pi/inbox/read-all` | POST | `useMarkAllRead` | Mark all messages as read (P24.M) |
| `/api/pi/inbox/delete` | DELETE | `useDeleteMessage` | Delete a single message |
| `/api/pi/inbox/purge-read` | DELETE | `usePurgeRead` | Purge all read messages |
| `/api/pi/inbox/clear` | DELETE | `useClearInbox` | Clear entire inbox |
| `/api/notifications/preferences` | GET/PUT | `useNotificationPreferences` | Notification channel prefs (P24.H) |
| `/api/brain/projects/:pid/context` | GET | `useProjectBrainContext` | Per-project brain context (P24.D) |
| `/api/telemetry/dashboard` | GET | `useTelemetryDashboard` | Observability dashboard summary (P25.H) |
| `/api/telemetry/events` | GET | `useTelemetryEvents` | Telemetry event list with filters (P25.H) |
| `/api/telemetry/stats` | GET | `useTelemetryStats` | Event statistics (P25.H) |
| `/api/telemetry/timeseries` | GET | `useTelemetryTimeSeries` | Time-series event data (P25.H) |
| `/api/telemetry/errors` | GET | `useTelemetryErrors` | Error analysis (P25.H) |
| `/api/telemetry/retention` | GET | `useTelemetryRetentionPolicy` | Retention policy info (P25.H) |
| `/api/tasks` | GET/POST | `usePlanExecutions` | Task CRUD (P22.E) |
| `/api/tasks/:tid/phases` | GET | `usePlanExecutions` | Phase plans for a task |
| `/api/executions/:eid/log` | GET | `ExecutionLogViewer` | Full execution log content |
| `/api/projects/:pid/worktrees` | GET | `useWorktreeFiles` | Worktree file listing (P22.D) |
| `/api/projects/:pid/worktrees/:wid/files` | GET | `useWorktreeFiles` | Worktree file content/diff (P22.D) |
| `/api/scale/worktrees` | GET | `useScaleStatus` | Worktree status list (P6.5) |
| `/api/scale/integration-queue` | GET | `useIntegrationQueueStatus` | Integration queue status |
| `/api/scale/integration-queue/optimization` | GET | `useScaleStatus` | Queue optimization suggestions |

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

### 10d. P24 Daily Intelligence Layer — Morning Digest, Inbox, Notifications

The P24 Daily Intelligence Layer adds a suite of features for daily awareness:

#### Morning Digest (`/api/digest`)

Consolidates daemon state, top signals, pending proposals, recent activity, goal progress, and project memory into a single morning overview:

```typescript
interface MorningDigest {
  daemonState: DaemonStatus;
  topSignals: BrainSignal[];
  pendingProposals: Proposal[];
  recentActivity: ActivityEvent[];
  goalProgress: { completed: number; total: number };
  projectMemory: MemoryRecord[];
  quickActions: DigestQuickAction[];
}
```

#### Pi Inbox (`/api/pi/inbox`)

System notification center with:
- Priority-based color coding (critical/warning/info)
- Type-based icons (system, daemon, proposal, goal, memory, security)
- Read/unread state with bulk actions
- Collapsible detail view per message

#### Notification Preferences (`/api/notifications/preferences`)

Per-channel delivery configuration:
- Global enable/disable
- Channel toggles (email, inbox, system)
- Per-type routing rules

#### Brain Context Panel (`/api/brain/projects/:pid/context`)

Slide-in right panel showing per-project brain context:
- Recent memories from project-specific memory store
- Recent reflections mentioning the project
- Active signal counts for the project

### 10e. P25 Local Observability Cockpit

The Observability Cockpit (`features/observability/ObservabilityCockpit.tsx`) provides a unified telemetry dashboard:

```
┌─ Observability Cockpit ──────────────────────────────────────────────────┐
│ [All] [Info] [Warning] [Error] [Critical]  [1h ▼] [↻ Auto-refresh]    │
├── Summary Cards ─────────────────────────────────────────────────────────┤
│ [Total: 1,234] [Errors: 23] [Avg Dur: 1.2s] [Error Rate: 1.8%]         │
├── Time-series Chart ─────────────────────────────────────────────────────┤
│ (Event count over time, color-coded by severity)                        │
├── Error Analysis Panel ──────────────────────────────────────────────────┤
│ Top error sources, correlation IDs, trace IDs                           │
├── Recent Events Table ───────────────────────────────────────────────────┤
│ [12:34:05] [ERR] [file-watcher] Timeout reading src/main.ts            │
│ [12:34:02] [WARN] [memory] Pressure detected: 85% heap used            │
│ [12:33:58] [INFO] [git] Commit detected: abc1234                       │
│ ... [click to expand full event detail side panel]                      │
├── Retention Policy Info ─────────────────────────────────────────────────┤
│ Events retained: 30 days | Auto-purge: enabled | Current size: 45MB     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Observability Event Schema** (`types-observability.ts`):
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique event ID |
| `timestamp` | string | RFC 3339 timestamp |
| `eventType` | string | Event type classifier |
| `source` | string | Source component name |
| `severity` | `debug \| info \| warning \| error \| critical` | Severity level |
| `status` | `ok \| error \| running \| unknown` | Status |
| `name` | string | Short event name |
| `traceId` | string | Distributed trace ID (P25.A) |
| `spanId` | string | Span within trace |
| `parentSpanId` | string \| null | Parent span for correlation |
| `correlationId` | string \| null | Cross-service correlation |
| `durationMs` | number \| null | Event duration |
| `error` | string \| null | Error message if applicable |

**Hooks (all from `hooks/useTelemetry.ts`):**
| Hook | Purpose |
|---|---|
| `useTelemetryDashboard()` | Summary stats: total events, error rate, avg duration |
| `useTelemetryEvents(filters)` | Paginated event list with severity/source/type/time filters |
| `useTelemetryStats(filters)` | Event statistics by severity, source, type |
| `useTelemetryTimeSeries(filters)` | Time-series aggregation for charting |
| `useTelemetryErrors(filters)` | Error analysis: top sources, trace bundling |
| `useTelemetryRetentionPolicy()` | Retention config: max age, max size, auto-purge |

### 10f. Brain State API Response Wrapper Fixes

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
| `components/LeftNav.tsx` | ~160 | `PlatformNavItem` type, `PLATFORM_NAV_ENTRIES[]`, `BRAIN_NAV_ENTRIES[]`, `LeftNav` component (renders platform + brain sections), `PlatformSectionHeader` |
| `components/sidebar/Sidebar.tsx` | ~400 | P22.A project-centric sidebar: project selector, brain/tasks/runs/platform sections |
| `components/ProjectItem.tsx` | ~30 | Single project row in Projects tab |
| `components/HistoryItem.tsx` | ~40 | Single execution row in Runs tab (status badge, title, date) |
| `components/TaskList.tsx` | ~80 | Task list and tree view in Tasks tab |
| `components/TaskCard.tsx` | ~40 | Single task card with status badge |
| `components/TaskAggregatesBar.tsx` | ~40 | Aggregate task stats (total, running, complete, failed) |
| `components/TaskCreateDialog.tsx` | ~190 | Task creation dialog (P22.E): name, description, execution mode |
| `components/TaskDetailView.tsx` | ~250 | Task detail with phase plans, timeline, logs |
| `components/sidebar/BrainNudgeCard.tsx` | ~150 | Sidebar brain nudge with observation/proposal/approval counts (P24.F) |

### Center Column — Extracted Layout Components

| File | Lines | Purpose |
|---|---|---|
| `components/topbar/Topbar.tsx` | ~200 | Extracted topbar: plan status badge, control buttons, sidebar collapse toggles (P22) |
| `components/right-sidebar/RightSidebar.tsx` | ~150 | Extracted right sidebar: events, alerts, plan summary (P22) |
| `components/right-sidebar/types.ts` | ~30 | Right sidebar type definitions (AlertEntry) |

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
| `components/WorkerList.tsx` | ~100 | Scrollable worker list with status badges |
| `components/WorkerP6LifecycleTab.tsx` | ~80 | Worker P6 lifecycle state transitions tab |
| `components/BlockedReasonPanel.tsx` | ~60 | Shows block reason for blocked workers with resolution hints |
| `components/LogViewer.tsx` | ~120 | Static log viewer for completed workers |
| `components/ExecuteScreen.tsx` | ~200 | Execution initiation screen with mode selection |
| `components/ReviewScreen.tsx` | ~150 | Pre-commit review screen showing changes |
| `components/ValidationScreen.tsx` | ~150 | Plan validation screen with error/warning list |
| `components/FileSelectScreen.tsx` | ~100 | File/folder selection screen for targeted execution |

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
| `features/observability/ObservabilityCockpit.tsx` | ~900 | P25.H Observability cockpit: summary cards, time-series, error analysis, event table |
| `components/inbox/PiInbox.tsx` | ~800 | P24.M Pi inbox: priority-coded messages, read/unread, bulk actions |
| `pages/DigestPage.tsx` | ~100 | P24.A Morning digest: daemon state, signals, proposals, activity |

### Brain Pages

| File | Lines | Purpose |
|---|---|---|
| `pages/BrainStatePage.tsx` | ~150 | P19 Brain state: daemon status, observations, signals, timeline, live activity, prompt editor |
| `pages/BrainMemoryPage.tsx` | ~150 | P19 Memory explorer: full CRUD, search, filters |
| `pages/BrainReflectionsPage.tsx` | ~150 | P19 Reflections: post-plan reflections, suggestions |
| `pages/BrainOvernightPage.tsx` | ~150 | P19 Overnight: queue runs, schedule, history |
| `pages/BrainTrustPage.tsx` | ~100 | P19 Trust: policy rules, audit entries |
| `pages/BrainGoalsPage.tsx` | ~100 | P19 Goals: goal board integration |
| `pages/BrainTrustPage.tsx` | ~100 | P19 Trust: policy rules, audit entries (separate from P11 TrustDashboard) |

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
| `components/brain/common/LoadingSkeleton.tsx` | ~30 | Reusable loading skeleton placeholder |
| `components/brain/common/ErrorState.tsx` | ~30 | Reusable error state with retry button |
| `components/brain/common/EmptyState.tsx` | ~20 | Reusable empty state illustration |
| `components/brain/common/Pagination.tsx` | ~50 | Reusable pagination component |
| `components/brain/common/SearchInput.tsx` | ~30 | Reusable search input |
| `components/brain/common/StatusBadge.tsx` | ~20 | Shared status badge component |

### P24 Daily Intelligence Layer — Digest & Inbox Sub-components

| File | Lines | Purpose |
|---|---|---|
| `components/digest/MorningCard.tsx` | ~120 | Morning overview card: daemon state, stats, quick actions (P24.A) |
| `components/digest/SignalFeed.tsx` | ~80 | Top signals feed with severity badges (P24.A) |
| `components/digest/ProposalNudge.tsx` | ~60 | Pending proposal nudges with accept/reject (P24.A) |
| `components/digest/ActivityTimeline.tsx` | ~150 | Unified activity feed: plan events, daemon events (P24.L) |
| `components/digest/FeedbackControls.tsx` | ~300 | Thumbs up/down rating with comment (P24.J) |
| `components/digest/DigestQuickActions.tsx` | ~100 | Quick action buttons: run overnight, view proposals, etc. (P24.K) |
| `components/digest/ProjectMemorySnippet.tsx` | ~50 | Project memory snippet for brain context panel (P24.D) |
| `components/digest/ReflectionSnippet.tsx` | ~40 | Recent reflection mentioning the project (P24.D) |

### P25 Observability Sub-components

| File | Lines | Purpose |
|---|---|---|
| `features/observability/ObservabilityCockpit.tsx` | ~900 | Full observability cockpit (see section 10e) (P25.H) |

### Scale & Batch Components

| File | Lines | Purpose |
|---|---|---|
| `components/ScaleCockpitPanel.tsx` | ~100 | Scale cockpit: groups worktree, queue, conflict panels (P6.5) |
| `components/ScaleOverviewStrip.tsx` | ~80 | Top-level scale mode overview strip |
| `components/ScaleModeSettings.tsx` | ~120 | Scale mode configuration (parallelism, experimental) |
| `components/WorktreeStatusPanel.tsx` | ~280 | Git worktree status: branch, dirty, path, cleanup (P6.J) |
| `components/IntegrationQueuePanel.tsx` | ~100 | Integration queue status: pending, running, done |
| `components/QueueOptimizationPanel.tsx` | ~80 | Queue optimization suggestions from planner |
| `components/BatchOSDashboard.tsx` | ~600 | Batch OS dashboard: DAG parallelism, safe parallelism, queue metrics (P7.C) |
| `components/BatchExplorer.tsx` | ~200 | Batch plan tree explorer with status visualization |
| `components/SafeBatchPreview.tsx` | ~80 | Safe effective parallelism preview with planner suggestions |

### P22 File Explorer & Multi-DAG Viewer

| File | Lines | Purpose |
|---|---|---|
| `components/FileExplorer.tsx` | ~730 | Tree view of worktree files with directory navigation, diff, content preview (P22.D) |
| `components/MultiDagViewer.tsx` | ~840 | SVG-based interactive multi-DAG viewer: zoom, pan, mini-map, color-coded phases (P22.F) |


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
| `hooks/useDigest.ts` | P24.A Morning digest | `fetchDigest()`, auto-refresh |
| `hooks/useDigestActions.ts` | P24.K Quick actions | `fetchQuickActions()`, `executeQuickAction()` |
| `hooks/useDigestFeedback.ts` | P24.J Feedback submission | `submitFeedback()`, states: neutral/submitting/success/error/update |
| `hooks/useActivityTimeline.ts` | P24.L Activity timeline | `fetchActivityTimeline()`, event type filtering |
| `hooks/usePiInbox.ts` | P24.M Pi inbox | `fetchMessages()`, `markRead()`, `markAllRead()`, `deleteMessage()`, `purgeRead()`, `clearInbox()` |
| `hooks/useNotificationPreferences.ts` | P24.H Notification prefs | `fetchPreferences()`, `updatePreferences()`, `resetDefaults()` |
| `hooks/useProjectBrainContext.ts` | P24.D Per-project brain context | `fetchContext()`, returns memories, reflections, signals |
| `hooks/useTelemetry.ts` | P25.H Observability | 6 hooks: `useTelemetryDashboard()`, `useTelemetryEvents()`, `useTelemetryStats()`, `useTelemetryTimeSeries()`, `useTelemetryErrors()`, `useTelemetryRetentionPolicy()` |
| `hooks/useWorktreeFiles.ts` | P22.D Worktree files | `listFiles()`, `getFileContent()`, `getDiff()`, auto-refresh polling |
| `hooks/useScaleStatus.ts` | P6.5 Scale status | `useWorktreeStatus()`, `useIntegrationQueueStatus()`, `useScaleModeReadiness()`, `useWorktreeCleanup()`, `useQueueMetrics()` |
| `hooks/useBatchPlan.ts` | P7.C Batch OS | `useBatchPlanExplorer()`, `useBatchPlanDetails()` |
| `hooks/usePlanTranscript.ts` | Plan transcript streaming | SSE-based plan transcript stream |
| `hooks/usePlanWorkspaces.ts` | Workspace tracking | Workspace CRUD and status tracking |
| `hooks/usePlanQueue.ts` | Plan queue | Executor queue status and control |
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
| `types.ts` | Core types: WorkerInfo, WorkspaceSummary, GitFilePatch, PlanExecution, PlanStats, PerformanceMetric, chat types, MultiPhaseTask, PhasePlan |
| `types-brain.ts` | Brain-specific types: BrainStateData, BrainObservation, BrainSignal, TimelineEvent, MemoryRecord, GoalRecord, Proposal, ReflectionReport, OvernightSession, PolicyRule, AuditEntry, ApprovalRequest, DaemonStatus, MorningDigest, FeedbackEntry |
| `types-observability.ts` | Observability types: ObservabilityEvent, EventStatistics, TelemetryDashboardSummary, ObservabilitySeverity, ObservabilityStatus (P25.H) |
| `types-artifacts.ts` | Artifact types for ArtifactBrowser |

### Styles

| File | Purpose |
|---|---|
| `app.css` | Animations for ThinkingAnimation, fade-in/slide-up, colored tool badges, log line animations |
| `index.css` / `tailwind.css` | Tailwind base styles and theme variables |

---

## 12. Current Issues & Improvement Ideas

### Issue 1: ~~Brain Section Missing from LeftNav~~ (RESOLVED)

**Resolved by:** `LeftNav.tsx` now renders `PLATFORM_NAV_ENTRIES[]` under a "Platform" header and `BRAIN_NAV_ENTRIES[]` under a "Brain (P19)" header. No longer mixed.

### Issue 2: Duplicate Entries

**Problem:** "Proposal Inbox" appears in both P11 and P19, and "Memory" / "Memory Explorer" appear in both. This is intentional but creates a confusing UX.

### Issue 3: Brain Page Consistency

Some brain pages are full-page components (BrainStatePage, BrainMemoryPage, etc.) while others are feature components (MemoryCockpit, GoalBoard, etc.). The brain pages need a consistent frame/container (max-w-5xl, padding, responsive).

### Issue 4: Navigation State Persistence

When navigating between platform and brain views, there's no breadcrumb or back button. User has to click sidebar items to switch views.

### Issue 5: Observability Cockpit File Size

`ObservabilityCockpit.tsx` is ~900 lines — should be split into smaller sub-components (summary cards, chart, event table, error analysis panel).

### Issue 6: Digest/Inbox Duplication Potential

The Pi Inbox (`PiInbox.tsx`) and event feed in the right sidebar (`EventLine`) both show system events. Need to define clear separation: inbox for persistent notifications, right sidebar for real-time execution events.

---

## 13. File Dependency Graph

```
App.tsx (1229 lines)
  │
  ├── Layout Components (extracted P22)
  │   ├── components/topbar/Topbar.tsx
  │   ├── components/right-sidebar/RightSidebar.tsx
  │   │   └── components/EventLine.tsx
  │   │       components/PlanSummaryPanel.tsx
  │   └── components/sidebar/Sidebar.tsx
  │       ├── components/sidebar/BrainNudgeCard.tsx (P24.F)
  │       └── components/LeftNav.tsx (PLATFORM_NAV_ENTRIES[], BRAIN_NAV_ENTRIES[])
  │
  ├── Plan Execution View
  │   ├── components/StatCard.tsx
  │   ├── components/StatusBadge.tsx
  │   ├── components/WarningBanner.tsx
  │   ├── components/SchedulerStatusPanel.tsx
  │   ├── components/WorkerDetail.tsx
  │   ├── components/LiveLogTerminal.tsx
  │   ├── components/WorkerList.tsx
  │   ├── components/BlockedReasonPanel.tsx
  │   ├── components/LogViewer.tsx
  │   ├── components/PlanSummary.tsx (legacy)
  │   ├── components/QueuePanel.tsx (legacy)
  │   └── components/ScaleCockpitPanel.tsx (P6.5)
  │       ├── components/WorktreeStatusPanel.tsx
  │       ├── components/IntegrationQueuePanel.tsx
  │       ├── components/QueueOptimizationPanel.tsx
  │       └── components/ScaleModeSettings.tsx
  │
  ├── Platform Feature Pages
  │   ├── features/autonomy/AutonomyCenter.tsx
  │   ├── features/observability/ObservabilityCockpit.tsx (P25.H)
  │   ├── features/memory/MemoryCockpit.tsx
  │   ├── features/plan-intake/PlanIntakePanel.tsx
  │   ├── features/policy-audit/PolicyAuditCenter.tsx
  │   ├── features/trust/TrustDashboard.tsx
  │   ├── features/proposal-inbox/ProposalInbox.tsx
  │   ├── features/settings/RegistrySettings.tsx
  │   ├── components/ExtensionsManager.tsx
  │   ├── components/SkillsManager.tsx
  │   ├── components/brain/goals/GoalBoard.tsx
  │   ├── components/inbox/PiInbox.tsx (P24.M)
  │   └── components/BrainContextPanel.tsx (P24.D)
  │
  ├── Brain Pages (P19)
  │   ├── pages/BrainStatePage.tsx
  │   ├── pages/BrainMemoryPage.tsx
  │   ├── pages/BrainReflectionsPage.tsx
  │   ├── pages/BrainOvernightPage.tsx
  │   ├── pages/BrainTrustPage.tsx
  │   ├── pages/BrainGoalsPage.tsx
  │   └── pages/DigestPage.tsx (P24.A)
  │
  ├── Dialogs & Overlays
  │   ├── components/OpenProjectDialog.tsx
  │   ├── components/PlanUploadDialog.tsx
  │   ├── components/SettingsDialog.tsx
  │   ├── components/RerunDialog.tsx
  │   ├── components/ExecutionLogViewer.tsx
  │   ├── components/ForceKillDialog.tsx (P25.A)
  │   ├── components/TaskCreateDialog.tsx (P22.E)
  │   ├── components/WorktreeCleanupDialog.tsx (P6.J)
  │   ├── components/ChatPanel.tsx
  │   ├── components/ArtifactBrowser.tsx
  │   ├── components/GitDialog.tsx
  │   ├── components/CommandsPanel.tsx
  │   └── components/MergeConflictPanel.tsx
  │
  ├── Brain Sub-components
  │   ├── components/brain/overview/
  │   │   ├── DaemonStatusCard.tsx
  │   │   ├── LiveDaemonActivity.tsx
  │   │   ├── BrainPromptEditor.tsx
  │   │   ├── SignalSummaryCards.tsx
  │   │   ├── TimelineList.tsx
  │   │   ├── ObservationStats.tsx
  │   │   └── index.ts
  │   ├── components/brain/memory/ (MemoryList, MemoryCard, etc.)
  │   ├── components/brain/reflections/ (ReflectionCard, etc.)
  │   ├── components/brain/proposals/ (ProposalCard, CorrectForm, etc.)
  │   ├── components/brain/overnight/ (RunHistoryTable, SchedulePicker, etc.)
  │   ├── components/brain/trust/ (PolicyRuleTable, ApprovalSummaryCard, etc.)
  │   ├── components/brain/goals/ (GoalCard, GoalDetail, MilestoneTracker, etc.)
  │   └── components/brain/common/ (LoadingSkeleton, ErrorState, EmptyState, etc.)
  │
  ├── P24 Digest Sub-components
  │   ├── components/digest/MorningCard.tsx
  │   ├── components/digest/SignalFeed.tsx
  │   ├── components/digest/ProposalNudge.tsx
  │   ├── components/digest/ActivityTimeline.tsx (P24.L)
  │   ├── components/digest/FeedbackControls.tsx (P24.J)
  │   ├── components/digest/DigestQuickActions.tsx (P24.K)
  │   ├── components/digest/ProjectMemorySnippet.tsx (P24.D)
  │   └── components/digest/ReflectionSnippet.tsx (P24.D)
  │
  ├── Execution Screens
  │   ├── components/ExecuteScreen.tsx
  │   ├── components/ValidationScreen.tsx
  │   ├── components/ReviewScreen.tsx
  │   └── components/FileSelectScreen.tsx
  │
  ├── P22 Specialized Viewers
  │   ├── components/FileExplorer.tsx (P22.D)
  │   ├── components/MultiDagViewer.tsx (P22.F)
  │   ├── components/DagDiffViewer.tsx
  │   ├── components/DiffViewer.tsx
  │   └── components/SafeBatchPreview.tsx
  │
  ├── Proposal & Optimizer
  │   ├── components/ProposalDetailPanel.tsx
  │   ├── components/ProposalCard.tsx
  │   ├── components/OriginCard.tsx
  │   ├── components/OptimizerApprovalPanel.tsx
  │   ├── components/ParallelismEditor.tsx
  │   └── components/PerformancePanel.tsx
  │
  ├── P16+ Proposal Inbox Sub-components
  │   ├── components/brain/proposals/ProposalCard.tsx
  │   ├── components/brain/proposals/CorrectForm.tsx
  │   ├── components/brain/proposals/EvidenceDrawer.tsx
  │   ├── components/brain/proposals/RejectModal.tsx
  │   └── components/brain/proposals/index.ts
  │
  ├── Hooks (50+ hooks)
  │   ├── hooks/useBrainStatus.ts (P19 state, observations, signals)
  │   ├── hooks/useMemoryRecords.ts (P19 memory CRUD)
  │   ├── hooks/useReflections.ts (P19 reflections)
  │   ├── hooks/useOvernight.ts (P19 overnight sessions)
  │   ├── hooks/useGoals.ts / useGoalBoard.ts (P15 goals)
  │   ├── hooks/useBrainProposals.ts (P19 proposals)
  │   ├── hooks/useTrust.ts (P18 trust/policy)
  │   ├── hooks/useDigest.ts / useDigestActions.ts / useDigestFeedback.ts (P24)
  │   ├── hooks/useActivityTimeline.ts (P24.L)
  │   ├── hooks/usePiInbox.ts (P24.M)
  │   ├── hooks/useNotificationPreferences.ts (P24.H)
  │   ├── hooks/useProjectBrainContext.ts (P24.D)
  │   ├── hooks/useTelemetry.ts (P25.H, 6 export hooks)
  │   ├── hooks/useWorktreeFiles.ts (P22.D)
  │   ├── hooks/useScaleStatus.ts (P6.5 scale)
  │   ├── hooks/usePlanExecutions.ts / usePlanEvents.ts / usePlanRunner.ts
  │   ├── hooks/useProjects.ts / useSettings.ts / useAuth.ts
  │   ├── hooks/useExtensions.ts / useSkills.ts
  │   ├── hooks/useToolCallEvents.ts / useJournalStream.ts / usePlanQueue.ts
  │   └── hooks/useTheme.ts / useUnreadCount.ts
  │
  ├── API Layer
  │   ├── api/brain.ts (BrainClient, 30+ typed methods)
  │   └── App.tsx (inline fetch for control commands, projects, etc.)
  │
  └── Types
      ├── types.ts (core types)
      ├── types-brain.ts (brain-specific types, MorningDigest, FeedbackEntry)
      ├── types-observability.ts (P25.H event schema)
      └── types-artifacts.ts (artifact browser types)
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
# Phase P19 — Full Second-Brain Dashboard & Autonomy UX

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P19`  
**One-line goal:** Turn the V2 backend into a usable second-brain product experience — all 7 dashboard pages fully integrated with real-time data, actions, and feedback.  
**Why now:** P13-P18 built backend. P19 turns server endpoints into composable UI. This is Milestone 3b — "Full Second-Brain UX".  
**Blast radius:** Complete dashboard rewrite; `packages/web-ui/dashboard` only (no backend changes).  
**Rollback path:** Remove V2 dashboard routes, fall back to existing dashboard.  
**Scale mode:** `stable_3`
**Safe parallelism target:** 3  
**Done when:** All 7 pages functional, all endpoints integrated, error/loading/empty states everywhere, navigation works, responsive, dogfood complete.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P19` |
| Title | `Full Second-Brain Dashboard & Autonomy UX` |
| Status | `Authoritative Implementation` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Complete V2 dashboard UX: brain state, proposals, memory, goals, autonomy, reflections, overnight` |
| Scale mode | `stable_3` |
| Worktree isolation | `Optional` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P19.A — Brain State Viewer | Pi Worker Agent | User | Reviewer | User |
| P19.B — Proposal Inbox | Pi Worker Agent | User | Reviewer | User |
| P19.C — Memory Explorer | Pi Worker Agent | User | Reviewer | User |
| P19.D — Goal Board | Pi Worker Agent | User | Reviewer | User |
| P19.E — Autonomy Controls | Pi Worker Agent | User | Reviewer | User |
| P19.F — Reflection Timeline | Pi Worker Agent | User | Reviewer | User |
| P19.G — Overnight Run Panel | Pi Worker Agent | User | Reviewer | User |
| P19.H — Dashboard Integration | Pi Worker Agent | User | Reviewer | User |
| P19.I — P19 Dogfood & Report | Pi Worker Agent | User | Reviewer | User |

---

## 2. Purpose

Expose the complete V2 second-brain product through a polished dashboard. All prior phases converge here:

| Phase | Component | Dashboard Page |
|-------|-----------|----------------|
| P13 | Observations, Signals, Timeline | `/brain` Brain State |
| P14 | Memory CRUD, Search | `/brain/memory` Memory Explorer |
| P15 | Goals, Preferences, Autonomy | `/brain/goals`, `/brain/autonomy` |
| P16 | Proposals, Inbox | `/brain/inbox` Proposal Inbox |
| P17 | Reflections, Suggestions | `/brain/reflections` Reflection Timeline |
| P18 | Policy, Approvals, Audit | `/brain/trust` Trust Dashboard |

### 2.1 Navigation Structure

```
Dashboard Header
├── 🔵 Brain State   (/brain)         ← default landing
├── 📥 Inbox          (/brain/inbox)   ← badge with pending count
├── 🧠 Memory         (/brain/memory)
├── 🎯 Goals          (/brain/goals)
├── 🔒 Trust          (/brain/trust)   ← added in P18
├── 🔄 Reflections    (/brain/reflections)
└── 🌙 Overnight      (/brain/overnight)
```

---

## 3. State Management Convention

All pages follow the same pattern:

```typescript
interface PageState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastRefreshed: string | null;
}

// Hook pattern:
function usePageData<T>(fetcher: () => Promise<T>): PageState<T> & {
  refresh: () => Promise<void>;
  invalidate: () => void;
}

// Error handling:
// - Network error: "Unable to connect to Pi server. Check if the server is running."
// - 404: empty state with "No data yet" message
// - 500: "Server error. Try again in a few moments."
// - Auth error: "Not authorized. Check permissions."
```

---

## 4. Detailed Page Specifications

### 4.A — Brain State Viewer (`/brain`)

**Source:** P13 endpoints: `GET /api/brain/state`, `GET /api/brain/timeline`, `GET /api/brain/observations`, `GET /api/brain/signals`

**Layout:**
```
┌─────────────────────────────────┐
│  Brain State  [🔴 Daemon Off]   │  <- Header with daemon indicator
├────────────────┬────────────────┤
│  Observations   │  Signals       │  <- Summary cards
│  Total: 47     │  Active: 3     │
│  Warnings: 12  │  Resolved: 8   │
│  Critical: 2   │                │
├────────────────┴────────────────┤
│  Timeline (last 50 events)      │  <- Scrollable list
│  [warning] Queue blocked         │
│  [info]    Plan completed P14    │
│  [info]    Workspace success     │
│  [critical] Integration dirty   │
│  ...                             │
├─────────────────────────────────┤
│  [↻ Refresh]  [⏱ Auto-refresh]  │  <- Controls
└─────────────────────────────────┘
```

**Components:**
```typescript
// DaemonStatusCard.tsx
// Props: { status: 'running' | 'stopped' | 'error', uptime: string, observationCount: number }
// States: loading (skeleton dot), running (green dot), stopped (red dot), error (yellow dot + error message)

// ObservationStats.tsx
// Props: { total: number, bySeverity: Record<Severity, number> }
// Bars: info (blue), warning (orange), critical (red)
// States: zero-state shows "0 observations"

// SignalSummaryCards.tsx
// Props: { signals: Array<{ type: string, count: number, severity: string }> }
// One card per unique signal type
// States: empty if no signals ("No signals detected")

// TimelineList.tsx
// Props: { events: TimelineEvent[], loading: boolean, error: string | null }
// Scrollable, virtualized for performance
// States: loading (skeleton rows), empty ("No events yet"), error ("Failed to load timeline")
```

**Hooks:**
```typescript
function useBrainStatus() {
  const [state, setState] = useState<PageState<BrainStateData>>();
  const [daemon, setDaemon] = useState<DaemonState>();
  const [observations, setObservations] = useState<ObservationStats>();
  const [signals, setSignals] = useState<SignalData[]>();
  const [timeline, setTimeline] = useState<TimelineEvent[]>();
  
  return {
    daemon, observations, signals, timeline,
    loading: boolean,
    error: string | null,
    refresh: () => Promise<void>,
    autoRefresh: boolean,
    setAutoRefresh: (v: boolean) => void,
  };
}
```

---

### 4.B — Proposal Inbox (`/brain/inbox`)

**Source:** P16 endpoints

**Layout:**
```
┌────────────────────────────────────┐
│  Inbox  (3 pending)                │
├────────────────────────────────────┤
│  ┌──────────────────────────────┐  │
│  │ Proposal: Add retry budget   │  │  <- Top-3 prioritized cards
│  │ Score: 0.82 ★★★★☆           │  │
│  │ Evidence: 3 memories, 5 obs  │  │
│  │ Risk: Medium                  │  │
│  │ [✅ Accept] [❌ Reject] [✏️ Correct]│
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Proposal: Optimize DAG       │  │
│  │ Score: 0.76 ★★★★☆           │  │
│  │ ...                           │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Proposal: Update memory TTL  │  │
│  │ Score: 0.61 ★★★☆☆           │  │
│  │ ...                           │  │
│  └──────────────────────────────┘  │
├────────────────────────────────────┤
│  📊 Stats: 10 total | 3 pending   │
│  Accepted: 5 | Rejected: 2        │
└────────────────────────────────────┘
```

**Components:**
- `ProposalCard` — score badge, evidence count, risk level, action buttons
- `EvidenceDrawer` — expandable panel showing memory/observation references
- `RejectModal` — reason input before rejecting
- `CorrectForm` — editable fields for proposal correction
- `EmptyState` — "No pending proposals. Pi will generate ideas from observations."

**Hooks:**
```typescript
function useProposals() {
  return {
    inbox: InboxView | null,
    loading, error,
    accept: (id: string) => Promise<void>,
    reject: (id: string, reason?: string) => Promise<void>,
    correct: (id: string, corrections: object) => Promise<void>,
    refresh: () => void,
    stats: ProposalStats | null,
  };
}
```

---

### 4.C — Memory Explorer (`/brain/memory`)

**Source:** P14 endpoints

**Layout:**
```
┌──────────────────────────────────────┐
│  Memory Explorer                     │
│  [🔍 Search...] [Filter ▼]          │
│  Types: [☑ all] [☑ failure] ...     │
│  Lifecycle: [☑ active] [☑ candidate]│
├──────────────────────────────────────┤
│  Stats: 24 memories | 8 types       │
├──────────────────────────────────────┤
│  ┌────────────────────────────────┐  │
│  │ Retry hotspot in P14         🟢│  │  <- Memory card
│  │ Type: failure_memory           │  │
│  │ Confidence: 0.85 ████████░░    │  │
│  │ Tags: #retry #hotspot #p14    │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ User prefers morning plans   🟢│  │
│  │ Type: user_preference_memory   │  │
│  │ ...                            │  │
│  └────────────────────────────────┘  │
├──────────────────────────────────────┤
│  [< 1 2 3 ... 5 >]                  │  <- Pagination
└──────────────────────────────────────┘
```

**Components:**
- `MemorySearch` — debounced input (300ms), results update as you type
- `MemoryFilterPanel` — type checkboxes, lifecycle checkboxes, tag autocomplete
- `MemoryCard` — title, type badge, lifecycle badge (🟢active/🟡candidate/🔴rejected), confidence bar, tag chips
- `MemoryDetailModal` — full content, source refs, edit/reject/activate actions
- `MemoryEditForm` — in-modal edit form for title, content, tags
- `EmptyState` — "No memories yet. Run plans to generate memories."

**Hooks:**
```typescript
function useMemories() {
  return {
    memories: MemoryRecord[],
    total: number,
    loading, error,
    search: (q: string) => void,
    setFilters: (f: FilterState) => void,
    create, update, reject, activate: (id: string) => Promise<void>,
    stats: MemoryStats | null,
    page, setPage,
  };
}
```

---

### 4.D — Goal Board (`/brain/goals`)

**Source:** P15 endpoints

**Layout:**
```
┌─────────────────────────────────────────┐
│  Goal Board                     [+ Add] │
├──────────┬──────────┬──────────┬────────┤
│ Active   │ Paused   │ Complete │ Review │  <- Columns
├──────────┼──────────┼──────────┼────────┤
│ Build V2 │Improve   │P13 Brain │Memory  │
│ 🔴 crit  │retry     │Core      │Conflict│
│ ████░░░  │ 🟡 normal│ 🟢 normal│ 🟡 high│
│ 3/5 done │ 1/2 done │ Done     │ Review │
│          │          │          │        │
│ Fix bugs │          │          │        │
│ 🟠 high  │          │          │        │
│ ██░░░░░  │          │          │        │
└──────────┴──────────┴──────────┴────────┘
```

**Components:**
- `GoalCard` — priority badge (🔴🟠🟡🟢), progress bar, milestone count, drift badge
- `GoalDetail` — full description, milestone checklist, edit/complete/delete buttons
- `GoalForm` — create/edit modal with title, description, priority, milestones
- `DriftBadge` — red badge on drifted goals, tooltip with drift report
- `EmptyState` — "No goals yet. Define your first goal to guide Pi's proposals."

**Hooks:**
```typescript
function useGoals() {
  return {
    goals: GoalRecord[],
    loading, error,
    create, update, complete, delete: (id: string) => Promise<void>,
    stats: GoalStats | null,
    driftReports: GoalDriftReport[],
    refresh: () => void,
  };
}
```

---

### 4.E — Trust Dashboard (`/brain/trust`)

**Source:** P18 endpoints

**Layout:**
```
┌─────────────────────────────────────┐
│  Trust & Safety                     │
├─────────────────────────────────────┤
│  🚨 EMERGENCY STOP                  │  <- Big red button
│  [Currently: NOT ACTIVE]            │
├─────────────────────────────────────┤
│  Autonomy: Level 3 (Operator)       │
│  Approved: 12 actions               │
│  Blocked: 2 actions                 │
├──────────────────┬──────────────────┤
│  Approval Queue   │  Audit Stats    │
│  3 pending        │  247 entries    │
│  8 approved today │  12 today       │
├──────────────────┴──────────────────┤
│  Policy Rules (10)                  │
│  ┌─ allow_001  Retry failures  ✅  │
│  └─ forbid_001 Secret access    🔒 │
└─────────────────────────────────────┘
```

**Components:**
- `EmergencyStopButton` — confirmation dialog → POST to `/api/brain/emergency/stop` → full-screen overlay
- `ApprovalSummaryCard` — pending/approved/rejected counts, link to /brain/inbox
- `AuditStatsChart` — time-series bar chart of decisions over time
- `PolicyRuleTable` — sortable table with enable/disable toggle per rule
- `DecisionExplainer` — text input for audit entry ID → displays full explanation

---

### 4.F — Reflection Timeline (`/brain/reflections`)

**Source:** P17 endpoints

**Layout:**
```
┌─────────────────────────────────┐
│  Reflections (12 total)         │
│  Memories created: 8            │
├─────────────────────────────────┤
│  2026-05-19 P14 Memory         │  <- Timeline entries
│  ✅ What worked: store validation│
│  ❌ What failed: conflict TTL   │
│  💡 2 memory proposals          │
│  🔮 1 future suggestion         │
│  ─────────────────              │
│  2026-05-18 P13 Brain          │
│  ✅ What worked: daemon startup │
│  ❌ What failed: heartbeat gap  │
│  💡 1 memory proposal           │
│  ...                            │
└─────────────────────────────────┘
```

**Components:**
- `ReflectionTimeline` — vertical timeline layout, chronological
- `ReflectionCard` — date, plan title, summary, worked/failed sections, memory/suggestion counts
- `ReflectionDetailPage` — full detail with evidence badges
- `EmptyState` — "No reflections yet. Complete a plan to get your first reflection."

---

### 4.G — Overnight Panel (`/brain/overnight`)

**Layout:**
```
┌──────────────────────────────────────┐
│  Overnight Run                       │
├──────────────────────────────────────┤
│  Queue Selection:                    │
│  [☑] P17 Plan Factory & Reflection  │
│  [☐] P16 Proposal Engine            │
│  [☑] P15 Goals & Preferences        │
├──────────────────────────────────────┤
│  Autonomy Level: [▼ Level 3]        │
│  Max Duration: [8] hours            │
├──────────────────────────────────────┤
│  Stop Conditions:                    │
│  [☑] Integration queue dirty        │
│  [☑] Merge conflict                 │
│  [☑] Policy violation               │
│  [☐] Low confidence unsafe          │
├──────────────────────────────────────┤
│  Schedule: [🌙 Tonight 22:00]       │
│  [▶ Run Now]  [📅 Schedule]         │
├──────────────────────────────────────┤
│  Past Runs:                          │
│  2026-05-18 ✅ 3/3 plans completed  │
│  2026-05-17 ⚠️ Stopped on conflict │
└──────────────────────────────────────┘
```

**Components:**
- `PlanQueueSelector` — checkboxes for available queueable plans
- `AutonomyLevelPicker` — dropdown with 3 or 4 (only execution-capable levels)
- `StopConditionCheckboxes` — one checkbox per stop condition
- `SchedulePicker` — time picker + "Run Now" button
- `RunHistoryTable` — table of past sessions with status badges
- `EmptyState` — "No plans queued yet. Generate a plan from the Inbox."

---

## 5. Common Components

All pages share these:

```typescript
// LoadingSkeleton.tsx
// Props: { variant: 'card' | 'row' | 'chart' | 'text', count: number }
// Pulse animation placeholders

// EmptyState.tsx
// Props: { icon: ReactNode, title: string, description: string, action?: { label: string, onClick: () => void } }
// Illustration + message + optional CTA button

// ErrorState.tsx
// Props: { message: string, details?: string, onRetry?: () => void }
// Error icon + message + retry button

// SeverityBadge.tsx
// Props: { severity: 'info' | 'warning' | 'critical' }
// Color-coded badge (blue/orange/red)

// StatusBadge.tsx
// Props: { status: string, mapping: Record<string, { color: string; label: string }> }
// Flexible badge for any status field

// Pagination.tsx
// Props: { page: number, total: number, onPageChange: (page: number) => void }

// SearchInput.tsx
// Props: { value: string, onChange: (value: string) => void, placeholder: string, debounceMs?: number }
```

---

## 6. API Client

```typescript
// packages/web-ui/dashboard/src/api/brain.ts

export class BrainClient {
  constructor(baseUrl: string);
  
  // State (P13)
  getState(): Promise<BrainStateData>;
  getTimeline(params: object): Promise<{ events: TimelineEvent[]; total: number }>;
  getObservations(params: object): Promise<{ observations: BrainObservation[]; total: number }>;
  getSignals(params: object): Promise<{ signals: BrainSignal[]; total: number }>;
  
  // Memory (P14)
  getMemories(params: object): Promise<{ memories: MemoryRecord[]; total: number }>;
  getMemory(id: string): Promise<MemoryRecord>;
  createMemory(data: object): Promise<MemoryRecord>;
  updateMemory(id: string, data: object): Promise<MemoryRecord>;
  deleteMemory(id: string): Promise<void>;
  rejectMemory(id: string): Promise<MemoryRecord>;
  activateMemory(id: string): Promise<MemoryRecord>;
  getMemoryStats(): Promise<MemoryStats>;
  
  // Proposals (P16)
  getProposalInbox(): Promise<InboxView>;
  getProposals(params: object): Promise<{ proposals: Proposal[]; total: number }>;
  getProposal(id: string): Promise<Proposal>;
  acceptProposal(id: string): Promise<Proposal>;
  rejectProposal(id: string, reason?: string): Promise<Proposal>;
  correctProposal(id: string, corrections: object): Promise<Proposal>;
  getProposalStats(): Promise<ProposalStats>;
  
  // Goals (P15)
  getGoals(params?: object): Promise<GoalRecord[]>;
  getGoal(id: string): Promise<GoalRecord>;
  createGoal(data: object): Promise<GoalRecord>;
  updateGoal(id: string, data: object): Promise<GoalRecord>;
  deleteGoal(id: string): Promise<void>;
  completeGoal(id: string): Promise<GoalRecord>;
  getGoalStats(): Promise<GoalStats>;
  getDriftReports(): Promise<GoalDriftReport[]>;
  
  // Autonomy (P15)
  getAutonomyProfile(): Promise<AutonomyProfile>;
  updateAutonomyProfile(data: object): Promise<AutonomyProfile>;
  emergencyStop(): Promise<void>;
  releaseStop(): Promise<void>;
  getEmergencyStatus(): Promise<{ stopped: boolean }>;
  
  // Policy (P18)
  getPolicyRules(): Promise<PolicyRule[]>;
  toggleRule(id: string): Promise<PolicyRule>;
  evaluateAction(data: object): Promise<PolicyResult>;
  
  // Approvals (P18)
  getApprovals(): Promise<{ approvals: ApprovalRequest[]; total: number }>;
  approve(id: string): Promise<ApprovalRequest>;
  rejectApproval(id: string, reason?: string): Promise<ApprovalRequest>;
  getApprovalStats(): Promise<ApprovalStats>;
  
  // Reflections (P17)
  getReflections(): Promise<ReflectionReport[]>;
  getReflection(planExecId: string): Promise<ReflectionReport>;
  getReflectionStats(): Promise<object>;
  
  // Audit (P18)
  getAuditEntries(params?: object): Promise<{ entries: AuditEntry[]; total: number }>;
  getAuditStats(): Promise<AuditStats>;
  getProvenance(targetId: string): Promise<object>;
  explainDecision(targetId: string): Promise<string>;
  
  // Overnight (P20)
  queueOvernight(config: object): Promise<{ sessionId: string }>;
  getOvernightStatus(sessionId: string): Promise<object>;
  getOvernightHistory(): Promise<object[]>;
  cancelOvernight(sessionId: string): Promise<void>;
}
```

---

## 7. Dashboard Integration

```typescript
// packages/web-ui/dashboard/src/App.tsx
// Routes to add:

<Routes>
  <Route path="/brain" element={<BrainStatePage />} />
  <Route path="/brain/inbox" element={<BrainInboxPage />} />
  <Route path="/brain/memory" element={<BrainMemoryPage />} />
  <Route path="/brain/memory/:id" element={<BrainMemoryDetailPage />} />
  <Route path="/brain/goals" element={<BrainGoalsPage />} />
  <Route path="/brain/trust" element={<BrainTrustPage />} />
  <Route path="/brain/reflections" element={<BrainReflectionsPage />} />
  <Route path="/brain/reflections/:planExecId" element={<BrainReflectionDetailPage />} />
  <Route path="/brain/overnight" element={<BrainOvernightPage />} />
</Routes>
```

```typescript
// packages/web-ui/dashboard/src/components/Navigation.tsx
// Nav items to add:

const NAV_ITEMS = [
  { path: '/brain', label: 'Brain State', icon: BrainIcon, badge: useUnreadCount()?.observations },
  { path: '/brain/inbox', label: 'Inbox', icon: InboxIcon, badge: useUnreadCount()?.proposals },
  { path: '/brain/memory', label: 'Memory', icon: MemoryIcon },
  { path: '/brain/goals', label: 'Goals', icon: GoalsIcon },
  { path: '/brain/trust', label: 'Trust', icon: ShieldIcon, badge: useUnreadCount()?.approvals },
  { path: '/brain/reflections', label: 'Reflections', icon: ReflectIcon },
  { path: '/brain/overnight', label: 'Overnight', icon: MoonIcon },
];
```

---

## 8. File Structure

```
packages/web-ui/dashboard/src/
├── api/
│   └── brain.ts                    # BrainApiClient
├── hooks/
│   ├── useBrainStatus.ts           # P13
│   ├── useObservations.ts          # P13
│   ├── useProposals.ts             # P16
│   ├── useMemoryRecords.ts         # P14
│   ├── useGoalBoard.ts             # P15
│   ├── useAutonomyControls.ts      # P15
│   ├── usePolicyRules.ts           # P18
│   ├── useApprovals.ts             # P18
│   ├── useReflections.ts           # P17
│   ├── useAudit.ts                 # P18
│   ├── useOvernight.ts             # P20
│   └── useUnreadCount.ts           # P13+P16+P18 badge counts
├── pages/
│   ├── BrainStatePage.tsx
│   ├── BrainInboxPage.tsx
│   ├── BrainMemoryPage.tsx
│   ├── BrainMemoryDetailPage.tsx
│   ├── BrainGoalsPage.tsx
│   ├── BrainTrustPage.tsx
│   ├── BrainReflectionsPage.tsx
│   ├── BrainReflectionDetailPage.tsx
│   └── BrainOvernightPage.tsx
├── components/
│   ├── brain/
│   │   ├── common/
│   │   │   ├── LoadingSkeleton.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ErrorState.tsx
│   │   │   ├── SeverityBadge.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── Pagination.tsx
│   │   │   ├── SearchInput.tsx
│   │   │   └── index.ts
│   │   ├── overview/
│   │   │   ├── DaemonStatusCard.tsx
│   │   │   ├── ObservationStats.tsx
│   │   │   ├── SignalSummaryCards.tsx
│   │   │   ├── TimelineList.tsx
│   │   │   └── index.ts
│   │   ├── proposals/
│   │   │   ├── ProposalInbox.tsx
│   │   │   ├── ProposalCard.tsx
│   │   │   ├── EvidenceDrawer.tsx
│   │   │   ├── AcceptButton.tsx
│   │   │   ├── RejectButton.tsx
│   │   │   ├── CorrectForm.tsx
│   │   │   └── index.ts
│   │   ├── memory/
│   │   │   ├── MemoryList.tsx
│   │   │   ├── MemoryCard.tsx
│   │   │   ├── MemoryDetailModal.tsx
│   │   │   ├── MemoryEditForm.tsx
│   │   │   ├── MemoryFilters.tsx
│   │   │   ├── MemorySearch.tsx
│   │   │   └── index.ts
│   │   ├── goals/
│   │   │   ├── GoalBoard.tsx
│   │   │   ├── GoalCard.tsx
│   │   │   ├── GoalDetail.tsx
│   │   │   ├── GoalForm.tsx
│   │   │   ├── MilestoneTracker.tsx
│   │   │   ├── DriftBadge.tsx
│   │   │   └── index.ts
│   │   ├── autonomy/
│   │   │   ├── AutonomyControls.tsx
│   │   │   ├── LevelSelector.tsx
│   │   │   └── index.ts
│   │   ├── trust/
│   │   │   ├── PolicyRuleTable.tsx
│   │   │   ├── ApprovalSummaryCard.tsx
│   │   │   ├── AuditStatsChart.tsx
│   │   │   ├── EmergencyStopButton.tsx
│   │   │   ├── DecisionExplainer.tsx
│   │   │   └── index.ts
│   │   ├── reflections/
│   │   │   ├── ReflectionTimeline.tsx
│   │   │   ├── ReflectionCard.tsx
│   │   │   ├── ReflectionDetail.tsx
│   │   │   └── index.ts
│   │   └── overnight/
│   │       ├── OvernightPanel.tsx
│   │       ├── PlanQueueSelector.tsx
│   │       ├── SchedulePicker.tsx
│   │       ├── RunHistoryTable.tsx
│   │       └── index.ts
│   └── ... existing components remain
```

---

## 9. Workstreams

| ID | Goal | Key Components | Acceptance |
|----|------|---------------|------------|
| P19.A | Brain State Viewer | DaemonStatusCard, ObservationStats, SignalCards, TimelineList | Shows live state, all error states |
| P19.B | Proposal Inbox | Top-3 cards, Accept/Reject/Correct, EvidenceDrawer | CRUD works, toast feedback |
| P19.C | Memory Explorer | Search, filters, card list, detail modal, edit form | Full CRUD, search debounced |
| P19.D | Goal Board | Kanban columns, GoalCard, Add Goal form, DriftBadge | Full CRUD, drift indicator |
| P19.E | Trust Dashboard | Policy rules, approvals, audit, emergency stop | All P18 endpoints integrated |
| P19.F | Reflection Timeline | Timeline layout, reflection cards, memory/suggestion sections | Displays data, links work |
| P19.G | Overnight Panel | Queue selector, schedule picker, history table | Queue selection works |
| P19.H | Dashboard Integration | Routes, navigation, API client, common components | All pages navigable, API client complete |
| P19.I | Dogfood Report | End-to-end UX validation | Report generated |

---

## 10. Done Criteria

* [ ] `/brain` — daemon status, observation stats, signal cards, timeline list
* [ ] `/brain/inbox` — top-3 proposals, accept/reject/correct with feedback
* [ ] `/brain/memory` — search, filter, CRUD, detail modal, pagination
* [ ] `/brain/goals` — Kanban board, goal CRUD, milestones, drift badges
* [ ] `/brain/trust` — policy rules, approvals, audit stats, emergency stop
* [ ] `/brain/reflections` — timeline list, detail view, memory/suggestion links
* [ ] `/brain/overnight` — plan selection, schedule, run history
* [ ] Navigation — all brain nav items work, badge counts on inbox/trust
* [ ] States — loading/error/empty handled on every page
* [ ] Responsive — works on desktop (1280px+)
* [ ] Dogfood report generated

---

## 11. Rollback

Remove V2 routes from `App.tsx`. Existing pages remain functional. No backend changes.


---

# Part 2 — Agent Brief

## Mission

Implement all P19 — P19 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

## Hard Requirements

1. Do not exceed selected scale-mode worker cap.
2. Do not run more than 3 workers unless worktree isolation and integration queue readiness pass.
3. Do not merge workspace output without passed workspace validation.
4. Do not mark a plan complete if integration validation fails.
5. Do not treat merge conflict as ordinary worker failure.
6. Do not start the next plan while integration queue state is dirty.
7. Do not run watch-mode validation.
8. Do not run `git push`.
9. Do not run raw destructive cleanup commands.
10. Do not access secrets or forbidden files.
11. The executor remains the only component that mutates execution state.
12. Integration queue must respect workspace-level queuePriority and the selected optimization strategy.
13. Queue optimization must not bypass safety checks.
14. Low-priority workspaces must still be merged within a reasonable window.

## Execution Policies

```yaml
scale:
  default_mode: stable_3
  selected_mode: stable_3
  modes:
    stable_3:
      max_parallel_workspaces: 3
      worktree_required: false
      integration_queue_required: false
    stable_6:
      max_parallel_workspaces: 6
      worktree_required: true
      integration_queue_required: true
      validation_lock_required: false
      archive_required: false
      completion_gate_required: true
    experimental_6:
      max_parallel_workspaces: 6
      worktree_required: true
      integration_queue_required: true
      validation_lock_required: true
      archive_required: true
      completion_gate_required: true
    scale_8:
      max_parallel_workspaces: 8
      worktree_required: true
      integration_queue_required: true
      validation_lock_required: true
      archive_required: true
      completion_gate_required: true
      dogfood_pass_required: true
      explicit_approval_required: true

worktree:
  enabled_by_default: true
  enabled: true
  root: .pi/worktrees
  quarantine_failed_by_default: true
  raw_rm_rf_forbidden: true
  path_scope_required: true

integration_queue:
  enabled: true
  process_one_merge_at_a_time: true
  stop_on_merge_conflict: true
  require_workspace_validation_pass: true
  require_integration_validation_pass: true
  git_push_allowed: false

queue_optimization:
  enabled_by_default: true
  default_strategy: priority_then_fifo
  strategies:
    priority_then_fifo:
      description: Workspaces merge in priority order; same-priority workspaces merge in submission order
      priority_levels: [critical, high, normal, low]
    critical_path_first:
      description: Workspaces on the critical path merge before non-critical workspaces
      priority_levels: [critical, high, normal, low]
    weighted_shortest_job_first:
      description: Workspaces with smaller changes merge first within priority bands
      priority_levels: [critical, high, normal, low]

validation:
  global_validation_lock_required: true
  targeted_validation_enabled: true
  final_integration_validation_required: true
  watch_mode_forbidden: true

parallelism_review:
  preflight_required: true
  interactive_dependency_review: true
  show_dag_effective_parallelism: true
  show_safe_effective_parallelism: true
  show_batch_preview: true
  show_safe_batch_preview: true
  show_critical_path: true
  show_scale_mode_readiness: true
  allow_dependency_editing: true
  persist_approved_graph: true
```

## Safety Stops

* Dependency cycles
* Invalid dependency patches
* Required preflight review not approved
* Stale approved graph hash
* Worktree path escaping `.pi/worktrees`
* Raw destructive worktree cleanup
* Integration merge without passed workspace validation
* Integration validation failure
* Merge conflict without handoff artifact
* Unsafe scale mode
* Queue starting next plan while integration queue is dirty
* Scale mode approval stale or missing
* Worktree isolation disabled while requesting more than 3 workers
* Forbidden file access
* Secrets access
* `git push`
* Watch-mode validation command
* Queue optimization enabled with invalid or missing strategy
* Queue priority set to unsupported value
* Dashboard must not directly mutate execution state
* UI updates must use debounced fetches

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** Authoritative execution contract for Pi's multi-agent execution system. Pi parses this JSON to build the execution plan.

**Validation:** Must be valid and complete before execution begins. Use `pi plan doctor` to validate.

```json
{
  "contractVersion": "2.5.1",
  "executionBackend": "postgres",
  "project": {
    "name": "pi-mono",
    "rootPath": "/home/erfolg/src/pi",
    "type": "repo",
    "tags": [
      "v2",
      "second-brain"
    ]
  },
  "planExecution": {
    "phase": "P19",
    "title": "Full Second-Brain Dashboard & Autonomy UX",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "scheduling": {
      "continuous": true,
      "slotCount": 3,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "experimental_6",
      "selectedMode": "stable_3",
      "modes": {
        "stable_3": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": false,
          "integrationQueueRequired": false
        },
        "experimental_6": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": true,
          "integrationQueueRequired": true,
          "validationLockRequired": true,
          "archiveRequired": true,
          "completionGateRequired": true
        },
        "scale_8": {
          "maxParallelWorkspaces": 8,
          "worktreeRequired": true,
          "integrationQueueRequired": true,
          "validationLockRequired": true,
          "archiveRequired": true,
          "completionGateRequired": true,
          "dogfoodPassRequired": true,
          "explicitApprovalRequired": true
        }
      }
    },
    "worktree": {
      "enabled": false,
      "enabledByDefault": true,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": false,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "requireWorkspaceValidationPass": true,
      "requireIntegrationValidationPass": true,
      "gitPushAllowed": false,
      "queuePriority": {
        "enabled": false,
        "defaultLevel": "normal",
        "levels": [
          "critical",
          "high",
          "normal",
          "low"
        ]
      },
      "queueOptimization": {
        "enabled": false,
        "strategy": "priority_then_fifo",
        "availableStrategies": [
          "priority_then_fifo",
          "critical_path_first",
          "weighted_shortest_job_first"
        ]
      }
    },
    "validation": {
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "watchModeForbidden": true
    },
    "interactiveParallelismReview": {
      "enabled": false,
      "preflightRequired": true,
      "approvalRequiredBeforeRun": true,
      "allowDependencyEditing": true,
      "showEffectiveParallelism": true,
      "showSafeEffectiveParallelism": true,
      "showBatchPreview": true,
      "showSafeBatchPreview": true,
      "showCriticalPath": true,
      "showScaleModeReadiness": true,
      "warnWhenEffectiveParallelismBelowRequested": true,
      "warnWhenSafeParallelismBelowDagParallelism": true,
      "warnWhenScaleModePrerequisitesMissing": true,
      "persistApprovedGraph": true
    },
    "planIntake": {
      "enabled": false,
      "runOnUpload": true,
      "parserPriority": [
        "part3_json",
        "markdown_fallback"
      ],
      "autoNormalize": true,
      "autoDoctor": true,
      "autoDagAnalysis": true,
      "autoOptimizationProposal": true,
      "autoQueuePriorityRecommendation": true,
      "autoWorkspaceSplitRecommendation": true,
      "autoDryRunForecast": true,
      "approvalRequiredBeforeApplyingOptimization": true,
      "approvalRequiredBeforeExecution": true
    },
    "optimizer": {
      "enabled": false,
      "mode": "advisory_until_approved",
      "objectives": [
        "maximize_safe_effective_parallelism",
        "minimize_critical_path",
        "minimize_same_file_conflicts",
        "minimize_validation_lock_contention",
        "prioritize_critical_path_queue_merges"
      ],
      "allowedPatches": [
        "dependencies",
        "parallelGroup",
        "queuePriority",
        "canRunWith",
        "cannotRunWith",
        "conflictScope",
        "workspaceSplitSuggestion",
        "workspaceMergeSuggestion"
      ],
      "forbiddenAutoPatches": [
        "allowedFiles",
        "forbiddenFiles",
        "capabilityManifest",
        "safety.hardStops",
        "forbiddenCommands"
      ]
    }
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "paused_or_stopped_only"
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "budget_violations",
      "dependency_cycles",
      "unapproved_parallelism_review",
      "invalid_dependency_patch",
      "worktree_path_escape",
      "raw_destructive_cleanup",
      "integration_merge_without_validation",
      "integration_validation_failure",
      "merge_conflict_without_handoff",
      "unsafe_scale_mode",
      "queue_next_plan_while_integration_dirty",
      "scale_mode_approval_stale",
      "worktree_required_for_requested_parallelism",
      "watch_mode_validation"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish",
      "terraform destroy",
      "kubectl delete",
      "git reset --hard",
      "git clean -fd",
      "vitest --watch",
      "jest --watch",
      "npm run dev"
    ],
    "forbiddenFiles": [
      ".env*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/id_rsa",
      "**/credentials/**",
      "**/secrets/**"
    ]
  },
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 6,
    "selectedScaleMode": "stable_3",
    "scaleModeReadiness": {
      "ready": true,
      "blockedReasons": [],
      "warnings": [],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 3,
    "expectedSafeEffectiveParallelismMin": 3,
    "dagEffectiveParallelism": null,
    "safeEffectiveParallelism": null,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "safeBatchingStrategy": "dag_batches_with_p6_safety_constraints",
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason",
      "workspaces[].parallelism.canRunWith",
      "workspaces[].parallelism.cannotRunWith",
      "workspaces[].parallelism.conflictScope",
      "workspaces[].integration.queuePriority",
      "workspaces[].integration.queueOptimizationNotes"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "safe_parallelism_below_dag_parallelism",
      "fully_serialized_graph",
      "long_serialized_tail",
      "file_overlap_blocks_parallelism",
      "symbol_overlap_blocks_parallelism",
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "scale_mode_prerequisites_missing",
      "worktree_isolation_required_for_scale",
      "queue_optimization_disabled_with_active_priority",
      "queue_priority_mismatch_with_configured_levels",
      "critical_path_workspace_has_low_priority",
      "queue_optimization_strategy_invalid_for_mode"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "safe_batch_preview",
      "critical_path",
      "scale_mode_readiness",
      "approved_dependency_patch",
      "approved_graph_hash",
      "queue_priority_snapshot",
      "queue_optimization_strategy",
      "queue_reorder_decision_log",
      "worktree_state"
    ],
    "batchPreview": {
      "batches": [],
      "overallEffectiveParallelism": null,
      "criticalPath": [],
      "criticalPathLength": 0,
      "serializedTailLength": 0
    },
    "safeBatchPreview": {
      "batches": [],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [],
      "blockedParallelismReasons": []
    },
    "optimizationReview": {
      "originalGraphHash": null,
      "proposedGraphHash": null,
      "approvedGraphHash": null,
      "originalDagEffectiveParallelism": null,
      "proposedDagEffectiveParallelism": null,
      "originalSafeEffectiveParallelism": null,
      "proposedSafeEffectiveParallelism": null,
      "criticalPathDelta": null,
      "serializedTailDelta": null,
      "suggestions": [],
      "approvalState": "pending"
    }
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "Brain State Viewer Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P13 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P13 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.B",
      "title": "Proposal Inbox Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.B must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P16 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P16 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.C",
      "title": "Memory Explorer Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.C must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P14 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P14 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.D",
      "title": "Goal Board Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.D must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P15 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P15 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.E",
      "title": "Trust Dashboard Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P18 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P18 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.F",
      "title": "Reflection Timeline Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.F must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P17 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on P17 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.G",
      "title": "Overnight Panel Page",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.G must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on P20 API; no internal P19 deps"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Depends on P20 API; no internal P19 deps"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.H",
      "title": "Dashboard Integration (routes, nav, API client)",
      "dependencies": [
        "7.A",
        "7.B",
        "7.C",
        "7.D",
        "7.E",
        "7.F",
        "7.G"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.H must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on all pages; last workstream"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on all pages; last workstream"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "7.I",
      "title": "P19 Dogfood & Report",
      "dependencies": [
        "7.H"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.I must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Validation only"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "low",
        "queueOptimizationNotes": "Validation only"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.5.1",
  "phase": "P19",
  "title": "P19 Dogfood & Report",
  "primaryGoal": "Implement and validate the P19 second-brain component.",
  "projectName": "pi-mono",
  "stateBackend": "postgres",
  "selectedScaleMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "requiresWorktreeIsolation": false,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "priority_then_fifo",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 3,
  "notInScope": [
    "Platform/enterprise deployment",
    "Remote execution agents",
    "PostgreSQL backend (reserved for v3)",
    "Multi-project orchestration"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "dependency_cycles",
    "unapproved_parallelism_review",
    "invalid_dependency_patch",
    "worktree_path_escape",
    "raw_destructive_cleanup",
    "integration_merge_without_validation",
    "integration_validation_failure",
    "merge_conflict_without_handoff",
    "unsafe_scale_mode",
    "queue_next_plan_while_integration_dirty",
    "queue_optimization_invalid_strategy",
    "queue_priority_invalid_level"
  ],
  "completionGate": "All P19 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P20"
}
```

# Phase P21 — Dashboard V2 Redesign: Structural Improvements

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-23  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-23

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P21`  
**One-line goal:** Implement dashboard structural improvements: sidebar hierarchy separation (P11/Brain), responsive 2×4 stats grid, 3-section right sidebar with clear separators, topbar groupings, navigation memory, and empty states.  
**Why now:** P19 delivered the second-brain dashboard. P21 fixes structural UX issues identified in design review (5.5→9/10 gap).  
**Blast radius:** `packages/web-ui/dashboard/` (React components), Tailwind config, dashboard state management.  
**Rollback path:** CSS class swaps, state management revert flags, component feature flags.  
**Scale mode:** `experimental_6`  
**Safe parallelism target:** 4  
**Done when:** All structural components implemented, responsive breakpoints working, accessibility parity achieved.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P21` |
| Title | `Dashboard V2 Redesign: Structural Improvements` |
| Status | `Authoritative Implementation` |
| Target environment | `Local Pi runtime` |
| Primary focus | `UI/UX structural fixes — hierarchy, grid, sidebar sections, topbar, navigation` |
| Scale mode | `experimental_6` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P21.A — Sidebar Hierarchy (P11/Brain) | Pi Worker Agent | User | Reviewer | User |
| P21.B — Stats Grid (2×4 responsive) | Pi Worker Agent | User | Reviewer | User |
| P21.C — Right Sidebar 3-Section Split | Pi Worker Agent | User | Reviewer | User |
| P21.D — Topbar Control Grouping | Pi Worker Agent | User | Reviewer | User |
| P21.E — Navigation Memory (breadcrumbs) | Pi Worker Agent | User | Reviewer | User |
| P21.F — Empty States | Pi Worker Agent | User | Reviewer | User |
| P21.G — Accessibility Parity | Pi Worker Agent | User | Reviewer | User |
| P21.H — Responsive Breakpoints | Pi Worker Agent | User | Reviewer | User |

---

## 2. Purpose

Fix structural UX issues in the P19 dashboard that prevent achieving 10/10 design score. The key gaps are:

1. **Hierarchy** — P11 Core and P19 Brain entries on same visual level, no grouping
2. **Stats overflow** — 7 cards in single row breaks on narrow screens
3. **Right sidebar congestion** — Events, Alerts, Cleanup Review mixed without separation
4. **Topbar button clutter** — 7 action buttons too close together, no priority
5. **Navigation memory** — No breadcrumb, back loses scroll/tab state
6. **Empty states** — Missing meaningful empty states with CTAs
7. **Accessibility** — Color-only status indicators (●◈✗) need icons/labels
8. **Responsiveness** — No explicit breakpoint behavior

### 2.1 Validation Scenarios

| # | Scenario | Description | Autonomy Level | Expected Outcome |
|---|----------|-------------|:---:|:---:|
| 1 | Sidebar renders with P11/Brain sections | P11 (Autonomy, Plan Intake, Extensions, Policy, Trust) and Brain (State, Memory, Reflections, Goals, Proposals) visually grouped with headers | 3 | Visual separation clear |
| 2 | Stats grid responds to screen width | Desktop 4 cols, tablet 2×2, mobile 1×4 | 3 | No horizontal scroll |
| 3 | Right sidebar shows 3 separated sections | Events, Alerts (collapsible), Cleanup Review with clear dividers | 3 | Each section scannable |
| 4 | Topbar controls logical grouping | [▶] [⏸] [■] grouped, sidebar toggle single button | 3 | Clickable at 44px minimum |
| 5 | Navigation preserves state | Back button returns to exact scroll position + active tab | 3 | Seamless return |
| 6 | Empty states show CTAs | Workers section shows "No workers yet" with action button | 3 | Actionable |
| 7 | Status indicators have text | Worker status shows icon + text label | 3 | Screen reader OK |
| 8 | Breakpoints work | Resize window triggers responsive layout | 3 | Layout adapts |

---

## 3. Implementation

### 3.A — Sidebar Hierarchy (P11/Brain)

```typescript
// packages/web-ui/dashboard/src/components/sidebar/Sidebar.tsx

export interface SidebarSection {
  id: string;
  title: string;
  type: 'platform' | 'brain';
  items: SidebarItem[];
  isExpanded?: boolean;
}

export interface SidebarItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: number;
  isActive?: boolean;
  href?: string;
  onClick?: () => void;
}

export const PLATFORM_SECTIONS: SidebarSection[] = [
  {
    id: 'p11-core',
    title: 'P11 Core',
    type: 'platform',
    items: [
      { id: 'autonomy', label: 'Autonomy', icon: Shield },
      { id: 'plan-intake', label: 'Plan Intake', icon: Upload },
      { id: 'extensions', label: 'Extensions', icon: Puzzle },
      { id: 'memory', label: 'Memory', icon: Brain },
      { id: 'policy-audit', label: 'Policy & Audit', icon: ClipboardCheck },
      { id: 'trust', label: 'Trust Dashboard', icon: Heart },
    ],
    isExpanded: true,
  },
];

export const BRAIN_SECTIONS: SidebarSection[] = [
  {
    id: 'p19-brain',
    title: 'Brain (P19)',
    type: 'brain',
    items: [
      { id: 'brain-state', label: 'State / Overview', icon: Activity },
      { id: 'observations', label: 'Observations & Signals', icon: Eye },
      { id: 'memory-explorer', label: 'Memory Explorer', icon: Database },
      { id: 'reflections', label: 'Reflections', icon: Lightbulb },
      { id: 'overnight', label: 'Overnight', icon: Moon },
      { id: 'proposals', label: 'Proposals', icon: FileText },
      { id: 'goals', label: 'Goals', icon: Target },
    ],
    isExpanded: true,
  },
];

// Visual differentiation:
// - Platform section: gray-700 text, gray-600 separators
// - Brain section: blue-400 icon tint, purple-500 header accent
// - Different group header styles ( Platform: uppercase, Brain: 🧠 emoji prefix)
```

**Changes:**
- Two separate section arrays with type enum
- Visual distinction: Platform uses muted gray, Brain uses blue/purple accent
- Header styling: Platform = `text-xs uppercase tracking-widest`, Brain = `text-sm font-medium` with brain emoji
- Duplicate entries (Memory, Proposals) consolidated to one location
- Collapsible sections with chevron indicators

---

### 3.B — Stats Grid (2×4 Responsive)

```typescript
// packages/web-ui/dashboard/src/components/stats/StatsGrid.tsx

export type StatsGridSize = 'desktop' | 'tablet' | 'mobile';

export interface StatCard {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  isCritical?: boolean;
  priority: 1 | 2; // priority 1 = top row (most critical)
}

export const STAT_PRIORITY: Record<string, StatCard['priority']> = {
  estCost: 1,
  tokensIn: 1,
  tokensOut: 1,
  burnRate: 1,
  cacheHit: 2,
  tokPerWorker: 2,
  tokPerProg: 2,
};

export function getStatsGridSize(width: number): StatsGridSize {
  if (width >= 1280) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'mobile';
}

export function getGridClass(size: StatsGridSize): string {
  switch (size) {
    case 'desktop':
      return 'grid-cols-4';
    case 'tablet':
      return 'grid-cols-2';
    case 'mobile':
      return 'grid-cols-1';
  }
}

export function getPriorityStats(stats: StatCard[]): { priority1: StatCard[]; priority2: StatCard[] } {
  return {
    priority1: stats.filter(s => s.priority === 1),
    priority2: stats.filter(s => s.priority === 2),
  };
}

// Layout:
// Desktop:  [Cost] [TokensIn] [TokensOut] [BurnRate]
//           [Cache] [Tok/Worker] [Tok/%prog]  <- can be empty or merged
//
// Tablet:   [Cost] [TokensIn]
//           [TokensOut] [BurnRate]
//           [Cache] [Tok/Worker]
//
// Mobile:   [Cost]
//           [TokensIn]
//           [TokensOut]
//           [BurnRate]
//           [Cache]
//           ...
```

**Changes:**
- Priority-based split: priority 1 (cost, tokens in/out, burn rate) always first row
- Responsive hook that calculates grid class based on viewport width
- CSS: `grid grid-cols-4 gap-4` for desktop, auto-adjusting for tablet/mobile
- Stat cards use consistent height with value truncation for overflow

---

### 3.C — Right Sidebar 3-Section Split

```typescript
// packages/web-ui/dashboard/src/components/right-sidebar/RightSidebar.tsx

export interface RightSidebarSection {
  id: string;
  type: 'events' | 'alerts' | 'cleanup';
  title: string;
  badge?: number;
  isCollapsible?: boolean;
  isCollapsed?: boolean;
  items: RightSidebarItem[];
}

export interface RightSidebarItem {
  id: string;
  source: string; // 'ws-1', 'sys', etc.
  message: string;
  timestamp?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const RIGHT_SIDEBAR_SECTIONS: RightSidebarSection[] = [
  {
    id: 'events',
    type: 'events',
    title: 'EVENTS',
    isCollapsible: false,
    items: [],
  },
  {
    id: 'alerts',
    type: 'alerts',
    title: 'ALERTS',
    badge: 0,
    isCollapsible: true,
    isCollapsed: false,
    items: [],
  },
  {
    id: 'cleanup',
    type: 'cleanup',
    title: 'CLEANUP REVIEW',
    isCollapsible: false,
    items: [],
  },
];

// Separator between sections: 'border-t border-gray-700 py-3'
// Alert collapse: 'transition-all duration-200 overflow-hidden'
// Alert badge: 'bg-red-500 text-white text-xs px-2 py-0.5 rounded-full'
// Section header: 'text-xs font-bold tracking-wider text-gray-400 mb-2'
// Item: 'text-sm text-gray-300 hover:text-white cursor-pointer py-1'
```

**Changes:**
- Clear separator between each section: `border-t border-gray-700`
- Alerts section collapsible: hide when `items.length === 0`
- Each section has distinct header styling (uppercase for Events/Alerts, mixed for Cleanup)
- Alerts get badge count for quick scanning
- Cleanup Review anchored to bottom with sticky positioning

---

### 3.D — Topbar Control Grouping

```typescript
// packages/web-ui/dashboard/src/components/topbar/Topbar.tsx

export interface TopbarAction {
  id: string;
  icon: LucideIcon;
  label?: string;
  onClick: () => void;
  primary?: boolean;
  group?: 'playback' | 'settings';
}

export const TOPBAR_ACTIONS: TopbarAction[] = [
  // Playback controls - grouped together
  { id: 'resume', icon: Play, label: 'Resume', primary: true, group: 'playback' },
  { id: 'pause', icon: Pause, primary: true, group: 'playback' },
  { id: 'stop', icon: Square, primary: true, group: 'playback' },
  // Settings
  { id: 'settings', icon: Settings, group: 'settings' },
  // Sidebar toggle - single combined button
  { id: 'sidebar-toggle', icon: PanelLeft, showLabel: false },
];

export function renderActionGroup(actions: TopbarAction[], group: string): TopbarAction[] {
  return actions.filter(a => a.group === group);
}

// Layout structure:
// [hamburger] [Logo/Title] [StatusBadge] [plan name truncated]
//                           [Play] [Pause] [Stop]    [Settings] [SidebarToggle]
//
// Playback group: flex gap-2 (buttons with 8px spacing)
// Sidebar toggle: single button, toggles both left and right sidebars
// All primary actions: min-width 44px, min-height 44px (touch target)
```

**Changes:**
- Playback controls grouped: `[▶ Resume] [⏸] [■]` with consistent 8px gaps
- Sidebar toggle merged to single button that toggles both sidebars
- Primary actions have minimum 44x44px touch targets
- Settings moved to rightmost, distinctly spaced
- Plan title truncated with ellipsis at 200px max-width

---

### 3.E — Navigation Memory (Breadcrumb + State Preservation)

```typescript
// packages/web-ui/dashboard/src/hooks/useNavigationMemory.ts

export interface NavigationState {
  path: string;
  scrollPosition: number;
  activeTab?: string;
  timestamp: number;
}

export interface NavigationHistory {
  back: NavigationState | null;
  current: NavigationState;
  forward: NavigationState | null;
}

export function useNavigationMemory() {
  const [history, setHistory] = useState<NavigationHistory>({
    back: null,
    current: { path: '/', scrollPosition: 0, timestamp: Date.now() },
    forward: null,
  });

  const navigate = useCallback((to: string, options?: { preserveScroll?: boolean }) => {
    const newState: NavigationState = {
      path: to,
      scrollPosition: options?.preserveScroll !== false
        ? window.scrollY
        : 0,
      timestamp: Date.now(),
    };

    setHistory(prev => ({
      back: prev.current,
      current: newState,
      forward: null,
    }));
  }, []);

  const goBack = useCallback(() => {
    if (!history.back) return;

    setHistory(prev => ({
      back: prev.back?.back || null,
      current: prev.back,
      forward: prev.current,
    }));

    // Restore scroll position after React render
    requestAnimationFrame(() => {
      window.scrollTo(0, history.back.scrollPosition);
    });
  }, [history.back]);

  const goForward = useCallback(() => {
    if (!history.forward) return;
    // ... similar implementation
  }, [history.forward]);

  return { navigate, goBack, goForward, history };
}

// Breadcrumb component:
// / Runs / run-123 / workers / ws-1
// [← Back] [section] [subsection] [item]
// Clicking any section navigates directly (sets that as current)
```

**Changes:**
- Custom hook `useNavigationMemory` tracks scroll position per route
- Breadcrumb trail: `/ Runs / run-123 / workers`
- Back button restores exact scroll position
- Tab state (e.g., "Overview" vs "Tools" in worker detail) preserved
- History limited to 10 entries to prevent memory bloat

---

### 3.F — Empty States

```typescript
// packages/web-ui/dashboard/src/components/common/EmptyState.tsx

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'warning' | 'error';
}

// All sections must have meaningful empty states:

export const EMPTY_STATES = {
  workers: {
    icon: Users,
    title: 'No workers yet',
    description: 'Workers will appear when the plan starts executing',
    action: { label: 'Upload plan to start', onClick: () => {} },
  },
  events: {
    icon: Activity,
    title: 'No events yet',
    description: 'Events will appear as the plan executes',
  },
  alerts: { // This one is special - collapses instead
    icon: AlertTriangle,
    title: 'No alerts',
    description: 'All systems operating normally',
  },
  queue: {
    icon: ListOrdered,
    title: 'Queue is empty',
    description: 'Add plans to the execution queue',
    action: { label: 'Add plan', onClick: () => {} },
  },
  'worker-detail': {
    icon: User,
    title: 'Select a worker',
    description: 'Click a worker card to view details',
  },
};

// Implementation: EmptyState component with icon, title, description, optional CTA
// Variant 'warning' uses yellow accent, 'error' uses red
```

**Changes:**
- Every major section gets EmptyState component
- Workers: "No workers yet" + "Upload plan to start" CTA
- Events: "No events yet" + muted description
- Alerts: Special case - entire section collapses when empty
- Queue: "Queue is empty" + "Add plan" CTA
- Worker detail: "Select a worker" with instruction

---

### 3.G — Accessibility Parity

```typescript
// packages/web-ui/dashboard/src/components/worker/WorkerStatus.tsx

export type WorkerStatus = 'active' | 'pending' | 'blocked' | 'failed' | 'done';

export interface WorkerStatusConfig {
  status: WorkerStatus;
  icon: LucideIcon;
  label: string; // ALWAYS shown, not just on hover
  color: string;
  ariaLabel: string;
}

export const WORKER_STATUS_CONFIG: Record<WorkerStatus, WorkerStatusConfig> = {
  active: {
    status: 'active',
    icon: PlayCircle,
    label: 'Active', // Text label always visible
    color: 'text-green-400',
    ariaLabel: 'Worker is actively running',
  },
  pending: {
    status: 'pending',
    icon: Clock,
    label: 'Pending',
    color: 'text-gray-400',
    ariaLabel: 'Worker is pending execution',
  },
  blocked: {
    status: 'blocked',
    icon: PauseCircle,
    label: 'Blocked',
    color: 'text-yellow-400',
    ariaLabel: 'Worker is blocked by dependency',
  },
  failed: {
    status: 'failed',
    icon: XCircle,
    label: 'Failed',
    color: 'text-red-400',
    ariaLabel: 'Worker has failed',
  },
  done: {
    status: 'done',
    icon: CheckCircle,
    label: 'Done',
    color: 'text-blue-400',
    ariaLabel: 'Worker completed successfully',
  },
};

// Implementation: Always show icon + label text
// Icon only shown with screen reader: sr-only class
// Focus ring on keyboard navigation
// Role="status" and aria-live="polite" for updates
```

**Changes:**
- All color-only indicators get icon + text label
- Worker status cards show: `[▶ Active]`, `[◯ Pending]`, `[◈ Blocked]`, `[✗ Failed]`, `[✓ Done]`
- Screen reader: `aria-label` on every interactive element
- Focus rings visible for keyboard navigation
- Status announcements via `aria-live="polite"` for dynamic updates

---

### 3.H — Responsive Breakpoints

```typescript
// packages/web-ui/dashboard/src/components/layout/ResponsiveGrid.tsx

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export const BREAKPOINTS = {
  xs: 480,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export interface ResponsiveConfig {
  breakpoint: Breakpoint;
  sidebarLeft: 'hidden' | 'collapsed' | 'expanded';
  sidebarRight: 'hidden' | 'collapsed' | 'expanded';
  statsGrid: 'grid-cols-1' | 'grid-cols-2' | 'grid-cols-4';
  workerCardsPerRow: number;
  showTextLabels: boolean;
}

export const RESPONSIVE_CONFIGS: Record<Breakpoint, ResponsiveConfig> = {
  '2xl': {
    breakpoint: '2xl',
    sidebarLeft: 'expanded',
    sidebarRight: 'expanded',
    statsGrid: 'grid-cols-4',
    workerCardsPerRow: 6,
    showTextLabels: true,
  },
  xl: {
    breakpoint: 'xl',
    sidebarLeft: 'expanded',
    sidebarRight: 'expanded',
    statsGrid: 'grid-cols-4',
    workerCardsPerRow: 4,
    showTextLabels: true,
  },
  lg: {
    breakpoint: 'lg',
    sidebarLeft: 'collapsed',
    sidebarRight: 'collapsed',
    statsGrid: 'grid-cols-2',
    workerCardsPerRow: 3,
    showTextLabels: true,
  },
  md: {
    breakpoint: 'md',
    sidebarLeft: 'collapsed',
    sidebarRight: 'hidden',
    statsGrid: 'grid-cols-2',
    workerCardsPerRow: 2,
    showTextLabels: true,
  },
  sm: {
    breakpoint: 'sm',
    sidebarLeft: 'hidden',
    sidebarRight: 'hidden',
    statsGrid: 'grid-cols-1',
    workerCardsPerRow: 1,
    showTextLabels: false,
  },
  xs: {
    breakpoint: 'xs',
    sidebarLeft: 'hidden',
    sidebarRight: 'hidden',
    statsGrid: 'grid-cols-1',
    workerCardsPerRow: 1,
    showTextLabels: false,
  },
};

export function useResponsive(): ResponsiveConfig {
  const [config, setConfig] = useState<RESPONSIVE_CONFIGS['xl']>();

  useEffect(() => {
    const updateConfig = () => {
      const width = window.innerWidth;
      if (width >= BREAKPOINTS['2xl']) setConfig(RESPONSIVE_CONFIGS['2xl']);
      else if (width >= BREAKPOINTS.xl) setConfig(RESPONSIVE_CONFIGS.xl);
      else if (width >= BREAKPOINTS.lg) setConfig(RESPONSIVE_CONFIGS.lg);
      else if (width >= BREAKPOINTS.md) setConfig(RESPONSIVE_CONFIGS.md);
      else if (width >= BREAKPOINTS.sm) setConfig(RESPONSIVE_CONFIGS.sm);
      else setConfig(RESPONSIVE_CONFIGS.xs);
    };

    updateConfig();
    window.addEventListener('resize', updateConfig);
    return () => window.removeEventListener('resize', updateConfig);
  }, []);

  return config || RESPONSIVE_CONFIGS.xl;
}
```

**Changes:**
- Explicit breakpoint configs for all layout aspects
- Sidebar behavior: expand → collapse → hide based on width
- Stats grid auto-adjusts (1→2→4 columns)
- Worker cards per row scales down
- Text labels hide on small screens to save space
- Smooth transitions between breakpoints

---

## 4. Rollback Strategy

Each workstream has a feature flag in dashboard state:

```typescript
// Feature flags for gradual rollout

export const DASHBOARD_FEATURE_FLAGS = {
  sidebarHierarchy: { enabled: true, rollBack: () => {} },
  statsGridResponsive: { enabled: true, rollBack: () => {} },
  rightSidebarSplit: { enabled: true, rollBack: () => {} },
  topbarGrouping: { enabled: true, rollBack: () => {} },
  navigationMemory: { enabled: true, rollBack: () => {} },
  emptyStates: { enabled: true, rollBack: () => {} },
  accessibilityParity: { enabled: true, rollBack: () => {} },
  responsiveBreakpoints: { enabled: true, rollBack: () => {} },
};
```

Rollback steps:
1. Set flag to `false` — component renders fallback legacy component
2. CSS class changes revert via Tailwind ````
3. State management reverting to local state if hook disabled

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|---|
| Responsive grid breaks existing layouts | Medium | High | Test on all breakpoints before merge |
| Navigation memory conflicts with router | Low | High | Use shallow routing, preserve state in context |
| Empty states hide real bugs | Medium | Medium | Add "debug mode" to force show content |
| Accessibility changes slow down renders | Low | Low | Memoize status config lookups |
| Sidebar hierarchy breaks existing navigation | Medium | High | Keep existing route paths, add visual layer only |

---

# Part 2 — Agent Brief

## Mission

Implement structural dashboard improvements identified in design review, achieving 9/10 UX score by addressing hierarchy, responsiveness, and accessibility gaps.

## Hard Requirements

1. **No breaking changes** — Existing routes, APIs, and state structures must remain functional
2. **Responsive** — Must work on 375px (mobile) to 1920px (desktop) viewports
3. **Accessible** — WCAG 2.1 AA compliance on color, focus, and screen reader
4. **Performant** — No new layout thrashing, maintain 60fps

## Execution Policies

1. Implement one workstream at a time, verify before moving to next
2. Use feature flags for all changes, default enabled
3. Test responsive behavior with viewport resizing, not just reload
4. Verify screen reader with VoiceOver (macOS) or NVDA (Windows)

## Safety Stops

- If any workstream causes layout collapse, stop and rollback
- If screen reader testing fails, stop and address before continuing
- If performance degrades >20% on any metric, stop and optimize

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.5.1",
  "project": {
    "name": "pi-mono",
    "repoUrl": "https://github.com/pi/pi-mono",
    "packageManager": "npm",
    "root": "."
  },
  "planExecution": {
    "planIntake": {
      "autoNormalize": true,
      "autoDoctor": true,
      "autoDAG": true,
      "autoOptimizationProposal": false
    },
    "optimizer": {
      "enabled": false,
      "objectives": [],
      "allowedPatches": [],
      "forbiddenPatches": []
    },
    "scheduling": {
      "continuous": true,
      "prewarmCount": 6
    },
    "worktree": {
      "enabled": true,
      "isolationMode": "isolated",
      "prewarmCount": 6,
      "cleanupPolicy": "auto"
    },
    "scale": {
      "defaultMode": "experimental_6",
      "selectedMode": "experimental_6"
    },
    "integration": {
      "queueEnabled": true,
      "validationLockEnabled": true,
      "conflictDetectionEnabled": true
    },
    "queueOptimization": {
      "enabled": true,
      "strategy": "priority_then_fifo"
    },
    "validation": {
      "policy": "targeted_then_final",
      "heavyCommandUsesGlobalLock": true,
      "watchModeForbidden": true
    }
  },
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 4,
    "expectedDagEffectiveParallelismMin": 2,
    "preflightStatus": "advisory",
    "approvalState": "not_required",
    "batchingStrategy": "dag_topological_batches"
  },
  "controls": {
    "dashboard": {
      "enabled": true,
      "url": "http://localhost:3000"
    },
    "interactiveParallelismReview": {
      "enabled": false
    }
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "dependency_cycles",
      "unsafe_scale_mode",
      "integration_validation_failure"
    ],
    "forbiddenCommands": [
      "git push",
      "rm -rf",
      "npm publish"
    ],
    "forbiddenFiles": [
      ".env*",
      "**/*.pem"
    ]
  },
  "workspaces": [
    {
      "id": "21.A",
      "title": "Sidebar Hierarchy Implementation",
      "description": "Implement P11 Core / Brain visual separation in sidebar with distinct headers and consolidated items",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": ["21.B", "21.C", "21.D"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Independent UI component work"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "low"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.B",
      "title": "Stats Grid 2x4 Responsive",
      "description": "Implement responsive stats grid with priority-based layout and breakpoint handling",
      "dependencies": ["21.A"],
      "parallelGroup": "batch_2",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["21.C", "21.D", "21.E"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Depends on base component structure"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "low"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.C",
      "title": "Right Sidebar 3-Section Split",
      "description": "Implement clear section separation (Events/Alerts/Cleanup) with collapsible alerts",
      "dependencies": ["21.A"],
      "parallelGroup": "batch_2",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["21.B", "21.D", "21.E"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Independent UI component work"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "low"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.D",
      "title": "Topbar Control Grouping",
      "description": "Group playback controls together, merge sidebar toggle to single button",
      "dependencies": ["21.A"],
      "parallelGroup": "batch_2",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["21.B", "21.C", "21.E"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Independent UI component work"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "low"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.F",
      "title": "Empty States Implementation",
      "description": "Implement meaningful empty states for all major sections with CTAs",
      "dependencies": ["21.A"],
      "parallelGroup": "batch_3",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["21.G", "21.H"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Independent UI work"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "normal"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.G",
      "title": "Accessibility Parity",
      "description": "Add icon + text labels to all status indicators, screen reader support, focus management",
      "dependencies": ["21.F"],
      "parallelGroup": "batch_4",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": ["21.H"],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Depends on empty states for testing"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": false,
        "requiresIntegrationValidation": false,
        "conflictHandoffRequired": false,
        "queuePriority": "normal"
      },
      "validation": {
        "profile": "final_only",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "21.H",
      "title": "Responsive Breakpoints & Testing",
      "description": "Implement explicit breakpoint configurations and viewport testing",
      "dependencies": ["21.B"],
      "parallelGroup": "batch_4",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": true,
        "safeParallelismNotes": "Final integration and testing"
      },
      "worktree": {
        "required": true,
        "isolationMode": "isolated"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": false,
        "queuePriority": "high"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "targetCommand": "npm run build --workspace=packages/web-ui && npm run test --workspace=packages/web-ui",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "medium",
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
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
  "phase": "P21",
  "title": "Dashboard V2 Redesign: Structural Improvements",
  "primaryGoal": "Implement structural dashboard improvements: sidebar hierarchy, responsive stats grid, 3-section right sidebar, topbar grouping, navigation memory, empty states, accessibility parity, responsive breakpoints",
  "projectName": "pi-mono",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 4,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "priority_then_fifo",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 2,
  "notInScope": [
    "State management backend changes",
    "Backend API modifications",
    "New dashboard features beyond structural fixes",
    "Full theme/color system overhaul"
  ],
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
    "queue_optimization_invalid_strategy",
    "queue_priority_invalid_level"
  ],
  "completionGate": "All 8 structural improvements implemented, responsive breakpoints working, accessibility WCAG 2.1 AA compliant, all tests passing",
  "nextPhase": null
}
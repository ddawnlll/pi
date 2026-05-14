# Pi Dashboard — Design Analysis & Summary

> File: `packages/web-ui/dashboard/`
> Tech stack: React 18, Tailwind CSS v4 (Vite), Framer Motion 11, Lucide Icons, TanStack React Query 5
> Target: Full redesign of layout, color system, component architecture, and interaction model

---

## 1. Layout Architecture

### 1.1 Top-Level Structure: 3-Panel Split

The dashboard is a **three-column resizable layout** that fills the viewport:

```
┌─────────────────────────────────────────────────────────┐
│  Header Bar (48px)                                      │
│  [sidebar toggle] [Planner ▲ StatusBadge] [controls]    │
├──────────┬─────────────────────────────┬────────────────┤
│  Left    │  Center                     │  Right         │
│  Sidebar │  [toolbar]                  │  Sidebar       │
│  320px   │  [stats] [queue strip]      │  Events        │
│          │  [warning banners]          │  Alerts        │
│  Tabs:   │  [worker list / detail      │  PlanSummary   │
│  Browse  │   / scale cockpit /         │                │
│  Queue   │    batch OS / lead agent]   │                │
│  Chat    │                             │                │
├──────────┴─────────────────────────────┴────────────────┤
│  (Dialogs: Settings, Git, Commands, Log Viewer)         │
└─────────────────────────────────────────────────────────┘
```

**Key layout properties:**
- `w-full h-screen flex flex-col` — viewport-filling, no scrolling on the body
- Center column is `flex-1` with `min-w-0 overflow-hidden`
- Sidebars collapse with Framer Motion `AnimatePresence` (duration 0.22s, ease `[0.4, 0, 0.2, 1]`)
- Mobile: sidebars render as absolute-positioned overlays with a 30% black backdrop
- All scrolling is *contained* to child regions (`overflow-y-auto`), never the body

### 1.2 Left Sidebar: 3 Tabs

Toggled by the `leftOpen` state + mobile nav. Contains:
1. **Browse tab** — Project list (filterable) + Execution history (scrollable)
2. **Queue tab** — `PlanQueueTab` (plan queue management)
3. **Chat tab** — `ChatPanel` (conversational AI with context refs)

Tab bar: `text-[10px] font-semibold uppercase tracking-widest`, active state with `border-b-2 border-blue-500` and blue text.

### 1.3 Center Column: Content Stack

Multiple conditional content zones stacked top-to-bottom:
1. **Toolbar** (row of `LabeledBtn` components, 44px tall)
2. **WarningBanner** (collapsible amber alerts with dismiss capability)
3. **Stat cards row** (7-column grid on sm+, 2-column on small)
4. **QueueStrip** (horizontal segmented bar showing pending/active/blocked/complete/failed counts)
5. **SchedulerStatusPanel**
6. **Main content** — one of:
   - Worker list + worker detail / live logs
   - Scale cockpit (grid of sub-panels)
   - Batch OS dashboard
   - Lead agent dashboard

### 1.4 Right Sidebar: Events + Alerts + Plan Summary

Fixed 300px wide, contains:
1. **Events feed** — scrollable list of journal events with All/Errors filter toggle
2. **Alerts section** — failed workspaces, merge conflicts, blocked workspaces
3. **PlanSummaryPanel** — cleanup review verdict, stats grid, issues, changed files, test results

### 1.5 Overlay Panels

Float over the center column using `AnimatePresence` + `motion.aside`:
- **Chat overlay** (320px, from the right)
- **Artifacts browser** (480px, from the right)
- **Dialogs**: Settings, Git, Commands, execution log viewer — rendered as centered modals with `bg-black/60` backdrop

---

## 2. Color System

### 2.1 Token Architecture

Colors are defined as **Tailwind arbitrary values** (e.g., `bg-[#F7F6F3]`) with per-component dark variants. There are **no CSS custom properties** used consistently — each file defines its own token constants.

The only CSS custom properties are in `index.css` for the dark theme:
```css
.dark {
  --color-surface: #1E1E1E;
  --color-surface-alt: #252525;
  --color-border: #3A3A3A;
  --color-text: #E8E6E1;
  --color-text-muted: #A0A09A;
  --color-accent-bg: #1E3A5F;
  --color-accent-text: #6BB5FF;
}
```
**However, these CSS variables are never referenced in component code** — components use their own string constants instead.

### 2.2 Token Constants (per-file, duplicated)

The most common pattern in `App.tsx`:
```typescript
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
```

**This pattern is copied across ~15 component files** with slight variations:
- `SURF`, `BORD`, `TXT`, `MUT` are the most-duplicated
- Some files add `ACC_TXT = "text-blue-700 dark:text-blue-300"`, others don't
- No shared import of these token constants

### 2.3 Color Palette — Light Mode

| Token | Hex | Tailwind Equivalent | Usage |
|-------|-----|---------------------|-------|
| Background | `#F7F6F3` | stone-50 | Page/chrome background |
| Surface | `#FFFFFF` | white | Card/sidebar backgrounds |
| Border | `#E8E6E1` | stone-200 | All borders, dividers |
| Text | `#1C1917` via `text-stone-800` | stone-800 | Primary text |
| Muted text | `#A8A29E` via `text-stone-400` | stone-400 | Secondary/label text |
| Accent BG | `#EBF2FF` | blue-50 | Active/selected item background |
| Accent text | `#1D4ED8` via `text-blue-700` | blue-700 | Active tab, selected item text |
| Primary button | `#2563EB` via `bg-blue-600` | blue-600 | Accent buttons, primary CTAs |
| Error BG | `#FEF2F2` via `bg-red-50` | red-50 | Error alerts, failed state |
| Warning BG | `#FFFBEB` via `bg-amber-50` | amber-50 | Warning/alerts |
| Success BG | `#ECFDF5` via `bg-emerald-50` | emerald-50 | Success indicators |

### 2.4 Color Palette — Dark Mode

| Token | Hex | Tailwind Equivalent | Usage |
|-------|-----|---------------------|-------|
| Background | `#161616` | near-black | Page/chrome background |
| Surface | `#1E1E1E` | neutral-900 | Card/sidebar backgrounds |
| Border | `#333333` | neutral-800 | All borders, dividers |
| Text | `#E7E5E4` via `text-stone-200` | stone-200 | Primary text |
| Muted text | `#78716C` via `text-stone-500` | stone-500 | Secondary text |
| Surface hover | `#2A2A2A` | — | Hover state for list items/buttons |
| Accent BG | `#1A2A44` | — | Active selection background |
| Accent text | `#93C5FD` via `text-blue-300` | blue-300 | Active tab text |
| Error BG | `#450A0A` via 30% opacity | red-950/30 | Error state backgrounds |
| Warning BG | `#451A03` via 20% opacity | amber-950/20 | Warning backgrounds |

### 2.5 Status Color Mapping

Status colors are consistent across all components using these 5 states:

| Status | Light Text | Light BG | Dark Text | Dark BG | Icon |
|--------|-----------|---------|-----------|---------|------|
| active/running | `text-emerald-600` | `bg-emerald-50` | `text-emerald-400` | `bg-emerald-900/30` | `CircleDot` (pulsing) |
| pending | `text-stone-400` | `bg-stone-100` | `text-stone-500` | `bg-stone-800/30` | — |
| blocked | `text-amber-600` | `bg-amber-50` | `text-amber-400` | `bg-amber-900/30` | `AlertCircle` |
| complete/done | `text-blue-600` | `bg-blue-50` | `text-blue-400` | `bg-blue-900/30` | `CheckCircle2` |
| failed | `text-red-600` | `bg-red-50` | `text-red-400` | `bg-red-900/30` | `AlertCircle` |
| stopped | `text-orange-700` | `bg-orange-50` | `text-orange-300` | `bg-orange-950/60` | `Square` |
| cancelled | `text-stone-500` | `bg-stone-100` | `text-stone-400` | `bg-stone-900/60` | `Ban` |

---

## 3. Typography

### 3.1 Font Stack

```css
font-family: 'DM_Sans', ui-sans-serif, system-ui, sans-serif
```
Applied at the root level in `App.tsx` via a className.

### 3.2 Type Scale

| Context | Size | Weight | Tracking | Case |
|---------|------|--------|----------|------|
| App title / section titles | `text-[13px]` | `font-semibold` | `tracking-tight` | normal |
| Section headers | `text-[10px]` | `font-semibold` | `tracking-[0.1em]` | `uppercase` |
| Button labels | `text-xs` | `font-medium` | normal | normal |
| Tab labels | `text-[10px]` | `font-semibold` | `tracking-widest` | `uppercase` |
| Metric values | `text-xl` or `text-lg` | `font-bold` or `font-semibold` | `tabular-nums` | normal |
| Metric labels | `text-[10px]` or `text-[9px]` | `font-semibold` | `tracking-wider` or `tracking-widest` | `uppercase` |
| Body / event text | `text-[11px]` | normal | normal | normal |
| Monospace (logs) | `text-xs` | normal | normal | normal |
| Monospace (diffs) | `text-[11px]` | normal | normal | normal |

**Key finding:** The type scale is extremely small. Most UI text is `10px` (6.25pt) to `12px` (9pt), with metric values being `16px-20px`. This is optimized for information density on developer monitors.

---

## 4. Spacing & Sizing

### 4.1 Common Measurements

- **Header bar height**: `h-12` (48px)
- **Toolbar height**: `h-11` (44px)
- **Sidebar widths**: 320px (left), 300px (right)
- **Card/panel padding**: `p-3` (12px) or `p-4` (16px)
- **Stat cards**: `p-4` with `rounded-xl` (12px radius)
- **List items**: `px-3.5 py-2` or `px-4 py-3`
- **Tab bars**: `py-2.5` (10px)
- **Icon buttons**: `h-8 w-8` (32x32px), small variant `h-7 w-7`
- **Labeled buttons**: `h-8 px-3` (32px tall)
- **Dialogs**: `min-w-[560px] max-w-2xl`, `max-h-[80vh]`
- **Divider**: `h-px` with color `bg-[#E8E6E1] dark:bg-[#333]`

### 4.2 Border Radius

- **Buttons/cards/panels**: `rounded-lg` (8px)
- **Stat cards (legacy)**: `rounded-xl` (12px)
- **Status badges**: `rounded-full` (pill shape)
- **Inputs/dialogs**: `rounded-lg` (8px)
- **Channels/stream pills**: `rounded` (4px)
- **Filter toggles**: `rounded` (4px)

---

## 5. Component Architecture

### 5.1 Reusable Primitives

The dashboard has a thin set of shared components plus many duplicated style tokens:

| Component | Props | Usage |
|-----------|-------|-------|
| `IconBtn` | `icon, label, variant("ghost"/"outline"/"accent"), danger, size` | Icon-only toolbar buttons |
| `LabeledBtn` | `icon, label, accent, danger, disabled` | Toolbar action buttons with text |
| `SectionHeader` | `title: string` | Sidebar section labels (uppercase 10px) |
| `Divider` | none | Horizontal rule |
| `StatCard` | `icon, label, value, accent, sublabel` | Metric display cards |
| `StatusBadge` | `status: string` | Animated status pill with ping effect |
| `EventLine` | `event: any` | Single event row in event feed |

### 5.2 Component Patterns & Inconsistencies

**Pattern 1: Inline token constants** — Most components redeclare `SURF`, `BORD`, `TXT`, `MUT` as local constants. There is no shared import.

**Pattern 2: Inline CSS keyframes** — `ThinkingAnimation.tsx` programmatically injects `<style>` tags into the document head. `app.css` also defines `@keyframes` in a separate CSS file.

**Pattern 3: Legacy vs Modern code** — Two distinct eras coexist:
- **Era 1 (Legacy)**: `Header.tsx`, `WorkerList.tsx`, `ControlButtons.tsx`, `LogViewer.tsx` — uses dark background (`bg-gray-900`), green terminal-style logs (`bg-black text-green-400`), Tailwind's built-in `gray` palette, Framer Motion `whileTap`/`layout` animations
- **Era 2 (Modern)**: `App.tsx`, `LiveLogTerminal.tsx`, `WorkerDetail.tsx`, `BatchOSDashboard.tsx` — uses light stone/warm palette, custom `#E8E6E1`/`#F7F6F3` colors, dark `#161616`/`#1E1E1E` surfaces, stacked token constants

**Pattern 4: Dialog rendering** — Two approaches:
- **Modal pattern 1**: `fixed inset-0 z-50 flex items-center justify-center bg-black/60` with nested dialog div + click-outside-to-close
- **Modal pattern 2**: `AnimatePresence` + `motion.div` wrapper with same backdrop pattern

---

## 6. Animation System

### 6.1 Libraries

- **Framer Motion 11** — Used for sidebar slide transitions, dialog entrance/exit, modal overlays
- **CSS `@keyframes`** — Used for log fade-in, thinking dots, cursor blink, brain pulse, tool bounce, arrow cycle, slow spin

### 6.2 Animation Catalog

| Element | Type | Duration | Easing | Details |
|---------|------|----------|--------|---------|
| Sidebar slide | Width + opacity | 0.22s | `[0.4, 0, 0.2, 1]` | Tween variant |
| Error banner | Height + opacity | 0.2s | default | AnimatePresence |
| Dialog entrance | Opacity + scale | 0.1s | default | Scale from 0.95 |
| Status indicator ping | Scale | 1.5s | easeInOut, infinite | CSS animation |
| Thinking dots | Opacity + scale | 1.4s | easeInOut, staggered | CSS animation |
| Live writing text | JS interval | 15ms/char | — | useState-driven |
| Log fade-in | Opacity + translateY | 0.35s | ease-out | CSS animation |
| Metric bars | Width transition | 0.5s | default | Tailwind transition |
| Hover states | background-color | 0.15s | default | Tailwind `transition-colors` |
| Spinner | Rotation | 2s (slow) / 1s (fast) | linear, infinite | CSS animation |

---

## 7. Icon System

### 7.1 Library

**Lucide React v0.454** — ~35 unique icons imported across all components.

### 7.2 Icon Style

- Default size: `size={14}` or `size={15}`, `strokeWidth={1.8}` or `strokeWidth={2}`
- Some legacy components use emoji/unicode symbols (e.g., `brain` U+1F9E0, `wrench` U+1F527, `shuffle` U+1F500)
- Small metrics icons: `size={13}` with `strokeWidth={1.8}`
- Tiny indicator icons: `size={9}`, `size={10}`, `size={11}`

### 7.3 Icon Usage Frequency

High-use icons: `AlertCircle`, `AlertTriangle`, `Activity`, `Cpu`, `GitBranch`, `LayoutGrid`, `Loader2`, `X`, `CheckCircle2`, `Lightbulb`
Medium: `Bot`, `Upload`, `Settings`, `Play`, `Pause`, `Square`, `Filter`, `Terminal`, `RefreshCw`
Low: `FileCode`, `Archive`, `DollarSign`, `Zap`, `BarChart3`, `ListOrdered`, `Layers`, `Timer`, `Clock`, `Info`, `Sparkles`

---

## 8. Key Design Issues & Anti-Patterns

### 8.1 Critical Issues

1. **No shared design token system** — Color constants (`SURF`, `BORD`, `TXT`, `MUT`, `ACC_BG`, `ACC_TXT`) are independently redeclared in ~15 component files. Any palette change requires editing every file.

2. **CSS variable disconnect** — The `.dark` class in `index.css` defines CSS custom properties (`--color-surface`, `--color-border`, etc.) that are **never referenced** in any component. All components use hardcoded Tailwind arbitrary values instead.

3. **Legacy/modern split** — Two theming/color systems coexist: an older `gray`-based dark theme (legacy components) and a newer `stone`-based warm palette (modern components). This creates visual inconsistency. The old legacy components (`Header.tsx`, `ControlButtons.tsx`, `WorkerList.tsx`, `LogViewer.tsx`) remain in the bundle but are actively rendered only in specific paths.

4. **Inline CSS injection** — `ThinkingAnimation.tsx` injects `<style>` tags into document head programmatically. This duplicates keyframes already defined in `app.css`.

### 8.2 Minor Issues

5. **All text is very small** — The `10px` base for labels and `11-12px` for body text is optimized for dense dashboards but is at the edge of readability, especially on non-Retina displays.

6. **Token duplication in CSS** — `app.css` and `index.css` both import `tailwindcss` and define the same `@keyframes log-fade-in` and `@keyframes thinking-dot-*` animations.

7. **Fragmented dark mode** — The dark mode variant is set in `index.css` via `@variant dark (&:where(.dark, .dark *))`, but some components use inline `dark:` variants while legacy components (in sub-dialogs like `SettingsDialog.tsx`) still use the old `gray` palette.

---

## 9. Responsive Behavior

### 9.1 Breakpoints

- **Mobile** (< 768px / `md:`): Sidebars become absolute overlays with `z-40` and a `bg-black/30` backdrop. Nav button in header toggles mobile nav state.
- **Tablet/Desktop** (>= 768px): Sidebars are fixed-position within the flex layout (`md:relative md:z-auto`).
- **Small screens** (`sm:`): Stat cards collapse from 7-col to 2-col grid.

### 9.2 Layout Responsiveness

- The core 3-panel layout is **fixed-width** (320px / 300px sidebars), not percentage-based
- On narrow screens, sidebars overlay instead of reflowing
- Toolbar buttons can overflow — they don't collapse into a hamburger menu
- Content areas use `min-w-0` + `overflow-hidden` to prevent horizontal overflow

---

## 10. Dark Mode

### 10.1 Toggle Mechanism

- Set via a custom DOM event (`pi-theme-change`) dispatched on `window`
- Handled by `useTheme` hook which adds/removes `.dark` class on `<html>` 
- Theme preference stored in localStorage under `pi-dashboard-theme`
- Respects `prefers-color-scheme: dark` system preference on initial load
- Can also be changed inside Settings dialog (General tab dropdown)

### 10.2 Dark Mode Implementation

Tailwind v4 `@variant` directive:
```css
@variant dark (&:where(.dark, .dark *));
```
Components apply dark variants inline: `bg-white dark:bg-[#1E1E1E]`

---

## 11. Data Patterns

### 11.1 State Management

- **TanStack React Query 5** — All API data fetching (`usePlanExecutions`, `useProjects`, `useSettings`, `useScaleStatus`, etc.) with automatic caching, polling, and invalidation
- **React `useState`** — UI state (sidebar open/close, active tabs, selected worker, dialog visibility)
- **SSE (Server-Sent Events)** — Real-time log streaming (`useWorkspaceLogStream`, `useLogStream`, `useWorkerTranscript`, `useLiveLogTerminal`)
- **Custom DOM events** — Theme changes propagate via `pi-theme-change` custom event

### 11.2 API Endpoints Used

| Endpoint | Hook | Purpose |
|----------|------|---------|
| `GET /api/projects` | `useProjects` | List projects |
| `GET /api/projects/:id/plans` | `usePlanExecutions` | List plan executions |
| `GET /api/projects/:id/plans/:execId` | `usePlanExecutionDetail` | Plan execution detail |
| `GET /api/projects/:id/plans/:execId/stats` | `usePlanStats` | Token/cost stats |
| `GET /api/projects/:id/plans/:execId/summary` | (in PlanSummaryPanel) | Cleanup review |
| `POST /api/control` | sendControlCommand | Pause/resume/stop |
| `SSE /api/logs/:planId/:workerId/:stream` | useWorkspaceLogStream | Log streaming |
| `GET /api/git-info` | fetchGitData | Git branch/status |
| `GET .../git-diff` | (in components) | File diffs |
| `GET /api/projects/:id/plan-queue` | usePlanQueue | Queue management |
| Various `/api/scale/*` | useScaleStatus | Scale mode, worktrees, integration queue |

---

## 12. Design Opportunities for Redesign

### 12.1 What to Keep

- **Three-panel layout** is proven for this use case — keeps navigation, content, and monitoring visible simultaneously
- **Framer Motion sidebar transitions** at 0.22s with custom easing feel polished
- **Status color mapping** (emerald=active, amber=blocked, blue=complete, red=failed) is clear and intuitive
- **Metric card design** (icon + large value + tiny label) works well for glanceable data
- **QueueStrip** (horizontal segmented bar of status counts) is effective
- **Channel-filtered log viewer** with auto-scroll toggle is well-designed

### 12.2 What to Redesign

- **Establish a single design token system** — CSS custom properties or a shared token object imported by all components
- **Unify legacy and modern color systems** — Migrate all components to the `stone`/warm palette, remove the old `gray`-based theme
- **Create a proper design system** with shared Button, Card, Badge, Tab, Dialog, Input primitives
- **Increase base font size slightly** (10px → 11px minimum for labels)
- **Improve responsive behavior** — Sidebars should reflow to stacked on smaller screens instead of absolute overlays
- **Reduce token duplication** — Centralize animation keyframes
- **Improve dialog consistency** — Standardize on one modal pattern
- **Better mobile experience** — Toolbar overflow needs a collapsed menu
- **Accessibility** — Audit color contrast ratios, especially for muted text on dark backgrounds; keyboard navigation paths
- **Performance** — Consider `React.memo` for frequently-updating components (event feed, log lines, worker cards)

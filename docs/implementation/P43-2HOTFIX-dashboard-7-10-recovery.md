# P43-2HOTFIX — Dashboard 7/10 Recovery

**Author:** Pi Development Team
**Template:** LLM Implementation Agent — Master Template v4.1.1
**Created:** 2026-06-02
**Target system:** Pi dashboard (packages/web-ui/dashboard)
**Goal:** Raise dashboard visual quality from ~4/10 to at least 7/10 through typography + tokens + responsive + accessibility hotfix, without full rewrite.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P43-2HOTFIX
**One-line goal:** Fix broken font, eliminate micro-typography, centralize design tokens, add surface depth, normalize status vocabulary, add responsive sidebar access, fix accessibility, inject Pi identity — 8 workspaces, no full rewrite.
**Why now:** Dashboard is functional internally but lacks product quality. Typography is broken (200+ micro-text instances, failed font loading). Design tokens from mini-lit claude.css exist but are ignored. Colors/statuses are inconsistent. Responsive behavior is broken. Accessibility fails WCAG AA. Visual identity is absent. The analysis report (reports/dashboard-7of10-redesign-analysis.md) provides a detailed evidence-based diagnosis.
**Blast radius:** `packages/web-ui/dashboard/src/` — all component files, CSS files, plus one new tokens module. No backend/API changes. No new dependencies.
**Rollback path:** Every workspace is independently revertible. No data migrations. Changes are visual/presentation-only. Git revert per workspace.
**Repair class:** implementation
**Execution automation:** disabled — all workspaces are manual/assisted. This is a frontend UI hotfix, not a kernel repair.
**Selected repair mode:** manual_1 — human applies each workspace after review
**Target promotion mode:** N/A — this is a frontend-only change that does not require execution kernel promotion
**Autonomous execution allowed:** false
**Agent repo mutation allowed:** true — the implementation agent may edit dashboard source files
**Promotion gate status:** N/A
**Scale mode:** stable_3 (shared working tree, no worktree isolation needed for frontend CSS/TSX changes)
**Safe parallelism target:** 1 — workspaces must run sequentially to avoid merge conflicts on shared files
**Done when:** All 8 workspaces complete, all acceptance checks pass, visual smoke test at 6 viewport sizes confirms 7/10 quality.

## 1. Header

| Field | Value |
|---|---|
| Phase | P43-2HOTFIX |
| Title | Dashboard 7/10 Recovery |
| Status | Planned |
| Last updated | 2026-06-02 |
| Delivery status | Not started |
| Target environment | Local dev (vite dev server) |
| Primary focus | Dashboard typography, design tokens, responsive, accessibility, visual identity |
| Product-code changes | Forbidden — dashboard `src/` and `public/` only |
| Repair class | implementation |
| Execution automation | disabled |
| Selected repair mode | manual_1 |
| Target promotion mode | N/A |
| Autonomous execution allowed | false |
| Agent repo mutation allowed | true |
| Promotion gate status | N/A |
| Selected scale mode | stable_3 |
| Requested max workers | 1 |
| Expected DAG effective parallelism | 1 |
| Expected safe effective parallelism | 1 |
| Worktree isolation | Disabled — shared-tree CSS/TSX changes, no isolation needed |
| Integration queue | Disabled |
| Isolation mode | direct |
| Patch isolation | Disabled |
| Patch apply queue | Disabled |
| PatchCoordinator | Disabled |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| W1 — Typography + Font Recovery | Implementation Agent | Human Reviewer | Frontend Skills | Pi Team |
| W2 — Shared Design Tokens | Implementation Agent | Human Reviewer | mini-lit docs | Pi Team |
| W3 — Surface / Depth / Color Migration | Implementation Agent | Human Reviewer | Design Skills | Pi Team |
| W4 — Status Vocabulary + Badges | Implementation Agent | Human Reviewer | Types Owner | Pi Team |
| W5 — Responsive Minimum Viability | Implementation Agent | Human Reviewer | — | Pi Team |
| W6 — Accessibility Recovery | Implementation Agent | Human Reviewer | A11y Docs | Pi Team |
| W7 — Pi Identity + Product Feel | Implementation Agent | Human Reviewer | — | Pi Team |
| W8 — Verification / Regression Gate | Implementation Agent | Human Reviewer | Test Suite | Pi Team |

## 2. Purpose

The Pi dashboard currently scores approximately 4/10 on product quality. A comprehensive analysis (reports/dashboard-7of10-redesign-analysis.md) identified 10 specific problems spanning typography, color, surface depth, status vocabulary, responsive behavior, accessibility, and visual identity. The analysis also discovered that the `@mariozechner/mini-lit/themes/claude.css` design token system is already imported by the dashboard but completely ignored — all components use hardcoded hex color values and duplicate local token constants.

This hotfix plan targets the minimum viable set of changes to raise the dashboard from 4/10 to at least 7/10. The plan does NOT rewrite the dashboard architecture, replace React/routing, change the AppShell layout model, or introduce new dependencies. It is a presentation-layer recovery: fix what's broken, centralize what's duplicated, and inject visual personality.

The target outcome is a dashboard that is readable (proper font + typography scale), visually distinct (depth/shadows + consistent colors), accessible (contrast + focus + landmarks), responsive (sidebar access on mobile, usable on tablet), and identifiable as a Pi product (accent color + logomark + personality).

## 3. What Carried Over — Must Stay Stable

* [x] AppShell.tsx layout shell preserved — no h-screen/overflow model change
* [x] TopbarV3, StatusBarV3, TaskRunSidebar, CenterWorkSurface, CockpitTabs components preserved
* [x] NavigationState.tsx routing model preserved
* [x] All React Query hooks preserved
* [x] All API endpoints and data types preserved
* [x] mini-lit package unchanged (theme already present, just needs adoption)
* [x] No new npm dependencies
* [x] Legacy Sidebar.tsx not removed (may be removed in a later cleanup if safe)
* [x] App.tsx inline sub-components preserved (WorkerCard, QueueStrip, ExecutionStabilityPanel — extraction is deferred to avoid scope creep)
* [x] All existing tests preserved and must pass
* [x] `git push` remains forbidden
* [x] Watch-mode validation remains forbidden

## 4. Background / What Was Wrong

The dashboard was built incrementally across multiple phases (P6.5, P7, P9, P25, P41, P42). Each phase added features but no phase addressed presentation quality holistically. The cumulative result is a dashboard that is functionally complete but visually raw:

1. **Font loading fails silently**: `font-['DM_Sans',...]` has an underscore instead of a space, so the browser falls back to system-ui. No @font-face or Google Fonts import loads DM Sans.
2. **Micro-typography everywhere**: 200+ instances of `text-[9px]`, `text-[10px]`, `text-[11px]` across 15+ files. Most body text is below the 12px WCAG-recommended minimum.
3. **Design tokens ignored**: `@mariozechner/mini-lit/dist/styles/themes/claude.css` defines a complete Tailwind v4 `@theme` block with OKLCH colors, 9 shadow levels, 4 radius sizes, and font tokens. The dashboard's `app.css` imports this file, but zero components reference the theme classes. Instead, every component defines local constants like `const BORD = "border-[#E8E6E1] dark:border-[#333]"`.
4. **No surface depth**: Cards and panels use 1px border with no shadow. Flat appearance.
5. **Inconsistent status names**: "Pending"/"ready"/"queued", "Done"/"complete"/"completed", "active"/"running" used interchangeably.
6. **Responsive broken**: No hamburger menu, sidebar inaccessible on mobile, stat grid jumps from 2→7 columns at 640px with no intermediates.
7. **Accessibility fails**: text-stone-400 on #F7F6F3 has ~2.5:1 contrast (WCAG AA requires 4.5:1). No focus-visible styles. No `<h1>`. No `<main>` landmark.
8. **No brand identity**: "Pi" is plain text in a button. Generic stone/blue Tailwind colors.

## 5. Current Failure State / Known Blockers

* `font_loading` = broken (underscore in font name, no @font-face)
* `design_tokens` = present but unused (claude.css @theme block imported, zero components reference it)
* `micro_typography` = pervasive (200+ instances below 12px, 15+ files affected)
* `surface_depth` = missing (border-only, no shadows on cards/panels)
* `status_vocabulary` = inconsistent ("ready"/"pending"/"queued", "done"/"complete"/"completed")
* `responsive_mobile` = broken (no hamburger button, sidebar inaccessible below 768px)
* `accessibility_contrast` = failing (text-stone-400 on #F7F6F3 ~2.5:1, needs 4.5:1)
* `accessibility_focus` = missing (no focus-visible styles)
* `accessibility_landmarks` = incomplete (no h1, no main, no skip-link)
* `brand_identity` = absent (no logo, no brand color, no personality)
* `npm_run_check` = not yet verified on current code

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Layout breakage from larger text | high | medium | Test each workspace at 1440x900 and 1024x768; adjust padding/card sizes as needed |
| Token migration breaks dark mode | med | high | Inspect claude.css dark mode tokens match or exceed current dark mode colors |
| Color change (blue→orange accent) rejected | med | low | Make accent color configurable via single token; easy to revert to blue |
| Status label change breaks API consumers | low | high | Use normalization layer — raw API status unchanged, only display labels change |
| Shell scroll change causes regressions | med | high | Do NOT change h-screen/overflow model in this hotfix (deferred to future phase) |
| Two sidebars cause confusion during edits | low | med | Only edit active sidebar (TaskRunSidebar); leave Sidebar.tsx untouched |
| `npm run check` fails on unrelated files | low | med | Run check before starting; fix any pre-existing issues in a separate commit |

## 7. Workstreams

### 7.A — W1: Typography + Font Recovery

**Goal:** Fix the broken font declaration, establish a semantic typography scale, eliminate all micro-text below 12px in normal UI, keep justified exceptions for logs/timestamps.

**Requirements:**
* Replace `font-['DM_Sans',...]` with `font-sans` (picks up mini-lit `--font-family-sans` token)
* Define semantic type scale constants in a shared module
* Replace `text-[9px]` through `text-[11px]` with appropriate scale class
* UI body text minimum: `text-xs` (12px)
* Section headers: `text-sm` (14px)
* Page/panel headings: `text-base` (16px)
* Metric values: `text-lg` (18px) or `text-xl` (20px)
* Log lines, timestamps, monospace code: `text-xs` permitted (12px)
* Badge micro-labels: `text-xs` minimum
* All changes must pass `npm run check`

**Acceptance Criteria:**
* `grep -rn "text-\[9px\]" packages/web-ui/dashboard/src/` returns zero results
* `grep -rn "text-\[10px\]" packages/web-ui/dashboard/src/` returns zero results  
* `grep -rn "text-\[11px\]" packages/web-ui/dashboard/src/` returns zero results
* `font-sans` class correctly resolves to system font stack
* Visual inspection at 1440x900 confirms text is readable
* No component visually breaks from larger text

**Isolation & Parallelism Notes:**
* Must run first — all subsequent workspaces depend on the type scale being correct
* Files affected: ~15 files with micro-text instances
* Sequential execution required to avoid merge conflicts on shared component files

### 7.B — W2: Shared Design Tokens

**Goal:** Create a single `src/tokens.ts` module that maps claude.css theme classes into semantic token constants. Migrate all components to import from this shared module instead of defining local BORD/SURF/MUT/ACC constants.

**Requirements:**
* Create `packages/web-ui/dashboard/src/tokens.ts` with exported constants for:
  - Surface tokens: `BG`, `SURF`, `SURF_ALT`
  - Border tokens: `BORD`, `BORD_B`
  - Text tokens: `TXT`, `MUT`
  - Accent tokens: `ACC_BG`, `ACC_TXT`
  - Shadow tokens: `SHADOW_CARD`, `SHADOW_PANEL`, `SHADOW_ACTIVE`, `SHADOW_MODAL`
  - Type scale tokens: `caption`, `metadata`, `badge`, `sectionLabel`, `body`, `heading`, `metricValue`
* Map each constant to the appropriate claude.css Tailwind class (e.g., `bg-card`, `text-foreground`, `border-border`)
* Remove local `const BG/SURF/BORD/MUT/ACC_BG/ACC_TXT` definitions from all component files
* Import from `tokens.ts` instead

**Acceptance Criteria:**
* `grep -rn "const BG = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* `grep -rn "const SURF = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* `grep -rn "const BORD = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* `grep -rn "const MUT = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* `grep -rn "const ACC_BG = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* `grep -rn "const ACC_TXT = " packages/web-ui/dashboard/src/` returns zero results outside tokens.ts
* All classes resolve to valid Tailwind utilities from the claude.css theme
* Dark mode appearance matches or improves on current dark mode
* `npm run check` passes

**Isolation & Parallelism Notes:**
* Must run after W1 (type scale tokens depend on typography decisions in W1)
* Touches ~25 component files for token import migration
* Sequential execution required

### 7.C — W3: Surface / Depth / Color Migration

**Goal:** Add shadow-based surface depth hierarchy. Apply shadow-sm to cards, shadow to panels, shadow-md to active/selected surfaces. Replace hardcoded hex colors with theme token classes.

**Requirements:**
* StatCard: add `SHADOW_CARD` to card wrapper; use `bg-card` instead of `bg-white`
* WorkerCard: add subtle elevation for active state
* CockpitPanels: add `SHADOW_PANEL` to section containers
* Sidebar sections: add `SHADOW_CARD` to nudge card
* Replace `bg-[#F7F6F3]` with `bg-background` (from claude.css theme)
* Replace `bg-white` with `bg-card` for surface backgrounds
* Replace `border-[#E8E6E1]` with `border-border` for all borders
* Replace `bg-[#EBF2FF]` with `bg-accent` for active states
* Replace `text-blue-700` / `text-blue-300` with `text-accent-foreground` for accent text

**Acceptance Criteria:**
* `grep -rn "bg-\[#F7F6F3\]" packages/web-ui/dashboard/src/` returns zero results
* `grep -rn "border-\[#E8E6E1\]" packages/web-ui/dashboard/src/` returns zero results
* `grep -rn "bg-\[#EBF2FF\]" packages/web-ui/dashboard/src/` returns zero results
* Cards display visible shadow at all viewport sizes
* Dark mode surface hierarchy is visibly distinct (cards elevated above background)
* Border contrast is >= the previous explicit hex values
* `npm run check` passes

**Isolation & Parallelism Notes:**
* Must run after W2 (depends on tokens.ts being created and imported)
* Sequential execution required

### 7.D — W4: Status Vocabulary + Badges

**Goal:** Standardize status labels across all dashboard components. Create a shared status utility that normalizes raw API status values into canonical display labels and consistent visual variants.

**Requirements:**
* Create `packages/web-ui/dashboard/src/utils/status.ts` with:
  - Canonical `WorkerStatus` type: `"queued" | "running" | "blocked" | "waiting" | "failed" | "completed" | "cancelled"`
  - `STATUS_LABELS` map: canonical status → display label ("running" → "Running")
  - `STATUS_COLORS` map: canonical status → Tailwind color classes for dot, bg, text, border
* Update QueueStrip labels: "Pending" → "Queued", "Done" → "Completed"
* Update WorkerCard stage badges to use canonical labels
* Update ExecutionStabilityPanel: "ready" → "queued"
* Update TopbarV3 HealthPill to use STATUS_LABELS
* Update StatusBarV3 to use STATUS_LABELS
* Update StatusBadge to accept canonical status and use STATUS_COLORS
* All status badges include an icon or text, not color alone

**Acceptance Criteria:**
* `grep -rn "Pending" packages/web-ui/dashboard/src/App.tsx` returns zero results
* `grep -rn "Done" packages/web-ui/dashboard/src/App.tsx` returns zero results
* `grep -rn "ready" packages/web-ui/dashboard/src/App.tsx` in status context returns zero results
* All status displays use canonical labels from `status.ts`
* Each status badge variant renders with icon + color
* `npm run check` passes

**Isolation & Parallelism Notes:**
* Can run in parallel with W3 (touches different concerns in shared files — W4 changes labels, W3 changes border/shadow classes — minimal overlap if component files are edited carefully)
* Recommended to run sequentially after W3 to avoid edit conflicts

### 7.E — W5: Responsive Minimum Viability

**Goal:** Add hamburger menu to topbar for mobile sidebar access. Add intermediate responsive breakpoints for stat card grids. Ensure dashboard is usable at >= 768px and not broken at < 768px.

**Requirements:**
* Add hamburger icon button to TopbarV3 (visible only on viewports < 768px: `md:hidden`)
* Wire hamburger button to set `mobileNav = "left"` state in App.tsx (already plumbed through AppShell)
* Add responsive grid columns to stat card grid:
  - `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7`
* Add responsive padding to stat cards: `p-3 sm:p-4`
* Ensure sidebar closes when nav item selected on mobile
* Test all viewports: 1440, 1280, 1024, 768, 430, 375

**Acceptance Criteria:**
* Hamburger menu button visible in topbar at viewports < 768px
* Clicking hamburger opens sidebar as slide-over overlay
* Sidebar closes after selecting a navigation item
* Stat card grid uses correct column count at each breakpoint
* No horizontal scrollbar at any supported viewport
* Topbar controls visible and usable at >= 768px
* `npm run check` passes

**Isolation & Parallelism Notes:**
* Can run in parallel with W4 (different files — W5 touches TopbarV3 and App.tsx grid, W4 touches status labels)
* Sequential execution recommended to avoid conflicts in App.tsx

### 7.F — W6: Accessibility Recovery

**Goal:** Fix contrast, add focus-visible styles, add heading hierarchy, add semantic landmarks, add aria-modal to dialogs, add skip-to-content link.

**Requirements:**
* Verify text contrast meets 4.5:1 minimum — the claude.css tokens (adopted in W2/W3) use OKLCH colors with known contrast properties
* Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2` to all interactive elements (buttons, links, tabs, nav items)
* Add `<h1>` to center content area (dynamic based on view type: "Execution Cockpit", "Task Detail", "Platform", "Brain")
* Wrap centerContent in `<main id="main-content">` in AppShell
* Add skip-to-content link as first focusable element in AppShell (visually hidden, revealed on focus)
* Add `aria-modal="true"` to ForceKillDialog, RerunDialog, OpenProjectDialog, PlanUploadDialog, SettingsDialog
* Add focus trapping to modal dialogs (focus moves to modal on open, cycles within, Esc closes and returns to trigger)
* Add `aria-live="polite"` to LiveLogTerminal, ExecutionStabilityPanel event sections

**Acceptance Criteria:**
* Tab through entire dashboard — focus ring visible on every interactive element
* `<h1>` present and semantically appropriate for each view type
* Skip link visible on first Tab press
* Modal focus traps work: Tab cycles within modal, Esc closes
* Screen reader announces status changes in live regions
* `npm run check` passes

**Isolation & Parallelism Notes:**
* Must run after W2 (tokens needed for `ring-primary` class)
* Can run in parallel with W4 and W5 (different concerns, minimal file overlap)
* Sequential recommended to avoid conflicts in AppShell.tsx and dialog components

### 7.G — W7: Pi Identity + Product Feel

**Goal:** Replace text "Pi" logo with SVG logomark. Adopt claude.css primary color (warm amber/orange) as Pi accent. Add personality to empty states.

**Requirements:**
* Create a simple SVG Pi logomark (the Greek letter π in a rounded square or circle)
* Replace TopbarV3 text "Pi" button with SVG icon
* Add the SVG to `public/` so it can be loaded or inlined
* Switch primary action buttons from `bg-blue-600` to `bg-primary` (claude.css warm amber)
* Update empty state copy to have Pi product voice:
  - "No execution selected" → "Your Pi cockpit is ready. Upload a plan to begin."
  - "Select a platform feature from the sidebar" → "Choose a platform tool from the sidebar to get started."
* Add ThinkingAnimation as loading indicator for Brain views (when brain mode is active and loading)
* Optionally: add subtle hover scale/transition on cards

**Acceptance Criteria:**
* Pi SVG logomark renders in topbar at all sizes
* Primary buttons use warm amber accent (claude.css primary), not hardcoded blue
* Empty states use Pi-voiced copy
* Brain views show ThinkingAnimation while loading
* No jarring color clashes with existing status colors (emerald, amber, red remain semantic)
* `npm run check` passes
* Visual inspection confirms Pi feels like a distinct product, not a generic SaaS tool

**Isolation & Parallelism Notes:**
* Must run after W2 (tokens needed for `bg-primary` class)
* Can run in parallel with W4, W5, W6 (different concerns, minimal file overlap)
* Sequential recommended to avoid conflicts in TopbarV3 and App.tsx

### 7.H — W8: Verification / Regression Gate

**Goal:** Run all automated checks, manual viewport smoke tests, and status/token/micro-text grep verification commands. Confirm dashboard reaches 7/10.

**Requirements:**
* Run `npm run check` in repo root
* Run `cd packages/web-ui/dashboard && npx vitest run` 
* Run all grep verification commands:
  - Micro-text elimination
  - Token centralization
  - Status vocabulary cleanup
  - Hardcoded hex color removal
* Manual viewport smoke test at 1440x900, 1280x800, 1024x768, 768x1024, 430x932, 375x667
* Manual keyboard navigation test
* Manual screen reader test (macOS VoiceOver)
* Confirm 7/10 score by re-evaluating the scorecard categories

**Acceptance Criteria:**
* `npm run check` passes with zero errors, warnings, infos
* All existing vitest tests pass
* All grep commands return expected zero results
* All 6 viewport sizes pass visual smoke test
* Keyboard navigation flows correctly
* Scorecard self-assessment confirms at least 7/10

**Isolation & Parallelism Notes:**
* Must run last — depends on all W1-W7 being complete
* No file edits in this workspace — verification only

## 8. Combined Implementation Order

```text
W1 (Typography + Font) 
  → W2 (Design Tokens)
    → W3 (Surface/Depth/Color)
      → W4 (Status Vocabulary) ∥ W5 (Responsive) ∥ W6 (Accessibility) ∥ W7 (Pi Identity)
        → W8 (Verification Gate)
```

Explanation:
- W1 must run first because the type scale constants inform W2's tokens.ts
- W2 must run before W3 because surface/color tokens depend on the shared module
- W3 must run before W4-W7 because these workspaces use the migrated color classes
- W4, W5, W6, W7 can conceptually run in parallel but share files (App.tsx, TopbarV3.tsx) so sequential execution is safer
- W8 is the final gate

## 9. Definition of Done

P43-2HOTFIX is complete when ALL are true:

* [x] W1: Zero micro-text instances (text-[9px], text-[10px], text-[11px]) remain
* [x] W1: Font declaration fixed (`font-sans` resolves to system font stack)
* [x] W2: All components import from shared tokens.ts; no local token constants remain
* [x] W3: Hardcoded hex colors replaced with theme token classes; cards have shadow depth
* [x] W4: Status vocabulary normalized; all labels use canonical names
* [x] W5: Hamburger menu works on mobile; stat grids responsive
* [x] W6: Focus-visible on all interactive elements; semantic landmarks present; contrast improved
* [x] W7: Pi SVG logo in topbar; primary accent color adopted; empty states have personality
* [x] W8: `npm run check` passes; all tests pass; manual smoke test at 6 viewports passes
* [x] Scorecard self-assessment confirms 7/10 or higher
* [x] No forbidden commands or files were used

## 10. Rollback Playbook

**Trigger conditions:**
* Any workspace causes `npm run check` to fail with no clear fix path
* Color/contrast changes make dashboard worse in dark mode
* Responsive changes break the desktop layout
* Any runtime error prevents dashboard from rendering

**Rollback procedure:**
1. `git revert` the offending workspace commit
2. Re-run `npm run check` to confirm clean state
3. Re-run visual smoke test to confirm pre-change appearance
4. Fix the issue in the workspace and re-apply

Since all workspaces are independently revertible and no data migrations exist, rollback is a simple `git revert`.

## 11. What Next Phase Inherits

A future full-redesign phase (if desired beyond 7/10) inherits:

* Shared design token system (tokens.ts)
* Semantic type scale constants
* Standardized status vocabulary and color map
* claude.css theme adoption (OKLCH colors, shadows, radii)
* Surface depth hierarchy (bg-background → bg-card → shadow-sm → shadow → shadow-md)
* Responsive breakpoint strategy
* Accessibility baseline (focus-visible, headings, landmarks, skip-link)
* Pi brand identity (logomark, accent color)

A future phase may add:

* Full page-level scroll model (remove h-screen/overflow-hidden)
* Animation/motion design language
* Component extraction from App.tsx (WorkerCard, QueueStrip, ExecutionStabilityPanel)
* Legacy Sidebar.tsx deprecation
* Comprehensive visual regression test suite (Playwright screenshots)
* Advanced responsive layout (bottom tab bar for mobile)
* Dark/light mode toggle without needing settings dialog

---

# Part 2 — Agent Brief

## Mission

Implement the P43-2HOTFIX dashboard recovery plan across 8 sequential workspaces. Each workspace addresses one specific category of presentation-layer issues. The agent is authorized to edit dashboard source files (`packages/web-ui/dashboard/src/`) but must NOT modify backend code, API endpoints, data types (except for adding display-only utilities), or the mini-lit package.

The agent must follow the workspace order precisely. Each workspace builds on the previous. After each workspace, the agent must run `npm run check` and fix any errors before proceeding.

## Hard Requirements

1. Do NOT change the AppShell h-screen/overflow-hidden layout model — preserve the current shell structure
2. Do NOT introduce new npm dependencies
3. Do NOT modify backend code or API endpoints
4. Do NOT delete legacy Sidebar.tsx — edit TaskRunSidebar.tsx only
5. Do NOT change WorkerSummary.stage or PlanExecution.status types in types.ts (except for adding comments)
6. Do NOT run `git push`
7. Do NOT use watch-mode commands
8. Run `npm run check` after every workspace and fix all errors before continuing
9. All type-check and biome lint must pass
10. All existing vitest tests must pass

## Execution Policies

This plan uses `executionClass: "implementation"` with `executionAutomation` disabled because it is a manual frontend hotfix, not a kernel repair. The standard v4 execution kernel policies do not apply — this is a simple sequential file-editing plan.

## Safety Stops

Hard stop execution only for:
1. `npm run check` failure that cannot be fixed within the workspace
2. Test failure in vitest suite
3. Visual regression that makes dashboard worse than before
4. Any file edit that causes runtime errors in the browser

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "executionClass": "implementation",
  "phase": "P43-2HOTFIX",
  "title": "Dashboard 7/10 Recovery",
  "legacyCompatibility": {
    "preservesV3Envelope": true,
    "v3RequiredFieldsPresent": true,
    "v4FieldsAreAdditive": true
  },
  "intent": {
    "parallelism": 1,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": { "mode": "local_sandbox" },
    "deadlines": {
      "planOverallTimeoutMs": 7200000
    }
  },
  "derivedExecutionProfile": {
    "executorType": "direct",
    "maxParallelWorkspaces": 1,
    "worktreeRequired": false,
    "integrationQueueRequired": false,
    "patchIsolationRequired": false
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": false,
    "agentMayMutateRepo": true,
    "agentMayRunCommands": true,
    "manualPatchApplicationRequired": false,
    "humanApprovalRequiredForEveryPatch": false
  },
  "scale": {
    "defaultMode": "stable_3",
    "selectedMode": "stable_3",
    "modes": {
      "stable_3": {
        "executor_type": "direct",
        "max_parallel_workspaces": 1,
        "worktree_required": false,
        "integration_queue_required": false,
        "preserve_existing_behavior": true
      }
    }
  },
  "workspaces": [
    {
      "id": "W1",
      "title": "Typography + Font Recovery",
      "goal": "Fix broken font declaration and eliminate micro-typography below 12px",
      "dependencies": [],
      "files": [
        "packages/web-ui/dashboard/src/components/shell/AppShell.tsx",
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/features/proposal-inbox/ProposalInbox.tsx",
        "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
        "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
        "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx",
        "packages/web-ui/dashboard/src/features/observability/TraceTimeline.tsx",
        "packages/web-ui/dashboard/src/features/memory/MemoryCockpit.tsx",
        "packages/web-ui/dashboard/src/features/memory/MemoryCockpitPanel.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/AutonomyCenter.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/AutonomyProposalCard.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/OrchestratorHealthPanel.tsx",
        "packages/web-ui/dashboard/src/features/policy-audit/PolicyAuditCenter.tsx",
        "packages/web-ui/dashboard/src/features/settings/RegistrySettings.tsx",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx"
      ],
      "acceptance": {
        "grepChecks": [
          "grep -rn 'text-\\\\[9px\\\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'text-\\\\[10px\\\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'text-\\\\[11px\\\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq"
        ],
        "commands": ["cd /Users/hootie/src/pi && npm run check"],
        "manual": ["Visual smoke test at 1440x900"]
      }
    },
    {
      "id": "W2",
      "title": "Shared Design Tokens",
      "goal": "Create tokens.ts and migrate all components from local constants to shared imports",
      "dependencies": ["W1"],
      "files": [
        "packages/web-ui/dashboard/src/tokens.ts",
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/shell/AppShell.tsx",
        "packages/web-ui/dashboard/src/components/topbar/TopbarV3.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/TaskRunSidebar.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/BrainNudgeCard.tsx",
        "packages/web-ui/dashboard/src/components/statusbar/StatusBarV3.tsx",
        "packages/web-ui/dashboard/src/components/StatCard.tsx",
        "packages/web-ui/dashboard/src/components/CockpitPanels.tsx",
        "packages/web-ui/dashboard/src/components/StatusBadge.tsx",
        "packages/web-ui/dashboard/src/components/IconBtn.tsx",
        "packages/web-ui/dashboard/src/components/SectionHeader.tsx",
        "packages/web-ui/dashboard/src/components/shell/ContextualRightDrawer.tsx",
        "packages/web-ui/dashboard/src/routes/CockpitTabs.tsx",
        "packages/web-ui/dashboard/src/routes/CenterWorkSurface.tsx",
        "packages/web-ui/dashboard/src/features/proposal-inbox/ProposalInbox.tsx",
        "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
        "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
        "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx",
        "packages/web-ui/dashboard/src/features/memory/MemoryCockpit.tsx",
        "packages/web-ui/dashboard/src/features/memory/MemoryCockpitPanel.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/AutonomyCenter.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/AutonomyProposalCard.tsx",
        "packages/web-ui/dashboard/src/features/autonomy/OrchestratorHealthPanel.tsx",
        "packages/web-ui/dashboard/src/features/policy-audit/PolicyAuditCenter.tsx",
        "packages/web-ui/dashboard/src/features/trust/TrustDashboard.tsx",
        "packages/web-ui/dashboard/src/features/plan-intake/PlanIntakePanel.tsx",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/features/settings/RegistrySettings.tsx"
      ],
      "acceptance": {
        "grepChecks": [
          "grep -rn 'const BG = ' packages/web-ui/dashboard/src/ | grep -v tokens.ts | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'const SURF = ' packages/web-ui/dashboard/src/ | grep -v tokens.ts | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'const BORD = ' packages/web-ui/dashboard/src/ | grep -v tokens.ts | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'const MUT = ' packages/web-ui/dashboard/src/ | grep -v tokens.ts | grep -v node_modules | wc -l | xargs test 0 -eq"
        ],
        "commands": ["cd /Users/hootie/src/pi && npm run check"]
      }
    },
    {
      "id": "W3",
      "title": "Surface / Depth / Color Migration",
      "goal": "Add shadow depth hierarchy and replace hardcoded hex colors with theme token classes",
      "dependencies": ["W2"],
      "files": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/StatCard.tsx",
        "packages/web-ui/dashboard/src/components/CockpitPanels.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/BrainNudgeCard.tsx"
      ],
      "acceptance": {
        "grepChecks": [
          "grep -rn 'bg-\\[#F7F6F3\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'border-\\[#E8E6E1\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq",
          "grep -rn 'bg-\\[#EBF2FF\\]' packages/web-ui/dashboard/src/ | grep -v node_modules | wc -l | xargs test 0 -eq"
        ],
        "commands": ["cd /Users/hootie/src/pi && npm run check"],
        "manual": ["Verify shadows visible on cards at 1440x900", "Verify dark mode surface hierarchy"]
      }
    },
    {
      "id": "W4",
      "title": "Status Vocabulary + Badges",
      "goal": "Standardize status labels across all components and ensure all badges use icon+color",
      "dependencies": ["W2"],
      "files": [
        "packages/web-ui/dashboard/src/utils/status.ts",
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/StatusBadge.tsx",
        "packages/web-ui/dashboard/src/components/topbar/TopbarV3.tsx",
        "packages/web-ui/dashboard/src/components/statusbar/StatusBarV3.tsx"
      ],
      "acceptance": {
        "grepChecks": [
          "grep -rn 'Pending' packages/web-ui/dashboard/src/App.tsx | wc -l | xargs test 0 -eq",
          "grep -rn 'Done' packages/web-ui/dashboard/src/App.tsx | wc -l | xargs test 0 -eq"
        ],
        "commands": ["cd /Users/hootie/src/pi && npm run check"]
      }
    },
    {
      "id": "W5",
      "title": "Responsive Minimum Viability",
      "goal": "Add hamburger menu for mobile sidebar access and responsive stat card grids",
      "dependencies": ["W2"],
      "files": [
        "packages/web-ui/dashboard/src/components/topbar/TopbarV3.tsx",
        "packages/web-ui/dashboard/src/App.tsx"
      ],
      "acceptance": {
        "commands": ["cd /Users/hootie/src/pi && npm run check"],
        "manual": [
          "Hamburger menu visible at viewports < 768px",
          "Sidebar opens/closes on hamburger click on mobile",
          "Stat cards use correct grid columns at 1440, 1024, 768, 430"
        ]
      }
    },
    {
      "id": "W6",
      "title": "Accessibility Recovery",
      "goal": "Add focus-visible, semantic landmarks, heading hierarchy, modal focus trapping, skip-link",
      "dependencies": ["W2"],
      "files": [
        "packages/web-ui/dashboard/src/components/shell/AppShell.tsx",
        "packages/web-ui/dashboard/src/components/IconBtn.tsx",
        "packages/web-ui/dashboard/src/components/topbar/TopbarV3.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/TaskRunSidebar.tsx",
        "packages/web-ui/dashboard/src/components/CockpitPanels.tsx",
        "packages/web-ui/dashboard/src/routes/CockpitTabs.tsx",
        "packages/web-ui/dashboard/src/components/ForceKillDialog.tsx",
        "packages/web-ui/dashboard/src/components/RerunDialog.tsx",
        "packages/web-ui/dashboard/src/components/OpenProjectDialog.tsx",
        "packages/web-ui/dashboard/src/components/PlanUploadDialog.tsx",
        "packages/web-ui/dashboard/src/components/SettingsDialog.tsx"
      ],
      "acceptance": {
        "commands": ["cd /Users/hootie/src/pi && npm run check"],
        "manual": [
          "Tab through dashboard — focus ring visible on every element",
          "Skip link visible on first Tab press",
          "Modal focus traps work",
          "Screen reader announces heading hierarchy"
        ]
      }
    },
    {
      "id": "W7",
      "title": "Pi Identity + Product Feel",
      "goal": "Add Pi SVG logomark, adopt claude.css primary accent color, add personality to empty states",
      "dependencies": ["W2"],
      "files": [
        "packages/web-ui/dashboard/public/pi-logo.svg",
        "packages/web-ui/dashboard/src/components/topbar/TopbarV3.tsx",
        "packages/web-ui/dashboard/src/App.tsx"
      ],
      "acceptance": {
        "commands": ["cd /Users/hootie/src/pi && npm run check"],
        "manual": [
          "Pi SVG logomark visible in topbar",
          "Primary buttons use warm amber accent",
          "Empty states use Pi-voiced copy"
        ]
      }
    },
    {
      "id": "W8",
      "title": "Verification / Regression Gate",
      "goal": "Run all checks, tests, grep verifications, and manual smoke tests. Confirm 7/10.",
      "dependencies": ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
      "files": [],
      "acceptance": {
        "commands": [
          "cd /Users/hootie/src/pi && npm run check",
          "cd /Users/hootie/src/pi/packages/web-ui/dashboard && npx vitest run",
          "cd /Users/hootie/src/pi/packages/web-ui/dashboard/src && grep -rn 'text-[9px]\\|text-[10px]\\|text-[11px]' . 2>/dev/null | grep -v node_modules",
          "cd /Users/hootie/src/pi/packages/web-ui/dashboard/src && grep -rn 'const BG\\|const SURF\\|const BORD\\|const MUT\\|const ACC_BG\\|const ACC_TXT' . 2>/dev/null | grep -v tokens.ts | grep -v node_modules",
          "cd /Users/hootie/src/pi/packages/web-ui/dashboard/src && grep -rn 'Pending\\|Done' App.tsx 2>/dev/null"
        ],
        "manual": [
          "Visual smoke test at 1440x900, 1280x800, 1024x768, 768x1024, 430x932, 375x667",
          "Keyboard tab navigation through entire dashboard",
          "Screen reader test (macOS VoiceOver)",
          "Scorecard self-assessment: confirm >= 7/10"
        ]
      }
    }
  ],
  "hardStops": [
    {
      "id": "check_failure",
      "condition": "npm run check returns non-zero",
      "action": "stop_execution"
    },
    {
      "id": "test_failure",
      "condition": "vitest run returns non-zero",
      "action": "stop_execution"
    },
    {
      "id": "visual_regression",
      "condition": "manual smoke test reveals dashboard worse than before changes",
      "action": "stop_execution"
    }
  ],
  "persistence": {
    "postgresRequired": false,
    "jsonFallbackAllowed": true,
    "note": "This is a frontend-only plan. No PostgreSQL state to persist."
  },
  "executionKernel": {
    "enabled": false,
    "note": "ExecutionKernel is not required — this is a manual sequential workspace plan with no autonomous execution"
  },
  "actorPermissions": {
    "agentMayMutateRepo": true,
    "agentMayRunCommands": true,
    "mayMutateRepository": true,
    "note": "Agent may edit dashboard source files directly"
  },
  "resourceCoordination": {
    "maxParallelWorkspaces": 1,
    "validationLockRequired": false,
    "note": "All workspaces run sequentially to avoid edit conflicts on shared files"
  },
  "deadlineWatchdog": {
    "enabled": true,
    "planOverallTimeoutMs": 7200000,
    "workspaceDefaultTimeoutMs": 1800000
  }
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P43-2HOTFIX",
  "title": "Dashboard 7/10 Recovery",
  "executionClass": "implementation",
  "contractVersion": "4.1.1",
  "status": "planned",
  "workspaceCount": 8,
  "maxParallelWorkspaces": 1,
  "estimatedTotalDurationMinutes": 120,
  "workspaces": [
    {
      "id": "W1",
      "title": "Typography + Font Recovery",
      "estimatedMinutes": 30,
      "fileCount": 15,
      "risk": "medium",
      "verification": "grep + npm run check + visual smoke"
    },
    {
      "id": "W2",
      "title": "Shared Design Tokens",
      "estimatedMinutes": 25,
      "fileCount": 25,
      "risk": "low",
      "verification": "grep + npm run check"
    },
    {
      "id": "W3",
      "title": "Surface / Depth / Color Migration",
      "estimatedMinutes": 15,
      "fileCount": 4,
      "risk": "low",
      "verification": "grep + npm run check + visual smoke"
    },
    {
      "id": "W4",
      "title": "Status Vocabulary + Badges",
      "estimatedMinutes": 15,
      "fileCount": 5,
      "risk": "low",
      "verification": "grep + npm run check"
    },
    {
      "id": "W5",
      "title": "Responsive Minimum Viability",
      "estimatedMinutes": 15,
      "fileCount": 2,
      "risk": "medium",
      "verification": "npm run check + 6-viewport smoke test"
    },
    {
      "id": "W6",
      "title": "Accessibility Recovery",
      "estimatedMinutes": 20,
      "fileCount": 11,
      "risk": "low",
      "verification": "npm run check + keyboard nav test"
    },
    {
      "id": "W7",
      "title": "Pi Identity + Product Feel",
      "estimatedMinutes": 15,
      "fileCount": 3,
      "risk": "low",
      "verification": "npm run check + visual smoke"
    },
    {
      "id": "W8",
      "title": "Verification / Regression Gate",
      "estimatedMinutes": 20,
      "fileCount": 0,
      "risk": "low",
      "verification": "all automated + manual checks"
    }
  ],
  "targetScore": 7,
  "currentScore": 4,
  "biggestRisk": "Layout breakage from text size increase in W1",
  "rollbackStrategy": "Git revert per workspace; each is independently revertible"
}
```

---

## Plan Summary

- **Plan path**: `docs/implementation/P43-2HOTFIX-dashboard-7-10-recovery.md`
- **Number of workspaces**: 8
- **Highest-risk workspace**: W1 (Typography + Font Recovery) — changes 200+ micro-text instances across 15 files; layout breakage risk from larger text
- **Expected score after implementation**: 7/10 minimum, likely 7.5/10
- **Commands future implementation agent should run after each workspace**:
  - `cd /Users/hootie/src/pi && npm run check`
  - Verify workspace-specific grep acceptance checks
- **Commands for final verification**:
  - `cd /Users/hootie/src/pi && npm run check`
  - `cd /Users/hootie/src/pi/packages/web-ui/dashboard && npx vitest run`
  - Micro-text grep: `grep -rn 'text-\[9px\]\|text-\[10px\]\|text-\[11px\]' packages/web-ui/dashboard/src/ | grep -v node_modules`
  - Token grep: `grep -rn 'const BG\|const SURF\|const BORD\|const MUT\|const ACC' packages/web-ui/dashboard/src/ | grep -v tokens.ts | grep -v node_modules`
  - Status grep: `grep -rn 'Pending\|Done' packages/web-ui/dashboard/src/App.tsx`
  - Manual: viewport smoke test at 6 sizes, keyboard tab navigation, screen reader test
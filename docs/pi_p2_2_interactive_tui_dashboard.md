# Phase P2.2 — Interactive TUI Dashboard

**Author:** Pi Development Team  
**Template:** Master Template v2  
**Created:** 2026-05-11  
**Target system:** Pi autonomous coding runtime  
**Goal:** Replace print-loop `pi plan watch` with live TUI dashboard supporting keyboard navigation.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P2.2  
**One-line goal:** Replace scrolling print spam in `pi plan watch` with live TUI dashboard and keyboard navigation.  
**Why now:** P2.1 production hardening complete. Need better observability for real execution.  
**Blast radius:** Only `pi plan watch` command. No state mutation. Observer-only.  
**Rollback path:** Revert commits, fallback to static status display.  
**Done when:** `pi plan watch` displays live TUI, supports worker navigation, filters events, and exits cleanly without affecting execution.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P2.2 |
| Title | Interactive TUI Dashboard |
| Status | Ready |
| Last updated | 2026-05-11 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Observability UX |
| Product-code changes | Allowed (plan-watch only) |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 8.A — TUI Dashboard Core | Pi Worker | User | Reviewer | User |
| 8.B — Worker Navigation | Pi Worker | User | Reviewer | User |
| 8.C — Event Log & Filtering | Pi Worker | User | Reviewer | User |
| 8.D — Selected Worker Detail | Pi Worker | User | Reviewer | User |
| 8.E — Fallback & Testing | Pi Worker | User | Reviewer | User |

---

## 2. Purpose

Replace the scrolling print-loop in `pi plan watch` with a live TUI dashboard that updates in place and supports keyboard navigation.

This phase improves:
- Observability during execution
- User experience for monitoring workers
- Event log filtering and navigation
- Worker detail inspection
- Terminal cleanliness (no scroll spam)

---

## 3. What Carried Over — Must Stay Stable

* [x] Observer-only (no execution control)
* [x] No mutation of .pi/plan-state.json
* [x] No mutation of .pi/execution-journal.ndjson
* [x] Read-only access to runtime state
* [x] Graceful fallback if TUI unavailable
* [x] Exit without affecting execution
* [x] No new dependencies unless already present

---

## 4. Background / What Was Wrong

Current `pi plan watch` implementation:
- Prints status lines in a loop
- Creates scrolling spam
- No worker navigation
- No event filtering
- No detailed worker inspection
- Poor UX for monitoring execution

---

## 5. Current Failure State / Known Blockers

None. P2 core is complete. This is a UX enhancement.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TUI rendering issues | low | low | Fallback to static status |
| Terminal compatibility | low | low | Test on Linux/macOS/Windows |
| Performance with many events | low | low | Implement event pagination |
| Key handling conflicts | low | low | Document shortcuts clearly |

---

## 7. Workstreams

### 8.A — TUI Dashboard Core

**Goal:** Create live TUI dashboard that repaints in place.

**Acceptance criteria:**
- Dashboard renders in place (no scrolling)
- Updates on state/journal changes
- Shows plan summary panel
- Shows worker grid panel
- Shows queue counts panel
- Uses existing TUI utilities from packages/tui
- No new dependencies added
- Graceful fallback to static status if TUI unavailable

**Dependencies:** None

---

### 8.B — Worker Navigation

**Goal:** Support keyboard navigation between workers.

**Acceptance criteria:**
- `1`/`2`/`3` keys select worker 1/2/3
- `tab` cycles between panels
- Selected worker is highlighted in grid
- Navigation state persists across refreshes
- Invalid worker selection is ignored
- Documentation updated with shortcuts

**Dependencies:** 8.A

---

### 8.C — Event Log & Filtering

**Goal:** Display recent events with filtering and scrolling.

**Acceptance criteria:**
- Recent events panel shows latest events
- `j`/`k` or arrow keys scroll event log
- `f` toggles failed/retry event filter
- `r` refreshes dashboard
- Event log is paginated (max 100 visible)
- Filtered events are highlighted
- Event timestamps are relative (e.g., "2m ago")

**Dependencies:** 8.A

---

### 8.D — Selected Worker Detail

**Goal:** Show detailed information for selected worker.

**Acceptance criteria:**
- Selected worker detail panel shows:
  - Workspace ID and title
  - Current stage (pending/active/complete/blocked/failed)
  - Retry count / max retries
  - Assigned worker ID
  - Packet hash if available
  - Latest snapshot path
  - Latest report path
  - Recent worker-specific events (last 10)
- Panel updates when worker selection changes
- Panel shows "No worker selected" when none selected
- Reads from .pi/workspaces/<id>/ metadata if needed

**Dependencies:** 8.B

---

### 8.E — Fallback & Testing

**Goal:** Ensure fallback mode and comprehensive testing.

**Acceptance criteria:**
- Fallback to static status if TUI unavailable
- Tests for render model generation
- Tests for key handling state machine
- Tests for event filtering logic
- Tests for selected worker switching
- Tests for fallback mode activation
- Tests pass in CI
- Documentation updated for `pi plan watch` shortcuts

**Dependencies:** 8.A, 8.B, 8.C, 8.D

---

## 8. Combined Implementation Order

```text
8.A → 8.B → 8.C → 8.D → 8.E
```

All workstreams are sequential to build dashboard incrementally.

---

## 9. Definition of Done

P2.2 is complete when ALL are true:

* `pi plan watch` displays live TUI dashboard
* Dashboard updates in place (no scrolling)
* Worker selection (1/2/3) works
* Tab cycles between panels
* Event log scrolling (j/k/arrows) works
* Event filtering (f) works
* Refresh (r) works
* Selected worker detail panel shows all required info
* Graceful fallback to static status if TUI unavailable
* `q` exits watch without affecting execution
* No write calls to .pi/plan-state.json or .pi/execution-journal.ndjson
* Tests pass for all features
* Documentation updated with shortcuts
* All changes committed (no git push)

---

## 10. Rollback Playbook

**Trigger:** TUI dashboard breaks or causes issues

**Rollback:**
1. Revert all commits from P2.2
2. Restore original `pi plan watch` implementation
3. Test fallback mode works
4. Review issues and fix

**Recovery time:** < 5 minutes

---

# Part 2 — Agent Brief

## Mission

Replace scrolling print spam in `pi plan watch` with live TUI dashboard and keyboard navigation.

You are improving the observability UX for P2 autonomous execution by:
1. Creating live TUI dashboard that repaints in place
2. Adding worker navigation (1/2/3 keys)
3. Adding event log filtering and scrolling
4. Adding selected worker detail panel
5. Ensuring graceful fallback and comprehensive testing

---

## Hard Requirements

1. Observer-only (no execution control)
2. No mutation of .pi/plan-state.json
3. No mutation of .pi/execution-journal.ndjson
4. Read-only access to runtime state
5. Use existing TUI utilities from packages/tui
6. No new dependencies unless already present
7. Graceful fallback if TUI unavailable
8. Exit cleanly without affecting execution
9. Comprehensive tests for all features

---

## Safety Stops

Hard stop only for:
- Attempts to mutate plan-state.json
- Attempts to mutate execution-journal.ndjson
- Attempts to add execution control (pause/continue/retry/kill)
- Attempts to add new dependencies without justification
- Attempts to modify execution logic

---

# Part 3 — Workspace Queue

```json
{
  "phase": "P2.2",
  "title": "Interactive TUI Dashboard",
  "maxParallelWorkspaces": 1,
  "workspaces": [
    {
      "id": "8.A",
      "title": "TUI Dashboard Core",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-watch.ts",
          "packages/coding-agent/src/cli/plan-watch-dashboard.ts"
        ],
        "cannotEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "package.json",
          "package-lock.json"
        ],
        "canRun": ["echo", "ls packages/tui/src/"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "Dashboard renders in place (no scrolling)",
        "Updates on state/journal changes",
        "Shows plan summary panel",
        "Shows worker grid panel",
        "Shows queue counts panel",
        "Uses existing TUI utilities from packages/tui",
        "No new dependencies added",
        "Graceful fallback to static status if TUI unavailable"
      ]
    },
    {
      "id": "8.B",
      "title": "Worker Navigation",
      "dependencies": ["8.A"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-watch-dashboard.ts",
          "docs/p2-user-guide.md"
        ],
        "cannotEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "package.json"
        ],
        "canRun": ["echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "1/2/3 keys select worker 1/2/3",
        "tab cycles between panels",
        "Selected worker is highlighted in grid",
        "Navigation state persists across refreshes",
        "Invalid worker selection is ignored",
        "Documentation updated with shortcuts"
      ]
    },
    {
      "id": "8.C",
      "title": "Event Log & Filtering",
      "dependencies": ["8.A"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-watch-dashboard.ts"
        ],
        "cannotEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "package.json"
        ],
        "canRun": ["echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "Recent events panel shows latest events",
        "j/k or arrow keys scroll event log",
        "f toggles failed/retry event filter",
        "r refreshes dashboard",
        "Event log is paginated (max 100 visible)",
        "Filtered events are highlighted",
        "Event timestamps are relative (e.g., '2m ago')"
      ]
    },
    {
      "id": "8.D",
      "title": "Selected Worker Detail",
      "dependencies": ["8.B"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-watch-dashboard.ts"
        ],
        "cannotEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "package.json"
        ],
        "canRun": ["echo", "ls .pi/workspaces/"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "Selected worker detail panel shows workspace ID and title",
        "Shows current stage (pending/active/complete/blocked/failed)",
        "Shows retry count / max retries",
        "Shows assigned worker ID",
        "Shows packet hash if available",
        "Shows latest snapshot path",
        "Shows latest report path",
        "Shows recent worker-specific events (last 10)",
        "Panel updates when worker selection changes",
        "Panel shows 'No worker selected' when none selected",
        "Reads from .pi/workspaces/{workspaceId}/ metadata if needed"
      ]
    },
    {
      "id": "8.E",
      "title": "Fallback & Testing",
      "dependencies": ["8.A", "8.B", "8.C", "8.D"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-watch-dashboard.ts",
          "packages/coding-agent/test/plan-watch-dashboard.test.ts",
          "docs/p2-user-guide.md"
        ],
        "cannotEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "package.json"
        ],
        "canRun": ["echo", "npx tsx ../../node_modules/vitest/dist/cli.js --run test/plan-watch-dashboard.test.ts"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "Fallback to static status if TUI unavailable",
        "Tests for render model generation",
        "Tests for key handling state machine",
        "Tests for event filtering logic",
        "Tests for selected worker switching",
        "Tests for fallback mode activation",
        "Tests pass in CI",
        "Documentation updated for pi plan watch shortcuts"
      ]
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P2.2",
  "title": "Interactive TUI Dashboard",
  "goal": "Replace scrolling print spam in pi plan watch with live TUI dashboard and keyboard navigation",
  "workersDefault": 1,
  "sameFileParallelism": false,
  "autoCommit": true,
  "autoPush": false,
  "retryPolicy": {
    "testFail": 3,
    "lintFail": 3,
    "typeFail": 3,
    "reviewFix": 3
  },
  "hardStops": [
    "state_mutation",
    "journal_mutation",
    "execution_control",
    "git_push",
    "new_dependencies_without_justification"
  ],
  "safetyLevel": "high",
  "blastRadius": "minimal",
  "rollbackComplexity": "trivial",
  "outputFiles": [
    "packages/coding-agent/src/cli/plan-watch.ts",
    "packages/coding-agent/src/cli/plan-watch-dashboard.ts",
    "packages/coding-agent/test/plan-watch-dashboard.test.ts",
    "docs/p2-user-guide.md"
  ],
  "forbiddenPatterns": [
    ".env*",
    "secrets/**",
    "*.key",
    "*.pem",
    "packages/coding-agent/src/core/plan-state.ts",
    "packages/coding-agent/src/core/autonomous-executor.ts",
    "package.json",
    "package-lock.json"
  ],
  "forbiddenCommands": [
    "git push",
    "npm publish",
    "rm -rf",
    "git reset --hard",
    "git clean -fd"
  ],
  "observerOnly": true,
  "readOnlyState": true,
  "keyboardShortcuts": {
    "1/2/3": "Select worker 1/2/3",
    "tab": "Cycle panels",
    "j/k": "Scroll event log down/up",
    "arrows": "Scroll event log",
    "f": "Toggle failed/retry filter",
    "r": "Refresh dashboard",
    "q": "Exit watch"
  },
  "tuiRequirements": {
    "useExistingUtilities": true,
    "noNewDependencies": true,
    "gracefulFallback": true,
    "inPlaceRendering": true
  }
}
```

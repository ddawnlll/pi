# Phase P10 — Dashboard Redesign (P10R)

**Author:** Pi Development Team
**Template:** LLM Implementation Agent — Master Template v2.4.0
**Created:** 2026-05-15
**Target system:** Pi autonomous coding runtime
**Goal:** Redesign Pi's dashboard for clarity, performance, accessibility, and extensibility, consolidating P6.5 scale views, P7 planning OS surfaces, and P9 remediation dashboards into a cohesive cockpit.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P10
**One-line goal:** Unify all dashboard surfaces (scale, planning, remediation, settings, worker detail) into one coherent, performant, accessible cockpit.
**Why now:** P6.5 added scale dashboard panels, P7 added planner UX, and P9 added remediation audit views. Each added valuable surfaces but the dashboard lacks cohesive IA, suffers from performance fragmentation, and has accessibility gaps.
**Blast radius:** Dashboard routes, components, hooks, settings dialog, worker detail panes, scale visualization, integration queue UX, merge conflict panels.
**Rollback path:** Feature-flag new dashboard surfaces; preserve existing routes under `/legacy` prefix; fall back to `stable_3`.
**Scale mode:** `stable_3` default; `experimental_6` available after readiness pass.
**Safe parallelism target:** 4 requested, minimum 3 safe if readiness passes.
**Done when:** Dashboard surfaces are consolidated, performant, accessible, and dogfood-tested.

## 1. Header

| Field | Value |
|---|---|
| Phase | P10 |
| Title | Dashboard Redesign |
| Status | Planned |
| Last updated | 2026-05-15 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Dashboard IA, performance, accessibility, component consolidation |
| Product-code changes | Forbidden — Pi dashboard/tests/docs only |
| Selected scale mode | `stable_3` for default; `experimental_6` if readiness passes |
| Requested max workers | 4 |
| Expected DAG effective parallelism | 4 |
| Expected safe effective parallelism | 3 |
| Worktree isolation | Required for `experimental_6` |
| Integration queue | Required for `experimental_6` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P10.A — Dashboard Information Architecture Redesign | Pi Worker Agent | User / owner | Reviewer | User |
| P10.B — Settings & Scale Configuration Consolidation | Pi Worker Agent | User / owner | Reviewer | User |
| P10.C — Worker Lifecycle & Detail View Redesign | Pi Worker Agent | User / owner | Reviewer | User |
| P10.D — Dashboard Performance & Data Flow Optimization | Pi Worker Agent | User / owner | Reviewer | User |
| P10.E — Accessibility & Responsive Design | Pi Worker Agent | User / owner | Reviewer | User |
| P10.F — Integration Queue & Merge Conflict UX | Pi Worker Agent | User / owner | Reviewer | User |
| P10.G — Dashboard Design System & Component Refactor | Pi Worker Agent | User / owner | Reviewer | User |
| P10.H — Dogfood and Stability Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P6.5 added scale dashboard panels (worktree status, integration queue, merge conflict, scheduler capacity), P7 added planning OS surfaces (batch preview, critical path, planner suggestions), and P9 added remediation audit views (governance ledger, rollback controls). Each was added as a self-contained surface, resulting in:

- Fragmented navigation: users jump between `/dashboard`, `/scale`, `/planner`, `/remediation` routes
- Inconsistent design: each phase introduced independent component patterns
- Performance debt: multiple data-fetching hooks poll independently
- Accessibility gaps: keyboard navigation, screen reader support, and focus management were not consistently applied

P10 solves this by redesigning the entire dashboard IA: consolidating surfaces, unifying components via a shared design system, optimizing data flow, and baking accessibility into every component.

This phase also updates the settings dialog to surface P6.5/P7/P9 configuration in a single place, and refines worker detail views to show lifecycle state, queue position, and validation status.

---

## 3. What Carried Over — Must Stay Stable

- `stable_3` remains the default.
- `experimental_6` requires worktree isolation.
- `experimental_6` requires integration queue.
- Integration queue stops on merge conflict.
- Merge conflicts must produce handoff artifacts.
- Failed or dirty worktrees must not be silently deleted.
- Dashboard controls must not directly mutate executor state.
- `git push` remains forbidden.
- Raw `rm -rf` remains forbidden.
- Watch-mode validation remains forbidden.
- Completion gate hardening remains active.
- Existing live logs, performance metrics, plan summary, and worker details remain compatible.
- P7 planner output is advisory until human approval.
- P9 governance ledger is append-only and tamper-evident.

---

## 4. Background / What Was Wrong

The dashboard evolved organically across four phases:

- **P6 core**: Basic plan summary, worker list, live logs.
- **P6.5**: Scale dashboard panels — worktree status, integration queue, merge conflict, scheduler capacity, scale mode settings.
- **P7**: Planning OS dashboard — batch preview, critical path, planner suggestions, approval UX.
- **P9**: Remediation dashboard — governance ledger, rollback controls, audit trail, remediation logs.

Each was built with the right priorities for its phase, but the aggregate result is a dashboard with:

1. **Navigation fragmentation** — 7+ top-level routes with no clear hierarchy
2. **Inconsistent design tokens** — independent color palettes, spacing, typography per phase
3. **Data-fetching duplication** — each panel fetches its own data; no shared cache or query deduplication
4. **Accessibility gaps** — keyboard navigation incomplete, screen reader labels missing, focus management weak
5. **No responsive layout** — dashboard assumes desktop width
6. **No design system** — component variants proliferate; no shared primitives

---

## 5. Current Failure State / Known Blockers

- dashboard IA not rationalized
- design tokens inconsistent across phases
- no shared data-fetching layer
- keyboard navigation gaps in worker detail and scale panels
- screen reader support missing in key surfaces
- responsive layout not implemented
- no component inventory or design system audit
- settings dialog does not expose P7 planner controls or P9 remediation policies

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dashboard redesign breaks existing surfaces | med | high | Legacy route prefix, feature flags, phased rollout |
| Performance optimization introduces regressions | med | med | Benchmark suite before and after, gradual data-fetching migration |
| Accessibility changes alter visual layout | low | med | Visual regression tests, pixel-comparison snapshots |
| Design system refactor touches too many files | med | high | Atomic component migration, preserve backwards-compatible exports |
| Settings consolidation misses critical config | low | med | Settings inventory audit before consolidation |

---

## 7. Workstreams

### P10.A — Dashboard Information Architecture Redesign

**Goal:** Rationalize dashboard routes, navigation hierarchy, and information architecture.

**Requirements:**
- Audit all existing dashboard routes and surfaces.
- Design unified navigation with clear hierarchy and grouping.
- Implement new route structure with legacy redirects.
- Ensure URL backward compatibility via redirect map.

**Acceptance Criteria:**
- All existing dashboard surfaces accessible under new IA.
- Legacy routes redirect to new equivalents.
- Navigation clearly distinguishes monitoring, configuration, and audit surfaces.
- No dead links or orphan routes.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_1`.
- Dependencies: `none`.
- Conflict scope: `dashboard/**, web-ui/**`.
- Queue priority: `critical`.

### P10.B — Settings & Scale Configuration Consolidation

**Goal:** Consolidate P6.5 scale settings, P7 planner controls, and P9 remediation policies into a single settings surface.

**Requirements:**
- Inventory all settings keys added in P6.5, P7, P9.
- Design unified settings schema.
- Implement consolidated settings dialog with tabbed layout.
- Wire settings changes to backend config.

**Acceptance Criteria:**
- All P6.5/P7/P9 settings are exposed in a single dialog.
- Settings dialog uses shared design system components.
- Backward-compatible settings migration path.
- Settings changes persist correctly.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_2`.
- Dependencies: `P10.A`.
- Conflict scope: `settings/**, config/**`.
- Queue priority: `critical`.

### P10.C — Worker Lifecycle & Detail View Redesign

**Goal:** Redesign worker detail views to show lifecycle state, queue position, validation status, and remediation history.

**Requirements:**
- Combine P6 worker detail, P6.5 lifecycle tab, P7 approval state, P9 remediation log.
- Design unified worker detail layout with tabbed sections.
- Implement real-time state updates via shared data layer.
- Add keyboard navigation and screen reader support.

**Acceptance Criteria:**
- Worker detail shows lifecycle, queue, validation, and remediation in one view.
- Real-time state updates without polling duplication.
- Keyboard-navigable detail sections.
- Screen reader labels present on all interactive elements.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_2`.
- Dependencies: `P10.A`.
- Conflict scope: `workers/**, web-ui/**`.
- Queue priority: `high`.

### P10.D — Dashboard Performance & Data Flow Optimization

**Goal:** Optimize dashboard data fetching with shared caching, query deduplication, and lazy loading.

**Requirements:**
- Audit all data-fetching hooks across dashboard surfaces.
- Implement shared query cache with deduplication.
- Add lazy loading for off-screen panels.
- Benchmark before and after with metrics.

**Acceptance Criteria:**
- Data-fetching hooks share a common cache layer.
- Off-screen panels lazy-load on scroll or focus.
- Dashboard initial load time improved by at least 40%.
- No duplicate network requests for the same data.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_2`.
- Dependencies: `P10.A`.
- Conflict scope: `hooks/**, dashboard/**, web-ui/**`.
- Queue priority: `high`.

### P10.E — Accessibility & Responsive Design

**Goal:** Make all dashboard surfaces keyboard-navigable, screen-reader compatible, and responsive at tablet/desktop widths.

**Requirements:**
- Audit all dashboard components for WCAG 2.1 AA compliance.
- Implement focus management, aria labels, and keyboard handlers.
- Add responsive layout breakpoints.
- Test with screen reader and keyboard-only navigation.

**Acceptance Criteria:**
- All interactive elements are keyboard accessible.
- Screen reader announces state changes and dynamic content.
- Dashboard layout works at 1024px and above.
- No focus traps or orphaned focus targets.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_3`.
- Dependencies: `P10.B, P10.C`.
- Conflict scope: `web-ui/**, dashboard/**`.
- Queue priority: `high`.

### P10.F — Integration Queue & Merge Conflict UX

**Goal:** Refine integration queue and merge conflict panels with clear state visualization and actionable controls.

**Requirements:**
- Redesign integration queue panel with clear queue position, status, and ETA indicators.
- Enhance merge conflict panel with file-level conflict detail and resolution guidance.
- Add queue priority visualization and reorder controls.
- Wire panels to shared data layer.

**Acceptance Criteria:**
- Queue panel shows position, status, ETA, and priority.
- Merge conflict panel shows file-level conflict breakdown.
- Queue reorder controls are accessible and undoable.
- Panels update in real-time via shared data layer.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_3`.
- Dependencies: `P10.B, P10.C, P10.D`.
- Conflict scope: `queue/**, integration/**`.
- Queue priority: `critical`.

### P10.G — Dashboard Design System & Component Refactor

**Goal:** Extract shared design tokens, component primitives, and layout system from all dashboard surfaces.

**Requirements:**
- Inventory all component variants across P6/P6.5/P7/P9 dashboard surfaces.
- Define shared design tokens (color, spacing, typography, shadow).
- Build component primitives (card, table, panel, badge, status indicator, nav item).
- Migrate dashboard surfaces to use shared primitives.
- Document design system in storybook-style examples.

**Acceptance Criteria:**
- All dashboard surfaces use shared component primitives.
- Design tokens are defined in a single source of truth.
- Component migration does not change visual appearance.
- Design system is documented with usage examples.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_4`.
- Dependencies: `P10.E, P10.F`.
- Conflict scope: `web-ui/**, design-system/**`.
- Queue priority: `normal`.

### P10.H — Dogfood and Stability Report

**Goal:** Dogfood P10 dashboard redesign against real plans and produce stability report.

**Requirements:**
- Run dashboard redesign through P6.x and P7 plan execution.
- Verify all surfaces render correctly with real data.
- Measure performance improvement vs pre-P10 baseline.
- Report accessibility audit results and any regressions.

**Acceptance Criteria:**
- Dogfood run completes without dashboard errors.
- Performance baseline shows measurable improvement.
- Accessibility audit shows no regressions.
- Stability report documents false positives, regressions, and follow-ups.

**Isolation & Parallelism Notes:**
- Expected safe batch: `batch_5`.
- Dependencies: `P10.G`.
- Conflict scope: `reports/**, dogfood/**`.
- Queue priority: `high`.

---

## 8. Combined Implementation Order

```
Batch 1: P10.A
Batch 2: P10.B + P10.C + P10.D
Batch 3: P10.E + P10.F
Batch 4: P10.G
Batch 5: P10.H
```

The graph is foundation-first: IA redesign (A) unblocks settings (B), worker detail (C), and performance work (D). Accessibility (E) and queue UX (F) run in parallel on the next tier. Design system refactor (G) depends on both. Dogfood (H) is last.

---

## 9. Definition of Done

P10 is complete when ALL are true:

- Every workstream acceptance criterion is satisfied.
- Part 3 JSON validates with `pi plan doctor`.
- DAG batch preview has been reviewed.
- Safe batch preview has been reviewed.
- Selected scale mode readiness passes or plan falls back to `stable_3`.
- Queue optimization settings are valid.
- User approval is required before graph mutation or execution.
- Integration queue is clean or intentionally blocked with handoff.
- No forbidden commands or files were used.
- Validation gates passed.
- Dogfood/stability report is attached.

---

## 10. Rollback Playbook

**Trigger conditions:**
- Dashboard redesign breaks existing production surfaces.
- Settings consolidation loses or corrupts configuration.
- Data-fetching optimization introduces stale or incorrect data.
- Accessibility changes alter visual behavior without warning.
- Design system refactor breaks component exports.

**Rollback procedure:**
1. Enable legacy route prefix fallback.
2. Set `dashboardVersion` config to `legacy`.
3. Restore pre-P10 dashboard bundle if needed.
4. Disable consolidated settings and restore per-phase settings.
5. Preserve `.pi/worktrees/{planExecId}/` for debugging.
6. Revert phase commits independently if needed.

---

# Part 2 — Implementation Detail

## Phase-level settings

```yaml
dashboard_redesign:
  enabled: true
  legacy_prefix: /legacy
  design_system_version: v2
  shared_data_layer: true
  accessibility_enabled: true
  performance_benchmark_required: true

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

Hard stop execution for dependency cycles, invalid dependency patches, stale approved graph hash, unsafe scale mode, forbidden file access, secrets access, raw destructive cleanup, `git push`, watch-mode validation, integration merge without validation, integration validation failure, merge conflict without handoff, invalid queue strategy, invalid priority level, or any attempt to bypass executor-mediated state transitions.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.4.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "p10",
      "dashboard-redesign",
      "design-system"
    ]
  },
  "planExecution": {
    "phase": "P10",
    "title": "Dashboard Redesign",
    "mode": "autonomous",
    "maxParallelWorkspaces": 4,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "stable_3",
      "selectedMode": "stable_3",
      "modes": {
        "stable_3": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": false,
          "integrationQueueRequired": false
        },
        "experimental_6": {
          "maxParallelWorkspaces": 6,
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
      "enabledByDefault": false,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": true,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "requireWorkspaceValidationPass": true,
      "requireIntegrationValidationPass": true,
      "gitPushAllowed": false,
      "queuePriority": {
        "enabled": true,
        "defaultLevel": "normal",
        "levels": [
          "critical",
          "high",
          "normal",
          "low"
        ]
      },
      "queueOptimization": {
        "enabled": true,
        "strategy": "critical_path_first",
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
      "enabled": true,
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
      "watch_mode_validation",
      "queue_optimization_invalid_strategy",
      "queue_priority_invalid_level"
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
    "requestedMaxParallelWorkspaces": 4,
    "selectedScaleMode": "stable_3",
    "scaleModeReadiness": {
      "ready": true,
      "blockedReasons": [],
      "warnings": [
        "Preflight review recommended before graph approval."
      ],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": false,
          "met": true,
          "message": "Not required for stable_3."
        },
        {
          "key": "integration_queue",
          "required": false,
          "met": true,
          "message": "Not required for stable_3."
        },
        {
          "key": "validation_lock",
          "required": false,
          "met": true,
          "message": "Not required for stable_3."
        },
        {
          "key": "completion_gate",
          "required": false,
          "met": true,
          "message": "Not required for stable_3."
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
    "batchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P10.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P10.B",
            "P10.C",
            "P10.D"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P10.E",
            "P10.F"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P10.G"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P10.H"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 1.6,
      "criticalPath": [
        "P10.A",
        "P10.C",
        "P10.F",
        "P10.G",
        "P10.H"
      ],
      "criticalPathLength": 5,
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P10.A"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P10.B",
            "P10.C",
            "P10.D"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P10.E",
            "P10.F"
          ],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P10.G"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P10.H"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        }
      ],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [
        "dashboard_rendering_pipeline",
        "design_system_migration_cost"
      ],
      "blockedParallelismReasons": [
        "Safe effective parallelism must be recomputed from repo/file overlap, validation pressure, and conflict history during preflight."
      ]
    },
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
      "queue_reorder_decision_log"
    ]
  },
  "workspaces": [
    {
      "id": "P10.A",
      "title": "Dashboard Information Architecture Redesign",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Foundation workspace with no prerequisites.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "dashboard/**",
          "web-ui/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.A."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "All existing dashboard surfaces accessible under new IA.",
        "Legacy routes redirect to new equivalents.",
        "Navigation clearly distinguishes monitoring, configuration, and audit surfaces.",
        "No dead links or orphan routes."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.B",
      "title": "Settings & Scale Configuration Consolidation",
      "dependencies": [
        "P10.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P10.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "settings/**",
          "config/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.B."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "All P6.5/P7/P9 settings are exposed in a single dialog.",
        "Settings dialog uses shared design system components.",
        "Backward-compatible settings migration path.",
        "Settings changes persist correctly."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.C",
      "title": "Worker Lifecycle & Detail View Redesign",
      "dependencies": [
        "P10.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P10.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "workers/**",
          "web-ui/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.C."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Worker detail shows lifecycle, queue, validation, and remediation in one view.",
        "Real-time state updates without polling duplication.",
        "Keyboard-navigable detail sections.",
        "Screen reader labels present on all interactive elements."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.D",
      "title": "Dashboard Performance & Data Flow Optimization",
      "dependencies": [
        "P10.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P10.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "hooks/**",
          "dashboard/**",
          "web-ui/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.D."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Data-fetching hooks share a common cache layer.",
        "Off-screen panels lazy-load on scroll or focus.",
        "Dashboard initial load time improved by at least 40%.",
        "No duplicate network requests for the same data."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.E",
      "title": "Accessibility & Responsive Design",
      "dependencies": [
        "P10.B",
        "P10.C"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires P10.B (settings) and P10.C (worker detail) outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "web-ui/**",
          "dashboard/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.E."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "All interactive elements are keyboard accessible.",
        "Screen reader announces state changes and dynamic content.",
        "Dashboard layout works at 1024px and above.",
        "No focus traps or orphaned focus targets."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.F",
      "title": "Integration Queue & Merge Conflict UX",
      "dependencies": [
        "P10.B",
        "P10.C",
        "P10.D"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires P10.B, P10.C, P10.D outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "queue/**",
          "integration/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.F."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Prioritized by dependency depth, downstream unblock value, and critical-path impact."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Queue panel shows position, status, ETA, and priority.",
        "Merge conflict panel shows file-level conflict breakdown.",
        "Queue reorder controls are accessible and undoable.",
        "Panels update in real-time via shared data layer."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.G",
      "title": "Dashboard Design System & Component Refactor",
      "dependencies": [
        "P10.E",
        "P10.F"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires P10.E (accessibility) and P10.F (queue UX) outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "web-ui/**",
          "design-system/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.G."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Normal priority because design system refactor is internal and does not block other workstreams."
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
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "All dashboard surfaces use shared component primitives.",
        "Design tokens are defined in a single source of truth.",
        "Component migration does not change visual appearance.",
        "Design system is documented with usage examples."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P10.H",
      "title": "Dogfood and Stability Report",
      "dependencies": [
        "P10.G"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Requires P10.G (design system refactor) outputs before dogfood can begin.",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "reports/**",
          "dogfood/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P10.H."
      },
      "worktree": {
        "required": false,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "High priority because dogfood must validate the integrated dashboard redesign."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "reports/**",
        "dogfood/**"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Dogfood run completes without dashboard errors.",
        "Performance baseline shows measurable improvement.",
        "Accessibility audit shows no regressions.",
        "Stability report documents false positives, regressions, and follow-ups."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "targeted validation commands approved by plan doctor"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "terraform destroy",
          "kubectl delete",
          "git reset --hard",
          "git clean -fd",
          "vitest --watch",
          "jest --watch",
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validated",
          "workspace_queued_for_integration"
        ],
        "logLevel": "info"
      }
    }
  ]
}
```

---

# Part 4 — Wireframe/Mock-up references

*(Wireframes to be added during implementation)*

---

# Part 5 — Testing Strategy

## Unit tests
- Route redirect map resolves correctly for all legacy paths.
- Settings migration handles old config keys gracefully.
- Design system components render with correct tokens.
- Data-fetching cache deduplicates identical requests.

## Integration tests
- Dashboard navigation flow: all surfaces reachable within 3 clicks.
- Settings dialog: all P6.5/P7/P9 settings present and persist.
- Worker detail: all tabs render with correct data.
- Queue panel: state updates correctly via shared data layer.

## Dogfood run
- Execute P10 dashboard redesign against a representative plan (P6.x or P7).
- Verify all surfaces render with real execution data.
- Measure dashboard initial load time before and after.
- Audit keyboard navigation and screen reader support.
- Report any regressions or false positives.

---

# Part 6 — Rollback and Cleanup

| Condition | Action |
|---|---|
| Dashboard surfaces break under new IA | Enable legacy route prefix |
| Settings migration corrupts config | Restore pre-P10 settings backup |
| Performance regression >10% | Disable shared data layer, revert to per-hook fetching |
| Design system refactor breaks exports | Preserve backwards-compatible exports during migration |
| Accessibility audit shows regressions | Revert to pre-P10 components for affected surfaces |

# P7 — Autonomous Planning & Batch Operating System

**Version:** 2.3.1  
**Last Updated:** 2026-05-14  
**Purpose:** Executable implementation plan for Pi using the latest Master Implementation Plan format with PostgreSQL-backed execution, interactive parallelism review, P6 scale-aware isolation, integration queue safety, and queue-aware optimization.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P7`  
**One-line goal:** Transform Pi from manual planner plus execution runtime into a goal-aware planning, DAG optimization, and execution operating system.  
**Why now:** P7 is needed once safe queue execution exists but plan quality, batch efficiency, and bottleneck detection remain manual.  
**Blast radius:** Planner, DAG optimizer, queue feedback, dashboard, dry-run simulation, planner memory, and approval UX.  
**Rollback path:** Disable planner optimization and queue feedback, fall back to the last approved manual DAG, and run in stable_3.  
**Scale mode:** `experimental_6` gated by readiness; fall back to `stable_3` if prerequisites fail.  
**Safe parallelism target:** `3`  
**Done when:** All workstreams are implemented, graph approval is current, safety gates pass, final integration validation is clean, and dogfood evidence is attached.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P7` |
| Title | `Autonomous Planning & Batch Operating System` |
| Status | `Planned` |
| Last updated | `2026-05-14` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Transform Pi from manual planner plus execution runtime into a goal-aware planning, DAG optimization, and execution operating system.` |
| Product-code changes | `Allowed, with safety gates` |
| Selected scale mode | `experimental_6` |
| Requested max workers | `6` |
| Expected DAG effective parallelism | `3+ after preflight` |
| Expected safe effective parallelism | `3` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| `P7.A` — Autonomous planner core | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.B` — DAG optimizer | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.C` — Batch Operating System dashboard | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.D` — Execution simulation and dry-run | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.E` — Planner heuristics and memory | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.F` — Planner and queue feedback loop | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.G` — Human review and approval UX | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P7.H` — P7 dogfood and stability report | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |

---

## 2. Purpose

Transform Pi from manual planner plus execution runtime into a goal-aware planning, DAG optimization, and execution operating system.

This phase converts the provided strategic scope into executable workstreams with explicit dependencies, safety controls, queue priority metadata, and a preflight approval gate. Human-written intent remains authoritative, while Pi computes the approved dependency graph, safe batch preview, critical path, and queue ordering before execution.

P6 scale-aware execution may be used only when worktree isolation, integration queue readiness, validation lock behavior, archive support, and completion gate hardening pass. The executor should prefer safe batch preview over theoretical DAG width when selecting actual worker concurrency.

---

## 3. What Carried Over — Must Stay Stable

* [ ] Human-authored plans remain primary and advisory planning cannot bypass approval.
* [ ] Executor remains the only source of truth for execution state transitions.
* [ ] Integration queue remains enabled for controlled merge behavior.
* [ ] Global validation lock remains active for heavy validation.
* [ ] Completion gate hardening remains active.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.

---

## 4. Background / What Was Wrong

The previous model relied on humans to define workspaces, dependencies, batch boundaries, and expected parallelism. That made the queue safe, but it did not guarantee that the graph was efficient, that bottlenecks were visible, or that unused worker windows were detected.

This phase adds planning intelligence while preserving the safety model. Pi should analyze plans, predict execution behavior, and propose changes, but it must not bypass validation, mutate protected systems without approval, or execute unsafe changes.

---

## 5. Current Failure State / Known Blockers

* planner intelligence = not implemented
* graph optimization = not implemented
* critical-path preview = not implemented
* safe execution forecast = not implemented
* dashboard surfaces = incomplete
* worktree_isolation = must be verified before experimental execution
* integration_queue = must be verified before experimental execution
* scale_mode_readiness = blocked until doctor verifies prerequisites
* safe_effective_parallelism = not computed until preflight

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Planner over-optimizes unsafe graph | med | high | Approval gate; doctor validation; conservative defaults |
| Critical path is computed from stale graph | med | med | Persist approved graph hash; block stale approvals |
| Queue optimization starves low-priority work | low | med | Starvation guard and reorder decision log |
| Validation lock limits throughput | med | med | Safe batch preview and lock-aware scheduling |
| Merge conflict blocks plan | med | med | Conflict handoff artifact and safe queue stop |
| Worktree path escapes `.pi/worktrees` | low | critical | Path scope checks; stop execution on escape |
| Raw destructive cleanup requested | low | critical | Forbidden command policy and scoped cleanup only |

---

## 7. Workstreams

### P7.A — Autonomous planner core

**Goal:** Analyze manually written plans and produce advisory optimization outputs.

**Requirements:**
* Parse plan markdown and machine-readable contract.
* Ingest repo structure, git/conflict history, and queue metrics.
* Produce warnings, suggestions, predicted parallelism, and optimized batch candidates.

**Acceptance Criteria:**
* [ ] Planner emits optimizedBatches, criticalPath, plannerWarnings, plannerSuggestions, and predictedParallelism.
* [ ] Planner never executes code or mutates repo state.
* [ ] Planner output is advisory until human approval.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_1`.
* Dependencies: `none`.
* Conflict scope: `planner/**, plan-parser/**`.
* Queue priority: `critical`.

### P7.B — DAG optimizer

**Goal:** Convert static plans into optimized dependency graphs while preserving safety.

**Requirements:**
* Detect unnecessary serialization and oversized workspaces.
* Suggest dependency flattening only when safe evidence exists.
* Compute conflict-aware schedules and throughput estimates.

**Acceptance Criteria:**
* [ ] Optimizer identifies critical path and bottlenecks.
* [ ] Optimizer proposes workspace splits and dependency reductions with evidence.
* [ ] Dependency changes require approval before becoming executable.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P7.A`.
* Conflict scope: `planner/dag/**, scheduler/**`.
* Queue priority: `critical`.

### P7.C — Batch Operating System dashboard

**Goal:** Expose execution operating-system views for current/next batch, critical path, throughput forecast, and planner suggestions.

**Requirements:**
* Show current batch status, active workers, safe runnable count, and blockers.
* Show next batch prediction and batch lane timeline.
* Display throughput forecast and optimization delta.

**Acceptance Criteria:**
* [ ] Dashboard distinguishes DAG parallelism from safe effective parallelism.
* [ ] Dashboard displays planner suggestions as advisory.
* [ ] Dashboard controls do not directly mutate execution state.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P7.A`.
* Conflict scope: `dashboard/**, ui/**`.
* Queue priority: `high`.

### P7.D — Execution simulation and dry-run

**Goal:** Predict execution characteristics without commands, commits, repo mutation, or queue mutation.

**Requirements:**
* Simulate effective parallelism, worker idle time, validation contention, merge contention, and likely conflicts.
* Guarantee dry-run does not mutate repo, commits, or queue state.
* Persist dry-run artifacts for review.

**Acceptance Criteria:**
* [ ] Dry-run produces forecast artifacts without side effects.
* [ ] Doctor blocks if dry-run attempts forbidden mutations.
* [ ] Simulation can compare manual and optimized DAGs.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P7.A`.
* Conflict scope: `simulation/**, executor/dry-run/**`.
* Queue priority: `high`.

### P7.E — Planner heuristics and memory

**Goal:** Persist planner learning from previous runs while preserving safe advisory behavior.

**Requirements:**
* Track successful batch structures, failed plans, conflict hotspots, validation-heavy paths, expensive tests, and throughput history.
* Use memory to improve future suggestions.
* Keep memory explainable and auditable.

**Acceptance Criteria:**
* [ ] Planner memory persists and can be inspected.
* [ ] Suggestions include evidence from memory when used.
* [ ] Memory does not auto-apply graph changes.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P7.A`.
* Conflict scope: `planner/memory/**, metrics/**`.
* Queue priority: `normal`.

### P7.F — Planner and queue feedback loop

**Goal:** Feed runtime queue observations back into planner scoring and rebatching recommendations.

**Requirements:**
* Translate validation contention, merge conflicts, and throughput changes into planner signals.
* Update conflict risk scores from queue outcomes.
* Generate rebatching recommendations without automatic graph mutation.

**Acceptance Criteria:**
* [ ] Queue feedback updates planner risk models.
* [ ] Rebatching recommendations require approval.
* [ ] Feedback loop does not bypass integration queue safety.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_3`.
* Dependencies: `P7.B, P7.D, P7.E`.
* Conflict scope: `queue/**, planner/feedback/**`.
* Queue priority: `critical`.

### P7.G — Human review and approval UX

**Goal:** Require user approval before graph mutation and make advisory suggestions reviewable.

**Requirements:**
* Support approve/reject/edit flows for reorder, split, merge, dependency reduction, and worker changes.
* Persist approved graph hash and decision log.
* Mark approvals stale when plan or graph changes.

**Acceptance Criteria:**
* [ ] Execution blocks until required approval is current.
* [ ] Rejected suggestions are logged with reason where available.
* [ ] Approval UX never mutates executor state directly.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_4`.
* Dependencies: `P7.B, P7.C, P7.F`.
* Conflict scope: `dashboard/approval/**, executor/approval/**`.
* Queue priority: `critical`.

### P7.H — P7 dogfood and stability report

**Goal:** Dogfood autonomous planning against real P6.x plans and prove throughput improvement safely.

**Requirements:**
* Compare manual DAG vs planner-optimized DAG.
* Measure effective parallelism, utilization, elapsed runtime, merge conflicts, and validation contention.
* Report throughput improvement and unsafe behavior findings.

**Acceptance Criteria:**
* [ ] Dogfood report includes manual vs optimized metrics.
* [ ] Stability report lists false positives, regressions, and follow-ups.
* [ ] P7 is not complete without evidence of safe throughput improvement.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_5`.
* Dependencies: `P7.C, P7.D, P7.F, P7.G`.
* Conflict scope: `reports/**, dogfood/**`.
* Queue priority: `high`.


---

## 8. Combined Implementation Order

```text
Batch 1: P7.A
Batch 2: P7.B + P7.C + P7.D + P7.E
Batch 3: P7.F
Batch 4: P7.G
Batch 5: P7.H
```

The graph is intentionally not a full linear chain. Foundation and safety primitives come first, then dashboard/runtime/read-only surfaces run in parallel where safe. Final dogfood and stability reporting depends on all implementation streams.

---

## 9. Definition of Done

`P7` is complete when ALL are true:

* [ ] Every workstream acceptance criterion is satisfied.
* [ ] Part 3 JSON validates with `pi plan doctor`.
* [ ] DAG batch preview has been reviewed.
* [ ] Safe batch preview has been reviewed.
* [ ] Selected scale mode readiness passes or plan falls back to `stable_3`.
* [ ] Queue optimization settings are valid.
* [ ] User approval is required before graph mutation or execution.
* [ ] Integration queue is clean or intentionally blocked with handoff.
* [ ] No forbidden commands or files were used.
* [ ] Validation gates passed.
* [ ] Dogfood/stability report is attached.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Planner, dashboard, lead-agent, or queue behavior mutates state outside approved executor paths.
* Graph optimization creates unsafe dependency reductions.
* Integration queue merges incorrect or unvalidated diffs.
* Merge conflicts are not detected or no handoff artifact is produced.
* Safe scale mode causes resource exhaustion or state corruption.
* Dashboard or doctor reports misleading readiness.

**Rollback procedure:**
1. Set scale mode to `stable_3`.
2. Set `maxParallelWorkspaces` to `3` or lower.
3. Disable optimization features while preserving read-only diagnostics.
4. Pause or disable integration queue processing.
5. Preserve `.pi/worktrees/{planExecId}/` for debugging.
6. Fall back to last approved graph.
7. Disable targeted validation and use broader validation if needed.
8. Revert phase commits independently if needed.

---

## 11. What Next Phase Inherits

`P8` inherits:

* v2.3.1 execution contract shape.
* Worktree-aware execution metadata.
* Scale-mode-aware validation rules.
* Integration queue requirements.
* Safe effective parallelism review.
* Queue priority and optimization metadata.
* Workspace-level isolation/integration/validation metadata.

---

# Part 2 — Agent Brief

## Mission

Implement `P7` so Pi gains the planned capabilities while preserving executor-mediated safety, approval gates, validation integrity, and queue correctness.

The agent must optimize for safe parallelism, not maximum concurrency. Higher worker counts are allowed only when scale-mode readiness passes and the executor can preserve correctness through worktree isolation, integration queue, validation locks, and completion gates.

## Hard Requirements

1. Implement only the workstreams defined in this plan.
2. Preserve human approval as the gate for execution graph changes.
3. Keep forbidden commands and forbidden file rules active.
4. Do not exceed selected scale-mode worker cap.
5. Do not run more than 3 workers unless worktree isolation and integration queue readiness pass.
6. Do not merge workspace output without passed workspace validation.
7. Do not mark a plan complete if integration validation fails.
8. Do not treat merge conflict as ordinary worker failure.
9. Do not start the next plan while integration queue state is dirty.
10. Do not run watch-mode validation.
11. Do not run `git push`.
12. Do not run raw destructive cleanup commands.
13. Do not access secrets or forbidden files.
14. The executor remains the only component that mutates execution state.
15. Queue optimization must not bypass safety checks.

## Execution Policies

```yaml
scale:
  default_mode: stable_3
  selected_mode: experimental_6
  max_parallel_workspaces: 6
  fallback_mode: stable_3

worktree:
  enabled_by_default: true
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
  default_strategy: critical_path_first
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

Hard stop execution for dependency cycles, invalid dependency patches, stale approved graph hash, unsafe scale mode, forbidden file access, secrets access, raw destructive cleanup, `git push`, watch-mode validation, integration merge without validation, integration validation failure, merge conflict without handoff, invalid queue strategy, invalid priority level, or any attempt to bypass executor-mediated state transitions.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.3.1",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "autonomous-planning",
      "batch-operating-system"
    ]
  },
  "planExecution": {
    "phase": "P7",
    "title": "Autonomous Planning & Batch Operating System",
    "mode": "autonomous",
    "maxParallelWorkspaces": 6,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "stable_3",
      "selectedMode": "experimental_6",
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
      "enabledByDefault": true,
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
    "requestedMaxParallelWorkspaces": 6,
    "selectedScaleMode": "experimental_6",
    "scaleModeReadiness": {
      "ready": false,
      "blockedReasons": [
        "Must verify worktree isolation, integration queue, validation lock, archive support, and completion gate hardening before execution."
      ],
      "warnings": [
        "Preflight review required before graph approval."
      ],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": false,
          "message": "Required for experimental_6."
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": false,
          "message": "Required for experimental_6."
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": false,
          "message": "Required for experimental_6."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": false,
          "message": "Required for experimental_6."
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
            "P7.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P7.B",
            "P7.C",
            "P7.D",
            "P7.E"
          ],
          "effectiveParallelism": 4
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P7.F"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P7.G"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P7.H"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 1.6,
      "criticalPath": [
        "P7.A",
        "P7.B",
        "P7.F",
        "P7.G",
        "P7.H"
      ],
      "criticalPathLength": 5,
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P7.A"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P7.B",
            "P7.C",
            "P7.D",
            "P7.E"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P7.F"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P7.G"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P7.H"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        }
      ],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [
        "validation_lock_limits_parallelism",
        "integration_queue_serializes_merges"
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
      "id": "P7.A",
      "title": "Autonomous planner core",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Foundation workspace with no prerequisites.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "planner/**",
          "plan-parser/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.A."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Planner emits optimizedBatches, criticalPath, plannerWarnings, plannerSuggestions, and predictedParallelism.",
        "Planner never executes code or mutates repo state.",
        "Planner output is advisory until human approval."
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
      "id": "P7.B",
      "title": "DAG optimizer",
      "dependencies": [
        "P7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P7.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "planner/dag/**",
          "scheduler/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.B."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Optimizer identifies critical path and bottlenecks.",
        "Optimizer proposes workspace splits and dependency reductions with evidence.",
        "Dependency changes require approval before becoming executable."
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
      "id": "P7.C",
      "title": "Batch Operating System dashboard",
      "dependencies": [
        "P7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P7.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "dashboard/**",
          "ui/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.C."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Dashboard distinguishes DAG parallelism from safe effective parallelism.",
        "Dashboard displays planner suggestions as advisory.",
        "Dashboard controls do not directly mutate execution state."
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
      "id": "P7.D",
      "title": "Execution simulation and dry-run",
      "dependencies": [
        "P7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P7.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "simulation/**",
          "executor/dry-run/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.D."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Dry-run produces forecast artifacts without side effects.",
        "Doctor blocks if dry-run attempts forbidden mutations.",
        "Simulation can compare manual and optimized DAGs."
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
      "id": "P7.E",
      "title": "Planner heuristics and memory",
      "dependencies": [
        "P7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P7.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "planner/memory/**",
          "metrics/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.E."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
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
        "Planner memory persists and can be inspected.",
        "Suggestions include evidence from memory when used.",
        "Memory does not auto-apply graph changes."
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
      "id": "P7.F",
      "title": "Planner and queue feedback loop",
      "dependencies": [
        "P7.B",
        "P7.D",
        "P7.E"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires P7.B, P7.D, P7.E outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "queue/**",
          "planner/feedback/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.F."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Queue feedback updates planner risk models.",
        "Rebatching recommendations require approval.",
        "Feedback loop does not bypass integration queue safety."
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
      "id": "P7.G",
      "title": "Human review and approval UX",
      "dependencies": [
        "P7.B",
        "P7.C",
        "P7.F"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires P7.B, P7.C, P7.F outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "dashboard/approval/**",
          "executor/approval/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.G."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Execution blocks until required approval is current.",
        "Rejected suggestions are logged with reason where available.",
        "Approval UX never mutates executor state directly."
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
      "id": "P7.H",
      "title": "P7 dogfood and stability report",
      "dependencies": [
        "P7.C",
        "P7.D",
        "P7.F",
        "P7.G"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Requires P7.C, P7.D, P7.F, P7.G outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "reports/**",
          "dogfood/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P7.H."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
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
        "Dogfood report includes manual vs optimized metrics.",
        "Stability report lists false positives, regressions, and follow-ups.",
        "P7 is not complete without evidence of safe throughput improvement."
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

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.3.1",
  "phase": "P7",
  "title": "Autonomous Planning & Batch Operating System",
  "primaryGoal": "Transform Pi from manual planner plus execution runtime into a goal-aware planning, DAG optimization, and execution operating system.",
  "projectName": "pi",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "critical_path_first",
  "safeEffectiveParallelismTarget": 3,
  "notInScope": [
    "Autonomous code execution outside the queue",
    "Bypassing validation",
    "Automatic graph mutation without approval",
    "Production deployment automation"
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
    "scale_mode_approval_stale",
    "worktree_required_for_requested_parallelism",
    "watch_mode_validation",
    "queue_optimization_invalid_strategy",
    "queue_priority_invalid_level"
  ],
  "completionGate": "All workspaces satisfy acceptance criteria, validation passes, graph approval is current, and final integration is clean.",
  "nextPhase": "P8"
}
```

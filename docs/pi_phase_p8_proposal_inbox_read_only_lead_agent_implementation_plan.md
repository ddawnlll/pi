# P8 — Proposal Inbox & Read-Only Lead Agent

**Version:** 2.3.1  
**Last Updated:** 2026-05-14  
**Purpose:** Executable implementation plan for Pi using the latest Master Implementation Plan format with PostgreSQL-backed execution, interactive parallelism review, P6 scale-aware isolation, integration queue safety, and queue-aware optimization.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P8`  
**One-line goal:** Add a persistent read-only lead agent that continuously analyzes the project and proposes improvements without directly modifying the system.  
**Why now:** P8 is needed after P7 because planning intelligence can now optimize approved work, while the next step is persistent engineering awareness that remains safely read-only.  
**Blast radius:** Lead-agent runtime, proposal inbox, repo scanner, proposal scoring, plan drafting, self-modification firewall, dashboard, and dogfood reporting.  
**Rollback path:** Disable lead-agent runtime and proposal drafting, keep stored proposals read-only, and fall back to user-driven planning only.  
**Scale mode:** `experimental_6` gated by readiness; fall back to `stable_3` if prerequisites fail.  
**Safe parallelism target:** `3`  
**Done when:** All workstreams are implemented, graph approval is current, safety gates pass, final integration validation is clean, and dogfood evidence is attached.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P8` |
| Title | `Proposal Inbox & Read-Only Lead Agent` |
| Status | `Planned` |
| Last updated | `2026-05-14` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Add a persistent read-only lead agent that continuously analyzes the project and proposes improvements without directly modifying the system.` |
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
| `P8.A` — Read-only lead agent runtime | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.B` — Proposal inbox | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.C` — Repo scanning and analysis | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.D` — Bug, risk, and improvement detection | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.E` — Semi-autonomous plan drafting | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.F` — Self-modification firewall | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.G` — Lead agent dashboard | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |
| `P8.H` — P8 dogfood and stability report | Implementation agent | Human reviewer | Planner/queue owner | Project stakeholders |

---

## 2. Purpose

Add a persistent read-only lead agent that continuously analyzes the project and proposes improvements without directly modifying the system.

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

### P8.A — Read-only lead agent runtime

**Goal:** Create a persistent read-only analysis agent that observes without modifying system state.

**Requirements:**
* Scan repo, plans, queue metrics, run history, test failures, conflict history, and dashboard metrics.
* Enforce read-only mode by default.
* Expose runtime health without executor mutation.

**Acceptance Criteria:**
* [ ] Lead agent can observe configured sources.
* [ ] Lead agent cannot edit code, execute plans, modify queue, apply patches, or commit changes.
* [ ] Attempts to mutate state are blocked and logged.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_1`.
* Dependencies: `none`.
* Conflict scope: `lead-agent/runtime/**, policy/**`.
* Queue priority: `critical`.

### P8.B — Proposal inbox

**Goal:** Create a safe holding area for autonomous suggestions.

**Requirements:**
* Support proposal lifecycle: proposal, review, approval/reject, optional plan draft, queue.
* Store risk, confidence, evidence, and approval requirement.
* Provide reviewable proposal records.

**Acceptance Criteria:**
* [ ] Proposal inbox persists proposal state and evidence.
* [ ] Approvals and rejections are auditable.
* [ ] No proposal becomes an execution plan without approval.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P8.A`.
* Conflict scope: `proposals/**, dashboard/proposals/**`.
* Queue priority: `critical`.

### P8.C — Repo scanning and analysis

**Goal:** Continuously analyze repository health in read-only mode.

**Requirements:**
* Analyze hot files, conflict-heavy files, test instability, validation slowness, dead code, duplicate logic, serialization bottlenecks, and worker underutilization.
* Use bounded scanning to avoid resource abuse.
* Record evidence snapshots.

**Acceptance Criteria:**
* [ ] Scanner produces repo health signals.
* [ ] Scanner never mutates repo or queue state.
* [ ] Scanner output links evidence to proposals.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_2`.
* Dependencies: `P8.A`.
* Conflict scope: `scanner/**, analysis/**`.
* Queue priority: `high`.

### P8.D — Bug, risk, and improvement detection

**Goal:** Turn repository analysis into actionable insights with risk and confidence scoring.

**Requirements:**
* Categorize bug candidates, performance issues, refactor opportunities, dashboard UX issues, conflict hotspots, queue inefficiencies, test coverage gaps, and validation bottlenecks.
* Attach evidence, confidence, risk, and requiresApproval to each proposal.
* Avoid unsafe recommendations.

**Acceptance Criteria:**
* [ ] Each proposal includes risk, confidence, evidence, and requiresApproval.
* [ ] False-positive handling is tracked.
* [ ] Unsafe suggestions are flagged and cannot proceed.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_3`.
* Dependencies: `P8.B, P8.C`.
* Conflict scope: `detectors/**, proposals/scoring/**`.
* Queue priority: `high`.

### P8.E — Semi-autonomous plan drafting

**Goal:** Allow the lead agent to draft plans after approval, then pass them through planner optimization and queue review.

**Requirements:**
* Draft implementation plans only after proposal approval.
* Route drafts through P7 planner optimization and approval flow.
* Prevent direct execution from drafted plans.

**Acceptance Criteria:**
* [ ] Approved proposals can produce draft plans.
* [ ] Draft plans remain non-executable until normal plan approval gates pass.
* [ ] Lead agent cannot enqueue or execute its own drafts.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_4`.
* Dependencies: `P8.B, P8.D`.
* Conflict scope: `plan-drafting/**, planner/**`.
* Queue priority: `high`.

### P8.F — Self-modification firewall

**Goal:** Protect planner, executor, validator, queue controls, policy engine, safety rules, and lead-agent runtime from unsafe self-modification.

**Requirements:**
* Require explicit self-modification approval for protected systems.
* Differentiate normal approval from self-modification approval.
* Sandbox lead agent in read-only mode.

**Acceptance Criteria:**
* [ ] Protected systems are declared and enforced.
* [ ] Self-modifying proposals require explicit approval beyond normal approval.
* [ ] No autonomous execution can modify protected systems.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_4`.
* Dependencies: `P8.A, P8.B, P8.E`.
* Conflict scope: `policy/firewall/**, protected-systems/**`.
* Queue priority: `critical`.

### P8.G — Lead agent dashboard

**Goal:** Visualize autonomous engineering suggestions safely.

**Requirements:**
* Show proposal inbox, risk levels, confidence levels, evidence, recommended plans, repo health, hot conflict files, queue health, and validation hotspots.
* Keep dashboard actions approval-mediated.
* Separate read-only observations from executable actions.

**Acceptance Criteria:**
* [ ] Dashboard displays proposal evidence and status.
* [ ] Dashboard cannot directly mutate protected systems or queue state.
* [ ] Dashboard makes approval requirements clear.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_4`.
* Dependencies: `P8.B, P8.C, P8.D`.
* Conflict scope: `dashboard/lead-agent/**, dashboard/proposals/**`.
* Queue priority: `normal`.

### P8.H — P8 dogfood and stability report

**Goal:** Validate that autonomous suggestions remain safe and useful.

**Requirements:**
* Measure proposal quality, false positive rate, unsafe suggestion rate, planner usefulness, and repo health detection quality.
* Run dogfood in read-only mode.
* Publish stability report with recommendations.

**Acceptance Criteria:**
* [ ] Dogfood report includes quality and safety metrics.
* [ ] Unsafe autonomous behavior count is zero for completion.
* [ ] Follow-up work is documented.

**Isolation & Parallelism Notes:**
* Expected safe batch: `batch_5`.
* Dependencies: `P8.D, P8.E, P8.F, P8.G`.
* Conflict scope: `reports/**, dogfood/**`.
* Queue priority: `high`.


---

## 8. Combined Implementation Order

```text
Batch 1: P8.A
Batch 2: P8.B + P8.C
Batch 3: P8.D
Batch 4: P8.E + P8.F + P8.G
Batch 5: P8.H
```

The graph is intentionally not a full linear chain. Foundation and safety primitives come first, then dashboard/runtime/read-only surfaces run in parallel where safe. Final dogfood and stability reporting depends on all implementation streams.

---

## 9. Definition of Done

`P8` is complete when ALL are true:

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

`No next phase declared` inherits:

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

Implement `P8` so Pi gains the planned capabilities while preserving executor-mediated safety, approval gates, validation integrity, and queue correctness.

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
      "proposal-inbox"
    ]
  },
  "planExecution": {
    "phase": "P8",
    "title": "Proposal Inbox & Read-Only Lead Agent",
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
            "P8.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P8.B",
            "P8.C"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P8.D"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P8.E",
            "P8.F",
            "P8.G"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P8.H"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 1.6,
      "criticalPath": [
        "P8.A",
        "P8.B",
        "P8.D",
        "P8.F",
        "P8.H"
      ],
      "criticalPathLength": 5,
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P8.A"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P8.B",
            "P8.C"
          ],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P8.D"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P8.E",
            "P8.F",
            "P8.G"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P8.H"
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
      "id": "P8.A",
      "title": "Read-only lead agent runtime",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Foundation workspace with no prerequisites.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "lead-agent/runtime/**",
          "policy/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.A."
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
        "Lead agent can observe configured sources.",
        "Lead agent cannot edit code, execute plans, modify queue, apply patches, or commit changes.",
        "Attempts to mutate state are blocked and logged."
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
      "id": "P8.B",
      "title": "Proposal inbox",
      "dependencies": [
        "P8.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P8.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "proposals/**",
          "dashboard/proposals/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.B."
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
        "Proposal inbox persists proposal state and evidence.",
        "Approvals and rejections are auditable.",
        "No proposal becomes an execution plan without approval."
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
      "id": "P8.C",
      "title": "Repo scanning and analysis",
      "dependencies": [
        "P8.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires P8.A outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "scanner/**",
          "analysis/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.C."
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
        "Scanner produces repo health signals.",
        "Scanner never mutates repo or queue state.",
        "Scanner output links evidence to proposals."
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
      "id": "P8.D",
      "title": "Bug, risk, and improvement detection",
      "dependencies": [
        "P8.B",
        "P8.C"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires P8.B, P8.C outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "detectors/**",
          "proposals/scoring/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.D."
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
        "Each proposal includes risk, confidence, evidence, and requiresApproval.",
        "False-positive handling is tracked.",
        "Unsafe suggestions are flagged and cannot proceed."
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
      "id": "P8.E",
      "title": "Semi-autonomous plan drafting",
      "dependencies": [
        "P8.B",
        "P8.D"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires P8.B, P8.D outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "plan-drafting/**",
          "planner/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.E."
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
        "Approved proposals can produce draft plans.",
        "Draft plans remain non-executable until normal plan approval gates pass.",
        "Lead agent cannot enqueue or execute its own drafts."
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
      "id": "P8.F",
      "title": "Self-modification firewall",
      "dependencies": [
        "P8.A",
        "P8.B",
        "P8.E"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires P8.A, P8.B, P8.E outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "policy/firewall/**",
          "protected-systems/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.F."
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
        "Protected systems are declared and enforced.",
        "Self-modifying proposals require explicit approval beyond normal approval.",
        "No autonomous execution can modify protected systems."
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
      "id": "P8.G",
      "title": "Lead agent dashboard",
      "dependencies": [
        "P8.B",
        "P8.C",
        "P8.D"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires P8.B, P8.C, P8.D outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "dashboard/lead-agent/**",
          "dashboard/proposals/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.G."
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
        "Dashboard displays proposal evidence and status.",
        "Dashboard cannot directly mutate protected systems or queue state.",
        "Dashboard makes approval requirements clear."
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
      "id": "P8.H",
      "title": "P8 dogfood and stability report",
      "dependencies": [
        "P8.D",
        "P8.E",
        "P8.F",
        "P8.G"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Requires P8.D, P8.E, P8.F, P8.G outputs before implementation can begin.",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "reports/**",
          "dogfood/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with same-batch workspaces after preflight confirms no file or validation-lock overlap for P8.H."
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
        "Dogfood report includes quality and safety metrics.",
        "Unsafe autonomous behavior count is zero for completion.",
        "Follow-up work is documented."
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
  "phase": "P8",
  "title": "Proposal Inbox & Read-Only Lead Agent",
  "primaryGoal": "Add a persistent read-only lead agent that continuously analyzes the project and proposes improvements without directly modifying the system.",
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
    "Autonomous code modification",
    "Autonomous execution",
    "Bypassing proposal approval",
    "Changing protected systems without explicit self-modification approval"
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
  "nextPhase": null
}
```

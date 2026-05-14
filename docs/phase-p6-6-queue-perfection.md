# Phase P6.6 — Queue Perfection: Critical Path, Priorities & Throughput Optimization

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.2.0 compatible  
**Created:** 2026-05-14  
**Target system:** Pi autonomous coding runtime  
**Goal:** Upgrade the integration queue from safe FIFO merge processor into an orchestration-aware queue with metrics, critical-path scoring, optimizer suggestions, safe queue controls, and dashboard bottleneck visibility.

---

## Overview

P6 made parallel execution safer through worktree isolation, integration queue, merge conflict handoff, validation gates, and dashboard visibility. P6.5 improves the dashboard and experimental six-worker visibility. P6.6 focuses specifically on making the queue smarter.

The current queue is good at serial integration safety. It processes one entry at a time, blocks on validation failure, stops on merge conflict, persists state, and exposes queue state to the dashboard. The next step is to add orchestration intelligence: priority, critical path, unlock impact, validation cost, conflict risk, queue timing metrics, and safe reorder suggestions.

This plan intentionally uses `contractVersion: "2.2.0"` so the current validator can parse it. The master template revision to v2.3.1 is included as workstream 6.6.A rather than used as this plan's contract version.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P6.6  
**One-line goal:** Turn the integration queue into a critical-path-aware orchestration queue.  
**Why now:** The queue is safe, but still mostly FIFO. Before P7 governance/policy/approval layers, the queue should understand bottlenecks, priorities, and throughput optimization.  
**Blast radius:** Integration queue, integration branch metrics, queue optimizer, scale routes, dashboard queue panel, new queue optimization panel, tests, master template docs.  
**Rollback path:** Keep existing FIFO behavior as fallback; queue optimizer suggestions stay advisory; disable reorder controls if safety checks fail.  
**Scale mode:** `stable_3` for implementation; can be dogfooded under `experimental_6` after P6.5 readiness passes.  
**Safe parallelism target:** Keep implementation at 3 workers; optimize queue throughput rather than raw worker count.  
**Done when:** Queue computes metrics and scoring, dashboard shows bottlenecks, optimizer produces safe suggestions, controls are executor-mediated, and dogfood report proves behavior.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P6.6 |
| Title | Queue Perfection: Critical Path, Priorities & Throughput Optimization |
| Status | Planned |
| Last updated | 2026-05-14 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Queue optimization and orchestration intelligence |
| Product-code changes | Forbidden — Pi runtime/dashboard/tests/docs only |
| Selected scale mode | `stable_3` for implementation |
| Requested max workers | 3 |
| Expected effective parallelism | 3 |
| Worktree isolation | Optional for implementation; preserved for dogfood |
| Integration queue | Required |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 6.6.A — Master template v2.3.1 queue metadata revision | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.B — Queue metrics schema and persistence | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.C — Priority and critical-path scoring | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.D — Queue optimizer and reorder suggestions | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.E1 — Dashboard queue optimization shell | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.E2 — Dashboard queue metrics and optimizer wiring | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.F — Executor-mediated queue control actions | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.G1 — Queue optimization dogfood harness scaffold | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.G2 — Actual queue optimization dogfood | Pi Worker Agent | User / owner | Reviewer | User |
| 6.6.H — Queue perfection stability report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P6.6 upgrades the queue from a safety mechanism into an optimization layer.

Today the integration queue is strong at one-at-a-time merging, validation blocking, conflict stopping, persistent state, and dashboard display. That is enough for safe integration, but not enough for production-grade orchestration. The queue should be able to answer:

```text
Which queued entry should go first?
Which workspace is on the critical path?
Which workspace unlocks the most downstream work?
Why are workers idle?
Which dependency creates a serialized tail?
Would reordering improve throughput?
Can a reorder be safely applied without violating dependencies?
```

P6.6 introduces queue metrics, priority scoring, critical path ranking, unlock impact, validation cost, conflict risk, queue optimizer suggestions, and dashboard bottleneck visualization.

---

## 3. What Carried Over — Must Stay Stable

* [x] Existing FIFO queue behavior remains the fallback.
* [x] Integration queue still processes one merge at a time.
* [x] Validation failure still blocks the queue.
* [x] Merge conflict still produces handoff artifacts.
* [x] Blocked/conflict entries are not bypassed.
* [x] Dashboard controls remain executor/backend mediated.
* [x] `git push` remains forbidden.
* [x] Raw `rm -rf` remains forbidden.
* [x] Watch-mode validation remains forbidden.
* [x] Existing P6/P6.5 dashboard visibility remains compatible.
* [x] Existing integration queue state files remain readable.

---

## 4. Background / What Was Wrong

The current integration queue is safe but not yet intelligent. It finds the next queued entry in order and processes it. This is correct for deterministic merging, but it cannot optimize for critical path, unlock impact, validation contention, or queue wait time.

The dashboard shows queue state, counts, conflicts, and validation status, but does not yet show critical path, queue utilization, idle worker windows, queue wait time, merge duration, validation duration, or reorder suggestions.

P6.6 keeps queue safety and adds orchestration intelligence without letting dashboard directly mutate execution state.

---

## 5. Current Failure State / Known Blockers

* `queue_metrics` = incomplete
* `critical_path_scoring` = missing
* `unlock_impact_scoring` = missing
* `validation_cost_estimation` = missing
* `conflict_risk_estimation` = missing
* `queue_optimizer_suggestions` = missing
* `safe_queue_reorder_controls` = missing
* `dashboard_bottleneck_visualization` = incomplete
* `master_template_queue_metadata` = missing

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Optimizer suggests unsafe reorder | med | high | Reorder suggestions must be dependency-checked and advisory unless executor approves |
| Queue controls bypass validation | low | critical | Backend rejects any reorder that bypasses validation or conflict handling |
| Dashboard appears to mutate queue directly | med | med | Dashboard only requests actions; backend/executor validates |
| Metrics break old queue state files | med | high | Add backward-compatible optional fields |
| Critical path scoring is misleading | med | med | Surface as heuristic with explanation, not absolute truth |
| Reorder controls hide blocked/conflict entries | low | high | Blocked/conflict entries cannot be moved ahead unsafely |
| Dogfood changes runtime source files | low | med | Dogfood workspace restricted to tests/docs |

---

## 7. Workstreams

### 6.6.A — Master template v2.3.1 queue metadata revision

**Goal:** Add queue optimization metadata to the master template vocabulary.

**Requirements:**
* Add optional workspace-level queue metadata: priority, criticalPathRank, unlockImpact, validationCost, conflictRisk, reorderable, reorderConstraints.
* Add queueOptimization guidance to parallelism review.
* Add validation rules for safe reordering.
* Preserve v2.3.0 scale/worktree/integration semantics.

**Acceptance Criteria:**
* Master template documents queue metadata fields.
* Template adds queue priority, critical path rank, unlock impact, validation cost, conflict risk, and reorder constraints.
* Template adds queue optimization metadata to parallelism review guidance.
* Template keeps v2.3.0 scale/worktree/integration semantics intact.

**Parallelism Notes:**
* Runs first.
* Documentation-only but foundational.

---

### 6.6.B — Queue metrics schema and persistence

**Goal:** Persist timing and throughput metrics for queue entries.

**Requirements:**
* Track queue wait time, merge duration, validation duration, blocked duration, retry count, and conflict occurrence.
* Preserve backward compatibility with existing `.pi/integration-queue.json`.

**Acceptance Criteria:**
* Queue entries record timing metrics where possible.
* Queue state persists timing metrics across restart.
* Metrics do not break existing queue state files.
* Existing integration queue tests continue to pass.

**Parallelism Notes:**
* Depends on 6.6.A.
* Can run in parallel with 6.6.C.

---

### 6.6.C — Priority and critical-path scoring

**Goal:** Add deterministic queue scoring utilities.

**Requirements:**
* Compute criticalPathRank and unlockImpact.
* Estimate validationCost and conflictRisk.
* Keep scoring deterministic.
* Avoid mutating queue order in this workstream.

**Acceptance Criteria:**
* Queue computes criticalPathRank.
* Queue computes unlockImpact.
* Queue estimates validationCost.
* Queue estimates conflictRisk.
* Scoring is deterministic for the same graph and metadata.

**Parallelism Notes:**
* Depends on 6.6.A.
* Can run in parallel with 6.6.B.

---

### 6.6.D — Queue optimizer and reorder suggestions

**Goal:** Generate safe reorder suggestions for independent queued entries.

**Requirements:**
* Suggest reordering independent queued entries.
* Explain why the reorder helps.
* Estimate throughput impact.
* Reject dependency-violating suggestions.
* Never suggest bypassing validation or conflict resolution.
* Keep suggestions advisory unless backend/executor applies them.

**Acceptance Criteria:**
* Optimizer suggests reordering independent queued entries.
* Optimizer never suggests dependency-violating reorders.
* Optimizer never bypasses validation or conflict resolution.
* Suggestions include explanation and expected throughput impact.
* Blocked/conflict entries are not moved ahead unsafely.

**Parallelism Notes:**
* Depends on 6.6.B and 6.6.C.
* Can run in parallel with 6.6.E.

---

### 6.6.E1 — Dashboard queue optimization shell

**Goal:** Create the QueueOptimizationPanel shell and dashboard placement before real metrics wiring exists.

**Scope:**
* Add QueueOptimizationPanel shell.
* Add empty/loading/error states.
* Add layout for critical path, serialized tail, utilization, queue timing metrics, and suggestions.
* Do not require real backend metrics wiring here.

**Allowed Files:**
* `packages/web-ui/dashboard/src/components/QueueOptimizationPanel.tsx`
* `packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx`
* `packages/web-ui/dashboard/src/hooks/useScaleStatus.ts`

**Acceptance Criteria:**
* QueueOptimizationPanel renders with empty/loading/error states.
* Existing IntegrationQueuePanel still works.
* No backend metrics required.
* Build/typecheck passes.

**Parallelism Notes:**
* Depends on 6.6.A.
* Can run in parallel with 6.6.B, 6.6.C, and 6.6.G1.

---

### 6.6.E2 — Dashboard queue metrics and optimizer wiring

**Goal:** Wire dashboard to real queue metrics and optimizer suggestions.

**Scope:**
* Show critical path.
* Show serialized tail.
* Show queue wait time.
* Show merge duration.
* Show validation duration.
* Show blocked duration.
* Show reorder suggestions as suggestions only.
* Distinguish DAG width, requested worker cap, safe runnable workers, and actual utilization.

**Acceptance Criteria:**
* Dashboard shows queue timing metrics when available.
* Dashboard shows critical path and serialized tail.
* Dashboard shows optimizer suggestions as advisory only.
* Build/typecheck passes.

**Parallelism Notes:**
* Depends on 6.6.B and 6.6.C and 6.6.E1.
* Can run in parallel with 6.6.D.

---

### 6.6.F — Executor-mediated queue control actions

**Goal:** Add safe queue controls without letting UI bypass safety.

**Requirements:**
* Add backend/executor-mediated queue actions: pause, resume, retry, requeue, clear completed, reorder queued entries.
* Reorder must validate dependency safety, no validation bypass, no conflict bypass, and no blocked entry bypass.
* Control actions should be auditable.

**Acceptance Criteria:**
* Queue supports safe pause/resume/retry/requeue/clear-completed where appropriate.
* Queued entries can be reordered only when dependencies allow it.
* Dashboard requests controls but executor/backend validates them.
* Unsafe queue actions are rejected with actionable errors.
* Control actions are auditable.

**Parallelism Notes:**
* Depends on 6.6.D and 6.6.E2.
* Can run in parallel with 6.6.G1.

---

### 6.6.G1 — Queue optimization dogfood harness scaffold

**Goal:** Prepare dogfood fixture and report template early.

**Scope:**
* Create test scaffold.
* Create report template.
* Add FIFO baseline vs optimized checklist.
* Do not require actual optimizer implementation.

**Allowed Files:**
* `packages/coding-agent/test/p66-queue-optimization-dogfood.test.ts`
* `docs/pi/stability/p6-6-queue-perfection-report.md`

**Acceptance Criteria:**
* Dogfood test scaffold exists.
* Report template exists.
* FIFO/optimized comparison checklist exists.
* No runtime source files edited.

**Parallelism Notes:**
* Depends on 6.6.A.
* Can run in parallel with 6.6.B, 6.6.C, and 6.6.E1.

---

### 6.6.G2 — Actual queue optimization dogfood

**Goal:** Run/validate FIFO vs optimized queue behavior after optimizer and dashboard wiring exist.

**Scope:**
* Run dogfood comparing FIFO baseline with optimized suggestions.
* Record throughput, worker utilization, queue wait time, validation contention, conflict rate, and elapsed duration.
* If optimizer cannot improve throughput, explain why.

**Acceptance Criteria:**
* Dogfood compares FIFO baseline with optimized suggestions.
* Dogfood records throughput, worker utilization, queue wait time, validation contention, conflict rate, and elapsed duration.
* If optimizer cannot improve throughput, it explains why.
* No runtime source files are changed by this workspace.

**Parallelism Notes:**
* Depends on 6.6.D, 6.6.E2, and 6.6.G1.
* Runs solo.

---

### 6.6.H — Queue perfection stability report

**Goal:** Publish final P6.6 readiness report.

**Requirements:**
* Publish `docs/pi/stability/p6-6-queue-perfection-report.md`.
* Answer whether queue can optimize throughput, explain bottlenecks, safely reorder, detect critical path, reduce idle windows, and support P7.

**Acceptance Criteria:**
* Report answers whether queue can optimize throughput.
* Report answers whether queue can explain bottlenecks.
* Report answers whether queue can safely reorder.
* Report lists remaining P7 prerequisites.
* Report confirms no safety regressions.

**Parallelism Notes:**
* Runs last.
* Depends on implementation and dogfood evidence.
* Depends on 6.6.F and 6.6.G2.

---

## 8. Combined Implementation Order

```text
Batch 1:
6.6.A

Batch 2:
6.6.B + 6.6.C + 6.6.E1 + 6.6.G1

Batch 3:
6.6.D + 6.6.E2 + 6.6.F

Batch 4:
6.6.G2

Batch 5:
6.6.H
```

Rationale:
* 6.6.A defines the master template queue metadata vocabulary first.
* Batch 2 runs the parallelizable shell work (metrics, scoring, dashboard shell, dogfood scaffold) simultaneously.
* Batch 3 runs optimizer, real dashboard wiring, and executor controls after metrics/scoring exist.
* 6.6.G2 runs solo in Batch 4 after optimizer and dashboard wiring are complete.
* 6.6.H remains final because it summarizes implementation and dogfood evidence.

The main implementation phase (batches 2-3) is now 3-4 wide instead of 2-wide, improving DAG width. The remaining serialized tail (6.6.G2, 6.6.H) is intentional — G2 must run after optimizer/dashboard wiring, and H must remain final because it summarizes dogfood results.

---

## 9. Definition of Done

P6.6 is complete when ALL are true:

* [ ] Master template queue metadata revision exists.
* [ ] Queue computes critical-path ranking.
* [ ] Queue computes unlock impact.
* [ ] Queue estimates conflict risk.
* [ ] Queue estimates validation cost.
* [ ] Queue metrics persist across restart.
* [ ] Dashboard visualizes critical path.
* [ ] Dashboard visualizes serialized tail.
* [ ] Dashboard visualizes worker utilization.
* [ ] Queue optimizer suggestions exist.
* [ ] Queue can safely reorder independent queued entries.
* [ ] Queue never violates DAG dependencies.
* [ ] Queue never bypasses validation.
* [ ] Queue never bypasses conflict handling.
* [ ] Queue never performs forbidden commands.
* [ ] Queue optimization dogfood completed.
* [ ] Stability report published.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Queue optimizer suggests unsafe reorder.
* Reorder controls bypass dependency safety.
* Dashboard controls mutate queue directly without backend validation.
* Existing FIFO queue behavior regresses.
* Existing integration queue state files become unreadable.
* Validation or merge conflict blocking behavior regresses.

**Rollback procedure:**
1. Disable queue optimizer suggestions.
2. Disable queue reorder controls.
3. Keep queue metrics read-only if safe.
4. Fall back to existing FIFO queue processing.
5. Preserve queue state files for debugging.
6. Re-run integration queue tests.
7. Document rollback reason in P6.6 report.

---

## 11. What P7 Inherits

P7 inherits queue metadata vocabulary, critical path and unlock impact scoring, queue metrics, bottleneck visualization, safe reorder suggestions, executor-mediated queue controls, and dogfood evidence for queue optimization.

P7 may add policy engine v2, approval workflows, enterprise governance, audit systems, release orchestration, remote execution, and autonomous planning.

---

# Part 2 — Agent Brief

## Mission

Implement P6.6 Queue Perfection.

Upgrade the integration queue from safe FIFO merge processor into an orchestration-aware queue. Add metrics, critical-path scoring, unlock impact, validation-cost/conflict-risk estimation, optimizer suggestions, dashboard bottleneck visualization, safe queue controls, dogfood, and stability report.

Do not bypass existing queue safety. Optimizer suggestions are advisory unless executor/backend validates and applies them.

---

## Hard Requirements

1. Existing FIFO queue behavior remains fallback.
2. Queue must never violate dependency graph.
3. Queue must never bypass validation.
4. Queue must never bypass merge conflict resolution.
5. Dashboard must not directly mutate queue state.
6. Queue controls must be backend/executor mediated.
7. Blocked/conflict entries must not be moved ahead unsafely.
8. Existing queue state files must remain readable.
9. `git push` remains forbidden.
10. Raw `rm -rf` remains forbidden.
11. Watch-mode validation remains forbidden.
12. Dogfood workspace must not edit runtime source files.

---

## Execution Policies

```yaml
default_workers: 3
hard_cap_workers: 3
same_file_parallelism: false
auto_commit: true
auto_push: false
preflight_required: true
interactive_dependency_review: true
show_effective_parallelism: true
show_batch_preview: true
allow_dependency_editing: true
persist_approved_graph: true

queue_perfection:
  fifo_fallback_required: true
  optimizer_suggestions_advisory: true
  executor_mediated_controls: true
  dependency_safe_reorder_only: true
  validation_bypass_forbidden: true
  conflict_bypass_forbidden: true
```

---

## Safety Stops

Hard stop execution only for dependency cycles, invalid dependency patches, required preflight review not approved, queue reorder dependency violation, queue reorder bypasses validation, queue reorder bypasses conflict resolution, dashboard direct queue mutation, forbidden command usage, forbidden file access, and secrets access.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.2.0",
  "executionBackend": "json",
  "project": {
    "name": "pi-mono",
    "rootPath": "/Users/hootie/src/pi",
    "type": "repo",
    "tags": [
      "p6.6",
      "queue-perfection"
    ]
  },
  "planExecution": {
    "phase": "P6.6",
    "title": "Queue Perfection: Critical Path, Priorities & Throughput Optimization",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "json",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "interactiveParallelismReview": {
      "enabled": true,
      "preflightRequired": true,
      "approvalRequiredBeforeRun": true,
      "allowDependencyEditing": true,
      "showEffectiveParallelism": true,
      "showBatchPreview": true,
      "showCriticalPath": true,
      "warnWhenEffectiveParallelismBelowRequested": true,
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
      "queue_reorder_dependency_violation",
      "queue_reorder_bypasses_validation",
      "queue_reorder_bypasses_conflict_resolution"
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
    "expectedEffectiveParallelismMin": 3,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "batchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "6.6.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "6.6.B",
            "6.6.C",
            "6.6.E1",
            "6.6.G1"
          ],
          "effectiveParallelism": 4
        },
        {
          "batch": 3,
          "workspaceIds": [
            "6.6.D",
            "6.6.E2",
            "6.6.F"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 4,
          "workspaceIds": [
            "6.6.G2"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 5,
          "workspaceIds": [
            "6.6.H"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 2.2,
      "criticalPath": [
        "6.6.A",
        "6.6.B",
        "6.6.D",
        "6.6.F",
        "6.6.H"
      ],
      "criticalPathLength": 5,
      "serializedTailLength": 2
    },
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "long_serialized_tail"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "critical_path",
      "approved_dependency_patch"
    ]
  },
  "workspaces": [
    {
      "id": "6.6.A",
      "title": "Master template v2.3.1 queue metadata revision",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Queue metadata vocabulary must be defined first.",
      "allowedFiles": [
        "docs/llm-implementation-agent-master-template.md",
        "docs/templates/llm-implementation-agent-master-template-v2.3.1.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Template documents queue priority metadata",
        "Template adds queueOptimization guidance",
        "Template keeps v2.3.0 scale/worktree/integration semantics intact"
      ],
      "targetCommand": "npm run typecheck",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "docs/llm-implementation-agent-master-template.md",
          "docs/templates/llm-implementation-agent-master-template-v2.3.1.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.B",
      "title": "Queue metrics schema and persistence",
      "dependencies": [
        "6.6.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Metrics schema depends on the queue metadata vocabulary.",
      "allowedFiles": [
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/coding-agent/src/integration/integration-branch.ts",
        "packages/coding-agent/test/integration-queue.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Queue entries record timing metrics",
        "Queue state persists metrics across restart",
        "Existing state files remain readable"
      ],
      "targetCommand": "npm run typecheck && npm test -- integration-queue",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/coding-agent/src/integration/integration-branch.ts",
          "packages/coding-agent/test/integration-queue.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.C",
      "title": "Priority and critical-path scoring",
      "dependencies": [
        "6.6.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Scoring depends on the queue metadata vocabulary.",
      "allowedFiles": [
        "packages/coding-agent/src/integration/queue-priority.ts",
        "packages/coding-agent/src/integration/queue-optimizer.ts",
        "packages/coding-agent/test/queue-priority.test.ts",
        "packages/coding-agent/test/queue-optimizer.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Computes criticalPathRank",
        "Computes unlockImpact",
        "Estimates validationCost and conflictRisk",
        "Scoring is deterministic"
      ],
      "targetCommand": "npm run typecheck && npm test -- queue-priority queue-optimizer",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/queue-priority.ts",
          "packages/coding-agent/src/integration/queue-optimizer.ts",
          "packages/coding-agent/test/queue-priority.test.ts",
          "packages/coding-agent/test/queue-optimizer.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.D",
      "title": "Queue optimizer and reorder suggestions",
      "dependencies": [
        "6.6.B",
        "6.6.C"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Optimizer needs metrics and scoring.",
      "allowedFiles": [
        "packages/coding-agent/src/integration/queue-optimizer.ts",
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/coding-agent/test/queue-optimizer.test.ts",
        "packages/coding-agent/test/integration-queue.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Suggests safe reorderings",
        "Never violates dependencies",
        "Never bypasses validation or conflict resolution",
        "Explains throughput impact"
      ],
      "targetCommand": "npm run typecheck && npm test -- queue-optimizer integration-queue",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/queue-optimizer.ts",
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/coding-agent/test/queue-optimizer.test.ts",
          "packages/coding-agent/test/integration-queue.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.E1",
      "title": "Dashboard queue optimization shell",
      "dependencies": [
        "6.6.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Dashboard shell depends on queue metadata vocabulary.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/QueueOptimizationPanel.tsx",
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "QueueOptimizationPanel renders with empty/loading/error states",
        "Existing IntegrationQueuePanel still works",
        "No backend metrics required",
        "Build/typecheck passes"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/QueueOptimizationPanel.tsx",
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.E2",
      "title": "Dashboard queue metrics and optimizer wiring",
      "dependencies": [
        "6.6.B",
        "6.6.C",
        "6.6.E1"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Dashboard wiring needs metrics, scoring, and shell.",
      "allowedFiles": [
        "packages/web-server/src/scale-routes.ts",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/web-ui/dashboard/src/components/QueueOptimizationPanel.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Shows DAG width, worker cap, safe runnable workers, actual utilization",
        "Shows critical path and serialized tail",
        "Shows queue timing metrics when available",
        "Shows optimizer suggestions as advisory only",
        "Build/typecheck passes"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/scale-routes.ts",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/components/QueueOptimizationPanel.tsx"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.F",
      "title": "Executor-mediated queue control actions",
      "dependencies": [
        "6.6.D",
        "6.6.E2"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Controls require optimizer safety rules and dashboard visibility.",
      "allowedFiles": [
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/web-server/src/scale-routes.ts",
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/coding-agent/test/integration-queue.test.ts",
        "packages/web-server/test/scale-routes.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Supports safe pause/resume/retry/requeue/clear-completed",
        "Reorders only when dependencies allow",
        "Unsafe actions rejected with actionable errors",
        "Actions are auditable"
      ],
      "targetCommand": "npm run typecheck && npm test -- integration-queue scale-routes",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/web-server/src/scale-routes.ts",
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/coding-agent/test/integration-queue.test.ts",
          "packages/web-server/test/scale-routes.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.G1",
      "title": "Queue optimization dogfood harness scaffold",
      "dependencies": [
        "6.6.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Dogfood scaffold depends on queue metadata vocabulary.",
      "allowedFiles": [
        "packages/coding-agent/test/p66-queue-optimization-dogfood.test.ts",
        "docs/pi/stability/p6-6-queue-perfection-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Dogfood test scaffold exists",
        "Report template exists",
        "FIFO/optimized comparison checklist exists",
        "No runtime source files edited"
      ],
      "targetCommand": "npm run typecheck",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p66-queue-optimization-dogfood.test.ts",
          "docs/pi/stability/p6-6-queue-perfection-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.G2",
      "title": "Actual queue optimization dogfood",
      "dependencies": [
        "6.6.D",
        "6.6.E2",
        "6.6.G1"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Dogfood needs optimizer, dashboard wiring, and scaffold.",
      "allowedFiles": [
        "packages/coding-agent/test/p66-queue-optimization-dogfood.test.ts",
        "docs/pi/stability/p6-6-queue-perfection-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Compares FIFO baseline with optimized suggestions",
        "Records throughput, worker utilization, queue wait time, validation contention, conflict rate, and elapsed duration",
        "Explains if improvement is impossible",
        "No runtime source files changed by this workspace"
      ],
      "targetCommand": "npm run typecheck && npm test -- p66-queue-optimization-dogfood",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p66-queue-optimization-dogfood.test.ts",
          "docs/pi/stability/p6-6-queue-perfection-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
      "id": "6.6.H",
      "title": "Queue perfection stability report",
      "dependencies": [
        "6.6.F",
        "6.6.G2"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Final report needs implementation and dogfood evidence.",
      "allowedFiles": [
        "docs/pi/stability/p6-6-queue-perfection-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Report answers whether queue optimizes throughput",
        "Report answers whether queue explains bottlenecks",
        "Report confirms no safety regressions",
        "Report lists P7 prerequisites"
      ],
      "targetCommand": "npm run typecheck",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "docs/pi/stability/p6-6-queue-perfection-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
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
  "contractVersion": "2.2.0",
  "phase": "P6.6",
  "title": "Queue Perfection: Critical Path, Priorities & Throughput Optimization",
  "primaryGoal": "Upgrade the integration queue into an orchestration-aware queue with metrics, critical path scoring, optimizer suggestions, safe controls, dashboard bottleneck visualization, and dogfood evidence.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "notInScope": [
    "P7 governance implementation",
    "Remote execution",
    "Release orchestration",
    "Autonomous planning"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "unapproved_parallelism_review",
    "invalid_dependency_patch",
    "queue_reorder_dependency_violation",
    "queue_reorder_bypasses_validation",
    "queue_reorder_bypasses_conflict_resolution"
  ],
  "completionGate": "Queue computes metrics and critical-path scores, produces safe reorder suggestions, exposes bottlenecks in dashboard, supports executor-mediated safe queue controls, and dogfoods optimized queue behavior.",
  "nextPhase": "P7"
}
```

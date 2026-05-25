# LLM Implementation Agent — Repair & Execution Correctness Template v3.0

**Version:** 3.0.0  
**Last Updated:** 2026-05-25  
**Purpose:** Canonical template for creating repair-first execution correctness plans for Pi. This template is used when the autonomous execution substrate is untrusted and plans must be manually gated and promotion-gated before restoration of autonomous execution. v3.0 plans support manual repair, assisted repair, and staged promotion back to stable automation. Autonomous execution MUST NOT run when `executionAutomation.autonomousExecutionEnabled` is false.

---

## Overview

This template provides a structured format for **repair and execution correctness plans** that can be:

1. **Read by humans** for reasoning, risk assessment, dependency review, rollback analysis, and decision-making.
2. **Parsed by Pi** for machine-readable execution contract validation, but NOT for autonomous execution unless explicitly enabled.
3. **Previewed interactively** before execution so authors can see the dependency graph, repair order, and promotion readiness.
4. **Executed via manual, assisted, or staged autonomous modes** depending on the promotion ladder position.
5. **Promoted from manual_0 through stable_6** as the execution substrate is repaired and validated.

**Plans using this template MUST NOT be executed autonomously when `executionAutomation.autonomousExecutionEnabled` is false.**

v3.0 supports three execution classes:
- **Repair plans**: executionClass="repair" — manual-first, autonomous execution disabled until promotion gates pass.
- **Verification plans**: executionClass="verification" — for validating that repairs are effective.
- **Implementation plans**: executionClass="implementation" — normal autonomous plans after promotion to stable.

For repair plans, autonomous execution is disabled by default. The workflow is: **analyze -> propose patch -> human review -> manual apply -> targeted validation -> checkpoint -> next patch**. No `pi plan run` or autonomous mode is permitted until promotion gates pass.

The template balances human authority in Markdown with machine-readable validation in the JSON execution contract. Part 3 JSON is the authoritative execution contract. In repair mode it is a **validation contract only** — it describes what the repair plan expects but does not authorize autonomous mutation.

---

## What Changed in v2.5.0

v2.5.0 makes **continuous (batchless) scheduling** the default execution mode. The scheduler no longer waits for entire batches to complete before starting new workspaces.

Key changes:
- **Continuous scheduling**: All 6 worktree slots filled immediately at plan start. Each workspace completion triggers immediate slot refill with the highest-priority ready workspace.
- **No batch barrier**: Workspaces from different topological batches run simultaneously. Batch previews are advisory/display only.
- **Critical-path priority**: Bottleneck nodes (high downstream blocking count) are scheduled before leaf nodes.
- **Worktree pool**: 6 prewarmed slots at plan start. Workspaces acquire/release leases instead of creating worktrees on the hot path.
- **GlobalReadyQueue**: Batch-barrier-free ready queue with priority sort.
- **Priority scorer**: `criticalPathRemaining * 100 + downstreamBlockingCount * 20 + ageBoost * 5 - conflictRiskPenalty`.
- Added `planExecution.scheduling.continuous` field (default: `true`).
- Added `planExecution.worktree.prewarmCount` (default: `6`).
- Updated `contractVersion` to `2.5.0`.

---

## What Changed in v2.5.1

v2.5.1 adds **worktree state persistence and crash recovery** support. When worktree isolation mode is enabled, worktree state is persisted to `.pi/worktree-state.json` so it can be recovered after a server crash.

Key changes:
- **Worktree state persistence**: WorktreeManager persists worktree states to `.pi/worktree-state.json` after each state change.
- **Crash recovery reconciliation**: On server restart, `resumeStrandedExecutions()` loads persisted worktree state and reconciles orphaned worktrees.
- **Orphan detection**: If a worktree exists on disk but its workspace is no longer in the execution queue, it's logged as orphaned and skipped during recovery.
- **Diff preservation**: Worktree diff artifacts are saved to `.pi/executions/{planExecId}/worktrees/{wsId}.patch` before stopping, surviving worktree cleanup.
- The ` recuperación` process filters out already-completed workspaces to avoid re-execution.
- Added worktree reconciliation logging: number of worktrees loaded, orphaned worktree IDs.

---

## What Changed in v2.6.0

v2.6.0 adds **Git serialization, lease hardening, and execution correctness** support. This update promotes `experimental_6` to `stable_6` by centralizing all Git operations through GitRunner, adding a continuous lease watchdog, backpressure-aware validation scheduling, empirical writeSet drift detection, and a dynamic integration queue merge-priority scorer.

Key changes:
- **GitRunner**: Centralized Git operation layer. All `execAsync('git ...')` calls migrated to GitRunner with read-only, per-worktree, and repo-wide mutation scope classification. Mutex serialization prevents Git lock corruption under concurrent worker load.
- **Lease Monitor**: Continuous background watchdog (30s interval) detects stale leases (heartbeat > 45s old, PID dead) and quarantines them automatically without a server restart. Heartbeat files written every 15s. Reconciliation precedence: lease file = ground truth for "was running", worktree state = ground truth for "what's on disk".
- **Merge-Priority Scorer**: Dynamic score computed at dequeue time: `downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10`. Static queuePriority acts as band multiplier (critical × 2.0, high × 1.5, normal × 1.0, low × 0.5). FIFO tiebreaker.
- **Validation Lane Backpressure**: Tracks heavy validation (max 1 concurrent) and targeted validation (max 3 concurrent) lane usage. Scheduler pre-filter defers heavy-validation workspaces when the heavy slot is saturated.
- **writeSet Drift Detection**: Post-execution `git diff --name-only <base> HEAD` captures empirical writeSets. Compared against declared `conflictScope`. Drift threshold (default: 3 files) triggers `warn_and_flag_integration` (default) or `block_integration` (opt-in). Drift reports persisted as artifacts.
- Added `leaseMonitor`, `validationLane`, `mergePriorityScorer` sections to Part 3 JSON.
- Added `validation` profile fields (`canRunTargetedOnly`, `estimatedHeavyValidationSeconds`).
- Added `conflictScope.driftDetection` with `driftThresholdFiles` and `onDriftDetected`.
- Added integration runtime fields: `downstreamReadyCount`, `criticalPathPosition`, `driftFlagged`, `requiresHumanReview`.
- Added new persisted artifacts: `empirical_write_set`, `write_set_drift_report`, `lease_heartbeat_snapshots`, `lease_reconciliation_log`, `merge_priority_score_log`, `validation_lane_saturation_log`.
- Added new doctor warnings (7): `lease_monitor_disabled_with_worktree_enabled`, `write_set_drift_detected_in_prior_run`, `validation_lane_saturated_blocking_scheduler`, `integration_queue_merge_priority_stale`, `lease_reconciliation_disagreement_detected`, `empirical_write_set_diverges_from_declared`.
- Added new hard stops (2): `integration_merge_with_unresolved_write_set_drift_in_block_mode`, `lease_reconciliation_disagreement_without_quarantine`.
- Added validation rules 55-62.
- Updated `contractVersion` to `2.6.0`.

---

## What Changed in v3.0.0

v3.0.0 is a **major semantic migration** from "autonomous implementation plan template" to **"repair/recovery/execution-correctness template"**. This version assumes the autonomous execution substrate is NOT trusted and must be repaired first.

Key changes:

- **Repair-first execution semantics**: Plans default to `executionClass: "repair"`, not `"implementation"`. The template is designed for repairing the execution system itself.
- **Autonomous execution disabled by default for repair plans**: `executionAutomation.autonomousExecutionEnabled: false`. No `pi plan run` or autonomous scheduler may execute repair workspaces before promotion.
- **Agent repo mutation disabled by default**: `executionAutomation.agentMayMutateRepo: false`. The agent is an advisor/reviewer/patch author, not an autonomous executor.
- **Manual patch application and human approval required for every patch**: `manualPatchApplicationRequired: true`, `humanApprovalRequiredForEveryPatch: true`.
- **Promotion ladder**: `manual_0 -> manual_1 -> assisted_1 -> stable_1 -> stable_3 -> stable_6 -> scale_8`. Each step requires passing corresponding promotion gates.
- **Bounded liveness contract**: No indefinite waits. LLM provider calls require request timeout and stream idle watchdog. Validation commands require timeout, process tree kill, output cap, and CI env. Git lock bypass is forbidden. State writes must be serialized.
- **LLM runtime timeout contract**: `providerRequestTimeoutMs`, `streamIdleTimeoutMs`, `workspaceOverallTimeoutMs`, circuit breaker with configurable cooldown.
- **Managed validation runtime contract**: `managedRunnerRequired`, `processGroupRequired`, `killTreeOnTimeout`, `maxOutputBytes`, forbidden interactive commands, separate heavy/targeted lanes.
- **Known broken subsystem registry**: Lists known broken subsystems (e.g., `executor_singleton_race`, `abort_signal_not_wired`, `worktree_mutex_bypass`, `validation_process_hang`, `json_state_store_concurrent_writes`) with severity, blocking status, and required fix gates.
- **Promotion gates and dogfood matrix**: 8 promotion gates (executor isolation, abort signal, validation hang kill, git serialization stress, state store concurrency, crash recovery, stable_3 dogfood, stable_6 stress) with status tracking per gate.
- **No-autonomous-mutation hard stops**: 20 new hard stops preventing autonomous execution during repair mode, missing timeouts, validation without process tree kills, git lock bypass, state store write without serialization, missing rollback/validation/approval on repair workspaces, and promotion gate failures.
- **contractVersion** updated to `3.0.0`.
- **Scale mode defaults** changed for repair: `scheduling.continuous: false`, `scheduling.slotCount: 1`, `schedulerRuntimeUse: "disabled_until_promotion"`.
- **Execution policies** restructured with `repair_modes`, `execution_automation`, and `bounded_liveness` sections.
- **Parser priority** updated: repair-mode safety validation and known broken subsystem gate take precedence before execution gate.

## What Changed in v2.4.0

v2.4.0 adds **plan-intake auto-analysis and DAG optimizer** support. Plans uploaded to Pi are now automatically analyzed: DAG recomputed, bottlenecks detected, optimization proposals generated, and graph diffs presented for approval before execution. Authored batch previews become advisory; the computed and approved graph is authoritative.

This version also adds the `planIntake` and `optimizer` sections to Part 3 JSON, defining:

- Auto-normalize, auto-doctor, auto-DAG-analysis, auto-optimization-proposal settings
- Optimizer objectives (maximize safe parallelism, minimize critical path, etc.)
- Allowed and forbidden auto-patches
- Approval gates before applying optimization patches or executing
- Workspace-split and workspace-merge suggestions as optimizer outputs

The v2.4 lifecycle is:

```text
Plan uploaded -> Plan intake auto-normalizes -> Auto-doctor -> Auto-DAG analysis ->
Optimizer proposes improved graph -> User reviews diff -> Approves or rejects patch ->
Approved graph persisted -> Execution blocked until approval is current
```

### Key changes

- Added `planExecution.planIntake` with auto-normalize, auto-doctor, auto-DAG, and auto-optimization settings.
- Added `planExecution.optimizer` with objectives, allowed patches, and forbidden auto-patches.
- Added `parallelismReview.optimizationReview` with original/proposed graph hashes and diffs.
- Added `execution_without_dry_run`, `execution_without_approval`, `protected_system_mutation_without_explicit_approval`, `extension_permission_denied`, `skill_permission_denied`, `memory_forbidden_source_indexing`, and `optimizer_patch_without_approval` hard stops.
- Added doctor warnings for optimizer, extension, skill, and memory violations.
- Added persisted artifacts for plan-intake analysis, optimizer proposal, graph diffs, registry snapshots, and memory index snapshots.
- Authored batch previews are now explicitly advisory. The computed and approved graph is authoritative.
- Updated `contractVersion` to `2.4.0`.

---

## What Changed in v2.3.2

v2.3.2 makes `experimental_6` the default scale mode and enables worktree isolation by default.

P6 worktree isolation, integration queue, merge conflict detection, dynamic scheduler, scale mode policy, test impact analysis, failure classifier, repo symbol graph, and dashboard scale controls are all implemented and tested. The master template now defaults to isolated workspace execution with up to 6 workers.

Changes:
- `scale.defaultMode` changed from `stable_3` to `experimental_6`
- `scale.selectedMode` changed from `stable_3` to `experimental_6`
- `worktree.enabledByDefault` changed from `false` to `true`

## What Changed in v2.3.1

v2.3.1 adds **queue metadata revision** with explicit queue priority and queue optimization guidance.

The key insight is that a safe integration queue still benefits from strategic ordering. Not all queued merges are equal:

```text
all queued workspaces must be safe
each queued workspace has a priority level
queue optimization reorders within safety constraints
critical-path workspaces merge first
```

A plan can have all workspaces passing validation with no conflicts, but merging in naive FIFO order delays critical-path delivery. v2.3.1 adds priority metadata and optimization strategies so the queue processes merges in an order that accelerates overall completion without compromising safety.

v2.3.1 adds:

- queue priority levels: `critical`, `high`, `normal`, `low`
- queue optimization strategies: `priority_then_fifo`, `critical_path_first`, `weighted_shortest_job_first`
- `queuePriority` and `queueOptimizationNotes` at workspace level
- queue optimization enabled/disabled toggle with strategy selection
- default queue priority level for workspaces without explicit priority
- queue optimization guidance for agent briefs and execution policies
- validation rules for queue priority consistency and optimization invariants
- doctor warnings when optimization is disabled with a full queue or when priority-based reordering could accelerate delivery
- persistence mapping for queue priority snapshots and optimization strategy artifacts
- editable fields for queue priority and optimization notes

v2.3.0 scale-aware execution, worktree isolation, integration queue, validation lock, and safe effective parallelism remain the foundation. v2.3.1 optimizes within those safety constraints.

---

## What Changed in v2.3.0

v2.2.0 added explicit support for **interactive parallelism review**.

The key lesson was:

```text
maxParallelWorkspaces = capacity limit
workspace dependency graph = actual parallelism
```

A plan can request three workers but still execute one workspace at a time if every workspace depends on the previous workspace. v2.2.0 added a required preflight review option that lets Pi compute, display, edit, validate, approve, and persist the actual graph before run.

v2.3.0 keeps this behavior and adds P6 safety constraints on top.

---

## How to Use This Template

v3.0 plans can be used in **two classes**:

a) **Normal implementation plans** (after promotion to stable automation) — follow the standard implementation flow.
b) **Repair plans** (before promotion) — follow the repair-first workflow.

### For repair plans:

1. **Fill Part 1 — Phase Plan**  
   Define goals, risks, repair workstreams, repair order, rollback strategy, and promotion targets.

2. **Fill Part 2 — Agent Brief**  
   Provide mission as advisor/reviewer/patch author, hard requirements (including repair-mode constraints), execution policies, and safety stops. The agent is NOT an autonomous executor for repair plans.

3. **Fill Part 3 — Machine-Readable Execution Contract**  
   Define the repair execution contract with `executionClass: "repair"`, `executionAutomation` disabled, `repairMode` configuration, known broken subsystems, bounded liveness, manual patch protocol, promotion gates, dogfood matrix, and workspace details in valid JSON.

4. **Fill Part 4 — Machine-Readable Summary**  
   Provide phase-level repair execution metadata.

5. **Review validation rules**  
   Ensure JSON is valid, all placeholders are resolved, contractVersion is 3.0.0, executionClass is valid, repair-mode safety passes, known broken subsystems are listed, bounded liveness is configured, manual patch protocol is enforced, and promotion gates are documented.

6. **Repair workflow** (NOT autonomous execution):  
   `analyze -> propose patch -> human review -> manual apply -> targeted validation -> checkpoint -> next patch`

7. **DO NOT run `pi plan run` or any autonomous execution mode for repair plans until promotion gates pass.**

8. **Promote through the ladder**:  
   `manual_0 -> manual_1 -> assisted_1 -> stable_1 -> stable_3 -> stable_6 -> scale_8`
   Each step requires passing the corresponding promotion gates before moving forward.

---

## Critical Requirements

- Every executable plan MUST include valid JSON in Part 3.
- `contractVersion` MUST be `"3.0.0"` for v3.0 plans.
- Markdown remains human authority for purpose, risks, rollback, and reasoning.
- Part 3 JSON is the execution contract (or validation contract for repair plans).
- Unresolved `{{ placeholders }}` make the plan non-executable.
- Pi parses Part 3 JSON first; Markdown heading fallback is recovery mode only.
- PostgreSQL backend uses project/plan/workspace hierarchy for multi-project execution.
- Dashboard is enabled by default for real-time monitoring.
- **Repair plans MUST set `executionClass: "repair"`.**
- **Repair plans MUST set `executionAutomation.autonomousExecutionEnabled: false`.**
- **Repair plans MUST set `executionAutomation.agentMayMutateRepo: false`.**
- **Repair plans MUST set `executionAutomation.manualPatchApplicationRequired: true`.**
- **No autonomous scheduler/runtime may execute repair workspaces before promotion.**
- **Every repair workspace MUST include rollback, targeted validation, and human approval metadata.**
- **No LLM call may be made without a provider request timeout and stream idle watchdog.**
- **No validation command may run without timeout, no-watch guard, output cap, and process tree kill support.**
- **No git repo-wide mutation may bypass GitRunner / repo-wide lock.**
- **State writes must be transaction-backed or serialized by a write queue.**
- **Promotion to `stable_6` requires dogfood/stress gates.**
- Scale modes above `stable_3` require worktree isolation, integration queue, global validation lock, archive support, and completion gate hardening.
- If worktree isolation is disabled, `maxParallelWorkspaces` must not exceed 3.
- If integration queue is disabled, `experimental_6` and `scale_8` are invalid.
- Dashboard and doctor output must distinguish theoretical DAG parallelism from safe effective parallelism.
- Merge conflicts must be surfaced as handoff artifacts and must not mark the plan complete.
- `git push` remains forbidden in every scale mode.
- Raw destructive cleanup such as `rm -rf` remains forbidden in every scale mode.
- Watch-mode validation commands remain forbidden.
- The executor remains the only component that mutates execution state after promotion.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `{{ Phase ID }}`  
**One-line goal:** `{{ Single sentence describing what this phase accomplishes }}`  
**Why now:** `{{ Why this phase is being executed at this point }}`  
**Blast radius:** `{{ What systems/files/components will be affected }}`  
**Rollback path:** `{{ How to safely revert if things go wrong }}`  
**Repair class:** `{{ implementation / repair / verification }}`  
**Execution automation:** `{{ enabled / disabled }}`  
**Selected repair mode:** `{{ manual_0 / manual_1 / assisted_1 / stable_1 / stable_3 / stable_6 / scale_8 }}`  
**Target promotion mode:** `{{ Target stable mode after repair }}`  
**Autonomous execution allowed:** `{{ true / false }}`  
**Agent repo mutation allowed:** `{{ true / false }}`  
**Promotion gate status:** `{{ pending / in_progress / passed }}`  
**Scale mode:** `{{ stable_3 / experimental_6 / scale_8 }}`  
**Safe parallelism target:** `{{ Expected safe effective parallelism, e.g. 1, 2, 3 }}`  
**Done when:** `{{ Clear definition of completion criteria }}`

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `{{ Phase ID }}` |
| Title | `{{ Phase Title }}` |
| Status | `{{ Planned / In Progress / Complete }}` |
| Last updated | `{{ YYYY-MM-DD }}` |
| Delivery status | `{{ Not started / In progress / Complete }}` |
| Target environment | `{{ Local / Staging / Production }}` |
| Primary focus | `{{ Main technical focus area }}` |
| Product-code changes | `{{ Allowed / Forbidden / Restricted }}` |
| Repair class | `{{ implementation / repair / verification }}` |
| Execution automation | `{{ enabled / disabled }}` |
| Selected repair mode | `{{ manual_0 / manual_1 / assisted_1 / stable_1 / stable_3 / stable_6 / scale_8 }}` |
| Target promotion mode | `{{ stable_3 / stable_6 }}` |
| Autonomous execution allowed | `{{ true / false }}` |
| Agent repo mutation allowed | `{{ true / false }}` |
| Promotion gate status | `{{ pending / in_progress / passed }}` |
| Selected scale mode | `{{ stable_3 / experimental_6 / scale_8 }}` |
| Requested max workers | `{{ integer }}` |
| Expected DAG effective parallelism | `{{ integer or TBD }}` |
| Expected safe effective parallelism | `{{ integer or TBD }}` |
| Worktree isolation | `{{ Required / Optional / Disabled }}` |
| Integration queue | `{{ Required / Optional / Disabled }}` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| `{{ Workstream ID }}` — `{{ Title }}` | `{{ Role }}` | `{{ Role }}` | `{{ Role }}` | `{{ Role }}` |

---

## 2. Purpose

`{{ Describe the purpose of this phase in 2-4 paragraphs. What problem does it solve? What capabilities does it enable? }}`

If this phase uses P6 scale-aware execution, explain why higher parallelism is safe, which prerequisites are required, and whether the actual executor should prefer DAG batch preview or safe batch preview.

---

## 3. What Carried Over — Must Stay Stable

List all constraints, policies, and systems that MUST remain stable:

* [ ] `{{ Constraint or policy that must not be violated }}`
* [ ] `{{ System or component that must remain unchanged }}`
* [ ] `{{ Safety guarantee that must be preserved }}`
* [ ] Worktree isolation remains available when requested by scale mode.
* [ ] Integration queue remains enabled when required by scale mode.
* [ ] Global validation lock remains active for heavy validation.
* [ ] Completion gate hardening remains active.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] The executor remains the source of truth for state transitions.

---

## 4. Background / What Was Wrong

`{{ Explain the problem state that motivated this phase. What was broken, inefficient, unsafe, or missing? }}`

If relevant, distinguish between:

- dependency graph limitations
- shared-working-tree limitations
- validation contention
- merge/integration risk
- poor safe parallelism despite a wide DAG
- missing dashboard or doctor visibility

---

## 5. Current Failure State / Known Blockers

List all known blockers and unimplemented components:

* `{{ component_name }}` = `{{ not implemented / broken / incomplete }}`
* `{{ system_name }}` = `{{ not implemented / broken / incomplete }}`
* `worktree_isolation` = `{{ enabled / disabled / incomplete / not required }}`
* `integration_queue` = `{{ enabled / disabled / incomplete / not required }}`
* `scale_mode_readiness` = `{{ ready / blocked / unknown }}`
* `safe_effective_parallelism` = `{{ computed / not computed / below target }}`

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| `{{ Risk description }}` | `{{ low / med / high }}` | `{{ low / med / high / critical }}` | `{{ Mitigation strategy }}` |
| Worktree path escapes `.pi/worktrees` | low | critical | Path scope checks; stop execution on escape |
| Integration queue merges unvalidated diff | med | high | Require workspace validation and integration validation |
| Merge conflict blocks plan | med | med | Generate conflict handoff artifact and stop queue safely |
| Safe parallelism is lower than requested | med | med | Doctor warning; show bottleneck; use safe batch preview |
| Validation lock limits throughput | med | med | Scheduler reduces concurrency while heavy validation runs |
| Cleanup deletes wrong files | low | critical | Raw destructive cleanup forbidden; scoped cleanup only |
| Scale mode enabled without prerequisites | low | high | Scale readiness gate blocks execution |

---

## 7. Workstreams

### 7.A — `{{ Workstream Title }}`

**Goal:** `{{ What this workstream accomplishes }}`

**Requirements:**
* `{{ Requirement 1 }}`
* `{{ Requirement 2 }}`

**Acceptance Criteria:**
* `{{ Criterion 1 }}`
* `{{ Criterion 2 }}`

**Isolation & Parallelism Notes:**
* `{{ Why this workspace depends on its dependencies, or why it can run independently }}`
* `{{ Expected parallel batch/group, if known }}`
* `{{ Whether this workspace requires git worktree isolation }}`
* `{{ Known file, symbol, package, or validation-lock overlap with other workspaces }}`
* `{{ Whether this workspace must enter the integration queue before dependent work starts }}`

---

`{{ Repeat for all workstreams }}`

---

## 8. Combined Implementation Order

```text
{{ Logical dependency order }}
{{ Batch 1: A }}
{{ Batch 2: B + C + D }}
{{ Batch 3: E + F }}
{{ Batch 4: G }}
```

`{{ Explain both the logical dependency order and the safe execution batches. Do not list a linear chain unless the work truly must be serialized. If P6 scale mode is enabled, explain why the DAG batch preview and safe batch preview may differ because of file overlap, symbol overlap, validation lock pressure, integration queue serialization, risk level, or worktree readiness. }}`

---

## 9. Definition of Done

`{{ Phase ID }}` is complete when ALL are true:

* [ ] `{{ Completion criterion 1 }}`
* [ ] `{{ Completion criterion 2 }}`
* [ ] `{{ Completion criterion 3 }}`
* [ ] DAG batch preview has been reviewed if required.
* [ ] Safe batch preview has been reviewed if required.
* [ ] Selected scale mode readiness passes.
* [ ] Worktree isolation status is correct for selected scale mode.
* [ ] Integration queue status is clean or intentionally blocked with handoff.
* [ ] No forbidden commands or files were used.
* [ ] Validation gates passed.
* [ ] Typecheck/build/test requirements passed where applicable.

---

## 10. Rollback Playbook

**Trigger conditions:**
* `{{ Condition that triggers rollback }}`
* Worktree creation or cleanup behaves unsafely.
* Integration queue merges incorrect or unvalidated diffs.
* Merge conflicts are not detected or no handoff artifact is produced.
* Safe scale mode causes resource exhaustion or state corruption.
* Validation planner misses a required failure.
* Dashboard or doctor reports misleading scale readiness.

**Rollback procedure:**
1. Set scale mode to `stable_3`.
2. Set `maxParallelWorkspaces` to `3` or lower.
3. Disable worktree mode only if safe fallback is required.
4. Pause or disable integration queue processing.
5. Preserve `.pi/worktrees/{planExecId}/` for debugging.
6. Fall back to shared-working-tree execution if explicitly allowed.
7. Disable targeted validation and use broader validation if needed.
8. Keep failure classifier and dashboard telemetry read-only if safe.
9. Revert phase commits independently if needed.

---

## 11. What Next Phase Inherits

`{{ Next Phase ID }}` inherits:

* `{{ System or component }}`
* Worktree-aware execution contract.
* Scale-mode-aware validation rules.
* Integration queue requirements.
* Safe effective parallelism review.
* Workspace-level parallelism/isolation/integration/validation metadata.

`{{ Next Phase ID }}` may add:

* `{{ New capability }}`
* Policy engine improvements.
* Approval workflows.
* Enterprise governance.
* Release orchestration.
* Remote execution.
* Agent abstraction.
* Audit systems.
* Autonomous planning.

---

# Part 2 — Agent Brief

## Mission

`{{ Clear mission statement for the implementing agent }}`

**For repair plans**, the agent is an **advisor/reviewer/patch author**, NOT an autonomous executor. The agent may propose patches but must NOT apply them if `agentMayMutateRepo` is false. Human approval is required for every patch.

If this plan uses P6 scale-aware execution (after promotion), the agent must optimize for safe parallelism, not maximum concurrency. Higher worker counts are allowed only when scale-mode readiness passes and the executor can preserve correctness through worktree isolation, integration queue, validation locks, and completion gates.

If this plan uses queue optimization, the agent must assign meaningful queue priority levels to workspaces and document the optimization rationale. Critical-path workspaces should receive `high` or `critical` priority. Workspaces with no downstream dependents should receive `normal` or `low` priority. The agent must not use queue optimization to bypass safety constraints — validation gates still apply regardless of priority level.

---

## Hard Requirements

1. `{{ Non-negotiable requirement 1 }}`
2. `{{ Non-negotiable requirement 2 }}`
3. `{{ Non-negotiable requirement 3 }}`
4. **Do not run autonomous execution for repair plans.**
5. **Do not mutate repo unless explicitly allowed (`agentMayMutateRepo` is true).**
6. **Do not run commands unless explicitly allowed (`agentMayRunCommands` is true).**
7. **Do not enable continuous scheduling until promotion gates pass.**
8. **Do not claim `stable_6` until the stable_6 stress gate passes.**
9. **Do not use the broken executor to repair itself.**
10. Do not exceed selected scale-mode worker cap.
11. Do not run more than 3 workers unless worktree isolation and integration queue readiness pass.
12. Do not merge workspace output without passed workspace validation.
13. Do not mark a plan complete if integration validation fails.
14. Do not treat merge conflict as ordinary worker failure.
15. Do not start the next plan while integration queue state is dirty.
16. Do not run watch-mode validation.
17. Do not run `git push`.
18. Do not run raw destructive cleanup commands.
19. Do not access secrets or forbidden files.
20. The executor remains the only component that mutates execution state after promotion.
21. If queue optimization is enabled, the queue must respect workspace-level `queuePriority` and the selected optimization strategy.
22. Queue optimization must not bypass safety checks: workspace validation and integration validation remain required regardless of priority.
23. Priority-based reordering must not cause starvation: low-priority workspaces must still be merged within a reasonable window.
24. Queue optimization strategy must be one of the supported strategies: `priority_then_fifo`, `critical_path_first`, or `weighted_shortest_job_first`.

---

## Execution Policies

```yaml
repair_modes:
  manual_0:
    description: analysis only, no repo mutation
    autonomous_execution_allowed: false
    agent_may_mutate_repo: false
  manual_1:
    description: human applies one patch at a time
    autonomous_execution_allowed: false
    agent_may_mutate_repo: false
  assisted_1:
    description: agent may propose patches, human applies
    autonomous_execution_allowed: false
    agent_may_mutate_repo: false
  stable_1:
    description: one autonomous workspace allowed after isolation gates
    autonomous_execution_allowed: true
    agent_may_mutate_repo: true
  stable_3:
    description: three autonomous workspaces after stable_3 dogfood
    autonomous_execution_allowed: true
    agent_may_mutate_repo: true
  stable_6:
    description: six autonomous workspaces after stable_6 stress
    autonomous_execution_allowed: true
    agent_may_mutate_repo: true
  scale_8:
    description: explicit approval and future phase only
    autonomous_execution_allowed: true
    agent_may_mutate_repo: true

execution_automation:
  autonomous_execution_enabled: false
  agent_may_mutate_repo: false
  agent_may_run_commands: false
  manual_patch_application_required: true
  human_approval_required_for_every_patch: true

bounded_liveness:
  no_indefinite_waits: true
  llm_provider_timeout_required: true
  llm_stream_idle_watchdog_required: true
  validation_timeout_required: true
  process_tree_kill_required: true
  git_lock_bypass_forbidden: true
  state_write_serialization_required: true

scale:
  default_mode: stable_3
  selected_mode: stable_3
  modes:
    stable_3:
      max_parallel_workspaces: 3
      worktree_required: false
      integration_queue_required: false
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
  enabled_by_default: false
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
      description: Workspaces on the critical path merge before non-critical workspaces regardless of submission time
      priority_levels: [critical, high, normal, low]
    weighted_shortest_job_first:
      description: Workspaces with fewer or smaller changes merge first within priority bands to reduce queue pressure
      priority_levels: [critical, high, normal, low]
  priority_levels:
    critical:
      description: Merge immediately when safe. Reserved for workspaces that unblock downstream work.
    high:
      description: Merge ahead of normal and low priority. Used for important but not blocking workspaces.
    normal:
      description: Default priority. Merge in FIFO order within this band.
    low:
      description: Merge last. Used for cosmetic, docs, or non-essential changes.

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

---

## Safety Stops

Hard stop execution only for:

* `{{ Safety condition 1 }}`
* `{{ Safety condition 2 }}`
* `{{ Safety condition 3 }}`
* `autonomous_execution_requested_during_repair_mode`
* `agent_repo_mutation_requested_during_manual_repair`
* `agent_command_execution_requested_during_manual_repair`
* `scheduler_enabled_before_executor_isolation_gate`
* `stable_6_requested_before_promotion_gates`
* `llm_call_without_provider_timeout`
* `llm_stream_without_idle_watchdog`
* `validation_command_without_timeout`
* `validation_process_without_process_group`
* `validation_watch_or_dev_server_command`
* `git_lock_bypass_detected`
* `state_store_write_without_serialization`
* `workspace_patch_without_human_approval`
* `repair_workspace_missing_rollback`
* `repair_workspace_missing_targeted_validation`
* `dogfood_required_but_missing`
* `promotion_gate_failed_or_missing`
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
* Queue priority level set to unsupported value
* Queue optimization disabled while queue is full and priority-enabled workspaces are queued

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract (or validation contract for repair plans) for Pi's PostgreSQL-backed multi-project execution system. Pi parses this section first to validate the plan. In repair mode, this JSON describes what the repair plan expects but does NOT authorize autonomous mutation.

**Validation:** This JSON must be valid and complete before any action proceeds. Use `pi plan doctor` to validate. For repair plans, doctor must also validate: contractVersion, executionClass, repair-mode safety, known broken subsystems, bounded liveness, manual patch protocol, and promotion gate status. Autonomous execution gates are only checked after promotion permits them.

```json
{
  "contractVersion": "3.0.0",
  "executionClass": "repair",
  "executionBackend": "postgres",
  "project": {
    "name": "{{ project_name }}",
    "rootPath": "{{ absolute_or_repo_relative_path }}",
    "type": "repo",
    "tags": []
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": false,
    "agentMayMutateRepo": false,
    "agentMayRunCommands": false,
    "manualPatchApplicationRequired": true,
    "humanApprovalRequiredForEveryPatch": true
  },
  "repairMode": {
    "selectedMode": "manual_1",
    "targetPromotionMode": "stable_6",
    "schedulerRuntimeUse": "disabled_until_promotion",
    "reason": "{{ Why autonomous execution is disabled for this plan }}"
  },
  "knownBrokenSubsystems": [
    {
      "id": "executor_singleton_race",
      "severity": "critical",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": ["stable_1", "stable_3", "stable_6"]
    },
    {
      "id": "abort_signal_not_wired",
      "severity": "critical",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": ["stable_1", "stable_3", "stable_6"]
    },
    {
      "id": "worktree_mutex_bypass",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": ["stable_3", "stable_6"]
    },
    {
      "id": "validation_process_hang",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": ["stable_3", "stable_6"]
    },
    {
      "id": "json_state_store_concurrent_writes",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": ["stable_3", "stable_6"]
    }
  ],
  "planExecution": {
    "phase": "{{ Phase ID }}",
    "title": "{{ Short Title }}",
    "mode": "manual_repair",
    "maxParallelWorkspaces": 1,
    "scheduling": {
      "continuous": false,
      "slotCount": 1,
      "priorityStrategy": "manual_order"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": false,
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
      "enabled": true,
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
        "levels": ["critical", "high", "normal", "low"]
      },
      "queueOptimization": {
        "enabled": true,
        "strategy": "priority_then_fifo",
        "availableStrategies": ["priority_then_fifo", "critical_path_first", "weighted_shortest_job_first"]
      }
    },
    "validation": {
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "watchModeForbidden": true
    },
    "leaseMonitor": {
      "enabled": true,
      "heartbeatIntervalSeconds": 15,
      "staleThresholdSeconds": 45,
      "monitorLoopIntervalSeconds": 30,
      "stalePolicy": "quarantine_and_replace",
      "reconciliationPrecedence": {
        "wasRunning": "lease_file",
        "whatIsOnDisk": "worktree_state",
        "onDisagreement": "quarantine_and_requeue"
      }
    },
    "validationLane": {
      "maxConcurrentHeavyValidations": 1,
      "maxConcurrentTargetedValidations": 3,
      "backpressureEnabled": true,
      "backpressureStrategy": "prefer_targeted_when_heavy_saturated",
      "schedulerFeedbackEnabled": true
    },
    "mergePriorityScorer": {
      "enabled": true,
      "formula": "downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10",
      "recomputeOnEachDequeue": true,
      "tiebreaker": "fifo"
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
    },
    "planIntake": {
      "enabled": true,
      "runOnUpload": true,
      "parserPriority": [
        "part3_json",
        "contractVersion_and_executionClass",
        "repair_mode_safety",
        "known_broken_subsystem_gate",
        "bounded_liveness",
        "manual_patch_protocol",
        "promotion_gate",
        "doctor",
        "execution_gate"
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
      "enabled": true,
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
  "boundedLiveness": {
    "required": true,
    "noIndefiniteWaits": true,
    "llm": {
      "providerRequestTimeoutMs": 120000,
      "streamIdleTimeoutMs": 300000,
      "workspaceOverallTimeoutMs": 1800000,
      "maxConsecutiveProviderTimeouts": 2,
      "onCircuitOpen": "fail_workspace_not_plan"
    },
    "validation": {
      "defaultTimeoutMs": 600000,
      "heavyTimeoutMs": 1200000,
      "killProcessTreeOnTimeout": true,
      "watchModeForbidden": true,
      "stdinClosed": true,
      "ciEnvRequired": true,
      "maxOutputBytes": 52428800
    },
    "git": {
      "repoMutationLockTimeoutMs": 60000,
      "lockBypassForbidden": true,
      "onLockTimeout": "fail_fast_and_retry_or_handoff"
    },
    "scheduler": {
      "stallDetectionEnabled": true,
      "noProgressTimeoutMs": 300000,
      "onNoProgress": "emit_blocked_reason"
    },
    "stateStore": {
      "transactionOrWriteQueueRequired": true,
      "atomicSnapshotRequired": true,
      "journalLineAtomicityRequired": true
    }
  },
  "llmRuntime": {
    "boundedProviderCallsRequired": true,
    "providerRequestTimeoutMs": 120000,
    "streamIdleTimeoutMs": 300000,
    "workspaceOverallTimeoutMs": 1800000,
    "circuitBreaker": {
      "enabled": true,
      "openAfterConsecutiveTimeouts": 2,
      "cooldownMs": 300000
    },
    "fallbackPolicy": {
      "enabled": false,
      "reason": "Repair patches must remain deterministic and human-reviewed unless explicitly approved."
    }
  },
  "validationRuntime": {
    "managedRunnerRequired": true,
    "processGroupRequired": true,
    "killTreeOnTimeout": true,
    "maxOutputBytes": 52428800,
    "forbiddenInteractiveCommands": [
      "vitest --watch",
      "jest --watch",
      "npm run dev",
      "vite --host"
    ],
    "lanes": {
      "heavy": { "maxConcurrent": 1 },
      "targeted": { "maxConcurrent": 3 }
    }
  },
  "promotionGates": {
    "initialMode": "manual_1",
    "targetMode": "stable_6",
    "gates": [
      {
        "id": "executor_isolation_passed",
        "requiredFor": ["stable_1", "stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "abort_signal_chain_passed",
        "requiredFor": ["stable_1", "stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "validation_hang_kill_passed",
        "requiredFor": ["stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "git_serialization_stress_passed",
        "requiredFor": ["stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "state_store_concurrency_passed",
        "requiredFor": ["stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "crash_recovery_passed",
        "requiredFor": ["stable_3", "stable_6"],
        "status": "pending"
      },
      {
        "id": "stable_3_dogfood_passed",
        "requiredFor": ["stable_6"],
        "status": "pending"
      },
      {
        "id": "stable_6_stress_passed",
        "requiredFor": ["stable_6"],
        "status": "pending"
      }
    ]
  },
  "manualPatchProtocol": {
    "required": true,
    "onePatchAtATime": true,
    "humanReviewBeforeApply": true,
    "rollbackRequiredForEachPatch": true,
    "targetedValidationRequiredForEachPatch": true,
    "checkpointAfterEachPatch": true
  },
  "dogfoodMatrix": {
    "required": true,
    "scenarios": [
      "executor_isolation_stress",
      "abort_signal_chain",
      "llm_stream_idle_timeout",
      "validation_process_hang_kill",
      "git_worktree_lock_stress",
      "state_store_concurrent_write_stress",
      "crash_recovery_requeue",
      "stable_3_dogfood",
      "stable_6_stress"
    ]
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "manual_repair_checkpoint_only"
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
      "execution_without_dry_run",
      "execution_without_approval",
      "protected_system_mutation_without_explicit_approval",
      "extension_permission_denied",
      "skill_permission_denied",
      "memory_forbidden_source_indexing",
      "optimizer_patch_without_approval",
      "integration_merge_with_unresolved_write_set_drift_in_block_mode",
      "lease_reconciliation_disagreement_without_quarantine",
      "autonomous_execution_requested_during_repair_mode",
      "agent_repo_mutation_requested_during_manual_repair",
      "agent_command_execution_requested_during_manual_repair",
      "scheduler_enabled_before_executor_isolation_gate",
      "stable_6_requested_before_promotion_gates",
      "llm_call_without_provider_timeout",
      "llm_stream_without_idle_watchdog",
      "validation_command_without_timeout",
      "validation_process_without_process_group",
      "validation_watch_or_dev_server_command",
      "git_lock_bypass_detected",
      "state_store_write_without_serialization",
      "workspace_patch_without_human_approval",
      "repair_workspace_missing_rollback",
      "repair_workspace_missing_targeted_validation",
      "dogfood_required_but_missing",
      "promotion_gate_failed_or_missing"
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
    "requestedMaxParallelWorkspaces": 1,
    "selectedScaleMode": "stable_3",
    "scaleModeReadiness": {
      "ready": true,
      "blockedReasons": [],
      "warnings": [],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": false,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        },
        {
          "key": "integration_queue",
          "required": false,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        },
        {
          "key": "validation_lock",
          "required": false,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        },
        {
          "key": "completion_gate",
          "required": false,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 1,
    "expectedSafeEffectiveParallelismMin": 1,
    "dagEffectiveParallelism": null,
    "safeEffectiveParallelism": null,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "safeBatchingStrategy": "dag_batches_with_p6_safety_constraints",
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
      "queue_optimization_strategy_invalid_for_mode",
      "optimizer_patch_without_approval",
      "extension_permission_requires_review",
      "skill_permission_requires_review",
      "memory_forbidden_source_indexing",
      "lease_monitor_disabled_with_worktree_enabled",
      "write_set_drift_detected_in_prior_run",
      "validation_lane_saturated_blocking_scheduler",
      "integration_queue_merge_priority_stale",
      "lease_reconciliation_disagreement_detected",
      "empirical_write_set_diverges_from_declared"
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
      "plan_intake_analysis",
      "optimizer_proposal",
      "graph_diff",
      "extension_registry_snapshot",
      "skill_registry_snapshot",
      "memory_index_snapshot",
      "platform_audit_timeline",
      "worktree_state",
      "lease_heartbeat_snapshots",
      "lease_reconciliation_log",
      "merge_priority_score_log",
      "empirical_write_set",
      "write_set_drift_report",
      "validation_lane_saturation_log",
      "repair_checkpoint",
      "manual_patch_approval",
      "patch_review_record",
      "rollback_artifact",
      "targeted_validation_artifact",
      "promotion_gate_result",
      "dogfood_matrix_result",
      "llm_timeout_circuit_breaker_event",
      "validation_process_kill_record",
      "git_lock_timeout_quarantine_record",
      "state_write_serialization_evidence"
    ]
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "{{ Workstream title }}",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "{{ Why this workspace has no dependencies or why these dependencies are required }}",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "{{ role_or_person }}"
      },
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "{{ Why this workspace can or cannot run concurrently with others }}"
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
        "queuePriority": "normal",
        "queueOptimizationNotes": "{{ Why this workspace should merge earlier or later based on critical-path analysis, dependency depth, or downstream impact }}"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800
      },
      "allowedFiles": [],
      "forbiddenFiles": [],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 0,
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
    }
  ]
}
```

---

## Field Definitions

### Contract Metadata

- **`contractVersion`**: Must be `"3.0.0"` for v3.0 repair-first execution correctness plans. Earlier versions (`2.3.0` through `2.6.0`) remain supported for plans using earlier defaults but MUST NOT be used for repair-mode plans.
- **`executionClass`**: The class of execution plan. Must be one of `"implementation"` (normal autonomous execution after promotion), `"repair"` (repair-first, manual-gated, promotion-gated), or `"verification"` (for validating that repairs are effective). Repair plans disable autonomous execution until promotion gates pass.
- **`executionAutomation`**: Defines whether autonomous execution, repo mutation, command execution are enabled, and whether manual patch application and human approval are required. See field definitions below.
- **`repairMode`**: Defines the repair mode, target promotion mode, scheduler runtime behavior, and the reason autonomous execution is disabled.
- **`knownBrokenSubsystems`**: Registry of known broken subsystems that block autonomous execution until certain promotion gates pass. Each entry has `id`, `severity`, `autonomousExecutionBlocked`, and `mustFixBefore` (array of mode identifiers).
- **`boundedLiveness`**: Defines liveness contracts for LLM, validation, git, scheduler, and state store operations. No indefinite waits are permitted.
- **`llmRuntime`**: Defines LLM provider call constraints: request timeout, stream idle timeout, workspace overall timeout, circuit breaker configuration, and fallback policy.
- **`validationRuntime`**: Defines managed validation runner requirements: process group, kill tree on timeout, output cap, forbidden interactive commands, and lane configurations.
- **`manualPatchProtocol`**: Defines the manual patch protocol: one patch at a time, human review before apply, rollback required, targeted validation required, checkpoint after each patch.
- **`promotionGates`**: Defines the promotion gate ladder from `initialMode` to `targetMode` with individual `gates` having `id`, `requiredFor` mode list, and `status`.
- **`dogfoodMatrix`**: Defines required dogfood/stress scenarios that must pass before certain promotion modes are reached.
- **`executionBackend`**: Must be `"postgres"` or `"json"`.
- **`project`**: Defines the repository/project being executed.
- **`planExecution`**: Defines execution behavior, scale mode, state backend, dashboard behavior, and safety primitives.

---

### Plan Execution Parallelism Fields

- **`planExecution.maxParallelWorkspaces`**: Maximum concurrent workspace count. This is a hard cap only; it does not guarantee concurrency.
- **`planExecution.interactiveParallelismReview.enabled`**: Enables graph and batch preview behavior.
- **`preflightRequired`**: Blocks execution until the plan has been reviewed.
- **`approvalRequiredBeforeRun`**: Requires explicit user approval before run.
- **`allowDependencyEditing`**: Allows safe dependency patching before approval.
- **`showEffectiveParallelism`**: Displays computed DAG effective parallelism.
- **`showSafeEffectiveParallelism`**: Displays safe effective parallelism after P6 safety constraints.
- **`showBatchPreview`**: Displays topological DAG batches.
- **`showSafeBatchPreview`**: Displays batches after safety constraints.
- **`showCriticalPath`**: Displays longest dependency path.
- **`showScaleModeReadiness`**: Displays selected scale mode prerequisites and blockers.
- **`warnWhenEffectiveParallelismBelowRequested`**: Emits warnings when requested capacity exceeds usable graph width.
- **`warnWhenSafeParallelismBelowDagParallelism`**: Emits warnings when P6 safety constraints reduce usable concurrency.
- **`warnWhenScaleModePrerequisitesMissing`**: Emits warnings when selected scale mode cannot safely run.
- **`persistApprovedGraph`**: Stores approved graph/hash and requires executor to use it.

---

### Execution Automation Fields

- **`executionAutomation.autonomousExecutionEnabled`**: Whether autonomous execution (e.g., `pi plan run`) is allowed. For repair plans, MUST be `false` unless all required promotion gates have passed.
- **`executionAutomation.agentMayMutateRepo`**: Whether the agent may directly mutate the repository. For repair plans at `manual_0` through `assisted_1`, MUST be `false`.
- **`executionAutomation.agentMayRunCommands`**: Whether the agent may run commands autonomously. For repair plans, MUST be `false` until promotion permits it.
- **`executionAutomation.manualPatchApplicationRequired`**: Whether patches must be applied manually by a human. For repair plans, MUST be `true`.
- **`executionAutomation.humanApprovalRequiredForEveryPatch`**: Whether every patch requires explicit human approval. For repair plans, MUST be `true`.

### Repair Mode Fields

- **`repairMode.selectedMode`**: The current repair mode. Valid values: `manual_0` (analysis only), `manual_1` (human applies patches), `assisted_1` (agent proposes, human applies), `stable_1` (one autonomous workspace after isolation gates), `stable_3` (three autonomous workspaces after dogfood), `stable_6` (six autonomous workspaces after stress gates), `scale_8` (explicit approval only).
- **`repairMode.targetPromotionMode`**: The target stable automation mode to reach after all promotions pass. Typically `stable_6`.
- **`repairMode.schedulerRuntimeUse`**: One of `"disabled_until_promotion"`, `"enabled_after_isolation"`, or `"enabled"`. For repair plans, MUST be `"disabled_until_promotion"`.
- **`repairMode.reason`**: Human-readable explanation for why autonomous execution is disabled for this plan.

### Known Broken Subsystems Fields

- **`knownBrokenSubsystems[].id`**: Unique identifier for the known broken subsystem.
- **`knownBrokenSubsystems[].severity`**: One of `"critical"`, `"high"`, `"medium"`, `"low"`.
- **`knownBrokenSubsystems[].autonomousExecutionBlocked`**: Whether this subsystem being broken blocks autonomous execution.
- **`knownBrokenSubsystems[].mustFixBefore`**: Array of mode identifiers (e.g., `"stable_1"`, `"stable_3"`, `"stable_6"`) that require this subsystem to be fixed before promotion to that mode.

### Bounded Liveness Fields

- **`boundedLiveness.required`**: Whether bounded liveness is required. For repair plans, MUST be `true`.
- **`boundedLiveness.noIndefiniteWaits`**: Whether indefinite waits are prohibited. MUST be `true`.
- **`boundedLiveness.llm.providerRequestTimeoutMs`**: Maximum time (ms) for a single LLM provider request. Default 120000.
- **`boundedLiveness.llm.streamIdleTimeoutMs`**: Maximum idle time (ms) for an LLM stream before watchdog triggers. Default 300000.
- **`boundedLiveness.llm.workspaceOverallTimeoutMs`**: Maximum total time (ms) for a workspace's LLM usage. Default 1800000.
- **`boundedLiveness.llm.maxConsecutiveProviderTimeouts`**: Number of consecutive provider timeouts before circuit breaker opens. Default 2.
- **`boundedLiveness.llm.onCircuitOpen`**: Behavior when circuit breaker opens. Must be `"fail_workspace_not_plan"`.
- **`boundedLiveness.validation.defaultTimeoutMs`**: Default validation command timeout (ms). Default 600000.
- **`boundedLiveness.validation.heavyTimeoutMs`**: Heavy validation command timeout (ms). Default 1200000.
- **`boundedLiveness.validation.killProcessTreeOnTimeout`**: Whether to kill the entire process tree on timeout. MUST be `true`.
- **`boundedLiveness.validation.watchModeForbidden`**: Whether watch/dev-server mode validation commands are forbidden. MUST be `true`.
- **`boundedLiveness.validation.stdinClosed`**: Whether stdin is closed for validation commands. MUST be `true`.
- **`boundedLiveness.validation.ciEnvRequired`**: Whether CI-like environment is required for validation. MUST be `true`.
- **`boundedLiveness.validation.maxOutputBytes`**: Maximum output bytes from a validation command. Default 52428800 (50MB).
- **`boundedLiveness.git.repoMutationLockTimeoutMs`**: Maximum time (ms) to wait for git repo-wide mutation lock. Default 60000.
- **`boundedLiveness.git.lockBypassForbidden`**: Whether bypassing the git lock is forbidden. MUST be `true`.
- **`boundedLiveness.git.onLockTimeout`**: Behavior on lock timeout. Must be `"fail_fast_and_retry_or_handoff"`.
- **`boundedLiveness.scheduler.stallDetectionEnabled`**: Whether scheduler stall detection is enabled. MUST be `true`.
- **`boundedLiveness.scheduler.noProgressTimeoutMs`**: Maximum time without progress before stall is declared. Default 300000.
- **`boundedLiveness.scheduler.onNoProgress`**: Action on stall detection. Must be `"emit_blocked_reason"`.
- **`boundedLiveness.stateStore.transactionOrWriteQueueRequired`**: Whether state writes must be transaction-backed or serialized by a write queue. MUST be `true`.
- **`boundedLiveness.stateStore.atomicSnapshotRequired`**: Whether state snapshots must be atomic. MUST be `true`.
- **`boundedLiveness.stateStore.journalLineAtomicityRequired`**: Whether journal writes must be line-atomic. MUST be `true`.

### LLM Runtime Fields

- **`llmRuntime.boundedProviderCallsRequired`**: Whether LLM provider calls must be bounded (timeout + watchdog). MUST be `true`.
- **`llmRuntime.providerRequestTimeoutMs`**: Maximum time (ms) for a single LLM provider request. Default 120000.
- **`llmRuntime.streamIdleTimeoutMs`**: Maximum idle time (ms) for an LLM stream. Default 300000.
- **`llmRuntime.workspaceOverallTimeoutMs`**: Maximum total time (ms) per workspace. Default 1800000.
- **`llmRuntime.circuitBreaker.enabled`**: Whether the circuit breaker is enabled. For repair plans, MUST be `true`.
- **`llmRuntime.circuitBreaker.openAfterConsecutiveTimeouts`**: Consecutive timeouts before circuit opens. Default 2.
- **`llmRuntime.circuitBreaker.cooldownMs`**: Cooldown period before circuit resets (ms). Default 300000.
- **`llmRuntime.fallbackPolicy.enabled`**: Whether LLM provider fallback is enabled. MUST be `false` for repair plans (patches must remain deterministic).
- **`llmRuntime.fallbackPolicy.reason`**: Explanation for fallback policy choice.

### Validation Runtime Fields

- **`validationRuntime.managedRunnerRequired`**: Whether a managed validation runner is required. MUST be `true`.
- **`validationRuntime.processGroupRequired`**: Whether validation processes must be in a managed process group. MUST be `true`.
- **`validationRuntime.killTreeOnTimeout`**: Whether the entire process tree is killed on timeout. MUST be `true`.
- **`validationRuntime.maxOutputBytes`**: Maximum output bytes captured from a validation command. Default 52428800.
- **`validationRuntime.forbiddenInteractiveCommands`**: Array of forbidden interactive/daemon commands (e.g., `vitest --watch`, `npm run dev`).
- **`validationRuntime.lanes.heavy.maxConcurrent`**: Maximum concurrent heavy validation commands. Default 1.
- **`validationRuntime.lanes.targeted.maxConcurrent`**: Maximum concurrent targeted validation commands. Default 3.

### Manual Patch Protocol Fields

- **`manualPatchProtocol.required`**: Whether the manual patch protocol is required. For repair plans, MUST be `true`.
- **`manualPatchProtocol.onePatchAtATime`**: Whether patches must be applied one at a time. MUST be `true`.
- **`manualPatchProtocol.humanReviewBeforeApply`**: Whether human review is required before applying each patch. MUST be `true`.
- **`manualPatchProtocol.rollbackRequiredForEachPatch`**: Whether rollback must be prepared for each patch. MUST be `true`.
- **`manualPatchProtocol.targetedValidationRequiredForEachPatch`**: Whether targeted validation is required after each patch. MUST be `true`.
- **`manualPatchProtocol.checkpointAfterEachPatch`**: Whether a checkpoint must be created after each patch. MUST be `true`.

### Promotion Gates Fields

- **`promotionGates.initialMode`**: The initial repair mode (e.g., `"manual_1"`).
- **`promotionGates.targetMode`**: The target promotion mode (e.g., `"stable_6"`).
- **`promotionGates.gates[].id`**: Unique gate identifier.
- **`promotionGates.gates[].requiredFor`**: Array of mode identifiers this gate is required for.
- **`promotionGates.gates[].status`**: One of `"pending"`, `"in_progress"`, `"passed"`, `"failed"`.

### Dogfood Matrix Fields

- **`dogfoodMatrix.required`**: Whether dogfood/stress testing is required. MUST be `true`.
- **`dogfoodMatrix.scenarios`**: Array of required stress scenario identifiers (e.g., `"executor_isolation_stress"`, `"stable_6_stress"`).

### Repair Workspace Metadata Fields

- **`workspaces[].manualApplicationRequired`**: Whether manual patch application is required for this workspace. For repair workspaces, MUST be `true`.
- **`workspaces[].humanApprovalRequired`**: Whether human approval is required for this workspace. For repair workspaces, MUST be `true`.
- **`workspaces[].autonomousExecutionAllowed`**: Whether autonomous execution is allowed for this workspace. For repair workspaces, MUST be `false`.
- **`workspaces[].rollbackRequired`**: Whether rollback metadata must be prepared for this workspace. For repair workspaces, MUST be `true`.
- **`workspaces[].targetedValidationRequired`**: Whether targeted validation is required for this workspace. For repair workspaces, MUST be `true`.
- **`workspaces[].patchReview.required`**: Whether patch review is required. MUST be `true`.
- **`workspaces[].patchReview.reviewer`**: Role or person responsible for reviewing the patch.

### P6 Scale-Aware Execution Fields

- **`planExecution.scale`**: Defines available scale modes and prerequisites.
- **`selectedMode`**: Requested scale mode for this plan. Must be one of `stable_3`, `experimental_6`, or `scale_8`. For repair plans, the executor does not use scale mode scheduling until promotion permits it.
- **`stable_3`**: Default safe mode. Maximum 3 workers. Does not require worktree isolation or integration queue, though both may still be enabled. For repair plans, `stable_3` is a promotion target, not a default execution assumption.
- **`experimental_6`**: Allows up to 6 workers only when worktree isolation, integration queue, validation lock, archive, and completion gate hardening are active. Not used during repair mode; only reachable after promotion gates pass.
- **`scale_8`**: Allows up to 8 workers only when all `experimental_6` prerequisites pass, dogfood has passed, and explicit approval is present. Not used during repair mode.
- **`planExecution.worktree`**: Defines git worktree isolation behavior, root path, quarantine policy, and cleanup safety requirements.
- **`planExecution.integrationQueue`**: Defines controlled merge behavior for successful workspace outputs.
- **`planExecution.integrationQueue.queuePriority`**: Configures queue priority levels. When `enabled`, the queue reorders pending merges by priority before falling back to FIFO within the same priority band. `defaultLevel` sets the priority for workspaces that do not specify an explicit priority. `levels` enumerates valid priority values.
- **`planExecution.leaseMonitor`**: Defines the continuous lease watchdog behavior (v2.6). `enabled` enables the watchdog. `heartbeatIntervalSeconds` sets how often active leases write heartbeat files (default 15). `staleThresholdSeconds` sets how long without a heartbeat before a lease is considered stale (default 45 = 3x heartbeat interval). `monitorLoopIntervalSeconds` sets the watchdog poll interval (default 30). `stalePolicy` must be `quarantine_and_replace`. `reconciliationPrecedence` defines lease file vs worktree-state precedence: `wasRunning: lease_file`, `whatIsOnDisk: worktree_state`, `onDisagreement: quarantine_and_requeue`.
- **`planExecution.validationLane`**: Defines validation lane backpressure behavior (v2.6). `maxConcurrentHeavyValidations` (default 1). `maxConcurrentTargetedValidations` (default 3). `backpressureEnabled` enables the scheduler pre-filter. `backpressureStrategy` must be `prefer_targeted_when_heavy_saturated`. `schedulerFeedbackEnabled` enables lane state feedback to the scheduler.
- **`planExecution.integrationQueue.mergePriorityScorer`**: Defines the dynamic merge-priority scorer (v2.6). `enabled` enables runtime score computation at dequeue time. `formula` documents the scoring formula. `recomputeOnEachDequeue` must be `true`. `tiebreaker` must be `fifo`.
- **`planExecution.integrationQueue.queueOptimization`**: Configures queue optimization behavior. When `enabled`, the queue applies the selected `strategy` to reorder pending merges within safety constraints. Valid strategies: `priority_then_fifo` (priority first, then submission order), `critical_path_first` (critical-path workspaces merge first), `weighted_shortest_job_first` (smaller changes merge first within priority bands).
- **`planExecution.validation`**: Defines validation lock, targeted validation, final integration validation, and watch-mode restrictions.
- **`planExecution.planIntake`**: Defines plan-intake auto-analysis behavior. When `enabled`, plans uploaded to Pi are automatically normalized, doctored, DAG-analyzed, and optimized before execution. `runOnUpload` triggers analysis on upload. `parserPriority` specifies the order of JSON vs Markdown parsing. `autoNormalize` normalizes the contract. `autoDoctor` runs doctor validation. `autoDagAnalysis` recomputes DAG and safe batch preview. `autoOptimizationProposal` generates optimizer suggestions. `autoQueuePriorityRecommendation` recommends queue priorities. `autoWorkspaceSplitRecommendation` suggests workspace splits/merges. `autoDryRunForecast` generates a dry-run forecast. `approvalRequiredBeforeApplyingOptimization` and `approvalRequiredBeforeExecution` gate optimizer patches and execution behind approval.
- **`planExecution.optimizer`**: Defines the DAG optimizer behavior. `mode` must be `advisory_until_approved` — the optimizer may propose changes but never apply them without approval. `objectives` enumerate optimization goals such as `maximize_safe_effective_parallelism`, `minimize_critical_path`, `minimize_same_file_conflicts`, `minimize_validation_lock_contention`, and `prioritize_critical_path_queue_merges`. `allowedPatches` lists fields the optimizer may propose changing. `forbiddenAutoPatches` lists fields the optimizer must never propose changing.

---

### Parallelism Review Object

- **`requestedMaxParallelWorkspaces`**: Mirrors requested capacity.
- **`selectedScaleMode`**: Scale mode used for readiness checks.
- **`scaleModeReadiness`**: Readiness result for selected scale mode, including met prerequisites, warnings, and blocking reasons.
- **`expectedDagEffectiveParallelismMin`**: Author expectation for minimum useful DAG parallelism.
- **`expectedSafeEffectiveParallelismMin`**: Author expectation for minimum useful safe parallelism.
- **`dagEffectiveParallelism`**: The theoretical parallelism available from the dependency graph alone.
- **`safeEffectiveParallelism`**: The actual safe parallelism after applying P6 constraints such as worktree readiness, file overlap, symbol overlap, validation lock pressure, integration queue serialization, risk level, and scale-mode prerequisites.
- **`preflightStatus`**: One of `required`, `approved`, `not_required`, `failed`.
- **`approvalState`**: One of `pending`, `approved`, `rejected`, `stale`.
- **`batchingStrategy`**: Usually `dag_topological_batches`. **Advisory/display only** — scheduler uses continuous (batchless) scheduling.
- **`safeBatchingStrategy`**: Usually `dag_batches_with_p6_safety_constraints`. **Advisory/display only**.
- **`batchPreview`**: Computed preview of topological batches before execution. **Display only** — scheduler does not wait for batch completion.
- **`safeBatchPreview`**: Batch preview after P6 safety constraints are applied.
- **`optimizationReview`**: Records the DAG optimizer proposal state. Contains `originalGraphHash` (hash of the authored graph), `proposedGraphHash` (hash of the optimizer's proposed graph), `approvedGraphHash` (hash of the approved graph after user review), `originalDagEffectiveParallelism`, `proposedDagEffectiveParallelism`, `originalSafeEffectiveParallelism`, `proposedSafeEffectiveParallelism`, `criticalPathDelta` (change in critical path length), `serializedTailDelta` (change in serialized tail length), `suggestions` (array of optimizer suggestion objects), and `approvalState` (one of `pending`, `approved`, `rejected`, `stale`).
- **`editableFields`**: Fields the interactive editor may patch.
- **`doctorWarnings`**: Warning categories the doctor should surface.
- **`persistedArtifacts`**: Artifacts stored for audit and reproducibility.

---

### Batch Preview Fields

- **`batches`**: Array of batch objects.
- **`overallEffectiveParallelism`**: Weighted average DAG parallelism across all batches.
- **`criticalPath`**: Longest dependency chain through the DAG.
- **`criticalPathLength`**: Number of workspaces on the critical path.
- **`serializedTailLength`**: Number of trailing batches containing only one workspace.

---

### Safe Batch Preview Fields

- **`overallSafeEffectiveParallelism`**: Weighted average safe parallelism after P6 constraints.
- **`bottlenecks`**: Summary categories explaining why safe parallelism is lower than requested or lower than DAG parallelism.
- **`blockedParallelismReasons`**: Human-readable reasons why DAG-ready workspaces cannot safely run together.
- **`safeEffectiveParallelism`**: Per-batch safe concurrency.

---

### Workspace Parallelism Fields

- **`dependencies`**: Workspace IDs that must complete before this workspace can start.
- **`parallelGroup`**: Optional human-authored expected batch/group label. Advisory only; the DAG remains authoritative.
- **`dependencyReason`**: Human-readable explanation for why listed dependencies are required.

---

### Workspace Isolation / Integration / Validation Fields

- **`parallelism.expectedBatch`**: Human-authored expected safe execution batch.
- **`parallelism.canRunWith`**: Optional list of workspace IDs expected to be safe to run concurrently.
- **`parallelism.cannotRunWith`**: Optional list of workspace IDs that should not run concurrently because of file, symbol, validation, risk, or integration overlap.
- **`parallelism.conflictScope`**: File, package, or symbol areas that may conflict with other workspaces.
- **`parallelism.sameFileParallelismAllowed`**: Must normally be false. Same-file parallelism is disabled unless explicitly safe and approved.
- **`parallelism.safeParallelismNotes`**: Human-readable explanation for safe concurrency decisions.
- **`worktree.required`**: Whether this workspace requires isolated git worktree execution.
- **`worktree.isolationMode`**: `shared`, `worktree`, or `shared_or_worktree`.
- **`worktree.cleanupPolicy`**: Cleanup behavior such as `quarantine_on_failure`.
- **`integration.queueRequired`**: Whether this workspace must enter integration queue after successful local validation.
- **`integration.queuePriority`**: Priority level for this workspace in the integration queue. Valid values correspond to `integrationQueue.queuePriority.levels`. `critical` workspaces merge first, then `high`, then `normal` (default), then `low`. Critical-path workspaces that unblock downstream work should use `critical` or `high`.
- **`integration.queueOptimizationNotes`**: Human-readable rationale for the assigned queue priority. Explains why this workspace should merge earlier or later based on critical-path position, dependency depth, change size, or downstream impact.
- **`integration.requiresWorkspaceValidation`**: Whether workspace validation must pass before queue entry.
- **`integration.requiresIntegrationValidation`**: Whether integration validation must pass after merge.
- **`integration.conflictHandoffRequired`**: Whether merge conflicts must produce reviewable handoff artifacts.
- **`validation.profile`**: Validation approach such as `targeted_then_final`.
- **`validation.heavyCommandUsesGlobalLock`**: Whether heavy validation commands require the global validation lock.
- **`validation.canRunTargetedOnly`** (v2.6): Whether this workspace's validation profile never requires the global lock. Default `false`. When `true`, the scheduler may launch this workspace even when the heavy validation slot is saturated.
- **`validation.estimatedHeavyValidationSeconds`** (v2.6): Nullable integer estimating heavy validation duration in seconds. Not used by P23 scheduling logic, declared for future use.
- **`validation.watchModeForbidden`**: Must remain true for autonomous execution.
- **`parallelism.conflictScope.driftDetection`** (v2.6): Defines writeSet drift detection behavior. `enabled` enables post-execution comparison. `compareAfterExecution` runs `git diff --name-only` after workspace completion. `driftThresholdFiles` sets the number of undeclared files allowed before flagging (default 3). `onDriftDetected` must be `warn_and_flag_integration` (default) or `block_integration` (opt-in).
- **`integration.downstreamReadyCount`** (v2.6): Runtime-only field. Nullable integer set by the executor, counting workspaces that would become ready after this one merges. Must be null in authored plans.
- **`integration.criticalPathPosition`** (v2.6): Runtime-only field. Nullable integer set by the executor, indicating position on the critical path. Must be null in authored plans.
- **`integration.driftFlagged`** (v2.6): Runtime-only field. Nullable boolean set when empirical writeSet drift exceeds the threshold.
- **`integration.requiresHumanReview`** (v2.6): Runtime-only field. Nullable boolean set when drift triggers `warn_and_flag_integration` mode.

---

## Validation Rules

Pi's `doctor` command validates the execution contract against these rules:

1. JSON must be syntactically valid.
2. `contractVersion` must be present and valid. For v3.0 repair plans, `contractVersion` must be `"3.0.0"`.
3. `project.name` must be non-empty.
4. `project.rootPath` must be valid.
5. `executionBackend` must be `postgres` or `json`.
6. `planExecution.stateBackend` must be `postgres` or `json`.
7. All workspace IDs must be unique.
8. All dependency references must point to existing workspaces.
9. Dependency graph must be acyclic.
10. `planExecution.scale.selectedMode` must be one of `stable_3`, `experimental_6`, or `scale_8`.
11. `maxParallelWorkspaces` must not exceed the maximum allowed by selected scale mode.
12. If `selectedMode` is `stable_3`, `maxParallelWorkspaces` must be between 1 and 3.
13. If `selectedMode` is `experimental_6`, `maxParallelWorkspaces` must be between 1 and 6.
14. If `selectedMode` is `scale_8`, `maxParallelWorkspaces` must be between 1 and 8.
15. If `maxParallelWorkspaces` is greater than 3, worktree isolation must be enabled and ready.
16. If `maxParallelWorkspaces` is greater than 3, integration queue must be enabled and ready.
17. If `maxParallelWorkspaces` is greater than 3, global validation lock must be enabled.
18. If selected mode is `experimental_6`, archive and completion gate hardening must be enabled.
19. If selected mode is `scale_8`, dogfood pass and explicit approval must be present.
20. If worktree isolation is disabled, `maxParallelWorkspaces` must not exceed 3.
21. If integration queue is disabled, `experimental_6` and `scale_8` are invalid.
22. `autoPush` must be false by default.
23. Forbidden commands and files must include required safety patterns.
24. No unresolved placeholders may remain.
25. If `preflightRequired` is true, execution is blocked until approval.
26. If approval graph hash is stale, execution is blocked.
27. If effective DAG parallelism is below requested parallelism, doctor must warn.
28. If effective DAG parallelism is 1 while requested max is greater than 1, doctor must emit a strong serialization warning.
29. If `safeEffectiveParallelism` is lower than `dagEffectiveParallelism`, doctor must show bottleneck reasons.
30. If scale-mode prerequisites are missing, doctor must block unsafe scale modes.
31. Dependency patch previews must reject cycles, missing workspaces, and invalid file-overlap claims.
32. If `batchPreview` is present, `batches` must be a non-empty array where each element contains `batch`, `workspaceIds`, and `effectiveParallelism`.
33. If `safeBatchPreview` is present, `batches` must show safe concurrency and blocked parallelism reasons where applicable.
34. If `preflightStatus` is `approved`, the accompanying `batchPreview` must not contain empty batches.
35. If merge conflict handoff is required but no handoff artifact can be produced, execution must stop.
36. If integration validation fails, execution must stop.
37. If integration queue is dirty, the next plan must not start.
38. If worktree cleanup path escapes `.pi/worktrees`, execution must stop.
39. If raw destructive cleanup is requested, execution must stop.
40. If watch-mode validation command is present, execution must stop.
41. `git push` must remain forbidden in every mode.
42. Dashboard controls must not directly mutate execution state.
43. Executor must remain the source of truth for state transitions after promotion.
44. If `queueOptimization.enabled` is true, `queueOptimization.strategy` must be one of the supported strategies.
45. If `queuePriority.enabled` is true, each workspace `integration.queuePriority` must be one of the configured `queuePriority.levels`.
46. If `queuePriority.enabled` is true, workspaces without an explicit `queuePriority` must use `queuePriority.defaultLevel`.
47. If `queueOptimization.enabled` is true and a workspace has `queueOptimizationNotes`, the notes must be non-empty and relevant to queue ordering.
48. Queue priority must not affect validation requirements: `requiresWorkspaceValidation` and `requiresIntegrationValidation` must be honored regardless of priority.
49. If `queueOptimization.enabled` is false but `queuePriority.enabled` is true, doctor must warn that priority metadata exists but no optimization strategy is active.
50. If `queueOptimization.strategy` is `critical_path_first`, the critical path must be computed from the approved dependency graph; workspaces on the critical path must be identifiable.
51. If queue optimization is enabled and queue configuration changes mid-execution, the change must be validated before taking effect.
52. If `planExecution.scheduling.continuous` is `true` (default), the scheduler MUST NOT use batch barriers. All `maxParallelWorkspaces` slots must be filled immediately and refilled as workspaces complete.
53. Batch previews (`batchPreview`, `safeBatchPreview`) are advisory/display only when continuous scheduling is enabled. The scheduler must not wait for batch completion.
54. If `planExecution.scheduling.slotCount` is set, the worktree pool must prewarm that many slots at plan start.

### v3.0 Repair Validation Rules

55. `contractVersion` must be `3.0.0` for v3.0 execution contracts.
56. `executionClass` must be one of `"implementation"`, `"repair"`, or `"verification"`.
57. If `executionClass` is `"repair"`, `executionAutomation.autonomousExecutionEnabled` MUST be `false` unless all required promotion gates have passed.
58. If `executionAutomation.autonomousExecutionEnabled` is `false`, `repairMode.schedulerRuntimeUse` MUST be `"disabled_until_promotion"`.
59. If `executionAutomation.agentMayMutateRepo` is `false`, no workspace may require autonomous mutation.
60. If `executionAutomation.agentMayRunCommands` is `false`, no workspace may require autonomous command execution.
61. Repair workspace MUST include `rollbackRequired`, `targetedValidationRequired`, and `humanApprovalRequired` metadata.
62. LLM runtime (`llmRuntime` or `boundedLiveness.llm`) MUST include `providerRequestTimeoutMs` and `streamIdleTimeoutMs`.
63. Validation runtime (`validationRuntime` or `boundedLiveness.validation`) MUST include `timeout`, `processGroupRequired`, `killTreeOnTimeout`, `maxOutputBytes`, `ciEnvRequired`, `stdinClosed`, and `watchModeForbidden`.
64. Git lock bypass (`boundedLiveness.git.lockBypassForbidden`) MUST be `true`.
65. State store MUST use transactions or write queue (`boundedLiveness.stateStore.transactionOrWriteQueueRequired` must be `true`).
66. Promotion to `stable_1` requires `executor_isolation_passed` and `abort_signal_chain_passed` gates.
67. Promotion to `stable_3` requires `validation_hang_kill_passed`, `git_serialization_stress_passed`, `state_store_concurrency_passed`, and `crash_recovery_passed` gates.
68. Promotion to `stable_6` requires `stable_3_dogfood_passed` and `stable_6_stress_passed` gates.
69. Repair plans MUST NOT be run via autonomous plan execution (`pi plan run`). Any attempt to run a repair plan autonomously is a hard stop.
70. If `executionClass` is `"repair"` and `autonomousExecutionEnabled` is `false`, `planExecution.scheduling.continuous` MUST be `false`.

---

## Persistence Mapping

Markdown plans map to the PostgreSQL database hierarchy:

```text
Project → Plan Execution → Workspace Execution → Journal Events / Workspace Logs
```

v2.2.0 additionally persists:

```text
Plan Execution → Parallelism Review → Dependency Graph → Batch Preview → Approved Patch / Graph Hash
```

v2.3.0 additionally persists:

```text
Plan Execution → Scale Mode Readiness
Plan Execution → Worktree Status Snapshot
Plan Execution → Integration Queue Snapshot
Plan Execution → Safe Batch Preview
Plan Execution → Merge Conflict Handoff Artifacts
Workspace Execution → Worktree Metadata
Workspace Execution → Integration Queue Entry
Workspace Execution → Validation Profile / Lock Usage
```

v2.3.1 additionally persists:

```text
Plan Execution → Queue Priority Snapshot
Plan Execution → Queue Optimization Strategy / State
Workspace Execution → Queue Priority Assignment
Workspace Execution → Queue Optimization Notes
```

v3.0 additionally persists:

```text
Plan Execution → Repair Checkpoint
Plan Execution → Promotion Gate Result
Plan Execution → Dogfood Matrix Result
Plan Execution → LLM Timeout / Circuit Breaker Events
Plan Execution → State Write Serialization Evidence
Workspace Execution → Manual Patch Approval
Workspace Execution → Patch Review Record
Workspace Execution → Rollback Artifact
Workspace Execution → Targeted Validation Artifact
Workspace Execution → Validation Process Kill Record
Workspace Execution → Git Lock Timeout / Quarantine Record
```

The `batchPreview` object is persisted with the plan execution so audit trails show the exact DAG batch decomposition that was reviewed and approved.

The `safeBatchPreview` object is persisted so audit trails also show the exact P6-constrained execution batch decomposition.

The executor must use the approved dependency graph and must also verify current scale-mode readiness before starting workspaces. If the approved graph is current but scale-mode readiness has become stale or invalid, execution must stop before any workspace starts. For repair plans, the execution contract is a **validation contract** — the executor does not start workspaces autonomously; instead, repair actions are coordinated through the manual patch protocol.

---

## Control Model

Pause, stop, cancel, and resume remain executor-mediated. The dashboard may request control actions, but the executor remains the only component that mutates execution state after promotion.

**For repair plans**:
- Dashboard may request repair actions (e.g., propose patch, approve patch, rollback) but must NOT directly mutate execution state.
- **In repair mode, human patch application is the source of truth.** No automated component may bypass human review and approval.
- Executor state mutation remains disabled until promotion gate permits it.
- Promotion is executor-validated and human-approved.

Interactive parallelism approval is executor-validated. The UI can submit approval, but execution starts only after the executor verifies that the approved graph is current, acyclic, and within safety limits.

Scale-mode readiness is also executor-validated. The dashboard can show and request scale settings, but it cannot bypass prerequisites.

Integration queue controls are executor-mediated. The dashboard may request pause/resume/cleanup/retry actions, but the executor must validate safety before mutating queue state.

Queue optimization controls are executor-mediated. The dashboard may display queue priority and optimization strategy, but the executor must validate consistency and safety before applying reorder decisions. Priority-based reordering must not bypass safety checks, and the executor must enforce that validation gates are satisfied regardless of priority level.

---

## Parser Priority

For v3.0:
1. Part 3 JSON first.
2. `contractVersion` and `executionClass` validation.
3. Repair-mode safety validation.
4. Known broken subsystem gate.
5. Bounded liveness validation.
6. Manual patch protocol validation.
7. Promotion gate validation.
8. Doctor validation.
9. Execution gate only if `autonomousExecutionEnabled` is true and promotion permits it.

For v2.x backward compatibility:
1. Part 3 JSON first.
2. Markdown heading fallback only as recovery mode.
3. Doctor validation.
4. Parallelism preflight if required.
5. Approval gate if required.
6. Scale-mode readiness gate.
7. Worktree/integration readiness gate.
8. Queue optimization readiness gate.
9. Execution gate.

---

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "3.0.0",
  "phase": "{{ Phase ID }}",
  "title": "{{ Phase Title }}",
  "executionClass": "repair",
  "executionAutomation": "disabled",
  "selectedRepairMode": "manual_1",
  "targetPromotionMode": "stable_6",
  "autonomousExecutionAllowed": false,
  "agentMayMutateRepo": false,
  "schedulerRuntimeUse": "disabled_until_promotion",
  "primaryGoal": "{{ One sentence summary of the phase goal }}",
  "projectName": "{{ project_name }}",
  "stateBackend": "postgres",
  "selectedScaleMode": "stable_3",
  "maxParallelWorkspaces": 1,
  "requiresWorktreeIsolation": false,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "priority_then_fifo",
  "continuousScheduling": false,
  "continuousSlotCount": 1,
  "safeEffectiveParallelismTarget": 1,
  "notInScope": [
    "{{ Thing explicitly not in scope }}"
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
    "queue_priority_invalid_level",
    "autonomous_execution_requested_during_repair_mode",
    "promotion_gate_failed_or_missing"
  ],
  "completionGate": "{{ P26 complete only when all repair and promotion gates pass }}",
  "nextPhase": "{{ Next Phase ID or null }}"
}
```

---

# Annex — v2.2.0 Worked Example: Three-Wide Parallel Batches

```text
Batch 1: 7.A
Batch 2: 7.B, 7.C, 7.D
Batch 3: 7.E, 7.F
Batch 4: 7.G
```

The following workspace snippets encode actual DAG dependencies that permit the batch plan above:

```json
[
  {
    "id": "7.A",
    "dependencies": [],
    "parallelGroup": "batch_1",
    "dependencyReason": "7.A provides the foundation."
  },
  {
    "id": "7.B",
    "dependencies": ["7.A"],
    "parallelGroup": "batch_2",
    "dependencyReason": "7.B builds on the foundation 7.A provides."
  },
  {
    "id": "7.C",
    "dependencies": ["7.A"],
    "parallelGroup": "batch_2",
    "dependencyReason": "7.C requires 7.A output as input."
  },
  {
    "id": "7.D",
    "dependencies": ["7.A"],
    "parallelGroup": "batch_2",
    "dependencyReason": "7.D extends scaffolding from 7.A."
  },
  {
    "id": "7.E",
    "dependencies": ["7.B", "7.C"],
    "parallelGroup": "batch_3",
    "dependencyReason": "7.E needs 7.B and 7.C artifacts."
  },
  {
    "id": "7.F",
    "dependencies": ["7.C", "7.D"],
    "parallelGroup": "batch_3",
    "dependencyReason": "7.F needs 7.C and 7.D artifacts."
  },
  {
    "id": "7.G",
    "dependencies": ["7.E", "7.F"],
    "parallelGroup": "batch_4",
    "dependencyReason": "7.G integrates 7.E and 7.F output."
  }
]
```

The corresponding `parallelismReview` object:

```json
{
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 3,
    "expectedDagEffectiveParallelismMin": 2,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "batchPreview": {
      "batches": [
        { "batch": 1, "workspaceIds": ["7.A"], "effectiveParallelism": 1 },
        { "batch": 2, "workspaceIds": ["7.B", "7.C", "7.D"], "effectiveParallelism": 3 },
        { "batch": 3, "workspaceIds": ["7.E", "7.F"], "effectiveParallelism": 2 },
        { "batch": 4, "workspaceIds": ["7.G"], "effectiveParallelism": 1 }
      ],
      "overallEffectiveParallelism": 1.75,
      "criticalPath": ["7.A", "7.C", "7.E", "7.G"],
      "criticalPathLength": 4,
      "serializedTailLength": 1
    },
    "doctorWarnings": [
      "effective_parallelism_below_requested"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "critical_path",
      "approved_dependency_patch"
    ]
  }
}
```

Key observations:

- Batch 2 achieves full 3-wide parallelism.
- Batch 3 is 2-wide.
- Batches 1 and 4 are 1-wide.
- Overall effective parallelism is 1.75.
- The critical path spans four batches.
- Execution is blocked until review approval if `preflightRequired` is true.

Do **not** encode this as a chain unless each workspace truly depends on the previous one:

```json
[
  { "id": "7.A", "dependencies": [] },
  { "id": "7.B", "dependencies": ["7.A"] },
  { "id": "7.C", "dependencies": ["7.B"] },
  { "id": "7.D", "dependencies": ["7.C"] }
]
```

That graph has effective parallelism 1 even if `maxParallelWorkspaces` is 3.

---

# Annex — v2.3.0 Worked Example: Experimental 6 with Safe Effective Parallelism

This example shows why DAG parallelism and safe effective parallelism can differ.

```text
Requested max workers: 6
Selected scale mode: experimental_6
DAG batch width: 5
Safe batch width: 3
Reason: validation lock pressure and overlapping conflict scopes reduce safe parallelism.
```

Example interpretation:

- The dependency graph permits five workspaces to run together.
- Worktree isolation is enabled, so separate file edits are safer.
- Integration queue is enabled, so merges are serialized after workspace validation.
- Two workspaces touch overlapping scheduler files, so they cannot safely run together.
- One workspace requires heavy validation, so the scheduler limits concurrency while the global validation lock is busy.
- The safe batch preview therefore runs three workspaces at once instead of five.

```json
{
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 6,
    "selectedScaleMode": "experimental_6",
    "dagEffectiveParallelism": 5,
    "safeEffectiveParallelism": 3,
    "scaleModeReadiness": {
      "ready": true,
      "blockedReasons": [],
      "warnings": [
        "Integration queue serializes merges after workspace completion."
      ]
    },
    "batchPreview": {
      "batches": [
        { "batch": 1, "workspaceIds": ["7.A"], "effectiveParallelism": 1 },
        { "batch": 2, "workspaceIds": ["7.B", "7.C", "7.D", "7.E", "7.F"], "effectiveParallelism": 5 },
        { "batch": 3, "workspaceIds": ["7.G"], "effectiveParallelism": 1 }
      ],
      "overallEffectiveParallelism": 2.33,
      "criticalPath": ["7.A", "7.C", "7.G"],
      "criticalPathLength": 3,
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": ["7.A"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": ["7.B", "7.C", "7.D"],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": [
            "7.E conflicts with 7.B conflictScope",
            "7.F delayed because validation lock pressure is high"
          ]
        },
        {
          "batch": 3,
          "workspaceIds": ["7.E", "7.F"],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": ["7.G"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        }
      ],
      "overallSafeEffectiveParallelism": 1.75,
      "bottlenecks": [
        "file_overlap_blocks_parallelism",
        "validation_lock_limits_parallelism",
        "integration_queue_serializes_merges"
      ],
      "blockedParallelismReasons": [
        "Some DAG-ready workspaces are delayed because P6 safety constraints reduce safe concurrency."
      ]
    }
  }
}
```

Do not treat `dagEffectiveParallelism` as permission to run that many workers. The executor must use `safeEffectiveParallelism` and scale-mode readiness when deciding actual concurrent workspace execution.

---

## Template Changelog

### v3.0.0 (2026-05-25)

- **Major semantic migration**: From "autonomous implementation plan template" to "repair/recovery/execution-correctness template".
- **Title changed** to "Repair & Execution Correctness Template v3.0".
- **Added `executionClass`**: Plans must declare `"implementation"`, `"repair"`, or `"verification"`.
- **Repair-first semantics**: Plans default to `executionClass: "repair"` with autonomous execution disabled.
- **Added `executionAutomation`**: Controls for `autonomousExecutionEnabled`, `agentMayMutateRepo`, `agentMayRunCommands`, `manualPatchApplicationRequired`, `humanApprovalRequiredForEveryPatch`.
- **Added `repairMode`**: Selected repair mode, target promotion mode, scheduler runtime use, and reason.
- **Added `knownBrokenSubsystems`**: Registry of known broken subsystems blocking autonomous execution.
- **Added `boundedLiveness`**: LLM, validation, git, scheduler, and state store timeout/contract fields.
- **Added `llmRuntime`**: Provider request timeout, stream idle watchdog, circuit breaker, fallback policy.
- **Added `validationRuntime`**: Managed runner, process group, kill tree, output cap, forbidden interactive commands, lanes.
- **Added `manualPatchProtocol`**: One patch at a time, human review, rollback, targeted validation, checkpoint.
- **Added `promotionGates`**: 8-gate promotion ladder with `requiredFor` per mode and status tracking.
- **Added `dogfoodMatrix`**: Required stress scenarios for promotion to `stable_6`.
- **Added v3.0 repair workspace metadata**: `manualApplicationRequired`, `humanApprovalRequired`, `autonomousExecutionAllowed`, `rollbackRequired`, `targetedValidationRequired`, `patchReview`.
- **Added v3.0 safety hard stops**: 20 new hard stops for repair-mode safety, bounded liveness, git lock, state store serialization, promotion gates, and missing repair workspace metadata.
- **Added v3.0 persisted artifacts**: Repair checkpoint, manual patch approval, patch review record, rollback artifact, targeted validation artifact, promotion gate result, dogfood matrix result, LLM timeout/circuit-breaker events, validation process kill record, git lock timeout/quarantine record, state write serialization evidence.
- **Added v3.0 validation rules** (55-70): contractVersion, executionClass, repair-mode safety, bounded liveness, promotion gates, and autonomous execution prohibition.
- **Updated execution policies YAML**: Added `repair_modes`, `execution_automation`, `bounded_liveness` sections.
- **Updated parser priority**: Repair-mode safety, known broken subsystem gate, bounded liveness, manual patch protocol, promotion gate take precedence before execution gate.
- **Updated control model**: Human patch application is source of truth in repair mode; executor state mutation disabled until promotion.
- **Updated Part 1 fields**: Added repair class, execution automation, repair mode, promotion gate status fields.
- **Default values changed for repair**: `scheduling.continuous: false`, `slotCount: 1`, `autoCommit: false`, `autoPush: false`, `scale.defaultMode: "stable_3"`.
- **Promotion ladder**: `manual_0 -> manual_1 -> assisted_1 -> stable_1 -> stable_3 -> stable_6 -> scale_8`.
- **contractVersion** updated to `3.0.0`.

### v2.4.0 (2026-05-16)

- Added plan-intake auto-analysis and DAG optimizer support (`planExecution.planIntake`, `planExecution.optimizer`).
- Added `parallelismReview.optimizationReview` with original/proposed graph hashes, diffs, and approval state.
- Added auto-normalize, auto-doctor, auto-DAG-analysis, auto-optimization-proposal, and auto-dry-run settings.
- Added optimizer objectives, allowed patches, and forbidden auto-patches.
- Authored batch previews are now explicitly advisory. The computed and approved graph is authoritative.
- Added hard stops: `execution_without_dry_run`, `execution_without_approval`, `protected_system_mutation_without_explicit_approval`, `extension_permission_denied`, `skill_permission_denied`, `memory_forbidden_source_indexing`, `optimizer_patch_without_approval`.
- Added doctor warnings for optimizer, extension, skill, and memory violations.
- Added persisted artifacts for plan-intake analysis, optimizer proposal, graph diffs, registry snapshots, memory index snapshots, and platform audit timeline.
- Default scale mode remains `experimental_6`.
- Worktree isolation remains enabled by default.
- Updated `contractVersion` to `2.4.0`.

### v2.3.1 (2026-05-14)

- Added queue priority metadata: enabled toggle, default level, and configurable levels (`critical`, `high`, `normal`, `low`).
- Added queue optimization guidance: enabled toggle, strategy selection (`priority_then_fifo`, `critical_path_first`, `weighted_shortest_job_first`).
- Added `integrationQueue.queuePriority` and `integrationQueue.queueOptimization` at plan level.
- Added `workspaces[].integration.queuePriority` and `workspaces[].integration.queueOptimizationNotes` at workspace level.
- Added queue optimization execution policies with priority level descriptions.
- Added validation rules for queue priority consistency, strategy validity, and optimization safety invariants.
- Added doctor warnings for queue optimization misconfigurations.
- Added editable fields for queue priority and optimization notes.
- Added persisted artifacts for queue priority snapshots and reorder decision logs.
- Updated all `contractVersion` references to `2.3.1`.
- Preserved v2.3.0 scale mode, worktree isolation, integration queue, validation lock, and safe effective parallelism semantics intact.

### v2.3.2 (2026-05-15)

- Default scale mode changed from `stable_3` to `experimental_6`.
- Default worktree isolation changed from disabled to enabled (`enabledByDefault: true`).
- Updated `contractVersion` to `2.3.2`.
- P6 worktree isolation, integration queue, merge conflict detection, dynamic scheduler, scale mode policy, and dashboard controls are all implemented and tested.

### v2.3.0 (2026-05-14)

- Added P6 scale-aware isolated execution support.
- Added `planExecution.scale`, `planExecution.worktree`, `planExecution.integrationQueue`, and `planExecution.validation`.
- Added scale modes: `stable_3`, `experimental_6`, and `scale_8`.
- Replaced fixed 3-worker cap with scale-mode-aware worker validation.
- Added safe effective parallelism in addition to DAG effective parallelism.
- Added `safeBatchPreview` and scale-mode readiness metadata.
- Added workspace-level `parallelism`, `worktree`, `integration`, and `validation` fields.
- Added validation rules for worktree isolation, integration queue, validation lock, merge conflict handoff, queue cleanliness, and scale-mode approval.
- Added persistence mapping for worktree status, integration queue snapshots, safe batch preview, and merge conflict handoff artifacts.
- Preserved v2.2.0 interactive parallelism review as the foundation.

### v2.2.0 (2026-05-13)

- Added interactive parallelism review.
- Added `planExecution.interactiveParallelismReview`.
- Added top-level `parallelismReview` metadata with `batchPreview` sub-object.
- Added workspace-level `parallelGroup` and `dependencyReason` fields.
- Added validation rules for effective parallelism, approval gates, stale graph hashes, and dependency patches.
- Added persistence mapping for dependency graph, batch preview, approved patch, and graph hash.
- Added worked example showing actual 3-wide batches versus accidental serialization.

### v2.1.0 (2026-05-11)

- PostgreSQL-backed multi-project execution contract added.
- Renamed Part 3 to Machine-Readable Execution Contract.
- Added `contractVersion`, `executionBackend`, `project`, `planExecution`, `controls`, and `safety` top-level fields.
- Added `telemetry` field to workspace configuration.
- Added persistence mapping section explaining database hierarchy.
- Added control model section explaining executor-only state mutations.
- Updated validation rules for PostgreSQL execution.
- Updated parser priority to mandate Part 3 JSON for PostgreSQL execution.
- Updated Part 4 with `contractVersion`, `projectName`, and `stateBackend` fields.

### v2.0 (2026-05-11)

- Added Part 3 — Machine-Readable Workspace Queue.
- Added Part 4 — Machine-Readable Summary.
- Added comprehensive field definitions and validation rules.
- Added parser priority rules.
- Moved worked example to Annex.
- Established JSON as machine execution source while preserving Markdown as human authority.

### v1.0 (2026-05-10)

- Initial Master Template structure.
- Part 1 — Phase Plan.
- Part 2 — Agent Brief.
- Markdown-only format.

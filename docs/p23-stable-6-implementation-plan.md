# P23 — Stable 6: Git Serialization, Lease Hardening, and Execution Correctness

**Template Version:** 2.5.1
**Last Updated:** 2026-05-24
**Contract Version:** 2.6.0

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P23
**One-line goal:** Harden `experimental_6` into `stable_6` by centralizing all Git operations through GitRunner, adding a continuous lease watchdog, backpressure-aware validation scheduling, empirical writeSet drift detection, and a dynamic integration queue merge-priority scorer.
**Why now:** `experimental_6` is the current default but its Git mutation layer is distributed across six files with no shared mutex, lease recovery is restart-triggered only, validation lane pressure is invisible to the scheduler, and writeSet conflict detection relies entirely on author declarations that rot. These are correctness gaps — not performance gaps — that will cause silent data corruption or require manual intervention under sustained 6-worker load.
**Blast radius:** `worktree-manager.ts`, `workspace-scheduler.ts`, `integration-queue.ts`, `validation-lock.ts`, `worktree-workspace-executor.ts`, `autonomous-executor.ts`, `cleanup-review.ts`, `scale-routes.ts`, `production-readiness-doctor.ts`, `workspace-schema.ts`, five dashboard components (`IntegrationQueuePanel`, `WorktreeStatusPanel`, `SchedulerStatusPanel`, `WorkerDetail`, `PlanSummaryPanel`), and the master template.
**Rollback path:** All GitRunner changes are additive wrapping — existing callers can be reverted to direct `execAsync` calls independently per file. Lease monitor is opt-in via `leaseMonitor.enabled` config flag. writeSet drift detection defaults to `warn` mode, not `block`, so it cannot halt execution on first deploy.
**Scale mode:** `experimental_6`
**Safe parallelism target:** 3 (W3, W4, W5 run simultaneously after W2 completes)
**Done when:** Stress test passes — 6 workers, forced mid-plan crash, zero manual intervention, full recovery, no Git lock corruption, drift detection fires correctly on a synthetic writeSet mismatch.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P23 |
| Title | Stable 6: Git Serialization, Lease Hardening, and Execution Correctness |
| Status | Planned |
| Last updated | 2026-05-24 |
| Delivery status | Not started |
| Target environment | Local |
| Primary focus | Execution infrastructure correctness and crash safety |
| Product-code changes | Allowed |
| Selected scale mode | `experimental_6` |
| Requested max workers | 6 |
| Expected DAG effective parallelism | 3 |
| Expected safe effective parallelism | 3 |
| Worktree isolation | Required |
| Integration queue | Required |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| W1 — GitRunner | Agent | Lead | Architect | Team |
| W2 — WorktreePool v2 + Lease Monitor | Agent | Lead | Architect | Team |
| W3 — Integration Queue Merge-Priority Scorer | Agent | Lead | Architect | Team |
| W4 — Validation Lane Backpressure | Agent | Lead | Architect | Team |
| W5 — writeSet Drift Detection | Agent | Lead | Architect | Team |
| W6 — Dashboard Extensions | Agent | Lead | UX | Team |
| W7 — Template v2.6.0 + Schema v2.6.0 | Agent | Lead | Architect | Team |
| W8 — Stress Test + Dogfood | Agent | Lead | QA | Team |

---

## 2. Purpose

P23 promotes `experimental_6` to `stable_6` by fixing the correctness gaps that make 6-worker execution unsafe under real conditions. The current system has the right primitives — worktrees, integration queue, validation lock, continuous scheduling — but the layer connecting them is fragile in three specific ways.

**Git mutation is uncoordinated.** The recent commits converting `execSync` to `execAsync` in `scale-routes.ts` and `production-readiness-doctor.ts` were patches on a symptom. The underlying problem is that no single layer owns git subprocess calls. At least six files call `execAsync('git ...')` directly with no shared serialization. Under 6-worker load, `git worktree add` from the pool and `git commit` from a workspace executor can interleave. Git's own lock files (`.git/index.lock`, `.git/worktrees/{id}/index.lock`) become the de facto serialization mechanism, which produces confusing, hard-to-reproduce errors. The fix is `GitRunner`: a centralized layer that classifies every git operation as repo-wide mutation, per-worktree mutation, or read-only, then acquires the appropriate mutex before calling git.

**Lease recovery requires a server restart.** The current `.pi/scheduler/leases/` design writes on acquire and deletes on release. If a worker process dies without releasing its lease, the lease file persists indefinitely. The lease monitor in `resumeStrandedExecutions()` only runs on restart — a hanging worker that doesn't crash the server keeps its stale lease forever. The fix is a background watchdog loop running every 30 seconds that checks heartbeat age against a configurable staleness threshold and quarantines stale leases automatically. When lease-file state and worktree-state disagree on recovery, an explicit precedence rule resolves it: lease file is ground truth for "was running," worktree-state is ground truth for "what's on disk," and disagreement triggers quarantine-and-requeue.

**writeSet declarations rot.** The `conflictScope` / `writeSet` fields in plan JSON are author-maintained. A workspace might declare it writes to `src/scheduler/` but also generate files in `src/types/generated/` as a side effect. When this happens, conflict detection has a false negative — two workspaces that should have been serialized run in parallel and produce a merge conflict. The fix is empirical writeSet recording: the worktree executor captures `git diff --name-only` post-execution and compares it against the declared writeSet. Drift beyond a configurable threshold (`driftThresholdFiles: 3`) flags the integration queue entry for human review rather than auto-merging. Over multiple runs, empirical writeSets feed back into `autoOptimizationProposal` to improve future plans.

The dynamic integration queue merge-priority scorer and validation lane backpressure are throughput improvements that are safe to ship once the correctness foundations above are solid.

---

## 3. What Carried Over — Must Stay Stable

* [ ] All existing worktree isolation behavior — worktrees remain under `.pi/worktrees`, path scope enforcement remains active.
* [ ] Integration queue one-merge-at-a-time invariant — GitRunner does not change merge serialization.
* [ ] Global validation lock — remains required for heavy validation commands.
* [ ] Completion gate hardening — remains active.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden in every scale mode.
* [ ] Raw destructive cleanup (`rm -rf`) remains forbidden in every scale mode.
* [ ] Watch-mode validation remains forbidden.
* [ ] The executor remains the only component that mutates execution state.
* [ ] `resumeStrandedExecutions()` on server restart remains as a secondary recovery path even after the watchdog is added — both paths must coexist.
* [ ] writeSet drift detection defaults to `warn` mode on first deploy — it must not block integration queue entries until the empirical data is trusted.
* [ ] All existing `DynamicParallelScheduler` priority scoring logic remains unchanged — W4 adds a backpressure input signal, it does not replace the existing scorer formula.
* [ ] `WorkspaceScheduler` v1 remains available as a fallback for `stable_3` mode plans.

---

## 4. Background / What Was Wrong

The `experimental_6` mode was built incrementally across P6, P6.5, and several hotfix commits. Each phase added the right primitive for its scope but left integration seams between primitives unaddressed.

The `execSync` → `execAsync` conversions in commits `dc5bd8f73` and `02cf69cbb` fixed the most visible symptom but not the cause. Git calls are still scattered across `worktree-manager.ts`, `cleanup-review.ts`, `scale-routes.ts`, `production-readiness-doctor.ts`, `scale-readiness-doctor.ts`, and `worktree-workspace-executor.ts`. Each file acquired its own ad-hoc async pattern. There is no shared mutex, no operation classification, and no single place to add repo-wide vs per-worktree serialization.

The lease system was designed for crash recovery on restart, which was appropriate for the single-worker era. At 6 workers, a hung process that doesn't crash the server is a normal failure mode, not an edge case. The 30-second background watchdog converts this from a manual-restart problem into an automatic-quarantine problem.

The `conflictScope` / `writeSet` fields were added in the P6.5 schema (`hardDeps`, `softDeps`, `readSet`, `writeSet`) with the right intent. The problem is that they are static — authored once, never verified against actual execution. Empirical recording closes this loop and makes the conflict detection system self-correcting over time.

---

## 5. Current Failure State / Known Blockers

* `git_runner` = not implemented — all git calls are direct `execAsync` in six different files
* `lease_watchdog` = not implemented — recovery only fires on server restart
* `lease_reconciliation_precedence` = implicit — no documented rule for lease-file vs worktree-state disagreement
* `merge_priority_scorer` = not implemented — integration queue uses static `queuePriority` only, no runtime recomputation
* `validation_lane_backpressure` = not implemented — scheduler launches workspaces without checking validation lane saturation
* `empirical_write_set` = not implemented — conflict detection is entirely declaration-based
* `write_set_drift_detection` = not implemented
* `worktree_isolation` = enabled, operational
* `integration_queue` = enabled, operational
* `scale_mode_readiness` = ready for `experimental_6`
* `safe_effective_parallelism` = computed but not accounting for validation lane pressure

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GitRunner mutex causes deadlock if callers hold locks while calling git | low | critical | GitRunner acquires mutex internally; callers must not hold external locks during git calls. Lint rule added to enforce this. |
| Watchdog quarantines a live lease due to heartbeat writer delay under load | low | high | Stale threshold set to 3× heartbeat interval (45s vs 15s). Quarantine is reversible — workspace requeues, not discarded. |
| Lease-file vs worktree-state reconciliation precedence causes valid work to be re-queued | med | med | Re-queued workspaces are idempotent (git worktree is clean). Doctor warns on reconciliation events. Dashboard shows quarantine count. |
| Empirical writeSet recording misses files written by subprocesses of the agent | med | med | Record via `git diff --name-only` in the worktree after agent exits — captures all file changes regardless of how they were written. |
| Drift detection blocks the integration queue on false positives | low | high | Drift detection defaults to `warn` not `block`. Threshold is configurable. `block` mode requires explicit opt-in per plan. |
| Dynamic merge-priority scorer recomputes to a stale value if graph changes mid-execution | low | med | Scorer recomputes on every dequeue, not on enqueue. Reads live workspace state at dequeue time. |
| Validation lane backpressure starves workspaces that only need targeted validation | low | med | Backpressure only defers workspaces needing `heavyCommandUsesGlobalLock: true`. Targeted-only workspaces are unaffected. |
| Worktree path escapes `.pi/worktrees` | low | critical | Path scope checks enforced in GitRunner before every per-worktree operation. |
| Integration queue merges unvalidated diff | med | high | Validation requirements enforced regardless of merge priority score. |
| Cleanup deletes wrong files | low | critical | Raw destructive cleanup forbidden. Scoped cleanup only. |

---

## 7. Workstreams

### W1 — GitRunner: Centralized Git Operation Layer

**Goal:** Create a single `GitRunner` class that owns all git subprocess calls, classifies operations by mutation scope, and enforces the correct mutex before every git call.

**Requirements:**
* All git calls across `worktree-manager.ts`, `cleanup-review.ts`, `scale-routes.ts`, `production-readiness-doctor.ts`, `scale-readiness-doctor.ts`, and `worktree-workspace-executor.ts` must be migrated to `GitRunner`.
* Operations must be classified into three categories: `read_only` (no mutex), `per_worktree_mutation` (per-worktree mutex keyed by `workspaceId`), `repo_wide_mutation` (single repo mutex).
* `repo_wide_mutation` operations: `git worktree add`, `git worktree remove`, `git worktree prune`, `git fetch`, `git gc`, branch create/delete, integration merge, shared ref mutation.
* `per_worktree_mutation` operations: `git add`, `git commit`, `git reset`, `git checkout`, `git status` (when it may touch the index).
* `read_only` operations: `git log`, `git diff --name-only`, `git status --porcelain` (read-only variant), `git rev-parse`.
* No direct `execAsync('git ...')` calls may remain outside `GitRunner` after this workspace completes. A lint rule must enforce this.
* `GitRunner` must carry `planExecId`, `workspaceId`, `leaseId`, and `cwd` as context for every call, enabling audit logging.
* Stale lock detection (`*.lock` file exists): check if the owning process/lease is live. If live, wait or fail gracefully. If stale, quarantine the worktree and create a replacement — never delete the lock file directly.

**Acceptance Criteria:**
* `grep -r "execAsync.*git " packages/coding-agent/src` returns zero results outside `git-runner.ts`.
* Lint rule `no-direct-git-exec` passes in CI.
* Repo-wide operations block concurrently-running per-worktree operations on the same repo during execution (verified by unit test with artificial delays).
* Per-worktree mutexes are independent — `workspaceId: A` and `workspaceId: B` do not block each other for per-worktree operations (verified by unit test).
* Stale lock test: inject a stale `.git/index.lock`, confirm GitRunner quarantines worktree and creates replacement without deleting the lock file directly.
* All existing worktree, integration queue, and cleanup tests pass without modification.

**Isolation & Parallelism Notes:**
* W1 has no dependencies. It can start immediately.
* W1 touches six files with no overlap with W6 (dashboard) or W7 (template). It can run in parallel with W6 and W7.
* W2 depends on W1 because the lease watchdog needs GitRunner to perform safe worktree operations during quarantine and replacement.
* W5 depends on W1 because empirical writeSet recording uses `git diff --name-only` through GitRunner.
* W1 has a large `conflictScope` — it touches the worktree and scheduler subsystems. It must not run concurrently with W2 or W5.
* This workspace requires git worktree isolation.
* W1 must enter the integration queue before W2 begins.

---

### W2 — WorktreePool v2 + Continuous Lease Monitor

**Goal:** Harden lease ownership with heartbeat writing, add a background watchdog loop that quarantines stale leases without a server restart, and establish an explicit reconciliation precedence rule for crash recovery.

**Requirements:**
* Each active lease must write a heartbeat file to `.pi/scheduler/leases/{leaseId}.heartbeat` every 15 seconds.
* The heartbeat file must contain: `leaseId`, `workspaceId`, `planExecId`, `pid`, `lastHeartbeatAt` (ISO timestamp), `cwd`, `lastGitCommand`.
* A background watchdog loop must run every 30 seconds, independent of any plan execution.
* The watchdog must: read all lease files, check `lastHeartbeatAt` against a staleness threshold (default: 45 seconds = 3× heartbeat interval), verify the PID is alive via `process.kill(pid, 0)`, and quarantine any lease whose heartbeat is stale and whose PID is not alive.
* Quarantine means: mark the worktree directory as quarantined by renaming it to `.pi/worktrees/{planExecId}/{workspaceId}.quarantined`, create a replacement prewarmed worktree slot, delete the lease file, and emit a `lease_quarantined` event to the dashboard.
* Reconciliation precedence rule (applied on server restart and during watchdog runs): lease file is ground truth for "was this workspace running"; worktree-state.json is ground truth for "what is on disk." If they agree: proceed normally. If lease file says running but worktree-state says completed: treat as completed, release lease. If lease file says running but worktree-state has no record: quarantine and requeue. If worktree-state says running but no lease file exists: quarantine and requeue. All disagreements must emit a `lease_reconciliation_disagreement` event with both sources logged.
* `WorktreePool.prewarm()` must continue to create 6 slots at plan start as per v2.5 contract.
* `leaseMonitor.enabled` config flag must allow disabling the watchdog for `stable_3` plans that do not use worktrees.

**Acceptance Criteria:**
* Watchdog test: start a plan with 3 workers, kill one worker process hard (`SIGKILL`), confirm the watchdog quarantines the lease within 75 seconds (2.5 watchdog cycles) without a server restart.
* Heartbeat test: confirm heartbeat file is updated every 15 seconds ± 2 seconds during active workspace execution.
* Reconciliation test: inject a disagreement between lease file and worktree-state.json, confirm the watchdog emits `lease_reconciliation_disagreement` and quarantines correctly.
* Recovery test: after quarantine, confirm the replacement slot is created and the workspace is requeued in `GlobalReadyQueue`.
* PID liveness check: confirm the watchdog does not quarantine a lease whose PID is alive, even if the heartbeat is slightly delayed.
* All existing crash recovery tests (`resumeStrandedExecutions`) continue to pass — both recovery paths must coexist.

**Isolation & Parallelism Notes:**
* W2 depends on W1 (GitRunner must be available for worktree quarantine and replacement operations).
* W2 has no overlap with W3, W4, or W6. After W2 merges, W3, W4, and W5 can all start simultaneously.
* W2 touches `workspace-scheduler.ts`, `worktree-manager.ts`, and `autonomous-executor.ts` — it cannot run concurrently with W1 or W5.
* This workspace requires git worktree isolation.
* W2 must enter the integration queue before W3, W4, or W5 begin.

---

### W3 — Integration Queue Dynamic Merge-Priority Scorer

**Goal:** Replace the static `queuePriority` field as the sole integration queue ordering mechanism with a runtime-computed merge-priority score that reflects current graph state at dequeue time.

**Requirements:**
* Add a `mergePriorityScorer` to `integration-queue.ts` that computes score at dequeue time (not enqueue time).
* Formula: `downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10`.
* `downstreamReadyCount`: number of workspaces that would become ready to execute immediately after this workspace merges.
* `criticalPathPosition`: inverse position on the critical path (workspace at position 1 on critical path = highest score, workspace not on critical path = 0).
* `waitTimeBoost`: minutes the workspace has been in the queue, capped at 10 to prevent starvation.
* `recomputeOnEachDequeue: true` — score is recomputed from live workspace state every time the queue picks the next merge.
* Tiebreaker: FIFO (submission order) when scores are equal.
* Static `queuePriority` from workspace definition acts as a band multiplier: `critical` × 2.0, `high` × 1.5, `normal` × 1.0, `low` × 0.5. This preserves backward compatibility with existing plans that declare priority.
* Add `downstreamReadyCount` and `criticalPathPosition` as nullable runtime fields on workspace integration state (null at authoring time, filled by executor at runtime).
* Persist the computed score and its components in the queue reorder decision log artifact.

**Acceptance Criteria:**
* Test with 4 workspaces queued simultaneously: workspace A (critical path position 1, 3 downstream ready) and workspace B (not on critical path, 0 downstream ready) — confirm A dequeues before B regardless of submission order.
* Test waitTimeBoost: after 10 minutes in queue with no dequeue, a low-priority workspace must score high enough to merge ahead of a new arrival with slightly higher static priority.
* Score is recomputed between each merge: confirm that after workspace A merges and its dependents become ready, the next dequeue reflects the updated `downstreamReadyCount` for remaining queued workspaces.
* Dashboard `IntegrationQueuePanel` shows score, formula breakdown (`downstreamReadyCount`, `criticalPathPosition`, `waitTimeBoost`, `staticBandMultiplier`), and `recomputedAt` timestamp for each queued workspace.
* All existing integration queue safety invariants pass: validation requirements are enforced regardless of score.

**Isolation & Parallelism Notes:**
* W3 depends on W2 (needs the WorktreePool v2 scheduler types to be stable before adding scorer logic that reads live workspace state).
* W3 touches `integration-queue.ts` and `IntegrationQueuePanel.tsx` only. No overlap with W4 (`validation-lock.ts`, `SchedulerStatusPanel`) or W5 (`worktree-workspace-executor.ts`, `WorkerDetail`).
* W3 can run concurrently with W4 and W5.
* This workspace requires git worktree isolation.

---

### W4 — Validation Lane Backpressure

**Goal:** Make the scheduler aware of validation lane saturation before launching a new workspace, so it prefers workspaces that can run targeted-only validation when the heavy validation slot is occupied.

**Requirements:**
* Add a `validationLane` section to plan execution config with: `maxConcurrentHeavyValidations: 1`, `maxConcurrentTargetedValidations: 3`, `backpressureEnabled: true`, `backpressureStrategy: "prefer_targeted_when_heavy_saturated"`, `schedulerFeedbackEnabled: true`.
* `DynamicParallelScheduler.getNextWorkspaces()` must check validation lane saturation before selecting a workspace from `GlobalReadyQueue`.
* If heavy validation slot is occupied (`currentHeavyValidations >= maxConcurrentHeavyValidations`): skip workspaces with `validation.heavyCommandUsesGlobalLock: true` and `validation.canRunTargetedOnly: false`. Select from workspaces with `canRunTargetedOnly: true` instead.
* Add `validation.canRunTargetedOnly` boolean field to workspace schema. Default: `false`. When `true`, the workspace's validation profile never requires the global lock.
* Add `validation.estimatedHeavyValidationSeconds` nullable integer field to workspace schema for future use by the scorer (not used in P23 scheduling logic, declared only).
* Backpressure must not starve heavy-validation workspaces: if all remaining ready workspaces require heavy validation and the slot is occupied, the scheduler must wait (not skip indefinitely). The `waitTimeBoost` in W3 ensures eventual progress.
* Emit `validation_lane_backpressure_active` event to dashboard when a workspace is deferred due to lane saturation.

**Acceptance Criteria:**
* Test: 4 ready workspaces, 2 require heavy validation, 2 are targeted-only. Heavy slot is occupied. Confirm the scheduler launches both targeted-only workspaces immediately without waiting for the heavy slot.
* Test: all remaining ready workspaces require heavy validation, heavy slot is occupied. Confirm the scheduler waits rather than skipping indefinitely.
* `SchedulerStatusPanel` shows: heavy lane (`currentHeavyValidations / maxConcurrentHeavyValidations`), targeted lane (`currentTargetedValidations / maxConcurrentTargetedValidations`), backpressure active indicator, workspaces currently deferred with reason.
* Existing priority scorer formula is unchanged — backpressure is a pre-filter on the ready queue, not a modification of scores.
* No change to validation lock acquisition logic — the global lock is still acquired inside the validation execution, not by the scheduler.

**Isolation & Parallelism Notes:**
* W4 depends on W2 (scheduler types must be stable).
* W4 touches `validation-lock.ts`, `workspace-scheduler.ts` (read-only, adds pre-filter), and `SchedulerStatusPanel.tsx`. No overlap with W3 (`integration-queue.ts`, `IntegrationQueuePanel`) or W5 (`worktree-workspace-executor.ts`, `WorkerDetail`).
* W4 can run concurrently with W3 and W5.
* This workspace requires git worktree isolation.

---

### W5 — writeSet Drift Detection

**Goal:** Record empirical writeSets post-execution via git diff, compare against declared writeSet, flag integration queue entries when drift exceeds threshold, and feed empirical data back into autoOptimizationProposal.

**Requirements:**
* After each workspace agent exits, the worktree executor must run `git diff --name-only HEAD` in the worktree to capture all files changed during execution.
* Store the result as `empiricalWriteSet: string[]` on the workspace execution state.
* Compare `empiricalWriteSet` against `parallelism.conflictScope` (declared writeSet). Files in `empiricalWriteSet` but not in any declared conflictScope pattern are "undeclared writes."
* If `undeclaredWriteCount > driftDetection.driftThresholdFiles` (default: 3): emit `write_set_drift_detected` event, set `integration.driftFlagged: true` on the workspace.
* If `driftFlagged: true` and `driftDetection.onDriftDetected` is `warn_and_flag_integration` (default): allow the integration queue entry but mark it with a `requires_human_review` flag visible in the dashboard. Do not auto-merge silently.
* If `driftDetection.onDriftDetected` is `block_integration` (opt-in): stop the integration queue entry and require explicit approval before merging.
* Persist `empiricalWriteSet` and `write_set_drift_report` as artifacts under `.pi/executions/{planExecId}/worktrees/{wsId}.drift.json`.
* Feed empirical writeSets into `PlanIntakeAnalyzer` as suggested `conflictScope` patches for future runs via the existing `autoOptimizationProposal` mechanism.

**Acceptance Criteria:**
* Test: workspace declares `conflictScope: ["src/scheduler/"]` but agent writes to `src/types/generated/scheduler-types.ts` (outside declared scope). Confirm `empiricalWriteSet` captures the undeclared file, `driftFlagged: true` is set, and the integration queue entry is marked `requires_human_review`.
* Test: workspace writes exactly the files in its declared conflictScope. Confirm `driftFlagged: false`, integration proceeds normally.
* Test with `onDriftDetected: "block_integration"`: confirm the integration queue entry is blocked and requires explicit approval.
* `WorkerDetail` component shows `empiricalWriteSet`, drift status (clean / drifted N files), and integration gate status.
* `PlanIntakeAnalyzer` receives empirical writeSet data and generates a `conflictScope` patch suggestion in the next plan's optimizer proposal.
* Drift report artifact exists at `.pi/executions/{planExecId}/worktrees/{wsId}.drift.json` after workspace completion.

**Isolation & Parallelism Notes:**
* W5 depends on W1 (GitRunner provides the `git diff --name-only` call) and W2 (workspace execution state schema must be stable).
* W5 touches `worktree-workspace-executor.ts`, `workspace-schema.ts`, `integration-queue.ts` (drift flag reading), `plan-intake-analyzer.ts`, and `WorkerDetail.tsx`. Minor overlap with W3 on `integration-queue.ts` — W5 adds a flag field, W3 adds scorer logic. These are non-conflicting additions to different parts of the file.
* W5 can run concurrently with W3 and W4.
* This workspace requires git worktree isolation.

---

### W6 — Dashboard Extensions

**Goal:** Extend five existing dashboard components to surface the new data produced by W2, W3, W4, and W5.

**Requirements:**

**IntegrationQueuePanel.tsx:**
* Show dynamic merge-priority score per queued workspace with formula breakdown: `downstreamReadyCount`, `criticalPathPosition`, `waitTimeBoost`, `staticBandMultiplier`, final score.
* Show `recomputedAt` timestamp.
* Show `requires_human_review` flag (from drift detection) with a distinct warning badge.

**WorktreeStatusPanel.tsx:**
* Show per-lease: owner workspaceId, PID, heartbeat age (seconds since last heartbeat), last git command, watchdog status (healthy / stale / quarantined).
* Show quarantine count for the current plan execution.

**SchedulerStatusPanel.tsx:**
* Show validation lane status: heavy lane (`currentHeavyValidations / maxConcurrentHeavyValidations`), targeted lane (`currentTargetedValidations / maxConcurrentTargetedValidations`).
* Show backpressure active indicator (green / amber / red).
* List workspaces currently deferred due to lane saturation with reason.

**WorkerDetail.tsx:**
* Show `empiricalWriteSet` as an expandable file list after workspace completes.
* Show drift status: clean (checkmark) or drifted (N undeclared files, warning badge).
* Show integration gate status: auto-merge / requires review / blocked.

**PlanSummaryPanel.tsx:**
* Show lease monitor health (watchdog running / disabled).
* Show reconciliation event count for the current plan (0 is normal; > 0 warrants investigation).
* Show quarantine count with link to quarantined worktree list.

**Acceptance Criteria:**
* All five components render correctly with mock data matching the new API response shapes.
* No new dashboard components introduced — all changes extend existing components.
* `requires_human_review` flag is visually distinct and cannot be missed (amber warning badge, not a subtle text label).
* Dashboard does not directly mutate any execution state — all new UI elements are read-only displays or trigger API requests that the executor validates.

**Isolation & Parallelism Notes:**
* W6 depends on W2 (heartbeat/lease data shapes), W3 (merge-priority score shape), W4 (validation lane saturation shape), and W5 (empirical writeSet and drift flag shapes). However, W6 can begin on stub API contracts agreed before W2-W5 complete, making it effectively parallel with W3/W4/W5 in practice.
* W6 touches only `packages/web-ui/dashboard/src/components/`. No overlap with any backend workspace.
* This workspace requires git worktree isolation.

---

### W7 — Template v2.6.0 + Schema v2.6.0

**Goal:** Update the master template and workspace schema to formally declare all new fields introduced by P23, add new doctor warnings and hard stops, bump `contractVersion` to `2.6.0`, and write the changelog entry.

**Requirements:**

**New `planExecution` sections to add:**

`leaseMonitor`:
```json
{
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
  }
}
```

`validationLane`:
```json
{
  "validationLane": {
    "maxConcurrentHeavyValidations": 1,
    "maxConcurrentTargetedValidations": 3,
    "backpressureEnabled": true,
    "backpressureStrategy": "prefer_targeted_when_heavy_saturated",
    "schedulerFeedbackEnabled": true
  }
}
```

`integrationQueue.mergePriorityScorer`:
```json
{
  "mergePriorityScorer": {
    "enabled": true,
    "formula": "downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10",
    "recomputeOnEachDequeue": true,
    "tiebreaker": "fifo"
  }
}
```

**New workspace-level fields:**

`validation`:
```json
{
  "validation": {
    "profile": "targeted_then_final",
    "heavyCommandUsesGlobalLock": true,
    "canRunTargetedOnly": false,
    "estimatedHeavyValidationSeconds": null,
    "watchModeForbidden": true
  }
}
```

`parallelism.conflictScope` extended:
```json
{
  "conflictScope": {
    "declared": [],
    "empirical": null,
    "driftDetection": {
      "enabled": true,
      "compareAfterExecution": true,
      "driftThresholdFiles": 3,
      "onDriftDetected": "warn_and_flag_integration"
    }
  }
}
```

`integration` runtime fields:
```json
{
  "integration": {
    "downstreamReadyCount": null,
    "criticalPathPosition": null,
    "driftFlagged": null,
    "requiresHumanReview": null
  }
}
```

**New `persistedArtifacts`:**
```
empirical_write_set
write_set_drift_report
lease_heartbeat_snapshots
lease_reconciliation_log
merge_priority_score_log
validation_lane_saturation_log
```

**New `doctorWarnings`:**
```
lease_monitor_disabled_with_worktree_enabled
write_set_drift_detected_in_prior_run
validation_lane_saturated_blocking_scheduler
integration_queue_merge_priority_stale
lease_reconciliation_disagreement_detected
empirical_write_set_diverges_from_declared
```

**New `hardStops`:**
```
integration_merge_with_unresolved_write_set_drift_in_block_mode
lease_reconciliation_disagreement_without_quarantine
```

**New validation rules (55–62):**
* Rule 55: If `leaseMonitor.enabled` is true, `staleThresholdSeconds` must be at least 3× `heartbeatIntervalSeconds`.
* Rule 56: If `worktree.enabled` is true and `leaseMonitor.enabled` is false, doctor must emit `lease_monitor_disabled_with_worktree_enabled` warning.
* Rule 57: If `validationLane.backpressureEnabled` is true, `schedulerFeedbackEnabled` must also be true.
* Rule 58: If `conflictScope.driftDetection.onDriftDetected` is `block_integration`, doctor must confirm explicit opt-in is present.
* Rule 59: If `mergePriorityScorer.enabled` is true, `recomputeOnEachDequeue` must be true.
* Rule 60: `integration.downstreamReadyCount` and `integration.criticalPathPosition` are runtime-only fields — they must be null in authored plans and non-null only in persisted execution state.
* Rule 61: If a lease reconciliation disagreement is detected without quarantine, execution must hard stop.
* Rule 62: `contractVersion` must be `"2.6.0"` for plans using `leaseMonitor`, `validationLane`, `mergePriorityScorer`, or `conflictScope.driftDetection`.

**Acceptance Criteria:**
* `pi plan doctor` validates a P23-format plan correctly using all new rules.
* Template changelog entry is complete and accurate.
* All new field definitions are documented in the Field Definitions section.
* No placeholder tokens remain in the template.
* `contractVersion: "2.6.0"` is accepted by `isV230Plus` and all schema version checks.

**Isolation & Parallelism Notes:**
* W7 depends on W1–W5 being complete so that field names, shapes, and behaviors are final before they are documented.
* W7 can draft schema stub sections (field names and types only, no behavior) in parallel with W3/W4/W5 to reduce idle time.
* W7 touches only `docs/llm-implementation-agent-master-template.md` and `workspace-schema.ts`. No overlap with any other backend workspace.
* This workspace requires git worktree isolation.

---

### W8 — Stress Test + Dogfood

**Goal:** Validate the entire P23 system under realistic 6-worker load with forced failures, confirming that all correctness guarantees hold without manual intervention.

**Requirements:**
* **Crash recovery test:** Start a plan with 6 workers, force-kill (`SIGKILL`) two worker processes at a random point during execution. Confirm: watchdog quarantines both leases within 75 seconds, replacement slots are created, quarantined workspaces are requeued, plan completes without manual intervention.
* **Git serialization test:** Run 6 simultaneous workspaces that each perform repo-wide Git operations (fetches, worktree management). Confirm: no `.git/index.lock` errors, no `git` process races, all operations complete correctly. Instrument GitRunner to log mutex wait times.
* **Drift detection test:** Inject a workspace that writes to files outside its declared `conflictScope`. Confirm: `empiricalWriteSet` captures the undeclared files, `driftFlagged: true` is set, integration queue entry is marked `requires_human_review`.
* **Backpressure test:** Run 6 workspaces where 4 require heavy validation. Confirm: only 1 runs heavy validation at a time, the other 3 heavy-validation workspaces wait while any targeted-only workspaces execute freely.
* **Merge-priority scorer test:** Queue 4 completed workspaces simultaneously with different graph positions. Confirm: the workspace with highest `downstreamReadyCount * 50 + criticalPathPosition * 30` dequeues first regardless of submission order.
* **No-manual-intervention requirement:** The stress test must complete from plan start to plan completion with zero human actions required after the initial start command.
* Write a dogfood report covering all five test scenarios with pass/fail status, timing data, and any anomalies observed.

**Acceptance Criteria:**
* All five stress scenarios pass.
* Dogfood report written and committed to `reports/p23-dogfood/`.
* No Git lock errors in the stress test run logs.
* Watchdog quarantine latency ≤ 75 seconds in the crash recovery scenario.
* Zero manual interventions required for plan completion.
* TypeScript build passes with zero errors after all P23 changes.
* All pre-existing tests pass.

**Isolation & Parallelism Notes:**
* W8 depends on all of W1–W7 being complete and merged. It runs last.
* W8 is a single sequential workspace — it cannot be parallelized.
* This workspace requires git worktree isolation.

---

## 8. Combined Implementation Order

```
Batch 1 (serial):  W1 — GitRunner
Batch 2 (serial):  W2 — WorktreePool v2 + Lease Monitor
Batch 3 (parallel, 3-wide): W3 + W4 + W5
                   W3 — Integration Queue Merge-Priority Scorer
                   W4 — Validation Lane Backpressure
                   W5 — writeSet Drift Detection
                   (W6 — Dashboard Extensions can begin on stub contracts during batch 3)
Batch 4 (serial):  W6 — Dashboard Extensions (finalized against real API shapes)
Batch 5 (serial):  W7 — Template v2.6.0 + Schema v2.6.0
Batch 6 (serial):  W8 — Stress Test + Dogfood
```

W1 and W2 are strictly sequential because W2's quarantine and replacement operations require GitRunner to be in place. This is the critical path bottleneck — both are heavy workspaces with broad file scope, and they cannot be parallelized safely.

After W2 merges, W3, W4, and W5 have non-overlapping file scopes and can run simultaneously at full 3-wide parallelism. W6 can begin on agreed API stub contracts during this batch, converting to a short finalization pass in batch 4 once W3/W4/W5 are merged.

W7 can draft field name stubs during batch 3 but must not finalize until all implementation shapes are confirmed. W8 runs last and is strictly sequential.

Critical path: W1 → W2 → W5 → W7 → W8 (6 workspaces deep). W5 is on the critical path because it introduces new workspace schema fields that W7 must document accurately.

Safe effective parallelism is 3 (batch 3). DAG effective parallelism is also 3. No safety constraints reduce the parallelism below the DAG width in batch 3 because W3, W4, and W5 touch non-overlapping files and have no validation lock overlap.

---

## 9. Definition of Done

P23 is complete when ALL of the following are true:

* [ ] `grep -r "execAsync.*git " packages/coding-agent/src` returns zero results outside `git-runner.ts`.
* [ ] Lint rule `no-direct-git-exec` passes in CI.
* [ ] Lease watchdog quarantines a stale lease within 75 seconds without a server restart (stress test scenario 1 passes).
* [ ] Reconciliation precedence rule is enforced: disagreements between lease-file and worktree-state result in quarantine-and-requeue, never silent assumption.
* [ ] Integration queue dequeues in computed merge-priority order, not submission order (stress test scenario 5 passes).
* [ ] Validation lane backpressure defers heavy-validation workspaces when the heavy slot is occupied (stress test scenario 4 passes).
* [ ] Empirical writeSet is recorded for every workspace execution via git diff.
* [ ] Drift detection fires correctly on a synthetic writeSet mismatch (stress test scenario 3 passes).
* [ ] All five dashboard components updated with new data fields.
* [ ] `contractVersion: "2.6.0"` accepted by all schema version checks.
* [ ] Master template v2.6.0 complete with all new field definitions, validation rules 55–62, new doctor warnings, new hard stops, and changelog entry.
* [ ] Dogfood report written at `reports/p23-dogfood/`.
* [ ] TypeScript build passes with zero errors.
* [ ] All pre-existing tests pass.
* [ ] DAG batch preview reviewed and approved.
* [ ] Safe batch preview reviewed and approved.
* [ ] Scale mode readiness passes for `experimental_6`.
* [ ] No forbidden commands or files used during execution.
* [ ] Integration queue is clean at plan completion.

---

## 10. Rollback Playbook

**Trigger conditions:**
* GitRunner mutex causes deadlock or significantly increases git operation latency.
* Lease watchdog quarantines live leases incorrectly (false positives causing work loss).
* Drift detection blocks the integration queue unexpectedly in `block_integration` mode.
* Validation lane backpressure starves workspaces indefinitely.
* Any stress test scenario fails in a way that requires manual intervention.

**Rollback procedure:**
1. Set scale mode to `stable_3` and `maxParallelWorkspaces` to 3.
2. Disable the lease watchdog: set `leaseMonitor.enabled: false` in plan config.
3. Revert individual files to direct `execAsync` calls: each file was migrated independently, so `worktree-manager.ts`, `cleanup-review.ts`, etc. can be reverted one at a time without reverting all of GitRunner.
4. Set `conflictScope.driftDetection.onDriftDetected` to `warn_and_flag_integration` (never `block_integration`) to prevent queue blocking.
5. Disable `validationLane.backpressureEnabled` if backpressure is causing starvation.
6. Preserve all quarantined worktrees under `.pi/worktrees/{planExecId}/*.quarantined` for diagnostics.
7. Fall back to `resumeStrandedExecutions()` on restart as the sole recovery mechanism.
8. Revert `contractVersion` to `2.5.1` in any active plans.

---

## 11. What Next Phase Inherits

P24 inherits:

* `GitRunner` — all git operations centralized, ready for audit logging, distributed git backend, or remote execution extensions.
* Hardened lease lifecycle with continuous watchdog — foundation for longer-running overnight executions (P20 integration).
* Empirical writeSet data accumulated across runs — feeds `autoOptimizationProposal` with real conflict scope data, improving plan quality automatically over time.
* Validation lane model — foundation for additional lane types (e.g., a separate compilation lane or a type-check lane).
* Dynamic merge-priority scorer — foundation for soft-dependency speculation: when a workspace is speculatively started, its merge priority can be discounted to reflect the uncertainty.

P24 may add:

* Soft-dependency speculation (speculative execution of workspaces with `softDeps` whose readSet does not conflict with the running dependency's writeSet).
* `SchedulingPolicy` interface separating scheduling decisions from execution — allowing the V2 brain's `PolicyEngine` to inform scheduling priorities.
* Node splitting: `PlanIntakeAnalyzer` automatically splits oversized DAG nodes by writeSet before execution begins.
* Remote execution lane for offloading validation to a separate machine.

---

# Part 2 — Agent Brief

## Mission

Implement the eight workspaces of P23 in strict DAG order, with W1 and W2 completed and merged before any of W3, W4, or W5 begin. The mission is correctness, not speed: every change must leave the system in a state where 6-worker execution is safer than before, never less safe. The `warn` default for drift detection and the `enabled` flag for the lease monitor exist specifically to allow incremental deployment without breaking existing plans.

This plan uses `experimental_6` scale-aware execution. The agent must optimize for safe parallelism, not maximum concurrency. The 3-wide parallelism in batch 3 is the correct target — do not attempt to parallelize W1 and W2 or W7 and W8.

---

## Hard Requirements

1. W1 (GitRunner) must be fully merged before W2 begins. No exceptions.
2. W2 (Lease Monitor) must be fully merged before W3, W4, or W5 begin.
3. No direct `execAsync('git ...')` calls may remain outside `git-runner.ts` after W1 merges.
4. Drift detection must default to `warn_and_flag_integration`, never `block_integration`, unless explicitly overridden in plan config.
5. The lease watchdog must not quarantine a lease whose PID is alive, even if the heartbeat is delayed.
6. Reconciliation disagreements must always quarantine-and-requeue — never silent assumption of either source.
7. Do not exceed 6 parallel workers.
8. Do not merge workspace output without passed workspace validation.
9. Do not mark the plan complete if integration validation fails.
10. Do not treat merge conflict as ordinary worker failure.
11. Do not start the next plan while the integration queue is dirty.
12. Do not run watch-mode validation.
13. Do not run `git push`.
14. Do not run raw destructive cleanup commands.
15. Do not access secrets or forbidden files.
16. The executor remains the only component that mutates execution state.
17. Queue optimization must not bypass safety checks: workspace validation and integration validation remain required regardless of merge-priority score.
18. `resumeStrandedExecutions()` on restart must continue to function after the lease watchdog is added — both recovery paths must coexist.

---

## Execution Policies

```yaml
scale:
  default_mode: experimental_6
  selected_mode: experimental_6
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

worktree:
  enabled_by_default: true
  root: .pi/worktrees
  quarantine_failed_by_default: true
  raw_rm_rf_forbidden: true
  path_scope_required: true

lease_monitor:
  enabled: true
  heartbeat_interval_seconds: 15
  stale_threshold_seconds: 45
  monitor_loop_interval_seconds: 30
  stale_policy: quarantine_and_replace
  reconciliation_precedence:
    was_running: lease_file
    what_is_on_disk: worktree_state
    on_disagreement: quarantine_and_requeue

integration_queue:
  enabled: true
  process_one_merge_at_a_time: true
  stop_on_merge_conflict: true
  require_workspace_validation_pass: true
  require_integration_validation_pass: true
  git_push_allowed: false
  merge_priority_scorer:
    enabled: true
    formula: "downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10"
    recompute_on_each_dequeue: true
    tiebreaker: fifo
  queue_optimization:
    enabled: true
    strategy: critical_path_first

validation_lane:
  max_concurrent_heavy_validations: 1
  max_concurrent_targeted_validations: 3
  backpressure_enabled: true
  backpressure_strategy: prefer_targeted_when_heavy_saturated
  scheduler_feedback_enabled: true

validation:
  global_validation_lock_required: true
  targeted_validation_enabled: true
  final_integration_validation_required: true
  watch_mode_forbidden: true

write_set_drift:
  enabled: true
  drift_threshold_files: 3
  on_drift_detected: warn_and_flag_integration
  compare_after_execution: true
  feed_to_optimizer: true
```

---

## Safety Stops

Hard stop execution for:

* Dependency cycles in the workspace graph
* W2 starting before W1 is merged
* Any direct `execAsync('git ...')` call outside `git-runner.ts` detected at runtime
* Lease reconciliation disagreement handled without quarantine
* Worktree path escaping `.pi/worktrees`
* Raw destructive worktree cleanup
* Integration merge without passed workspace validation
* Integration validation failure
* Merge conflict without handoff artifact
* `conflictScope.driftDetection.onDriftDetected: "block_integration"` firing without explicit plan-level opt-in
* Queue starting next plan while integration queue is dirty
* Scale mode approval stale or missing
* Worktree isolation disabled while requesting more than 3 workers
* Forbidden file access
* Secrets access
* `git push`
* Watch-mode validation command
* Required preflight review not approved
* Stale approved graph hash

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.6.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": ["infrastructure", "scheduler", "correctness"]
  },
  "planExecution": {
    "phase": "P23",
    "title": "Stable 6: Git Serialization, Lease Hardening, and Execution Correctness",
    "mode": "autonomous",
    "maxParallelWorkspaces": 6,
    "scheduling": {
      "continuous": true,
      "slotCount": 6,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "experimental_6",
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
      "enabled": true,
      "enabledByDefault": true,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
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
    "integrationQueue": {
      "enabled": true,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "requireWorkspaceValidationPass": true,
      "requireIntegrationValidationPass": true,
      "gitPushAllowed": false,
      "mergePriorityScorer": {
        "enabled": true,
        "formula": "downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10",
        "recomputeOnEachDequeue": true,
        "tiebreaker": "fifo"
      },
      "queuePriority": {
        "enabled": true,
        "defaultLevel": "normal",
        "levels": ["critical", "high", "normal", "low"]
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
    "validationLane": {
      "maxConcurrentHeavyValidations": 1,
      "maxConcurrentTargetedValidations": 3,
      "backpressureEnabled": true,
      "backpressureStrategy": "prefer_targeted_when_heavy_saturated",
      "schedulerFeedbackEnabled": true
    },
    "validation": {
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "watchModeForbidden": true
    },
    "writeSetDrift": {
      "enabled": true,
      "driftThresholdFiles": 3,
      "onDriftDetected": "warn_and_flag_integration",
      "compareAfterExecution": true,
      "feedToOptimizer": true
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
      "parserPriority": ["part3_json", "markdown_fallback"],
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
      "execution_without_dry_run",
      "execution_without_approval",
      "protected_system_mutation_without_explicit_approval",
      "extension_permission_denied",
      "skill_permission_denied",
      "memory_forbidden_source_indexing",
      "optimizer_patch_without_approval",
      "integration_merge_with_unresolved_write_set_drift_in_block_mode",
      "lease_reconciliation_disagreement_without_quarantine"
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
      "ready": true,
      "blockedReasons": [],
      "warnings": [],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": true,
          "message": "Required for experimental_6."
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": true,
          "message": "Required for experimental_6."
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": true,
          "message": "Required for experimental_6."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required for experimental_6."
        },
        {
          "key": "lease_monitor",
          "required": true,
          "met": true,
          "message": "Required for experimental_6 in P23+."
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
        { "batch": 1, "workspaceIds": ["W1"], "effectiveParallelism": 1 },
        { "batch": 2, "workspaceIds": ["W2"], "effectiveParallelism": 1 },
        { "batch": 3, "workspaceIds": ["W3", "W4", "W5"], "effectiveParallelism": 3 },
        { "batch": 4, "workspaceIds": ["W6"], "effectiveParallelism": 1 },
        { "batch": 5, "workspaceIds": ["W7"], "effectiveParallelism": 1 },
        { "batch": 6, "workspaceIds": ["W8"], "effectiveParallelism": 1 }
      ],
      "overallEffectiveParallelism": 1.5,
      "criticalPath": ["W1", "W2", "W5", "W7", "W8"],
      "criticalPathLength": 5,
      "serializedTailLength": 3
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": ["W1"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": ["W2"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": ["W2 requires W1 merge before git operations are safe"]
        },
        {
          "batch": 3,
          "workspaceIds": ["W3", "W4", "W5"],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": ["W6"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "workspaceIds": ["W7"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": ["W7 must document final field shapes from W3/W4/W5"]
        },
        {
          "batch": 6,
          "workspaceIds": ["W8"],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": ["W8 requires all prior workspaces merged"]
        }
      ],
      "overallSafeEffectiveParallelism": 1.5,
      "bottlenecks": [
        "long_serialized_tail",
        "integration_queue_serializes_merges"
      ],
      "blockedParallelismReasons": [
        "W1 and W2 must be strictly sequential due to git operation safety.",
        "W7 and W8 must follow all implementation workspaces."
      ]
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
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "scale_mode_prerequisites_missing",
      "lease_monitor_disabled_with_worktree_enabled",
      "write_set_drift_detected_in_prior_run",
      "validation_lane_saturated_blocking_scheduler",
      "integration_queue_merge_priority_stale",
      "lease_reconciliation_disagreement_detected",
      "empirical_write_set_diverges_from_declared",
      "optimizer_patch_without_approval"
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
      "merge_priority_score_log",
      "plan_intake_analysis",
      "optimizer_proposal",
      "graph_diff",
      "worktree_state",
      "lease_heartbeat_snapshots",
      "lease_reconciliation_log",
      "empirical_write_set",
      "write_set_drift_report",
      "validation_lane_saturation_log",
      "platform_audit_timeline"
    ]
  },
  "workspaces": [
    {
      "id": "W1",
      "title": "GitRunner: Centralized Git Operation Layer",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "W1 has no dependencies. It is the foundation for all other workspaces — W2 requires GitRunner for safe worktree quarantine, W5 requires it for git diff recording.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": ["W6", "W7"],
        "cannotRunWith": ["W2", "W3", "W4", "W5", "W8"],
        "conflictScope": {
          "declared": [
            "packages/coding-agent/src/worktree/worktree-manager.ts",
            "packages/coding-agent/src/core/cleanup-review.ts",
            "packages/web-server/src/scale-routes.ts",
            "packages/coding-agent/src/core/production-readiness-doctor.ts",
            "packages/coding-agent/src/doctor/scale-readiness-doctor.ts",
            "packages/coding-agent/src/worktree/worktree-workspace-executor.ts"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W1 touches six files that are also touched by W2 and W5. It must not run concurrently with any other backend workspace."
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
        "queueOptimizationNotes": "W1 is on the critical path and blocks all other backend workspaces. Merge first.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/git-runner.ts",
        "packages/coding-agent/src/worktree/**",
        "packages/coding-agent/src/core/cleanup-review.ts",
        "packages/web-server/src/scale-routes.ts",
        "packages/coding-agent/src/core/production-readiness-doctor.ts",
        "packages/coding-agent/src/doctor/scale-readiness-doctor.ts"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "grep -r 'execAsync.*git ' packages/coding-agent/src returns zero results outside git-runner.ts",
        "Lint rule no-direct-git-exec passes in CI",
        "Repo-wide mutex blocks concurrent per-worktree operations (unit test)",
        "Per-worktree mutexes are independent across workspace IDs (unit test)",
        "Stale lock quarantine test passes without deleting the lock file directly"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/git-runner.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/git-runner.ts",
          "packages/coding-agent/src/worktree/worktree-manager.ts",
          "packages/coding-agent/src/core/cleanup-review.ts",
          "packages/web-server/src/scale-routes.ts",
          "packages/coding-agent/src/core/production-readiness-doctor.ts",
          "packages/coding-agent/src/doctor/scale-readiness-doctor.ts",
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "W2",
      "title": "WorktreePool v2 + Continuous Lease Monitor",
      "dependencies": ["W1"],
      "parallelGroup": "batch_2",
      "dependencyReason": "W2 requires GitRunner (W1) for safe worktree quarantine and replacement operations during watchdog-triggered cleanup.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["W6", "W7"],
        "cannotRunWith": ["W1", "W3", "W4", "W5", "W8"],
        "conflictScope": {
          "declared": [
            "packages/coding-agent/src/core/workspace-scheduler.ts",
            "packages/coding-agent/src/worktree/worktree-manager.ts",
            "packages/coding-agent/src/core/autonomous-executor.ts"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W2 modifies the scheduler and worktree manager which are also touched by W4 and W5 respectively. Must not run concurrently with any other backend workspace."
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
        "queueOptimizationNotes": "W2 is on the critical path and blocks W3, W4, W5 simultaneously. Merge immediately after W1.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/workspace-scheduler.ts",
        "packages/coding-agent/src/scheduler/dynamic-scheduler.ts",
        "packages/coding-agent/src/worktree/worktree-manager.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Watchdog quarantines stale lease within 75 seconds without server restart",
        "Heartbeat file updated every 15s ±2s during active execution",
        "Reconciliation disagreement emits lease_reconciliation_disagreement event and quarantines",
        "Replacement slot created and workspace requeued after quarantine",
        "PID liveness check prevents quarantine of live leases",
        "resumeStrandedExecutions() continues to function alongside watchdog"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/lease-monitor.test.ts packages/coding-agent/test/worktree-pool-v2.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/scheduler/dynamic-scheduler.ts",
          "packages/coding-agent/src/worktree/worktree-manager.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed", "lease_quarantined", "lease_reconciliation_disagreement"],
        "logLevel": "info"
      }
    },
    {
      "id": "W3",
      "title": "Integration Queue Dynamic Merge-Priority Scorer",
      "dependencies": ["W2"],
      "parallelGroup": "batch_3",
      "dependencyReason": "W3 reads live workspace state from the scheduler to compute downstreamReadyCount and criticalPathPosition. Scheduler types must be stable (W2 complete) before adding scorer logic.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["W4", "W5"],
        "cannotRunWith": ["W1", "W2", "W7", "W8"],
        "conflictScope": {
          "declared": [
            "packages/coding-agent/src/integration/integration-queue.ts",
            "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W3 touches integration-queue.ts and IntegrationQueuePanel only. W4 touches validation-lock.ts and SchedulerStatusPanel. W5 touches worktree-workspace-executor.ts and WorkerDetail. No file overlap — safe to run concurrently with W4 and W5."
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
        "queueOptimizationNotes": "W3 has no downstream dependents in the DAG but unblocks W6 (dashboard finalization). Merge promptly.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Higher downstreamReadyCount workspace dequeues before lower regardless of submission order",
        "waitTimeBoost prevents starvation after 10 minutes",
        "Score recomputed between each merge reflecting updated graph state",
        "IntegrationQueuePanel shows score breakdown and recomputedAt timestamp",
        "Validation requirements enforced regardless of score"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/integration-queue-scorer.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "W4",
      "title": "Validation Lane Backpressure",
      "dependencies": ["W2"],
      "parallelGroup": "batch_3",
      "dependencyReason": "W4 adds a pre-filter to DynamicParallelScheduler which was stabilized in W2.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["W3", "W5"],
        "cannotRunWith": ["W1", "W2", "W7", "W8"],
        "conflictScope": {
          "declared": [
            "packages/coding-agent/src/core/validation-lock.ts",
            "packages/coding-agent/src/core/workspace-scheduler.ts",
            "packages/coding-agent/src/core/workspace-schema.ts",
            "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W4 touches workspace-scheduler.ts (pre-filter only, read path) and workspace-schema.ts (new fields only). W2 has already merged its scheduler changes. W3 and W5 do not touch these files. Safe to run concurrently."
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
        "queueOptimizationNotes": "W4 has no downstream dependents but unblocks W6. Merge promptly alongside W3.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/validation-lock.ts",
        "packages/coding-agent/src/core/workspace-scheduler.ts",
        "packages/coding-agent/src/core/workspace-schema.ts",
        "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Targeted-only workspaces launch immediately when heavy slot is occupied",
        "Scheduler waits (not skips) when all ready workspaces need heavy validation and slot is occupied",
        "SchedulerStatusPanel shows lane saturation and backpressure indicator",
        "Existing priority scorer formula unchanged",
        "No change to validation lock acquisition logic"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/validation-lane-backpressure.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/validation-lock.ts",
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/core/workspace-schema.ts",
          "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed", "validation_lane_backpressure_active"],
        "logLevel": "info"
      }
    },
    {
      "id": "W5",
      "title": "writeSet Drift Detection",
      "dependencies": ["W1", "W2"],
      "parallelGroup": "batch_3",
      "dependencyReason": "W5 uses GitRunner (W1) for git diff and depends on workspace execution state schema stabilized in W2.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["W3", "W4"],
        "cannotRunWith": ["W1", "W2", "W7", "W8"],
        "conflictScope": {
          "declared": [
            "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
            "packages/coding-agent/src/core/workspace-schema.ts",
            "packages/coding-agent/src/integration/integration-queue.ts",
            "packages/coding-agent/src/core/plan-intake-analyzer.ts",
            "packages/web-ui/dashboard/src/components/WorkerDetail.tsx"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W5 touches integration-queue.ts (adds drift flag reading) and workspace-schema.ts (adds empirical fields). W3 also touches integration-queue.ts (adds scorer logic) — these are non-conflicting additions to different parts of the file, but cannotRunWith W3 is set as a precaution. Re-evaluate at preflight."
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
        "queueOptimizationNotes": "W5 is on the critical path (W1 → W2 → W5 → W7 → W8). Merge before W3 and W4 if queue pressure requires prioritization.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
        "packages/coding-agent/src/core/workspace-schema.ts",
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/coding-agent/src/core/plan-intake-analyzer.ts",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Undeclared file write captured in empiricalWriteSet and driftFlagged set to true",
        "Clean workspace produces driftFlagged: false and auto-merges normally",
        "block_integration mode blocks queue entry and requires explicit approval",
        "WorkerDetail shows empiricalWriteSet, drift status, and gate status",
        "PlanIntakeAnalyzer receives empirical data and generates conflictScope patch suggestion",
        "Drift report artifact written to .pi/executions/{planExecId}/worktrees/{wsId}.drift.json"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/write-set-drift.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "med",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/src/core/workspace-schema.ts",
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/coding-agent/src/core/plan-intake-analyzer.ts",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed", "write_set_drift_detected"],
        "logLevel": "info"
      }
    },
    {
      "id": "W6",
      "title": "Dashboard Extensions",
      "dependencies": ["W2", "W3", "W4", "W5"],
      "parallelGroup": "batch_4",
      "dependencyReason": "W6 finalizes dashboard components against real API shapes from W2 (lease/heartbeat), W3 (merge-priority score), W4 (validation lane), and W5 (empirical writeSet). Stub work can begin during batch 3 but finalization requires all four to be merged.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": ["W7", "W8"],
        "conflictScope": {
          "declared": [
            "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
            "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
            "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
            "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
            "packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 3,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W6 touches only dashboard components. No backend file overlap. Safe to stub during batch 3, finalize in batch 4."
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
        "queueOptimizationNotes": "W6 has no backend downstream dependents. Normal priority.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
        "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "All five components render correctly with mock data",
        "No new dashboard components introduced",
        "requires_human_review flag visually distinct (amber warning badge)",
        "Dashboard components do not mutate execution state",
        "TypeScript build passes for dashboard package"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/web-ui/dashboard",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
          "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "W7",
      "title": "Template v2.6.0 + Schema v2.6.0",
      "dependencies": ["W1", "W2", "W3", "W4", "W5"],
      "parallelGroup": "batch_5",
      "dependencyReason": "W7 must document final field names, shapes, behaviors, validation rules, and doctor warnings from all implementation workspaces. Finalizing before W1-W5 are merged risks documenting unstable shapes.",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": ["W8"],
        "conflictScope": {
          "declared": [
            "docs/llm-implementation-agent-master-template.md",
            "packages/coding-agent/src/core/workspace-schema.ts"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 2,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W7 touches only the master template doc and workspace-schema.ts. workspace-schema.ts was also touched by W4 and W5, but those are already merged before W7 starts."
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
        "queueOptimizationNotes": "W7 is on the critical path to W8 but has no parallel alternatives. Normal priority.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "docs/llm-implementation-agent-master-template.md",
        "packages/coding-agent/src/core/workspace-schema.ts"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "pi plan doctor validates a P23-format plan using all new rules 55-62",
        "Template changelog entry complete and accurate",
        "All new field definitions documented in Field Definitions section",
        "No placeholder tokens remain in the template",
        "contractVersion 2.6.0 accepted by isV230Plus and all schema version checks"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/workspace-schema.test.ts",
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "docs/llm-implementation-agent-master-template.md",
          "packages/coding-agent/src/core/workspace-schema.ts"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "W8",
      "title": "Stress Test + Dogfood",
      "dependencies": ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
      "parallelGroup": "batch_6",
      "dependencyReason": "W8 requires all prior workspaces to be merged and fully operational before stress testing begins.",
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [],
        "cannotRunWith": ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
        "conflictScope": {
          "declared": [
            "reports/p23-dogfood/"
          ],
          "empirical": null,
          "driftDetection": {
            "enabled": true,
            "compareAfterExecution": true,
            "driftThresholdFiles": 1,
            "onDriftDetected": "warn_and_flag_integration"
          }
        },
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "W8 is strictly sequential and final. It only writes to the reports directory."
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
        "queuePriority": "low",
        "queueOptimizationNotes": "W8 is the final workspace with no downstream dependents. Low priority.",
        "downstreamReadyCount": null,
        "criticalPathPosition": null,
        "driftFlagged": null,
        "requiresHumanReview": null
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "canRunTargetedOnly": false,
        "estimatedHeavyValidationSeconds": null,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "reports/p23-dogfood/"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Crash recovery scenario: watchdog quarantines 2 leases within 75s, plan completes without manual intervention",
        "Git serialization scenario: zero index.lock errors across 6 concurrent workers",
        "Drift detection scenario: undeclared file write captured and flagged correctly",
        "Backpressure scenario: only 1 heavy validation at a time, targeted workspaces unaffected",
        "Merge-priority scorer scenario: highest scored workspace dequeues first regardless of submission order",
        "Zero manual interventions from plan start to plan completion",
        "TypeScript build passes with zero errors",
        "All pre-existing tests pass",
        "Dogfood report committed to reports/p23-dogfood/"
      ],
      "targetCommand": "npx tsc --noEmit && npx vitest run packages/coding-agent/test/suite/p23-stress-test.test.ts",
      "roleBudget": "worker",
      "maxRetries": 1,
      "riskLevel": "med",
      "capabilityManifest": {
        "canEdit": [
          "reports/p23-dogfood/"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npx tsc --noEmit", "npx vitest run"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "vitest --watch"]
      },
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
  "contractVersion": "2.6.0",
  "phase": "P23",
  "title": "Stable 6: Git Serialization, Lease Hardening, and Execution Correctness",
  "primaryGoal": "Harden experimental_6 into stable_6 by centralizing Git through GitRunner, adding a continuous lease watchdog, backpressure-aware validation scheduling, empirical writeSet drift detection, and a dynamic integration queue merge-priority scorer.",
  "projectName": "pi",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "critical_path_first",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 3,
  "notInScope": [
    "Soft-dependency speculation (deferred to P24)",
    "SchedulingPolicy interface / brain feedback hook (deferred to P24)",
    "Node splitting in PlanIntakeAnalyzer (deferred to P24)",
    "Remote execution lane (future phase)",
    "Integration queue dashboard UI changes beyond extending existing IntegrationQueuePanel",
    "scale_8 mode enablement"
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
    "execution_without_dry_run",
    "execution_without_approval",
    "integration_merge_with_unresolved_write_set_drift_in_block_mode",
    "lease_reconciliation_disagreement_without_quarantine"
  ],
  "completionGate": "All 8 workspaces merged, stress test passes all 5 scenarios with zero manual interventions, TypeScript build clean, dogfood report committed.",
  "nextPhase": "P24"
}
```

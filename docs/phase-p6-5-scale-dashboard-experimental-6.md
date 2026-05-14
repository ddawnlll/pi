# Phase P6.5 — Scale Dashboard, Settings & Experimental 6-Worker Dogfood

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.3.0  
**Created:** 2026-05-14  
**Target system:** Pi autonomous coding runtime  
**Goal:** Make P6 scale execution visible, configurable, and testable through the dashboard; then dogfood `experimental_6` with six workers when readiness passes.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P6.5  
**One-line goal:** Turn P6's worktree/integration/scale architecture into an operable dashboard experience and run a controlled six-worker dogfood.  
**Why now:** P6 added worktree isolation, integration queue, dynamic scheduling, failure classification, and scale readiness, but the dashboard still presents these as separate fragments rather than a single scale execution cockpit.  
**Blast radius:** Dashboard layout, scale status hooks, settings dialog, scale routes, scheduler status panel, worker detail lifecycle view, scale dogfood docs/tests.  
**Rollback path:** Hide new P6.5 panels behind feature flags; keep existing P6 routes and components; fall back to `stable_3`.  
**Scale mode:** `experimental_6` for dogfood; default remains `stable_3`.  
**Safe parallelism target:** 6 requested, minimum 4 safe if readiness passes.  
**Done when:** Dashboard clearly shows worktree health, integration queue, merge conflicts, scale readiness, safe parallelism, validation bottlenecks, and a controlled six-worker dogfood result.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P6.5 |
| Title | Scale Dashboard, Settings & Experimental 6-Worker Dogfood |
| Status | Planned |
| Last updated | 2026-05-14 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | P6 dashboard operability, settings, safe scale dogfood |
| Product-code changes | Forbidden — Pi runtime/dashboard/tests/docs only |
| Selected scale mode | `experimental_6` for dogfood |
| Requested max workers | 6 |
| Expected DAG effective parallelism | 4-6 |
| Expected safe effective parallelism | 4-6 if readiness passes |
| Worktree isolation | Required for `experimental_6` |
| Integration queue | Required for `experimental_6` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 6.5.A — Scale dashboard information architecture | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.B — Scale & Safety settings tab | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.C — Scale route and hook schema alignment | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.D — Worktree status and cleanup review | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.E — Integration queue and merge conflict visibility | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.F1 — WorkerDetail P6 lifecycle tab shell | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.F2 — WorkerDetail lifecycle queue/conflict wiring | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.G — Scheduler safe parallelism and scale bottleneck display | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.H1 — Experimental 6-worker dogfood harness | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.H2 — Actual stable_3 and experimental_6 dogfood run | Pi Worker Agent | User / owner | Reviewer | User |
| 6.5.I — P6.5 dashboard stability report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P6 added the major scale architecture: isolated git worktrees, integration queue, merge conflict handling, dynamic scheduler, scale mode policy, test impact analysis, repo graph, and failure classification. The dashboard already has first versions of `WorktreeStatusPanel`, `IntegrationQueuePanel`, `MergeConflictPanel`, `ScaleModeSettings`, `useScaleStatus`, and `scale-routes.ts`.

But the current UI still does not fully answer the scale operator questions:

```text
Can I safely run six workers?
Why is scale mode blocked?
Which workspaces are isolated in worktrees?
Which diffs are queued for integration?
Is the integration queue blocked by conflict or validation?
Is scheduler capacity limited by dependency graph, file overlap, validation lock, or integration queue?
Did the six-worker dogfood actually work?
```

P6.5 makes the P6 execution model visible and controllable enough to trust before P7.

This phase also updates settings so scale behavior is not hidden in backend defaults. The settings UI currently manages steering, follow-up, edit strategy, context budgets, provider/model, shell, telemetry, and skill commands, but it does not expose P6 scale/worktree/integration controls.

---

## 3. What Carried Over — Must Stay Stable

* [x] `stable_3` remains the default.
* [x] `experimental_6` requires worktree isolation.
* [x] `experimental_6` requires integration queue.
* [x] `experimental_6` requires global validation lock.
* [x] Integration queue stops on merge conflict.
* [x] Merge conflicts must produce handoff artifacts.
* [x] Failed or dirty worktrees must not be silently deleted.
* [x] Dashboard controls must not directly mutate executor state.
* [x] `git push` remains forbidden.
* [x] Raw `rm -rf` remains forbidden.
* [x] Watch-mode validation remains forbidden.
* [x] Completion gate hardening remains active.
* [x] Existing live logs, performance metrics, plan summary, and worker details remain compatible.

---

## 4. Background / What Was Wrong

P6 implementation exists, but the dashboard still feels like P4.6/P5.5 plus a few P6 widgets. The user can see worktrees, integration queue, conflicts, and scale readiness, but not as one integrated scale cockpit.

Current issues:

* `ScaleModeReadiness` still exposes `currentMode: "stable" | "scale"` instead of the clearer v2.3 model: `stable_3`, `experimental_6`, `scale_8`.
* `buildScaleModeReadiness()` supports stable 1-3 and experimental 4-6, but does not model `scale_8`, dogfood pass, explicit approval, archive readiness, or completion gate readiness.
* `SchedulerStatusPanel` shows counts and progress, but not requested/max workers, DAG effective parallelism, safe effective parallelism, bottlenecks, or scale readiness.
* `SettingsDialog` has no Scale & Safety tab.
* `WorkerDetail` shows overview, tokens, performance, git, commands, logs, and transcript, but not the P6 lifecycle: worktree → workspace validation → queue → merge → integration validation → conflict/merged.
* Worktree cleanup exists, but the UI should make cleanup scope and safety more explicit.

---

## 5. Current Failure State / Known Blockers

* `dashboard_scale_cockpit` = incomplete — P6 panels are not unified.
* `settings_scale_tab` = missing — scale/worktree/integration controls are not exposed.
* `scale_mode_enum` = incomplete — current UI/API uses stable/scale instead of stable_3/experimental_6/scale_8.
* `safe_effective_parallelism_display` = missing — scheduler shows counts but not safe concurrency.
* `worker_p6_lifecycle_view` = missing — WorkerDetail does not show worktree/integration lifecycle.
* `integration_conflict_entrypoint` = incomplete — conflict panel is strong, but not consistently reachable from queue/alerts/worker detail.
* `worktree_cleanup_review` = incomplete — cleanup action exists but needs stronger confirmation and affected list.
* `experimental_6_dogfood` = required — six-worker run should be explicitly attempted and reported.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Dashboard implies 6-worker mode is safe when prerequisites fail | med | high | Scale readiness panel must show blocking reasons and disable unsafe enablement |
| Worktree cleanup removes wrong worktree | low | critical | Add review dialog, scoped path display, dirty/active checks, no raw destructive cleanup |
| Integration queue state shown stale | med | med | Poll queue frequently during processing and show last updated timestamp |
| Merge conflict hidden in queue details | med | high | Add top-level conflict alert and deep link to MergeConflictPanel |
| User enables experimental_6 without integration queue | low | high | Settings save must be blocked or readiness API must return blocked |
| Scheduler shows active counts but not actual bottleneck | med | med | Add safe parallelism and bottleneck explanations |
| Six-worker dogfood overloads local machine | med | med | Doctor must pass; run only if readiness allows; fall back to stable_3 with clear reason |
| Current route cleanup uses shell command strings | med | high | Prefer argument-safe execution; keep path-scope checks; no `rm -rf` |

---

## 7. Workstreams

### 6.5.A — Scale dashboard information architecture

**Goal:** Add a coherent P6 scale cockpit layout so users can understand scale readiness, worktrees, integration queue, scheduler capacity, validation pressure, and conflicts from one place.

**Requirements:**

* Add a "Scale" or "Scale & Integration" dashboard section.
* Include:
  * scale readiness
  * requested/max workers
  * safe effective parallelism
  * worktree health
  * integration queue status
  * merge conflict status
  * validation lock status
* Keep existing P4.6/P5.5 panels intact.
* Do not hide live logs or worker detail.
* Use current P6 components rather than duplicating them.

**Acceptance Criteria:**

* User can answer "Can I safely run six workers?" from one area.
* User can see why scale mode is blocked.
* User can see worktree, integration queue, and conflict health together.
* Existing dashboard layout remains usable on laptop width.
* No existing stats or live logs regress.

**Isolation & Parallelism Notes:**

* UI-only workstream.
* Can run in parallel with 6.5.B and 6.5.D if files do not overlap heavily.
* Uses existing `useScaleStatus` and scale route data.

---

### 6.5.B — Scale & Safety settings tab

**Goal:** Add settings for scale mode, worker count, worktree isolation, integration queue, validation lock, and dogfood-only experimental mode.

**Requirements:**

* Add `Scale & Safety` tab to `SettingsDialog`.
* Settings should include:
  * selected scale mode: `stable_3`, `experimental_6`, `scale_8`
  * requested max workers
  * worktree isolation enabled
  * integration queue enabled
  * global validation lock enabled
  * quarantine failed worktrees
  * stop integration queue on conflict
  * require workspace validation before queue
  * require integration validation after merge
* Disable or warn for unsafe combinations.
* `scale_8` should be visible but disabled until dogfood pass and explicit approval exist.
* Save should go through settings API, not direct executor mutation.

**Acceptance Criteria:**

* Settings shows current scale mode.
* Settings blocks `experimental_6` unless prerequisites can be enabled.
* Settings shows `stable_3` as default.
* Settings allows configuring six workers for dogfood only when readiness passes.
* Existing General/Budgets/Project/Advanced tabs still work.

**Isolation & Parallelism Notes:**

* Can run in parallel with 6.5.A if component files are separated.
* Requires `SettingsDialog` edits.

---

### 6.5.C — Scale route and hook schema alignment

**Goal:** Align `scale-routes.ts` and `useScaleStatus.ts` with v2.3 scale mode terminology.

**Requirements:**

* Update scale readiness types from:

```text
currentMode: "stable" | "scale"
```

to:

```text
selectedMode: "stable_3" | "experimental_6" | "scale_8"
```

* Include:
  * requestedWorkers
  * maxAllowedWorkers
  * ready
  * blockedReasons
  * warnings
  * prerequisites
  * dogfoodPassRequired
  * explicitApprovalRequired
  * safeEffectiveParallelism if available
* Keep backward compatibility for existing consumers if needed.
* Add route tests.

**Acceptance Criteria:**

* `useScaleModeReadiness()` exposes v2.3-compatible readiness.
* `ScaleModeSettings` uses `stable_3` / `experimental_6` naming.
* Six-worker readiness can be represented exactly.
* `scale_8` is represented but blocked.
* Tests cover stable_3, experimental_6 ready, experimental_6 blocked, scale_8 blocked.

**Isolation & Parallelism Notes:**

* Backend + hook work.
* Should complete before 6.5.B and 6.5.G final wiring.
* Current hook and route already exist but need schema upgrade.

---

### 6.5.D — Worktree status and cleanup review

**Goal:** Improve worktree visibility and make cleanup safer to operate from dashboard.

**Requirements:**

* Extend `WorktreeStatusPanel` to show:
  * plan execution id if available
  * workspace id mapping if available
  * branch
  * commit
  * path
  * dirty/clean
  * locked
  * quarantine status if available
  * last updated
* Add cleanup confirmation modal:
  * list affected worktrees
  * show why each is safe
  * block dirty/active/main worktrees
  * require confirmation for bulk prune
* Prefer backend cleanup using argument-safe execution instead of shell-interpolated command strings.
* Keep raw `rm -rf` forbidden.

**Acceptance Criteria:**

* User can see every worktree status.
* User can see which worktrees are dirty and why they are not removable.
* Bulk cleanup shows affected worktrees before action.
* Dirty, main, bare, locked, or active integration worktrees are not removable.
* Cleanup errors are visible.

**Isolation & Parallelism Notes:**

* Can run after 6.5.C.
* Worktree panel already shows branch/path/dirty/locked state.
* Backend route already checks dirty/main/active queue before pruning, but UI must make that reviewable.

---

### 6.5.E — Integration queue and merge conflict visibility

**Goal:** Make integration queue and conflict handoff visible from dashboard overview, queue panel, alerts, and worker detail.

**Requirements:**

* Extend `IntegrationQueuePanel`:
  * show integration branch if available
  * show current entry duration
  * show queue blocked reason
  * show integration validation status
  * link conflict entries to `MergeConflictPanel`
* Surface conflict count in Alerts.
* Add conflict deep links from:
  * IntegrationQueuePanel
  * Alerts panel
  * WorkerDetail P6 lifecycle tab
* Ensure conflict does not look like ordinary failure.

**Acceptance Criteria:**

* User can see queued/merging/validating/merged/failed/blocked/conflict counts.
* User can open conflict handoff from queue.
* Conflict files and suggested resolution are visible.
* Queue blocked state is obvious.
* Integration validation failure is distinct from worker failure.

**Isolation & Parallelism Notes:**

* Can run after 6.5.C.
* `IntegrationQueuePanel` already exposes entries, counts, conflict files, and queue state.
* `MergeConflictPanel` already has conflict diff, git status, resolution notes, retry, and abort actions.

---

### 6.5.F1 — WorkerDetail P6 lifecycle tab shell

**Goal:** Add the basic WorkerDetail P6 Lifecycle tab structure early.

**Requirements:**

* Add `P6 Lifecycle` tab shell/layout to `WorkerDetail`.
* Add empty and loading states.
* Show basic workspace id, stage, branch/dirty data if already available.
* Do NOT require final queue/conflict deep-link wiring here.
* Preserve existing Overview, Tokens, Performance, Git, Commands, Logs, Transcript tabs.

**Acceptance Criteria:**

* WorkerDetail has a P6 Lifecycle tab.
* Tab renders without queue/conflict data.
* Existing WorkerDetail tabs still work.
* Typecheck/build passes.

**Isolation & Parallelism Notes:**

* Depends on 6.5.C only.
* Can run in parallel with 6.5.A, 6.5.B, 6.5.D, 6.5.E, 6.5.G.

---

### 6.5.F2 — WorkerDetail lifecycle queue/conflict wiring

**Goal:** Wire the lifecycle tab to integration queue, worktree, validation, and conflict handoff data.

**Requirements:**

* Wire lifecycle tab to:
  * integration queue status
  * worktree validation status
  * merge/conflict state
  * conflict workspace link to MergeConflictPanel
  * cleanup/quarantine state
* Ensure completed workspaces show merged/integrated status.
* Ensure failed workspaces show quarantine/cleanup state if available.

**Acceptance Criteria:**

* Lifecycle tab shows queue/integration/conflict status.
* Conflict workspace links to handoff panel.
* Completed workspace shows merged/integrated status.
* Failed workspace shows quarantine/cleanup state if available.
* Existing WorkerDetail tabs still work.

**Isolation & Parallelism Notes:**

* Depends on 6.5.E and 6.5.F1.
* Cannot run until queue/conflict wiring is available.

---

### 6.5.G — Scheduler safe parallelism and scale bottleneck display

**Goal:** Upgrade scheduler dashboard from simple counts to P6 safe parallelism display.

**Requirements:**

* Extend `SchedulerStatusPanel` to show:
  * selected scale mode
  * requested workers
  * max allowed workers
  * active workers
  * idle slots
  * DAG effective parallelism if available
  * safe effective parallelism if available
  * bottlenecks:
    * dependency
    * file overlap
    * symbol overlap
    * validation lock
    * integration queue
    * scale readiness
* Keep compact visual layout.
* Show warnings when safe parallelism < requested workers.

**Acceptance Criteria:**

* User can see why six workers are or are not being used.
* User can distinguish pending vs ready vs blocked.
* User can see when validation lock or integration queue is the bottleneck.
* Dashboard must not show "effective parallelism" as exceeding requested worker cap.
* Dashboard should distinguish:
  * DAG width
  * requested worker cap
  * safe runnable workers
  * worker cap utilization
* Example display:
  DAG width: 7
  Worker cap: 6
  Safe runnable: 6
  Utilization: 100%
* Existing progress display remains.
* Tests cover count display and bottleneck display.

**Isolation & Parallelism Notes:**

* Depends on 6.5.C for new data.
* Current panel shows active/total/ready/blocked/complete/failed and progress, but not P6 safe parallelism or scale bottlenecks.

---

### 6.5.H1 — Experimental 6-worker dogfood harness

**Goal:** Prepare the dogfood test harness and report template before the actual run.

**Requirements:**

* Create or update dogfood test scaffold.
* Add metrics capture placeholders.
* Add report template sections.
* Do NOT run the actual six-worker dogfood here.

**Acceptance Criteria:**

* Dogfood harness exists.
* Report template exists.
* Stable_3 and experimental_6 checklist sections exist.
* No actual dogfood execution is required in this workspace.
* Typecheck/test scaffold passes if applicable.

**Isolation & Parallelism Notes:**

* Depends on 6.5.C only.
* Can run in parallel with implementation work after schema alignment.

---

### 6.5.H2 — Actual stable_3 and experimental_6 dogfood run

**Goal:** Run stable_3 baseline and attempt experimental_6 with maxParallelWorkspaces=6 if readiness passes.

**Requirements:**

* Run once in `stable_3`.
* Run once in `experimental_6` with `maxParallelWorkspaces=6` if doctor/readiness passes.
* Required prerequisites:
  * worktree isolation enabled
  * integration queue enabled
  * global validation lock enabled
  * completion gate active
  * archive/summary available
* If six-worker mode is blocked, dashboard must show exact blocked reason.
* Capture:
  * requested workers
  * active peak workers
  * DAG effective parallelism
  * safe effective parallelism
  * worktree count
  * queue entries
  * conflicts
  * validation failures
  * elapsed time
  * tokens
  * cache hit
* Publish report.

**Acceptance Criteria:**

* Stable_3 dogfood completes or fails with clear reason.
* Experimental_6 dogfood is attempted if readiness passes.
* If experimental_6 runs, peak active workers should reach more than 3 unless safe bottlenecks prevent it.
* If safe bottlenecks prevent six-wide execution, dashboard explains why.
* Integration queue processes successful workspaces.
* Merge conflicts, if any, produce handoff artifacts.
* No `git push` occurs.
* No raw destructive cleanup occurs.
* Report exists.

**Isolation & Parallelism Notes:**

* Depends on 6.5.A, 6.5.B, 6.5.D, 6.5.E, 6.5.F2, 6.5.G, 6.5.H1.
* This is the explicit six-worker test requested by the user.

---

### 6.5.I — P6.5 dashboard stability report

**Goal:** Document whether P6 scale visualization and six-worker dogfood are production-useful.

**Requirements:**

* Publish `docs/pi/stability/p6-5-scale-dashboard-report.md`.
* Include:
  * UI summary
  * scale readiness result
  * worktree status result
  * integration queue result
  * scheduler bottleneck summary
  * six-worker dogfood result
  * blocked reasons if dogfood could not run
  * known gaps before P7
* Include recommendations for P7.

**Acceptance Criteria:**

* Report clearly says whether `experimental_6` is usable.
* Report lists dashboard gaps remaining before P7.
* Report confirms settings behavior.
* Report confirms no safety regressions.
* TypeScript/build/tests pass.

**Isolation & Parallelism Notes:**

* Runs last.
* Documentation/testing only.

---

## 8. Combined Implementation Order

```text
Batch 1:
6.5.C

Batch 2:
6.5.A + 6.5.B + 6.5.D + 6.5.E + 6.5.G + 6.5.F1 + 6.5.H1

Batch 3:
6.5.F2

Batch 4:
6.5.H2

Batch 5:
6.5.I
```

Rationale:

* `6.5.C` must come first because route/hook schema determines what the UI can show.
* `6.5.A`, `6.5.B`, and `6.5.D` can run after schema alignment.
* `6.5.F1` can run early because it only adds the tab shell.
* `6.5.H1` can run early because it only prepares dogfood harness/report scaffolding.
* `6.5.E` and `6.5.G` depend on better scale/integration data — moving them to batch 2 removes a batch slot without blocking other work.
* `6.5.F2` waits for integration queue/conflict visibility.
* `6.5.H2` remains late because actual dogfood must run after dashboard/settings/scheduler visibility is ready.
* `6.5.I` documents the result.

The serialized tail (6.5.F2 → 6.5.H2 → 6.5.I) is intentional:
- 6.5.F2 is serialized because it depends on queue/conflict wiring from 6.5.E.
- 6.5.H2 is serialized because actual dogfood must run after dashboard visibility exists.
- 6.5.I is serialized because final report depends on dogfood result.

Expected safe parallelism:

```text
DAG batch width target: 4-7
Safe batch width target: 4-6 when readiness passes
Requested dogfood max workers: 6
Minimum acceptable experimental_6 proof: peak active workers > 3 OR dashboard explains safe bottleneck
Overall DAG effective parallelism: 11 workspaces / 5 batches = 2.2
Critical path: 6.5.C → 6.5.E → 6.5.F2 → 6.5.H2 → 6.5.I (5 steps)
Serialized tail length: 3 (6.5.F2, 6.5.H2, 6.5.I)
```

---

## 9. Definition of Done

P6.5 is complete when ALL are true:

* [ ] Scale dashboard section exists.
* [ ] Dashboard shows selected scale mode.
* [ ] Dashboard shows requested workers and max allowed workers.
* [ ] Dashboard shows scale readiness and blocked reasons.
* [ ] Dashboard shows worktree status.
* [ ] Dashboard shows integration queue status.
* [ ] Dashboard shows merge conflict count and conflict details.
* [ ] Dashboard shows safe effective parallelism or explains why unavailable.
* [ ] Scheduler panel shows bottlenecks.
* [ ] Settings includes Scale & Safety tab.
* [ ] Settings blocks or warns on unsafe `experimental_6`.
* [ ] WorkerDetail includes P6 lifecycle tab shell (6.5.F1).
* [ ] WorkerDetail lifecycle tab is wired to queue/conflict data (6.5.F2).
* [ ] Worktree cleanup has review/confirmation.
* [ ] Stable_3 dogfood run is captured.
* [ ] Experimental_6 six-worker dogfood is attempted if readiness passes.
* [ ] If six-worker mode is blocked, dashboard shows exact reason.
* [ ] Integration queue does not merge unvalidated diffs.
* [ ] Merge conflicts produce handoff artifacts.
* [ ] No `git push` occurs.
* [ ] No raw destructive cleanup occurs.
* [ ] TypeScript compiles.
* [ ] Relevant tests pass.
* [ ] `docs/pi/stability/p6-5-scale-dashboard-report.md` exists.

---

## 10. Rollback Playbook

**Trigger conditions:**

* Scale dashboard shows misleading readiness.
* Settings allows unsafe `experimental_6`.
* Cleanup UI risks deleting wrong worktree.
* Integration queue panel hides blocked/conflict state.
* Six-worker dogfood creates unstable repo state.
* Build/test failures in dashboard or web-server.

**Rollback procedure:**

1. Hide P6.5 dashboard panels behind feature flag.
2. Reset selected scale mode to `stable_3`.
3. Set `maxParallelWorkspaces=3`.
4. Disable Scale & Safety settings writes.
5. Keep existing P6 scale routes read-only if safe.
6. Stop integration queue processing if dirty.
7. Preserve worktrees and conflict artifacts for debugging.
8. Fall back to current P6 dashboard components.
9. Document rollback reason in P6.5 report.

---

## 11. What P7 Inherits

P7 inherits:

* P6.5 scale dashboard cockpit.
* Scale & Safety settings tab.
* v2.3 scale-mode terminology in dashboard/API.
* Safe effective parallelism display.
* Worktree cleanup review UX.
* Integration queue/conflict visibility.
* Worker-level P6 lifecycle view.
* Six-worker dogfood evidence.

P7 may add:

* Policy engine v2.
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

Implement P6.5 — Scale Dashboard, Settings & Experimental 6-Worker Dogfood.

You are not adding another hidden backend optimization. You are making P6 operable. The user must be able to see whether six-worker execution is safe, why it is blocked, how worktrees are used, what is in the integration queue, where merge conflicts are, and whether the dogfood actually proved scale readiness.

---

## Hard Requirements

1. Default scale mode remains `stable_3`.
2. `experimental_6` must not run unless worktree isolation, integration queue, validation lock, and completion gate readiness pass.
3. Dashboard must distinguish `stable_3`, `experimental_6`, and `scale_8`.
4. Dashboard must show blocked reasons when scale mode is unsafe.
5. Settings must not silently enable unsafe scale mode.
6. Integration queue must not merge unvalidated workspace output.
7. Merge conflicts must produce handoff artifacts.
8. Worktree cleanup must never remove dirty, main, bare, locked, or active integration worktrees.
9. Raw destructive cleanup remains forbidden.
10. `git push` remains forbidden.
11. Watch-mode validation remains forbidden.
12. Dashboard controls must not directly mutate execution state.
13. Existing live logs, worker details, performance metrics, and plan summary must not regress.
14. Experimental six-worker dogfood must be attempted only if readiness passes; if blocked, report exact reason.

---

## Execution Policies

```yaml
scale:
  default_mode: stable_3
  selected_mode: experimental_6_for_dogfood
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

dashboard:
  scale_cockpit_enabled: true
  show_worktree_status: true
  show_integration_queue: true
  show_merge_conflicts: true
  show_safe_effective_parallelism: true
  show_bottleneck_reasons: true
  preserve_existing_live_logs: true

settings:
  add_scale_safety_tab: true
  block_unsafe_scale_mode: true
  expose_worker_count: true
  expose_worktree_isolation: true
  expose_integration_queue: true
  expose_validation_lock: true

dogfood:
  run_stable_3_baseline: true
  attempt_experimental_6: true
  max_parallel_workspaces: 6
  require_readiness_pass: true
  report_blocked_reason: true
```

---

## Safety Stops

Hard stop execution only for:

* Unsafe scale mode.
* Worktree path escaping `.pi/worktrees`.
* Raw destructive worktree cleanup.
* Integration merge without passed workspace validation.
* Integration validation failure.
* Merge conflict without handoff artifact.
* Queue starting next plan while integration queue is dirty.
* Scale mode approval stale or missing.
* Worktree isolation disabled while requesting more than 3 workers.
* Forbidden file access.
* Secrets access.
* `git push`.
* Watch-mode validation command.
* Dashboard attempting direct executor state mutation.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.3.0",
  "executionBackend": "json",
  "project": {
    "name": "pi-mono",
    "rootPath": "/Users/hootie/src/pi",
    "type": "repo",
    "tags": [
      "p6.5",
      "scale-dashboard",
      "worktree-visibility",
      "integration-queue",
      "experimental-6",
      "dogfood"
    ]
  },
  "planExecution": {
    "phase": "P6.5",
    "title": "Scale Dashboard, Settings & Experimental 6-Worker Dogfood",
    "mode": "autonomous",
    "maxParallelWorkspaces": 6,
    "stateBackend": "json",
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
      "gitPushAllowed": false
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
      "watch_mode_validation"
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
        "Computed at preflight by scale readiness doctor"
      ],
      "warnings": [],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": null,
          "message": "Required for experimental_6."
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": null,
          "message": "Required for experimental_6."
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": null,
          "message": "Required for experimental_6."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": null,
          "message": "Required for experimental_6."
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 4,
    "expectedSafeEffectiveParallelismMin": 4,
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
            "6.5.C"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "6.5.A",
            "6.5.B",
            "6.5.D",
            "6.5.E",
            "6.5.G",
            "6.5.F1",
            "6.5.H1"
          ],
          "effectiveParallelism": 7
        },
        {
          "batch": 3,
          "workspaceIds": [
            "6.5.F2"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 4,
          "workspaceIds": [
            "6.5.H2"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 5,
          "workspaceIds": [
            "6.5.I"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 2.2,
      "criticalPath": [
        "6.5.C",
        "6.5.E",
        "6.5.F2",
        "6.5.H2",
        "6.5.I"
      ],
      "criticalPathLength": 5,
      "serializedTailLength": 3
    },
    "safeBatchPreview": {
      "batches": [],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [
        "Serialized tail is intentional: 6.5.F2 needs queue/conflict wiring from 6.5.E, 6.5.H2 needs dashboard visibility, 6.5.I needs dogfood results"
      ],
      "blockedParallelismReasons": []
    },
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason",
      "workspaces[].parallelism.canRunWith",
      "workspaces[].parallelism.cannotRunWith",
      "workspaces[].parallelism.conflictScope"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "safe_parallelism_below_dag_parallelism",
      "long_serialized_tail_is_intentional",
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "scale_mode_prerequisites_missing",
      "worktree_isolation_required_for_scale"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "safe_batch_preview",
      "critical_path",
      "scale_mode_readiness",
      "approved_dependency_patch",
      "approved_graph_hash"
    ]
  },
  "workspaces": [
    {
      "id": "6.5.C",
      "title": "Scale route and hook schema alignment",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Route and hook schema must be aligned before UI components consume v2.3 scale readiness.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-server/src/scale-routes.ts",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation schema work; should run first."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-server/src/scale-routes.ts",
        "packages/web-server/test/scale-routes.test.ts",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
        "packages/web-ui/dashboard/src/types.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Scale readiness uses stable_3 / experimental_6 / scale_8 terminology",
        "Readiness includes requestedWorkers and maxAllowedWorkers",
        "Readiness includes blockedReasons and warnings",
        "Six-worker readiness is representable",
        "Route and hook tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- scale-routes",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/scale-routes.ts",
          "packages/web-server/test/scale-routes.test.ts",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
          "packages/web-ui/dashboard/src/types.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
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
          "scale_readiness_checked",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.5.A",
      "title": "Scale dashboard information architecture",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Needs v2.3 scale readiness schema from 6.5.C.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "6.5.B",
          "6.5.D"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/App.tsx"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with settings and worktree panel work if App.tsx edits are coordinated."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/ScaleCockpitPanel.tsx",
        "packages/web-ui/dashboard/src/components/ScaleOverviewStrip.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Scale cockpit section exists",
        "Worktree, integration queue, conflict, and readiness panels are visible together",
        "Existing live logs and WorkerDetail remain accessible",
        "Dashboard remains responsive",
        "Build passes"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/ScaleCockpitPanel.tsx",
          "packages/web-ui/dashboard/src/components/ScaleOverviewStrip.tsx"
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
    },
    {
      "id": "6.5.B",
      "title": "Scale & Safety settings tab",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Needs v2.3 scale readiness schema from 6.5.C.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "6.5.A",
          "6.5.D"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
          "packages/web-ui/dashboard/src/hooks/useSettings.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Settings work is isolated from scale cockpit if App.tsx is not touched."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
        "packages/web-ui/dashboard/src/hooks/useSettings.ts",
        "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Settings includes Scale & Safety tab",
        "stable_3 remains default",
        "experimental_6 is blocked or warned when prerequisites fail",
        "scale_8 is visible but disabled without dogfood pass and explicit approval",
        "Existing settings tabs still work"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
          "packages/web-ui/dashboard/src/hooks/useSettings.ts",
          "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx"
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
    },
    {
      "id": "6.5.D",
      "title": "Worktree status and cleanup review",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Needs v2.3 scale hook and route shape from 6.5.C.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "6.5.A",
          "6.5.B"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
          "packages/web-server/src/scale-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with dashboard layout/settings if backend route edits are coordinated with 6.5.C completion."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
        "packages/web-ui/dashboard/src/components/WorktreeCleanupDialog.tsx",
        "packages/web-server/src/scale-routes.ts",
        "packages/web-server/test/scale-routes.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Worktree panel shows branch, commit, path, dirty, locked, and cleanup eligibility",
        "Bulk cleanup requires confirmation",
        "Cleanup dialog lists affected worktrees",
        "Dirty/main/bare/locked/active worktrees cannot be removed",
        "Cleanup tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- scale-routes",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
          "packages/web-ui/dashboard/src/components/WorktreeCleanupDialog.tsx",
          "packages/web-server/src/scale-routes.ts",
          "packages/web-server/test/scale-routes.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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
    },
    {
      "id": "6.5.E",
      "title": "Integration queue and merge conflict visibility",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Needs scale route/hook schema alignment from 6.5.C.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "6.5.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/components/MergeConflictPanel.tsx"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with scheduler bottleneck display if route schema is stable."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/web-ui/dashboard/src/components/MergeConflictPanel.tsx",
        "packages/web-ui/dashboard/src/App.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Queue shows blocked reason and validation status",
        "Conflict entries open handoff panel",
        "Alerts show conflict count",
        "Conflict is distinct from ordinary failed workspace",
        "Build passes"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/components/MergeConflictPanel.tsx",
          "packages/web-ui/dashboard/src/App.tsx"
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
    },
    {
      "id": "6.5.G",
      "title": "Scheduler safe parallelism and scale bottleneck display",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Needs scale readiness and stats schema from 6.5.C.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "6.5.E"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
          "packages/web-server/src/execution-stats.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with integration queue visibility if App.tsx placement is coordinated."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
        "packages/web-server/src/execution-stats.ts",
        "packages/web-server/test/execution-stats.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Scheduler panel shows requested workers and max allowed workers",
        "Scheduler panel shows safe effective parallelism if available",
        "Scheduler panel shows bottleneck reasons",
        "Existing progress display remains",
        "Stats tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- execution-stats",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/SchedulerStatusPanel.tsx",
          "packages/web-server/src/execution-stats.ts",
          "packages/web-server/test/execution-stats.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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
    },
    {
      "id": "6.5.F1",
      "title": "WorkerDetail P6 lifecycle tab shell",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Tab shell needs v2.3 scale schema from 6.5.C to show basic workspace state.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "6.5.A",
          "6.5.B",
          "6.5.D",
          "6.5.E",
          "6.5.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Tab shell adds layout only and does not require queue/conflict wiring."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
        "packages/web-ui/dashboard/src/types.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "WorkerDetail has a P6 Lifecycle tab",
        "Tab renders without queue/conflict data",
        "Existing WorkerDetail tabs still work",
        "Typecheck/build passes"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
          "packages/web-ui/dashboard/src/types.ts"
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
    },
    {
      "id": "6.5.F2",
      "title": "WorkerDetail lifecycle queue/conflict wiring",
      "dependencies": [
        "6.5.E",
        "6.5.F1"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Needs queue/conflict data from 6.5.E and tab shell from 6.5.F1.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Queue/conflict wiring must wait for integration queue visibility from 6.5.E."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Lifecycle tab shows queue/integration/conflict status",
        "Conflict workspace links to handoff panel",
        "Completed workspace shows merged/integrated status",
        "Failed workspace shows quarantine/cleanup state if available",
        "Existing WorkerDetail tabs still work"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerP6LifecycleTab.tsx",
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
    },
    {
      "id": "6.5.H1",
      "title": "Experimental 6-worker dogfood harness",
      "dependencies": [
        "6.5.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Dogfood harness needs v2.3 scale schema from 6.5.C for readiness checks.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "6.5.A",
          "6.5.B",
          "6.5.D",
          "6.5.E",
          "6.5.G",
          "6.5.F1"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Scaffold work and report template can run early; does not execute the actual dogfood."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
        "docs/pi/stability/p6-5-scale-dashboard-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Dogfood harness exists",
        "Report template exists",
        "Stable_3 and experimental_6 checklist sections exist",
        "No actual dogfood execution is required in this workspace",
        "Typecheck/test scaffold passes if applicable"
      ],
      "targetCommand": "npm run typecheck && npm test -- p65-experimental-6-dogfood",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
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
      "id": "6.5.H2",
      "title": "Actual stable_3 and experimental_6 dogfood run",
      "dependencies": [
        "6.5.A",
        "6.5.B",
        "6.5.D",
        "6.5.E",
        "6.5.F2",
        "6.5.G",
        "6.5.H1"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Dogfood must run after the dashboard, settings, scheduler, queue/conflict wiring, and dogfood harness are ready.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Dogfood validates the full result and must run after all dashboard workstreams."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
        "docs/pi/stability/p6-5-scale-dashboard-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "stable_3 dogfood result captured",
        "experimental_6 dogfood attempted if readiness passes",
        "If experimental_6 is blocked, exact blocked reason is recorded",
        "If experimental_6 runs, peak active workers should exceed 3 unless safe bottlenecks prevent it",
        "Integration queue and conflict results are captured",
        "no git push or raw destructive cleanup occurs"
      ],
      "targetCommand": "npm run typecheck && npm test -- p65-experimental-6-dogfood",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p65-experimental-6-dogfood.test.ts",
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
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
          "scale_readiness_checked",
          "experimental_6_dogfood_started",
          "experimental_6_dogfood_completed",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.5.I",
      "title": "P6.5 dashboard stability report",
      "dependencies": [
        "6.5.H2"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Report depends on implementation and dogfood evidence.",
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Final reporting runs last."
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
        "conflictHandoffRequired": true
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "docs/pi/stability/p6-5-scale-dashboard-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Report states whether experimental_6 is usable",
        "Report includes dashboard gaps before P7",
        "Report includes settings behavior",
        "Report confirms no safety regressions",
        "Report includes dogfood result or blocked reason"
      ],
      "targetCommand": "npm run typecheck",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "docs/pi/stability/p6-5-scale-dashboard-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck"
        ],
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

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.3.0",
  "phase": "P6.5",
  "title": "Scale Dashboard, Settings & Experimental 6-Worker Dogfood",
  "primaryGoal": "Make P6 scale execution visible, configurable, and dogfood experimental_6 with six workers when readiness passes.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "safeEffectiveParallelismTarget": 4,
  "notInScope": [
    "P7 policy engine v2",
    "Enterprise approval workflows",
    "Remote execution",
    "Release orchestration",
    "Autonomous planning"
  ],
  "workspaceCount": 11,
  "batchCount": 5,
  "batchWidthPeak": 7,
  "criticalPath": [
    "6.5.C",
    "6.5.E",
    "6.5.F2",
    "6.5.H2",
    "6.5.I"
  ],
  "serializedTailLength": 3,
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
    "worktree_required_for_requested_parallelism",
    "watch_mode_validation"
  ],
  "completionGate": "Dashboard shows P6 scale readiness/worktree/integration/conflict/safe-parallelism clearly, settings can configure safe scale mode, and experimental_6 dogfood is attempted or blocked with exact reason.",
  "nextPhase": "P7"
}
```

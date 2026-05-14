# Phase P6 — Large Project Scale & Reliability

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.1.0  
**Created:** 2026-05-13  
**Target system:** Pi autonomous coding runtime  
**Goal:** Make Pi reliable and fast on large projects by isolating each workspace in its own git worktree, adding a merge/integration queue, enabling safe higher parallelism, improving test impact analysis, and classifying failures for smarter retries.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P6  
**One-line goal:** Move Pi from shared-working-tree parallelism to isolated workspace execution with worktrees, merge queue, dynamic scheduling, targeted validation, and safe 6+ worker mode.  
**Why now:** P4.6 made execution visible and trustworthy. P5 made execution durable and operational. P5.5 reduced token/context/validation waste. P6 now attacks the main large-project bottleneck: multiple workers sharing one working tree. Without isolation, higher parallelism causes file conflicts, validation contention, dirty repo state, and unreliable commits.  
**Blast radius:** Git execution layer, workspace scheduler, validation planner, state store, archive/replay metadata, dashboard run overview, merge/integration flow, tests. Product application source changes are forbidden except fixtures/docs.  
**Rollback path:** Disable worktree mode and dynamic scheduler; fall back to P5.5 shared-working-tree execution with max 3 workers and global validation lock. Preserve worktree artifacts for debugging.  
**Done when:** Each workspace can run in an isolated git worktree, successful workspaces enter an integration queue, merge conflicts are detected and surfaced, validation is staged, failed worktrees can be discarded, and safe 6+ worker execution is available behind explicit settings and doctor checks.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P6 |
| Title | Large Project Scale & Reliability |
| Status | Planned |
| Last updated | 2026-05-13 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Worktree isolation, merge queue, dynamic scheduler, large-project reliability |
| Product-code changes | Forbidden — Pi runtime/dashboard/tests/docs only |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 6.A — Workspace isolation via git worktrees | Pi Worker Agent | User / owner | Reviewer | User |
| 6.B — Worktree lifecycle and cleanup manager | Pi Worker Agent | User / owner | Reviewer | User |
| 6.C — Integration branch and merge queue | Pi Worker Agent | User / owner | Reviewer | User |
| 6.D — Merge conflict detection and handoff | Pi Worker Agent | User / owner | Reviewer | User |
| 6.E — Dynamic parallel scheduler | Pi Worker Agent | User / owner | Reviewer | User |
| 6.F — Safe 6+ worker mode | Pi Worker Agent | User / owner | Reviewer | User |
| 6.G — Test impact analysis v1 | Pi Worker Agent | User / owner | Reviewer | User |
| 6.H — Failure classifier and retry routing | Pi Worker Agent | User / owner | Reviewer | User |
| 6.I — Repo symbol / ownership graph v1 | Pi Worker Agent | User / owner | Reviewer | User |
| 6.J — Dashboard scale controls and integration visibility | Pi Worker Agent | User / owner | Reviewer | User |
| 6.K — Large-project dogfood and stability report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P6 changes the execution model from multiple workers sharing one repo checkout to multiple isolated workspaces, each with its own git worktree. This is the key step required before Pi can safely use more than three workers on large projects.

The current shared-working-tree model is acceptable for small and medium plans, but it has structural limits:

* Workers can step on each other's changes.
* File locks become overly conservative.
* Dirty working tree state blocks progress.
* Failed workspaces are hard to discard cleanly.
* Validation commands contend for the same checkout.
* Higher worker counts increase chaos instead of throughput.

P6 introduces a more production-grade execution topology:

```text
base repo checkout
→ per-workspace git worktree
→ workspace implementation + local validation
→ workspace diff artifact
→ integration queue
→ integration branch merge
→ integration validation
→ commit / handoff
```

This allows Pi to scale parallelism safely while keeping correctness gates intact. P6 is not about public platformization or agent-agnostic split. It is about making the current Pi fork a robust large-project executor.

---

## 3. What Carried Over — Must Stay Stable

* [x] P4.5 adaptive edit strategy and failure handoff remain active.
* [x] P4.6 visibility, progress, live logs, hung detection, and resume confidence remain active.
* [x] P4.6.1 completion gate hardening remains active.
* [x] P4.6.2 parser metadata and workspace count consistency remain active.
* [x] P5 execution archive / Plan Vault remains canonical when available.
* [x] P5 queue must not start next plan until current integration state is clean.
* [x] P5.5 prompt cache, retrieval, execution memory, and targeted validation remain active.
* [x] Global validation lock remains active for shared resources.
* [x] `git push` remains forbidden.
* [x] Raw `rm -rf` remains forbidden.
* [x] Secrets and forbidden files remain blocked.
* [x] Dashboard/control UI cannot directly mutate execution state.
* [x] Executor remains source of truth for state transitions.
* [x] TypeScript strict mode remains required.
* [x] No new npm dependencies without explicit approval.

---

## 4. Background / What Was Wrong

Pi's current parallelism is bounded mostly by safety concerns, not compute. Running three workers in one checkout already exposes problems: validation contention, conflicting edits, dirty tree ambiguity, repeated retries, and poor recovery when a worker fails halfway through.

Raising `maxParallelWorkspaces` to 6 in the current shared-working-tree model is unsafe. It increases the chance that workers touch overlapping files, run heavy validation simultaneously, or leave the repo in an inconsistent partial state.

The correct scaling primitive is git worktree isolation. Each workspace gets its own clean checkout tied to a base commit. It can edit, validate, fail, and be discarded without corrupting the main checkout or other workers. Successful workspaces do not directly mutate the main repo. They enter a controlled integration queue where merges and validation happen serially or with stricter gates.

P6 makes this shift.

---

## 5. Current Failure State / Known Blockers

* `workspace_worktree_isolation` = not implemented — workers still share the same checkout.
* `worktree_lifecycle_manager` = missing — no create/list/cleanup/archive lifecycle for workspace checkouts.
* `integration_queue` = missing — completed workspace diffs are not merged through a controlled queue.
* `merge_conflict_handoff` = incomplete — conflicts are not surfaced as first-class reviewable artifacts.
* `dynamic_scheduler` = incomplete — worker count is static and file-lock driven.
* `safe_6_worker_mode` = not production-ready — higher parallelism is unsafe without isolation.
* `test_impact_analysis` = incomplete — validation is broader and slower than necessary.
* `failure_classifier` = incomplete — retries do not adapt based on failure type.
* `repo_symbol_graph` = incomplete — scheduler and retrieval lack strong import/ownership/test mapping.
* `dashboard_integration_visibility` = incomplete — users cannot see worktree/integration queue state clearly.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Worktree creation corrupts repo state | low | critical | Use git worktree porcelain commands only; never manually copy `.git` |
| Integration queue merges bad diff | med | high | Require workspace validation + integration validation before commit |
| Merge conflicts block plan | med | med | Surface conflict as handoff with patch/conflict artifact |
| Higher parallelism overloads CPU/memory | med | high | Dynamic scheduler respects resource limits and validation lock |
| Worktree cleanup deletes wrong files | low | critical | No raw `rm -rf`; cleanup uses scoped quarantine/trash API |
| Test impact misses failure | med | high | Targeted tests are early gate; final integration validation remains required |
| Failure classifier misroutes retry | med | med | Classifier suggests strategy, but hard failures still block/handoff |
| Dashboard shows stale worktree status | med | low | State events are source of truth; polling/SSE refresh |
| Queue starts next plan before integration clean | low | high | P5 queue clean-tree gate includes integration queue state |

---

## 7. Workstreams

### 6.A — Workspace isolation via git worktrees

**Goal:** Run each workspace in its own git worktree rooted at the plan base commit.

**Requirements:**
* Add `WorktreeWorkspaceExecutor` or equivalent execution mode.
* Create worktrees under `.pi/worktrees/{planExecId}/{workspaceId}/`.
* Each workspace records:
  * base commit
  * worktree path
  * branch name
  * workspace id
  * plan execution id
  * createdAt
* Workspace commands run inside its worktree, not the main checkout.
* Worktree mode is opt-in initially and can be disabled.
* Existing shared-working-tree mode remains available as fallback.
* Worktree paths must be scoped and path-traversal safe.

**Acceptance Criteria:**
* A workspace can execute inside its own git worktree.
* Main checkout remains clean while workspace edits occur.
* Workspace state records worktree path and base commit.
* Two independent workspaces can edit different files concurrently in separate worktrees.
* Worktree mode can be disabled to fall back to P5.5 behavior.
* Tests cover create/run/path-safety behavior.

---

### 6.B — Worktree lifecycle and cleanup manager

**Goal:** Manage worktree creation, archival, quarantine, and cleanup safely.

**Requirements:**
* Add `WorktreeManager` service.
* Operations:
  * create worktree
  * list worktrees
  * mark completed
  * mark failed
  * quarantine failed worktree
  * cleanup safe worktree
  * archive diff/metadata
* Cleanup must not use raw `rm -rf`.
* Cleanup must verify path under `.pi/worktrees/{planExecId}/`.
* Failed worktrees are quarantined by default until reviewed or retention expires.
* Worktree metadata is archived into execution archive.

**Acceptance Criteria:**
* Failed worktree is preserved/quarantined for review.
* Completed worktree produces diff artifact.
* Cleanup refuses paths outside `.pi/worktrees`.
* Cleanup does not use raw destructive commands.
* Worktree list API shows status and disk usage if available.
* Tests cover path safety and quarantine behavior.

---

### 6.C — Integration branch and merge queue

**Goal:** Merge successful workspace diffs through a controlled integration queue instead of directly mutating the main checkout.

**Requirements:**
* Add integration branch per plan:
  * `pi/integration/{planExecId}` or equivalent local branch.
* Add `IntegrationQueue` service.
* Completed workspace enters queue with:
  * workspace id
  * diff artifact
  * base commit
  * validation summary
  * changed files
  * risk level
* Queue processes one merge at a time initially.
* Before merge:
  * verify workspace validation passed
  * verify no unresolved failure events
  * verify worktree diff exists
* After merge:
  * run integration validation plan
  * record commit/hash or conflict status
* `git push` remains forbidden.

**Acceptance Criteria:**
* Successful workspace enters integration queue.
* Queue merges one workspace at a time into integration branch.
* Failed validation blocks merge.
* Integration validation runs after merge.
* Merge result is recorded in archive/state.
* `git push` is never run.

---

### 6.D — Merge conflict detection and handoff

**Goal:** Surface merge conflicts as first-class handoff artifacts.

**Requirements:**
* Detect merge conflict during integration queue processing.
* Mark workspace integration status as `merge_conflict`.
* Stop integration queue by default on conflict.
* Generate conflict artifact:
  * conflicting files
  * workspace id
  * base commit
  * integration branch state
  * conflict summary
  * suggested resolution steps
* Dashboard shows conflict panel.
* User can resolve manually and resume integration queue.
* Conflict does not mark plan complete.

**Acceptance Criteria:**
* Merge conflict does not silently fail or mark complete.
* Conflict artifact is written.
* Dashboard shows conflict status and files.
* Integration queue stops safely on conflict.
* Manual resolution + resume path is documented/tested.

---

### 6.E — Dynamic parallel scheduler

**Goal:** Replace static worker selection with a scheduler that adapts to dependencies, file conflicts, resource pressure, validation lock, and worktree isolation.

**Requirements:**
* Scheduler inputs:
  * max worker setting
  * experimental mode flag
  * dependency graph
  * worktree mode enabled
  * file/symbol overlap
  * validation lock queue depth
  * CPU/memory load if available
  * workspace risk level
  * failure history
* Scheduler outputs:
  * selected workspaces
  * skipped workspaces
  * skip reason
  * capacity reason
* In worktree mode, disjoint file edits may run with higher concurrency.
* Same-file parallelism remains disabled unless explicitly safe and isolated.
* High-risk workspaces can be weighted lower concurrency.
* Scheduler diagnostics remain visible from P4.6.

**Acceptance Criteria:**
* Scheduler fills capacity with ready-safe workspaces.
* Scheduler can use higher concurrency in worktree mode.
* Scheduler reduces concurrency when validation lock/resource pressure is high.
* Scheduler explains skipped/selected decisions.
* Same-file conflicts are not run unsafely.
* Tests cover dynamic capacity decisions.

---

### 6.F — Safe 6+ worker mode

**Goal:** Enable 4–8 worker execution only when worktree isolation and safety checks are active.

**Requirements:**
* Add `scaleMode` setting:
  * `stable_3`
  * `experimental_6`
  * `scale_8`
* Defaults to `stable_3`.
* `experimental_6` requires:
  * worktree isolation enabled
  * integration queue enabled
  * global validation lock enabled
  * P4.6 completion gate hardening enabled
  * P5 archive enabled
  * P5.5 targeted validation enabled
* `scale_8` requires explicit confirmation and dogfood pass.
* Doctor warns or fails if prerequisites missing.
* UI labels higher modes as experimental until dogfood success.

**Acceptance Criteria:**
* 6 workers cannot be enabled without worktree isolation.
* 6 workers cannot be enabled without integration queue.
* 6 workers cannot be enabled without global validation lock.
* Doctor reports readiness for scale mode.
* Dashboard shows current scale mode and prerequisite status.
* Stable default remains 3 workers.

---

### 6.G — Test impact analysis v1

**Goal:** Improve validation speed by mapping changed files to likely tests and required integration checks.

**Requirements:**
* Build test impact analyzer from:
  * changed files
  * package boundaries
  * test filename conventions
  * imports/symbol graph when available
  * prior execution memory from P5.5
* Output:
  * likely unit tests
  * package-level checks
  * required final integration checks
  * confidence level
* Low confidence falls back to broader validation.
* Full final validation remains required before plan completion for high-risk plans.
* Global validation lock still serializes heavy commands.

**Acceptance Criteria:**
* Analyzer maps dashboard component changes to dashboard tests/build.
* Analyzer maps coding-agent core changes to coding-agent tests/typecheck.
* Low confidence uses broader validation.
* Test impact result is logged and visible.
* Tests cover common repo areas.

---

### 6.H — Failure classifier and retry routing

**Goal:** Classify failures so retries use the right strategy instead of blindly repeating.

**Requirements:**
* Add failure categories:
  * type_error
  * test_failure
  * flaky_test
  * edit_failure
  * merge_conflict
  * validation_timeout
  * missing_context
  * forbidden_action
  * dependency_conflict
  * reviewer_rejection
* Classifier inputs:
  * command exit code
  * stderr/stdout snippets
  * test output
  * edit failure events
  * validation lock timeouts
  * merge queue status
* Retry routing examples:
  * type_error → inspect error file + targeted patch
  * flaky_test → rerun once, then classify stable failure
  * missing_context → retrieval expansion
  * edit_failure → P4.5 handoff after threshold
  * merge_conflict → integration handoff
* Store classifier result in archive and execution memory.

**Acceptance Criteria:**
* Failures are classified into known categories.
* Retry strategy changes based on failure category.
* Merge conflicts do not retry as ordinary coding failures.
* Failure classification is visible in dashboard/logs.
* Tests cover major failure categories.

---

### 6.I — Repo symbol / ownership graph v1

**Goal:** Build a lightweight repo graph for scheduling, retrieval, test impact, and conflict prediction.

**Requirements:**
* Build graph from:
  * file paths
  * imports/exports where cheaply parsed
  * package boundaries
  * test associations
  * ownership/config conventions if present
  * recent changed files
* Graph supports queries:
  * files likely related to workspace
  * tests likely affected by file
  * workspaces likely to conflict
  * package or module boundary
* Graph must ignore forbidden files.
* Graph can be rebuilt incrementally or lazily.
* No external database required in v1.

**Acceptance Criteria:**
* Graph maps files to related tests where conventions exist.
* Graph helps detect likely cross-workspace conflicts.
* Graph is used by scheduler/test impact/retrieval.
* Graph ignores forbidden files.
* Tests cover import/test association behavior.

---

### 6.J — Dashboard scale controls and integration visibility

**Goal:** Make worktrees, integration queue, scale mode, and merge status visible and controllable.

**Requirements:**
* Add dashboard panels for:
  * worktree list/status
  * integration queue
  * merge status
  * scale mode readiness
  * active worker count
  * validation lock queue
  * conflict handoff
* Controls:
  * enable worktree mode
  * select scale mode
  * pause integration queue
  * resume integration queue
  * open conflict handoff
  * cleanup/quarantine reviewed worktrees
* UI must not directly mutate state; controls go through executor/control APIs.

**Acceptance Criteria:**
* User can see each workspace worktree status.
* User can see integration queue status.
* User can see merge conflicts and handoff details.
* User can see why 6-worker mode is enabled/blocked.
* Worktree cleanup is scoped and safe.
* Dashboard remains responsive.

---

### 6.K — Large-project dogfood and stability report

**Goal:** Prove P6 works on a realistic plan with isolated worktrees and higher parallelism.

**Requirements:**
* Create dogfood plan with at least 8 workspaces.
* Run once in stable_3 worktree mode.
* Run once in experimental_6 mode if doctor passes.
* Validate:
  * worktree creation
  * concurrent isolated edits
  * integration queue merges
  * merge conflict fixture
  * test impact planning
  * failure classification
  * validation lock behavior
  * dashboard visibility
* Publish `docs/pi/stability/p6-large-project-scale-report.md`.

**Acceptance Criteria:**
* Dogfood report exists.
* Worktree isolation is proven.
* Integration queue is proven.
* Failed worktree discard/quarantine is proven.
* Experimental 6-worker mode is validated or blocked with clear reason.
* No `git push` occurs.
* TypeScript and relevant tests pass.

---

## 8. Combined Implementation Order

```text
Batch 0: 6.A, 6.I
Batch 1: 6.B, 6.G
Batch 2: 6.C, 6.H
Batch 3: 6.D, 6.E, 6.F, 6.J
Batch 4: 6.K
```

**Batching rationale:**

* **6.A + 6.I in parallel** — Worktree executor and symbol graph are fully independent. Both are foundational for downstream workstreams.
* **6.B + 6.G in parallel** — Lifecycle manager needs 6.A; test impact analyzer needs 6.I. No cross-dependency.
* **6.C + 6.H in parallel** — Integration queue needs 6.A+6.B; failure classifier needs 6.G. No cross-dependency.
* **6.D, 6.E, 6.F, 6.J in parallel** — Once integration queue (6.C) exists, merge conflict detection, dynamic scheduler, scale mode, and dashboard are all independently implementable:
  * 6.E does NOT need 6.D — scheduler uses dependency graph and worktree mode, not conflict status.
  * 6.F does NOT need 6.E — scale mode policy only requires worktree isolation (6.A) and integration queue (6.C), not the dynamic scheduler.
  * 6.J does NOT need 6.F or 6.H — dashboard panels consume backend API shapes; stubs defined alongside the APIs.
* **6.K last** — Dogfood validates everything together.

With `maxParallelWorkspaces=3`, effective utilization:

| Batch | Workspaces | Workers Used | Capacity |
|-------|-----------|-------------|----------|
| 0 | 6.A, 6.I | 2/3 | 67% |
| 1 | 6.B, 6.G | 2/3 | 67% |
| 2 | 6.C, 6.H | 2/3 | 67% |
| 3 | 6.D, 6.E, 6.F, 6.J | 3/3 | 100% |
| 4 | 6.K | 1/3 | 33% |

The 1-worker gap in batches 0-2 is inherent to the hard dependency chain (6.A -> 6.B -> 6.C) which is sequential by nature.

---

## 9. Definition of Done

P6 is complete when ALL are true:

* [ ] Each workspace can run in an isolated git worktree.
* [ ] Main checkout remains clean while isolated workspaces edit files.
* [ ] Worktree lifecycle manager can create, list, quarantine, archive, and safely cleanup worktrees.
* [ ] Successful workspace diffs enter integration queue.
* [ ] Integration queue merges workspaces into a plan integration branch.
* [ ] Merge conflicts are detected and surfaced as handoff artifacts.
* [ ] Dynamic scheduler uses dependencies, file conflicts, resource pressure, validation lock, and worktree mode.
* [ ] 6-worker mode is available only when all safety prerequisites pass.
* [ ] Stable default remains 3 workers.
* [ ] Test impact analyzer maps changed files to likely tests and required final checks.
* [ ] Failure classifier routes retries by failure type.
* [ ] Repo symbol/ownership graph supports retrieval, scheduling, and test impact.
* [ ] Dashboard shows worktrees, integration queue, merge state, scale mode readiness, and validation lock queue.
* [ ] P5 queue does not start next plan until integration queue is clean.
* [ ] Global validation lock remains active.
* [ ] Watch-mode validation remains forbidden.
* [ ] Completion gate hardening remains active.
* [ ] No `git push` occurs.
* [ ] TypeScript compiles cleanly.
* [ ] P6 dogfood report proves large-project scale behavior.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Worktree creation corrupts repo or creates unsafe paths.
* Integration queue merges incorrect or unvalidated diffs.
* Merge conflicts are not detected.
* 6-worker mode causes resource exhaustion or state corruption.
* Cleanup/quarantine deletes wrong files.
* Test impact analysis misses critical failures.
* Dashboard controls mutate state directly or bypass executor.

**Rollback procedure:**
1. Set `worktreeMode.enabled=false`.
2. Set `scaleMode=stable_3`.
3. Disable integration queue processing.
4. Preserve `.pi/worktrees/{planExecId}/` for debugging.
5. Disable dynamic scheduler and fall back to P5.5 shared checkout scheduler.
6. Disable test impact planner and use targetCommand/full validation.
7. Keep failure classifier read-only if safe.
8. Revert P6 commits independently if needed.

**Recovery time:** < 15 minutes.

---

## 11. What Phase P7 Inherits

P7 inherits:

* Worktree-isolated workspace execution
* Worktree lifecycle manager
* Integration branch and merge queue
* Merge conflict handoff
* Dynamic parallel scheduler
* Safe 6+ worker mode prerequisites
* Test impact analysis v1
* Failure classifier
* Repo symbol / ownership graph v1
* Dashboard scale controls and integration visibility
* Large-project dogfood report

P7 may add:

* Agent-agnostic runtime layer
* Policy engine v2
* Approval rules
* Autonomous plan generation
* PR/release workflow
* Remote skill registry
* Enterprise audit and governance

---

# Part 2 — Agent Brief

## Mission

Implement P6 — Large Project Scale & Reliability.

You are moving Pi from shared-working-tree execution to isolated worktree execution with an integration queue. This is the scale foundation required for large projects and safe 6+ worker mode. Do not trade correctness for speed. Worktree isolation, merge safety, validation gates, and dashboard visibility are non-negotiable.

---

## Hard Requirements

1. Worktree mode must be opt-in until dogfood passes.
2. Each workspace worktree must be scoped under `.pi/worktrees/{planExecId}/{workspaceId}/`.
3. Worktree cleanup must not use raw `rm -rf`.
4. Main checkout must remain clean while isolated workspaces run.
5. Successful workspaces must merge through integration queue, not directly mutate main checkout.
6. Integration queue must stop on merge conflict by default.
7. Merge conflict must produce handoff artifact.
8. 6-worker mode must require worktree isolation and integration queue.
9. Stable default remains 3 workers.
10. Global validation lock remains active.
11. Watch-mode validation remains forbidden.
12. Completion gate hardening remains active.
13. P5 queue must not start next plan until integration queue is clean.
14. `git push` remains forbidden.
15. Raw `rm -rf` remains forbidden.
16. No secrets or forbidden files may be read.
17. No new npm dependencies without explicit approval.
18. TypeScript strict mode: no new `as any`, `@ts-ignore`, or `@ts-expect-error`.

---

## Execution Policies

```yaml
scale:
  default_mode: stable_3
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
      dogfood_pass_required: true

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

validation:
  global_validation_lock_required: true
  targeted_validation_enabled: true
  final_integration_validation_required: true
  watch_mode_forbidden: true
```

---

## Safety Stops

Hard stop execution only for:

* worktree path escaping `.pi/worktrees`
* raw destructive cleanup command
* integration merge without passed workspace validation
* integration validation failure
* merge conflict without handoff artifact
* 6-worker mode without required prerequisites
* completed workspace marked complete despite failed validation
* P5 queue attempting next plan while integration queue dirty
* forbidden file access
* secrets/env/private-key access
* `git push`
* raw destructive commands

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "json",
  "project": {
    "name": "pi-mono",
    "rootPath": "/Users/hootie/src/pi",
    "type": "repo",
    "tags": [
      "p6",
      "large-project-scale",
      "worktree-isolation",
      "merge-queue",
      "dynamic-scheduler",
      "safe-6-workers"
    ]
  },
  "planExecution": {
    "phase": "P6",
    "title": "Large Project Scale & Reliability",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "json",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "postPlanHandoff": true,
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
          "dogfoodPassRequired": true
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
      "gitPushAllowed": false
    },
    "validation": {
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "watchModeForbidden": true
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
      "git_push",
      "worktree_path_escape",
      "raw_destructive_cleanup",
      "integration_merge_without_validation",
      "integration_validation_failure",
      "merge_conflict_without_handoff",
      "unsafe_scale_mode",
      "queue_next_plan_while_integration_dirty"
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
  "workspaces": [
    {
      "id": "6.A",
      "title": "Workspace isolation via git worktrees",
      "dependencies": [],
      "allowedFiles": [
        "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
        "packages/coding-agent/src/worktree/worktree-types.ts",
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/test/worktree-workspace-executor.test.ts",
        "docs/pi/scale/worktree-isolation.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "A workspace can execute inside its own git worktree",
        "Main checkout remains clean while workspace edits occur",
        "Workspace state records worktree path and base commit",
        "Two independent workspaces can edit different files concurrently in separate worktrees",
        "Worktree mode can be disabled to fall back to P5.5 behavior"
      ],
      "targetCommand": "npm run typecheck && npm test -- worktree-workspace-executor",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/src/worktree/worktree-types.ts",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/worktree-workspace-executor.test.ts",
          "docs/pi/scale/worktree-isolation.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "git status",
          "git worktree list"
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
          "worktree_created",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.B",
      "title": "Worktree lifecycle and cleanup manager",
      "dependencies": [
        "6.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/worktree/worktree-manager.ts",
        "packages/coding-agent/src/worktree/worktree-cleanup.ts",
        "packages/coding-agent/test/worktree-manager.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Failed worktree is preserved/quarantined for review",
        "Completed worktree produces diff artifact",
        "Cleanup refuses paths outside .pi/worktrees",
        "Cleanup does not use raw destructive commands",
        "Worktree list API shows status"
      ],
      "targetCommand": "npm run typecheck && npm test -- worktree-manager",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/worktree/worktree-manager.ts",
          "packages/coding-agent/src/worktree/worktree-cleanup.ts",
          "packages/coding-agent/test/worktree-manager.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "git worktree list"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "git clean -fd"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "worktree_quarantined",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.C",
      "title": "Integration branch and merge queue",
      "dependencies": [
        "6.A",
        "6.B"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/coding-agent/src/integration/integration-branch.ts",
        "packages/coding-agent/src/core/plan-state.ts",
        "packages/coding-agent/test/integration-queue.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Successful workspace enters integration queue",
        "Queue merges one workspace at a time into integration branch",
        "Failed validation blocks merge",
        "Integration validation runs after merge",
        "Merge result is recorded in archive/state",
        "git push is never run"
      ],
      "targetCommand": "npm run typecheck && npm test -- integration-queue",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/coding-agent/src/integration/integration-branch.ts",
          "packages/coding-agent/src/core/plan-state.ts",
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
          "git status"
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
          "integration_queue_enqueued",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.D",
      "title": "Merge conflict detection and handoff",
      "dependencies": [
        "6.C"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/integration/merge-conflict-handoff.ts",
        "packages/coding-agent/src/integration/integration-queue.ts",
        "packages/web-ui/dashboard/src/components/MergeConflictPanel.tsx",
        "packages/coding-agent/test/merge-conflict-handoff.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Merge conflict does not silently fail or mark complete",
        "Conflict artifact is written",
        "Dashboard shows conflict status and files",
        "Integration queue stops safely on conflict",
        "Manual resolution and resume path is documented/tested"
      ],
      "targetCommand": "npm run typecheck && npm run build && npm test -- merge-conflict-handoff",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/integration/merge-conflict-handoff.ts",
          "packages/coding-agent/src/integration/integration-queue.ts",
          "packages/web-ui/dashboard/src/components/MergeConflictPanel.tsx",
          "packages/coding-agent/test/merge-conflict-handoff.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build",
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
          "merge_conflict_detected",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.E",
      "title": "Dynamic parallel scheduler",
      "dependencies": [
        "6.C"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/scheduler/dynamic-scheduler.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/core/scheduler-diagnostics.ts",
        "packages/coding-agent/test/dynamic-scheduler.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Scheduler fills capacity with ready-safe workspaces",
        "Scheduler can use higher concurrency in worktree mode",
        "Scheduler reduces concurrency when validation lock/resource pressure is high",
        "Scheduler explains skipped/selected decisions",
        "Same-file conflicts are not run unsafely"
      ],
      "targetCommand": "npm run typecheck && npm test -- dynamic-scheduler",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/scheduler/dynamic-scheduler.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/scheduler-diagnostics.ts",
          "packages/coding-agent/test/dynamic-scheduler.test.ts"
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
          "scheduler_tick",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.F",
      "title": "Safe 6+ worker mode",
      "dependencies": [
        "6.A",
        "6.C"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/scheduler/scale-mode-policy.ts",
        "packages/coding-agent/src/doctor/scale-readiness-doctor.ts",
        "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx",
        "packages/coding-agent/test/scale-mode-policy.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "6 workers cannot be enabled without worktree isolation",
        "6 workers cannot be enabled without integration queue",
        "6 workers cannot be enabled without global validation lock",
        "Doctor reports readiness for scale mode",
        "Dashboard shows current scale mode and prerequisite status",
        "Stable default remains 3 workers"
      ],
      "targetCommand": "npm run typecheck && npm run build && npm test -- scale-mode-policy",
      "roleBudget": "reviewer",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/scheduler/scale-mode-policy.ts",
          "packages/coding-agent/src/doctor/scale-readiness-doctor.ts",
          "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx",
          "packages/coding-agent/test/scale-mode-policy.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build",
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
          "scale_mode_checked",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.G",
      "title": "Test impact analysis v1",
      "dependencies": [
        "6.I"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/validation/test-impact-analyzer.ts",
        "packages/coding-agent/src/validation/validation-planner.ts",
        "packages/coding-agent/test/test-impact-analyzer.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Analyzer maps dashboard component changes to dashboard tests/build",
        "Analyzer maps coding-agent core changes to coding-agent tests/typecheck",
        "Low confidence uses broader validation",
        "Test impact result is logged and visible",
        "Tests cover common repo areas"
      ],
      "targetCommand": "npm run typecheck && npm test -- test-impact-analyzer",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/validation/test-impact-analyzer.ts",
          "packages/coding-agent/src/validation/validation-planner.ts",
          "packages/coding-agent/test/test-impact-analyzer.test.ts"
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
          "test_impact_analyzed",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.H",
      "title": "Failure classifier and retry routing",
      "dependencies": [
        "6.G"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/failure/failure-classifier.ts",
        "packages/coding-agent/src/failure/retry-router.ts",
        "packages/coding-agent/test/failure-classifier.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Failures are classified into known categories",
        "Retry strategy changes based on failure category",
        "Merge conflicts do not retry as ordinary coding failures",
        "Failure classification is visible in dashboard/logs",
        "Tests cover major failure categories"
      ],
      "targetCommand": "npm run typecheck && npm test -- failure-classifier",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/failure/failure-classifier.ts",
          "packages/coding-agent/src/failure/retry-router.ts",
          "packages/coding-agent/test/failure-classifier.test.ts"
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
          "failure_classified",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.I",
      "title": "Repo symbol / ownership graph v1",
      "dependencies": [],
      "allowedFiles": [
        "packages/coding-agent/src/repo-graph/repo-symbol-graph.ts",
        "packages/coding-agent/src/repo-graph/repo-graph-builder.ts",
        "packages/coding-agent/test/repo-symbol-graph.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Graph maps files to related tests where conventions exist",
        "Graph helps detect likely cross-workspace conflicts",
        "Graph is used by scheduler/test impact/retrieval",
        "Graph ignores forbidden files",
        "Tests cover import/test association behavior"
      ],
      "targetCommand": "npm run typecheck && npm test -- repo-symbol-graph",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/repo-graph/repo-symbol-graph.ts",
          "packages/coding-agent/src/repo-graph/repo-graph-builder.ts",
          "packages/coding-agent/test/repo-symbol-graph.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
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
          "repo_graph_built",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "6.J",
      "title": "Dashboard scale controls and integration visibility",
      "dependencies": [
        "6.A",
        "6.B",
        "6.C"
      ],
      "allowedFiles": [
        "packages/web-server/src/scale-routes.ts",
        "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
        "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
        "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx",
        "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
        "packages/web-server/test/scale-routes.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "User can see each workspace worktree status",
        "User can see integration queue status",
        "User can see merge conflicts and handoff details",
        "User can see why 6-worker mode is enabled/blocked",
        "Worktree cleanup is scoped and safe",
        "Dashboard remains responsive"
      ],
      "targetCommand": "npm run typecheck && npm run build && npm test -- scale-routes",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/scale-routes.ts",
          "packages/web-ui/dashboard/src/components/WorktreeStatusPanel.tsx",
          "packages/web-ui/dashboard/src/components/IntegrationQueuePanel.tsx",
          "packages/web-ui/dashboard/src/components/ScaleModeSettings.tsx",
          "packages/web-ui/dashboard/src/hooks/useScaleStatus.ts",
          "packages/web-server/test/scale-routes.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build",
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
      "id": "6.K",
      "title": "Large-project dogfood and stability report",
      "dependencies": [
        "6.A",
        "6.B",
        "6.C",
        "6.D",
        "6.E",
        "6.F",
        "6.G",
        "6.H",
        "6.I",
        "6.J"
      ],
      "allowedFiles": [
        "packages/coding-agent/test/p6-large-project-dogfood.test.ts",
        "docs/pi/stability/p6-large-project-scale-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Dogfood report exists",
        "Worktree isolation is proven",
        "Integration queue is proven",
        "Failed worktree discard/quarantine is proven",
        "Experimental 6-worker mode is validated or blocked with clear reason",
        "No git push occurs"
      ],
      "targetCommand": "npm run typecheck && npm test -- p6-large-project-dogfood",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p6-large-project-dogfood.test.ts",
          "docs/pi/stability/p6-large-project-scale-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "git status"
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
  "contractVersion": "2.1.0",
  "phase": "P6",
  "title": "Large Project Scale & Reliability",
  "primaryGoal": "Make Pi reliable and fast on large projects by isolating workspaces in git worktrees, merging through an integration queue, enabling safe higher parallelism, adding test impact analysis, and classifying failures for smarter retries.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "notInScope": [
    "Agent-agnostic runtime split",
    "Public platformization",
    "Remote cloud runners",
    "Remote skill registry",
    "Production git push automation",
    "Enterprise approval engine v2",
    "Hosted multi-user permissions"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "git_push",
    "worktree_path_escape",
    "raw_destructive_cleanup",
    "integration_merge_without_validation",
    "integration_validation_failure",
    "merge_conflict_without_handoff",
    "unsafe_scale_mode",
    "queue_next_plan_while_integration_dirty"
  ],
  "completionGate": "P6 is complete when workspaces execute in isolated git worktrees, successful diffs merge through an integration queue, conflicts produce handoff artifacts, dynamic scheduling enables safe higher parallelism, 6-worker mode is gated by readiness checks, test impact analysis reduces validation cost, failure classification improves retries, and dogfood proves large-project reliability without git push or unsafe cleanup.",
  "nextPhase": "P7"
}
```


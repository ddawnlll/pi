# P37 — Patch Transaction Runtime Prototype

**Contract Version:** `4.0.0`  
**Template Version:** `4.0.0`  
**Phase:** `P37`  
**Title:** `Patch Transaction Runtime Prototype`  
**Status:** `Planned`  
**Last Updated:** `2026-05-30`  
**Execution Class:** `implementation`  
**Selected Scale Mode:** `stable_3`  
**Requested Max Workers:** `3`  
**Expected DAG Effective Parallelism:** `3`  
**Expected Safe Effective Parallelism:** `2-3`  
**Target Promotion Mode:** `stable_6`  
**Target Runtime Being Built:** `patch_transaction stable_6 candidate`  
**Worktree Isolation For This Run:** `Disabled`  
**Integration Queue For This Run:** `Disabled`  
**PostgreSQL Runtime State:** `Required`  
**JSON Runtime Fallback:** `Forbidden`  
**Autonomous Execution Allowed:** `true only after stable_3 admission passes`  
**Agent Repo Mutation Allowed:** `true after admission`  

> **Important compatibility note:** This plan is intentionally written against the currently runnable **v4.0.0** template, not v4.1.0.  
> The goal of this plan is to implement the runtime prototype needed for the future v4.1 patch transaction execution mode.  
> The plan itself must execute under the existing `stable_3` path.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

P37 implements the first real runtime prototype of the patch transaction executor. The runtime used to execute this plan is still the existing `stable_3` executor; P37 builds the future `stable_6` patch transaction path behind feature flags.

```text
P37 is executed by stable_3.
P37 builds stable_6 patch_transaction.
P37 must not self-host on the runtime it is creating.
```

The system being built is:

```text
6 codegen workers produce PatchArtifacts
        ↓
1 PatchCoordinator applies patches
        ↓
WriteSetGuard + FileHashGuard + ForbiddenPathGuard
        ↓
git apply --check
        ↓
apply patch
        ↓
targeted validation
        ↓
accept / reject / rollback / handoff
```

## 1. Header

| Field | Value |
|---|---|
| Phase | `P37` |
| Title | `Patch Transaction Runtime Prototype` |
| Status | `Planned` |
| Last updated | `2026-05-30` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Execution runtime mutation model` |
| Product-code changes | `Allowed` |
| Execution class | `implementation` |
| Execution automation | `enabled after stable_3 admission` |
| Selected repair mode | `stable_3` |
| Target promotion mode | `stable_6` |
| Autonomous execution allowed | `true after admission` |
| Agent repo mutation allowed | `true after admission` |
| Promotion gate status | `pending` |
| Selected scale mode | `stable_3` |
| Requested max workers | `3` |
| Expected DAG effective parallelism | `3` |
| Expected safe effective parallelism | `2-3` |
| Worktree isolation | `Disabled for this run` |
| Integration queue | `Disabled for this run` |
| Runtime being built | `patch_transaction stable_6 candidate` |
| Patch apply lanes being built | `1` |
| PatchCoordinator being built | `Yes` |
| Done when | `Patch transaction runtime prototype is implemented, dogfooded on the real repo, and reports prove no direct worker mutation, no dirty repo leak, no stuck patch lifecycle state, and correct rollback/handoff behavior.` |

## 2. Purpose

P37 removes the next major blocker to stable parallel execution by implementing a feature-flagged patch transaction runtime prototype. The old high-parallelism path relied on git worktree isolation and integration queue semantics. This plan does not delete that path, but it introduces a safer path where parallelism happens during code generation while repository mutation is controlled by a single PatchCoordinator.

The plan is deliberately executed with `stable_3`. It must not rely on the patch transaction executor it is building. At the end of P37, patch transaction may be recommended for stable_6 dogfood/stress, but P37 itself must not claim production stable_6 readiness unless the required dogfood metrics pass.

## 3. What Carried Over — Must Stay Stable

- Existing stable_3 execution path must continue to work.
- Existing worktree code must not be deleted.
- Existing direct/shared working tree behavior must not be broken.
- PostgreSQL remains authoritative runtime state.
- JSON runtime fallback remains forbidden as production truth.
- Existing ExecutionKernel doctrine remains valid.
- New PatchCoordinator repository mutation authority must not create dual execution-state authority.
- `git push`, watch-mode validation, and raw destructive cleanup remain forbidden.
- Patch transaction remains feature-flagged and disabled by default.

## 4. Background / What Was Wrong

The worktree-based path gives strong theoretical isolation but carries heavy operational complexity: worktree creation, lease acquisition, heartbeat, cleanup, stale lease recovery, git ref locks, integration queue serialization, dirty integration state, and merge handoff. This reduces practical parallelism and makes failures difficult to debug.

The patch transaction model aims to preserve parallel code generation while simplifying mutation authority:

```text
Workers are patch producers.
PatchCoordinator is the only repository writer.
Every patch apply is checked, rollbackable, validation-gated, and terminal.
```

## 5. Current Failure State / Known Blockers

| Component | Current State | P37 Goal |
|---|---|---|
| MutationBackend abstraction | missing / not explicit | Add direct/worktree/patch_transaction seam |
| PatchArtifact schema | lab-only | Add real runtime schema |
| PatchArtifactStore | lab-only | Add scoped artifact persistence |
| PatchCoordinator | lab-only | Add real guarded coordinator |
| Worker direct mutation guard | missing for patch mode | Enforce no direct main repo writes |
| Temp overlay / diff path | missing | Add patch workspace and diff generator |
| Patch lifecycle events | missing | Add typed lifecycle events/deadlines |
| Scheduler patch mode | missing | Add 6 codegen slot profile + 1 apply lane |
| Patch readiness doctor | missing | Add gated readiness checks |
| Real repo dogfood | not run | Add runtime gauntlet reports |

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Patch transaction corrupts working tree | Medium | Critical | PatchCoordinator only writer, clean apply check, rollback, dirty checks |
| Worker still mutates repo directly | Medium | Critical | Tool-layer guard, overlay, before/after snapshots, hard stop |
| Validation fails after apply | High | High | Rollback on validation failure |
| Rollback fails | Medium | Critical | Capture snapshot/reverse patch; fallback checkout touched files |
| Scheduler admits unsafe concurrency | Medium | High | P37 runs stable_3; patch tx dogfood is feature-flagged |
| Patch apply lane accidentally becomes 2 | Low | High | Hard stop `patch_apply_lane_count_gt_1` |
| Worktree fallback breaks | Low | High | Do not delete worktree code; compile/smoke test legacy path |
| Postgres event shape incomplete | Medium | Medium | Filesystem artifacts allowed as evidence; no JSON runtime truth |

## 7. Workstreams


## P37.00 — Preflight & Runtime Inventory

**Area:** `diagnostics`  
**Batch:** `B0`  
**Queue Priority:** `critical`  
**Depends on:** `none`  
**Workspace Role:** `diagnostic`  
**Risk Level:** `medium`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Create a concrete inventory of the current runtime code paths before introducing the patch transaction backend.

### Requirements

- Locate current executor entrypoints and runtime mutation call sites.
- Identify scheduler admission, validation runner, state store, and worktree-specific assumptions.
- Generate a preflight report under reports/patch-transaction-runtime/p37-preflight/.
- Do not change runtime behavior in this workspace.

### Known Write Scope

```text
reports/patch-transaction-runtime/p37-preflight/**
scripts/diagnose-patch-transaction-readiness.ts
```

### Acceptance Criteria

- Runtime inventory report exists.
- Executor entrypoints, mutation tools, scheduler admission path, validation path, and worktree preservation list are documented.
- No runtime behavior change is introduced.

### Targeted Validation

```bash
npm run typecheck -- --noEmit
```


## P37.01 — MutationBackend Seam & Isolation Mode Plumbing

**Area:** `core/execution`  
**Batch:** `B1`  
**Queue Priority:** `critical`  
**Depends on:** `P37.00`  
**Workspace Role:** `implementation`  
**Risk Level:** `high`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Add the minimal execution boundary needed to support direct, worktree, and patch_transaction mutation strategies without physically splitting the package.

### Requirements

- Add IsolationMode: direct, worktree, patch_transaction.
- Add MutationBackend interface and backend selector.
- Add env parsing for PI_EXECUTION_ISOLATION_MODE, PI_PATCH_TRANSACTION_ENABLED, and PI_WORKTREE_LEGACY_ENABLED.
- Patch transaction must be scaffolded but not default.
- Existing stable_3 behavior remains default.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/mutation-backend.ts
packages/coding-agent/src/core/execution/isolation-mode.ts
packages/coding-agent/src/core/execution/mutation-backend-selector.ts
packages/coding-agent/src/core/execution/patch/patch-transaction-backend.ts
packages/coding-agent/src/core/execution/index.ts
packages/coding-agent/test/execution/mutation-backend.test.ts
```

### Acceptance Criteria

- Backend selection tests pass.
- Patch transaction selection requires explicit enable flag.
- Worktree legacy selection remains available.
- Default stable_3 behavior is preserved.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/mutation-backend.test.ts
npm run typecheck -- --noEmit
```


## P37.02 — Real PatchArtifact Schema & PatchArtifactStore

**Area:** `core/execution/patch`  
**Batch:** `B1`  
**Queue Priority:** `critical`  
**Depends on:** `P37.00`  
**Workspace Role:** `implementation`  
**Risk Level:** `medium`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Create the real runtime PatchArtifact contract and artifact store.

### Requirements

- PatchArtifact includes patchId, planExecId, workspaceId, attemptId, baseSha, readSet, writeSet, fileHashes, diff, createdFiles, deletedFiles, renamedFiles, validationPlan, riskLevel, createdAt, metadata.
- Store artifacts under .pi/patches/{planExecId}/{workspaceId}/.
- Persist JSON metadata and diff separately.
- Reject malformed artifacts.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-artifact.ts
packages/coding-agent/src/core/execution/patch/patch-artifact-store.ts
packages/coding-agent/src/core/execution/patch/patch-status.ts
packages/coding-agent/src/core/execution/patch/patch-validation-plan.ts
packages/coding-agent/src/core/execution/patch/index.ts
packages/coding-agent/test/execution/patch-artifact.test.ts
packages/coding-agent/test/execution/patch-artifact-store.test.ts
```

### Acceptance Criteria

- Patch without baseSha, writeSet, or diff/file operations is invalid.
- Store writes and reads artifact without data loss.
- Artifact paths are scoped to .pi/patches/.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-artifact.test.ts
npm run test -w packages/coding-agent -- test/execution/patch-artifact-store.test.ts
npm run typecheck -- --noEmit
```


## P37.03 — PatchCoordinator, Guards, and Rollback Core

**Area:** `core/execution/patch`  
**Batch:** `B2`  
**Queue Priority:** `critical`  
**Depends on:** `P37.01, P37.02`  
**Workspace Role:** `implementation`  
**Risk Level:** `critical`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Implement the real single-writer PatchCoordinator pipeline.

### Requirements

- Pipeline: ForbiddenPathGuard -> WriteSetGuard -> FileHashGuard -> git apply --check -> apply -> targeted validation -> accept/reject/rollback/handoff.
- Keep patchApplyLanes = 1.
- Preserve coordinator journal.
- No failed path may leave dirty repo state.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-coordinator.ts
packages/coding-agent/src/core/execution/patch/patch-apply-queue.ts
packages/coding-agent/src/core/execution/patch/write-set-guard.ts
packages/coding-agent/src/core/execution/patch/file-hash-guard.ts
packages/coding-agent/src/core/execution/patch/forbidden-path-guard.ts
packages/coding-agent/src/core/execution/patch/rollback-manager.ts
packages/coding-agent/src/core/execution/patch/patch-coordinator-journal.ts
packages/coding-agent/test/execution/patch-coordinator.test.ts
packages/coding-agent/test/execution/patch-guards.test.ts
packages/coding-agent/test/execution/rollback-manager.test.ts
```

### Acceptance Criteria

- WriteSet violation, forbidden path, stale hash, and apply failure are handled safely.
- Validation failure triggers rollback.
- Dirty repo leak after failed patch is zero in tests.
- Only PatchCoordinator applies patches.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-coordinator.test.ts
npm run typecheck -- --noEmit
```


## P37.04 — Worker Temp Overlay, Diff Generation, and Direct Mutation Guard

**Area:** `core/tools`  
**Batch:** `B2`  
**Queue Priority:** `critical`  
**Depends on:** `P37.01, P37.02`  
**Workspace Role:** `implementation`  
**Risk Level:** `critical`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Ensure workers do not directly mutate the main repository in patch_transaction mode.

### Requirements

- Use temp root .pi/patch-workspaces/{planExecId}/{workspaceId}/.
- In patch mode, write/edit tools route to overlay.
- Generate diff from overlay output.
- Detect direct main repo mutation and hard-stop.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-workspace.ts
packages/coding-agent/src/core/execution/patch/diff-generator.ts
packages/coding-agent/src/core/execution/patch/direct-mutation-detector.ts
packages/coding-agent/src/core/tools/file-write-policy.ts
packages/coding-agent/test/execution/patch-workspace.test.ts
packages/coding-agent/test/execution/direct-mutation-detector.test.ts
packages/coding-agent/test/execution/diff-generator.test.ts
```

### Acceptance Criteria

- Main repo unchanged after worker codegen before coordinator apply.
- Diff generation handles created and deleted files.
- Direct main repo mutation is detected and hard-stopped.
- Non-patch modes preserve existing behavior.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-workspace.test.ts
npm run test -w packages/coding-agent -- test/execution/direct-mutation-detector.test.ts
npm run test -w packages/coding-agent -- test/execution/diff-generator.test.ts
npm run typecheck -- --noEmit
```


## P37.05 — Patch Transaction Lifecycle Events and State Persistence

**Area:** `core/state`  
**Batch:** `B2`  
**Queue Priority:** `high`  
**Depends on:** `P37.01, P37.02`  
**Workspace Role:** `implementation`  
**Risk Level:** `high`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Add patch transaction lifecycle events and persistence without creating dual runtime authority.

### Requirements

- Add typed patch events from artifact creation through acceptance/rollback/handoff.
- Add deadline fields for patch checking, applying, and validating.
- Actors emit events; controller/state authority remains source of truth.
- Do not use JSON fallback as production truth.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-events.ts
packages/coding-agent/src/core/execution/patch/patch-state.ts
packages/coding-agent/src/core/execution/patch/patch-persistence.ts
packages/coding-agent/src/core/execution/patch/patch-deadlines.ts
packages/coding-agent/test/execution/patch-events.test.ts
packages/coding-agent/test/execution/patch-state.test.ts
```

### Acceptance Criteria

- Patch lifecycle events are typed.
- Non-terminal patch states have deadlines.
- Patch states cannot remain non-terminal indefinitely in tests.
- No JSON fallback becomes runtime truth.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-events.test.ts
npm run test -w packages/coding-agent -- test/execution/patch-state.test.ts
npm run typecheck -- --noEmit
```


## P37.06 — Scheduler Integration: Codegen Slots and Patch Apply Lane

**Area:** `core/scheduler`  
**Batch:** `B3`  
**Queue Priority:** `critical`  
**Depends on:** `P37.01, P37.03, P37.04, P37.05`  
**Workspace Role:** `implementation`  
**Risk Level:** `critical`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Wire patch_transaction scheduling without requiring WorktreePool leases.

### Requirements

- Patch scheduling profile: maxCodegenWorkers=6, patchApplyLanes=1, final validation serial.
- Patch mode codegen does not require worktree lease.
- Scheduler respects hardDeps and conflict metadata.
- Diagnostics expose active codegen count, apply queue depth, validation lane usage, and blocked reasons.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-scheduling-profile.ts
packages/coding-agent/src/core/workspace-scheduler.ts
packages/coding-agent/src/core/scheduler.ts
packages/coding-agent/src/core/dynamic-parallel-scheduler.ts
packages/coding-agent/test/execution/patch-scheduler.test.ts
```

### Acceptance Criteria

- Patch mode admits codegen without worktree lease.
- Six codegen slots can be simulated in tests.
- Patch apply queue remains single lane.
- Existing stable_3 scheduler behavior does not regress.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-scheduler.test.ts
npm run typecheck -- --noEmit
```


## P37.07 — Feature Flags, AdmissionGate, Doctor, and Compatibility

**Area:** `admission`  
**Batch:** `B3`  
**Queue Priority:** `critical`  
**Depends on:** `P37.01, P37.02, P37.03, P37.06`  
**Workspace Role:** `implementation`  
**Risk Level:** `high`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Add safe runtime gating so patch transaction cannot be accidentally enabled without all required components.

### Requirements

- Readiness checks for backend, coordinator, store, guards, rollback, direct mutation guard, apply lane count, Postgres, JSON fallback disabled.
- Doctor output for patch readiness.
- Admission hard stops for missing requirements.
- Preserve v4.0 parser compatibility.

### Known Write Scope

```text
packages/coding-agent/src/core/execution/patch/patch-readiness.ts
packages/coding-agent/src/core/admission-gate.ts
packages/coding-agent/src/core/production-readiness-doctor.ts
packages/coding-agent/test/execution/patch-readiness.test.ts
packages/coding-agent/test/execution/patch-admission.test.ts
```

### Acceptance Criteria

- Patch transaction cannot start unless components are present.
- patchApplyLanes > 1 is rejected.
- Doctor shows readiness status and blocked reasons.
- Existing non-patch modes remain healthy.

### Targeted Validation

```bash
npm run test -w packages/coding-agent -- test/execution/patch-readiness.test.ts
npm run test -w packages/coding-agent -- test/execution/patch-admission.test.ts
npm run typecheck -- --noEmit
```


## P37.08 — Real Repo Patch Transaction Dogfood Gauntlet

**Area:** `scripts/reports`  
**Batch:** `B4`  
**Queue Priority:** `critical`  
**Depends on:** `P37.03, P37.04, P37.06, P37.07`  
**Workspace Role:** `dogfood`  
**Risk Level:** `critical`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Prove patch transaction runtime behavior against a real repo temp copy and controlled project path if safe.

### Requirements

- Create runtime gauntlet script.
- Cover deterministic non-conflicting patches, same-file conflict, writeSet violation, forbidden path, stale hash, validation rollback, worker crash, coordinator crash, six-worker saturation.
- Generate results.json, summary.md, patch artifacts, event log, and dirty checks.

### Known Write Scope

```text
scripts/run-patch-transaction-runtime-gauntlet.ts
reports/patch-transaction-runtime/**
packages/coding-agent/test/execution/patch-runtime-gauntlet.test.ts
```

### Acceptance Criteria

- 3-worker dogfood passes.
- 6-codegen-worker dogfood passes.
- Peak codegen workers is 6.
- Dirty repo leak, stuck state, and direct worker mutation counts are zero.
- Rollback success and writeSet detection are 100%.

### Targeted Validation

```bash
PI_EXECUTION_ISOLATION_MODE=patch_transaction PI_PATCH_TRANSACTION_ENABLED=1 npx tsx scripts/run-patch-transaction-runtime-gauntlet.ts
npm run typecheck -- --noEmit
npm run test -w packages/coding-agent -- test/execution
```


## P37.09 — Final Validation, Documentation, and Promotion Recommendation

**Area:** `docs/reports`  
**Batch:** `B5`  
**Queue Priority:** `critical`  
**Depends on:** `P37.08`  
**Workspace Role:** `finalization`  
**Risk Level:** `medium`  
**Worktree Required:** `false`  
**Integration Queue Required:** `false`  

### Goal

Finalize P37 with documentation, known limitations, rollback instructions, and promotion recommendation.

### Requirements

- Document feature flags, artifacts, coordinator behavior, rollback, known limitations, and dogfood paths.
- Write recommendation: A continue to stable_6 dogfood/stress, B continue hardening, or C reject patch runtime path.
- Do not claim production stable_6 unless dogfood/stress gates pass.

### Known Write Scope

```text
docs/pi/p37-patch-transaction-runtime.md
reports/patch-transaction-runtime/final-summary.md
reports/patch-transaction-runtime/promotion-recommendation.md
```

### Acceptance Criteria

- Operator and developer docs exist.
- Final summary and promotion recommendation exist.
- Known limitations and rollback instructions are documented.
- P37 remains honest about production readiness.

### Targeted Validation

```bash
npm run typecheck -- --noEmit
```


## 8. Combined Implementation Order

```text
B0:
  P37.00

B1:
  P37.01 + P37.02

B2:
  P37.03 + P37.04 + P37.05

B3:
  P37.06 + P37.07

B4:
  P37.08

B5:
  P37.09
```

Critical path:

```text
P37.00 -> P37.01 -> P37.03 -> P37.06 -> P37.08 -> P37.09
```

P37 uses stable_3 because it modifies the execution runtime. It must not execute on the runtime it is creating.

## 9. Definition of Done

- [ ] Preflight report exists.
- [ ] MutationBackend seam exists.
- [ ] Patch transaction backend can be selected by feature flag but is not default.
- [ ] PatchArtifact schema and store exist.
- [ ] PatchCoordinator exists and is the only patch applier.
- [ ] WriteSetGuard, FileHashGuard, ForbiddenPathGuard, and RollbackManager exist.
- [ ] Worker writes route to temp overlay in patch_transaction mode.
- [ ] Direct main repo mutation by patch worker is detected and hard-stopped.
- [ ] Scheduler can admit patch transaction codegen without worktree lease.
- [ ] Patch apply lane remains single-lane.
- [ ] AdmissionGate blocks unsafe patch transaction activation.
- [ ] Doctor reports patch transaction readiness.
- [ ] Real repo gauntlet produces report.
- [ ] 3-worker dogfood passes.
- [ ] 6-codegen-worker dogfood passes.
- [ ] Dirty repo leak count is 0.
- [ ] Stuck non-terminal state count is 0.
- [ ] Direct worker mutation count is 0.
- [ ] Rollback success rate is 100%.
- [ ] WriteSet violation detection rate is 100%.
- [ ] Existing stable_3 path still works.
- [ ] Worktree legacy path still compiles or failure is documented as pre-existing.
- [ ] Final recommendation is written.

## 10. Rollback Playbook

Rollback or disable patch transaction if any of these occur:

- Dirty repo leak after failed patch.
- Direct worker mutation detected.
- Rollback fails.
- Patch applies without clean check.
- WriteSetGuard misses violation.
- Patch apply lane becomes >1.
- Patch transaction affects stable_3 default behavior.
- Worktree fallback breaks.
- Scheduler enters no-progress state.
- Dogfood shows stuck non-terminal patch state.

Procedure:

1. Set `PI_PATCH_TRANSACTION_ENABLED=0`.
2. Unset `PI_EXECUTION_ISOLATION_MODE` or set it to `direct`.
3. Keep selected scale mode at `stable_3`.
4. Stop patch transaction dogfood runs.
5. Pause patch apply queue.
6. Preserve `.pi/patches/**`.
7. Preserve `.pi/patch-workspaces/**` if safe.
8. Preserve coordinator journals and reports.
9. Revert P37 commits if stable_3 regresses.
10. Run stable_3 smoke test and final validation.
11. Write handoff report with failed invariant.

## 11. What Next Phase Inherits

The next phase inherits:

- MutationBackend abstraction.
- PatchArtifact schema and store.
- PatchCoordinator.
- WriteSetGuard, FileHashGuard, ForbiddenPathGuard, RollbackManager.
- Patch transaction lifecycle events and readiness checks.
- Real repo dogfood reports.
- Feature flags and rollback procedure.

The next phase may add:

- Full v4.1 template/runtime integration.
- First-class Postgres patch artifact tables.
- Dashboard patch transaction UI.
- stable_6 patch transaction stress suite.
- Optional second patch apply lane after evidence gate.
- Aggregator workspace automation.

---

# Part 2 — Agent Brief

## Mission

Implement the P37 patch transaction runtime prototype under the existing v4.0 stable_3 execution contract.

You are not implementing product features. You are implementing a safer execution runtime mutation path.

```text
In patch_transaction mode:
  workers do not directly mutate the main repository;
  workers produce PatchArtifacts;
  PatchCoordinator is the only repository writer;
  every patch is checked, applied, validated, accepted/rejected/rolled back/handoffed;
  no failed path leaves the repo dirty or the workspace stuck.
```

## Operating Mode

This plan must execute under stable_3. Do not execute P37 with patch_transaction mode. P37 creates that mode.

## Hard Requirements

1. Preserve current stable_3 behavior.
2. Do not delete worktree code.
3. Do not switch default execution mode to patch transaction.
4. Do not enable more than one patch apply lane.
5. Do not allow workers to mutate the main repository in patch transaction mode.
6. Do not apply any patch without clean-apply validation.
7. Do not apply any patch without a rollback plan.
8. Do not accept a patch outside declared writeSet.
9. Do not blind-overwrite stale file hashes.
10. Do not let patch states remain non-terminal indefinitely.
11. Do not use JSON runtime fallback as production truth.
12. Do not run watch-mode validation.
13. Do not run `git push`.
14. Do not run raw destructive cleanup.
15. Do not claim production stable_6 readiness from P37 alone.
16. Do not physically extract execution into a separate package.
17. Do not implement Brain V5 features.
18. Do not change the master template as part of P37 except documentation references if necessary.

## Execution Policies

```yaml
execution_runtime:
  execution_class: implementation
  selected_scale_mode: stable_3
  max_parallel_workspaces: 3
  worktree_required_for_this_run: false
  integration_queue_required_for_this_run: false
  target_runtime_being_built: patch_transaction_stable_6_candidate

feature_flags:
  PI_EXECUTION_ISOLATION_MODE:
    default: unset
    allowed_values: [direct, worktree, patch_transaction]
  PI_PATCH_TRANSACTION_ENABLED:
    default: "0"
    required_for_patch_transaction: "1"
  PI_WORKTREE_LEGACY_ENABLED:
    default: "1"

patch_transaction_target:
  enabled_by_default: false
  max_codegen_workers: 6
  patch_apply_lanes: 1
  single_repository_writer: patch_coordinator
  workers_may_mutate_main_repo: false
  patch_artifacts_required: true
  write_set_guard_required: true
  file_hash_guard_required: true
  forbidden_path_guard_required: true
  rollback_required: true
  validation_after_apply_required: true
  final_integration_validation_required: true

validation:
  targeted_validation_enabled: true
  final_validation_required: true
  watch_mode_forbidden: true
  kill_tree_on_timeout: true
  output_cap_required: true

persistence:
  authoritative_runtime_state: postgres
  json_runtime_fallback_allowed: false
  patch_artifacts_filesystem_allowed_as_evidence: true
  patch_artifact_index_backend: postgres_or_adapter
```

## Safety Stops

- `patch_transaction_enabled_without_feature_flag`
- `patch_transaction_backend_selected_without_patch_coordinator`
- `patch_transaction_backend_selected_without_artifact_store`
- `patch_transaction_backend_selected_without_rollback_manager`
- `patch_transaction_backend_selected_without_direct_mutation_guard`
- `worker_direct_repo_mutation_detected`
- `patch_without_base_sha`
- `patch_without_write_set`
- `patch_write_set_violation`
- `patch_forbidden_path_detected`
- `patch_stale_hash_blind_overwrite_attempt`
- `patch_apply_without_clean_check`
- `patch_apply_without_rollback_plan`
- `patch_validation_failure_without_rollback`
- `patch_apply_lane_count_gt_1`
- `dirty_repo_leak_after_failed_patch`
- `patch_state_stuck_non_terminal`
- `stable_3_default_behavior_changed`
- `worktree_legacy_code_deleted`
- `json_runtime_fallback_used_as_truth`
- `git_push_attempted`
- `watch_mode_validation_command`
- `raw_destructive_cleanup_command`

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "4.0.0",
  "templateVersion": "4.0.0",
  "legacyCompatibility": {
    "v3EnvelopePreserved": true,
    "legacyValidatorMode": "v3_compatible_extensions",
    "fallbackContractVersionForLegacyParser": "3.0.0",
    "legacyMechanismFieldsAreHints": true,
    "unknownV4FieldsPolicy": "ignore_for_read_only_legacy_consumers_reject_for_execution_without_v4_validator"
  },
  "executionClass": "implementation",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "execution",
      "patch-transaction",
      "runtime",
      "stable_3"
    ]
  },
  "intent": {
    "parallelism": 3,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": {
      "mode": "trusted_local",
      "untrustedCodeAllowed": false,
      "networkPolicy": "host_default",
      "secretsPolicy": "forbidden_files_and_env_allowlist"
    },
    "deadlines": {
      "llmRequestMs": 120000,
      "llmStreamIdleMs": 300000,
      "workspaceOverallMs": 1800000,
      "validationDefaultMs": 600000,
      "validationHeavyMs": 1200000,
      "schedulerNoProgressMs": 300000
    }
  },
  "derivedExecutionProfile": {
    "generatedBy": "ExecutionProfileDeriver",
    "deriverVersion": "4.0.0",
    "readOnly": false,
    "worktreeRequired": false,
    "integrationQueueRequired": false,
    "gitRunnerQueueRequired": true,
    "validationLanesRequired": true,
    "attemptScopedArtifactsRequired": true,
    "deadlineWatchdogRequired": true,
    "admissionGateMode": "strict",
    "writeSetDriftPolicy": "warn_and_flag_integration",
    "explain": [
      "P37 itself executes under stable_3 and must not require worktree isolation.",
      "The target runtime being built is patch_transaction stable_6, but it remains feature-flagged and disabled by default.",
      "PostgreSQL remains the authoritative runtime state backend."
    ]
  },
  "persistence": {
    "authoritativeBackend": "postgres",
    "jsonRuntimeFallbackAllowed": false,
    "eventJournalBackend": "postgres",
    "transitionBackend": "postgres",
    "controllerInboxBackend": "postgres",
    "handoffQueueBackend": "postgres",
    "rawLogsBackend": "filesystem",
    "artifactIndexBackend": "postgres",
    "debugExportAllowed": true
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": true,
    "agentMayMutateRepo": true,
    "agentMayRunCommands": true,
    "manualPatchApplicationRequired": false,
    "humanApprovalRequiredForEveryPatch": false
  },
  "executionKernel": {
    "enabled": true,
    "stateAuthority": "workspace_attempt_controller",
    "planAuthority": "plan_supervisor",
    "stateAuthorityTokenRequired": true,
    "admissionGateRequired": true,
    "eventSourcedAttempts": true,
    "attemptEventJournalRequired": true,
    "directStateMutationForbidden": true,
    "actorsEmitEventsOnly": true,
    "policiesSuggestOnly": true,
    "brainWorkersReadOnly": true,
    "retryRequiresTerminalAttempt": true,
    "everyNonTerminalStateHasDeadline": true,
    "controllerSerializesDecisionsNotWork": true,
    "controllerLeadership": {
      "required": true,
      "mode": "postgres_advisory_lock_plus_expected_version",
      "transitionRequiresExpectedVersion": true,
      "onVersionConflict": "reject_and_emit_controller_conflict"
    }
  },
  "attemptLifecycle": {
    "initialState": "queued",
    "terminalStates": [
      "succeeded",
      "failed_retryable",
      "failed_final",
      "aborted",
      "timed_out",
      "quarantined",
      "handoff_required"
    ],
    "nonTerminalStates": [
      "queued",
      "running",
      "validating",
      "waiting_for_validation_lane",
      "aborting",
      "killing_process_tree",
      "stale"
    ],
    "retryableTerminalStates": [
      "failed_retryable",
      "timed_out",
      "quarantined"
    ],
    "retryForbiddenFromNonTerminal": true,
    "deadlineRequiredForNonTerminalStates": true,
    "handoffRequiredCreatesQueueItem": true
  },
  "planLifecycle": {
    "completionPredicateRequired": true,
    "cannotCompleteWithRequiredNonTerminalWorkspaces": true,
    "cannotCompleteWithUnresolvedRequiredHandoff": true,
    "finalValidationRequiredBeforeCompleted": true,
    "states": [
      "created",
      "preflight",
      "running",
      "blocked_with_reason",
      "awaiting_handoff",
      "final_validation",
      "completed",
      "completed_with_warnings",
      "failed_final",
      "stopping",
      "stopped"
    ]
  },
  "actorPermissions": {
    "workspaceAttemptController": {
      "mayMutateAttemptState": true,
      "mayCreateRetryAttempt": true
    },
    "planSupervisor": {
      "mayMutatePlanState": true,
      "mayReserveSchedulerSlots": true
    },
    "executorActor": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "validationActor": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "gitRunner": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "retryPolicy": {
      "mayMutateAttemptState": false,
      "mayCreateRetryAttempt": false,
      "maySuggestRetry": true
    },
    "brainWorkers": {
      "mayMutateExecutionState": false,
      "mayEmitDiagnosis": true,
      "mayProposeAction": true
    },
    "diagnostics": {
      "mayMutateExecutionState": false,
      "mayEmitEvidence": true
    }
  },
  "admissionGate": {
    "required": true,
    "allEntrypointsMustUseGate": true,
    "coveredEntrypoints": [
      "cli_plan_run",
      "dashboard_run",
      "api_plan_run",
      "retry_endpoint",
      "cleanup_rerun_endpoint",
      "brain_worker_trigger",
      "overnight_runner",
      "proposal_executor"
    ],
    "rejectWhen": [
      "postgres_unavailable_for_authoritative_runtime",
      "json_runtime_fallback_detected",
      "execution_kernel_disabled",
      "state_authority_not_single",
      "brain_worker_direct_mutation_detected",
      "stable_3_admission_failed"
    ]
  },
  "resourceCoordination": {
    "nestedLocksForbidden": true,
    "holdLockAcrossAwaitForbidden": true,
    "stateLocks": {
      "scope": "attempt",
      "maxHoldMs": 1000
    },
    "planLock": {
      "scope": "plan",
      "maxHoldMs": 1000,
      "purpose": "slot_reservation_only"
    },
    "gitRunner": {
      "mode": "queue",
      "repoMutationTimeoutMs": 60000,
      "lockBypassForbidden": true
    },
    "validationLanes": {
      "heavy": {
        "maxConcurrent": 1
      },
      "targeted": {
        "maxConcurrent": 3
      }
    },
    "stateStore": {
      "writesThroughControllerOnly": true,
      "transactionOrWriteQueueRequired": true
    }
  },
  "deadlineWatchdog": {
    "required": true,
    "intervalSeconds": 15,
    "emitsEventsOnly": true,
    "eventType": "deadline_exceeded",
    "supervised": true,
    "onWatchdogUnavailable": "block_new_execution_or_downgrade"
  },
  "handoffQueue": {
    "required": true,
    "createdByStates": [
      "handoff_required"
    ],
    "allowedActions": [
      "retry_requested",
      "close_failed",
      "manual_resolution",
      "followup_plan_requested"
    ],
    "controllerMediatedRetryRequired": true
  },
  "legacyMigration": {
    "enabled": true,
    "strategy": "strangler_fig",
    "phases": [
      "M0_shadow",
      "M1_compatibility_adapter",
      "M2_actor_conversion",
      "M3_enforcement",
      "M4_cleanup"
    ],
    "dualAuthorityForbidden": true,
    "legacyWritesEmitAuditEvents": true,
    "legacyMechanismFieldsAreHints": true
  },
  "planExecution": {
    "phase": "P37",
    "title": "Patch Transaction Runtime Prototype",
    "mode": "stable_3",
    "maxParallelWorkspaces": 3,
    "scheduling": {
      "continuous": true,
      "slotCount": 3,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": false,
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
      "enabled": false,
      "enabledByDefault": false,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": false,
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
    "validationLane": {
      "maxConcurrentHeavyValidations": 1,
      "maxConcurrentTargetedValidations": 3,
      "backpressureEnabled": true,
      "backpressureStrategy": "prefer_targeted_when_heavy_saturated",
      "schedulerFeedbackEnabled": true
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
    "patchTransactionPrototype": {
      "targetRuntime": "stable_6_candidate",
      "enabledByDefault": false,
      "featureFlagRequired": true,
      "maxCodegenWorkers": 6,
      "patchApplyLanes": 1,
      "singleRepositoryWriter": "patch_coordinator",
      "workersMayMutateMainRepo": false,
      "patchArtifactsRequired": true,
      "writeSetGuardRequired": true,
      "fileHashGuardRequired": true,
      "forbiddenPathGuardRequired": true,
      "rollbackRequired": true,
      "validationAfterApplyRequired": true,
      "finalIntegrationValidationRequired": true
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
      "reason": "P37 modifies runtime infrastructure; deterministic stable_3 execution is required."
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
      "heavy": {
        "maxConcurrent": 1
      },
      "targeted": {
        "maxConcurrent": 3
      }
    }
  },
  "promotionGates": {
    "initialMode": "stable_3",
    "targetMode": "stable_6",
    "gates": [
      {
        "id": "stable_3_admission_passed",
        "requiredFor": [
          "plan_start"
        ],
        "status": "pending"
      },
      {
        "id": "mutation_backend_seam_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "patch_artifact_store_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "patch_coordinator_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "direct_mutation_guard_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "scheduler_patch_mode_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "real_repo_3_worker_dogfood_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "real_repo_6_worker_dogfood_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      }
    ]
  },
  "safety": {
    "hardStops": [
      "patch_transaction_enabled_without_feature_flag",
      "patch_transaction_backend_selected_without_patch_coordinator",
      "patch_transaction_backend_selected_without_artifact_store",
      "patch_transaction_backend_selected_without_rollback_manager",
      "patch_transaction_backend_selected_without_direct_mutation_guard",
      "worker_direct_repo_mutation_detected",
      "patch_without_base_sha",
      "patch_without_write_set",
      "patch_write_set_violation",
      "patch_forbidden_path_detected",
      "patch_stale_hash_blind_overwrite_attempt",
      "patch_apply_without_clean_check",
      "patch_apply_without_rollback_plan",
      "patch_validation_failure_without_rollback",
      "patch_apply_lane_count_gt_1",
      "dirty_repo_leak_after_failed_patch",
      "patch_state_stuck_non_terminal",
      "stable_3_default_behavior_changed",
      "worktree_legacy_code_deleted",
      "json_runtime_fallback_used_as_truth",
      "git_push_attempted",
      "watch_mode_validation_command",
      "raw_destructive_cleanup_command"
    ]
  },
  "workspaces": [
    {
      "id": "P37.00",
      "title": "Preflight & Runtime Inventory",
      "batch": "B0",
      "area": "diagnostics",
      "priority": "critical",
      "dependencies": [],
      "hardDeps": [],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "diagnostic",
      "riskLevel": "medium",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run typecheck -- --noEmit",
      "validationCommands": [
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "reports/patch-transaction-runtime/p37-preflight/**",
        "scripts/diagnose-patch-transaction-readiness.ts"
      ],
      "capabilities": {
        "canEdit": [
          "reports/patch-transaction-runtime/p37-preflight/**",
          "scripts/diagnose-patch-transaction-readiness.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "reports/patch-transaction-runtime/p37-preflight/**",
          "scripts/diagnose-patch-transaction-readiness.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Runtime inventory report exists.",
        "Executor entrypoints, mutation tools, scheduler admission path, validation path, and worktree preservation list are documented.",
        "No runtime behavior change is introduced."
      ]
    },
    {
      "id": "P37.01",
      "title": "MutationBackend Seam & Isolation Mode Plumbing",
      "batch": "B1",
      "area": "core/execution",
      "priority": "critical",
      "dependencies": [
        "P37.00"
      ],
      "hardDeps": [
        "P37.00"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "high",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/mutation-backend.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/mutation-backend.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/mutation-backend.ts",
        "packages/coding-agent/src/core/execution/isolation-mode.ts",
        "packages/coding-agent/src/core/execution/mutation-backend-selector.ts",
        "packages/coding-agent/src/core/execution/patch/patch-transaction-backend.ts",
        "packages/coding-agent/src/core/execution/index.ts",
        "packages/coding-agent/test/execution/mutation-backend.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/mutation-backend.ts",
          "packages/coding-agent/src/core/execution/isolation-mode.ts",
          "packages/coding-agent/src/core/execution/mutation-backend-selector.ts",
          "packages/coding-agent/src/core/execution/patch/patch-transaction-backend.ts",
          "packages/coding-agent/src/core/execution/index.ts",
          "packages/coding-agent/test/execution/mutation-backend.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/mutation-backend.ts",
          "packages/coding-agent/src/core/execution/isolation-mode.ts",
          "packages/coding-agent/src/core/execution/mutation-backend-selector.ts",
          "packages/coding-agent/src/core/execution/patch/patch-transaction-backend.ts",
          "packages/coding-agent/src/core/execution/index.ts",
          "packages/coding-agent/test/execution/mutation-backend.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Backend selection tests pass.",
        "Patch transaction selection requires explicit enable flag.",
        "Worktree legacy selection remains available.",
        "Default stable_3 behavior is preserved."
      ]
    },
    {
      "id": "P37.02",
      "title": "Real PatchArtifact Schema & PatchArtifactStore",
      "batch": "B1",
      "area": "core/execution/patch",
      "priority": "critical",
      "dependencies": [
        "P37.00"
      ],
      "hardDeps": [
        "P37.00"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "medium",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-artifact.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-artifact.test.ts",
        "npm run test -w packages/coding-agent -- test/execution/patch-artifact-store.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-artifact.ts",
        "packages/coding-agent/src/core/execution/patch/patch-artifact-store.ts",
        "packages/coding-agent/src/core/execution/patch/patch-status.ts",
        "packages/coding-agent/src/core/execution/patch/patch-validation-plan.ts",
        "packages/coding-agent/src/core/execution/patch/index.ts",
        "packages/coding-agent/test/execution/patch-artifact.test.ts",
        "packages/coding-agent/test/execution/patch-artifact-store.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-artifact.ts",
          "packages/coding-agent/src/core/execution/patch/patch-artifact-store.ts",
          "packages/coding-agent/src/core/execution/patch/patch-status.ts",
          "packages/coding-agent/src/core/execution/patch/patch-validation-plan.ts",
          "packages/coding-agent/src/core/execution/patch/index.ts",
          "packages/coding-agent/test/execution/patch-artifact.test.ts",
          "packages/coding-agent/test/execution/patch-artifact-store.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-artifact.ts",
          "packages/coding-agent/src/core/execution/patch/patch-artifact-store.ts",
          "packages/coding-agent/src/core/execution/patch/patch-status.ts",
          "packages/coding-agent/src/core/execution/patch/patch-validation-plan.ts",
          "packages/coding-agent/src/core/execution/patch/index.ts",
          "packages/coding-agent/test/execution/patch-artifact.test.ts",
          "packages/coding-agent/test/execution/patch-artifact-store.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Patch without baseSha, writeSet, or diff/file operations is invalid.",
        "Store writes and reads artifact without data loss.",
        "Artifact paths are scoped to .pi/patches/."
      ]
    },
    {
      "id": "P37.03",
      "title": "PatchCoordinator, Guards, and Rollback Core",
      "batch": "B2",
      "area": "core/execution/patch",
      "priority": "critical",
      "dependencies": [
        "P37.01",
        "P37.02"
      ],
      "hardDeps": [
        "P37.01",
        "P37.02"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "critical",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-coordinator.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-coordinator.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-coordinator.ts",
        "packages/coding-agent/src/core/execution/patch/patch-apply-queue.ts",
        "packages/coding-agent/src/core/execution/patch/write-set-guard.ts",
        "packages/coding-agent/src/core/execution/patch/file-hash-guard.ts",
        "packages/coding-agent/src/core/execution/patch/forbidden-path-guard.ts",
        "packages/coding-agent/src/core/execution/patch/rollback-manager.ts",
        "packages/coding-agent/src/core/execution/patch/patch-coordinator-journal.ts",
        "packages/coding-agent/test/execution/patch-coordinator.test.ts",
        "packages/coding-agent/test/execution/patch-guards.test.ts",
        "packages/coding-agent/test/execution/rollback-manager.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-coordinator.ts",
          "packages/coding-agent/src/core/execution/patch/patch-apply-queue.ts",
          "packages/coding-agent/src/core/execution/patch/write-set-guard.ts",
          "packages/coding-agent/src/core/execution/patch/file-hash-guard.ts",
          "packages/coding-agent/src/core/execution/patch/forbidden-path-guard.ts",
          "packages/coding-agent/src/core/execution/patch/rollback-manager.ts",
          "packages/coding-agent/src/core/execution/patch/patch-coordinator-journal.ts",
          "packages/coding-agent/test/execution/patch-coordinator.test.ts",
          "packages/coding-agent/test/execution/patch-guards.test.ts",
          "packages/coding-agent/test/execution/rollback-manager.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-coordinator.ts",
          "packages/coding-agent/src/core/execution/patch/patch-apply-queue.ts",
          "packages/coding-agent/src/core/execution/patch/write-set-guard.ts",
          "packages/coding-agent/src/core/execution/patch/file-hash-guard.ts",
          "packages/coding-agent/src/core/execution/patch/forbidden-path-guard.ts",
          "packages/coding-agent/src/core/execution/patch/rollback-manager.ts",
          "packages/coding-agent/src/core/execution/patch/patch-coordinator-journal.ts",
          "packages/coding-agent/test/execution/patch-coordinator.test.ts",
          "packages/coding-agent/test/execution/patch-guards.test.ts",
          "packages/coding-agent/test/execution/rollback-manager.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "WriteSet violation, forbidden path, stale hash, and apply failure are handled safely.",
        "Validation failure triggers rollback.",
        "Dirty repo leak after failed patch is zero in tests.",
        "Only PatchCoordinator applies patches."
      ]
    },
    {
      "id": "P37.04",
      "title": "Worker Temp Overlay, Diff Generation, and Direct Mutation Guard",
      "batch": "B2",
      "area": "core/tools",
      "priority": "critical",
      "dependencies": [
        "P37.01",
        "P37.02"
      ],
      "hardDeps": [
        "P37.01",
        "P37.02"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "critical",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-workspace.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-workspace.test.ts",
        "npm run test -w packages/coding-agent -- test/execution/direct-mutation-detector.test.ts",
        "npm run test -w packages/coding-agent -- test/execution/diff-generator.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-workspace.ts",
        "packages/coding-agent/src/core/execution/patch/diff-generator.ts",
        "packages/coding-agent/src/core/execution/patch/direct-mutation-detector.ts",
        "packages/coding-agent/src/core/tools/file-write-policy.ts",
        "packages/coding-agent/test/execution/patch-workspace.test.ts",
        "packages/coding-agent/test/execution/direct-mutation-detector.test.ts",
        "packages/coding-agent/test/execution/diff-generator.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-workspace.ts",
          "packages/coding-agent/src/core/execution/patch/diff-generator.ts",
          "packages/coding-agent/src/core/execution/patch/direct-mutation-detector.ts",
          "packages/coding-agent/src/core/tools/file-write-policy.ts",
          "packages/coding-agent/test/execution/patch-workspace.test.ts",
          "packages/coding-agent/test/execution/direct-mutation-detector.test.ts",
          "packages/coding-agent/test/execution/diff-generator.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-workspace.ts",
          "packages/coding-agent/src/core/execution/patch/diff-generator.ts",
          "packages/coding-agent/src/core/execution/patch/direct-mutation-detector.ts",
          "packages/coding-agent/src/core/tools/file-write-policy.ts",
          "packages/coding-agent/test/execution/patch-workspace.test.ts",
          "packages/coding-agent/test/execution/direct-mutation-detector.test.ts",
          "packages/coding-agent/test/execution/diff-generator.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Main repo unchanged after worker codegen before coordinator apply.",
        "Diff generation handles created and deleted files.",
        "Direct main repo mutation is detected and hard-stopped.",
        "Non-patch modes preserve existing behavior."
      ]
    },
    {
      "id": "P37.05",
      "title": "Patch Transaction Lifecycle Events and State Persistence",
      "batch": "B2",
      "area": "core/state",
      "priority": "high",
      "dependencies": [
        "P37.01",
        "P37.02"
      ],
      "hardDeps": [
        "P37.01",
        "P37.02"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "high",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-events.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-events.test.ts",
        "npm run test -w packages/coding-agent -- test/execution/patch-state.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-events.ts",
        "packages/coding-agent/src/core/execution/patch/patch-state.ts",
        "packages/coding-agent/src/core/execution/patch/patch-persistence.ts",
        "packages/coding-agent/src/core/execution/patch/patch-deadlines.ts",
        "packages/coding-agent/test/execution/patch-events.test.ts",
        "packages/coding-agent/test/execution/patch-state.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-events.ts",
          "packages/coding-agent/src/core/execution/patch/patch-state.ts",
          "packages/coding-agent/src/core/execution/patch/patch-persistence.ts",
          "packages/coding-agent/src/core/execution/patch/patch-deadlines.ts",
          "packages/coding-agent/test/execution/patch-events.test.ts",
          "packages/coding-agent/test/execution/patch-state.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-events.ts",
          "packages/coding-agent/src/core/execution/patch/patch-state.ts",
          "packages/coding-agent/src/core/execution/patch/patch-persistence.ts",
          "packages/coding-agent/src/core/execution/patch/patch-deadlines.ts",
          "packages/coding-agent/test/execution/patch-events.test.ts",
          "packages/coding-agent/test/execution/patch-state.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Patch lifecycle events are typed.",
        "Non-terminal patch states have deadlines.",
        "Patch states cannot remain non-terminal indefinitely in tests.",
        "No JSON fallback becomes runtime truth."
      ]
    },
    {
      "id": "P37.06",
      "title": "Scheduler Integration: Codegen Slots and Patch Apply Lane",
      "batch": "B3",
      "area": "core/scheduler",
      "priority": "critical",
      "dependencies": [
        "P37.01",
        "P37.03",
        "P37.04",
        "P37.05"
      ],
      "hardDeps": [
        "P37.01",
        "P37.03",
        "P37.04",
        "P37.05"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "critical",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-scheduler.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-scheduler.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-scheduling-profile.ts",
        "packages/coding-agent/src/core/workspace-scheduler.ts",
        "packages/coding-agent/src/core/scheduler.ts",
        "packages/coding-agent/src/core/dynamic-parallel-scheduler.ts",
        "packages/coding-agent/test/execution/patch-scheduler.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-scheduling-profile.ts",
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/core/scheduler.ts",
          "packages/coding-agent/src/core/dynamic-parallel-scheduler.ts",
          "packages/coding-agent/test/execution/patch-scheduler.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-scheduling-profile.ts",
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/core/scheduler.ts",
          "packages/coding-agent/src/core/dynamic-parallel-scheduler.ts",
          "packages/coding-agent/test/execution/patch-scheduler.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Patch mode admits codegen without worktree lease.",
        "Six codegen slots can be simulated in tests.",
        "Patch apply queue remains single lane.",
        "Existing stable_3 scheduler behavior does not regress."
      ]
    },
    {
      "id": "P37.07",
      "title": "Feature Flags, AdmissionGate, Doctor, and Compatibility",
      "batch": "B3",
      "area": "admission",
      "priority": "critical",
      "dependencies": [
        "P37.01",
        "P37.02",
        "P37.03",
        "P37.06"
      ],
      "hardDeps": [
        "P37.01",
        "P37.02",
        "P37.03",
        "P37.06"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "implementation",
      "riskLevel": "high",
      "maxRetries": 1,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run test -w packages/coding-agent -- test/execution/patch-readiness.test.ts",
      "validationCommands": [
        "npm run test -w packages/coding-agent -- test/execution/patch-readiness.test.ts",
        "npm run test -w packages/coding-agent -- test/execution/patch-admission.test.ts",
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/core/execution/patch/patch-readiness.ts",
        "packages/coding-agent/src/core/admission-gate.ts",
        "packages/coding-agent/src/core/production-readiness-doctor.ts",
        "packages/coding-agent/test/execution/patch-readiness.test.ts",
        "packages/coding-agent/test/execution/patch-admission.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-readiness.ts",
          "packages/coding-agent/src/core/admission-gate.ts",
          "packages/coding-agent/src/core/production-readiness-doctor.ts",
          "packages/coding-agent/test/execution/patch-readiness.test.ts",
          "packages/coding-agent/test/execution/patch-admission.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/execution/patch/patch-readiness.ts",
          "packages/coding-agent/src/core/admission-gate.ts",
          "packages/coding-agent/src/core/production-readiness-doctor.ts",
          "packages/coding-agent/test/execution/patch-readiness.test.ts",
          "packages/coding-agent/test/execution/patch-admission.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Patch transaction cannot start unless components are present.",
        "patchApplyLanes > 1 is rejected.",
        "Doctor shows readiness status and blocked reasons.",
        "Existing non-patch modes remain healthy."
      ]
    },
    {
      "id": "P37.08",
      "title": "Real Repo Patch Transaction Dogfood Gauntlet",
      "batch": "B4",
      "area": "scripts/reports",
      "priority": "critical",
      "dependencies": [
        "P37.03",
        "P37.04",
        "P37.06",
        "P37.07"
      ],
      "hardDeps": [
        "P37.03",
        "P37.04",
        "P37.06",
        "P37.07"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "dogfood",
      "riskLevel": "critical",
      "maxRetries": 0,
      "worktree": false,
      "integration": false,
      "targetCommand": "PI_EXECUTION_ISOLATION_MODE=patch_transaction PI_PATCH_TRANSACTION_ENABLED=1 npx tsx scripts/run-patch-transaction-runtime-gauntlet.ts",
      "validationCommands": [
        "PI_EXECUTION_ISOLATION_MODE=patch_transaction PI_PATCH_TRANSACTION_ENABLED=1 npx tsx scripts/run-patch-transaction-runtime-gauntlet.ts",
        "npm run typecheck -- --noEmit",
        "npm run test -w packages/coding-agent -- test/execution"
      ],
      "allowedFiles": [
        "scripts/run-patch-transaction-runtime-gauntlet.ts",
        "reports/patch-transaction-runtime/**",
        "packages/coding-agent/test/execution/patch-runtime-gauntlet.test.ts"
      ],
      "capabilities": {
        "canEdit": [
          "scripts/run-patch-transaction-runtime-gauntlet.ts",
          "reports/patch-transaction-runtime/**",
          "packages/coding-agent/test/execution/patch-runtime-gauntlet.test.ts"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "scripts/run-patch-transaction-runtime-gauntlet.ts",
          "reports/patch-transaction-runtime/**",
          "packages/coding-agent/test/execution/patch-runtime-gauntlet.test.ts"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "3-worker dogfood passes.",
        "6-codegen-worker dogfood passes.",
        "Peak codegen workers is 6.",
        "Dirty repo leak, stuck state, and direct worker mutation counts are zero.",
        "Rollback success and writeSet detection are 100%."
      ]
    },
    {
      "id": "P37.09",
      "title": "Final Validation, Documentation, and Promotion Recommendation",
      "batch": "B5",
      "area": "docs/reports",
      "priority": "critical",
      "dependencies": [
        "P37.08"
      ],
      "hardDeps": [
        "P37.08"
      ],
      "canRunWith": [],
      "cannotRunWith": [],
      "workspaceRole": "finalization",
      "riskLevel": "medium",
      "maxRetries": 0,
      "worktree": false,
      "integration": false,
      "targetCommand": "npm run typecheck -- --noEmit",
      "validationCommands": [
        "npm run typecheck -- --noEmit"
      ],
      "allowedFiles": [
        "docs/pi/p37-patch-transaction-runtime.md",
        "reports/patch-transaction-runtime/final-summary.md",
        "reports/patch-transaction-runtime/promotion-recommendation.md"
      ],
      "capabilities": {
        "canEdit": [
          "docs/pi/p37-patch-transaction-runtime.md",
          "reports/patch-transaction-runtime/final-summary.md",
          "reports/patch-transaction-runtime/promotion-recommendation.md"
        ]
      },
      "capabilityManifest": {
        "canEdit": [
          "docs/pi/p37-patch-transaction-runtime.md",
          "reports/patch-transaction-runtime/final-summary.md",
          "reports/patch-transaction-runtime/promotion-recommendation.md"
        ],
        "canRunCommands": true,
        "canUseNetwork": false
      },
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "docs/llm-implementation-agent-master-template.md"
      ],
      "acceptanceCriteria": [
        "Operator and developer docs exist.",
        "Final summary and promotion recommendation exist.",
        "Known limitations and rollback instructions are documented.",
        "P37 remains honest about production readiness."
      ]
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P37",
  "title": "Patch Transaction Runtime Prototype",
  "contractVersion": "4.0.0",
  "templateVersion": "4.0.0",
  "executionClass": "implementation",
  "selectedScaleMode": "stable_3",
  "requestedMaxWorkers": 3,
  "expectedDagEffectiveParallelism": 3,
  "expectedSafeEffectiveParallelism": "2-3",
  "targetPromotionMode": "stable_6",
  "runtimeBeingBuilt": "patch_transaction_stable_6_candidate",
  "worktreeRequiredForThisRun": false,
  "integrationQueueRequiredForThisRun": false,
  "postgresAuthoritativeStateRequired": true,
  "jsonRuntimeFallbackAllowed": false,
  "autonomousExecutionAllowed": true,
  "agentRepoMutationAllowed": true,
  "workspaceCount": 10,
  "batchCount": 6,
  "criticalPath": [
    "P37.00",
    "P37.01",
    "P37.03",
    "P37.06",
    "P37.08",
    "P37.09"
  ],
  "parallelGroups": {
    "B0": [
      "P37.00"
    ],
    "B1": [
      "P37.01",
      "P37.02"
    ],
    "B2": [
      "P37.03",
      "P37.04",
      "P37.05"
    ],
    "B3": [
      "P37.06",
      "P37.07"
    ],
    "B4": [
      "P37.08"
    ],
    "B5": [
      "P37.09"
    ]
  },
  "definitionOfDone": [
    "MutationBackend seam exists.",
    "PatchArtifact schema and store exist.",
    "PatchCoordinator applies patches as the only repository writer.",
    "Direct worker mutation is blocked in patch_transaction mode.",
    "Scheduler can simulate six codegen workers and one patch apply lane.",
    "Patch transaction admission and doctor checks exist.",
    "Real repo dogfood reports prove zero dirty leak, zero direct mutation, zero stuck state, 100% rollback, and 100% writeSet detection.",
    "Existing stable_3 path remains healthy.",
    "Worktree legacy path is preserved."
  ]
}
```

# P26 — Execution Correctness Recovery

**Contract Version:** 3.0.0  
**Template:** LLM Implementation Agent — Repair & Execution Correctness Template v3.0  
**Phase:** P26  
**Title:** Execution Correctness Recovery  
**Status:** Planned  
**Last Updated:** 2026-05-25  
**Execution Class:** `repair`  
**Selected Repair Mode:** `manual_1`  
**Target Promotion Mode:** `stable_6`  
**Autonomous Execution Allowed:** `false`  
**Agent Repo Mutation Allowed:** `false`  
**Scheduler Runtime Use:** `disabled_until_promotion`  
**Workspace Count:** 14  
**Safe Effective Parallelism During Repair:** 1  

---

## 0. TL;DR / Compact Mental Model

P26 repairs the execution substrate itself. The current autonomous runtime is not trusted because concurrent workspace execution can share mutable executor state, abort wiring is incomplete, git worktree locking can fail unsafely, validation processes can hang, and state persistence can race under concurrent writes.

Therefore, **P26 must not be executed by the broken autonomous executor.** Every workspace is a manually reviewed patch unit. The workflow is:

```text
analyze -> propose patch -> human review -> manual apply -> targeted validation -> checkpoint -> next patch
```

The end state is not merely "code changed." P26 is complete only when the repaired system passes promotion gates:

```text
manual_1 -> stable_1 -> stable_3 -> stable_6
```

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P26 |
| Title | Execution Correctness Recovery |
| Status | Planned |
| Last updated | 2026-05-25 |
| Delivery status | Not started |
| Target environment | Local first, then dogfood |
| Primary focus | Execution correctness, bounded liveness, repair-mode safety, stable_6 promotion |
| Product-code changes | Allowed, but manual-gated |
| Repair class | repair |
| Execution automation | disabled |
| Selected repair mode | manual_1 |
| Target promotion mode | stable_6 |
| Autonomous execution allowed | false |
| Agent repo mutation allowed | false |
| Promotion gate status | pending |
| Selected scale mode during repair | stable_3 validation only; scheduler disabled |
| Requested max workers during repair | 1 |
| Expected DAG effective parallelism | 4 theoretical, display only |
| Expected safe effective parallelism | 1 until promotion |
| Worktree isolation | Required for validation and future promotion |
| Integration queue | Required before stable_6 promotion |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P26.A-P26.N | Human maintainer + LLM patch author | Human maintainer | Runtime/infra reviewer | Product and platform stakeholders |

---

## 2. Purpose

P26 exists to restore trust in Pi's autonomous execution substrate. The previous design allowed a continuous scheduler to fill multiple workspace slots, but the execution layer retained shared mutable state inside a singleton `WorkspaceAgentExecutor`. Under parallel execution this can corrupt abort handling, timeout handling, LLM idle watchdogs, log paths, and git worktree references. Worktree isolation at the filesystem level is not sufficient when the in-process executor state is still shared.

P26 also addresses the real tıkanma classes that remain after executor isolation: LLM provider stalls, validation/test process hangs, git/worktree lock contention, state store write races, stale leases, integration queue stalls, and plan-design mistakes that accidentally serialize the graph or overload validation lanes.

P26 is intentionally a repair-mode phase. It must not be run through the broken autonomous runtime. Each workspace is a patch/review/checkpoint unit. The autonomous scheduler remains disabled until the relevant promotion gates pass.

The target outcome is `stable_6` readiness: six concurrent workspace execution may be re-enabled only after executor isolation, abort chaining, git serialization, validation process containment, state consistency, crash recovery, stable_3 dogfood, and stable_6 stress all pass.

---

## 3. What Carried Over — Must Stay Stable

* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup such as `rm -rf` remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] Secrets and forbidden files remain inaccessible.
* [ ] Worktree isolation remains available and path-scoped under `.pi/worktrees`.
* [ ] Integration queue remains single-writer and validation-gated.
* [ ] Completion gate must not mark a plan complete if integration validation fails.
* [ ] Merge conflicts produce handoff artifacts, not silent success.
* [ ] Queue priority never bypasses validation.
* [ ] Dashboard requests never directly mutate execution state.
* [ ] In repair mode, human patch application is the source of truth.
* [ ] After promotion, the executor remains the only component that mutates execution state.

---

## 4. Background / What Was Wrong

The core execution flaw was that workspace isolation stopped at the filesystem boundary. Each workspace could receive a git worktree, but the object managing execution was shared. Under concurrent scheduling, multiple workspace calls could overwrite the same executor fields: abort controller, timeout handle, LLM idle handle, worktree executor, log path, and last LLM event timestamp.

This produced nondeterministic symptoms:

* aborting workspace A could abort workspace B;
* workspace A's log output could be written to workspace B's log path;
* workspace A's LLM idle watchdog could be cleared by workspace C;
* artifact collection could read from the wrong worktree;
* stop/pause could fail to stop active work;
* git worktree lock timeouts could permit unsafe branch/worktree races;
* validation processes could hang without bounded cleanup;
* JSON-backed state could be corrupted or made stale by concurrent writes.

P26 repairs the substrate by converting every indefinite or shared-state condition into a bounded, workspace-local, observable state transition.

---

## 5. Current Failure State / Known Blockers

| Component | State | Blocks |
|---|---|---|
| `WorkspaceAgentExecutor` singleton runtime state | broken | stable_1, stable_3, stable_6 |
| `AbortSignal` propagation to real execution | incomplete | stable_1, stable_3, stable_6 |
| Worktree mutex / git branch lock behavior | unsafe under contention | stable_3, stable_6 |
| Attempt-scoped worktree identity | incomplete | stable_3, stable_6 |
| JSON state store concurrent writes | unsafe | stable_3, stable_6 |
| Validation process lifecycle containment | incomplete | stable_3, stable_6 |
| LLM provider bounded runtime | incomplete | stable_3, stable_6 |
| Lease heartbeat / quarantine | incomplete | stable_3, stable_6 |
| Integration queue correctness under drift/conflict | incomplete | stable_6 |
| Plan-intake anti-stall analysis | incomplete | stable_6 |
| stable_3 dogfood | not passed | stable_6 |
| stable_6 stress | not passed | stable_6 |

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Broken executor is accidentally used to repair itself | medium | critical | P26.A hard-gates repair-mode autonomous execution and rejects pi plan run for repair plans. |
| A patch is too broad and reintroduces hidden coupling | medium | high | One patch at a time, narrow allowedFiles, human review, targeted validation. |
| Validation command hangs | high | high | P26.H creates managed validation runtime with timeout, no-watch guard, output cap, process tree kill. |
| LLM provider stalls or stream goes idle | medium | high | P26.J adds request timeout, stream idle watchdog, circuit breaker. |
| Git lock contention corrupts worktree state | medium | critical | P26.E removes lock bypass and serializes repo-wide git mutations. |
| State store corrupts journal or plan-state under concurrent writes | medium | critical | P26.G serializes JSON writes and adds atomic snapshot/journal invariants. |
| Plan design still produces low safe parallelism | medium | medium | P26.M adds anti-stall plan-intake and optimizer warnings. |
| stable_6 promoted too early | low | critical | P26.N requires stable_3 dogfood and stable_6 stress gates before promotion. |

---

## 7. Workstreams

### P26.A — Repair-mode lockdown and promotion guard

**Goal:** Make the system refuse autonomous repair execution and prevent stable_6/continuous scheduling until explicit promotion gates pass.

**Dependencies:** None  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- plan-doctor worker-concurrency`

**Likely files / components:**
* `packages/coding-agent/src/cli/plan-commands.ts`
* `packages/coding-agent/src/core/worker-concurrency.ts`
* `packages/coding-agent/src/core/safety-doctor.ts`
* `packages/coding-agent/src/core/plan-parser.ts`
* `docs/llm-implementation-agent-master-template.md`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Repair plans with executionAutomation.autonomousExecutionEnabled=false cannot be launched with autonomous execution commands.
* [ ] experimental_6/stable_6 cannot be selected while required promotion gates are pending.
* [ ] Doctor emits hard stops for autonomous_execution_requested_during_repair_mode and promotion_gate_failed_or_missing.
* [ ] Existing stable_1/stable_3 non-repair behavior remains backward compatible.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.A/`.
### P26.B — Per-workspace executor isolation

**Goal:** Remove the shared singleton WorkspaceAgentExecutor from the runtime path and create a fresh executor per workspace execution.

**Dependencies:** P26.A  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- workspace-agent-executor autonomous-executor`

**Likely files / components:**
* `packages/coding-agent/src/core/autonomous-executor.ts`
* `packages/coding-agent/src/core/workspace-agent-executor.ts`
* `packages/coding-agent/test/workspace-agent-executor.test.ts`
* `packages/coding-agent/test/autonomous-executor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] AutonomousExecutor no longer stores a reusable singleton WorkspaceAgentExecutor for concurrent workspace execution.
* [ ] Each executeWorkspace call creates or obtains a workspace-scoped executor instance.
* [ ] activeAgentExecutors tracks workspaceId -> executor for stop/artifact handling.
* [ ] Concurrent fake workspaces cannot overwrite each other's executor instance identity.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.B/`.
### P26.C — WorkspaceExecutionContext refactor

**Goal:** Move abort controller, timers, idle watchdog, log path, and worktree executor state into a per-execution context.

**Dependencies:** P26.B  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- workspace-agent-executor`

**Likely files / components:**
* `packages/coding-agent/src/core/workspace-agent-executor.ts`
* `packages/coding-agent/test/workspace-agent-executor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] abortController, timeoutHandle, llmIdleHandle, lastLLMEventTime, worktreeExecutor, and logPath are not shared mutable execution fields.
* [ ] executeInWorktree and executeAgentInPlace receive an execution context or equivalent immutable execution-local structure.
* [ ] setLogPath is removed from concurrent execution path or made non-mutating and execution-local.
* [ ] Timer isolation tests prove workspace A completion cannot clear workspace B watchdogs.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.C/`.
### P26.D — Abort, pause, stop, and force-kill correctness

**Goal:** Wire ContinuousExecutor AbortSignal through AutonomousExecutor, WorkspaceAgentExecutor, agent session, and process lifecycle cleanup.

**Dependencies:** P26.B, P26.C  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- continuous-executor abort stop`

**Likely files / components:**
* `packages/coding-agent/src/core/continuous-executor.ts`
* `packages/coding-agent/src/core/autonomous-executor.ts`
* `packages/coding-agent/src/core/workspace-agent-executor.ts`
* `packages/coding-agent/src/cli/plan-commands.ts`
* `packages/coding-agent/src/utils/shell.ts`
* `packages/coding-agent/test/continuous-executor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] plan-commands no longer ignores the AbortSignal passed by ContinuousExecutor.
* [ ] executeWorkspace accepts a signal and promptly aborts workspace-local work when signal fires.
* [ ] stopAllActiveWorkspaces aborts all active workspace executors, not just the latest one.
* [ ] Abort integration test verifies no workspace remains active and no tracked detached children remain after stop.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.D/`.
### P26.E — Strict GitRunner serialization and worktree lock hardening

**Goal:** Remove git worktree/branch lock bypass, centralize repo-wide mutations through GitRunner, and fail cleanly on lock timeout.

**Dependencies:** P26.A  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- git-runner worktree-workspace-executor`

**Likely files / components:**
* `packages/coding-agent/src/core/git-runner.ts`
* `packages/coding-agent/src/worktree/worktree-workspace-executor.ts`
* `packages/coding-agent/test/worktree-workspace-executor.test.ts`
* `packages/coding-agent/test/git-runner.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] The 5-second mutex auto-release/bypass behavior is removed.
* [ ] Branch lock acquisition throws if lock cannot be acquired; it never proceeds unlocked.
* [ ] git worktree prune, branch creation/reset, worktree add/remove run inside serialized repo-wide mutation scope.
* [ ] Cross-process or simulated concurrent worktree creation no longer produces git ref lock errors.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.E/`.
### P26.F — Attempt-scoped worktrees, branches, logs, and artifacts

**Goal:** Make every retry/crash recovery attempt use unique branch/path/artifact identities and never reuse stale attempt paths blindly.

**Dependencies:** P26.E  
**Queue priority:** `high`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- worktree attempt recovery`

**Likely files / components:**
* `packages/coding-agent/src/worktree/worktree-types.ts`
* `packages/coding-agent/src/worktree/worktree-workspace-executor.ts`
* `packages/coding-agent/src/core/autonomous-executor.ts`
* `packages/coding-agent/src/core/state-store.ts`
* `packages/coding-agent/src/core/json-state-store.ts`
* `packages/coding-agent/test/worktree-workspace-executor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Branch names include planExecutionId, workspaceId, and attemptId/attemptNo unique suffix.
* [ ] Worktree paths include attempt identity and never blindly reuse stale workspace root path.
* [ ] Diff/log/report artifact paths include attempt identity.
* [ ] Recovery can mark old attempt abandoned/recovered and start a fresh attempt without path collision.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.F/`.
### P26.G — StateStore serialization, atomic writes, and journal integrity

**Goal:** Make JSON fallback concurrency-safe and define transaction/write-queue invariants shared with the database backend.

**Dependencies:** P26.A  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Targeted validation:** `pnpm --filter coding-agent test -- json-state-store state-store-concurrency`

**Likely files / components:**
* `packages/coding-agent/src/core/state-store.ts`
* `packages/coding-agent/src/core/json-state-store.ts`
* `packages/coding-agent/src/core/plan-state.ts`
* `packages/coding-agent/src/core/database-state-store.ts`
* `packages/coding-agent/test/json-state-store.test.ts`
* `packages/coding-agent/test/state-store-concurrency.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] JsonStateStore serializes all mutating writes through a write queue or equivalent lock.
* [ ] plan-state snapshots use temp file + atomic rename semantics.
* [ ] execution-journal.ndjson writes are line-atomic and recovery-tolerant.
* [ ] Stress test with at least 1000 concurrent journal/status/log writes produces valid parseable output with no lost events.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.G/`.
### P26.H — Managed validation runner and process lifecycle containment

**Goal:** Introduce a validation runtime that enforces timeouts, no-watch rules, process group tracking, output caps, and kill-tree behavior.

**Dependencies:** P26.A  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- validation-runner bash-tool`

**Likely files / components:**
* `packages/coding-agent/src/core/validation-runner.ts`
* `packages/coding-agent/src/extensions/tools/bash.ts`
* `packages/coding-agent/src/utils/shell.ts`
* `packages/coding-agent/test/validation-runner.test.ts`
* `packages/coding-agent/test/bash-tool.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Validation commands run with deadline, closed stdin, CI env, output cap, and managed process group.
* [ ] Watch/dev-server commands are classified and blocked before execution.
* [ ] Timeout escalates SIGTERM to SIGKILL and records killed child PIDs.
* [ ] A deliberately hanging validation command exits as timed_out/killed and does not leave child processes.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.H/`.
### P26.I — Validation lane backpressure and scheduler feedback

**Goal:** Use validation lane state to avoid saturating heavy validation while preserving targeted validation throughput.

**Dependencies:** P26.H  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Targeted validation:** `pnpm --filter coding-agent test -- validation-lane workspace-scheduler`

**Likely files / components:**
* `packages/coding-agent/src/core/validation-lane.ts`
* `packages/coding-agent/src/core/workspace-scheduler.ts`
* `packages/coding-agent/src/core/execution-simulator.ts`
* `packages/coding-agent/test/workspace-scheduler.test.ts`
* `packages/coding-agent/test/validation-lane.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Heavy validation lane permits max 1 concurrent heavy validation by default.
* [ ] Targeted validation lane permits max 3 concurrent targeted validations by default.
* [ ] Scheduler defers heavy-validation workspaces when the heavy lane is saturated.
* [ ] Doctor/dashboard can explain validation_lane_saturated_blocking_scheduler.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.I/`.
### P26.J — Bounded LLM provider runtime and idle watchdog correctness

**Goal:** Guarantee LLM/provider calls cannot hang indefinitely and that stream idle watchdogs are workspace-local.

**Dependencies:** P26.C, P26.D  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- llm-runtime workspace-agent-executor`

**Likely files / components:**
* `packages/coding-agent/src/core/workspace-agent-executor.ts`
* `packages/coding-agent/src/core/sdk.ts`
* `packages/coding-agent/src/core/agent-session.ts`
* `packages/coding-agent/test/llm-runtime.test.ts`
* `packages/coding-agent/test/workspace-agent-executor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Every provider call has a request deadline.
* [ ] Every streaming session has a workspace-local idle watchdog.
* [ ] Provider timeout or stream idle timeout fails only the affected workspace and records a retryable failure reason.
* [ ] Circuit breaker opens after configured consecutive provider timeouts and does not fail the whole plan unless configured.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.J/`.
### P26.K — Lease monitor, heartbeat, quarantine, and requeue

**Goal:** Detect stale worktree/worker leases continuously and reconcile lease files with worktree state without waiting for restart.

**Dependencies:** P26.E, P26.F  
**Queue priority:** `high`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- lease-monitor worktree-manager`

**Likely files / components:**
* `packages/coding-agent/src/worktree/lease-monitor.ts`
* `packages/coding-agent/src/worktree/worktree-manager.ts`
* `packages/coding-agent/src/worktree/worktree-types.ts`
* `packages/coding-agent/src/core/autonomous-executor.ts`
* `packages/coding-agent/test/lease-monitor.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Active leases write heartbeat files on the configured interval.
* [ ] Stale lease detection checks heartbeat age and PID liveness.
* [ ] Lease/worktree-state disagreement quarantines the worktree and requeues the workspace when safe.
* [ ] Quarantine artifact includes lease snapshot, worktree state, and recovery decision.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.K/`.
### P26.L — Integration queue correctness, merge priority, and writeSet drift gate

**Goal:** Ensure successful workspaces enter a safe single-writer integration queue with merge priority and empirical writeSet drift checks.

**Dependencies:** P26.F, P26.G, P26.I  
**Queue priority:** `high`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- integration-queue completion-gate`

**Likely files / components:**
* `packages/coding-agent/src/core/integration-queue.ts`
* `packages/coding-agent/src/core/auto-commit.ts`
* `packages/coding-agent/src/core/completion-gate.ts`
* `packages/coding-agent/src/core/git-runner.ts`
* `packages/coding-agent/test/integration-queue.test.ts`
* `packages/coding-agent/test/completion-gate.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Only the integration queue mutates the integration/main branch; workers do not merge directly.
* [ ] Merge priority is recomputed on each dequeue and respects safety gates before priority.
* [ ] Empirical git diff --name-only writeSet is compared with declared conflictScope after workspace completion.
* [ ] Merge conflict or unresolved block-mode drift produces handoff artifact and does not mark plan complete.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.L/`.
### P26.M — Plan-intake anti-stall analysis and optimizer hardening

**Goal:** Make plan design problems visible before execution: accidental serialization, over-broad conflict scopes, validation contention, and missing approval gates.

**Dependencies:** P26.G  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Targeted validation:** `pnpm --filter coding-agent test -- plan-intake execution-simulator safety-doctor`

**Likely files / components:**
* `packages/coding-agent/src/core/plan-parser.ts`
* `packages/coding-agent/src/core/execution-simulator.ts`
* `packages/coding-agent/src/core/safety-doctor.ts`
* `packages/coding-agent/src/core/parallelism-review.ts`
* `packages/coding-agent/test/plan-intake.test.ts`
* `packages/coding-agent/test/execution-simulator.test.ts`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Doctor distinguishes DAG effective parallelism from safe effective parallelism.
* [ ] Plan-intake flags fully serialized graphs, long serialized tails, broad conflict scopes, and validation lane bottlenecks.
* [ ] Optimizer proposals remain advisory_until_approved and cannot alter forbidden safety fields.
* [ ] Repair-mode plans are blocked from autonomous execution by validation before scheduling.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.M/`.
### P26.N — Promotion gates, dogfood matrix, stress tests, and observability

**Goal:** Prove the repaired substrate through targeted tests, stable_3 dogfood, stable_6 stress, and dashboard/doctor diagnostics.

**Dependencies:** P26.B, P26.C, P26.D, P26.E, P26.F, P26.G, P26.H, P26.I, P26.J, P26.K, P26.L, P26.M  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Targeted validation:** `pnpm --filter coding-agent test -- execution-correctness-stress crash-recovery stable-6-dogfood scale-readiness`

**Likely files / components:**
* `packages/coding-agent/test/execution-correctness-stress.test.ts`
* `packages/coding-agent/test/crash-recovery.test.ts`
* `packages/coding-agent/test/stable-6-dogfood.test.ts`
* `packages/coding-agent/src/core/scale-readiness-doctor.ts`
* `packages/coding-agent/src/dashboard/**`
* `docs/p26-execution-correctness-recovery.md`

**Requirements:**
* Keep autonomous execution disabled for this repair workspace.
* Produce a small, reviewable patch with a rollback note.
* Run only the targeted validation command after human approval and manual application.
* Record a repair checkpoint before moving to the next workspace.

**Acceptance Criteria:**
* [ ] Promotion gate records exist for executor isolation, abort chain, validation hang kill, git serialization, state store concurrency, crash recovery, stable_3 dogfood, and stable_6 stress.
* [ ] Dashboard/doctor show workspaceId, attemptId, executorId, worktreePath, branchName, active timers, abort status, validation lane state, and blocked reason.
* [ ] stable_3 dogfood passes before stable_6 is permitted.
* [ ] stable_6 stress covers 6-slot execution, abort, LLM idle timeout, validation hang kill, git worktree contention, state concurrency, and crash recovery.

**Rollback:** Revert only the files changed by this workspace patch. Preserve logs, test output, and any quarantine artifacts under `.pi/executions/{planExecId}/repair/P26/P26.N/`.


---

## 8. Combined Implementation Order

### 8.1 Theoretical DAG order

```text
Batch 1: P26.A
Batch 2: P26.B + P26.E + P26.G + P26.H
Batch 3: P26.C + P26.F + P26.I
Batch 4: P26.D + P26.J + P26.K
Batch 5: P26.L + P26.M
Batch 6: P26.N
```

This DAG shows how the fixes could be reasoned about. It is **not permission to run P26 in parallel**. In repair mode, all workspaces are applied manually one at a time.

### 8.2 Manual repair order

```text
1. P26.A — Repair-mode lockdown and promotion guard
2. P26.B — Per-workspace executor isolation
3. P26.C — WorkspaceExecutionContext refactor
4. P26.D — Abort, pause, stop, and force-kill correctness
5. P26.E — Strict GitRunner serialization and worktree lock hardening
6. P26.F — Attempt-scoped worktrees, branches, logs, and artifacts
7. P26.G — StateStore serialization, atomic writes, and journal integrity
8. P26.H — Managed validation runner and process lifecycle containment
9. P26.I — Validation lane backpressure and scheduler feedback
10. P26.J — Bounded LLM provider runtime and idle watchdog correctness
11. P26.K — Lease monitor, heartbeat, quarantine, and requeue
12. P26.L — Integration queue correctness, merge priority, and writeSet drift gate
13. P26.M — Plan-intake anti-stall analysis and optimizer hardening
14. P26.N — Promotion gates, dogfood matrix, stress tests, and observability
```

### 8.3 Why safe effective parallelism is 1

Even though Batch 2 and Batch 4 have theoretical parallelism, P26 modifies the execution substrate itself. Running those patches through the broken substrate would invalidate the repair assumptions. Therefore, `safeEffectiveParallelism = 1` until promotion gates pass.

---

## 9. Definition of Done

P26 is complete when all of the following are true:

* [ ] All 14 repair workspaces are manually reviewed, applied, validated, and checkpointed.
* [ ] `autonomous_execution_requested_during_repair_mode` hard stop is enforced.
* [ ] Shared singleton executor runtime state is removed from concurrent execution path.
* [ ] Abort/pause/stop propagates from scheduler signal to workspace-local abort controller, agent session, and process cleanup.
* [ ] LLM provider calls have request timeout, stream idle watchdog, and circuit breaker events.
* [ ] Validation commands run through managed runner with timeout, process group, kill-tree, output cap, closed stdin, CI env, and no-watch guard.
* [ ] Git worktree/branch mutations are serialized through GitRunner/repo-wide lock; lock bypass is impossible.
* [ ] Worktree branches, paths, logs, and artifacts are attempt-scoped.
* [ ] State writes are transaction-backed or serialized by write queue; JSON fallback passes concurrency stress.
* [ ] Lease monitor detects stale leases and quarantines/requeues safely.
* [ ] Integration queue is single-writer, validation-gated, drift-aware, and conflict-handoff-safe.
* [ ] Plan-intake catches accidental serialization, broad conflict scopes, and validation bottlenecks.
* [ ] stable_3 dogfood passes.
* [ ] stable_6 stress passes.
* [ ] Dashboard/doctor show blocked reasons and promotion gate status.
* [ ] No forbidden commands, files, or destructive cleanup were used.

---

## 10. Rollback Playbook

**Trigger conditions:**

* Any repair patch introduces state corruption, broken stop/pause behavior, or unsafe git mutation.
* Any validation runner change leaves orphan processes.
* Any worktree change deletes or mutates outside `.pi/worktrees`.
* Any state store change produces malformed JSON/NDJSON or broken database writes.
* Any promotion gate fails and cannot be explained by expected pre-fix behavior.

**Rollback procedure:**

1. Stop immediately; do not proceed to the next workspace.
2. Keep autonomous execution disabled.
3. Revert only the current workspace patch.
4. Preserve logs, test output, quarantine artifacts, and state snapshots under `.pi/executions/{planExecId}/repair/P26/`.
5. Re-run the targeted validation for the previous checkpoint.
6. If the failure is systemic, reset target promotion mode to `stable_1` or keep `manual_1`.
7. Do not promote until the failing gate is fixed and re-run.

---

## 11. What P27 Inherits

P27 may inherit:

* Per-workspace executor isolation.
* Workspace-local abort/timer/log/worktree context.
* Bounded LLM runtime.
* Managed validation runner.
* Strict GitRunner serialization.
* Attempt-scoped worktree artifacts.
* Transaction/write-queue state persistence.
* Lease monitor and quarantine flow.
* Integration queue drift/conflict gates.
* Plan-intake anti-stall diagnostics.
* stable_6 promotion gate machinery.

P27 may add remote execution, scale_8 exploration, richer dashboard controls, release orchestration, or deeper autonomous planning only after P26 promotion gates pass.

---

# Part 2 — Agent Brief

## Mission

You are assisting with P26, a repair-mode phase for Pi's execution substrate. You are an advisor, reviewer, and patch author. You are **not** an autonomous executor for this phase.

You may propose patches, identify files, write implementation notes, design tests, and review risks. You must not apply patches, mutate the repository, run commands, or start autonomous execution unless the human maintainer explicitly changes the executionAutomation policy and promotion gates permit it.

The mission is to restore bounded, deterministic, observable execution correctness so Pi can be promoted from `manual_1` to `stable_6` safely.

## Hard Requirements

1. Do not run autonomous execution for P26.
2. Do not use the broken executor to repair itself.
3. Do not mutate repo unless explicitly allowed by a human and by the contract.
4. Do not run commands unless explicitly allowed by a human and by the contract.
5. Do not enable continuous scheduling until promotion gates pass.
6. Do not claim `stable_6` until `stable_3_dogfood_passed` and `stable_6_stress_passed` are recorded.
7. Every patch must be human-reviewed before application.
8. Every patch must include rollback notes.
9. Every patch must have targeted validation.
10. Every indefinite wait must become bounded by timeout, abort, fail-fast, quarantine, retry, or explicit blocked state.
11. No LLM provider call may run without request timeout and stream idle watchdog.
12. No validation command may run without timeout, process group, kill-tree, output cap, closed stdin, CI env, and no-watch guard.
13. No git repo-wide mutation may bypass GitRunner/repo-wide lock.
14. No JSON state write may run outside transaction/write queue protection.
15. `git push`, raw destructive cleanup, secrets access, and watch-mode validation remain forbidden.

## Execution Policies

```yaml
repair_modes:
  manual_1:
    description: Human applies one patch at a time.
    autonomous_execution_allowed: false
    agent_may_mutate_repo: false
    agent_may_run_commands: false
  stable_1:
    description: One autonomous workspace allowed after executor isolation and abort gates pass.
    autonomous_execution_allowed: true
    required_gates: [executor_isolation_passed, abort_signal_chain_passed]
  stable_3:
    description: Three autonomous workspaces allowed after validation, git, state, and crash recovery gates pass.
    autonomous_execution_allowed: true
    required_gates: [validation_hang_kill_passed, git_serialization_stress_passed, state_store_concurrency_passed, crash_recovery_passed]
  stable_6:
    description: Six autonomous workspaces allowed after dogfood and stress gates pass.
    autonomous_execution_allowed: true
    required_gates: [stable_3_dogfood_passed, stable_6_stress_passed]

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
```

## Safety Stops

Hard stop immediately if any of the following occur:

* autonomous execution is requested during repair mode;
* a patch attempts to re-enable continuous scheduling before promotion;
* a patch permits repo mutation by the agent during manual repair;
* LLM runtime lacks provider request timeout or stream idle watchdog;
* validation runner lacks timeout, process group, kill-tree, or no-watch guard;
* git lock bypass exists or is introduced;
* state write serialization is missing;
* a repair workspace lacks rollback, targeted validation, or human approval;
* stable_6 is claimed before dogfood/stress evidence exists;
* forbidden commands/files are used.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "3.0.0",
  "executionClass": "repair",
  "executionBackend": "postgres",
  "project": {
    "name": "Pi",
    "rootPath": "/home/erfolg/src/pi",
    "type": "repo",
    "tags": [
      "execution-correctness",
      "repair",
      "p26"
    ]
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
    "reason": "P26 repairs the execution substrate itself. The broken autonomous executor must not be used to repair itself."
  },
  "knownBrokenSubsystems": [
    {
      "id": "executor_singleton_race",
      "severity": "critical",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": [
        "stable_1",
        "stable_3",
        "stable_6"
      ]
    },
    {
      "id": "abort_signal_not_wired",
      "severity": "critical",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": [
        "stable_1",
        "stable_3",
        "stable_6"
      ]
    },
    {
      "id": "worktree_mutex_bypass",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": [
        "stable_3",
        "stable_6"
      ]
    },
    {
      "id": "validation_process_hang",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": [
        "stable_3",
        "stable_6"
      ]
    },
    {
      "id": "json_state_store_concurrent_writes",
      "severity": "high",
      "autonomousExecutionBlocked": true,
      "mustFixBefore": [
        "stable_3",
        "stable_6"
      ]
    },
    {
      "id": "plan_design_can_accidentally_serialize_or_saturate_validation",
      "severity": "medium",
      "autonomousExecutionBlocked": false,
      "mustFixBefore": [
        "stable_6"
      ]
    }
  ],
  "planExecution": {
    "phase": "P26",
    "title": "Execution Correctness Recovery",
    "mode": "manual_repair",
    "maxParallelWorkspaces": 1,
    "scheduling": {
      "continuous": false,
      "slotCount": 1,
      "priorityStrategy": "manual_order",
      "schedulerRuntimeUse": "disabled_until_promotion"
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
      "heavy": {
        "maxConcurrent": 1
      },
      "targeted": {
        "maxConcurrent": 3
      }
    }
  },
  "promotionGates": {
    "initialMode": "manual_1",
    "targetMode": "stable_6",
    "gates": [
      {
        "id": "executor_isolation_passed",
        "requiredFor": [
          "stable_1",
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "abort_signal_chain_passed",
        "requiredFor": [
          "stable_1",
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "validation_hang_kill_passed",
        "requiredFor": [
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "git_serialization_stress_passed",
        "requiredFor": [
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "state_store_concurrency_passed",
        "requiredFor": [
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "crash_recovery_passed",
        "requiredFor": [
          "stable_3",
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "stable_3_dogfood_passed",
        "requiredFor": [
          "stable_6"
        ],
        "status": "pending"
      },
      {
        "id": "stable_6_stress_passed",
        "requiredFor": [
          "stable_6"
        ],
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
      "npm run dev",
      "vite --host"
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
      "ready": false,
      "blockedReasons": [
        "repair_mode_autonomous_execution_disabled",
        "promotion_gates_pending"
      ],
      "warnings": [
        "P26 is manual_1 until promotion gates pass."
      ],
      "prerequisites": [
        {
          "key": "executor_isolation",
          "required": true,
          "met": false,
          "message": "Required before stable_1."
        },
        {
          "key": "abort_signal_chain",
          "required": true,
          "met": false,
          "message": "Required before stable_1."
        },
        {
          "key": "managed_validation_runner",
          "required": true,
          "met": false,
          "message": "Required before stable_3."
        },
        {
          "key": "git_serialization",
          "required": true,
          "met": false,
          "message": "Required before stable_3."
        },
        {
          "key": "state_store_serialization",
          "required": true,
          "met": false,
          "message": "Required before stable_3."
        },
        {
          "key": "stable_6_stress",
          "required": true,
          "met": false,
          "message": "Required before stable_6."
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 1,
    "expectedSafeEffectiveParallelismMin": 1,
    "dagEffectiveParallelism": 4,
    "safeEffectiveParallelism": 1,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "manual_repair_sequence",
    "safeBatchingStrategy": "manual_1_one_patch_at_a_time",
    "batchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P26.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P26.B",
            "P26.E",
            "P26.G",
            "P26.H"
          ],
          "effectiveParallelism": 4
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P26.C",
            "P26.F",
            "P26.I"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P26.D",
            "P26.J",
            "P26.K"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P26.L",
            "P26.M"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 6,
          "workspaceIds": [
            "P26.N"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 2.33,
      "criticalPath": [
        "P26.A",
        "P26.B",
        "P26.C",
        "P26.D",
        "P26.J",
        "P26.N"
      ],
      "criticalPathLength": 6,
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "P26.A"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P26.B"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P26.C"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P26.D"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P26.E"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 6,
          "workspaceIds": [
            "P26.F"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 7,
          "workspaceIds": [
            "P26.G"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 8,
          "workspaceIds": [
            "P26.H"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 9,
          "workspaceIds": [
            "P26.I"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 10,
          "workspaceIds": [
            "P26.J"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 11,
          "workspaceIds": [
            "P26.K"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 12,
          "workspaceIds": [
            "P26.L"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 13,
          "workspaceIds": [
            "P26.M"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        },
        {
          "batch": 14,
          "workspaceIds": [
            "P26.N"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "manual_1 repair mode requires one patch at a time"
          ]
        }
      ],
      "overallSafeEffectiveParallelism": 1,
      "bottlenecks": [
        "repair_mode_blocks_autonomous_parallelism",
        "promotion_gates_pending",
        "validation_lock_limits_parallelism"
      ],
      "blockedParallelismReasons": [
        "P26 intentionally disables autonomous scheduling until promotion gates pass."
      ]
    },
    "optimizationReview": {
      "originalGraphHash": null,
      "proposedGraphHash": null,
      "approvedGraphHash": null,
      "originalDagEffectiveParallelism": 4,
      "proposedDagEffectiveParallelism": 4,
      "originalSafeEffectiveParallelism": 1,
      "proposedSafeEffectiveParallelism": 1,
      "criticalPathDelta": 0,
      "serializedTailDelta": 0,
      "suggestions": [],
      "approvalState": "pending"
    },
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelism.conflictScope",
      "workspaces[].integration.queuePriority",
      "workspaces[].validation.targetCommand"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "safe_parallelism_below_dag_parallelism",
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "repair_mode_autonomous_execution_disabled",
      "promotion_gate_failed_or_missing"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "safe_batch_preview",
      "critical_path",
      "scale_mode_readiness",
      "approved_dependency_patch",
      "approved_graph_hash",
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
      "state_write_serialization_evidence",
      "worktree_state",
      "lease_heartbeat_snapshots",
      "lease_reconciliation_log",
      "empirical_write_set",
      "write_set_drift_report",
      "validation_lane_saturation_log"
    ]
  },
  "workspaces": [
    {
      "id": "P26.A",
      "title": "Repair-mode lockdown and promotion guard",
      "dependencies": [],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/cli/plan-commands.ts",
          "packages/coding-agent/src/core/worker-concurrency.ts",
          "packages/coding-agent/src/core/safety-doctor.ts",
          "packages/coding-agent/src/core/plan-parser.ts",
          "docs/llm-implementation-agent-master-template.md"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- plan-doctor worker-concurrency"
      },
      "allowedFiles": [
        "packages/coding-agent/src/cli/plan-commands.ts",
        "packages/coding-agent/src/core/worker-concurrency.ts",
        "packages/coding-agent/src/core/safety-doctor.ts",
        "packages/coding-agent/src/core/plan-parser.ts",
        "docs/llm-implementation-agent-master-template.md"
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
      ],
      "acceptanceCriteria": [
        "Repair plans with executionAutomation.autonomousExecutionEnabled=false cannot be launched with autonomous execution commands.",
        "experimental_6/stable_6 cannot be selected while required promotion gates are pending.",
        "Doctor emits hard stops for autonomous_execution_requested_during_repair_mode and promotion_gate_failed_or_missing.",
        "Existing stable_1/stable_3 non-repair behavior remains backward compatible."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- plan-doctor worker-concurrency",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-commands.ts",
          "packages/coding-agent/src/core/worker-concurrency.ts",
          "packages/coding-agent/src/core/safety-doctor.ts",
          "packages/coding-agent/src/core/plan-parser.ts",
          "docs/llm-implementation-agent-master-template.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.B",
      "title": "Per-workspace executor isolation",
      "dependencies": [
        "P26.A"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts",
          "packages/coding-agent/test/autonomous-executor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- workspace-agent-executor autonomous-executor"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/test/workspace-agent-executor.test.ts",
        "packages/coding-agent/test/autonomous-executor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "AutonomousExecutor no longer stores a reusable singleton WorkspaceAgentExecutor for concurrent workspace execution.",
        "Each executeWorkspace call creates or obtains a workspace-scoped executor instance.",
        "activeAgentExecutors tracks workspaceId -> executor for stop/artifact handling.",
        "Concurrent fake workspaces cannot overwrite each other's executor instance identity."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- workspace-agent-executor autonomous-executor",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts",
          "packages/coding-agent/test/autonomous-executor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.C",
      "title": "WorkspaceExecutionContext refactor",
      "dependencies": [
        "P26.B"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- workspace-agent-executor"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/test/workspace-agent-executor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "abortController, timeoutHandle, llmIdleHandle, lastLLMEventTime, worktreeExecutor, and logPath are not shared mutable execution fields.",
        "executeInWorktree and executeAgentInPlace receive an execution context or equivalent immutable execution-local structure.",
        "setLogPath is removed from concurrent execution path or made non-mutating and execution-local.",
        "Timer isolation tests prove workspace A completion cannot clear workspace B watchdogs."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- workspace-agent-executor",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.D",
      "title": "Abort, pause, stop, and force-kill correctness",
      "dependencies": [
        "P26.B",
        "P26.C"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/continuous-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/cli/plan-commands.ts",
          "packages/coding-agent/src/utils/shell.ts",
          "packages/coding-agent/test/continuous-executor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- continuous-executor abort stop"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/continuous-executor.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/src/cli/plan-commands.ts",
        "packages/coding-agent/src/utils/shell.ts",
        "packages/coding-agent/test/continuous-executor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "plan-commands no longer ignores the AbortSignal passed by ContinuousExecutor.",
        "executeWorkspace accepts a signal and promptly aborts workspace-local work when signal fires.",
        "stopAllActiveWorkspaces aborts all active workspace executors, not just the latest one.",
        "Abort integration test verifies no workspace remains active and no tracked detached children remain after stop."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- continuous-executor abort stop",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/continuous-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/cli/plan-commands.ts",
          "packages/coding-agent/src/utils/shell.ts",
          "packages/coding-agent/test/continuous-executor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.E",
      "title": "Strict GitRunner serialization and worktree lock hardening",
      "dependencies": [
        "P26.A"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/git-runner.ts",
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/test/worktree-workspace-executor.test.ts",
          "packages/coding-agent/test/git-runner.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- git-runner worktree-workspace-executor"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/git-runner.ts",
        "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
        "packages/coding-agent/test/worktree-workspace-executor.test.ts",
        "packages/coding-agent/test/git-runner.test.ts"
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
      ],
      "acceptanceCriteria": [
        "The 5-second mutex auto-release/bypass behavior is removed.",
        "Branch lock acquisition throws if lock cannot be acquired; it never proceeds unlocked.",
        "git worktree prune, branch creation/reset, worktree add/remove run inside serialized repo-wide mutation scope.",
        "Cross-process or simulated concurrent worktree creation no longer produces git ref lock errors."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- git-runner worktree-workspace-executor",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/git-runner.ts",
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/test/worktree-workspace-executor.test.ts",
          "packages/coding-agent/test/git-runner.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.F",
      "title": "Attempt-scoped worktrees, branches, logs, and artifacts",
      "dependencies": [
        "P26.E"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/worktree/worktree-types.ts",
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/test/worktree-workspace-executor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- worktree attempt recovery"
      },
      "allowedFiles": [
        "packages/coding-agent/src/worktree/worktree-types.ts",
        "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/core/state-store.ts",
        "packages/coding-agent/src/core/json-state-store.ts",
        "packages/coding-agent/test/worktree-workspace-executor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Branch names include planExecutionId, workspaceId, and attemptId/attemptNo unique suffix.",
        "Worktree paths include attempt identity and never blindly reuse stale workspace root path.",
        "Diff/log/report artifact paths include attempt identity.",
        "Recovery can mark old attempt abandoned/recovered and start a fresh attempt without path collision."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- worktree attempt recovery",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/worktree/worktree-types.ts",
          "packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/test/worktree-workspace-executor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.G",
      "title": "StateStore serialization, atomic writes, and journal integrity",
      "dependencies": [
        "P26.A"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/database-state-store.ts",
          "packages/coding-agent/test/json-state-store.test.ts",
          "packages/coding-agent/test/state-store-concurrency.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- json-state-store state-store-concurrency"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/state-store.ts",
        "packages/coding-agent/src/core/json-state-store.ts",
        "packages/coding-agent/src/core/plan-state.ts",
        "packages/coding-agent/src/core/database-state-store.ts",
        "packages/coding-agent/test/json-state-store.test.ts",
        "packages/coding-agent/test/state-store-concurrency.test.ts"
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
      ],
      "acceptanceCriteria": [
        "JsonStateStore serializes all mutating writes through a write queue or equivalent lock.",
        "plan-state snapshots use temp file + atomic rename semantics.",
        "execution-journal.ndjson writes are line-atomic and recovery-tolerant.",
        "Stress test with at least 1000 concurrent journal/status/log writes produces valid parseable output with no lost events."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- json-state-store state-store-concurrency",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/database-state-store.ts",
          "packages/coding-agent/test/json-state-store.test.ts",
          "packages/coding-agent/test/state-store-concurrency.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.H",
      "title": "Managed validation runner and process lifecycle containment",
      "dependencies": [
        "P26.A"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/validation-runner.ts",
          "packages/coding-agent/src/extensions/tools/bash.ts",
          "packages/coding-agent/src/utils/shell.ts",
          "packages/coding-agent/test/validation-runner.test.ts",
          "packages/coding-agent/test/bash-tool.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- validation-runner bash-tool"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/validation-runner.ts",
        "packages/coding-agent/src/extensions/tools/bash.ts",
        "packages/coding-agent/src/utils/shell.ts",
        "packages/coding-agent/test/validation-runner.test.ts",
        "packages/coding-agent/test/bash-tool.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Validation commands run with deadline, closed stdin, CI env, output cap, and managed process group.",
        "Watch/dev-server commands are classified and blocked before execution.",
        "Timeout escalates SIGTERM to SIGKILL and records killed child PIDs.",
        "A deliberately hanging validation command exits as timed_out/killed and does not leave child processes."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- validation-runner bash-tool",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/validation-runner.ts",
          "packages/coding-agent/src/extensions/tools/bash.ts",
          "packages/coding-agent/src/utils/shell.ts",
          "packages/coding-agent/test/validation-runner.test.ts",
          "packages/coding-agent/test/bash-tool.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.I",
      "title": "Validation lane backpressure and scheduler feedback",
      "dependencies": [
        "P26.H"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/validation-lane.ts",
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/core/execution-simulator.ts",
          "packages/coding-agent/test/workspace-scheduler.test.ts",
          "packages/coding-agent/test/validation-lane.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- validation-lane workspace-scheduler"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/validation-lane.ts",
        "packages/coding-agent/src/core/workspace-scheduler.ts",
        "packages/coding-agent/src/core/execution-simulator.ts",
        "packages/coding-agent/test/workspace-scheduler.test.ts",
        "packages/coding-agent/test/validation-lane.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Heavy validation lane permits max 1 concurrent heavy validation by default.",
        "Targeted validation lane permits max 3 concurrent targeted validations by default.",
        "Scheduler defers heavy-validation workspaces when the heavy lane is saturated.",
        "Doctor/dashboard can explain validation_lane_saturated_blocking_scheduler."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- validation-lane workspace-scheduler",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/validation-lane.ts",
          "packages/coding-agent/src/core/workspace-scheduler.ts",
          "packages/coding-agent/src/core/execution-simulator.ts",
          "packages/coding-agent/test/workspace-scheduler.test.ts",
          "packages/coding-agent/test/validation-lane.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.J",
      "title": "Bounded LLM provider runtime and idle watchdog correctness",
      "dependencies": [
        "P26.C",
        "P26.D"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.K",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/core/sdk.ts",
          "packages/coding-agent/src/core/agent-session.ts",
          "packages/coding-agent/test/llm-runtime.test.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- llm-runtime workspace-agent-executor"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/src/core/sdk.ts",
        "packages/coding-agent/src/core/agent-session.ts",
        "packages/coding-agent/test/llm-runtime.test.ts",
        "packages/coding-agent/test/workspace-agent-executor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Every provider call has a request deadline.",
        "Every streaming session has a workspace-local idle watchdog.",
        "Provider timeout or stream idle timeout fails only the affected workspace and records a retryable failure reason.",
        "Circuit breaker opens after configured consecutive provider timeouts and does not fail the whole plan unless configured."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- llm-runtime workspace-agent-executor",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/core/sdk.ts",
          "packages/coding-agent/src/core/agent-session.ts",
          "packages/coding-agent/test/llm-runtime.test.ts",
          "packages/coding-agent/test/workspace-agent-executor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.K",
      "title": "Lease monitor, heartbeat, quarantine, and requeue",
      "dependencies": [
        "P26.E",
        "P26.F"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.L",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/worktree/lease-monitor.ts",
          "packages/coding-agent/src/worktree/worktree-manager.ts",
          "packages/coding-agent/src/worktree/worktree-types.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/test/lease-monitor.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- lease-monitor worktree-manager"
      },
      "allowedFiles": [
        "packages/coding-agent/src/worktree/lease-monitor.ts",
        "packages/coding-agent/src/worktree/worktree-manager.ts",
        "packages/coding-agent/src/worktree/worktree-types.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/test/lease-monitor.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Active leases write heartbeat files on the configured interval.",
        "Stale lease detection checks heartbeat age and PID liveness.",
        "Lease/worktree-state disagreement quarantines the worktree and requeues the workspace when safe.",
        "Quarantine artifact includes lease snapshot, worktree state, and recovery decision."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- lease-monitor worktree-manager",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/worktree/lease-monitor.ts",
          "packages/coding-agent/src/worktree/worktree-manager.ts",
          "packages/coding-agent/src/worktree/worktree-types.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/test/lease-monitor.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.L",
      "title": "Integration queue correctness, merge priority, and writeSet drift gate",
      "dependencies": [
        "P26.F",
        "P26.G",
        "P26.I"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.M",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/integration-queue.ts",
          "packages/coding-agent/src/core/auto-commit.ts",
          "packages/coding-agent/src/core/completion-gate.ts",
          "packages/coding-agent/src/core/git-runner.ts",
          "packages/coding-agent/test/integration-queue.test.ts",
          "packages/coding-agent/test/completion-gate.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- integration-queue completion-gate"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/integration-queue.ts",
        "packages/coding-agent/src/core/auto-commit.ts",
        "packages/coding-agent/src/core/completion-gate.ts",
        "packages/coding-agent/src/core/git-runner.ts",
        "packages/coding-agent/test/integration-queue.test.ts",
        "packages/coding-agent/test/completion-gate.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Only the integration queue mutates the integration/main branch; workers do not merge directly.",
        "Merge priority is recomputed on each dequeue and respects safety gates before priority.",
        "Empirical git diff --name-only writeSet is compared with declared conflictScope after workspace completion.",
        "Merge conflict or unresolved block-mode drift produces handoff artifact and does not mark plan complete."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- integration-queue completion-gate",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/integration-queue.ts",
          "packages/coding-agent/src/core/auto-commit.ts",
          "packages/coding-agent/src/core/completion-gate.ts",
          "packages/coding-agent/src/core/git-runner.ts",
          "packages/coding-agent/test/integration-queue.test.ts",
          "packages/coding-agent/test/completion-gate.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.M",
      "title": "Plan-intake anti-stall analysis and optimizer hardening",
      "dependencies": [
        "P26.G"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.N"
        ],
        "conflictScope": [
          "packages/coding-agent/src/core/plan-parser.ts",
          "packages/coding-agent/src/core/execution-simulator.ts",
          "packages/coding-agent/src/core/safety-doctor.ts",
          "packages/coding-agent/src/core/parallelism-review.ts",
          "packages/coding-agent/test/plan-intake.test.ts",
          "packages/coding-agent/test/execution-simulator.test.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- plan-intake execution-simulator safety-doctor"
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/plan-parser.ts",
        "packages/coding-agent/src/core/execution-simulator.ts",
        "packages/coding-agent/src/core/safety-doctor.ts",
        "packages/coding-agent/src/core/parallelism-review.ts",
        "packages/coding-agent/test/plan-intake.test.ts",
        "packages/coding-agent/test/execution-simulator.test.ts"
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
      ],
      "acceptanceCriteria": [
        "Doctor distinguishes DAG effective parallelism from safe effective parallelism.",
        "Plan-intake flags fully serialized graphs, long serialized tails, broad conflict scopes, and validation lane bottlenecks.",
        "Optimizer proposals remain advisory_until_approved and cannot alter forbidden safety fields.",
        "Repair-mode plans are blocked from autonomous execution by validation before scheduling."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- plan-intake execution-simulator safety-doctor",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/plan-parser.ts",
          "packages/coding-agent/src/core/execution-simulator.ts",
          "packages/coding-agent/src/core/safety-doctor.ts",
          "packages/coding-agent/src/core/parallelism-review.ts",
          "packages/coding-agent/test/plan-intake.test.ts",
          "packages/coding-agent/test/execution-simulator.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P26.N",
      "title": "Promotion gates, dogfood matrix, stress tests, and observability",
      "dependencies": [
        "P26.B",
        "P26.C",
        "P26.D",
        "P26.E",
        "P26.F",
        "P26.G",
        "P26.H",
        "P26.I",
        "P26.J",
        "P26.K",
        "P26.L",
        "P26.M"
      ],
      "parallelGroup": "manual_repair_sequence",
      "dependencyReason": "Repair-mode dependency order is manual and safety-driven; dependencies identify the minimum prerequisite fixes needed before this patch is reviewed or applied.",
      "manualApplicationRequired": true,
      "humanApprovalRequired": true,
      "autonomousExecutionAllowed": false,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": true,
        "reviewer": "human maintainer"
      },
      "parallelism": {
        "expectedBatch": "manual_1",
        "canRunWith": [],
        "cannotRunWith": [
          "P26.A",
          "P26.B",
          "P26.C",
          "P26.D",
          "P26.E",
          "P26.F",
          "P26.G",
          "P26.H",
          "P26.I",
          "P26.J",
          "P26.K",
          "P26.L",
          "P26.M"
        ],
        "conflictScope": [
          "packages/coding-agent/test/execution-correctness-stress.test.ts",
          "packages/coding-agent/test/crash-recovery.test.ts",
          "packages/coding-agent/test/stable-6-dogfood.test.ts",
          "packages/coding-agent/src/core/scale-readiness-doctor.ts",
          "packages/coding-agent/src/dashboard/**",
          "docs/p26-execution-correctness-recovery.md"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "P26 is a repair-mode phase. Even independent workspaces are applied one patch at a time until promotion gates allow automation."
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
        "queueOptimizationNotes": "Repair patches that unblock promotion gates have higher queue priority; priority never bypasses validation or human review."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "targetCommand": "pnpm --filter coding-agent test -- execution-correctness-stress crash-recovery stable-6-dogfood scale-readiness"
      },
      "allowedFiles": [
        "packages/coding-agent/test/execution-correctness-stress.test.ts",
        "packages/coding-agent/test/crash-recovery.test.ts",
        "packages/coding-agent/test/stable-6-dogfood.test.ts",
        "packages/coding-agent/src/core/scale-readiness-doctor.ts",
        "packages/coding-agent/src/dashboard/**",
        "docs/p26-execution-correctness-recovery.md"
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
      ],
      "acceptanceCriteria": [
        "Promotion gate records exist for executor isolation, abort chain, validation hang kill, git serialization, state store concurrency, crash recovery, stable_3 dogfood, and stable_6 stress.",
        "Dashboard/doctor show workspaceId, attemptId, executorId, worktreePath, branchName, active timers, abort status, validation lane state, and blocked reason.",
        "stable_3 dogfood passes before stable_6 is permitted.",
        "stable_6 stress covers 6-slot execution, abort, LLM idle timeout, validation hang kill, git worktree contention, state concurrency, and crash recovery."
      ],
      "targetCommand": "pnpm --filter coding-agent test -- execution-correctness-stress crash-recovery stable-6-dogfood scale-readiness",
      "roleBudget": "worker",
      "maxRetries": 0,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/execution-correctness-stress.test.ts",
          "packages/coding-agent/test/crash-recovery.test.ts",
          "packages/coding-agent/test/stable-6-dogfood.test.ts",
          "packages/coding-agent/src/core/scale-readiness-doctor.ts",
          "packages/coding-agent/src/dashboard/**",
          "docs/p26-execution-correctness-recovery.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/*.p12",
          "**/*.pfx",
          "**/id_rsa",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "pnpm --filter coding-agent test -- <targeted-test>",
          "pnpm --filter coding-agent typecheck"
        ],
        "cannotRun": [
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
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "patch_proposed",
          "human_reviewed",
          "manual_apply_recorded",
          "targeted_validation_completed",
          "repair_checkpoint_created"
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
  "contractVersion": "3.0.0",
  "phase": "P26",
  "title": "Execution Correctness Recovery",
  "executionClass": "repair",
  "executionAutomation": "disabled",
  "selectedRepairMode": "manual_1",
  "targetPromotionMode": "stable_6",
  "autonomousExecutionAllowed": false,
  "agentMayMutateRepo": false,
  "schedulerRuntimeUse": "disabled_until_promotion",
  "primaryGoal": "Repair the Pi execution substrate so autonomous execution can be safely promoted from manual_1 to stable_6.",
  "projectName": "Pi",
  "stateBackend": "postgres",
  "selectedScaleMode": "stable_3",
  "maxParallelWorkspaces": 1,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "critical_path_first",
  "continuousScheduling": false,
  "continuousSlotCount": 1,
  "safeEffectiveParallelismTarget": 1,
  "notInScope": [
    "New product features",
    "remote execution",
    "scale_8 promotion",
    "automatic repair execution",
    "git push",
    "destructive cleanup"
  ],
  "hardStops": [
    "autonomous_execution_requested_during_repair_mode",
    "promotion_gate_failed_or_missing",
    "validation_command_without_timeout",
    "git_lock_bypass_detected",
    "state_store_write_without_serialization"
  ],
  "completionGate": "P26 is complete only when all repair workspaces are manually applied, targeted validation passes, and all promotion gates through stable_6 are passed.",
  "nextPhase": "P27 or stable_6 dogfood expansion"
}
```

---

# Annex A — Promotion Gate Matrix

| Gate | Required for | Evidence |
|---|---|---|
| `executor_isolation_passed` | stable_1, stable_3, stable_6 | Concurrent fake workspaces prove no shared abort/log/timer/worktree state. |
| `abort_signal_chain_passed` | stable_1, stable_3, stable_6 | Stop/pause aborts all in-flight workspace sessions and child processes. |
| `validation_hang_kill_passed` | stable_3, stable_6 | Deliberately hanging validation command is killed with no orphan process. |
| `git_serialization_stress_passed` | stable_3, stable_6 | Concurrent worktree/branch creation produces no git ref lock corruption. |
| `state_store_concurrency_passed` | stable_3, stable_6 | 1000+ concurrent writes produce valid state and journal. |
| `crash_recovery_passed` | stable_3, stable_6 | Active workspace crash is recovered via abandoned/recovered attempt and fresh attempt. |
| `stable_3_dogfood_passed` | stable_6 | Real 3-slot dogfood completes with clean queue and correct artifacts. |
| `stable_6_stress_passed` | stable_6 | 6-slot stress covers abort, LLM timeout, validation hang, git contention, state concurrency, and crash recovery. |

---

# Annex B — No Indefinite Wait Policy

Every runtime wait must be bounded:

| Wait class | Bound | Result on expiry |
|---|---:|---|
| LLM provider request | 120s | workspace provider_timeout |
| LLM stream idle | 300s | workspace stream_idle_timeout + retry/fail |
| Workspace overall execution | 1800s | workspace timeout + abort |
| Targeted validation | 600s | validation timed_out + process tree kill |
| Heavy validation | 1200s | validation timed_out + process tree kill |
| Git repo mutation lock | 60s | fail_fast_and_retry_or_handoff |
| Scheduler no progress | 300s | emit blocked reason |
| State write | backend-specific bounded retry | fail plan or quarantine state write artifact |

---

# Annex C — P26 Manual Patch Checklist

For every workspace:

* [ ] Patch proposal is scoped to allowed files.
* [ ] Human reviewer approved the patch.
* [ ] Rollback notes are included.
* [ ] Patch is manually applied.
* [ ] Targeted validation command is run through a bounded runner or manually with equivalent timeout discipline.
* [ ] Validation output is saved.
* [ ] Repair checkpoint is recorded.
* [ ] Promotion gates impacted by this workspace are updated.
* [ ] No autonomous execution was used.

---

# Annex D — Explicit Non-Goals

* Do not implement new user-facing product features.
* Do not attempt scale_8.
* Do not run P26 through `pi plan run`.
* Do not rely on the broken executor for repair.
* Do not merge without validation.
* Do not skip dogfood because unit tests pass.
* Do not treat provider timeout, validation timeout, or git lock timeout as impossible.


# LLM Implementation Agent — P12.6 Final Validation Gate & Validation-Triggered Remediation

**Template Format:** Master Template v2.5.0  
**Plan Version:** 1.0.0  
**Last Updated:** 2026-05-19  
**Phase:** P12.6  
**Title:** Final Validation Gate & Validation-Triggered Remediation  
**Purpose:** Redesign Pi's validation lifecycle so implementation workers do not run tests, final validation runs once on the integrated tree, validation failures trigger bounded LLM remediation, and cleanup remains read-only.

---

## Overview

P12.6 changes Pi's execution model from workspace-level validation to a final-only validation lifecycle.

The current v2.5 execution model uses continuous, batchless scheduling with multiple worktree slots filled immediately. That model is good for parallel implementation, but it makes per-workspace validation dangerous: multiple workers can start heavy `vitest`, `npm test`, build, or typecheck commands at the same time. Even with a global validation lock, some commands may bypass the lock through worktree execution paths, custom tools, direct process spawns, or remediation/cleanup paths.

P12.6 preserves parallel implementation but moves validation to a deterministic post-plan gate.

```text
Implementation workers write.
Final Validation proves.
Remediation repairs.
Cleanup explains.
```

The new lifecycle:

```text
Plan uploaded
  -> Plan intake / DAG optimization / approval
  -> Parallel implementation workers
  -> Integration queue merges worktree outputs
  -> Final Validation Gate tests the integrated tree
  -> If validation fails: validation-triggered remediation runs, then validation retries
  -> If validation passes: cleanup review summarizes the final result
  -> Handoff / complete
```

This plan is written in the Master Template v2.5.0 format, but it intentionally introduces the P12.6 work needed to evolve the template and runtime toward a v2.6.0 final-validation lifecycle.

---

## What Changes in P12.6

P12.6 introduces:

- **Final-only validation mode**: implementation workers do not run tests, builds, typecheck, dev servers, or `targetCommand`.
- **Target command semantic change**: workspace `targetCommand` becomes a final validation input, not a worker command.
- **Deterministic Final Validation Gate**: a non-LLM runner collects, normalizes, deduplicates, and runs validation commands sequentially on the integrated tree.
- **Validation-triggered remediation**: failed final validation can trigger bounded LLM remediation through the existing remediation runtime.
- **Read-only cleanup review**: cleanup reads reports, diffs, validation artifacts, and remediation attempts, then summarizes. It does not execute commands or mutate files.
- **Dashboard validation UX**: the dashboard shows final validation, remediation attempts, command logs, failure status, and rerun controls.
- **Master Template v2.6 update**: the canonical template is updated so future plans do not reintroduce workspace-level validation.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

| Field | Value |
|---|---|
| Phase | `P12.6` |
| One-line goal | Move tests from parallel implementation workers to a deterministic final validation gate, with bounded LLM remediation on validation failures. |
| Why now | Continuous scheduling and worktree parallelism make per-workspace validation expensive, unreliable, and prone to duplicate Vitest/RAM exhaustion. |
| Blast radius | Coding agent execution lifecycle, validation planner, bash command policy, plan runner, remediation runtime, cleanup review, dashboard, master template, plan schema, tests, and reports. |
| Rollback path | Disable final-only validation, restore legacy per-workspace validation, keep worker cap at stable_3, and use existing cleanup review behavior. |
| Scale mode | `experimental_6` |
| Safe parallelism target | 4-6 implementation workers; 1 validation runner |
| Done when | Implementation workers no longer run tests; final validation runs sequentially after integration; remediation handles failed validation; dashboard exposes all validation states; dogfood confirms no parallel Vitest explosion. |

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P12.6` |
| Title | `Final Validation Gate & Validation-Triggered Remediation` |
| Status | `Planned` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local / Dogfood` |
| Primary focus | `Validation lifecycle correctness, resource safety, remediation integration, dashboard visibility` |
| Product-code changes | `Allowed` |
| Selected scale mode | `experimental_6` |
| Requested max workers | `6` |
| Expected DAG effective parallelism | `4-6` |
| Expected safe effective parallelism | `4-6 implementation workers; 1 final validation runner` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| P12.6.A — Master Template v2.6 Contract Update | Coding Agent | Human operator | Dashboard / Runtime | Future plan authors |
| P12.6.B — Validation Schema and Policy Model | Coding Agent | Human operator | Runtime / Doctor | Dashboard |
| P12.6.C — Remove Worker-Level Validation Execution | Coding Agent | Human operator | Runtime | Dashboard |
| P12.6.D — Worker Command Guard | Coding Agent | Human operator | Safety / Tools | Dashboard |
| P12.6.E — FinalValidationRunner | Coding Agent | Human operator | Validation / Shell | Dashboard |
| P12.6.F — Plan-Runner Lifecycle Wiring | Coding Agent | Human operator | Web Server / State Store | Dashboard |
| P12.6.G — Validation-Triggered Remediation | Coding Agent | Human operator | Remediation Runtime | Dashboard |
| P12.6.H — Cleanup Review Read-Only Integration | Coding Agent | Human operator | Cleanup Review | Dashboard |
| P12.6.I — Persistence, Artifacts, and Journal Events | Coding Agent | Human operator | State Store / Archive | Dashboard |
| P12.6.J — Dashboard Final Validation UX | Coding Agent | Human operator | Web Server / UI | Users |
| P12.6.K — Rerun Controls | Coding Agent | Human operator | Web Server / UI | Users |
| P12.6.L1 — Unit and Regression Tests | Coding Agent | Human operator | QA / Runtime | Future maintainers |
| P12.6.L2 — Dogfood, Migration Docs, and Final Report | Coding Agent | Human operator | QA / Runtime | Future maintainers |

---

## 2. Purpose

P12.6 fixes the structural validation problem created by combining continuous parallel scheduling with per-workspace test execution. In the current model, each implementation worker may run `targetCommand`, `vitest`, `npm test`, or targeted validation commands. When four to six workspaces run concurrently, these validation commands can overlap, exhaust memory, and leave orphan processes. Existing validation locks help but are not sufficient when commands bypass the standard bash tool or spawn child processes outside the lock.

This phase redesigns validation around a deterministic Final Validation Gate. Workers implement changes only. After all workspaces complete and worktree outputs are integrated, the Final Validation Gate runs validation commands sequentially with CI-safe environment defaults, timeout controls, command deduplication, watch-mode rejection, and per-command artifacts.

The phase keeps LLMs in the loop where they are valuable: repairing failed validation. If final validation fails, the remediation runtime receives a focused validation failure task containing the failed command, exit code, logs, changed files, and workspace reports. The LLM repair worker may edit files, but it does not decide pass/fail. The Final Validation Gate reruns the failed command and then the full final validation set.

Cleanup review remains read-only. It explains what happened, summarizes implementation results, reads final validation and remediation artifacts, and produces a human-readable summary. It must not run commands, edit files, or override validation results.

---

## 3. What Carried Over — Must Stay Stable

* [ ] Worktree isolation remains available and enabled for `experimental_6`.
* [ ] Integration queue remains enabled when required by scale mode.
* [ ] Global validation lock remains active as a safety net.
* [ ] Continuous scheduling remains enabled for implementation workspaces.
* [ ] Completion gate hardening remains active, but no longer treats worker-reported completion as target-command success.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] The executor remains the source of truth for state transitions.
* [ ] Dashboard controls request state changes but do not directly mutate execution state.
* [ ] Cleanup review remains read-only.

---

## 4. Background / What Was Wrong

The current execution model allows implementation workers to run validation commands as part of workspace completion. That behavior was acceptable at lower concurrency, but it becomes unreliable under v2.5 continuous scheduling. Since workspaces are started immediately as slots become available, several agents can attempt validation at the same time.

Known failure modes:

- Multiple `vitest` processes run concurrently and consume all available RAM.
- Workers may start validation through paths not protected by the standard validation lock.
- Worker-reported `VERDICT: COMPLETE` may be treated as proof that `targetCommand` passed.
- Cleanup comments imply test/review responsibility, but the actual cleanup worker is read-only and cannot reliably perform validation.
- Dashboard users cannot clearly distinguish "implementation complete" from "final tests passed."
- Retrying or stopping plans can leave orphan validation processes.
- Targeted validation can generate several commands from changed files, creating duplicate or overlapping test runs.

The correct split is:

```text
Implementation worker = writes code
Final Validation Gate = runs tests and proves correctness
Validation-triggered remediation = fixes failed tests
Cleanup review = explains final result
```

---

## 5. Current Failure State / Known Blockers

* `worker_level_validation` = `unsafe under continuous scheduling`
* `targetCommand_semantics` = `ambiguous; currently worker-command-like`
* `completion_gate_target_command_success` = `overtrusts agent verdict`
* `final_validation_runner` = `not implemented`
* `validation_artifacts` = `not implemented`
* `validation_remediation_trigger` = `not implemented`
* `dashboard_final_validation_panel` = `not implemented`
* `dashboard_validation_repair_panel` = `not implemented`
* `cleanup_validation_input` = `incomplete`
* `master_template_v2_6` = `not implemented`
* `worktree_isolation` = `enabled`
* `integration_queue` = `enabled`
* `scale_mode_readiness` = `ready but validation lifecycle unsafe`
* `safe_effective_parallelism` = `computed for implementation, not validation`

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Workers still run tests despite prompt changes | med | high | Enforce command guard in bash/tool layer; block test/build/dev commands in worker context. |
| Final validation fails late after many changes | med | med | Trigger focused remediation with failure logs; cap repair attempts; show artifacts in dashboard. |
| Final validation commands are incomplete | med | high | Collect from plan-level commands, workspace targetCommands, test-impact analyzer, and repo defaults. |
| Command normalization rewrites incorrectly | low | high | Unit-test normalization; reject unsafe watch/dev commands rather than guessing when uncertain. |
| Final validation runner hangs | med | high | Use timeout, kill process tree, max buffer, CI env, and orphan process cleanup. |
| Remediation loops indefinitely | low | high | Enforce `maxRepairAttempts`, default 2. |
| Cleanup tries to repair or run commands | low | high | Keep cleanup tools read-only; add hard stop for cleanup command/file mutation attempts. |
| Dashboard shows stale cleanup after rerun validation | med | med | Mark cleanup summary stale whenever final validation reruns. |
| Integration queue merges unvalidated implementation output | med | med | Treat integration as merge/conflict safety; final correctness validation happens after integration. |
| Existing plans depend on per-workspace validation | med | med | Provide legacy mode behind explicit config; default new template to final-only validation. |
| Worktree path escapes `.pi/worktrees` | low | critical | Path scope checks; stop execution on escape. |
| Merge conflict blocks plan | med | med | Generate conflict handoff artifact and stop queue safely. |
| Raw destructive cleanup requested | low | critical | Continue forbidding raw `rm -rf` and unsafe cleanup. |
| Watch-mode validation command appears | med | high | Reject or rewrite; never run watch/dev commands in autonomous validation. |

---

## 7. Workstreams

### P12.6.A — Master Template v2.6 Contract Update

**Goal:** Update the canonical master template so future plans use final-only validation semantics by default.

**Requirements:**
* Add v2.6.0 changelog section describing Final Validation Gate and validation-triggered remediation.
* Update overview, critical requirements, hard requirements, execution policies, safety stops, validation rules, persistence mapping, and Part 4 summary fields.
* Redefine `targetCommand` as final validation input, not a worker command.
* Replace workspace validation requirement language with final validation requirement language.
* Document cleanup review as read-only.

**Acceptance Criteria:**
* Master template documents the new mental model: workers write, final validation proves, remediation repairs, cleanup explains.
* Template examples use `contractVersion: "2.6.0"` for future plans.
* v2.5 compatibility notes remain clear.
* No section implies implementation workers should run `targetCommand`.

**Isolation & Parallelism Notes:**
* Can run early and independently.
* Touches docs/template files primarily.
* Does not require runtime changes to be complete before editing docs.

---

### P12.6.B — Validation Schema and Policy Model

**Goal:** Add schema/config support for final-only validation mode and validation-triggered remediation.

**Requirements:**
* Define validation mode values: `final_only`, `legacy_per_workspace`, and `off`.
* Add policy fields for worker validation, command sources, command dedupe, sequential execution, fail-fast behavior, timeout, max repair attempts, and artifact paths.
* Add workspace validation profile for `implementation_only_final_validation_deferred`.
* Add validation lifecycle state types and journal event types.
* Update doctor/schema validation rules for new semantics.

**Acceptance Criteria:**
* Plans can express final-only validation in Part 3 JSON.
* Existing v2.5 plans remain supported.
* Doctor warns or blocks invalid combinations.
* `targetCommand` is validated as final validation input when `mode = final_only`.

**Isolation & Parallelism Notes:**
* Can run in parallel with P12.6.A.
* Enables workstreams C, D, E, F, G, H, I, J, and dashboard.

---

### P12.6.C — Remove Worker-Level Validation Execution

**Goal:** Stop implementation workers from running tests, builds, typecheck, dev servers, or targetCommand.

**Requirements:**
* Update worker prompt generation so workers are told not to run validation commands.
* Remove any logic that marks target command success based on `VERDICT: COMPLETE`.
* Ensure workspace completion means "implementation complete," not "tests passed."
* Preserve worker ability to use small inspection commands when allowed.

**Acceptance Criteria:**
* Worker prompts explicitly defer validation to Final Validation Gate.
* `targetCommand` is not appended as a worker instruction.
* Completion gate no longer records target command success from worker verdict alone.
* Workspace reports distinguish implementation status from validation status.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B.
* Can run in parallel with P12.6.D and P12.6.E.
* Touches worker prompt/executor/completion-gate paths.

---

### P12.6.D — Worker Command Guard for Test/Build/Dev Commands

**Goal:** Enforce the worker-level validation ban in the tool layer, not only in prompts.

**Requirements:**
* Add command policy guard for worker context.
* Block `vitest`, `npm test`, `pnpm test`, `yarn test`, `npm run test`, `npm run build`, `npm run typecheck`, `tsc`, `vite`, `vite dev`, and `npm run dev` during implementation worker execution.
* Allow these commands only through the Final Validation Gate or explicit legacy validation context.
* Emit clear tool output explaining that validation is deferred to Final Validation Gate.
* Keep existing forbidden destructive commands intact.

**Acceptance Criteria:**
* Worker attempting `vitest` receives a blocked-command response.
* FinalValidationRunner can still run allowed validation commands.
* Unit tests cover command classification and context behavior.
* No false positives for harmless commands like `git diff`, `ls`, or `cat`.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B.
* Can run in parallel with P12.6.C and P12.6.E.
* Reduces risk while other lifecycle changes are implemented.

---

### P12.6.E — Implement FinalValidationRunner

**Goal:** Build the deterministic runner that collects, normalizes, deduplicates, and runs final validation commands sequentially.

**Requirements:**
* Collect commands from:
  1. `planExecution.validation.commands`
  2. `workspaces[].targetCommand`
  3. test impact analyzer output
  4. repo default command
* Normalize common commands:
  * `vitest` -> `vitest run`
  * add `CI=1` environment
  * reject watch/dev commands
* Deduplicate commands.
* Run commands sequentially; no `Promise.all`.
* Enforce timeout, max buffer, resource limits, validation lock, process-tree kill on timeout, and orphan cleanup.
* Write `final-validation.json`.
* Write per-command stdout/stderr logs.

**Acceptance Criteria:**
* Runner produces deterministic result artifacts.
* Runner can run with zero commands and report a clear skipped/failed policy result depending on config.
* Watch-mode commands are rejected or safely rewritten.
* Duplicate commands run once.
* Tests prove validation commands are never run in parallel.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B.
* Can run in parallel with P12.6.C and P12.6.D.
* Provides core capability for P12.6.F and P12.6.G.

---

### P12.6.F — Wire FinalValidationRunner into Plan-Runner Lifecycle

**Goal:** Insert final validation into the background plan execution lifecycle after all workspaces complete and after integration output is available.

**Requirements:**
* Add lifecycle state `validating` or `final_validating`.
* Trigger FinalValidationRunner after all workspaces complete.
* Ensure final validation runs after integration queue has produced the integrated tree.
* Prevent plan completion if final validation fails or is missing.
* Emit validation lifecycle journal events.
* Update plan markdown/status updates.
* Make failure path route to validation-triggered remediation when enabled.

**Acceptance Criteria:**
* Happy path: all workspaces complete -> final validation passes -> cleanup review runs -> plan completes/handoff.
* Failure path: final validation fails -> remediation or failed/handoff state.
* Plan cannot be marked complete without final validation pass.
* Dashboard polling can observe `validating` state.

**Isolation & Parallelism Notes:**
* Depends on P12.6.C, P12.6.D, P12.6.E, and P12.6.I.
* Central lifecycle integration workstream.

---

### P12.6.G — Validation-Triggered Remediation Path

**Goal:** Reuse the remediation runtime to repair final validation failures with bounded attempts.

**Requirements:**
* Add remediation trigger: `final_validation_failed`.
* Build remediation input from failed command, exit code, stdout/stderr paths, snippets, changed files, workspace reports, and git diff summary.
* Allow remediation to edit files, but not decide pass/fail.
* After repair, rerun the failed command first.
* If failed command passes, rerun full final validation.
* Enforce `maxRepairAttempts`, default 2.
* Persist remediation attempt metadata and diffs.

**Acceptance Criteria:**
* Failed final validation triggers remediation when enabled.
* Repair loop stops after max attempts.
* Pass/fail remains owned by FinalValidationRunner.
* Remediation artifacts are visible to cleanup and dashboard.
* Infinite validation/repair loops are impossible.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B, P12.6.E, and P12.6.I (interfaces/types from validation schema, runner, and artifacts; lifecycle wiring in F completes later).
* Can run in parallel with P12.6.H and P12.6.F.

---

### P12.6.H — Cleanup Review Read-Only Integration

**Goal:** Keep cleanup review read-only and feed it final validation/remediation artifacts.

**Requirements:**
* Update cleanup prompt to include final validation results.
* Include remediation attempts and repair summaries.
* Ensure cleanup tools remain read-only.
* Add explicit cleanup rules: do not run commands, do not edit files, do not override validation result.
* Update cleanup result parser/output contract for final validation and remediation fields.

**Acceptance Criteria:**
* Cleanup review summarizes final validation status and remediation history.
* Cleanup cannot run bash/write/edit.
* Cleanup summary marks stale validation artifacts when relevant.
* Cleanup verdict is review verdict, not final validation source of truth.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B, P12.6.E, and P12.6.I (cleanup reads validation types and artifacts; lifecycle wiring in F completes later).
* Can run in parallel with P12.6.G and P12.6.F.

---

### P12.6.I — Persistence, Artifacts, and Journal Events

**Goal:** Persist validation and remediation results for audit, dashboard, and cleanup.

**Requirements:**
* Add final validation artifact directory:
  `.pi/executions/{planExecId}/validation/`
* Persist:
  * `final-validation.json`
  * per-command stdout/stderr logs
  * command metadata
  * rejected watch-mode commands
  * remediation attempts
  * remediation diffs/summaries
* Add journal events:
  * `final_validation_started`
  * `final_validation_command_started`
  * `final_validation_command_completed`
  * `final_validation_failed`
  * `final_validation_passed`
  * `validation_remediation_started`
  * `validation_remediation_completed`
  * `cleanup_review_started`
  * `cleanup_review_completed`
* Expose summary APIs for dashboard.

**Acceptance Criteria:**
* All artifacts are written in stable, documented paths.
* Dashboard can fetch final validation status without reading giant logs inline.
* Cleanup can read final validation/remediation artifacts.
* State store and JSON fallback remain compatible.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B.
* Should be ready before P12.6.F, P12.6.G, P12.6.H, and P12.6.J finalize.

---

### P12.6.J — Dashboard Final Validation UX

**Goal:** Update the dashboard to make implementation, validation, remediation, and cleanup phases visible and understandable.

**Requirements:**
* Add `FinalValidationPanel`.
* Add `ValidationRepairPanel`.
* Add validation state to plan status rendering.
* Add `_final_validation` pseudo-worker or equivalent live status row.
* Add worker badge: `Validation deferred to Final Validation Gate`.
* Add command list, current command, duration, exit code, stdout/stderr expandable logs, rejected watch commands, and artifact links.
* Add stale cleanup warning when validation is rerun.

**Acceptance Criteria:**
* User can tell whether implementation is complete but validation is still pending/running/failed.
* User can inspect failed command logs.
* User can see remediation attempts and remaining attempts.
* Worker cards no longer imply tests passed.
* Dashboard handles missing artifacts gracefully.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B (schema/types define the API shape; mock data can be used before artifacts are finalized).
* Can start with mocked API shape while backend wiring finishes.

---

### P12.6.K — Rerun Validation, Remediation, and Cleanup Controls

**Goal:** Add safe rerun controls for final validation, validation remediation, and cleanup review.

**Requirements:**
* Add endpoint: `POST /api/projects/:projectId/plans/:planExecId/rerun-final-validation`.
* Add endpoint or action for validation remediation retry when allowed.
* Preserve existing cleanup rerun behavior but mark cleanup stale when validation changes.
* Ensure rerun validation does not run concurrently with active validation or remediation.
* Ensure rerun validation uses the same deterministic runner and artifacts.

**Acceptance Criteria:**
* User can rerun final validation from dashboard.
* Rerun final validation invalidates stale cleanup summary.
* Rerun remediation respects max attempts and current validation result.
* Duplicate rerun requests are rejected or coalesced safely.

**Isolation & Parallelism Notes:**
* Depends on P12.6.F, P12.6.G, P12.6.I, and P12.6.J.

---

### P12.6.L1 — Unit and Regression Tests

**Goal:** Write unit and regression tests for P12.6 core components before full integration dogfood.

**Requirements:**
* Add unit tests for command collection, normalization, dedupe, watch-mode policy, command guard, final validation artifact writing, and cleanup read-only enforcement.
* Add dashboard tests for final validation and remediation panels.

**Acceptance Criteria:**
* Unit and regression tests cover P12.6 behavior for coding-agent and dashboard components.
* Tests prove parallel validation commands are never run.
* Worker command guard unit tests pass.

**Isolation & Parallelism Notes:**
* Depends on P12.6.B, P12.6.C, P12.6.D, P12.6.E, P12.6.I, and P12.6.J.
* Scoped to `packages/coding-agent/test/**`; no overlap with K's web-server/dashboard test scopes.
* Can run in parallel with P12.6.K.

---

### P12.6.L2 — Dogfood, Migration Docs, and Final Report

**Goal:** Prove the redesign works end-to-end and document migration from v2.5 per-workspace validation to v2.6 final-only validation.

**Requirements:**
* Dogfood against Pi repo.
* Confirm no parallel Vitest process explosion.
* Write migration notes explaining legacy compatibility and new defaults.
* Write dogfood report.

**Acceptance Criteria:**
* Dogfood report shows final validation commands ran sequentially.
* No implementation worker starts test/build/typecheck/dev command.
* Documentation explains legacy compatibility and new defaults.
* P12.6 is safe to make the basis for Master Template v2.6.

**Isolation & Parallelism Notes:**
* Depends on all implementation workstreams (P12.6.F, P12.6.G, P12.6.H, P12.6.K, P12.6.L1).
* Final verification of the whole phase.

---

## 8. Combined Implementation Order

### Dependency Graph

```text
P12.6.A Master Template v2.6  P12.6.B Validation schema/policy
  (parallel, no cross-dependency)

P12.6.B
  -> P12.6.C Remove worker validation
  -> P12.6.D Worker command guard
  -> P12.6.E FinalValidationRunner
  -> P12.6.I Persistence/artifacts
  -> P12.6.J Dashboard UX (stub with mock data)

P12.6.B + P12.6.E + P12.6.I
  -> P12.6.F Plan-runner lifecycle wiring
  -> P12.6.G Validation-triggered remediation (interface-driven, no F dep)
  -> P12.6.H Cleanup read-only integration (interface-driven, no F dep)

P12.6.B + C/D/E/I/J
  -> P12.6.L1 Unit and regression tests

P12.6.F + G + H + I + J
  -> P12.6.K Rerun controls

P12.6.F + G + H + K + L1
  -> P12.6.L2 Dogfood, migration docs, final report
```

### Suggested Execution Batches

```text
Batch 1 (width 2):
  P12.6.A  Master Template v2.6 Contract Update
  P12.6.B  Validation Schema and Policy Model

Batch 2 (width 5):
  P12.6.C  Remove Worker-Level Validation Execution
  P12.6.D  Worker Command Guard
  P12.6.E  Implement FinalValidationRunner
  P12.6.I  Persistence, Artifacts, and Journal Events
  P12.6.J  Dashboard Final Validation UX (stub data)

Batch 3 (width 4):
  P12.6.F  Wire FinalValidationRunner into Plan-Runner Lifecycle
  P12.6.G  Validation-Triggered Remediation Path
  P12.6.H  Cleanup Review Read-Only Integration
  P12.6.L1 Unit and Regression Tests

Batch 4 (width 1):
  P12.6.K  Rerun Validation, Remediation, and Cleanup Controls

Batch 5 (width 1):
  P12.6.L2 Dogfood, Migration Docs, and Final Report
```

### Continuous Scheduling Notes

Although batches are shown for human review, v2.5 continuous scheduling may refill slots as soon as dependencies are satisfied (no batch barrier). The scheduler must still respect dependency edges and conflict scopes.

P12.6 deliberately keeps implementation parallelism high while forcing validation concurrency to one deterministic final validation runner.

### DAG Optimization Rationale

The original DAG had 7 batches with critical path length 7. After optimization:

```text
Before:
  widths = 1, 1, 4, 2, 2, 1, 1
  critical path length = 7
  effective parallelism = 1.7

After:
  widths = 2, 5, 4, 1, 1
  critical path length = 5
  effective parallelism = 2.6
```

Key changes:
- **A and B parallelized**: Master template and schema are both based on the same redesign decisions, no code-level dependency.
- **Dashboard (J) moved to batch 2**: Depends only on B (types/schema), can use mock/stub data without full backend.
- **Persistence (I) stays in batch 2**: Artifact shape follows schema, runner consumes it later.
- **Remediation (G) and Cleanup (H) decoupled from F**: Both work against interfaces (`FinalValidationResult`, `ValidationFailureContext`) defined by B/E/I, not against F's lifecycle wiring.
- **F moved to batch 3**: Lifecycle wiring depends on C, D, E, I which are all in batch 2.
- **L split into L1 and L2**: Unit tests can start as soon as types/guards/runner/artifacts/dashboard exist (batch 3). Dogfood and migration docs wait until all implementation is complete (batch 5).

**Conflict mitigation**: F, G, H in batch 3 must not touch the same files. Scopes are partitioned:

```text
F — plan-runner lifecycle wiring
    packages/web-server/src/plan-runner.ts
    packages/coding-agent/src/core/autonomous-executor.ts

G — remediation integration
    packages/coding-agent/src/core/remediation-*.ts

H — cleanup prompt/input redesign
    packages/coding-agent/src/core/cleanup-review.ts
```

---

## 9. Definition of Done

P12.6 is complete when ALL are true:

* [ ] Master Template v2.6 documents final-only validation lifecycle.
* [ ] Part 3 JSON supports final-only validation configuration.
* [ ] Worker prompts no longer ask implementation agents to run `targetCommand`, tests, builds, or typecheck.
* [ ] Worker command guard blocks test/build/dev validation commands outside final validation context.
* [ ] `targetCommand` is collected only by the Final Validation Gate.
* [ ] Completion gate no longer records target command success from worker verdict alone.
* [ ] FinalValidationRunner runs commands sequentially with CI-safe environment defaults.
* [ ] Watch-mode commands are rejected or safely rewritten.
* [ ] `final-validation.json` and command logs are persisted.
* [ ] Failed final validation triggers bounded remediation when enabled.
* [ ] Remediation is revalidated by FinalValidationRunner.
* [ ] Cleanup review remains read-only and receives final validation/remediation artifacts.
* [ ] Dashboard shows final validation and remediation status clearly.
* [ ] Rerun final validation works.
* [ ] Cleanup summary is marked stale after validation rerun.
* [ ] Plan cannot complete without final validation pass.
* [ ] Dogfood confirms no parallel Vitest process explosion.
* [ ] Typecheck/build/test requirements pass where applicable.

---

## 10. Rollback Playbook

**Trigger conditions:**

* Final-only validation blocks all plans unexpectedly.
* FinalValidationRunner cannot reliably collect or execute validation commands.
* Command guard blocks required non-validation commands.
* Remediation trigger causes unsafe or repeated edits.
* Dashboard validation states are misleading.
* Final validation artifacts are missing or corrupt.
* Existing plans cannot run due to schema compatibility issues.

**Rollback procedure:**

1. Set validation mode to `legacy_per_workspace`.
2. Set scale mode to `stable_3`.
3. Set `maxParallelWorkspaces` to `3` or lower.
4. Disable validation-triggered remediation.
5. Keep cleanup review read-only.
6. Preserve `.pi/executions/{planExecId}/validation/` for debugging.
7. Disable worker command guard only if it incorrectly blocks implementation commands.
8. Restore legacy targetCommand semantics only for explicitly legacy plans.
9. Revert dashboard panels independently if backend remains functional.
10. Revert phase commits independently if needed.

---

## 11. What Next Phase Inherits

The next phase inherits:

* Final-only validation lifecycle.
* Deterministic FinalValidationRunner.
* Validation-triggered remediation integration.
* Read-only cleanup review with validation artifact input.
* Dashboard validation panels and rerun controls.
* Master Template v2.6 semantics.
* Worker command guard for validation commands.
* Final validation artifact and audit trail.

The next phase may add:

* Smarter test-impact planning.
* Distributed but resource-aware final validation.
* Per-package validation shards with scheduler-controlled concurrency.
* Release orchestration.
* Remote execution validation runners.
* More advanced failure classification for remediation.
* Validation history trend analysis.

---

# Part 2 — Agent Brief

## Mission

Implement P12.6: Final Validation Gate & Validation-Triggered Remediation.

The agent must redesign Pi's validation lifecycle so implementation workers no longer run validation commands. All tests, builds, typechecks, and target commands must move to a deterministic final validation phase that runs after all workspaces complete and after integrated output is available. If validation fails, the existing remediation runtime should receive a focused validation failure repair task. Cleanup review must remain read-only and must only summarize final results.

The primary success metric is eliminating parallel Vitest/test process explosions while preserving LLM-based repair of validation failures.

---

## Hard Requirements

1. Implementation workers must not run tests, builds, typecheck, dev servers, or `targetCommand`.
2. `targetCommand` is final validation input only when validation mode is `final_only`.
3. Final validation runs after all implementation workspaces complete.
4. Final validation runs on the integrated tree, not on isolated per-workspace partial states.
5. Final validation commands must be deduplicated.
6. Final validation commands must run sequentially.
7. Final validation must use CI-safe environment defaults.
8. Watch-mode/dev-server commands must be rejected or rewritten safely.
9. Pass/fail decision belongs only to FinalValidationRunner.
10. Worker `VERDICT: COMPLETE` must not mark targetCommand passed.
11. Validation failure may trigger remediation, but remediation must be bounded by `maxRepairAttempts`.
12. Remediation may edit files, but final validation must re-prove correctness.
13. Cleanup review must not run commands.
14. Cleanup review must not edit files.
15. Cleanup review must not override final validation pass/fail.
16. Dashboard must distinguish implementation complete, validating, validation failed, remediating, cleanup reviewing, and complete.
17. Rerun final validation must invalidate stale cleanup summaries.
18. Do not run `git push`.
19. Do not run raw destructive cleanup commands.
20. The executor remains the only component that mutates execution state.

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
  enabled_by_default: true
  root: .pi/worktrees
  quarantine_failed_by_default: true
  raw_rm_rf_forbidden: true
  path_scope_required: true

integration_queue:
  enabled: true
  process_one_merge_at_a_time: true
  stop_on_merge_conflict: true
  workspace_validation_policy: deferred_to_final_validation
  require_final_validation_pass_before_plan_complete: true
  git_push_allowed: false

validation:
  mode: final_only
  worker_validation_enabled: false
  worker_validation_command_policy: block_test_build_typecheck_dev_commands
  target_command_role: final_validation_input
  final_validation_required: true
  final_validation_timing: after_all_workspaces_integrated
  command_sources:
    - planExecution.validation.commands
    - workspaces[].targetCommand
    - testImpactAnalyzer
    - repoDefault
  default_command: npm test
  dedupe_commands: true
  sequential_execution_required: true
  fail_fast: false
  global_validation_lock_required: true
  force_ci: true
  watch_mode_forbidden: true
  normalize_vitest_run: true
  timeout_ms: 600000
  max_repair_attempts: 2
  validation_triggered_remediation_enabled: true
  rerun_failed_command_first: true
  rerun_full_final_validation_after_repair: true

cleanup_review:
  read_only: true
  command_execution_allowed: false
  file_mutation_allowed: false
  may_override_validation_result: false

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

Hard stop execution for:

* Dependency cycles.
* Invalid dependency patches.
* Required preflight review not approved.
* Stale approved graph hash.
* Worktree path escaping `.pi/worktrees`.
* Raw destructive worktree cleanup.
* Integration merge conflict without handoff artifact.
* Unsafe scale mode.
* Queue starting next plan while integration queue is dirty.
* Scale mode approval stale or missing.
* Worktree isolation disabled while requesting more than 3 workers.
* Forbidden file access.
* Secrets access.
* `git push`.
* Worker attempting validation command in final-only mode.
* Watch-mode validation command.
* Final validation missing.
* Final validation artifact missing.
* Validation command parallel execution.
* Final validation failure after max remediation attempts.
* Cleanup attempted command execution.
* Cleanup attempted file mutation.
* Validation repair attempt limit exceeded.
* Dashboard direct state mutation.

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract for Pi's autonomous execution system. It uses Master Template v2.5.0 structure while defining the P12.6 work needed to introduce final-only validation lifecycle semantics.

**Validation:** This JSON must be valid and complete before execution begins. Run `pi plan doctor` before execution. If the current runtime does not yet support new P12.6 validation fields, P12.6.A and P12.6.B must add compatibility handling before later workstreams rely on those fields.

```json
{
  "contractVersion": "2.5.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi-monorepo",
    "rootPath": "{{ absolute_or_repo_relative_path }}",
    "type": "repo",
    "tags": ["p12.6", "validation", "remediation", "dashboard"]
  },
  "planExecution": {
    "phase": "P12.6",
    "title": "Final Validation Gate & Validation-Triggered Remediation",
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
      "prewarmCount": 6,
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": true,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "workspaceValidationPolicy": "deferred_to_final_validation",
      "requireWorkspaceValidationPass": false,
      "requireIntegrationValidationPass": false,
      "requireFinalValidationPassBeforePlanComplete": true,
      "gitPushAllowed": false,
      "queuePriority": {
        "enabled": true,
        "defaultLevel": "normal",
        "levels": ["critical", "high", "normal", "low"]
      },
      "queueOptimization": {
        "enabled": true,
        "strategy": "critical_path_first",
        "availableStrategies": ["priority_then_fifo", "critical_path_first", "weighted_shortest_job_first"]
      }
    },
    "validation": {
      "mode": "final_only",
      "workerValidationEnabled": false,
      "workerValidationCommandPolicy": "block_test_build_typecheck_dev_commands",
      "targetCommandRole": "final_validation_input",
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "finalValidationRequired": true,
      "finalValidationTiming": "after_all_workspaces_integrated",
      "commandSources": [
        "planExecution.validation.commands",
        "workspaces[].targetCommand",
        "testImpactAnalyzer",
        "repoDefault"
      ],
      "commands": [],
      "defaultCommand": "npm test",
      "dedupeCommands": true,
      "sequential": true,
      "failFast": false,
      "forceCI": true,
      "watchModeForbidden": true,
      "normalizeVitestRun": true,
      "timeoutMs": 600000,
      "maxRepairAttempts": 2,
      "validationTriggeredRemediation": {
        "enabled": true,
        "trigger": "final_validation_failed",
        "rerunFailedCommandFirst": true,
        "rerunFullFinalValidationAfterRepair": true
      },
      "artifacts": {
        "writeFinalValidationJson": true,
        "writeCommandStdoutStderrLogs": true,
        "path": ".pi/executions/{planExecId}/validation/"
      }
    },
    "cleanupReview": {
      "readOnly": true,
      "commandExecutionAllowed": false,
      "fileMutationAllowed": false,
      "mayOverrideValidationResult": false,
      "includeFinalValidationArtifacts": true,
      "includeValidationRemediationArtifacts": true
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
      "merge_conflict_without_handoff",
      "unsafe_scale_mode",
      "queue_next_plan_while_integration_dirty",
      "scale_mode_approval_stale",
      "worktree_required_for_requested_parallelism",
      "watch_mode_validation",
      "worker_validation_command_attempt",
      "final_validation_missing",
      "final_validation_failure",
      "final_validation_artifact_missing",
      "validation_command_parallel_execution",
      "validation_repair_attempt_limit_exceeded",
      "cleanup_attempted_command_execution",
      "cleanup_attempted_file_mutation",
      "execution_without_dry_run",
      "execution_without_approval",
      "optimizer_patch_without_approval"
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
      "vite dev"
    ],
    "workerForbiddenValidationCommands": [
      "vitest",
      "npm test",
      "pnpm test",
      "yarn test",
      "npm run test",
      "npm run build",
      "npm run typecheck",
      "tsc",
      "vite",
      "vite dev",
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
      "warnings": [
        "Implementation workers may run in parallel, but final validation must run sequentially."
      ],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": true,
          "message": "Required for experimental_6 and scale_8."
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": true,
          "message": "Required as safety net, even though final validation is sequential."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required, but must not treat worker verdict as target-command success."
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
      "batches": [],
      "overallEffectiveParallelism": null,
      "criticalPath": [],
      "criticalPathLength": 0,
      "serializedTailLength": 0
    },
    "safeBatchPreview": {
      "batches": [],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [
        "final_validation_serializes_test_execution_by_design"
      ],
      "blockedParallelismReasons": [
        "Validation commands are intentionally not parallelized in P12.6."
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
      "symbol_overlap_blocks_parallelism",
      "validation_lock_limits_parallelism",
      "final_validation_serialized_by_design",
      "integration_queue_serializes_merges",
      "scale_mode_prerequisites_missing",
      "worktree_isolation_required_for_scale",
      "queue_optimization_disabled_with_active_priority",
      "queue_priority_mismatch_with_configured_levels",
      "critical_path_workspace_has_low_priority",
      "queue_optimization_strategy_invalid_for_mode",
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
      "plan_intake_analysis",
      "optimizer_proposal",
      "graph_diff",
      "final_validation_result",
      "final_validation_command_logs",
      "validation_repair_attempts",
      "validation_repair_diff",
      "cleanup_review_summary"
    ]
  },
  "workspaces": [
    {
      "id": "P12.6.A",
      "title": "Master Template v2.6 Contract Update",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Template semantics should be defined before schema and runtime implementation.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": ["docs/llm-implementation-agent-master-template.md"],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Documentation-only foundation work."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Defines semantics required by downstream workstreams."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "docs/llm-implementation-agent-master-template.md",
        "docs/llm-implementation-agent-master-template-v2.6.md",
        "docs/pi/validation/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Master Template v2.6 documents final-only validation lifecycle.",
        "targetCommand is documented as final validation input.",
        "cleanup review is documented as read-only."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "docs/llm-implementation-agent-master-template.md",
          "docs/llm-implementation-agent-master-template-v2.6.md",
          "docs/pi/validation/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.B",
      "title": "Validation Schema and Policy Model",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "Schema and master template are both grounded in the same redesign semantics; no code-level dependency.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": ["P12.6.A"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/workspace-schema.ts",
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/watch-mode-guard.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run in parallel with A — no file overlap between docs and schema."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical because downstream workstreams depend on the policy model."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/workspace-schema.ts",
        "packages/coding-agent/src/core/plan-state.ts",
        "packages/coding-agent/src/core/watch-mode-guard.ts",
        "packages/coding-agent/src/validation/**",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Validation mode supports final_only, legacy_per_workspace, and off.",
        "Policy model includes final validation and remediation fields.",
        "Doctor/schema validation understands targetCommand final-validation semantics."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/workspace-schema.ts",
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/watch-mode-guard.ts",
          "packages/coding-agent/src/validation/**",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.C",
      "title": "Remove Worker-Level Validation Execution",
      "dependencies": ["P12.6.B"],
      "parallelGroup": "batch_2",
      "dependencyReason": "Worker behavior depends on the new validation policy.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["P12.6.D", "P12.6.E", "P12.6.I", "P12.6.J"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/completion-gate.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with command guard and runner work if file scopes remain separate."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Important runtime behavior change that should merge before lifecycle wiring."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/workspace-agent-executor.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/core/completion-gate.ts",
        "packages/coding-agent/src/core/role-packets.ts",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Worker prompts forbid tests/build/typecheck/dev commands.",
        "targetCommand is not sent to workers as an instruction.",
        "Worker COMPLETE no longer records targetCommand success."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/core/completion-gate.ts",
          "packages/coding-agent/src/core/role-packets.ts",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.D",
      "title": "Worker Command Guard for Test/Build/Dev Commands",
      "dependencies": ["P12.6.B"],
      "parallelGroup": "batch_2",
      "dependencyReason": "Command guard needs the validation context/policy model.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["P12.6.C", "P12.6.E", "P12.6.I", "P12.6.J"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/tools/bash.ts",
          "packages/coding-agent/src/core/watch-mode-guard.ts",
          "packages/coding-agent/src/core/utils/shell.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Tool-layer work can run in parallel with runner and schema artifact work."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Safety guard should merge early."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/tools/bash.ts",
        "packages/coding-agent/src/core/watch-mode-guard.ts",
        "packages/coding-agent/src/core/utils/shell.ts",
        "packages/coding-agent/src/validation/**",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Worker-context validation commands are blocked.",
        "Final-validation context can run allowed validation commands.",
        "Blocked output clearly explains final validation deferral."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/tools/bash.ts",
          "packages/coding-agent/src/core/watch-mode-guard.ts",
          "packages/coding-agent/src/core/utils/shell.ts",
          "packages/coding-agent/src/validation/**",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.E",
      "title": "Implement FinalValidationRunner",
      "dependencies": ["P12.6.B"],
      "parallelGroup": "batch_2",
      "dependencyReason": "Runner depends on validation policy definitions.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["P12.6.C", "P12.6.D", "P12.6.I", "P12.6.J"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/validation/final-validation-runner.ts",
          "packages/coding-agent/src/validation/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Mostly additive validation module."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Core capability for P12.6 lifecycle."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/validation/**",
        "packages/coding-agent/src/core/validation-lock.ts",
        "packages/coding-agent/src/core/utils/shell.ts",
        "packages/coding-agent/src/index.ts",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "FinalValidationRunner collects, normalizes, dedupes, and runs commands sequentially.",
        "Runner writes final-validation.json and command logs.",
        "Runner rejects or rewrites watch-mode commands."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/validation/**",
          "packages/coding-agent/src/core/validation-lock.ts",
          "packages/coding-agent/src/core/utils/shell.ts",
          "packages/coding-agent/src/index.ts",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.F",
      "title": "Wire FinalValidationRunner into Plan-Runner Lifecycle",
      "dependencies": ["P12.6.C", "P12.6.D", "P12.6.E", "P12.6.I"],
      "parallelGroup": "batch_3",
      "dependencyReason": "Lifecycle wiring requires worker behavior, command guard, runner, and artifacts — all available from batch 2.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["P12.6.G", "P12.6.H", "P12.6.L1"],
        "cannotRunWith": ["P12.6.K"],
        "conflictScope": [
          "packages/web-server/src/plan-runner.ts",
          "packages/web-server/src/index.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Central lifecycle wiring should be serialized."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Unblocks remediation, cleanup, dashboard, and controls."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-server/src/plan-runner.ts",
        "packages/web-server/src/index.ts",
        "packages/web-server/src/plan-markdown.ts",
        "packages/coding-agent/src/core/autonomous-executor.ts",
        "packages/coding-agent/src/index.ts",
        "packages/web-server/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Final validation runs after implementation and integration.",
        "Plan cannot complete without final validation pass.",
        "Validation failure routes to remediation or failed/handoff state."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/plan-runner.ts",
          "packages/web-server/src/index.ts",
          "packages/web-server/src/plan-markdown.ts",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/index.ts",
          "packages/web-server/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "final_validation_started",
          "final_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.G",
      "title": "Validation-Triggered Remediation Path",
      "dependencies": ["P12.6.B", "P12.6.E", "P12.6.I"],
      "parallelGroup": "batch_3",
      "dependencyReason": "Remediation works against FinalValidationResult and ValidationFailureContext types from B/E/I; does not need F's lifecycle wiring.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["P12.6.F", "P12.6.H", "P12.6.L1"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/remediation-runtime.ts",
          "packages/coding-agent/src/core/remediation-policy-engine.ts",
          "packages/coding-agent/src/core/proposal-execution-pipeline.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run alongside cleanup/dashboard integration if file scopes do not overlap."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Repair loop is important but follows core lifecycle wiring."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/remediation-runtime.ts",
        "packages/coding-agent/src/core/remediation-policy-engine.ts",
        "packages/coding-agent/src/core/proposal-execution-pipeline.ts",
        "packages/coding-agent/src/core/failure/**",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "final_validation_failed trigger creates focused remediation task.",
        "Remediation attempts are bounded.",
        "FinalValidationRunner revalidates repairs."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/remediation-runtime.ts",
          "packages/coding-agent/src/core/remediation-policy-engine.ts",
          "packages/coding-agent/src/core/proposal-execution-pipeline.ts",
          "packages/coding-agent/src/core/failure/**",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "validation_remediation_started",
          "validation_remediation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.H",
      "title": "Cleanup Review Read-Only Integration",
      "dependencies": ["P12.6.B", "P12.6.E", "P12.6.I"],
      "parallelGroup": "batch_3",
      "dependencyReason": "Cleanup works against CleanupReviewInput types from B/E/I; can be developed independently of F lifecycle wiring.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["P12.6.F", "P12.6.G", "P12.6.L1"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/cleanup-review.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Focused cleanup integration can run alongside remediation/dashboard work."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Cleanup depends on validation artifacts but does not block core runner."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/cleanup-review.ts",
        "packages/coding-agent/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Cleanup prompt includes final validation and remediation artifacts.",
        "Cleanup remains read-only.",
        "Cleanup summary cannot override final validation pass/fail."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/cleanup-review.ts",
          "packages/coding-agent/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.I",
      "title": "Persistence, Artifacts, and Journal Events",
      "dependencies": ["P12.6.B"],
      "parallelGroup": "batch_2",
      "dependencyReason": "Artifact model depends on validation schema/policy.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["P12.6.C", "P12.6.D", "P12.6.E", "P12.6.J"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/src/core/database-state-store.ts",
          "packages/web-server/src/execution-archive.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Persistence work may overlap with schema; merge carefully."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Required by lifecycle, remediation, cleanup, and dashboard."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/core/plan-state.ts",
        "packages/coding-agent/src/core/state-store.ts",
        "packages/coding-agent/src/core/json-state-store.ts",
        "packages/coding-agent/src/core/database-state-store.ts",
        "packages/web-server/src/execution-archive.ts",
        "packages/web-server/src/state-store-provider.ts",
        "packages/coding-agent/test/**",
        "packages/web-server/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Validation artifacts are persisted in stable paths.",
        "Journal events cover validation and remediation lifecycle.",
        "Dashboard can retrieve validation summaries without reading huge logs inline."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/core/plan-state.ts",
          "packages/coding-agent/src/core/state-store.ts",
          "packages/coding-agent/src/core/json-state-store.ts",
          "packages/coding-agent/src/core/database-state-store.ts",
          "packages/web-server/src/execution-archive.ts",
          "packages/web-server/src/state-store-provider.ts",
          "packages/coding-agent/test/**",
          "packages/web-server/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.J",
      "title": "Dashboard Final Validation UX",
      "dependencies": ["P12.6.B"],
      "parallelGroup": "batch_2",
      "dependencyReason": "Dashboard can start with stub data once schema/types are defined; backend wiring connects in K.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": ["P12.6.C", "P12.6.D", "P12.6.E", "P12.6.I"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/FinalValidationPanel.tsx",
          "packages/web-ui/dashboard/src/components/ValidationRepairPanel.tsx",
          "packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx",
          "packages/web-ui/dashboard/src/types.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "UI work can proceed once artifact API shape is stable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Dashboard UX can merge after backend artifact model."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/**",
        "packages/web-ui/dashboard/src/hooks/**",
        "packages/web-ui/dashboard/src/types.ts",
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Dashboard shows final validation state, commands, logs, and artifacts.",
        "Dashboard shows remediation attempts.",
        "Worker cards show validation deferred badge."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/**",
          "packages/web-ui/dashboard/src/hooks/**",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.K",
      "title": "Rerun Validation, Remediation, and Cleanup Controls",
      "dependencies": ["P12.6.F", "P12.6.G", "P12.6.H", "P12.6.I", "P12.6.J"],
      "parallelGroup": "batch_4",
      "dependencyReason": "Rerun controls require lifecycle (F), remediation (G), cleanup (H), artifacts (I), and dashboard (J) — all ready by end of batch 3.",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-server/src/index.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx",
          "packages/web-ui/dashboard/src/components/FinalValidationPanel.tsx"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Control endpoints and UI should be serialized after core panels and lifecycle."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Follows core lifecycle and dashboard integration."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-server/src/index.ts",
        "packages/web-server/src/plan-runner.ts",
        "packages/web-ui/dashboard/src/components/**",
        "packages/web-ui/dashboard/src/hooks/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Rerun final validation endpoint works.",
        "Validation rerun invalidates cleanup summary.",
        "Duplicate concurrent validation reruns are rejected or coalesced."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/index.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/web-ui/dashboard/src/components/**",
          "packages/web-ui/dashboard/src/hooks/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.L1",
      "title": "Unit and Regression Tests",
      "dependencies": [
        "P12.6.B",
        "P12.6.C",
        "P12.6.D",
        "P12.6.E",
        "P12.6.I",
        "P12.6.J"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Unit and regression tests can start once types, guards, runner, artifacts, and dashboard schema are stable.",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": ["P12.6.F", "P12.6.G", "P12.6.H"],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/test/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Test-writing can run in parallel with lifecycle wiring (F), remediation (G), and cleanup (H) as scopes do not overlap."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Early test coverage catches integration issues before dogfood."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/test/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/test/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Unit tests cover command collection, normalization, dedupe, watch-mode policy, and command guard.",
        "Integration tests cover: all workspaces complete -> final validation runs; validation fail -> remediation trigger; remediation pass -> full rerun; cleanup receives validation artifacts; plan cannot complete without final validation pass.",
        "Dashboard tests cover final validation and remediation panels."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/test/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
      },
      "telemetry": {
        "expectedEvents": ["workspace_started", "workspace_completed"],
        "logLevel": "info"
      }
    },
    {
      "id": "P12.6.L2",
      "title": "Dogfood, Migration Docs, and Final Report",
      "dependencies": [
        "P12.6.F",
        "P12.6.G",
        "P12.6.H",
        "P12.6.K",
        "P12.6.L1"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Dogfood requires complete lifecycle, remediation, cleanup, rerun controls, and test coverage.",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "docs/**",
          "reports/p12-6-final-validation/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Final verification and documentation after all implementation is merged."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "workspaceValidationPolicy": "deferred_to_final_validation",
        "requiresWorkspaceValidation": false,
        "requiresFinalValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Wraps up the phase with real-world validation."
      },
      "validation": {
        "profile": "implementation_only_final_validation_deferred",
        "workerValidation": "disabled",
        "targetCommandRole": "final_validation_input",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "docs/**",
        "reports/p12-6-final-validation/**"
      ],
      "forbiddenFiles": [".env*", "**/*.pem", "**/*.key"],
      "acceptanceCriteria": [
        "Dogfood confirms no parallel Vitest explosion.",
        "Migration docs explain final-only validation and legacy mode.",
        "Final report documents the DAG optimization outcomes, conflicts resolved, and critical path improvements."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "docs/**",
          "reports/p12-6-final-validation/**"
        ],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["git diff", "git status"],
        "cannotRun": ["git push", "rm -rf", "npm test", "vitest", "npm run dev"]
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

## Field Definition Notes for P12.6

### Validation Mode

- **`final_only`**: implementation workers do not run validation commands. FinalValidationRunner runs all validation after implementation and integration.
- **`legacy_per_workspace`**: old behavior retained for explicit compatibility only.
- **`off`**: validation disabled; unsafe for autonomous completion unless explicitly approved.

### Target Command Semantics

In P12.6, `targetCommand` is a final validation input. It must not be run by implementation workers.

### Final Validation Gate

The Final Validation Gate is deterministic and non-LLM. It owns command execution and pass/fail.

### Validation-Triggered Remediation

Remediation is LLM-based and may edit files, but it does not own pass/fail. Every repair must be revalidated by FinalValidationRunner.

### Cleanup Review

Cleanup review is read-only. It explains final state and risks. It does not run tests, edit files, commit, or override validation results.

---

## P12.6 Validation Rules

1. JSON must be syntactically valid.
2. `contractVersion` must be present and valid.
3. `planExecution.validation.mode` must be one of `final_only`, `legacy_per_workspace`, or `off`.
4. If `validation.mode` is `final_only`, `workerValidationEnabled` must be false.
5. If `validation.mode` is `final_only`, implementation workers must not run `targetCommand`, test, build, typecheck, watch, or dev commands.
6. If `validation.mode` is `final_only`, workspace `targetCommand` values are final validation inputs only.
7. Final Validation Gate must run after all workspaces have completed.
8. Final Validation Gate must run after integration queue output is available.
9. Final validation commands must be deduplicated before execution.
10. Final validation commands must run sequentially; `Promise.all`-style validation execution is forbidden.
11. Watch-mode validation commands must be rejected or safely rewritten before execution.
12. `vitest` without `run` should normalize to `vitest run` when safe.
13. Final validation must use CI-safe environment defaults.
14. Final validation must write `final-validation.json`.
15. Final validation must write per-command stdout/stderr artifacts.
16. A plan must not be marked complete unless Final Validation Gate passes.
17. Worker `VERDICT: COMPLETE` must not mark target command success.
18. If Final Validation Gate fails and remediation is enabled, validation-triggered remediation may run up to `maxRepairAttempts`.
19. Remediation must be revalidated by FinalValidationRunner.
20. Cleanup review must be read-only.
21. Cleanup review must not execute shell commands.
22. Cleanup review must not mutate files.
23. Cleanup review must not override final validation pass/fail.
24. Dashboard must distinguish implementation complete, final validation running, validation failed, remediation running, cleanup review, and complete.
25. Rerun final validation must invalidate stale cleanup summaries.
26. Rerun final validation must not run concurrently with another active final validation or remediation pass.
27. Worker command guard must block validation commands in worker context.
28. Final-validation context may run allowed validation commands only through FinalValidationRunner.
29. Existing v2.5 plans may use legacy behavior only when explicitly configured.
30. Dogfood must confirm no parallel Vitest process explosion.

---

## Persistence Mapping

P12.6 additionally persists:

```text
Plan Execution -> Final Validation Result
Plan Execution -> Final Validation Command Logs
Plan Execution -> Rejected Watch Commands
Plan Execution -> Validation Repair Attempts
Plan Execution -> Validation Repair Diffs
Plan Execution -> Validation Remediation Decisions
Plan Execution -> Cleanup Review Summary
```

Artifact layout:

```text
.pi/executions/{planExecId}/validation/
  final-validation.json
  001-command.stdout.log
  001-command.stderr.log
  002-command.stdout.log
  002-command.stderr.log

.pi/executions/{planExecId}/validation-remediation/
  attempt-1.json
  attempt-1.diff
  attempt-2.json
  attempt-2.diff
```

---

## Control Model

Pause, stop, cancel, resume, validation rerun, remediation rerun, and cleanup rerun remain executor-mediated. The dashboard may request these actions, but the executor remains the only component that mutates execution state.

Final validation rerun requests must be rejected or safely coalesced if final validation or remediation is already active.

Cleanup rerun is allowed only against the latest final validation artifact set. If final validation reruns, prior cleanup output is stale.

---

## Parser Priority

1. Part 3 JSON first.
2. Markdown heading fallback only as recovery mode.
3. Doctor validation.
4. Parallelism preflight if required.
5. Approval gate if required.
6. Scale-mode readiness gate.
7. Worktree/integration readiness gate.
8. Queue optimization readiness gate.
9. Validation lifecycle readiness gate.
10. Execution gate.

---

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.5.0",
  "phase": "P12.6",
  "title": "Final Validation Gate & Validation-Triggered Remediation",
  "primaryGoal": "Move validation from parallel implementation workers to a deterministic post-plan Final Validation Gate, with bounded LLM remediation for failures.",
  "projectName": "pi-monorepo",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "critical_path_first",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 4,
  "validationMode": "final_only",
  "workerValidationEnabled": false,
  "finalValidationRequired": true,
  "validationTriggeredRemediationEnabled": true,
  "maxRepairAttempts": 2,
  "cleanupReviewReadOnly": true,
  "notInScope": [
    "Remote validation execution",
    "Distributed validation sharding",
    "Changing model providers",
    "Changing git push policy",
    "Removing worktree isolation",
    "Replacing the existing remediation runtime"
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
    "merge_conflict_without_handoff",
    "unsafe_scale_mode",
    "queue_next_plan_while_integration_dirty",
    "watch_mode_validation",
    "worker_validation_command_attempt",
    "final_validation_missing",
    "final_validation_artifact_missing",
    "validation_command_parallel_execution",
    "validation_repair_attempt_limit_exceeded",
    "cleanup_attempted_command_execution",
    "cleanup_attempted_file_mutation"
  ],
  "completionGate": "Implementation workers may complete implementation, but the plan cannot complete until Final Validation Gate passes and cleanup review summarizes the result.",
  "nextPhase": null
}
```

---

# Annex A — Runtime Role Separation

```text
Implementation Workers
  Purpose: write code
  LLM: yes
  Can edit files: yes
  Can run tests: no
  Owns pass/fail: no

Final Validation Gate
  Purpose: prove correctness
  LLM: no
  Can edit files: no
  Can run tests: yes
  Owns pass/fail: yes

Validation-Triggered Remediation
  Purpose: fix failed validation
  LLM: yes
  Can edit files: yes
  Can run tests: only through validation runner
  Owns pass/fail: no

Cleanup Review
  Purpose: explain final result
  LLM: yes
  Can edit files: no
  Can run tests: no
  Owns pass/fail: no
```

---

# Annex B — Dashboard Lifecycle Visualization

```text
Implementation
  P12.6.A complete
  P12.6.B complete
  P12.6.C complete
  ...

Final Validation
  Attempt 1 running
    CI=1 npm test
    CI=1 npm run typecheck

If pass:
  Cleanup Review
    final validation: PASS
    remediation attempts: 0

If fail:
  Validation Remediation
    attempt 1
    failed command: CI=1 npm test
    patch produced

  Final Validation
    rerun failed command
    rerun full validation

  Cleanup Review
    final validation: PASS
    remediation attempts: 1
```

---

# Annex C — Migration Notes

Existing plans that rely on per-workspace validation should explicitly set:

```json
{
  "planExecution": {
    "validation": {
      "mode": "legacy_per_workspace"
    }
  }
}
```

New plans should default to:

```json
{
  "planExecution": {
    "validation": {
      "mode": "final_only",
      "workerValidationEnabled": false,
      "finalValidationRequired": true
    }
  }
}
```

Future Master Template v2.6 plans should treat `targetCommand` as a final validation input only.

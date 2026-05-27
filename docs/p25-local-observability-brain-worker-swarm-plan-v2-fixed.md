# P25 — Local Production Observability & Brain Worker Swarm

**Version:** 3.0.0  
**Last updated:** 2026-05-27  
**Contract version:** 4.0.0  
**Execution class:** implementation  
**Total workspaces:** 21  
**Primary goal:** Make Pi locally stable, observable, self-debugging, idea-generating, and capable of routing work to specialized brain workers without runaway loops.

**v3.0 migration:** Rewritten from v2 mechanism-heavy format (2.5.0) to v4 intent-driven contract (4.0.0). Mechanism fields (worktree, integration queue, validation lanes, parallelism review, scale modes) are removed — the ExecutionKernel derives them from `intent.parallelism`, `intent.safetyLevel`, and `intent.conflictRisk`. See [llm-implementation-agent-master-template.md](llm-implementation-agent-master-template.md) for the canonical v4 template.

**v1.1 fix (preserved):** Narrowed each workspace `writeSet`, `allowedFiles`, and `canEdit` list to prevent same-batch file conflicts. Batch 1 workspaces 25.A, 25.C, and 25.E have non-overlapping file ownership.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P25
**Title:** Local Production Observability & Brain Worker Swarm
**One-line goal:** Pi can see itself, debug itself, generate better ideas, assign specialized brain workers, propose fixes, and prove the loop is stable locally.
**Intent:** parallelism=6, safetyLevel=strict, conflictRisk=medium, executionEnvironment=trusted_local
**Why now:** P24 makes Pi proactive as a daily driver. P25 makes that proactive system observable, debuggable, and locally stable enough to run every day.
**Blast radius:** packages/coding-agent/, packages/web-server/, packages/web-ui/dashboard/, packages/db/, docs/, and reports/.
**Rollback path:** Disable the Brain Orchestrator Supervisor and worker pipelines behind local feature flags.
**Derived mechanisms:** worktree isolation required, integration queue required, admission gate strict mode, deadline watchdog active, handoff queue required.
**Done when:** Pi passes the brain-worker swarm dogfood gauntlet and produces a final local stability report.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P25` |
| Title | `Local Production Observability & Brain Worker Swarm` |
| Status | `Planned` |
| Last updated | `2026-05-27` |
| Delivery status | `Not started` |
| Target environment | `Local production / local daily-driver` |
| Primary focus | `Observability, specialized brain workers, self-debugging, idea generation, loop prevention` |
| Product-code changes | `Allowed` |
| Contract version | `4.0.0` |
| Execution class | `implementation` |
| Intent: parallelism | `6` |
| Intent: safetyLevel | `strict` |
| Intent: conflictRisk | `medium` |
| Intent: executionEnvironment | `trusted_local` |
| Expected DAG effective parallelism | `3.5 average, 6 peak` |
| Expected safe effective parallelism | `3.33 average, 5 peak` |
| Security posture | `Local safety only; no enterprise/cloud security scope` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| Observability schema/store/UI | Implementing agent | Lead operator | User | Dashboard users |
| Brain worker contracts and workers | Implementing agent | Lead operator | User | Pi brain modules |
| Closed-loop debug/fix/idea pipelines | Implementing agent | Lead operator | User | Future phases |
| Readiness doctor and dogfood | Implementing agent | Lead operator | User | Future operators |

---

## 2. Purpose

P25 is the local production stability phase for Pi after P24. The target is not cloud deployment, enterprise security, or multi-user RBAC. The target is local autonomous operational intelligence: Pi should understand what is happening inside itself, diagnose failures, assign specialized brain workers, generate improvement ideas, propose fixes, synthesize executable plans, and prove that all of this can run safely without spam or infinite loops.

P25 turns the existing cognitive OS and execution engine into an inspectable, workerized operations layer. The observer layer collects execution, scheduler, validation, queue, brain, overnight, proposal, reflection, and memory events. The worker layer routes those events to specialized workers. The closed-loop layer turns diagnostics and ideas into proposals and executable plans through normal approval and validation gates.

The key product shift is from passive observability to active self-debugging. Pi should not merely display that a workspace failed. It should assemble a diagnostic packet, assign the Debugger Worker, produce a root-cause hypothesis, assign the Fix Strategist Worker, create a bounded fix proposal, and then route that proposal through existing plan/execution controls.

---

## 3. What Carried Over — Must Stay Stable

- ExecutionKernel invariants apply and cannot be overridden (see master template section 2).
- PostgreSQL is authoritative for structured runtime state; JSON runtime fallback is forbidden in production.
- Actors emit events only; WorkspaceAttemptController is the only attempt state writer.
- Retry requires terminal previous attempt; retry during RUNNING is rejected.
- Every non-terminal attempt state has a deadline enforced by DeadlineWatchdog.
- HANDOFF_REQUIRED is terminal and creates a durable handoff_queue item.
- PlanCompletionPredicate gates plan completion; unresolved handoffs block COMPLETED.
- AdmissionGate covers all execution entrypoints (CLI, dashboard, API, retry, brain triggers).
- `git push` remains forbidden.
- Raw destructive cleanup remains forbidden.
- Watch-mode validation remains forbidden.
- Brain memory, proposal, reflection, policy, audit, and overnight APIs remain backward-compatible.
- Existing P24 daily intelligence surfaces must not regress.
- P32 dogfood harness proves kernel invariants (stable_1 gate, stable_3 dogfood, stable_6 stress).

### v3.0 change

Removed mechanism-specific references (worktree isolation, integration queue, validation lock, completion gate). These are now derived from intent by the ExecutionProfileDeriver and owned by the ExecutionKernel. Plans do not configure them.

---

## 4. Background / What Was Wrong

After P24, Pi becomes proactive. It has morning digests, brain surfacing, notifications, inboxes, feedback loops, staleness detection, and daily-driver behavior. But a proactive local system needs operational self-awareness. Without P25, Pi can surface useful information but still struggle to answer deeper operational questions:

- Why did this workspace fail?
- Which subsystem owns the failure?
- Did this happen before?
- Which worker should investigate?
- Is this fix safe?
- Is this idea new or duplicate?
- Did Pi just create a loop?
- Can Pi recover after a local restart?
- Can I trust the worker swarm to run overnight or daily?

P25 closes that gap by creating a local observability substrate and a specialist worker swarm.

---

## 5. Current Failure State / Known Blockers

- `local_observability_event_schema` = not implemented as a single canonical layer.
- `trace_correlation_across_brain_and_execution` = incomplete.
- `brain_worker_contracts` = not implemented.
- `worker_supervisor` = not implemented as a durable local job orchestrator.
- `debugger_worker` = not implemented.
- `fix_strategist_worker` = not implemented.
- `idea_scout_worker` = not implemented.
- `plan_synthesizer_worker` = not implemented as a specialist worker.
- `worker_handoff_inbox` = not implemented.
- `loop_prevention_for_worker_swarm` = not implemented.
- `local_readiness_doctor_for_brain_workers` = not implemented.
- `brain_worker_swarm_dogfood_gauntlet` = not implemented.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Worker swarm creates repetitive proposals | medium | high | Dedupe windows, cooldowns, proposal scoring, loop-depth caps |
| Self-fix loop modifies too much | medium | high | Approval gates, diagnostic packet requirement, bounded fix strategy, validation gates |
| Observability volume gets noisy | medium | medium | Retention policy, severity levels, sampling, cockpit filtering |
| Worker job stuck after crash | medium | high | Durable job leases, resume/quarantine behavior, readiness doctor check |
| UI/API conflicts in dashboard workspaces | medium | medium | Worktree isolation, integration queue, conflict handoff |
| Validation lock limits throughput | medium | medium | Continuous scheduling with safe refill; lock-aware validation |
| Dogfood gauntlet becomes flaky | medium | medium | Deterministic fixtures and explicit scenario assertions |
| Raw cleanup deletes wrong files | low | critical | Raw destructive cleanup forbidden; scoped cleanup only |
| Forbidden files accessed by diagnostics | low | critical | Forbidden-file policies remain active |

---

## 7. Workstreams

### 25.A — Observability event schema, trace IDs, and correlation model

**Type:** backend  
**Dependencies:** None  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Define the canonical local observability event envelope, trace IDs, correlation IDs, source taxonomy, severity levels, and cross-subsystem event metadata.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.C — Brain worker contracts, roles, manifests, and lifecycle states

**Type:** backend  
**Dependencies:** None  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Define specialist brain worker roles, manifests, capabilities, job lifecycle states, input/output contracts, and worker result types.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.E — Diagnostic packet and evidence model

**Type:** backend  
**Dependencies:** None  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Create a structured diagnostic packet model for failures, traces, logs, test output, plan metadata, suspected subsystem, confidence, and evidence references.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.B — Local telemetry store, retention, and query API

**Type:** backend  
**Dependencies:** 25.A  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Persist local observability events with retention controls and expose query APIs for traces, health, subsystem activity, and recent incidents.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.D — Brain Orchestrator Supervisor

**Type:** backend  
**Dependencies:** 25.A, 25.C  
**Queue priority:** critical  
**Risk:** high

**Goal:** Implement the local supervisor that routes jobs to specialist brain workers, manages leases, cooldowns, job states, health, retries, and audit events.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.F — Execution engine collectors

**Type:** backend  
**Dependencies:** 25.A, 25.E  
**Queue priority:** high  
**Risk:** medium

**Goal:** Collect execution engine, scheduler, validation, worktree, integration queue, worker, and cleanup events into the local observability stream.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.G — Brain, overnight, and proposal collectors

**Type:** backend  
**Dependencies:** 25.A, 25.E  
**Queue priority:** high  
**Risk:** medium

**Goal:** Collect brain observations, memory changes, proposal activity, reflections, policy/audit signals, and overnight orchestrator events.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.I — Debugger Worker

**Type:** worker  
**Dependencies:** 25.C, 25.E  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Implement a specialist worker that consumes diagnostic packets and emits root-cause hypotheses, evidence summaries, likely subsystem owner, confidence, and next actions.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.K — Idea Scout Worker

**Type:** worker  
**Dependencies:** 25.A, 25.C  
**Queue priority:** high  
**Risk:** medium

**Goal:** Implement a specialist worker that scans reflections, repeated failures, user dismissals, stale work, and activity trends to propose new improvement ideas.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.H — Local Observability Cockpit UI

**Type:** fullstack  
**Dependencies:** 25.B, 25.F, 25.G  
**Queue priority:** high  
**Risk:** medium

**Goal:** Add a local dashboard cockpit for traces, system health, worker activity, recent incidents, queue state, brain activity, and observability search.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.J — Fix Strategist Worker

**Type:** worker  
**Dependencies:** 25.I  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Implement a specialist worker that turns debugger hypotheses into bounded fix proposals with affected files, risk level, test plan, rollback, and workspace split suggestions.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.L — Regression Hunter Worker

**Type:** worker  
**Dependencies:** 25.F, 25.I  
**Queue priority:** high  
**Risk:** medium

**Goal:** Implement a specialist worker that clusters repeated test failures, flaky behavior, fragile files, retry loops, and recurring breakage patterns.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.M — Memory Curator Worker

**Type:** worker  
**Dependencies:** 25.G, 25.K  
**Queue priority:** high  
**Risk:** medium

**Goal:** Implement a specialist worker that reviews stale memories, duplicate memories, contradictory memories, and promotion/demotion candidates.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.N — Plan Synthesizer Worker

**Type:** worker  
**Dependencies:** 25.C, 25.K  
**Queue priority:** high  
**Risk:** medium

**Goal:** Implement a specialist worker that turns approved improvement ideas into executable markdown plans with JSON contracts, DAGs, queue priorities, acceptance criteria, and rollback.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.O — Worker handoff inbox and triage router

**Type:** fullstack  
**Dependencies:** 25.B, 25.D, 25.I, 25.K  
**Queue priority:** critical  
**Risk:** high

**Goal:** Create a persistent local inbox for worker findings and a triage router that assigns diagnostics, ideas, memory issues, and regression signals to the correct worker.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.P — Debug to fix proposal pipeline

**Type:** backend  
**Dependencies:** 25.O, 25.J, 25.L  
**Queue priority:** critical  
**Risk:** high

**Goal:** Connect observability failures to Debugger Worker, Fix Strategist Worker, proposal creation, approval gates, validation plans, and execution handoff.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.Q — Idea to proposal to plan pipeline

**Type:** backend  
**Dependencies:** 25.O, 25.N, 25.M  
**Queue priority:** high  
**Risk:** high

**Goal:** Connect Idea Scout and Memory Curator outputs into proposal scoring, dedupe, approval, and Plan Synthesizer execution-plan generation.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.R — Budgets, cooldowns, backoff, and loop prevention

**Type:** backend  
**Dependencies:** 25.D, 25.O  
**Queue priority:** critical  
**Risk:** high

**Goal:** Prevent runaway autonomous loops with per-worker budgets, daily caps, dedupe windows, cooldowns, backoff, recursion depth limits, and stop conditions.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.S — Worker crash recovery and job resumption

**Type:** backend  
**Dependencies:** 25.B, 25.D, 25.O  
**Queue priority:** critical  
**Risk:** high

**Goal:** Persist worker job leases and recover or quarantine in-flight worker jobs after local server restart, crash, or partial failure.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.T — Local Production Readiness Doctor

**Type:** fullstack  
**Dependencies:** 25.H, 25.P, 25.Q, 25.R, 25.S  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Create a doctor command and dashboard panel that verifies local observability, worker routing, recovery, loop prevention, proposal quality, and readiness to run every day.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.

### 25.U — Brain Worker Swarm Dogfood and Final Stability Report

**Type:** qa  
**Dependencies:** 25.T  
**Queue priority:** critical  
**Risk:** medium

**Goal:** Run the local brain-worker gauntlet: failed workspace, stuck queue, bad proposal, duplicate idea, stale memory, worker crash, failed validation, successful self-fix, and successful idea-to-plan generation.

**Acceptance criteria:**
- Implements the workspace capability without breaking existing P6/P6.5/P11/P13-P20 behavior.
- Emits or consumes traceable observability events where relevant.
- Produces evidence-backed diagnostics, worker outputs, or UI states rather than silent failures.
- Adds targeted tests or dogfood checks.
- Respects local safety constraints: no `git push`, no raw destructive cleanup, no watch-mode validation.


---

## 8. Combined Implementation Order

```text
Batch 1:
  25.A  Observability event schema, trace IDs, correlation model
  25.C  Brain worker contracts, manifests, lifecycle states
  25.E  Diagnostic packet and evidence model

Batch 2:
  25.B  Local telemetry store, retention, query API
  25.D  Brain Orchestrator Supervisor
  25.F  Execution engine collectors
  25.G  Brain / overnight / proposal collectors
  25.I  Debugger Worker
  25.K  Idea Scout Worker

Batch 3:
  25.H  Local Observability Cockpit UI
  25.J  Fix Strategist Worker
  25.L  Regression Hunter Worker
  25.M  Memory Curator Worker
  25.N  Plan Synthesizer Worker
  25.O  Worker handoff inbox and triage router

Batch 4:
  25.P  Debug -> fix proposal pipeline
  25.Q  Idea -> proposal -> plan pipeline
  25.R  Budgets, cooldowns, backoff, loop prevention
  25.S  Worker crash recovery and job resumption

Batch 5:
  25.T  Local Production Readiness Doctor

Batch 6:
  25.U  Brain Worker Swarm Dogfood + Final Stability Report
```

Continuous scheduling is enabled. These batches are DAG previews and review artifacts, not runtime barriers. The scheduler should fill all six worktree slots when ready work exists and refill slots as soon as workspaces complete.

---

## 9. Definition of Done

P25 is complete when all are true:

- Pi emits canonical local observability events across execution, scheduler, validation, queue, brain, overnight, proposal, reflection, and memory systems.
- Trace IDs and correlation IDs connect failures to diagnostic packets, worker jobs, proposals, and plans.
- The Brain Orchestrator Supervisor can route jobs to specialist workers.
- Debugger Worker produces root-cause hypotheses with evidence and confidence.
- Fix Strategist Worker produces bounded fix proposals with risk, test plan, rollback, and affected files.
- Idea Scout Worker produces deduped improvement ideas.
- Regression Hunter Worker clusters repeated failures and flaky patterns.
- Memory Curator Worker identifies stale, duplicate, and conflicting memories.
- Plan Synthesizer Worker produces executable plan drafts with valid JSON contracts.
- Worker handoff inbox shows pending, completed, failed, and quarantined worker outputs.
- Debug-to-fix and idea-to-plan pipelines route through proposal/approval/validation gates.
- Budgets, cooldowns, backoff, and loop prevention block runaway autonomous behavior.
- Worker jobs can recover or quarantine after local restart.
- Local Production Readiness Doctor passes.
- Brain Worker Swarm Dogfood report is generated and signed off.
- No forbidden commands or files were used.
- Validation gates passed.
- ExecutionKernel invariants are preserved (P32 dogfood harness passes).

### v3.0 change

Removed mechanism-specific wording about worktree, integration queue, and completion gates. These are enforced by the ExecutionKernel, not the plan.

---

## 10. Rollback Playbook

**Trigger conditions:**

- Worker swarm generates duplicate or runaway proposals.
- Debug/fix pipeline bypasses approval or validation.
- Worker jobs are not recoverable after restart.
- Observability collection causes instability or excessive volume.
- Readiness doctor reports false-safe status.
- Dogfood gauntlet fails on critical safety scenarios.

**Rollback procedure:**

1. Disable Brain Orchestrator Supervisor feature flag.
2. Disable closed-loop pipelines `25.P` and `25.Q`.
3. Leave telemetry store read-only for debugging.
4. Preserve worker job ledger and diagnostic packets.
5. Stop worker job scheduling and quarantine in-flight jobs.
6. Fall back to P24 daily intelligence layer only.
7. Run cleanup/recovery doctor.
8. Revert phase commits independently if needed.

---

## 11. What Next Phase Inherits

The next phase inherits:

- Canonical local observability event model.
- Trace/correlation ID model.
- Local telemetry store and dashboard cockpit.
- Specialist brain worker contracts.
- Debugger, Fix Strategist, Idea Scout, Regression Hunter, Memory Curator, and Plan Synthesizer workers.
- Worker handoff inbox and triage router.
- Debug-to-fix and idea-to-plan pipelines.
- Loop prevention and worker crash recovery.
- Local Production Readiness Doctor.
- Brain worker swarm dogfood report.

---

# Part 2 — Agent Brief

## Mission

Implement P25: Local Production Observability & Brain Worker Swarm.

You are adding the layer that lets Pi observe itself, diagnose itself, route work to specialist brain workers, generate fix and improvement proposals, synthesize plans, prevent loops, recover jobs after restart, and prove the system is locally stable.

Optimize for safe local autonomy, not cloud production. Do not implement enterprise RBAC, public API hardening, remote deployment, or external canary rollout. Preserve local safety constraints and all existing execution/brain guarantees.

## Hard Requirements

1. Do not exceed 6 requested workers.
2. Do not run more than 3 workers unless worktree isolation and integration queue readiness pass.
3. Do not merge workspace output without passed workspace validation.
4. Do not mark the plan complete if integration validation fails.
5. Do not treat merge conflict as ordinary worker failure.
6. Do not start the next plan while integration queue state is dirty.
7. Do not run watch-mode validation.
8. Do not run `git push`.
9. Do not run raw destructive cleanup commands.
10. Do not access secrets or forbidden files.
11. The executor remains the only component that mutates execution state.
12. Every worker job must have a trace ID or correlation ID.
13. Every self-fix proposal must include an evidence-backed diagnostic packet.
14. Every autonomous loop must have budgets, cooldowns, dedupe, and stop conditions.
15. Worker outputs must be inspectable in the handoff inbox or persisted artifacts.
16. Readiness Doctor must fail closed when evidence is missing.

## Execution Policies

```yaml
scale:
  selected_mode: experimental_6
  max_parallel_workspaces: 6
  worktree_required: true
  integration_queue_required: true
  validation_lock_required: true

scheduling:
  continuous: true
  slot_count: 6
  priority_strategy: critical_path_first

local_safety:
  git_push_allowed: false
  raw_destructive_cleanup_allowed: false
  watch_mode_validation_allowed: false
  forbidden_files_enforced: true
  approval_required_for_risky_mutations: true

worker_swarm:
  worker_jobs_require_trace_id: true
  diagnostic_packet_required_for_self_fix: true
  budgets_required: true
  cooldowns_required: true
  loop_prevention_required: true
  job_recovery_required: true
```

## Safety Stops

Hard stop execution for:

- Dependency cycles.
- Invalid dependency patches.
- Required preflight review not approved.
- Stale approved graph hash.
- Worktree path escaping `.pi/worktrees`.
- Raw destructive worktree cleanup.
- Integration merge without passed workspace validation.
- Integration validation failure.
- Merge conflict without handoff artifact.
- Unsafe scale mode.
- Queue starting next plan while integration queue is dirty.
- Forbidden file access.
- Secrets access.
- `git push`.
- Watch-mode validation command.
- Queue optimization enabled with invalid strategy.
- Worker job created without trace ID.
- Self-fix proposal created without diagnostic evidence.
- Autonomous loop without budget/cooldown/stop condition.
- Readiness doctor passing without required evidence.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.5.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "p25",
      "local-production",
      "observability",
      "brain-worker-swarm",
      "self-debugging"
    ]
  },
  "planExecution": {
    "phase": "P25",
    "title": "Local Production Observability and Brain Worker Swarm",
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
    },
    "planIntake": {
      "enabled": true,
      "runOnUpload": true,
      "parserPriority": [
        "part3_json",
        "markdown_fallback"
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
      "autonomous_loop_without_budget",
      "worker_job_without_trace_id",
      "self_fix_without_evidence_packet"
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
      "warnings": [
        "Execution requires worktree isolation, integration queue, validation lock, archive support, and completion gate hardening.",
        "Scale_8 is intentionally not selected for this phase; P25 should prove local experimental_6 stability first."
      ],
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
          "message": "Required for safe parallel validation."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required before final plan completion."
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 4,
    "expectedSafeEffectiveParallelismMin": 4,
    "dagEffectiveParallelism": 3.5,
    "safeEffectiveParallelism": 3.67,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches_display_only",
    "safeBatchingStrategy": "dag_batches_with_p6_safety_constraints_display_only",
    "batchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "25.A",
            "25.C",
            "25.E"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 2,
          "workspaceIds": [
            "25.B",
            "25.D",
            "25.F",
            "25.G",
            "25.I",
            "25.K"
          ],
          "effectiveParallelism": 6
        },
        {
          "batch": 3,
          "workspaceIds": [
            "25.H",
            "25.J",
            "25.L",
            "25.M",
            "25.N",
            "25.O"
          ],
          "effectiveParallelism": 6
        },
        {
          "batch": 4,
          "workspaceIds": [
            "25.P",
            "25.Q",
            "25.R",
            "25.S"
          ],
          "effectiveParallelism": 4
        },
        {
          "batch": 5,
          "workspaceIds": [
            "25.T"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 6,
          "workspaceIds": [
            "25.U"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 3.5,
      "criticalPath": [
        "25.E",
        "25.I",
        "25.J",
        "25.P",
        "25.T",
        "25.U"
      ],
      "criticalPathLength": 6,
      "serializedTailLength": 2
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "workspaceIds": [
            "25.A",
            "25.C",
            "25.E"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": [
            "25.B",
            "25.D",
            "25.F",
            "25.G",
            "25.I",
            "25.K"
          ],
          "safeEffectiveParallelism": 5,
          "blockedParallelismReasons": [
            "25.D and worker-oriented workspaces may contend on orchestrator worker type exports.",
            "Heavy validation commands must respect the global validation lock."
          ]
        },
        {
          "batch": 3,
          "workspaceIds": [
            "25.H",
            "25.J",
            "25.L",
            "25.M",
            "25.N",
            "25.O"
          ],
          "safeEffectiveParallelism": 5,
          "blockedParallelismReasons": [
            "25.H and 25.O may both touch dashboard navigation and worker inbox API clients.",
            "Worker implementations may share core worker contract exports."
          ]
        },
        {
          "batch": 4,
          "workspaceIds": [
            "25.P",
            "25.Q",
            "25.R",
            "25.S"
          ],
          "safeEffectiveParallelism": 4,
          "blockedParallelismReasons": [
            "Pipeline integration must use the integration queue for safe merge ordering."
          ]
        },
        {
          "batch": 5,
          "workspaceIds": [
            "25.T"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "Readiness doctor depends on all closed-loop automation work."
          ]
        },
        {
          "batch": 6,
          "workspaceIds": [
            "25.U"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": [
            "Dogfood gauntlet must run after readiness doctor."
          ]
        }
      ],
      "overallSafeEffectiveParallelism": 3.67,
      "bottlenecks": [
        "Readiness doctor and dogfood gauntlet are intentionally serialized.",
        "Validation lock may reduce safe parallelism during heavy test runs.",
        "Integration queue serializes merges even when workspace execution is parallel."
      ],
      "blockedParallelismReasons": [
        "Continuous scheduling is enabled, so batches are a preview only.",
        "Integration queue serializes merges even when workspace execution is parallel.",
        "Critical-path workspaces should merge before leaf workspaces."
      ]
    },
    "optimizationReview": {
      "originalGraphHash": null,
      "proposedGraphHash": null,
      "approvedGraphHash": null,
      "originalDagEffectiveParallelism": 3.5,
      "proposedDagEffectiveParallelism": null,
      "originalSafeEffectiveParallelism": 3.33,
      "proposedSafeEffectiveParallelism": null,
      "criticalPathDelta": null,
      "serializedTailDelta": null,
      "suggestions": [
        {
          "type": "fixed",
          "message": "v2 narrows writeSet and allowedFiles per workspace so Batch 1 can start 25.A, 25.C, and 25.E together."
        },
        {
          "type": "review",
          "message": "Do not broaden writeSet/allowedFiles back to repo-wide globs; that will cause safe scheduler serialization."
        },
        {
          "type": "review",
          "message": "Do not split 25.T or 25.U; both are intended release gates."
        }
      ],
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
      "long_serialized_tail",
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "critical_path_workspace_has_low_priority",
      "worker_loop_without_budget",
      "worker_job_without_trace_id",
      "diagnostic_packet_missing_evidence",
      "readiness_doctor_missing_gate"
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
      "worktree_state",
      "local_observability_events",
      "worker_job_ledger",
      "diagnostic_packets",
      "readiness_doctor_report",
      "brain_worker_swarm_dogfood_report",
      "workspace_file_ownership_matrix"
    ]
  },
  "workspaces": [
    {
      "id": "25.A",
      "title": "Observability event schema, trace IDs, and correlation model",
      "dependencies": [],
      "hardDeps": [],
      "softDeps": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "No dependencies; this workspace defines a foundation.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/test/**",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/test/observability/schema.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [
          "25.C",
          "25.E"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "observability-types",
          "trace-correlation",
          "event-schema"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.A is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/test/observability/schema.test.ts"
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
        "25.A implements Observability event schema, trace IDs, and correlation model without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/observability/schema.ts",
          "packages/coding-agent/src/observability/correlation.ts",
          "packages/coding-agent/src/observability/types.ts",
          "packages/coding-agent/src/observability/index.ts",
          "packages/coding-agent/test/observability/schema.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.C",
      "title": "Brain worker contracts, roles, manifests, and lifecycle states",
      "dependencies": [],
      "hardDeps": [],
      "softDeps": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "No dependencies; this workspace defines a foundation.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/test/**",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/test/brain-workers/contracts.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [
          "25.A",
          "25.E"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "brain-worker-types",
          "worker-lifecycle",
          "worker-manifest"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.C is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/test/brain-workers/contracts.test.ts"
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
        "25.C implements Brain worker contracts, roles, manifests, and lifecycle states without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/contracts.ts",
          "packages/coding-agent/src/brain-workers/lifecycle.ts",
          "packages/coding-agent/src/brain-workers/types.ts",
          "packages/coding-agent/test/brain-workers/contracts.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.E",
      "title": "Diagnostic packet and evidence model",
      "dependencies": [],
      "hardDeps": [],
      "softDeps": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "No dependencies; this workspace defines a foundation.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/test/**",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
        "packages/coding-agent/src/diagnostics/evidence.ts",
        "packages/coding-agent/src/diagnostics/root-cause.ts",
        "packages/coding-agent/src/diagnostics/index.ts",
        "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [
          "25.A",
          "25.C"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "diagnostic-packet",
          "evidence-model",
          "root-cause-types"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.E is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
        "packages/coding-agent/src/diagnostics/evidence.ts",
        "packages/coding-agent/src/diagnostics/root-cause.ts",
        "packages/coding-agent/src/diagnostics/index.ts",
        "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts"
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
        "25.E implements Diagnostic packet and evidence model without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
          "packages/coding-agent/src/diagnostics/evidence.ts",
          "packages/coding-agent/src/diagnostics/root-cause.ts",
          "packages/coding-agent/src/diagnostics/index.ts",
          "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.B",
      "title": "Local telemetry store, retention, and query API",
      "dependencies": [
        "25.A"
      ],
      "hardDeps": [
        "25.A"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.A.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/observability/schema.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/observability/store/telemetry-store.ts",
        "packages/coding-agent/src/observability/store/retention.ts",
        "packages/coding-agent/src/observability/store/query.ts",
        "packages/coding-agent/test/observability/telemetry-store.test.ts",
        "packages/web-server/src/observability-routes.ts",
        "packages/web-server/test/observability-routes.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.D",
          "25.F",
          "25.G",
          "25.I",
          "25.K"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "telemetry-store",
          "retention-policy",
          "telemetry-query-api"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.B is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/observability/store/telemetry-store.ts",
        "packages/coding-agent/src/observability/store/retention.ts",
        "packages/coding-agent/src/observability/store/query.ts",
        "packages/coding-agent/test/observability/telemetry-store.test.ts",
        "packages/web-server/src/observability-routes.ts",
        "packages/web-server/test/observability-routes.test.ts"
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
        "25.B implements Local telemetry store, retention, and query API without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/observability/store/telemetry-store.ts",
          "packages/coding-agent/src/observability/store/retention.ts",
          "packages/coding-agent/src/observability/store/query.ts",
          "packages/coding-agent/test/observability/telemetry-store.test.ts",
          "packages/web-server/src/observability-routes.ts",
          "packages/web-server/test/observability-routes.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.D",
      "title": "Brain Orchestrator Supervisor",
      "dependencies": [
        "25.A",
        "25.C"
      ],
      "hardDeps": [
        "25.A",
        "25.C"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.A, 25.C.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/contracts.test.ts",
        "packages/coding-agent/test/observability/schema.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
        "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
        "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
        "packages/coding-agent/test/brain-workers/supervisor.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.B",
          "25.F",
          "25.G",
          "25.I",
          "25.K"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "brain-orchestrator",
          "worker-scheduler",
          "worker-health"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.D is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
        "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
        "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
        "packages/coding-agent/test/brain-workers/supervisor.test.ts"
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
        "25.D implements Brain Orchestrator Supervisor without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
          "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
          "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
          "packages/coding-agent/test/brain-workers/supervisor.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.F",
      "title": "Execution engine collectors",
      "dependencies": [
        "25.A",
        "25.E"
      ],
      "hardDeps": [
        "25.A",
        "25.E"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.A, 25.E.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
        "packages/coding-agent/src/diagnostics/evidence.ts",
        "packages/coding-agent/src/diagnostics/index.ts",
        "packages/coding-agent/src/diagnostics/root-cause.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts",
        "packages/coding-agent/test/observability/schema.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/observability/collectors/execution/execution-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/scheduler-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/validation-collector.ts",
        "packages/coding-agent/test/observability/execution-collectors.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.B",
          "25.D",
          "25.G",
          "25.I",
          "25.K"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "execution-collectors",
          "scheduler-events",
          "workspace-events"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.F is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/observability/collectors/execution/execution-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/scheduler-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/validation-collector.ts",
        "packages/coding-agent/test/observability/execution-collectors.test.ts"
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
        "25.F implements Execution engine collectors without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/observability/collectors/execution/execution-collector.ts",
          "packages/coding-agent/src/observability/collectors/execution/scheduler-collector.ts",
          "packages/coding-agent/src/observability/collectors/execution/validation-collector.ts",
          "packages/coding-agent/test/observability/execution-collectors.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.G",
      "title": "Brain, overnight, and proposal collectors",
      "dependencies": [
        "25.A",
        "25.E"
      ],
      "hardDeps": [
        "25.A",
        "25.E"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.A, 25.E.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
        "packages/coding-agent/src/diagnostics/evidence.ts",
        "packages/coding-agent/src/diagnostics/index.ts",
        "packages/coding-agent/src/diagnostics/root-cause.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts",
        "packages/coding-agent/test/observability/schema.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/observability/collectors/brain/brain-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/overnight-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/proposal-collector.ts",
        "packages/coding-agent/test/observability/brain-collectors.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.B",
          "25.D",
          "25.F",
          "25.I",
          "25.K"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "brain-collectors",
          "overnight-events",
          "proposal-events"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.G is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/observability/collectors/brain/brain-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/overnight-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/proposal-collector.ts",
        "packages/coding-agent/test/observability/brain-collectors.test.ts"
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
        "25.G implements Brain, overnight, and proposal collectors without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/observability/collectors/brain/brain-collector.ts",
          "packages/coding-agent/src/observability/collectors/brain/overnight-collector.ts",
          "packages/coding-agent/src/observability/collectors/brain/proposal-collector.ts",
          "packages/coding-agent/test/observability/brain-collectors.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.I",
      "title": "Debugger Worker",
      "dependencies": [
        "25.C",
        "25.E"
      ],
      "hardDeps": [
        "25.C",
        "25.E"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.C, 25.E.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/src/diagnostics/diagnostic-packet.ts",
        "packages/coding-agent/src/diagnostics/evidence.ts",
        "packages/coding-agent/src/diagnostics/index.ts",
        "packages/coding-agent/src/diagnostics/root-cause.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/contracts.test.ts",
        "packages/coding-agent/test/diagnostics/diagnostic-packet.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
        "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
        "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
        "packages/coding-agent/test/brain-workers/debugger-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.B",
          "25.D",
          "25.F",
          "25.G",
          "25.K"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "debugger-worker",
          "diagnostic-analysis",
          "root-cause-hypotheses"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.I is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
        "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
        "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
        "packages/coding-agent/test/brain-workers/debugger-worker.test.ts"
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
        "25.I implements Debugger Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
          "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
          "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
          "packages/coding-agent/test/brain-workers/debugger-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.K",
      "title": "Idea Scout Worker",
      "dependencies": [
        "25.A",
        "25.C"
      ],
      "hardDeps": [
        "25.A",
        "25.C"
      ],
      "softDeps": [],
      "parallelGroup": "batch_2",
      "dependencyReason": "Requires completed outputs from 25.A, 25.C.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/src/observability/correlation.ts",
        "packages/coding-agent/src/observability/index.ts",
        "packages/coding-agent/src/observability/schema.ts",
        "packages/coding-agent/src/observability/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/contracts.test.ts",
        "packages/coding-agent/test/observability/schema.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
        "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "25.B",
          "25.D",
          "25.F",
          "25.G",
          "25.I"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "idea-scout-worker",
          "idea-generation",
          "improvement-signals"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.K is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
        "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts"
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
        "25.K implements Idea Scout Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
          "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
          "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
          "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.H",
      "title": "Local Observability Cockpit UI",
      "dependencies": [
        "25.B",
        "25.F",
        "25.G"
      ],
      "hardDeps": [
        "25.B",
        "25.F",
        "25.G"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.B, 25.F, 25.G.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/observability/collectors/brain/brain-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/overnight-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/proposal-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/execution-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/scheduler-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/validation-collector.ts",
        "packages/coding-agent/src/observability/store/query.ts",
        "packages/coding-agent/src/observability/store/retention.ts",
        "packages/coding-agent/src/observability/store/telemetry-store.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/observability/brain-collectors.test.ts",
        "packages/coding-agent/test/observability/execution-collectors.test.ts",
        "packages/coding-agent/test/observability/telemetry-store.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/observability-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/observability-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
        "packages/web-ui/dashboard/src/features/observability/TraceTimeline.tsx",
        "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
        "packages/web-ui/dashboard/src/hooks/useObservability.ts",
        "packages/web-ui/dashboard/src/types-observability.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.J",
          "25.L",
          "25.M",
          "25.N",
          "25.O"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "observability-ui",
          "dashboard-navigation",
          "telemetry-api-client"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.H is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
        "packages/web-ui/dashboard/src/features/observability/TraceTimeline.tsx",
        "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
        "packages/web-ui/dashboard/src/hooks/useObservability.ts",
        "packages/web-ui/dashboard/src/types-observability.ts"
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
        "25.H implements Local Observability Cockpit UI without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
          "packages/web-ui/dashboard/src/features/observability/TraceTimeline.tsx",
          "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
          "packages/web-ui/dashboard/src/hooks/useObservability.ts",
          "packages/web-ui/dashboard/src/types-observability.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.J",
      "title": "Fix Strategist Worker",
      "dependencies": [
        "25.I"
      ],
      "hardDeps": [
        "25.I"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.I.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
        "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
        "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/debugger-worker.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/fix-strategist/fix-strategist-worker.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/patch-strategy.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/test-plan-generator.ts",
        "packages/coding-agent/test/brain-workers/fix-strategist-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.H",
          "25.L",
          "25.M",
          "25.N",
          "25.O"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "fix-strategist-worker",
          "patch-strategy",
          "test-plan-generation"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.J is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/fix-strategist/fix-strategist-worker.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/patch-strategy.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/test-plan-generator.ts",
        "packages/coding-agent/test/brain-workers/fix-strategist-worker.test.ts"
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
        "25.J implements Fix Strategist Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/fix-strategist/fix-strategist-worker.ts",
          "packages/coding-agent/src/brain-workers/fix-strategist/patch-strategy.ts",
          "packages/coding-agent/src/brain-workers/fix-strategist/test-plan-generator.ts",
          "packages/coding-agent/test/brain-workers/fix-strategist-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.L",
      "title": "Regression Hunter Worker",
      "dependencies": [
        "25.F",
        "25.I"
      ],
      "hardDeps": [
        "25.F",
        "25.I"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.F, 25.I.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
        "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
        "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
        "packages/coding-agent/src/observability/collectors/execution/execution-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/scheduler-collector.ts",
        "packages/coding-agent/src/observability/collectors/execution/validation-collector.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/debugger-worker.test.ts",
        "packages/coding-agent/test/observability/execution-collectors.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/regression-hunter/regression-hunter-worker.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/failure-clusterer.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/flaky-test-detector.ts",
        "packages/coding-agent/test/brain-workers/regression-hunter-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.H",
          "25.J",
          "25.M",
          "25.N",
          "25.O"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "regression-hunter-worker",
          "flaky-tests",
          "failure-clustering"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.L is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/regression-hunter/regression-hunter-worker.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/failure-clusterer.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/flaky-test-detector.ts",
        "packages/coding-agent/test/brain-workers/regression-hunter-worker.test.ts"
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
        "25.L implements Regression Hunter Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/regression-hunter/regression-hunter-worker.ts",
          "packages/coding-agent/src/brain-workers/regression-hunter/failure-clusterer.ts",
          "packages/coding-agent/src/brain-workers/regression-hunter/flaky-test-detector.ts",
          "packages/coding-agent/test/brain-workers/regression-hunter-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.M",
      "title": "Memory Curator Worker",
      "dependencies": [
        "25.G",
        "25.K"
      ],
      "hardDeps": [
        "25.G",
        "25.K"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.G, 25.K.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
        "packages/coding-agent/src/observability/collectors/brain/brain-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/overnight-collector.ts",
        "packages/coding-agent/src/observability/collectors/brain/proposal-collector.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts",
        "packages/coding-agent/test/observability/brain-collectors.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/memory-curator/memory-curator-worker.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/stale-memory-detector.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/conflict-review.ts",
        "packages/coding-agent/test/brain-workers/memory-curator-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.H",
          "25.J",
          "25.L",
          "25.N",
          "25.O"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "memory-curator-worker",
          "memory-dedupe",
          "memory-conflicts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.M is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/memory-curator/memory-curator-worker.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/stale-memory-detector.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/conflict-review.ts",
        "packages/coding-agent/test/brain-workers/memory-curator-worker.test.ts"
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
        "25.M implements Memory Curator Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/memory-curator/memory-curator-worker.ts",
          "packages/coding-agent/src/brain-workers/memory-curator/stale-memory-detector.ts",
          "packages/coding-agent/src/brain-workers/memory-curator/conflict-review.ts",
          "packages/coding-agent/test/brain-workers/memory-curator-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.N",
      "title": "Plan Synthesizer Worker",
      "dependencies": [
        "25.C",
        "25.K"
      ],
      "hardDeps": [
        "25.C",
        "25.K"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.C, 25.K.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/contracts.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
        "packages/coding-agent/src/brain-workers/lifecycle.ts",
        "packages/coding-agent/src/brain-workers/types.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/contracts.test.ts",
        "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/plan-synthesizer/plan-synthesizer-worker.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/dag-builder.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/template-renderer.ts",
        "packages/coding-agent/test/brain-workers/plan-synthesizer-worker.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.H",
          "25.J",
          "25.L",
          "25.M",
          "25.O"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "plan-synthesizer-worker",
          "plan-generation",
          "dag-generation"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.N is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/plan-synthesizer/plan-synthesizer-worker.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/dag-builder.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/template-renderer.ts",
        "packages/coding-agent/test/brain-workers/plan-synthesizer-worker.test.ts"
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
        "25.N implements Plan Synthesizer Worker without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/plan-synthesizer/plan-synthesizer-worker.ts",
          "packages/coding-agent/src/brain-workers/plan-synthesizer/dag-builder.ts",
          "packages/coding-agent/src/brain-workers/plan-synthesizer/template-renderer.ts",
          "packages/coding-agent/test/brain-workers/plan-synthesizer-worker.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.O",
      "title": "Worker handoff inbox and triage router",
      "dependencies": [
        "25.B",
        "25.D",
        "25.I",
        "25.K"
      ],
      "hardDeps": [
        "25.B",
        "25.D",
        "25.I",
        "25.K"
      ],
      "softDeps": [],
      "parallelGroup": "batch_3",
      "dependencyReason": "Requires completed outputs from 25.B, 25.D, 25.I, 25.K.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/debugger/debugger-worker.ts",
        "packages/coding-agent/src/brain-workers/debugger/evidence-summarizer.ts",
        "packages/coding-agent/src/brain-workers/debugger/root-cause-analyzer.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-deduper.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/idea-scout-worker.ts",
        "packages/coding-agent/src/brain-workers/idea-scout/signal-miner.ts",
        "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
        "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
        "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
        "packages/coding-agent/src/observability/store/query.ts",
        "packages/coding-agent/src/observability/store/retention.ts",
        "packages/coding-agent/src/observability/store/telemetry-store.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/debugger-worker.test.ts",
        "packages/coding-agent/test/brain-workers/idea-scout-worker.test.ts",
        "packages/coding-agent/test/brain-workers/supervisor.test.ts",
        "packages/coding-agent/test/observability/telemetry-store.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/observability-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/observability-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "25.H",
          "25.J",
          "25.L",
          "25.M",
          "25.N"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "worker-handoff-inbox",
          "triage-router",
          "worker-routing"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.O is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts"
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
        "25.O implements Worker handoff inbox and triage router without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
          "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
          "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
          "packages/web-server/src/brain-worker-routes.ts",
          "packages/web-server/test/brain-worker-routes.test.ts",
          "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
          "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.P",
      "title": "Debug to fix proposal pipeline",
      "dependencies": [
        "25.O",
        "25.J",
        "25.L"
      ],
      "hardDeps": [
        "25.O",
        "25.J",
        "25.L"
      ],
      "softDeps": [],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires completed outputs from 25.O, 25.J, 25.L.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/fix-strategist/fix-strategist-worker.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/patch-strategy.ts",
        "packages/coding-agent/src/brain-workers/fix-strategist/test-plan-generator.ts",
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/failure-clusterer.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/flaky-test-detector.ts",
        "packages/coding-agent/src/brain-workers/regression-hunter/regression-hunter-worker.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/fix-strategist-worker.test.ts",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/coding-agent/test/brain-workers/regression-hunter-worker.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-policy.ts",
        "packages/coding-agent/test/brain-workers/debug-to-fix-pipeline.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "25.Q",
          "25.R",
          "25.S"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "debug-fix-pipeline",
          "proposal-execution",
          "approval-gate"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.P is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-policy.ts",
        "packages/coding-agent/test/brain-workers/debug-to-fix-pipeline.test.ts"
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
        "25.P implements Debug to fix proposal pipeline without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-pipeline.ts",
          "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-policy.ts",
          "packages/coding-agent/test/brain-workers/debug-to-fix-pipeline.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.Q",
      "title": "Idea to proposal to plan pipeline",
      "dependencies": [
        "25.O",
        "25.N",
        "25.M"
      ],
      "hardDeps": [
        "25.O",
        "25.N",
        "25.M"
      ],
      "softDeps": [],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires completed outputs from 25.O, 25.N, 25.M.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/conflict-review.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/memory-curator-worker.ts",
        "packages/coding-agent/src/brain-workers/memory-curator/stale-memory-detector.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/dag-builder.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/plan-synthesizer-worker.ts",
        "packages/coding-agent/src/brain-workers/plan-synthesizer/template-renderer.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/coding-agent/test/brain-workers/memory-curator-worker.test.ts",
        "packages/coding-agent/test/brain-workers/plan-synthesizer-worker.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-policy.ts",
        "packages/coding-agent/test/brain-workers/idea-to-plan-pipeline.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "25.P",
          "25.R",
          "25.S"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "idea-plan-pipeline",
          "proposal-generation",
          "plan-factory"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "high priority because 25.Q is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-policy.ts",
        "packages/coding-agent/test/brain-workers/idea-to-plan-pipeline.test.ts"
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
        "25.Q implements Idea to proposal to plan pipeline without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-pipeline.ts",
          "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-policy.ts",
          "packages/coding-agent/test/brain-workers/idea-to-plan-pipeline.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.R",
      "title": "Budgets, cooldowns, backoff, and loop prevention",
      "dependencies": [
        "25.D",
        "25.O"
      ],
      "hardDeps": [
        "25.D",
        "25.O"
      ],
      "softDeps": [],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires completed outputs from 25.D, 25.O.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
        "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
        "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/coding-agent/test/brain-workers/supervisor.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/runtime/budget-controls.ts",
        "packages/coding-agent/src/brain-workers/runtime/cooldowns.ts",
        "packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts",
        "packages/coding-agent/test/brain-workers/loop-prevention.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "25.P",
          "25.Q",
          "25.S"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "budget-controls",
          "cooldowns",
          "loop-prevention"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.R is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/runtime/budget-controls.ts",
        "packages/coding-agent/src/brain-workers/runtime/cooldowns.ts",
        "packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts",
        "packages/coding-agent/test/brain-workers/loop-prevention.test.ts"
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
        "25.R implements Budgets, cooldowns, backoff, and loop prevention without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/runtime/budget-controls.ts",
          "packages/coding-agent/src/brain-workers/runtime/cooldowns.ts",
          "packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts",
          "packages/coding-agent/test/brain-workers/loop-prevention.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.S",
      "title": "Worker crash recovery and job resumption",
      "dependencies": [
        "25.B",
        "25.D",
        "25.O"
      ],
      "hardDeps": [
        "25.B",
        "25.D",
        "25.O"
      ],
      "softDeps": [],
      "parallelGroup": "batch_4",
      "dependencyReason": "Requires completed outputs from 25.B, 25.D, 25.O.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/inbox/handoff-inbox.ts",
        "packages/coding-agent/src/brain-workers/inbox/triage-router.ts",
        "packages/coding-agent/src/brain-workers/supervisor/job-lease.ts",
        "packages/coding-agent/src/brain-workers/supervisor/supervisor.ts",
        "packages/coding-agent/src/brain-workers/supervisor/worker-health.ts",
        "packages/coding-agent/src/observability/store/query.ts",
        "packages/coding-agent/src/observability/store/retention.ts",
        "packages/coding-agent/src/observability/store/telemetry-store.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/handoff-inbox.test.ts",
        "packages/coding-agent/test/brain-workers/supervisor.test.ts",
        "packages/coding-agent/test/observability/telemetry-store.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/brain-worker-routes.ts",
        "packages/web-server/src/observability-routes.ts",
        "packages/web-server/test/**",
        "packages/web-server/test/brain-worker-routes.test.ts",
        "packages/web-server/test/observability-routes.test.ts",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/brain-workers/WorkerInbox.tsx",
        "packages/web-ui/dashboard/src/hooks/useBrainWorkerInbox.ts",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/brain-workers/runtime/job-recovery.ts",
        "packages/coding-agent/src/brain-workers/runtime/job-state-store.ts",
        "packages/coding-agent/test/brain-workers/job-recovery.test.ts"
      ],
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "25.P",
          "25.Q",
          "25.R"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "worker-recovery",
          "job-leases",
          "resume-stranded-jobs"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.S is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/brain-workers/runtime/job-recovery.ts",
        "packages/coding-agent/src/brain-workers/runtime/job-state-store.ts",
        "packages/coding-agent/test/brain-workers/job-recovery.test.ts"
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
        "25.S implements Worker crash recovery and job resumption without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain-workers/runtime/job-recovery.ts",
          "packages/coding-agent/src/brain-workers/runtime/job-state-store.ts",
          "packages/coding-agent/test/brain-workers/job-recovery.test.ts"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.T",
      "title": "Local Production Readiness Doctor",
      "dependencies": [
        "25.H",
        "25.P",
        "25.Q",
        "25.R",
        "25.S"
      ],
      "hardDeps": [
        "25.H",
        "25.P",
        "25.Q",
        "25.R",
        "25.S"
      ],
      "softDeps": [],
      "parallelGroup": "batch_5",
      "dependencyReason": "Requires completed outputs from 25.H, 25.P, 25.Q, 25.R, 25.S.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/debug-to-fix-policy.ts",
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-pipeline.ts",
        "packages/coding-agent/src/brain-workers/pipelines/idea-to-plan-policy.ts",
        "packages/coding-agent/src/brain-workers/runtime/budget-controls.ts",
        "packages/coding-agent/src/brain-workers/runtime/cooldowns.ts",
        "packages/coding-agent/src/brain-workers/runtime/job-recovery.ts",
        "packages/coding-agent/src/brain-workers/runtime/job-state-store.ts",
        "packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/brain-workers/debug-to-fix-pipeline.test.ts",
        "packages/coding-agent/test/brain-workers/idea-to-plan-pipeline.test.ts",
        "packages/coding-agent/test/brain-workers/job-recovery.test.ts",
        "packages/coding-agent/test/brain-workers/loop-prevention.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/observability/HealthSummary.tsx",
        "packages/web-ui/dashboard/src/features/observability/ObservabilityCockpit.tsx",
        "packages/web-ui/dashboard/src/features/observability/TraceTimeline.tsx",
        "packages/web-ui/dashboard/src/hooks/useObservability.ts",
        "packages/web-ui/dashboard/src/types-observability.ts",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/src/doctor/local-production-readiness-doctor.ts",
        "packages/coding-agent/test/local-production-readiness-doctor.test.ts",
        "packages/web-server/src/local-readiness-routes.ts",
        "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx"
      ],
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "readiness-doctor",
          "readiness-panel",
          "stability-checks"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.T is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/src/doctor/local-production-readiness-doctor.ts",
        "packages/coding-agent/test/local-production-readiness-doctor.test.ts",
        "packages/web-server/src/local-readiness-routes.ts",
        "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx"
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
        "25.T implements Local Production Readiness Doctor without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/doctor/local-production-readiness-doctor.ts",
          "packages/coding-agent/test/local-production-readiness-doctor.test.ts",
          "packages/web-server/src/local-readiness-routes.ts",
          "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "25.U",
      "title": "Brain Worker Swarm Dogfood and Final Stability Report",
      "dependencies": [
        "25.T"
      ],
      "hardDeps": [
        "25.T"
      ],
      "softDeps": [],
      "parallelGroup": "batch_6",
      "dependencyReason": "Requires completed outputs from 25.T.",
      "readSet": [
        "docs/**",
        "packages/coding-agent/src/**",
        "packages/coding-agent/src/doctor/local-production-readiness-doctor.ts",
        "packages/coding-agent/test/**",
        "packages/coding-agent/test/local-production-readiness-doctor.test.ts",
        "packages/db/src/**",
        "packages/db/test/**",
        "packages/web-server/src/**",
        "packages/web-server/src/local-readiness-routes.ts",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**",
        "packages/web-ui/dashboard/src/features/observability/LocalReadinessPanel.tsx",
        "reports/**"
      ],
      "writeSet": [
        "packages/coding-agent/test/suite/regressions/p25-brain-worker-swarm-dogfood.test.ts",
        "reports/p25-brain-worker-swarm/final-stability-report.md",
        "reports/p25-brain-worker-swarm/dogfood-gauntlet.md",
        "docs/p25-local-observability-brain-worker-swarm.md"
      ],
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "dogfood-report",
          "stability-report",
          "local-gauntlet"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "v2 fixed: this workspace has narrow write ownership. It may run with same-batch workspaces because writeSet/allowedFiles no longer overlap broadly; integration queue and validation lock remain authoritative."
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
        "queueOptimizationNotes": "critical priority because 25.U is part of the local observability and brain-worker stability path."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true,
        "requiredChecks": [
          "npm run typecheck --if-present",
          "npm test -- --runInBand --if-present",
          "npm run build --if-present"
        ]
      },
      "allowedFiles": [
        "packages/coding-agent/test/suite/regressions/p25-brain-worker-swarm-dogfood.test.ts",
        "reports/p25-brain-worker-swarm/final-stability-report.md",
        "reports/p25-brain-worker-swarm/dogfood-gauntlet.md",
        "docs/p25-local-observability-brain-worker-swarm.md"
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
        "25.U implements Brain Worker Swarm Dogfood and Final Stability Report without breaking existing P6/P6.5/P11/P13-P20 behavior.",
        "All new APIs, types, and UI states are covered by targeted tests or documented dogfood checks.",
        "All autonomous behavior has explicit budget, cooldown, dedupe, and stop-condition handling where applicable.",
        "All failures surface evidence-backed diagnostics rather than silent errors.",
        "No forbidden commands or forbidden files are used.",
        "Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/suite/regressions/p25-brain-worker-swarm-dogfood.test.ts",
          "reports/p25-brain-worker-swarm/final-stability-report.md",
          "reports/p25-brain-worker-swarm/dogfood-gauntlet.md",
          "docs/p25-local-observability-brain-worker-swarm.md"
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
          "npm test",
          "npm run test",
          "npm run typecheck",
          "npm run build",
          "npm run lint",
          "git status",
          "git diff"
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
          "npm run dev"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entered",
          "integration_validation_completed"
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
  "contractVersion": "2.5.0",
  "phase": "P25",
  "title": "Local Production Observability and Brain Worker Swarm v2 Fixed File Ownership",
  "primaryGoal": "Make Pi locally stable, observable, self-debugging, idea-generating, and capable of routing work to specialized brain workers without runaway loops.",
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
  "safeEffectiveParallelismTarget": 4,
  "totalWorkspaces": 21,
  "previewBatches": 6,
  "peakDagWidth": 6,
  "notInScope": [
    "Cloud deployment",
    "Enterprise multi-user RBAC",
    "Public API security hardening",
    "External canary rollout",
    "Scale_8 execution by default"
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
    "watch_mode_validation",
    "autonomous_loop_without_budget",
    "worker_job_without_trace_id",
    "self_fix_without_evidence_packet"
  ],
  "completionGate": "P25 is complete when Pi can observe its local runtime, diagnose failures, assign specialist workers, generate fix and idea proposals, recover worker jobs, prevent loops, and pass the brain-worker swarm dogfood gauntlet.",
  "nextPhase": "P26 or production dogfood cycle"
}
```

---

# Annex A — Brain Worker Swarm Target Behavior

P25 should prove the following local loop:

```text
observability event
  -> diagnostic packet
  -> Debugger Worker
  -> root-cause hypothesis
  -> Fix Strategist Worker
  -> fix proposal
  -> approval / safe execution gate
  -> validation
  -> reflection
  -> memory update
  -> better future diagnosis
```

And the improvement loop:

```text
reflection / repeated failure / stale work / dismissed proposal
  -> Idea Scout Worker
  -> Memory Curator Worker if memory-related
  -> proposal scoring and dedupe
  -> Plan Synthesizer Worker
  -> executable markdown plan
  -> approval
  -> execution
```

---

# Annex B — Dogfood Gauntlet Scenarios

25.U must run or document all of these:

1. Failed workspace produces diagnostic packet.
2. Debugger Worker produces evidence-backed root cause.
3. Fix Strategist Worker produces bounded fix proposal.
4. Bad proposal is deduped or rejected.
5. Duplicate idea does not spam the inbox.
6. Stale memory is detected by Memory Curator Worker.
7. Worker crash leaves durable job state.
8. Restart recovers or quarantines worker job.
9. Failed validation prevents merge.
10. Successful self-fix reaches reflection and memory update.
11. Idea Scout produces a new improvement idea.
12. Plan Synthesizer turns approved idea into valid executable markdown.
13. Loop-prevention blocks repeated self-triggering.
14. Readiness Doctor fails when evidence is missing.
15. Readiness Doctor passes when all required evidence exists.

---

# Annex C — Final Stability Report Required Sections

25.U must produce `reports/p25-brain-worker-swarm/final-stability-report.md` with:

- Executive summary.
- Workspace completion table.
- DAG and safe parallelism actuals.
- Worker swarm architecture summary.
- Observability coverage matrix.
- Debug-to-fix scenario result.
- Idea-to-plan scenario result.
- Recovery scenario result.
- Loop-prevention scenario result.
- Known limitations.
- Rollback notes.
- Final launch recommendation.

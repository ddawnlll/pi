# P39 — Stable_3 Golden Path Recovery

**Status:** Planned  
**Phase:** P39  
**Title:** Stable_3 Golden Path Recovery  
**Primary goal:** Make `stable_3` the boringly reliable baseline execution mode before platform/agent separation.  
**Roadmap position:** After P38.1 Central Gauntlet, before P40 Platform / Agent Separation.  
**Default mode after this phase:** `stable_3`  
**Patch transaction status:** Still non-default; production-candidate/default promotion is deferred to P45/P46.  
**Required gate:** `make test-full` must pass before and after this phase.

---

## 0. Executive Summary

P39 is not a feature expansion phase. It is the stabilization phase that turns `stable_3` into the trustworthy baseline path for the whole platform.

P38.1 gave us the testing foundation:

- `make test` is now the fast deterministic development gate.
- `make test-full` is now the full local execution confidence gate.
- The central gauntlet runs deterministic tests, synthetic E2E, synthetic Monte Carlo, smoke-real Python E2E, smoke-real Monte Carlo, and combined summary validation.
- Lead Agent real failure classification, directive creation, escalation, command history recording, replay generation, and parallelism sampling are now proven at smoke-real level.

P39 uses that foundation to harden the actual `stable_3` runtime path.

The target end state:

```txt
parse plan
run up to 3 workers
record real commands
apply CompletionGate correctly
stop reliably
continue/rerun reliably
ignore stale completions
inject Lead Agent directives into retries
run final validation
surface failure reasons
write replayable reports
```

The one-line goal:

```txt
Make stable_3 boringly reliable.
```

---

## 1. Current Evidence

Recent P38.1 final gate results show:

```txt
make test:
  deterministic-only quick gate

make test-full:
  deterministic tests
  synthetic gauntlet
  synthetic Monte Carlo
  smoke-real Python happy path
  smoke-real Python Monte Carlo
  combined summary validation
```

Important evidence from the latest run:

```txt
Phase A: Deterministic Tests          PASS
Phase B: Synthetic Gauntlet           PASS
Phase C: Smoke-Real Python            PASS
Phase D: Smoke-Real Python MC         PASS / expected negative failures detected
Phase E: Combined Summary Validation  PASS

stable_3.tested = true
patch_transaction.tested = true
leadAgent.directivesCreated = 4
leadAgent.escalationsCreated = 4
completionGate.commandHistoryRecorded = true
parallelism.maxObservedActiveWorkers = 2
replay.available = true
combined summary validator = 19/19 PASS
```

This unblocks P39.

However, two report-level issues must be fixed inside P39:

```txt
1. Smoke-real Monte Carlo verdict semantics:
   Expected injected negative failures are currently represented as PARTIAL.
   They should become PASS_WITH_EXPECTED_FAILURES or EXPECTED_FAILURE_CAUGHT.

2. Parallelism aggregation semantics:
   Some combined-summary fields can show stable_3 maxObservedActiveWorkers = 4,
   while top-level parallelism shows maxObservedActiveWorkers = 2.
   stable_3 must never report > 3 unless the field means a different aggregate.
```

These are not blockers to starting P39, but they are the first workstream.

---

## 2. Problem Statement

The system has historically failed in these ways:

```txt
workers retry the same failure blindly
CompletionGate does not always know which commands actually ran
targetCommand can block forever
validation commands can fail in confusing ways
No test files found can look like success
stop may not really stop active workers
continue/rerun can race with stale worker completions
stale worker completion can attempt illegal FSM transitions
dashboard/report can show failed but not why
plan completion can be confused with workspace completion
```

P38/P38.1 added the supervisor and the gauntlet. P39 must harden the real `stable_3` execution path so these problems are handled, visible, and replayable.

---

## 3. Scope

P39 includes:

```txt
stable_3 lifecycle hardening
stop / continue / rerun recovery
stale completion guards
CompletionGate command history correctness
Lead Agent runtime integration
final validation gate enforcement
minimum runtime visibility
combined-summary verdict semantics cleanup
make test / make test-full gate enforcement
```

P39 does **not** include:

```txt
platform / agent separation
dashboard redesign
external worker adapters
patch transaction default promotion
stable_6 production promotion
worktree revival
Rust rewrite
brain / overnight planner
multi-apply patch lanes
full real LLM default test mode
```

---

## 4. Non-Negotiable Invariants

### 4.1 Stable_3 Execution

```txt
stable_3 max active workers <= 3
stable_3 should reach >= 2 active workers when the plan DAG has independent width >= 2
stable_3 must not require worktree isolation
stable_3 must not use patch transaction semantics by default
stable_3 must not bypass CompletionGate
stable_3 must not bypass TransitionRouter / FSM
```

### 4.2 State Truth

```txt
state-store truth beats executor memory cache
before terminal transition, reload fresh workspace state
before retry/reset, terminalize or quarantine stale active attempts
late completion from old attempt must be ignored, not failed
no PENDING -> SUCCEEDED attempted
no SUCCEEDED -> RUNNING retry-cache regression
```

### 4.3 Command / Validation

```txt
every bash/exec/validation command must be recorded
targetCommand requires command evidence
acceptedEquivalentCommands require command evidence
No tests found with exit 0 is failure for targeted validation
watch-mode validation is forbidden
non-zero validation blocks completion
final validation is required before plan completion
workspace complete != plan complete
```

### 4.4 Lead Agent

```txt
same failure signature must not retry blindly beyond configured budget
LeadDirective must be created before repeated retry
UserEscalation must be created after retry budget exhaustion
blocking severity failures must not blindly retry
Lead Agent must not directly mutate execution state
Lead Agent must not mark workspaces complete
Lead Agent must not bypass FSM or CompletionGate
```

### 4.5 Visibility

```txt
workspace error must be visible
CompletionGate block reason must be visible
last command and exit code must be visible
Lead diagnosis must be visible
retry count must be visible
replay command must be visible
parallelism samples must be written
combined-summary.json must be truthful
```

---

# 5. Workstreams

---

## P39.00 — Gauntlet Verdict Semantics and Summary Aggregation

### Goal

Fix report/summary ambiguity so `make test-full` becomes a reliable source of truth.

### Required Changes

Add clear scenario outcome semantics:

```txt
PASS
FAIL
PASS_WITH_EXPECTED_FAILURES
EXPECTED_FAILURE_CAUGHT
UNEXPECTED_FAILURE
SKIPPED
```

A Monte Carlo iteration with injected `wrong_validation_command`, `backend_health_failure`, `patch_write_set_violation`, or `no_tests_found_exit_zero` should be reported as successful if the system caught it correctly.

Example:

```json
{
  "iteration": 6,
  "scenario": "no_tests_found_exit_zero",
  "expectedToFail": true,
  "expectedFailureCaught": true,
  "verdict": "EXPECTED_FAILURE_CAUGHT",
  "countsAsSuiteFailure": false
}
```

Add fields:

```json
{
  "expectedFailures": {
    "total": 0,
    "caught": 0,
    "missed": 0,
    "items": []
  },
  "unexpectedFailures": [],
  "verdictSemanticsVersion": "1.0"
}
```

Fix parallelism aggregation:

```txt
executionModes.stable_3.maxObservedActiveWorkers must mean active stable_3 workers only.
It must never exceed 3.
If a number includes global workers or patch transaction codegen workers, name it differently.
```

Suggested fields:

```json
{
  "parallelism": {
    "stable3MaxObservedActiveWorkers": 0,
    "patchTxMaxObservedCodegenWorkers": 0,
    "globalMaxObservedWorkers": 0
  }
}
```

### Acceptance Criteria

```txt
make test-full passes
combined-summary validator understands expected failures
smoke-real expected negative scenarios are not mislabeled as ordinary failures
stable_3 max active worker aggregation is <= 3
parallelism fields are unambiguous
```

---

## P39.01 — Stable_3 Execution Profile Lockdown

### Goal

Make the `stable_3` execution profile explicit, visible, and hard to accidentally mutate.

### Stable_3 Profile

```txt
maxParallelWorkspaces = 3
worktreeRequired = false
patchIsolationRequired = false
patch_transaction = false
finalValidationRequired = true
Lead Agent enabled
CompletionGate enabled
command history required
stop/continue recovery enabled
```

### Tasks

- Add or centralize a stable_3 execution profile.
- Ensure plan parser/normalizer does not accidentally turn stable_3 into worktree or patch mode.
- Ensure max workers are capped at 3.
- Ensure final validation requirement is explicit.
- Ensure Lead Agent and CompletionGate are enabled by default in stable_3.
- Add the selected execution profile to reports.

### Files to Inspect

```txt
packages/coding-agent/src/core/workspace-scheduler.ts
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/plan-parser.ts
packages/coding-agent/src/core/workspace-schema.ts
packages/coding-agent/src/core/plan-state.ts
packages/coding-agent/src/core/state-store.ts
scripts/run-execution-stability-gauntlet.ts
```

### Acceptance Criteria

```txt
stable_3 execution profile is visible in report
max active stable_3 workers never exceeds 3
make test-full asserts stable_3 profile
no worktree requirement in stable_3
patch transaction is not enabled in stable_3
```

---

## P39.02 — Stop / Continue / Rerun Recovery

### Goal

Make stop, continue, and rerun reliable under `stable_3`.

### Required Stop Behavior

When stop is requested:

```txt
prevent new scheduling immediately
write runner-visible control request
abort active workspace execution
terminate child processes where possible
drain in-flight promises or time out
release file/process locks
mark active attempts stopped/cancelled or quarantined
emit stop_requested
emit stop_draining
emit stop_completed or stop_failed
```

Stop must be idempotent.

### Required Continue/Rerun Behavior

When continue/rerun is requested:

```txt
reload state-store truth
preserve completed workspaces
reset only resettable failed/blocked/stopped workspaces
do not reset active attempts until terminalized/quarantined
create fresh attempt identity
clear stale in-flight registry entries
resume scheduling
emit continue_requested
emit rerun_started
emit rerun_completed or rerun_failed
```

### Required Stale Completion Guard

Before applying any worker result:

```txt
reload current workspace state
reload current attempt identity
reload plan status
compare attemptId / attemptNo / generation
if stale, ignore result
emit stale_attempt_completion_ignored
do not fail workspace because stale completion arrived
do not call TransitionRouter for illegal stale transition
```

### Files to Inspect

```txt
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/plan-control.ts
packages/coding-agent/src/core/state-store.ts
packages/coding-agent/src/core/plan-state.ts
packages/coding-agent/src/execution-kernel/transition-router.ts
packages/web-server/src/plan-runner.ts
packages/web-server/src/index.ts
```

### Tests

```txt
stop_drains_active_workers.test.ts
continue_failed_plan.test.ts
stale_completion_after_continue.test.ts
stop_idempotency.test.ts
succeeded_to_running_retry_regression.test.ts
```

### Acceptance Criteria

```txt
stop prevents new scheduling
stop drains or terminalizes active workers
continue resumes resettable work
completed workspaces remain complete
late completion ignored as stale
no PENDING -> SUCCEEDED attempted
no SUCCEEDED -> RUNNING attempted
make test-full passes stop/continue smoke scenarios
```

---

## P39.03 — CompletionGate Command History Hardening

### Goal

Make CompletionGate depend on real command execution evidence.

### Required Command Record

Every command run during workspace execution must record:

```txt
command
cwd
workspaceId
planExecId
startedAt
finishedAt
exitCode
stdout/stderr summary
output artifact path
cancelled
timedOut
matchedTargetCommand
matchedAcceptedEquivalentCommand
matchedValidationRequirement
noTestsFoundDetected
```

### Rules

```txt
targetCommand is not satisfied without command evidence
acceptedEquivalentCommands are not satisfied without command evidence
No test files found with exit 0 is failure
non-zero exit code blocks validation
watch mode command rejected
missing command history blocks completion
```

### Files to Inspect

```txt
packages/coding-agent/src/core/bash-executor.ts
packages/coding-agent/src/core/tools/bash.ts
packages/coding-agent/src/core/completion-gate.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/validation-lock.ts
packages/coding-agent/src/utils/shell.ts
```

### Tests

```txt
completion-gate-command-history.test.ts
completion-gate-equivalent-command.test.ts
no-tests-found-validation.test.ts
target-command-evidence-required.test.ts
```

### Acceptance Criteria

```txt
commandHistoryRecorded true in make test-full
CompletionGate blocks missing command evidence
No tests found exit 0 fails
acceptedEquivalentCommands work only with evidence
command output artifact path written
combined-summary includes command evidence
```

---

## P39.04 — Lead Agent Runtime Integration

### Goal

Move Lead Agent from “classifier core exists” to “runtime recovery participant.”

### Required Behavior

When a workspace fails or blocks:

```txt
extract failure signature
classify failure
update retry budget
create LeadDirective when needed
inject LeadDirective into retry packet
block blind retry when retry budget exhausted
create UserEscalation when lead cannot resolve
write directive/escalation to report/journal
show directive/escalation in combined summary
```

### Directive Injection

A retry must not receive the same prompt blindly. Retry packet must include:

```txt
previous failure signature
Lead diagnosis
Lead recommended action
exact worker instruction
retry budget remaining
forbidden repeated action
expected next evidence
```

Example instruction:

```txt
Do not rerun the same command blindly.
The target command was not observed by CompletionGate.
Verify command history wiring or run the accepted equivalent validation command.
If the test file is missing, create it before retrying.
```

### Files to Inspect

```txt
packages/coding-agent/src/core/lead-agent/*
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/role-packets.ts
packages/coding-agent/src/core/retry-handler.ts
packages/coding-agent/src/core/state-store.ts
packages/web-ui/dashboard/src/**
```

### Tests

```txt
lead-agent-runtime-directive-injection.test.ts
retry-packet-lead-directive.test.ts
lead-agent-user-escalation.test.ts
blind-retry-blocked.test.ts
```

### Acceptance Criteria

```txt
same failure not retried blindly
LeadDirective appears in retry packet
UserEscalation created after exhausted budget
Lead Agent does not mutate execution state directly
combined-summary includes real lead classifications/directives/escalations
make test-full proves real smoke directive and escalation
```

---

## P39.05 — Final Validation Gate

### Goal

Make final validation the plan completion authority.

### Required Behavior

```txt
workspace complete != plan complete
final validation required before plan complete
final validation command must have command evidence
final validation failure blocks plan
final repair or user escalation follows final validation failure
```

### Stable_3 Policy

```txt
ordinary implementation workspace:
  may run smoke checks
  should not be forced to run heavy tests

final validation workspace:
  must run target validation command
  must record command evidence
  must block plan completion on failure

final repair workspace:
  optional but recommended for large plans
  consumes final validation failure
```

### Files to Inspect

```txt
packages/coding-agent/src/core/completion-gate.ts
packages/coding-agent/src/core/plan-state.ts
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/workspace-schema.ts
packages/coding-agent/src/core/plan-parser.ts
```

### Tests

```txt
final-validation-required.test.ts
workspace-complete-plan-incomplete.test.ts
final-validation-repair-flow.test.ts
```

### Acceptance Criteria

```txt
plan cannot complete before final validation
final validation command has evidence
final validation failure blocks plan
final repair/retry path is visible
make test-full final_validation_repair scenario passes
```

---

## P39.06 — Stable_3 Real Task Execution Hardening

### Goal

Ensure `stable_3` works for real small task execution, not just synthetic simulation.

### Reference Smoke Task

Use the markdown-driven Python web app smoke suite as the reference real task.

Stable_3 must:

```txt
load markdown task specs
create temp project
run backend/frontend/test workspaces
allow safe PY1/PY2 overlap
run real Python validation command
record command history
record parallelism samples
produce combined summary
preserve artifacts on failure
```

### Acceptance Criteria

```txt
stable_3.tested = true
pythonWebApp.tested = true
commandHistoryRecorded = true
parallelism samples non-empty
max observed stable_3 workers <= 3
safe parallelism >= 2 when task graph allows
no hardcoded generator
solutionPreGenerated = false
markdown task source used
```

---

## P39.07 — Minimum Runtime Visibility

### Goal

Provide enough visibility to debug `stable_3` without waiting for the P42 dashboard redesign.

### Required Workspace Fields

```txt
stage
attempts
last error
last command
last exit code
completion gate block reasons
lead classification
lead directive
retry budget remaining
user escalation status
```

### Required Plan Fields

```txt
status
active count
ready count
blocked count
failed count
complete count
parallelism samples
final validation status
replay commands
```

### Required Report Files

```txt
summary.md
combined-summary.json
event-stream.ndjson
state-snapshots.ndjson
scheduler-decisions.ndjson
parallelism-samples.ndjson
live-monitor.log
replay-commands.md
```

### Acceptance Criteria

```txt
all required files written by make test-full
combined-summary.json is parseable
replay commands exist for failed expected scenarios
workspace failure reason visible
CompletionGate block reason visible
Lead diagnosis visible
parallelism samples visible
```

---

## P39.08 — Test Gate Enforcement

### Goal

Preserve the final command split and make it authoritative.

### `make test`

Quick deterministic development gate.

Must run only deterministic focused tests:

```txt
Lead Agent unit tests
CompletionGate focused tests
invariant checker tests
replay parser tests
synthetic worker unit tests
attempt FSM regression tests
```

Target:

```txt
< 60s preferred
< 2m hard max
```

### `make test-full`

Full P39 readiness / execution confidence gate.

Must run:

```txt
deterministic tests
synthetic execution gauntlet
synthetic Monte Carlo
smoke-real Python happy path
smoke-real Python Monte Carlo
combined summary validation
```

Target:

```txt
< 5m preferred
< 8m hard max
```

### Acceptance Criteria

```txt
make test passes
make test-full passes
combined summary validation passes
make test-full is required before P40
```

---

## 6. Suggested Workspace Breakdown

Recommended workspaces:

```txt
P39.00 — Gauntlet Verdict Semantics and Summary Aggregation
P39.01 — Stable_3 Execution Profile Lockdown
P39.02 — Stop / Continue / Rerun Recovery
P39.03 — Stale Attempt Completion Guard
P39.04 — CompletionGate Command History Hardening
P39.05 — Lead Agent Runtime Directive Injection
P39.06 — Final Validation Gate and Repair Flow
P39.07 — Stable_3 Real Task Execution Hardening
P39.08 — Minimum Runtime Visibility and Reports
P39.09 — make test / make test-full Gate Enforcement
P39.10 — Final Validation, Replay, and Release Report
```

### Parallelization Notes

Safe parallel candidates:

```txt
P39.00 can run with P39.01
P39.04 can run with P39.05 if file scopes do not overlap
P39.07 can run after P39.02/P39.03/P39.04 basics are ready
P39.08 can run after report schemas stabilize
```

Dependency-sensitive:

```txt
P39.02 stop/continue recovery
P39.03 stale completion guard
P39.05 retry directive injection
P39.06 final validation gate
P39.10 final validation
```

Do not over-parallelize this phase. Reliability matters more than throughput.

---

## 7. Files Likely to Change

Core execution:

```txt
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/workspace-scheduler.ts
packages/coding-agent/src/core/plan-state.ts
packages/coding-agent/src/core/state-store.ts
packages/coding-agent/src/core/plan-control.ts
packages/coding-agent/src/core/workspace-schema.ts
packages/coding-agent/src/core/retry-handler.ts
packages/coding-agent/src/core/role-packets.ts
```

Completion / command:

```txt
packages/coding-agent/src/core/completion-gate.ts
packages/coding-agent/src/core/bash-executor.ts
packages/coding-agent/src/core/tools/bash.ts
packages/coding-agent/src/core/validation-lock.ts
packages/coding-agent/src/utils/shell.ts
```

Lead Agent:

```txt
packages/coding-agent/src/core/lead-agent/*
```

Execution kernel:

```txt
packages/coding-agent/src/execution-kernel/transition-router.ts
packages/coding-agent/src/execution-kernel/**
```

Gauntlet:

```txt
scripts/run-execution-stability-gauntlet.ts
scripts/validate-combined-summary.ts
packages/coding-agent/src/core/execution-gauntlet/**
test-fixtures/gauntlet/**
```

Server/dashboard minimal visibility:

```txt
packages/web-server/src/plan-runner.ts
packages/web-server/src/index.ts
packages/web-ui/dashboard/src/**
```

Test commands:

```txt
Makefile
package.json
packages/coding-agent/package.json
```

Tests:

```txt
packages/coding-agent/test/execution/**
packages/coding-agent/test/execution-gauntlet/**
packages/web-server/test/**
```

---

## 8. Required Tests

Add or update tests for:

```txt
stable_3 profile enforcement
stop drains active workers
stop idempotency
continue failed plan
continue stopped plan
stale completion ignored
PENDING -> SUCCEEDED never attempted
SUCCEEDED -> RUNNING never attempted
command history recorded
CompletionGate targetCommand evidence
accepted equivalent command evidence
No tests found exit 0 failure
Lead directive injection into retry packet
Lead escalation after retry budget
final validation required before plan complete
final validation repair flow
combined summary expected failure semantics
stable_3 parallelism aggregation
make test / make test-full command behavior
```

---

## 9. Acceptance Criteria

P39 is complete only when:

```txt
make test passes
make test-full passes
stable_3 profile locked down
stop/continue/rerun works in stable_3
stale completions are ignored
CompletionGate uses real command history
No tests found exit 0 fails
LeadDirective is injected into retry prompt
UserEscalation is created after exhausted budget
final validation gates plan completion
combined-summary expected failure semantics fixed
stable_3 parallelism aggregation fixed
reports contain workspace failure reason
reports contain command history
reports contain Lead diagnosis
reports contain replay commands
no PENDING -> SUCCEEDED attempted
no SUCCEEDED -> RUNNING attempted
smoke-real Python stable_3 still passes
smoke-real Python Monte Carlo still passes with expected failures caught
```

---

## 10. Final Report Requirements

Write final report to:

```txt
reports/p39-stable3-golden-path/<timestamp>/
```

Required files:

```txt
summary.md
files-changed.md
test-results.md
control-plane-recovery.md
completion-gate-command-history.md
lead-agent-runtime-integration.md
final-validation-gate.md
gauntlet-semantics-cleanup.md
remaining-risks.md
```

`summary.md` must include:

```txt
overall verdict
what was broken
what was fixed
what was intentionally deferred
make test result
make test-full result
stable_3 readiness assessment
P40 readiness assessment
remaining risks
```

---

## 11. P40 Readiness Gate

P40 Platform / Agent Separation may start only if:

```txt
make test passes
make test-full passes
P39 final report exists
stable_3 is the confirmed baseline
no critical stop/continue bugs remain
no command history / CompletionGate blocker remains
Lead Agent runtime integration is functional
final validation gate is functional
combined summary is truthful
```

If these do not hold, do not start P40.

---

## 12. Definition of Done

P39 is done when we can honestly say:

```txt
stable_3 is the reliable baseline execution mode.
A plan can start, run, fail, stop, continue, recover, validate, and report without manual DB surgery.
Workers cannot blindly retry the same failure forever.
CompletionGate knows what commands actually ran.
Lead Agent can guide retries and escalate real failures.
Final validation decides plan completion.
make test-full proves the golden path before major architecture changes.
```

---

## 13. Final Implementation Directive

Implement P39 as a stabilization phase.

Do not expand scope.

Do not promote patch_transaction to default.

Do not start platform separation inside P39.

Do not redesign the dashboard.

Do not add new product features.

Use P39 to make `stable_3` boring, reliable, observable, and recoverable.

After P39 passes, proceed to:

```txt
P40 — Platform / Agent Separation
```

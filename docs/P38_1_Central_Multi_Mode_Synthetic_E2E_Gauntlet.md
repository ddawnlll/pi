# P38.1 — Central Multi-Mode Synthetic E2E Execution Gauntlet

**Status:** Planned  
**Purpose:** Replace one-off dogfood prompts with a centralized, cheap, reproducible, multi-plan end-to-end test suite for the execution platform.  
**Default runtime budget:** ≤ 5 minutes  
**Default cost profile:** no real LLM, no full npm test, no network, deterministic synthetic workers  
**Execution modes covered:** `stable_3` and `patch_transaction`  
**Primary command:** `make test`

---

## 0. TL;DR

We should stop writing a custom dogfood plan for every phase.

Instead, build a central execution gauntlet that runs a suite of small synthetic end-to-end plans against the real execution control plane.

The gauntlet must test:

- `stable_3`
- `patch_transaction`
- scheduler behavior
- parallelism behavior
- CompletionGate behavior
- command history wiring
- Lead Agent retry-loop prevention
- final validation / final repair behavior
- stop / continue / stale completion behavior
- dashboard/report visibility
- live execution monitoring
- deterministic replay

The default suite must be cheap and reproducible:

```bash
make test
```

should run:

```txt
1. deterministic unit/focused regression tests
2. deterministic synthetic E2E plans
3. seeded Monte Carlo gauntlet
4. report generation
```

The full default run must finish in **under 5 minutes**.

---

## 1. Why This Exists

The system has repeatedly failed in ways that one-off tests did not catch:

- workers retrying the same failure 12–18 times
- `CompletionGate` not seeing command execution
- `targetCommand` blocked forever
- `No test files found` exiting 0 and looking like success
- stale worker completions causing illegal transitions
- stop not actually draining active workers
- continue/rerun not reliably recovering failed plans
- dashboard showing “failed” but not why
- plans needing repeated custom dogfood prompts

These are not phase-specific problems. They are **execution platform invariants**.

So they should live in a central regression/gauntlet suite.

---

## 2. Core Principle

The gauntlet should use:

```txt
real parser
real scheduler
real state store
real CompletionGate
real Lead Agent
real execution loop
real event/report pipeline
synthetic small plans
controlled synthetic workers
fault injection
seeded Monte Carlo
```

It should not rely on a real LLM by default.

The goal is not to test model quality.  
The goal is to test the execution platform.

---

## 3. Required Test Modes

### 3.1 `fast` mode — default

This is what `make test` should run.

```txt
runtime: <= 5 minutes
real LLM: no
network: no
full npm test: no
synthetic plans: yes
synthetic workers: yes
Postgres: preferred if available, otherwise controlled local test backend if supported
seeded Monte Carlo: yes
live report: yes
```

Example:

```bash
npx tsx scripts/run-execution-stability-gauntlet.ts \
  --mode fast \
  --suite all \
  --execution-modes stable_3,patch_transaction \
  --iterations 100 \
  --seed 12345 \
  --timeout-ms 300000
```

### 3.2 `smoke-real` mode — optional

Small real-worker smoke test.

```txt
runtime: <= 10–15 minutes
real LLM: optional
plans: tiny
workers: 1–2
cost: low
trigger: manual / pre-release
```

Example:

```bash
make test-smoke-real
```

### 3.3 `nightly-real` mode — optional

Expensive real dogfood run.

```txt
runtime: overnight
real LLM: yes
plans: bigger
cost: allowed
trigger: nightly/manual
```

Example:

```bash
make test-nightly-real
```

---

## 4. Execution Modes to Test

The gauntlet must test **both** execution modes.

### 4.1 `stable_3`

This is the current reliable baseline.

Expected properties:

```txt
max workers <= 3
direct/stable execution path
no worktree dependency
stop/continue/rerun must work
CompletionGate must work
Lead Agent must prevent blind retry loops
final validation must gate plan completion
```

### 4.2 `patch_transaction`

This is the future scalable execution mode.

Expected properties:

```txt
workers produce patch artifacts
PatchCoordinator is the only repository writer
patchApplyLanes = 1 by default
worktreeRequired = false
writeSet guard enforced
file hash / stale base guard enforced
rollback required
final validation required
```

The fast gauntlet does not need full production patch transaction implementation with real codegen.  
It must at least test the control-plane semantics and invariants:

```txt
worker cannot directly mutate repo
patch without writeSet rejected
patch without base version rejected
patch apply requires coordinator
overlapping writeSets serialize/handoff
stale hash rejects/handoff
rollback path exists
```

---

## 5. Deterministic First, Monte Carlo Second

`make test` must run in this order:

```txt
Phase A — deterministic focused tests
Phase B — deterministic synthetic E2E plans
Phase C — seeded Monte Carlo gauntlet
Phase D — report + replay metadata
```

Why deterministic first?

- It catches known regressions quickly.
- It gives clear failures.
- It avoids wasting Monte Carlo time when a known invariant is already broken.

Monte Carlo should only run after deterministic tests pass.

---

## 6. Multi-Plan Synthetic E2E Test Registry

The gauntlet must run multiple small plans, not just one.

Each plan should be tiny but should exercise the real task execution loop.

### Plan G1 — `hello_success`

Purpose:

```txt
Happy path.
```

Behavior:

```txt
one workspace creates a tiny hello module
final validation passes
plan completes
```

Assertions:

```txt
workspace completes
command history exists
final validation passes
plan complete
report written
```

---

### Plan G2 — `three_parallel_hello_stable_3`

Purpose:

```txt
Verify stable_3 can run multiple independent workspaces with max parallelism 3.
```

Behavior:

```txt
3 independent workspaces
no overlapping write scope
synthetic workers complete successfully
```

Assertions:

```txt
max observed active workers >= 2
max observed active workers <= 3
all complete
parallelism samples written
```

---

### Plan G3 — `patch_transaction_non_overlapping_patches`

Purpose:

```txt
Verify patch_transaction can accept non-overlapping patches.
```

Behavior:

```txt
3 workers produce patch artifacts for different files
PatchCoordinator applies them
final validation passes
```

Assertions:

```txt
direct worker mutation = 0
PatchCoordinator apply count = 3
dirty repo leak = 0
patchApplyLanes observed = 1
all patches accepted
```

---

### Plan G4 — `patch_transaction_write_set_violation`

Purpose:

```txt
Verify patch transaction rejects/handoffs writeSet violations.
```

Behavior:

```txt
worker declares writeSet A but patch touches file B
```

Assertions:

```txt
patch rejected or handoff_required
repo remains clean
Lead Agent classifies write_set_violation if surfaced
plan does not falsely complete
```

---

### Plan G5 — `completion_gate_missing_command`

Purpose:

```txt
Verify CompletionGate blocks when command evidence is missing.
```

Behavior:

```txt
worker claims completion
targetCommand exists
command history intentionally missing
```

Assertions:

```txt
CompletionGate blocks
Lead Agent classifies target_command_not_executed or command_history_missing
same failure does not retry blindly more than configured budget
directive created
```

---

### Plan G6 — `no_tests_found_exit_zero`

Purpose:

```txt
Verify "No test files found" is failure even if exit code is 0.
```

Behavior:

```txt
worker runs wrong test path
command exits 0
output contains "No test files found"
```

Assertions:

```txt
validation fails
no_tests_found_exit_zero classification exists
plan does not complete
Lead directive suggests fixing test path or creating missing test
```

---

### Plan G7 — `repeated_retry_loop`

Purpose:

```txt
Verify Lead Agent prevents 12–18 blind retries.
```

Behavior:

```txt
same completion gate failure repeats
```

Assertions:

```txt
same failure signature repeat count tracked
LeadDirective created by repeat 2
UserEscalation created by repeat 3 or configured threshold
blind retry blocked
```

---

### Plan G8 — `half_done_worker`

Purpose:

```txt
Verify worker cannot say COMPLETE after partial implementation.
```

Behavior:

```txt
worker writes source file but omits required test or final artifact
```

Assertions:

```txt
final validation fails
Lead classification: incomplete_implementation or missing_test_file
repair/escalation generated
plan complete blocked
```

---

### Plan G9 — `stop_continue_stale_completion`

Purpose:

```txt
Verify stale worker completion after stop/continue is ignored.
```

Behavior:

```txt
workspace starts
stop requested while active
continue/rerun resets workspace
old worker returns COMPLETE late
```

Assertions:

```txt
stale_attempt_completion_ignored emitted
PENDING -> SUCCEEDED never attempted
workspace state remains valid
no illegal FSM transition
```

---

### Plan G10 — `succeeded_to_running_retry_cache_regression`

Purpose:

```txt
Verify cached attempt retry does not produce SUCCEEDED -> RUNNING.
```

Behavior:

```txt
attempt succeeds
retry path starts another attempt
```

Assertions:

```txt
fresh attempt or legal attempt_started transition
SUCCEEDED -> RUNNING never occurs
attempt FSM remains valid
```

---

### Plan G11 — `final_validation_repair`

Purpose:

```txt
Verify deferred validation + final repair flow.
```

Behavior:

```txt
implementation workspace leaves small intentional bug
final validation fails
repair workspace fixes bug
final validation reruns and passes
```

Assertions:

```txt
implementation workspace can complete without heavy test
plan cannot complete before final validation
final repair consumes validation failure
final validation passes after repair
plan completes
```

---

### Plan G12 — `dashboard_visibility_artifacts`

Purpose:

```txt
Verify report/dashboard data is produced for failures.
```

Behavior:

```txt
workspace fails with known completion gate block
```

Assertions:

```txt
workspace error message recorded
completion gate block reason recorded
last command recorded
exit code recorded
Lead diagnosis recorded
report contains visibility section
```

---

## 7. Controlled Worker Behavior Injection

The gauntlet must support deterministic worker behaviors.

Example:

```ts
type SyntheticWorkerBehavior =
  | "success"
  | "half_done"
  | "missing_command_history"
  | "wrong_test_path"
  | "no_tests_found_exit_zero"
  | "late_complete_after_reset"
  | "repeat_same_failure"
  | "validation_fail_then_repair"
  | "patch_non_overlapping"
  | "patch_write_set_violation"
  | "patch_stale_hash"
  | "timeout"
  | "memory_killed";
```

Each synthetic plan declares the behavior for each workspace.

The execution loop should still be real.

The worker behavior is controlled so the suite stays cheap and reproducible.

---

## 8. Monte Carlo Scenario Fuzzing

Monte Carlo should randomize **timing and event order**, not generate huge random projects.

Randomized factors:

```txt
stop timing
continue timing
worker completion order
late completion delay
validation delay
command failure type
command history presence
retry count
queue snapshot missing
file lock timing
patch conflict timing
lead directive timing
```

Required properties:

```txt
seeded
replayable
bounded
cheap
```

Command:

```bash
npx tsx scripts/run-execution-stability-gauntlet.ts \
  --mode fast \
  --suite monte-carlo \
  --execution-modes stable_3,patch_transaction \
  --iterations 100 \
  --seed 12345 \
  --timeout-ms 300000
```

If a scenario fails, write replay file:

```txt
reports/execution-stability-gauntlet/<timestamp>/replays/failed-scenario-<n>.json
```

Replay command:

```bash
npx tsx scripts/run-execution-stability-gauntlet.ts \
  --replay reports/execution-stability-gauntlet/<timestamp>/replays/failed-scenario-17.json
```

---

## 9. Live Monitoring Requirements

The gauntlet must monitor execution live.

It should reuse ideas from the existing V5 diagnostic runner:

```txt
heartbeat
event stream
journal
state snapshots
scheduler decisions
parallelism samples
lock snapshots
validation events
integration/patch apply events
hang analysis
progress summary
final report
```

Live log file:

```txt
reports/execution-stability-gauntlet/<timestamp>/live-monitor.log
```

Event stream:

```txt
reports/execution-stability-gauntlet/<timestamp>/event-stream.ndjson
```

State snapshots:

```txt
reports/execution-stability-gauntlet/<timestamp>/state-snapshots.ndjson
```

Parallelism samples:

```txt
reports/execution-stability-gauntlet/<timestamp>/parallelism-samples.ndjson
```

Scheduler decisions:

```txt
reports/execution-stability-gauntlet/<timestamp>/scheduler-decisions.ndjson
```

---

## 10. Parallelism Monitoring

Parallelism must be observed continuously.

For each plan:

```txt
requestedMaxParallelism
expectedDAGParallelism
expectedSafeParallelism
maxObservedActiveWorkers
averageActiveWorkers
activeWorkerTimeline
parallelismRegression
serializationReason
```

Assertions:

### stable_3

```txt
maxObservedActiveWorkers <= 3
if plan width >= 3, maxObservedActiveWorkers should reach at least 2
no unexpected serialization unless documented
```

### patch_transaction

```txt
codegen workers may be > 3 in future mode
patchApplyLanes = 1 by default
only one patch apply at a time unless explicitly enabled
non-overlapping codegen can run concurrently
overlapping writes serialize/handoff
```

Report must show:

```txt
parallelism chart/table
active workers over time
underutilization explanation
serialization causes
```

A simple terminal/TUI view should show this live.

---

## 11. TUI / Live Console

A minimal TUI would be valuable.

It does not need to be fancy.

Required live display:

```txt
run id
elapsed time
current suite
current plan
execution mode
seed
iterations completed
active workers
ready workers
blocked workers
failed workers
complete workers
current max observed parallelism
last event
current failure classification
lead directives created
escalations created
current invariant failures
report path
```

Optional key controls:

```txt
q = quit after current scenario
s = save snapshot
p = pause between scenarios
f = show current failures
r = show replay command
```

Implementation options:

```txt
start simple with console redraw
later migrate to Ink/blessed if desired
```

Do not let TUI complexity block the test harness.

If TUI is too much for first pass, implement:

```txt
--tui=false default
--tui=true optional
```

But always write live-monitor.log.

---

## 12. Invariants

The gauntlet must assert these invariants.

### Attempt / FSM

```txt
No PENDING -> SUCCEEDED attempted
No SUCCEEDED -> RUNNING retry-cache regression
No transition bypasses TransitionRouter
Late completion after reset is ignored as stale
Stopped/cancelled plan does not keep scheduling
```

### Stop / Continue

```txt
Stop prevents new scheduling
Stop drains or terminalizes active workers
Continue recovers resettable failed/blocked workspaces
Completed workspaces remain complete
Queue snapshot missing returns clear error
```

### CompletionGate

```txt
targetCommand requires real command evidence
acceptedEquivalentCommands require real command evidence
commandHistory is populated
No tests found with exit 0 fails targeted validation
watch-mode validation forbidden
non-zero validation fails
```

### Lead Agent

```txt
same failure signature does not retry blindly > configured limit
LeadDirective created on repeated failure
UserEscalation created after retry budget exhausted
blocking severity failures do not blindly retry
Lead Agent does not mutate execution state directly
```

### Patch Transaction

```txt
PatchCoordinator is repository mutation authority
worker direct repo mutation forbidden
patch without writeSet rejected
patch without base version rejected
stale hash rejected/handoff
rollback required
patchApplyLanes default 1
```

### Visibility

```txt
workspace error visible in report
completion gate block reason visible
last command visible
exit code visible
lead diagnosis visible
parallelism samples written
replay command written for failures
```

---

## 13. Reports

Every gauntlet run must write:

```txt
reports/execution-stability-gauntlet/<timestamp>/
  summary.md
  scenario-results.json
  failed-scenarios.json
  replay-commands.md
  event-stream.ndjson
  state-snapshots.ndjson
  scheduler-decisions.ndjson
  parallelism-samples.ndjson
  live-monitor.log
  invariants.md
  monte-carlo-summary.md
  tui-snapshot.txt
```

### `summary.md`

Must include:

```txt
overall pass/fail
total duration
seed
mode
execution modes tested
plans tested
iterations
scenario pass/fail table
top invariant failures
parallelism summary
Lead Agent summary
CompletionGate summary
Stop/Continue summary
Patch transaction summary
replay instructions
```

### `scenario-results.json`

Machine-readable results.

### `failed-scenarios.json`

Must include enough data to replay.

### `replay-commands.md`

Must include exact commands.

---

## 14. Make Targets

Add or update:

```make
test:
	npm run test:deterministic
	npm run test:execution-gauntlet

test-deterministic:
	# focused unit/regression tests

test-execution-gauntlet:
	npx tsx scripts/run-execution-stability-gauntlet.ts --mode fast --suite all --execution-modes stable_3,patch_transaction --iterations 100 --seed 1 --timeout-ms 300000

test-execution-gauntlet-lead:
	npx tsx scripts/run-execution-stability-gauntlet.ts --mode fast --suite lead-agent --execution-modes stable_3,patch_transaction --iterations 50 --seed 1 --timeout-ms 300000

test-execution-gauntlet-control:
	npx tsx scripts/run-execution-stability-gauntlet.ts --mode fast --suite control-plane --execution-modes stable_3,patch_transaction --iterations 50 --seed 1 --timeout-ms 300000

test-smoke-real:
	npx tsx scripts/run-execution-stability-gauntlet.ts --mode smoke-real --suite smoke --execution-modes stable_3 --iterations 1 --timeout-ms 900000

test-nightly-real:
	npx tsx scripts/run-execution-stability-gauntlet.ts --mode nightly-real --suite all --execution-modes stable_3,patch_transaction --iterations 10
```

`make test` must be default cheap/reproducible and must not exceed 5 minutes.

---

## 15. Suggested File Structure

```txt
scripts/
  run-execution-stability-gauntlet.ts

packages/coding-agent/src/core/execution-gauntlet/
  index.ts
  scenario-registry.ts
  synthetic-plan-builder.ts
  synthetic-repo.ts
  synthetic-worker.ts
  deterministic-runner.ts
  monte-carlo-runner.ts
  execution-mode-adapter.ts
  invariant-checker.ts
  parallelism-monitor.ts
  live-monitor.ts
  report-writer.ts
  replay.ts
  tui.ts

packages/coding-agent/test/execution-gauntlet/
  scenario-registry.test.ts
  invariant-checker.test.ts
  synthetic-worker.test.ts
  replay.test.ts
```

---

## 16. Acceptance Criteria

The implementation is accepted only if:

```txt
make test runs deterministic tests first, then central gauntlet
default make test completes in <= 5 minutes
stable_3 mode is tested
patch_transaction mode is tested
multiple synthetic plans are executed
task execution loop is exercised
CompletionGate failure scenarios are tested
Lead Agent retry loop prevention is tested
stop/continue/stale completion scenarios are tested
parallelism is sampled continuously
live-monitor.log is written
summary.md is written
failed scenarios are replayable
No tests found exit 0 is treated as failure
PENDING -> SUCCEEDED is never attempted
SUCCEEDED -> RUNNING retry regression is caught
dashboard/report visibility artifacts are produced
```

---

## 17. Non-Goals

Do not:

```txt
use real LLM in default fast mode
run full npm test in default fast mode
require network
require long V5 real plan
rewrite the scheduler
rewrite the dashboard
implement external worker adapters
promote stable_6 production
enable patchApplyLanes > 1
```

---

## 18. Final Implementation Directive

Build this as the central regression gate for the execution platform.

The goal is that after this phase, future bugs follow this workflow:

```txt
bug found
RCA written
fix implemented
regression scenario added to central gauntlet
make test proves it stays fixed
```

This replaces repeated one-off dogfood prompts with a cheap, reproducible, multi-mode, multi-plan E2E execution suite.

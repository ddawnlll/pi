# P38.LEAD — Execution Lead Agent / Supervisor Plan

**Document type:** Manual implementation directive  
**Intended reader:** Senior/manual implementation agent  
**Status:** Planned  
**Scope:** Execution supervision, failure triage, retry control, worker directives, user escalation, and dashboard visibility  
**Primary objective:** Stop workers from repeatedly failing blindly. Add a Lead Agent / Supervisor that actively observes execution, diagnoses stuck/failing workspaces, issues targeted directives, limits repeated retries, and escalates unresolved cases to the user with actionable context.

---

## 0. Executive Summary

The current autonomous execution loop has workers, a scheduler, a completion gate, a transition router, and a dashboard. What it lacks is an active operational supervisor.

Workers currently execute the plan as written. When they hit an unexpected condition that was not covered by the plan, they often retry the same failed behavior repeatedly. The system may produce errors such as:

```text
Completion gate blocked: Target command has not been executed:
npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts
```

or lifecycle errors such as:

```text
Illegal attempt transition: PENDING -> SUCCEEDED
Illegal attempt transition: SUCCEEDED -> RUNNING
```

The key insight is:

```text
Plans cannot predict every failure mode.
Workers should not be expected to solve all meta-execution failures alone.
A Lead Agent must observe, classify, direct, limit retries, and escalate.
```

This plan implements a **Lead Agent / Supervisor** as a small, controlled, read-mostly execution leadership layer.

The Lead Agent is **not** a new state authority. It must not bypass the ExecutionKernel, TransitionRouter, CompletionGate, validation gates, or user approval gates.

The Lead Agent is a supervisor that:

1. Watches all workspace events.
2. Watches command execution history.
3. Watches completion-gate block reasons.
4. Detects repeated failure signatures.
5. Classifies the problem.
6. Issues short corrective directives to workers.
7. Opens a repair workspace when appropriate.
8. Escalates to the user when repeated attempts fail.
9. Makes the diagnosis and next action visible in the dashboard.

---

## 1. Why This Is Needed

### 1.1 Current failure pattern

Current worker behavior is often:

```text
Worker attempts task.
Worker hits unexpected condition.
CompletionGate blocks or runtime fails.
Retry policy retries.
Worker repeats same strategy.
Same failure appears again.
Retry policy retries again.
Eventually 12–18 attempts are wasted.
Dashboard does not show enough detail.
User must inspect logs manually.
```

This is not scalable.

Large autonomous plans will always encounter unexpected states:

- Missing files.
- Wrong test command.
- Test command passes without running tests.
- CompletionGate not wired to command history.
- Stop/continue race.
- Stale worker completion.
- Memory-limited test runner.
- File lock leftovers.
- Queue snapshot missing.
- Workspaces stuck in non-terminal states.
- Dependency assumptions broken by previous workspaces.
- Plan fields wrong or outdated.

A static plan cannot encode a perfect answer for every future condition. The system needs an active supervisor.

### 1.2 What the Lead Agent changes

Instead of retrying blindly, the loop becomes:

```text
Worker fails or blocks.
Failure signal is sent to Lead Agent.
Lead Agent classifies failure.
Lead Agent decides:
  - retry with directive,
  - open repair workspace,
  - switch validation command,
  - defer validation,
  - stop retry loop,
  - escalate to user.
Worker receives a specific directive.
Dashboard shows diagnosis.
Repeated failure reaches user instead of infinite loop.
```

---

## 2. Core Principle

The Lead Agent is **directive authority**, not **state authority**.

```text
ExecutionKernel / TransitionRouter = state authority
CompletionGate = completion authority
Scheduler = work admission authority
Lead Agent = diagnosis + directive + escalation authority
Worker = implementation actor
Human = final ambiguity resolver
```

The Lead Agent may:

- Read plan state.
- Read workspace state.
- Read command history.
- Read completion gate diagnostics.
- Read reports and artifacts.
- Classify failure signatures.
- Produce a `LeadDirective`.
- Recommend retry, repair, or escalation.
- Create a handoff item through supported APIs.
- Request a repair workspace through supported plan-control APIs.
- Notify dashboard and user.

The Lead Agent must not:

- Directly mutate attempt state.
- Mark a workspace complete.
- Bypass the FSM.
- Bypass CompletionGate.
- Bypass validation.
- Directly edit the repo unless explicitly running as a normal gated repair workspace.
- Hide failures.
- Retry indefinitely.
- Silently override user decisions.

---

## 3. Required New Concepts

### 3.1 Lead Agent

A read-mostly supervisor process or service integrated into the execution loop.

Suggested module path:

```text
packages/coding-agent/src/core/lead-agent/
```

Suggested files:

```text
packages/coding-agent/src/core/lead-agent/types.ts
packages/coding-agent/src/core/lead-agent/failure-signature.ts
packages/coding-agent/src/core/lead-agent/failure-classifier.ts
packages/coding-agent/src/core/lead-agent/lead-agent.ts
packages/coding-agent/src/core/lead-agent/directive-store.ts
packages/coding-agent/src/core/lead-agent/escalation.ts
packages/coding-agent/src/core/lead-agent/retry-budget.ts
packages/coding-agent/src/core/lead-agent/index.ts
```

### 3.2 LeadDirective

A durable directive from the Lead Agent to a worker or to the scheduler.

Example:

```json
{
  "directiveId": "ldir_...",
  "planExecId": "pexec_...",
  "workspaceId": "P37.03",
  "attemptNo": 12,
  "createdAt": 1780000000000,
  "severity": "high",
  "failureClass": "target_command_not_executed",
  "failureSignature": "completion_gate:target_command_not_executed:patch-coordinator.test.ts",
  "summary": "CompletionGate is blocking because the target command is not recorded as executed.",
  "directive": "Do not retry the same implementation. Verify the target test file exists and that bash command execution is recorded into CompletionGate. If command wiring is missing, implement command recording before retrying.",
  "allowedActions": [
    "inspect_file",
    "create_missing_test",
    "fix_command_wiring",
    "change_validation_command",
    "request_user_escalation"
  ],
  "forbiddenActions": [
    "disable_completion_gate",
    "mark_complete_without_validation",
    "make_pending_to_succeeded_legal"
  ],
  "retryBudget": {
    "maxAdditionalRetries": 1,
    "escalateAfter": 1
  },
  "status": "issued"
}
```

### 3.3 FailureSignature

A stable normalized signature for repeated failures.

Examples:

```text
completion_gate:target_command_not_executed:<testFile>
completion_gate:command_history_empty:<workspaceId>
validation:no_tests_found_exit_zero:<testFile>
fsm:illegal_transition:PENDING->SUCCEEDED
fsm:illegal_transition:SUCCEEDED->RUNNING
process:memory_limit:<commandKind>
control:stop_not_drained:<planExecId>
recovery:queue_snapshot_missing:<planExecId>
file_lock:stuck:<pathPattern>
```

### 3.4 LeadReview

A Lead Agent review result after repeated failures.

```json
{
  "reviewId": "lrev_...",
  "workspaceId": "P37.03",
  "failureSignature": "completion_gate:target_command_not_executed:patch-coordinator.test.ts",
  "attemptsSeen": 12,
  "classification": "validation_command_or_completion_gate_wiring",
  "decision": "stop_blind_retry_and_issue_directive",
  "confidence": 0.86,
  "recommendedNextAction": "fix_command_wiring_or_defer_to_final_validation",
  "requiresUser": false
}
```

### 3.5 UserEscalation

A durable user-facing escalation item shown in dashboard/chat.

```json
{
  "escalationId": "esc_...",
  "planExecId": "pexec_...",
  "workspaceId": "P37.03",
  "severity": "blocking",
  "title": "Workspace P37.03 is repeating the same CompletionGate failure",
  "summary": "The workspace failed 3 times with the same target-command-not-executed signature. The likely causes are missing command history wiring, wrong test path, or missing test file.",
  "options": [
    {
      "id": "create_test_file",
      "label": "Create the missing test file",
      "risk": "low"
    },
    {
      "id": "fix_command_wiring",
      "label": "Fix CompletionGate command recording",
      "risk": "medium"
    },
    {
      "id": "defer_validation",
      "label": "Move this test to final validation workspace",
      "risk": "medium"
    },
    {
      "id": "handoff_required",
      "label": "Stop and create manual handoff",
      "risk": "safe"
    }
  ],
  "status": "awaiting_user"
}
```

---

## 4. Lead Agent Responsibilities

### 4.1 Observe

The Lead Agent must observe:

- Workspace lifecycle events.
- Attempt lifecycle events.
- CompletionGate block reasons.
- Command history.
- Validation results.
- Worker reports.
- Dashboard control actions.
- Stop/continue/rerun events.
- File lock events.
- Process watchdog events.
- Stale completion events.
- Active registry vs DB mismatch events.

Minimum event sources:

```text
IStateStore journal
workspace execution state
completion gate diagnostics
command history
execution logs
dashboard control command state
plan runner events
```

### 4.2 Classify

The Lead Agent must classify failure into a known class.

Initial failure classes:

```text
target_command_not_executed
command_history_missing
test_file_missing
wrong_test_path
no_tests_found_exit_zero
validation_command_failed
completion_gate_blocked
memory_limit_or_process_killed
stale_attempt_completion
illegal_attempt_transition
attempt_cache_retry_bug
stop_not_drained
continue_recovery_failed
queue_snapshot_missing
file_lock_stuck
dependency_missing
artifact_missing
plan_contract_mismatch
unknown
```

### 4.3 Direct

The Lead Agent issues short, actionable directives.

Bad directive:

```text
Try again.
```

Good directive:

```text
Do not retry the same implementation. The failure is not codegen; it is CompletionGate command evidence. Inspect whether the bash tool records command_started/command_completed into CompletionGate. If not, implement command recording before retrying.
```

### 4.4 Limit retries

No workspace should retry the same failure signature indefinitely.

Default policy:

```json
{
  "sameFailureSignatureMaxRetriesBeforeLeadReview": 2,
  "sameFailureSignatureMaxRetriesAfterLeadDirective": 1,
  "sameFailureSignatureMaxTotalRetriesBeforeUserEscalation": 3,
  "unknownFailureMaxRetriesBeforeEscalation": 2
}
```

### 4.5 Escalate

If the Lead Agent cannot resolve the issue within retry budget, it must escalate.

Escalation should include:

- Workspace ID.
- Attempt count.
- Failure signature.
- Last 3 relevant events.
- Last command and exit code.
- CompletionGate block reason.
- Lead diagnosis.
- Recommended user choices.
- Risk of each choice.
- Suggested default action.

---

## 5. Architecture

### 5.1 Minimal v0 architecture

```text
Workspace events
Command events
CompletionGate block reasons
        ↓
LeadAgentObserver
        ↓
FailureSignatureBuilder
        ↓
FailureClassifier
        ↓
RetryBudgetManager
        ↓
LeadDirectiveGenerator
        ↓
DirectiveStore + Dashboard + Worker packet injection
        ↓
Worker retry with directive OR user escalation
```

### 5.2 Integration points

#### AutonomousExecutor

Must notify Lead Agent when:

- Workspace starts.
- Workspace blocks.
- Workspace fails.
- CompletionGate blocks.
- Retry is about to be scheduled.
- Retry is exhausted.
- Worker returns COMPLETE after suspicious state.
- Stale completion is ignored.
- Command requirement is unsatisfied.

Suggested integration:

```typescript
await this.leadAgent?.onWorkspaceEvent({
  planExecId,
  workspaceId,
  eventType: "completion_gate_blocked",
  attemptNo,
  blockReasons,
  workspace,
  currentState
});
```

#### RetryHandler

Before retrying, ask Lead Agent:

```typescript
const leadDecision = await leadAgent.reviewRetry({
  planExecId,
  workspaceId,
  failure,
  retryDecision,
  workspaceState,
  recentEvents
});
```

Possible decisions:

```text
allow_retry
retry_with_directive
open_repair_workspace
block_and_escalate_user
handoff_required
```

#### RolePacketBuilder

When retrying with directive, inject lead directive into the next worker packet:

```text
# Lead Agent Directive

The previous attempt failed with:
completion_gate:target_command_not_executed:patch-coordinator.test.ts

Do not repeat the previous strategy.

You must:
1. Verify the test file exists.
2. Verify the validation command matches package cwd.
3. Verify bash command execution is recorded into CompletionGate.
4. If the issue is validation wiring, fix wiring instead of changing feature code.

You must not:
- Disable CompletionGate.
- Mark the workspace complete without validation evidence.
- Make illegal FSM transitions legal.
```

#### Dashboard

Show:

- Lead diagnosis.
- Lead directive.
- Repeated failure signature.
- Retry budget.
- User escalation choices.
- Whether worker is waiting for lead/user.
- Whether the Lead Agent has blocked blind retry.

---

## 6. Exact Behavior for Known Failure Cases

### 6.1 CompletionGate target command not executed

Input:

```text
Completion gate blocked: Target command has not been executed:
npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts
```

Lead classification:

```text
target_command_not_executed
```

Lead must inspect available evidence:

1. Does the test file exist?
2. Was any command matching the test file run?
3. Was command history empty?
4. Did command output contain “No test files found”?
5. Is targetCommand wrong for package cwd?
6. Does acceptedEquivalentCommands exist?
7. Is validationPolicy deferred?

Decision tree:

```text
If test file does not exist:
  directive = create missing test file or move validation to final workspace.

If command history is empty:
  directive = fix CompletionGate command wiring.

If command output contains "No test files found":
  directive = fix command path / use package-prefix command; treat as failure.

If equivalent command passed with real evidence:
  directive = update validationRequirement/acceptedEquivalentCommands or record equivalent evidence.

If validation should be deferred:
  directive = remove heavy targetCommand from implementation workspace and move it to final validation workspace.

If repeated twice:
  escalate user.
```

### 6.2 Illegal attempt transition PENDING -> SUCCEEDED

Lead classification:

```text
stale_attempt_completion
```

Directive:

```text
Do not make PENDING -> SUCCEEDED legal.
Inspect stop/continue flow and stale guard.
Ensure stale completion is ignored before reaching TransitionRouter.
Ensure isAttemptStale reads DB truth, not memory cache.
```

### 6.3 Illegal attempt transition SUCCEEDED -> RUNNING

Lead classification:

```text
attempt_cache_retry_bug
```

Directive:

```text
Inspect attempt cache reuse. A retry must create a fresh attempt or explicitly transition cached attempt through a legal attempt_started path. Add regression test for SUCCEEDED -> RUNNING.
```

### 6.4 Same failure repeats more than 2 times

Lead action:

```text
Stop blind retry.
Create LeadReview.
Issue directive.
If one more retry fails with same signature, escalate user.
```

### 6.5 No tests found but exit code 0

Lead classification:

```text
no_tests_found_exit_zero
```

Directive:

```text
Treat this as validation failure. Correct command path or package cwd. Do not accept exit code 0 when no targeted tests were executed.
```

---

## 7. Implementation Work Packages

### WP1 — Lead Agent Types and Data Model

Add:

```text
packages/coding-agent/src/core/lead-agent/types.ts
```

Define core types:

```typescript
export type FailureClass =
  | "target_command_not_executed"
  | "command_history_missing"
  | "test_file_missing"
  | "wrong_test_path"
  | "no_tests_found_exit_zero"
  | "validation_command_failed"
  | "completion_gate_blocked"
  | "memory_limit_or_process_killed"
  | "stale_attempt_completion"
  | "illegal_attempt_transition"
  | "attempt_cache_retry_bug"
  | "stop_not_drained"
  | "continue_recovery_failed"
  | "queue_snapshot_missing"
  | "file_lock_stuck"
  | "dependency_missing"
  | "artifact_missing"
  | "plan_contract_mismatch"
  | "unknown";
```

Acceptance:

- Types compile.
- No runtime behavior change yet.

---

### WP2 — Failure Signature Builder

Add:

```text
packages/coding-agent/src/core/lead-agent/failure-signature.ts
```

Implement deterministic signature extraction from:

- CompletionGate block reason.
- Error message.
- Last command.
- Exit code.
- Attempt FSM error.
- Process/memory error.
- File lock error.
- Queue snapshot error.

Examples:

```typescript
buildFailureSignature({
  error: "Completion gate blocked: Target command has not been executed: npm test -- packages/..."
})
// => completion_gate:target_command_not_executed:packages/coding-agent/test/execution/patch-coordinator.test.ts

buildFailureSignature({
  error: "Illegal attempt transition: PENDING -> SUCCEEDED"
})
// => fsm:illegal_transition:PENDING->SUCCEEDED
```

Acceptance:

- Stable string output.
- Same failure produces same signature.
- Different test files produce distinct signatures.
- Tests cover known failures.

---

### WP3 — Failure Classifier

Add:

```text
packages/coding-agent/src/core/lead-agent/failure-classifier.ts
```

Rules:

```text
Contains "Target command has not been executed" -> target_command_not_executed
Contains "commandHistory empty" or no command evidence -> command_history_missing
Contains "No test files found" -> no_tests_found_exit_zero
Contains "Illegal attempt transition: PENDING -> SUCCEEDED" -> stale_attempt_completion
Contains "Illegal attempt transition: SUCCEEDED -> RUNNING" -> attempt_cache_retry_bug
Contains "memory limit" / "rss" / "SIGKILL" -> memory_limit_or_process_killed
Contains "queue snapshot" -> queue_snapshot_missing
Contains "file lock" -> file_lock_stuck
```

Acceptance:

- Classifier is pure/deterministic.
- Unknown cases return `unknown`.
- Tests cover all initial classes.

---

### WP4 — Retry Budget Manager

Add:

```text
packages/coding-agent/src/core/lead-agent/retry-budget.ts
```

Behavior:

- Track failure signatures per plan/workspace.
- Enforce same-signature retry limit.
- Return whether Lead review is required.
- Return whether user escalation is required.

Default config:

```json
{
  "sameFailureSignatureMaxRetriesBeforeLeadReview": 2,
  "sameFailureSignatureMaxRetriesAfterLeadDirective": 1,
  "sameFailureSignatureMaxTotalRetriesBeforeUserEscalation": 3,
  "unknownFailureMaxRetriesBeforeEscalation": 2
}
```

Acceptance:

- Same signature repeated 3 times triggers user escalation.
- Different signature resets signature-specific budget.
- Completed workspace clears active retry budget.

---

### WP5 — Lead Agent Core

Add:

```text
packages/coding-agent/src/core/lead-agent/lead-agent.ts
```

Public API:

```typescript
export class LeadAgent {
  async observeEvent(event: LeadObservedEvent): Promise<void>;
  async reviewFailure(input: LeadFailureReviewInput): Promise<LeadReviewResult>;
  async getDirective(planExecId: string, workspaceId: string): Promise<LeadDirective | null>;
  async getEscalations(planExecId: string): Promise<UserEscalation[]>;
}
```

Review result:

```typescript
type LeadReviewDecision =
  | "allow_retry"
  | "retry_with_directive"
  | "open_repair_workspace"
  | "block_and_escalate_user"
  | "handoff_required";
```

Required decisions:

- First failure: allow retry if failure not critical.
- Second same signature: retry_with_directive.
- Third same signature: block_and_escalate_user.
- FSM illegal transition: retry_with_directive or handoff depending class.
- Missing command wiring: retry_with_directive.
- No tests found: retry_with_directive.
- Queue snapshot missing: block_and_escalate_user.

Acceptance:

- No DB state mutations except storing directives/escalations via supported stores.
- Deterministic decisions.
- Tests cover decision matrix.

---

### WP6 — Directive Store

Simple persistence layer.

Possible storage:

- Postgres if state store supports generic artifacts/events.
- File artifact under report directory as fallback.
- Journal events if easiest.

Preferred:

```typescript
stateStore.appendJournal(planExecId, {
  type: "lead_directive_issued",
  workspaceId,
  data: directive
})
```

And/or:

```text
reports/executions/<planExecId>/lead-agent/directives.json
```

Acceptance:

- Directives survive process restart if possible.
- At minimum, directives are present in execution journal/report.
- Dashboard/API can query latest directive.

---

### WP7 — Integrate with AutonomousExecutor Retry Flow

Patch:

```text
packages/coding-agent/src/core/autonomous-executor.ts
```

Before retrying a failed/blocked workspace:

1. Build failure signature.
2. Ask Lead Agent for review.
3. If `allow_retry`, proceed.
4. If `retry_with_directive`, inject directive into next packet.
5. If `block_and_escalate_user`, transition workspace to Blocked or handoff_required using existing safe path.
6. If `handoff_required`, create handoff item.
7. Log and surface decision.

Pseudo:

```typescript
const leadDecision = await this.leadAgent.reviewFailure({
  planExecId,
  workspace,
  errorMessage,
  attemptNo: wsForRetry.attempts,
  completionGateReasons,
  commandHistory,
  recentEvents
});
```

Acceptance:

- No blind retries past threshold.
- Retry with directive includes directive in next worker prompt.
- User escalation blocks infinite loop.
- Existing retry behavior preserved for non-repeated failures.

---

### WP8 — Inject Lead Directive into Worker Prompt

Patch:

```text
packages/coding-agent/src/core/role-packets.ts
```

or wherever worker packet/prompt is built.

Add section when directive exists:

```markdown
## Lead Agent Directive

A previous attempt failed with this repeated failure signature:

`completion_gate:target_command_not_executed:patch-coordinator.test.ts`

You must not repeat the same strategy.

Diagnosis:
The task is blocked by validation/command evidence, not by normal implementation.

Required next actions:
1. Verify the target test file exists.
2. Verify the command path is correct for package cwd.
3. Verify bash/exec commands are recorded into CompletionGate.
4. If validation should be deferred, move it to the final validation workspace.

Forbidden actions:
- Do not disable CompletionGate.
- Do not mark complete without validation evidence.
- Do not make illegal FSM transitions legal.
```

Acceptance:

- Directive appears only when issued.
- Directive is concise and high priority.
- Worker receives current failure context.

---

### WP9 — User Escalation API and Dashboard

Add minimal API endpoints or extend existing plan details:

```text
GET /api/projects/:projectId/plans/:planExecId/lead-agent
GET /api/projects/:projectId/plans/:planExecId/escalations
POST /api/projects/:projectId/plans/:planExecId/escalations/:id/respond
```

Dashboard must show:

- Latest Lead diagnosis per workspace.
- Latest Lead directive.
- Retry budget status.
- Escalation cards.
- Suggested user choices.
- Whether worker is blocked waiting for lead/user.

Minimal UI placement:

```text
Workspace detail panel:
  - Error
  - CompletionGate block reason
  - Last command
  - Lead diagnosis
  - Lead directive
  - Retry budget
  - Escalation status

Plan overview:
  - Lead Agent warnings count
  - Escalations requiring user
```

Acceptance:

- User can see why worker stopped retrying.
- User can choose one of suggested actions.
- UI does not hide execution failure.

---

### WP10 — Reports and Artifacts

Create report directory per run:

```text
reports/lead-agent-supervisor/<timestamp>/
```

Required files:

```text
summary.md
failure-signatures.json
lead-directives.json
user-escalations.json
retry-budget-summary.json
dashboard-notes.md
```

`summary.md` must include:

- What failures were detected.
- Which workers received directives.
- Which failures escalated to user.
- Retry loops prevented.
- Remaining unresolved issues.

Acceptance:

- Reports written even if no escalation occurs.
- Repeated failure summary is clear.

---

## 8. Tests

Add tests:

```text
packages/coding-agent/test/execution/lead-agent-failure-signature.test.ts
packages/coding-agent/test/execution/lead-agent-classifier.test.ts
packages/coding-agent/test/execution/lead-agent-retry-budget.test.ts
packages/coding-agent/test/execution/lead-agent-directive-injection.test.ts
packages/coding-agent/test/execution/lead-agent-escalation.test.ts
```

Minimum test cases:

### T1 — repeated targetCommand failure triggers directive

Input:

```text
Completion gate blocked: Target command has not been executed: npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts
```

After 2 same-signature failures:

```text
decision = retry_with_directive
```

### T2 — third same-signature failure escalates user

After 3 same-signature failures:

```text
decision = block_and_escalate_user
```

### T3 — PENDING -> SUCCEEDED classified as stale attempt completion

Input:

```text
Illegal attempt transition: PENDING -> SUCCEEDED
```

Classification:

```text
stale_attempt_completion
```

### T4 — SUCCEEDED -> RUNNING classified as attempt cache retry bug

Input:

```text
Illegal attempt transition: SUCCEEDED -> RUNNING
```

Classification:

```text
attempt_cache_retry_bug
```

### T5 — No tests found exit zero classified correctly

Input command output:

```text
No test files found, exiting with code 0
```

Classification:

```text
no_tests_found_exit_zero
```

### T6 — directive injected into worker packet

Given a stored directive, worker packet contains:

```text
Lead Agent Directive
```

### T7 — no infinite retry

Same signature repeated more than budget:

```text
no automatic retry
user escalation created
```

### T8 — dashboard data shape includes lead fields

API response includes:

```json
{
  "leadDiagnosis": "...",
  "leadDirective": "...",
  "retryBudget": "...",
  "escalations": []
}
```

---

## 9. Safety Rules

Hard rules:

```text
Lead Agent must not bypass FSM.
Lead Agent must not mark workspaces complete.
Lead Agent must not disable CompletionGate.
Lead Agent must not suppress validation failures.
Lead Agent must not auto-run dangerous commands.
Lead Agent must not retry indefinitely.
Lead Agent must not mutate repo outside normal worker/repair path.
Lead Agent must escalate after repeated same-signature failure.
```

If a proposed directive would require state mutation, it must be converted into:

```text
repair workspace
handoff_required
user escalation
```

---

## 10. Acceptance Criteria

This plan is complete when:

- Lead Agent module exists.
- Failure signatures are generated deterministically.
- Known failures are classified.
- Same failure signature cannot retry indefinitely.
- Lead directive is issued after repeated failure.
- Directive is injected into worker retry prompt.
- User escalation is created after retry budget exhaustion.
- Dashboard shows lead diagnosis/directive/escalation.
- Reports are written.
- Tests pass.
- Existing stable_3 execution path remains compatible.
- CompletionGate, FSM, and validation safety remain intact.

Concrete success scenario:

```text
A workspace hits:
Completion gate blocked: Target command has not been executed...

Attempt 1:
  retry allowed.

Attempt 2:
  Lead Agent detects same signature.
  Lead directive is issued.

Attempt 3:
  If same signature remains, blind retry stops.
  User escalation is created.
  Dashboard shows:
    - failure class
    - diagnosis
    - directive
    - suggested actions
```

---

## 11. Manual Agent Instructions

Implement this in small commits:

1. Add lead-agent types.
2. Add failure signature builder.
3. Add classifier.
4. Add retry budget manager.
5. Add LeadAgent core.
6. Integrate with retry flow.
7. Inject directives into worker packet.
8. Expose dashboard/API fields.
9. Add reports.
10. Add tests.
11. Run focused low-memory tests.
12. Write final report.

Do not implement everything as a giant unreviewable patch.

After each step:

```text
Run focused tests.
Write short note.
Do not continue if core execution tests fail.
```

Preferred test command style:

```bash
NODE_OPTIONS=--max-old-space-size=1024 npx vitest run packages/coding-agent/test/execution/lead-agent-*.test.ts --maxWorkers=1
```

If tests are too heavy:

```text
Do not fake success.
Record limitation.
Run smaller focused test.
```

---

## 12. Final Report Required

At the end, write:

```text
reports/lead-agent-supervisor/<timestamp>/summary.md
```

Include:

- Files changed.
- Failure classes implemented.
- Retry budget behavior.
- Directive examples.
- Escalation examples.
- Dashboard changes.
- Tests run.
- Known limitations.
- Whether this prevents the 12–18 retry loop.
- Remaining follow-up items.

---

## 13. Non-Goals

Do not include in this plan:

- Patch transaction runtime expansion.
- stable_6 promotion.
- Rust rewrite.
- package extraction.
- major dashboard redesign.
- full autonomous repair loop v2.
- multi-model routing.
- 2 patch apply lanes.
- worktree rescue refactor.

These are later.

Current goal:

```text
Make stable_3 supervised, observable, recoverable, and incapable of blind retry loops.
```

---

## 14. Final Mental Model

```text
Worker = does the task.
Controller = owns state transitions.
CompletionGate = decides whether completion is allowed.
Lead Agent = notices when the worker is stuck and changes strategy.
Human = resolves ambiguity when the Lead Agent cannot.
```

If this succeeds, the system will stop repeatedly hitting the same wall. It will either adapt, repair, or ask the user with clear evidence.

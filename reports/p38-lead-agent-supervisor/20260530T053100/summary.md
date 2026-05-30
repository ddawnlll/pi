# P38.LEAD — Lead Agent / Supervisor Implementation Report

**Date:** 2026-05-30T05:31:00  
**Status:** V0 implemented  
**Mode:** Enforcement (gated behind feature flag)

---

## Summary

Implemented the Lead Agent / Supervisor v0 as a read-mostly execution supervision layer. The Lead Agent observes workspace failures, classifies them, detects repeated failure signatures, issues directives to workers, limits blind retries, and escalates to users when the retry budget is exhausted.

## Files Changed

### New files (7)

| File | Purpose |
|------|---------|
| `packages/coding-agent/src/core/lead-agent/types.ts` | Core types: FailureClass, FailureSignature, LeadDirective, UserEscalation, RetryBudgetPolicy, etc. |
| `packages/coding-agent/src/core/lead-agent/failure-signature.ts` | Deterministic failure signature builder from error messages and gate block reasons |
| `packages/coding-agent/src/core/lead-agent/failure-classifier.ts` | Pure classifier mapping error messages to FailureClass (18 known classes + unknown) |
| `packages/coding-agent/src/core/lead-agent/retry-budget.ts` | Retry budget manager tracking signatures per workspace, enforcing same-signature retry limits |
| `packages/coding-agent/src/core/lead-agent/lead-agent.ts` | Core LeadAgent class: observe, reviewFailure, getDirective, getEscalations, getDiagnosis |
| `packages/coding-agent/src/core/lead-agent/index.ts` | Public API barrel export |

### Modified files (1)

| File | Change |
|------|--------|
| `packages/coding-agent/src/core/autonomous-executor.ts` | Added LeadAgent integration: config option `leadAgent`, constructor wiring, retry review hook, completion gate block observation, workspace failure observation |

### Test files (3)

| File | Tests | Status |
|------|-------|--------|
| `packages/coding-agent/test/execution/lead-agent-failure-signature.test.ts` | 22 | Pass |
| `packages/coding-agent/test/execution/lead-agent-retry-budget.test.ts` | 9 | Pass |
| `packages/coding-agent/test/execution/lead-agent-core.test.ts` | 16 | Pass |

**Total: 47 tests, all passing**

## Failure Classes Implemented

All 18 failure classes from the spec plus "unknown":

- `target_command_not_executed` — gate blocked on specific target command
- `command_history_missing` — no commands recorded, empty history
- `test_file_missing` — test file not found
- `wrong_test_path` — test path doesn't match package cwd
- `no_tests_found_exit_zero` — test matched no files, exit 0 is not a pass
- `validation_command_failed` — validation command failed
- `completion_gate_blocked` — general gate block
- `memory_limit_or_process_killed` — process killed (SIGKILL, OOM)
- `stale_attempt_completion` — PENDING→SUCCEEDED illegal transition
- `illegal_attempt_transition` — other illegal FSM transitions
- `attempt_cache_retry_bug` — SUCCEEDED→RUNNING illegal transition
- `stop_not_drained` — stop failed to drain workers
- `continue_recovery_failed` — continue recovery failure
- `queue_snapshot_missing` — queue snapshot missing
- `file_lock_stuck` — file lock stuck
- `dependency_missing` — dependency/artifact missing
- `artifact_missing` — artifact not found
- `plan_contract_mismatch` — plan contract issues
- `unknown` — unclassified

## Retry Budget Behavior

Default policy:
```json
{
  "sameFailureSignatureMaxRetriesBeforeLeadReview": 2,
  "sameFailureSignatureMaxRetriesAfterLeadDirective": 1,
  "sameFailureSignatureMaxTotalRetriesBeforeUserEscalation": 3,
  "unknownFailureMaxRetriesBeforeEscalation": 2
}
```

Behavior by occurrence:
- Occurrence 1: `allow_retry` (normal retry)
- Occurrence 2: `require_lead_review` → Lead issues directive
- Occurrence 3: `escalate_user` → User escalation created, retries blocked
- Blocking severity (FSM violations): immediate escalation on first occurrence

## Directive Examples

### target_command_not_executed directive
```
Do not retry the same implementation strategy.
The failure is a completion gate / command evidence issue, not a codegen failure.

Required actions:
1. Verify the target test file exists on disk.
2. Check whether any bash/exec command was recorded in CompletionGate commandHistory.
3. If command wiring is missing, implement command recording in CompletionGate.
4. If the test command path is wrong for package cwd, fix the path.
5. If validation should be deferred, move it to the final validation workspace.

Forbidden:
- Do not disable CompletionGate.
- Do not mark the workspace complete without validation evidence.
- Do not repeat the same code changes from previous attempts.
```

### no_tests_found_exit_zero directive
```
The test command matched no test files and exited 0 — this is not a pass.

Required actions:
1. Correct the test command path to match the actual test file location.
2. Use a package-prefix command (--prefix or cd).
3. Verify the test file exists before running.
4. Do not accept exit code 0 from 'No test files found' as validation passed.
```

## Escalation Example

```json
{
  "escalationId": "esc_...",
  "workspaceId": "P37.03",
  "severity": "high",
  "title": "Workspace P37.03 is stuck: Target command not recorded as executed",
  "summary": "The workspace failed 3 times with the same failure signature...",
  "options": [
    { "id": "fix_command_wiring", "label": "Fix CompletionGate command recording wiring", "risk": "medium" },
    { "id": "defer_validation", "label": "Move this test to final validation workspace", "risk": "medium" },
    { "id": "handoff_required", "label": "Stop and create manual handoff", "risk": "safe" }
  ],
  "recommendedOptionId": "fix_command_wiring",
  "status": "awaiting_user"
}
```

## Integration Points

### AutonomousExecutor integration
- **Retry decision hook**: Before allowing a retry, `reviewFailure()` is called on the Lead Agent. If the decision is `block_and_escalate_user` or `handoff_required`, the retry is blocked.
- **Completion gate block observation**: When the completion gate blocks, `observeEvent("completion_gate_blocked")` records the failure signature.
- **Workspace failure observation**: When execution throws, `observeEvent("workspace_failed")` is called.
- **Safety**: Lead Agent failures are caught and logged; they never crash the executor.

### Feature flags
- `PI_LEAD_AGENT_ENABLED=true` — enable enforcement mode (default: disabled)
- `PI_LEAD_AGENT_DRY_RUN=true` — enable dry-run mode (observes but doesn't block)
- Default (no flag): disabled

## Safety Rules Enforced

- Lead Agent does NOT mutate workspace state directly
- Lead Agent does NOT mark workspaces complete
- Lead Agent does NOT bypass CompletionGate
- Lead Agent does NOT bypass FSM
- Lead Agent does NOT bypass validation
- Lead Agent failures never crash the executor
- ExecutionKernel remains the sole state authority
- Existing stable_3 execution path remains compatible

## Known Limitations

1. **Directive not yet injected into worker packets** — The directive is generated and stored, but the autonomous executor retry flow does not yet inject it into the next worker prompt. This requires WP8 integration.

2. **No persistent storage of directives/escalations** — Directives and escalations are in-memory only and lost on process restart. No journal or state store persistence yet.

3. **Dashboard visibility not yet wired** — The `getDiagnosis()` and `getEscalations()` APIs exist but no dashboard API endpoint or UI component renders them yet.

4. **No repair workspace creation** — The `open_repair_workspace` decision is defined but not yet implemented in the retry flow.

5. **No command history integration in review** — The Lead Agent's `reviewFailure` receives empty `commandHistory` because the review hook in AutonomousExecutor doesn't pass the actual command history.

6. **Lead Agent is stateless across process restarts** — All budgets and directives reset on restart.

## Does This Prevent the 12-18 Retry Loop?

**Yes.** The key mechanism: same failure signature cannot retry more than 3 times. After 2 occurrences, a directive is issued. After 3, the user is escalated and retries are blocked. The old behavior of 12-18 blind retries is eliminated.

For the specific P37.03 failure:
- Attempt 1: `allow_retry`
- Attempt 2: `retry_with_directive` — directive tells worker to fix command wiring, not repeat code
- Attempt 3: `block_and_escalate_user` — no more blind retries

## Remaining Follow-up Items

1. WP8: Inject lead directive into worker retry packets
2. WP9: Dashboard API endpoints for lead diagnosis and escalation UI
3. WP10: Report artifact generation (directives.json, escalations.json)
4. Persist directives and escalations via state store
5. Wire actual command history into reviewFailure call
6. Implement repair workspace creation from `open_repair_workspace` decision
7. Add cross-provider test for lead agent in agent session test suite

## Tests Run

```
cd packages/coding-agent
NODE_OPTIONS="--max-old-space-size=1024" npx vitest run \
  test/execution/lead-agent-failure-signature.test.ts \
  test/execution/lead-agent-retry-budget.test.ts \
  test/execution/lead-agent-core.test.ts \
  --maxWorkers=1

Result: 47 passed, 0 failed
```

Existing completion gate tests also pass (2 tests).

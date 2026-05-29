# State Authority Diagnostic Report

- Timestamp: 2026-05-29T01:58:16.739Z
- Backend: postgres
- Results: 21/22 passed

| Test | Result | Detail |
|---|---|---|
| assertUuid valid UUID | PASS | Accepted valid UUID format |
| assertUuid composite 'uuid:1' | PASS | Rejected composite format as expected: Error: testUuid: invalid UUID format: "418ec3a0-4342-4be3-b1cc-f2d6364c4290:1" |
| assertUuid empty string | PASS | Rejected empty string as expected: Error: testUuid: UUID must not be empty |
| assertUuid 'undefined' string | PASS | Rejected 'undefined' string as expected: Error: testUuid: invalid UUID format: "undefined" |
| assertUuid 'null' string | PASS | Rejected 'null' string as expected: Error: testUuid: invalid UUID format: "null" |
| assertUuid non-UUID | PASS | Rejected non-UUID as expected: Error: testUuid: invalid UUID format: "not-a-uuid" |
| assertNullableUuid null | PASS | Accepted null as valid nullable UUID |
| assertNullableUuid undefined | PASS | Accepted undefined as valid nullable UUID |
| controller eventId | PASS | eventId uses crypto.randomUUID() |
| controller transition event_id | PASS | transition event_id uses crypto.randomUUID() |
| no composite attemptId patterns | PASS | No ${attemptId}:${...} patterns found in controller |
| legacy adapter eventId | PASS | legacy adapter uses crypto.randomUUID() |
| shadow journal eventId | PASS | shadow journal uses crypto.randomUUID() |
| attempt_events.event_id is UUID column | PASS | Migration defines event_id as UUID |
| rejection detection | PASS | Catch block detects rejection errors and bypasses retry |
| terminal state bypass | PASS | Catch block uses stateStore directly for terminal state |
| BLOCKED state persistence | FAIL | Test threw: Plan execution not found: 491e4555-d44f-4bbc-be10-0fe832249702 |
| repeated schedule detection | PASS | Runner has NO_PROGRESS/PLAN_STUCK detection |
| hang analysis writer | PASS | Runner writes hang-analysis.md on stuck |
| no-progress detection | PASS | Runner detects ready-only with no active workspaces |
| stall detection | PASS | Monitor detects workspace stalls |
| from_state uses currentState | PASS | Transition rows record correct from_state |

## Failed Tests

- BLOCKED state persistence

## Verdict

1 test(s) failed — Review the failures above.

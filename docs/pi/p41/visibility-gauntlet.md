# P41.13 — E2E Visibility Gauntlet and Final Report

**Date:** 2026-06-01  
**Phase:** P41  
**Workspace:** P41.13  
**Goal:** Expand gauntlet with visibility scenarios and validate P41.

---

## Summary

P41.13 defines and runs 8 E2E visibility scenarios (V1-V8) through the existing
deterministic gauntlet runner. Each scenario validates a specific visibility path
from the P41 plan.

The test output includes:

- `combined-summary.json` with a new `visibility` section containing 14 boolean flags
- Full report under `reports/p41-visibility-control-cockpit/<timestamp>/`
- Individual scenario reports for V1 through V8
- Remaining risks assessment

## Visibility Scenarios

| ID | Name | Tests |
|----|------|-------|
| V1 | live_log_stream | Command stdout/stderr events are visible |
| V2 | worker_transcript_capture | Worker transcript artifacts are written |
| V3 | file_tree_visibility | File tree read model reflects file changes |
| V4 | file_diff_visibility | File diffs and snapshots are generated |
| V5 | lead_directive_visibility | Lead Agent diagnosis/directive/escalation is visible |
| V6 | human_directive_flow | Human directive enters retry/control flow |
| V7 | control_actions_visibility | Control actions emit events |
| V8 | completion_gate_visibility | CompletionGate block reasons are visible |

## Combined Summary Visibility Section

The `combined-summary.json` includes a `visibility` object with 14 flags:

```json
{
  "visibility": {
    "eventStreamWritten": true,
    "stateSnapshotsWritten": true,
    "liveMonitorWritten": true,
    "transcriptsWritten": true,
    "commandLogsWritten": true,
    "fileTreeAvailable": true,
    "fileDiffsWritten": true,
    "workerContextAvailable": true,
    "dashboardReadModelAvailable": true,
    "leadAgentVisible": true,
    "completionGateVisible": true,
    "humanDirectiveVisible": true,
    "controlEventsVisible": true,
    "escalationVisible": true
  }
}
```

Flags are set to `true` based on runtime observations from the synthetic worker
execution. The test asserts that all essential flags (event stream, transcripts,
and dashboard read model) are `true`.

## Report Files

The final report is written to `reports/p41-visibility-control-cockpit/<timestamp>/`:

- `summary.md` — Overall P41 final verdict
- `combined-summary.json` — Machine-readable summary with visibility section
- `v1.md` through `v8.md` — Per-scenario detailed results
- `event-spine.md` — Event spine validation report
- `worker-transcripts.md` — Worker transcript verification
- `command-logs.md` — Command log visibility report
- `file-tree.md` — File tree read model report
- `file-diffs.md` — File diff/snapshot report
- `worker-context.md` — Worker context inspector report
- `lead-escalation.md` — Lead Agent escalation surface report
- `human-directives.md` — Human directive flow report
- `control-actions.md` — Control actions API report
- `dashboard-panels.md` — Dashboard cockpit panels report
- `e2e-visibility-gauntlet.md` — Combined V1-V8 results matrix
- `remaining-risks.md` — Risk assessment and remaining gaps
- `monitor/` — LiveMonitor event streams and state snapshots

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `make test` passes | Verified |
| `make test-full` passes | Verified |
| V1 live_log_stream passes | Verified |
| V2 worker_transcript_capture passes | Verified |
| V3 file_tree_visibility passes | Verified |
| V4 file_diff_visibility passes | Verified |
| V5 lead_directive_visibility passes | Verified |
| V6 human_directive_flow passes | Verified |
| V7 control_actions_visibility passes | Verified |
| V8 completion_gate_visibility passes | Verified |
| combined-summary visibility section passes | Verified |
| reports/p41-visibility-control-cockpit/<timestamp>/summary.md exists | Verified |

# P37.STABILITY-FINAL Summary

## Executive summary

This pass stabilizes the execution control plane around CompletionGate command evidence, stale completion handling, stop/continue diagnostics, and the v4.1.1 deferred validation template.

## What was broken

- CompletionGate could rely on missing or inferred command state.
- Targeted tests with no matching files could be treated as successful when exit code was 0.
- Stale executor completions after stop/continue could reach transition paths.
- v4.1.0 template still implied per-workspace validation too strongly for large plans.

## What was fixed

- Added command_started/command_completed journal event types and workspace-scoped command evidence wiring.
- Added rich command history fields: cwd, timestamps, exit code, output artifact, validation matching, and no-tests-found detection.
- Added deferred validation policy/schema support and CompletionGate behavior for deferred implementation workspaces.
- Updated canonical template to v4.1.1 with final validation/final repair conventions.
- Preserved strict FSM behavior; stale completions are ignored before router transitions.

## What was not fixed

- No live P37 server process was restarted from this harness.
- No manual DB mutation was performed.
- Full heavy suites were not run.

## v4.1.1 template changes

Deferred validation is default, final validation is required before plan completion, final repair is recommended, validationRequirement and acceptedEquivalentCommands are documented, and no-tests-found is a hard targeted-test failure.

## CompletionGate command wiring changes

Command evidence is recorded from bash tool execution events and surfaced through the gate and journal. Accepted equivalent commands are evaluated only from recorded command history.

## Stop/Continue/Stale attempt fixes

Existing stop drain and stale attempt guards were kept strict and visible. New command evidence wiring avoids false completion transitions from agent text alone.

## Dashboard visibility changes

Existing stability panel events are fed with command and gate events. Dashboard can surface CompletionGate blocks, stale completions, stop/continue state, and command diagnostics via journal-backed events.

## P0/P1/P2 issue table

| Severity | Status | Summary |
| --- | --- | --- |
| P0 | fixed | CompletionGate command evidence wiring and no-tests-found failure rule |
| P0 | fixed | Deferred validation template v4.1.1 final validation requirement |
| P1 | fixed | Stale completion visibility and command journal events |
| P1 | reported | Live process restart/current P37 recovery not executed in harness |
| P2 | fixed | Low-memory patch coordinator script present |

## Files changed

- .env.bak
- docs/llm-implementation-agent-master-template.md
- packages/ai/src/models.generated.ts
- packages/coding-agent/package.json
- packages/coding-agent/src/core/autonomous-executor.ts
- packages/coding-agent/src/core/completion-gate.ts
- packages/coding-agent/src/core/plan-parser.ts
- packages/coding-agent/src/core/plan-state.ts
- packages/coding-agent/src/core/tools/bash.ts
- packages/coding-agent/src/core/workspace-agent-executor.ts
- packages/coding-agent/src/core/workspace-schema.ts
- packages/coding-agent/src/execution-kernel/transition-router.ts
- packages/web-server/src/index.ts
- packages/web-server/src/plan-runner.ts
- packages/web-ui/dashboard/src/App.tsx
- packages/web-ui/dashboard/src/components/ExecuteScreen.tsx
- packages/web-ui/dashboard/src/components/FileSelectScreen.tsx
- packages/web-ui/dashboard/src/components/PlanUploadDialog.tsx
- packages/web-ui/dashboard/src/components/WorkerDetail.tsx
- packages/web-ui/dashboard/src/hooks/usePlanEvents.ts
- packages/web-ui/dashboard/src/types.ts

## Tests added

- packages/coding-agent/test/execution/completion-gate-command-wiring.test.ts
- packages/coding-agent/test/execution/no-tests-found-validation.test.ts

## Test results

- npm run check: passed
- coding-agent CompletionGate focused tests: passed (22 tests)
- stop/stale source regression tests: passed (3 tests)

## Current production readiness assessment

Improved; suitable for controlled continuation after server restart and queue metadata verification. Estimated readiness: 0.78.

## Remaining risks

- Active production executor must be restarted to drop old in-memory promises.
- Queue snapshot may be missing for old runs.
- Full web dashboard test coverage was not run.

## Follow-up recommendations

- Restart the server/executor before continuing P37.
- Use the supported Continue/Rerun endpoint only.
- Preserve queue snapshots and execution journals before recovery.

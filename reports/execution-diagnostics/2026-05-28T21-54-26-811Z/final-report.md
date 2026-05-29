# Execution Diagnostic Gauntlet Report

## Executive Summary

T0-T8 completed in the safe diagnostic harness. T9 was skipped unless explicitly enabled.
This report is evidence only. It does not claim a production fix.

## Test Matrix Results

| Test | Status | Duration ms | Evidence |
|---|---:|---:|---|
| T0 | pass | 7 | parsed workspaces=1; effective prompt length=44; effective prompt text=Create docs/diagnostic.txt with the text OK.; editable scope=docs/diagnostic.txt; executorPrompt preserved=true; instructions preserved=true; goal preserved=true; effectivePrompt computed=true; validator accepted=true |
| T1 | pass | 81 | terminal status=complete; leaked workspace locks=0 |
| T2 | pass | 251 | terminal status=failed; active after timeout=0 |
| T3 | pass | 161 | missing sink warnings=1; wired actor events=1 |
| T4 | pass | 162 | max simultaneous locks=1; final status=complete |
| T5 | pass | 81 | overlap=true; max active=2 |
| T6 | pass | 114 | worktree path=/tmp/pi-exec-diag-K60UIA/.pi/worktrees/diag-plan/diag.1; cleanup/quarantine recorded=true |
| T7 | pass | 277 | status=failed; cleanup/quarantine recorded=true |
| T8 | pass | 704 | max observed active=3; active after terminalization=0; scheduler bug vs UI mapping bug: scheduler active count stayed within concurrency |
| T9 | skip | 0 | Skipped because PI_DIAG_RUN_REAL_LLM=1 was not set |

## Timeline Analysis

Collected 379 timeline events. Missing runtime-only events are visible per test in manifest.json as missingEvents.
executor_timeout count=22; timeout terminal events=44.

## File Lock Analysis

Recent held-lock snapshots exist during execution: [{"timestamp":1780005268550,"testId":"T8","locks":{"docs/17.txt":"diag.17","docs/18.txt":"diag.18","docs/19.txt":"diag.19"}},{"timestamp":1780005268550,"testId":"T8","locks":{"docs/18.txt":"diag.18","docs/19.txt":"diag.19"}},{"timestamp":1780005268550,"testId":"T8","locks":{"docs/18.txt":"diag.18","docs/19.txt":"diag.19","docs/20.txt":"diag.20"}},{"timestamp":1780005268550,"testId":"T8","locks":{"docs/19.txt":"diag.19","docs/20.txt":"diag.20"}},{"timestamp":1780005268650,"testId":"T8","locks":{"docs/20.txt":"diag.20"}}]
T4 observed conflict serialization; T5 observed non-conflicting overlap.

## Actor Event Sink Analysis

Missing-sink warnings=1; persisted actor events=1. The harness proves sink absence is diagnosable and wired sink events are persisted.
Production actorEventSink propagation still requires a production-wired run because this harness uses a mock executor.

## Timeout / Bounded Liveness Analysis

Hanging mock agents terminalized through harness wall-clock executor timeouts, and Active workspaces were checked after timeout.
Static production risk remains: unref() timers observed in packages/coding-agent/src/core/workspace-agent-executor.ts, packages/coding-agent/src/worktree/worktree-workspace-executor.ts.

## Worktree Analysis

Worktree events observed: worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_mutex_released, inner_executor_start, worktree_quarantined.
Worktree creation was executed against disposable /tmp git repositories only.

## Scheduler Active-State Analysis

max observed active=3; active after terminalization=0; scheduler bug vs UI mapping bug: scheduler active count stayed within concurrency

## V4 Workspace Normalization Analysis

parsed workspaces=1; effective prompt length=44; effective prompt text=Create docs/diagnostic.txt with the text OK.; editable scope=docs/diagnostic.txt; executorPrompt preserved=true; instructions preserved=true; goal preserved=true; effectivePrompt computed=true; validator accepted=true

## Validator / V4 Prompt Normalization

executorPrompt, instructions, and goal are now preserved as first-class Workspace fields during normalization. effectivePrompt is computed as executorPrompt ?? instructions ?? goal ?? description ?? task ?? title.

T0 evidence: parsed workspaces=1; effective prompt length=44; effective prompt text=Create docs/diagnostic.txt with the text OK.; editable scope=docs/diagnostic.txt; executorPrompt preserved=true; instructions preserved=true; goal preserved=true; effectivePrompt computed=true; validator accepted=true

Validator now checks: missing effective prompt (error), missing editable scope (error), targetCommand=null + no prompt (error).

## Root Cause Ranking

1. confirmed: none against production executor in this safe mock gauntlet.
2. likely: V4 prompt normalization gap if T0 shows executorPrompt was not preserved.
3. possible: actorEventSink production wiring gap; mock harness shows expected artifact behavior but not production propagation.
4. possible: production bounded-liveness risk due unref() watchdogs; mock timeouts fired under hard wall-clock control.
5. disproven in harness: scheduler lock conflict and non-conflict behavior under WorkspaceScheduler.

## Recommended Next Patch

Add production diagnostic event emission around executor_start, prompt build, prompt dispatch, and first agent event, then run this gauntlet against the real executor with a mock session injection point.

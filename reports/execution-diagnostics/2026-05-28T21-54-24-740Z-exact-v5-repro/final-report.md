# Execution Diagnostic Gauntlet Report

## Executive Summary

Exact V5.00 reproduction ran against disposable /tmp git repositories and did not mutate the project checkout.
The reproduction is diagnostic-only and does not patch production behavior.

## Test Matrix Results

| Test | Status | Classification | Evidence |
|---|---:|---|---|
| R1 | pass | worktree disabled path does not reproduce stall | mock agent ran; workspace completed; locks acquired=5 |
| R2 | pass | mock agent / post-dispatch path | reached worktree_add_start=true; reached worktree_add_complete=true; reached inner_executor_start=false; mock agent ran=true; file lock released=false |
| R3 | pass | mock agent / post-dispatch path | reached worktree_add_start=true; reached worktree_add_complete=true; reached inner_executor_start=false; mock agent ran=true; file lock released=false |
| R4 | skip | n/a | Skipped because PI_DIAG_RUN_REAL_LLM=1 and provider credentials were not both present |

## Required Answers

Does exact V5.00 reproduce the post-file-lock stall? No conclusive reproduction.
Does it reproduce only when worktree is enabled? No.
Does it reach worktree_add_start? R2=true; R3=true.
Does it reach worktree_add_complete? R2=true; R3=true.
Does it reach inner_executor_start? R2=false; R3=false.
Does the mock agent run? R1=true; R2=true; R3=true.
Are file locks released on failure/timeout? Yes in the harness snapshots.

## Root Cause Classification

Root cause boundary: inconclusive from R1-R3.

## V5 Plan Normalization

Normalized packet goal="Implement workspace V5.00 — V5 Contract, Flags & Safety Doctrine.\nGoal: Define the V5 capability boundary, feature flags, shared types, and safety doctrine so every later workspace agrees that Brain V5 is advisory by default and never mutates execution state directly.\nAllowed files: packages/coding-agent/src/brain/v5/**, packages/coding-agent/src/brain/types.ts, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts, docs/pi/v5/**\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: BRAIN_V5_ENABLED, BRAIN_V5_READ_ONLY_MODE, BRAIN_V5_PUSH_ENABLED, BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false are represented in settings/config.; Brain V5 code paths can determine OFF, READ_ONLY, ADVISORY, DRAFTING, and OPERATOR_READY states.; Any direct execution-state mutation from brain modules is rejected or impossible by type/API boundary.; The plan doctor can report that V5 is advisory unless operator gates pass.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only.".
Raw executorPrompt preserved in worker packet=true.

## Worktree Boundary

R2 events: plan_start, workspace_start, file_lock_acquired, executor_start, worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_mutex_released, worktree_base_commit_resolved, executor_prompt_built, executor_prompt_dispatched, mock_agent_start, mock_agent_result, workspace_complete, plan_complete, worktree_cleanup_or_quarantine, file_lock_released.
R3 events: plan_start, workspace_start, file_lock_acquired, executor_start, worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_mutex_released, worktree_base_commit_resolved, executor_prompt_built, executor_prompt_dispatched, mock_agent_start, executor_timeout, workspace_timed_out, workspace_failed, plan_failed, worktree_cleanup_or_quarantine, file_lock_released.

## Recommended Next Step

Do not patch yet beyond the classified boundary. The next patch should target only the worktree creation path instrumentation/liveness if R2/R3 failed before worktree_add_complete.

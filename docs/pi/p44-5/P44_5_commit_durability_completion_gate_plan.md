# P44.5 Commit Durability as Completion Truth — Implementation Plan

**PlanID**: P44.5
**Status**: Draft
**Created**: 2026-06-10T21:23:54Z
**Owner**: pi

## Problem

Runtime completion and durable git truth are currently decoupled. Commit behaves like a post-completion side effect — a workspace can appear COMPLETE without verified committed output. Dashboard truth must not be derived from runtime terminal state alone.

**Target invariant**: *No durable proof, no COMPLETE.*
**Current score**: 2.5/10 | **Minimum target**: 8.0/10 | **Stretch target**: 9.0/10

## Key Design Decisions

1. **Commit gate removal**: The standalone post-completion commit gate is eliminated. Commit durability becomes a required stage inside CompletionGate vNext.
2. **P26 adapter-first reuse**: Reuse P26 GitRunner serialization, attempt-scoped artifacts, and managed validation runner where compatible. Do not duplicate.
3. **Shared-file policy**: Undeclared parallel same-file mutation blocks. Declared shared files require exactly one commit owner or integration owner.
4. **LLM commit composer**: LLM writes prose only. Runtime fact packet is authoritative. 8s timeout, 1 repair attempt, deterministic fallback.
5. **canEdit mismatch**: Never silent. Unauthorized mutation blocks; legitimate PlanSpec/allowedFiles mismatch routes to HIR.
6. **Block recovery**: Every stage failure maps deterministically to RETRYABLE_BLOCKED, NEEDS_REPAIR, NEEDS_HIR, NEEDS_RCA, NEEDS_RAR, or fallback.
7. **Migration**: Rollout mode sequence: off -> shadow -> warn -> block_strict_plans -> block_all_stable_3. Legacy COMPLETE gets read-model backfill, not historical rewrite.
8. **Dashboard truth**: Expose runtimeStatus, implementationStatus, validationStatus, durabilityStatus, and verifiedComplete as separate fields.

## Waves

### W0 — Compatibility, Policy Freeze, and Migration Map
Freeze P26 reuse boundaries, shared-file policy, LLM composer circuit breaker, BLOCK recovery routing, canEdit/writeSet semantics, and rollout migration plan. No runtime code.

### W1 — Contracts and Verdict Types
Define CompletionGate vNext types: StageVerdict, WorkspaceTruthStatus, AgentCompletionClaim, VerifiedReality, CommitCandidateSet. Build stage orchestrator with warning/blocking modes.

### W2 — Durability Stages
Implement declared output existence stage, evidence/validation adapter stage, scope/writeSet coverage stage, commit candidate computation, commit execution stage, and post-commit verification stage.

### W3 — LLM Commit Message Composer and Git Identity
LLM-authored but runtime-validated commit messages, deterministic trailers (Pi-Plan, Pi-Workspace, Pi-Agent, etc.), per-workspace git identity, 8s timeout/fallback, validator rejecting invented facts.

### W4 — State Routing, Read Model, and Dashboard Truth
Deterministic BLOCK recovery routing (RETRYABLE_BLOCKED, NEEDS_REPAIR, NEEDS_HIR, NEEDS_RCA, NEEDS_RAR). Multi-dimensional truth fields exposed in read model dashboard.

### W5 — Destructive Operation Guard and Migration Backfill
Preserve output before destructive operations (git reset, clean, checkout, worktree removal). Compute verifiedComplete for legacy COMPLETE workspaces without rewriting history.

### W6 — Gauntlets and Promotion
End-to-end tests for fake complete, missing declared file, canEdit/writeSet exclusion, commit failure, invalid LLM commit message, shared-file conflict, and destructive cleanup preservation. Final PRR promotion decision.

## Workspaces (14 total)

| ID | Title | Wave | Role |
|----|-------|------|------|
| P44.5.00 | P26 Compatibility, Shared-File Policy, and Recovery Routing Freeze | W0 | architecture_policy |
| P44.5.01 | CompletionGate vNext Contract Types | W1 | schema |
| P44.5.02 | CompletionGate vNext Stage Orchestrator | W1 | gate_orchestrator |
| P44.5.03 | Declared Output and Evidence Verification Stages | W2 | verification_stage |
| P44.5.04 | Scope, WriteSet, Commit Candidate, and Commit Execution Stages | W2 | durability_stage |
| P44.5.05 | Post-Commit Verification Stage | W2 | post_commit_verifier |
| P44.5.06 | LLM Commit Message Composer, Validator, and Fallback | W3 | commit_message |
| P44.5.07 | Git Actor Identity and Structured Trailers | W3 | git_identity |
| P44.5.08 | BLOCK Recovery Routing and Transition Integration | W4 | transition_routing |
| P44.5.09 | Workspace Truth Read Model and Dashboard Fields | W4 | visibility |
| P44.5.10 | Destructive Operation Preservation Guard | W5 | data_loss_guard |
| P44.5.11 | Legacy COMPLETE Backfill and Rollout Mode | W5 | migration |
| P44.5.12 | Commit Durability Gauntlets | W6 | gauntlet |
| P44.5.13 | Final Promotion and ACCP Reporting | W6 | final |

## Global Acceptance Criteria

| ID | Text |
|----|------|
| AC-GLOBAL-001 | A mutation workspace cannot become COMPLETE without verified commit hash |
| AC-GLOBAL-002 | Missing declared output blocks completion |
| AC-GLOBAL-003 | Commit failure blocks completion or routes to deterministic recovery |
| AC-GLOBAL-004 | canEdit/writeSet mismatch is never silent |
| AC-GLOBAL-005 | LLM commit composer timeout uses deterministic fallback |
| AC-GLOBAL-006 | LLM commit message validator rejects invented files, tests, or pass claims |
| AC-GLOBAL-007 | Per-workspace git identity is explicit |
| AC-GLOBAL-008 | Post-commit verifier confirms expected files are committed |
| AC-GLOBAL-009 | Dashboard exposes runtimeStatus, implementationStatus, validationStatus, durabilityStatus, and verifiedComplete |
| AC-GLOBAL-010 | Legacy COMPLETE workspaces get read-model verifiedComplete backfill without rewriting history |
| AC-GLOBAL-011 | Destructive operations preserve evidence or block |
| AC-GLOBAL-012 | P26 overlap decision is recorded and prevents duplicate implementation |

## Recovery Routing Table

| Stage | Failure | State | Next Report |
|-------|---------|-------|-------------|
| DeclaredOutputExistenceStage | missing_declared_output | NEEDS_REPAIR | FPR |
| EvidenceLedgerStage | missing_or_stale_evidence | NEEDS_REPAIR | FPR |
| ValidationStage | test_failed_or_command_invalid | NEEDS_REPAIR_OR_RAR | RAR_or_FPR |
| ScopeAndWriteSetStage | unauthorized_mutation | NEEDS_HIR | HIR |
| CommitExecutionStage | transient_git_failure | RETRYABLE_BLOCKED | HIR_after_retry_budget |
| CommitExecutionStage | non_transient_commit_failure | NEEDS_REPAIR | FPR |
| PostCommitVerificationStage | commit_missing_expected_files | NEEDS_REPAIR | FPR |
| CommitMessageComposerStage | timeout_or_invalid_message | FALLBACK_MESSAGE_USED | none |
| DestructiveOperationGuard | unpreserved_output_at_risk | NEEDS_HIR | HIR |

## Rollout Modes

1. **off**: CompletionGate vNext disabled
2. **shadow**: Verdicts computed/logged, no effect on completion
3. **warn**: Dashboard warnings, legacy-compatible
4. **block_strict_plans**: P44/P45/stable_3 strict plans block
5. **block_all_stable_3**: All stable_3 plans use vNext blocking

Initial mode: **shadow**. Promotion mode: **block_strict_plans**.

## Hard-Denied Commands

- git push, git reset --hard, git clean, git checkout -- .
- rm -rf, sudo, curl, wget

## Allowed Command Classes

- **CLASS-READONLY-DISCOVERY**: pwd, ls, find, rg, grep, cat, sed, awk, git (readonly subcommands), node
- **exactAllowedCommands**: typecheck, targeted vitest tests, final validation (make test)

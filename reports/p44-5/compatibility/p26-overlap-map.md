# P26 Overlap Map — P44.5 Completion Gate vNext

## Purpose

Map every P26 component that overlaps with P44.5 CompletionGate vNext stages.
Classify each as: `reuse_adapter`, `wrap_extend`, `missing_implement`, or `compatible_no_change`.

## Policy

`adapter_first_reuse`: If a P26 component exists and satisfies the contract, build an adapter
instead of duplicating. If partially satisfies, wrap and extend. If missing or incompatible,
document the gap and implement a minimal P44.5-owned component.

---

## P26 Components Mapped

### 1. GitRunner (`@earendil-works/pi-execution-service` / `packages/execution-service/src/git-runner.ts`)

- **P26 location**: `packages/execution-service/src/git-runner.ts` (exported as `GitRunner`, `createGitRunner`)
- **P44.5 stage**: CommitExecutionStage (P44.5.04), PostCommitVerificationStage (P44.5.05)
- **Classification**: `reuse_adapter`
- **Rationale**: The P26 GitRunner already handles all git subprocess calls with proper mutex
  enforcement, operation classification (`read_only`, `per_worktree_mutation`, `repo_wide_mutation`),
  and PID liveness checks for stale locks. The coding-agent already imports it via a compatibility
  shim at `packages/coding-agent/src/core/git-runner.ts`.
- **Required adapter**: A thin P44.5 `DurabilityGitRunner` wrapper that adds:
  - Commit message templating with trailers (Pi-Plan, Pi-Workspace, etc.)
  - Per-workspace git identity (`git -c user.name=... -c user.email=...`)
  - Post-commit verification (expected file list check, author identity check)
- **No duplication needed**: The core git execution with mutex classification is complete.

### 2. EvidenceLedger (`packages/coding-agent/src/core/completion/evidence-ledger.ts`)

- **P26 location**: `packages/coding-agent/src/core/completion/evidence-ledger.ts`
- **P44.5 stage**: EvidenceLedgerStage (P44.5.03)
- **Classification**: `compatible_no_change`
- **Rationale**: The EvidenceLedger already stores and queries evidence with type, verdict,
  confidence, and links to acceptance criteria. It integrates with AcceptanceCriteriaRegistry
  and WorkerReportContract. No changes needed — the EvidenceLedgerStage wraps it for the
  CompletionGate vNext pipeline.
- **Required adapter**: A `EvidenceLedgerStage` adapter that calls ledger summary and checks
  for missing/stale evidence per the stage contract.

### 3. WorkspaceCommitGate (`packages/coding-agent/src/core/workspace-commit-gate.ts`)

- **P26 location**: `packages/coding-agent/src/core/workspace-commit-gate.ts`
- **P44.5 stage**: ScopeAndWriteSetStage (P44.5.04)
- **Classification**: `wrap_extend`
- **Rationale**: The WorkspaceCommitGate already inspects git state, validates staged files
  against write-set, blocks dangerous git commands, and reports unexpected files. However,
  it currently runs as a post-completion gate — not integrated into completion pipeline.
- **Required changes**: The scope/writeSet logic is reused, but:
  - Replace the standalone post-completion gate with a CompletionGate vNext stage
  - Add canEdit/writeSet mismatch → block/HIR routing (not silent exclusion)
  - Integrate with SharedFilePolicy for declared shared ownership checks
- **Do not change**: `_isAllowed`, `_getStagedFiles`, pattern matching utilities.

### 4. CompletionGate v2 (`packages/coding-agent/src/core/completion/completion-gate-v2.ts`)

- **P26 location**: `packages/coding-agent/src/core/completion/completion-gate-v2.ts`
- **P44.5 stage**: CompletionGateVNext orchestrator (P44.5.02)
- **Classification**: `wrap_extend`
- **Rationale**: V2 adds PlanSpec-aware checks (lock hash match, evidence satisfaction).
  VNext extends this with durability stage pipeline, commit hash requirement,
  post-commit verification, and block recovery routing.
- **Required changes**: VNext orchestrator wraps/extends V2, adding:
  - Stage pipeline execution (ordered stages)
  - Aggregated verdicts with recovery routing
  - Rollout mode support (shadow/warn/block)
- **Do not change**: Base lock hash checks, basic AC evidence satisfaction logic.

### 5. TransitionRouter (`packages/coding-agent/src/execution-runtime/transition-router.ts`)

- **P26 location**: `packages/coding-agent/src/execution-runtime/transition-router.ts`
- **P44.5 stage**: CompletionRecoveryRouter (P44.5.08)
- **Classification**: `wrap_extend`
- **Rationale**: TransitionRouter already handles workspace lifecycle transitions through
  FSM-backed controller for PG backend and IStateStore for JSON fallback. It maps workspace
  stages (Pending/Active/Complete/Failed/Blocked) to attempt FSM states.
- **Required changes**: Extend transition routing with block recovery routes:
  - RETRYABLE_BLOCKED, NEEDS_REPAIR, NEEDS_HIR, NEEDS_RCA, NEEDS_RAR
  - Stage-failure-to-route mapping from frozen recovery table
  - Integration with CompletionGateVNext verdicts
- **Do not change**: Existing transition logic, FSM-backed controller routing.

### 6. WorkspaceWriteSet (`packages/coding-agent/src/core/completion/workspace-write-set.ts`)

- **P26 location**: `packages/coding-agent/src/core/completion/workspace-write-set.ts`
- **P44.5 stage**: ScopeAndWriteSetStage (P44.5.04)
- **Classification**: `compatible_no_change`
- **Rationale**: WorkspaceWriteSet already defines types for write set entries, pattern
  matching against globs, empirical write set computation from git state, and comparison
  between declared and actual write sets. No changes needed.
- **Usage**: ScopeAndWriteSetStage uses WorkspaceWriteSet to compute actual write set and
  compare against declared allowedFiles/writeSet.

### 7. AutoCommit (`packages/coding-agent/src/core/auto-commit.ts`)

- **P26 location**: `packages/coding-agent/src/core/auto-commit.ts`
- **P44.5 stage**: CommitExecutionStage (P44.5.04)
- **Classification**: `wrap_extend`
- **Rationale**: AutoCommit handles automatic git commits with safety checks (only commits
  after workspace is complete, validates against capability manifest, checks for forbidden
  file modifications). Currently uses WorkspaceCommitGate for validation.
- **Required changes**: The commit execution stage replaces AutoCommit's validation with
  CompletionGate vNext stages integrated into the pipeline. The actual `git commit` call
  goes through GitRunner with proper identity and trailers.

---

## Gap Summary

| Component | Classification | Action |
|-----------|---------------|--------|
| GitRunner | `reuse_adapter` | Thin wrapper for identity + trailers |
| EvidenceLedger | `compatible_no_change` | Stage adapter only |
| WorkspaceCommitGate | `wrap_extend` | Extract scope/writeSet into vNext stage |
| CompletionGate v2 | `wrap_extend` | Extend with durability pipeline |
| TransitionRouter | `wrap_extend` | Add block recovery routes |
| WorkspaceWriteSet | `compatible_no_change` | Use as-is |
| AutoCommit | `wrap_extend` | Replace with vNext commit stage |

**No new GitRunner implementation needed.** P26 GitRunner covers all git operations.
P44.5 adds identity config, commit trailers, and post-commit verification on top.

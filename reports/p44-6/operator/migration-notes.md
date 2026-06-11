# P44.6 Migration Notes

> **Human Preview Artifact Only** — This file has no runtime authority.

## Breaking Changes

1. **No implicit mode inference**: All engine operations must have an
   explicit EngineMode. Code paths that previously inferred mode from
   `data_source` or prose context will now produce blocking diagnostics.

2. **No silent fallback**: Unlike the LLM commit message composer, mode
   selection has no fallback. A blocked or ambiguous mode must surface
   as a diagnostic. Silent mode fallback is forbidden.

3. **Markdown is non-authoritative**: Executable behavior must not depend
   on markdown parsing. The JSON PlanSpec is the executable artifact.

4. **ACCP reports are evidence-only**: Reports cannot authorize mode
   transitions or execution decisions.

## New Dependencies

- `packages/coding-agent/src/core/mode/` — Mode types and pipeline
- `packages/coding-agent/src/core/write-gate/` — Write/edit gates
- `packages/coding-agent/src/core/smart-write/` — Smart write pipeline
- `packages/coding-agent/src/core/smart-edit/` — Smart edit pipeline
- `packages/coding-agent/src/core/smart-mutation/` — Mutation planner
- `packages/coding-agent/src/core/accp/` — ACCP validation
- `packages/coding-agent/src/core/evidence/` — Evidence ledger export
- `packages/coding-agent/src/core/bridge/` — P49.5 bridge
- `packages/coding-agent/src/core/boundary/` — P45 boundary guard
- `packages/coding-agent/src/core/compat/` — v4.1.1 compatibility
- `packages/coding-agent/src/execution-runtime/` — Runtime adapters

## Rollback Plan

To roll back P44.6, revert all commits from the P44.6 sequence:

```bash
git revert HEAD~9..HEAD  # Revert all P44.6 workspace commits
```

Or reset to the commit before P44.6 started:

```bash
git reset --hard <pre-p44.6-commit-hash>
```

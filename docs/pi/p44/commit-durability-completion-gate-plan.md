# P44.5 — Commit Durability as Completion Truth

## Mission

Make durable git truth a required part of workspace completion. A mutation workspace
cannot become COMPLETE until declared outputs exist, evidence and validation pass,
scope/writeSet are verified, commit succeeds, and post-commit verification confirms
expected files and identity.

## Summary

The current post-completion commit gate (`WorkspaceCommitGate`) is a separate concept
that runs after completion. P44.5 reworks this into **CompletionGate vNext** — a set of
durability stages integrated into the completion pipeline itself. The key changes:

1. **Standalone post-completion commit gate is removed.** Commit durability becomes a
   CompletionGate vNext stage.
2. **A mutation workspace cannot transition to COMPLETE without a verified commit hash**
   and post-commit file verification.
3. **LLM commit composer** may write explanation but must never be source of truth.
   Runtime fact packet and validator are authoritative.
4. **canEdit/writeSet mismatch is never silent.** Block or HIR.
5. **Parallel shared-file mutation requires declared shared ownership.**
6. **P26 infrastructure is reused where present** through adapters.
7. **BLOCK state routes deterministically** to retry, repair, HIR, RCA, or RAR.

## Waves

| Wave | Workspaces | Description |
|------|-----------|-------------|
| W0   | P44.5.00  | Compatibility, Policy Freeze, Migration Map |
| W1   | P44.5.01, P44.5.02 | Contracts and Verdict Types |
| W2   | P44.5.03, P44.5.04, P44.5.05 | Durability Stages |
| W3   | P44.5.06, P44.5.07 | LLM Commit Message Composer and Git Identity |
| W4   | P44.5.08, P44.5.09 | State Routing, Read Model, Dashboard Truth |
| W5   | P44.5.10, P44.5.11 | Destructive Operation Guard, Migration Backfill |
| W6   | P44.5.12, P44.5.13 | Gauntlets and Promotion |

## Design Decisions (Frozen)

### Shared File Policy: `declared_owner_or_block`

- Undeclared parallel mutation blocks at admission.
- Declared shared file requires single commitOwner; other workspaces contribute
  patches or evidence only.
- Same-file write drift at completion routes to NEEDS_HIR.

### LLM Composer Circuit Breaker

- Timeout: 8s, max repair attempts: 1.
- Fallback: deterministic runtime fact commit message.
- LLM is never authority for gate verdict, evidence validation, validation truth,
  or mutation authorization.

### P26 Overlap Policy: `adapter_first_reuse`

- If P26 component exists and satisfies contract, build adapter.
- If partially satisfies, wrap and extend.
- If missing or incompatible, document gap and implement minimal P44.5 component.

### canEdit Mismatch Policy: `block_by_default_hir_on_authority_ambiguity`

- Out-of-scope mutation blocks.
- Legitimate output outside allowedFiles routes to HIR.
- Silent exclusion is forbidden.

### Rollout Mode Sequence

`off` → `shadow` → `warn` → `block_strict_plans` → `block_all_stable_3`

Initial mode: `shadow`. Promotion mode: `block_strict_plans`.

## Success Metrics Target

Current score: 2.5/10. Target: 8.0/10 (minimum). Stretch: 9.0/10.

## References

- P44 Commit Gate Forensics — Comprehensive Bug Search Report
- Commit Durability as Completion Truth — Vision Document
- P44 PlanSpec v5 alpha2
- P26 Execution Correctness Recovery Plan v3

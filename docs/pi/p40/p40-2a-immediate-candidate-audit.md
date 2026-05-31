# P40.2A — Immediate Copy Candidate Audit

**Date:** 2026-05-30

## Original Manifest vs Actual Extraction

The manifest listed 14 "immediate copy candidates." After deep dependency verification, only 7 were truly self-contained or dependent only on already-extracted packages. 4 were successfully extracted. 3 had complex export profiles that exceeded the auto-shim approach.

### Successfully Extracted (4)

| File | Source | Destination | Lines | Strategy |
|---|---|---|---|---|
| `worker-concurrency.ts` | coding-agent/core/ | execution-core | 297 | Self-contained, 15 exports, 9 importers updated |
| `git-runner.ts` | coding-agent/core/ | execution-service | 625 | Self-contained, 6 exports, 9 importers updated |
| `failure/failure-classifier.ts` | coding-agent/failure/ | execution-service | 473 | Self-contained, enum + 2 types, 4 importers updated |
| `worktree/worktree-types.ts` | coding-agent/worktree/ | execution-core | 201 | Self-contained, 11 type exports + 2 value exports, 3 importers updated |

### Reclassified as Dirty (5)

| File | Reclassified As | Blocking Dependencies | Phase |
|---|---|---|---|
| `retry-handler.ts` | DIRTY | plan-state.js, workspace-schema.js | P42 |
| `plan-control.ts` | DIRTY | state-store.js | P42 |
| `execution-profile.ts` | DIRTY | execution-kernel/legacy-normalizer.js, workspace-schema.js | P42 |
| `auto-commit.ts` | DIRTY | git-runner.js (now extracted), plan-state.js, workspace-schema.js | P42 |
| `lead-agent/failure-classifier.ts` | DIRTY | lead-agent/types.js (complex type coupling) | P42 |

### Deferred — Complex Exports (3)

| File | Reason | Phase |
|---|---|---|
| `validation-runner.ts` | 7+ exports with mixed type/value patterns; auto-shim missed members; reverted | P42 |
| `lease-monitor.ts` | 7+ exports with mixed type/value patterns; auto-shim missed members; reverted | P42 |
| `failure/retry-router.ts` | 8+ exports with mixed type/value patterns; depends on failure-classifier (now extracted) but auto-shim missed members; reverted | P42 |

### Left Intentionally (3)

| File | Reason |
|---|---|
| `workspace-agent-executor.ts` | IS the local Pi worker — WORKER-OWNED |
| `worktree/worktree-workspace-executor.ts` | Uses WorkspaceAgentExecutor directly — WORKER-OWNED |
| `role-packets.ts` | Depends on context-packet.js — WORKER-OWNED |

## Lesson

`export *` shims do not work reliably in TypeScript. Each shim must explicitly list every exported member. The auto-detection of exports from source files works for simple modules but fails for files with complex re-export patterns, default exports, or namespace exports. Manual verification of every export is required before claiming a file is "extracted."

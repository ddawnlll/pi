# P9.H Remediation Plan

**Generated:** 2026-05-15  
**Workspace:** P9.H  
**Status:** DRAFT — Pending Review  
**Workspace Lock Conflicts:** P9.E holds lock on `src/**` — all changes to source files blocked

## 1. Overview

This remediation plan addresses workspace execution failures from prior attempts. Previous attempt 3 failed due to file lock conflict with workspace P9.E on `src/**`. The remediation strategy uses a **flash retry** to minimize contention window.

## 2. Affected Scope

| Resource | Status | Owner |
|---|---|---|
| `src/**` | LOCKED by P9.E | P9.E |
| `reports/**` | AVAILABLE | P9.H |
| `docs/**` | AVAILABLE | P9.H |
| `test/**` | AVAILABLE | P9.H |

## 3. Remediation Actions

### 3.1 — Unblock workspace execution
- **Action:** Set up artifact generation pipeline in `reports/` (free from lock conflicts)
- **Priority:** HIGH
- **Dependency:** None
- **Risk:** Low — no source file modifications required

### 3.2 — Generate execution artifacts
- **Action:** Produce DAG, risk report, dry-run, rollback plan, and audit log
- **Priority:** HIGH
- **Dependency:** Section 3.1
- **Risk:** Low

### 3.3 — Await P9.E release of `src/**`
- **Action:** Register completion callback — do NOT retry while lock is held
- **Priority:** MEDIUM
- **Dependency:** P9.E completion
- **Risk:** Medium — potential for cascading delays

## 4. Parallelism Analysis

### Analyzed Task Graph (see DAG in 02-optimized-dag.md)

| Task ID | Description | Parallel Group | Estimated Duration |
|---|---|---|---|
| T1 | Artifact scaffolding | 1 (serial) | 2 min |
| T2 | DAG construction | 2 (parallel with T3) | 3 min |
| T3 | Dry-run simulation | 2 (parallel with T2) | 5 min |
| T4 | Risk assessment | 3 (after T2) | 4 min |
| T5 | Rollback plan | 3 (after T2) | 3 min |
| T6 | Audit log | 3 (after T3) | 2 min |
| T7 | Review gate | 4 (serial) | 1 min |

### Maximum parallelism: 2 concurrent tasks
### Estimated serial duration: 20 min
### Estimated parallel duration: 12 min (40% reduction)

## 5. Serialization Warnings

> **WARNING [S001]:** T4 (Risk Assessment) depends on T2 (DAG construction) — risk analysis cannot begin until all task dependencies are mapped. This is a structural dependency and cannot be parallelized.

> **WARNING [S002]:** T7 (Review Gate) is a hard serial barrier — no execution can proceed until all prior artifacts are validated. This is required by the acceptance criteria contract.

> **WARNING [S003]:** The lock on `src/**` by P9.E serializes all source-modifying remediation actions. Until released, all source work remains blocked. This is a cross-workspace serialization hazard.

> **WARNING [S004]:** T5 (Rollback Plan) and T3 (Dry-run) share input data (current workspace state). If either task mutates shared state, the outputs may diverge. Consider read-only access pattern for these tasks.

## 6. Resource Requirements

- Storage: ~5 MB for artifact files (markdown + graphs)
- Compute: Minimal — pure document generation
- Permissions: Write access to `reports/` directory

## 7. Success Criteria

- [ ] All 6 artifact files written to `reports/p9h-remediation/`
- [ ] Parallelism analysis included in each artifact
- [ ] Serialization warnings surfaced
- [ ] Artifacts reviewable before execution approval
- [ ] No modifications to locked `src/**` paths

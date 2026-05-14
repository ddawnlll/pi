# P9.H Optimized DAG — Directed Acyclic Graph

**Generated:** 2026-05-15  
**Workspace:** P9.H  
**Optimization Goal:** Minimize wall-clock time given parallelism constraints and lock conflicts

## 1. Task Definitions

```
T1 ──> T2 ──> T4 ──> T7
 │              │
 │              └──> T5 ──> T7
 │
 └──> T3 ──> T6 ──> T7
```

### Legend
- `──>` : dependency edge (must complete before)
- `│`   : parallel fork
- `T1` etc. : task nodes (see table below)

## 2. Task Table

| ID | Name | Est. Duration | Dependencies | Parallel Group | Critical Path |
|---|---|---|---|---|---|
| T1 | Artifact scaffolding | 2 min | — | 1 | YES |
| T2 | DAG construction | 3 min | T1 | 2 | YES |
| T3 | Dry-run simulation | 5 min | T1 | 2 | YES |
| T4 | Risk assessment | 4 min | T2 | 3 | YES |
| T5 | Rollback plan | 3 min | T2 | 3 | — |
| T6 | Audit log generation | 2 min | T3 | 3 | YES |
| T7 | Review gate | 1 min | T4, T5, T6 | 4 | YES |

## 3. Critical Path

```
T1 (2m) -> T2 (3m) -> T4 (4m) -> T7 (1m) = 10 min  (primary)
T1 (2m) -> T3 (5m) -> T6 (2m) -> T7 (1m) = 10 min  (secondary)
```

**Critical path duration: 10 minutes**  
**Total parallel wall-clock: 12 minutes** (includes non-critical T5 running alongside T4)

## 4. Parallelism Analysis

### Paraellizable Groups

| Group | Tasks | Type | Max Concurrency |
|---|---|---|---|
| 1 | T1 | Serial bootstrap | 1 |
| 2 | T2, T3 | Parallel fork | 2 |
| 3 | T4, T5, T6 | Parallel after branch join | 3 (including T5) |
| 4 | T7 | Serial review gate | 1 |

### Efficiency Metrics

- **Total serial work:** 20 task-minutes
- **Parallel schedule:** 12 minutes wall-clock
- **Speedup factor:** 1.67x
- **Idle time:** T5 has 1 min slack (finishes before T7 starts)
- **Resource utilization:** ~83% (100% during groups 1, 2, 4; 66% during group 3 due to T5 underutilization)

## 5. Serialization Warnings

> **WARNING [DAG-S001]:** Group boundaries are enforced by dependency edges — no task can start its group until all predecessor groups complete. This serialization is structural and cannot be eliminated.

> **WARNING [DAG-S002]:** The fork at T1 -> T2/T3 creates two parallel chains. If either chain takes longer than estimated, the critical path shifts and total wall-clock time increases linearly.

> **WARNING [DAG-S003]:** P9.E's lock on `src/**` is an **external serialization constraint** not modeled in this DAG. If source file remediation is later added, the entire DAG must be re-optimized with the lock release as a hard dependency.

> **WARNING [DAG-S004]:** T3 (Dry-run) writes state that T6 (Audit log) consumes. If T3 is retried after T6 starts, audit data may be inconsistent. Consider snapshotting T3 output before T6 begins.

## 6. Optimization Recommendations

1. **Merge T4 and T5** if the risk assessment and rollback plan share data — reduces handoff overhead
2. **Parallelize T6 start** by streaming dry-run events to audit log in real-time rather than after T3 completion
3. **Add P9.E lock monitoring** as a data-dependent trigger for DAG update when lock releases

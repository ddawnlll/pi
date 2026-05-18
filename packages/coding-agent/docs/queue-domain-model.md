# Queue Domain Model — Two-Layer Architecture

Pi's execution pipeline uses a **two-layer queue model** to separate concerns between
plan-level orchestration and workspace-level integration.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Layer 1: Plan Queue                         │
│                                                                  │
│  Manages which *plans* run per project. Queued plans wait for    │
│  gates: dirty-tree check, integration-queue check, draft gates.  │
│  Only one active plan per project runs at a time.                │
│                                                                  │
│  States: Pending → Active → Complete | Failed | Blocked | Skipped│
│  Persisted: .pi/plan-queue-state.json                            │
│  Owner: PlanQueueRunner (src/core/plan-queue-runner.ts)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │  When a plan becomes Active, its
                            │  workspaces are enqueued into...
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 2: Integration Queue                     │
│                                                                  │
│  Manages the merge & validation order of *workspaces* within a   │
│  plan's integration branch. Workspaces are processed one at a    │
│  time: merge, validate, record.                                  │
│                                                                  │
│  States: queued → merging → validating → merged|failed|blocked   │
│          conflict (merge conflict detected)                      │
│  Persisted: .pi/integration-queue.json                           │
│  Owner: IntegrationQueue (src/integration/integration-queue.ts)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Plan Queue

**File:** `src/core/plan-queue-runner.ts`
**State file:** `.pi/plan-queue-state.json`

The Plan Queue Runner manages sequential execution of multiple plans per
project, enforcing the invariant that only one plan runs per project at a
time.

### States

| Status    | Meaning                                          | Terminal? |
|-----------|--------------------------------------------------|-----------|
| `pending` | Waiting for previous plans and gates             | No        |
| `active`  | Currently executing (plan execution running)     | No        |
| `complete`| Plan finished successfully                       | Yes       |
| `failed`  | Plan encountered an unrecoverable error          | Yes       |
| `blocked` | Queue policy stopped execution (dirty tree, etc.)| Yes       |
| `skipped` | Prior plan failed and stopOnFailure is true      | Yes       |

### Gates

Before a pending plan transitions to `active`, the runner checks:

1. **Dirty working tree** — if uncommitted changes exist, the plan is blocked
2. **Integration queue clean** — if the integration queue has entries, the
   plan is blocked until they resolve
3. **Draft gates (P8.E)** — if the plan is a draft and the enqueuing agent
   is the lead agent, the enqueue is rejected

### Key Types

- `PlanQueueEntry` — represents a single plan in the queue
- `PlanQueueEntryStatus` — enum of possible states (pending, active, complete, failed, blocked, skipped)
- `PlanQueueRunnerConfig` — configuration for the runner
- `PlanQueueState` — persisted state structure

---

## Layer 2: Integration Queue

**File:** `src/integration/integration-queue.ts`
**Domain types:** `src/integration/queue-domain.ts`
**State file:** `.pi/integration-queue.json`

The Integration Queue manages the merge and validation pipeline for
workspaces within a plan's integration branch. Workspaces are processed
strictly one at a time.

### States

| Status       | Meaning                                         | Terminal? |
|--------------|-------------------------------------------------|-----------|
| `queued`     | Waiting in queue for its turn                   | No        |
| `merging`    | Currently being cherry-picked into integration  | No        |
| `validating` | Post-merge validation is running                | No        |
| `merged`     | Successfully merged and validated               | Yes       |
| `failed`     | Merge operation failed                          | Yes       |
| `blocked`    | Validation failed — queue halts until resolved  | Yes       |
| `conflict`   | Merge conflict detected — manual resolution req.| Yes       |

### Processing Pipeline

1. **Merge** — cherry-pick the workspace commit into the integration branch
2. **Validate** — run the configured validation command (if any)
3. **Record** — save the result and timing metrics

If merge fails with a conflict, a conflict artifact is written to
`.pi/merge-conflicts/`. The queue halts at the first blocked, failed, or
conflict entry.

### Key Types

- `IntegrationQueueEntry` — a workspace in the queue
- `IntegrationQueueStatus` — union of possible states
- `IntegrationQueueState` — serialized queue state (entries, processing flag, audit trail)
- `AuditEntry` — a logged queue control action
- `IntegrationQueueTiming` — computed timing metrics (wait, merge, validation, total)

---

## Clean / Dirty Classification

Each layer defines **clean** (terminal / stable) and **dirty** (non-terminal /
in-progress) states. These classifications are used by gates, the dashboard,
and automation to determine whether it is safe to proceed to the next step.

| Layer          | Clean (terminal) states                     | Dirty (non-terminal) states |
|----------------|---------------------------------------------|-----------------------------|
| Plan Queue     | `complete`, `failed`, `skipped`, `blocked`  | `pending`, `active`         |
| Integration Q  | `merged`, `failed`, `blocked`, `conflict`   | `queued`, `merging`, `validating` |

### Classification Utilities

Provided in `src/integration/queue-domain.ts`:

```typescript
// Per-status checks
isPlanStatusClean(status)              // true for complete, failed, skipped, blocked
isPlanStatusDirty(status)              // true for pending, active
isIntegrationStatusClean(status)       // true for merged, failed, blocked, conflict
isIntegrationStatusDirty(status)       // true for queued, merging, validating

// Per-entry checks
isPlanEntryClean(entry)                // true if status is clean
isPlanEntryDirty(entry)                // true if status is dirty
isIntegrationEntryClean(entry)         // true if status is clean
isIntegrationEntryDirty(entry)         // true if status is dirty

// Aggregate queue checks
isPlanQueueClean(entries)              // true if ALL entries are clean (or empty)
isPlanQueueDirty(entries)              // true if ANY entry is dirty
isIntegrationQueueClean(entries)       // true if ALL entries are clean (or empty)
isIntegrationQueueDirty(entries)       // true if ANY entry is dirty
```

---

## Related Files

| File                                                    | Purpose                                 |
|---------------------------------------------------------|-----------------------------------------|
| `src/core/plan-queue-runner.ts`                         | Plan-level queue runner implementation  |
| `src/integration/integration-queue.ts`                  | Integration queue implementation        |
| `src/integration/queue-domain.ts`                       | Shared domain types & clean/dirty utils |
| `src/integration/queue-priority.ts`                     | Priority & critical-path scoring        |
| `src/integration/queue-optimizer.ts`                    | Queue reordering optimization           |
| `src/core/workspace-schema.ts`                          | `WorkspaceQueue` type definition        |
| `docs/phase-p6-6-queue-perfection.md`                   | P6.6 phase plan                         |

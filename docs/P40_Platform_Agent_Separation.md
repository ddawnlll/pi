# P40 - Platform / Agent Separation

**Contract Version:** 5.0.0
**Template:** LLM Implementation Agent - Execution-Safe Refactor Plan
**Phase:** P40
**Title:** Platform / Agent Separation
**Status:** Complete
**Last Updated:** 2026-05-30
**Corrected Direction:** P40 requires **physical package extraction** out of `packages/coding-agent`. Internal folders under `packages/coding-agent/src/execution-core/`, `packages/coding-agent/src/execution-service/`, and `packages/coding-agent/src/worker-adapter/` are only P40.0 scaffold placeholders. P40.1 is **physical package extraction**: `execution-core`, `execution-service`, and `worker-adapters` must be real workspace packages. `coding-agent` becomes only the local Pi worker implementation and compatibility surface.
**Execution Class:** `architecture_refactor`
**Selected Mode:** `physical_package_extraction_stable_3`
**Target Promotion Mode:** `stable_3`
**Autonomous Execution Allowed:** `true_after_preflight`
**Agent Repo Mutation Allowed:** `true_after_admission`
**Workspace Count:** 13
**Requested Max Parallelism:** 3
**Safe Effective Parallelism:** 2-3
**Primary Rule:** Execution owns state. Agent owns work. Brain owns advice. Web owns transport. UI owns visibility.

> **Historical Note:** This plan supersedes P34. P34 provided the original boundary doctrine — "Execution / Brain / Agent Separation" — which introduced the logical-boundary-first approach and deferred physical package splitting. After P38 (Lead Agent / Supervisor V0), P38.1 (Central Multi-Mode Synthetic E2E Gauntlet), and P39 (Stable_3 Golden Path Recovery), the system has matured enough to make platform/agent separation real via **physical package extraction**. P40 preserves P34's core authority doctrine but turns it into controlled extraction grounded in the stable_3 baseline.
>
> **Critical correction:** The previous internal-boundary approach (P40.0 scaffold) created folders inside `packages/coding-agent/src/execution-core/`, `packages/coding-agent/src/execution-service/`, and `packages/coding-agent/src/worker-adapter/`. This is **not sufficient** — those paths are still inside `packages/coding-agent`. The corrected P40 goal is stricter: the execution system must **leave** `packages/coding-agent`. Execution platform must become independent workspace packages. `packages/coding-agent` must become only the local Pi worker implementation / compatibility surface.

---

## 0. TL;DR / Compact Mental Model

P40 is **not** a rewrite of the execution kernel.
P40 is **not** a Postgres state hotfix.
P40 is **not** a V5 Brain feature implementation phase.
P40 is **not** a worktree-mode introduction.
P40 does **not** make patch_transaction the default.

P40 extracts the execution platform from `packages/coding-agent` into separate packages:

```text
packages/execution-core/      - Contracts: ExecutionCommand, ExecutionReadModel, WorkerAdapter
packages/execution-service/   - Facades: command/query handlers, execution service gateway
packages/coding-agent/        - Remains: local Pi worker impl + compatibility surface
```

The core architectural problem remains the same as P34 identified - authority boundaries are not enforced at package boundaries:

```text
Runner can create its own execution reality.
Agent execution can leak into state transitions.
Brain code risks becoming too close to execution mutation.
Web/dashboard can accidentally rely on mixed local/runtime/Postgres state.
```

P40 fixes this by creating physical boundary packages where P34 only introduced logical ones:

```text
Execution owns state.
Agent owns work.
Brain owns advice.
Web owns transport.
UI owns visibility.
DB owns persistence.
```

P40 builds on the P39 stable_3 golden path. It does not demand massive file movement. It does not change stable_3 semantics. It does not require worktree mode. It does not promote patch_transaction.

---

## 1. Problem Statement

P38/P39 stabilized the execution kernel. The Lead Agent, CompletionGate, execution gauntlet, and combined-summary validator all work. The system now has:

- Deterministic tests passing (`make test`)
- Full execution confidence gate passing (`make test-full`)
- Stable_3 as the reliable baseline
- Lead Agent runtime integration functional (gauntlet-proven)
- Final validation gate functional (gauntlet-proven)
- Combined-summary truthful
- WorkerAdapter boundary exists (P40.0 scaffold)

But the system still has the boundary problem P34 identified, and the P40.0 scaffold showed that internal boundaries alone are insufficient:

```text
AutonomousExecutor directly constructs WorkspaceAgentExecutor.
Brain modules may import mutable state-store APIs.
Web routes may bypass intended command/query boundaries.
Dashboard may depend on internal executor classes.
No forbidden-import boundary tests exist.
execution-core has no real consumers outside new files.
execution-service has no real callers outside tests.
```

P40 addresses this by creating actual package/module boundaries via physical package extraction.

### 1.1 What P40 must prevent

P40 must make these impossible or strongly visible:

```text
Brain mutates execution state directly.
Agent decides workspace state transitions.
Web UI derives authoritative execution state from local/in-memory data.
Runner starts work before Execution authority admits it.
Completion/failure is decided outside the Execution boundary.
Agent adapter is hard-coded so replacing Pi is painful.
packages/execution-core imports from packages/coding-agent.
packages/execution-service permanently depends on packages/coding-agent.
```

### 1.2 What P40 intentionally does not solve

P40 does not:

```text
rewrite the scheduler
rewrite the dashboard
rewrite CompletionGate
implement Brain V5 features
move 100+ files in one step
promote patch_transaction to default
introduce worktree isolation as a requirement
require stable_6
start brain/overnight planner work
rewrite state store
```

---

## 2. Design Doctrine

### 2.1 Authority model

| System | Responsibility | May mutate execution state? |
|---|---|---:|
| Execution | State machine, transitions, scheduler, attempts, locks, worktree, validation, completion | Yes |
| Agent Runtime | Execute worker packet and stream events/results | No |
| Pi Agent Adapter | Default local worker implementation | No |
| Brain | Observe, remember, summarize, propose, draft, notify | No |
| Web Server | Transport/API gateway | No |
| Web UI | Visibility and user control surface | No |
| DB | Persistence and event storage | Stores state, does not decide |

### 2.2 Golden rule

```text
Only Execution may transition execution state.
```

Any other subsystem may only emit requests/events/proposals.

### 2.3 Agent rule

```text
Agents do work; they do not own state.
```

An agent returns:

```text
complete / failed / blocked / timed_out
events
changed files
report
error
```

Execution decides how that maps to workspace state.

### 2.4 Brain rule

```text
Brain is advisory by default.
```

Brain can:

```text
observe execution
read memories
scan repository signals
generate proposals
generate drafts
recommend retries
summarize anomalies
```

Brain cannot:

```text
transition workspace state
acquire file locks
write to workspace_executions
mutate integration queue
mark completion gates passed
```

### 2.5 Web/UI rule

```text
Web transports commands.
UI observes and requests.
Neither is authority.
```

### 2.6 Package-dependency rule

```text
packages/execution-core must not import packages/coding-agent.
packages/execution-service must not permanently depend on packages/coding-agent.
packages/coding-agent may import execution-core contracts.
Worker adapter bridges coding-agent worker impl to execution-core contracts.
Any execution-service -> coding-agent dependency must be a temporary compatibility bridge.
```

---

## 3. Current System State (P39 Baseline + P40.0 Scaffold)

### 3.1 What exists today

The P40.0 scaffold (`47ccbda0f`) added internal boundary modules within `packages/coding-agent`:

```text
packages/coding-agent/src/
  worker-adapter/           — WorkerAdapter interface + LocalPiWorkerAdapter (P40.0 scaffold)
  execution-core/           — ExecutionCommand, ExecutionReadModel, BrainProposal types (P40.0 scaffold)
  execution-service/        — command-handler.ts, query-handler.ts (P40.0 scaffold)

brain/
  boundary.ts               — BrainBoundary class
  execution-read-client.ts  — BrainExecutionReadClient
  proposal-contract.ts      — Proposal helpers
```

**These are still inside `packages/coding-agent`. This is the P40.0 scaffold only.** P40.1 must physically extract them into separate workspace packages.

### 3.2 Physical extraction status (P40.1)

The following new packages must be created:

```text
packages/execution-core/      — Canonical contracts (types, commands, read-model, events, WorkerAdapter)
packages/execution-service/   — Command/query facades (command-handler, query-handler, execution-service)
packages/worker-adapters/     — Worker adapter implementations (LocalPiWorkerAdapter)
```

After extraction, the old paths under `packages/coding-agent/src/execution-core/`, `packages/coding-agent/src/execution-service/`, and `packages/coding-agent/src/worker-adapter/` become **compatibility shims only** — re-exporting from the new packages.

### 3.2 What P39 confirmed

- stable_3 is the reliable baseline
- `make test` passes (deterministic, fast)
- `make test-full` passes (full execution confidence)
- Lead Agent works
- CompletionGate uses command history (at gauntlet level)
- Combined-summary is truthful
- Patch transaction is tested but non-default
- No worktree requirement for stable_3

### 3.3 What the P40.0 scaffold proved

- WorkerAdapter interface works
- LocalPiWorkerAdapter wraps WorkspaceAgentExecutor
- 38 boundary tests pass
- AutonomousExecutor accepts WorkerAdapter and auto-creates LocalPiWorkerAdapter
- index.ts re-exports through execution-core
- execution-service has a real caller (AutonomousExecutor stop handler)

---

## 4. Target Physical Package Structure

### 4.1 packages/execution-core

**Purpose:** Canonical execution contracts. No runtime implementation. Only types and interfaces.

```text
packages/execution-core/
  package.json
  tsconfig.json
  src/
    index.ts          - Public API surface
    types.ts          - ExecutionCommand, ExecutionReadModel, BrainProposal, PlanStatus
    commands.ts       - Command type definitions
    read-model.ts     - Read model interfaces
    events.ts         - Event type definitions
    worker-adapter.ts - WorkerAdapter interface
```

**Dependency direction:** MUST NOT import `packages/coding-agent`.

### 4.2 packages/execution-service

**Purpose:** Execution service facades. Command/query handlers, execution service gateway.

```text
packages/execution-service/
  package.json
  tsconfig.json
  src/
    index.ts            - Public API surface
    command-handler.ts  - handleExecutionCommand
    query-handler.ts    - createExecutionReadModel
    execution-service.ts - Higher-level service facade
```

**Dependency direction:** MUST NOT permanently depend on `packages/coding-agent`. Any temporary coding-agent dependency must be marked as a compatibility bridge.

### 4.3 packages/coding-agent (remainder)

**Purpose:** Local Pi worker implementation + compatibility surface.

Remains the default local Pi worker implementation. Import contracts from `packages/execution-core`. Export compatibility shims for old import paths.

### 4.4 packages/worker-adapters

**Purpose:** Worker adapter implementations.

```text
packages/worker-adapters/
  package.json
  tsconfig.json
  src/
    index.ts                — Public API surface
    local-pi-worker-adapter.ts — LocalPiWorkerAdapter bridging execution-core WorkerAdapter to coding-agent worker
```

**Dependency direction:** Imports `WorkerAdapter` from `@earendil-works/pi-execution-core`. May import `@earendil-works/pi-coding-agent` internals for the bridge implementation.

---

## 5. Public Interfaces (Same Doctrine as P34)

### 5.1 WorkerAdapter

```ts
// packages/execution-core/src/worker-adapter.ts
export interface WorkerAdapter {
  run(request: WorkerRunRequest): Promise<WorkerRunResult>;
  abort(runId: string): Promise<void>;
  getCapabilities(): WorkerAdapterCapabilities;
}

export interface WorkerRunRequest {
  planExecutionId: string;
  workspaceExecutionId: string;
  workspaceId: string;
  attemptNumber: number;
  projectRoot: string;
  workspacePath: string;
  packet: HashedPacket;
  allowedTools: string[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface WorkerRunResult {
  verdict: "complete" | "failed" | "blocked" | "timed_out" | "cancelled";
  events: WorkerEvent[];
  changedFiles: string[];
  commandHistory: WorkerCommandHistoryEntry[];
  report?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### 5.2 ExecutionCommand

```ts
// packages/execution-core/src/commands.ts
export type ExecutionCommand =
  | { type: "start_plan"; planId: string }
  | { type: "stop_plan"; planExecutionId: string; reason?: string }
  | { type: "continue_plan"; planExecutionId: string; reason?: string }
  | { type: "rerun_plan"; planExecutionId: string; reason?: string }
  | { type: "retry_workspace"; planExecutionId: string; workspaceId: string; reason?: string }
  | { type: "request_user_escalation"; planExecutionId: string; workspaceId: string; reason?: string }
  | { type: "approve_proposal"; proposalId: string };
```

### 5.3 ExecutionReadModel

```ts
// packages/execution-core/src/read-model.ts
export interface ExecutionReadModel {
  getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;
  getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
  listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;
  getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]>;
  getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]>;
  getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView>;
}
```

### 5.4 BrainProposal

```ts
// packages/execution-core/src/types.ts
export interface BrainProposal {
  id: string;
  type: "retry" | "split_workspace" | "draft_plan" | "investigate" | "notify";
  summary: string;
  rationale: string;
  evidenceRefs: string[];
  proposedCommand?: ExecutionCommand;
}
```

---

## 6. Non-Goals

P40 must not:

```text
move 100+ files in one step
change DB schema unless required for boundary tests
change stable_3 semantics
rewrite CompletionGate
rewrite WorkspaceScheduler
rewrite Web UI
remove the current Pi agent
change the LLM provider layer
make patch_transaction the default
introduce worktree isolation as a requirement
require stable_6
start brain/overnight planner work
rewrite state store
```

P40 should avoid churn.

Expected file movement: controlled, incremental.
Expected new packages: 2.
Expected new files: 15-25.
Expected modified files: 10-20.
Expected import changes: 30-60.
Expected compatibility shims: 5-10.

---

## 7. Required Invariants

### 7.1 Execution authority invariant

```text
A workspace may execute only after Execution authority accepts active transition.
```

### 7.2 Agent non-authority invariant

```text
WorkerAdapter cannot import mutable state-store transition APIs.
```

### 7.3 Brain read-only invariant

```text
Brain modules cannot import transitionWorkspace, DatabaseStateStore mutation methods, WorkspaceScheduler mutation methods, or worktree/file-lock mutation APIs.
```

### 7.4 Web gateway invariant

```text
Web routes must call Execution command/query interfaces, not direct internal scheduler/state mutation helpers.
```

### 7.5 UI observer invariant

```text
Dashboard types and views consume read-model/event envelopes, not internal executor classes.
```

### 7.6 Test gate invariant

```text
Boundary tests must fail if forbidden imports are introduced.
```

### 7.7 Package dependency invariant

```text
execution-core must not import from coding-agent.
execution-service must not permanently depend on coding-agent.
```

### 7.8 Stable_3 invariant

```text
stable_3 remains the default execution mode. patch_transaction remains non-default. No worktree requirement is introduced.
```

---

## 8. Implementation Strategy

### 8.1 mkdir/cp/facade/import migration

No rewrite. No destructive moves. Use:

```text
mkdir  - create new package directories
cp     - copy files into new packages (not mv, keep originals)
facade - wrap existing implementations behind new interfaces
import migration - change import paths to new package locations
```

### 8.2 Extraction order

1. Create `packages/execution-core` as real npm workspace package
2. Copy/extract contracts into it (types, commands, read-model, events, worker-adapter)
3. Wire package.json, tsconfig, workspace references
4. Create `packages/execution-service` as real npm workspace package
5. Copy/extract facades into it (command-handler, query-handler, execution-service)
6. Wire package.json, tsconfig, workspace references
7. Add compatibility shims in `packages/coding-agent` for old import paths
8. Migrate imports in small batches, low-risk first
9. Validate with `make test` after each batch
10. Final validation with `make test-full`

### 8.3 Compatibility

Every old import path in `packages/coding-agent` gets a shim re-export from the new package location. No script breaks during transition.

---

## 9. Workspaces

### P40.00 - Baseline, Scaffold Audit, and Import Inventory  ✅ COMPLETE

**Goal:** Audit the current internal P40 scaffold, P39 baseline, and direct imports before package extraction.

**Allowed files:**
```text
docs/pi/p40/**
packages/coding-agent/src/**/*.ts
packages/web-server/src/**/*.ts
packages/web-ui/dashboard/src/**/*.ts
```

**Executor prompt:**
Verify `make test` and `make test-full` pass against P39 stable_3 baseline. Audit the P40.0 scaffold and produce an import inventory documenting current direct imports of execution-kernel, core/autonomous-executor, core/workspace-agent-executor, state-store mutation APIs, completion-gate, brain imports into execution, and web-server imports into execution internals. List which files are ready to copy into new packages and which must stay.

**Acceptance criteria:**
```text
make test passes
make test-full passes
docs/pi/p40/import-migration-inventory.md exists
docs/pi/p40/boundary-audit.md exists
before counts documented
migration plan with tables A-E exists
```

---

### P40.01 - Create packages/execution-core Workspace Package  ✅ COMPLETE

**Goal:** Create real workspace package structure for execution-core outside packages/coding-agent.

**Allowed files:**
```text
packages/execution-core/**
```

**Executor prompt:**
Create `packages/execution-core/` with package.json (name: `@earendil-works/pi-execution-core`), tsconfig.json, and stub src/index.ts. Add package entry to root workspace config. Ensure the package is buildable. Do NOT include runtime implementations - only types and interfaces.

**Acceptance criteria:**
```text
packages/execution-core/package.json exists
packages/execution-core/tsconfig.json exists
packages/execution-core/src/index.ts exists
Package is registered in root workspace
npm install resolves the package
```

---

### P40.02 - Create packages/execution-service Workspace Package  ✅ COMPLETE

**Goal:** Create real workspace package structure for execution-service outside packages/coding-agent.

**Allowed files:**
```text
packages/execution-service/**
```

**Executor prompt:**
Create `packages/execution-service/` with package.json (name: `@earendil-works/pi-execution-service`), tsconfig.json, and stub src/index.ts. May temporarily depend on `@earendil-works/pi-execution-core` (clean) and `@earendil-works/pi-coding-agent` (temporary compatibility bridge, must be marked). Add package entry to root workspace config.

**Acceptance criteria:**
```text
packages/execution-service/package.json exists
packages/execution-service/tsconfig.json exists
packages/execution-service/src/index.ts exists
Package is registered in root workspace
Any coding-agent dependency is marked temporary
```

---

### P40.03 - Copy/Extract Execution Contracts into execution-core  ✅ COMPLETE

**Goal:** Move/copy ExecutionCommand, ExecutionReadModel, WorkerAdapter, command/event/read model types into packages/execution-core.

**Allowed files:**
```text
packages/execution-core/**
packages/coding-agent/src/worker-adapter/types.ts
packages/coding-agent/src/execution-core/types.ts
packages/coding-agent/src/execution-core/index.ts
packages/coding-agent/src/brain/boundary.ts
packages/coding-agent/src/brain/execution-read-client.ts
packages/coding-agent/src/brain/proposal-contract.ts
```

**Executor prompt:**
Copy (not move) the canonical contract types from P40.0 scaffold locations into `packages/execution-core/`. Keep originals as compatibility shims. Execution-core exports must include: ExecutionCommand, ExecutionReadModel, WorkerAdapter, WorkerRunRequest, WorkerRunResult, BrainProposal, PlanExecutionSummary, WorkspaceExecutionSummary, JournalEventEnvelope, CommandHistoryView, LeadDirectiveView, FinalValidationView. execution-core must NOT import from coding-agent.

**Acceptance criteria:**
```text
execution-core exports all contract types
execution-core does not import from coding-agent
Originals still exist (compatibility)
make test still passes
```

---

### P40.04 - Copy/Extract Execution Service Facades into execution-service  ✅ COMPLETE

**Goal:** Move/copy command/query/facade handlers into packages/execution-service.

**Allowed files:**
```text
packages/execution-service/**
packages/coding-agent/src/execution-service/command-handler.ts
packages/coding-agent/src/execution-service/query-handler.ts
packages/coding-agent/src/execution-service/index.ts
```

**Executor prompt:**
Copy (not move) the command-handler and query-handler into `packages/execution-service/`. Keep originals as compatibility shims. The copied facades must import from `@earendil-works/pi-execution-core` instead of internal paths. Any temporary coding-agent dependency must be marked in code comments.

**Acceptance criteria:**
```text
execution-service exports command/query handlers
execution-service imports from execution-core package
Temporary bridges marked
Originals still exist (compatibility)
make test still passes
```

---

### P40.05 - Add coding-agent Compatibility Shims  ✅ COMPLETE

**Goal:** Keep old internal imports working by re-exporting from new packages where needed.

**Allowed files:**
```text
packages/coding-agent/src/worker-adapter/**
packages/coding-agent/src/execution-core/**
packages/coding-agent/src/execution-service/**
packages/coding-agent/src/index.ts
docs/pi/p40/**
```

**Executor prompt:**
Update the internal P40.0 scaffold boundary files in `packages/coding-agent` to re-export from the new package locations. The old internal paths (`worker-adapter/`, `execution-core/`, `execution-service/`) must remain importable but should re-export from `@earendil-works/pi-execution-core` or `@earendil-works/pi-execution-service` where possible. Add deprecation JSDoc annotations to compatibility shims.

**Acceptance criteria:**
```text
Old internal paths still importable
Old paths re-export from new packages
Deprecation notices added
make test still passes
```

---

### P40.06 - WorkerAdapter / LocalPiWorkerAdapter Bridge  ✅ COMPLETE

**Goal:** Ensure coding-agent worker implementation conforms to execution-core WorkerAdapter contract.

**Allowed files:**
```text
packages/coding-agent/src/worker-adapter/**
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/index.ts
packages/execution-core/src/worker-adapter.ts
```

**Executor prompt:**
Ensure `LocalPiWorkerAdapter` in `packages/coding-agent` conforms to the `WorkerAdapter` contract now in `packages/execution-core`. Update imports. Ensure `AutonomousExecutor` continues to auto-create `LocalPiWorkerAdapter` as the default. The `WorkerAdapter` type must come from `@earendil-works/pi-execution-core`, not from an internal path.

**Acceptance criteria:**
```text
LocalPiWorkerAdapter conforms to execution-core contract
WorkerAdapter type imported from @earendil-works/pi-execution-core
AutonomousExecutor still auto-creates LocalPiWorkerAdapter
make test still passes
```

---

### P40.07 - Import Migration Batch 1: Low-Risk Type and Read Model Imports  ✅ COMPLETE

**Goal:** Migrate low-risk imports from internal coding-agent paths to new package exports.

**Allowed files:**
```text
packages/coding-agent/src/**/*.ts
packages/coding-agent/src/index.ts
docs/pi/p40/**
```

**Executor prompt:**
Migrate type-only imports (ExecutionCommand, ExecutionReadModel, BrainProposal, WorkerAdapter) from internal `execution-core/` or `worker-adapter/` paths to `@earendil-works/pi-execution-core`. Migrate re-exports in `packages/coding-agent/src/index.ts` similarly. Run `make test` after each file batch.

**Acceptance criteria:**
```text
Type-only imports use new package locations
Re-exports in index.ts use new packages
make test still passes
```

---

### P40.08 - Runtime Caller Adoption: execution-service  ✅ COMPLETE

**Goal:** Give execution-service real callers; it must not remain a dead stub.

**Allowed files:**
```text
packages/execution-service/**
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/cli/plan-commands.ts
packages/web-server/src/index.ts
packages/web-server/src/plan-runner.ts
```

**Executor prompt:**
Ensure `handleExecutionCommand` and `createExecutionReadModel` from `@earendil-works/pi-execution-service` have real runtime callers. At minimum: AutonomousExecutor stop handling must use execution-service (already done in P40.0). Add at least one more: wire the web-server stop/pause control endpoint through execution-service's command handler where practical.

**Acceptance criteria:**
```text
execution-service command-handler has at least 2 real callers
execution-service query-handler has at least 1 real caller
make test still passes
```

---

### P40.09 - Web Server Command/Query Adoption  ✅ COMPLETE

**Goal:** Migrate key web-server command/query paths to execution-service where practical.

**Allowed files:**
```text
packages/web-server/src/index.ts
packages/web-server/src/plan-runner.ts
packages/web-server/src/state-store-provider.ts
packages/execution-service/**
docs/pi/p40/**
```

**Executor prompt:**
Identify web-server control endpoints (stop, pause, resume) and route them through `@earendil-works/pi-execution-service`'s `handleExecutionCommand` where practical. Keep direct state-store fallback for backward compat. Document which routes were migrated and which remain direct.

**Acceptance criteria:**
```text
Web server has at least key command/query integration through execution-service
Remaining direct routes documented
make test still passes
```

---

### P40.10 - Boundary Import Guards and Doctor Checks  ✅ COMPLETE

**Goal:** Add checks preventing execution-core/service/coding-agent dependency inversion and forbidden imports.

**Allowed files:**
```text
packages/execution-core/**
packages/execution-service/**
packages/coding-agent/test/**/*boundary*.test.ts
packages/coding-agent/src/core/production-readiness-doctor.ts
docs/pi/p40/**
```

**Executor prompt:**
Add boundary tests that fail if:
1. `packages/execution-core` imports from `packages/coding-agent`
2. `WorkerAdapter` imports transition-router or state-writer
3. Brain boundary imports mutable execution APIs
4. Web command path doesn't use execution-service for migrated commands
5. execution-service has zero callers

Add doctor checks for boundary health.

**Acceptance criteria:**
```text
Forbidden import tests exist
execution-core → coding-agent import guarded
WorkerAdapter state mutation import guarded
Brain mutable API import guarded
execution-service caller count check exists
make test still passes
```

---

### P40.11 - Package Build, Exports, and Workspace Wiring  ✅ COMPLETE

**Goal:** Update package.json, exports, tsconfig/workspace wiring so new packages build and can be imported.

**Allowed files:**
```text
packages/execution-core/**
packages/execution-service/**
package.json (root)
tsconfig.json (root)
packages/coding-agent/package.json
packages/coding-agent/tsconfig.json
```

**Executor prompt:**
Ensure `packages/execution-core` and `packages/execution-service` build correctly in the workspace. Verify `npm run build` succeeds. Verify `packages/coding-agent` can import from both new packages. Verify `@earendil-works/pi-execution-core` and `@earendil-works/pi-execution-service` resolve correctly.

**Acceptance criteria:**
```text
npm run build succeeds
New packages are importable
coding-agent can import from new packages
make test still passes
```

---

### P40.12 - Final make test-full Validation and P40 Report  ✅ COMPLETE

**Goal:** Run make test and make test-full, then write final P40 report.

**Allowed files:**
```text
docs/pi/p40/**
reports/p40-platform-agent-separation/**
```

**Executor prompt:**
Run `make test` and `make test-full`. Produce the final P40 report at `reports/p40-platform-agent-separation/<timestamp>/`. Include all required report files.

**Acceptance criteria:**
```text
make test passes
make test-full passes
stable_3 remains default and green
patch_transaction remains non-default
No worktree requirement introduced
reports/p40-platform-agent-separation/<timestamp>/summary.md exists
```

---

## 10. Execution Batches

### Batch 0 - Audit and inventory
```text
P40.00
```
Parallelism: 1

### Batch 1 - Package creation
```text
P40.01
P40.02
```
Parallelism: 2

### Batch 2 - Contract and facade extraction
```text
P40.03
P40.04
```
Parallelism: 2

### Batch 3 - Shims and adapter bridge
```text
P40.05
P40.06
```
Parallelism: 2

### Batch 4 - Import migration and runtime adoption
```text
P40.07
P40.08
P40.09
```
Parallelism: 2-3

### Batch 5 - Guards and build wiring
```text
P40.10
P40.11
```
Parallelism: 2

### Batch 6 - Final validation
```text
P40.12
```
Parallelism: 1

---

## 11. File Scope Summary

### New packages

```text
packages/execution-core/
  package.json
  tsconfig.json
  src/index.ts
  src/types.ts
  src/commands.ts
  src/read-model.ts
  src/events.ts
  src/worker-adapter.ts

packages/execution-service/
  package.json
  tsconfig.json
  src/index.ts
  src/command-handler.ts
  src/query-handler.ts
  src/execution-service.ts
```

### New/modified files within coding-agent

```text
packages/coding-agent/src/worker-adapter/index.ts (shim → re-export)
packages/coding-agent/src/execution-core/index.ts (shim → re-export)
packages/coding-agent/src/execution-service/index.ts (shim → re-export)
packages/coding-agent/src/core/autonomous-executor.ts (update import)
packages/coding-agent/src/index.ts (update re-exports)
packages/coding-agent/package.json (add package deps)
packages/coding-agent/tsconfig.json (add path refs)
```

### Files not intended for broad moves

```text
packages/db/**
packages/ai/**
packages/web-ui/dashboard/**
packages/web-server route tree (only control endpoints changed)
packages/coding-agent/src/execution-kernel/** (gradual migration)
packages/coding-agent/src/core/execution-gauntlet/** (test infra)
```

---

## 12. Validation Commands

Run deterministic quick gate:

```bash
make test
```

Run full execution confidence gate:

```bash
make test-full
```

Run optional real smoke only when credentials are available:

```bash
PI_GAUNTLET_REAL_LLM=1 make test-nightly-real
```

Do **not** require real LLM tests for P40 completion.

---

## 13. Acceptance Criteria

P40 is complete only if:

```text
packages/execution-core exists as real workspace package.
packages/execution-service exists as real workspace package.
execution-core has real consumers.
execution-service has real callers.
coding-agent has compatibility shims for old paths if needed.
AutonomousExecutor default worker path uses WorkerAdapter / LocalPiWorkerAdapter boundary.
web-server has at least key command/query adoption through execution-service.
import migration report exists.
before/after import counts exist.
remaining legacy imports are documented.
make test passes.
make test-full passes.
stable_3 remains default and green.
patch_transaction remains non-default.
No worktree requirement is introduced.
Lead Agent still works.
CompletionGate still uses command history.
final validation still gates plan completion.
combined-summary remains truthful.
P40 final report exists.
```

---

## 14. Failure Conditions

P40 fails if:

```text
execution-core remains only inside packages/coding-agent.
execution-service remains only inside packages/coding-agent.
execution-service has zero callers.
execution-core has no real consumers.
coding-agent remains the sole owner of execution contracts.
patch_transaction becomes default.
worktree requirement is reintroduced.
stable_3 semantics change.
make test-full fails.
the refactor becomes a scheduler/state-store/CompletionGate rewrite.
import migration creates circular dependencies.
```

---

## 15. Final Report Template

```markdown
# P40 Final Report - Platform / Agent Separation

## Summary
## Package Extraction Status
## Boundaries Added
## WorkerAdapter / AgentRuntime
## Execution Core Package
## Execution Service Package
## Brain Read-Only Boundary
## Web/API Gateway Boundary
## Dashboard Contract Boundary
## Compatibility Shims
## Import Migration
## Forbidden Import Tests
## Files Changed
## Validation Results
## Remaining Legacy Couplings
## Deferred Physical Package Split
## Final Verdict
```

---

## 16. Final Verdict Criteria

P40 does not claim the system is production-ready by itself.

P40 claims:

```text
The execution platform is now extracted into separate packages.
Pi is a replaceable default worker adapter behind the WorkerAdapter boundary.
Execution is the single state authority.
Brain is advisory/read-only with proposals.
Web server is a command/query gateway.
Dashboard consumes read models.
Forbidden import tests prevent boundary drift and dependency inversion.
E2E gates (make test, make test-full) remain green throughout.
```

---

# Part 3 - JSON Queue

```json
{
  "contractVersion": "5.0.0",
  "phase": "P40",
  "title": "Platform / Agent Separation",
  "status": "planned",
  "executionClass": "architecture_refactor",
  "selectedMode": "physical_package_extraction_stable_3",
  "targetPromotionMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "expectedSafeEffectiveParallelism": 3,
  "jsonRuntimeFallbackAllowed": false,
  "planExecution": {
    "phase": "P40",
    "title": "Platform / Agent Separation",
    "maxParallelWorkspaces": 3,
    "expectedSafeEffectiveParallelism": 3,
    "stateBackend": "postgres",
    "worktree": {
      "enabled": false
    },
    "validation": {
      "globalValidationLockRequired": true,
      "finalValidationRequired": true,
      "makeTestFullRequired": true
    }
  },
  "derivedExecutionProfile": {
    "executionBackend": "postgres",
    "worktreeRequired": false,
    "integrationQueueRequired": false,
    "agentMutationAllowed": false,
    "patchTransactionDefault": false,
    "patchTransactionRequired": false
  },
  "workspaces": [
    {
      "id": "P40.00",
      "title": "Baseline, Scaffold Audit, and Import Inventory",
      "goal": "Audit the current internal P40 scaffold, P39 baseline, and direct imports before package extraction.",
      "executorPrompt": "Verify make test and make test-full pass against P39 stable_3 baseline. Audit the P40.0 scaffold and produce docs/pi/p40/import-migration-inventory.md. Document current direct imports of execution-kernel, core/autonomous-executor, core/workspace-agent-executor, state-store mutation APIs, completion-gate, brain imports into execution, and web-server imports into execution internals.",
      "capabilities": {
        "canEdit": [
          "docs/pi/p40/**"
        ],
        "canRun": [
          "make test",
          "make test-full",
          "grep",
          "find"
        ]
      },
      "dependencies": []
    },
    {
      "id": "P40.01",
      "title": "Create packages/execution-core Workspace Package",
      "goal": "Create real workspace package structure for execution-core outside packages/coding-agent.",
      "executorPrompt": "Create packages/execution-core/ with package.json (name: @earendil-works/pi-execution-core), tsconfig.json, and stub src/index.ts. Add package entry to root workspace. Must NOT depend on coding-agent.",
      "capabilities": {
        "canEdit": [
          "packages/execution-core/**",
          "package.json",
          "tsconfig.json"
        ],
        "canRun": [
          "npm install",
          "npm run build"
        ]
      },
      "dependencies": [
        {
          "id": "P40.00",
          "type": "hard",
          "reason": "Need inventory to know what to extract."
        }
      ]
    },
    {
      "id": "P40.02",
      "title": "Create packages/execution-service Workspace Package",
      "goal": "Create real workspace package structure for execution-service outside packages/coding-agent.",
      "executorPrompt": "Create packages/execution-service/ with package.json (name: @earendil-works/pi-execution-service), tsconfig.json, and stub src/index.ts. May depend on @earendil-works/pi-execution-core. Any coding-agent dependency must be marked temporary.",
      "capabilities": {
        "canEdit": [
          "packages/execution-service/**",
          "package.json",
          "tsconfig.json"
        ],
        "canRun": [
          "npm install",
          "npm run build"
        ]
      },
      "dependencies": [
        {
          "id": "P40.01",
          "type": "hard",
          "reason": "Needs execution-core contracts."
        }
      ]
    },
    {
      "id": "P40.03",
      "title": "Copy/Extract Execution Contracts into execution-core",
      "goal": "Move/copy ExecutionCommand, ExecutionReadModel, WorkerAdapter, command/event/read model types into packages/execution-core.",
      "executorPrompt": "Copy canonical contract types from P40.0 scaffold into packages/execution-core/. Keep originals as compatibility shims. Must NOT import from coding-agent.",
      "capabilities": {
        "canEdit": [
          "packages/execution-core/**",
          "packages/coding-agent/src/worker-adapter/types.ts",
          "packages/coding-agent/src/execution-core/types.ts",
          "packages/coding-agent/src/brain/**"
        ],
        "canRun": [
          "make test",
          "npm run build"
        ]
      },
      "dependencies": [
        {
          "id": "P40.01",
          "type": "hard",
          "reason": "Need the package to exist."
        }
      ]
    },
    {
      "id": "P40.04",
      "title": "Copy/Extract Execution Service Facades into execution-service",
      "goal": "Move/copy command/query/facade handlers into packages/execution-service.",
      "executorPrompt": "Copy command-handler and query-handler into packages/execution-service/. Keep originals as compatibility shims. Copied facades must import from @earendil-works/pi-execution-core. Mark temporary coding-agent dependencies in comments.",
      "capabilities": {
        "canEdit": [
          "packages/execution-service/**",
          "packages/coding-agent/src/execution-service/command-handler.ts",
          "packages/coding-agent/src/execution-service/query-handler.ts"
        ],
        "canRun": [
          "make test",
          "npm run build"
        ]
      },
      "dependencies": [
        {
          "id": "P40.02",
          "type": "hard",
          "reason": "Need the package to exist."
        },
        {
          "id": "P40.03",
          "type": "hard",
          "reason": "Need contracts in execution-core."
        }
      ]
    },
    {
      "id": "P40.05",
      "title": "Add coding-agent Compatibility Shims",
      "goal": "Keep old internal imports working by re-exporting from new packages where needed.",
      "executorPrompt": "Update internal P40.0 scaffold boundary files in coding-agent to re-export from new package locations. Add deprecation JSDoc annotations to compatibility shims.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/worker-adapter/**",
          "packages/coding-agent/src/execution-core/**",
          "packages/coding-agent/src/execution-service/**",
          "packages/coding-agent/src/index.ts",
          "docs/pi/p40/**"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.03",
          "type": "hard",
          "reason": "Need contracts in execution-core to re-export."
        },
        {
          "id": "P40.04",
          "type": "hard",
          "reason": "Need facades in execution-service to re-export."
        }
      ]
    },
    {
      "id": "P40.06",
      "title": "WorkerAdapter / LocalPiWorkerAdapter Bridge",
      "goal": "Ensure coding-agent worker implementation conforms to execution-core WorkerAdapter contract.",
      "executorPrompt": "Ensure LocalPiWorkerAdapter imports WorkerAdapter from @earendil-works/pi-execution-core. Ensure AutonomousExecutor auto-creates LocalPiWorkerAdapter as default. WorkerAdapter type must come from external package, not internal path.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/worker-adapter/**",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/index.ts",
          "packages/execution-core/src/worker-adapter.ts"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.03",
          "type": "hard",
          "reason": "Need WorkerAdapter contract in execution-core."
        },
        {
          "id": "P40.05",
          "type": "hard",
          "reason": "Need compatibility shims."
        }
      ]
    },
    {
      "id": "P40.07",
      "title": "Import Migration Batch 1: Low-Risk Type and Read Model Imports",
      "goal": "Migrate low-risk imports from internal coding-agent paths to new package exports.",
      "executorPrompt": "Migrate type-only imports (ExecutionCommand, ExecutionReadModel, BrainProposal, WorkerAdapter) from internal execution-core/ or worker-adapter/ paths to @earendil-works/pi-execution-core. Migrate re-exports in coding-agent/src/index.ts similarly. Run make test after each file batch.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/**/*.ts",
          "packages/coding-agent/src/index.ts",
          "docs/pi/p40/**"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.05",
          "type": "hard",
          "reason": "Need compatibility shims in place."
        },
        {
          "id": "P40.06",
          "type": "hard",
          "reason": "Need WorkerAdapter bridge."
        }
      ]
    },
    {
      "id": "P40.08",
      "title": "Runtime Caller Adoption: execution-service",
      "goal": "Give execution-service real callers; it must not remain a dead stub.",
      "executorPrompt": "Ensure handleExecutionCommand and createExecutionReadModel from @earendil-works/pi-execution-service have real runtime callers. At minimum: AutonomousExecutor stop handling uses execution-service (already done). Add web-server control endpoint adoption.",
      "capabilities": {
        "canEdit": [
          "packages/execution-service/**",
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/web-server/src/index.ts",
          "packages/web-server/src/plan-runner.ts"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.04",
          "type": "hard",
          "reason": "Need facades in execution-service."
        }
      ]
    },
    {
      "id": "P40.09",
      "title": "Web Server Command/Query Adoption",
      "goal": "Migrate key web-server command/query paths to execution-service where practical.",
      "executorPrompt": "Identify web-server control endpoints (stop, pause, resume) and route them through @earendil-works/pi-execution-service handleExecutionCommand where practical. Keep direct state-store fallback for backward compat. Document which routes were migrated and which remain direct.",
      "capabilities": {
        "canEdit": [
          "packages/web-server/src/index.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/web-server/src/state-store-provider.ts",
          "packages/execution-service/**",
          "docs/pi/p40/**"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.08",
          "type": "hard",
          "reason": "Need execution-service facades."
        },
        {
          "id": "P40.07",
          "type": "hard",
          "reason": "Need import migration for clean paths."
        }
      ]
    },
    {
      "id": "P40.10",
      "title": "Boundary Import Guards and Doctor Checks",
      "goal": "Add checks preventing execution-core/service/coding-agent dependency inversion and forbidden imports.",
      "executorPrompt": "Add boundary tests that fail if execution-core imports from coding-agent, WorkerAdapter imports transition-router, brain imports mutable execution APIs, or execution-service has zero callers. Add doctor checks for boundary health.",
      "capabilities": {
        "canEdit": [
          "packages/execution-core/**",
          "packages/execution-service/**",
          "packages/coding-agent/test/**/*boundary*.test.ts",
          "packages/coding-agent/src/core/production-readiness-doctor.ts",
          "docs/pi/p40/**"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.07",
          "type": "hard",
          "reason": "Need import migration done to test boundaries."
        },
        {
          "id": "P40.08",
          "type": "hard",
          "reason": "Need runtime callers to check."
        }
      ]
    },
    {
      "id": "P40.11",
      "title": "Package Build, Exports, and Workspace Wiring",
      "goal": "Update package.json, exports, tsconfig/workspace wiring so new packages build and can be imported.",
      "executorPrompt": "Ensure execution-core and execution-service build correctly. Verify npm run build succeeds. Verify coding-agent can import from both new packages.",
      "capabilities": {
        "canEdit": [
          "packages/execution-core/**",
          "packages/execution-service/**",
          "package.json",
          "tsconfig.json",
          "packages/coding-agent/package.json",
          "packages/coding-agent/tsconfig.json"
        ],
        "canRun": [
          "npm run build",
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P40.10",
          "type": "hard",
          "reason": "Need boundary guards before finalizing packages."
        }
      ]
    },
    {
      "id": "P40.12",
      "title": "Final make test-full Validation and P40 Report",
      "goal": "Run make test and make test-full, then write final P40 report.",
      "executorPrompt": "Run make test and make test-full. Produce docs/pi/p40/final-report.md and reports/p40-platform-agent-separation/<timestamp>/summary.md with results, remaining couplings, and final verdict.",
      "capabilities": {
        "canEdit": [
          "docs/pi/p40/**",
          "reports/p40-platform-agent-separation/**"
        ],
        "canRun": [
          "make test",
          "make test-full"
        ]
      },
      "dependencies": [
        {
          "id": "P40.11",
          "type": "hard",
          "reason": "Need working package build."
        }
      ]
    }
  ]
}
```

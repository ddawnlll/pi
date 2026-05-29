# P34 — Execution / Brain / Agent Separation

**Contract Version:** 4.0.0  
**Template:** LLM Implementation Agent — Execution-Safe Refactor Plan  
**Phase:** P34  
**Title:** Execution / Brain / Agent Separation  
**Status:** Draft  
**Last Updated:** 2026-05-29  
**Execution Class:** `architecture_refactor`  
**Selected Mode:** `logical_boundary_first`  
**Target Promotion Mode:** `stable_6`  
**Autonomous Execution Allowed:** `true_after_preflight`  
**Agent Repo Mutation Allowed:** `true_after_admission`  
**Scheduler Runtime Use:** `enabled_after_state_hotfixes`  
**Workspace Count:** 12  
**Requested Max Parallelism:** 6  
**Safe Effective Parallelism:** 3  
**Primary Rule:** Execution owns state. Agent owns work. Brain owns advice. Web owns transport. UI owns visibility.

---

## 0. TL;DR / Compact Mental Model

P34 is **not** the Postgres state hotfix.  
P34 is **not** a large package split.  
P34 is **not** a V5 Brain feature implementation phase.

P34 separates responsibilities and authority boundaries so the system becomes production-stabilizable without a risky import explosion.

The core architectural problem is not that files live in the same package. The problem is that **authority boundaries are not enforced strongly enough**:

```text
Runner can create its own execution reality.
Agent execution can leak into state transitions.
Brain code risks becoming too close to execution mutation.
Web/dashboard can accidentally rely on mixed local/runtime/Postgres state.
```

P34 fixes this by introducing logical boundaries first:

```text
Execution owns state.
Agent owns work.
Brain owns advice.
Web owns transport.
UI owns visibility.
DB owns persistence.
```

Physical package splitting is intentionally deferred unless proven necessary.

---

## 1. Problem Statement

The current system has good design ideas, but the runtime is not production-ready because some critical invariants are not enforced at module/API boundaries.

Recent real E2E runs exposed the pattern:

```text
controller/state says one thing
runner does another thing
monitor calculates a third thing
agent execution becomes a fourth reality
```

The immediate state bugs should be fixed in the relevant hotfix phase, but P34 addresses the deeper architectural risk: **the system does not clearly prevent the wrong layer from doing the wrong thing.**

### 1.1 What P34 must prevent

P34 must make these impossible or strongly visible:

```text
Brain mutates execution state directly.
Agent decides workspace state transitions.
Web UI derives authoritative execution state from local/in-memory data.
Runner starts work before Execution authority admits it.
Completion/failure is decided outside the Execution boundary.
Agent adapter is hard-coded so replacing Pi is painful.
```

### 1.2 What P34 intentionally does not solve

P34 does not:

```text
fix the attempt UUID bug
fix pg_notify payload size
rewrite Postgres state store
implement Brain V5 features
physically split the monorepo into many packages
rewrite the scheduler
rewrite the dashboard
```

Those are either hotfixes, future phases, or downstream improvements.

---

## 2. Design Doctrine

### 2.1 Authority model

| System | Responsibility | May mutate execution state? |
|---|---|---:|
| Execution | State machine, transitions, scheduler, attempts, locks, worktree, validation, completion | Yes |
| Agent Runtime | Execute worker packet and stream events/results | No |
| Pi Agent Adapter | Default implementation of AgentRuntime | No |
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

---

## 3. Target Logical Architecture

P34 does **logical separation first** inside the existing repo/package structure.

```text
packages/coding-agent/src/
  execution/
    types.ts
    execution-engine.ts
    execution-authority.ts
    state-read-model.ts
    command-model.ts

  agent-runtime/
    types.ts
    agent-runtime.ts
    pi-agent-runtime.ts

  brain/
    boundary.ts
    execution-read-client.ts
    proposal-contract.ts

  core/
    existing files remain during transition
```

No mass move is required in P34. Existing `core/*` files can remain where they are, while boundary wrappers and interfaces are introduced and enforced.

---

## 4. New Public Interfaces

### 4.1 AgentRuntime

```ts
export interface AgentRuntime {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  abort(runId: string): Promise<void>;
}

export interface AgentRunRequest {
  planExecutionId: string;
  workspaceExecutionId: string;
  workspaceId: string;
  attemptNumber: number;
  worktreePath: string;
  packet: WorkerPacket;
  allowedTools: ToolSpec[];
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRunResult {
  verdict: "complete" | "failed" | "blocked" | "timed_out";
  events: AgentEvent[];
  changedFiles: string[];
  report?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.2 ExecutionCommand

```ts
export type ExecutionCommand =
  | { type: "start_plan"; planId: string }
  | { type: "stop_plan"; planExecutionId: string; reason?: string }
  | { type: "retry_workspace"; planExecutionId: string; workspaceId: string; reason?: string }
  | { type: "approve_proposal"; proposalId: string };
```

### 4.3 ExecutionReadModel

Brain, Web Server, and UI may consume this read model, not the mutable execution internals.

```ts
export interface ExecutionReadModel {
  getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;
  getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
  listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;
}
```

### 4.4 Brain proposal boundary

```ts
export interface BrainProposal {
  id: string;
  type: "retry" | "split_workspace" | "draft_plan" | "investigate" | "notify";
  summary: string;
  rationale: string;
  evidenceRefs: string[];
  proposedCommand?: ExecutionCommand;
}
```

Brain may create `BrainProposal`. Execution decides whether a proposal can become a command.

---

## 5. Non-Goals

P34 must not:

```text
move 100+ files
change DB schema unless required for boundary tests
change V5 product behavior
rewrite CompletionGate
rewrite WorkspaceScheduler
rewrite Web UI
remove the current Pi agent
change the LLM provider layer
```

P34 should avoid churn.

Expected file movement: near zero.  
Expected new boundary files: 8–15.  
Expected modified files: 10–25.  
Expected import changes: 20–60.  

---

## 6. Required Invariants

### 6.1 Execution authority invariant

```text
A workspace may execute only after Execution authority accepts active transition.
```

### 6.2 Agent non-authority invariant

```text
AgentRuntime cannot import mutable state-store transition APIs.
```

### 6.3 Brain read-only invariant

```text
Brain modules cannot import transitionWorkspace, DatabaseStateStore mutation methods, WorkspaceScheduler mutation methods, or worktree/file-lock mutation APIs.
```

### 6.4 Web gateway invariant

```text
Web routes must call Execution command/query interfaces, not direct internal scheduler/state mutation helpers.
```

### 6.5 UI observer invariant

```text
Dashboard types and views consume read-model/event envelopes, not internal executor classes.
```

### 6.6 Test gate invariant

```text
Boundary tests must fail if forbidden imports are introduced.
```

---

## 7. Implementation Strategy

### 7.1 Do not start with package split

Large physical separation would likely touch:

```text
70–150 files
150–400 imports
multiple build/test boundaries
many incidental failures
```

That is not the right first move.

P34 starts with logical separation:

```text
new interfaces
new adapters
new boundary tests
minimal rewiring
no broad file moves
```

### 7.2 First extraction: AgentRuntime

`AutonomousExecutor` must stop directly owning the concrete worker implementation.

Before:

```text
AutonomousExecutor -> WorkspaceAgentExecutor
```

After:

```text
AutonomousExecutor -> AgentRuntime -> PiAgentRuntime -> WorkspaceAgentExecutor
```

This makes Pi replaceable later.

### 7.3 Second extraction: Brain read-only client

Brain modules must get a read-only execution client.

Before risk:

```text
Brain -> state store / scheduler / execution internals
```

After:

```text
Brain -> ExecutionReadModel
Brain -> BrainProposal
```

### 7.4 Third extraction: Web routes as gateway

Web server should expose:

```text
POST /execution/commands
GET /execution/plans/:id
GET /execution/events/:id
POST /brain/proposals
GET /brain/conversation
```

Internally these call command/query interfaces.

### 7.5 Fourth extraction: diagnostic gates

The E2E scripts created during recent hotfixes become permanent gates:

```text
mock execution gauntlet
Postgres simulated full plan
real LLM smoke
state-authority diagnostic
nightly/full real run
```

---

## 8. Workspaces

### P34.00 — Architecture Boundary Audit

**Goal:** Map current imports and mutable authority paths across execution, agent, brain, web, UI, DB, and scripts.

**Allowed files:**
```text
docs/pi/p34/**
packages/coding-agent/src/**/*.ts
packages/web-server/src/**/*.ts
packages/web-ui/dashboard/src/**/*.ts
```

**Executor prompt:**  
Audit the current codebase and produce a boundary map showing which files currently own execution state, which files call agent execution, which files access mutable state store APIs, which brain files can see execution internals, and which web routes bypass intended command/query boundaries. Do not refactor yet except adding documentation artifacts.

**Acceptance criteria:**
```text
docs/pi/p34/boundary-audit.md exists
mutable execution authority paths are listed
agent coupling points are listed
brain-to-execution import risks are listed
web route bypasses are listed
recommended minimal refactor points are listed
```

---

### P34.01 — Shared Boundary Contracts

**Goal:** Add small boundary contracts without moving existing implementation files.

**Allowed files:**
```text
packages/coding-agent/src/execution/**
packages/coding-agent/src/agent-runtime/**
packages/coding-agent/src/brain/boundary.ts
packages/coding-agent/src/brain/execution-read-client.ts
packages/coding-agent/src/brain/proposal-contract.ts
docs/pi/p34/**
```

**Executor prompt:**  
Create minimal TypeScript contracts for Execution commands, Execution read model, AgentRuntime, AgentRunRequest, AgentRunResult, AgentEvent, BrainProposal, and read-only Brain execution access. Keep the contracts stable, small, and implementation-agnostic.

**Acceptance criteria:**
```text
AgentRuntime interface exists
ExecutionCommand interface/types exist
ExecutionReadModel interface exists
BrainProposal contract exists
No concrete executor implementation is moved
No behavior change yet
```

---

### P34.02 — PiAgentRuntime Adapter

**Goal:** Wrap current `WorkspaceAgentExecutor` behind `AgentRuntime`.

**Allowed files:**
```text
packages/coding-agent/src/agent-runtime/**
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/role-packets.ts
packages/coding-agent/test/**/*agent-runtime*.test.ts
docs/pi/p34/**
```

**Executor prompt:**  
Implement `PiAgentRuntime` as the default `AgentRuntime` adapter around the existing worker execution path. Do not remove `WorkspaceAgentExecutor`; adapt it. Ensure `AgentRunResult` has no authority to mutate execution state.

**Acceptance criteria:**
```text
PiAgentRuntime can run a workspace packet
PiAgentRuntime returns AgentRunResult
AgentRunResult contains verdict/report/changedFiles/error/events
PiAgentRuntime does not call transitionWorkspace directly
Unit tests cover success/failure/abort mapping
```

---

### P34.03 — AutonomousExecutor Uses AgentRuntime

**Goal:** Replace direct concrete agent construction in `AutonomousExecutor` with injected `AgentRuntime`.

**Allowed files:**
```text
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/agent-runtime/**
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/test/**/*autonomous-executor*.test.ts
packages/coding-agent/scripts/post-hotfix-real-validation.ts
packages/coding-agent/scripts/run-v5-real-implementation.ts
```

**Executor prompt:**  
Refactor `AutonomousExecutor` so it depends on `AgentRuntime` instead of directly constructing `WorkspaceAgentExecutor`. Execution still owns state transitions, file locks, scheduling, retries, completion, and terminalization.

**Acceptance criteria:**
```text
AutonomousExecutor accepts AgentRuntime dependency
Default wiring uses PiAgentRuntime
No direct state mutation is moved into AgentRuntime
Existing diagnostic scripts still run
Mock AgentRuntime can be used in tests
```

---

### P34.04 — Execution Authority Guard Tests

**Goal:** Add tests proving only execution authority can transition state.

**Allowed files:**
```text
packages/coding-agent/test/**/*execution-authority*.test.ts
packages/coding-agent/test/**/*agent-runtime*.test.ts
packages/coding-agent/src/execution/**
packages/coding-agent/src/agent-runtime/**
```

**Executor prompt:**  
Add boundary tests that fail if AgentRuntime or Brain imports mutable execution transition APIs. Add tests proving agent result mapping flows through Execution before state changes.

**Acceptance criteria:**
```text
AgentRuntime cannot transition workspace state directly
Brain cannot import mutable execution APIs
Agent result maps through execution terminalization
Forbidden import tests exist
```

---

### P34.05 — Brain Read-Only Execution Boundary

**Goal:** Ensure Brain can observe execution but cannot mutate it.

**Allowed files:**
```text
packages/coding-agent/src/brain/**
packages/coding-agent/src/execution/**
packages/coding-agent/test/**/*brain*.test.ts
docs/pi/p34/**
```

**Executor prompt:**  
Introduce or enforce a read-only execution client for Brain modules. Brain modules may query summaries, events, and history. Brain outputs proposals/drafts only. No direct state mutation from Brain modules is allowed.

**Acceptance criteria:**
```text
Brain uses ExecutionReadModel or read-only client
BrainProposal contract used for action suggestions
No brain module imports transitionWorkspace or mutable state-store methods
Boundary test covers forbidden imports
```

---

### P34.06 — Web Server Gateway Boundary

**Goal:** Keep web server as transport/API gateway, not execution authority.

**Allowed files:**
```text
packages/web-server/src/**/*.ts
packages/coding-agent/src/execution/**
packages/coding-agent/test/**/*web*.test.ts
docs/pi/p34/**
```

**Executor prompt:**  
Identify and wrap direct web-server calls into execution internals behind command/query interfaces. Do not rewrite routes broadly. Ensure web server sends commands and reads summaries/events.

**Acceptance criteria:**
```text
Web server routes use Execution command/query interface where practical
No route directly mutates workspace execution rows
No route directly drives scheduler internals except via execution API
Existing route behavior remains compatible
```

---

### P34.07 — Dashboard Contract Boundary

**Goal:** Make dashboard consume stable read models/event envelopes instead of executor internals.

**Allowed files:**
```text
packages/web-ui/dashboard/src/**/*.ts
packages/coding-agent/src/execution/**
docs/pi/p34/**
```

**Executor prompt:**  
Introduce or document dashboard-facing execution summary/event types. Avoid importing internal executor classes into UI types. Keep changes minimal.

**Acceptance criteria:**
```text
Dashboard-facing types are stable read models
UI does not depend on mutable executor internals
No broad dashboard rewrite
```

---

### P34.08 — Permanent E2E Gate Scripts

**Goal:** Convert diagnostic scripts into permanent cheap execution gates.

**Allowed files:**
```text
packages/coding-agent/scripts/execution-diagnostic-gauntlet.ts
packages/coding-agent/scripts/post-hotfix-real-validation.ts
packages/coding-agent/scripts/state-authority-diagnostic.ts
packages/coding-agent/scripts/run-real-execution-smoke.ts
packages/coding-agent/package.json
docs/pi/p34/**
```

**Executor prompt:**  
Stabilize the diagnostic scripts into reusable gates: mock E2E, Postgres simulated full plan, real LLM smoke, state-authority diagnostic, and optional full real implementation run.

**Acceptance criteria:**
```text
npm script exists for execution contract validation
npm script exists for mock E2E
npm script exists for Postgres simulated full plan
npm script exists for state-authority diagnostic
npm script exists for optional real LLM smoke
Docs explain when each gate runs
```

---

### P34.09 — Boundary Enforcement in CI/Doctor

**Goal:** Make boundary violations visible before runtime.

**Allowed files:**
```text
packages/coding-agent/src/core/production-readiness-doctor.ts
packages/coding-agent/src/core/plan-intake-analyzer.ts
packages/coding-agent/scripts/**
packages/coding-agent/package.json
docs/pi/p34/**
```

**Executor prompt:**  
Add doctor/CI checks for boundary violations: forbidden imports, missing AgentRuntime adapter, Brain mutable state access, web route direct mutation, and missing E2E gates.

**Acceptance criteria:**
```text
Doctor reports AgentRuntime adapter status
Doctor reports Brain read-only boundary status
Doctor reports execution authority boundary status
Doctor reports E2E gate availability
Boundary violations produce actionable warnings/errors
```

---

### P34.10 — Backward Compatibility and Migration Notes

**Goal:** Keep existing entrypoints working while new boundaries become default.

**Allowed files:**
```text
docs/pi/p34/**
packages/coding-agent/src/core/**
packages/coding-agent/src/agent-runtime/**
packages/coding-agent/scripts/**
```

**Executor prompt:**  
Document and implement compatibility shims so existing scripts and callers still work while `AgentRuntime` and execution boundary interfaces become the preferred path.

**Acceptance criteria:**
```text
Existing scripts still run
New AgentRuntime path is default where feasible
Compatibility notes written
Known legacy paths listed with deprecation plan
```

---

### P34.11 — Final Validation and Report

**Goal:** Validate P34 without running a full V5 implementation.

**Allowed files:**
```text
docs/pi/p34/**
reports/execution-diagnostics/**
```

**Executor prompt:**  
Run targeted tests, cheap E2E gates, and boundary checks. Produce the final P34 report.

**Acceptance criteria:**
```text
npm run check --workspace packages/coding-agent passes or known unrelated failures documented
mock execution gauntlet passes
Postgres simulated full plan passes
state-authority diagnostic passes
AgentRuntime tests pass
Brain boundary tests pass
Doctor boundary report passes
docs/pi/p34/final-report.md exists
```

---

## 9. Execution Batches

### Batch 0 — Audit and contracts

```text
P34.00
P34.01
```

Parallelism: 1–2

### Batch 1 — Agent adapter boundary

```text
P34.02
P34.03
P34.04
```

Parallelism: 2

### Batch 2 — Brain/Web/UI boundaries

```text
P34.05
P34.06
P34.07
```

Parallelism: 2–3

### Batch 3 — Permanent gates and doctor

```text
P34.08
P34.09
```

Parallelism: 2

### Batch 4 — Compatibility and final validation

```text
P34.10
P34.11
```

Parallelism: 1

---

## 10. File Scope Summary

### Likely new files

```text
packages/coding-agent/src/agent-runtime/types.ts
packages/coding-agent/src/agent-runtime/agent-runtime.ts
packages/coding-agent/src/agent-runtime/pi-agent-runtime.ts
packages/coding-agent/src/execution/types.ts
packages/coding-agent/src/execution/execution-authority.ts
packages/coding-agent/src/execution/state-read-model.ts
packages/coding-agent/src/execution/command-model.ts
packages/coding-agent/src/brain/boundary.ts
packages/coding-agent/src/brain/execution-read-client.ts
packages/coding-agent/src/brain/proposal-contract.ts
docs/pi/p34/boundary-audit.md
docs/pi/p34/migration-notes.md
docs/pi/p34/final-report.md
```

### Likely modified files

```text
packages/coding-agent/src/core/autonomous-executor.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/src/core/role-packets.ts
packages/coding-agent/src/core/production-readiness-doctor.ts
packages/coding-agent/src/core/plan-intake-analyzer.ts
packages/coding-agent/scripts/post-hotfix-real-validation.ts
packages/coding-agent/scripts/execution-diagnostic-gauntlet.ts
packages/coding-agent/scripts/state-authority-diagnostic.ts
packages/coding-agent/package.json
packages/web-server/src/**/*.ts
packages/web-ui/dashboard/src/**/*.ts
```

### Files not intended for broad moves

```text
packages/db/**
packages/ai/**
packages/web-ui/dashboard large components
packages/web-server route tree
```

---

## 11. Validation Commands

Run targeted validation:

```bash
npm run check --workspace packages/coding-agent
```

Run cheap gates:

```bash
node --import tsx packages/coding-agent/scripts/execution-diagnostic-gauntlet.ts
PI_STATE_STORE_BACKEND=postgres node --import tsx packages/coding-agent/scripts/post-hotfix-real-validation.ts --simulated-only
PI_STATE_STORE_BACKEND=postgres node --import tsx packages/coding-agent/scripts/state-authority-diagnostic.ts
```

Run optional real smoke only when credentials are available:

```bash
PI_DIAG_RUN_REAL_LLM=1 PI_STATE_STORE_BACKEND=postgres node --import tsx packages/coding-agent/scripts/post-hotfix-real-validation.ts --real-smoke-only
```

Do **not** require full V5 real implementation for P34 completion.

---

## 12. Acceptance Criteria

P34 is complete only if:

```text
AgentRuntime boundary exists.
PiAgentRuntime is the default adapter.
AutonomousExecutor uses AgentRuntime or has a clear compatibility shim.
AgentRuntime cannot mutate execution state directly.
Brain uses read-only execution access and proposal contracts.
Brain cannot mutate execution state directly.
Web server uses command/query boundaries where practical.
Dashboard consumes stable read models/event envelopes where practical.
Permanent E2E gates exist as scripts/package commands.
Doctor can report boundary status.
No large physical package split was required.
Existing hotfix diagnostics still pass.
```

---

## 13. Failure Conditions

P34 fails if:

```text
It becomes a broad file-moving refactor.
It changes V5 product behavior.
It rewrites scheduler/state store without need.
It makes full real implementation run mandatory.
AgentRuntime directly transitions workspace state.
Brain can still import mutable execution APIs.
AutonomousExecutor remains tightly coupled to only WorkspaceAgentExecutor with no adapter path.
E2E gates are not preserved.
```

---

## 14. Final Report Template

```markdown
# P34 Final Report — Execution / Brain / Agent Separation

## Summary

## What Changed

## Boundaries Added

## AgentRuntime Adapter

## Execution Authority Enforcement

## Brain Read-Only Boundary

## Web/API Gateway Boundary

## Dashboard Contract Boundary

## Permanent E2E Gates

## Files Changed

## Validation Results

## Remaining Legacy Couplings

## Deferred Physical Package Split

## Final Verdict
```

---

## 15. Final Verdict Criteria

P34 does not claim the system is production-ready by itself.

P34 claims:

```text
The architecture now has enforceable boundaries that make production hardening possible.
Pi is on the path to becoming a replaceable default agent adapter.
Execution is the single state authority.
Brain is advisory/read-only with proposals.
E2E gates are permanent enough to prevent the same class of silent runtime regressions.
```

Production readiness still requires:

```text
P-HOTFIX-STATE-2 completed
state-authority diagnostic green
real full V5 run either succeeds or fails with precise blocker report
nightly/real E2E gate stabilized
```

---

# Part 3 — JSON Queue

```json
{
  "contractVersion": "4.0.0",
  "phase": "P34",
  "title": "Execution / Brain / Agent Separation",
  "status": "draft",
  "executionClass": "architecture_refactor",
  "selectedMode": "logical_boundary_first",
  "targetPromotionMode": "stable_6",
  "maxParallelWorkspaces": 6,
  "expectedSafeEffectiveParallelism": 3,
  "jsonRuntimeFallbackAllowed": false,
  "planExecution": {
    "phase": "P34",
    "title": "Execution / Brain / Agent Separation",
    "maxParallelWorkspaces": 6,
    "expectedSafeEffectiveParallelism": 3,
    "stateBackend": "postgres",
    "worktree": {
      "enabled": true
    },
    "integrationQueue": {
      "enabled": true
    },
    "validation": {
      "globalValidationLockRequired": true
    }
  },
  "derivedExecutionProfile": {
    "executionBackend": "postgres",
    "worktreeRequired": true,
    "integrationQueueRequired": true,
    "agentMutationAllowed": true
  },
  "workspaces": [
    {
      "id": "P34.00",
      "title": "Architecture Boundary Audit",
      "goal": "Map current execution, agent, brain, web, UI, DB, and script authority boundaries before refactoring.",
      "executorPrompt": "Audit the current codebase and produce docs/pi/p34/boundary-audit.md. Identify mutable execution authority paths, agent coupling points, brain-to-execution import risks, web route bypasses, and minimal refactor points. Do not refactor behavior yet.",
      "capabilities": {
        "canEdit": [
          "docs/pi/p34/**"
        ],
        "canRun": [
          "grep",
          "find",
          "npm test"
        ]
      },
      "dependencies": []
    },
    {
      "id": "P34.01",
      "title": "Shared Boundary Contracts",
      "goal": "Introduce small boundary contracts for execution commands/read models, agent runtime, and brain proposals.",
      "executorPrompt": "Create minimal TypeScript contracts for ExecutionCommand, ExecutionReadModel, AgentRuntime, AgentRunRequest, AgentRunResult, AgentEvent, BrainProposal, and read-only Brain execution access. Do not move existing implementations.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/execution/**",
          "packages/coding-agent/src/agent-runtime/**",
          "packages/coding-agent/src/brain/boundary.ts",
          "packages/coding-agent/src/brain/execution-read-client.ts",
          "packages/coding-agent/src/brain/proposal-contract.ts",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.00",
          "type": "hard",
          "reason": "Contracts should reflect the audit."
        }
      ]
    },
    {
      "id": "P34.02",
      "title": "PiAgentRuntime Adapter",
      "goal": "Wrap current WorkspaceAgentExecutor behavior behind an AgentRuntime adapter.",
      "executorPrompt": "Implement PiAgentRuntime as the default AgentRuntime adapter around the existing worker execution path. Do not remove WorkspaceAgentExecutor. Ensure AgentRunResult has no authority to mutate execution state.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/agent-runtime/**",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/src/core/role-packets.ts",
          "packages/coding-agent/test/**/*agent-runtime*.test.ts",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.01",
          "type": "hard",
          "reason": "Needs AgentRuntime contracts."
        }
      ]
    },
    {
      "id": "P34.03",
      "title": "AutonomousExecutor Uses AgentRuntime",
      "goal": "Refactor AutonomousExecutor to depend on AgentRuntime instead of directly constructing the concrete agent executor.",
      "executorPrompt": "Refactor AutonomousExecutor so it uses an injected AgentRuntime or a default PiAgentRuntime compatibility path. Execution must still own state transitions, file locks, scheduling, retries, completion, and terminalization.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/autonomous-executor.ts",
          "packages/coding-agent/src/agent-runtime/**",
          "packages/coding-agent/src/core/workspace-agent-executor.ts",
          "packages/coding-agent/test/**/*autonomous-executor*.test.ts",
          "packages/coding-agent/scripts/post-hotfix-real-validation.ts",
          "packages/coding-agent/scripts/run-v5-real-implementation.ts"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.02",
          "type": "hard",
          "reason": "Needs PiAgentRuntime adapter."
        }
      ]
    },
    {
      "id": "P34.04",
      "title": "Execution Authority Guard Tests",
      "goal": "Add boundary tests proving agent and brain layers cannot directly mutate execution state.",
      "executorPrompt": "Add boundary tests that fail if AgentRuntime or Brain imports mutable execution transition APIs. Add tests proving agent result mapping flows through Execution before state changes.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/test/**/*execution-authority*.test.ts",
          "packages/coding-agent/test/**/*agent-runtime*.test.ts",
          "packages/coding-agent/src/execution/**",
          "packages/coding-agent/src/agent-runtime/**",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.03",
          "type": "hard",
          "reason": "Tests target the AgentRuntime integration."
        }
      ]
    },
    {
      "id": "P34.05",
      "title": "Brain Read-Only Execution Boundary",
      "goal": "Ensure Brain observes execution and emits proposals/drafts but cannot directly mutate execution state.",
      "executorPrompt": "Introduce or enforce a read-only execution client for Brain modules. Brain modules may query summaries, events, and history. Brain outputs proposals/drafts only. No direct state mutation from Brain modules is allowed.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/**",
          "packages/coding-agent/src/execution/**",
          "packages/coding-agent/test/**/*brain*.test.ts",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.01",
          "type": "hard",
          "reason": "Needs boundary contracts."
        }
      ]
    },
    {
      "id": "P34.06",
      "title": "Web Server Gateway Boundary",
      "goal": "Keep web server as API transport and gateway rather than execution authority.",
      "executorPrompt": "Identify and wrap direct web-server calls into execution internals behind command/query interfaces. Do not rewrite routes broadly. Ensure routes send commands and read summaries/events.",
      "capabilities": {
        "canEdit": [
          "packages/web-server/src/**/*.ts",
          "packages/coding-agent/src/execution/**",
          "packages/coding-agent/test/**/*web*.test.ts",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.01",
          "type": "hard",
          "reason": "Needs execution command/query contracts."
        }
      ]
    },
    {
      "id": "P34.07",
      "title": "Dashboard Contract Boundary",
      "goal": "Make dashboard consume stable read models and event envelopes instead of mutable executor internals.",
      "executorPrompt": "Introduce or document dashboard-facing execution summary/event types. Avoid importing internal executor classes into UI types. Keep changes minimal.",
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/**/*.ts",
          "packages/coding-agent/src/execution/**",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.01",
          "type": "hard",
          "reason": "Needs read-model contracts."
        }
      ]
    },
    {
      "id": "P34.08",
      "title": "Permanent E2E Gate Scripts",
      "goal": "Promote execution diagnostic scripts into permanent cheap E2E gates.",
      "executorPrompt": "Stabilize diagnostic scripts into reusable gates: mock E2E, Postgres simulated full plan, real LLM smoke, state-authority diagnostic, and optional full real implementation run. Add package scripts and docs.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/scripts/execution-diagnostic-gauntlet.ts",
          "packages/coding-agent/scripts/post-hotfix-real-validation.ts",
          "packages/coding-agent/scripts/state-authority-diagnostic.ts",
          "packages/coding-agent/scripts/run-real-execution-smoke.ts",
          "packages/coding-agent/package.json",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.03",
          "type": "hard",
          "reason": "Gates should use the new AgentRuntime path where applicable."
        }
      ]
    },
    {
      "id": "P34.09",
      "title": "Boundary Enforcement in CI and Doctor",
      "goal": "Make boundary violations visible before runtime.",
      "executorPrompt": "Add doctor or CI checks for forbidden imports, missing AgentRuntime adapter, Brain mutable state access, web route direct mutation, and missing E2E gates.",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/production-readiness-doctor.ts",
          "packages/coding-agent/src/core/plan-intake-analyzer.ts",
          "packages/coding-agent/scripts/**",
          "packages/coding-agent/package.json",
          "docs/pi/p34/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.04",
          "type": "hard",
          "reason": "Needs boundary tests."
        },
        {
          "id": "P34.08",
          "type": "hard",
          "reason": "Doctor should report E2E gate status."
        }
      ]
    },
    {
      "id": "P34.10",
      "title": "Backward Compatibility and Migration Notes",
      "goal": "Keep existing entrypoints working while new boundaries become the preferred path.",
      "executorPrompt": "Document and implement compatibility shims so existing scripts and callers still work while AgentRuntime and execution boundary interfaces become the preferred path.",
      "capabilities": {
        "canEdit": [
          "docs/pi/p34/**",
          "packages/coding-agent/src/core/**",
          "packages/coding-agent/src/agent-runtime/**",
          "packages/coding-agent/scripts/**"
        ],
        "canRun": [
          "npm test",
          "npm run check"
        ]
      },
      "dependencies": [
        {
          "id": "P34.03",
          "type": "hard",
          "reason": "Needs adapter path."
        },
        {
          "id": "P34.09",
          "type": "soft",
          "reason": "Migration notes should mention doctor checks."
        }
      ]
    },
    {
      "id": "P34.11",
      "title": "Final Validation and Report",
      "goal": "Validate P34 boundaries and produce final report.",
      "executorPrompt": "Run targeted checks, cheap E2E gates, and boundary tests. Produce docs/pi/p34/final-report.md with results, remaining couplings, deferred package split notes, and final verdict.",
      "capabilities": {
        "canEdit": [
          "docs/pi/p34/**",
          "reports/execution-diagnostics/**"
        ],
        "canRun": [
          "npm test",
          "npm run check",
          "node"
        ]
      },
      "dependencies": [
        {
          "id": "P34.05",
          "type": "hard",
          "reason": "Needs brain boundary."
        },
        {
          "id": "P34.06",
          "type": "hard",
          "reason": "Needs web gateway boundary."
        },
        {
          "id": "P34.07",
          "type": "hard",
          "reason": "Needs dashboard boundary."
        },
        {
          "id": "P34.10",
          "type": "hard",
          "reason": "Needs compatibility notes."
        }
      ]
    }
  ]
}
```

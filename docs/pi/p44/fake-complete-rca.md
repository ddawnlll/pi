# Fake Complete Root Cause Analysis

## Executive Summary

A "fake complete" occurs when a worker agent responds with `VERDICT: COMPLETE` but has not actually satisfied all acceptance criteria or produced verifiable artifacts. This RCA maps every path through the verdict/state transition system where fake-complete can enter, propagate, or be gated, with specific file and function evidence.

---

## 1. Verdict Entry Points

### 1.1 Worker Self-Report (Primary Entry)

**File:** `packages/coding-agent/src/core/workspace-agent-executor.ts`
**Functions:**
- `executeWorkspace()` (line ~1187)
- `Verdict parsing block` (lines 1187-1260)

**How fake-complete enters:**
The worker's LLM output is scanned for the string `VERDICT: COMPLETE` via a simple `content.includes("VERDICT: COMPLETE")` check at line 1187. The verdict is emitted immediately:

```typescript
// workspace-agent-executor.ts:1187
if (content.includes("VERDICT: COMPLETE")) {
    finalVerdict = "COMPLETE";
    log("Agent reported COMPLETE");
    // Emit validation passed and decision summary
    if (this.stateStore && this.planExecutionId) {
        if (typeof this.stateStore.emitValidation === "function") {
            await this.stateStore
                .emitValidation(this.planExecutionId, workspaceId, "All acceptance criteria met", true)
                .catch(() => {});
        }
    }
}
```

**Vulnerability:** No semantic validation of whether ACs were actually met — only string matching on the verdict label. The worker can literally output `VERDICT: COMPLETE` while having done no work.

---

### 1.2 Worker Echo Extraction (PlanSpec v5)

**File:** `packages/coding-agent/src/core/completion/worker-echo-extractor.ts`
**Functions:**
- `extractWorkerEcho()` (line 195)
- `tryParseStructuredJson()` (line 57)
- `tryParseAccpMetadataBlock()` (line 99)
- `tryParseExplicitCompletionBlock()` (line 144)
- `verifyWorkerEcho()` (line 238)

**How fake-complete enters:**
In PlanSpec v5 mode, the worker's report is parsed for structured echo claims (JSON blocks, ACCP metadata, or explicit completion blocks). The parser at `tryParseStructuredJson()` (line 57) extracts `planLockHash`, `workspaceLockHash`, and `verdict` from any JSON block containing those fields.

**Vulnerability:** If the worker fabricates lock hashes or omits them, the echo may pass extraction but fail lock hash verification downstream. The `verifyWorkerEcho()` function (line 238) compares extracted hashes against expected values but does not verify the worker actually performed the work.

---

## 2. State Propagation Paths

### 2.1 WorkspaceAgentExecutor → AutonomousExecutor

**File:** `packages/coding-agent/src/core/autonomous-executor.ts`
**Functions:**
- `executeWorkspace()` (line ~1320 area)
- `handleWorkerCompletion()` (around line 1460)

**Flow:**
The `workspace-agent-executor` returns a `WorkspaceExecutionResult` with verdict string. The `AutonomousExecutor.executeWorkspace()` receives this result at line 1320 and feeds it into the completion gate.

**Fake-complete risk:** The verdict string from the agent executor is forwarded without additional validation. If the agent executor's verdict parsing was fooled, the fake-complete propagates here.

### 2.2 Completion Gate Registry

**File:** `packages/coding-agent/src/core/completion-gate.ts`
**Functions:**
- `CompletionGateRegistry.evaluateWorkspace()` (line 1397)
- `CompletionGateRegistry.evaluateWorkspaceV2()` (line 1429)
- `evaluateWorkspaceCompletion()` (line 345)

**Flow:**
The gate checks:
1. Implementation finished? (boolean flag)
2. Target command passed? (exit code 0 or equivalent)
3. No unresolved test failures?
4. No error events?
5. Not out of retries?
6. No validation command running?
7. No watch-mode commands?
8. No dangerous git commands?
9. Last command exit code 0?

In V2 mode (PlanSpec), additional checks:
10. Lock hashes match?
11. AC evidence satisfaction?

**Vulnerability:** 
- `implementationFinished` is set by `markImplementationFinished()` which is called on receipt of `VERDICT: COMPLETE` from worker. This is a circular trust — the gate trusts that the worker finished because the worker said so.
- Evidence satisfaction checks require a properly populated `EvidenceLedger` which may not exist in v3 mode.
- The `cleanEvidenceDowngrade` path (line ~387-427) can downgrade missing targetCommand check to non-blocking if the worker reported COMPLETE with "clean evidence".

### 2.3 Lead Agent Bypass

**File:** `packages/coding-agent/src/core/autonomous-executor.ts`
**Lines:** ~1330-1335

**How fake-complete can bypass the gate entirely:**
Lead agents (read-only observers) skip the completion gate and auto-commit entirely:

```typescript
// autonomous-executor.ts:1330-1333
const isLeadRole = workspace.roleBudget === "lead";
if (isLeadRole) {
    // Lead agents are read-only observers; mark complete directly without completion gate
    if (result.verdict === "COMPLETE") {
        await this.transitionRouter.transitionWorkspace(
            planExecutionId, workspace.id, WorkspaceStage.Complete, { verdict: result.verdict }
        );
    }
}
```

**Vulnerability:** Lead agents bypass all gate checks. A lead agent saying `VERDICT: COMPLETE` goes directly to workspace transition.

---

## 3. Terminal State Transitions

### 3.1 TransitionRouter

**File:** `packages/coding-agent/src/execution-runtime/transition-router.ts`
**Functions:**
- `DirectTransitionRouter.transitionWorkspace()` (line 92)
- `KernelBackedTransitionRouter.transitionWorkspace()` (line 147)

**Flow:**
Once the gate says `canComplete`, the transition router:
1. Maps `WorkspaceStage.Complete` → `AttemptState.SUCCEEDED` via `mapStageToAttemptState()` (line ~33)
2. Calls `this.stateStore.transitionWorkspace()` to persist the transition
3. In PG mode, routes through `WorkspaceAttemptController` for FSM validation

**Vulnerability:** The FSM (`attempt-fsm.ts`) only validates legal state transitions (e.g., RUNNING → SUCCEEDED is legal), not whether the completion was genuine. It enforces state machine legality, not completion integrity.

### 3.2 Plan-Level Completion Predicate

**File:** `packages/coding-agent/src/execution-runtime/completion-predicate.ts`
**Functions:**
- `computePlanLifecycleState()` (line ~69)

**Flow:**
Plan completion is computed from workspace terminal states. If all required workspaces are SUCCEEDED and final validation passes, the plan is COMPLETED.

**Vulnerability:** If individual workspaces are fake-complete, the plan-level predicate aggregates those fake completions into a plan-level fake completion. No cross-workspace integrity check exists.

---

## 4. Known Vulnerabilities Summary

| ID | Path | File | Function/Location | Risk Level | Existing Guard |
|---|---|---|---|---|---|
| FC-01 | Worker verdict string match | `workspace-agent-executor.ts` | `executeWorkspace()` L1187 | **HIGH** | None — string match only |
| FC-02 | Echo extraction accepts forged hashes | `worker-echo-extractor.ts` | `tryParseStructuredJson()` L57 | **MEDIUM** | Lock hash verification in V2 gate |
| FC-03 | Gate trusts implementationFinished flag | `completion-gate.ts` | `evaluateWorkspaceCompletion()` L352 | **HIGH** | None — circular trust |
| FC-04 | Lead agent gate bypass | `autonomous-executor.ts` | `executeWorkspace()` L1333 | **HIGH** | None — deliberate bypass |
| FC-05 | Clean evidence downgrade | `completion-gate.ts` | `evaluateWorkspaceCompletion()` L387 | **MEDIUM** | Conservative: only when all signals clean |
| FC-06 | FSM only checks legality, not integrity | `attempt-fsm.ts` | `assertLegalTransition()` | **LOW** | None — out of scope for FSM |
| FC-07 | No cross-workspace integrity | `completion-predicate.ts` | `computePlanLifecycleState()` | **MEDIUM** | None |

---

## 5. Recommended Mitigations

1. **Post-Implementation Auditor** — Verify worker claims against actual git diff output before allowing completion (P44.07 scope).
2. **CompletionGate v2** — Strengthen evidence satisfaction checks with required proof artifacts per AC (P44.03 scope).
3. **Negative Assertion Scanner** — Detect forbidden shortcuts/patterns in worker output that indicate fake completion (P44.04 scope).
4. **Eliminate Lead Agent bypass** — Lead agents should still gate, just with read-appropriate checks.
5. **Evidence-backed completion** — Require at least one `EvidenceRef` per completed workspace before the gate allows transition.

---

## 6. Verdict/State Transition Map

```
Worker Output
    │
    ├── Contains "VERDICT: COMPLETE"?
    │      YES ──► workspace-agent-executor.ts:1187
    │                  │
    │                  ▼
    │             finalVerdict = "COMPLETE"
    │                  │
    │                  ▼
    │             AutonomousExecutor.executeWorkspace()
    │             autonomous-executor.ts:1320
    │                  │
    │                  ├── Lead role? ──► Skip gate → transitionWorkspace(Complete)
    │                  │                       autonomous-executor.ts:1333
    │                  │
    │                  └── Normal role ──► markImplementationFinished()
    │                                       completion-gate.ts:1376
    │                                            │
    │                                            ▼
    │                                       evaluateWorkspace()
    │                                       completion-gate.ts:1491/1498
    │                                            │
    │                              ┌─────────────┴─────────────┐
    │                              ▼                           ▼
    │                         canComplete                  blocked
    │                              │                           │
    │                              ▼                           ▼
    │                     transitionWorkspace(Complete)   transitionWorkspace(Failed|Blocked)
    │                     transition-router.ts:92/147     transition-router.ts:92/147
    │                              │
    │                              ▼
    │                     StateStore persists attempt
    │                              │
    │                              ▼
    │                     computePlanLifecycleState()
    │                     completion-predicate.ts:69
    │                              │
    │                              ▼
    │                     Plan COMPLETED / FAILED_FINAL
    │
    └── Not found ──► No verdict emitted (loop continues or timeout)
```

---

## 7. File/Function Evidence Map

| File | Key Function(s) | Lines | Role |
|---|---|---|---|
| `workspace-agent-executor.ts` | `executeWorkspace()` | 1187-1260 | Verdict parsing from worker output |
| `worker-echo-extractor.ts` | `extractWorkerEcho()`, `tryParseStructuredJson()`, `verifyWorkerEcho()` | 195-260 | Structured echo extraction |
| `autonomous-executor.ts` | `executeWorkspace()` | 1320-1650 | Completion orchestration, gate integration |
| `completion-gate.ts` | `evaluateWorkspaceCompletion()`, `evaluateWorkspace()`, `evaluateWorkspaceV2()` | 345-1450 | Gate logic, block reasons |
| `transition-router.ts` | `transitionWorkspace()` | 60-164 | State transition persistence |
| `completion-predicate.ts` | `computePlanLifecycleState()` | 69-150 | Plan-level completion |
| `attempt-fsm.ts` | `assertLegalTransition()` | Full file | FSM legality check |
| `workspace-attempt-controller.ts` | Full class | Full file | PG-backed attempt FSM |
| `context-packet.ts` | Output contract setup | 141 | Sets `VERDICT: COMPLETE \| BLOCKED \| FAILED` |
| `role-packets.ts` | Various role packet builders | 126, 161, 196, 240 | Output contract per role |

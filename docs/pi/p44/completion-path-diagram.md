# Completion Path Diagram

## End-to-End Architectural Flow

This document maps the complete path from worker output through parsing, evidence collection, completion gating, terminal reconciliation, and final ExecutionKernel transition.

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WORKER OUTPUT                                  │
│  LLM-generated text containing verdict (VERDICT: COMPLETE / BLOCKED /       │
│  FAILED) and optionally structured echo claims (JSON, ACCP metadata)        │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: PARSER                                                           │
│                                                                             │
│  ┌─────────────────────────────┐    ┌──────────────────────────────────┐   │
│  │ workspace-agent-executor.ts │    │  worker-echo-extractor.ts         │   │
│  │                             │    │                                  │   │
│  │ content.includes(           │    │  extractWorkerEcho(output)       │   │
│  │   "VERDICT: COMPLETE")      │    │    ├─ tryParseStructuredJson()   │   │
│  │   → finalVerdict="COMPLETE" │    │    ├─ tryParseAccpMetadataBlock()│   │
│  │                             │    │    └─ tryParseExplicitCompletion()│   │
│  │ content.includes(           │    │                                  │   │
│  │   "VERDICT: BLOCKED")       │    │  Returns: WorkerEchoClaim        │   │
│  │   → finalVerdict="BLOCKED"  │    │    { workspaceId, planLockHash,  │   │
│  │                             │    │      workspaceLockHash, verdict,  │   │
│  │ content.includes(           │    │      evidenceRefs }              │   │
│  │   "VERDICT: FAILED")        │    └──────────┬───────────────────────┘   │
│  │   → finalVerdict="FAILED"   │               │                          │
│  └──────────┬──────────────────┘               │                          │
│             │                                  │                          │
└─────────────┼──────────────────────────────────┼──────────────────────────┘
              │                                  │
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: EVIDENCE COLLECTION                                              │
│                                                                             │
│  autonomous-executor.ts                                                     │
│                                                                             │
│  1. Record command history                                                  │
│     completionGate.recordCommand(planExecId, wsId, command);                │
│                                                                             │
│  2. Record completion from agent executor                                   │
│     completionGate.recordCompletion(planExecId, wsId, event);              │
│                                                                             │
│  3. Mark implementation as finished (if verdict=COMPLETE)                   │
│     completionGate.markImplementationFinished(planExecId, wsId);           │
│                                                                             │
│  4. Record equivalent command evidence (P37.HOTFIX)                         │
│     completionGate.recordEquivalentCommand(planExecId, wsId, cmd, exit);   │
│                                                                             │
│  5. Validate commit safety (P43.8A)                                         │
│     WorkspaceCommitGate.validate()                                          │
│     → blockReasons from dangerous git commands                              │
│                                                                             │
│  6. Extract worker echo (PlanSpec v5 mode)                                  │
│     extractWorkerEcho(report) → planLockHash/workspaceLockHash             │
│                                                                             │
│  7. Set lock hashes on validation state (PlanSpec v5 mode)                  │
│     completionGate.setLockHashes(planExecId, wsId, planHash, wsHash);     │
│                                                                             │
│  Brain V5 Evidence Index (read-only)                                        │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ brain/evidence/api.ts                                              │    │
│  │ EvidenceRef types: git_file, validation, approval, memory,         │    │
│  │                   temporal_event, proposal, draft, test, scan,     │    │
│  │                   log_json, command                               │    │
│  │ BuildV5Outputs adds confidence assessment from evidence refs      │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: COMPLETION GATE                                                  │
│                                                                             │
│  completion-gate.ts                                                        │
│                                                                             │
│  evaluateWorkspaceCompletion(validationState, workspace)                    │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ Block Reasons Checked:                                            │    │
│  │                                                                    │    │
│  │  [1] Implementation finished?                                     │    │
│  │       └─ implementationFinished flag (set in Phase 2 step 3)      │    │
│  │                                                                    │    │
│  │  [2] Target command passed? (exit 0 or equivalent)                │    │
│  │       └─ Downgraded to warning if clean evidence + COMPLETE       │    │
│  │                                                                    │    │
│  │  [3] Unresolved test failures?                                    │    │
│  │       └─ Filtered from failureSignals by isTestFailureSignal()    │    │
│  │                                                                    │    │
│  │  [4] Unresolved error events?                                     │    │
│  │       └─ Filtered from failureSignals by isErrorSignal()          │    │
│  │                                                                    │    │
│  │  [5] Out of retries?                                              │    │
│  │       └─ Forces recommendedState = WorkspaceStage.Failed          │    │
│  │                                                                    │    │
│  │  [6] Validation command still running?                            │    │
│  │                                                                    │    │
│  │  [7] Watch-mode command detected?                                 │    │
│  │       └─ Forbidden pattern match on command history               │    │
│  │                                                                    │    │
│  │  [8] Dangerous git command detected?                              │    │
│  │       └─ Pattern match: git add ., git commit -a, etc.            │    │
│  │                                                                    │    │
│  │  [9] Last command had non-zero exit code?                         │    │
│  │       └─ lastCommandExitCode !== null && !== 0                    │    │
│  │                                                                    │    │
│  │  ┌─ If any block: canComplete=false, recommendedState set         │    │
│  │  └─ If none: canComplete=true, recommendedState=Complete          │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  V2 PlanSpec Mode (evaluateWorkspaceV2):                                   │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ Additional Block Reasons:                                         │    │
│  │  [10] Lock hashes not set on validation state                     │    │
│  │  [11] Plan lock hash mismatch                                     │    │
│  │  [12] Workspace lock hash mismatch                                │    │
│  │  [13] Worker-reported lock hash mismatch                          │    │
│  │  [14] AC evidence unsatisfied (requires EvidenceLedger)           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Result: WorkspaceCompletionResult { canComplete, blockReasons[],          │
│           recommendedState }                                                │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       canComplete=true          canComplete=false
              │                         │
              ▼                         ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│ PHASE 4: RECONCILER    │  │ PHASE 4: RECONCILER          │
│                         │  │                              │
│ autonomous-executor.ts  │  │ autonomous-executor.ts       │
│ line ~1505              │  │ line ~1546                   │
│                         │  │                              │
│ transitionRouter       │  │ transitionRouter             │
│   .transitionWorkspace  │  │   .transitionWorkspace       │
│   (Complete)            │  │   (Failed | Blocked)         │
│                         │  │                              │
│ Auto-commit:            │  │ Lead Agent observation:      │
│ commitWorkspace(ws)     │  │ observeEvent({               │
│                         │  │   eventType:                 │
│ Auto-commit skipped:    │  │   "completion_gate_blocked"  │
│   lead role             │  │ })                           │
│   commit === false      │  │                              │
└───────────┬─────────────┘  │ Control plane event:         │
            │                │ appendControlPlaneEvent(     │
            │                │   "completion_gate_blocked_  │
            ▼                │    visible", blockReasons)   │
                             └───────────┬──────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: EXECUTION KERNEL                                                 │
│                                                                             │
│  transition-router.ts                                                      │
│                                                                             │
│  DirectTransitionRouter (JSON backend):                                    │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ transitionWorkspace(stateStore) → stateStore.transitionWorkspace() │    │
│  │ Direct delegation to IStateStore — no FSM enforcement              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  KernelBackedTransitionRouter (PG backend):                                │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 1. Map stage to attempt state:                                    │    │
│  │    Complete → SUCCEEDED                                            │    │
│  │    Failed → FAILED_RETRYABLE                                       │    │
│  │    Blocked → BLOCKED                                                │    │
│  │                                                                    │    │
│  │ 2. assertLegalTransition(currentState, newState)                    │    │
│  │    └─ FSM enforces: RUNNING→SUCCEEDED (legal)                     │    │
│  │                    RUNNING→FAILED_RETRYABLE (legal)               │    │
│  │                    RUNNING→BLOCKED (legal)                          │    │
│  │                                                                    │    │
│  │ 3. WorkspaceAttemptController.transitionState()                    │    │
│  │    └─ Creates attempt journal event                                 │    │
│  │    └─ Persists to PostgreSQL via attempt_events table              │    │
│  │                                                                    │    │
│  │ 4. stateStore.transitionWorkspace() persists stage                 │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Plan-Level Completion (completion-predicate.ts):                           │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ computePlanLifecycleState() — runs after each workspace completes  │    │
│  │                                                                    │    │
│  │ Rules:                                                             │    │
│  │ • Any required HANDOFF_REQUIRED unresolved → AWAITING_HANDOFF      │    │
│  │ • Any required FAILED_FINAL → FAILED_FINAL                         │    │
│  │ • Any required non-terminal → BLOCKED_WITH_REASON                  │    │
│  │ • All required SUCCEEDED + no final validation → FINAL_VALIDATION  │    │
│  │ • Final validation passed → COMPLETED                              │    │
│  │ • Final validation failed → FAILED_FINAL                           │    │
│  │ • Optional failures → COMPLETED_WITH_WARNINGS                      │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | File | Responsibility | ExecutionKernel Role |
|---|---|---|---|
| **Parser** | `workspace-agent-executor.ts` | Extract verdict string from LLM output | Event source (observer) |
| **Echo Extractor** | `worker-echo-extractor.ts` | Extract structured completion claims (JSON, ACCP, explicit) | Event source (observer) |
| **Evidence Collector** | `autonomous-executor.ts` | Record commands, completions, equivalent validation | Authorized actor |
| **Evidence Index** | `brain/evidence/api.ts` | Read-only index of evidence refs from artifacts | Read-only (doctrine) |
| **Completion Gate** | `completion-gate.ts` | Evaluate whether workspace can complete | Authorized actor (decision) |
| **Commit Safety** | `workspace-commit-gate.ts` | Validate git staged files are within scope | Authorized actor |
| **Reconciler** | `autonomous-executor.ts` | Apply gate result, trigger transition | Authorized actor |
| **Transition Router** | `transition-router.ts` | Persist state transition, route through FSM | ExecutionKernel boundary |
| **FSM Controller** | `workspace-attempt-controller.ts` | Enforce legal attempt state transitions | ExecutionKernel (PG) |
| **Plan Predicate** | `completion-predicate.ts` | Compute plan lifecycle from workspace states | ExecutionKernel (observer) |

---

## Data Flow

```
                ┌─────────────┐
                │  LLM Output  │  Raw text: "I did the work... VERDICT: COMPLETE"
                └──────┬──────┘
                       │
                       ▼
                ┌──────────────┐
                │   Parser     │  → finalVerdict: "COMPLETE"
                │              │  → WorkerEchoClaim { planLockHash, ... }
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────────┐
                │ Evidence Collector│  → recordCommand(), recordCompletion()
                │                   │  → markImplementationFinished()
                └──────┬───────────┘
                       │
                       ▼
                ┌──────────────────┐
                │  Completion Gate  │  → evaluateWorkspaceCompletion()
                │                   │  → WorkspaceCompletionResult
                └──────┬───────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
        canComplete        blocked
              │                 │
              ▼                 ▼
     ┌──────────────┐   ┌──────────────┐
     │  Reconciler   │   │  Reconciler   │
     │  Transition   │   │  Transition   │
     │  to Complete  │   │  to Fail/Block│
     └──────┬───────┘   └──────┬───────┘
            │                  │
            ▼                  ▼
     ┌──────────────────────────────────┐
     │     ExecutionKernel (FSM)        │
     │  WorkspaceAttemptController      │
     │  → assertLegalTransition()       │
     │  → create attempt_event          │
     │  → persist state                 │
     │                                  │
     │  Plan Predicate                  │
     │  → computePlanLifecycleState()   │
     └──────────────────────────────────┘
```

---

## Key File References

| File | Path |
|---|---|
| Workspace Agent Executor | `packages/coding-agent/src/core/workspace-agent-executor.ts` |
| Worker Echo Extractor | `packages/coding-agent/src/core/completion/worker-echo-extractor.ts` |
| Autonomous Executor | `packages/coding-agent/src/core/autonomous-executor.ts` |
| Completion Gate | `packages/coding-agent/src/core/completion-gate.ts` |
| Transition Router | `packages/coding-agent/src/execution-runtime/transition-router.ts` |
| Workspace Commit Gate | `packages/coding-agent/src/core/workspace-commit-gate.ts` |
| Completion Predicate | `packages/coding-agent/src/execution-runtime/completion-predicate.ts` |
| Attempt FSM | `packages/coding-agent/src/execution-runtime/attempt-fsm.ts` |
| Workspace Attempt Controller | `packages/coding-agent/src/execution-runtime/workspace-attempt-controller.ts` |
| Brain V5 Evidence API | `packages/coding-agent/src/brain/evidence/api.ts` |
| Evidence Types | `packages/coding-agent/src/brain/evidence/types.ts` |
| V5 Outputs | `packages/coding-agent/src/brain/evidence/v5-outputs.ts` |
| Context Packet | `packages/coding-agent/src/core/context-packet.ts` |
| Role Packets | `packages/coding-agent/src/core/role-packets.ts` |

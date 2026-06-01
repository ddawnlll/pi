# Control Action Safety Matrix

**Date:** 2026-06-01
**Author:** Worker agent (P42.02)
**Goal:** Audit all control actions and map plan/workspace/escalation/proposal/orchestrator/scale/digest actions through execution-service-backed endpoints. Dangerous actions require confirmation with impact summary.
**Source docs:** `proposed_interface_map_v3.md` (section 13), `P42_Dashboard_V3_Execution_Cockpit_Plan_v4_1_1.md`
**Data sources examined:**
- `packages/execution-core/src/commands.ts` — Canonical command types (11 command variants)
- `packages/execution-core/src/events.ts` — 39 event types
- `packages/execution-core/src/types.ts` — State store interface, workspace stage enum
- `packages/execution-service/src/command-handler.ts` — Command handler facade
- `packages/execution-service/src/execution-service.ts` — Service facade
- `packages/web-server/src/index.ts` — Legacy `POST /api/executions/:planExecId/control` endpoint
- `packages/web-server/src/human-directive-routes.ts` — Workspace/escalation control endpoints
- `packages/web-server/src/proposal-routes.ts` — Proposal action endpoints
- `packages/web-server/src/orchestrator-routes.ts` — Orchestrator control endpoints (1431 lines)
- `packages/web-server/src/scale-routes.ts` — Scale/integration queue control endpoints (1163 lines)
- `packages/web-server/src/digest-action-routes.ts` — Digest action endpoints
- `packages/web-ui/dashboard/src/hooks/useHumanDirectives.ts` — UI hooks for intervention/directives
- `packages/web-ui/dashboard/src/hooks/usePlanRunner.ts` — UI hooks for plan run/validate
- `packages/web-ui/dashboard/src/components/ControlActionsPanel.tsx` — Workspace control UI
- `packages/web-ui/dashboard/src/components/HumanDirectivePanel.tsx` — Directive UI

---

## 1. Control Action Inventory

### 1.1 Plan-Level Actions

| # | Action | Current Endpoint | ES Command | Event Emitted | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|-----------------|------------|---------------|-----------------|----------------------|--------------|
| 1 | Pause | `POST /api/executions/:peid/control` (`action: "pause"`) | — (direct `stateStore.pausePlan()`) | `plan_paused` | Partial¹ | No | Safe |
| 2 | Resume | `POST /api/executions/:peid/control` (`action: "resume"`) | `continue_plan` | `plan_resumed` | Partial² | No | Safe |
| 3 | Stop | `POST /api/executions/:peid/control` (`action: "stop"`) | `stop_plan` | `plan_stopped` | Partial³ | **Yes** (impact summary) | **DANGEROUS** |
| 4 | Cancel | `POST /api/executions/:peid/control` (`action: "cancel"`) | `rerun_plan`⁴ | `plan_cancelled` | Partial³ | **Yes** (impact summary) | **DANGEROUS** |
| 5 | Force Kill | `POST /api/executions/:peid/control` (`action: "force-kill"`) | — (direct state store + `killTrackedDetachedChildren()` + worktree removal) | `plan_stopped` | No⁵ | **Yes** (double confirm) | **CRITICAL** |
| 6 | Rerun | `POST /api/projects/:pid/plans/run` | `rerun_plan` | New plan execution | Partial⁶ | **Yes** (creates new execution) | **DANGEROUS** |

**Footnotes:**
1. Pause bypasses `handleExecutionCommand()` entirely — calls `stateStore.pausePlan()` directly and emits `wake` via `signalExecutionEvent()`.
2. Resume routes through `handleExecutionCommand({ type: "continue_plan" })` for adoption tracking (with empty deps `{}`), but then also calls `stateStore.resumePlan()` directly for the actual mutation.
3. Stop and Cancel route through `handleExecutionCommand()` (with empty deps `{}`) for adoption tracking, but primary mutation is still through direct state store calls (`stateStore.stopPlan()`, `stateStore.cancelPlan()`, `stateStore.writeControlRequest()`).
4. `cancel` uses `rerun_plan` command type — this is semantically incorrect; it should use `stop_plan` with cancel reason or a dedicated cancel command.
5. Force Kill bypasses ES entirely — directly:
   - Calls `stateStore.stopPlan()`
   - Calls `stateStore.writeControlRequest()`
   - Kills child processes via `killTrackedDetachedChildren()` and `pkill -KILL -P ${ourPid}`
   - Removes worktrees via `git worktree remove --force` / `rm -rf`
   - This is intentionally outside ES because force-kill is a last-resort operation that the normal execution flow cannot handle.
6. Rerun goes through plan-runner's `POST /api/projects/:pid/plans/run` which parses plan content and creates a new execution using `AutonomousExecutor`. The `handleExecutionCommand({ type: "rerun_plan" })` adoption tracking (with empty deps `{}`) is called separately for the old execution.

### 1.2 Workspace-Level Actions

| # | Action | Endpoint | ES Command | Event Emitted | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|------------|---------------|-----------------|----------------------|--------------|
| 7 | Stop | `POST /api/human/intervene/:peid/:wsId` (`action: "stop"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | **Yes** (impact summary) | **DANGEROUS** |
| 8 | Pause | `POST /api/human/intervene/:peid/:wsId` (`action: "pause"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | No | Safe |
| 9 | Cancel | `POST /api/human/intervene/:peid/:wsId` (`action: "cancel"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | **Yes** (impact summary) | **DANGEROUS** |
| 10 | Retry | `POST /api/human/intervene/:peid/:wsId` (`action: "retry"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | No | Safe |
| 11 | Issue Directive | `POST /api/human/directive` | `issue_human_directive` | `human_directive_issued` | **Yes** ✅ | No | Safe |

**Note:** Workspace-level actions correctly route through `handleExecutionCommand()` via `human-directive-routes.ts`. This is the model that plan-level actions should follow. The `planControlManager: stateStore` dep is properly provided.

### 1.3 Escalation-Level Actions

| # | Action | Endpoint | ES Command | Event Emitted | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|------------|---------------|-----------------|----------------------|--------------|
| 12 | Resolve | `POST /api/human/escalations/:escId/resolve` | `resolve_escalation` | `lead_agent_escalation_resolved` | **Broken**⁰ | No | Safe |
| 13 | Acknowledge Directive | `POST /api/human/escalations/:escId/ack`¹ | `acknowledge_directive` | `lead_agent_directive_acknowledged` | **Yes** ✅ | No | Safe |

**Footnotes:**
0. **CRITICAL BUG**: `resolve_escalation` route in `human-directive-routes.ts` passes empty deps `{}` to `handleExecutionCommand()`, but the handler requires `escalationManager`. The handler checks `if (!deps.escalationManager)` and returns `{ accepted: false, message: "Escalation manager not available", error: "No escalation manager configured" }`. The route will ALWAYS return 422 regardless of request validity. Escalation is never actually resolved.
   - **Root cause**: The route handler at `fastify.post("/api/human/escalations/:escalationId/resolve", ...)` constructs the command and passes `{}` as the second argument to `handleExecutionCommand()`, instead of `{ escalationManager: stateStore }` (or a dedicated escalation manager that implements the `resolveEscalation` method).
   - **Impact**: Every resolve escalation call fails with 422. There is no fallback mutation path (unlike the legacy control endpoint which calls both `handleExecutionCommand()` AND direct `stateStore` methods).
   - **Fix**: Wire the `escalationManager` dependency. The `getStateStore()` stateStore needs to expose the `escalationManager` interface (`resolveEscalation` method, matching the `EscalationManager` shape), or a separate escalation manager should be injected.
1. The acknowledge endpoint (`POST /api/human/escalations/:escId/ack`) is specified in V3 section 13.1 as `POST /api/execution/:eid/escalations/:escId/ack` but is not yet implemented in `human-directive-routes.ts`. Only `resolve` is currently implemented — and it's broken.

### 1.4 Proposal-Level Actions (Policy / Governance)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 14 | Approve for Planning | `POST /api/proposals/:id/action` (`action: "approve_for_planning"`) | No² | No | Advisory |
| 15 | Approve for Execution | `POST /api/proposals/:id/action` (`action: "approve_for_execution"`) | No² | **Yes**¹ | **DANGEROUS** |
| 16 | Reject | `POST /api/proposals/:id/action` (`action: "reject"`) | No² | No | Advisory |
| 17 | Request Changes | `POST /api/proposals/:id/action` (`action: "request_changes"`) | No² | No | Advisory |
| 18 | Approve Self-Modification | `POST /api/proposals/:id/action` (`action: "approve_self_modification"`) | No² | **Yes** (double confirm) | **CRITICAL** |

**Footnotes:**
1. Approve for Execution should require confirmation because it enables resource consumption (tokens, compute). The route already enforces dry-run (`proposal.dryRunStatus !== "passed"`) and budget (`proposal.budgetState !== "valid"`) pre-conditions before allowing execution approval, returning 400 if either check fails.
2. Proposal actions modify `.pi/proposals/index.json` directly via file writes (or DB via `ProposalRepository`). They do not go through execution-service because proposals are a different domain (policy/intelligence vs execution). This is architecturally correct — proposal actions are policy decisions, not execution commands. The `handleExecutionCommand({ type: "approve_proposal" })` stub exists in the command handler but is never called from the proposal routes.

### 1.5 Orchestrator-Level Actions (Separate System)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 19 | Pause | `POST /api/orchestrator/control` (`action: "pause"`) | N/A¹ | No | Safe |
| 20 | Resume | `POST /api/orchestrator/control` (`action: "resume"`) | N/A¹ | No | Safe |
| 21 | Request Scan | `POST /api/orchestrator/control` (`action: "request_scan"`) | N/A¹ | No | Safe |
| 22 | Lead Agent Pause | `POST /api/orchestrator/lead-agent/control` (`action: "pause"`) | N/A¹ | No | Safe |
| 23 | Lead Agent Resume | `POST /api/orchestrator/lead-agent/control` (`action: "resume"`) | N/A¹ | No | Safe |
| 24 | Lead Agent Stop | `POST /api/orchestrator/lead-agent/control` (`action: "stop"`) | N/A¹ | **Yes**² | **DANGEROUS** |

**Footnotes:**
1. Orchestrator is a separate daemon process. Control actions write to `.pi/.orchestrator/control-request.json` which the orchestrator daemon reads asynchronously. Health state is updated immediately in `.pi/.orchestrator/health.json` for dashboard feedback. This is architecturally correct per P11.N AC2 ("dashboard requests do not directly mutate orchestrator state"). However, stopping lead agent analysis mid-flight (action 24) could lose partial analysis results — the analysis would need to be restarted from scratch.
2. Lead Agent Stop (`POST /api/orchestrator/lead-agent/control` with `action: "stop"`) is handled purely in-memory via mutable module-level variables (`leadAgentStopped = true`). There is no persistence or recovery mechanism. The SSE stream checks `leadAgentStopped` before each step and emits "Analysis stopped by user." on detection.

### 1.6 Scale / Integration Queue Actions (Separate System)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 25 | Worktree Cleanup | `POST /api/scale/worktrees/cleanup` | N/A¹ | No | Safe |
| 26 | Delete Worktree | `DELETE /api/scale/worktrees/:name` | N/A¹ | **Yes**² | **DANGEROUS** |
| 27 | Queue Pause | `POST /api/scale/integration-queue/pause` | N/A¹ | No | Safe |
| 28 | Queue Resume | `POST /api/scale/integration-queue/resume` | N/A¹ | No | Safe |
| 29 | Queue Retry | `POST /api/scale/integration-queue/retry/:wsId` | N/A¹ | No | Safe |
| 30 | Queue Requeue | `POST /api/scale/integration-queue/requeue/:wsId` | N/A¹ | **Yes**² | **DANGEROUS** |
| 31 | Clear Completed | `POST /api/scale/integration-queue/clear-completed` | N/A¹ | **Yes**² | **DANGEROUS** |
| 32 | Queue Reorder | `POST /api/scale/integration-queue/reorder` | N/A¹ | **Yes**² | **DANGEROUS** |

**Footnotes:**
1. Scale/integration queue is a separate domain from plan execution. These actions modify `.pi/integration-queue.json` directly via `IntegrationQueue`. They do not go through execution-service, which is architecturally correct. Destructive actions (delete worktree, requeue, clear completed, reorder) should have confirmation dialogs in the UI.
2. Note that `clear_completed`, `reorder`, and `requeue` actions DO perform server-side safety validation via `queue.validateAction()`. The validation checks dependency constraints before allowing the action, returning 422 if the action is unsafe. However, there is no UI-side confirmation dialog for any of these actions.

### 1.7 Digest / Brain Actions (Read-Only Signals)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 33 | Resolve Signal | `POST /digest/actions/signal/:signalId/resolve` | N/A¹ | No | Safe |
| 34 | Dismiss Observation | `POST /digest/actions/observation/:observationId/dismiss` | N/A¹ | No | Safe |
| 35 | Acknowledge Proposal | `POST /digest/actions/proposal/:proposalId/acknowledge` | N/A¹ | No | Safe |

**Footnote:**
1. Digest actions are lightweight state mutations on brain signal/observation/proposal records. They import from `@earendil-works/pi-coding-agent` (calling `resolveSignal()`, `dismissObservation()`, `acknowledgeProposal()`). If the function is unavailable, the route returns `success: true` with a fallback message — no architecture-level bypass concern. These are architecturally separate from execution control.

---

## 2. Execution-Service Coverage Analysis

### 2.1 Commands Routed Through `handleExecutionCommand()`

| ExecutionCommand Type | Routes Through ES? | Backend Implementation | Danger Level |
|-----------------------|-------------------|----------------------|--------------|
| `start_plan` | ✅ Yes (stub) | `command-handler.ts` line: returns `{ accepted: true }`, no real execution | Safe |
| `stop_plan` | ✅ Yes | Mapped via legacy endpoint (`index.ts` line 4015) with empty deps `{}` + adoption tracking; real mutation via `stateStore.stopPlan()` directly | **DANGEROUS** |
| `continue_plan` | ✅ Yes | Mapped via legacy endpoint (`index.ts` line 4028) with empty deps `{}` + adoption tracking; real mutation via `stateStore.resumePlan()` directly | Safe |
| `rerun_plan` | ✅ Yes | Mapped via legacy endpoint (`index.ts` line 4021) with empty deps `{}` + adoption tracking; real mutation via `stateStore.cancelPlan()` directly | **DANGEROUS** |
| `retry_workspace` | ✅ Yes | Mapped via `transitionRouter.transitionWorkspace()` | Safe |
| `request_user_escalation` | ✅ Yes (stub) | Returns accepted, no real execution | Safe |
| `approve_proposal` | ✅ Yes (stub) | Returns accepted, no real execution | Advisory |
| `acknowledge_directive` | ✅ Yes | Mapped via `directiveManager.acknowledgeDirective()` | Safe |
| `resolve_escalation` | ✅ Yes | Mapped via `escalationManager.resolveEscalation()` — **broken** (empty deps) | Safe (when fixed) |
| `issue_human_directive` | ✅ Yes | Mapped via `planControlManager.writeControlRequest()` | Safe |
| `intervene_workspace` | ✅ Yes | Mapped via `planControlManager.writeControlRequest()` | Varies by action |

### 2.2 Backend Implementation Detail Per Command

| Type | `command-handler.ts` Lines | Backend Call | Dep Required |
|------|---------------------------|-------------|--------------|
| `start_plan` | 68-69 | `{ accepted: true }` — no-op | None |
| `stop_plan` | 70-78 | `deps.planControlManager.writeControlRequest("stop", reason)` | `planControlManager` |
| `continue_plan` | 79-87 | `deps.planControlManager.writeControlRequest("resume", reason)` | `planControlManager` |
| `rerun_plan` | 88-97 | `deps.planControlManager.writeControlRequest("cancel", reason)` | `planControlManager` |
| `retry_workspace` | 98-108 | `deps.transitionRouter.transitionWorkspace()` | `transitionRouter` |
| `request_user_escalation` | 109-111 | `{ accepted: true }` — no-op | None |
| `approve_proposal` | 112-113 | `{ accepted: true }` — no-op | None |
| `acknowledge_directive` | 114-127 | `deps.directiveManager.acknowledgeDirective()` | `directiveManager` |
| `resolve_escalation` | 128-140 | `deps.escalationManager.resolveEscalation()` | `escalationManager` |
| `issue_human_directive` | 141-157 | `deps.planControlManager.writeControlRequest("human_directive", JSON.stringify(...))` | `planControlManager` |
| `intervene_workspace` | 158-172 | `deps.planControlManager.writeControlRequest(action, JSON.stringify({workspaceId, reason}))` | `planControlManager` |

### 2.3 Dep Injection Status Per Route

| Route File | Route | Deps Passed | Status |
|------------|-------|-------------|--------|
| `index.ts` | `POST /api/executions/:peid/control` (stop) | `{}` (empty) | **Broken** — `planControlManager` not provided; command handler returns fallback success but relies on subsequent direct state store calls |
| `index.ts` | `POST /api/executions/:peid/control` (cancel) | `{}` (empty) | **Broken** — same as above |
| `index.ts` | `POST /api/executions/:peid/control` (resume) | `{}` (empty) | **Broken** — same as above |
| `index.ts` | `POST /api/executions/:peid/control` (pause) | N/A (no ES call) | N/A |
| `index.ts` | `POST /api/executions/:peid/control` (force-kill) | N/A (no ES call) | N/A |
| `human-directive-routes.ts` | `POST /api/human/directive` | `{ planControlManager: stateStore }` | ✅ Correct |
| `human-directive-routes.ts` | `POST /api/human/intervene/:peid/:wsId` | `{ planControlManager: stateStore }` | ✅ Correct |
| `human-directive-routes.ts` | `POST /api/human/escalations/:escId/resolve` | `{}` (empty) | **CRITICAL BUG** — `escalationManager` not provided; always returns 422 |

### 2.4 Legacy Direct Control Paths (Not Going Through ES)

These paths bypass `handleExecutionCommand()` entirely and should be migrated or marked as legacy:

1. **`POST /api/executions/:peid/control` (all actions)** — The primary legacy path. While some actions call `handleExecutionCommand()` for adoption tracking, the real mutation goes through `stateStore` directly. This endpoint should be:
   - Replaced by per-action endpoints (`POST /api/execution/:eid/control/pause`, `POST /api/execution/:eid/control/stop`, etc.) as specified in V3 section 13.1
   - Or deprecated in favor of the new dedicated endpoints, with the legacy endpoint kept as a compat shim

2. **`POST /api/executions/:peid/control` (force-kill)** — Fully bypasses ES. Directly terminates child processes, removes worktrees, and mutates state store. This is intentionally outside ES because force-kill is a last-resort operation that the normal execution flow cannot handle.

3. **`POST /api/proposals/:id/action`** — While architecturally correct to bypass ES (proposals are policy, not execution), the proposal action endpoint writes directly to `.pi/proposals/index.json` or DB. This is acceptable because proposals are read-model-only from the execution perspective.

4. **`POST /api/orchestrator/control` and `/api/orchestrator/lead-agent/control`** — These correctly bypass ES because the orchestrator is a separate daemon. Control is done via file-based signaling (control-request.json) and in-memory state (lead agent).

5. **`POST /api/scale/*`** — Correctly bypass ES because scale/integration queue is a separate domain. Uses `IntegrationQueue` class for safe state mutation with built-in validation.

### 2.5 Critical Gap: `resolve_escalation` Route Has Broken ES Dependency Injection

**Location:** `packages/web-server/src/human-directive-routes.ts` line ~145-175

```typescript
// The route calls handleExecutionCommand with empty deps {}
const result = await handleExecutionCommand(
    {
        type: "resolve_escalation",
        planExecutionId,
        workspaceId,
        escalationId,
        chosenOptionId,
        userResponse,
    },
    {},  // <-- empty deps! escalationManager not provided
);
```

The `handleExecutionCommand` for `resolve_escalation` requires `deps.escalationManager`:

```typescript
case "resolve_escalation": {
    if (!deps.escalationManager)
        return {
            accepted: false,
            message: "Escalation manager not available",
            error: "No escalation manager configured",
        };
    // ...
    await deps.escalationManager.resolveEscalation(...)
}
```

**Impact**: Every resolve escalation API call returns 422. The escalation is never resolved. There is no fallback mutation path (unlike the legacy control endpoint which calls both `handleExecutionCommand()` AND direct `stateStore` methods).

**Fix**: Pass the required dependency. The stateStore (from `getStateStore()`) needs to expose an `escalationManager` interface, or a separate escalation manager should be wired in. The `registerHumanDirectiveRoutes` function already accepts `getStateStore` as a parameter, but `stateStore` needs to implement the escalation manager contract:

```typescript
// In human-directive-routes.ts, change:
const result = await handleExecutionCommand({ ... }, {});
// To:
const result = await handleExecutionCommand({ ... }, {
    escalationManager: stateStore as EscalationManager,
});
// Where EscalationManager is { resolveEscalation(...): Promise<void> }
```

### 2.6 UI Mutation Paths

| UI Component | Action | Backend Route | Goes Through ES? | Confirmation? |
|-------------|--------|---------------|-----------------|---------------|
| `ControlActionsPanel` | Workspace stop/pause/cancel/retry | `POST /api/human/intervene/:peid/:wsId` | **Yes** ✅ | Built-in (2-click pattern with optional reason) |
| `HumanDirectivePanel` | Issue directive | `POST /api/human/directive` | **Yes** ✅ | No (safe action) |
| Topbar (App.tsx) | Plan pause/stop/cancel/resume/rerun/force-kill | `POST /api/executions/:peid/control` | Partial | Partial (ForceKillDialog, RerunDialog exist; others use bare `confirm()`) |
| `usePlanRunner` | Validate/run plan | `POST /api/projects/:pid/plans/validate`, `POST /api/projects/:pid/plans/run` | Partial (run routes through AutonomousExecutor) | No (validation is pre-check) |

---

## 3. Confirmation Dialog Specifications

### 3.1 Confirmation Requirements by Danger Level

| Danger Level | Confirmation Type | Example Actions |
|-------------|-------------------|-----------------|
| **Safe** | No confirmation needed | Pause, Resume, Retry, Send Directive, Resolve Escalation, Acknowledge Directive |
| **DANGEROUS** | Single confirmation with impact summary | Stop (plan/workspace), Cancel (plan/workspace), Rerun, Approve for Execution, Delete Worktree, Requeue, Clear Completed, Reorder, Stop Lead Agent |
| **CRITICAL** | Double confirmation with explicit typed acknowledgment | Force Kill, Approve Self-Modification |

### 3.2 Confirmation Dialog Content Per Action

| Action | Impact Summary | Special Behavior |
|--------|---------------|-----------------|
| Stop (plan) | "This will stop the plan. {N} active workspace(s) will be stopped. Partial results from each workspace will be preserved." | Reason input (optional) |
| Cancel (plan) | "This will cancel the plan. {N} workspace(s) ({M} completed, {P} pending) will be cancelled. Completed workspace results will be preserved. Pending workspaces will not run." | Reason input (optional) |
| Stop (workspace) | "This will stop workspace {workspaceId}. Partial results from attempt {N} will be preserved." | Reason input (optional) |
| Cancel (workspace) | "This will cancel workspace {workspaceId}. No results from attempt {N} will be saved. The workspace will be marked as cancelled." | Reason input (optional) |
| Rerun (plan) | "This will create a new execution of the same plan. The current execution ({execId}) will be cancelled. All current workspace results will be preserved in the history." | Plan name preview |
| Force Kill (plan) | "WARNING: This will forcefully terminate all active processes for this plan. Partial results will be LOST. Worktrees will be DELETED. This action CANNOT be undone." | Must type "KILL" to confirm |
| Approve Execution (proposal) | "Approving this proposal for execution will consume compute resources (tokens, API calls, compute time). Estimated cost: {N} tokens." | Budget preview; also enforces dry-run & budget pre-checks server-side |
| Approve Self-Modification (proposal) | "This proposal contains self-modification actions that will change agent/project configuration. Review the self-modification impact before approving." | Self-modification diff preview |
| Delete Worktree (scale) | "This will delete worktree {name}. Uncommitted changes in the worktree will be LOST." | — |
| Requeue (scale) | "This will requeue workspace {wsId} from '{currentStatus}' status. Ensure no worker is actively processing this workspace." | Server-side dependency validation already enforced |
| Clear Completed (scale) | "This will remove all completed, failed, and conflict entries from the integration queue. This action CANNOT be undone." | — |
| Reorder (scale) | "Reordering queued entries may break dependency chains. Ensure the new order respects batch dependencies." | Server-side dependency validation already enforced |
| Stop Lead Agent (orchestrator) | "Stopping lead agent analysis mid-flight will lose partial analysis results. Analysis will need to be restarted from scratch." | — |

### 3.3 Current Confirmation Implementation Status

| Action | Confirmation Implemented? | Location | Notes |
|--------|--------------------------|----------|-------|
| Stop (plan) | Partial | `App.tsx` — `handleControl()` includes confirm via `controlDisabled`/`control` state logic | No impact summary; just browser `confirm()` |
| Cancel (plan) | Partial | `App.tsx` — `handleControl()` includes confirm | No impact summary |
| Force Kill (plan) | ✅ Yes | `ForceKillDialog.tsx` | Has double-confirm with "KILL" text entry |
| Rerun (plan) | ✅ Yes | `RerunDialog.tsx` | Has plan name preview |
| Stop (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern (select action -> confirm with optional reason) | Has optional reason input |
| Pause (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern as stop |
| Cancel (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern as stop |
| Retry (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern, no confirmation needed but uses same UX |
| Send Directive | ❌ No | `HumanDirectivePanel.tsx` — sends immediately | No confirmation needed (safe action) |
| Resolve Escalation | ❌ No | `human-directive-routes.ts` — resolves immediately | No confirmation needed (safe action); **route is broken** |
| Acknowledge Directive | ❌ Not implemented | Not wired in UI | Not yet needed |
| Approve for Execution | ❌ No | `proposal-routes.ts` — action applies immediately | No confirmation dialog in UI; server-side dry-run + budget checks exist |
| Approve Self-Modification | ❌ No | `proposal-routes.ts` — action applies immediately | No double-confirm |
| Delete Worktree | ❌ No | `scale-routes.ts` — deletes immediately | No confirmation in UI |
| Requeue | ❌ No | `scale-routes.ts` — requeues immediately | No confirmation in UI; server-side safety validation exists |
| Clear Completed | ❌ No | `scale-routes.ts` — clears immediately | No confirmation in UI; server-side safety validation exists |
| Reorder | ❌ No | `scale-routes.ts` — reorders immediately | No confirmation in UI; server-side safety validation exists |
| Stop Lead Agent | ❌ No | `orchestrator-routes.ts` — stops immediately | No confirmation in UI |

---

## 4. Migration Recommendations

### 4.1 Priority Actions (Critical Safety Gaps)

1. **P0: Fix `resolve_escalation` deps injection** — The escalation resolution endpoint always returns 422 because `{}` empty deps are passed to `handleExecutionCommand()`. Wire `escalationManager` from `getStateStore()`.

2. **P1: Stop/Cancel (plan) — Add impact summaries**: Current `confirm()` dialogs in `App.tsx` lack workspace count, active workspace list, and partial results info. Replace with dedicated `Modal` confirmation variant showing computed impact data.

3. **P1: Wire `planControlManager` deps for plan-level ES calls**: The legacy endpoint at `index.ts` calls `handleExecutionCommand()` with empty deps `{}` for stop/cancel/resume. While the real mutation happens via direct state store calls afterward, the ES command handler's `planControlManager` is never invoked, meaning the control request is never written via the ES path. This is a logic gap for plans that rely on ES-side control request detection.

4. **P2: Add UI confirmations for destructive scale actions**: Delete Worktree, Requeue, Clear Completed, and Reorder all mutate state without any UI-side confirmation dialog (though some have server-side validation).

5. **P2: Add confirmation for Approve for Execution**: While server-side dry-run and budget checks exist, the user should see a cost/budget preview before authorizing resource consumption.

6. **P3: Add double-confirm for Approve Self-Modification**: Self-modification changes agent/project configuration and should require explicit typed acknowledgment.

### 4.2 Proposed Migration: Replace Legacy Control Endpoint

The legacy `POST /api/executions/:planExecId/control` endpoint should be replaced with per-action endpoints as specified in V3 section 13.1:

| Current | Proposed V3 |
|---------|-------------|
| `POST /api/executions/:eid/control` (body: `{action: "pause"}`) | `POST /api/execution/:eid/control/pause` |
| `POST /api/executions/:eid/control` (body: `{action: "stop"}`) | `POST /api/execution/:eid/control/stop` |
| `POST /api/executions/:eid/control` (body: `{action: "cancel"}`) | `POST /api/execution/:eid/control/cancel` |
| `POST /api/executions/:eid/control` (body: `{action: "resume"}`) | `POST /api/execution/:eid/control/resume` |
| `POST /api/executions/:eid/control` (body: `{action: "force-kill"}`) | `POST /api/execution/:eid/control/force-kill` |
| — (new) | `POST /api/execution/:eid/control/rerun` |

Each new endpoint MUST:
- Route through `handleExecutionCommand()` as the primary mutation path with properly wired deps
- Accept an optional `reason` field
- Return `CommandHandlerResult` structure (`{accepted, message, error}`)
- Log the action through the command log stream
- Emit the appropriate event via `signalExecutionEvent()`

### 4.3 Actions That Correctly Bypass ES (Keep As-Is)

These actions serve different domains and should **not** be migrated through ES:

- **Proposal actions** (`POST /api/proposals/:id/action`) — Policy/governance domain. File/DB mutations are correct.
- **Orchestrator controls** (`POST /api/orchestrator/control`, `/lead-agent/control`) — Separate daemon. File-based signaling is correct.
- **Scale/queue actions** (`POST /api/scale/*`) — Integration queue domain. `IntegrationQueue.validateAction()` provides built-in safety.
- **Digest actions** (`POST /digest/actions/*`) — Brain signal domain. Lightweight state mutations are correct.

### 4.4 Missing Endpoints (V3 Spec Not Yet Implemented)

These endpoints are specified in V3 section 13.1 but not yet implemented:

| V3 Endpoint | Purpose | Priority |
|-------------|---------|----------|
| `POST /api/execution/:eid/escalations/:escId/ack` | Acknowledge a directive (escalation context) | Low |
| `POST /api/execution/:eid/workspaces/:wsId/retry` | Workspace retry (dedicated) | Low (exists via intervene) |
| `POST /api/execution/:eid/workspaces/:wsId/cancel` | Workspace cancel (dedicated) | Low (exists via intervene) |
| `POST /api/execution/:eid/workspaces/:wsId/directive` | Send directive (dedicated) | Medium |

---

## 5. State Machine: Control Action Confirmation Flow

```
                    +---------------------------------------------+
                    |         CONTROL ACTION CONFIRMATION         |
                    +---------------------------------------------+

  idle ----> user clicks dangerous action -----> showingConfirm
   ^                                                  |
   |                                                  v
   |                                          user reviews impact
   |                                                  |
   |                                         +--------+--------+
   |                                         |        |        |
   |                                      confirm  cancel  editReason
   |                                         |        |        |
   |                                         v        |        |
   |                                    executing     |        |
   |                                         |        |        |
   |                                   +-----+-----+  |        |
   |                                   |     |     |  |        |
   |                                success error timeout |      |
   |                                   |     |     |  |        |
   |                                   +-----+-----+  |        |
   |                                         |        |        |
   +-----------------------------------------+--------+--------+

Confirmation dialog content per action:
  Stop:      "This will stop {workspaceId}. Partial results from
              attempt {N} will be preserved."
  Cancel:    "This will cancel {workspaceId}. No results will be
              saved."
  Force Kill: "WARNING: This is a destructive action. All
              processes will be terminated. Type KILL to confirm."
```

---

## 6. Current Implementation Shape: Response Consistency

### 6.1 Plan-Level (Legacy Endpoint)

```
// Success:
{ success: true }

// Error:
{ success: false, error: "Plan execution not found in database or local state" }
{ success: false, error: "Invalid action" }

// Fallback (no state store):
{ success: true, fallback: "file_based" }
```

### 6.2 Workspace-Level (human-directive-routes.ts)

```
// Success (issue directive - 201):
{ success: true, message: "Human directive issued for workspace {wsId}", directiveId: "uuid" }

// Success (intervene):
{ success: true, message: "{action} intervention sent for workspace {wsId}" }

// Success (resolve escalation):
{ success: true, message: "Escalation {escId} resolved with option {optId}" }

// Validation error (400):
{ success: false, error: "planExecutionId is required and must be a string" }

// Not found (404):
{ success: false, error: "Escalation not found: {escId}" }

// Rejected (422):
{ success: false, error: "No plan control manager configured" }

// Server error (500):
{ success: false, error: "Failed to issue human directive", message: "..." }
```

### 6.3 Proposal-Level (proposal-routes.ts)

```
// Success:
{ success: true, proposal: { /* full proposal object */ } }

// Not found (404):
{ success: false, error: "Proposal '{id}' not found" }

// Pre-condition failure (400):
{ success: false, error: "Execution approval requires a passed dry-run. Current dry-run status: {status}" }

// Validation error (400):
{ success: false, error: "Invalid action: {action}. Must be one of: approve_for_planning, ..." }

// Server error (500):
{ success: false, error: "Failed to apply proposal action", message: "..." }
```

### 6.4 Orchestrator-Level (orchestrator-routes.ts)

```
// Control success:
{ success: true, health: { /* full health object */ } }

// Lead Agent control success:
{ success: true }

// Validation error (400):
{ success: false, error: "Invalid action: {action}. Must be one of: pause, resume, request_scan" }

// Server error (500):
{ success: false, error: "Failed to process orchestrator control action" }
```

### 6.5 Scale-Level (scale-routes.ts)

```
// Success:
{ success: true, message: "Entry '{wsId}' requeued" }
{ success: true, message: "'{wsId}' retried" }
{ success: true, optimized: true|false, message: "Queue reordered for optimal throughput" }

// Safety validation failure (422):
{ success: false, error: "Dependency constraints violated; ..." }

// Server error (500):
{ success: false, error: String(error) }
```

### 6.6 Digest-Level (digest-action-routes.ts)

```
// Success:
{ success: true, signalId: "{id}", action: "resolved" }

// Server error (500):
{ error: "Failed to resolve signal", details: "..." }
```

### 6.7 Response Consistency Gap

All endpoints return `{ success: boolean, error?: string }` but:

| Endpoint Group | Response Shape Variation |
|----------------|-------------------------|
| Legacy plan control | `{ success: true }` bare, no `message` on success. Fallback adds `fallback: "file_based"`. |
| Workspace control | `{ success: true, message: "..." }` on success. Adds `directiveId` for issue directive (201). |
| Proposal | `{ success: true, proposal: {...} }` on success (different success shape entirely). |
| Orchestrator | `{ success: true }` bare (lead agent) or `{ success: true, health: {...} }` (orchestrator control). |
| Scale | `{ success: true, message: "..." }` on success. Adds `optimized`/`throughputImpact` for reorder. |
| Digest | `{ success: true, signalId, action }` on success (3 fields, all top-level). |

**Recommendation**: Standardize all control action success responses to:
```typescript
{
  success: true;
  message?: string;      // Human-readable success message
  action: string;        // The action that was taken (e.g., "stop", "pause", "resolve")
  timestamp: number;     // When the action was processed
  details?: {            // Action-specific response data
    directiveId?: string;
    proposal?: ProposalResponse;
    health?: OrchestratorHealth;
    // etc.
  };
}
```

Error responses should standardize to:
```typescript
{
  success: false;
  error: string;         // Machine-readable error code
  message?: string;      // Human-readable error description
  details?: string;      // Detailed error (for 500s, debug info)
}
```

---

## 7. Dependency Injection State Summary

| Route | File | Deps Needed | Deps Passed | Status |
|-------|------|-------------|-------------|--------|
| `issue_human_directive` | `human-directive-routes.ts` | `planControlManager` | `{ planControlManager: stateStore }` | ✅ |
| `intervene_workspace` | `human-directive-routes.ts` | `planControlManager` | `{ planControlManager: stateStore }` | ✅ |
| `resolve_escalation` | `human-directive-routes.ts` | `escalationManager` | `{}` | **BROKEN** 🚫 |
| `stop_plan` (legacy) | `index.ts` | `planControlManager` | `{}` | **BROKEN** 🚫 (bypassed by direct state store) |
| `cancel` (legacy) | `index.ts` | `planControlManager` | `{}` | **BROKEN** 🚫 (bypassed by direct state store) |
| `resume` (legacy) | `index.ts` | `planControlManager` | `{}` | **BROKEN** 🚫 (bypassed by direct state store) |

**Key Finding**: The workspace-level routes (`human-directive-routes.ts`) correctly inject `planControlManager: stateStore`, but the plan-level legacy routes (`index.ts`) pass empty deps for stop/cancel/resume ES calls *and* skip the ES path entirely for the actual mutation. This creates an inconsistent architecture where:
- Workspace-level actions are ES-backed with proper deps
- Plan-level actions partially call ES (with broken deps) but do the real work via direct state store

---

## 8. Summary

### 8.1 Actions Requiring Confirmation (Must-Have)

| Action | Current State | Gap |
|--------|--------------|-----|
| Stop (plan) | Basic `confirm()` — no impact summary | **Add impact summary** (active workspaces, partial results) |
| Cancel (plan) | Basic `confirm()` — no impact summary | **Add impact summary** (completed vs pending workspaces) |
| Force Kill (plan) | ✅ Fully implemented (`ForceKillDialog`) | No gap |
| Rerun (plan) | ✅ Fully implemented (`RerunDialog`) | No gap |
| Stop (workspace) | ✅ 2-click with reason input | Impact summary could show attempt count |
| Cancel (workspace) | ✅ 2-click with reason input | Impact summary could show attempt count |
| Approve for Execution | ❌ No confirmation | **Add confirmation dialog** with cost/budget preview |
| Approve Self-Modification | ❌ No confirmation | **Add double-confirm** with diff preview |
| Delete Worktree | ❌ No confirmation | **Add confirmation dialog** |
| Clear Completed | ❌ No confirmation | **Add confirmation dialog** |
| Requeue | ❌ No confirmation | **Add confirmation dialog** |
| Reorder | ❌ No confirmation | **Add confirmation dialog** |
| Stop Lead Agent | ❌ No confirmation | **Add confirmation dialog** |

### 8.2 Actions That Are Correct (No Changes Needed)

| Action | Reason |
|--------|--------|
| Pause (plan/workspace) | Safe — reversible |
| Resume (plan) | Safe — reverses pause |
| Retry (workspace) | Safe — only affects failed workspace |
| Send Directive (workspace) | Safe — advisory only |
| Resolve Escalation | Safe — resolves a blocked state (when deps fix is applied) |
| Acknowledge Directive | Safe — acknowledges a constraint |
| Orchestrator Pause/Resume/Scan | Safe — reversible, separate daemon |
| Digest actions (resolve/dismiss/acknowledge) | Safe — lightweight state mutation |
| Request Scan (orchestrator) | Safe — read-only, kicks off analysis |

### 8.3 Critical Bug: Fix `resolve_escalation` Deps Injection (P0)

**Severity: P0 — Action is completely broken**

The `resolve_escalation` route at `POST /api/human/escalations/:escId/resolve` always fails with 422 because `handleExecutionCommand()` receives empty deps `{}`.

**Fix**: In `packages/web-server/src/human-directive-routes.ts`, change the `handleExecutionCommand()` call from:
```typescript
const result = await handleExecutionCommand(
    {
        type: "resolve_escalation",
        planExecutionId,
        workspaceId,
        escalationId,
        chosenOptionId,
        userResponse,
    },
    {},  // empty — broken
);
```
to:
```typescript
const result = await handleExecutionCommand(
    {
        type: "resolve_escalation",
        planExecutionId,
        workspaceId,
        escalationId,
        chosenOptionId,
        userResponse,
    },
    {
        escalationManager: stateStore as { // or a dedicated manager
            resolveEscalation(
                planExecutionId: string,
                workspaceId: string,
                escalationId: string,
                chosenOptionId: string,
                userResponse?: string,
            ): Promise<void>;
        },
    },
);
```

### 8.4 Legacy Paths to Migrate (priority order)

1. **P0: Fix `resolve_escalation` deps injection** (see 8.3) — Action is completely broken
2. **P1: Wire `planControlManager` deps for plan-level ES calls** in `index.ts` — While direct state store calls are the actual mutation path, the ES command handler should receive proper deps for consistency and future migration
3. **P2: `POST /api/executions/:peid/control` (pause/stop/cancel/resume)** -> Replace with per-action endpoints routing through `handleExecutionCommand()` as primary mutation path, with event emission
4. **P2: `POST /api/executions/:peid/control` (force-kill)** -> Keep as-is (intentional ES bypass for last-resort), but add dedicated endpoint for discoverability
5. **P3: Topbar control dispatch** -> Migrate from `App.tsx` direct dispatch to new per-action hooks (`usePlanControl hook`)

### 8.5 Confirmation Dialog Implementation Pattern

For UI implementation, follow the existing `ControlActionsPanel.tsx` pattern:

1. **Safe actions** (Pause, Resume, Retry, Send Directive, Resolve Escalation): Execute immediately on click — no confirmation needed
2. **Dangerous actions** (Stop, Cancel, Requeue, Clear Completed, Delete Worktree, Reorder): Two-click pattern — first click selects action, second click confirms with optional reason. Show impact summary between clicks.
3. **Critical actions** (Force Kill, Self-Modification): Explicit confirmation dialog with typed acknowledgment (e.g., must type "KILL" or "I UNDERSTAND"). Show full impact and consequences.

### 8.6 Quick Reference: Route -> DI Status

```
Route                                          DI Status   Action    Source File
──────────────────────────────────────────────────────────────────────────────
POST /api/human/directive                      ✅ OK       issue     human-directive-routes.ts
POST /api/human/intervene/:peid/:wsId          ✅ OK       intervene human-directive-routes.ts
POST /api/human/escalations/:escId/resolve     🚫 BROKEN  resolve   human-directive-routes.ts
GET  /api/human/directives/:peid/:wsId         N/A        list      human-directive-routes.ts (no ES call)
GET  /api/human/escalations/:peid/:wsId        N/A        list      human-directive-routes.ts (no ES call)

POST /api/executions/:peid/control (stop)      🚫 BROKEN  stop      index.ts (deps={})
POST /api/executions/:peid/control (cancel)    🚫 BROKEN  cancel    index.ts (deps={})
POST /api/executions/:peid/control (resume)    🚫 BROKEN  resume    index.ts (deps={})
POST /api/executions/:peid/control (pause)     N/A        pause     index.ts (no ES call)
POST /api/executions/:peid/control (force-kill) N/A       f-kill    index.ts (no ES call)

POST /api/proposals/:id/action                 N/A        all       proposal-routes.ts (correctly bypasses ES)
POST /api/orchestrator/control                 N/A        all       orchestrator-routes.ts (separate daemon)
POST /api/orchestrator/lead-agent/control      N/A        all       orchestrator-routes.ts (separate daemon)
POST /api/scale/*                              N/A        all       scale-routes.ts (separate domain)
POST /digest/actions/*                         N/A        all       digest-action-routes.ts (separate domain)
```

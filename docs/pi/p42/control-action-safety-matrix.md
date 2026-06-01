# Control Action Safety Matrix

**Date:** 2026-06-01
**Author:** Worker agent (P42.02)
**Goal:** Audit all control actions and map plan/workspace/escalation/proposal actions through execution-service-backed endpoints. Dangerous actions require confirmation with impact summary.
**Source docs:** `proposed_interface_map_v3.md` (section 13), `P42_Dashboard_V3_Execution_Cockpit_Plan_v4_1_1.md`
**Data sources examined:**
- `packages/execution-core/src/commands.ts` — Canonical command types
- `packages/execution-service/src/command-handler.ts` — Command handler facade
- `packages/execution-service/src/execution-service.ts` — Service facade
- `packages/web-server/src/index.ts` — Legacy `POST /api/executions/:planExecId/control` endpoint
- `packages/web-server/src/human-directive-routes.ts` — Workspace/escalation control endpoints
- `packages/web-server/src/proposal-routes.ts` — Proposal action endpoints
- `packages/web-server/src/orchestrator-routes.ts` — Orchestrator control endpoints
- `packages/web-server/src/scale-routes.ts` — Scale/integration queue control endpoints
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
1. Pause bypasses `handleExecutionCommand()` entirely — calls `stateStore.pausePlan()` directly.
2. Resume routes through `handleExecutionCommand({ type: "continue_plan" })` for adoption tracking, but then also calls `stateStore.resumePlan()` directly.
3. Stop and Cancel route through `handleExecutionCommand({ type: "stop_plan" | "rerun_plan" })` for adoption tracking, but primary mutation is still through direct state store calls (`stateStore.stopPlan()`, `stateStore.cancelPlan()`, `stateStore.writeControlRequest()`).
4. `cancel` uses `rerun_plan` command type — this is semantically incorrect; it should use `stop_plan` with cancel reason or a dedicated cancel command.
5. Force Kill bypasses ES entirely — directly:
   - Calls `stateStore.stopPlan()`
   - Calls `stateStore.writeControlRequest()`
   - Kills child processes via `killTrackedDetachedChildren()` and `pkill -KILL`
   - Removes worktrees via `git worktree remove --force` / `rm -rf`
6. Rerun goes through plan-runner's `POST /api/projects/:pid/plans/run` which parses plan content and creates a new execution using `AutonomousExecutor`. The `handleExecutionCommand` adoption tracking for the old execution is called separately.

### 1.2 Workspace-Level Actions

| # | Action | Endpoint | ES Command | Event Emitted | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|------------|---------------|-----------------|----------------------|--------------|
| 7 | Stop | `POST /api/human/intervene/:peid/:wsId` (`action: "stop"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | **Yes** (impact summary) | **DANGEROUS** |
| 8 | Pause | `POST /api/human/intervene/:peid/:wsId` (`action: "pause"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | No | Safe |
| 9 | Cancel | `POST /api/human/intervene/:peid/:wsId` (`action: "cancel"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | **Yes** (impact summary) | **DANGEROUS** |
| 10 | Retry | `POST /api/human/intervene/:peid/:wsId` (`action: "retry"`) | `intervene_workspace` | `human_intervention_requested` | **Yes** ✅ | No | Safe |
| 11 | Issue Directive | `POST /api/human/directive` | `issue_human_directive` | `human_directive_issued` | **Yes** ✅ | No | Safe |

**Note:** Workspace-level actions correctly route through `handleExecutionCommand()` via `human-directive-routes.ts`. This is the model that plan-level actions should follow.

### 1.3 Escalation-Level Actions

| # | Action | Endpoint | ES Command | Event Emitted | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|------------|---------------|-----------------|----------------------|--------------|
| 12 | Resolve | `POST /api/human/escalations/:escId/resolve` | `resolve_escalation` | `lead_agent_escalation_resolved` | **Yes** ✅ | No | Safe |
| 13 | Acknowledge Directive | `POST /api/human/escalations/:escId/ack`¹ | `acknowledge_directive` | `lead_agent_directive_acknowledged` | **Yes** ✅ | No | Safe |

**Note:** The acknowledge endpoint (`/api/human/escalations/:escId/ack`) is specified in V3 but not yet implemented in `human-directive-routes.ts`. Only resolve is currently implemented.

### 1.4 Proposal-Level Actions (Policy / Governance)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 14 | Approve for Planning | `POST /api/proposals/:id/action` (`action: "approve_for_planning"`) | No² | No | Advisory |
| 15 | Approve for Execution | `POST /api/proposals/:id/action` (`action: "approve_for_execution"`) | No² | **Yes**¹ | **DANGEROUS** |
| 16 | Reject | `POST /api/proposals/:id/action` (`action: "reject"`) | No² | No | Advisory |
| 17 | Request Changes | `POST /api/proposals/:id/action` (`action: "request_changes"`) | No² | No | Advisory |
| 18 | Approve Self-Modification | `POST /api/proposals/:id/action` (`action: "approve_self_modification"`) | No² | **Yes** (double confirm) | **CRITICAL** |

**Footnotes:**
1. Approve for Execution should require confirmation because it enables resource consumption (tokens, compute).
2. Proposal actions modify `.pi/proposals/index.json` directly via file writes. They do not go through execution-service because proposals are a different domain (policy/intelligence vs execution). This is architecturally correct — proposal actions are policy decisions, not execution commands.

### 1.5 Orchestrator-Level Actions (Separate System)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 19 | Pause | `POST /api/orchestrator/control` (`action: "pause"`) | N/A¹ | No | Safe |
| 20 | Resume | `POST /api/orchestrator/control` (`action: "resume"`) | N/A¹ | No | Safe |
| 21 | Request Scan | `POST /api/orchestrator/control` (`action: "request_scan"`) | N/A¹ | No | Safe |
| 22 | Lead Agent Pause | `POST /api/orchestrator/lead-agent/control` (`action: "pause"`) | N/A¹ | No | Safe |
| 23 | Lead Agent Resume | `POST /api/orchestrator/lead-agent/control` (`action: "resume"`) | N/A¹ | No | Safe |
| 24 | Lead Agent Stop | `POST /api/orchestrator/lead-agent/control` (`action: "stop"`) | N/A¹ | **Yes**¹ | **DANGEROUS** |

**Footnote:**
1. Orchestrator is a separate daemon process. Control actions write to a control file that the orchestrator daemon reads asynchronously. This is architecturally correct per P11.N AC2 ("dashboard requests do not directly mutate orchestrator state"). However, stopping lead agent analysis mid-flight could lose partial analysis results.

### 1.6 Scale / Integration Queue Actions (Separate System)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 25 | Worktree Cleanup | `POST /api/scale/worktrees/cleanup` | N/A¹ | No | Safe |
| 26 | Delete Worktree | `DELETE /api/scale/worktrees/:name` | N/A¹ | **Yes**¹ | **DANGEROUS** |
| 27 | Queue Pause | `POST /api/scale/integration-queue/pause` | N/A¹ | No | Safe |
| 28 | Queue Resume | `POST /api/scale/integration-queue/resume` | N/A¹ | No | Safe |
| 29 | Queue Retry | `POST /api/scale/integration-queue/retry/:wsId` | N/A¹ | No | Safe |
| 30 | Queue Requeue | `POST /api/scale/integration-queue/requeue/:wsId` | N/A¹ | **Yes**¹ | **DANGEROUS** |
| 31 | Clear Completed | `POST /api/scale/integration-queue/clear-completed` | N/A¹ | **Yes**¹ | **DANGEROUS** |
| 32 | Queue Reorder | `POST /api/scale/integration-queue/reorder` | N/A¹ | **Yes**¹ | **DANGEROUS** |

**Footnote:**
1. Scale/integration queue is a separate domain from plan execution. These actions modify the queue state file (`.pi/integration-queue.json`) directly. They do not go through execution-service, which is correct. However, destructive actions (delete worktree, requeue, clear completed, reorder) should have confirmation dialogs in the UI.

### 1.7 Digest / Brain Actions (Read-Only Signals)

| # | Action | Endpoint | Goes Through ES? | Confirmation Required? | Danger Level |
|---|--------|----------|-----------------|----------------------|--------------|
| 33 | Resolve Signal | `POST /digest/actions/signal/:signalId/resolve` | N/A¹ | No | Safe |
| 34 | Dismiss Observation | `POST /digest/actions/observation/:observationId/dismiss` | N/A¹ | No | Safe |
| 35 | Acknowledge Proposal | `POST /digest/actions/proposal/:proposalId/acknowledge` | N/A¹ | No | Safe |

**Footnote:**
1. Digest actions are lightweight state mutations on brain signal/observation/proposal records. They are architecturally separate from execution control.

---

## 2. Execution-Service Coverage Analysis

### 2.1 Commands Routed Through `handleExecutionCommand()`

| ExecutionCommand Type | Routes Through ES? | Backend Implementation | Danger Level |
|-----------------------|-------------------|----------------------|--------------|
| `start_plan` | ✅ Yes (stub) | `command-handler.ts` returns accepted, no real execution | Safe |
| `stop_plan` | ✅ Yes | Mapped via legacy endpoint + adoption tracking | **DANGEROUS** |
| `continue_plan` | ✅ Yes | Mapped via legacy endpoint + adoption tracking | Safe |
| `rerun_plan` | ✅ Yes | Mapped via legacy endpoint + adoption tracking | **DANGEROUS** |
| `retry_workspace` | ✅ Yes | Mapped via `transitionRouter.transitionWorkspace()` | Safe |
| `request_user_escalation` | ✅ Yes (stub) | Returns accepted, no real execution | Safe |
| `approve_proposal` | ✅ Yes (stub) | Returns accepted, no real execution | Advisory |
| `acknowledge_directive` | ✅ Yes | Mapped via `directiveManager.acknowledgeDirective()` | Safe |
| `resolve_escalation` | ✅ Yes | Mapped via `escalationManager.resolveEscalation()` | Safe |
| `issue_human_directive` | ✅ Yes | Mapped via `planControlManager.writeControlRequest()` | Safe |
| `intervene_workspace` | ✅ Yes | Mapped via `planControlManager.writeControlRequest()` | Varies by action |

### 2.2 Legacy Direct Control Paths (Not Going Through ES)

These paths bypass `handleExecutionCommand()` entirely and should be migrated or marked as legacy:

1. **`POST /api/executions/:peid/control` (all actions)** — The primary legacy path. While some actions call `handleExecutionCommand()` for adoption tracking, the real mutation goes through `stateStore` directly. This endpoint should be:
   - Replaced by per-action endpoints (`POST /api/execution/:eid/control/pause`, `POST /api/execution/:eid/control/stop`, etc.)
   - Or deprecated in favor of the new dedicated endpoints, with the legacy endpoint kept as a compat shim

2. **`POST /api/executions/:peid/control` (force-kill)** — Fully bypasses ES. Directly terminates child processes, removes worktrees, and mutates state store. This is intentionally outside ES because force-kill is a last-resort operation that the normal execution flow cannot handle.

3. **`POST /api/proposals/:id/action`** — While architecturally correct to bypass ES (proposals are policy, not execution), the proposal action endpoint writes directly to `.pi/proposals/index.json`. This is acceptable because proposals are read-model-only from the execution perspective.

4. **`POST /api/orchestrator/control` and `/api/orchestrator/lead-agent/control`** — These correctly bypass ES because the orchestrator is a separate daemon. Control is done via file-based signaling.

5. **`POST /api/scale/*`** — Correctly bypass ES because scale/integration queue is a separate domain.

### 2.3 UI Mutation Paths

| UI Component | Action | Backend Route | Goes Through ES? | Confirmation? |
|-------------|--------|---------------|-----------------|---------------|
| `ControlActionsPanel` | Workspace stop/pause/cancel/retry | `POST /api/human/intervene/:peid/:wsId` | **Yes** ✅ | Built-in (2-click pattern) |
| `HumanDirectivePanel` | Issue directive | `POST /api/human/directive` | **Yes** ✅ | No |
| Topbar (App.tsx) | Plan pause/stop/cancel/resume/rerun/force-kill | `POST /api/executions/:peid/control` | Partial | Partial (ForceKillDialog, RerunDialog) |
| `usePlanRunner` | Validate/run plan | `POST /api/projects/:pid/plans/validate`, `POST /api/projects/:pid/plans/run` | Partial (run routes through AutonomousExecutor) | No (validation is pre-check) |

---

## 3. Confirmation Dialog Specifications

### 3.1 Confirmation Requirements by Danger Level

| Danger Level | Confirmation Type | Example Actions |
|-------------|-------------------|-----------------|
| **Safe** | No confirmation needed | Pause, Resume, Retry, Send Directive, Resolve Escalation |
| **DANGEROUS** | Single confirmation with impact summary | Stop (plan/workspace), Cancel (plan/workspace), Rerun |
| **CRITICAL** | Double confirmation with explicit acknowledgment | Force Kill, Approve Self-Modification |

### 3.2 Confirmation Dialog Content Per Action

| Action | Impact Summary | Special Behavior |
|--------|---------------|-----------------|
| Stop (plan) | "This will stop the plan. {N} active workspace(s) will be stopped. Partial results from each workspace will be preserved." | Reason input (optional) |
| Cancel (plan) | "This will cancel the plan. {N} workspace(s) ({M} completed, {P} pending) will be cancelled. Completed workspace results will be preserved. Pending workspaces will not run." | Reason input (optional) |
| Stop (workspace) | "This will stop workspace {workspaceId}. Partial results from attempt {N} will be preserved." | Reason input (optional) |
| Cancel (workspace) | "This will cancel workspace {workspaceId}. No results from attempt {N} will be saved. The workspace will be marked as cancelled." | Reason input (optional) |
| Rerun (plan) | "This will create a new execution of the same plan. The current execution ({execId}) will be cancelled. All current workspace results will be preserved in the history." | Plan name preview |
| Force Kill (plan) | "WARNING: This will forcefully terminate all active processes for this plan. Partial results will be LOST. Worktrees will be DELETED. This action CANNOT be undone." | Must type "KILL" to confirm |
| Approve Execution (proposal) | "Approving this proposal for execution will consume compute resources (tokens, API calls, compute time). Estimated cost: {N} tokens." | Budget preview |
| Approve Self-Modification (proposal) | "This proposal contains self-modification actions that will change agent/project configuration. Review the self-modification impact before approving." | Self-modification diff preview |
| Delete Worktree (scale) | "This will delete worktree {name}. Uncommitted changes in the worktree will be LOST." | — |
| Requeue (scale) | "This will requeue workspace {wsId} from '{currentStatus}' status. Ensure no worker is actively processing this workspace." | — |
| Clear Completed (scale) | "This will remove all completed, failed, and conflict entries from the integration queue. This action CANNOT be undone." | — |
| Reorder (scale) | "Reordering queued entries may break dependency chains. Ensure the new order respects batch dependencies." | — |
| Stop Lead Agent (orchestrator) | "Stopping lead agent analysis mid-flight will lose partial analysis results. Analysis will need to be restarted from scratch." | — |

### 3.3 Current Confirmation Implementation Status

| Action | Confirmation Implemented? | Location | Notes |
|--------|--------------------------|----------|-------|
| Stop (plan) | Partial | `App.tsx` — `handleControl()` includes confirm via `controlDisabled` logic | No impact summary; just browser `confirm()` |
| Cancel (plan) | Partial | `App.tsx` — `handleControl()` includes confirm | No impact summary |
| Force Kill (plan) | ✅ Yes | `ForceKillDialog.tsx` | Has double-confirm with "KILL" text entry |
| Rerun (plan) | ✅ Yes | `RerunDialog.tsx` | Has plan name preview |
| Stop (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern (select action → confirm) | Has optional reason input |
| Pause (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern as stop |
| Cancel (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern as stop |
| Retry (workspace) | ✅ Yes | `ControlActionsPanel.tsx` — 2-click pattern | Same pattern, no confirmation needed but uses same UX |
| Send Directive | ❌ No | `HumanDirectivePanel.tsx` — sends immediately | No confirmation needed (safe action) |
| Resolve Escalation | ❌ No | `human-directive-routes.ts` — resolves immediately | No confirmation needed (safe action) |
| Acknowledge Directive | ❌ Not implemented | Not wired in UI | Not yet needed |
| Approve for Execution | ❌ No | `proposal-routes.ts` — action applies immediately | No confirmation dialog in UI |
| Approve Self-Modification | ❌ No | `proposal-routes.ts` — action applies immediately | No double-confirm |
| Delete Worktree | ❌ No | `scale-routes.ts` — deletes immediately | No confirmation in UI |
| Requeue | ❌ No | `scale-routes.ts` — requeues immediately | No confirmation in UI |
| Clear Completed | ❌ No | `scale-routes.ts` — clears immediately | No confirmation in UI |
| Reorder | ❌ No | `scale-routes.ts` — reorders immediately | No confirmation in UI |
| Stop Lead Agent | ❌ No | `orchestrator-routes.ts` — stops immediately | No confirmation in UI |

---

## 4. Migration Recommendations

### 4.1 Priority Actions (Critical Safety Gaps)

1. **Stop/Cancel (plan) — Add impact summaries**: Current `confirm()` dialogs lack workspace count, active workspace list, and partial results info. Replace with `Modal.tsx` confirmation variant.

2. **Force Kill — No changes needed**: `ForceKillDialog.tsx` already has proper double-confirm pattern.

3. **Stop/Cancel (workspace) — Already implemented**: `ControlActionsPanel.tsx` has correct 2-click pattern with reason input. Impact summary could be improved with workspace attempt count.

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
- Route through `handleExecutionCommand()` as the primary mutation path
- Accept an optional `reason` field
- Return `CommandHandlerResult` structure (`{accepted, message, error}`)
- Log the action through the command log stream

### 4.3 Actions That Correctly Bypass ES (Keep As-Is)

These actions serve different domains and should **not** be migrated through ES:

- **Proposal actions** (`POST /api/proposals/:id/action`) — Policy/governance domain
- **Orchestrator controls** (`POST /api/orchestrator/control`, `/lead-agent/control`) — Separate daemon
- **Scale/queue actions** (`POST /api/scale/*`) — Integration queue domain
- **Digest actions** (`POST /digest/actions/*`) — Brain signal domain

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
                    ┌─────────────────────────────────────────────┐
                    │         CONTROL ACTION CONFIRMATION         │
                    └─────────────────────────────────────────────┘

  idle ──── user clicks dangerous action ──────> showingConfirm
   ↑                                                  │
   │                                                  ▼
   │                                          user reviews impact
   │                                                  │
   │                                         ┌────────┼────────┐
   │                                         │        │        │
   │                                      confirm   cancel  editReason
   │                                         │        │        │
   │                                         ▼        │        │
   │                                    executing     │        │
   │                                         │        │        │
   │                                   ┌─────┼─────┐  │        │
   │                                   │     │     │  │        │
   │                                success error timeout │      │
   │                                   │     │     │  │        │
   │                                   └─────┼─────┘  │        │
   │                                         │        │        │
   └─────────────────────────────────────────┘────────┘────────┘

Confirmation dialog content per action:
  Stop:    "This will stop {workspaceId}. Partial results from
            attempt {N} will be preserved."
  Cancel:  "This will cancel {workspaceId}. No results will be
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

// Rejected (422):
{ success: false, error: "No plan control manager configured" }

// Server error (500):
{ success: false, error: "Failed to issue human directive", message: "..." }
```

### 6.3 Response Consistency Gap

All endpoints return `{ success: boolean, error?: string }` but:

- Legacy endpoint: Returns `{ success: true }` without `message` on success
- Workspace endpoint: Returns `{ success: true, message: "..." }` on success
- Proposal endpoint: Returns `{ success: true, proposal: {...} }` on success (different shape)

**Recommendation**: Standardize all control action responses to:
```typescript
{
  success: boolean;
  message?: string;      // Human-readable success message
  error?: string;        // Machine-readable error code
  details?: string;      // Detailed error message (for 500s)
}
```

---

## 7. Summary

### 7.1 Actions Requiring Confirmation (Must-Have)

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

### 7.2 Actions That Are Correct (No Changes Needed)

| Action | Reason |
|--------|--------|
| Pause (plan/workspace) | Safe — reversible |
| Resume (plan) | Safe — reverses pause |
| Retry (workspace) | Safe — only affects failed workspace |
| Send Directive (workspace) | Safe — advisory only |
| Resolve Escalation | Safe — resolves a blocked state |
| Acknowledge Directive | Safe — acknowledges a constraint |
| Orchestrator Pause/Resume/Scan | Safe — reversible |
| Digest actions (resolve/dismiss/acknowledge) | Safe — lightweight state mutation |

### 7.3 Legacy Paths to Migrate (priority order)

1. **`POST /api/executions/:peid/control` (pause/stop/cancel/resume)** → Replace with per-action endpoints routing through `handleExecutionCommand()` as primary mutation path
2. **`POST /api/executions/:peid/control` (force-kill)** → Keep as-is (intentional ES bypass for last-resort), but add dedicated endpoint
3. **Topbar control dispatch** → Migrate from `App.tsx` direct dispatch to new per-action hooks (`useControlActions` hook)

### 7.4 Confirmation Dialog Implementation Pattern

For UI implementation, follow the existing `ControlActionsPanel.tsx` pattern:

1. **Safe actions** (Pause, Resume, Retry, Send Directive): Execute immediately on click
2. **Dangerous actions** (Stop, Cancel): Two-click pattern — first click selects action, second click confirms with optional reason
3. **Critical actions** (Force Kill, Self-Modification): Explicit confirmation dialog with typed acknowledgment (e.g., type "KILL")

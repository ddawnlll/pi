# P41.00 — Visibility Baseline Audit

**Date:** 2026-06-01  
**Phase:** P41  
**Workspace:** P41.00  
**Goal:** Audit current logs, transcripts, event streams, dashboard APIs, worker context visibility, and missing control paths.

---

## Table of Contents

1. [Methodology](#1-methodology)
2. [Existing Event/Log/Transcript Artifacts](#2-existing-eventlogtranscript-artifacts)
3. [Current Dashboard API Endpoints](#3-current-dashboard-api-endpoints)
4. [File Visibility](#4-file-visibility)
5. [Command History Visibility](#5-command-history-visibility)
6. [Lead Agent Visibility](#6-lead-agent-visibility)
7. [Control Actions](#7-control-actions)
8. [Gap Analysis](#8-gap-analysis)
9. [E2E Visibility Gaps](#9-e2e-visibility-gaps)
10. [Appendix: Artifact File Mapping](#10-appendix-artifact-file-mapping)

---

## 1. Methodology

The audit was conducted by reading the source code of the following packages:

- `packages/execution-core/src/` — Canonical contracts (events, read model, commands, types)
- `packages/execution-service/src/` — Query and command handlers
- `packages/worker-adapters/src/` — Worker adapter implementations
- `packages/web-server/src/` — REST API endpoints (index.ts, log-stream-routes, file-explorer-routes, artifact-routes, activity-timeline-routes, orchestrator-routes, scale-routes, proposal-routes, etc.)
- `packages/coding-agent/src/core/execution-gauntlet/` — Combined summary, live monitor
- `packages/brain/src/` — Brain execution read client

No runtime execution was performed; this is a static code audit of visibility contracts, implementations, and exposed APIs.

---

## 2. Existing Event/Log/Transcript Artifacts

### 2.1 Execution Archive (`.pi/executions/{planExecId}/`)

Defined in `packages/web-server/src/execution-archive.ts`.

**Plan-level artifacts:**

| Artifact | Format | Status | Description |
|---|---|---|---|
| `original-plan.md` | Markdown | Written at plan start | Raw plan content |
| `parsed-contract.json` | JSON | Written at plan start | Workspace queue from parsed plan |
| `doctor-report.json` | JSON | Written at plan start | Safety doctor report |
| `dry-run-report.json` | JSON | Written when available | Dry-run simulation report |
| `workspace-dag.json` | JSON | Written at plan start | Dependency graph |
| `safety-policy.json` | JSON | Written at plan start | Safety profile snapshot |
| `commits.json` | JSON | Written at plan end | Commit log |

**Workspace-level artifacts:**

| Artifact | Format | Status | Description |
|---|---|---|---|
| `packet.md` | Markdown | Written | Worker context/briefing |
| `raw.log` | Plain text | Appended during execution | Raw log lines |
| `structured.ndjson` | NDJSON | Appended | JSON log entries with categories |
| `tool-calls.ndjson` | NDJSON | Appended | Tool call events |
| `events.ndjson` | NDJSON | Appended | Workspace events |
| `decisions.ndjson` | NDJSON | Appended | Decision entries |
| `narrative.ndjson` | NDJSON | Appended | Human-readable summaries |
| `audit.ndjson` | NDJSON | Appended | Audit/operational events |
| `files-touched.json` | JSON | Written at workspace end | File change list |
| `test-results/` | Directory | Created | Test result files |
| `reviewer-verdict.md` | Markdown | Written at workspace end | Verdict summary |
| `diff.patch` | Patch | Written when available | Unified diff of changes |

**Current state:** All archive write functions exist but are passive — external code must call them. There is no automatic event emission from the execution kernel into the archive. The workspace agent executor writes to these files through intermediaries.

### 2.2 Live Monitor (Gauntlet Only)

Defined in `packages/coding-agent/src/core/execution-gauntlet/live-monitor.ts`.

| Artifact | Format | Status |
|---|---|---|
| `event-stream.ndjson` | NDJSON | Written during gauntlet runs only |
| `state-snapshots.ndjson` | NDJSON | Written during gauntlet runs only |
| `scheduler-decisions.ndjson` | NDJSON | Written during gauntlet runs only |
| `live-monitor.log` | Plain text | Written during gauntlet runs only |

**Events emitted by LiveMonitor (gauntlet only):**
- `heartbeat` — Periodic state pulse
- `plan_start`, `plan_end` — Plan lifecycle
- `workspace_error` — Error with completion gate block reasons + last command
- `iteration_start`, `iteration_end` — Monte Carlo iteration lifecycle
- `suite_start`, `suite_end` — Suite lifecycle

**Limitation:** The LiveMonitor is only active during gauntlet test runs (`make test-full`). It is NOT integrated into real plan execution through `plan-runner.ts`.

### 2.3 Execution-Core Events

Defined in `packages/execution-core/src/events.ts`.

Only a single type is currently defined:
- `WorkspaceExecutionStage` — enum: `Pending`, `Running`, `Complete`, `Failed`, `Blocked`, `Cancelled`, `Skipped`, `Paused`, `TimedOut`

**No canonical event types exist yet** for plan events, worker events, command/terminal events, file visibility events, completion gate events, lead agent events, or human intervention events. These are planned for **P41.01**.

### 2.4 Worker Events (WorkerAdapter)

Defined in `packages/execution-core/src/worker-adapter.ts`.

The `WorkerRunResult` interface includes:
- `events: WorkerEvent[]` — Array of `{ type, payload, timestamp }` events
- `commandHistory: WorkerCommandHistoryEntry[]` — Array of `{ command, cwd, exitCode, startedAt, finishedAt, outputSummary }`
- `changedFiles: string[]` — Array of file paths

**Current implementation** (`LocalPiWorkerAdapter` in `packages/worker-adapters/src/local-pi-worker-adapter.ts`): All three fields are returned as **empty arrays**. No events, no command history, and no changed files are captured from the actual worker execution.

---

## 3. Current Dashboard API Endpoints

### 3.1 Plan & Workspace Lifecycle

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/projects` | Exists | List projects |
| POST | `/api/projects` | Exists | Create project |
| GET | `/api/projects/:projectId/plans` | Exists | List plan executions |
| GET | `/api/projects/:projectId/plans/:planExecId` | Exists | Plan execution detail |
| GET | `/api/projects/:projectId/plans/:planExecId/events` | Exists | SSE: plan events |
| POST | `/api/projects/:projectId/plans/run` | Exists | Upload and run plan |
| POST | `/api/projects/:projectId/plans/:planExecId/rerun` | Exists | Rerun failed/stopped plan |
| POST | `/api/projects/:projectId/plans/validate` | Exists | Validate plan content |
| PATCH | `/api/projects/:projectId/plans/preview` | Exists | Apply dep patches |
| GET | `/api/projects/:projectId/active` | Exists | Get active execution info |

### 3.2 Logs & Transcripts

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/log-stream/:planExecId/:workspaceId/recent` | Exists | REST: recent workspace logs |
| GET | `/api/log-stream/:planExecId/:workspaceId/live` | Exists | SSE: live log streaming |
| GET | `/api/logs/v2/:planExecId/:workspaceId/:stream` | Exists | SSE: legacy log v2 (raw/structured/narrative/audit/decision) |
| GET | `/api/logs/:workspaceId/:attempt/:stream` | Exists | SSE: legacy log endpoint |
| GET | `/api/transcript/:planExecId/:workspaceId` | Exists | SSE: worker transcript events |
| GET | `/api/plan-state` | Exists | Legacy: poll plan state |
| GET | `/api/events` | Exists | Legacy: SSE execution journal |

### 3.3 Worktree / File Explorer

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/projects/:projectId/plans/:planExecId/worktrees` | Exists | List worktrees |
| GET | `/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files` | Exists | List worktree files |
| GET | `/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/*` | Exists | Read worktree file |
| GET | `/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff` | Exists | Git diff for worktree |

### 3.4 Artifacts

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/artifacts/:planExecId` | Exists | List execution artifacts |
| GET | `/api/artifacts/:planExecId/*` | Exists | Read artifact content |

### 3.5 Activity & Performance

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/activity-timeline` | Exists | Recent activity feed |
| GET | `/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/performance` | Exists | Workspace performance metrics |
| GET | `/api/projects/:projectId/plans/:planExecId/performance` | Exists | Plan-level aggregated performance |

### 3.6 Orchestrator / Brain

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/orchestrator/health` | Exists | Orchestrator health snapshot |
| GET | `/api/orchestrator/health/stream` | Exists | SSE: health updates |
| GET | `/api/orchestrator/proposals` | Exists | Orchestrator proposals |
| POST | `/api/orchestrator/control` | Exists | Pause/resume/request-scan |
| POST | `/api/orchestrator/run-lead-agent` | Exists | Trigger lead agent |
| GET | `/api/orchestrator/lead-agent/stream` | Exists | SSE: lead agent transcript |
| POST | `/api/orchestrator/lead-agent/control` | Exists | Pause/resume/stop lead agent |

### 3.7 Queue

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/projects/:projectId/queue` | Exists | Plan queue |
| POST | `/api/projects/:projectId/queue/enqueue` | Exists | Add to queue |
| POST | `/api/projects/:projectId/queue/reorder` | Exists | Reorder queue |
| POST | `/api/projects/:projectId/queue/pause` | Exists | Pause queue |
| POST | `/api/projects/:projectId/queue/resume` | Exists | Resume queue |
| POST | `/api/projects/:projectId/queue/stop-after-current` | Exists | Stop after current |

### 3.8 Control / Tasks

| Method | Path | Status | Description |
|---|---|---|---|
| POST | `/api/control` | Exists | Legacy: pause/stop/cancel/resume via control file |
| POST | `/api/projects/:projectId/tasks/:taskId/pause` | Exists | Pause task |
| POST | `/api/projects/:projectId/tasks/:taskId/resume` | Exists | Resume task |

### 3.9 Scale

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/scale/integration-queue` | Exists | Integration queue status |
| POST | `/api/scale/integration-queue/retry/:workspaceId` | Exists | Retry entry |
| POST | `/api/scale/integration-queue/requeue/:workspaceId` | Exists | Requeue merged entry |

---

## 4. File Visibility

### 4.1 What Exists

1. **Worktree File Explorer** — Full tree listing, file reading, and git diff for worktree-based workspaces (`file-explorer-routes.ts`). Only available when `worktreeRequired: true`.
2. **files-touched.json** — Written to workspace archive at end of execution, lists paths and change types (created/modified/deleted).
3. **diff.patch** — Unified diff written to archive when available.
4. **Git diff in main index.ts** — `getGitDiff()` and `getGitDiffPatches()` functions exist in the web server but are only used internally for plan summaries, not exposed as dedicated endpoints for arbitrary workspaces.

### 4.2 Gaps

- **No file tree visibility for non-worktree execution** — The file explorer only serves worktree directories. Main workspace file changes have no live browsing API.
- **No live file change streaming** — No SSE endpoint for real-time file change notifications.
- **No per-workspace diff API outside worktrees** — The `getGitDiffPatches` function exists but is not exposed as an API endpoint for arbitrary workspaces.
- **ChangedFiles from WorkerAdapter is always empty** — The `changedFiles` field in `WorkerRunResult` is never populated by the `LocalPiWorkerAdapter`.

---

## 5. Command History Visibility

### 5.1 What Exists

- **`CommandHistoryView` interface** — Defined in `execution-core/src/read-model.ts` with fields: `command`, `cwd`, `exitCode`, `startedAt`, `finishedAt`, `outputSummary`, `isTargetCommand`.
- **`getCommandHistory()` in read model** — Interface method exists.
- **`WorkerCommandHistoryEntry`** — Defined in `worker-adapter.ts` with similar fields.
- **Log files capture commands** — `raw.log` and `structured.ndjson` capture some command output.

### 5.2 Gaps

- **`getCommandHistory()` returns empty array** — The `ExecutionReadModel` implementation in `query-handler.ts` stubs `getCommandHistory()` to always return `[]`.
- **WorkerAdapter returns empty commandHistory** — `LocalPiWorkerAdapter` returns an empty array for `commandHistory` in its result.
- **No command history API endpoint** — No REST endpoint exposes command history for a workspace or plan.
- **No completion gate command evidence visible via API** — Even though `CompletionGate` uses command history internally, it is not surfaced through any API.
- **Combined summary has `completionGate.commandHistoryRecorded` flag** but there is no runtime API to query it.

---

## 6. Lead Agent Visibility

### 6.1 What Exists

- **`LeadDirectiveView` interface** — Defined in `execution-core/src/read-model.ts` with fields: `workspaceId`, `directiveType`, `allowedActions`, `retryBudget`, `escalationOption`.
- **`getLeadDirectives()` in read model** — Interface method exists.
- **`getFinalValidationStatus()` in read model** — Interface method exists.
- **Combined summary has `leadAgent` section** — Tracks `directivesCreated`, `escalationsCreated`, `classifications`.
- **Proposal routes** — `GET /api/orchestrator/proposals` lists proposals, `POST /api/orchestrator/run-lead-agent` triggers lead agent analysis.
- **Orchestrator lead agent SSE** — `GET /api/orchestrator/lead-agent/stream` streams lead agent thinking transcript.

### 6.2 Gaps

- **`getLeadDirectives()` returns empty array** — The `ExecutionReadModel` implementation stubs both `getLeadDirectives()` and `getCommandHistory()` to return `[]`.
- **No lead directive API endpoint** — No REST endpoint returns current lead directives for a workspace or plan.
- **No escalation visibility endpoint** — No dedicated endpoint for viewing escalations per workspace.
- **No combined lead agent detail view** — No API exists to see the lead agent's diagnosis, directive, retry budget, and escalation status for a specific workspace in a single call.
- **Proposal/Occhestrator routes are separate from workspace detail** — Proposals and lead agent data aren't integrated into the workspace detail API response.

---

## 7. Control Actions

### 7.1 What Exists

**Legacy control:**
- `POST /api/control` — Writes a `plan-control.json` file with action (pause/stop/cancel/resume).
- Queue pause/resume/stop-after-current endpoints.
- Task pause/resume endpoints.

**Execution-service commands (defined in `commands.ts`):**
- `start_plan` — Start plan
- `stop_plan` — Stop with optional reason
- `continue_plan` — Continue/resume
- `rerun_plan` — Rerun (cancel + restart)
- `retry_workspace` — Retry a workspace
- `request_user_escalation` — Request user intervention
- `approve_proposal` — Approve a brain proposal

**Execution command handler** (`command-handler.ts`) implements: `start_plan`, `stop_plan`, `continue_plan`, `rerun_plan`, `retry_workspace`, `request_user_escalation`, `approve_proposal`.

### 7.2 Gaps

- **Web server does NOT use execution-service for control** — The web server's `POST /api/control` endpoint writes a legacy control file instead of calling `handleExecutionCommand()` or `executionService.executeCommand()`.
- **No stop/continue/retry API endpoints using execution-service** — There are no dedicated REST endpoints for stopping, continuing, or retrying workspaces through the execution-service facade.
- **`POST /api/projects/:projectId/plans/:planExecId/rerun` exists** but only for whole-plan rerun, not per workspace retry.
- **No human directive API endpoint** — No REST endpoint accepts human directives (text instructions) and forwards them into running execution.
- **No pause/resume for individual workspaces** — Only plan-level pause/resume is supported.
- **No cancel-workspace endpoint** — No way to cancel a specific running workspace.
- **No validation-rerun endpoint** — No way to request re-running validation for a completed workspace.

---

## 8. Gap Analysis

### 8.1 Visibility Paths Missing

| Visibility Path | Current State | P41 Target |
|---|---|---|
| **Event spine / canonical event types** | Only `WorkspaceExecutionStage` enum exists | Full event schema (P41.01) |
| **Event store / streaming** | Events written to ndjson files; no runtime event bus | Event spine with SSE consumers |
| **Live worker state** | No API to list/query currently running workers | Worker list with state, heartbeat, elapsed time |
| **Worker transcript path** | Archive path known internally; no API to query transcript path per workspace | Transcript path in workspace detail |
| **Live command output** | Polling-based log streaming exists (log-stream-routes) | Real-time SSE command stream |
| **Worker context inspector** | Packet.md written to archive; no API to retrieve it | Context packet available via API |
| **File tree (non-worktree)** | Only worktree-based file explorer exists | File tree for all execution modes |
| **File diff (non-worktree)** | Git diff functions exist but not exposed as API | Diff endpoint for any workspace |
| **File change events** | No live file change event stream | SSE file change notifications |
| **Completion gate block reasons** | Stored in state but not exposed via API | Block reasons in workspace detail |
| **Command evidence** | Used internally by CompletionGate; not exposed | Visible via API with evidence |
| **Lead agent diagnosis** | Stored internally; not exposed per workspace | Diagnosis visible in workspace detail |
| **Escalation status** | Combined summary tracks count; no detail | Escalation detail visible |
| **Final validation status** | Interface exists; no dashboard endpoint | Visible via API |
| **Combined summary visibility section** | Does not exist | Added with truth tracking |
| **Plan-level parallelism timeline** | Written to combined-summary.json | Visible in real-time dashboard |

### 8.2 Dashboard Endpoint Gaps

| Missing Endpoint | Why Needed | Priority |
|---|---|---|
| `GET /api/workers/:planExecId` | List active workers for a plan | High |
| `GET /api/workers/:planExecId/:workspaceId/status` | Detailed worker state | High |
| `GET /api/command-history/:planExecId/:workspaceId` | Command history detail | High |
| `GET /api/lead-directives/:planExecId/:workspaceId` | Lead agent directives | High |
| `GET /api/escalations/:planExecId` | Escalation list | Medium |
| `GET /api/workspace-context/:planExecId/:workspaceId` | Worker context packet | Medium |
| `GET /api/file-tree/:planExecId/:workspaceId` | File tree for any workspace | Medium |
| `GET /api/file-diff/:planExecId/:workspaceId` | Diff for any workspace | Medium |
| `GET /api/completion-gate/:planExecId/:workspaceId` | Completion gate block reasons | High |
| `GET /api/combined-summary/:planExecId` | Combined summary for plan | Medium |
| `GET /api/validation-status/:planExecId/:workspaceId` | Final validation status | Medium |

### 8.3 Control Action Gaps

| Missing Control Action | Why Needed | Priority |
|---|---|---|
| `POST /api/control/stop-plan` | Stop via execution-service | High |
| `POST /api/control/continue-plan` | Continue via execution-service | High |
| `POST /api/control/retry-workspace` | Retry single workspace | High |
| `POST /api/control/cancel-workspace` | Cancel running workspace | High |
| `POST /api/control/human-directive` | Send human directive | High |
| `POST /api/control/rerun-validation` | Rerun validation for workspace | Medium |
| `POST /api/control/pause-workspace` | Pause individual workspace | Medium |
| `POST /api/control/resume-workspace` | Resume individual workspace | Medium |

### 8.4 Event Schema Gaps

Comparing the P41 canonical event types (from P41 plan doc) against current state:

| Event Category | Current State | Missing Count |
|---|---|---|
| Plan events (7 types) | No canonical types | 7 |
| Workspace events (9 types) | `WorkspaceExecutionStage` enum only | 8 |
| Worker events (8 types) | `WorkerEvent` interface exists, never emitted | 8 |
| Command/terminal events (6 types) | None | 6 |
| File visibility events (8 types) | None | 8 |
| CompletionGate events (7 types) | None | 7 |
| Lead Agent events (6 types) | None | 6 |
| Human intervention events (8 types) | None | 8 |

**Total: 58 canonical event types are planned; 0 are currently defined as canonical, typed events.**

---

## 9. E2E Visibility Gaps

The P41 plan defines 8 E2E visibility scenarios (V1-V8). Current readiness:

| Scenario | Current State | Gap |
|---|---|---|
| **V1 — live_log_stream** | `log-stream-routes.ts` exists with REST + SSE, cursor support | No canonical `command_started/command_stdout/command_stderr` events emitted from execution runtime |
| **V2 — worker_transcript_capture** | Transcript written to archive (`packet.md`, `narrative.ndjson`), `GET /api/transcript` exists | No `worker_transcript_written` event; transcript path not exposed in workspace detail API |
| **V3 — file_tree_visibility** | Worktree file explorer exists | No file tree for non-worktree workspaces; no file tree in main workspace |
| **V4 — file_diff_visibility** | Worktree diff endpoint exists, `diff.patch` archived | No diff API for non-worktree; diff metadata not in workspace detail |
| **V5 — lead_directive_visibility** | Combined summary tracks counts, proposal routes exist | No per-workspace lead directive API |
| **V6 — human_directive_flow** | No endpoint or event for human directives | Entirely missing |
| **V7 — control_actions_visibility** | Legacy control file works; execution-service commands exist | No control action events emitted; no events for pause/resume/stop/retry |
| **V8 — completion_gate_visibility** | Completion gate internally tracks blocks | No `completion_gate_blocked` event; no API to query block reasons |

**Combined summary `visibility` section:** Does not exist. No tracking of `eventStreamWritten`, `stateSnapshotsWritten`, `liveMonitorWritten`, `transcriptsWritten`, `commandHistoryRecorded`, `humanDirectiveVisible`, `completionGateVisible`, etc.

---

## 10. Appendix: Artifact File Mapping

### 10.1 Archive File Locations

| Scope | Path Pattern |
|---|---|
| Plan archive root | `.pi/executions/{planExecId}/` |
| Workspace archive root | `.pi/executions/{planExecId}/workspaces/{workspaceId}/` |
| Worktree root | `.pi/worktrees/{planExecId}/{workspaceId}/` |
| Gauntlet reports | `reports/p41-visibility-control-cockpit/{timestamp}/` |

### 10.2 Combined Summary Current Shape (without visibility section)

The `CombinedSummary` interface in `combined-summary.ts` currently has these top-level sections:

| Section | Status |
|---|---|
| `runId`, `timestamp`, `mode`, `seed`, `durationMs`, `overallVerdict` | Exists |
| `verdictSemanticsVersion` | Exists |
| `executionProfile` | Exists (P39.01) |
| `commands` | Exists |
| `stages` | Exists |
| `executionModes` | Exists |
| `pythonWebApp` | Exists |
| `invariants` | Exists |
| `leadAgent` | Exists |
| `completionGate` | Exists |
| `stopContinue` | Exists |
| `parallelism` | Exists |
| `artifacts` | Exists |
| `replay` | Exists |
| `limitations` | Exists |
| `expectedFailures` | Exists |
| **`visibility`** | **MISSING — to be added in P41** |

---

## Summary

The system has significant visibility infrastructure in place: execution archive writing, log streaming endpoints, worktree file explorer, artifact browser, activity timeline, and combined summary reporting. However, the visibility layer is **passive and archival** — events are written to files for post-hoc analysis, not streamed for live consumption. Key gaps:

1. **No canonical event types** — 58 event types from the P41 plan are undefined.
2. **No real event spine** — No runtime event store or streaming bus.
3. **WorkerAdapter returns empty data** — `events`, `changedFiles`, and `commandHistory` are all empty arrays from the only worker adapter.
4. **Read model stubs** — `getCommandHistory()` and `getLeadDirectives()` return empty arrays.
5. **Legacy control bypasses execution-service** — The dashboard uses a control file instead of the execution-service command handler.
6. **No human directive path** — No endpoint, event, or data flow for human directives.
7. **No combined summary `visibility` section** — No tracking of whether visibility artifacts were actually generated.
8. **Limited dashboard endpoints** — No dedicated endpoints for worker status, completion gate, lead agent detail, or file visibility outside worktrees.

The gap is not in missing infrastructure — most write paths exist — but in the **event contract layer (types + emission)**, **runtime event bus**, and **read model API surface**. P41.01 (Event Schema), P41.03 (Runtime Emitters), and P41.12 (Dashboard Panels) will address these systematically.

# P41 — Execution Visibility & Control Cockpit

**Contract Version:** 5.0.0  
**Phase:** P41  
**Title:** Execution Visibility & Control Cockpit  
**Status:** Planned  
**Execution Class:** `visibility_control_platform`  
**Selected Mode:** `stable_3_visibility_cockpit`  
**Target Promotion Mode:** `stable_3`  
**Max Parallel Workspaces:** 3  
**Expected Safe Effective Parallelism:** 2–3  
**Worktree Required:** false  
**Patch Transaction Default:** false  
**Real LLM Required by Default:** false  
**Required Gates:** `make test`, `make test-full`  
**Primary Goal:** Turn the execution system from a blind auto-executor into an observable, steerable coding cockpit.

---

## 0. TL;DR

P41 makes the execution platform visible and steerable.

Before P41, the system can execute, but it behaves like a blind submarine: workers run, commands execute, files change, failures happen, but the user cannot reliably see inside or intervene safely.

After P41, the system should feel like a coding cockpit:

```txt
see every worker
see every command
see live stdout/stderr
see transcripts/context packets
see file tree changes
see diffs/snapshots
see CompletionGate blocks
see Lead Agent diagnosis/escalation
send human directives
pause/resume/stop/retry/rerun validation safely
```

P41 is not dashboard polish. P41 is the event spine, read models, control APIs, minimal cockpit panels, and E2E visibility proof.

---

## 1. Current Context

P40 created the physical platform boundary foundation:

```txt
packages/execution-core
packages/execution-service
packages/worker-adapters
packages/brain
```

P40 also established:

```txt
stable_3 remains the default baseline
patch_transaction remains non-default
worktree is not required
coding-agent is no longer the canonical owner of execution contracts
```

However, execution is still not sufficiently visible or steerable. P41 fixes that.

---

## 2. Product Vision

P41 turns:

```txt
blind autonomous executor
```

into:

```txt
visible and steerable coding platform
```

The user must be able to answer these questions live:

```txt
Which workers are running?
What is each worker doing?
What command is running now?
What did stdout/stderr say?
What files changed?
Who changed each file?
What is the diff?
What role/context packet did the worker receive?
Why did CompletionGate block?
What did Lead Agent diagnose?
Is escalation needed?
Can I send a directive?
Can I stop/retry/rerun validation safely?
```

If the user still has to dig through raw logs manually, P41 failed.

---

## 3. Scope

P41 includes:

```txt
execution event schema
event spine / event store
runtime event emitters
worker transcript capture
live command log / terminal stream
file tree read model
file diff and snapshot artifacts
worker context inspector
Lead Agent escalation surface
human directive / intervention API
control actions API
minimal dashboard cockpit panels
visibility E2E gauntlet expansion
combined-summary visibility validation
```

P41 does not include:

```txt
full dashboard visual redesign
advanced IDE layout / Monaco editor
external Codex/Claude/OpenCode workers
patch_transaction default promotion
dirty runtime dependency inversion
brain overnight planner
real LLM required by default
unrestricted browser shell input
```

---

## 4. P41 vs P42

P41 and P42 must remain separate.

```txt
P41:
  event spine
  visibility artifacts
  read models
  control APIs
  minimal functional dashboard cockpit
  E2E proof

P42:
  full dashboard rework
  IDE-grade UX
  visual polish
  advanced layout
  deeper interaction design
```

P41 makes the system visible and steerable. P42 makes it beautiful and product-grade.

---

## 5. Target Architecture

```txt
Execution Runtime
  emits structured ExecutionEvents
      ↓
Event Spine / Event Store
  persists and streams events
      ↓
Read Model Builder
  derives plan/workspace/worker/file/lead/control views
      ↓
Web Server API / SSE / WebSocket
  serves live visibility and control endpoints
      ↓
Minimal Dashboard Cockpit
  shows live state, logs, transcripts, files, diffs, controls
      ↓
Human Intervention API
  sends directives/control commands back through execution-service
```

The event spine is the source of truth for visibility. The state store remains the source of truth for execution state. The UI must not infer authoritative execution state locally.

---

## 6. Canonical Event Types

### 6.1 Plan Events

```txt
plan_started
plan_paused
plan_resumed
plan_stopped
plan_failed
plan_completed
plan_final_validation_started
plan_final_validation_failed
plan_final_validation_passed
```

### 6.2 Workspace Events

```txt
workspace_queued
workspace_started
workspace_blocked
workspace_failed
workspace_completed
workspace_retry_requested
workspace_retry_started
workspace_cancel_requested
workspace_cancelled
workspace_stale_completion_ignored
```

### 6.3 Worker Events

```txt
worker_spawned
worker_heartbeat
worker_context_loaded
worker_prompt_created
worker_response_received
worker_transcript_written
worker_completed
worker_failed
```

### 6.4 Command / Terminal Events

```txt
command_started
command_stdout
command_stderr
command_completed
command_failed
command_cancelled
command_timed_out
```

### 6.5 File Visibility Events

```txt
file_read
file_written
file_created
file_deleted
file_diff_created
file_snapshot_created
file_lock_acquired
file_lock_released
file_tree_updated
```

### 6.6 CompletionGate Events

```txt
completion_gate_started
completion_gate_blocked
completion_gate_passed
completion_gate_failed
target_command_missing
command_history_missing
no_tests_found_detected
```

### 6.7 Lead Agent / Escalation Events

```txt
lead_diagnosis_created
lead_directive_created
lead_retry_budget_updated
lead_escalation_created
lead_escalation_resolved
user_escalation_required
```

### 6.8 Human Intervention Events

```txt
human_directive_sent
human_directive_attached_to_retry
human_override_requested
human_override_applied
human_override_rejected
repair_workspace_requested
validation_rerun_requested
```

---

## 7. Required Artifacts

Each run must write and/or expose:

```txt
event-stream.ndjson
state-snapshots.ndjson
live-monitor.log
worker-transcripts/
command-logs/
file-snapshots/
file-diffs/
worker-contexts/
lead-agent/
human-directives/
replay-commands.md
combined-summary.json
```

P41 must ensure these artifacts are discoverable through the read model/API where practical.

---

## 8. Control and Intervention Rules

P41 introduces steering, not unsafe arbitrary mutation.

Allowed controls:

```txt
pause plan
resume plan
stop plan
cancel workspace
retry workspace
rerun validation
send human directive
open repair workspace
resolve escalation
acknowledge escalation
```

Restricted controls:

```txt
unrestricted browser shell input
direct DB state mutation
manual mark-complete
manual bypass CompletionGate
manual bypass final validation
```

All control actions must:

```txt
go through execution-service command boundary
emit an event
be persisted
appear in transcript/read model
appear in final report
```

---

## 9. Minimal Dashboard Cockpit

P41 adds functional panels without a full redesign.

Required panels:

```txt
Plan Overview
Worker List
Worker Detail
Live Logs / Terminal Stream
File Tree
Diff Viewer
Worker Context Inspector
Lead Agent / Escalation Panel
Control Actions Panel
```

### 9.1 Plan Overview

Must show:

```txt
plan status
active workers
ready workers
blocked workers
failed workers
completed workers
current phase
final validation status
last event
```

### 9.2 Worker List

Must show:

```txt
worker id
workspace id
status
current command
last heartbeat
retry count
lead directive status
changed files count
```

### 9.3 Worker Detail

Must show:

```txt
workspace id
goal
role packet
context packet
allowed files
touched files
last command
stdout/stderr summary
retry count
Lead Agent diagnosis
human directive if present
transcript link
```

### 9.4 Live Logs / Terminal Stream

Must show:

```txt
command_started
stdout
stderr
command_completed
exit code
duration
full log artifact path
```

Read-only live terminal stream is enough for P41. Interactive shell input should remain gated.

### 9.5 File Tree

Must show an execution-aware file tree:

```txt
created files
modified files
deleted files
locked files
last writer
last write event
diff availability
validation relevance
```

Example:

```txt
src/completion-gate.ts
  status: modified
  lastWorker: P41.04
  lastEvent: file_written
  diff: available
  lock: released
```

### 9.6 Diff Viewer

Must show:

```txt
before snapshot
after snapshot
unified diff
worker id
workspace id
timestamp
file event id
```

### 9.7 Lead Agent / Escalation Panel

Must show:

```txt
failure class
failure signature
repeat count
retry budget remaining
diagnosis
directive
escalation status
suggested next action
```

### 9.8 Control Actions Panel

Must support:

```txt
pause plan
resume plan
stop plan
cancel workspace
retry workspace
rerun validation
send human directive
open repair workspace
acknowledge escalation
resolve escalation
```

---

## 10. E2E Visibility Gauntlet Expansion

P41 must expand the existing gauntlet. `make test-full` must validate visibility, not only execution correctness.

### V1 — live_log_stream

Purpose: verify command stdout/stderr are streamed and visible.

Expected:

```txt
command_started event exists
command_stdout event exists
command_stderr event exists when stderr is produced
command_completed event exists
live-monitor.log contains command output
dashboard/read model can retrieve command logs
```

### V2 — worker_transcript_capture

Purpose: verify worker prompt/context/response/tool transcript is written.

Expected:

```txt
worker_transcript_written event exists
worker transcript artifact exists
worker detail read model includes transcript path
combined-summary visibility.transcriptsWritten = true
```

### V3 — file_tree_visibility

Purpose: verify file tree is generated and updated during execution.

Expected:

```txt
file_tree_updated event exists
file tree read model exists
created/modified/deleted file states are correct
dashboard file tree endpoint returns data
```

### V4 — file_diff_visibility

Purpose: verify file diffs and snapshots are generated.

Expected:

```txt
file_snapshot_created event exists
file_diff_created event exists
diff artifact exists
diff viewer read model can retrieve diff metadata
```

### V5 — lead_directive_visibility

Purpose: verify Lead Agent diagnosis/directive/escalation is visible.

Expected:

```txt
lead_diagnosis_created event exists
lead_directive_created event exists
lead_escalation_created event exists when expected
Lead panel read model returns diagnosis/directive
```

### V6 — human_directive_flow

Purpose: verify user can send a directive and it enters retry/control flow.

Expected:

```txt
human_directive_sent event exists
directive persisted
retry packet includes human directive
worker transcript shows directive
combined-summary visibility.humanDirectiveVisible = true
```

### V7 — control_actions_visibility

Purpose: verify pause/resume/stop/retry/rerun validation actions are evented and visible.

Expected:

```txt
control command event exists
execution-service command boundary is used
state/read model updates
dashboard control endpoint returns result
```

### V8 — completion_gate_visibility

Purpose: verify CompletionGate block reasons are visible.

Expected:

```txt
completion_gate_blocked event exists
block reason visible in workspace detail
command evidence visible
combined-summary visibility.completionGateVisible = true
```

---

## 11. Combined Summary Additions

P41 must add a `visibility` section to `combined-summary.json`.

```json
{
  "visibility": {
    "eventStreamWritten": true,
    "stateSnapshotsWritten": true,
    "liveMonitorWritten": true,
    "transcriptsWritten": true,
    "commandLogsWritten": true,
    "fileTreeAvailable": true,
    "fileDiffsWritten": true,
    "workerContextAvailable": true,
    "dashboardReadModelAvailable": true,
    "leadAgentVisible": true,
    "completionGateVisible": true,
    "humanDirectiveVisible": true,
    "controlEventsVisible": true,
    "escalationVisible": true
  }
}
```

`make test-full` must fail if required visibility fields are false.

---

## 12. Workspaces

P41 uses 14 workspaces.

### P41.00 — Visibility Baseline Audit

**Goal:** Audit current logs, transcripts, event streams, dashboard APIs, worker context visibility, and missing control paths.

**Tasks:**

```txt
Map existing event/log/transcript artifacts
Map current dashboard endpoints
Map current file visibility
Map current command history visibility
Map current Lead Agent visibility
Map current control actions
Identify gaps
Create docs/pi/p41/visibility-baseline-audit.md
```

**Acceptance criteria:**

```txt
audit exists
missing visibility paths listed
dashboard endpoint gaps listed
control action gaps listed
E2E visibility gaps listed
```

---

### P41.01 — Execution Event Schema

**Goal:** Define canonical event types for visibility/control in execution-core.

**Acceptance criteria:**

```txt
event schema exported from execution-core
event types compile
no coding-agent imports in execution-core
make test passes
```

---

### P41.02 — Event Spine / Event Store

**Goal:** Implement event append/read/stream boundary.

**Acceptance criteria:**

```txt
events can be appended
events can be read
events can be streamed in tests
event-stream.ndjson written
make test passes
```

---

### P41.03 — Runtime Event Emitters

**Goal:** Emit visibility events from real execution paths.

**Acceptance criteria:**

```txt
smoke-real gauntlet emits lifecycle events
completion_gate_blocked visible
lead_directive_created visible
state snapshots remain valid
make test passes
```

---

### P41.04 — Worker Transcript Capture

**Goal:** Capture worker role/context/prompt/response/tool transcript artifacts.

**Acceptance criteria:**

```txt
worker transcript artifact exists
role/context packet visible
worker_transcript_written event exists
E2E V2 passes
make test passes
```

---

### P41.05 — Live Command Log / Terminal Stream

**Goal:** Make command stdout/stderr visible live and in artifacts.

**Acceptance criteria:**

```txt
stdout/stderr events written
command logs visible in read model
worker terminal stream endpoint exists
E2E V1 passes
make test passes
```

---

### P41.06 — File Tree Read Model

**Goal:** Build execution-aware file tree read model and API.

**Acceptance criteria:**

```txt
file tree read model exists
file tree API returns data
dashboard panel can render tree
E2E V3 passes
make test passes
```

---

### P41.07 — File Diff / Snapshot Artifacts

**Goal:** Capture file snapshots and diffs.

**Acceptance criteria:**

```txt
diff artifact exists
file diff event exists
diff metadata API returns data
dashboard can show minimal diff metadata
E2E V4 passes
make test passes
```

---

### P41.08 — Worker Context Inspector

**Goal:** Expose worker role packet, context packet, allowed files, touched files, and current goal.

**Acceptance criteria:**

```txt
worker context read model exists
dashboard worker detail panel shows context
transcript and context linked
make test passes
```

---

### P41.09 — Lead Agent Escalation Surface

**Goal:** Make Lead Agent diagnosis, directives, and escalations visible and actionable.

**Acceptance criteria:**

```txt
Lead diagnosis visible
Lead directive visible
Escalation visible
E2E V5 passes
make test passes
```

---

### P41.10 — Human Directive / Intervention API

**Goal:** Allow user to send a directive when escalation occurs.

**Acceptance criteria:**

```txt
human directive command works
human_directive_sent event exists
directive appears in retry packet or next worker context
E2E V6 passes
make test passes
```

---

### P41.11 — Control Actions API

**Goal:** Make pause/resume/stop/retry/rerun validation visible and routed through execution-service.

**Acceptance criteria:**

```txt
control actions emit events
dashboard can trigger supported controls
read model updates after control action
E2E V7 passes
make test passes
```

---

### P41.12 — Minimal Dashboard Cockpit Panels

**Goal:** Add functional panels for visibility and control without full redesign.

**Required panels:**

```txt
Plan Overview
Worker List
Worker Detail
Live Logs
File Tree
Diff metadata
Lead/Escalation
Control Actions
```

**Acceptance criteria:**

```txt
minimal panels exist
panels consume read models/APIs
no full dashboard rewrite
make test passes
```

---

### P41.13 — E2E Visibility Gauntlet and Final Report

**Goal:** Expand gauntlet with visibility scenarios and validate P41.

**Acceptance criteria:**

```txt
make test passes
make test-full passes
V1 live_log_stream passes
V2 worker_transcript_capture passes
V3 file_tree_visibility passes
V4 file_diff_visibility passes
V5 lead_directive_visibility passes
V6 human_directive_flow passes
V7 control_actions_visibility passes
V8 completion_gate_visibility passes
combined-summary visibility section passes
reports/p41-visibility-control-cockpit/<timestamp>/summary.md exists
```

---

## 13. Execution Batches

### Batch 0 — Audit and Schema

```txt
P41.00
P41.01
```

Parallelism: 1–2

### Batch 1 — Event Spine and Runtime Emitters

```txt
P41.02
P41.03
```

Parallelism: 1–2

### Batch 2 — Worker Logs / Transcript / File Visibility

```txt
P41.04
P41.05
P41.06
P41.07
P41.08
```

Parallelism: 2–3

### Batch 3 — Escalation and Control

```txt
P41.09
P41.10
P41.11
```

Parallelism: 2

### Batch 4 — Dashboard Panels and E2E

```txt
P41.12
P41.13
```

Parallelism: 1–2

---

## 14. Validation Commands

Required:

```bash
make test
make test-full
```

Optional, not default:

```bash
PI_GAUNTLET_REAL_LLM=1 make test-nightly-real
```

P41 must not require real LLM by default.

---

## 15. Acceptance Criteria

P41 is complete only if:

```txt
event schema exists in execution-core
event spine can append/read/stream events
worker transcript artifacts are written
command stdout/stderr logs are visible
file tree read model exists
file diff artifacts exist
worker context inspector exists
Lead Agent diagnosis/directive/escalation visible
human directive API works
control actions emit events
minimal dashboard cockpit panels exist
make test passes
make test-full passes
visibility E2E scenarios V1–V8 pass
combined-summary visibility section passes
reports/p41-visibility-control-cockpit final report exists
```

---

## 16. Failure Conditions

P41 fails if:

```txt
visibility relies only on raw console logs
dashboard panels use fake/static data
human directives bypass execution-service
control actions directly mutate DB/state outside execution-service
worker transcripts are not persisted
file tree is not execution-aware
file diffs are not linked to worker events
Lead Agent escalation is not visible
make test-full fails
stable_3 behavior changes
patch_transaction becomes default
worktree is reintroduced
```

---

## 17. Final Report

Write final report to:

```txt
reports/p41-visibility-control-cockpit/<timestamp>/
```

Required files:

```txt
summary.md
event-spine.md
worker-transcripts.md
command-logs.md
file-tree.md
file-diffs.md
worker-context.md
lead-escalation.md
human-directives.md
control-actions.md
dashboard-panels.md
e2e-visibility-gauntlet.md
remaining-risks.md
```

---

# Part 3 — JSON Queue

```json
{
  "contractVersion": "4.1.1",
  "phase": "P41",
  "title": "Execution Visibility & Control Cockpit",
  "status": "planned",
  "executionClass": "visibility_control_platform",
  "selectedMode": "stable_3_visibility_cockpit",
  "targetPromotionMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "expectedSafeEffectiveParallelism": 3,
  "jsonRuntimeFallbackAllowed": false,
  "planExecution": {
    "phase": "P41",
    "title": "Execution Visibility & Control Cockpit",
    "stateBackend": "postgres",
    "worktree": {
      "enabled": false
    },
    "patchTransactionDefault": false,
    "finalValidationRequired": true,
    "makeTestFullRequired": true
  },
  "derivedExecutionProfile": {
    "executionBackend": "postgres",
    "worktreeRequired": false,
    "patchTransactionRequired": false,
    "patchTransactionDefault": false,
    "agentMutationAllowed": false
  },
  "workspaces": [
    {
      "id": "P41.00",
      "title": "Visibility Baseline Audit",
      "dependencies": [],
      "capabilities": {
        "canEdit": ["docs/pi/p41/**"],
        "canRun": ["find packages -name '*.ts' | head -50"]
      }
    },
    {
      "id": "P41.01",
      "title": "Execution Event Schema",
      "dependencies": ["P41.00"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/events/**"],
        "canRun": ["npm run build", "npm run check"]
      }
    },
    {
      "id": "P41.02",
      "title": "Event Spine / Event Store",
      "dependencies": ["P41.01"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.03",
      "title": "Runtime Event Emitters",
      "dependencies": ["P41.02"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**", "packages/execution-service/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.04",
      "title": "Worker Transcript Capture",
      "dependencies": ["P41.02"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.05",
      "title": "Live Command Log / Terminal Stream",
      "dependencies": ["P41.02"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**", "packages/execution-service/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.06",
      "title": "File Tree Read Model",
      "dependencies": ["P41.02"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**", "packages/web-server/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.07",
      "title": "File Diff / Snapshot Artifacts",
      "dependencies": ["P41.06"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.08",
      "title": "Worker Context Inspector",
      "dependencies": ["P41.04"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**", "packages/web-server/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.09",
      "title": "Lead Agent Escalation Surface",
      "dependencies": ["P41.02"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/**", "packages/brain/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.10",
      "title": "Human Directive / Intervention API",
      "dependencies": ["P41.09"],
      "capabilities": {
        "canEdit": ["packages/execution-service/src/**", "packages/web-server/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.11",
      "title": "Control Actions API",
      "dependencies": ["P41.10"],
      "capabilities": {
        "canEdit": ["packages/execution-service/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.12",
      "title": "Minimal Dashboard Cockpit Panels",
      "dependencies": ["P41.06", "P41.08", "P41.09", "P41.11"],
      "capabilities": {
        "canEdit": ["packages/web-ui/dashboard/src/**"],
        "canRun": ["npm run build", "make test"]
      }
    },
    {
      "id": "P41.13",
      "title": "E2E Visibility Gauntlet and Final Report",
      "dependencies": ["P41.12"],
      "capabilities": {
        "canEdit": ["packages/coding-agent/test/**", "docs/pi/p41/**", "reports/**"],
        "canRun": ["make test", "make test-full"]
      }
    }
  ]
}
```

---

## 19. Final Directive

P41 must not be reduced to logging.

P41 must make execution:

```txt
visible
inspectable
streamable
auditable
steerable
recoverable
```

The user must be able to see workers, files, commands, transcripts, Lead Agent decisions, and escalation state live.

If a worker fails, the user must be able to see why and send a directive.

If a file changes, the user must be able to see where, when, by whom, and how.

If the system is still a black box after this phase, P41 failed.

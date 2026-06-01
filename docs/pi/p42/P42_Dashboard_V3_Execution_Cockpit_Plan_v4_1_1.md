# P42 — Dashboard V3 Execution Cockpit Implementation

**Plan Format:** 4.1.1  
**Phase:** P42  
**Status:** Ready for implementation  
**Execution Class:** implementation  
**Primary Runtime Mode:** stable_3  
**Selected Mode:** stable_3_dashboard_cockpit  
**Target Promotion Mode:** stable_3  
**Max Parallel Workspaces:** 3  
**Expected Safe Effective Parallelism:** 2–3  
**State Backend:** postgres  
**Worktree Required:** false  
**Patch Transaction Default:** false  
**JSON Runtime Fallback Allowed:** false  
**Final Validation Required:** true  
**Full Gauntlet Required:** true  

## Authoritative Source Documents

Use these as implementation authority:

```txt
docs/pi/p42/proposed_interface_map_v3.md
docs/pi/p42/pi_cockpit_v3_final_mockup.html
docs/pi/p42/README.md
```

Do **not** use these as implementation authority:

```txt
docs/pi/p42/proposed-dashboard-v2.md
docs/pi/p42/pi_cockpit_v3_no_rightsidebar.html
older dashboard summaries
stale P21/P22/P41 visual notes unless explicitly referenced by V3
```

---

# Part 1 — Product Mission

P42 turns the dashboard into **Pi Execution Cockpit V3**, an autonomous coding IDE cockpit.

The dashboard must answer these five questions in under three seconds:

```txt
1. What is happening?
2. Where is the risk?
3. What changed?
4. What evidence proves it?
5. What is the safest next action?
```

The primary live object is:

```txt
Plan Execution
```

The secondary objects are:

```txt
Workspace
Worker Attempt
Command
File Change
Log
Transcript
Validation Evidence
Escalation
Artifact
Control Action
```

Brain and Platform surfaces remain available, but they become **supporting namespaces**, not competing primary cockpit surfaces.

---

# Part 2 — Non-Negotiable V3 Decisions

## 2.1 Workspace Click Opens a Dedicated Nested Route

Workspace cards must not open a large modal as the main detail experience.

Required route model:

```txt
/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId
```

Workspace detail must render as a full nested cockpit page with:

```txt
header
current state
prompt/context summary
command history
file changes
logs/transcript
validation evidence
attempt history
escalations/directives
contextual controls
```

Dialogs are allowed only for short actions:

```txt
confirm stop
confirm cancel
confirm skip
send human directive
resolve escalation
artifact preview
dangerous action confirmation
```

## 2.2 Controls Are Contextual, Not a Tab

There must be no primary `Controls` tab.

Controls attach to the object they affect:

```txt
Plan controls      -> topbar / mission hero
Workspace controls -> workspace card / workspace detail page
Escalation controls -> escalation card / escalation center
File controls      -> files/diff view
```

## 2.3 Files/Diff Is a First-Class IDE View

The Files view must answer:

```txt
What changed?
Who changed it?
Which workspace changed it?
Which command/test validates it?
What is the diff?
```

Production cockpit must use read-model/API truth, not direct git shelling from the UI.

## 2.4 Logs Are Command Timeline First

Logs must default to a command timeline, not a raw wall of terminal text.

Each command row should show:

```txt
workspace
attempt
command
duration
exit code
running/completed/failed state
is target command?
matched validation requirement?
stdout/stderr detail
links to workspace/files/evidence
```

Raw terminal output is a detail/debug toggle.

## 2.5 Escalations Are Root Cause + Action

Escalations must show:

```txt
root cause
impact
blocked dependency edges
evidence
retry budget
Lead Agent diagnosis if available
recommended actions
human directive input
safe intervention controls
```

## 2.6 No Permanent Right Sidebar

The old permanent right event/sidebar must not remain the primary layout.

V3 uses:

```txt
center-first layout
contextual right drawer
priority feed in Overview
raw event debug mode only when requested
```

## 2.7 Zero Fake Production Data

Production cockpit panels must not rely on fake/static/demo data.

Allowed only if:

```txt
explicitly marked test/story/demo-only
not used by production route
covered by fake-data detection report/test
```

---

# Part 3 — Scope

## 3.1 In Scope

```txt
V3 cockpit shell
App.tsx decomposition
task -> run tree sidebar
topbar simplification
route/navigation state
mission control hero
execution overview
workspace board
dedicated workspace detail route
files/diff IDE view
logs command timeline
escalation/action center
contextual controls
brain/platform regrouping
contextual drawers
read-model wiring
stub/fake/static data removal
control-path unification through execution-service
accessibility and keyboard flows
final frontend audit
make test / make test-full validation
```

## 3.2 Out of Scope

```txt
Runtime dependency inversion
Patch transaction default promotion
Scheduler rewrite
State-store rewrite
Execution kernel rewrite
Worker ecosystem expansion
External Codex/Claude worker adapter implementation
Brain overnight redesign
Mobile app
Vercel deployment automation
React Native
New backend persistence architecture
New orchestration model
```

---

# Part 4 — Target App Shell

## 4.1 Final Layout

```txt
┌──────────────────────────────────────────────────────────────────────┐
│ Topbar 48px                                                          │
│ [Pi] project > task > run > workspace     ● Running   [Pause][Stop]  │
│                                             [Brain][Settings][Search] │
├──────────────┬───────────────────────────────────────────────────────┤
│ Left Sidebar │ Center Work Surface                                   │
│ 230px        │                                                       │
│              │ [Overview|Workspaces|Files|Logs|Escalations]          │
│ Task tree    │                                                       │
│ Brain        │ Selected cockpit route                                │
│ Platform     │                                                       │
│ Quick actions│ Contextual drawer opens only when requested           │
├──────────────┴───────────────────────────────────────────────────────┤
│ Status Bar 24px                                                      │
│ run #4 · Running · 3/12 active · 2 blocked · ~$0.84 · 24k tokens      │
└──────────────────────────────────────────────────────────────────────┘
```

## 4.2 Primary Tabs

```txt
Overview
Workspaces
Files
Logs
Escalations
```

Not allowed as primary tabs:

```txt
Controls
Raw Events
Debug
Brain
Platform
```

---

# Part 5 — Route Map

## 5.1 Required Primary Routes

```txt
/
  -> last active execution or project list

/projects/:projectId
  -> project detail

/projects/:projectId/tasks/:taskId
  -> task detail

/projects/:projectId/tasks/:taskId/runs/:runId
  -> execution overview

/projects/:projectId/tasks/:taskId/runs/:runId/workspaces
  -> workspace board

/projects/:projectId/tasks/:taskId/runs/:runId/workspaces/:workspaceId
  -> dedicated workspace detail page

/projects/:projectId/tasks/:taskId/runs/:runId/files
  -> files/diff cockpit

/projects/:projectId/tasks/:taskId/runs/:runId/files/*filePath
  -> file detail/diff view

/projects/:projectId/tasks/:taskId/runs/:runId/logs
  -> command timeline

/projects/:projectId/tasks/:taskId/runs/:runId/escalations
  -> escalation/action center

/projects/:projectId/tasks/:taskId/runs/:runId/artifacts
  -> artifact browser if implemented; otherwise defer to drawer
```

## 5.2 Secondary Namespaces

```txt
/brain/proposals
/brain/memory
/brain/digest
/brain/reflections
/brain/overnight
/brain/inbox

/platform/observability
/platform/policy
/platform/trust
/platform/extensions
/platform/skills
/platform/settings

/history/executions
/history/tasks
/history/brain
```

These must not compete with active execution.

---

# Part 6 — State Ownership and Mutation Rules

## 6.1 UI Reads

Dashboard may read through:

```txt
web-server REST APIs
SSE/WebSocket event streams
execution-service query/read-model APIs
artifact endpoints
transcript endpoints
```

Dashboard must not directly read:

```txt
postgres tables
state-store files
execution core mutable internals
local filesystem paths except through approved endpoints
```

## 6.2 UI Mutations

All control mutations must go through execution-service-backed endpoints.

Required control actions:

```txt
pause plan
resume plan
stop plan
cancel plan
rerun plan
retry workspace
cancel workspace
send human directive
skip workspace
rerun validation
resolve escalation
acknowledge escalation
increase retry budget if supported
```

Forbidden:

```txt
direct DB mutation
direct state-store mutation
direct control file write from dashboard
manual COMPLETE/BLOCKED state transition from UI component
CompletionGate bypass
force kill without double confirmation
```

---

# Part 7 — Implementation Workspaces

P42 has **12 workspaces**.

This is intentionally more granular than the V3 map’s high-level phase list because high-risk areas should not be bundled together.

```txt
P42.00 — V3 Source Lock and Baseline Audit
P42.01 — Read Model Stub Completion and API Contract Hardening
P42.02 — Unified Control Path Through Execution-Service
P42.03 — App Shell and Navigation Cleanup
P42.04 — Mission Control Overview
P42.05 — Workspace Board
P42.06 — Dedicated Workspace Detail Route
P42.07 — Files / Diff IDE Workspace
P42.08 — Logs / Command Timeline
P42.09 — Escalation / Root-Cause Action Center
P42.10 — Brain / Platform Regrouping and Contextual Drawers
P42.11 — Legacy Deprecation, QA, A11y, React Doctor, Final Report
```

Recommended execution:

```txt
Batch 0: P42.00
Batch 1: P42.01 + P42.02
Batch 2: P42.03
Batch 3: P42.04 + P42.05
Batch 4: P42.06 + P42.07 + P42.08
Batch 5: P42.09 + P42.10
Batch 6: P42.11
```

---

# Part 8 — Workspace Specifications

---

## P42.00 — V3 Source Lock and Baseline Audit

**Risk:** low  
**Parallelizable:** no  
**Dependencies:** none  

### Goal

Lock the V3 docs as source-of-truth and create a precise baseline before changing production UI.

### Allowed Files

```txt
docs/pi/p42/**
reports/p42-dashboard-v3/**
packages/web-ui/dashboard/src/**
packages/web-server/src/**
packages/execution-core/src/**
packages/execution-service/src/**
```

### Executor Prompt

Read the authoritative V3 documents:

```txt
docs/pi/p42/proposed_interface_map_v3.md
docs/pi/p42/pi_cockpit_v3_final_mockup.html
docs/pi/p42/README.md
```

Do not use V2 or older dashboard summaries as implementation authority.

Audit current dashboard and backend surfaces:

```txt
App.tsx responsibilities
current sidebar/topbar/right-sidebar layout
existing routes or route-like state
dashboard components
hooks and API clients
read model stubs
fake/static data
control actions and mutation paths
files/diff data path
logs/command data path
escalation data path
Brain/Platform navigation
```

Create:

```txt
docs/pi/p42/p42-baseline-audit.md
reports/p42-dashboard-v3/<timestamp>/baseline-audit.md
```

### Acceptance Criteria

```txt
V3 source docs are named as authoritative
V2/old docs are explicitly marked non-authoritative
baseline audit exists
read model stub inventory exists
fake/static data inventory exists
control path inventory exists
App.tsx responsibility inventory exists
make test passes
```

### Validation

```bash
make test
```

---

## P42.01 — Read Model Stub Completion and API Contract Hardening

**Risk:** high  
**Parallelizable:** yes, with P42.02 after P42.00  
**Dependencies:** P42.00  

### Goal

Fix or clearly harden read-model/API surfaces required by V3 so UI panels can consume real execution truth.

### Allowed Files

```txt
packages/execution-core/src/read-model.ts
packages/execution-core/src/file-tree.ts
packages/execution-core/src/**
packages/execution-service/src/query-handler.ts
packages/execution-service/src/**
packages/web-server/src/**
packages/web-ui/dashboard/src/api/**
packages/web-ui/dashboard/src/hooks/**
docs/pi/p42/**
reports/p42-dashboard-v3/**
```

### Executor Prompt

Implement or harden read-model query surfaces required by V3:

```txt
getPlanSummary
getPlanStats
getWorkspaceSummary
getDependencyGraph
getWorkerContext
getCommandHistory
getChangedFiles
getFileTree
getFileContent
getFileDiff
getLeadEscalations
getLeadDirectives
getFinalValidationStatus
getArtifacts / snapshots if already present
transcript read API if already present
```

If a full implementation is too large, do not fake it. Instead:

```txt
return explicit not_available status
document missing source
show typed empty state reason
add TODO only in report, not production fake data
```

Also expose or confirm web-server endpoints needed by cockpit views.

### Acceptance Criteria

```txt
no production read-model method returns silent [] or null without explicit unavailable reason
Files/Diff can consume getChangedFiles/getFileTree/getFileDiff
Logs can consume getCommandHistory
Escalations can consume getLeadEscalations/getDependencyGraph
Workspace Detail can consume worker context and command history
API contracts documented in docs/pi/p42/read-model-contracts.md
make test passes
```

### Validation

```bash
make test
npm run test -w packages/execution-service || true
npm run test -w packages/execution-core || true
```

`|| true` is acceptable only if the workspace/package does not define that script; report the reason.

---

## P42.02 — Unified Control Path Through Execution-Service

**Risk:** high  
**Parallelizable:** yes, with P42.01 after P42.00  
**Dependencies:** P42.00  

### Goal

Ensure V3 control actions have one safe mutation path through execution-service.

### Allowed Files

```txt
packages/execution-core/src/**
packages/execution-service/src/command-handler.ts
packages/execution-service/src/**
packages/web-server/src/**
packages/web-ui/dashboard/src/hooks/useHumanDirectives.ts
packages/web-ui/dashboard/src/hooks/usePlanRunner.ts
packages/web-ui/dashboard/src/api/**
packages/web-ui/dashboard/src/components/ControlActionsPanel.tsx
packages/web-ui/dashboard/src/components/HumanDirectivePanel.tsx
docs/pi/p42/**
reports/p42-dashboard-v3/**
```

### Executor Prompt

Audit existing control actions and eliminate primary UI reliance on legacy mutation paths.

Control actions to support or map:

```txt
pause plan
resume plan
stop plan
cancel plan
rerun plan
retry workspace
cancel workspace
send human directive
skip workspace
rerun validation
resolve escalation
acknowledge escalation
increase retry budget if supported
```

Create or update:

```txt
docs/pi/p42/control-action-safety-matrix.md
```

Ensure dangerous actions have confirmation requirements and impact summaries.

### Acceptance Criteria

```txt
control safety matrix exists
primary dashboard control actions map to execution-service-backed endpoints
legacy direct-control paths are removed from primary UI or marked debug/legacy
dangerous actions require confirmation
control action response has pending/success/failure UI shape
make test passes
```

### Validation

```bash
make test
```

---

## P42.03 — App Shell and Navigation Cleanup

**Risk:** high  
**Parallelizable:** no  
**Dependencies:** P42.01, P42.02  

### Goal

Create V3 shell/navigation and reduce App.tsx responsibilities.

### Allowed Files

```txt
packages/web-ui/dashboard/src/App.tsx
packages/web-ui/dashboard/src/app/**
packages/web-ui/dashboard/src/components/shell/**
packages/web-ui/dashboard/src/components/topbar/**
packages/web-ui/dashboard/src/components/sidebar/**
packages/web-ui/dashboard/src/components/statusbar/**
packages/web-ui/dashboard/src/navigation/**
packages/web-ui/dashboard/src/routes/**
packages/web-ui/dashboard/src/types.ts
packages/web-ui/dashboard/src/app.css
docs/pi/p42/**
reports/p42-dashboard-v3/**
```

### Executor Prompt

Implement the V3 app shell:

```txt
AppShell
TopbarV3
TaskRunSidebar
CenterWorkSurface
StatusBarV3
ContextualRightDrawer
CockpitTabs
Breadcrumb model
Route/navigation state
```

Topbar must include:

```txt
Pi logo
project > task > run > workspace breadcrumb
health/status pill
status text
Pause/Stop controls
Brain dropdown
Settings dropdown
Search/command palette trigger
```

Left sidebar must include:

```txt
task -> run tree
completed tasks
Brain support section
Platform support section
Upload plan
New task
```

Remove old primary patterns:

```txt
Browse/Queue/Chat tab sidebar
permanent right sidebar
Controls tab as primary view
```

Do not remove old components if still imported by secondary routes; deprecate gradually.

### Acceptance Criteria

```txt
V3 shell renders
right sidebar is not permanently visible by default
task/run sidebar is primary navigation
topbar is simplified
status bar exists or explicitly deferred with reason
App.tsx shell responsibility materially reduced
existing run selection still works
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
npm run build -w packages/web-ui/dashboard || true
```

---

## P42.04 — Mission Control Overview

**Risk:** medium  
**Parallelizable:** yes, with P42.05 after P42.03  
**Dependencies:** P42.03  

### Goal

Implement Overview/Mission Control as the default execution cockpit landing page.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/execution-overview/**
packages/web-ui/dashboard/src/components/mission-control/**
packages/web-ui/dashboard/src/components/StatCard.tsx
packages/web-ui/dashboard/src/hooks/usePlanExecutions.ts
packages/web-ui/dashboard/src/hooks/usePlanStats.ts
packages/web-ui/dashboard/src/hooks/usePlanEvents.ts
packages/web-ui/dashboard/src/hooks/useEscalations.ts
packages/web-ui/dashboard/src/types.ts
packages/web-ui/dashboard/src/app.css
docs/pi/p42/**
```

### Executor Prompt

Create:

```txt
MissionControlHero
MetricsStrip
WorkspacePreview
PriorityFeed
NextActionCard
CurrentBottleneckSummary
LatestEscalationSummary
ValidationStatusSummary
```

Hero states must cover:

```txt
healthy running
blocked
stalled
failed
paused
complete
stopped
```

Priority feed groups:

```txt
ATTENTION
ACTIVE
RECENT
```

Raw events must be hidden behind debug/expand controls.

### Acceptance Criteria

```txt
Overview is default route for active execution
hero shows current state, risk, and next action
metrics strip uses real data or explicit unavailable state
priority feed groups events by importance
next action card appears when actionable
no production fake plan/workspace numbers
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.05 — Workspace Board

**Risk:** medium/high  
**Parallelizable:** yes, with P42.04 after P42.03  
**Dependencies:** P42.03, P42.01  

### Goal

Implement grouped workspace board with actionable cards.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/workspaces/**
packages/web-ui/dashboard/src/components/WorkerList.tsx
packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts
packages/web-ui/dashboard/src/hooks/useWorkerContext.ts
packages/web-ui/dashboard/src/hooks/useEscalations.ts
packages/web-ui/dashboard/src/types.ts
packages/web-ui/dashboard/src/app.css
docs/pi/p42/**
```

### Executor Prompt

Create:

```txt
WorkspaceBoard
WorkspaceGroup
WorkspaceCardV3
WorkspaceStatusBadge
WorkspaceCardActions
```

Groups:

```txt
Attention / Blocked
Running
Ready
Completed
Failed
```

Each card must show:

```txt
workspace id
status
phase
current command
retry count
last heartbeat
files touched
blocks / blocked by
model/provider if available
safe contextual actions
```

Card click must route to workspace detail, not open a giant modal.

### Acceptance Criteria

```txt
workspaces grouped by status
blocked/attention workspaces prioritized
cards show last command/phase/retry/heartbeat where available
card click opens workspace detail route
buttons do not swallow route behavior incorrectly
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.06 — Dedicated Workspace Detail Route

**Risk:** high  
**Parallelizable:** no or limited  
**Dependencies:** P42.05, P42.01, P42.02  

### Goal

Implement nested workspace detail page.

### Allowed Files

```txt
packages/web-ui/dashboard/src/pages/workspace/**
packages/web-ui/dashboard/src/components/workspace-detail/**
packages/web-ui/dashboard/src/components/WorkerDetail.tsx
packages/web-ui/dashboard/src/components/WorkerContextInspector.tsx
packages/web-ui/dashboard/src/components/LiveLogTerminal.tsx
packages/web-ui/dashboard/src/hooks/useWorkerContext.ts
packages/web-ui/dashboard/src/hooks/usePlanTranscript.ts
packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts
packages/web-ui/dashboard/src/hooks/useEscalations.ts
packages/web-ui/dashboard/src/types.ts
docs/pi/p42/**
```

### Executor Prompt

Create `WorkspaceDetailPage` with panels:

```txt
Header
Current State
Prompt / Context Summary
Command History
File Changes
Transcript
Validation Evidence
Attempt History
Escalations / Directives
```

Include contextual actions:

```txt
pause
stop
cancel
retry
send directive
rerun validation
```

Dangerous actions use confirmation dialogs.

### Acceptance Criteria

```txt
workspace detail route exists
workspace not found state exists
workspace detail shows current phase/heartbeat/command
command history visible
file changes visible
transcript/context summary visible
validation evidence visible
attempt history visible
escalations/directives visible
Back to Workspaces works
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.07 — Files / Diff IDE Workspace

**Risk:** high  
**Parallelizable:** yes, with P42.08 after P42.06 starts if file scopes are isolated  
**Dependencies:** P42.01, P42.03  

### Goal

Implement first-class Files/Diff cockpit.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/files/**
packages/web-ui/dashboard/src/components/FileExplorer.tsx
packages/web-ui/dashboard/src/components/DiffViewer.tsx
packages/web-ui/dashboard/src/hooks/useFileTree*.ts
packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts
packages/web-ui/dashboard/src/types.ts
packages/web-server/src/**
packages/execution-service/src/query-handler.ts
packages/execution-core/src/read-model.ts
docs/pi/p42/**
```

### Executor Prompt

Create Files view with:

```txt
execution-aware file tree
status: created/modified/deleted/unchanged/locked
last writer
related workspace
related command
related validation
file preview
unified diff
copy diff
download patch if available
links to workspace detail and logs
```

Use read-model/API surfaces from P42.01. If an endpoint is not implemented, add explicit unavailable state, not fake data.

### Acceptance Criteria

```txt
Files tab exists
file tree is execution-aware
changed files visible
diff visible when available
file metadata visible
related workspace/command links exist
does not shell out to git from production UI
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.08 — Logs / Command Timeline

**Risk:** medium/high  
**Parallelizable:** yes, with P42.07  
**Dependencies:** P42.01, P42.03  

### Goal

Implement command timeline as default Logs view.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/logs/**
packages/web-ui/dashboard/src/components/LiveLogTerminal.tsx
packages/web-ui/dashboard/src/components/LogViewer.tsx
packages/web-ui/dashboard/src/hooks/useLiveLogTerminal.ts
packages/web-ui/dashboard/src/hooks/usePlanEvents.ts
packages/web-ui/dashboard/src/types.ts
packages/web-server/src/**
packages/execution-service/src/query-handler.ts
docs/pi/p42/**
```

### Executor Prompt

Create:

```txt
CommandTimelineView
CommandTimelineFilters
CommandRow
CommandDetailPanel
RawOutputToggle
```

Default view is command timeline.

Raw output is available behind toggle.

Filters:

```txt
workspace
command name
status
target commands only
show raw output
```

### Acceptance Criteria

```txt
Logs tab shows command timeline by default
commands grouped by workspace/attempt
duration and exit code visible
stdout/stderr expandable
target command / validation matching visible where available
raw output toggle exists
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.09 — Escalation / Root-Cause Action Center

**Risk:** medium/high  
**Parallelizable:** yes, with P42.10 after P42.06  
**Dependencies:** P42.01, P42.02, P42.06  

### Goal

Implement escalation/action center that shows root cause, impact, evidence, and next action.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/escalations/**
packages/web-ui/dashboard/src/components/LeadEscalationPanel.tsx
packages/web-ui/dashboard/src/components/BlockedReasonPanel.tsx
packages/web-ui/dashboard/src/hooks/useEscalations.ts
packages/web-ui/dashboard/src/hooks/useHumanDirectives.ts
packages/web-ui/dashboard/src/hooks/usePlanEvents.ts
packages/web-ui/dashboard/src/types.ts
packages/web-server/src/**
packages/execution-service/src/**
docs/pi/p42/**
```

### Executor Prompt

Create:

```txt
EscalationCenter
EscalationCardV3
DeadlockDependencyPanel
RecommendedActionsPanel
HumanDirectiveInput
EscalationEvidenceList
```

Each escalation card must show:

```txt
workspace id
severity
root cause
impact
evidence
retry budget
Lead Agent diagnosis if available
recommended actions
state: awaiting_user/user_responded/resolved/expired
```

### Acceptance Criteria

```txt
Escalations route exists
blocked workspaces visible
deadlock dependency edges visible
root cause visible
impact visible
evidence visible
recommended action visible
human directive input works through execution-service
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.10 — Brain / Platform Regrouping and Contextual Drawers

**Risk:** medium  
**Parallelizable:** yes, with P42.09 if routes are isolated  
**Dependencies:** P42.03  

### Goal

Move Brain/Platform into support namespaces and implement contextual drawers.

### Allowed Files

```txt
packages/web-ui/dashboard/src/components/brain/**
packages/web-ui/dashboard/src/features/**
packages/web-ui/dashboard/src/pages/**
packages/web-ui/dashboard/src/components/drawers/**
packages/web-ui/dashboard/src/components/ArtifactBrowser.tsx
packages/web-ui/dashboard/src/components/ChatPanel.tsx
packages/web-ui/dashboard/src/components/right-sidebar/**
packages/web-ui/dashboard/src/navigation/**
packages/web-ui/dashboard/src/routes/**
packages/web-ui/dashboard/src/types.ts
docs/pi/p42/**
```

### Executor Prompt

Regroup support surfaces:

```txt
Brain: proposals, memory, digest, reflections, overnight, inbox
Platform: observability, policy, trust, extensions, skills, settings
History: executions, tasks, brain
```

Implement contextual drawers:

```txt
TranscriptDrawer
ArtifactDrawer
DebugEventDrawer
FileEvidenceDrawer
DirectiveDrawer if needed
```

Permanent right sidebar must not be default cockpit layout.

### Acceptance Criteria

```txt
Brain no longer competes with active execution cockpit
Platform no longer competes with active execution cockpit
contextual drawer infrastructure exists
right-sidebar legacy path is removed from default cockpit or marked legacy
artifact/transcript/debug drawers can open from relevant UI
make test passes
```

### Validation

```bash
make test
npm run check -w packages/web-ui/dashboard || true
```

---

## P42.11 — Legacy Deprecation, QA, A11y, React Doctor, Final Report

**Risk:** medium  
**Parallelizable:** no  
**Dependencies:** all previous P42 workspaces  

### Goal

Remove or mark legacy paths, finish quality, add tests, run audits, and write final report.

### Allowed Files

```txt
packages/web-ui/dashboard/src/**
packages/web-ui/dashboard/test/**
packages/web-ui/dashboard/tests/**
packages/web-ui/dashboard/__tests__/**
docs/pi/p42/**
reports/p42-dashboard-v3/**
```

### Executor Prompt

Final validation and cleanup:

```txt
remove unused old sidebar paths from primary cockpit
remove Controls tab if still present
remove permanent right sidebar from default cockpit path
detect and remove fake/static production data
add or update tests for critical flows
add keyboard/focus/a11y checks where supported
run react-doctor if available and safe
write final report
```

Critical flows:

```txt
load execution overview
open workspace board
click workspace card -> dedicated detail route
open files/diff view
open logs command timeline
open escalation center
send human directive
dangerous action opens confirmation
brain/platform accessible as secondary
```

Create:

```txt
reports/p42-dashboard-v3/<timestamp>/summary.md
docs/pi/p42/p42-implementation-summary.md
```

### Acceptance Criteria

```txt
all must-have criteria pass
make test passes
make test-full passes
react-doctor run or skipped with explicit reason
fake/static data report exists
legacy/deprecated component report exists
final summary report exists
P42 marked ready for review
```

### Validation

```bash
make test
make test-full
npm run check -w packages/web-ui/dashboard || true
npm run build -w packages/web-ui/dashboard || true
npx react-doctor@latest || true
```

---

# Part 9 — Dependency Graph

```txt
P42.00
  ├── P42.01
  └── P42.02
        ↓
      P42.03
        ├── P42.04
        └── P42.05
              ↓
            P42.06
        ├────┴────┐
        ↓         ↓
      P42.07    P42.08
        └────┬────┘
             ↓
          P42.09
             ↓
          P42.10
             ↓
          P42.11
```

More accurate execution batches:

```txt
Batch 0:
  P42.00

Batch 1:
  P42.01
  P42.02

Batch 2:
  P42.03

Batch 3:
  P42.04
  P42.05

Batch 4:
  P42.06
  P42.07
  P42.08

Batch 5:
  P42.09
  P42.10

Batch 6:
  P42.11
```

---

# Part 10 — Risk Register

| Risk | Severity | Where | Mitigation |
|---|---:|---|---|
| App.tsx decomposition breaks current app | high | P42.03 | preserve old routes, incremental shell split, make test after every change |
| Read model stubs cause fake UI | critical | P42.01, P42.07, P42.08 | fix stubs first or show explicit unavailable state |
| Control actions bypass execution-service | critical | P42.02, P42.09 | single control path matrix and tests |
| Workspace detail becomes giant modal | high | P42.06 | enforce dedicated route acceptance criteria |
| Files/Diff bypasses read model | high | P42.07 | inspect API usage; forbid production git shell path |
| Logs remain raw-only | medium | P42.08 | command timeline required as default |
| Escalations show generic blocked status only | high | P42.09 | root cause/impact/evidence/action required |
| Brain/Platform still dominates navigation | medium | P42.10 | support namespace only |
| Too many UI changes in one run | high | all | stable_3 max parallel 3, batch gates |
| Frontend skill prompt bloat | medium | all frontend workers | load only relevant skills; deploy/token/native disabled |

---

# Part 11 — Validation Requirements

## 11.1 Per Workspace

Every implementation workspace must run:

```bash
make test
```

If available and safe:

```bash
npm run check -w packages/web-ui/dashboard
npm run build -w packages/web-ui/dashboard
```

If those commands are missing, the worker must report:

```txt
command not available
fallback command used
reason
```

## 11.2 Final Validation

P42 final validation requires:

```bash
make test
make test-full
```

Frontend audit if available:

```bash
npx react-doctor@latest
```

Do not install new tools or run network-heavy commands unless allowed by environment/policy.

## 11.3 Required Test Coverage

Add or update tests for:

```txt
workspace card click routes to dedicated workspace detail
Controls tab not present as primary route
overview hero shows state/risk/next action
workspace board groups workspaces correctly
files view shows changed files from read model
logs view shows command timeline by default
escalation center shows root cause/impact/evidence/action
dangerous action opens confirmation dialog
human directive goes through execution-service endpoint
brain/platform are secondary support namespaces
fake/static data is not used in production cockpit
```

---

# Part 12 — Acceptance Criteria

P42 is complete only if:

```txt
[ ] V3 docs are source of truth
[ ] App shell is decomposed
[ ] App.tsx is materially reduced
[ ] task -> run sidebar is primary navigation
[ ] permanent right sidebar is gone from default cockpit
[ ] primary tabs are Overview, Workspaces, Files, Logs, Escalations
[ ] Controls is not a primary tab
[ ] Mission Control Hero shows state/risk/next action
[ ] Workspace Board is grouped by state
[ ] Workspace click opens dedicated nested detail route
[ ] Workspace Detail shows current state, context, commands, files, transcript, validation, attempts, escalations
[ ] Files/Diff view answers "what changed?"
[ ] Files/Diff uses read model/API, not production UI git bypass
[ ] Logs view is command timeline by default
[ ] Raw logs are behind toggle/debug mode
[ ] Escalations show root cause, impact, evidence, retry budget, recommended action
[ ] Controls are contextual
[ ] Dangerous controls require confirmation
[ ] Control mutations go through execution-service
[ ] Brain/Platform are secondary/support namespaces
[ ] No fake/static production cockpit data remains
[ ] Loading/empty/error states exist for primary panels
[ ] Keyboard/focus basics work
[ ] make test passes
[ ] make test-full passes
[ ] final report exists
```

---

# Part 13 — Failure Conditions

P42 must be considered failed if any of these remain in the final cockpit:

```txt
workspace detail only opens as a large modal
Controls remains a primary tab
permanent right sidebar remains default cockpit layout
production panels use fake/static/demo data
UI directly mutates DB/state/control files
primary controls bypass execution-service
Files/Diff bypasses read model without legacy/debug marking
Logs remains raw-only
Escalations are only generic blocked cards
Brain/Platform compete with active execution
App.tsx grows further instead of being decomposed
make test-full fails
```

---

# Part 14 — Final Report Requirements

Write:

```txt
reports/p42-dashboard-v3/<timestamp>/summary.md
docs/pi/p42/p42-implementation-summary.md
```

Final report must include:

```txt
overall verdict
screens implemented
routes implemented
components created
components reused
components deprecated
App.tsx before/after size
read models used
fake/static data removed
control paths migrated
tests added
validation results
react-doctor result or skip reason
remaining risks
P43 recommendations
```

---

# Part 15 — ACCP-Lite Reporting Requirement

Every worker final report should include an ACCP-Lite section or artifact:

```txt
<ACCP type="IPR-Lite" version="1.0">
...
</ACCP>
```

Minimum requirements:

```txt
files changed
implementation summary
validation commands and exit codes
remaining risks
safe_to_continue yes/no/partial
```

Validation reports should use:

```txt
<ACCP type="TVR-Lite" version="1.0">
...
</ACCP>
```

Regression or bug analysis should use:

```txt
<ACCP type="RAR-Lite" version="1.0">
...
</ACCP>
```

---

# Part 16 — Part 3 JSON Execution Contract

```json
{
  "contractVersion": "4.1.1",
  "phase": "P42",
  "title": "Dashboard V3 Execution Cockpit Implementation",
  "status": "planned",
  "executionClass": "implementation",
  "selectedMode": "stable_3_dashboard_cockpit",
  "targetPromotionMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "expectedSafeEffectiveParallelism": 3,
  "jsonRuntimeFallbackAllowed": false,
  "sourceDocuments": {
    "authoritative": [
      "docs/pi/p42/proposed_interface_map_v3.md",
      "docs/pi/p42/pi_cockpit_v3_final_mockup.html",
      "docs/pi/p42/README.md"
    ],
    "ignoreForImplementationAuthority": [
      "docs/pi/p42/proposed-dashboard-v2.md",
      "docs/pi/p42/pi_cockpit_v3_no_rightsidebar.html"
    ]
  },
  "planExecution": {
    "phase": "P42",
    "title": "Dashboard V3 Execution Cockpit Implementation",
    "stateBackend": "postgres",
    "scale": "stable_3_harmony",
    "maxParallelWorkspaces": 3,
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
    "agentMutationAllowed": true,
    "uiDirectStateMutationAllowed": false
  },
  "frontendSkills": {
    "defaultForDashboardTasks": [
      "shadcn",
      "react-doctor",
      "vercel-react-best-practices",
      "vercel-composition-patterns",
      "web-design-guidelines"
    ],
    "explicitOnly": [
      "vercel-optimize",
      "vercel-react-view-transitions",
      "deploy-to-vercel",
      "vercel-cli-with-tokens"
    ],
    "disabledForThisPhase": [
      "vercel-react-native-skills"
    ]
  },
  "workspaces": [
    {
      "id": "P42.00",
      "title": "V3 Source Lock and Baseline Audit",
      "goal": "Lock V3 docs as source-of-truth and create a precise baseline before changing production UI.",
      "executorPrompt": "Read docs/pi/p42/proposed_interface_map_v3.md, docs/pi/p42/pi_cockpit_v3_final_mockup.html, and docs/pi/p42/README.md as authoritative. Do not use V2 or older dashboard summaries as implementation authority. Audit current dashboard and backend surfaces and create docs/pi/p42/p42-baseline-audit.md plus reports/p42-dashboard-v3/<timestamp>/baseline-audit.md.",
      "skills": [
        "vercel-react-best-practices",
        "vercel-composition-patterns",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "docs/pi/p42/**",
          "reports/p42-dashboard-v3/**"
        ],
        "canRun": [
          "grep",
          "find",
          "make test"
        ]
      },
      "dependencies": []
    },
    {
      "id": "P42.01",
      "title": "Read Model Stub Completion and API Contract Hardening",
      "goal": "Fix or harden read-model/API surfaces required by V3 so UI panels consume real execution truth.",
      "executorPrompt": "Implement or harden read-model/query surfaces for plan summary, stats, workspace summary, dependency graph, worker context, command history, changed files, file tree, file content, file diff, escalations, directives, final validation, artifacts, and transcripts. Do not fake missing data; return explicit unavailable states and document missing sources.",
      "skills": [
        "vercel-react-best-practices"
      ],
      "capabilities": {
        "canEdit": [
          "packages/execution-core/src/read-model.ts",
          "packages/execution-core/src/file-tree.ts",
          "packages/execution-core/src/**",
          "packages/execution-service/src/query-handler.ts",
          "packages/execution-service/src/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/api/**",
          "packages/web-ui/dashboard/src/hooks/**",
          "docs/pi/p42/**",
          "reports/p42-dashboard-v3/**"
        ],
        "canRun": [
          "make test",
          "npm run test -w packages/execution-service",
          "npm run test -w packages/execution-core"
        ]
      },
      "dependencies": [
        {
          "id": "P42.00",
          "type": "hard",
          "reason": "Requires baseline audit."
        }
      ]
    },
    {
      "id": "P42.02",
      "title": "Unified Control Path Through Execution-Service",
      "goal": "Ensure V3 control actions have one safe mutation path through execution-service.",
      "executorPrompt": "Audit existing controls and map plan/workspace/escalation actions through execution-service-backed endpoints. Create docs/pi/p42/control-action-safety-matrix.md. Dangerous actions require confirmation and impact summary.",
      "skills": [
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/execution-core/src/**",
          "packages/execution-service/src/command-handler.ts",
          "packages/execution-service/src/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/hooks/useHumanDirectives.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanRunner.ts",
          "packages/web-ui/dashboard/src/api/**",
          "packages/web-ui/dashboard/src/components/ControlActionsPanel.tsx",
          "packages/web-ui/dashboard/src/components/HumanDirectivePanel.tsx",
          "docs/pi/p42/**",
          "reports/p42-dashboard-v3/**"
        ],
        "canRun": [
          "make test"
        ]
      },
      "dependencies": [
        {
          "id": "P42.00",
          "type": "hard",
          "reason": "Requires baseline audit."
        }
      ]
    },
    {
      "id": "P42.03",
      "title": "App Shell and Navigation Cleanup",
      "goal": "Create V3 shell/navigation and reduce App.tsx responsibilities.",
      "executorPrompt": "Implement AppShell, TopbarV3, TaskRunSidebar, CenterWorkSurface, StatusBarV3, ContextualRightDrawer, CockpitTabs, and breadcrumb/route state. Remove old Browse/Queue/Chat sidebar from primary path and remove permanent right sidebar from default cockpit.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "vercel-composition-patterns",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/app/**",
          "packages/web-ui/dashboard/src/components/shell/**",
          "packages/web-ui/dashboard/src/components/topbar/**",
          "packages/web-ui/dashboard/src/components/sidebar/**",
          "packages/web-ui/dashboard/src/components/statusbar/**",
          "packages/web-ui/dashboard/src/navigation/**",
          "packages/web-ui/dashboard/src/routes/**",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-ui/dashboard/src/app.css",
          "docs/pi/p42/**",
          "reports/p42-dashboard-v3/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard",
          "npm run build -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.01",
          "type": "hard",
          "reason": "Shell must avoid fake/stub data wiring."
        },
        {
          "id": "P42.02",
          "type": "soft",
          "reason": "Topbar controls depend on control path mapping."
        }
      ]
    },
    {
      "id": "P42.04",
      "title": "Mission Control Overview",
      "goal": "Implement Overview/Mission Control as the default execution cockpit landing page.",
      "executorPrompt": "Create MissionControlHero, MetricsStrip, WorkspacePreview, PriorityFeed, NextActionCard, CurrentBottleneckSummary, LatestEscalationSummary, and ValidationStatusSummary. Cover all hero states and hide raw events behind debug/expand controls.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/execution-overview/**",
          "packages/web-ui/dashboard/src/components/mission-control/**",
          "packages/web-ui/dashboard/src/components/StatCard.tsx",
          "packages/web-ui/dashboard/src/hooks/usePlanExecutions.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanStats.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanEvents.ts",
          "packages/web-ui/dashboard/src/hooks/useEscalations.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-ui/dashboard/src/app.css",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.03",
          "type": "hard",
          "reason": "Overview renders inside V3 shell."
        }
      ]
    },
    {
      "id": "P42.05",
      "title": "Workspace Board",
      "goal": "Implement grouped workspace board with actionable cards.",
      "executorPrompt": "Create WorkspaceBoard, WorkspaceGroup, WorkspaceCardV3, WorkspaceStatusBadge, and WorkspaceCardActions. Group by Attention/Blocked, Running, Ready, Completed, and Failed. Card body navigates to workspace detail route.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/workspaces/**",
          "packages/web-ui/dashboard/src/components/WorkerList.tsx",
          "packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts",
          "packages/web-ui/dashboard/src/hooks/useWorkerContext.ts",
          "packages/web-ui/dashboard/src/hooks/useEscalations.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-ui/dashboard/src/app.css",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.03",
          "type": "hard",
          "reason": "Workspace board depends on shell/route model."
        }
      ]
    },
    {
      "id": "P42.06",
      "title": "Dedicated Workspace Detail Route",
      "goal": "Implement nested workspace detail page.",
      "executorPrompt": "Create WorkspaceDetailPage with Header, Current State, Prompt/Context Summary, Command History, File Changes, Transcript, Validation Evidence, Attempt History, and Escalations/Directives. Use route, not large modal, as the primary detail UX.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "vercel-composition-patterns",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/pages/workspace/**",
          "packages/web-ui/dashboard/src/components/workspace-detail/**",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerContextInspector.tsx",
          "packages/web-ui/dashboard/src/components/LiveLogTerminal.tsx",
          "packages/web-ui/dashboard/src/hooks/useWorkerContext.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanTranscript.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts",
          "packages/web-ui/dashboard/src/hooks/useEscalations.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.05",
          "type": "hard",
          "reason": "Workspace cards route to the detail page."
        },
        {
          "id": "P42.01",
          "type": "hard",
          "reason": "Detail panels need real read models."
        },
        {
          "id": "P42.02",
          "type": "soft",
          "reason": "Workspace controls attach to detail page."
        }
      ]
    },
    {
      "id": "P42.07",
      "title": "Files / Diff IDE Workspace",
      "goal": "Implement first-class Files/Diff cockpit.",
      "executorPrompt": "Create an execution-aware Files view with file tree, statuses, last writer, related workspace, related command, related validation, preview, unified diff, copy diff, patch download, and links to workspace/log evidence.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/files/**",
          "packages/web-ui/dashboard/src/components/FileExplorer.tsx",
          "packages/web-ui/dashboard/src/components/DiffViewer.tsx",
          "packages/web-ui/dashboard/src/hooks/useFileTree*.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanWorkspaces.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-server/src/**",
          "packages/execution-service/src/query-handler.ts",
          "packages/execution-core/src/read-model.ts",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.01",
          "type": "hard",
          "reason": "Files view must use real read-model/API data."
        },
        {
          "id": "P42.03",
          "type": "hard",
          "reason": "Files route depends on shell/routes."
        }
      ]
    },
    {
      "id": "P42.08",
      "title": "Logs / Command Timeline",
      "goal": "Implement command timeline as default Logs view.",
      "executorPrompt": "Create CommandTimelineView, filters, command row, command detail panel, and raw output toggle. Default is timeline; raw terminal is debug/detail mode.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/logs/**",
          "packages/web-ui/dashboard/src/components/LiveLogTerminal.tsx",
          "packages/web-ui/dashboard/src/components/LogViewer.tsx",
          "packages/web-ui/dashboard/src/hooks/useLiveLogTerminal.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanEvents.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-server/src/**",
          "packages/execution-service/src/query-handler.ts",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.01",
          "type": "hard",
          "reason": "Timeline needs command history/read-model data."
        },
        {
          "id": "P42.03",
          "type": "hard",
          "reason": "Logs route depends on shell/routes."
        }
      ]
    },
    {
      "id": "P42.09",
      "title": "Escalation / Root-Cause Action Center",
      "goal": "Implement escalation/action center that shows root cause, impact, evidence, and next action.",
      "executorPrompt": "Create EscalationCenter, EscalationCardV3, DeadlockDependencyPanel, RecommendedActionsPanel, HumanDirectiveInput, and EscalationEvidenceList. Controls must go through execution-service.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/escalations/**",
          "packages/web-ui/dashboard/src/components/LeadEscalationPanel.tsx",
          "packages/web-ui/dashboard/src/components/BlockedReasonPanel.tsx",
          "packages/web-ui/dashboard/src/hooks/useEscalations.ts",
          "packages/web-ui/dashboard/src/hooks/useHumanDirectives.ts",
          "packages/web-ui/dashboard/src/hooks/usePlanEvents.ts",
          "packages/web-ui/dashboard/src/types.ts",
          "packages/web-server/src/**",
          "packages/execution-service/src/**",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.01",
          "type": "hard",
          "reason": "Escalation center needs real escalation/dependency read models."
        },
        {
          "id": "P42.02",
          "type": "hard",
          "reason": "Actions must go through execution-service."
        },
        {
          "id": "P42.06",
          "type": "soft",
          "reason": "Escalations should link to workspace detail."
        }
      ]
    },
    {
      "id": "P42.10",
      "title": "Brain / Platform Regrouping and Contextual Drawers",
      "goal": "Move Brain/Platform into support namespaces and implement contextual drawers.",
      "executorPrompt": "Regroup Brain and Platform under secondary/support namespaces. Implement TranscriptDrawer, ArtifactDrawer, DebugEventDrawer, FileEvidenceDrawer, and DirectiveDrawer if needed. Permanent right sidebar must not be default cockpit layout.",
      "skills": [
        "shadcn",
        "vercel-react-best-practices",
        "vercel-composition-patterns",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/brain/**",
          "packages/web-ui/dashboard/src/features/**",
          "packages/web-ui/dashboard/src/pages/**",
          "packages/web-ui/dashboard/src/components/drawers/**",
          "packages/web-ui/dashboard/src/components/ArtifactBrowser.tsx",
          "packages/web-ui/dashboard/src/components/ChatPanel.tsx",
          "packages/web-ui/dashboard/src/components/right-sidebar/**",
          "packages/web-ui/dashboard/src/navigation/**",
          "packages/web-ui/dashboard/src/routes/**",
          "packages/web-ui/dashboard/src/types.ts",
          "docs/pi/p42/**"
        ],
        "canRun": [
          "make test",
          "npm run check -w packages/web-ui/dashboard"
        ]
      },
      "dependencies": [
        {
          "id": "P42.03",
          "type": "hard",
          "reason": "Support namespaces depend on V3 shell/navigation."
        }
      ]
    },
    {
      "id": "P42.11",
      "title": "Legacy Deprecation, QA, A11y, React Doctor, Final Report",
      "goal": "Remove or mark legacy paths, finish quality, add tests, run audits, and write final report.",
      "executorPrompt": "Remove or mark old primary sidebar/right-sidebar/Controls tab paths, detect fake/static production data, add critical flow tests, verify keyboard/focus/accessibility basics, run react-doctor if available and safe, then write final P42 reports.",
      "skills": [
        "shadcn",
        "react-doctor",
        "vercel-react-best-practices",
        "vercel-composition-patterns",
        "web-design-guidelines"
      ],
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/**",
          "packages/web-ui/dashboard/test/**",
          "packages/web-ui/dashboard/tests/**",
          "packages/web-ui/dashboard/__tests__/**",
          "docs/pi/p42/**",
          "reports/p42-dashboard-v3/**"
        ],
        "canRun": [
          "make test",
          "make test-full",
          "npm run check -w packages/web-ui/dashboard",
          "npm run build -w packages/web-ui/dashboard",
          "npx react-doctor@latest"
        ]
      },
      "dependencies": [
        {
          "id": "P42.04",
          "type": "hard",
          "reason": "Final QA needs overview."
        },
        {
          "id": "P42.05",
          "type": "hard",
          "reason": "Final QA needs workspace board."
        },
        {
          "id": "P42.06",
          "type": "hard",
          "reason": "Final QA needs workspace detail route."
        },
        {
          "id": "P42.07",
          "type": "hard",
          "reason": "Final QA needs files/diff view."
        },
        {
          "id": "P42.08",
          "type": "hard",
          "reason": "Final QA needs command timeline."
        },
        {
          "id": "P42.09",
          "type": "hard",
          "reason": "Final QA needs escalation center."
        },
        {
          "id": "P42.10",
          "type": "soft",
          "reason": "Final QA should include support namespace polish."
        }
      ]
    }
  ],
  "acceptanceCriteria": {
    "workspaceDetailDedicatedRoute": true,
    "controlsNotPrimaryTab": true,
    "rightSidebarNotDefault": true,
    "filesDiffFirstClass": true,
    "logsCommandTimelineDefault": true,
    "escalationsRootCauseAction": true,
    "brainPlatformSecondary": true,
    "noProductionFakeData": true,
    "controlMutationsThroughExecutionService": true,
    "makeTestRequired": true,
    "makeTestFullRequired": true
  }
}
```

---

# Part 17 — Operator Notes

## Recommended First Prompt

Use this plan as the P42 implementation plan.

Start with P42.00 only.

Do not begin implementation work before the baseline audit is written and read.

## Recommended Runtime

```txt
stable_3
maxParallelWorkspaces = 3
worktree.enabled = false
patchTransactionDefault = false
```

## Recommended Stop Conditions

Stop and ask for human review if:

```txt
App.tsx decomposition breaks app startup
read-model stubs cannot be fixed without runtime rewrite
control actions cannot route through execution-service
workspace detail route requires a major router migration
make test fails after two repair attempts
make test-full fails final gate
```

---

# End of P42 Plan

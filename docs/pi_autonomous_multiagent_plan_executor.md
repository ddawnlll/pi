````markdown
# Phase P2 — Pi Autonomous Multiagent Plan Executor

**Author:** GPT-5.5 Planning Agent  
**Template:** LLM Implementation Agent — Master Template v2  
**Created:** 2026-05-10  
**Target system:** Pi autonomous coding runtime  
**Goal:** Transform Pi from a budget-safe single-agent runtime into a fully autonomous bounded multi-agent implementation executor using Master Template v2 plans.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P2 — Pi Autonomous Multiagent Plan Executor  
**One-line goal:** Allow Pi to autonomously parse implementation plans, schedule workspaces, execute coding tasks with multiple workers, test/fix/review automatically, commit completed workspaces, and continue until plan completion.  
**Why now:** P1 established the token/context safety foundation. Pi can now safely execute bounded autonomous multi-agent loops without Hermes-style context explosion.  
**Blast radius:** Pi runtime/execution/scheduler/state/report/CLI layers only. No product application source should be changed directly by P2 implementation itself.  
**Rollback path:** Disable autonomous execution and revert to P1 single-agent behavior.  
**Done when:** Pi can read a Master Template v2 plan, generate a workspace queue, run autonomous multi-agent execution loops with bounded context, retry failures automatically, commit completed workspaces, and finish the entire plan without human interruption unless safety conditions are triggered.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P2 |
| Title | Pi Autonomous Multiagent Plan Executor |
| Status | Planned |
| Last updated | 2026-05-10 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Autonomous execution + bounded multi-agent scheduling |
| Product-code changes | Forbidden in P2 implementation phase |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| A — Plan Parser | Pi Worker Agent | User / owner | Reviewer | Workers |
| B — Workspace Schema | Pi Worker Agent | User / owner | Reviewer | Workers |
| C — State & Reports | Pi Worker Agent | User / owner | Reviewer | User |
| D — DAG Scheduler | Pi Worker Agent | User / owner | Reviewer | Workers |
| E — Packet Builders | Pi Worker Agent | User / owner | Reviewer | Workers |
| F — Autonomous Loop | Pi Worker Agent | User / owner | Reviewer | User |
| G — 3-Worker Scheduler | Pi Worker Agent | User / owner | Reviewer | User |
| H — Retry/Test Loop | Pi Worker Agent | User / owner | Reviewer | Workers |
| I — Auto Commit | Pi Worker Agent | User / owner | Reviewer | User |
| J — Doctor/Safety | Pi Worker Agent | User / owner | Reviewer | User |
| K — CLI Commands | Pi Worker Agent | User / owner | Reviewer | User |
| L — End-to-End Dry Run | Worker + Reviewer | User / owner | — | User |

---

## 2. Purpose

P2 upgrades Pi into a fully autonomous multi-agent coding executor.

Pi should:

```text
read plan
→ analyze
→ ask questions before execution if ambiguity exists
→ create workspace queue
→ schedule workers
→ implement
→ test
→ retry/fix automatically
→ review
→ commit
→ continue
→ finish plan
````

P2 MUST remain bounded and budget-safe using the P1 gateway.

---

## 3. What Carried Over — Must Stay Stable

* [x] P1 token budget gateway is mandatory.
* [x] 1M context disabled by default.
* [x] Large-file full injection forbidden by default.
* [x] Full repo injection forbidden by default.
* [x] Full chat history injection forbidden by default.
* [x] Master Template v2 remains the authority format.
* [x] Part 3 JSON queue is the machine execution source.
* [x] P2 must not bypass P1 budget enforcement.

---

## 4. Background / What Was Wrong

Hermes-style orchestration became extremely expensive because every agent saw too much context:

```text
canon + memory + huge prompts + full plans + session history + orchestration
```

P2 solves this by:

```text
workspace isolation
+ packetized execution
+ bounded workers
+ token gateway
+ chunked retrieval
+ state summaries
+ file locks
```

Workers should never see the whole plan or repo unless explicitly required.

---

## 5. Current Failure State / Known Blockers

* `plan_parser` = `not implemented`
* `workspace_queue` = `not implemented`
* `dependency_dag` = `not implemented`
* `autonomous_loop` = `not implemented`
* `multi_worker_scheduler` = `not implemented`
* `auto_retry_loop` = `not implemented`
* `state_json` = `not implemented`
* `report_system` = `not implemented`
* `auto_commit` = `not implemented`
* `resume/recovery` = `not implemented`

---

## 6. Risk Register

| Risk                                     | Likelihood |   Impact | Mitigation                           |
| ---------------------------------------- | ---------: | -------: | ------------------------------------ |
| Worker conflicts                         |        med |     high | file ownership locks                 |
| Retry loops spiral                       |        med |      med | retry counters + reviewer escalation |
| Parallel edits corrupt files             |        low |     high | no same-file parallelism             |
| Autonomous bad commits                   |        med |     high | reviewer gate before commit          |
| Plan ambiguity causes bad implementation |        med |     high | ask before execution start           |
| Scheduler deadlock                       |        low |      med | DAG validation + cycle detection     |
| Context budgets bypassed                 |        low | critical | mandatory P1 gateway                 |
| Infinite autonomous loop                 |        low |     high | watchdog + retry ceilings            |

---

## 7. Workstreams

### 7.A — Plan Parser + JSON Queue

Goal:
Parse Master Template v2 plans.

Requirements:

* Part 3 JSON queue first
* Markdown heading fallback only
* Placeholder detection
* Schema validation

Acceptance criteria:

* parses valid Part 3 JSON queue
* fallback heading parser works
* unresolved placeholders fail doctor
* malformed queue fails safely

---

### 7.B — Workspace Schema + Validation

Goal:
Create normalized workspace schema.

Schema fields:

* id
* title
* dependencies
* allowedFiles
* forbiddenFiles
* acceptanceCriteria
* targetCommand
* roleBudget
* maxRetries
* riskLevel

Acceptance criteria:

* schema validation exists
* dependency validation exists
* duplicate workspace IDs fail
* invalid roleBudget fails

---

### 7.C — State Store + Report System

Goal:
Replace giant chat history with compact machine state.

State:

* pending
* active
* complete
* blocked
* failed
* attempts
* timestamps
* report paths

Reports:

* worker report
* flash report
* reviewer report
* final phase report

Acceptance criteria:

* state survives restart
* reports written per workspace
* resume restores state correctly

---

### 7.D — Dependency DAG + File Locks

Goal:
Safe bounded scheduling.

Rules:

* no same-file parallelism
* dependency-aware execution
* cycle detection
* blocked workspace propagation

Acceptance criteria:

* dependency graph executes correctly
* cycles fail safely
* same-file conflicts blocked
* unrelated workspaces can run in parallel

---

### 7.E — Agent Role Packet Builders

Goal:
Generate compact role-specific packets.

Roles:

* Worker
* Flash
* Reviewer

Requirements:

* current workspace only
* summarized state only
* no full plan
* no full repo
* P1 budget enforced

Acceptance criteria:

* worker packets under budget
* flash packets use diff/test excerpts only
* reviewer packets contain reports + changed hunks only

---

### 7.F — Autonomous Execution Loop

Goal:
Run plans automatically end-to-end.

Flow:

```text
analyze
→ execute
→ test
→ retry/fix
→ review
→ commit
→ continue
```

Acceptance criteria:

* autonomous run works
* loop continues without interruption
* ambiguity questions only asked before execution start
* completed workspace advances queue

---

### 7.G — 3-Worker Scheduler

Goal:
Enable bounded parallelism.

Defaults:

```yaml
workers_default: 3
workers_hard_cap: 3
same_file_parallelism: false
```

Acceptance criteria:

* 3 workers run concurrently
* scheduler respects locks
* scheduler respects dependencies
* risky workspaces serialize automatically

---

### 7.H — Retry/Test/Fix Loop

Goal:
Allow autonomous recovery from failures.

Defaults:

```yaml
test_fail_retries: 10
lint_fail_retries: 10
type_fail_retries: 10
review_fix_retries: 3
```

Acceptance criteria:

* test failures retry automatically
* flash agent can apply trivial fixes
* retries tracked in state
* exhausted retries escalate to reviewer

---

### 7.I — Auto Commit System

Goal:
Commit completed workspaces automatically.

Rules:

* commit after reviewer approval
* no auto push
* no auto merge

Commit examples:

```text
feat(p2): complete workspace 7.A parser
fix(p2): complete workspace 7.D scheduler
test(p2): complete workspace 7.L dry run
```

Acceptance criteria:

* workspace commits generated automatically
* commit skipped on failed review
* no git push occurs

---

### 7.J — Doctor + Safety Gates

Goal:
Prevent dangerous autonomous behavior.

Hard stops:

* secrets/env access
* destructive ops
* forbidden file edits
* unresolved placeholders
* budget violations
* security ambiguity

Acceptance criteria:

* unsafe behavior blocked
* doctor validates runtime
* safety events logged

---

### 7.K — CLI Commands

Required commands:

```bash
pi plan doctor
pi plan status
pi plan run
pi plan resume
pi plan one
pi plan dry-run
```

Acceptance criteria:

* commands work
* status reflects state.json
* dry-run performs no writes
* resume restores execution

---

### 7.L — End-to-End Dry Run

Goal:
Validate full autonomous loop.

Scenarios:

* synthetic small plan
* 5000-line file task
* retry loop
* worker conflict
* reviewer rejection
* resume after interruption

Acceptance criteria:

* complete autonomous flow works
* P1 budgets enforced
* no full repo injection
* no full chat history injection
* no same-file corruption

---

## 8. Combined Implementation Order

```text
A → B → C → D → E → F → G → H → I → J → K → L
```

---

## 9. Definition of Done

P2 is complete when ALL are true:

* Pi parses Master Template v2 plans.
* Pi executes workspace queues autonomously.
* 3-worker scheduler works safely.
* File locks prevent same-file corruption.
* P1 budget gateway cannot be bypassed.
* Retry/test/fix loop works automatically.
* Auto commits work.
* Resume/recovery works.
* Dry-run works.
* End-to-end tests pass.

---

## 10. Rollback Playbook

Trigger:

* runaway autonomous loops
* corrupted workspace state
* unsafe edits
* scheduler instability

Rollback:

1. disable autonomous mode
2. disable scheduler
3. revert P2 commits
4. restore P1 single-agent mode

---

## 11. What Phase P3 Inherits

P3 inherits:

* plan parser
* queue system
* scheduler
* autonomous execution loop
* retry/review system
* state/report layer

P3 may add:

* semantic retrieval
* repo graphing
* smarter planning
* advanced reasoning
* vector indexing

---

# Part 2 — Agent Brief

## Mission

Implement P2 — Pi Autonomous Multiagent Plan Executor.

You are building a bounded autonomous multi-agent coding runtime using P1 token safety guarantees.

---

## Hard Requirements

1. P1 budget gateway mandatory.
2. No bypass around provider enforcement.
3. No full repo injection.
4. No full chat history injection.
5. No same-file parallel edits.
6. No auto push.
7. No 1M context default.
8. Ask ambiguity questions only before execution starts.
9. Auto commit after approved workspace.
10. Fully autonomous execution loop.

---

## Parallelism Rules

```yaml
default_workers: 3
hard_cap_workers: 3
same_file_parallelism: false
```

---

## Retry Rules

```yaml
test_fail_retries: 10
lint_fail_retries: 10
type_fail_retries: 10
review_fix_retries: 3
```

---

## Safety Stops

Hard stop only for:

* secrets/env access
* destructive commands
* forbidden files
* unresolved placeholders
* unresolved security ambiguity
* budget violations

Normal test/code failures must retry automatically.

---

# Part 3 — Pi Workspace Queue

```json
{
  "phase": "P2",
  "title": "Pi Autonomous Multiagent Plan Executor",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Plan Parser + JSON Queue",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.B",
      "title": "Workspace Schema + Validation",
      "dependencies": ["7.A"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.C",
      "title": "State Store + Report System",
      "dependencies": ["7.B"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.D",
      "title": "Dependency DAG + File Locks",
      "dependencies": ["7.B"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.E",
      "title": "Agent Role Packet Builders",
      "dependencies": ["7.C", "7.D"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.F",
      "title": "Autonomous Execution Loop",
      "dependencies": ["7.E"],
      "roleBudget": "lead",
      "maxRetries": 3
    },
    {
      "id": "7.G",
      "title": "3-Worker Scheduler",
      "dependencies": ["7.D", "7.F"],
      "roleBudget": "lead",
      "maxRetries": 3
    },
    {
      "id": "7.H",
      "title": "Retry/Test/Fix Loop",
      "dependencies": ["7.F"],
      "roleBudget": "flash",
      "maxRetries": 10
    },
    {
      "id": "7.I",
      "title": "Auto Commit System",
      "dependencies": ["7.G"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.J",
      "title": "Doctor + Safety Gates",
      "dependencies": ["7.G"],
      "roleBudget": "reviewer",
      "maxRetries": 3
    },
    {
      "id": "7.K",
      "title": "CLI Commands",
      "dependencies": ["7.I", "7.J"],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.L",
      "title": "End-to-End Dry Run",
      "dependencies": ["7.K", "7.H"],
      "roleBudget": "reviewer",
      "maxRetries": 1
    }
  ]
}
```

# Part 4 — Autonomous Loop Policy

```text
Pi must:
- run autonomously
- retry failures automatically
- continue after successful workspaces
- commit approved workspaces automatically
- maintain state/report history
- respect dependency DAG
- respect file ownership locks
- respect P1 token budgets
```

---

# Part 5 — Machine-Readable Summary

```json
{
  "phase": "P2",
  "title": "Pi Autonomous Multiagent Plan Executor",
  "goal": "Transform Pi into a fully autonomous bounded multi-agent implementation runtime.",
  "workersDefault": 3,
  "sameFileParallelism": false,
  "autoCommit": true,
  "autoPush": false,
  "retryPolicy": {
    "testFail": 10,
    "lintFail": 10,
    "typeFail": 10,
    "reviewFix": 3
  },
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "security_ambiguity"
  ],
  "inherits": [
    "P1 token gateway",
    "P1 file policy",
    "P1 doctor",
    "P1 token reporting"
  ]
}
```

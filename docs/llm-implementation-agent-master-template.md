# LLM Implementation Agent — Master Template v2

**Version:** 2.1.0
**Last Updated:** 2026-05-11
**Purpose:** Canonical template for creating executable implementation plans for Pi autonomous multi-agent execution with PostgreSQL-backed multi-project support

---

## Overview

This template provides a structured format for creating implementation plans that can be:
1. **Read by humans** for reasoning, risk assessment, and decision-making
2. **Parsed by Pi** for autonomous multi-agent execution

The template balances human authority (markdown prose) with machine executability (JSON workspace queues).

---

## How to Use This Template

1. **Fill Part 1 — Phase Plan**: Define goals, risks, workstreams, and implementation order
2. **Fill Part 2 — Agent Brief**: Provide mission, hard requirements, and execution policies
3. **Fill Part 3 — Machine-Readable Execution Contract**: Define the executable contract with project, plan execution, and workspace details in valid JSON
4. **Fill Part 4 — Machine-Readable Summary**: Provide phase-level execution metadata
5. **Review validation rules**: Ensure JSON is valid and all placeholders are resolved

### Critical Requirements

- **Every executable plan MUST include valid JSON in Part 3**
- **Markdown remains human authority**; Part 3 JSON is the execution contract
- **For autonomous execution, Part 3 JSON is mandatory**
- **Unresolved `{{ placeholders }}` make the plan non-executable**
- Pi will parse Part 3 JSON first; markdown heading fallback is recovery mode only
- **PostgreSQL backend uses project/plan/workspace hierarchy** for multi-project execution
- **Dashboard enabled by default** for real-time monitoring via web UI

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `{{ Phase ID }}`  
**One-line goal:** `{{ Single sentence describing what this phase accomplishes }}`  
**Why now:** `{{ Why this phase is being executed at this point }}`  
**Blast radius:** `{{ What systems/files/components will be affected }}`  
**Rollback path:** `{{ How to safely revert if things go wrong }}`  
**Done when:** `{{ Clear definition of completion criteria }}`

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `{{ Phase ID }}` |
| Title | `{{ Phase Title }}` |
| Status | `{{ Planned / In Progress / Complete }}` |
| Last updated | `{{ YYYY-MM-DD }}` |
| Delivery status | `{{ Not started / In progress / Complete }}` |
| Target environment | `{{ Local / Staging / Production }}` |
| Primary focus | `{{ Main technical focus area }}` |
| Product-code changes | `{{ Allowed / Forbidden / Restricted }}` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| `{{ Workstream ID }}` — `{{ Title }}` | `{{ Role }}` | `{{ Role }}` | `{{ Role }}` | `{{ Role }}` |

---

## 2. Purpose

`{{ Describe the purpose of this phase in 2-4 paragraphs. What problem does it solve? What capabilities does it enable? }}`

---

## 3. What Carried Over — Must Stay Stable

List all constraints, policies, and systems that MUST remain stable:

* [ ] `{{ Constraint or policy that must not be violated }}`
* [ ] `{{ System or component that must remain unchanged }}`
* [ ] `{{ Safety guarantee that must be preserved }}`

---

## 4. Background / What Was Wrong

`{{ Explain the problem state that motivated this phase. What was broken, inefficient, or missing? }}`

---

## 5. Current Failure State / Known Blockers

List all known blockers and unimplemented components:

* `{{ component_name }}` = `{{ not implemented / broken / incomplete }}`
* `{{ system_name }}` = `{{ not implemented / broken / incomplete }}`

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `{{ Risk description }}` | `{{ low / med / high }}` | `{{ low / med / high / critical }}` | `{{ Mitigation strategy }}` |

---

## 7. Workstreams

### 7.A — `{{ Workstream Title }}`

**Goal:** `{{ What this workstream accomplishes }}`

**Requirements:**
* `{{ Requirement 1 }}`
* `{{ Requirement 2 }}`

**Acceptance Criteria:**
* `{{ Criterion 1 }}`
* `{{ Criterion 2 }}`

---

### 7.B — `{{ Workstream Title }}`

**Goal:** `{{ What this workstream accomplishes }}`

**Requirements:**
* `{{ Requirement 1 }}`
* `{{ Requirement 2 }}`

**Acceptance Criteria:**
* `{{ Criterion 1 }}`
* `{{ Criterion 2 }}`

---

`{{ Repeat for all workstreams }}`

---

## 8. Combined Implementation Order

```text
{{ A → B → C → D → ... }}
```

`{{ Explain the dependency chain and why this order is required }}`

---

## 9. Definition of Done

`{{ Phase ID }}` is complete when ALL are true:

* [ ] `{{ Completion criterion 1 }}`
* [ ] `{{ Completion criterion 2 }}`
* [ ] `{{ Completion criterion 3 }}`

---

## 10. Rollback Playbook

**Trigger conditions:**
* `{{ Condition that triggers rollback }}`
* `{{ Condition that triggers rollback }}`

**Rollback procedure:**
1. `{{ Step 1 }}`
2. `{{ Step 2 }}`
3. `{{ Step 3 }}`

---

## 11. What Next Phase Inherits

`{{ Next Phase ID }}` inherits:
* `{{ System or component }}`
* `{{ System or component }}`

`{{ Next Phase ID }}` may add:
* `{{ New capability }}`
* `{{ New capability }}`

---

# Part 2 — Agent Brief

## Mission

`{{ Clear mission statement for the implementing agent }}`

---

## Hard Requirements

1. `{{ Non-negotiable requirement 1 }}`
2. `{{ Non-negotiable requirement 2 }}`
3. `{{ Non-negotiable requirement 3 }}`

---

## Execution Policies

`{{ Define any execution-specific policies, such as parallelism rules, retry policies, safety stops, etc. }}`

Example:

```yaml
default_workers: 3
hard_cap_workers: 3
same_file_parallelism: false
auto_commit: true
auto_push: false
```

---

## Safety Stops

Hard stop execution only for:
* `{{ Safety condition 1 }}`
* `{{ Safety condition 2 }}`
* `{{ Safety condition 3 }}`

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract for Pi's PostgreSQL-backed multi-project autonomous execution system. Pi parses this section first to build the execution plan.

**Validation:** This JSON must be valid and complete before execution begins. Use `pi plan doctor` to validate.

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "postgres",
  "project": {
    "name": "{{ project_name }}",
    "rootPath": "{{ absolute_or_repo_relative_path }}",
    "type": "repo",
    "tags": []
  },
  "planExecution": {
    "phase": "{{ N }}",
    "title": "{{ Short Title }}",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "paused_or_stopped_only"
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "budget_violations",
      "dependency_cycles"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish",
      "terraform destroy",
      "kubectl delete"
    ],
    "forbiddenFiles": [
      ".env*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/id_rsa",
      "**/credentials/**",
      "**/secrets/**"
    ]
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "{{ Workstream title }}",
      "dependencies": [],
      "allowedFiles": [],
      "forbiddenFiles": [],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    }
  ]
}
```

## Field Definitions

### Contract Metadata

- **`contractVersion`** (string, required): Version of the execution contract schema. Must be `"2.1.0"` for PostgreSQL multi-project execution.
- **`executionBackend`** (string, required): Backend system for execution. Must be `"postgres"` or `"json"`.

### Project Configuration

- **`project.name`** (string, required): Project name for database identification
- **`project.rootPath`** (string, required): Absolute or repository-relative path to project root
- **`project.type`** (string, required): Project type, must be `"repo"`
- **`project.tags`** (array of strings, optional): Tags for categorization

### Plan Execution Configuration

- **`planExecution.phase`** (string, required): Phase identifier matching Part 1
- **`planExecution.title`** (string, required): Phase title matching Part 1
- **`planExecution.mode`** (string, required): Must be `"autonomous"`
- **`planExecution.maxParallelWorkspaces`** (number, required): Maximum concurrent workspaces (1-3)
- **`planExecution.stateBackend`** (string, required): Must be `"postgres"` or `"json"`
- **`planExecution.jsonFallbackEnabled`** (boolean, required): Enable JSON fallback if PostgreSQL unavailable
- **`planExecution.dashboardEnabled`** (boolean, required): Enable real-time dashboard monitoring
- **`planExecution.autoCommit`** (boolean, required): Auto-commit completed workspaces
- **`planExecution.autoPush`** (boolean, required): Auto-push commits (must default `false`)

### Control Configuration

- **`controls.allowPause`** (boolean, required): Allow execution pause
- **`controls.allowStop`** (boolean, required): Allow execution stop
- **`controls.allowCancel`** (boolean, required): Allow execution cancel
- **`controls.resumePolicy`** (string, required): Must be `"paused_or_stopped_only"`

### Safety Configuration

- **`safety.hardStops`** (array, required): Must include `"secrets"`, `"destructive_ops"`, `"forbidden_files"`, `"budget_violations"`, `"dependency_cycles"`
- **`safety.forbiddenCommands`** (array, required): Must include `"git push"`, `"rm -rf"`, `"npm publish"`, etc.
- **`safety.forbiddenFiles`** (array, required): Must include `".env*"`, `"**/*.pem"`, `"**/*.key"`, credential paths

### Workspace Fields

- **`id`** (string, required): Unique workspace identifier
- **`title`** (string, required): Short descriptive title
- **`dependencies`** (array, required): Workspace IDs that must complete first
- **`allowedFiles`** (array, optional): Glob patterns for allowed file modifications
- **`forbiddenFiles`** (array, optional): Glob patterns for forbidden files
- **`acceptanceCriteria`** (array, required): Completion criteria
- **`targetCommand`** (string or null): Validation command
- **`roleBudget`** (string, required): One of `"flash"`, `"worker"`, `"lead"`, `"reviewer"`, `"debug"`
- **`maxRetries`** (number, required): Maximum retry attempts
- **`riskLevel`** (string, required): One of `"low"`, `"medium"`, `"high"`
- **`capabilityManifest`** (object, required): Defines permissions
  - **`canEdit`**: Allowed file patterns
  - **`cannotEdit`**: Forbidden file patterns
  - **`canRun`**: Allowed commands
  - **`cannotRun`**: Forbidden commands
- **`telemetry`** (object, required): Telemetry configuration
  - **`expectedEvents`**: Expected event types
  - **`logLevel`**: One of `"debug"`, `"info"`, `"warn"`, `"error"`

---

## Validation Rules

Pi's `doctor` command validates the execution contract against these rules:

1. **JSON validity**: The JSON must be syntactically valid
2. **Contract version required**: `contractVersion` must be present and valid (currently `"2.1.0"`)
3. **Project name required**: `project.name` must be a non-empty string
4. **Project root path required**: `project.rootPath` must be a valid path
5. **Execution backend valid**: `executionBackend` must be `"postgres"` or `"json"`
6. **State backend valid**: `planExecution.stateBackend` must be `"postgres"` or `"json"`
7. **Unique workspace IDs**: All workspace `id` fields must be unique within the phase
8. **Valid dependencies**: All workspace IDs referenced in `dependencies` arrays must exist in the workspace list
9. **No dependency cycles**: The dependency graph must be acyclic (no circular dependencies)
10. **File pattern conflicts**: `allowedFiles` and `forbiddenFiles` must not have overlapping patterns
11. **Parallel workspace limit**: `maxParallelWorkspaces` must be between 1 and 3
12. **Valid role budgets**: `roleBudget` must be one of: `flash`, `worker`, `lead`, `reviewer`, `debug`
13. **Valid risk levels**: `riskLevel` must be one of: `low`, `medium`, `high`
14. **Auto-push must default false**: `planExecution.autoPush` must be `false` for safety
15. **Forbidden commands required**: `safety.forbiddenCommands` must include:
    - `git push` and `git push --force`
    - `rm -rf`
    - `npm publish`
    - Any production-modifying commands
16. **Forbidden files required**: `safety.forbiddenFiles` must include:
    - `.env*` patterns
    - `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`
    - Credential and secret directories
17. **No unresolved placeholders**: All `{{ placeholder }}` syntax must be replaced with actual values

**Validation failure**: If any validation rule fails, `pi plan doctor` will report the error and prevent execution.

---

## Persistence Mapping

Markdown plans map to the PostgreSQL database hierarchy for multi-project execution:

**Database Hierarchy:**
```
Project → Plan Execution → Workspace Execution → Journal Events / Workspace Logs
```

**Mapping Details:**

- **`project`** creates or reuses a `projects` table row identified by `project.name`
- **`planExecution`** creates a `plan_executions` table row linked to the project
- Each **`workspace`** creates `workspace_executions` table rows linked to the plan execution
- Execution **events** are persisted to `journal_events` table with timestamps and metadata
- Workspace **logs** (stdout/stderr) are persisted to `workspace_logs` table
- **Dashboard** reads execution state via web-server REST APIs and Server-Sent Events (SSE)
- **JSON fallback** uses `.pi/` directory files only when PostgreSQL is unavailable

**State Transitions:**

All state mutations are performed exclusively by the autonomous executor. The dashboard and control UI are read-only except for control requests (pause/stop/cancel), which are written to a control request table and processed by the executor.

---

## Control Model

**Important:** Pause/stop/cancel are not direct state mutations by the UI.

**Control Flow:**

1. **Dashboard/CLI writes control requests** to the control system (file or database)
2. **Executor polls control requests** and processes them
3. **Executor is the only component** that mutates execution state
4. **Dashboard reads state** via APIs/SSE for real-time monitoring

**Control Request Types:**

- **Pause**: Executor completes current workspace, then pauses before starting next
- **Stop**: Executor completes current workspace, then stops execution
- **Cancel**: Executor immediately cancels current workspace and stops
- **Resume**: Executor resumes from paused or stopped state (only if `resumePolicy` allows)

**Safety:**

- Control requests are advisory, not immediate
- Executor validates control requests before applying
- Invalid control requests are logged and ignored
- Resume is only allowed from `paused` or `stopped` states per `resumePolicy`

---

## Parser Priority

Pi's plan parser follows this priority:

1. **Part 3 JSON first**: Pi attempts to parse the JSON execution contract in Part 3
2. **Markdown heading fallback**: If Part 3 JSON is missing or invalid, Pi falls back to parsing markdown headings (recovery mode only)
3. **Doctor validation**: Before execution, Pi runs validation checks on the parsed contract
4. **Execution gate**: For PostgreSQL multi-project execution, Part 3 JSON is mandatory. If missing, `doctor` fails and execution is blocked.

**Note:** Markdown sections (Part 1 and Part 2) remain required for human reasoning, risk assessment, rollback procedures, and authority. JSON is the execution contract, not a replacement for the plan.

---

# Part 4 — Machine-Readable Summary

**Purpose:** Phase-level execution metadata for Pi's autonomous executor.

```json
{
  "contractVersion": "2.1.0",
  "phase": "{{ Phase ID }}",
  "title": "{{ Phase Title }}",
  "primaryGoal": "{{ One sentence summary of the phase goal }}",
  "projectName": "{{ project_name }}",
  "stateBackend": "postgres",
  "notInScope": [
    "{{ Thing explicitly not in scope }}",
    "{{ Thing explicitly not in scope }}"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations"
  ],
  "completionGate": "{{ Definition of done summary }}",
  "nextPhase": "{{ Next Phase ID or null }}"
}
```

### Summary Fields

- **`contractVersion`** (string, required): Contract version, must be `"2.1.0"`
- **`phase`** (string, required): Phase identifier
- **`title`** (string, required): Phase title
- **`projectName`** (string, required): Project name matching Part 3
- **`stateBackend`** (string, required): Must be `"postgres"` or `"json"`
- **`primaryGoal`** (string, required): One-sentence summary of what this phase accomplishes
- **`notInScope`** (array of strings, optional): Explicit list of things NOT included in this phase
- **`hardStops`** (array of strings, required): Conditions that immediately halt execution
- **`completionGate`** (string, required): Summary of completion criteria
- **`nextPhase`** (string or null, required): ID of the next phase, or `null` if this is the final phase

---

# Annex — Worked Example

This section provides a complete worked example of a Master Template v2 plan.

## Example: Phase P2 — Pi Autonomous Multiagent Plan Executor

### Part 1 — Phase Plan

#### 0. TL;DR

**Phase:** P2  
**One-line goal:** Transform Pi into a fully autonomous bounded multi-agent implementation executor  
**Why now:** P1 established token safety; P2 enables autonomous multi-agent execution  
**Blast radius:** Pi runtime/execution/scheduler/state/report/CLI layers only  
**Rollback path:** Disable autonomous execution, revert to P1 single-agent behavior  
**Done when:** Pi can parse plans, schedule workspaces, execute autonomously, retry failures, commit completed work

#### 1. Header

| Field | Value |
|---|---|
| Phase | P2 |
| Title | Pi Autonomous Multiagent Plan Executor |
| Status | In Progress |
| Last updated | 2026-05-11 |
| Delivery status | In progress |
| Target environment | Local Pi runtime |
| Primary focus | Autonomous execution + bounded multi-agent scheduling |
| Product-code changes | Forbidden in P2 implementation phase |

#### 2. Purpose

P2 upgrades Pi into a fully autonomous multi-agent coding executor. Pi should be able to read a plan, analyze it, create a workspace queue, schedule workers, implement code, test, retry/fix automatically, review, commit, and continue until plan completion.

P2 MUST remain bounded and budget-safe using the P1 gateway.

#### 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Worker conflicts | med | high | file ownership locks |
| Retry loops spiral | med | med | retry counters + reviewer escalation |
| Parallel edits corrupt files | low | high | no same-file parallelism |

#### 7. Workstreams

##### 7.A — Plan Parser + JSON Queue

**Goal:** Parse Master Template v2 plans

**Requirements:**
* Part 3 JSON queue first
* Markdown heading fallback only
* Placeholder detection

**Acceptance Criteria:**
* Parses valid Part 3 JSON queue
* Fallback heading parser works
* Unresolved placeholders fail doctor

### Part 2 — Agent Brief

#### Mission

Implement P2 — Pi Autonomous Multiagent Plan Executor. You are building a bounded autonomous multi-agent coding runtime using P1 token safety guarantees.

#### Hard Requirements

1. P1 budget gateway mandatory
2. No bypass around provider enforcement
3. No full repo injection
4. No same-file parallel edits
5. Auto commit after approved workspace

### Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi-mono",
    "rootPath": "/home/user/projects/pi-mono",
    "type": "repo",
    "tags": ["autonomous-execution", "multi-agent"]
  },
  "planExecution": {
    "phase": "P2",
    "title": "Pi Autonomous Multiagent Plan Executor",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "paused_or_stopped_only"
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "budget_violations",
      "dependency_cycles"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish"
    ],
    "forbiddenFiles": [
      ".env*",
      "**/*.pem",
      "**/*.key",
      "**/credentials/**"
    ]
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "Plan Parser + JSON Queue",
      "dependencies": [],
      "allowedFiles": ["packages/coding-agent/src/core/plan-parser.ts"],
      "forbiddenFiles": [".env*", "**/*.pem"],
      "acceptanceCriteria": [
        "Parses valid Part 3 JSON queue",
        "Fallback heading parser works",
        "Unresolved placeholders fail doctor"
      ],
      "targetCommand": "npm test -- plan-parser.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": ["packages/coding-agent/src/core/*.ts"],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npm test", "npm run check"],
        "cannotRun": ["git push", "rm -rf", "npm publish"]
      }
    },
    {
      "id": "7.B",
      "title": "Workspace Schema + Validation",
      "dependencies": ["7.A"],
      "allowedFiles": ["packages/coding-agent/src/core/workspace-schema.ts"],
      "forbiddenFiles": [".env*", "**/*.pem"],
      "acceptanceCriteria": [
        "Schema validation exists",
        "Dependency validation exists",
        "Duplicate workspace IDs fail"
      ],
      "targetCommand": "npm test -- workspace-schema.test.ts",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": ["packages/coding-agent/src/core/*.ts"],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": ["npm test", "npm run check"],
        "cannotRun": ["git push", "rm -rf", "npm publish"]
      }
    }
  ]
}
```

### Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.1.0",
  "phase": "P2",
  "title": "Pi Autonomous Multiagent Plan Executor",
  "primaryGoal": "Transform Pi into a fully autonomous bounded multi-agent implementation runtime",
  "projectName": "pi-mono",
  "stateBackend": "postgres",
  "notInScope": [
    "Semantic retrieval",
    "Vector indexing",
    "Advanced reasoning"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations"
  ],
  "completionGate": "Pi can parse plans, schedule workspaces, execute autonomously, retry failures, and commit completed work",
  "nextPhase": "P3"
}
```

---

## Template Changelog

### v2.1.0 (2026-05-11)
- **PostgreSQL-backed multi-project execution contract added**
- Renamed Part 3 to "Machine-Readable Execution Contract"
- Added `contractVersion`, `executionBackend`, `project`, `planExecution`, `controls`, and `safety` top-level fields
- Added `telemetry` field to workspace configuration
- Added persistence mapping section explaining database hierarchy
- Added control model section explaining executor-only state mutations
- Updated validation rules for PostgreSQL execution
- Updated parser priority to mandate Part 3 JSON for PostgreSQL execution
- Updated Part 4 with `contractVersion`, `projectName`, and `stateBackend` fields
- Updated worked example with full PostgreSQL contract structure

### v2.0 (2026-05-11)
- Added Part 3 — Machine-Readable Workspace Queue
- Added Part 4 — Machine-Readable Summary
- Added comprehensive field definitions and validation rules
- Added parser priority rules
- Moved worked example to Annex
- Established JSON as machine execution source while preserving markdown as human authority

### v1.0 (2026-05-10)
- Initial Master Template structure
- Part 1 — Phase Plan
- Part 2 — Agent Brief
- Markdown-only format

---

## License

This template is part of the Pi project and follows the project's license terms.

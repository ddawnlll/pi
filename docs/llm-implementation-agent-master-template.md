# LLM Implementation Agent — Master Template v2

**Version:** 2.0  
**Last Updated:** 2026-05-11  
**Purpose:** Canonical template for creating executable implementation plans for Pi autonomous multi-agent execution

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
3. **Fill Part 3 — Machine-Readable Workspace Queue**: Define the executable workspace queue in valid JSON
4. **Fill Part 4 — Machine-Readable Summary**: Provide phase-level execution metadata
5. **Review validation rules**: Ensure JSON is valid and all placeholders are resolved

### Critical Requirements

- **Every executable plan MUST include valid JSON in Part 3**
- **Markdown remains human authority**; Part 3 JSON is the machine execution source
- **Unresolved `{{ placeholders }}` make the plan non-executable**
- Pi will parse Part 3 JSON first; markdown heading fallback is recovery mode only

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

# Part 3 — Machine-Readable Workspace Queue

**Purpose:** This JSON structure is the authoritative source for Pi autonomous execution. Pi parses this section first to build the execution plan.

**Validation:** This JSON must be valid and complete before execution begins. Use `pi plan doctor` to validate.

```json
{
  "phase": "{{ Phase ID }}",
  "title": "{{ Phase Title }}",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "{{ Unique workspace ID, e.g., 7.A }}",
      "title": "{{ Short descriptive title }}",
      "dependencies": [],
      "allowedFiles": [],
      "forbiddenFiles": [],
      "acceptanceCriteria": [
        "{{ Criterion 1 }}",
        "{{ Criterion 2 }}"
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [".env*", "**/*.pem", "**/*.key"],
        "canRun": [],
        "cannotRun": ["git push", "rm -rf", "npm publish"]
      }
    }
  ]
}
```

## Field Definitions

### Top-Level Fields

- **`phase`** (string, required): Phase identifier matching Part 1 header
- **`title`** (string, required): Phase title matching Part 1 header
- **`maxParallelWorkspaces`** (number, required): Maximum concurrent workspaces (1-3)

### Workspace Fields

- **`id`** (string, required): Unique workspace identifier (e.g., "7.A", "7.B")
- **`title`** (string, required): Short descriptive title for the workspace
- **`dependencies`** (array of strings, required): List of workspace IDs that must complete before this workspace can start. Empty array `[]` means no dependencies.
- **`allowedFiles`** (array of strings, optional): Glob patterns for files this workspace is allowed to modify. Empty means no restrictions.
- **`forbiddenFiles`** (array of strings, optional): Glob patterns for files this workspace must not modify. Takes precedence over `allowedFiles`.
- **`acceptanceCriteria`** (array of strings, required): List of criteria that must be met for workspace completion
- **`targetCommand`** (string or null, optional): Command to run for validation (e.g., `"npm test"`, `"npm run check"`). `null` means no command.
- **`roleBudget`** (string, required): Token budget role for this workspace. Must be one of:
  - `"flash"` — Minimal context, quick fixes (e.g., 8K tokens)
  - `"worker"` — Standard implementation tasks (e.g., 32K tokens)
  - `"lead"` — Complex coordination tasks (e.g., 64K tokens)
  - `"reviewer"` — Review and approval tasks (e.g., 32K tokens)
  - `"debug"` — Debugging with extended context (e.g., 64K tokens)
- **`maxRetries`** (number, required): Maximum retry attempts for this workspace (typically 1-10)
- **`riskLevel`** (string, required): Risk assessment. Must be one of:
  - `"low"` — Safe, isolated changes
  - `"medium"` — Moderate impact, requires review
  - `"high"` — Critical changes, requires careful validation
- **`capabilityManifest`** (object, required): Defines what the workspace can and cannot do
  - **`canEdit`** (array of strings): Glob patterns for files that can be edited
  - **`cannotEdit`** (array of strings): Glob patterns for files that must not be edited (e.g., secrets, keys)
  - **`canRun`** (array of strings): Commands that are allowed to run
  - **`cannotRun`** (array of strings): Commands that must not be run (e.g., destructive operations)

---

## Validation Rules

Pi's `doctor` command validates the workspace queue against these rules:

1. **JSON validity**: The JSON must be syntactically valid
2. **Unique workspace IDs**: All workspace `id` fields must be unique within the phase
3. **Valid dependencies**: All workspace IDs referenced in `dependencies` arrays must exist in the workspace list
4. **No dependency cycles**: The dependency graph must be acyclic (no circular dependencies)
5. **File pattern conflicts**: `allowedFiles` and `forbiddenFiles` must not have overlapping patterns
6. **Parallel workspace limit**: `maxParallelWorkspaces` must be between 1 and 3
7. **Valid role budgets**: `roleBudget` must be one of: `flash`, `worker`, `lead`, `reviewer`, `debug`
8. **Valid risk levels**: `riskLevel` must be one of: `low`, `medium`, `high`
9. **Dangerous commands forbidden**: `capabilityManifest.cannotRun` must include dangerous commands by default:
   - `git push`
   - `rm -rf`
   - `npm publish`
   - Any command that modifies production systems
10. **No unresolved placeholders**: All `{{ placeholder }}` syntax must be replaced with actual values

**Validation failure**: If any validation rule fails, `pi plan doctor` will report the error and prevent execution.

---

## Parser Priority

Pi's plan parser follows this priority:

1. **Part 3 JSON first**: Pi attempts to parse the JSON workspace queue in Part 3
2. **Markdown heading fallback**: If Part 3 JSON is missing or invalid, Pi falls back to parsing markdown headings (recovery mode only)
3. **Doctor validation**: Before execution, Pi runs validation checks on the parsed queue
4. **Execution gate**: If Part 3 JSON is missing in a plan intended for autonomous execution, `doctor` fails and execution is blocked

**Note:** Markdown sections (Part 1 and Part 2) remain required for human reasoning, risk assessment, rollback procedures, and authority. JSON does not replace the plan; it makes the plan executable by machines.

---

# Part 4 — Machine-Readable Summary

**Purpose:** Phase-level execution metadata for Pi's autonomous executor.

```json
{
  "phase": "{{ Phase ID }}",
  "title": "{{ Phase Title }}",
  "primaryGoal": "{{ One sentence summary of the phase goal }}",
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

- **`phase`** (string, required): Phase identifier
- **`title`** (string, required): Phase title
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

### Part 3 — Machine-Readable Workspace Queue

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
  "phase": "P2",
  "title": "Pi Autonomous Multiagent Plan Executor",
  "primaryGoal": "Transform Pi into a fully autonomous bounded multi-agent implementation runtime",
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

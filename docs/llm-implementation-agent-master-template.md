# LLM Implementation Agent — Master Template v2

**Version:** 2.2.0  
**Last Updated:** 2026-05-13  
**Purpose:** Canonical template for creating executable implementation plans for Pi autonomous multi-agent execution with PostgreSQL-backed multi-project support and interactive parallelism review

---

## Overview

This template provides a structured format for implementation plans that can be:

1. **Read by humans** for reasoning, risk assessment, dependency review, and decision-making
2. **Parsed by Pi** for autonomous multi-agent execution
3. **Previewed interactively** before execution so authors can see the real dependency graph, effective parallelism, and batch plan

The template balances human authority in Markdown with machine executability in the JSON execution contract.

---

## What Changed in v2.2.0

v2.2.0 adds explicit support for **interactive parallelism review**.

The key lesson is:

```text
maxParallelWorkspaces = capacity limit
workspace dependency graph = actual parallelism
```

A plan can request three workers but still execute one workspace at a time if every workspace depends on the previous workspace. Therefore, v2.2.0 adds a required preflight review option that lets Pi compute, display, edit, validate, approve, and persist the actual graph before run.

---

## How to Use This Template

1. **Fill Part 1 — Phase Plan**: Define goals, risks, workstreams, and implementation order.
2. **Fill Part 2 — Agent Brief**: Provide mission, hard requirements, and execution policies.
3. **Fill Part 3 — Machine-Readable Execution Contract**: Define the executable contract with project, plan execution, controls, safety, parallelism review, and workspace details in valid JSON.
4. **Fill Part 4 — Machine-Readable Summary**: Provide phase-level execution metadata.
5. **Review validation rules**: Ensure JSON is valid and all placeholders are resolved.
6. **Run preflight review** when enabled: inspect the DAG, batches, effective parallelism, blocked reasons, and dependency warnings before execution.

### Critical Requirements

- **Every executable plan MUST include valid JSON in Part 3.**
- **Markdown remains human authority** for purpose, risks, rollback, and reasoning.
- **Part 3 JSON is the execution contract.**
- **Unresolved `{{ placeholders }}` make the plan non-executable.**
- Pi parses Part 3 JSON first; Markdown heading fallback is recovery mode only.
- PostgreSQL backend uses project/plan/workspace hierarchy for multi-project execution.
- Dashboard is enabled by default for real-time monitoring.
- When `interactiveParallelismReview.preflightRequired` is true, execution must not begin until the dependency graph is reviewed and approved.

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

**Parallelism Notes:**
* `{{ Why this workspace depends on its dependencies, or why it can run independently }}`
* `{{ Expected parallel batch/group, if known }}`

---

`{{ Repeat for all workstreams }}`

---

## 8. Combined Implementation Order

```text
{{ Batch 1: A }}
{{ Batch 2: B + C + D }}
{{ Batch 3: E + F }}
```

`{{ Explain the dependency graph and why each batch can run in parallel. Do not list a linear chain unless the work truly must be serialized. }}`

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
1. `{{ Step 1 }} `
2. `{{ Step 2 }} `
3. `{{ Step 3 }} `

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

1. `{{ Non-negotiable requirement 1 }} `
2. `{{ Non-negotiable requirement 2 }} `
3. `{{ Non-negotiable requirement 3 }} `

---

## Execution Policies

```yaml
default_workers: 3
hard_cap_workers: 3
same_file_parallelism: false
auto_commit: true
auto_push: false
preflight_required: true
interactive_dependency_review: true
show_effective_parallelism: true
show_batch_preview: true
allow_dependency_editing: true
persist_approved_graph: true
```

---

## Safety Stops

Hard stop execution only for:
* `{{ Safety condition 1 }}`
* `{{ Safety condition 2 }}`
* `{{ Safety condition 3 }}`
* Dependency cycles
* Invalid dependency patches
* Required preflight review not approved

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract for Pi's PostgreSQL-backed multi-project autonomous execution system. Pi parses this section first to build the execution plan.

**Validation:** This JSON must be valid and complete before execution begins. Use `pi plan doctor` to validate. If interactive review is required, use the dashboard preflight editor or equivalent CLI approval before running.

```json
{
  "contractVersion": "2.2.0",
  "executionBackend": "postgres",
  "project": {
    "name": "{{ project_name }}",
    "rootPath": "{{ absolute_or_repo_relative_path }}",
    "type": "repo",
    "tags": []
  },
  "planExecution": {
    "phase": "{{ Phase ID }}",
    "title": "{{ Short Title }}",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "interactiveParallelismReview": {
      "enabled": true,
      "preflightRequired": true,
      "approvalRequiredBeforeRun": true,
      "allowDependencyEditing": true,
      "showEffectiveParallelism": true,
      "showBatchPreview": true,
      "showCriticalPath": true,
      "warnWhenEffectiveParallelismBelowRequested": true,
      "persistApprovedGraph": true
    }
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
      "dependency_cycles",
      "unapproved_parallelism_review",
      "invalid_dependency_patch"
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
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 3,
    "expectedEffectiveParallelismMin": 2,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "batchPreview": {
      "batches": [],
      "overallEffectiveParallelism": null,
      "criticalPath": [],
      "criticalPathLength": 0,
      "serializedTailLength": 0
    },
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "fully_serialized_graph",
      "long_serialized_tail",
      "file_overlap_blocks_parallelism"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "critical_path",
      "approved_dependency_patch"
    ]
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "{{ Workstream title }}",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "{{ Why this workspace has no dependencies or why these dependencies are required }}",
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

---

## Field Definitions

### Contract Metadata

- **`contractVersion`**: Must be `"2.2.0"` for interactive parallelism review. v2.1.0 remains supported for plans that do not use these fields.
- **`executionBackend`**: Must be `"postgres"` or `"json"`.

### Plan Execution Parallelism Fields

- **`planExecution.maxParallelWorkspaces`**: Maximum concurrent workspace count. This is a hard cap only; it does not guarantee concurrency.
- **`planExecution.interactiveParallelismReview.enabled`**: Enables graph and batch preview behavior.
- **`preflightRequired`**: Blocks execution until the plan has been reviewed.
- **`approvalRequiredBeforeRun`**: Requires explicit user approval before run.
- **`allowDependencyEditing`**: Allows safe dependency patching before approval.
- **`showEffectiveParallelism`**: Displays computed effective parallelism.
- **`showBatchPreview`**: Displays topological batches.
- **`showCriticalPath`**: Displays longest dependency path.
- **`warnWhenEffectiveParallelismBelowRequested`**: Emits warnings when requested capacity exceeds usable graph width.
- **`persistApprovedGraph`**: Stores the approved graph/hash and requires executor to use it.

### Parallelism Review Object

- **`requestedMaxParallelWorkspaces`**: Mirrors the requested capacity.
- **`expectedEffectiveParallelismMin`**: Author expectation for the minimum useful effective parallelism.
- **`preflightStatus`**: One of `required`, `approved`, `not_required`, `failed`.
- **`approvalState`**: One of `pending`, `approved`, `rejected`, `stale`.
- **`batchingStrategy`**: Usually `dag_topological_batches`.
- **`batchPreview`**: Computed preview of topological batches before execution. Contains:
  - **`batches`**: Array of `{ batch, workspaceIds[], effectiveParallelism }` objects, one per topological level.
  - **`overallEffectiveParallelism`**: Weighted average parallelism across all batches (total workspaces / total batches).
  - **`criticalPath`**: Longest dependency chain through the DAG.
  - **`criticalPathLength`**: Number of workspaces on the critical path (also the minimum number of sequential batches).
  - **`serializedTailLength`**: Number of trailing batches that contain only one workspace, indicating a serialization bottleneck at the end of the plan.
- **`editableFields`**: Fields the interactive editor may patch.
- **`doctorWarnings`**: Warning categories the doctor should surface.
- **`persistedArtifacts`**: Artifacts stored for audit and reproducibility.

### Workspace Parallelism Fields

- **`dependencies`**: Workspace IDs that must complete before this workspace can start.
- **`parallelGroup`**: Optional human-authored expected batch/group label. It is advisory; the DAG remains authoritative.
- **`dependencyReason`**: Human-readable explanation for why the listed dependencies are required.

---

## Validation Rules

Pi's `doctor` command validates the execution contract against these rules:

1. JSON must be syntactically valid.
2. `contractVersion` must be present and valid.
3. `project.name` must be non-empty.
4. `project.rootPath` must be valid.
5. `executionBackend` must be `postgres` or `json`.
6. `planExecution.stateBackend` must be `postgres` or `json`.
7. All workspace IDs must be unique.
8. All dependency references must point to existing workspaces.
9. Dependency graph must be acyclic.
10. `maxParallelWorkspaces` must be between 1 and 3.
11. `autoPush` must be false by default.
12. Forbidden commands and files must include required safety patterns.
13. No unresolved placeholders may remain.
14. If `preflightRequired` is true, execution is blocked until approval.
15. If approval graph hash is stale, execution is blocked.
16. If effective parallelism is below requested parallelism, doctor must warn.
17. If effective parallelism is 1 while requested max is greater than 1, doctor must emit a strong serialization warning.
18. Dependency patch previews must reject cycles, missing workspaces, and invalid file-overlap claims.
19. If `batchPreview` is present, `batches` must be a non-empty array where each element contains `batch` (1-indexed), `workspaceIds` (non-empty), and `effectiveParallelism` (positive integer).
20. If `preflightStatus` is `approved`, the accompanying `batchPreview` must not contain empty `batches`.

---

## Persistence Mapping

Markdown plans map to the PostgreSQL database hierarchy:

```text
Project → Plan Execution → Workspace Execution → Journal Events / Workspace Logs
```

v2.2.0 additionally persists:

```text
Plan Execution → Parallelism Review → Dependency Graph → Batch Preview → Approved Patch / Graph Hash
```

The `batchPreview` object is persisted with the plan execution so that audit trails show the exact batch decomposition that was reviewed and approved. The executor must use the approved graph and batch preview when one exists. If the approved graph hash does not match the plan being executed, execution must stop before any workspace starts.

---

## Control Model

Pause, stop, cancel, and resume remain executor-mediated. The dashboard may request control actions, but the executor remains the only component that mutates execution state.

Interactive parallelism approval is also executor-validated. The UI can submit approval, but execution starts only after the executor verifies that the approved graph is current, acyclic, and within safety limits.

---

## Parser Priority

1. Part 3 JSON first.
2. Markdown heading fallback only as recovery mode.
3. Doctor validation.
4. Parallelism preflight if required.
5. Approval gate if required.
6. Execution gate.

---

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.2.0",
  "phase": "{{ Phase ID }}",
  "title": "{{ Phase Title }}",
  "primaryGoal": "{{ One sentence summary of the phase goal }}",
  "projectName": "{{ project_name }}",
  "stateBackend": "postgres",
  "notInScope": [
    "{{ Thing explicitly not in scope }}"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "unapproved_parallelism_review",
    "invalid_dependency_patch"
  ],
  "completionGate": "{{ Definition of done summary }}",
  "nextPhase": "{{ Next Phase ID or null }}"
}
```

---

# Annex — v2.2.0 Worked Example: Three-Wide Parallel Batches

```text
Batch 1: 7.A
Batch 2: 7.B, 7.C, 7.D
Batch 3: 7.E, 7.F
Batch 4: 7.G
```

The following workspace snippets encode actual DAG dependencies that permit the batch plan above:

```json
[
  { "id": "7.A", "dependencies": [], "parallelGroup": "batch_1", "dependencyReason": {} },
  { "id": "7.B", "dependencies": ["7.A"], "parallelGroup": "batch_2", "dependencyReason": { "7.A": "7.B builds on the foundation 7.A provides" } },
  { "id": "7.C", "dependencies": ["7.A"], "parallelGroup": "batch_2", "dependencyReason": { "7.A": "7.C requires 7.A output as input" } },
  { "id": "7.D", "dependencies": ["7.A"], "parallelGroup": "batch_2", "dependencyReason": { "7.A": "7.D extends the scaffolding from 7.A" } },
  { "id": "7.E", "dependencies": ["7.B", "7.C"], "parallelGroup": "batch_3", "dependencyReason": { "7.B": "7.E needs 7.B artifacts", "7.C": "7.E needs 7.C artifacts" } },
  { "id": "7.F", "dependencies": ["7.C", "7.D"], "parallelGroup": "batch_3", "dependencyReason": { "7.C": "7.F needs 7.C artifacts", "7.D": "7.F needs 7.D artifacts" } },
  { "id": "7.G", "dependencies": ["7.E", "7.F"], "parallelGroup": "batch_4", "dependencyReason": { "7.E": "7.G integrates 7.E output", "7.F": "7.G integrates 7.F output" } }
]
```

The corresponding `parallelismReview` object with batch preview metadata for this plan:

```json
{
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 3,
    "expectedEffectiveParallelismMin": 2,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "batchPreview": {
      "batches": [
        { "batch": 1, "workspaceIds": ["7.A"], "effectiveParallelism": 1 },
        { "batch": 2, "workspaceIds": ["7.B", "7.C", "7.D"], "effectiveParallelism": 3 },
        { "batch": 3, "workspaceIds": ["7.E", "7.F"], "effectiveParallelism": 2 },
        { "batch": 4, "workspaceIds": ["7.G"], "effectiveParallelism": 1 }
      ],
      "overallEffectiveParallelism": 1.75,
      "criticalPath": ["7.A", "7.C", "7.E", "7.G"],
      "criticalPathLength": 4,
      "serializedTailLength": 1
    },
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "critical_path",
      "approved_dependency_patch"
    ]
  }
}
```

Key observations from this batch preview:
- **Batch 2 achieves full 3-wide parallelism**, using all `maxParallelWorkspaces` capacity.
- **Batch 3 is 2-wide** because only 7.E and 7.F are simultaneously ready.
- **Batches 1 and 4 are 1-wide** (single workspace) — no parallelism opportunity exists.
- **Overall effective parallelism is 1.75** (7 workspaces / 4 batches), which is below the requested max of 3. The `doctorWarnings` array flags this.
- **Critical path** runs through the longest chain (7.A → 7.C → 7.E → 7.G), spanning all 4 batches.
- **preflightStatus** is `required` because `interactiveParallelismReview.preflightRequired` is true; execution is blocked until the batch preview is reviewed and `approvalState` transitions to `approved`.

Do **not** encode this as a chain unless each workspace truly depends on the previous one:

```json
[
  { "id": "7.A", "dependencies": [] },
  { "id": "7.B", "dependencies": ["7.A"] },
  { "id": "7.C", "dependencies": ["7.B"] },
  { "id": "7.D", "dependencies": ["7.C"] }
]
```

That second graph has effective parallelism 1 even if `maxParallelWorkspaces` is 3.

---

## Template Changelog

### v2.2.0 (2026-05-13)
- Added interactive parallelism review.
- Added `planExecution.interactiveParallelismReview`.
- Added top-level `parallelismReview` metadata with `batchPreview` sub-object.
- Added workspace-level `parallelGroup` and `dependencyReason` fields.
- Added validation rules for effective parallelism, approval gates, stale graph hashes, and dependency patches.
- Added persistence mapping for dependency graph, batch preview, approved patch, and graph hash.
- Added worked example showing actual 3-wide batches versus accidental serialization with full `parallelismReview.batchPreview` metadata.

### v2.1.0 (2026-05-11)
- PostgreSQL-backed multi-project execution contract added.
- Renamed Part 3 to Machine-Readable Execution Contract.
- Added `contractVersion`, `executionBackend`, `project`, `planExecution`, `controls`, and `safety` top-level fields.
- Added `telemetry` field to workspace configuration.
- Added persistence mapping section explaining database hierarchy.
- Added control model section explaining executor-only state mutations.
- Updated validation rules for PostgreSQL execution.
- Updated parser priority to mandate Part 3 JSON for PostgreSQL execution.
- Updated Part 4 with `contractVersion`, `projectName`, and `stateBackend` fields.

### v2.0 (2026-05-11)
- Added Part 3 — Machine-Readable Workspace Queue.
- Added Part 4 — Machine-Readable Summary.
- Added comprehensive field definitions and validation rules.
- Added parser priority rules.
- Moved worked example to Annex.
- Established JSON as machine execution source while preserving Markdown as human authority.

### v1.0 (2026-05-10)
- Initial Master Template structure.
- Part 1 — Phase Plan.
- Part 2 — Agent Brief.
- Markdown-only format.

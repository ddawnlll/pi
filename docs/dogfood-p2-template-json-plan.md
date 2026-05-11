# Phase DOGFOOD — Master Template v2 JSON Queue Validation

**Author:** Roo  
**Template:** LLM Implementation Agent — Master Template v2  
**Created:** 2026-05-11  
**Target system:** Pi autonomous coding runtime  
**Goal:** Validate that Pi can parse and execute a Master Template v2 plan with Part 3 machine-readable JSON queue.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** DOGFOOD  
**One-line goal:** Validate Pi can execute Master Template v2 plans with Part 3 JSON workspace queues  
**Why now:** Master Template v2 was just created; need to validate it works before using it for real work  
**Blast radius:** Only docs/ directory; creates/updates docs/dogfood-output.md  
**Rollback path:** Delete docs/dogfood-output.md and revert any test commits  
**Done when:** Pi successfully parses JSON queue, executes 3 workspaces, creates output doc, and commits locally

---

## 1. Header

| Field | Value |
|---|---|
| Phase | DOGFOOD |
| Title | Master Template v2 JSON Queue Validation |
| Status | Planned |
| Last updated | 2026-05-11 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Template validation + JSON parser testing |
| Product-code changes | Forbidden |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| 7.A — Create dogfood output doc | Pi Worker | User | — | User |
| 7.B — Add validation checklist | Pi Worker | User | — | User |
| 7.C — Final verification report | Pi Worker | User | — | User |

---

## 2. Purpose

This dogfood plan validates that:
1. Pi can parse Part 3 JSON workspace queues
2. Pi can execute workspaces with dependencies
3. Pi respects capability manifests
4. Pi creates execution journals
5. Pi auto-commits completed workspaces locally
6. `pi plan doctor` validates the plan correctly
7. `pi plan dry-run` simulates execution safely

This is a minimal, safe test that only creates/updates documentation files.

---

## 3. What Carried Over — Must Stay Stable

* [x] No product source code changes
* [x] No package.json changes
* [x] No external service calls
* [x] No git push operations
* [x] No destructive operations
* [x] Only docs/ directory modifications allowed

---

## 4. Background / What Was Wrong

Master Template v2 was just created with Part 3 machine-readable JSON workspace queues. Before using it for real implementation work, we need to validate that Pi can:
- Parse the JSON correctly
- Execute workspaces in dependency order
- Respect file restrictions
- Create proper execution journals
- Auto-commit safely

---

## 5. Current Failure State / Known Blockers

* `pi plan doctor` command = may not be implemented yet
* `pi plan dry-run` command = may not be implemented yet
* `pi plan run` command = may not be implemented yet
* JSON parser = may not be implemented yet

If these commands don't exist yet, this dogfood plan will help identify what needs to be built.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Parser not implemented | high | low | Identifies what needs building |
| Commands not implemented | high | low | Identifies what needs building |
| JSON schema mismatch | med | low | Easy to fix in template |
| File creation fails | low | low | Only docs/ files affected |

---

## 7. Workstreams

### 7.A — Create Dogfood Output Doc

**Goal:** Create initial docs/dogfood-output.md with basic structure

**Requirements:**
* Create docs/dogfood-output.md
* Add header and introduction
* Add placeholder sections for validation results

**Acceptance Criteria:**
* File exists at docs/dogfood-output.md
* Contains valid markdown structure
* Contains workspace 7.A completion marker

---

### 7.B — Add Validation Checklist Section

**Goal:** Add validation checklist to dogfood output doc

**Requirements:**
* Read existing docs/dogfood-output.md
* Add "Validation Checklist" section
* List all validation points from Master Template v2

**Acceptance Criteria:**
* Validation checklist section exists
* All 10 validation rules listed
* Contains workspace 7.B completion marker
* Depends on 7.A completion

---

### 7.C — Final Verification Report

**Goal:** Add final verification report to dogfood output doc

**Requirements:**
* Read existing docs/dogfood-output.md
* Add "Verification Report" section
* Document execution results
* Confirm all workspaces completed

**Acceptance Criteria:**
* Verification report section exists
* Documents workspace execution order
* Documents dependency resolution
* Contains workspace 7.C completion marker
* Depends on 7.B completion

---

## 8. Combined Implementation Order

```text
7.A → 7.B → 7.C
```

Sequential execution required to validate dependency handling.

---

## 9. Definition of Done

DOGFOOD phase is complete when ALL are true:

* [x] docs/dogfood-output.md created
* [x] All 3 workspaces completed in order
* [x] Validation checklist documented
* [x] Verification report documented
* [x] Execution journal created (if Pi supports it)
* [x] Local commits created (if Pi supports auto-commit)
* [x] No git push occurred
* [x] No product source code modified

---

## 10. Rollback Playbook

**Trigger conditions:**
* Unexpected file modifications outside docs/
* Git push attempted
* Product source code modified

**Rollback procedure:**
1. `git reset --hard HEAD~N` (where N = number of dogfood commits)
2. `rm -f docs/dogfood-output.md`
3. Verify no other files modified
4. Report issues with template or parser

---

## 11. What Next Phase Inherits

Next phases inherit:
* Validated Master Template v2 structure
* Working JSON workspace queue parser
* Working `pi plan` commands
* Execution journal format
* Auto-commit behavior

Next phases may add:
* Real implementation workspaces
* Product source code changes
* Test file modifications
* Package dependency updates

---

# Part 2 — Agent Brief

## Mission

Execute DOGFOOD phase to validate Master Template v2 JSON workspace queue functionality. Create a simple documentation file through 3 sequential workspaces to test parsing, dependency resolution, and execution.

---

## Hard Requirements

1. Only modify files in docs/ directory
2. No product source code changes
3. No package.json changes
4. No git push operations
5. No external service calls
6. No destructive operations
7. Execute workspaces in dependency order: 7.A → 7.B → 7.C
8. Respect capability manifests
9. Create execution journal if supported
10. Auto-commit locally if supported

---

## Execution Policies

```yaml
default_workers: 2
hard_cap_workers: 2
same_file_parallelism: false
auto_commit: true
auto_push: false
```

---

## Safety Stops

Hard stop execution only for:
* Attempts to modify files outside docs/
* Attempts to run git push
* Attempts to run destructive commands (rm -rf, etc.)
* Attempts to modify secrets or .env files
* Attempts to publish packages

---

# Part 3 — Machine-Readable Workspace Queue

```json
{
  "phase": "DOGFOOD",
  "title": "Master Template v2 JSON Queue Validation",
  "maxParallelWorkspaces": 2,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Create Dogfood Output Doc",
      "dependencies": [],
      "allowedFiles": ["docs/dogfood-output.md"],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/*.ts",
        "packages/**/*.js",
        "package.json",
        "package-lock.json"
      ],
      "acceptanceCriteria": [
        "File exists at docs/dogfood-output.md",
        "Contains valid markdown structure",
        "Contains header and introduction",
        "Contains workspace 7.A completion marker"
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": ["docs/dogfood-output.md"],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**",
          "package.json",
          "package-lock.json"
        ],
        "canRun": ["cat", "ls", "echo"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "npm install"]
      }
    },
    {
      "id": "7.B",
      "title": "Add Validation Checklist Section",
      "dependencies": ["7.A"],
      "allowedFiles": ["docs/dogfood-output.md"],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/*.ts",
        "packages/**/*.js",
        "package.json",
        "package-lock.json"
      ],
      "acceptanceCriteria": [
        "Validation checklist section exists in docs/dogfood-output.md",
        "All 10 validation rules from Master Template v2 listed",
        "Contains workspace 7.B completion marker",
        "File remains valid markdown"
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": ["docs/dogfood-output.md"],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**",
          "package.json",
          "package-lock.json"
        ],
        "canRun": ["cat", "ls", "echo"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "npm install"]
      }
    },
    {
      "id": "7.C",
      "title": "Final Verification Report",
      "dependencies": ["7.B"],
      "allowedFiles": ["docs/dogfood-output.md"],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/*.ts",
        "packages/**/*.js",
        "package.json",
        "package-lock.json"
      ],
      "acceptanceCriteria": [
        "Verification report section exists in docs/dogfood-output.md",
        "Documents workspace execution order (7.A → 7.B → 7.C)",
        "Documents dependency resolution success",
        "Contains workspace 7.C completion marker",
        "File remains valid markdown"
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": ["docs/dogfood-output.md"],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**",
          "package.json",
          "package-lock.json"
        ],
        "canRun": ["cat", "ls", "echo"],
        "cannotRun": ["git push", "rm -rf", "npm publish", "npm install"]
      }
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "DOGFOOD",
  "title": "Master Template v2 JSON Queue Validation",
  "primaryGoal": "Validate Pi can parse and execute Master Template v2 plans with Part 3 JSON workspace queues",
  "notInScope": [
    "Product source code changes",
    "Package dependency updates",
    "External service integration",
    "Production deployments"
  ],
  "hardStops": [
    "modifications_outside_docs",
    "git_push",
    "destructive_ops",
    "secrets_access",
    "package_modifications"
  ],
  "completionGate": "All 3 workspaces completed sequentially, docs/dogfood-output.md created with validation checklist and verification report",
  "nextPhase": null
}
```

---

## Execution Notes

This dogfood plan is intentionally minimal and safe:
- Only creates/modifies docs/dogfood-output.md
- No product code changes
- No package changes
- No external dependencies
- Sequential execution to test dependency handling
- maxParallelWorkspaces: 2 (but dependencies force sequential execution)

If `pi plan doctor` or `pi plan run` commands don't exist yet, this plan documents what they should validate and execute.

# Phase DOGFOOD — P2 Template Validation

**Author:** Pi Autonomous Executor  
**Template:** Master Template v2  
**Created:** 2026-05-11  
**Target system:** Pi autonomous coding runtime  
**Goal:** Validate that Pi can execute a Master Template v2 plan with Part 3 machine-readable JSON queue.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** DOGFOOD  
**One-line goal:** Create a simple documentation output to validate P2 autonomous execution with Master Template v2.  
**Why now:** P2 CLI commands (7.K), observer dashboard (7.M), and end-to-end validation (7.L) are complete. Time to dogfood the system.  
**Blast radius:** Only creates/updates `docs/dogfood-output.md`. No product code changes.  
**Rollback path:** Delete `docs/dogfood-output.md` and `.pi/` directory.  
**Done when:** All 3 workspaces complete successfully, execution journal created, and dogfood output document exists.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | DOGFOOD |
| Title | P2 Template Validation |
| Status | Ready |
| Last updated | 2026-05-11 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Validate autonomous execution |
| Product-code changes | Forbidden |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 7.A — Create dogfood output doc | Pi Worker | User | Reviewer | User |
| 7.B — Add validation checklist | Pi Worker | User | Reviewer | User |
| 7.C — Final verification report | Pi Worker | User | Reviewer | User |

---

## 2. Purpose

Validate P2 autonomous execution by creating a simple documentation file through 3 sequential workspaces.

This dogfood plan tests:
- Master Template v2 parsing
- Part 3 JSON queue execution
- Dependency ordering
- File locking
- State persistence
- Execution journal
- Auto commit (local only)
- Safety gates

---

## 3. What Carried Over — Must Stay Stable

* [x] P1 token budget gateway is mandatory
* [x] No git push
* [x] No product code changes
* [x] No external services
* [x] No package changes
* [x] Local execution only

---

## 4. Background / What Was Wrong

P2 implementation is complete but untested in real autonomous execution. Need to validate the full flow with a safe, minimal plan.

---

## 5. Current Failure State / Known Blockers

None. All P2 workstreams (7.A-7.L) are complete.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Execution fails | low | low | Only creates docs, easy rollback |
| File conflicts | low | low | Single file target, sequential execution |
| State corruption | low | med | State is in .pi/ directory, easy to delete |

---

## 7. Workstreams

### 7.A — Create Dogfood Output Doc

**Goal:** Create initial dogfood output document.

**Acceptance criteria:**
- `docs/dogfood-output.md` created
- Contains header and introduction
- Markdown is valid

---

### 7.B — Add Validation Checklist

**Goal:** Add validation checklist section to output document.

**Dependencies:** 7.A

**Acceptance criteria:**
- Checklist section added
- Lists all validation points
- Markdown is valid

---

### 7.C — Final Verification Report

**Goal:** Add final verification report section.

**Dependencies:** 7.B

**Acceptance criteria:**
- Verification section added
- Includes execution summary
- Document is complete

---

## 8. Combined Implementation Order

```text
7.A → 7.B → 7.C
```

---

## 9. Definition of Done

DOGFOOD is complete when ALL are true:

* Pi parses this Master Template v2 plan
* Pi executes all 3 workspaces autonomously
* `docs/dogfood-output.md` exists and is complete
* Execution journal created in `.pi/execution-journal.ndjson`
* State file created in `.pi/plan-state.json`
* No git push occurred
* Auto commits are local only
* `pi plan doctor` passes
* `pi plan dry-run` passes
* `pi plan status` shows completion

---

## 10. Rollback Playbook

**Trigger:** Execution fails or produces unexpected results

**Rollback:**
1. Delete `docs/dogfood-output.md`
2. Delete `.pi/` directory
3. Review execution journal for issues
4. Fix issues and retry

---

# Part 2 — Agent Brief

## Mission

Execute a simple 3-workspace plan to validate P2 autonomous execution.

You are creating a documentation file through 3 sequential steps. Each workspace adds a section to the document.

---

## Hard Requirements

1. Only create/modify `docs/dogfood-output.md`
2. No product code changes
3. No git push
4. No external services
5. No package changes
6. Sequential execution (respect dependencies)
7. Create valid Markdown

---

## Safety Stops

Hard stop only for:
- Attempts to modify product code
- Attempts to git push
- Attempts to access secrets/env files
- Attempts to run destructive commands

---

# Part 3 — Workspace Queue

```json
{
  "phase": "DOGFOOD",
  "title": "P2 Template Validation",
  "maxParallelWorkspaces": 2,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Create Dogfood Output Doc",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/dogfood-output.md"],
        "canRead": ["docs/**/*.md"],
        "canRun": ["echo"]
      },
      "acceptanceCriteria": [
        "docs/dogfood-output.md created",
        "Contains header and introduction",
        "Markdown is valid"
      ]
    },
    {
      "id": "7.B",
      "title": "Add Validation Checklist",
      "dependencies": ["7.A"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/dogfood-output.md"],
        "canRead": ["docs/**/*.md"],
        "canRun": ["echo"]
      },
      "acceptanceCriteria": [
        "Checklist section added to docs/dogfood-output.md",
        "Lists all validation points",
        "Markdown is valid"
      ]
    },
    {
      "id": "7.C",
      "title": "Final Verification Report",
      "dependencies": ["7.B"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/dogfood-output.md"],
        "canRead": ["docs/**/*.md", ".pi/**/*"],
        "canRun": ["echo"]
      },
      "acceptanceCriteria": [
        "Verification section added to docs/dogfood-output.md",
        "Includes execution summary",
        "Document is complete"
      ]
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "DOGFOOD",
  "title": "P2 Template Validation",
  "goal": "Validate P2 autonomous execution with Master Template v2",
  "workersDefault": 2,
  "sameFileParallelism": false,
  "autoCommit": true,
  "autoPush": false,
  "retryPolicy": {
    "testFail": 3,
    "lintFail": 3,
    "typeFail": 3,
    "reviewFix": 3
  },
  "hardStops": [
    "product_code_changes",
    "git_push",
    "secrets_access",
    "destructive_ops",
    "external_services"
  ],
  "safetyLevel": "high",
  "blastRadius": "minimal",
  "rollbackComplexity": "trivial",
  "outputFiles": [
    "docs/dogfood-output.md"
  ],
  "forbiddenPatterns": [
    ".env*",
    "secrets/**",
    "*.key",
    "*.pem",
    "src/**",
    "packages/**/src/**",
    "package.json",
    "package-lock.json"
  ],
  "forbiddenCommands": [
    "git push",
    "npm publish",
    "rm -rf",
    "git reset --hard",
    "git clean -fd"
  ]
}
```

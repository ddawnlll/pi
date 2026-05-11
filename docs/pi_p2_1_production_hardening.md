# Phase P2.1 — Production Hardening & Real Dogfood

**Author:** Pi Development Team  
**Template:** Master Template v2  
**Created:** 2026-05-11  
**Target system:** Pi autonomous coding runtime  
**Goal:** Harden P2 autonomous execution and validate with real-world task before P3.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P2.1  
**One-line goal:** Harden P2 runtime hygiene, validate with real dogfood execution, and document for production use.  
**Why now:** P2 core is complete (7.A-7.L). Need production hardening and real validation before P3 semantic indexing.  
**Blast radius:** Only docs, tests, .gitignore, and minor config. No product-critical code.  
**Rollback path:** Revert commits, delete runtime state, restore .gitignore.  
**Done when:** Real dogfood task completes successfully, runtime state is clean, documentation is complete, and stability report exists.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P2.1 |
| Title | Production Hardening & Real Dogfood |
| Status | Ready |
| Last updated | 2026-05-11 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Production readiness |
| Product-code changes | Forbidden |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 7.A — Runtime Output Hygiene | Pi Worker | User | Reviewer | User |
| 7.B — P2 User Documentation | Pi Worker | User | Reviewer | User |
| 7.C — Real Dogfood Plan | Pi Worker | User | Reviewer | User |
| 7.D — Real Execution Validation | Pi Worker | User | Reviewer | User |
| 7.E — Stability & Failure Analysis | Pi Worker | User | Reviewer | User |

---

## 2. Purpose

Harden the P2 autonomous execution system for production use and validate it with a real-world task.

This phase ensures:
- Runtime state never pollutes git commits
- Users understand how to use P2 commands
- Real execution works end-to-end
- Stability issues are identified before P3
- Documentation is production-ready

---

## 3. What Carried Over — Must Stay Stable

* [x] P1 token budget gateway is mandatory
* [x] P2 bounded execution model (no infinite loops)
* [x] Observer-only dashboard (no user input during execution)
* [x] Retry escalation with max attempts
* [x] No git push (local only)
* [x] No product-critical code changes
* [x] File locking for safe parallelism
* [x] State persistence and recovery

---

## 4. Background / What Was Wrong

P2 core implementation (7.A-7.L) is complete but:
- Runtime state files (.pi/) are not in .gitignore
- User documentation is missing
- Only synthetic dogfood validation (simple doc creation)
- No real-world execution validation
- Stability characteristics unknown
- Production readiness unclear

---

## 5. Current Failure State / Known Blockers

None. P2 core is complete and synthetic dogfood passes.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Real execution reveals bugs | medium | medium | Small scope, easy rollback |
| Documentation incomplete | low | low | Review existing CLI help |
| Runtime state pollution | low | low | Add .gitignore entries |
| Stability issues found | medium | low | Document for P3, don't block P2.1 |

---

## 7. Workstreams

### 7.A — Runtime Output Hygiene

**Goal:** Ensure runtime state never pollutes git commits.

**Acceptance criteria:**
- `.pi/plan-state.json` in .gitignore
- `.pi/execution-journal.ndjson` in .gitignore
- `.pi/workspaces/` in .gitignore
- `git status` clean after run + cleanup
- No runtime files in git history

**Dependencies:** None

---

### 7.B — P2 User Documentation

**Goal:** Document P2 commands and execution model for users.

**Acceptance criteria:**
- Document `pi plan doctor` command
- Document `pi plan dry-run` command
- Document `pi plan run` command
- Document `pi plan status` command
- Document `pi plan watch` command
- Document `pi plan resume` command
- Document `pi plan one` command
- Explain bounded execution model
- Explain P1 budget safety
- Explain observer-only dashboard
- Explain retry escalation model
- Documentation is in `docs/` directory

**Dependencies:** None

---

### 7.C — Real Dogfood Plan

**Goal:** Create a real small repository task plan for validation.

**Acceptance criteria:**
- Plan modifies only docs/tests/minor config
- No product-critical code changes
- Valid Part 3 JSON queue
- Dependency ordering specified
- Capability manifests specified
- Acceptance criteria specified
- Rollback section included
- Plan passes `pi plan doctor`
- Plan passes `pi plan dry-run`

**Dependencies:** 7.A, 7.B

---

### 7.D — Real Execution Validation

**Goal:** Execute real dogfood plan and validate all P2 features.

**Acceptance criteria:**
- Run `pi plan doctor` successfully
- Run `pi plan dry-run` successfully
- Run `pi plan run` successfully
- Run `pi plan status` successfully
- Run `pi plan watch` successfully
- Verify retries work correctly
- Verify state persistence works
- Verify journal correctness
- Verify snapshot creation
- Verify auto commit works
- Verify no git push occurs
- Capture findings in report

**Dependencies:** 7.C

---

### 7.E — Stability & Failure Analysis

**Goal:** Document stability characteristics and identify P3 prerequisites.

**Acceptance criteria:**
- Record token behavior observations
- Record retry behavior observations
- Record scheduler behavior observations
- Record dashboard behavior observations
- Record usability friction points
- Identify remaining architectural risks
- Identify P3 prerequisites
- Report is in `docs/` directory

**Dependencies:** 7.D

---

## 8. Combined Implementation Order

```text
7.A → 7.B → 7.C → 7.D → 7.E
```

All workstreams are sequential to ensure proper foundation before validation.

---

## 9. Definition of Done

P2.1 is complete when ALL are true:

* Runtime state files are in .gitignore
* `git status` is clean after execution
* P2 user documentation exists in `docs/`
* Real dogfood plan exists and passes doctor/dry-run
* Real dogfood execution completes successfully
* All P2 commands validated (doctor, dry-run, run, status, watch, resume, one)
* Retries, state persistence, journal, snapshots, auto-commit validated
* No git push occurred during execution
* Stability report exists documenting findings
* P3 prerequisites identified
* All changes committed (no git push)

---

## 10. Rollback Playbook

**Trigger:** Execution fails or produces unexpected results

**Rollback:**
1. Revert all commits from P2.1
2. Delete `.pi/` directory
3. Restore original .gitignore
4. Review execution journal for issues
5. Fix issues and retry

**Recovery time:** < 5 minutes

---

# Part 2 — Agent Brief

## Mission

Harden P2 for production use and validate with a real-world task.

You are preparing the P2 autonomous execution system for production use by:
1. Adding runtime hygiene (.gitignore)
2. Writing user documentation
3. Creating a real dogfood plan
4. Executing and validating the plan
5. Documenting stability findings

---

## Hard Requirements

1. Only modify docs, tests, .gitignore, and minor config
2. No product-critical code changes
3. No git push
4. No external services
5. No package changes
6. Sequential execution (respect dependencies)
7. Real dogfood plan must be small and safe
8. Document all findings

---

## Safety Stops

Hard stop only for:
- Attempts to modify product-critical code
- Attempts to git push
- Attempts to access secrets/env files
- Attempts to run destructive commands
- Attempts to modify package.json dependencies

---

# Part 3 — Workspace Queue

```json
{
  "phase": "P2.1",
  "title": "Production Hardening & Real Dogfood",
  "maxParallelWorkspaces": 1,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Runtime Output Hygiene",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": [".gitignore"],
        "cannotEdit": ["src/**", "packages/**/src/**", "package.json", "package-lock.json"],
        "canRun": ["git status", "ls -la .pi/"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        ".pi/plan-state.json in .gitignore",
        ".pi/execution-journal.ndjson in .gitignore",
        ".pi/workspaces/ in .gitignore",
        "git status clean after adding entries"
      ]
    },
    {
      "id": "7.B",
      "title": "P2 User Documentation",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/p2-user-guide.md"],
        "cannotEdit": ["src/**", "packages/**/src/**", "package.json", "package-lock.json"],
        "canRun": ["echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "docs/p2-user-guide.md created",
        "Documents all P2 commands",
        "Explains bounded execution model",
        "Explains P1 budget safety",
        "Explains observer-only dashboard",
        "Explains retry escalation model"
      ]
    },
    {
      "id": "7.C",
      "title": "Real Dogfood Plan",
      "dependencies": ["7.A", "7.B"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/p2-1-real-dogfood-task.md"],
        "cannotEdit": ["src/**", "packages/**/src/**", "package.json", "package-lock.json"],
        "canRun": ["echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "docs/p2-1-real-dogfood-task.md created",
        "Plan modifies only docs/tests/minor config",
        "Valid Part 3 JSON queue",
        "Dependency ordering specified",
        "Capability manifests specified",
        "Acceptance criteria specified",
        "Rollback section included"
      ]
    },
    {
      "id": "7.D",
      "title": "Real Execution Validation",
      "dependencies": ["7.C"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilities": {
        "canEdit": ["docs/p2-1-execution-report.md"],
        "cannotEdit": ["src/**", "packages/**/src/**", "package.json", "package-lock.json"],
        "canRun": ["pi plan doctor", "pi plan dry-run", "pi plan status", "echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf", "pi plan run"]
      },
      "acceptanceCriteria": [
        "docs/p2-1-execution-report.md created",
        "Documents doctor results",
        "Documents dry-run results",
        "Documents status results",
        "Documents all validation findings",
        "Note: Actual 'pi plan run' execution is manual, not automated in this workspace"
      ]
    },
    {
      "id": "7.E",
      "title": "Stability & Failure Analysis",
      "dependencies": ["7.D"],
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilities": {
        "canEdit": ["docs/p2-1-stability-report.md"],
        "cannotEdit": ["src/**", "packages/**/src/**", "package.json", "package-lock.json"],
        "canRun": ["echo"],
        "cannotRun": ["git push", "npm publish", "rm -rf"]
      },
      "acceptanceCriteria": [
        "docs/p2-1-stability-report.md created",
        "Records token behavior observations",
        "Records retry behavior observations",
        "Records scheduler behavior observations",
        "Records dashboard behavior observations",
        "Records usability friction points",
        "Identifies remaining architectural risks",
        "Identifies P3 prerequisites"
      ]
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P2.1",
  "title": "Production Hardening & Real Dogfood",
  "goal": "Harden P2 runtime hygiene, validate with real-world task, and document for production use",
  "workersDefault": 1,
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
    "external_services",
    "package_changes"
  ],
  "safetyLevel": "high",
  "blastRadius": "minimal",
  "rollbackComplexity": "trivial",
  "outputFiles": [
    ".gitignore",
    "docs/p2-user-guide.md",
    "docs/p2-1-real-dogfood-task.md",
    "docs/p2-1-execution-report.md",
    "docs/p2-1-stability-report.md"
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
  ],
  "telemetry": {
    "trackTokenUsage": true,
    "trackRetries": true,
    "trackScheduling": true,
    "trackDashboard": true
  },
  "p3Prerequisites": [
    "semantic_indexing_design",
    "vector_store_selection",
    "embedding_model_selection",
    "relevance_ranking_algorithm"
  ]
}
```

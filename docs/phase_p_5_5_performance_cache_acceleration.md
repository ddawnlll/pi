# Phase P5.5 — Performance, Cache & Retrieval Acceleration

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.1.0  
**Created:** 2026-05-13  
**Target system:** Pi autonomous coding runtime  
**Goal:** Improve execution speed and token efficiency before P6 scale work by stabilizing prompt caching, splitting static/dynamic context, adding lightweight retrieval/memory, reducing validation cost, and exposing performance telemetry.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P5.5  
**One-line goal:** Make Pi faster without making it less safe by increasing cache hit rate, shrinking worker context, reusing execution memory, and running smaller targeted validations.  
**Why now:** P5 improves production operations, but execution remains expensive and slow: cache hit can be 0%, workers receive large changing prompts, validation commands are heavy, and memory from successful/failed runs is not reused. P6 will add worktree isolation and higher parallelism, but before that Pi needs a performance layer.  
**Blast radius:** Prompt/context assembly, worker packet generation, model telemetry, execution metrics, validation command selection, local repo index, execution memory, dashboard performance panels, tests. Product application source changes are forbidden except docs/fixtures.  
**Rollback path:** Disable performance features with flags: `promptCache.enabled=false`, `retrieval.enabled=false`, `executionMemory.enabled=false`, `targetedValidation.enabled=false`. Fall back to P5 execution behavior.  
**Done when:** Static prompt prefix is cacheable, dynamic context is isolated at the suffix, cache hit is visible and actionable, worker packets are smaller and deterministic, repo/memory retrieval provides relevant context without full-file injection, validation is targeted when safe, and dogfood shows reduced tokens per completed workspace.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P5.5 |
| Title | Performance, Cache & Retrieval Acceleration |
| Status | Planned |
| Last updated | 2026-05-13 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Speed, cache hit, context reduction, targeted validation, reusable memory |
| Product-code changes | Forbidden — Pi runtime/dashboard/tests/docs only |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 5.5.A — Prompt cache architecture | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.B — Static/dynamic context split | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.C — Cacheable workspace packet format | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.D — Repo retrieval / local memory v1 | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.E — Execution memory from prior runs | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.F — Targeted validation planner | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.G — Performance telemetry dashboard | Pi Worker Agent | User / owner | Reviewer | User |
| 5.5.H — Performance dogfood & report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P4.6 makes execution visible and trustworthy. P5 makes execution durable and operational. P5.5 makes execution faster and cheaper before P6 increases parallelism.

The main problem is that worker prompts are likely changing too much between calls. Provider prompt caching usually works best when a large prefix is byte-for-byte stable. Pi currently mixes static instructions, plan text, workspace status, logs, timestamps, retry state, and recent events in ways that make cache hits unlikely. A 0% cache hit with large input tokens means Pi is paying repeatedly for context that should be reusable.

P5.5 introduces a layered performance model:

```text
1. Prompt Cache Layer
   Stable static prefix reused across worker calls.

2. Retrieval Layer
   Only relevant repo/context snippets are fetched.

3. Execution Memory Layer
   Prior run lessons, successful patches, failures, and file/test mappings are reused.

4. Targeted Validation Layer
   Run the smallest safe validation first; full validation remains final gate.
```

This phase should not reduce correctness. It should reduce wasted context, repeated reasoning, unnecessary validations, and unknown cache behavior.

---

## 3. What Carried Over — Must Stay Stable

* [x] P4.5 adaptive edit strategy remains active.
* [x] P4.6 visibility, progress, hung detection, live logs, and resume confidence remain active.
* [x] Global validation lock remains active: only one heavy validation command at a time.
* [x] P5 execution archive and docs export behavior must not regress if already implemented.
* [x] P1 token budget gateway remains mandatory.
* [x] No full repo injection by default.
* [x] No raw chain-of-thought stored in memory or shown in UI.
* [x] `git push`, raw `rm -rf`, secrets, and forbidden files remain blocked.
* [x] Same-file parallelism remains disabled.
* [x] TypeScript strict mode remains required.
* [x] No new npm dependencies without explicit approval.

---

## 4. Background / What Was Wrong

Recent runs showed high token usage and slow completion despite multiple workers. Example symptoms:

* Cache hit can remain at 0%.
* Large static context is likely re-sent as dynamic prompt content.
* Workers may repeat repository discovery that previous workers already performed.
* Validation commands can dominate runtime.
* Typecheck/build/test are often run too broadly and too often.
* Successful fixes and prior failures are not converted into reusable execution memory.
* Performance metrics show tokens and cost, but do not yet explain efficiency per completed workspace or per progress percentage.

P5.5 fixes these issues before P6 adds worktree isolation and higher worker counts. More workers without cache/retrieval/validation efficiency would simply burn tokens faster.

---

## 5. Current Failure State / Known Blockers

* `prompt_cache_prefix` = missing — static context is not explicitly separated from dynamic context.
* `cache_hit_diagnostics` = incomplete — 0% cache hit is visible but not explained or actionable.
* `worker_packet_determinism` = incomplete — workspace packet ordering/content may vary unnecessarily.
* `dynamic_context_suffix` = incomplete — logs/timestamps/retry state may pollute cacheable prefix.
* `repo_retrieval_v1` = missing — workers still rely on ad hoc file reads/searches.
* `execution_memory` = missing — prior run lessons are not retrieved for new workspaces.
* `targeted_validation` = incomplete — workers run broad validation instead of smallest safe checks.
* `performance_dashboard` = incomplete — no clear tokens per completed workspace, cache hit reason, validation time, or context size breakdown.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Cache prefix becomes stale | med | med | Include explicit cache prefix version/hash and invalidate on policy/plan changes |
| Retrieval omits critical context | med | high | Retrieval augments, never replaces required workspace contract/safety context |
| Execution memory repeats bad advice | med | high | Store outcomes and confidence; retrieve only successful or reviewed lessons by default |
| Targeted validation misses integration failure | med | high | Targeted validation is early gate; final phase/workspace integration still runs required full validation |
| Performance optimization reduces safety | low | critical | Safety block remains outside performance layer and cannot be disabled |
| Memory stores private reasoning | low | high | Store action summaries, facts, failures, files, commands, outcomes only; no raw private reasoning |
| Cache metrics are provider-specific | med | low | Show unknown if unavailable; do not infer false cache hit data |
| Extra indexing slows runs | med | med | Index incrementally and lazily; allow retrieval disabled flag |

---

## 7. Workstreams

### 5.5.A — Prompt cache architecture

**Goal:** Define a prompt assembly architecture that makes static context stable and cacheable.

**Requirements:**
* Add `PromptCachePolicy` module.
* Define cacheable prefix sections:
  * system/tool policy
  * safety policy
  * edit strategy policy
  * execution contract schema rules
  * stable project conventions
  * static phase/workspace contract where safe
* Define dynamic suffix sections:
  * current timestamp
  * current workspace status
  * last tool result
  * latest logs
  * retry count
  * current diff
  * recent failure
* Add cache prefix hash and version.
* Add prompt assembly debug metadata:
  * prefix bytes/tokens estimate
  * suffix bytes/tokens estimate
  * cacheability reason
* Dynamic content must never be inserted into the prefix.

**Acceptance Criteria:**
* Prompt assembly separates cacheable prefix from dynamic suffix.
* Static prefix hash remains stable across equivalent worker calls.
* Dynamic suffix changes do not change prefix hash.
* Cache prefix version invalidates when safety or policy changes.
* Tests cover stable prefix and changing suffix.

---

### 5.5.B — Static/dynamic context split

**Goal:** Refactor worker context building so dynamic execution data is isolated and minimized.

**Requirements:**
* Add `ContextSection` model with fields:
  * `kind`
  * `cacheability`
  * `priority`
  * `tokenEstimate`
  * `source`
  * `hash`
* Mark sections as:
  * `static_cacheable`
  * `semi_static_cacheable`
  * `dynamic_non_cacheable`
  * `ephemeral`
* Ensure logs, timestamps, tool results, and retry state are always dynamic suffix.
* Ensure static phase plan text is stable and normalized.
* Add context report per worker call.

**Acceptance Criteria:**
* Context sections are explicitly classified.
* Logs/timestamps/retry data do not appear in cacheable prefix.
* Worker context report shows static/dynamic token split.
* Existing token budget gateway still applies.
* Tests cover context classification.

---

### 5.5.C — Cacheable workspace packet format

**Goal:** Make workspace packets deterministic and small enough to reuse across attempts.

**Requirements:**
* Normalize workspace packet field order.
* Include stable workspace contract hash.
* Include deterministic allowedFiles/forbiddenFiles ordering.
* Include deterministic acceptance criteria ordering.
* Move live state and latest logs out of packet body into dynamic suffix.
* Add `workspacePacketHash` to state and archive.
* Add packet diff report when packet changes between attempts.

**Acceptance Criteria:**
* Same workspace contract produces same packet hash.
* Retry attempt does not change packet hash unless contract changes.
* Dynamic state changes do not alter packet hash.
* Packet hash is visible in logs/artifacts.
* Tests cover deterministic packet generation.

---

### 5.5.D — Repo retrieval / local memory v1

**Goal:** Add lightweight local retrieval so workers receive relevant context without full-file or full-repo injection.

**Requirements:**
* Build simple local repo index from:
  * file paths
  * exports/symbol names where cheaply available
  * imports
  * test file associations by naming/path convention
  * recent touched files
* Retrieval query inputs:
  * workspace title
  * allowedFiles
  * acceptance criteria
  * failed test names
  * changed files
* Retrieval output:
  * small ranked list of relevant files/snippets
  * reason for each result
  * token estimate
* No external vector database required in v1.
* Optional future adapter can support vector DB.
* Retrieval must obey forbidden file policy.

**Acceptance Criteria:**
* Retrieval returns relevant repo paths/snippets for a workspace.
* Retrieval does not access forbidden files.
* Retrieval output is capped by token budget.
* Retrieval reasons are logged.
* Tests cover path/symbol/test association retrieval.

---

### 5.5.E — Execution memory from prior runs

**Goal:** Store and retrieve useful prior execution lessons without storing private reasoning.

**Requirements:**
* Add `ExecutionMemoryEntry` schema:
  * `id`
  * `planExecId`
  * `workspaceId`
  * `filesTouched`
  * `commandsRun`
  * `failureType`
  * `fixSummary`
  * `validationOutcome`
  * `reusableLesson`
  * `confidence`
  * `createdAt`
* Store entries for:
  * successful workspace completion
  * failed validation and fix
  * edit failure handoff
  * validation lock bottlenecks
  * repeated file conflicts
* Retrieve only relevant entries by file path, symbol, workspace title, and failure type.
* Store action summaries only; no raw private reasoning.
* Add memory allow/disable setting.

**Acceptance Criteria:**
* Successful workspace creates memory entry.
* Failed workspace creates failure memory entry.
* New workspace retrieves relevant prior memory.
* Memory entries exclude raw hidden reasoning.
* Memory can be disabled.
* Tests cover store/retrieve/filter behavior.

---

### 5.5.F — Targeted validation planner

**Goal:** Reduce validation time by choosing the smallest safe validation first while preserving full validation gates where required.

**Requirements:**
* Add `ValidationPlanner` service.
* Inputs:
  * changed files
  * workspace targetCommand
  * package/project graph if available
  * test associations
  * risk level
* Output validation plan:
  * `quickChecks`
  * `targetedTests`
  * `requiredFinalChecks`
* Examples:
  * TS-only runtime change → targeted typecheck/package test first
  * dashboard component change → dashboard build/test first
  * core executor change → coding-agent tests + typecheck
* Global validation lock still applies to heavy commands.
* Watch-mode validation remains forbidden.
* Final required validation still runs before workspace completion when targetCommand requires it.

**Acceptance Criteria:**
* Planner chooses targeted validation based on changed files.
* Full validation still runs when required by targetCommand/risk.
* Watch mode commands are rejected.
* Validation lock wraps heavy validation commands.
* Tests cover dashboard, coding-agent, server, docs-only changes.

---

### 5.5.G — Performance telemetry dashboard

**Goal:** Make cache, retrieval, validation, and token efficiency visible in the dashboard.

**Requirements:**
* Add metrics:
  * cache hit rate
  * cache hit unknown vs zero
  * prefix/suffix token estimates
  * tokens per completed workspace
  * tokens per 1% progress
  * validation wait time
  * validation run time
  * retrieval hits used
  * memory hits used
  * prompt packet hash changes
* Show warning when:
  * cache hit is 0% and input tokens are high
  * prefix hash changes too often
  * validation wait time dominates runtime
  * retrieval disabled and context usage is high
* Add per-workspace performance details.

**Acceptance Criteria:**
* Dashboard shows cache/prompt/validation performance metrics.
* Dashboard distinguishes cache unknown from 0%.
* Workspace detail shows prefix/suffix token split.
* Validation lock wait time is visible.
* Tests cover metric calculation.

---

### 5.5.H — Performance dogfood & report

**Goal:** Prove P5.5 reduces waste without reducing correctness.

**Requirements:**
* Run dogfood on a plan with at least 5 workspaces.
* Capture baseline metrics where possible:
  * tokens in/out
  * cache hit
  * elapsed time
  * validation time
  * completed workspace count
  * retries
* Run with P5.5 features enabled.
* Compare:
  * tokens per completed workspace
  * prefix stability
  * context size
  * validation wait/run time
  * cache hit improvement or unknown explanation
* Publish `docs/pi/stability/p5-5-performance-cache-report.md`.

**Acceptance Criteria:**
* Dogfood report exists.
* Report shows prefix/suffix token split.
* Report shows cache hit/unknown status.
* Report shows validation time reduction or explanation.
* Report confirms no safety regression.
* TypeScript and relevant tests pass.

---

## 8. Combined Implementation Order

```text
Batch 1: 5.5.A                                     (prompt cache architecture — foundation)
Batch 2: 5.5.B, 5.5.C, 5.5.D, 5.5.F, 5.5.G       (parallel: context, packets, retrieval, validation, dashboard)
Batch 3: 5.5.E                                     (execution memory — needs retrieval)
Batch 4: 5.5.H                                     (dogfood — needs everything)
```

Rationale:

* Cache architecture must come first.
* Context split (B), deterministic packets (C), repo retrieval (D), validation planning (F),
  and dashboard telemetry (G) touch different packages and can run in parallel after A.
* Execution memory (E) builds on retrieval (D) so waits one batch.
* Dogfood (H) validates performance and safety before P6 scale work.

---

## 9. Definition of Done

P5.5 is complete when ALL are true:

* [ ] Prompt assembly separates cacheable prefix from dynamic suffix.
* [ ] Static prefix hash remains stable across equivalent worker calls.
* [ ] Worker context report shows prefix/suffix token estimates.
* [ ] Workspace packets are deterministic and hashable.
* [ ] Dynamic logs/timestamps/retry state do not alter packet hash.
* [ ] Local repo retrieval returns relevant capped context.
* [ ] Retrieval obeys forbidden file policy.
* [ ] Execution memory stores successful/failure lessons without raw private reasoning.
* [ ] Relevant execution memory is retrieved for future workspaces.
* [ ] Targeted validation planner chooses smaller safe validation commands.
* [ ] Full validation gates remain where required.
* [ ] Global validation lock remains active.
* [ ] Watch-mode validation remains forbidden.
* [ ] Dashboard shows cache/prompt/validation performance metrics.
* [ ] Cache hit unknown is distinct from 0%.
* [ ] Performance dogfood report proves reduced waste or explains bottlenecks.
* [ ] TypeScript compiles cleanly.
* [ ] P4.6 visibility and correctness features remain compatible.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Prompt cache prefix causes stale or wrong instructions.
* Retrieval omits required context and causes incorrect edits.
* Execution memory retrieves misleading or bad lessons.
* Targeted validation misses critical failures.
* Performance metrics become misleading.
* Token usage increases significantly without progress improvement.

**Rollback procedure:**
1. Set `promptCache.enabled=false`.
2. Set `retrieval.enabled=false`.
3. Set `executionMemory.enabled=false`.
4. Set `targetedValidation.enabled=false`.
5. Keep dashboard telemetry read-only if safe.
6. Fall back to P5 execution behavior.
7. Preserve performance reports for analysis.

**Recovery time:** < 10 minutes.

---

## 11. What Phase P6 Inherits

P6 inherits:

* Stable prompt cache prefix architecture
* Static/dynamic context split
* Deterministic workspace packet hashes
* Local repo retrieval v1
* Execution memory v1
* Targeted validation planner
* Performance telemetry dashboard
* Cache/validation dogfood report

P6 may add:

* Git worktree isolation
* Dynamic high-parallel scheduler
* Test impact analysis v2
* Symbol graph v2
* Safe 6+ worker mode
* Merge queue
* Integration validation planner

---

# Part 2 — Agent Brief

## Mission

Implement P5.5 — Performance, Cache & Retrieval Acceleration.

You are making Pi faster and cheaper before P6 scale work. Do not reduce safety. Do not hide failures. Optimize context assembly, prompt cacheability, retrieval, execution memory, and validation cost while preserving P4.6 visibility and completion gate correctness.

---

## Hard Requirements

1. Static cacheable prompt prefix must be separated from dynamic suffix.
2. Dynamic logs, timestamps, retry state, latest tool output, and current diff must not enter cacheable prefix.
3. Cache hit unknown must not be displayed as 0%.
4. Retrieval must obey forbidden file policy.
5. Execution memory must not store raw private chain-of-thought.
6. Targeted validation must not bypass required final validation gates.
7. Global validation lock must remain active.
8. Watch-mode validation commands remain forbidden.
9. `git push` remains forbidden.
10. Raw `rm -rf` remains forbidden.
11. No secrets or forbidden files may be read for retrieval/memory.
12. No new npm dependencies without explicit approval.
13. TypeScript strict mode: no new `as any`, `@ts-ignore`, or `@ts-expect-error`.

---

## Execution Policies

```yaml
performance:
  prompt_cache:
    enabled: true
    static_prefix_required: true
    dynamic_suffix_required: true
    prefix_hash_tracking: true
    cache_hit_unknown_when_unavailable: true

  context:
    classify_sections: true
    dynamic_logs_in_suffix_only: true
    timestamps_in_suffix_only: true
    retry_state_in_suffix_only: true
    deterministic_workspace_packets: true

  retrieval:
    enabled: true
    provider: local_repo_index_v1
    forbidden_files_respected: true
    max_retrieval_tokens_per_workspace: 6000

  execution_memory:
    enabled: true
    store_private_reasoning: false
    store_success_lessons: true
    store_failure_lessons: true
    retrieve_by_file_and_failure_type: true

  validation:
    targeted_validation_enabled: true
    required_final_validation_preserved: true
    global_validation_lock_required: true
    watch_mode_forbidden: true
```

---

## Safety Stops

Hard stop execution only for:

* forbidden file access during retrieval
* secrets/env/private-key access
* raw private reasoning stored in memory
* targeted validation attempting to bypass required final validation
* watch-mode validation command
* completed workspace marked complete despite failed validation
* `git push`
* raw destructive commands

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "json",
  "project": {
    "name": "pi-mono",
    "rootPath": "/Users/hootie/src/pi",
    "type": "repo",
    "tags": [
      "p5.5",
      "performance",
      "prompt-cache",
      "retrieval",
      "execution-memory",
      "targeted-validation"
    ]
  },
  "planExecution": {
    "phase": "P5.5",
    "title": "Performance, Cache & Retrieval Acceleration",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "json",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "postPlanHandoff": true,
    "performance": {
      "promptCache": {
        "enabled": true,
        "staticPrefixRequired": true,
        "dynamicSuffixRequired": true,
        "prefixHashTracking": true,
        "cacheHitUnknownWhenUnavailable": true
      },
      "context": {
        "classifySections": true,
        "dynamicLogsInSuffixOnly": true,
        "timestampsInSuffixOnly": true,
        "retryStateInSuffixOnly": true,
        "deterministicWorkspacePackets": true
      },
      "retrieval": {
        "enabled": true,
        "provider": "local_repo_index_v1",
        "forbiddenFilesRespected": true,
        "maxRetrievalTokensPerWorkspace": 6000
      },
      "executionMemory": {
        "enabled": true,
        "storePrivateReasoning": false,
        "storeSuccessLessons": true,
        "storeFailureLessons": true,
        "retrieveByFileAndFailureType": true
      },
      "validation": {
        "targetedValidationEnabled": true,
        "requiredFinalValidationPreserved": true,
        "globalValidationLockRequired": true,
        "watchModeForbidden": true
      }
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
      "git_push",
      "forbidden_retrieval_access",
      "private_reasoning_stored",
      "required_validation_bypassed",
      "watch_mode_validation"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish",
      "terraform destroy",
      "kubectl delete",
      "git reset --hard",
      "git clean -fd",
      "vitest --watch",
      "jest --watch",
      "npm run dev"
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
      "id": "5.5.A",
      "title": "Prompt cache architecture",
      "dependencies": [],
      "allowedFiles": [
        "packages/coding-agent/src/context/prompt-cache-policy.ts",
        "packages/coding-agent/src/context/prompt-assembler.ts",
        "packages/coding-agent/test/prompt-cache-policy.test.ts",
        "docs/pi/performance/prompt-cache-architecture.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Prompt assembly separates cacheable prefix from dynamic suffix",
        "Static prefix hash remains stable across equivalent calls",
        "Dynamic suffix changes do not change prefix hash",
        "Cache prefix version invalidates on safety/policy changes",
        "Tests cover stable prefix and changing suffix"
      ],
      "targetCommand": "npm run typecheck && npm test -- prompt-cache-policy",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/context/prompt-cache-policy.ts",
          "packages/coding-agent/src/context/prompt-assembler.ts",
          "packages/coding-agent/test/prompt-cache-policy.test.ts",
          "docs/pi/performance/prompt-cache-architecture.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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
    },
    {
      "id": "5.5.B",
      "title": "Static/dynamic context split",
      "dependencies": [
        "5.5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/context/context-section.ts",
        "packages/coding-agent/src/context/context-builder.ts",
        "packages/coding-agent/test/context-section.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Context sections are classified by cacheability",
        "Logs/timestamps/retry data stay out of prefix",
        "Worker context report shows static/dynamic token split",
        "Token budget gateway still applies",
        "Context classification tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- context-section",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/context/context-section.ts",
          "packages/coding-agent/src/context/context-builder.ts",
          "packages/coding-agent/test/context-section.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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
    },
    {
      "id": "5.5.C",
      "title": "Cacheable workspace packet format",
      "dependencies": [
        "5.5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/context/workspace-packet.ts",
        "packages/coding-agent/src/core/workspace-schema.ts",
        "packages/coding-agent/test/workspace-packet.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Same workspace contract produces same packet hash",
        "Retry does not change packet hash unless contract changes",
        "Dynamic state changes do not alter packet hash",
        "Packet hash is visible in logs/artifacts",
        "Deterministic packet tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- workspace-packet",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/context/workspace-packet.ts",
          "packages/coding-agent/src/core/workspace-schema.ts",
          "packages/coding-agent/test/workspace-packet.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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
    },
    {
      "id": "5.5.D",
      "title": "Repo retrieval / local memory v1",
      "dependencies": [
        "5.5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/retrieval/local-repo-index.ts",
        "packages/coding-agent/src/retrieval/retrieval-service.ts",
        "packages/coding-agent/test/local-repo-index.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Retrieval returns relevant repo paths/snippets",
        "Retrieval does not access forbidden files",
        "Retrieval output is capped by token budget",
        "Retrieval reasons are logged",
        "Retrieval tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- local-repo-index",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/retrieval/local-repo-index.ts",
          "packages/coding-agent/src/retrieval/retrieval-service.ts",
          "packages/coding-agent/test/local-repo-index.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "retrieval_performed",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.5.E",
      "title": "Execution memory from prior runs",
      "dependencies": [
        "5.5.D"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/memory/execution-memory.ts",
        "packages/coding-agent/src/memory/execution-memory-store.ts",
        "packages/coding-agent/test/execution-memory.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "**/credentials/**",
        "**/secrets/**"
      ],
      "acceptanceCriteria": [
        "Successful workspace creates memory entry",
        "Failed workspace creates failure memory entry",
        "New workspace retrieves relevant prior memory",
        "Memory excludes raw hidden reasoning",
        "Memory can be disabled",
        "Memory tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- execution-memory",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/memory/execution-memory.ts",
          "packages/coding-agent/src/memory/execution-memory-store.ts",
          "packages/coding-agent/test/execution-memory.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "execution_memory_stored",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.5.F",
      "title": "Targeted validation planner",
      "dependencies": [
        "5.5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/validation/validation-planner.ts",
        "packages/coding-agent/src/core/validation-lock.ts",
        "packages/coding-agent/test/validation-planner.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Planner chooses targeted validation based on changed files",
        "Full validation remains when required by targetCommand/risk",
        "Watch mode commands are rejected",
        "Validation lock wraps heavy commands",
        "Validation planner tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- validation-planner",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/validation/validation-planner.ts",
          "packages/coding-agent/src/core/validation-lock.ts",
          "packages/coding-agent/test/validation-planner.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "validation_plan_created",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.5.G",
      "title": "Performance telemetry dashboard",
      "dependencies": [],
      "allowedFiles": [
        "packages/web-server/src/performance-routes.ts",
        "packages/web-ui/dashboard/src/components/PerformancePanel.tsx",
        "packages/web-ui/dashboard/src/hooks/usePerformanceMetrics.ts",
        "packages/web-server/test/performance-routes.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Dashboard shows cache/prompt/validation performance metrics",
        "Cache unknown is distinct from 0%",
        "Workspace detail shows prefix/suffix token split",
        "Validation lock wait time is visible",
        "Metric calculation tests pass"
      ],
      "targetCommand": "npm run typecheck && npm run build && npm test -- performance-routes",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/performance-routes.ts",
          "packages/web-ui/dashboard/src/components/PerformancePanel.tsx",
          "packages/web-ui/dashboard/src/hooks/usePerformanceMetrics.ts",
          "packages/web-server/test/performance-routes.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build",
          "npm test"
        ],
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
    },
    {
      "id": "5.5.H",
      "title": "Performance dogfood & report",
      "dependencies": [
        "5.5.A",
        "5.5.B",
        "5.5.C",
        "5.5.D",
        "5.5.E",
        "5.5.F",
        "5.5.G"
      ],
      "allowedFiles": [
        "packages/coding-agent/test/p55-performance-dogfood.test.ts",
        "docs/pi/stability/p5-5-performance-cache-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "Dogfood report exists",
        "Report shows prefix/suffix token split",
        "Report shows cache hit/unknown status",
        "Report shows validation time reduction or explanation",
        "Report confirms no safety regression",
        "TypeScript and relevant tests pass"
      ],
      "targetCommand": "npm run typecheck && npm test -- p55-performance-dogfood",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/p55-performance-dogfood.test.ts",
          "docs/pi/stability/p5-5-performance-cache-report.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
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

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.1.0",
  "phase": "P5.5",
  "title": "Performance, Cache & Retrieval Acceleration",
  "primaryGoal": "Improve Pi execution speed and token efficiency through prompt caching, static/dynamic context split, local retrieval, execution memory, targeted validation, and performance telemetry.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "notInScope": [
    "P6 git worktree isolation",
    "safe 6+ worker production mode",
    "merge queue",
    "remote vector database requirement",
    "remote skill registry",
    "agent-agnostic runtime split",
    "full public platformization"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "git_push",
    "forbidden_retrieval_access",
    "private_reasoning_stored",
    "required_validation_bypassed",
    "watch_mode_validation"
  ],
  "completionGate": "P5.5 is complete when cacheable prompt prefixes are stable, dynamic context is isolated, workspace packets are deterministic, local retrieval and execution memory reduce repeated context discovery, targeted validation reduces unnecessary heavy checks, and dashboard telemetry proves improved tokens per completed workspace without safety regression.",
  "nextPhase": "P6"
}
```


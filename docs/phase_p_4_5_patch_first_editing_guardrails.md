# Phase P4.5 — Adaptive Edit Strategy & Failure Handoff

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.1.0  
**Created:** 2026-05-13  
**Target system:** Pi autonomous coding runtime  
**Goal:** Replace hard token-saving edit behavior with adaptive edit strategy modes, failure-aware retry limits, and clean human handoff when the agent gets stuck editing a file.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P4.5  
**One-line goal:** Make Pi choose the right edit strategy for the situation — full rewrite, targeted patch, or human handoff — instead of blindly optimizing for tokens or repeatedly retrying failed edits.  
**Why now:** Real runs showed two opposite failure modes: full-file rewrites wasted tokens through truncation, while strict patch-first edits became brittle and failed on exact-match patches. Hard token optimization is not enough; Pi needs adaptive edit strategy and fast failure handoff.  
**Blast radius:** Pi coding-agent edit pipeline, write/edit tool wrappers, workspace-agent executor, state store metadata, audit logs, doctor checks, dashboard worker warnings, and tests. Product application source changes are forbidden except fixtures/docs.  
**Rollback path:** Set edit strategy mode to `speed`, or set `PI_EDIT_STRATEGY_ENFORCEMENT=warn`, then fall back to P4 behavior. If the write/edit wrapper is unstable, revert P4.5 commits independently.  
**Done when:** Hybrid mode is the default, users can select Token Saving / Hybrid / Speed from settings, full rewrites are allowed when they are practical, truncation forces fallback, repeated edit failures stop the workspace instead of burning tokens, and the dashboard provides a clean manual handoff with attempted patch details.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P4.5 |
| Title | Adaptive Edit Strategy & Failure Handoff |
| Status | Planned |
| Last updated | 2026-05-13 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Edit reliability, completion speed, failure handoff, token waste prevention |
| Product-code changes | Forbidden — Pi runtime/tests/docs only |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 4.5.A — Edit strategy modes | Pi Worker Agent | User / owner | Reviewer | User |
| 4.5.B — Write/Edit gate integration | Pi Worker Agent | User / owner | Reviewer | User |
| 4.5.C — Truncation and edit failure detector | Pi Worker Agent | User / owner | Reviewer | User |
| 4.5.D — Failure handoff and manual recovery | Pi Worker Agent | User / owner | Reviewer | User |
| 4.5.E — Audit, reporting, and dashboard visibility | Pi Worker Agent | User / owner | Reviewer | User |
| 4.5.F — Doctor checks, tests, and dogfood replay | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P1 focused on input token control: compact packets, context budgets, and large-file context policy. But recent runs showed that input token savings do not automatically produce efficient or reliable implementation. The agent can still waste output tokens by repeatedly rewriting large files, or it can fail slowly by trying brittle exact-match patches.

P4.5 changes the goal from “always save tokens” to **complete correctly and quickly, while preventing obvious waste loops**. Token efficiency remains important, but it is no longer the primary default behavior. The default mode should be Hybrid: allow full rewrites for manageable files, prefer patching for very large files, and stop quickly when the chosen strategy fails repeatedly.

The phase introduces three edit strategy modes:

```text
Token Saving  → strict patch-first, lowest token usage, slower but safer for expensive runs
Hybrid        → default, allows full rewrite under practical thresholds, patch for large files
Speed         → prioritizes fast implementation, disables token-saving edit restrictions, keeps hard safety gates
```

The most important new behavior is **failure handoff**. If Pi fails to edit the same file repeatedly, it must not keep burning tokens. It should mark the workspace `BLOCKED`, show the attempted edits and current diff, and let the user either fix manually or resume with a new instruction.

---

## 3. What Carried Over — Must Stay Stable

* [x] P1 token budget gateway remains mandatory for model requests.
* [x] P1 large-file input policy remains available.
* [x] P2 bounded autonomous execution remains intact.
* [x] P3 reliability and recovery fixes must not regress.
* [x] P4 structured logs and tool-call events must continue to work.
* [x] P4 auto-commit must never push.
* [x] Existing `write` behavior for new files must remain supported.
* [x] Existing targeted edit behavior must remain supported.
* [x] No product source files should be modified by P4.5 implementation.
* [x] No new npm dependencies without explicit approval.
* [x] TypeScript strict mode remains required.
* [x] Hard safety gates remain active in every edit mode.

---

## 4. Background / What Was Wrong

Two real failure patterns motivated P4.5.

First, the agent tried to rewrite a large existing TSX file multiple times. The file output was truncated, the agent retried full rewrite, tried again in parts, then restored the original file and only later switched to targeted edits. This wasted more tokens than the earlier token-saving work intended to save.

Second, after introducing patch-first thinking, the agent got stuck on a brittle exact-match patch. It successfully made small import/interface edits, then failed to replace a larger block because the `oldText` did not match exact whitespace and newlines. That left the file partially modified and the workspace continued spending time without clear progress.

The lesson:

```text
Full rewrite can be wasteful.
Hard patch-first can be brittle.
The real fix is adaptive strategy + fast stop on repeated failure.
```

P4.5 therefore introduces configurable modes, better edit attempt tracking, truncation detection, and human handoff when a workspace is stuck.

---

## 5. Current Failure State / Known Blockers

* `edit_strategy_modes` = not implemented — user cannot choose Token Saving / Hybrid / Speed.
* `hybrid_default` = not implemented — current behavior is inconsistent and not policy-driven.
* `write_gate` = incomplete — full rewrites are not evaluated against mode, file size, or failure history.
* `exact_match_failure_tracking` = not implemented — failed edit patches are not counted by file.
* `truncation_detector` = not implemented — truncation does not automatically switch strategy.
* `same_file_failure_handoff` = not implemented — agent keeps trying instead of stopping after repeated failures.
* `manual_recovery_flow` = not implemented — dashboard does not show attempted patch, partial diff, and resume options.
* `edit_strategy_audit` = incomplete — users cannot see which strategy was used and why it failed.
* `doctor_edit_strategy_check` = not implemented — plans touching large files are not warned based on selected mode.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Speed mode causes token spikes | med | med | Make Hybrid default; Speed must be explicit and audited |
| Token Saving mode blocks useful full rewrites | med | med | User can switch to Hybrid or Speed from settings |
| Hybrid thresholds are wrong | med | low | Make thresholds config-driven and visible in settings |
| Failure handoff stops too early | med | med | Default to 2 same-file edit failures before handoff; allow reviewer override |
| Agent loops after rewrite denial | med | high | Rewrite denial must include next allowed action and increment failure counter |
| Partial edits remain after failure | med | high | Capture pre-edit snapshot and show current diff in handoff |
| Exact-match detector false positives | low | low | Count only tool-returned edit failures, not ordinary compiler errors |
| Dashboard handoff becomes noisy | low | low | Show handoff only after threshold, not on first failure |
| Safety gates accidentally relaxed in Speed mode | low | critical | Hard safety gates are separate from token-saving edit restrictions |

---

## 7. Workstreams

### 4.5.A — Edit strategy modes

**Goal:** Define a centralized edit strategy policy with three modes: Token Saving, Hybrid, and Speed.

**Requirements:**
* Add `EditStrategyPolicy` module.
* Add `editStrategyMode` setting with values: `token_saving`, `hybrid`, `speed`.
* Default mode is `hybrid`.
* Token Saving mode:
  * existing files over 200 lines or 8KB require targeted patch mode
  * existing TSX/JSX components over 300 lines require targeted patch mode
  * strict output budget
* Hybrid mode:
  * existing files under 1000 lines and 40KB may be full-rewritten if output budget passes
  * existing files over 1000 lines or 40KB prefer/require targeted patch mode
  * this is the default mode
* Speed mode:
  * token-saving edit restrictions are disabled
  * full rewrite is allowed under 1000 lines by default
  * files over 1000 lines require warning/audit and optional explicit override
  * hard safety gates remain active
* New file writes are allowed in all modes.
* Generated-file rewrites are allowed only when explicitly marked generated/rewrite-safe.
* Policy returns a decision and reason code.

**Mode defaults:**

```yaml
edit_strategy:
  default_mode: hybrid
  modes:
    token_saving:
      existing_file_full_rewrite_max_lines: 200
      existing_file_full_rewrite_max_bytes: 8000
      tsx_component_patch_required_lines: 300
      max_generated_output_bytes_without_override: 12000

    hybrid:
      existing_file_full_rewrite_max_lines: 1000
      existing_file_full_rewrite_max_bytes: 40000
      tsx_component_patch_required_lines: 1000
      max_generated_output_bytes_without_override: 50000

    speed:
      token_saving_edit_restrictions_enabled: false
      existing_file_full_rewrite_soft_limit_lines: 1000
      require_override_above_lines: 1000
      hard_safety_gates_enabled: true
```

**Acceptance Criteria:**
* `EditStrategyPolicy` supports all three modes.
* Hybrid is default.
* Token Saving blocks full rewrite above strict thresholds.
* Hybrid allows full rewrite below 1000 lines / 40KB.
* Speed allows full rewrite below 1000 lines while preserving hard safety gates.
* New file writes are allowed in all modes.
* Generated-file rewrites require generated-file marking.
* Unit tests cover all mode decisions.

---

### 4.5.B — Write/Edit gate integration

**Goal:** Apply the selected edit strategy at the actual write/edit tool boundary.

**Requirements:**
* Wrap all write/edit tool paths used by `WorkspaceAgentExecutor`.
* Before full-file write to an existing file, collect metadata: exists, line count, byte count, extension, hash.
* Apply current project `editStrategyMode`.
* Allow or block full write according to policy.
* Targeted edits remain allowed in all modes.
* Full writes to new files remain allowed in all modes.
* Hard safety gates apply before edit strategy:
  * forbidden files
  * secrets/env/private keys
  * path escaping
  * destructive commands
* On blocked rewrite, return clear next action: use targeted edit or switch mode.
* Create pre-edit snapshot for guarded files.
* On failed edit, keep snapshot path for handoff.

**Acceptance Criteria:**
* Token Saving blocks full write to existing 815-line TSX file.
* Hybrid allows full rewrite for existing files under 1000 lines and 40KB.
* Speed allows full rewrite under 1000 lines.
* Forbidden files remain blocked in all modes.
* Targeted edit remains allowed in all modes.
* Blocked rewrite emits `edit_strategy_blocked`.
* Pre-edit snapshot is available for failure handoff.

---

### 4.5.C — Truncation and edit failure detector

**Goal:** Detect failed edit strategies and stop retry loops before they waste time and tokens.

**Requirements:**
* Track edit attempts per `{planExecId, workspaceId, filePath}`.
* Track attempt type:
  * full_write
  * targeted_edit
  * patch_plan
  * restore
* Track failure type:
  * truncation
  * exact_match_failed
  * output_too_large
  * malformed_patch
  * validation_failed_after_edit
  * restore_after_failed_write
* Detect truncation markers:
  * `truncated`
  * `The file got truncated`
  * `write is truncating`
  * `Let me write the complete file again`
  * `complete file in parts`
  * `... more lines`
* Detect exact-match edit failures from tool output:
  * `Could not find the exact text`
  * `old text must match exactly`
* Truncation forces patch fallback in all modes.
* Exact-match failure increments same-file edit failure counter.
* Same-file edit failure threshold defaults to 2.
* Detector state is persisted in workspace metadata.

**Acceptance Criteria:**
* Truncation forces fallback away from full rewrite.
* Exact-match edit failure is detected and counted.
* Two same-file edit failures trigger handoff state.
* Targeted edit after full-write truncation remains allowed.
* Detector state survives retry within same workspace.

---

### 4.5.D — Failure handoff and manual recovery

**Goal:** Stop the workspace cleanly when Pi gets stuck editing the same file, and give the user a useful manual recovery surface.

**Requirements:**
* If `sameFileEditFailures >= 2`, mark workspace `BLOCKED_EDIT_FAILURE`.
* Stop further autonomous edit attempts for that file.
* Emit `edit_failure_handoff` event.
* Handoff payload includes:
  * file path
  * selected edit mode
  * failed strategy list
  * last tool error
  * pre-edit snapshot path
  * current diff
  * attempted patch summary
  * suggested manual fix steps
  * suggested resume instruction
* Dashboard shows modal/panel with:
  * current diff
  * failed edit attempts
  * restore option
  * continue after manual fix
  * retry with different edit mode
* CLI prints equivalent handoff summary.
* Manual fix + resume must not lose workspace state.

**Acceptance Criteria:**
* Two failed edits to same file block the workspace.
* Workspace does not continue burning tokens after handoff.
* Dashboard shows attempted patch and current diff.
* User can manually fix and resume workspace.
* User can restore pre-edit snapshot.
* Handoff event is archived.

---

### 4.5.E — Audit, reporting, and dashboard visibility

**Goal:** Make edit strategy decisions, failures, and token-waste prevention visible.

**Requirements:**
* Add event types:
  * `edit_strategy_selected`
  * `edit_strategy_blocked`
  * `full_rewrite_attempted`
  * `edit_truncation_detected`
  * `edit_exact_match_failed`
  * `patch_fallback_forced`
  * `edit_failure_handoff`
  * `token_waste_prevented`
* Event payload includes planExecId, workspaceId, filePath, mode, strategy, line count, byte count, attempt number, failure type, and reason code.
* Final summary includes:
  * edit mode used
  * blocked rewrites
  * truncation events
  * exact-match failures
  * handoffs
  * estimated waste prevented
* WorkerDetail shows edit strategy warnings and handoff state.
* Settings UI shows selected edit strategy mode.

**Acceptance Criteria:**
* Strategy selection emits audit event.
* Truncation and exact-match failures are visible.
* Handoff appears in WorkerDetail.
* Final summary includes edit strategy section.
* Settings exposes Token Saving / Hybrid / Speed.

---

### 4.5.F — Doctor checks, tests, and dogfood replay

**Goal:** Validate the revised adaptive strategy against both observed failure modes.

**Requirements:**
* Extend `pi plan doctor` to report selected edit strategy mode.
* Doctor warns when plan can edit files above selected mode threshold.
* Add tests for:
  * mode policy decisions
  * write gate by mode
  * new file writes
  * generated file rewrite marking
  * truncation detection
  * exact-match failure detection
  * same-file failure handoff
  * audit event emission
* Add dogfood replay fixtures:
  * repeated full-file rewrite/truncation scenario
  * exact-match patch failure scenario
* Document policy in `docs/pi/adaptive-edit-strategy.md`.

**Acceptance Criteria:**
* Doctor reports selected mode and threshold warnings.
* Dogfood proves repeated full rewrite cannot loop indefinitely.
* Dogfood proves repeated exact-match edit failure triggers handoff.
* Documentation explains modes, thresholds, speed tradeoff, and recovery flow.
* TypeScript compiles cleanly.

---

## 8. Combined Implementation Order

```text
4.5.A → 4.5.B → 4.5.C → 4.5.D → 4.5.E → 4.5.F
```

Rationale:

* `4.5.A` defines the policy and modes.
* `4.5.B` applies the policy at the write/edit boundary.
* `4.5.C` detects when a strategy is failing.
* `4.5.D` stops the workspace and hands off cleanly.
* `4.5.E` makes strategy decisions visible.
* `4.5.F` validates both real failure modes and documents the system.

Sequential implementation is preferred because this is an execution-safety phase.

---

## 9. Definition of Done

P4.5 is complete when ALL are true:

* [ ] `EditStrategyPolicy` exists and is config-driven.
* [ ] Settings expose `editStrategyMode`: Token Saving, Hybrid, Speed.
* [ ] Hybrid is the default mode.
* [ ] Token Saving mode enforces strict patch-first behavior above 200 lines / 8KB.
* [ ] Hybrid mode allows full rewrite under 1000 lines / 40KB.
* [ ] Speed mode disables token-saving edit restrictions while preserving hard safety gates.
* [ ] New file writes work in all modes.
* [ ] Generated-file rewrites require explicit generated-file marking.
* [ ] Truncation forces fallback in all modes.
* [ ] Exact-match edit failures are detected and counted.
* [ ] Two same-file edit failures trigger `BLOCKED_EDIT_FAILURE`.
* [ ] Workspace stops instead of continuing to burn tokens after repeated edit failure.
* [ ] Dashboard shows manual handoff with diff, failed attempts, restore option, and resume guidance.
* [ ] Audit events show strategy selected, failure type, fallback, and handoff.
* [ ] Final execution summary includes edit strategy section.
* [ ] Doctor reports selected mode and warns on risky file scopes.
* [ ] Dogfood replay covers full rewrite truncation and exact-match patch failure.
* [ ] TypeScript compilation passes.
* [ ] P4 single-plan execution remains backward compatible.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Write/edit gate blocks common legitimate edits.
* New file creation is accidentally blocked.
* Hybrid mode becomes slower than P4 baseline.
* Failure handoff triggers too early.
* Tool wrapper causes file corruption.
* Dashboard recovery flow is confusing or blocks resume.

**Rollback procedure:**
1. Set `editStrategyMode=speed`.
2. Set `PI_EDIT_STRATEGY_ENFORCEMENT=warn`.
3. Keep audit events enabled to continue observing failures.
4. Disable handoff threshold enforcement if false positives block execution.
5. Revert write/edit gate integration if urgent.
6. Preserve detector tests and docs if safe.
7. Full revert P4.5 if write/edit behavior remains unstable.

**Recovery time:** < 10 minutes.

---

## 11. What Phase P5 Inherits

P5 inherits:

* Adaptive edit strategy modes
* Hybrid default behavior
* Write/edit gate integration
* Truncation detection
* Exact-match failure detection
* Same-file edit failure handoff
* Manual recovery metadata
* Edit strategy audit events
* Doctor mode warnings
* Dogfood fixtures for edit failure regressions

P5 may add:

* Project-wide edit strategy dashboard analytics
* Per-plan edit mode override
* Skill-based patch planning
* More advanced AST-aware editing
* Multi-plan queue token/time waste reporting

---

# Part 2 — Agent Brief

## Mission

Implement P4.5 — Adaptive Edit Strategy & Failure Handoff.

You are replacing brittle hard token optimization with a practical edit system. Pi should choose between full rewrite, targeted patch, and handoff based on file size, selected mode, failure history, and safety constraints. The goal is successful completion per minute, not maximum token saving at all costs.

---

## Hard Requirements

1. Do not modify product application source code except test fixtures and docs.
2. Add three edit modes: Token Saving, Hybrid, Speed.
3. Hybrid must be the default mode.
4. Token Saving mode must enforce strict patch-first thresholds.
5. Hybrid mode must allow full rewrites under 1000 lines / 40KB.
6. Speed mode must disable token-saving edit restrictions but keep hard safety gates.
7. New file writes must remain allowed in all modes.
8. Generated-file rewrite must require explicit generated-file marking.
9. Truncation must force fallback in all modes.
10. Exact-match edit failures must be detected and counted.
11. Two same-file edit failures must trigger human handoff.
12. Handoff must include diff, failed attempts, snapshot/restore option, and resume guidance.
13. Raw private chain-of-thought must not be logged.
14. No `git push` under any circumstance.
15. No raw `rm -rf` under any circumstance.
16. No new npm dependencies without explicit approval.
17. TypeScript strict mode: no new `as any`, `@ts-ignore`, or `@ts-expect-error`.

---

## Execution Policies

```yaml
edit_strategy:
  default_mode: hybrid

  token_saving:
    enforcement_mode: enforce
    existing_file_full_rewrite_max_lines: 200
    existing_file_full_rewrite_max_bytes: 8000
    tsx_component_patch_required_lines: 300
    same_file_edit_failure_handoff_threshold: 2
    truncation_forces_fallback: true
    exact_match_failure_counts_toward_handoff: true

  hybrid:
    enforcement_mode: enforce
    existing_file_full_rewrite_max_lines: 1000
    existing_file_full_rewrite_max_bytes: 40000
    tsx_component_patch_required_lines: 1000
    same_file_edit_failure_handoff_threshold: 2
    truncation_forces_fallback: true
    exact_match_failure_counts_toward_handoff: true

  speed:
    enforcement_mode: warn
    token_saving_edit_restrictions_enabled: false
    existing_file_full_rewrite_soft_limit_lines: 1000
    same_file_edit_failure_handoff_threshold: 2
    truncation_forces_fallback: true
    exact_match_failure_counts_toward_handoff: true
    hard_safety_gates_enabled: true
```

---

## Safety Stops

Hard stop execution only for:

* forbidden file access
* secrets/env/private-key access
* `git push`
* raw destructive commands
* patch path escaping allowed workspace paths
* generated-file rewrite without generated-file marking when required
* repeated same-file edit failure after threshold
* write/edit wrapper cannot create snapshot for guarded file

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
      "p4.5",
      "adaptive-edit-strategy",
      "failure-handoff",
      "token-waste-prevention",
      "edit-safety"
    ]
  },
  "planExecution": {
    "phase": "P4.5",
    "title": "Adaptive Edit Strategy & Failure Handoff",
    "mode": "autonomous",
    "maxParallelWorkspaces": 1,
    "stateBackend": "json",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "postPlanHandoff": true,
    "editStrategy": {
      "defaultMode": "hybrid",
      "selectedMode": "hybrid",
      "sameFileEditFailureHandoffThreshold": 2,
      "modes": {
        "tokenSaving": {
          "enforcementMode": "enforce",
          "existingFileFullRewriteMaxLines": 200,
          "existingFileFullRewriteMaxBytes": 8000,
          "tsxComponentPatchRequiredLines": 300,
          "truncationForcesFallback": true,
          "exactMatchFailureCountsTowardHandoff": true
        },
        "hybrid": {
          "enforcementMode": "enforce",
          "existingFileFullRewriteMaxLines": 1000,
          "existingFileFullRewriteMaxBytes": 40000,
          "tsxComponentPatchRequiredLines": 1000,
          "truncationForcesFallback": true,
          "exactMatchFailureCountsTowardHandoff": true
        },
        "speed": {
          "enforcementMode": "warn",
          "tokenSavingEditRestrictionsEnabled": false,
          "existingFileFullRewriteSoftLimitLines": 1000,
          "truncationForcesFallback": true,
          "exactMatchFailureCountsTowardHandoff": true,
          "hardSafetyGatesEnabled": true
        }
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
      "repeated_same_file_edit_failure",
      "patch_path_escape",
      "generated_file_rewrite_without_manifest"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish",
      "terraform destroy",
      "kubectl delete",
      "git reset --hard",
      "git clean -fd"
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
      "id": "4.5.A",
      "title": "Edit strategy modes",
      "dependencies": [],
      "allowedFiles": [
        "packages/coding-agent/src/editing/edit-strategy-policy.ts",
        "packages/coding-agent/src/editing/edit-strategy-types.ts",
        "packages/coding-agent/test/edit-strategy-policy.test.ts",
        "docs/pi/adaptive-edit-strategy.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "EditStrategyPolicy module created",
        "Token Saving, Hybrid, and Speed modes implemented",
        "Hybrid is default",
        "Token Saving blocks full rewrite above strict thresholds",
        "Hybrid allows full rewrite under 1000 lines and 40KB",
        "Speed allows full rewrite under 1000 lines while preserving hard safety gates",
        "new files are write_allowed in all modes",
        "unit tests cover all mode decisions"
      ],
      "targetCommand": "npm run typecheck && npm test -- edit-strategy-policy",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/editing/edit-strategy-policy.ts",
          "packages/coding-agent/src/editing/edit-strategy-types.ts",
          "packages/coding-agent/test/edit-strategy-policy.test.ts",
          "docs/pi/adaptive-edit-strategy.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**",
          "packages/web-server/**"
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
      "id": "4.5.B",
      "title": "Write/Edit gate integration",
      "dependencies": [
        "4.5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/editing/write-gate.ts",
        "packages/coding-agent/src/editing/file-metadata.ts",
        "packages/coding-agent/src/core/tools/write.ts",
        "packages/coding-agent/src/workspace-agent-executor.ts",
        "packages/coding-agent/test/write-gate.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "write/edit paths call EditStrategyPolicy",
        "hard safety gates run before edit strategy",
        "Token Saving blocks large existing file rewrite",
        "Hybrid allows manageable full rewrites",
        "Speed allows full rewrite under 1000 lines",
        "targeted edits remain allowed",
        "pre-edit snapshot is created for guarded files"
      ],
      "targetCommand": "npm run typecheck && npm test -- write-gate",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/editing/write-gate.ts",
          "packages/coding-agent/src/editing/file-metadata.ts",
          "packages/coding-agent/src/core/tools/write.ts",
          "packages/coding-agent/src/workspace-agent-executor.ts",
          "packages/coding-agent/test/write-gate.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**"
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
          "edit_strategy_selected",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "4.5.C",
      "title": "Truncation and edit failure detector",
      "dependencies": [
        "4.5.B"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/editing/edit-attempt-tracker.ts",
        "packages/coding-agent/src/editing/truncation-detector.ts",
        "packages/coding-agent/src/json-state-store.ts",
        "packages/coding-agent/test/edit-attempt-tracker.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "edit attempts tracked per plan/workspace/file",
        "truncation markers detected",
        "exact-match edit failures detected",
        "same-file failure counter increments",
        "detector state persists in workspace metadata",
        "fallback is forced after truncation"
      ],
      "targetCommand": "npm run typecheck && npm test -- edit-attempt-tracker",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/editing/edit-attempt-tracker.ts",
          "packages/coding-agent/src/editing/truncation-detector.ts",
          "packages/coding-agent/src/json-state-store.ts",
          "packages/coding-agent/test/edit-attempt-tracker.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**"
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
          "edit_truncation_detected",
          "edit_exact_match_failed",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "4.5.D",
      "title": "Failure handoff and manual recovery",
      "dependencies": [
        "4.5.C"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/editing/edit-failure-handoff.ts",
        "packages/coding-agent/src/workspace-agent-executor.ts",
        "packages/web-ui/dashboard/src/components/EditFailureHandoff.tsx",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/hooks/useEditFailureHandoff.ts",
        "packages/coding-agent/test/edit-failure-handoff.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "two same-file edit failures mark workspace BLOCKED_EDIT_FAILURE",
        "workspace stops further autonomous edits after handoff",
        "handoff payload includes diff, failed attempts, snapshot, suggested manual fix, resume instruction",
        "dashboard shows handoff panel",
        "user can resume after manual fix"
      ],
      "targetCommand": "npm run typecheck && npm run build && npm test -- edit-failure-handoff",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/editing/edit-failure-handoff.ts",
          "packages/coding-agent/src/workspace-agent-executor.ts",
          "packages/web-ui/dashboard/src/components/EditFailureHandoff.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/hooks/useEditFailureHandoff.ts",
          "packages/coding-agent/test/edit-failure-handoff.test.ts"
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
          "edit_failure_handoff",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "4.5.E",
      "title": "Audit, reporting, and dashboard visibility",
      "dependencies": [
        "4.5.D"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/editing/edit-audit-events.ts",
        "packages/coding-agent/src/state-store.ts",
        "packages/coding-agent/src/json-state-store.ts",
        "packages/web-ui/dashboard/src/components/EditStrategyWarnings.tsx",
        "packages/web-ui/dashboard/src/components/SettingsDialog.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "edit strategy audit events implemented",
        "Settings exposes Token Saving / Hybrid / Speed",
        "WorkerDetail shows edit strategy warnings and handoff state",
        "final summary includes edit strategy section",
        "audit events include mode, strategy, failure type, and reason code"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "reviewer",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/editing/edit-audit-events.ts",
          "packages/coding-agent/src/state-store.ts",
          "packages/coding-agent/src/json-state-store.ts",
          "packages/web-ui/dashboard/src/components/EditStrategyWarnings.tsx",
          "packages/web-ui/dashboard/src/components/SettingsDialog.tsx"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
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
          "edit_strategy_selected",
          "edit_failure_handoff",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "4.5.F",
      "title": "Doctor checks, tests, and dogfood replay",
      "dependencies": [
        "4.5.A",
        "4.5.B",
        "4.5.C",
        "4.5.D",
        "4.5.E"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/cli/plan-doctor.ts",
        "packages/coding-agent/test/adaptive-edit-dogfood.test.ts",
        "docs/pi/adaptive-edit-strategy.md",
        "docs/pi/stability/p4-5-adaptive-edit-report.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "doctor reports selected edit strategy mode",
        "doctor warns on files above selected mode thresholds",
        "dogfood replay covers full rewrite truncation",
        "dogfood replay covers exact-match patch failure",
        "documentation explains modes and handoff recovery",
        "stability report published"
      ],
      "targetCommand": "npm run typecheck && npm test -- adaptive-edit-dogfood",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-doctor.ts",
          "packages/coding-agent/test/adaptive-edit-dogfood.test.ts",
          "docs/pi/adaptive-edit-strategy.md",
          "docs/pi/stability/p4-5-adaptive-edit-report.md"
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
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.1.0",
  "phase": "P4.5",
  "title": "Adaptive Edit Strategy & Failure Handoff",
  "primaryGoal": "Replace hard token-saving edit behavior with adaptive edit modes and clean human handoff when agents repeatedly fail to edit the same file.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "notInScope": [
    "P5 multi-plan queue",
    "remote skill registry",
    "git worktree isolation",
    "AST-aware universal patch engine",
    "6-worker production mode",
    "product feature implementation"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "git_push",
    "repeated_same_file_edit_failure",
    "patch_path_escape",
    "generated_file_rewrite_without_manifest"
  ],
  "completionGate": "P4.5 is complete when Hybrid is default, Token Saving and Speed modes are available, write/edit tools respect selected mode, truncation and exact-match failures are detected, two same-file edit failures trigger human handoff, and dogfood proves both observed failure modes cannot loop indefinitely.",
  "nextPhase": "P5"
}
```


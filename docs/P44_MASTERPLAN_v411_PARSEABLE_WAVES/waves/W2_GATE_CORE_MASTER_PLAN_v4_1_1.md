# LLM Implementation Agent — P44 W2 Master Plan v4.1.1

**Version:** 4.1.1  
**Phase:** P44  
**Wave:** W2  
**Title:** Gate Core — CompletionGate v2, Terminal Reconciler, Scanner  
**Last Updated:** 2026-06-05  
**Purpose:** Standalone parseable v4.1.1 master plan for this wave. This is not ACCP wrapper format.

---

## Overview

Gate Core — CompletionGate v2, Terminal Reconciler, Scanner implements a bounded subset of P44 under stable_3. It must parse as a v4.1.1 master plan. The active runtime contract is `4.1.1`.

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P44`  
**One-line goal:** `Gate Core — CompletionGate v2, Terminal Reconciler, Scanner`  
**Why now:** `This wave is required before downstream P44 work can safely proceed.`  
**Blast radius:** `P44.03, P44.04, P44.05`  
**Rollback path:** `Rollback this wave only; preserve reports.`  
**Repair class:** `implementation`  
**Execution automation:** `enabled`  
**Selected repair mode:** `stable_3`  
**Target promotion mode:** `stable_3`  
**Autonomous execution allowed:** `true`  
**Agent repo mutation allowed:** `true`  
**Promotion gate status:** `pending`  
**Scale mode:** `stable_3`  
**Safe parallelism target:** `3`  
**Done when:** `All wave workstreams and wave gate pass.`

## 1. Header

| Field | Value |
|---|---|
| Phase | `P44` |
| Wave | `W2` |
| Title | `Gate Core — CompletionGate v2, Terminal Reconciler, Scanner` |
| Status | `Planned` |
| Last updated | `2026-06-05` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Gate Core` |
| Product-code changes | `Allowed` |
| Repair class | `implementation` |
| Execution automation | `enabled` |
| Selected repair mode | `stable_3` |
| Target promotion mode | `stable_3` |
| Autonomous execution allowed | `true` |
| Agent repo mutation allowed | `true` |
| Promotion gate status | `pending` |
| Selected scale mode | `stable_3` |
| Requested max workers | `3` |
| Expected DAG effective parallelism | `3` |
| Expected safe effective parallelism | `3` |
| Worktree isolation | `Disabled` |
| Integration queue | `Disabled` |
| Isolation mode | `direct` |
| Patch isolation | `Disabled` |
| Patch apply queue | `Disabled` |
| Repository mutation authority | `direct guarded by P44 gates` |
| PatchCoordinator | `Disabled` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| `P44.03` — CompletionGate v2 | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P44.04` — Terminal Verdict Reconciliation | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P44.05` — Negative Assertion & Forbidden Shortcut Scanner | Implementing agent | Execution owner | Safety reviewer | Operator |

## 2. Purpose

This wave is one independently executable slice of P44. It must not rely on undocumented side effects from other waves. It must preserve v4.1.1 parser compatibility and must include a valid `## 7. Workstreams` section.

## 3. What Carried Over — Must Stay Stable

* [ ] `contractVersion` remains `4.1.1`.
* [ ] `templateVersion` remains `4.1.1`.
* [ ] stable_3 remains selected mode.
* [ ] Worker self-report remains claim-only.
* [ ] ExecutionKernel remains state authority.
* [ ] P45 implementation remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] Silent pass validation remains forbidden.

## 4. Background / What Was Wrong

P44 research showed that completion safety modules are missing or not production-wired. This wave addresses only its declared workstreams and must prove production wiring where required.

## 5. Current Failure State / Known Blockers

* `P44.03` — `CompletionGate v2` is not complete before this wave.
* `P44.04` — `Terminal Verdict Reconciliation` is not complete before this wave.
* `P44.05` — `Negative Assertion & Forbidden Shortcut Scanner` is not complete before this wave.

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Module exists but production path does not call it | medium | high | Require grep/source evidence and integration tests |
| Tests pass but evidence not serialized | medium | medium | Require report artifact checks |
| Unsupported 4.2.0 contract sneaks in | low | high | Hard stop on version mismatch |
| P45 implementation leaks into P44 | low | high | Bridge artifacts only; no runtime implementation |

## 7. Workstreams

### 7.A — `P44.03` — CompletionGate v2

**Goal:** Implement `CompletionGate v2` as part of P44 `W2`.

**Dependencies:** `P44.01, P44.02, P44.06`

**Expected files:**

- `packages/coding-agent/src/core/completion/completion-gate-v2.ts`
- `packages/coding-agent/test/completion/completion-gate-v2.test.ts`

**Acceptance Criteria:**

- `AC-P4403-001` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-002` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-003` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-004` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-005` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-006` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-007` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-008` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-009` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-010` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-011` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4403-012` — `CompletionGate v2` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_03.test.ts
npx tsgo --noEmit
```
### 7.B — `P44.04` — Terminal Verdict Reconciliation

**Goal:** Implement `Terminal Verdict Reconciliation` as part of P44 `W2`.

**Dependencies:** `P44.03, P44.06`

**Expected files:**

- `packages/coding-agent/src/core/completion/terminal-verdict-parser.ts`
- `packages/coding-agent/src/core/completion/terminal-verdict-reconciler.ts`
- `packages/coding-agent/test/completion/terminal-verdict-reconciler.test.ts`

**Acceptance Criteria:**

- `AC-P4404-001` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-002` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-003` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-004` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-005` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-006` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-007` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-008` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-009` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-010` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-011` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4404-012` — `Terminal Verdict Reconciliation` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_04.test.ts
npx tsgo --noEmit
```
### 7.C — `P44.05` — Negative Assertion & Forbidden Shortcut Scanner

**Goal:** Implement `Negative Assertion & Forbidden Shortcut Scanner` as part of P44 `W2`.

**Dependencies:** `P44.01, P44.02`

**Expected files:**

- `packages/coding-agent/src/core/completion/negative-assertions.ts`
- `packages/coding-agent/src/core/completion/forbidden-shortcut-scanner.ts`
- `packages/coding-agent/test/completion/negative-assertions.test.ts`

**Acceptance Criteria:**

- `AC-P4405-001` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-002` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-003` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-004` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-005` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-006` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-007` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-008` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-009` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-010` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-011` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4405-012` — `Negative Assertion & Forbidden Shortcut Scanner` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_05.test.ts
npx tsgo --noEmit
```

## 8. Combined Implementation Order

```text
1. P44.03 — CompletionGate v2
2. P44.04 — Terminal Verdict Reconciliation
3. P44.05 — Negative Assertion & Forbidden Shortcut Scanner
```

## 9. Definition of Done

* [ ] Every workstream in this wave passes its acceptance criteria.
* [ ] Every required test passes.
* [ ] Typecheck passes.
* [ ] No workstream is only module-complete when production wiring is required.
* [ ] Reports are written under `reports/p44-verified-completion/<timestamp>/`.
* [ ] Part 3 JSON remains valid.
* [ ] Next wave prerequisites are explicitly satisfied.

## 10. Rollback Playbook

Rollback wave-local source and test changes only. Preserve evidence and report artifacts. Do not run global destructive cleanup.

## 11. What Next Phase Inherits

The next wave inherits only completed, tested, and wired outputs from this wave. A module without production wiring is not inherited as complete.

# Part 2 — Agent Brief

## Mission

Implement P44 `W2` according to this v4.1.1 master plan. Do not convert this to ACCP format. Do not implement P45.

## Hard Requirements

1. Use `contractVersion: "4.1.1"`.
2. Use `templateVersion: "4.1.1"`.
3. Keep `## 7. Workstreams` intact.
4. Keep every workstream as `### 7.X — ...`.
5. Keep Part 3 JSON fenced and valid.
6. Do not use 4.2.0 as runtime contract.
7. Do not implement P45.
8. Do not use stable_6 or stable_12.
9. Do not bypass P44 gates.
10. Do not accept silent validation passes.

## Execution Policies

```bash
npx tsgo --noEmit
cd packages/coding-agent && npx vitest run test/p44/p44_03.test.ts
cd packages/coding-agent && npx vitest run test/p44/p44_04.test.ts
cd packages/coding-agent && npx vitest run test/p44/p44_05.test.ts
```

## Safety Stops

Hard stop if:
* `## 7. Workstreams` is missing.
* Part 3 JSON is invalid.
* Runtime contract is not 4.1.1.
* P45 runtime implementation is attempted.
* Production wiring is missing for runtime behavior.

# Part 2.5 — v4 ExecutionKernel Doctrine

The ExecutionKernel remains state authority. P44 adds verified completion gates before authoritative state transition.

```text
Worker output
  -> WorkerCompletionReport
  -> EvidenceLedger
  -> CompletionGate v2
  -> TerminalVerdictReconciler
  -> WorkspaceCommitGate / WriteGate when applicable
  -> ExecutionKernel transition
```

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "phase": "P44",
  "waveId": "W2",
  "title": "Gate Core \u2014 CompletionGate v2, Terminal Reconciler, Scanner",
  "executionClass": "implementation",
  "repairMode": "stable_3",
  "scale": {
    "defaultMode": "stable_3",
    "selectedMode": "stable_3",
    "maxParallelWorkspaces": 3
  },
  "legacyCompatibility": {
    "v3EnvelopePreserved": true,
    "unknownV4FieldsPolicy": "ignore_for_read_only_legacy_consumers_reject_for_execution_without_v4_validator"
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": true,
    "agentMayMutateRepo": true,
    "manualPatchApplicationRequired": false,
    "humanApprovalRequiredForEveryPatch": false
  },
  "intent": {
    "parallelism": 3,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": {
      "mode": "local_sandbox"
    }
  },
  "p44Extensions": {
    "verifiedCompletion": {
      "completionGateVersion": "v2",
      "workerSelfReportIsClaimOnly": true,
      "evidenceLedgerRequired": true,
      "stableAcceptanceCriteriaRequired": true,
      "negativeEvidenceRequired": true
    },
    "mutationSafety": {
      "writeGateRequired": true,
      "smartMutationEngineRequired": true,
      "largeOverwriteBlockedByDefault": true,
      "rollbackRequired": true
    },
    "commitSafety": {
      "workspaceCommitGateRequired": true,
      "forbiddenGitCommands": [
        "git add .",
        "git add -A",
        "git add --all",
        "git commit -a",
        "git commit --all"
      ]
    },
    "p45Bridge": {
      "implementationAllowed": false,
      "artifactExportsAllowed": true
    }
  },
  "workspaces": [
    {
      "id": "P44.03",
      "title": "CompletionGate v2",
      "dependencies": [
        "P44.01",
        "P44.02",
        "P44.06"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P4403-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4403-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/completion-gate-v2.ts",
        "packages/coding-agent/test/completion/completion-gate-v2.test.ts"
      ],
      "queuePriority": "critical",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/completion-gate-v2.ts",
          "packages/coding-agent/test/completion/completion-gate-v2.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P44.04",
      "title": "Terminal Verdict Reconciliation",
      "dependencies": [
        "P44.03",
        "P44.06"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P4404-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4404-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/terminal-verdict-parser.ts",
        "packages/coding-agent/src/core/completion/terminal-verdict-reconciler.ts",
        "packages/coding-agent/test/completion/terminal-verdict-reconciler.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/terminal-verdict-parser.ts",
          "packages/coding-agent/src/core/completion/terminal-verdict-reconciler.ts",
          "packages/coding-agent/test/completion/terminal-verdict-reconciler.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P44.05",
      "title": "Negative Assertion & Forbidden Shortcut Scanner",
      "dependencies": [
        "P44.01",
        "P44.02"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P4405-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4405-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/negative-assertions.ts",
        "packages/coding-agent/src/core/completion/forbidden-shortcut-scanner.ts",
        "packages/coding-agent/test/completion/negative-assertions.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/negative-assertions.ts",
          "packages/coding-agent/src/core/completion/forbidden-shortcut-scanner.ts",
          "packages/coding-agent/test/completion/negative-assertions.test.ts"
        ],
        "canRun": ["*"]
      }
    }
  ],
  "validation": {
    "watchModeForbidden": true,
    "silentPassPatternsForbidden": [
      "|| true",
      "|| exit 0",
      "; true"
    ],
    "noTestsFoundIsFailure": true,
    "targetCommandEvidenceRequired": true
  },
  "hardStops": [
    "contract_version_not_4_1_1",
    "template_version_not_4_1_1",
    "missing_workstreams_section",
    "part3_json_missing_or_invalid",
    "worker_self_report_direct_state_transition",
    "production_wiring_missing",
    "p45_runtime_implemented_in_p44"
  ]
}
```

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P44",
  "wave": "W2",
  "title": "Gate Core \u2014 CompletionGate v2, Terminal Reconciler, Scanner",
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "workspaceCount": 3,
  "workstreamsSectionRequired": true,
  "part3JsonRequired": true,
  "selectedMode": "stable_3",
  "p45ImplementationAllowed": false
}
```

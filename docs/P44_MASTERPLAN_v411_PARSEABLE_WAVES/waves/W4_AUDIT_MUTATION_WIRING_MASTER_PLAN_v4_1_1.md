# LLM Implementation Agent — P44 W4 Master Plan v4.1.1

**Version:** 4.1.1  
**Phase:** P44  
**Wave:** W4  
**Title:** Audit and Mutation Wiring — Auditor plus WriteGate Tool Path  
**Last Updated:** 2026-06-05  
**Purpose:** Standalone parseable v4.1.1 master plan for this wave. This is not ACCP wrapper format.

---

## Overview

Audit and Mutation Wiring — Auditor plus WriteGate Tool Path implements a bounded subset of P44 under stable_3. It must parse as a v4.1.1 master plan. The active runtime contract is `4.1.1`.

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P44`  
**One-line goal:** `Audit and Mutation Wiring — Auditor plus WriteGate Tool Path`  
**Why now:** `This wave is required before downstream P44 work can safely proceed.`  
**Blast radius:** `P44.07, P44.WG`  
**Rollback path:** `Rollback this wave only; preserve reports.`  
**Repair class:** `implementation`  
**Execution automation:** `enabled`  
**Selected repair mode:** `stable_3`  
**Target promotion mode:** `stable_3`  
**Autonomous execution allowed:** `true`  
**Agent repo mutation allowed:** `true`  
**Promotion gate status:** `pending`  
**Scale mode:** `stable_3`  
**Safe parallelism target:** `2`  
**Done when:** `All wave workstreams and wave gate pass.`

## 1. Header

| Field | Value |
|---|---|
| Phase | `P44` |
| Wave | `W4` |
| Title | `Audit and Mutation Wiring — Auditor plus WriteGate Tool Path` |
| Status | `Planned` |
| Last updated | `2026-06-05` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Audit and Mutation Wiring` |
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
| Expected DAG effective parallelism | `2` |
| Expected safe effective parallelism | `2` |
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
| `P44.07` — Post-Implementation Auditor | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P44.WG` — WriteGate and SmartMutation Tool Wiring | Implementing agent | Execution owner | Safety reviewer | Operator |

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

* `P44.07` — `Post-Implementation Auditor` is not complete before this wave.
* `P44.WG` — `WriteGate and SmartMutation Tool Wiring` is not complete before this wave.

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Module exists but production path does not call it | medium | high | Require grep/source evidence and integration tests |
| Tests pass but evidence not serialized | medium | medium | Require report artifact checks |
| Unsupported 4.2.0 contract sneaks in | low | high | Hard stop on version mismatch |
| P45 implementation leaks into P44 | low | high | Bridge artifacts only; no runtime implementation |

## 7. Workstreams

### 7.A — `P44.07` — Post-Implementation Auditor

**Goal:** Implement `Post-Implementation Auditor` as part of P44 `W4`.

**Dependencies:** `P44.01, P44.02, P44.06`

**Expected files:**

- `packages/coding-agent/src/core/completion/post-implementation-auditor.ts`
- `packages/coding-agent/test/completion/post-implementation-auditor.test.ts`

**Acceptance Criteria:**

- `AC-P4407-001` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-002` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-003` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-004` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-005` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-006` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-007` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-008` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-009` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-010` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-011` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4407-012` — `Post-Implementation Auditor` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_07.test.ts
npx tsgo --noEmit
```
### 7.B — `P44.WG` — WriteGate and SmartMutation Tool Wiring

**Goal:** Implement `WriteGate and SmartMutation Tool Wiring` as part of P44 `W4`.

**Dependencies:** `P44.01, P44.02`

**Expected files:**

- `packages/coding-agent/src/core/write-gate.ts`
- `packages/coding-agent/src/core/mutation/smart-mutation-engine.ts`
- `packages/coding-agent/src/core/tools/write.ts`
- `packages/coding-agent/src/core/tools/edit.ts`
- `packages/coding-agent/test/completion/write-gate-tool-wiring.test.ts`

**Acceptance Criteria:**

- `AC-P44WG-001` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-002` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-003` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-004` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-005` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-006` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-007` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-008` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-009` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-010` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-011` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P44WG-012` — `WriteGate and SmartMutation Tool Wiring` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_wg.test.ts
npx tsgo --noEmit
```

## 8. Combined Implementation Order

```text
1. P44.07 — Post-Implementation Auditor
2. P44.WG — WriteGate and SmartMutation Tool Wiring
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

Implement P44 `W4` according to this v4.1.1 master plan. Do not convert this to ACCP format. Do not implement P45.

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
cd packages/coding-agent && npx vitest run test/p44/p44_07.test.ts
cd packages/coding-agent && npx vitest run test/p44/p44_wg.test.ts
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
  "waveId": "W4",
  "title": "Audit and Mutation Wiring \u2014 Auditor plus WriteGate Tool Path",
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
    "parallelism": 2,
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
      "id": "P44.07",
      "title": "Post-Implementation Auditor",
      "dependencies": [
        "P44.01",
        "P44.02",
        "P44.06"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P4407-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4407-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/post-implementation-auditor.ts",
        "packages/coding-agent/test/completion/post-implementation-auditor.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/post-implementation-auditor.ts",
          "packages/coding-agent/test/completion/post-implementation-auditor.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P44.WG",
      "title": "WriteGate and SmartMutation Tool Wiring",
      "dependencies": [
        "P44.01",
        "P44.02"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P44WG-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P44WG-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/write-gate.ts",
        "packages/coding-agent/src/core/mutation/smart-mutation-engine.ts",
        "packages/coding-agent/src/core/tools/write.ts",
        "packages/coding-agent/src/core/tools/edit.ts",
        "packages/coding-agent/test/completion/write-gate-tool-wiring.test.ts"
      ],
      "queuePriority": "critical",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/write-gate.ts",
          "packages/coding-agent/src/core/mutation/smart-mutation-engine.ts",
          "packages/coding-agent/src/core/tools/write.ts",
          "packages/coding-agent/src/core/tools/edit.ts",
          "packages/coding-agent/test/completion/write-gate-tool-wiring.test.ts"
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
  "wave": "W4",
  "title": "Audit and Mutation Wiring \u2014 Auditor plus WriteGate Tool Path",
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "workspaceCount": 2,
  "workstreamsSectionRequired": true,
  "part3JsonRequired": true,
  "selectedMode": "stable_3",
  "p45ImplementationAllowed": false
}
```

# LLM Implementation Agent — P44 W7 Master Plan v4.1.1

**Version:** 4.1.1  
**Phase:** P44  
**Wave:** W7  
**Title:** Bridge — v4.1.1 Extensions and P45 Artifact Outputs  
**Last Updated:** 2026-06-05  
**Purpose:** Standalone parseable v4.1.1 master plan for this wave. This is not ACCP wrapper format.

---

## Overview

Bridge — v4.1.1 Extensions and P45 Artifact Outputs implements a bounded subset of P44 under stable_3. It must parse as a v4.1.1 master plan. The active runtime contract is `4.1.1`.

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P44`  
**One-line goal:** `Bridge — v4.1.1 Extensions and P45 Artifact Outputs`  
**Why now:** `This wave is required before downstream P44 work can safely proceed.`  
**Blast radius:** `P44.12, P45.B1, P45.B2, P45.B3`  
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
| Wave | `W7` |
| Title | `Bridge — v4.1.1 Extensions and P45 Artifact Outputs` |
| Status | `Planned` |
| Last updated | `2026-06-05` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Bridge` |
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
| `P44.12` — Master Template 4.1.1-Compatible Extension Update | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P45.B1` — Accepted WriteSet Export and Ownership Summary | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P45.B2` — Assembler-Only Candidate Discovery and P45 Readiness Doctor | Implementing agent | Execution owner | Safety reviewer | Operator |
| `P45.B3` — Evidence Ledger and Mutation Report Export | Implementing agent | Execution owner | Safety reviewer | Operator |

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

* `P44.12` — `Master Template 4.1.1-Compatible Extension Update` is not complete before this wave.
* `P45.B1` — `Accepted WriteSet Export and Ownership Summary` is not complete before this wave.
* `P45.B2` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` is not complete before this wave.
* `P45.B3` — `Evidence Ledger and Mutation Report Export` is not complete before this wave.

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Module exists but production path does not call it | medium | high | Require grep/source evidence and integration tests |
| Tests pass but evidence not serialized | medium | medium | Require report artifact checks |
| Unsupported 4.2.0 contract sneaks in | low | high | Hard stop on version mismatch |
| P45 implementation leaks into P44 | low | high | Bridge artifacts only; no runtime implementation |

## 7. Workstreams

### 7.A — `P44.12` — Master Template 4.1.1-Compatible Extension Update

**Goal:** Implement `Master Template 4.1.1-Compatible Extension Update` as part of P44 `W7`.

**Dependencies:** `P44.01, P44.02, P44.03`

**Expected files:**

- `docs/llm-implementation-agent-master-template.md`
- `packages/coding-agent/test/template/p44-v411-extension.test.ts`

**Acceptance Criteria:**

- `AC-P4412-001` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-002` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-003` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-004` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-005` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-006` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-007` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-008` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-009` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-010` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-011` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P4412-012` — `Master Template 4.1.1-Compatible Extension Update` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p44_12.test.ts
npx tsgo --noEmit
```
### 7.B — `P45.B1` — Accepted WriteSet Export and Ownership Summary

**Goal:** Implement `Accepted WriteSet Export and Ownership Summary` as part of P44 `W7`.

**Dependencies:** `P44.08, P44.09, P44.11`

**Expected files:**

- `packages/coding-agent/src/core/completion/p45-bridge-exporter.ts`
- `packages/coding-agent/test/p45-bridge-schemas.test.ts`

**Acceptance Criteria:**

- `AC-P45B1-001` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-002` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-003` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-004` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-005` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-006` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-007` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-008` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-009` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-010` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-011` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B1-012` — `Accepted WriteSet Export and Ownership Summary` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p45_b1.test.ts
npx tsgo --noEmit
```
### 7.C — `P45.B2` — Assembler-Only Candidate Discovery and P45 Readiness Doctor

**Goal:** Implement `Assembler-Only Candidate Discovery and P45 Readiness Doctor` as part of P44 `W7`.

**Dependencies:** `P45.B1`

**Expected files:**

- `packages/coding-agent/src/core/completion/p45-bridge-exporter.ts`
- `packages/coding-agent/test/p45-bridge-schemas.test.ts`

**Acceptance Criteria:**

- `AC-P45B2-001` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-002` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-003` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-004` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-005` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-006` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-007` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-008` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-009` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-010` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-011` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B2-012` — `Assembler-Only Candidate Discovery and P45 Readiness Doctor` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p45_b2.test.ts
npx tsgo --noEmit
```
### 7.D — `P45.B3` — Evidence Ledger and Mutation Report Export

**Goal:** Implement `Evidence Ledger and Mutation Report Export` as part of P44 `W7`.

**Dependencies:** `P44.02, P44.WG, P44.11`

**Expected files:**

- `packages/coding-agent/src/core/completion/p45-bridge-exporter.ts`
- `packages/coding-agent/test/p45-bridge-schemas.test.ts`

**Acceptance Criteria:**

- `AC-P45B3-001` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-002` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-003` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-004` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-005` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-006` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-007` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-008` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-009` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-010` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-011` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.
- `AC-P45B3-012` — `Evidence Ledger and Mutation Report Export` has implementation, test evidence, and production-wiring evidence when applicable.

**Implementation Requirements:**
- Preserve v4.1.1 runtime contract.
- Do not introduce 4.2.0 runtime fields as authoritative contract fields.
- If this workspace implements runtime behavior, prove production wiring with source-level evidence.
- If this workspace emits artifacts, write deterministic JSON/Markdown reports.
- If this workspace blocks behavior, return machine-readable block reasons.
- If this workspace touches completion/commit/mutation flow, include success and failure-path tests.

**Validation:**

```bash
cd packages/coding-agent && npx vitest run test/p44/p45_b3.test.ts
npx tsgo --noEmit
```

## 8. Combined Implementation Order

```text
1. P44.12 — Master Template 4.1.1-Compatible Extension Update
2. P45.B1 — Accepted WriteSet Export and Ownership Summary
3. P45.B2 — Assembler-Only Candidate Discovery and P45 Readiness Doctor
4. P45.B3 — Evidence Ledger and Mutation Report Export
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

Implement P44 `W7` according to this v4.1.1 master plan. Do not convert this to ACCP format. Do not implement P45.

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
cd packages/coding-agent && npx vitest run test/template/p44-v411-extension.test.ts
cd packages/coding-agent && npx vitest run test/p45-bridge-schemas.test.ts
cd packages/coding-agent && npx vitest run test/p45-bridge-schemas.test.ts
cd packages/coding-agent && npx vitest run test/p45-bridge-schemas.test.ts
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
  "waveId": "W7",
  "title": "Bridge \u2014 v4.1.1 Extensions and P45 Artifact Outputs",
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
    "conflictRisk": "medium",
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
      "id": "P44.12",
      "title": "Master Template 4.1.1-Compatible Extension Update",
      "dependencies": [
        "P44.01",
        "P44.02",
        "P44.03"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P4412-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P4412-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "docs/llm-implementation-agent-master-template.md",
        "packages/coding-agent/test/template/p44-v411-extension.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "docs/llm-implementation-agent-master-template.md",
          "packages/coding-agent/test/template/p44-v411-extension.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P45.B1",
      "title": "Accepted WriteSet Export and Ownership Summary",
      "dependencies": [
        "P44.08",
        "P44.09",
        "P44.11"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P45B1-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B1-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
        "packages/coding-agent/test/p45-bridge-schemas.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
          "packages/coding-agent/test/p45-bridge-schemas.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P45.B2",
      "title": "Assembler-Only Candidate Discovery and P45 Readiness Doctor",
      "dependencies": [
        "P45.B1"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P45B2-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B2-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
        "packages/coding-agent/test/p45-bridge-schemas.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
          "packages/coding-agent/test/p45-bridge-schemas.test.ts"
        ],
        "canRun": ["*"]
      }
    },
    {
      "id": "P45.B3",
      "title": "Evidence Ledger and Mutation Report Export",
      "dependencies": [
        "P44.02",
        "P44.WG",
        "P44.11"
      ],
      "acceptanceCriteria": [
        {
          "id": "AC-P45B3-001",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-002",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-003",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-004",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-005",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-006",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-007",
          "level": "required",
          "evidenceRequired": true
        },
        {
          "id": "AC-P45B3-008",
          "level": "required",
          "evidenceRequired": true
        }
      ],
      "targetFiles": [
        "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
        "packages/coding-agent/test/p45-bridge-schemas.test.ts"
      ],
      "queuePriority": "normal",
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/core/completion/p45-bridge-exporter.ts",
          "packages/coding-agent/test/p45-bridge-schemas.test.ts"
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
  "wave": "W7",
  "title": "Bridge \u2014 v4.1.1 Extensions and P45 Artifact Outputs",
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "workspaceCount": 4,
  "workstreamsSectionRequired": true,
  "part3JsonRequired": true,
  "selectedMode": "stable_3",
  "p45ImplementationAllowed": false
}
```

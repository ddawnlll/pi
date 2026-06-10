# Worker Report Contract — P44.06

**Last Updated:** 2026-06-09
**Schema Version:** 1.0.0
**PlanSpec Reference:** P44.06 — Worker Report Contract and V5 Lock Echo Fields

## Overview

The Worker Report Contract defines the structured format workers must use when reporting completion of a workspace. It replaces free-form completion announcements with a validated, evidence-backed report that the CompletionGate can verify.

Without a valid WorkerReport, a worker cannot achieve COMPLETE status.

## Components

### 1. WorkerReport Interface

The canonical report structure (`packages/coding-agent/src/core/completion/worker-report-contract.ts`):

| Field | Type | Description |
|-------|------|-------------|
| `reportId` | `string` | Unique report identifier (auto-generated) |
| `schemaVersion` | `string` | Schema version for forward compatibility |
| `workerId` | `string` | Agent/system identifier |
| `workspaceId` | `string` | The workspace being reported |
| `planId` | `string` | The plan/phase identifier |
| `startedAt` | `number` | Epoch ms start time |
| `completedAt` | `number` | Epoch ms completion time |
| `verdict` | `WorkerVerdict` | `pass` / `fail` / `inconclusive` / `not_started` / `in_progress` |
| `criteriaStatus` | `CriterionReportItem[]` | Per-criterion verification status |
| `mutations` | `MutationSummary` | Summary of files changed and commands run |
| `evidenceSummary` | `object` | Total/passed/failed evidence counts |
| `summary` | `string` | Human-readable summary |

### 2. WorkerReportBuilder

Fluent builder for constructing reports:

```typescript
const report = new WorkerReportBuilder(workerId, workspaceId, planId)
    .withCriteriaStatuses(criteriaStatuses)
    .withMutation(mutationSummary)
    .withEvidenceSummary(total, passed, failed)
    .withSummary("Workspace completed successfully")
    .build();
```

### 3. CriterionReportItem

Per-acceptance-criterion status:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Criterion ID |
| `description` | `string` | Human-readable description |
| `status` | `CriterionVerificationStatus` | `verified` / `failed` / `unverified` |
| `evidenceIds` | `string[]` | References to EvidenceLedger entries |
| `notes` | `string` | Optional worker notes |

### 4. MutationSummary

Records what the worker actually changed:

| Field | Type | Description |
|-------|------|-------------|
| `created` | `string[]` | Files created |
| `modified` | `string[]` | Files modified |
| `deleted` | `string[]` | Files deleted |
| `commandsExecuted` | `string[]` | Commands run |
| `editCount` | `number` | Total edits applied |

## Contract Rules

### Rule 1: Structured report required

Prose-only completion claims (e.g., "I completed the workspace") are rejected. Reports must use the structured `WorkerReport` format. If `criteriaStatus` is empty or `mutations.commandsExecuted` is empty when validation is required, the report is treated as `inconclusive` and COMPLETE is blocked.

### Rule 2: Evidence-backed criteria

Every criterion in `criteriaStatus` must reference evidence IDs that exist in the EvidenceLedger. The `buildReportFromCriteria()` function filters out evidence IDs that are not present in the provided ledger entries, ensuring only verifiable evidence is referenced.

### Rule 3: Verdict derivation

The `determineVerdict()` function computes the overall verdict:

- **pass**: All criteria have status `verified`
- **fail**: Any criterion has status `failed`
- **inconclusive**: No criteria, criteria are `unverified`, or mixed without failures

### Rule 4: Lock hash echo extraction

Worker reports must echo the plan lock hash and workspace lock hash when operating in planspec_locked mode. The `worker-echo-extractor.ts` module handles extraction and verification of lock hashes from worker output. Missing or mismatched lock hashes block COMPLETE.

## Integration

```
Worker Output
    |
    v
WorkerReportBuilder  -->  WorkerReport
    |                        |
    |                        v
    |              CompletionGate v2 (P44.03)
    |              - validates criteria status
    |              - verifies evidence refs
    |              - checks lock hash echo
    |                        |
    |                        v
    |              TerminalReconciler (P44.04)
    |              - finalizes verdict as COMPLETE/BLOCKED/FAILED
    |
    +-----> EvidenceLedger (P44.02)
            - stores evidence entries
            - validates evidence types

```

## Related Files

- `packages/coding-agent/src/core/completion/worker-report-contract.ts` — Schema and builder
- `packages/coding-agent/src/core/completion/worker-echo-extractor.ts` — Lock hash echo extraction
- `packages/coding-agent/test/completion/worker-report-contract.test.ts` — Tests
- `packages/coding-agent/test/worker-echo-extraction.test.ts` — Echo extraction tests

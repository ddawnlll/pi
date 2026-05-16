# LLM Implementation Agent — Master Template v2.4

**Version:** 2.4.0  
**Last Updated:** 2026-05-16  
**Purpose:** Canonical template for creating executable implementation plans with plan-intake lifecycle auto-optimization, continuous self-improvement platform foundations, extension/skill ecosystems, organic memory, policy governance, and audit-ledger traceability.

---

## Overview

v2.4 extends v2.3.1 (scale-aware isolated execution with queue optimization) with the **plan-intake lifecycle** and **platform ecosystem** model.

### Key Capabilities Added in v2.4

1. **Plan-Intake Auto-DAG-Optimization** — Uploaded plans are automatically analyzed, their DAG is recomputed, bottlenecks detected, and optimized graph proposals generated before execution approval.
2. **Always-On Orchestrator** — Continuous daemon observes project health, scans queue/build/metric states, and generates self-improvement proposals without direct mutation.
3. **Extension & Skill Ecosystems** — Installable, updateable, disableable extensions and skills with permission-checked hooks, local registries, and dashboard-managed lifecycle.
4. **Organic Vector Memory** — Provenance-backed memory store with embedding, source tracking, freshness decay, and forbidden-source protection.
5. **Policy & Permission Model** — Capability-gated access control for orchestrator, extensions, skills, memory, plan optimization, and protected-system actions.
6. **Audit Ledger** — Structured event stream for all platform actions: allowed, denied, pending-approval, approved, rejected, and rollback.
7. **Dashboard Platform Surfaces** — Autonomy Center, Plan Intake UI, Extensions & Skills Manager, Memory Cockpit, Policy & Audit Center.

---

## What Changed in v2.4 from v2.3.1

### Contract Version

`contractVersion` is now `"2.4.0"`.

### Part 3 JSON — New Top-Level Fields

```json
{
  "contractVersion": "2.4.0",
  "planExecution": {
    "planIntake": {
      "enabled": true,
      "autoDagOptimizationEnabled": true,
      "analyzerProfile": "full",
      "approvalRequiredBeforePatch": true
    }
  }
}
```

- **`planIntake.enabled`**: When true, plan upload triggers automatic DAG analysis, bottleneck detection, and optimizer proposal generation.
- **`planIntake.autoDagOptimizationEnabled`**: When true, the analyzer proposes optimized dependency graphs. The optimizer is advisory until approved.
- **`planIntake.approvalRequiredBeforePatch`**: When true, graph patches from the optimizer require explicit approval before the executor uses them.

### Part 3 JSON — Enhanced Workspace Entry

v2.4 workspace entries adopt the full metadata model that v2.3.1 introduced as template but which v2.4 makes mandatory for all platform-capable plans. The key difference is that `capabilityManifest` (with `canEdit`, `cannotEdit`, `canRun`, `cannotRun`) replaces the older `capabilities` object, and `allowedFiles`/`forbiddenFiles` become required.

```json
{
  "id": "P11.B",
  "title": "Always-on orchestrator daemon, scheduler, and health loop",
  "dependencies": ["P11.A"],
  "parallelGroup": "batch_2",
  "dependencyReason": "P11.B builds on platform contracts from P11.A",
  "parallelism": {
    "expectedBatch": "batch_2",
    "canRunWith": ["P11.C", "P11.D", "P11.E", "P11.F", "P11.G"],
    "cannotRunWith": [],
    "conflictScope": [
      "packages/coding-agent/src/orchestrator/**",
      "packages/web-server/src/orchestrator/**"
    ],
    "sameFileParallelismAllowed": false,
    "safeParallelismNotes": "Can run with batch_2 peers because it only touches the orchestrator namespace."
  },
  "worktree": { "required": true, "isolationMode": "worktree", "cleanupPolicy": "quarantine_on_failure" },
  "integration": {
    "queueRequired": true, "requiresWorkspaceValidation": true,
    "requiresIntegrationValidation": true, "conflictHandoffRequired": true,
    "queuePriority": "critical", "queueOptimizationNotes": "Critical-path for proposal generation."
  },
  "validation": { "profile": "targeted_then_final", "heavyCommandUsesGlobalLock": true, "watchModeForbidden": true },
  "allowedFiles": ["packages/coding-agent/src/orchestrator/**", "packages/web-server/src/orchestrator/**"],
  "forbiddenFiles": [".env*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/id_rsa", "**/credentials/**", "**/secrets/**"],
  "acceptanceCriteria": [
    "The orchestrator can run continuously and expose current status through API/state store.",
    "Pause/resume is executor-mediated and auditable.",
    "Mutation attempts are blocked and logged as policy events."
  ],
  "targetCommand": null,
  "roleBudget": "worker", "maxRetries": 3, "riskLevel": "high",
  "capabilityManifest": {
    "canEdit": ["packages/coding-agent/src/orchestrator/**", "packages/web-server/src/orchestrator/**"],
    "cannotEdit": [".env*", "**/*.pem", "**/*.key", "**/credentials/**", "**/secrets/**"],
    "canRun": ["typecheck", "targeted_tests", "build_if_required"],
    "cannotRun": ["git push", "git push --force", "rm -rf", "npm publish", "terraform destroy", "kubectl delete", "git reset --hard", "git clean -fd", "vitest --watch", "jest --watch", "npm run dev"]
  },
  "telemetry": { "expectedEvents": ["workspace_started", "workspace_completed", "workspace_validation_completed", "integration_queue_entry"], "logLevel": "info" }
}
```

#### New/Expanded Workspace Fields vs v2.3.1

| Field | v2.3.1 | v2.4 |
|---|---|---|
| `parallelism.conflictScope` | Optional | Required for platform plans |
| `parallelism.canRunWith` | Optional | Required when workspace runs in parallel batches |
| `allowedFiles` | Optional | Required — defines exact file scope |
| `forbiddenFiles` | Optional | Required — includes all secret/key patterns |
| `capabilityManifest` | Optional (`capabilityManifest`) | Required — replaces `capabilities` object in queue format |
| `telemetry` | Optional | Required — even if minimal |

### Part 3 JSON — Additional Hard Stops for Platform

v2.4 adds these hard stops (in addition to v2.3.1 stops):

```
execution_without_dry_run
execution_without_approval
protected_system_mutation_without_explicit_approval
extension_permission_denied
skill_permission_denied
memory_forbidden_source_indexing
optimizer_patch_without_approval
```

### Part 4 — Machine-Readable Summary Extended

v2.4 adds:
- `runnableWorkspaceCount` — Total workspace count including spec/preflight workspaces
- `implementationWorkspaceCount` — Subset that produces product code
- `batchCount` — Total DAG batch count
- `peakDagEffectiveParallelism` — Peak parallelism before safety constraints
- `peakSafeEffectiveParallelism` — Peak parallelism after safety constraints
- `requiresWorktreeIsolation` — Whether worktree mode is mandatory
- `planIntakeEnabled` / `autoDagOptimizationEnabled`
- `extensionRegistryRequired` / `skillRegistryRequired` / `organicMemoryRequired`
- Extended `notInScope` for platform items

---

## How to Use This Template

1. **Read the v2.3.1 base template** (`llm-implementation-agent-master-template-v2.3.1.md`) for foundational knowledge.
2. **Apply v2.4 extensions** as documented in this file.
3. **Fill Part 1** using the v2.3.1 format, adding v2.4 workstreams.
4. **Fill Part 2** using v2.3.1 format, adding v2.4 platform policies.
5. **Fill Part 3** with `contractVersion: "2.4.0"`, full workspace metadata, `planIntake` settings, and extended hard stops.
6. **Fill Part 4** with extended fields.
7. **Validate** against all v2.3.1 rules plus v2.4 additions.

---

## Validation Rules — v2.4 Additions

In addition to all v2.3.1 validation rules, v2.4 adds:

### Plan-Intake Rules
1. If `planIntake.enabled` is true, a `planIntake` section must exist in `planExecution`.
2. If `autoDagOptimizationEnabled` is true, `approvalRequiredBeforePatch` must be true.
3. At least 1 implementation workspace (beyond spec/preflight) must exist.
4. Plan-intake analysis must persist before execution if `preflightRequired` is true.

### Workspace Metadata Rules
5. Every workspace must have `allowedFiles` and `forbiddenFiles` arrays.
6. Every workspace in a batch with width > 1 must have `parallelism.canRunWith`.
7. Every workspace must have `capabilityManifest` (replaces legacy `capabilities`).
8. `capabilityManifest.canEdit` must be a subset of `allowedFiles`.
9. Every workspace must have `telemetry.expectedEvents` and `telemetry.logLevel`.

### Platform Rules
10. Extension/skill plans must include a shared platform contracts workspace.
11. Dashboard shell wiring must be owned by exactly one workspace.
12. Protected-system mutation requires explicit self-modification approval.
13. Memory workspace `allowedFiles` must exclude secrets/credentials.
14. Audit workspace `allowedFiles` must not overlap with secret patterns.

---

## Relation to v2.3.1

v2.4 is a **superset** of v2.3.1. All v2.3.1 features remain: interactive parallelism review, scale-aware execution, queue optimization, PostgreSQL/JSON backends. v2.4 adds platform ecosystem capabilities. Plans may target v2.3.1 by setting `contractVersion: "2.3.1"` and omitting platform sections. Plans target v2.4 by setting `contractVersion: "2.4.0"` and including platform sections.

---

## Reference: P11 as v2.4 Canonical Example

The canonical v2.4 plan is **P11 — Ecosystem & Continuous Self-Improvement Platform**:

- **21 runnable workspaces**: P11.0 (preflight) + P11.A (platform contracts) + P11.B–P11.G (6 platform foundations) + P11.H–P11.M (6 integration layers) + P11.N–P11.R (5 dashboard features) + P11.S (shell wiring) + P11.T (validation/dogfood)
- **7 DAG batches**: Peak width 6, critical path: P11.0 → P11.A → P11.G → P11.M → P11.R → P11.S → P11.T
- **Scale mode**: `experimental_6` with worktree isolation, integration queue, validation lock
- **Queue strategy**: `critical_path_first`
- **Plan-intake**: Enabled with auto DAG optimization, approval-gated patches
- **Hard stops**: All v2.3.1 stops plus 7 new platform stops

---

## Template Changelog

### v2.4.0 (2026-05-16)
- Added plan-intake lifecycle: auto DAG optimization, analyzer profiles, approval-gated optimizer patches.
- Added platform capability manifest model: typed manifests per workspace, shared contracts.
- Added enhanced workspace metadata: `allowedFiles`, `forbiddenFiles`, `capabilityManifest`, `telemetry` become mandatory.
- Added always-on orchestrator daemon with health loop, scheduled scans, mutation-blocked policy.
- Added extension registry, package format, and runtime host with permission-checked hooks.
- Added skill registry, package format, and runner with capability-manifest invocation.
- Added organic vector memory with provenance tracking and forbidden-source protection.
- Added policy and permission model with protected capability gates and self-modification approval.
- Added audit ledger events for all platform actions.
- Added dashboard platform surfaces: Autonomy Center, Plan Intake, Extensions & Skills, Memory Cockpit, Policy & Audit.
- Added `planIntake` section to `planExecution`.
- Extended hard stops with 7 new platform safety stops.
- Extended Part 4 summary with runnable/implementation counts, batch/parallelism metadata, platform flags.
- Added validation rules for plan-intake, workspace metadata, capability manifests, dashboard shell isolation.
- Set `contractVersion` to `2.4.0`.
- Preserved all v2.3.1 scale-aware execution, queue optimization, worktree isolation, and integration queue semantics.

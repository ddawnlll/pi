# ACCP 1.2 Research Report — Alpha2 Plan Compiler Migration

## 1. Executive Summary

**Current parser rating: 3/10**

Four separate parsing paths exist for what should be one canonical pipeline. The RC1 parser (`planspec-v5-parser.ts`) and the legacy Markdown parser (`plan-parser.ts`) share no code, produce incompatible output types (`PlanSpecV5` vs `ParseResult`/`WorkspaceQueue`), and are stitched together in `plan-runner.ts` with nested try/catch fallthrough logic. The Alpha2 parser (`planspec-v5-alpha2-parser.ts`) exists but is never called from the runtime — it is a dead prototype. The web-server `index.ts` validate route has been patched to stop swallowing RC1 errors, but the plan-runner's run route still has a fragile 4-layer fallback chain.

**Migration difficulty: High** — not because the compiler is complex, but because `WorkspaceQueue` from `workspace-schema.ts` is imported by ~55 production files and ~45 test files. Replacing the axis of the runtime from `WorkspaceQueue` to `CompiledPlan` requires a coordinated stage-gated migration.

**Main architectural risk**: `WorkspaceQueue` is the universal runtime intermediate. Executors, schedulers, state stores, safety doctors, and batch planners all consume it. Anything that changes its shape or replaces its role risks breaking the executor pipeline silently — especially the `AutonomousExecutor` (2960 lines) which has the most complex state machine in the codebase.

**Recommended target architecture**: Single `compilePlanSpecAlpha2()` entrypoint that produces a `CompiledPlan` artifact containing everything the runtime needs. The `CompiledPlan` should be a superset of `WorkspaceQueue` that can be trivially adapted. Once the runtime consumes `CompiledPlan` directly, `WorkspaceQueue` becomes an internal implementation detail, then removable.

---

## 2. Current Parser Inventory

| File | Current Role | Runtime Used? | Keep / Delete / Replace / Move | Reason |
|------|-------------|:---:|:---:|------|
| `core/plan-parser.ts` | Legacy v4 Markdown parser. File-level `parsePlan()`, `loadPlan()`, `formatParseResult()`. ~900 lines. | YES | Delete after migration | Markdown parsing is deprecated by ACCP 1.2. `loadPlan` is the CLI's only entrypoint. `formatParseResult` couples frontend display to legacy types. |
| `core/planspec-v5-parser.ts` | RC1 JSON entry point. `parsePlanSpecJsonOnly()`, `parsePlanSpecCombined()`. Bridges RC1 → `PlanSpecCombinedResult`. ~230 lines. | YES | Delete | Alpha2 supersedes RC1. `parsePlanSpecCombined()` is the "auto" mode that handles both RC1 JSON and legacy Markdown — exactly the wrong abstraction. |
| `core/planspec-v5-schema.ts` | RC1 Zod schema definitions + `parsePlanSpecV5()`. 18 strict object schemas. ~330 lines. | YES | Delete | RC1 schema frozen. Replace with Alpha2 Zod schemas in new compiler. |
| `core/planspec-v5-types.ts` | RC1 TypeScript interfaces. ~240 lines. | YES | Delete | RC1 types frozen. Replace with Alpha2 types. |
| `core/planspec-v5-semantic-validator.ts` | RC1 cross-field semantic validation (10 rules). ~300 lines. | YES | Delete | RC1-specific rules (accpVersion, commandPolicy structure, p45Bridge). Replace with Alpha2-appropriate rules. |
| `core/planspec-v5-alpha2-parser.ts` | Standalone Alpha2 parser — loose validation, never called from runtime. ~70 lines. | NO | Replace | Too loose, missing schema enforcement, no span tracking, no diagnostics. Skeleton for the new compiler. |
| `core/planspec-v5-alpha2-types.ts` | Alpha2 TypeScript interfaces. ~280 lines. | NO | Move & replace | Types are usable as-is but need some tightening (see Section 8). Move into `plan-compiler/alpha2/alpha2-types.ts`. |
| `core/workspace-schema.ts` | `WorkspaceQueue` + `Workspace` definitions, version matrix, `validateWorkspaceQueue()`, `detectCycles()`. ~1380 lines. | YES | Adapt temporarily, then deprecate | The runtime's central type. Cannot be deleted until `CompiledPlan` replaces it in the executor pipeline. Adapt by having the compiler emit a `CompiledPlan` that can be converted to `WorkspaceQueue` during migration Stage C. |
| `core/plan-parser.ts` (workspace-schema imports) | `validateWorkspaceQueue()` called from `parsePlan()` and from `safety-doctor.ts`. | YES | Move validation logic | The safety doctor calls `validateWorkspaceQueue()` on the parsed queue. This is runtime validation, not parse validation. Move into compiler's validation phase and remove from parser. |
| `cli/plan-commands.ts` | CLI commands: `doctor`, `dry-run`, `run`, `rerun`, `resume`. Uses `loadPlan()` → `parsePlan()` → `WorkspaceQueue`. ~2770 lines. | YES | Refactor CLI to use compiler | Every CLI command that accepts a plan file path goes through `loadPlan()`. Must switch to `compilePlanSpecAlpha2()`. |
| `web-server/src/plan-runner.ts` | Background plan execution. Has its own 4-layer parse chain (RC1 + schema + semantics → WorkspaceQueue adapter → legacy fallback). ~2770 lines. | YES | Replace parse chain with compiler | The hand-written RC1→WorkspaceQueue adapter (lines 529-595) is the most brittle code in the system. |
| `web-server/src/index.ts` (validate/run routes) | Validate route now stops on RC1 error. Run route has the same 4-layer chain. ~50 lines parse logic each. | YES | Replace with compiler | Validate route recently fixed. Run route still has legacy fallback. Both should call `compilePlanSpecAlpha2()`. |
| `web-server/src/plan-preview.ts` | `computeBatchPlan(WorkspaceQueue)` — batch computation, cycle detection. ~580 lines. | YES | Adapt to accept both `WorkspaceQueue` and `CompiledPlan` | Batch computation logic is correct. Needs a thin adapter. |
| `web-server/src/plan-markdown.ts` | Living plan markdown generation. ~260 lines. | YES | Keep | Operates on execution events, not parse output. No change needed. |
| `web-ui/dashboard/src/utils/planParser.ts` | Frontend-only plan parser (Markdown/JSON/YAML). ~430 lines. | YES | Delete | Frontend should not parse plans. Upload raw content to backend, let compiler handle it. |
| `web-ui/dashboard/src/utils/planValidator.ts` | Frontend-only validation (cycles, batches, file conflicts). ~500 lines. | YES | Delete | Validation is the backend's job. Frontend should display diagnostics from `compilePlanSpecAlpha2()`. |
| `core/draft-planner.ts` | Generates draft plans. ~120 lines. | YES | Adapt | Currently builds `WorkspaceQueue` objects directly. Should emit Alpha2 JSON or use compiler. |
| `brain-workers/plan-synthesizer/index.ts` | Plan generation pipeline. | YES | Adapt output | Generates plans that eventually feed into the parser. Should generate Alpha2 JSON directly. |

---

## 3. Current Call Graph

### 3.1 Legacy Markdown Path (incoming from CLI)

```
pi plan doctor plan.md
  -> plan-commands.ts: planDoctor()
    -> loadPlan() [plan-parser.ts]
      -> parsePlan() [plan-parser.ts]
        -> extractPart3Json() [embedded JSON from ```json block]
        -> scanMarkdownWorkstreamHeadings()
        -> key:value line parser
        -> YAML list parser
        -> construct ParseResult with WorkspaceQueue
        -> validateWorkspaceQueue() [workspace-schema.ts]
    -> formatParseResult() for error display
    -> createSafetyDoctor().validateQueue(WorkspaceQueue)
```

### 3.2 V5 RC1 JSON Path (incoming from web-server)

```
POST /api/projects/:projectId/plans/validate { planContent }
  -> index.ts validate handler
    -> if startsWith("{"): parsePlanSpecJsonOnly(planContent) [planspec-v5-parser.ts]
      -> JSON.parse()
      -> parsePlanSpecV5(JSON) [planspec-v5-schema.ts]  (Zod schema)
      -> validatePlanSpecSemantics(parsed) [planspec-v5-semantic-validator.ts]
      -> return PlanSpecCombinedResult { success, planspec, errors }
    -> if v5 fails: return errors immediately (after recent fix)
    -> else: parsePlan(planContent) [legacy Markdown fallback]

POST /api/projects/:projectId/plans/run { planContent }
  -> plan-runner.ts: runPlan()
    -> if startsWith("{"): multi-layer parse chain:
      Layer 1: parsePlanSpecJsonOnly(planContent)  [v5 JSON schema + semantics]
      Layer 2: if v5 fails: parsePlan(planContent)  [legacy Markdown]
      Layer 3: v5 success → hand-written adapter:
        parsed.workspaces.map(ws => ({ id, title, dependencies, ...Workspace }))
        -> creates WorkspaceQueue containing Workspace[]
    -> WorkspaceQueue → AutonomousExecutor
```

### 3.3 Alpha2 Path (currently dead code)

```
(no runtime entrypoint calls this)
parsePlanSpecV5Alpha2(rawJson) [planspec-v5-alpha2-parser.ts]
  -> JSON.parse()
  -> check planSpecVersion === "5.0.0-alpha2"
  -> check kind === "ImplementationPlan"
  -> check core required fields
  -> check duplicate wave/workspace IDs
  -> return PlanSpecParseResult { valid, spec?, errors, warnings }
```

### 3.4 Frontend Parse Path (completely separate)

```
PlanUploadDialog.tsx
  -> planParser.ts: parsePlan(rawText, fileName)
    -> detects extension: .json, .md, .yml/yaml, .txt
    -> json parser or markdown parser or yaml parser
    -> returns ParsedPlanDraft
  -> planValidator.ts: validatePlanDraft(parsedDraft, allPlans)
    -> checks titles, IDs, deps, cycles, files, conflicts, parallelism
    -> returns PlanValidationMessage[]
  -> ValidationScreen.tsx displays results
```

---

## 4. Dependency Findings

### 4.1 `parsePlan` (from `core/plan-parser.ts`)

| File | Symbol | Why Used | Blocks Deletion? | Replacement |
|---|---|---|---|---|
| `core/planspec-v5-parser.ts:13` | `parsePlan` | Called in `parsePlanSpecCombined()` as legacy fallback | YES — `parsePlanSpecCombined()` must be removed first | Remove `parsePlanSpecCombined()` entirely |
| `cli/plan-commands.ts:46` | `loadPlan`, `formatParseResult` | Every CLI plan command uses `loadPlan()` to read and parse plan files | YES — `loadPlan` is the CLI's only file ingestion path | Replace with `compilePlanSpecAlpha2()` call |
| `index.ts:181` | `formatParseResult`, `loadPlan`, `parsePlan` | Public API exports for consumers | YES — exported publicly | Replace exports with compiler API |
| `web-server/src/index.ts:63` | `parsePlan` | Imported but only used as `parsePlan()` in legacy fallback | YES — used in validate route's `try {}` catch fallback | Remove fallback; require Alpha2 JSON |
| `web-server/src/plan-runner.ts:20` | `parsePlan` | Used as final fallback when v5 parsing fails | YES — the run route's escape hatch | Remove fallback |

### 4.2 `parsePlanSpecJsonOnly` (from `core/planspec-v5-parser.ts`)

| File | Symbol | Why Used | Blocks Deletion? | Replacement |
|---|---|---|---|---|
| `core/autonomous-executor.ts:636` | `parsePlanSpecJsonOnly` | Dynamic import inside `admitPlanspecFromQueue()` | YES — lock admission depends on RC1 parse result | Replace with compile-alpha2 call |
| `web-server/src/index.ts:63,1859,2209` | `parsePlanSpecJsonOnly` | Validate and run routes | YES — both routes call it | Replace with `compilePlanSpecAlpha2()` |
| `web-server/src/plan-runner.ts:21,521` | `parsePlanSpecJsonOnly` | Layer 1 of run route's parse chain | YES — the primary parse attempt | Replace with compiler |
| `index.ts:194` | `parsePlanSpecJsonOnly` | Public API export | YES — exported | Replace export |

### 4.3 `parsePlanSpecV5` (from `core/planspec-v5-schema.ts`)

| File | Symbol | Why Used | Blocks Deletion? | Replacement |
|---|---|---|---|---|
| `web-server/src/plan-runner.ts:22,523` | `parsePlanSpecV5` | Layer 1b — Zod schema validation of RC1 | YES — part of the 4-layer chain | Remove; compiler handles schema validation |
| `index.ts:196` | `parsePlanSpecV5` | Public API export | YES — exported | Replace export |

### 4.4 `validatePlanSpecSemantics` (from `core/planspec-v5-semantic-validator.ts`)

| File | Symbol | Why Used | Blocks Deletion? | Replacement |
|---|---|---|---|---|
| `core/planspec-v5-parser.ts:15,104` | `validatePlanSpecSemantics` | Called inside `parsePlanSpecJsonOnly()` | YES — part of RC1 parse | Remove with RC1 parser |
| `web-server/src/plan-runner.ts:24,526` | `validatePlanSpecSemantics` | Layer 1c — semantic validation of RC1 | YES — part of the 4-layer chain | Remove |
| `index.ts:197` | `validatePlanSpecSemantics` | Public API export | YES — exported | Replace export |

### 4.5 `parsePlanSpecV5Alpha2` (from `core/planspec-v5-alpha2-parser.ts`)

| File | Symbol | Why Used | Blocks Deletion? | Replacement |
|---|---|---|---|---|
| `test/project-state/planspec-v5-alpha2-parser.test.ts` | `parsePlanSpecV5Alpha2` | Only caller — test file | NO — can be updated | Update test to use new compiler |

### 4.6 `WorkspaceQueue` (from `core/workspace-schema.ts`)

This is the biggest blocker. ~55 production files and ~45 test files import `WorkspaceQueue` or `Workspace` from `workspace-schema.ts`. Every executor, scheduler, state store, and validator depends on it. Full list in Section 2's inventory tables. Until `CompiledPlan` carries equivalent or superset data, `WorkspaceQueue` cannot be deleted.

---

## 5. Alpha2-Only Target Architecture

```
plan-compiler/
  index.ts                     — Public API: compilePlanSpecAlpha2()
  compile-alpha2.ts            — Orchestrator: source classification → parse → validate → emit
  alpha2/
    alpha2-types.ts            — Move from core/planspec-v5-alpha2-types.ts (tightened)
    alpha2-schema.ts           — Zod schemas for all Alpha2 types (strictObj everywhere)
    parse-alpha2-json.ts       — JSON.parse + Zod validation + error collection with spans
  validation/
    validate-alpha2-semantics.ts   — Cross-field semantic rules (refs, dups, required)
    validate-alpha2-graph.ts       — Wave + workspace dependency cycle detection
    validate-alpha2-security.ts    — Self-mod firewall, data exfil, secret protection checks
    validate-alpha2-commands.ts    — Command policy enforcement, blocked/allowed checks
  emit/
    emit-compiled-plan.ts      — Transform validated PlanSpecV5Alpha2 → CompiledPlan
    emit-worker-packets.ts     — Generate per-workspace WorkerPacket from CompiledPlan
    emit-plan-lock.ts          — Generate PlanLock + hash from CompiledPlan
  diagnostics/
    diagnostic.ts              — PlanDiagnostic type and builder functions
    diagnostic-codes.ts        — All diagnostic codes as const enum
    format-diagnostics.ts      — Format diagnostics for CLI display, JSON output, and API responses
```

### File Responsibilities

**`index.ts`**: Single public entrypoint. Reads input string, detects source type (rejects non-JSON immediately), calls orchestrator, returns `PlanCompileResult`.

**`compile-alpha2.ts`**: Orchestrator that coordinates the pipeline phases:
1. Source classification (verify JSON, check `planSpecVersion`, check `kind`)
2. JSON parse (structured `JSON.parse` with position tracking)
3. Schema validation (Zod with `superRefine` for collection-level rules)
4. Semantic validation (ref resolution, field constraints)
5. Graph validation (cycle detection in waves + workspaces)
6. Policy validation (command policy, edit policy, security policy)
7. Emission (produce `CompiledPlan`, `WorkerPacket[]`, `PlanLock`)

**`alpha2/alpha2-types.ts`**: Tightened versions of the current `PlanSpecV5Alpha2` types. Must use `ReadonlyArray` for immutability after compilation. Add `sourcePosition` tracking to fields for span reporting.

**`alpha2/alpha2-schema.ts`**: Zod schemas with `z.strictObject()` (equivalent to `additionalProperties: false`), field-level refinements (pattern validation on IDs, ISO date validation on timestamps, min/max on numbers).

**`alpha2/parse-alpha2-json.ts`**: Thin wrapper over `JSON.parse()` that tracks line/column positions. Catches `JSON.parse` exceptions and converts to structured diagnostics.

**`validation/validate-alpha2-semantics.ts`**: Rules that check field values and cross-field consistency without graph analysis. Examples: workspace `rootDir` must be absolute, `planSpecVersion` must be exact `"5.0.0-alpha2"`, task `priority` must be valid enum value.

**`validation/validate-alpha2-graph.ts`**: Wave dependency DAG cycle detection, workspace dependency DAG cycle detection, wave-ordered topological sort validation.

**`validation/validate-alpha2-security.ts`**: Self-modification firewall rules (protected paths match workspace `canEdit`), data exfiltration guard checks, secret pattern compliance.

**`validation/validate-alpha2-commands.ts`**: Command policy level validation (`strict`/`moderate`/`permissive`), blocked command rejection, timeout bounds, allowedCommands subset enforcement.

**`emit/emit-compiled-plan.ts`**: Maps validated `PlanSpecV5Alpha2` to `CompiledPlan`. Ordering: wave topology → workspace ordering inside waves → task grouping → batched execution plan. This is where the topological batch computation that currently lives in `plan-preview.ts` migrates to.

**`emit/emit-worker-packets.ts`**: For each workspace+task combination, produce a `WorkerPacket` containing only the commands, files, and ACs relevant to that workspace. This replaces the hand-rolled adapter in `plan-runner.ts:529-595`.

**`emit/emit-plan-lock.ts`**: Generate a deterministic lock from the `CompiledPlan`. Include hash of commands, workspace IDs, schema version, and edit policies. This replaces `planlock-admission.ts` + `planlock-hash.ts`.

**`diagnostics/`**: The foundation that makes "parse failed — no details available" impossible. Every diagnostic has a code, severity, phase, message, and optional hint/sourceSpan. The format function can output Markdown (for CLI), JSON (for API), or structured objects (for frontend).

---

## 6. New Public API

```typescript
// plan-compiler/index.ts

export interface PlanCompileResult {
  ok: boolean;
  artifact?: CompiledPlan;
  workerPackets?: WorkerPacket[];
  planLock?: PlanLock;
  diagnostics: PlanDiagnostic[];
}

export interface PlanDiagnostic {
  code: PlanDiagnosticCode;
  severity: "info" | "warning" | "error" | "fatal";
  phase:
    | "source_classification"
    | "json_parse"
    | "schema_validation"
    | "semantic_validation"
    | "graph_validation"
    | "policy_validation"
    | "emission";
  message: string;
  path?: string;
  hint?: string;
  sourceSpan?: {
    line: number;
    column: number;
    length: number;
  };
}

export function compilePlanSpecAlpha2(input: string): PlanCompileResult;
```

Design rationale:
- `PlanCompileResult.ok` replaces `success` — "compile" semantics are clearer than "parse".
- `PlanCompileResult.diagnostics` replaces `errors` + `warnings` — single array, never empty on failure.
- `PlanCompileResult.artifact` is the full `CompiledPlan` — never set when `ok` is false.
- `PlanCompileResult.workerPackets` and `planLock` are pre-emitted — the runtime doesn't need to compute these separately.
- `PlanDiagnostic.sourceSpan` is optional — set when the source position is known (JSON field positions), unset when the diagnostic is derived (e.g., cycle detection).
- `PlanDiagnostic.code` is an enum — never a free-form string. Frontend can map codes to localized messages.
- `PlanDiagnostic.phase` tracks which pipeline phase produced the diagnostic — critical for debugging where in the pipeline something failed.

---

## 7. CompiledPlan Artifact Design

```typescript
interface CompiledPlan {
  // Source identity
  planSpecVersion: "5.0.0-alpha2";
  kind: "ImplementationPlan";

  // Task identity
  phaseId: string;        // Alpha2: metadata.phaseId
  title: string;           // Alpha2: metadata.title
  owner: string;           // Alpha2: metadata.owner
  status: string;          // Alpha2: metadata.status

  // Metadata
  createdAt: string;       // Alpha2: metadata.createdAt (ISO 8601)
  updatedAt: string;       // Alpha2: metadata.updatedAt (ISO 8601)
  sourceDocument?: string; // Alpha2: metadata.sourceDocument
  tags: string[];          // Alpha2: metadata.tags

  // Description
  description: string;     // Alpha2: metadata.description
  goal: string;            // Alpha2: intent.goal
  successCriteria: string[]; // Alpha2: intent.successCriteria
  outOfScope: string[];    // Alpha2: intent.outOfScope

  // Execution configuration
  mode: string;            // Alpha2: authority.executionState.mode
  maxParallelWorkspaces: number; // Alpha2: authority.executionState.maxParallelWorkspaces
  scaleMode?: string;
  worktreeIsolation: boolean;    // default: false
  integrationQueue: boolean;     // default: false
  validationLock: boolean;       // default: false

  // Completion requirements
  requiresAcceptanceCriteria: boolean;
  requiresValidationEvidence: boolean;
  requiresReport: boolean;
  requiresRollbackPlan: boolean;
  requiresFinalVerdict: boolean;

  // Command policy (frozen at compile time)
  commandPolicy: {
    level: "strict" | "moderate" | "permissive"; // Alpha2: commands.policy
    allowedCommands: string[];                     // Alpha2: commands.allowedCommands
    blockedCommands: string[];                     // Alpha2: commands.blockedCommands
    timeoutSeconds: number;
    maxOutputBytes: number;
  };

  // File edit policy (frozen at compile time)
  filePolicy: {
    enabledProtectedPaths: string[];  // Alpha2: security.selfModificationFirewall.protectedPaths
    allowListedFiles: string[];       // Alpha2: security.selfModificationFirewall.allowListedFiles
    requireExplicitApproval: boolean;
  };

  // Wave graph (topologically ordered)
  waves: CompiledWave[];
  waveAdjacency: Record<string, string[]>;  // wave ID → dependency wave IDs

  // Workspace graph (topologically ordered within waves)
  workspaces: CompiledWorkspace[];
  workspaceAdjacency: Record<string, string[]>;  // workspace ID → dependency workspace IDs

  // Tasks (flat list, mapped to workspaces via workspaceId)
  tasks: CompiledTask[];

  // Pre-computed batch plan
  executionBatches: ExecutionBatch[];

  // Validation requirements
  validation: {
    preValidation: string[];
    postValidation: string[];
    continuousValidation: boolean;
    failFast: boolean;
  };

  // Evidence configuration
  evidence: {
    captureMode: string;
    types: string[];
  };

  // Security configuration
  security: {
    selfModificationFirewall: CompiledSelfModFirewall;
    dataExfiltrationGuard: CompiledDataExfilGuard;
    secretProtection: CompiledSecretProtection;
  };

  // Lock state
  planLock?: CompiledPlanLock;
  lockHash?: string;

  // Diagnostics summary
  diagnosticSummary: {
    info: number;
    warning: number;
    error: number;
    fatal: number;
  };
}
```

### Alpha2 Field Mapping

| CompiledPlan Field | Alpha2 Source | Notes |
|---|---|---|
| `phaseId` | `metadata.phaseId` | Direct |
| `title` | `metadata.title` | Direct |
| `description` | `metadata.description` | Direct |
| `goal` | `intent.goal` | Direct |
| `successCriteria` | `intent.successCriteria` | Direct |
| `outOfScope` | `intent.outOfScope` | Direct |
| `mode` | `authority.executionState.mode` | Must be validated against known modes |
| `maxParallelWorkspaces` | `authority.executionState.maxParallelWorkspaces` | Clamp to max allowed |
| `commandPolicy.level` | `commands.policy` | Map "strict"/"moderate"/"permissive" |
| `filePolicy.enabledProtectedPaths` | `security.selfModificationFirewall.protectedPaths` | Direct |
| `waves` | `waves[]` | Sorted by `order` field, dependencies resolved |
| `workspaces` | `workspaces[]` | Sorted by wave+task membership |
| `tasks` | `waves[].tasks[]` | Flattened, deduplicated, mapped to workspace |

---

## 8. Validation Rules

### Source Classification Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_EMPTY_INPUT` | fatal | "Input is empty. Provide a PlanSpec Alpha2 JSON document." |
| `E_NOT_JSON` | fatal | "Input is not valid JSON. PlanSpec Alpha2 requires a JSON document." |
| `E_WRONG_VERSION` | fatal | `$.planSpecVersion: Expected "5.0.0-alpha2", got "5.0.0"` |
| `E_WRONG_KIND` | fatal | `$.kind: Expected "ImplementationPlan", got "Implementation"` |
| `E_LEGACY_MARKDOWN` | fatal | "Markdown plans are no longer supported. Convert to PlanSpec Alpha2 JSON format." |

### JSON Parse Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_MALFORMED_JSON` | fatal | `$: Unexpected token at position 42. Expected property name.` |
| `E_ROOT_NOT_OBJECT` | fatal | `$: Root value must be a JSON object, got array.` |

### Schema Validation Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_MISSING_FIELD` | error | `$.metadata: Missing required field.` |
| `E_INVALID_TYPE` | error | `$.waves: Expected array, got object.` |
| `E_INVALID_VALUE` | error | `$.authority.executionState.mode: Expected one of ["stable_3", "experimental_6"], got "turbo".` |
| `E_DUPLICATE_ID` | error | `$.waves[1].id: Duplicate wave ID "wave-1".` |

### Semantic Validation Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_DUPLICATE_WORKSPACE` | error | `$.workspaces[2]: Duplicate workspace ID "ws-main".` |
| `E_DUPLICATE_TASK` | error | `$.waves[0].tasks[3]: Duplicate task ID "task-build".` |
| `E_REF_UNKNOWN_WAVE` | error | `$.waves[1].dependencies[0]: Reference to unknown wave "wave-99".` |
| `E_REF_UNKNOWN_WORKSPACE` | error | `$.workspaces[0].rootDir: Reference to unknown workspace "ws-missing".` |
| `E_REF_UNKNOWN_TASK` | error | `$.waves[0].tasks[1].dependencies[0]: Reference to unknown task "task-missing".` |
| `E_REF_UNKNOWN_WORKSPACE_TASK` | error | `$.waves[0].tasks[2].workspaceId: References unknown workspace "ws-nonexistent".` |
| `E_ROOT_DIR_NOT_ABSOLUTE` | warning | `$.workspaces[0].rootDir: Should be an absolute path, got "src/app".` |

### Graph Validation Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_CYCLE_WAVE` | error | `$.waves: Circular dependency detected in wave graph: wave-A → wave-B → wave-A.` |
| `E_CYCLE_TASK` | error | `$.waves: Circular dependency detected in task graph: task-1 → task-3 → task-1.` |
| `E_ORPHAN_WORKSPACE` | warning | `$.workspaces[2]: Workspace "ws-standalone" is not referenced by any wave.` |
| `E_TASK_ORDER_MISMATCH` | warning | `$.waves[0].tasks: Task "task-init" has dependency on "task-build" but appears earlier in the list.` |

### Policy Validation Phase

| Code | Severity | Example Message |
|---|---|---|
| `E_COMMAND_POLICY_VIOLATION` | error | `$.waves[0].tasks[1].executionPolicy.allowedCommands[0]: Command "rm -rf /" is blocked by top-level command policy.` |
| `E_FILE_POLICY_VIOLATION` | error | `$.workspaces[0].canEdit[1]: Path "/etc/passwd" is protected by self-modification firewall.` |
| `E_DELETE_FORBIDDEN` | error | `$.waves[0].tasks[0].files[2]: Delete operation on "/usr/bin/pi" violates security policy.` |
| `E_VALIDATION_UNRESOLVABLE` | error | `$.waves[0].tasks[1].validation.postCheck[0]: Validation command "run-lint" not found in allowed commands.` |
| `E_COMPLETION_UNSATISFIABLE` | warning | `$.authority.completion.requiresAcceptanceCriteria is true but no tasks define acceptanceCriteria.` |

### Emission Phase

| Code | Severity | Example Message |
|---|---|---|
| `W_EMPTY_WAVE` | info | `$.waves[2]: Wave "wave-empty" contains no tasks. It will be skipped during execution.` |
| `W_HIGH_PARALLELISM` | info | `$.authority.executionState.maxParallelWorkspaces: 10 workers may cause resource contention.` |

---

## 9. Deletion / Replacement Plan

### Stage A — No Runtime Behavior Changes
**Goal**: Add compiler skeleton alongside existing parsers. No runtime changes.

**Files changed**:
- Create `plan-compiler/` directory with all files from Section 5
- Add `compilePlanSpecAlpha2()` to public exports in `index.ts`
- Add import map entries if the package has explicit exports

**Risk**: Low — new code, no existing paths changed.
**Validation**: `npm run check` + new unit tests for compiler.
**Rollback**: Delete `plan-compiler/` directory, revert `index.ts` exports.

### Stage B — Add Research Tests
**Goal**: Prove compiler correctness against existing test fixtures.

**Files changed**:
- Create `test/plan-compiler/` directory with tests from Section 10
- Add tests that feed Alpha2 JSON to both old and new parsers, compare results
- Add regression tests for every diagnostic code

**Risk**: Low — new test code only.
**Validation**: All tests pass.
**Rollback**: Delete test directory.

### Stage C — Switch Runtime to Compiler
**Goal**: `compilePlanSpecAlpha2()` becomes the only plan ingestion path. All plan content goes through it.

**Files changed**:
- `web-server/src/index.ts`: Replace validate/run parse chains with `compilePlanSpecAlpha2()`
- `web-server/src/plan-runner.ts`: Remove all 4 layers of parse fallback, use compiler
- `cli/plan-commands.ts`: Replace `loadPlan()` calls with `compilePlanSpecAlpha2()` calls
- `core/autonomous-executor.ts`: Replace `parsePlanSpecJsonOnly()` import with compiler
- `core/planlock-admission.ts`: Update to consume `CompiledPlan` instead of `PlanSpecV5`
- `web-server/src/plan-preview.ts`: Add `CompiledPlan` → `WorkspaceQueue` adapter
- `index.ts`: Update public exports (remove legacy, add compiler)

**Risk**: HIGH — this is the stage where everything can break.
**Validation**: Full e2e tests pass. Manual testing with real Alpha2 plans.
**Rollback**: Revert all Stage C changes → full rollback to Stage B state.

### Stage D — Delete Unsupported Parser Files
**Goal**: Remove all RC1 and legacy parser code.

**Files deleted**:
- `core/plan-parser.ts` (entire file)
- `core/planspec-v5-parser.ts`
- `core/planspec-v5-schema.ts`
- `core/planspec-v5-types.ts`
- `core/planspec-v5-semantic-validator.ts`
- `core/planspec-v5-alpha2-parser.ts` (replaced by compiler's parse-alpha2-json.ts)
- `core/planspec-v5-alpha2-types.ts` (moved to compiler's alpha2/)
- `web-ui/dashboard/src/utils/planParser.ts`
- `web-ui/dashboard/src/utils/planValidator.ts`

**Risk**: Medium — deletions are safe if Stage C is fully rolled out.
**Validation**: No dangling imports. `npm run check` passes.
**Rollback**: Restore files from git.

### Stage E — Clean Tests and Docs
**Goal**: Remove legacy tests, update documentation.

**Files changed**:
- Delete/rewrite: `plan-parser.test.ts`, `p31-plan-parser-v4.test.ts`, `v4-template-parser.test.ts`, `planspec-v5-rc1.test.ts`, `planspec-v5-final-gauntlet.test.ts`, `v5-e2e-integration.test.ts`, `v5-real-smoke-gauntlet.test.ts`
- Update: `plan-commands.test.ts` (remove .md fixture tests, add compiler tests)
- Update: `boundary-imports.test.ts` (remove legacy exports)
- Rewrite: `README.md` documentation for both packages
- Update: `docs/providers.md` if applicable

**Risk**: Low — tests only.
**Validation**: New test suite passes.
**Rollback**: Restore from git.

---

## 10. Test Matrix

### Test File: `test/plan-compiler/compile-alpha2.test.ts`

| Test Case | Input | Expected `ok` | Expected Diagnostic Codes |
|---|---|---|---|
| Valid minimal Alpha2 plan | Minimal JSON with required fields only | `true` | `[]` |
| Valid realistic Alpha2 plan | Full plan with waves, workspaces, tasks, security | `true` | Warnings only (e.g., `W_EMPTY_WAVE`) |
| Malformed JSON | `{ invalid` | `false` | `E_MALFORMED_JSON` |
| Markdown input | `# Phase P2\n\n## 7.A — Task` | `false` | `E_LEGACY_MARKDOWN` |
| RC1 JSON input | `{"planSpecVersion": "5.0.0", "kind": "PlanSpec"}` | `false` | `E_WRONG_VERSION`, `E_WRONG_KIND` |
| Legacy v4 Markdown input | `# Phase\n### Workspace A\nDepends On: B` | `false` | `E_LEGACY_MARKDOWN` |
| Empty input | `""` | `false` | `E_EMPTY_INPUT` |
| Missing metadata | Drop `$.metadata` | `false` | `E_MISSING_FIELD` |
| Missing workspaces | Drop `$.workspaces` | `false` | `E_MISSING_FIELD` |
| Missing waves | Drop `$.waves` | `false` | `E_MISSING_FIELD` |
| Duplicate workspace ID | Two workspaces with same `id` | `false` | `E_DUPLICATE_ID` |
| Duplicate wave ID | Two waves with same `id` | `false` | `E_DUPLICATE_ID` |
| Invalid workspace reference | Task references non-existent workspace | `false` | `E_REF_UNKNOWN_WORKSPACE_TASK` |
| Invalid wave dependency | Wave depends on non-existent wave | `false` | `E_REF_UNKNOWN_WAVE` |
| Circular wave dependency | Wave-A → Wave-B → Wave-A | `false` | `E_CYCLE_WAVE` |
| Circular task dependency | Task-1 → Task-3 → Task-1 | `false` | `E_CYCLE_TASK` |
| Forbidden file mutation | Workspace edits protected path | `false` | `E_FILE_POLICY_VIOLATION` |
| Forbidden delete | Task deletes protected file | `false` | `E_DELETE_FORBIDDEN` |
| Blocked command | Task uses blocked command | `false` | `E_COMMAND_POLICY_VIOLATION` |
| Invalid command reference | Validation check references unknown command | `false` | `E_VALIDATION_UNRESOLVABLE` |
| Wrong kind | `{"kind": "NotImplementationPlan"}` | `false` | `E_WRONG_KIND` |
| Wrong version | `{"planSpecVersion": "4.1.0"}` | `false` | `E_WRONG_VERSION` |
| Root is array | `[]` | `false` | `E_ROOT_NOT_OBJECT` |
| No-details-available regression | Any failing input | `false` | At least one `fatal` or `error` diagnostic with message |

### Test File: `test/plan-compiler/emit-compiled-plan.test.ts`

| Test Case | Input | Expected Check |
|---|---|---|
| Single wave, single workspace | 1 wave, 1 workspace | `executionBatches[0].workspaceIds.length === 1` |
| Multiple waves, serial | 3 waves, no dependencies | `executionBatches.length === 3` |
| Multiple waves, parallel | 2 waves with `parallel: true` | `executionBatches.length === 1` |
| Workspace-to-task mapping | 2 workspaces, 3 tasks | Each task assigned to correct workspace |
| Plan lock determinism | Same input twice | Same lock hash |

---

## 11. Runtime Integration Plan

### Current Runtime Entrypoints

1. **`cli/plan-commands.ts`** — `planDoctor()`, `planDryRun()`, `planRun()`, `planRerun()`, `planResume()` all call `loadPlan()` → `parsePlan()` → `WorkspaceQueue`
2. **`web-server/src/index.ts`** — `POST /plans/validate` and `POST /plans/run` call `parsePlanSpecJsonOnly()` then `parsePlan()` fallback
3. **`web-server/src/plan-runner.ts`** — `runPlan()` has the 4-layer v5 → legacy fallback chain
4. **`core/autonomous-executor.ts`** — `admitPlanspecFromQueue()` dynamically imports `parsePlanSpecJsonOnly()` → `admitPlanSpec()`

### Required Replacement Calls

| Entrypoint | Old Call | New Call |
|---|---|---|
| `planDoctor()` | `loadPlan(path)` → `parsePlan()` | `compilePlanSpecAlpha2(content)` |
| `planDryRun()` | Same | Same |
| `planRun()` | Same | Same |
| `planRerun()` | Same | Same |
| `post /validate` | `parsePlanSpecJsonOnly()` | `compilePlanSpecAlpha2()` |
| `post /run` | `parsePlanSpecJsonOnly()` → adapter | `compilePlanSpecAlpha2().artifact` |
| `runPlan()` | 4-layer chain → hand adapter | `compilePlanSpecAlpha2().artifact` |
| `admitPlanspecFromQueue()` | `parsePlanSpecJsonOnly()` | `compilePlanSpecAlpha2()` → emit plan lock |

### Compatibility Issues

- **`WorkspaceQueue` lifetime**: ~55 production files depend on `WorkspaceQueue`. The compiler's `CompiledPlan` must be convertible to `WorkspaceQueue` during Stage C via an adapter function. This adapter lives in `plan-preview.ts` and is removed in Stage D.
- **`PlanSpecV5` type**: Used in `planlock-admission.ts` and `planlock-hash.ts`. The compiler should emit `PlanLock` directly, making these files deletable.
- **`ParseResult` type**: Exported from `index.ts`. External consumers may use it. Keep a deprecated type alias pointing at `PlanCompileResult` during Stage C.
- **Frontend parser**: `web-ui/dashboard/src/utils/planParser.ts` and `planValidator.ts` are completely independent. They must be deleted and the frontend must call the backend's validate endpoint instead. This requires frontend changes in `PlanUploadDialog.tsx` and `ValidationScreen.tsx`.

### `WorkspaceQueue` Removal Path

1. Stage C: Add adapter function `compiledPlanToWorkspaceQueue(cp: CompiledPlan): WorkspaceQueue`
2. Stage C: All runtime code that receives `WorkspaceQueue` receives it through this adapter
3. Stage D: When all consumers use `CompiledPlan` directly, remove adapter and `WorkspaceQueue` type

---

## 12. Risk Register

### Risk 1: Hidden Legacy Markdown Dependency
**Why it matters**: Some runtime paths may accept Markdown plans without our knowledge. The web-server validate route's `catch {}` fallback and plan-runner's `try {} catch { parsePlan() }` both silently accept Markdown. If we remove the fallback without auditing all callers, Markdown uploads will get opaque 500 errors instead of clear diagnostics.
**Affected files**: `web-server/src/index.ts:1876-1890`, `web-server/src/plan-runner.ts:597-605`
**Mitigation**: Add explicit Markdown detection before the parse chain in Stage C. Return `E_LEGACY_MARKDOWN` diagnostic with a clear message.
**Rollback**: Re-enable legacy fallback with deprecation warning.

### Risk 2: Tests Relying on `parsePlan`
**Why it matters**: 7 test files directly import `parsePlan`. Many more import `WorkspaceQueue` for fixture construction. Deleting `parsePlan` without migrating these tests will break CI.
**Affected files**: All files listed in Section 4.1 under test files.
**Mitigation**: Stage E must complete before or alongside Stage C. Tests must be rewritten to construct `CompiledPlan` or use `compilePlanSpecAlpha2()` directly.
**Rollback**: Keep old test files alongside new ones with `@deprecated` markers, run both suites during transition.

### Risk 3: `WorkspaceQueue` Deeply Embedded in Executor
**Why it matters**: `AutonomousExecutor` (~2960 lines) stores `WorkspaceQueue` as a private field, passes it to schedulers, state stores, and safety doctors. Replacing this type requires changes across the entire runtime surface.
**Affected files**: `AutonomousExecutor`, `WorkspaceScheduler`, `DynamicScheduler`, `PlanStateStore`, `JsonStateStore`, `DatabaseStateStore`, `PlanQueueRunner`, `PlanQueueStore`, `SafetyDoctor`, `DagAnalyzer`, `DagOptimizer` — ~20 core files.
**Mitigation**: The `CompiledPlan` → `WorkspaceQueue` adapter allows gradual migration. Start by having the compiler emit both types. Then migrate consumers one by one.
**Rollback**: Revert to adapter-based conversion.

### Risk 4: Alpha2 Schema Too Loose
**Why it matters**: The current `parsePlanSpecV5Alpha2()` has a "loose mode" comment — it checks core fields but doesn't validate sub-field types strictly. The current `PlanSpecV5Alpha2` interface has optional fields that should be required (e.g., `security` is required by the ACCP 1.2 spec but optional in the type).
**Affected files**: `core/planspec-v5-alpha2-types.ts`, `core/planspec-v5-alpha2-parser.ts`
**Mitigation**: The new `alpha2-schema.ts` must use `strictObj()` + Zod refinements. Every field that is required by ACCP 1.2 must be required in the schema. Review the ACCP 1.2 spec against the current types and fix discrepancies before Stage A.
**Rollback**: Not applicable — schema is new code.

### Risk 5: Diagnostics Not Propagated to CLI/UI
**Why it matters**: The entire reason for this migration is to eliminate "no details available". If the compiler produces great diagnostics but the CLI or web dashboard doesn't display them, the user still gets a bad experience.
**Affected files**: `cli/plan-commands.ts` (formatParseResult replacement), `ValidationScreen.tsx` (diagnostic display), `plan-command-cli.ts`
**Mitigation**: The compiler's `format-diagnostics.ts` must produce both machine-readable JSON and human-readable Markdown. The CLI should use the Markdown formatter. The web dashboard should use the JSON formatter and render it with structured components.
**Rollback**: Fallback to generic error display.

### Risk 6: Accidental Runtime Support for RC1/Legacy After Migration
**Why it matters**: If the runtime code still has fallback paths, users will accidentally use old formats. The compiler must be the ONLY entrypoint. Any `try {} catch { old-parser }` pattern undermines the migration.
**Affected files**: All runtime entrypoints.
**Mitigation**: After Stage C, audit every import of old parser functions. Add lint rules forbidding imports from unsupported modules. Use `@deprecated` with `Error` throw in the old modules.
**Rollback**: Not applicable — single-direction migration.

---

## 13. Recommended Implementation Plan

### Workspace A — Build Compiler Skeleton

**Goal**: File structure, types, diagnostics framework, and public API. No validation logic yet.

**Files**:
- Create `plan-compiler/index.ts` with `compilePlanSpecAlpha2()` stub
- Create `plan-compiler/alpha2/alpha2-types.ts` (copy from current, tighten)
- Create `plan-compiler/alpha2/alpha2-schema.ts` (Zod schemas)
- Create `plan-compiler/diagnostics/diagnostic.ts`, `diagnostic-codes.ts`, `format-diagnostics.ts`
- Create `plan-compiler/compile-alpha2.ts` (orchestrator skeleton)

**Steps**:
1. Define all `PlanDiagnosticCode` enum values
2. Define `PlanDiagnostic` interface and builder functions
3. Copy and tighten `PlanSpecV5Alpha2` types (remove loosened optionals, add `sourcePosition` tracking)
4. Write Zod schemas for every type with `strictObj()`
5. Stub `compilePlanSpecAlpha2()` that returns `{ ok: true, artifact: ... }` for valid input, `{ ok: false, diagnostics: [...] }` for invalid

**Acceptance Criteria**:
- `npm run check` passes
- `compilePlanSpecAlpha2()` returns diagnostics for every invalid input type
- All diagnostic codes are documented

**Validation**: `npm run check && npm test -- --run test/plan-compiler/` (once written)
**Rollback**: Delete `plan-compiler/` directory

---

### Workspace B — Phase Implementation (Parse + Schema + Semantics + Graph + Policy + Emission)

**Goal**: Implement each compiler phase with full validation rules, diagnostics, and emission. Each phase is independently testable.

**Files**:
- `plan-compiler/alpha2/parse-alpha2-json.ts`
- `plan-compiler/validation/validate-alpha2-semantics.ts`
- `plan-compiler/validation/validate-alpha2-graph.ts`
- `plan-compiler/validation/validate-alpha2-security.ts`
- `plan-compiler/validation/validate-alpha2-commands.ts`
- `plan-compiler/emit/emit-compiled-plan.ts`
- `plan-compiler/emit/emit-worker-packets.ts`
- `plan-compiler/emit/emit-plan-lock.ts`

**Steps**:
1. `parse-alpha2-json.ts`: Wrapper around JSON.parse that tracks line/column and produces `E_MALFORMED_JSON`, `E_ROOT_NOT_OBJECT` diagnostics
2. `validate-alpha2-semantics.ts`: Cross-field rules — duplicate IDs, missing fields, invalid values, ref resolution
3. `validate-alpha2-graph.ts`: Wave dependency DFS cycle detection, task dependency DFS cycle detection, topological order validation
4. `validate-alpha2-security.ts`: Self-mod firewall path matching, data exfil guard checks
5. `validate-alpha2-commands.ts`: Command policy level, blocked/allowed command validation, timeout bounds
6. `emit-compiled-plan.ts`: Map validated Alpha2 → `CompiledPlan`, compute execution batches via topological sort
7. `emit-worker-packets.ts`: Flatten tasks into per-workspace packets with frozen command lists
8. `emit-plan-lock.ts`: Deterministic hash over compiled plan fields

**Acceptance Criteria**:
- Each validation phase returns correct diagnostics for known-bad inputs
- Emission produces correct `CompiledPlan` for known-good inputs
- Worker packets match manually verified expectations
- Plan lock is deterministic

**Validation**: `npm test -- --run test/plan-compiler/`
**Rollback**: Revert individual phase files

---

### Workspace C — Test Suite

**Goal**: Full test coverage for all diagnostic codes, all emission paths, and all regression scenarios.

**Files**:
- `test/plan-compiler/compile-alpha2.test.ts`
- `test/plan-compiler/emit-compiled-plan.test.ts`
- `test/plan-compiler/emit-worker-packets.test.ts`
- `test/plan-compiler/emit-plan-lock.test.ts`
- `test/plan-compiler/validate-semantics.test.ts`
- `test/plan-compiler/validate-graph.test.ts`
- `test/plan-compiler/validate-security.test.ts`
- `test/plan-compiler/validate-commands.test.ts`
- `test/plan-compiler/format-diagnostics.test.ts`
- `test/plan-compiler/regression/no-details-available.test.ts`

**Steps**:
1. Create test fixtures for every validation rule
2. Write positive tests (valid minimal, valid realistic)
3. Write negative tests for each diagnostic code
4. Write emission verification tests
5. Write regression test for "no details available"
6. Write determinism test for plan lock hashing

**Acceptance Criteria**:
- Every diagnostic code has at least one positive test and one negative test
- Emission tests verify structural correctness of `CompiledPlan`
- No-details-available regression test proves diagnostics are always present on failure

**Validation**: `npm test -- --run test/plan-compiler/` 100% pass
**Rollback**: Delete test directory

---

### Workspace D — Runtime Switchover

**Goal**: Replace all runtime plan ingestion with `compilePlanSpecAlpha2()`. Keep adapter for `WorkspaceQueue` consumers.

**Files**:
- `web-server/src/index.ts` — replace validate/run parse chains
- `web-server/src/plan-runner.ts` — replace 4-layer chain
- `cli/plan-commands.ts` — replace `loadPlan()` calls
- `core/autonomous-executor.ts` — replace dynamic import
- `core/planlock-admission.ts` — adapt to consume `CompiledPlan` or remove
- `core/planlock-hash.ts` — adapt or remove
- `web-server/src/plan-preview.ts` — add `CompiledPlan` → `WorkspaceQueue` adapter
- `index.ts` — update exports
- `core/model-resolver.ts` — update if it references plan types
- `core/provider-display-names.ts` — update if referenced

**Steps**:
1. Add `compiledPlanToWorkspaceQueue()` adapter to `plan-preview.ts`
2. Replace validate route parse chain with `compilePlanSpecAlpha2()`
3. Replace run route parse chain with `compilePlanSpecAlpha2()`
4. Replace CLI `loadPlan()` with `compilePlanSpecAlpha2()`
5. Replace `autonomous-executor.ts` dynamic import
6. Update public exports in `index.ts`
7. Run full test suite

**Acceptance Criteria**:
- `POST /plans/validate` with valid Alpha2 JSON returns 200 with full response
- `POST /plans/validate` with invalid Alpha2 JSON returns 400 with diagnostics
- `POST /plans/validate` with Markdown returns 400 with `E_LEGACY_MARKDOWN`
- `POST /plans/run` with valid Alpha2 JSON starts execution
- `pi plan doctor` with valid Alpha2 JSON prints success
- `pi plan doctor` with invalid Alpha2 JSON prints diagnostics
- `pi plan doctor` with Markdown prints error
- All existing tests pass (except those explicitly migrated in Stage E)

**Validation**: `npm run check && npm test` (full suite)
**Rollback**: Revert all Stage D changes

---

### Workspace E — Deletion and Cleanup

**Goal**: Remove all dead parser code, update documentation.

**Files**:
- Delete: `core/plan-parser.ts`
- Delete: `core/planspec-v5-parser.ts`
- Delete: `core/planspec-v5-schema.ts`
- Delete: `core/planspec-v5-types.ts`
- Delete: `core/planspec-v5-semantic-validator.ts`
- Delete: `core/planspec-v5-alpha2-parser.ts`
- Delete: `core/planspec-v5-alpha2-types.ts` (content moved to compiler)
- Delete: `web-ui/dashboard/src/utils/planParser.ts`
- Delete: `web-ui/dashboard/src/utils/planValidator.ts`
- Delete: `test/plan-parser.test.ts`, `p31-plan-parser-v4.test.ts`, `v4-template-parser.test.ts`, `planspec-v5-rc1.test.ts`, `planspec-v5-final-gauntlet.test.ts`, `v5-e2e-integration.test.ts`, `v5-real-smoke-gauntlet.test.ts`
- Update: `boundary-imports.test.ts`

**Steps**:
1. Delete legacy parser files
2. Delete RC1 test files
3. Delete frontend parser/validator
4. Update boundary-imports test
5. Update README.md and docs
6. Run full check

**Acceptance Criteria**:
- No imports reference deleted files
- `npm run check` passes
- All runtime paths work with compiler only

**Validation**: `npm run check && npm test`
**Rollback**: `git checkout -- <deleted-files>`

---

## 14. Final Verdict

### Is full rework justified?

**Yes, absolutely.** The current architecture has four parse paths, none of which share code or types. The 4-layer fallback chain in `plan-runner.ts` is the most fragile code in the web-server. The Alpha2 parser exists but is dead code. The frontend has its own independent parser that duplicates logic. The "no details available" problem is a symptom of this fragmentation — when any path fails, the fallback swallows the error.

The cost of maintaining this architecture is higher than the cost of replacing it.

### Should we delete RC1/legacy?

**Yes.** RC1 and Alpha2 serve the same purpose (structured JSON plan compilation). Keeping RC1 creates confusion about which format is canonical. Legacy Markdown parsing was a workaround for the pre-structured era. ACCP 1.2 mandates structured JSON. There is no scenario where a Markdown plan provides information that an Alpha2 JSON plan cannot.

Exception: The `plan-parser.ts` file's `WorkspaceQueue` type and validation logic (particularly `validateWorkspaceQueue()`) will live on in the runtime until the `CompiledPlan` migration is complete. But the parser functions (`parsePlan`, `loadPlan`, `formatParseResult`) should be deleted.

### Can Alpha2 be made canonical safely?

**Yes, with the following conditions:**

1. The current Alpha2 types must be tightened (required fields that are currently optional, `strictObj` Zod schemas).
2. The current Alpha2 parser is too loose — it does not validate nested field types, does not track source positions, and does not produce structured diagnostics. All of these must be added in the new compiler.
3. The Alpha2 task structure (`waves[].tasks[].workspaceId`) must be stable — if it changes, the entire `emit-worker-packets.ts` design changes.
4. A `CompiledPlan` → `WorkspaceQueue` adapter must exist for the duration of Stage C-D migration.

### Minimum safe implementation sequence

```
Stage A → Stage B → Stage C → Stage D → Stage E
```

Each stage is independently testable and reversable. Do not skip stages. Do not combine Stage C and D — the runtime must be running on the compiler for at least one release cycle before deleting old parser code.

If urgency forces compression:
- Merge Stage A+B: compiler skeleton + tests in one go
- Merge Stage D+E: deletion + cleanup in one go
- But NEVER merge Stage C with D or E — the switchover needs isolated validation

### Target score after implementation

**9/10**

Deducted 1 point for:
- The adapter complexity during WorkspaceQueue migration
- The large surface area of runtime files that need updating
- The risk of overlooked Markdown dependencies in edge-case test fixtures

The compiler itself should be 10/10 — single entrypoint, exhaustive diagnostics, no silent fallbacks, every failure produces at least one diagnostic with a code, phase, message, and path.

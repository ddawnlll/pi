# P45 — Predictive Spec Planning & Namespace Async Assembly Runtime

**Template:** Pi LLM Implementation Agent Master Template v4.1.1  
**Phase:** P45  
**Version:** FINAL_GODMODE_v3  
**Status:** Planned; hold until P44 green  
**Last Updated:** 2026-06-04  
**Selected Mode:** stable_6_candidate_async_assembly  
**Target Promotion Mode:** stable_6_candidate  
**Requested Max Workers:** 6  
**20-Worker Mode:** hard-blocked until load profile passes  
**Verified Completion Spine Required:** P44 must pass  
**Patch Transaction:** required  
**Patch Apply Lanes:** 1 initially; profile before change  
**Repository Mutation Authority:** Deterministic Assembler / PatchCoordinator  
**Primary Slogan:** No dependency waits without proof.  
**Secondary Slogan:** Workers depend on frozen specs, not on each other.  

---

## 0. Executive Summary

P45 solves the parallelism problem.

Current plans often create dependency chains:

```txt
A creates X
B uses X
therefore B waits for A
```

P45 changes the plan model:

```txt
PredictiveSpec defines X upfront
A implements X
B consumes X
A and B run in parallel
Assembler integrates both after artifact validation
```

This converts deep dependency DAGs into a four-barrier execution model:

```txt
Spec Freeze
  -> Parallel Namespace Work
  -> Deterministic Assembly
  -> Validation / Replay
```

P45 depends on P44 because async assembly must consume only verified artifacts.

---

## 1. What P45 Does Not Claim

```txt
P45 does not claim 20-worker production safety.
P45 does not remove all semantic conflicts.
P45 does not let workers edit shared integration files.
P45 does not treat LLM spec guesses as truth.
P45 does not bypass P44 CompletionGate.
P45 does not make patchApplyLanes=1 magically scalable.
```

20-worker mode is a future gate, not a P45 promotion.

---

## 2. Core Doctrine

```txt
D001 Dependency wait is a planning smell unless proven necessary.
D002 Workers depend on frozen specs, not on each other.
D003 StaticPartitioner assigns disjoint write namespaces.
D004 Workers cannot edit shared integration files.
D005 Workers output patch/artifact manifests.
D006 Assembler is the only writer of shared integration files.
D007 Assembler output must be deterministic and byte-stable.
D008 Assembler writes must be atomic and rollback-safe.
D009 Spec drift must be detected before integration acceptance.
D010 Spec drift invalidates only affected artifacts unless cascade threshold is exceeded.
D011 Targeted replay must preserve unaffected namespaces.
D012 Verified Completion Spine is required before artifact acceptance.
D013 Final integration validation is mandatory.
D014 20-worker mode is hard-blocked until load profile passes.
```

---

## 3. End-to-End Runtime Flow

```txt
1. Plan Intake
2. Baseline DAG measurement
3. Predictive fact collection
4. LLM architect JSON proposal
5. Predictive spec validation
6. Contract freeze
7. Static namespace partition
8. StrictObservation dependency optimization
9. Async namespace worker execution
10. P44 verified completion gate
11. Artifact manifest acceptance
12. Deterministic assembly
13. Spec drift detection
14. Targeted replay or cascade replan
15. Final integration validation
16. Promotion / handoff
```

---

## 4. Predictive Spec Generation

### 4.1 Inputs

```ts
export interface PredictiveSpecInput {
  planPath: string;
  repoRoot: string;
  targetPhase: string;
  workspaceSummaries: WorkspaceIntent[];
  existingRoutes: RouteFact[];
  existingExports: ExportFact[];
  existingTypes: TypeFact[];
  existingApiShapes: ApiShapeFact[];
  docs: string[];
  humanConstraints: string[];
}
```

### 4.2 Fact Collection

Implement:

```txt
scripts/collect-predictive-spec-facts.ts
```

Command:

```bash
npx tsx scripts/collect-predictive-spec-facts.ts \
  --plan docs/pi/p42/P42_Dashboard_V3_Execution_Cockpit_Plan_v4_1_1.md \
  --output reports/p45-spec/facts.json
```

Required output:

```json
{
  "routes": [],
  "exports": [],
  "types": [],
  "apiShapes": [],
  "files": [],
  "workspaceIntents": [],
  "factsHash": "sha256..."
}
```

Pass condition:

```txt
facts.json exists
factsHash exists
routes/types/exports/apiShapes arrays exist
script exits 0
```

### 4.3 LLM Architect Proposal

The LLM receives only:

```txt
facts.json
plan workspaces
allowed architecture rules
forbidden assumptions
output JSON schema
```

The LLM outputs:

```txt
predictive-spec.proposed.json
```

Markdown is not authoritative.

### 4.4 PredictiveSpec Schema

```ts
export interface PredictiveSpec {
  specVersion: string;
  specHash: string;
  compatibility: {
    major: number;
    minor: number;
    patch: number;
    breakingChangePolicy: "replan" | "targeted_replay_allowed";
  };
  routes: Record<string, RouteContract>;
  slots: Record<string, SlotContract>;
  exports: Record<string, ExportContract>;
  types: Record<string, TypeContract>;
  apiShapes: Record<string, ApiShapeContract>;
  controlActions: Record<string, ControlActionContract>;
  assemblerOnlyFiles: string[];
  workerReadonlyFiles: string[];
  validationExpectations: ValidationExpectation[];
}
```

### 4.5 Spec Validation

Validator checks:

```txt
all required slots have producers
all required types are defined
all assembler-only files are listed
all worker-owned namespaces are disjoint
all required contracts have confidence >= 0.75
low-confidence required contracts block execution
specVersion exists
compatibility policy exists
```

### 4.6 Contract Freeze

Freeze output:

```json
{
  "specVersion": "p45.p42.v1",
  "specHash": "sha256...",
  "frozenAt": "timestamp",
  "contracts": {},
  "assemblerOnlyFiles": [],
  "workerReadonlyFiles": []
}
```

Workers may read frozen spec but cannot modify it.

---

## 5. StaticPartitioner Algorithm

### 5.1 Inputs

```ts
export interface StaticPartitionInput {
  frozenSpec: PredictiveSpec;
  workspaceIntents: WorkspaceIntent[];
  repoFileIndex: RepoFileIndex;
  namespaceTemplates: NamespaceTemplate[];
  assemblerOnlyFiles: string[];
}
```

### 5.2 Algorithm

```txt
1. Initialize empty ownership map.
2. Mark assemblerOnlyFiles as reserved.
3. For each workspace intent:
   a. Determine namespaceId from workspace domain.
   b. Assign generated/new files under namespace prefix.
   c. Assign tests under matching namespace test prefix.
   d. Assign owned hooks under namespace hook prefix.
4. Expand all globs to concrete planned paths where possible.
5. For each candidate owned path:
   a. if path is assembler-only -> reject.
   b. if path already owned by another namespace -> conflict.
   c. otherwise assign owner.
6. Convert shared integration needs into assembler slots, not worker edits.
7. Compute partition cost:
   a. file count
   b. expected LOC
   c. contract dependency count
   d. replay blast radius
8. If a namespace is too large or too coupled -> partition warning.
9. Emit OwnershipManifest.
```

### 5.3 Tie-Breaking

```txt
shared integration file -> assembler owns it
splittable shared file -> split into namespace file
same symbol wanted by two workspaces -> contract conflict
unresolved tie -> partition_conflict hard stop
```

### 5.4 OwnershipManifest

```ts
export interface OwnershipManifest {
  manifestVersion: string;
  specHash: string;
  namespaces: Array<{
    namespaceId: string;
    workspaceId: string;
    owns: string[];
    mayRead: string[];
    forbiddenEdit: string[];
    producesSlots: string[];
    consumesContracts: string[];
    expectedExports: string[];
    cost: {
      plannedFileCount: number;
      estimatedLoc: number;
      dependencyCount: number;
      replayBlastRadius: number;
    };
  }>;
  assemblerOnlyFiles: string[];
  conflicts: PartitionConflict[];
}
```

---

## 6. StrictObservation Validator

Dependency removal requires strict proof.

```ts
export type StrictObservationType =
  | "file_content_analysis"
  | "type_graph_trace"
  | "import_chain_proof"
  | "route_contract_proof"
  | "namespace_ownership_proof"
  | "human_approved_contract";

export interface StrictObservation {
  id: string;
  dependencyId: string;
  observationType: StrictObservationType;
  claim: string;
  evidence: {
    files: string[];
    excerpts?: Array<{
      file: string;
      startLine: number;
      endLine: number;
      textHash: string;
    }>;
    typeGraphHash?: string;
    routeGraphHash?: string;
    ownershipManifestHash?: string;
    command?: string;
    commandExitCode?: number;
  };
  decision: "remove_dependency" | "keep_dependency" | "replace_with_contract";
  authorizedBy: "verified_tool_output" | "human" | "static_analyzer";
}
```

Reject if:

```txt
evidence.files is empty
observationType is unknown
observationType is llm_claim or assumption
decision removes dependency without dependencyId
command evidence has non-zero exit
claim references a file not in evidence.files
```

---

## 7. Artifact Acceptance

P45 consumes P44.

An artifact is accepted only when:

```txt
P44 WorkerCompletionReport exists
EvidenceLedger exists
CompletionGate v2 gateVerdict=accepted
ArtifactManifest exists
Namespace ownership passes
Spec conformance passes
```

Artifact manifest:

```ts
export interface AsyncAssemblyArtifactManifest {
  workspaceId: string;
  namespaceId: string;
  attemptId: string;
  specHash: string;
  ownershipManifestHash: string;
  ownedFiles: string[];
  writeSet: string[];
  exports: Array<{
    symbol: string;
    from: string;
  }>;
  slots: Array<{
    slot: string;
    component: string;
  }>;
  contractsUsed: string[];
  evidenceLedgerPath: string;
  patchArtifactId: string;
}
```

---

## 8. Deterministic Assembler

### 8.1 Inputs

```ts
export interface AssemblyInput {
  assemblyRunId: string;
  frozenSpec: PredictiveSpec;
  ownershipManifest: OwnershipManifest;
  artifactManifests: AsyncAssemblyArtifactManifest[];
  targetRepoRoot: string;
}
```

### 8.2 Deterministic Sorting

```txt
sort manifests by namespaceId then workspaceId
sort slots alphabetically
sort imports by source path then symbol name
sort exports by symbol name
sort JSON keys before serialization
do not use filesystem enumeration order
do not use Date.now/random in generated code
```

### 8.3 Atomic Write Procedure

```txt
1. compute all outputs in memory
2. validate all outputs
3. record beforeHash for every target shared file
4. write temp files under .pi/assembly-tmp/<assemblyRunId>/
5. fsync temp files where supported
6. rename temp files into target paths
7. verify afterHash
8. emit ASSEMBLY_COMMITTED
```

### 8.4 Rollback Procedure

On failure after beforeHash recording:

```txt
1. emit ASSEMBLY_ROLLBACK_STARTED
2. restore every target shared file to beforeHash content
3. remove temp files
4. verify current hashes equal beforeHash
5. emit ASSEMBLY_ROLLED_BACK
6. block plan with exact reason
```

### 8.5 Crash Recovery

On restart:

```txt
1. query PostgreSQL for ASSEMBLY_STARTED without COMMITTED/ROLLED_BACK
2. load journal file records
3. compute current hash of every target
4. if all current hashes == beforeHash -> mark rolled back/noop
5. if all current hashes == afterHash -> mark committed idempotently
6. if mixed hashes -> restore beforeHash for all targets
7. if restore fails -> HANDOFF_REQUIRED with recovery bundle
8. remove orphan temp files after journal resolution
```

### 8.6 Journal Events

```txt
ASSEMBLY_PREPARED
ASSEMBLY_STARTED
ASSEMBLY_FILE_PREPARED
ASSEMBLY_FILE_RENAMED
ASSEMBLY_COMMITTED
ASSEMBLY_ROLLBACK_STARTED
ASSEMBLY_ROLLED_BACK
ASSEMBLY_RECOVERY_REQUIRED
```

---

## 9. Spec Drift Detector

### 9.1 When It Runs

```txt
after worker artifact generation
before artifact acceptance
before assembly
after targeted replay
```

### 9.2 Inputs

```txt
frozen spec
artifact manifest
actual exported symbols
actual TypeScript declaration snapshot
slot registry request
API/read-model usage
```

### 9.3 Drift Classes

```txt
compatible:
  optional additive field
  extra unused export
  component prop with default
  type widening that preserves consumers

breaking:
  required prop renamed
  required field removed
  export renamed
  route path changed
  slot name changed
  type narrowed incompatibly
```

Breaking drift triggers targeted replay or cascade replan.

---

## 10. Targeted Replay and Cascade Breaker

### 10.1 Replay Algorithm

```txt
1. Identify drift source namespace.
2. Build contract dependency graph from frozen spec.
3. Add direct consumers of changed contract.
4. Add assembler slot if slot affected.
5. Do not include unrelated namespaces.
6. If cascade threshold exceeded -> stop and require replan.
```

### 10.2 Cascade Thresholds

```txt
affectedNamespacesPercent > 40%
affectedNamespacesCount > 6
same namespace replayed more than 2 times
contract major version changed
assembler fails same slot twice
```

---

## 11. Minimal E2E Smoke Harness

Implement:

```txt
scripts/run-p45-minimal-async-assembly-smoke.ts
test/assembly/fixtures/minimal-two-namespace-plan.json
```

Fixture:

```txt
namespace alpha:
  owns components/alpha/**
  exports AlphaPanel
  slot demo.alpha

namespace beta:
  owns components/beta/**
  exports BetaPanel
  slot demo.beta

assembler-only:
  App.tsx
  routes.tsx
  demoSlots.ts
```

Command:

```bash
npx tsx scripts/run-p45-minimal-async-assembly-smoke.ts --output reports/p45-smoke/minimal.json
```

Expected JSON:

```json
{
  "contractFrozen": true,
  "namespaceConflicts": 0,
  "artifactsAccepted": 2,
  "assemblyCommitted": true,
  "deterministic": true,
  "finalValidationExitCode": 0
}
```

---

## 12. P42 Replan Experiment

Command:

```bash
npx tsx scripts/run-p45-p42-replan-experiment.ts \
  --input docs/pi/p42/P42_Dashboard_V3_Execution_Cockpit_Plan_v4_1_1.md \
  --output reports/p45-async-assembly/p42-replan/result.json
```

Required fields:

```txt
originalMaxDagDepth
optimizedMaxDagDepth
originalAvgRunnableWorkers
optimizedAvgRunnableWorkers
expectedRunnableWorkers
namespaceConflicts
removedDependencyCount
strictObservationCount
semanticRiskCount
```

Pass conditions:

```bash
node scripts/assert-min-parallelism.ts --input reports/p45-async-assembly/p42-replan/result.json --min 4
node -e "const r=require('./reports/p45-async-assembly/p42-replan/result.json'); if (r.namespaceConflicts !== 0) process.exit(1)"
node -e "const r=require('./reports/p45-async-assembly/p42-replan/result.json'); if (r.removedDependencyCount > r.strictObservationCount) process.exit(1)"
```

---

## 13. 20-Workspace Mode Is Blocked

Hard rule:

```txt
20-worker mode is BLOCKED until load profile proves safety.
```

Load command:

```bash
npx tsx scripts/run-p45-load-profile.ts --namespaces 20 --output reports/p45-async-assembly/load-profile
```

Required outputs:

```txt
postgres-journal.json
patch-apply-lane.json
assembler-fan-in.json
cascade-worst-case.json
```

Required fields:

```txt
p95WriteMs
p99WriteMs
patchApplyQueueP95WaitMs
assemblerP95Ms
worstCaseReplayPercent
recommendation: hold | keep_6 | experiment_2_lanes | promote_20_candidate
```

Even if this passes, P45 may only recommend a later phase for >6 workers.

---

## 14. Workspaces

```txt
P45.00 Mechanized Baseline Parallelism Audit
P45.01 Predictive Spec Generation and Contract Freeze Protocol
P45.02 Static Namespace Partitioner and Partition Cost Model
P45.03 StrictObservation Validator and Dependency Elimination Optimizer
P45.04 Artifact Manifest Protocol
P45.05 Namespace Worker Enforcement and PatchArtifact Adapter
P45.06 Deterministic Assembler with Atomic Rollback and Idempotency
P45.07 Spec Versioning and Drift Detector
P45.08 Targeted Replay with Cascade Breaker
P45.09 Minimal E2E Smoke Harness
P45.10 P42 Replan Experiment
P45.11 PostgreSQL Journal and Patch Apply Lane Load Profile
P45.12 Strict E2E Async Assembly Gauntlet and Monte Carlo
P45.13 Dashboard / Doctor / Operator Visibility
P45.14 Master Template Update and Async Assembly Plan Intake
P45.15 Promotion Report and stable_6 Candidate Decision
```

---

## 15. Acceptance Gates by Workspace

### P45.00 — Mechanized Baseline Parallelism Audit

```bash
npx tsx scripts/measure-dag-parallelism.ts --phase P42 --output reports/p45-baseline/dag-audit.json
node -e "const r=require('./reports/p45-baseline/dag-audit.json'); if (![r.avgRunnableWorkers,r.maxDagDepth,r.totalEdges,r.removableEdgeCount].every(Number.isFinite)) process.exit(1)"
```

### P45.01 — Predictive Spec

```bash
npx vitest --run packages/coding-agent/test/assembly/predictive-spec.test.ts
```

Required tests:

```txt
validates p42 fixture
rejects frozen contract mutation
requires spec versioning
rejects low-confidence required contract
```

### P45.02 — StaticPartitioner

```bash
npx vitest --run packages/coding-agent/test/assembly/static-partitioner.test.ts
```

Required tests:

```txt
creates disjoint ownership
rejects overlap
marks assembler-only files
splits shared integration into slots
reports partition cost
rejects unresolved tie
```

### P45.03 — StrictObservation

```bash
npx vitest --run packages/coding-agent/test/assembly/strict-observation-validator.test.ts
```

Required tests:

```txt
rejects empty evidence
rejects llm claim
requires dependency id for removal
accepts type graph proof
accepts human approved contract
optimizer cannot remove edge without strict observation
```

### P45.06 — Assembler

```bash
npx vitest --run packages/coding-agent/test/assembly/deterministic-assembler.test.ts
```

Required tests:

```txt
monte carlo deterministic output
rejects missing export
rejects invalid slot
rollback after injected failure
recovers mixed hash crash state
idempotent rerun
```

### P45.07 — Spec Drift

```bash
npx vitest --run packages/coding-agent/test/assembly/spec-drift-detector.test.ts
```

Required tests:

```txt
detects missing export
detects renamed export
detects required prop change
classifies optional additive field as compatible
reports affected slots and namespaces
```

### P45.08 — Targeted Replay

```bash
npx vitest --run packages/coding-agent/test/assembly/targeted-replay.test.ts
```

Required tests:

```txt
direct dependents only
preserves unaffected namespaces
cascade breaker by percent
cascade breaker by count
major contract version triggers replan
```

---

## 16. Async Assembly Gauntlet

Scenarios:

```txt
G-AA-01 two namespace smoke succeeds
G-AA-02 six independent namespaces assemble
G-AA-03 worker writes assembler-only file -> reject
G-AA-04 two workers overlap namespace -> reject
G-AA-05 missing export -> reject
G-AA-06 invalid slot -> reject
G-AA-07 signature drift -> targeted replay
G-AA-08 stale patch artifact -> reject
G-AA-09 order randomization -> deterministic output
G-AA-10 validation failure -> namespace repair
G-AA-11 fake complete blocked by P44 gate
G-AA-12 P42-like plan optimizes to high parallelism
G-AA-13 assembler crash mid-write -> rollback clean
G-AA-14 cascade threshold exceeded -> replan required
G-AA-15 PostgreSQL mixed-state recovery -> rollback or commit idempotently
```

Commands:

```bash
node scripts/run-execution-stability-gauntlet.ts --scenario async-assembly --list
node scripts/run-execution-stability-gauntlet.ts --scenario async-assembly --output reports/p45-async-assembly/gauntlet.json
node scripts/run-execution-stability-gauntlet.ts --scenario async-assembly --monte-carlo 100 --assert-deterministic --output reports/p45-async-assembly/monte-carlo.json
```

Pass conditions:

```txt
list includes G-AA-01..G-AA-15
gauntlet JSON has failedScenarios: 0
monte-carlo JSON has totalRuns: 100 and matchRate: 1.0
```

No `|| true`.

---

## 17. Final Validation

```bash
make test
make test-full
npx tsx scripts/run-p45-minimal-async-assembly-smoke.ts --output reports/p45-smoke/minimal.json
node scripts/run-execution-stability-gauntlet.ts --scenario async-assembly --monte-carlo 100 --assert-deterministic --output reports/p45-async-assembly/monte-carlo.json
npx tsx scripts/run-p45-load-profile.ts --namespaces 20 --output reports/p45-async-assembly/load-profile
```

---

## 18. Definition of Done

```txt
[ ] P44 is green.
[ ] Predictive spec generation is mechanized.
[ ] StaticPartitioner implemented.
[ ] StrictObservation validator implemented.
[ ] Artifact acceptance requires P44 gate.
[ ] Assembler deterministic output proven over 100 randomized orders.
[ ] Assembler rollback/recovery proven.
[ ] Spec drift detector implemented.
[ ] Targeted replay implemented.
[ ] Cascade breaker implemented.
[ ] Minimal smoke passes.
[ ] P42 replan experiment shows expectedRunnableWorkers >= 4.
[ ] 20-namespace load profile exists and does not promote 20 workers prematurely.
[ ] Async assembly gauntlet passes.
[ ] make test passes.
[ ] make test-full passes.
```

---

## 19. Machine-Readable Contract

```json
{
  "phase": "P45",
  "title": "Predictive Spec Planning & Namespace Async Assembly Runtime",
  "version": "FINAL_GODMODE_v3",
  "selectedMode": "stable_6_candidate_async_assembly",
  "targetPromotionMode": "stable_6_candidate",
  "maxParallelWorkers": 6,
  "hardBlockedUntil": [
    "P44 green"
  ],
  "coreDoctrine": [
    "Dependency wait is a planning smell unless proven necessary.",
    "Workers depend on frozen specs, not on each other.",
    "StaticPartitioner assigns disjoint write namespaces.",
    "Only the Assembler writes shared integration files.",
    "Assembler writes are deterministic, rollback-safe, and idempotent.",
    "Spec drift triggers targeted replay or cascade replan.",
    "20-worker mode is blocked until load profile passes."
  ],
  "mustPass": [
    "make test",
    "make test-full",
    "minimal two-namespace smoke",
    "async assembly gauntlet",
    "100-run deterministic Monte Carlo",
    "P42 replan experiment",
    "20-namespace load profile report"
  ],
  "forbidden": [
    "worker edits assembler-only file",
    "dependency removal without StrictObservation",
    "assembler partial write without rollback",
    "spec drift accepted silently",
    "targeted replay touches unaffected namespaces",
    "20-worker promotion claim without load profile"
  ]
}
```

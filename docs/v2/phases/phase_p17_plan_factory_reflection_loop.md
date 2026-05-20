# Phase P17 — Plan Factory & Reflection Loop

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P17`  
**One-line goal:** Convert approved proposals into executable implementation plans using the v2.5.1 master template, then generate source-backed reflections after every execution run to create lasting knowledge.  
**Why now:** P16 generates proposals, but proposals alone don't achieve anything — they need to become plans. And after execution, Pi must learn from what happened. P17 closes both gaps. This is Milestone 2b — "Pi Plans & Reflects".  
**Blast radius:** Plan generation, master template integration, reflection engine, memory update proposals, future suggestions; `packages/coding-agent/src/brain/plan-factory/`, `packages/coding-agent/src/brain/reflection/`, `packages/web-server`, `packages/web-ui/dashboard`.  
**Rollback path:** Disable via `PLAN_FACTORY_ENABLED=false`, `REFLECTION_ENABLED=false`.  
**Scale mode:** `stable_3`
**Safe parallelism target:** 3  
**Done when:** Plans generated from proposals, master template v2.5.1 used correctly, reflections generated after execution, memory proposals created from reflections, API endpoints functional, dashboard shows reflections, integration queue clean.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P17` |
| Title | `Plan Factory & Reflection Loop` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Plan generation, reflection, memory updates, future suggestions` |
| Product-code changes | `Allowed — Pi runtime/dashboard/tests/docs only` |
| Selected scale mode | `stable_3` |
| Requested max workers | `3` |
| Expected DAG effective parallelism | `3` |
| Expected safe effective parallelism | `3` |
| Worktree isolation | `Optional` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| P17.A — Plan Factory Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P17.B — Master Template Integration | Pi Worker Agent | User / owner | Reviewer | User |
| P17.C — Reflection Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P17.D — Source-Backed Summarizer | Pi Worker Agent | User / owner | Reviewer | User |
| P17.E — Memory Update Proposal Generator | Pi Worker Agent | User / owner | Reviewer | User |
| P17.F — Future Phase Suggestion Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P17.G — Reflection API | Pi Worker Agent | User / owner | Reviewer | User |
| P17.H — Reflection Viewer UI | Pi Worker Agent | User / owner | Reviewer | User |
| P17.I — P17 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Close the V2 cognitive loop completely: **proposals become executable plans**, and **execution results become lasting knowledge through reflection**. 

P17 connects P16 (proposals) → execution (P12.5 core) → learning (P14 memory, P16 proposals). Without P17, the loop is incomplete.

### 2.1 Plan Factory Component

**Input:** `Proposal` (approved, from P16)  
**Output:** Phase markdown file (`docs/pi/phases/phase_pXX_*.md`) + JSON execution contract

The Plan Factory:
1. Analyzes the proposal type, evidence, and scope
2. Generates workstream definitions based on proposal scope
3. Creates a dependency graph with batch layout
4. Populates every section of the master template v2.5.1
5. Writes the phase markdown file to `docs/pi/phases/`
6. Generates and writes the JSON execution contract
7. Validates both outputs for correctness

### 2.2 Reflection Engine Component

**Input:** `ReflectionInput` (execution results from plan runner)  
**Output:** `ReflectionReport` + memory update proposals + future suggestions

The Reflection Engine:
1. Analyzes what ran, what worked, what failed, what slowed down
2. Computes metrics: success rate, retry count, duration, validation failures
3. Generates source-backed summaries (every claim must reference evidence from execution journal, workspace outcomes, validation results)
4. Creates memory update proposals from failures and successes
5. Generates future phase suggestions based on identified bottlenecks
6. Stores all output artifacts to `.pi/brain/reflections/{planExecId}/`

### 2.3 What P17 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Plan Factory Engine | `src/brain/plan-factory/engine.ts` | Converts proposals to phase plans |
| Master Template Integration | `src/brain/plan-factory/template.ts` | Loads/populates master template v2.5.1 |
| Reflection Engine | `src/brain/reflection/engine.ts` | Generates post-execution reflections |
| Source-Backed Summarizer | `src/brain/reflection/summarizer.ts` | Evidence-only summary generation |
| Memory Proposal Generator | `src/brain/reflection/memory-proposals.ts` | Creates memory updates from reflections |
| Future Suggestion Engine | `src/brain/reflection/future-suggestions.ts` | Generates next-phase suggestions |
| Reflection API | `/api/brain/reflections/*` | REST API for reflections |
| Reflection Viewer UI | Dashboard component | Display reflections with evidence |

### 2.4 Output Artifacts

```
.pi/brain/reflections/{planExecId}/
├── reflection-summary.md                 # Human-readable markdown
├── reflection-summary.json               # Machine-readable JSON
├── memory-proposals.json                 # Proposed memory updates
└── future-suggestions.json               # Suggested next phases
```

---

## 3. What Carried Over — Must Stay Stable

* [x] P16 proposals and scoring — proposals are the input to plan factory
* [x] P15 goals for alignment — plans must reference goals
* [x] P14 memory for evidence reference — reflections link to memories
* [x] P13 brain observations — reflections use observations as evidence
* [x] P12.5 plan queue — generated plans must be queueable
* [x] Integration queue gate — plans must respect dirty gate
* [x] No git push, no destructive cleanup, no watch-mode validation
* [x] LLM cannot mutate state directly
* [x] npm only

* [ ] Worktree isolation remains available when requested by scale mode.
* [ ] Integration queue remains enabled when required by scale mode.
* [ ] Global validation lock remains active for heavy validation.
* [ ] Completion gate hardening remains active.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] The executor remains the source of truth for state transitions.
### 3.1 New V2 Constraints Added

* [ ] Every generated plan must pass validation before queuing
* [ ] Every reflection claim must reference evidence sources
* [ ] LLM content in plans must be validated for structure, not hallucination
* [ ] Memory from reflection must start as `candidate` (P14 lifecycle)

---

## 4. Background / What Was Wrong

Pi V1 could execute plans that humans wrote, but it could not:
1. **Generate plans itself** — proposals from P16 were dead ends without plan generation
2. **Learn from execution** — every plan was a fresh start, no cumulative learning

### 4.1 V1 Limitations Addressed

| V1 Limitation | P17 Solution |
|---------------|--------------|
| No auto-planning | PlanFactory converts proposals to phase markdown |
| No learning loop | ReflectionEngine analyzes what worked/failed |
| No memory from execution | MemoryProposalGenerator creates memory updates |
| No improvement suggestions | FutureSuggestionEngine identifies next steps |
| No post-run analysis | Reflection artifacts stored and queryable |

### 4.2 Example: Full Loop

```
P16 Proposal: "Add retry budget to plan splitting"
  ↓
P17 PlanFactory: creates `phase_p21_retry_budget.md` + JSON contract
  ↓
P12.5 Executor: runs the plan
  ↓
P17 ReflectionEngine:
  - whatRan: ["workspace A split plan runner", "workspace B added budget check"]
  - whatWorked: ["budget check caught 2/3 retries"]
  - whatFailed: ["split runner had off-by-one error"]
  - memory proposals: ["remember: retry budget pattern", "remember: split runner off-by-one fix"]
  - future suggestions: ["P22: universal retry budget", "P23: split runner v2"]
```

---

## 5. Current Failure State / Known Blockers

* `p17_plan_factory_engine` = not implemented
* `p17_master_template_integration` = not implemented
* `p17_reflection_engine` = not implemented
* `p17_source_backed_summarizer` = not implemented
* `p17_memory_proposal_generator` = not implemented
* `p17_future_suggestion_engine` = not implemented
* `p17_reflection_api` = not implemented
* `p17_reflection_ui` = not implemented
* `worktree_isolation` = optional for this phase
* `integration_queue` = enabled and required
* `scale_mode_readiness` = experimental_6 ready
* `safe_effective_parallelism` = expected 3

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| Plan factory generates invalid plan format | med | high | Validation step after generation; contract schema checks |
| LLM hallucination in plan workstreams | med | med | Use proposal evidence as constraints; validate workstream count |
| Reflection hallucination (claims without evidence) | med | critical | Source-backed summarizer rejects un-evidenced claims |
| Reflection not triggered | low | high | Hook into plan completion event; fallback on startup |
| Memory proposals create noise | med | low | Start as candidate; scoring filters low confidence |
| Future suggestions irrelevant | med | low | Rank by goal alignment; limit to top 3 |
| Plan factory produces unmergeable markdown | low | med | Rendered template validated against required sections |
| Reflection store corrupts | low | med | Atomic writes per artifact file |

---

## 7. Workstreams

### 7.A — Plan Factory Engine

**Goal:** Convert approved proposals into executable phase plans with workstreams, dependencies, and batch layout.

**Requirements:**
* Analyze proposal type, evidence, risk to determine phase scope
* Generate N workstreams proportional to proposal complexity
* Create dependency graph between workstreams
* Assign queue priorities based on critical path analysis
* Generate batch layout for non-overlapping workstreams
* Validate generated plan against schema

**Acceptance Criteria:**
* [ ] Creates phase markdown file from proposal input
* [ ] Generates JSON execution contract matching v2.5.1 schema
* [ ] Workstreams generated based on proposal scope
* [ ] Dependencies correctly computed (no cycles)
* [ ] Batches layout non-overlapping workstreams
* [ ] Validates output before returning
* [ ] Test: proposal → plan → validate → output

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/plan-factory/engine.ts

export interface PlanFactoryConfig {
  outputDir: string;                       // docs/pi/phases/
  contractDir: string;                     // .pi/plans/generated/
  maxWorkstreams: number;                  // default 8
  templateVersion: string;                 // default "2.5.1"
  validateBeforeReturn: boolean;           // default true
  enableLLMContent: boolean;               // default true
}

export interface PlanFactoryInput {
  proposalId: string;
  goalId?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  masterTemplateVersion?: string;
  userNotes?: string;                      // optional user overrides
}

export interface PlanFactoryOutput {
  phaseId: string;                         // e.g., "P21"
  phaseTitle: string;
  markdownPath: string;                    // full path to .md
  jsonContract: PlanExecutionContract;
  workstreams: WorkstreamDef[];
  batches: string[][];                     // workstream ID arrays
  generatedAt: string;
  confidence: number;                      // 0-1, based on evidence completeness
  validationResults: ValidationResult[];
}

export interface PlanExecutionContract {
  contractVersion: string;                 // "2.5.1"
  phase: { id: string; title: string };
  workstreams: WorkstreamDef[];
  dependencies: Array<{ from: string; to: string; type: 'blocking' | 'informational' }>;
  batches: string[][];
  scaleMode: string;
  integrationQueue: boolean;
  worktreeIsolation: boolean;
  metadata: Record<string, unknown>;
}

export interface WorkstreamDef {
  id: string;                              // e.g., "P21.A"
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  dependencies: string[];                  // workstream IDs this depends on
  fileScope: string[];                     // glob patterns
  isolationNotes: string;
  queuePriority: 'critical' | 'high' | 'normal' | 'low';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ValidationResult {
  type: 'error' | 'warning' | 'info';
  component: 'markdown' | 'contract' | 'workstream' | 'dependency';
  message: string;
  details?: Record<string, unknown>;
}

export class PlanFactory {
  private config: PlanFactoryConfig;
  private templateIntegration: MasterTemplateIntegration;
  
  constructor(
    templateIntegration: MasterTemplateIntegration,
    config?: Partial<PlanFactoryConfig>,
  );
  
  // Core
  async createPlan(input: PlanFactoryInput): Promise<PlanFactoryOutput>;
  
  // Proposal analysis
  private async analyzeProposal(
    proposal: Proposal,
  ): Promise<{
    scope: string;
    estimatedWorkstreams: number;
    affectedSystems: string[];
    risk: RiskLevel;
    evidenceQuality: number;
  }>;
  
  // Workstream generation
  private generateWorkstreams(
    analysis: Awaited<ReturnType<PlanFactory['analyzeProposal']>>,
    proposal: Proposal,
  ): WorkstreamDef[];
  
  private generateWorkstreamId(
    phaseId: string,
    index: number,
  ): string;
  
  private generateDependencies(
    workstreams: WorkstreamDef[],
  ): Array<{ from: string; to: string; type: 'blocking' | 'informational' }>;
  
  private generateBatches(
    workstreams: WorkstreamDef[],
    dependencies: Array<{ from: string; to: string; type: 'blocking' | 'informational' }>,
  ): string[][];
  
  // Phase naming
  private computePhaseId(): Promise<string>;  // scans existing phases for next available
  private computePhaseTitle(proposal: Proposal): string;
  
  // Template population
  private populateTemplate(
    template: string,
    data: TemplateData,
  ): string;
  
  // JSON contract
  private buildJsonContract(
    phase: {
      id: string;
      title: string;
      workstreams: WorkstreamDef[];
      dependencies: Array<{ from: string; to: string; type: 'blocking' | 'informational' }>;
      batches: string[][];
    },
  ): PlanExecutionContract;
  
  // I/O
  async resolveOutputPaths(
    phaseId: string,
    phaseTitle: string,
  ): Promise<{ markdownPath: string; contractPath: string }>;
  
  async writeMarkdown(path: string, content: string): Promise<void>;
  async writeContract(path: string, contract: PlanExecutionContract): Promise<void>;
  
  // Validation
  async validatePlan(output: PlanFactoryOutput): Promise<ValidationResult[]>;
  private validateMarkdown(path: string): ValidationResult[];
  private validateContract(contract: PlanExecutionContract): ValidationResult[];
  private validateDependencies(workstreams: WorkstreamDef[], dependencies: unknown[]): ValidationResult[];
  
  // Configuration
  setConfig(config: Partial<PlanFactoryConfig>): void;
  getConfig(): PlanFactoryConfig;
}

// File structure:
export const PLAN_FACTORY_FILES = [
  'packages/coding-agent/src/brain/plan-factory/engine.ts',
  'packages/coding-agent/src/brain/plan-factory/types.ts',
  'packages/coding-agent/src/brain/plan-factory/index.ts',
  'packages/coding-agent/test/brain/plan-factory/engine.test.ts',
  'packages/coding-agent/test/fixtures/plan-factory/valid-proposal.json',
  'packages/coding-agent/test/fixtures/plan-factory/expected-output.md',
];
```

**File Scope:** P17.A file set as listed above.

**Dependencies:** P16.A (Proposal type), P17.B (MasterTemplateIntegration)

---

### 7.B — Master Template Integration

**Goal:** Load, parse, populate, and validate the master template v2.5.1 for plan generation.

**Requirements:**
* Load master template from `docs/llm-implementation-agent-master-template.md`
* Parse into segments (Part 1, Part 2, segments within)
* Each segment has a template string with `{{ ... }}` placeholders
* Populate segments with phase-specific data
* Generate PlanExecutionContract from populated segments
* Validate populated output against required sections

**Acceptance Criteria:**
* [ ] Loads and parses v2.5.1 template correctly
* [ ] Identifies all required segments
* [ ] Populates all `{{ ... }}` placeholders
* [ ] Generates valid JSON contract
* [ ] Validates populated output completeness
* [ ] Handles missing template gracefully

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/plan-factory/template.ts

export interface TemplateData {
  phase: { id: string; title: string; purpose: string };
  workstreams: WorkstreamDef[];
  dependencies: Array<{ from: string; to: string; type: 'blocking' | 'informational' }>;
  batches: string[][];
  riskRegister: Array<{ risk: string; likelihood: string; impact: string; mitigation: string }>;
  rollback: { triggerConditions: string[]; procedure: string[] };
  nextPhase: { id: string; title: string };
  hardRequirements: string[];
  executionPolicies: Record<string, unknown>;
}

export interface RequiredSegment {
  id: string;
  name: string;
  required: boolean;
  order: number;
  template: string;
  placeholders: string[];
}

export interface ParsedTemplate {
  version: string;
  segments: RequiredSegment[];
  contractSchema: Record<string, unknown>;
  raw: string;
}

export class MasterTemplateIntegration {
  private templatePath: string;
  private parsedCache: Map<string, ParsedTemplate> = new Map();
  
  constructor(templatePath?: string);
  
  // Load
  async loadTemplate(version?: string): Promise<ParsedTemplate>;
  private parseTemplate(raw: string): ParsedTemplate;
  
  // Populate
  populateSegment(
    segment: RequiredSegment,
    data: TemplateData,
  ): string;
  
  populateFullTemplate(
    parsedTemplate: ParsedTemplate,
    data: TemplateData,
  ): string;
  
  // Contract
  generateContract(
    populated: string,
    phase: { id: string; title: string; workstreams: WorkstreamDef[]; dependencies: unknown[]; batches: string[][] },
  ): PlanExecutionContract;
  
  // Validation
  validatePopulated(content: string): ValidationResult[];
  validateContract(contract: PlanExecutionContract): ValidationResult[];
  
  // Required segments check
  private getRequiredSegments(version: string): RequiredSegment[];
  checkAllRequiredSegmentsPresent(populated: string, version: string): boolean;
  
  // Version support
  getSupportedVersions(): string[];
  isVersionSupported(version: string): boolean;
  
  // Cache management
  clearCache(): void;
}

// Required segments in v2.5.1:
// 1. TL;DR / Compact Mental Model
// 2. Header (table)
// 3. RACI (table)
// 4. Purpose
// 5. What Carried Over
// 6. Background / What Was Wrong
// 7. Current Failure State / Known Blockers
// 8. Risk Register
// 9. Workstreams (one per workstream)
// 10. Combined Implementation Order
// 11. Definition of Done
// 12. Rollback Playbook
// 13. What Next Phase Inherits
```

**File Scope:** `packages/coding-agent/src/brain/plan-factory/template.ts`, `packages/coding-agent/test/brain/plan-factory/template.test.ts`

**Dependencies:** None (reads template file directly)

---

### 7.C — Reflection Engine

**Goal:** Generate source-backed reflections after every plan execution, analyzing what ran, worked, failed, and slowed down.

**Requirements:**
* Trigger after plan execution completes (hook into plan completion event)
* Consume execution journal, workspace outcomes, validation results
* Analyze patterns: what succeeded, what failed repeatedly
* Compute metrics: success rate, retry count, duration, validation failures
* Generate source-backed summaries (every claim must reference evidence)
* Create memory update proposals from findings
* Generate future phase suggestions
* Store all artifacts to `.pi/brain/reflections/{planExecId}/`

**Acceptance Criteria:**
* [ ] Triggers automatically on plan completion
* [ ] Analyzes workspace outcomes correctly
* [ ] Detects failure patterns (retry hotspots, validation failures)
* [ ] Computes accurate metrics
* [ ] Summary references evidence (no hallucination)
* [ ] Memory proposals reference reflection evidence
* [ ] Future suggestions ranked by priority
* [ ] Markdown and JSON artifacts written correctly

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/reflection/engine.ts

export interface ReflectionConfig {
  outputBaseDir: string;               // .pi/brain/reflections/
  minWorkspaceCount: number;           // default 3 (skip reflection for tiny plans)
  enableMemoryGeneration: boolean;     // default true
  enableFutureSuggestions: boolean;    // default true
  maxFutureSuggestions: number;        // default 3
  sourceBackedRequired: boolean;       // default true
}

export interface ReflectionInput {
  planExecId: string;
  planId: string;
  planTitle?: string;
  executionJournal: ExecutionJournalEntry[];
  workspaceOutcomes: WorkspaceOutcome[];
  validationResults: ValidationResult[];
  integrationState: {
    wasDirty: boolean;
    conflicts: number;
    resolvedConflicts: number;
  };
  duration: number;                    // total execution duration in ms
  startTime: string;                   // ISO 8601
  endTime: string;                     // ISO 8601
  autonomyLevel: number;
  policyStops: number;
  approvalRequests: number;
}

export interface ExecutionJournalEntry {
  timestamp: string;
  eventType: string;
  workspaceId: string;
  severity?: string;
  data: Record<string, unknown>;
}

export interface WorkspaceOutcome {
  workspaceId: string;
  status: 'success' | 'failure' | 'retry' | 'skipped' | 'conflict';
  retryCount: number;
  duration: number;
  errorTypes?: string[];
  validationPassed?: boolean;
  summary?: string;
}

export interface ReflectionReport {
  id: string;                          // ULID
  planExecId: string;
  planTitle?: string;
  
  // Summary
  summary: string;                     // 2-3 sentence overview
  whatPeopleNeedToKnow: string;        // One-line takeaway
  
  // What happened
  whatRan: string[];                   // Plan-level summary
  whatWorked: string[];                // Things that went well
  whatFailed: string[];                // Things that went wrong
  whatSlowedDown: string[];            // Bottlenecks
  
  // Metrics
  workspaceCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  successRate: number;                 // 0-1
  avgRetryCount: number;
  totalDuration: number;               // ms
  validationFailures: number;
  
  // Memory & proposals
  memoriesToCreate: MemoryProposalSuggestion[];
  proposalsToGenerate: ProposalSuggestion[];
  futurePhaseSuggestions: FuturePhaseSuggestion[];
  
  // Trust
  policyStops: number;
  approvalRequests: number;
  safetyInterventions: number;
  
  // Metadata
  createdAt: string;
  confidence: number;                  // 0-1, based on evidence completeness
  sources: SourceRef[];                // All referenced sources
}

export interface MemoryProposalSuggestion {
  type: MemoryType;
  title: string;
  content: string;
  confidence: number;
  sourceRefs: MemorySourceRef[];
  category: 'failure' | 'success' | 'architecture' | 'process';
}

export interface ProposalSuggestion {
  type: ProposalType;
  title: string;
  description: string;
  rationale: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  evidenceIds: string[];
}

export interface FuturePhaseSuggestion {
  title: string;
  rationale: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  estimatedWorkstreams: number;
  relatedMemoryIds: string[];
  relatedObservationIds: string[];
}

export interface SourceRef {
  type: 'workspace' | 'journal' | 'validation' | 'memory';
  id: string;
  description: string;
}

export class ReflectionEngine {
  private config: ReflectionConfig;
  private memoryProposalGen: MemoryProposalGenerator;
  private futureSuggestionGen: FutureSuggestionEngine;
  private summarizer: SourceBackedSummarizer;
  
  constructor(
    config?: Partial<ReflectionConfig>,
  );
  
  // Core
  async reflect(input: ReflectionInput): Promise<ReflectionReport>;
  async generateReflection(input: ReflectionInput): Promise<ReflectionReport>;
  
  // Analysis
  private analyzeWhatRan(outcomes: WorkspaceOutcome[]): string[];
  private analyzeWhatWorked(
    outcomes: WorkspaceOutcome[],
    journal: ExecutionJournalEntry[],
  ): string[];
  
  private analyzeWhatFailed(
    outcomes: WorkspaceOutcome[],
    validationResults: ValidationResult[],
  ): string[];
  
  private analyzeWhatSlowedDown(
    outcomes: WorkspaceOutcome[],
    journal: ExecutionJournalEntry[],
  ): string[];
  
  private computeMetrics(outcomes: WorkspaceOutcome[]): {
    workspaceCount: number;
    successCount: number;
    failureCount: number;
    retryCount: number;
    successRate: number;
    avgRetryCount: number;
    totalDuration: number;
    validationFailures: number;
  };
  
  // Memory proposals
  private generateMemorySuggestions(
    worked: string[],
    failed: string[],
    outcomes: WorkspaceOutcome[],
    validationResults: ValidationResult[],
  ): MemoryProposalSuggestion[];
  
  // Summary
  private generateSummary(report: Omit<ReflectionReport, 'summary'>): string;
  private generateOneLiner(report: Omit<ReflectionReport, 'summary'>): string;
  
  // Source-backing enforcement
  private assertSourceBacked(field: string, refs: SourceRef[]): void;
  private validateSources(report: ReflectionReport): boolean;
  
  // I/O
  async storeReflection(report: ReflectionReport): Promise<void>;
  async writeMarkdown(report: ReflectionReport): Promise<string>;
  async writeJson(report: ReflectionReport): Promise<string>;
  
  // Artifact paths
  private reflectionDir(planExecId: string): string;
  private reflectionMdPath(planExecId: string): string;
  private reflectionJsonPath(planExecId: string): string;
  private memoryProposalsPath(planExecId: string): string;
  private futureSuggestionsPath(planExecId: string): string;
  
  // Configuration
  setConfig(config: Partial<ReflectionConfig>): void;
  getConfig(): ReflectionConfig;
}
```

**File Scope:** `packages/coding-agent/src/brain/reflection/engine.ts`, `packages/coding-agent/test/brain/reflection/engine.test.ts`, `packages/coding-agent/test/fixtures/reflection/valid-input.json`, `packages/coding-agent/test/fixtures/reflection/expected-output.json`

**Dependencies:** P17.D (SourceBackedSummarizer), P17.E (MemoryProposalGenerator), P17.F (FutureSuggestionEngine)

---

### 7.D — Source-Backed Summarizer

**Goal:** Generate summaries where every claim references evidence. No hallucination allowed.

**Requirements:**
* Each summary sentence must reference at least one evidence source
* validateEvidenceChain() checks that each claim has a corresponding source
* Reject summaries with un-evidenced claims
* Format summary for both markdown and dashboard display

**Acceptance Criteria:**
* [ ] WhatWorked summary references workspace outcomes
* [ ] WhatFailed summary references validation results
* [ ] Summaries include source IDs inline `[source:workspace-A]`
* [ ] validateEvidenceChain rejects missing references
* [ ] Markdown and dashboard format outputs

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/reflection/summarizer.ts

export class SourceBackedSummarizer {
  // Summary generation
  generateWhatWorkedSummary(
    outcomes: WorkspaceOutcome[],
  ): string;
  
  generateWhatFailedSummary(
    outcomes: WorkspaceOutcome[],
    validationResults: ValidationResult[],
  ): string;
  
  generateMetricSummary(
    metrics: { successRate: number; avgRetryCount: number; totalDuration: number },
  ): string;
  
  // Evidence validation
  validateEvidenceChain(
    text: string,
    sources: SourceRef[],
  ): { valid: boolean; missingRefs: string[]; matchedRefs: string[] };
  
  // Format helpers
  formatForMarkdown(report: ReflectionReport): string;
  formatForDashboard(report: ReflectionReport): {
    summary: string;
    whatWorked: Array<{ text: string; sources: string[] }>;
    whatFailed: Array<{ text: string; sources: string[] }>;
  };
  
  // Template
  private markdownTemplate: string = `
## Reflection: {{planTitle}}

### Summary
{{summary}}

### What Ran
{{whatRan}}

### What Worked
{{whatWorked}}

### What Failed
{{whatFailed}}

### Metrics
| Metric | Value |
|--------|-------|
| Workspaces | {{workspaceCount}} |
| Success Rate | {{successRate}} |
| Avg Retries | {{avgRetryCount}} |
| Duration | {{duration}} |

### Memory Proposals ({{memoryCount}})
{{memoryProposals}}

### Future Suggestions
{{futureSuggestions}}

*Generated: {{createdAt}} | Confidence: {{confidence}}*
`;
}
```

**File Scope:** `packages/coding-agent/src/brain/reflection/summarizer.ts`, `packages/coding-agent/test/brain/reflection/summarizer.test.ts`

**Dependencies:** None

---

### 7.E — Memory Update Proposal Generator

**Goal:** Create memory update proposals from reflection results — failures become failure_memory, successes become execution_memory.

**Requirements:**
* Failure patterns → `failure_memory` type
* Success patterns → `execution_memory` type
* Architecture changes → `architecture_memory` type
* Each memory proposal includes source references to reflection evidence
* Proposals start as `candidate` lifecycle (P14 lifecycle)
* Confidence based on evidence strength and retry count

**Acceptance Criteria:**
* [ ] Failures generate failure_memory proposals
* [ ] Successes generate execution_memory proposals
* [ ] Architecture changes generate architecture_memory proposals
* [ ] Each proposal references reflection evidence
* [ ] Proposals formatted for P14 MemoryRecord
* [ ] Confidence reflects evidence quality

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/reflection/memory-proposals.ts

export interface MemoryProposalOutput {
  memory: Partial<MemoryRecord>;
  evidence: SourceRef[];
  confidence: number;
}

export class MemoryProposalGenerator {
  // Main
  fromReflection(report: ReflectionReport): MemoryProposalOutput[];
  
  // Specific generators
  fromFailures(
    failed: string[],
    outcomes: WorkspaceOutcome[],
  ): MemoryProposalOutput[];
  
  fromSuccesses(
    worked: string[],
    outcomes: WorkspaceOutcome[],
  ): MemoryProposalOutput[];
  
  fromArchitecture(
    whatRan: string[],
    outcomes: WorkspaceOutcome[],
  ): MemoryProposalOutput[];
  
  // Confidence calculation
  private computeConfidence(
    sourceCount: number,
    retryCount: number,
    outcomeCount: number,
  ): number;
  
  // Source mapping
  private mapOutcomesToSources(outcomes: WorkspaceOutcome[]): SourceRef[];
  private mapFailuresToSources(failed: string[], outcomes: WorkspaceOutcome[]): SourceRef[];
  
  // Formatting
  formatAsProposal(output: MemoryProposalOutput): Partial<Proposal>;
}
```

**File Scope:** `packages/coding-agent/src/brain/reflection/memory-proposals.ts`, `packages/coding-agent/test/brain/reflection/memory-proposals.test.ts`

**Dependencies:** P14.A (MemoryRecord type)

---

### 7.F — Future Phase Suggestion Engine

**Goal:** Generate prioritized next-phase suggestions from reflection analysis.

**Requirements:**
* Analyze failure patterns → suggest fix phases
* Analyze bottlenecks → suggest optimization phases
* Analyze goal alignment → suggest goal-advancing phases
* Rank suggestions by: goal alignment, bottleneck severity, failure frequency
* Max 3 suggestions per reflection (configurable)

**Acceptance Criteria:**
* [ ] Failures generate fix suggestions
* [ ] Bottlenecks generate optimization suggestions
* [ ] Goals generate advancement suggestions
* [ ] Suggestions ranked by priority
* [ ] Each suggestion includes rationale
* [ ] Max 3 suggestions by default

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/reflection/future-suggestions.ts

export interface SuggestionRankingConfig {
  goalAlignmentWeight: number;       // default 0.4
  bottleneckSeverityWeight: number;  // default 0.3
  failureFrequencyWeight: number;    // default 0.3
  maxSuggestions: number;            // default 3
}

export class FutureSuggestionEngine {
  constructor(config?: Partial<SuggestionRankingConfig>);
  
  // Main
  fromReflection(report: ReflectionReport, goals?: GoalRecord[]): FuturePhaseSuggestion[];
  
  // From failures
  private fromFailures(
    failed: string[],
    scores: Map<string, number>,
  ): FuturePhaseSuggestion[];
  
  // From bottlenecks
  private fromBottlenecks(
    slowedDown: string[],
  ): FuturePhaseSuggestion[];
  
  // From goals
  private fromGoals(
    goals: GoalRecord[],
    completedPlans: string[],
  ): FuturePhaseSuggestion[];
  
  // Ranking
  rankSuggestions(
    suggestions: FuturePhaseSuggestion[],
    goals?: GoalRecord[],
    failureScores?: Map<string, number>,
  ): FuturePhaseSuggestion[];
  
  // Configuration
  setConfig(config: Partial<SuggestionRankingConfig>): void;
  getConfig(): SuggestionRankingConfig;
}
```

**File Scope:** `packages/coding-agent/src/brain/reflection/future-suggestions.ts`, `packages/coding-agent/test/brain/reflection/future-suggestions.test.ts`

**Dependencies:** P15.A (GoalRecord type)

---

### 7.G — Reflection API

**Goal:** REST API for listing, reading, and regenerating reflections.

**Acceptance Criteria:**
* [ ] GET /api/brain/reflections returns paginated list
* [ ] GET /api/brain/reflections/:id returns detail with evidence
* [ ] POST /api/brain/reflections/:id/generate regenerates
* [ ] GET /api/brain/reflections/stats returns stats
* [ ] GET /api/brain/reflections/:id/memories returns memory proposals
* [ ] GET /api/brain/reflections/:id/future returns future suggestions

**API Specifications:**

```
GET /api/brain/reflections
Query: planExecId?, limit?, offset?, since?, until?
Response: { reflections: ReflectionReport[], total: number }

GET /api/brain/reflections/:planExecId
Response: ReflectionReport

POST /api/brain/reflections/:planExecId/generate
Body: { force?: boolean }
Response: ReflectionReport

GET /api/brain/reflections/stats
Response: { total: number; byPlan: Record<string, number>; avgConfidence: number }

GET /api/brain/reflections/:planExecId/memories
Response: { memories: MemoryProposalSuggestion[] }

GET /api/brain/reflections/:planExecId/future
Response: { suggestions: FuturePhaseSuggestion[] }
```

**File Scope:** `packages/web-server/src/routes/brain/reflections.ts`, `packages/coding-agent/src/brain/reflection/api.ts`

**Dependencies:** P17.C (ReflectionEngine)

---

### 7.H — Reflection Viewer UI

**Goal:** Dashboard component showing reflections with evidence, memory proposals, and future suggestions.

**Acceptance Criteria:**
* [ ] Timeline view of all reflections
* [ ] Detail view shows all sections
* [ ] WhatWorked/WhatFailed with source badges
* [ ] Memory proposals linked to P14 memory
* [ ] Future suggestions linked to P16 proposals
* [ ] Expand/collapse sections

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    reflections/
      ReflectionTimeline.tsx         # Timeline list
      ReflectionCard.tsx             # Summary card
      ReflectionDetail.tsx           # Full report
      WhatWorkedSection.tsx          # Green section
      WhatFailedSection.tsx          # Red section
      MetricsTable.tsx               # Metrics display
      MemoryProposalsSection.tsx     # Memory proposals
      FutureSuggestionsSection.tsx   # Future suggestions
      index.ts
```

**File Scope:** `packages/web-ui/dashboard/src/components/brain/reflections/*.tsx`, `packages/web-ui/dashboard/src/pages/BrainReflections.tsx`

**Dependencies:** P17.G (API)

---

### 7.I — P17 Dogfood & Report

**Goal:** Run P17 end-to-end: generate plan from proposal, execute plan, generate reflection, verify artifacts.

**Acceptance Criteria:**
* [ ] Proposal → PlanFactory → valid phase markdown
* [ ] Plan markdown passes validation
* [ ] Plan completes execution
* [ ] Reflection generates automatically
* [ ] Reflection artifacts written
* [ ] Memory proposals created
* [ ] Future suggestions generated
* [ ] API returns reflection data
* [ ] Dashboard shows reflection

**Dogfood Report Template:**

```markdown
# P17 Dogfood Report

## Environment
- Pi version:
- PlanFactory enabled: true
- Reflection enabled: true

## Plan Factory
- Proposals processed: X
- Plans generated: X
- Plans validated: X
- Average confidence: X

## Reflections
- Plans executed: X
- Reflections generated: X
- Source-backed: X/X (claims validated)
- Memory proposals: X
- Future suggestions: X

## Artifacts
- Markdown files: X
- JSON contracts: X
- Reflection artifacts: X

## Issues Found
- [List]

## Next Steps
- [Recommendations for P18]
```

---

## 8. Combined Implementation Order

```text
Phase: P17 — Plan Factory & Reflection Loop
=============================================

Batch 1 (Foundation):
  P17.A — Plan Factory Engine (types + core logic)
  P17.B — Master Template Integration (template parsing)

Batch 2 (Reflection):
  P17.D — Source-Backed Summarizer
  P17.E — Memory Update Proposal Generator
  P17.F — Future Phase Suggestion Engine

Batch 3 (Core Engine):
  P17.C — Reflection Engine (depends on all above)

Batch 4 (Integration):
  P17.G — Reflection API
  P17.H — Reflection Viewer UI

Batch 5 (Validation):
  P17.I — P17 Dogfood & Report
```

**Dependency Rationale:**
- Plan Factory (P17.A) needs template integration (P17.B)
- Reflection engine (P17.C) needs summarizer, memory proposals, future suggestions
- Summarizer/memory/future are independent of each other
- API depends on engine
- UI depends on API

---

## 9. Definition of Done

P17 is complete when ALL are true:

* [ ] Plan Factory Engine — creates valid phase markdown + JSON contract from proposal
* [ ] Master Template Integration — loads, parses, populates v2.5.1 template
* [ ] Reflection Engine — generates source-backed reflection after execution
* [ ] Source-Backed Summarizer — every summary claim references evidence
* [ ] Memory Update Proposal Generator — creates memory proposals from failures/successes
* [ ] Future Phase Suggestion Engine — generates ranked next-phase suggestions
* [ ] Reflection API — all endpoints functional
* [ ] Reflection Viewer UI — dashboard shows reflections with evidence
* [ ] P17 Dogfood Report — complete report generated
* [ ] Integration queue is clean or intentionally blocked with handoff
* [ ] No forbidden commands or files were used
* [ ] Typecheck/build/test requirements passed

---

## 10. Rollback Playbook

**Trigger conditions:**
* Plan factory generates invalid plans (validation fails)
* Reflection engine produces hallucinated summaries
* Memory proposals create excessive noise
* Future suggestions are irrelevant

**Rollback procedure:**
1. Set `PLAN_FACTORY_ENABLED=false` — proposals stay as drafts
2. Set `REFLECTION_ENABLED=false` — post-execution reflection skipped
3. Existing reflection artifacts remain readable
4. Plan queue continues with manually authored plans

---

## 11. What Next Phase Inherits

**P18 inherits:**
* Plan factory output (plans queued for execution)
* Reflection artifacts (source of trust data)
* Memory proposals to track via policy

**P18 may add:**
* Policy checks on plan factory output
* Approval gating before plan queuing
* Audit logging of generated plans


---

# Part 2 — Agent Brief

## Mission

Implement all P17 — P17 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

## Hard Requirements

1. Do not exceed selected scale-mode worker cap.
2. Do not run more than 3 workers unless worktree isolation and integration queue readiness pass.
3. Do not merge workspace output without passed workspace validation.
4. Do not mark a plan complete if integration validation fails.
5. Do not treat merge conflict as ordinary worker failure.
6. Do not start the next plan while integration queue state is dirty.
7. Do not run watch-mode validation.
8. Do not run `git push`.
9. Do not run raw destructive cleanup commands.
10. Do not access secrets or forbidden files.
11. The executor remains the only component that mutates execution state.
12. Integration queue must respect workspace-level queuePriority and the selected optimization strategy.
13. Queue optimization must not bypass safety checks.
14. Low-priority workspaces must still be merged within a reasonable window.

## Execution Policies

```yaml
scale:
  default_mode: experimental_6
  selected_mode: experimental_6
  modes:
    stable_3:
      max_parallel_workspaces: 3
      worktree_required: false
      integration_queue_required: false
    experimental_6:
      max_parallel_workspaces: 6
      worktree_required: true
      integration_queue_required: true
      validation_lock_required: true
      archive_required: true
      completion_gate_required: true
    scale_8:
      max_parallel_workspaces: 8
      worktree_required: true
      integration_queue_required: true
      validation_lock_required: true
      archive_required: true
      completion_gate_required: true
      dogfood_pass_required: true
      explicit_approval_required: true

worktree:
  enabled_by_default: true
  enabled: true
  root: .pi/worktrees
  quarantine_failed_by_default: true
  raw_rm_rf_forbidden: true
  path_scope_required: true

integration_queue:
  enabled: true
  process_one_merge_at_a_time: true
  stop_on_merge_conflict: true
  require_workspace_validation_pass: true
  require_integration_validation_pass: true
  git_push_allowed: false

queue_optimization:
  enabled_by_default: true
  default_strategy: priority_then_fifo
  strategies:
    priority_then_fifo:
      description: Workspaces merge in priority order; same-priority workspaces merge in submission order
      priority_levels: [critical, high, normal, low]
    critical_path_first:
      description: Workspaces on the critical path merge before non-critical workspaces
      priority_levels: [critical, high, normal, low]
    weighted_shortest_job_first:
      description: Workspaces with smaller changes merge first within priority bands
      priority_levels: [critical, high, normal, low]

validation:
  global_validation_lock_required: true
  targeted_validation_enabled: true
  final_integration_validation_required: true
  watch_mode_forbidden: true

parallelism_review:
  preflight_required: true
  interactive_dependency_review: true
  show_dag_effective_parallelism: true
  show_safe_effective_parallelism: true
  show_batch_preview: true
  show_safe_batch_preview: true
  show_critical_path: true
  show_scale_mode_readiness: true
  allow_dependency_editing: true
  persist_approved_graph: true
```

## Safety Stops

* Dependency cycles
* Invalid dependency patches
* Required preflight review not approved
* Stale approved graph hash
* Worktree path escaping `.pi/worktrees`
* Raw destructive worktree cleanup
* Integration merge without passed workspace validation
* Integration validation failure
* Merge conflict without handoff artifact
* Unsafe scale mode
* Queue starting next plan while integration queue is dirty
* Scale mode approval stale or missing
* Worktree isolation disabled while requesting more than 3 workers
* Forbidden file access
* Secrets access
* `git push`
* Watch-mode validation command
* Queue optimization enabled with invalid or missing strategy
* Queue priority set to unsupported value
* Generated plans must pass validation before queuing
* Reflection claims must reference evidence sources

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** Authoritative execution contract for Pi's multi-agent execution system. Pi parses this JSON to build the execution plan.

**Validation:** Must be valid and complete before execution begins. Use `pi plan doctor` to validate.

```json
{
  "contractVersion": "2.5.1",
  "executionBackend": "postgres",
  "project": {
    "name": "pi-mono",
    "rootPath": "/home/erfolg/src/pi",
    "type": "repo",
    "tags": [
      "v2",
      "second-brain"
    ]
  },
  "planExecution": {
    "phase": "P17",
    "title": "Plan Factory & Reflection Loop",
    "mode": "autonomous",
    "maxParallelWorkspaces": 6,
    "scheduling": {
      "continuous": true,
      "slotCount": 6,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "experimental_6",
      "selectedMode": "experimental_6",
      "modes": {
        "stable_3": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": false,
          "integrationQueueRequired": false
        },
        "experimental_6": {
          "maxParallelWorkspaces": 6,
          "worktreeRequired": true,
          "integrationQueueRequired": true,
          "validationLockRequired": true,
          "archiveRequired": true,
          "completionGateRequired": true
        },
        "scale_8": {
          "maxParallelWorkspaces": 8,
          "worktreeRequired": true,
          "integrationQueueRequired": true,
          "validationLockRequired": true,
          "archiveRequired": true,
          "completionGateRequired": true,
          "dogfoodPassRequired": true,
          "explicitApprovalRequired": true
        }
      }
    },
    "worktree": {
      "enabled": true,
      "enabledByDefault": true,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": true,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "requireWorkspaceValidationPass": true,
      "requireIntegrationValidationPass": true,
      "gitPushAllowed": false,
      "queuePriority": {
        "enabled": true,
        "defaultLevel": "normal",
        "levels": [
          "critical",
          "high",
          "normal",
          "low"
        ]
      },
      "queueOptimization": {
        "enabled": true,
        "strategy": "priority_then_fifo",
        "availableStrategies": [
          "priority_then_fifo",
          "critical_path_first",
          "weighted_shortest_job_first"
        ]
      }
    },
    "validation": {
      "globalValidationLockRequired": true,
      "targetedValidationEnabled": true,
      "finalIntegrationValidationRequired": true,
      "watchModeForbidden": true
    },
    "interactiveParallelismReview": {
      "enabled": true,
      "preflightRequired": true,
      "approvalRequiredBeforeRun": true,
      "allowDependencyEditing": true,
      "showEffectiveParallelism": true,
      "showSafeEffectiveParallelism": true,
      "showBatchPreview": true,
      "showSafeBatchPreview": true,
      "showCriticalPath": true,
      "showScaleModeReadiness": true,
      "warnWhenEffectiveParallelismBelowRequested": true,
      "warnWhenSafeParallelismBelowDagParallelism": true,
      "warnWhenScaleModePrerequisitesMissing": true,
      "persistApprovedGraph": true
    },
    "planIntake": {
      "enabled": true,
      "runOnUpload": true,
      "parserPriority": [
        "part3_json",
        "markdown_fallback"
      ],
      "autoNormalize": true,
      "autoDoctor": true,
      "autoDagAnalysis": true,
      "autoOptimizationProposal": true,
      "autoQueuePriorityRecommendation": true,
      "autoWorkspaceSplitRecommendation": true,
      "autoDryRunForecast": true,
      "approvalRequiredBeforeApplyingOptimization": true,
      "approvalRequiredBeforeExecution": true
    },
    "optimizer": {
      "enabled": true,
      "mode": "advisory_until_approved",
      "objectives": [
        "maximize_safe_effective_parallelism",
        "minimize_critical_path",
        "minimize_same_file_conflicts",
        "minimize_validation_lock_contention",
        "prioritize_critical_path_queue_merges"
      ],
      "allowedPatches": [
        "dependencies",
        "parallelGroup",
        "queuePriority",
        "canRunWith",
        "cannotRunWith",
        "conflictScope",
        "workspaceSplitSuggestion",
        "workspaceMergeSuggestion"
      ],
      "forbiddenAutoPatches": [
        "allowedFiles",
        "forbiddenFiles",
        "capabilityManifest",
        "safety.hardStops",
        "forbiddenCommands"
      ]
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
      "unapproved_parallelism_review",
      "invalid_dependency_patch",
      "worktree_path_escape",
      "raw_destructive_cleanup",
      "integration_merge_without_validation",
      "integration_validation_failure",
      "merge_conflict_without_handoff",
      "unsafe_scale_mode",
      "queue_next_plan_while_integration_dirty",
      "scale_mode_approval_stale",
      "worktree_required_for_requested_parallelism",
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
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 6,
    "selectedScaleMode": "experimental_6",
    "scaleModeReadiness": {
      "ready": true,
      "blockedReasons": [],
      "warnings": [],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required for experimental_6"
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 3,
    "expectedSafeEffectiveParallelismMin": 3,
    "dagEffectiveParallelism": null,
    "safeEffectiveParallelism": null,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "safeBatchingStrategy": "dag_batches_with_p6_safety_constraints",
    "editableFields": [
      "workspaces[].dependencies",
      "workspaces[].parallelGroup",
      "workspaces[].dependencyReason",
      "workspaces[].parallelism.canRunWith",
      "workspaces[].parallelism.cannotRunWith",
      "workspaces[].parallelism.conflictScope",
      "workspaces[].integration.queuePriority",
      "workspaces[].integration.queueOptimizationNotes"
    ],
    "doctorWarnings": [
      "effective_parallelism_below_requested",
      "safe_parallelism_below_dag_parallelism",
      "fully_serialized_graph",
      "long_serialized_tail",
      "file_overlap_blocks_parallelism",
      "symbol_overlap_blocks_parallelism",
      "validation_lock_limits_parallelism",
      "integration_queue_serializes_merges",
      "scale_mode_prerequisites_missing",
      "worktree_isolation_required_for_scale",
      "queue_optimization_disabled_with_active_priority",
      "queue_priority_mismatch_with_configured_levels",
      "critical_path_workspace_has_low_priority",
      "queue_optimization_strategy_invalid_for_mode"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "safe_batch_preview",
      "critical_path",
      "scale_mode_readiness",
      "approved_dependency_patch",
      "approved_graph_hash",
      "queue_priority_snapshot",
      "queue_optimization_strategy",
      "queue_reorder_decision_log",
      "worktree_state"
    ],
    "batchPreview": {
      "batches": [],
      "overallEffectiveParallelism": null,
      "criticalPath": [],
      "criticalPathLength": 0,
      "serializedTailLength": 0
    },
    "safeBatchPreview": {
      "batches": [],
      "overallSafeEffectiveParallelism": null,
      "bottlenecks": [],
      "blockedParallelismReasons": []
    },
    "optimizationReview": {
      "originalGraphHash": null,
      "proposedGraphHash": null,
      "approvedGraphHash": null,
      "originalDagEffectiveParallelism": null,
      "proposedDagEffectiveParallelism": null,
      "originalSafeEffectiveParallelism": null,
      "proposedSafeEffectiveParallelism": null,
      "criticalPathDelta": null,
      "serializedTailDelta": null,
      "suggestions": [],
      "approvalState": "pending"
    }
  },
  "workspaces": [
    {
      "id": "7.A",
      "title": "Plan Factory Engine",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; all others depend on plan types"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Foundation; all others depend on plan types"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.B",
      "title": "Master Template Integration",
      "dependencies": [
        "7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.B must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on plan factory types"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on plan factory types"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.C",
      "title": "Reflection Engine",
      "dependencies": [
        "7.D",
        "7.E",
        "7.F"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.C must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on all reflection sub-modules"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Depends on all reflection sub-modules"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.D",
      "title": "Source-Backed Summarizer",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.D must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Independent; no deps on other P17 workstreams"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Independent; no deps on other P17 workstreams"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.E",
      "title": "Memory Proposal Generator",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Independent; references P14 type only"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Independent; references P14 type only"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.F",
      "title": "Future Suggestion Engine",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.F must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Independent; references P15 type only"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Independent; references P15 type only"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.G",
      "title": "Reflection REST API",
      "dependencies": [
        "7.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.G must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on reflection engine"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Depends on reflection engine"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.H",
      "title": "Reflection Viewer UI",
      "dependencies": [
        "7.G"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.H must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on API"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "normal",
        "queueOptimizationNotes": "Depends on API"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
      "id": "7.I",
      "title": "P17 Dogfood & Report",
      "dependencies": [
        "7.G",
        "7.H"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.I must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Validation only"
      },
      "worktree": {
        "required": true,
        "isolationMode": "shared_or_worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "low",
        "queueOptimizationNotes": "Validation only"
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [],
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
  "contractVersion": "2.5.1",
  "phase": "P17",
  "title": "P17 Dogfood & Report",
  "primaryGoal": "Implement and validate the P17 second-brain component.",
  "projectName": "pi-mono",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "priority_then_fifo",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 3,
  "notInScope": [
    "Platform/enterprise deployment",
    "Remote execution agents",
    "PostgreSQL backend (reserved for v3)",
    "Multi-project orchestration"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "dependency_cycles",
    "unapproved_parallelism_review",
    "invalid_dependency_patch",
    "worktree_path_escape",
    "raw_destructive_cleanup",
    "integration_merge_without_validation",
    "integration_validation_failure",
    "merge_conflict_without_handoff",
    "unsafe_scale_mode",
    "queue_next_plan_while_integration_dirty",
    "queue_optimization_invalid_strategy",
    "queue_priority_invalid_level"
  ],
  "completionGate": "All P17 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P18"
}
```

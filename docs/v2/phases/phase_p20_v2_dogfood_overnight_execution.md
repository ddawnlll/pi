# Phase P20 — V2 Dogfood: Overnight Autonomous Roadmap Execution

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P20`  
**One-line goal:** Validate the complete V2 cognitive loop end-to-end: overnight autonomous execution, morning reports, reflection, memory proposals, trust assessment.  
**Why now:** P13-P19 built all components. P20 proves the full system works in real usage. This is Milestone 4 — "Dogfood & Trust".  
**Blast radius:** Overnight orchestrator, morning report, validation scenarios; `packages/coding-agent`, `docs/`.  
**Rollback path:** Each component has individual disable flag. Fall back to manual overnight runs.  
**Scale mode:** `stable_3`  
**Safe parallelism target:** 3  
**Done when:** Full cognitive loop validated overnight, morning reports accurate, trust assessment green, dogfood report complete.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P20` |
| Title | `V2 Dogfood: Overnight Autonomous Roadmap Execution` |
| Status | `Authoritative Implementation` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Full system validation, overnight execution, trust assessment` |
| Scale mode | `stable_3` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| P20.A — Overnight Run Orchestration | Pi Worker Agent | User | Reviewer | User |
| P20.B — Morning Report Generator | Pi Worker Agent | User | Reviewer | User |
| P20.C — Full Loop Validation | Pi Worker Agent | User | Reviewer | User |
| P20.D — Trust Assessment | Pi Worker Agent | User | Reviewer | User |
| P20.E — Dogfood Report | Pi Worker Agent | User | Reviewer | User |

---

## 2. Purpose

Validate the complete V2 cognitive loop end-to-end: observe → remember → think → decide → plan → execute → reflect → improve, all happening autonomously overnight.

### 2.1 Validation Scenarios

| # | Scenario | Description | Autonomy Level | Expected Outcome |
|---|----------|-------------|:---:|:---:|
| 1 | Full Autonomous Run | Approved plan queue executes overnight without intervention | 3 | All plans complete |
| 2 | Approval Gate | Proposal generated, queued for approval, waits | 3 | User approves → plan created |
| 3 | Safety Stop | Integration queue gets dirty → queue stops | 3 | Handoff artifact created |
| 4 | Reflection Loop | Plan completes → reflection → memories | 3 | Memories created from reflection |
| 5 | Morning Report | Report generated with accurate summary | 3 | Report delivered |
| 6 | Trust Controls | Auto-start blocked by policy | 3 | Audit entry logged |

### 2.2 Success Criteria (from Vision §15)

**Quantitative:**
- Overnight plan completion count > 0
- Memory hit rate during planning > 50%
- Policy stops > 0 (meaning detection works)
- Unsafe actions blocked = all attempted

**Qualitative:**
- Pi noticed problems before user asked
- Pi generated plans aligned with goals
- Pi remembered past decisions correctly
- Pi stopped when it should
- Morning report was actionable

---

## 3. Implementation

### 3.A — Overnight Run Orchestration

```typescript
// packages/coding-agent/src/brain/overnight/orchestrator.ts

export type OvernightStopCondition =
  | 'integration_queue_dirty'
  | 'merge_conflict'
  | 'policy_violation'
  | 'low_confidence_unsafe'
  | 'user_intervention'
  | 'error_threshold_exceeded'
  | 'max_duration_reached';

export interface OvernightConfig {
  planExecIds: string[];          // Plans to execute
  autonomyLevel: 3 | 4;          // Only 3+ can execute
  stopConditions: OvernightStopCondition[];
  maxDurationHours: number;      // default 8
  scheduleTime?: string;         // HH:mm, if scheduled
  notificationEnabled: boolean;
  generateMorningReport: boolean;
}

export interface RunSession {
  id: string;
  planExecIds: string[];
  status: 'scheduled' | 'running' | 'completed' | 'stopped' | 'failed';
  startedAt?: string;
  completedAt?: string;
  stopReason?: string;
  progress: {
    completed: number;
    total: number;
    failed: number;
  };
  createdAt: string;
}

export interface RunStatus {
  sessionId: string;
  status: RunSession['status'];
  progress: RunSession['progress'];
  currentPlan?: string;
  currentPlanStatus?: string;
  lastStopCheckAt?: string;
  stopConditionsMet?: string[];
  elapsedHours: number;
}

export class OvernightOrchestrator {
  private config: OvernightConfig;
  private session?: RunSession;
  private stopCheckTimer?: NodeJS.Timeout;
  private planQueue: PlanQueueRef;
  
  constructor(planQueue: PlanQueueRef, config?: Partial<OvernightConfig>);
  
  // Lifecycle
  async schedule(config: OvernightConfig): Promise<RunSession>;
  async startNow(config: OvernightConfig): Promise<RunSession>;
  async startScheduled(sessionId: string): Promise<void>;
  async stop(reason: string): Promise<RunSession>;
  async pause(): Promise<RunSession>;
  async resume(): Promise<RunSession>;
  
  // Status
  getStatus(): RunStatus;
  getSession(): RunSession | null;
  getHistory(limit?: number): RunSession[];
  
  // Stop condition checks
  async checkStopConditions(): Promise<OvernightStopCondition[]>;
  private checkIntegrationQueue(): Promise<boolean>;
  private checkMergeConflicts(): Promise<boolean>;
  private checkPolicyViolations(): Promise<boolean>;
  private checkUserIntervention(): Promise<boolean>;
  private checkDuration(): Promise<boolean>;
  
  // Progress
  private updateProgress(): Promise<void>;
  private getNextPlan(): Promise<string | null>;
  private markPlanComplete(planExecId: string): Promise<void>;
  
  // Internal
  private startStopCheckInterval(): void;
  private stopStopCheckInterval(): void;
  private runOrchestrationLoop(): Promise<void>;
}
```

### 3.B — Morning Report Generator

```typescript
// packages/coding-agent/src/brain/overnight/morning-report.ts

export interface MorningReport {
  id: string;
  date: string;
  sessionId: string;
  
  // Summary
  title: string;
  summary: string;
  duration: string;
  plansAttempted: number;
  plansCompleted: number;
  plansFailed: number;
  
  // Execution
  whatRan: Array<{
    planId: string;
    planTitle: string;
    status: 'completed' | 'failed' | 'stopped';
    workspacesCompleted: number;
    workspacesFailed: number;
    duration: string;
  }>;
  
  // Analysis
  whatWorked: string[];
  whatFailed: string[];
  whatStopped: Array<{ plan: string; reason: string; at: string }>;
  
  // Changes
  newMemoriesCreated: number;
  memoryTypesCreated: string[];
  newReflectionsGenerated: number;
  proposalsGenerated: number;
  proposalsAccepted: number;
  
  // Trust
  policyStops: number;
  approvalRequests: number;
  safetyInterventions: number;
  totalAuditEntries: number;
  
  // Next steps
  suggestedNextActions: string[];
  topProposals: Array<{ title: string; score: number; description: string }>;
  recommendedGoalUpdates: string[];
  
  // Artifacts
  artifactLinks: Array<{ label: string; path: string; type: 'reflection' | 'audit' | 'memory' | 'report' }>;
  
  // Metadata
  generatedAt: string;
  reportVersion: string;
  generatedBy: string;
}

export class MorningReportGenerator {
  constructor(
    private observationEngine?: ObservationEngine,
    private memoryStore?: MemoryStore,
    private reflectionEngine?: ReflectionEngine,
    private auditLedger?: AuditLedger,
  );
  
  // Core
  async generate(session: RunSession): Promise<MorningReport>;
  async generateFromData(data: MorningReportData): Promise<MorningReport>;
  
  // Sections
  private async buildWhatRan(session: RunSession): Promise<MorningReport['whatRan']>;
  private async buildAnalysis(session: RunSession): Promise<{ whatWorked: string[]; whatFailed: string[] }>;
  private async buildChanges(session: RunSession): Promise<MorningReport['changes']>;
  private async buildTrust(session: RunSession): Promise<MorningReport['trust']>;
  private async buildNextSteps(session: RunSession): Promise<MorningReport['nextSteps']>;
  private async buildArtifacts(session: RunSession): Promise<MorningReport['artifactLinks']>;
  
  // Summary
  private generateTitle(report: Partial<MorningReport>): string;
  private generateSummary(report: Partial<MorningReport>): string;
  
  // Output
  async saveReport(report: MorningReport): Promise<string>;  // returns path
  async renderMarkdown(report: MorningReport): Promise<string>;
  async renderJson(report: MorningReport): Promise<string>;
  
  // Notification
  async sendReport(report: MorningReport, channels?: string[]): Promise<void>;
}
```

### 3.C — Full Loop Validation

```typescript
// packages/coding-agent/src/brain/overnight/validation.ts

export interface ValidationScenario {
  id: string;
  name: string;
  description: string;
  autonomyLevel: 3 | 4;
  setupSteps: (() => Promise<void>)[];
  expectedOutcome: 'complete' | 'approval_needed' | 'safety_stop' | 'error';
  validationChecks: ValidationCheck[];
}

export interface ValidationResult {
  scenarioId: string;
  passed: boolean;
  checks: Array<ValidationCheck & { passed: boolean; actualValue?: unknown }>;
  errors: string[];
  duration: number;
  startedAt: string;
  completedAt: string;
}

export interface ValidationCheck {
  id: string;
  type: 'observation' | 'memory' | 'proposal' | 'reflection' | 'audit' | 'policy' | 'report';
  description: string;
  expectedValue?: unknown;
  check: () => Promise<{ passed: boolean; actualValue?: unknown; evidence?: string }>;
}

export class FullLoopValidator {
  constructor(
    private observationEngine: ObservationEngine,
    private memoryStore: MemoryStore,
    private proposalStore: unknown,
    private reflectionEngine: ReflectionEngine,
    private auditLedger: AuditLedger,
    private policyEngine: PolicyEngine,
    private morningReportGenerator: MorningReportGenerator,
  );
  
  // Run
  async runScenario(scenario: ValidationScenario): Promise<ValidationResult>;
  async runAllScenarios(): Promise<Map<string, ValidationResult>>;
  async runScenarioById(id: string): Promise<ValidationResult>;
  
  // Built-in scenarios
  static SCENARIO_FULL_AUTONOMOUS_RUN: ValidationScenario;
  static SCENARIO_APPROVAL_GATE: ValidationScenario;
  static SCENARIO_SAFETY_STOP: ValidationScenario;
  static SCENARIO_REFLECTION_LOOP: ValidationScenario;
  static SCENARIO_TRUST_CONTROLS: ValidationScenario;
  
  // Individual validations
  async validateObservationGenerated(): Promise<ValidationCheck>;
  async validateSignalGenerated(): Promise<ValidationCheck>;
  async validateMemoryCreated(): Promise<ValidationCheck>;
  async validateProposalGenerated(): Promise<ValidationCheck>;
  async validateReflectionCreated(): Promise<ValidationCheck>;
  async validateAuditLogged(action: string): Promise<ValidationCheck>;
  async validatePolicyBlocked(action: string): Promise<ValidationCheck>;
  async validateMorningReport(): Promise<ValidationCheck>;
  async validateEvidenceChain(proposalId: string): Promise<ValidationCheck>;
  
  // Helpers
  private getValidationResults(scenario: ValidationScenario): Promise<Omit<ValidationResult, 'duration'>>;
}

// Scenario definitions:

// Scenario 1: Full Autonomous Run
SCENARIO_FULL_AUTONOMOUS_RUN = {
  id: 'full_autonomous',
  name: 'Full Autonomous Run',
  description: 'Queue approved plans at autonomy level 3 and execute overnight',
  autonomyLevel: 3,
  setupSteps: [async () => { /* queue 2-3 test plans */ }],
  expectedOutcome: 'complete',
  validationChecks: [
    { id: 'v1_obs', type: 'observation', description: 'Observations generated during execution' },
    { id: 'v1_mem', type: 'memory', description: 'Memories created from execution' },
    { id: 'v1_prop', type: 'proposal', description: 'Proposals generated from observations' },
    { id: 'v1_ref', type: 'reflection', description: 'Reflection generated after completion' },
    { id: 'v1_aud', type: 'audit', description: 'All decisions audited' },
    { id: 'v1_rpt', type: 'report', description: 'Morning report generated' },
  ],
};

// Scenario 2: Approval Gate
SCENARIO_APPROVAL_GATE = {
  id: 'approval_gate',
  name: 'Approval Gate',
  description: 'Generate a proposal requiring approval, verify it queues',
  autonomyLevel: 3,
  setupSteps: [async () => { /* trigger a proposal requiring approval */ }],
  expectedOutcome: 'approval_needed',
  validationChecks: [
    { id: 'v2_queued', type: 'audit', description: 'Proposal queued for approval' },
    { id: 'v2_blocked', type: 'audit', description: 'Plan not auto-executed' },
    { id: 'v2_approve', type: 'audit', description: 'Proposal accepted by user' },
  ],
};

// Scenario 3: Safety Stop
SCENARIO_SAFETY_STOP = {
  id: 'safety_stop',
  name: 'Safety Stop',
  description: 'Dirty integration queue stops overnight execution',
  autonomyLevel: 3,
  setupSteps: [async () => { /* dirty the integration queue */ }],
  expectedOutcome: 'safety_stop',
  validationChecks: [
    { id: 'v3_stop', type: 'audit', description: 'Execution stopped on dirty queue' },
    { id: 'v3_handoff', type: 'audit', description: 'Handoff artifact created' },
    { id: 'v3_resume', type: 'audit', description: 'Queue not auto-cleared' },
  ],
};

// Scenario 4: Reflection Loop
SCENARIO_REFLECTION_LOOP = {
  id: 'reflection_loop',
  name: 'Reflection Loop',
  description: 'Post-execution reflection generates memories and proposals',
  autonomyLevel: 3,
  setupSteps: [async () => { /* complete a plan */ }],
  expectedOutcome: 'complete',
  validationChecks: [
    { id: 'v4_ref', type: 'reflection', description: 'Reflection generated' },
    { id: 'v4_mem', type: 'memory', description: 'Memory proposals created from reflection' },
    { id: 'v4_future', type: 'proposal', description: 'Future phase suggestions created' },
  ],
};

// Scenario 5: Trust Controls
SCENARIO_TRUST_CONTROLS = {
  id: 'trust_controls',
  name: 'Trust Controls',
  description: 'Attempt forbidden action, verify blocked and audited',
  autonomyLevel: 3,
  setupSteps: [async () => { /* attempt forbidden action */ }],
  expectedOutcome: 'error',
  validationChecks: [
    { id: 'v5_block', type: 'policy', description: 'Forbidden action blocked' },
    { id: 'v5_audit', type: 'audit', description: 'Block logged to audit' },
    { id: 'v5_explain', type: 'audit', description: 'Explanation available' },
  ],
};
```

### 3.D — Trust Assessment

```typescript
// packages/coding-agent/src/brain/overnight/trust-assessment.ts

export interface TrustAssessment {
  id: string;
  date: string;
  version: string;
  
  // Overall score
  score: number;  // 0-100
  
  // Dimensions
  dimensions: {
    safety: TrustDimension;
    reliability: TrustDimension;
    transparency: TrustDimension;
    userControl: TrustDimension;
  };
  
  // Findings
  findings: TrustFinding[];
  recommendations: string[];
  
  // History tracking
  previousScore?: number;
  trend: 'improving' | 'stable' | 'declining' | 'first_assessment';
  
  // Metadata
  assessedAt: string;
  sessionId?: string;
}

export interface TrustDimension {
  score: number;       // 0-100
  status: 'green' | 'yellow' | 'red';
  description: string;
  criteria: TrustCriterion[];
}

export interface TrustCriterion {
  name: string;
  passed: boolean;
  weight: number;
  evidence: string;
  details: string;
}

export interface TrustFinding {
  dimension: string;
  status: 'green' | 'yellow' | 'red';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  evidence: string;
  recommendation?: string;
}

export class TrustAssessor {
  constructor(
    private auditLedger: AuditLedger,
    private policyEngine: PolicyEngine,
    private memoryStore?: MemoryStore,
  );
  
  // Core
  async assess(options?: { sessionId?: string }): Promise<TrustAssessment>;
  async assessDimension(dimension: keyof TrustAssessment['dimensions']): Promise<TrustDimension>;
  
  // Dimension assessments
  async assessSafety(): Promise<TrustDimension>;
  async assessReliability(): Promise<TrustDimension>;
  async assessTransparency(): Promise<TrustDimension>;
  async assessUserControl(): Promise<TrustDimension>;
  
  // Safety criteria
  private criterionNoUnauthorizedActions(): Promise<TrustCriterion>;
  private criterionPolicyStopsWork(): Promise<TrustCriterion>;
  private criterionForbiddenActionsBlocked(): Promise<TrustCriterion>;
  private criterionEmergencyStopWorks(): Promise<TrustCriterion>;
  
  // Reliability criteria
  private criterionPlansComplete(): Promise<TrustCriterion>;
  private criterionReflectionsGenerated(): Promise<TrustCriterion>;
  private criterionMemoryAccurate(): Promise<TrustCriterion>;
  private criterionProposalsUseful(): Promise<TrustCriterion>;
  
  // Transparency criteria
  private criterionAllActionsLogged(): Promise<TrustCriterion>;
  private criterionDecisionsExplainable(): Promise<TrustCriterion>;
  private criterionEvidenceChainsComplete(): Promise<TrustCriterion>;
  private criterionMorningReportsAccurate(): Promise<TrustCriterion>;
  
  // User control criteria
  private criterionApprovalsWork(): Promise<TrustCriterion>;
  private criterionAutonomyRespected(): Promise<TrustCriterion>;
  private criterionUserCanOverride(): Promise<TrustCriterion>;
  private criterionRollbackWorks(): Promise<TrustCriterion>;
  
  // Helpers
  private computeScore(dimensions: TrustAssessment['dimensions']): number;
  private computeTrend(previousScore: number | undefined, currentScore: number): TrustAssessment['trend'];
  private generateFindings(dimensions: TrustAssessment['dimensions']): TrustFinding[];
  private generateRecommendations(findings: TrustFinding[]): string[];
}
```

### 3.E — Dogfood Report

The ultimate deliverable. Complete report generation:

```typescript
// packages/coding-agent/src/brain/overnight/dogfood-report.ts

export interface DogfoodReport {
  id: string;
  date: string;
  version: string;
  
  // Executive Summary
  status: 'success' | 'partial' | 'failed';
  summary: string;
  
  // Scenarios
  scenarios: Array<{
    id: string;
    name: string;
    passed: boolean;
    duration: number;
    checks: Array<{ id: string; passed: boolean; evidence: string }>;
  }>;
  
  // Trust Assessment
  trust: TrustAssessment;
  
  // System Metrics
  metrics: {
    observations: { total: number; bySource: Record<string, number>; bySeverity: Record<string, number> };
    memories: { total: number; byType: Record<string, number>; conflictsDetected: number; userCorrections: number };
    proposals: { generated: number; accepted: number; rejected: number; autoQueued: number };
    reflections: { total: number; memoriesFromReflection: number; suggestionsCreated: number };
    audit: { totalEntries: number; decisions: Record<string, number>; policyStops: number };
  };
  
  // Issues
  issues: Array<{
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    component: string;
    resolution?: string;
    resolved: boolean;
  }>;
  
  // Recommendations
  recommendations: Array<{ priority: 'P0' | 'P1' | 'P2'; title: string; description: string }>;
  
  // Sign-off
  signOff: {
    v2SafeForOvernight: boolean;
    trustGreenAcrossDimensions: boolean;
    allScenariosPassed: boolean;
    userControlsFunctional: boolean;
    morningReportsAccurate: boolean;
    signedOffBy?: string;
    signedOffAt?: string;
  };
  
  // Metadata
  generatedAt: string;
  dogfoodRunId: string;
  reportVersion: string;
}

export class DogfoodReportGenerator {
  constructor(
    private validator: FullLoopValidator,
    private trustAssessor: TrustAssessor,
  );
  
  async generate(): Promise<DogfoodReport>;
  async writeReport(report: DogfoodReport): Promise<string>; // returns path
  async renderMarkdown(report: DogfoodReport): Promise<string>;
  async renderJson(report: DogfoodReport): Promise<string>;
}
```

---

## 4. Workstreams

| ID | Goal | Acceptance |
|----|------|------------|
| P20.A | Overnight Orchestration | Schedules and runs overnight queue with stop conditions |
| P20.B | Morning Report Generator | Accurate report with all sections |
| P20.C | Full Loop Validation | 5 scenarios pass successfully |
| P20.D | Trust Assessment | Green across all dimensions |
| P20.E | Dogfood Report | Complete, signed-off report |

---

## 5. Done Criteria

* [ ] Overnight orchestrator schedules and runs queue
* [ ] Stop conditions trigger correctly
* [ ] Morning report generated with accurate data
* [ ] All 5 validation scenarios pass
* [ ] Trust assessment score ≥ 80/100
* [ ] Safety = green, Reliability = green/yellow
* [ ] Dogfood report written with sign-off
* [ ] The user can say:
  * "Pi noticed problems before I asked"
  * "Pi generated plans I would have written"
  * "Pi remembered past decisions correctly"
  * "Pi stopped when it should"
  * "Morning report was actionable"

---

## 6. Rollback

Each V2 component has its own disable flag. Fall back to P12.5 behavior for execution.


---

# Part 2 — Agent Brief

## Mission

Implement all P20 — Overnight Run Report UI — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
  default_mode: stable_3
  selected_mode: stable_3
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
* Dogfood must not execute on live workspace
* Error injection must be scoped to test files only

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
    "phase": "P20",
    "title": "V2 Dogfood Overnight Execution",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "scheduling": {
      "continuous": true,
      "slotCount": 3,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "scale": {
      "defaultMode": "experimental_6",
      "selectedMode": "stable_3",
      "modes": {
        "stable_3": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": false,
          "integrationQueueRequired": false
        },
        "experimental_6": {
          "maxParallelWorkspaces": 3,
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
      "enabled": false,
      "enabledByDefault": true,
      "root": ".pi/worktrees",
      "quarantineFailedByDefault": true,
      "rawRmRfForbidden": true,
      "pathScopeRequired": true
    },
    "integrationQueue": {
      "enabled": false,
      "processOneMergeAtATime": true,
      "stopOnMergeConflict": true,
      "requireWorkspaceValidationPass": true,
      "requireIntegrationValidationPass": true,
      "gitPushAllowed": false,
      "queuePriority": {
        "enabled": false,
        "defaultLevel": "normal",
        "levels": [
          "critical",
          "high",
          "normal",
          "low"
        ]
      },
      "queueOptimization": {
        "enabled": false,
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
      "enabled": false,
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
      "enabled": false,
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
      "enabled": false,
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
    "selectedScaleMode": "stable_3",
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
    "expectedDagEffectiveParallelismMin": 2,
    "expectedSafeEffectiveParallelismMin": 2,
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
      "title": "Simulation Scenarios",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; scenario definitions"
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
        "queueOptimizationNotes": "Foundation; scenario definitions"
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
      "title": "Overnight Runner Engine",
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
        "safeParallelismNotes": "Depends on scenarios"
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
        "queueOptimizationNotes": "Depends on scenarios"
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
      "title": "Phase-Scoped Constraints Runner",
      "dependencies": [
        "7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.C must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Independent of runner; parallel with 7.B"
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
        "queueOptimizationNotes": "Independent of runner; parallel with 7.B"
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
      "id": "7.D",
      "title": "Dogfood Checklist Executor",
      "dependencies": [
        "7.B",
        "7.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.D must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on runner and constraints"
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
        "queueOptimizationNotes": "Depends on runner and constraints"
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
      "id": "7.E",
      "title": "Error Injection & Recovery Tests",
      "dependencies": [
        "7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Independent of runner; parallel with 7.B"
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
        "queueOptimizationNotes": "Independent of runner; parallel with 7.B"
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
      "id": "7.F",
      "title": "Metrics Collector",
      "dependencies": [
        "7.D"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.F must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on dogfood execution"
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
        "queueOptimizationNotes": "Depends on dogfood execution"
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
      "title": "Dogfood Report Generator",
      "dependencies": [
        "7.F"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.G must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on metrics"
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
        "queueOptimizationNotes": "Depends on metrics"
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
      "id": "7.H",
      "title": "Overnight Run Report UI",
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
        "safeParallelismNotes": "Depends on report generator"
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
        "queueOptimizationNotes": "Depends on report generator"
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
  "phase": "P20",
  "title": "Overnight Run Report UI",
  "primaryGoal": "Implement and validate the P20 second-brain component.",
  "projectName": "pi-mono",
  "stateBackend": "postgres",
  "selectedScaleMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "requiresWorktreeIsolation": false,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "priority_then_fifo",
  "continuousScheduling": true,
  "continuousSlotCount": 6,
  "safeEffectiveParallelismTarget": 2,
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
  "completionGate": "All P20 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": null
}
```

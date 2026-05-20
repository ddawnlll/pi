# Phase P15 — Goals, Preferences & Decision Policy

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P15`  
**One-line goal:** Give Pi an explicit model of user goals, preferences, autonomy profile, decision classes, approval thresholds, and goal review proposals.  
**Why now:** Memory alone (P14) is not enough. Pi needs to know what it is optimizing for and which actions are auto-safe, approval-gated, or forbidden. This is Milestone 1b — "Pi Understands Goals".  
**Blast radius:** Goal records, preferences, autonomy, decision classification; `packages/coding-agent`, `packages/web-server`, `packages/web-ui/dashboard`, and V2 docs/tests.  
**Rollback path:** Disable newly added V2 capability flags (`GOALS_ENABLED=false`), default autonomy level 1 (Advisor only), keep stores read-only, revert phase commits independently.  
**Scale mode:** `experimental_6`  
**Safe parallelism target:** 3  
**Done when:** P15 exit criteria pass, goals queryable, autonomy level changes take effect, decisions classified, npm validation passes, integration queue clean.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P15` |
| Title | `Goals, Preferences & Decision Policy` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Goal records, preferences, autonomy, decision classification` |
| Product-code changes | `Allowed — Pi runtime/dashboard/tests/docs only` |
| Selected scale mode | `experimental_6` |
| Requested max workers | `3` |
| Expected DAG effective parallelism | `3` |
| Expected safe effective parallelism | `3` |
| Worktree isolation | `Optional` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| P15.A — Goal & Preference Domain Model | Pi Worker Agent | User / owner | Reviewer | User |
| P15.B — Goal Store | Pi Worker Agent | User / owner | Reviewer | User |
| P15.C — Autonomy Profile Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P15.D — Decision Classification V0 | Pi Worker Agent | User / owner | Reviewer | User |
| P15.E — Goal Drift Detector | Pi Worker Agent | User / owner | Reviewer | User |
| P15.F — User Protocol Actions | Pi Worker Agent | User / owner | Reviewer | User |
| P15.G — Goal Board UI Primitive | Pi Worker Agent | User / owner | Reviewer | User |
| P15.H — P15 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Give Pi an explicit model of user goals, preferences, autonomy profile, decision classes, approval thresholds, and goal review proposals.

P15 delivers **Milestone 1b — "Pi Understands Goals"**. Without explicit goals, Pi cannot determine what "useful" means. Without autonomy levels, Pi won't know what it is allowed to do automatically. Without decision classification, Pi cannot distinguish between safe actions and risky ones.

### 2.1 What P15 Solves

Pi V1 was a blind executor — it ran whatever plan it was given. P15 transforms this by giving Pi:

1. **Explicit goal model**: Pi knows what the user is optimizing for
2. **Preference system**: Pi remembers user's preferences about execution, planning, memory
3. **Autonomy profile**: Pi knows its authority boundaries (level 1-4)
4. **Decision classification**: Pi categorizes actions by risk level
5. **Goal drift detection**: Pi notices when proposals stop aligning with goals

### 2.2 Autonomy Levels (from Vision §10)

| Level | Name | Capabilities | Default | Requires Approval For |
|-------|------|-------------|---------|----------------------|
| 1 | Advisor | Generate insights, identify bottlenecks, summarize failures, propose ideas, draft phase plans | ON | Everything beyond reading |
| 2 | Planner | Generate phase plans, validate plans, recommend queue order, prepare approval inbox items | ON | Plan execution |
| 3 | Operator | Run approved queues, retry safe transient failures, pause on dirty queue, produce morning reports | OFF (gated) | Any execution start |
| 4 | Autonomous Strategist | Propose roadmap changes, recommend architecture direction, generate self-improvement plans | OFF | Strategic changes |

### 2.3 Decision Classes (from Vision §5.4)

| Decision Class | Examples |
|----------------|----------|
| **Auto-decide** | Low-risk queue reordering, retrying transient network failures, generating draft proposals, creating read-only summaries |
| **Approval required** | Executing generated plans, protected system mutations, memory indexing of sensitive sources, architecture changes, extension permission expansion |
| **Never auto-decide** | Secrets access, destructive cleanup, git push, irreversible deletion, bypassing validation gates |

### 2.4 Initial Primary Goal (from Vision §9.3)

```text
Build Pi into a trusted second brain that can propose, plan, queue,
execute approved work, and learn from outcomes.
```

### 2.5 Initial Preferences (from Vision §9.4)

```text
Prefer executable plans over ad-hoc changes.
Prefer queueable phases.
Prefer safe automation.
Prefer approval before risky system mutation.
Prefer source-backed memory.
Prefer morning reports after overnight runs.
```

### 2.6 What P15 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Goal Domain Model | `src/brain/goals/types.ts` | Goal, preference, autonomy, decision types |
| Goal Store | `.pi/brain/goals/goals.json` | Persist goals |
| Preference Store | `.pi/brain/goals/preferences.json` | Persist preferences |
| Autonomy Profile | `.pi/brain/goals/autonomy.json` | Persist autonomy profile |
| Autonomy Engine | `src/brain/goals/autonomy.ts` | Level-based permission checks |
| Decision Classifier | `src/brain/goals/decisions.ts` | Action risk classification |
| Goal Drift Detector | `src/brain/goals/drift.ts` | Detection of goal misalignment |
| Goal Board UI | Dashboard component | View and manage goals |

---

## 3. What Carried Over — Must Stay Stable

* [x] P14 memory store and lifecycle
* [x] P13 brain observations and candidate signals
* [x] P12.5 plan queue
* [x] P12.5 PlanQueue still enforces one active plan per project
* [x] The next plan does not start while the integration queue is dirty
* [x] `git push` remains forbidden
* [x] Raw destructive cleanup remains forbidden
* [x] Watch-mode validation remains forbidden
* [x] The executor remains the source of truth for state transitions
* [x] LLM output never directly mutates runtime state
* [x] npm remains the only package manager used for validation

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

* [ ] Every action must be classified before execution (auto/approval/forbidden)
* [ ] Autonomy profile checked before any plan execution
* [ ] Goal drift triggers review proposal (not auto-correction)
* [ ] Preferences affect proposal scoring, not execution bypass
* [ ] Autonomy level changes must be user-initiated

---

## 4. Background / What Was Wrong

Pi V1 could execute plans but had no understanding of what the user was optimizing for. It couldn't answer questions like:

- *"What is the most important thing to work on next?"*
- *"Which plans can run overnight safely?"*
- *"Which decisions require approval?"*
- *"What did we learn from the last run?"*

### 4.1 V1 Limitations Addressed by P15

| V1 Limitation | P15 Solution |
|---------------|--------------|
| No goal awareness | `GoalRecord` with milestones and priorities |
| No preference model | `PreferenceRecord` key-value store |
| No autonomy concept | `AutonomyProfile` with level 1-4 |
| Blind decision-making | `DecisionClassifier` categorizes actions |
| No drift awareness | `GoalDriftDetector` catches misalignment |
| No user protocol | Morning/night session endpoints |

### 4.2 What P15 Does NOT Solve

- Proposal generation (P16)
- Plan creation (P17)
- Policy enforcement (P18)

---

## 5. Current Failure State / Known Blockers

* `p15_goal_and_preference_domain_model` = not implemented
* `p15_goal_store` = not implemented
* `p15_preference_store` = not implemented
* `p15_autonomy_profile_engine` = not implemented
* `p15_decision_classification_v0` = not implemented
* `p15_goal_drift_detector` = not implemented
* `p15_user_protocol_actions` = not implemented
* `p15_goal_board_ui` = not implemented
* `worktree_isolation` = optional for this phase
* `integration_queue` = enabled and required as a cleanliness gate
* `scale_mode_readiness` = experimental_6 ready
* `safe_effective_parallelism` = expected 3

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| User goal mismatch causes bad proposals | med | high | Explicit review; drift detection; user correction |
| Autonomy level set incorrectly | low | critical | Level changes require confirmation; max level gated |
| Decision classifier false positive | med | med | Approve-high-then-tighten approach; audit trail |
| Goal drift noise overwhelms | med | med | Configurable drift threshold; cooldown |
| Preference conflicts | low | low | Explicit priority ordering; user tiebreak |
| LLM generates non-aligned goals | low | high | Goals are system-owned; LLM proposes only |

---

## 7. Workstreams

### 7.A — Goal & Preference Domain Model

**Goal:** Define GoalRecord, PreferenceRecord, AutonomyProfile, DecisionClassification, and all supporting types with schemas.

**Requirements:**
* Implement in runtime-owned TypeScript code
* Every goal has milestones with status tracking
* Preferences are typed (string, boolean, number) with source attribution
* Autonomy levels 1-4 with explicit capability lists
* Decision classification maps actions to decision classes

**Acceptance Criteria:**
* [ ] All types compile without errors
* [ ] Goal milestones trackable individually
* [ ] Preference categories defined
* [ ] Autonomy levels with explicit capabilities
* [ ] Decision class enum complete
* [ ] Test fixtures cover all types

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/types.ts

import type { MemorySourceRef } from '../memory/types';

// ===== Enums & Unions =====

export type AutonomyLevel = 1 | 2 | 3 | 4;

export type GoalStatus = 'active' | 'completed' | 'paused' | 'cancelled' | 'needs_review';

export type GoalPriority = 'critical' | 'high' | 'normal' | 'low';

export type PreferenceSource = 'user_explicit' | 'user_implicit' | 'system_default' | 'learned';

export type DecisionClass = 'auto_decide' | 'approval_required' | 'never_auto_decide';

export type PreferenceCategory = 'execution' | 'planning' | 'memory' | 'proposal' | 'dashboard' | 'autonomy';

// ===== Goal Types =====

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  order: number;
}

export interface GoalRecord {
  id: string; // ULID
  title: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  category: string;
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
  targetDate?: string;
  completedAt?: string;
  relatedMemoryIds: string[];
  metadata: Record<string, unknown>;
}

export interface GoalCreateInput {
  title: string;
  description: string;
  priority?: GoalPriority;
  category?: string;
  milestones?: Omit<Milestone, 'id' | 'createdAt'>[];
  targetDate?: string;
  relatedMemoryIds?: string[];
}

export interface GoalUpdateInput {
  title?: string;
  description?: string;
  priority?: GoalPriority;
  status?: GoalStatus;
  category?: string;
  milestones?: Milestone[];
  targetDate?: string;
  relatedMemoryIds?: string[];
}

// ===== Preference Types =====

export interface PreferenceRecord {
  id: string;
  category: PreferenceCategory;
  key: string;
  value: string | boolean | number;
  source: PreferenceSource;
  confidence: number; // 0-1
  description?: string;
  updatedAt: string;
}

export interface PreferenceCreateInput {
  category: PreferenceCategory;
  key: string;
  value: string | boolean | number;
  source?: PreferenceSource;
  confidence?: number;
  description?: string;
}

// ===== Autonomy Types =====

export interface AutonomyProfile {
  userId: string;
  level: AutonomyLevel;
  approvedCategories: string[];
  forbiddenActions: string[];
  approvalThresholds: Record<string, 'auto' | 'approval' | 'forbidden'>;
  maxAutonomousSpend?: number; // in compute-minutes
  updatedAt: string;
  createdAt: string;
}

export interface AutonomyCapabilities {
  level: AutonomyLevel;
  canGenerateInsights: boolean;
  canProposeIdeas: boolean;
  canGeneratePlans: boolean;
  canValidatePlans: boolean;
  canExecutePlans: boolean;
  canRetryTransientFailures: boolean;
  canProduceReports: boolean;
  canProposeRoadmapChanges: boolean;
  canRecommendArchitecture: boolean;
  requiresApprovalFor: string[];
  forbiddenFor: string[];
}

export const AUTONOMY_CAPABILITIES: Record<AutonomyLevel, AutonomyCapabilities> = {
  1: {
    level: 1,
    canGenerateInsights: true,
    canProposeIdeas: true,
    canGeneratePlans: false,
    canValidatePlans: false,
    canExecutePlans: false,
    canRetryTransientFailures: false,
    canProduceReports: true,
    canProposeRoadmapChanges: false,
    canRecommendArchitecture: false,
    requiresApprovalFor: [
      'memory_creation', 'proposal_submission', 'goal_change',
    ],
    forbiddenFor: [],
  },
  2: {
    level: 2,
    canGenerateInsights: true,
    canProposeIdeas: true,
    canGeneratePlans: true,
    canValidatePlans: true,
    canExecutePlans: false,
    canRetryTransientFailures: false,
    canProduceReports: true,
    canProposeRoadmapChanges: false,
    canRecommendArchitecture: false,
    requiresApprovalFor: [
      'plan_execution', 'system_mutation', 'memory_indexing',
      'architecture_change', 'extension_permission',
    ],
    forbiddenFor: [],
  },
  3: {
    level: 3,
    canGenerateInsights: true,
    canProposeIdeas: true,
    canGeneratePlans: true,
    canValidatePlans: true,
    canExecutePlans: true,
    canRetryTransientFailures: true,
    canProduceReports: true,
    canProposeRoadmapChanges: false,
    canRecommendArchitecture: false,
    requiresApprovalFor: [
      'strategic_change', 'unusual_risk', 'emergency_stop_override',
    ],
    forbiddenFor: [
      'secret_access', 'destructive_cleanup', 'git_push',
      'irreversible_deletion', 'bypass_validation_gate',
    ],
  },
  4: {
    level: 4,
    canGenerateInsights: true,
    canProposeIdeas: true,
    canGeneratePlans: true,
    canValidatePlans: true,
    canExecutePlans: true,
    canRetryTransientFailures: true,
    canProduceReports: true,
    canProposeRoadmapChanges: true,
    canRecommendArchitecture: true,
    requiresApprovalFor: [
      'irreversible_actions', 'policy_override',
    ],
    forbiddenFor: [
      'secret_access', 'destructive_cleanup', 'git_push',
      'irreversible_deletion', 'bypass_validation_gate',
    ],
  },
};

// ===== Decision Types =====

export interface DecisionClassification {
  action: string;
  decisionClass: DecisionClass;
  confidence: number;
  requiresApprovalFrom?: string;
  policyRefs: string[];
  rationale: string;
  autonomyLevel: AutonomyLevel;
}

export interface DecisionRule {
  id: string;
  action: string;
  decisionClass: DecisionClass;
  conditions?: DecisionCondition[];
  priority: number;
  description: string;
}

export interface DecisionCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: unknown;
}

// ===== Drift Types =====

export interface GoalDriftReport {
  id: string;
  goalId: string;
  goalTitle: string;
  severity: 'low' | 'medium' | 'high';
  indicators: DriftIndicator[];
  generatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface DriftIndicator {
  type: 'rejection_pattern' | 'proposal_mismatch' | 'stale_goal' | 'priority_shift';
  details: string;
  evidence: MemorySourceRef[];
  score: number;
}

// ===== Stats =====

export interface GoalsStats {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  byStatus: Record<GoalStatus, number>;
  byPriority: Record<GoalPriority, number>;
  driftReports: number;
  openDriftReports: number;
}
```

**File Scope:** `packages/coding-agent/src/brain/goals/types.ts`, `packages/coding-agent/test/brain/goals/types.test.ts`, `packages/coding-agent/test/fixtures/goals/*.json`

**Dependencies:** P14.A (MemorySourceRef)

---

### 7.B — Goal Store

**Goal:** Persist goals, preferences, and autonomy profile. Query by status, priority, category.

**Requirements:**
* JSON file persistence under `.pi/brain/goals/`
* Atomic writes (write to temp, rename)
* Goals indexed by status and priority
* Preferences indexed by category
* Autonomy profile per user
* No data loss on crash (writes to temp first)

**Acceptance Criteria:**
* [ ] Goals CRUD works correctly
* [ ] Preferences persist and update
* [ ] Autonomy profile save/load works
* [ ] Query by status returns correct results
* [ ] Query by priority returns correct results
* [ ] Atomic writes prevent corruption
* [ ] Missing files handled gracefully

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/store.ts

export interface GoalStoreConfig {
  basePath: string;  // .pi/brain/goals/
}

export interface GoalsData {
  goals: Record<string, GoalRecord>;
  preferences: Record<string, PreferenceRecord>;
  autonomyProfiles: Record<string, AutonomyProfile>;
  driftReports: Record<string, GoalDriftReport>;
  version: number;
}

export class GoalStore {
  private config: GoalStoreConfig;
  private data: GoalsData;
  private writeLock: Promise<void>;
  
  constructor(config?: Partial<GoalStoreConfig>);
  
  // Initialization
  async initialize(): Promise<void>;
  
  // Goals
  async createGoal(input: GoalCreateInput): Promise<GoalRecord>;
  async getGoal(id: string): Promise<GoalRecord | null>;
  async updateGoal(id: string, input: GoalUpdateInput): Promise<GoalRecord>;
  async deleteGoal(id: string): Promise<void>;
  async listGoals(status?: GoalStatus[], priority?: GoalPriority[]): Promise<GoalRecord[]>;
  async completeGoal(id: string): Promise<GoalRecord>;
  
  // Preferences
  async setPreference(input: PreferenceCreateInput): Promise<PreferenceRecord>;
  async getPreference(category: PreferenceCategory, key: string): Promise<PreferenceRecord | null>;
  async listPreferences(category?: PreferenceCategory): Promise<PreferenceRecord[]>;
  async deletePreference(id: string): Promise<void>;
  
  // Autonomy
  async getAutonomyProfile(userId?: string): Promise<AutonomyProfile>;
  async updateAutonomyProfile(profile: Partial<AutonomyProfile>, userId?: string): Promise<AutonomyProfile>;
  async resetAutonomyProfile(userId?: string): Promise<AutonomyProfile>;
  
  // Drift
  async saveDriftReport(report: GoalDriftReport): Promise<void>;
  async getDriftReport(id: string): Promise<GoalDriftReport | null>;
  async listDriftReports(resolved?: boolean): Promise<GoalDriftReport[]>;
  
  // Stats
  async getStats(): Promise<GoalsStats>;
  
  // Persistence
  private async load(): Promise<GoalsData>;
  private async save(): Promise<void>;
  private atomicWrite(path: string, data: string): Promise<void>;
}
```

**File Scope:** `packages/coding-agent/src/brain/goals/store.ts`, `packages/coding-agent/src/brain/goals/index.ts`, `packages/coding-agent/test/brain/goals/store.test.ts`

**Dependencies:** P15.A (types)

---

### 7.C — Autonomy Profile Engine

**Goal:** Manage autonomy levels, check permissions, derive capability sets from level.

**Requirements:**
* Retrieve capabilities for any autonomy level
* Check if a specific action is allowed at current level
* Determine if action needs approval
* Track forbidden actions per profile
* Emergency stop overrides all autonomous actions

**Acceptance Criteria:**
* [ ] Level 1 capabilities are read-only
* [ ] Level 2 requires approval for plan execution
* [ ] Level 3 can execute approved plans but not strategic
* [ ] Level 4 has all strategic capabilities
* [ ] Emergency stop blocks all autonomous actions
* [ ] Forbidden actions blocked regardless of level

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/autonomy.ts

export interface AutonomyConfig {
  defaultLevel: AutonomyLevel;
  maxLevel: AutonomyLevel;
  level3RequiresApproval: boolean;
  emergencyStopped: boolean;
}

export interface AutonomyCheck {
  allowed: boolean;
  requiresApproval: boolean;
  isForbidden: boolean;
  reason?: string;
  requiredLevel?: AutonomyLevel;
}

export class AutonomyEngine {
  private config: AutonomyConfig;
  private emergencyStopActive: boolean = false;
  
  constructor(config?: Partial<AutonomyConfig>);
  
  // Permission checks
  canPerform(
    action: string,
    profile: AutonomyProfile,
    context?: Record<string, unknown>,
  ): AutonomyCheck;
  
  canAutoDecide(
    action: string,
    profile: AutonomyProfile,
  ): boolean;
  
  requiresApproval(
    action: string,
    profile: AutonomyProfile,
  ): boolean;
  
  isForbidden(
    action: string,
    profile: AutonomyProfile,
  ): boolean;
  
  // Capabilities
  getCapabilities(level: AutonomyLevel): AutonomyCapabilities;
  getAllowedActions(profile: AutonomyProfile): string[];
  getForbiddenActions(profile: AutonomyProfile): string[];
  
  // Emergency controls
  isEmergencyStopped(): boolean;
  async emergencyStop(): Promise<void>;
  async releaseEmergencyStop(userId: string): Promise<void>;
  
  // Configuration
  setConfig(config: Partial<AutonomyConfig>): void;
  getConfig(): AutonomyConfig;
  
  // Helpers
  validateTransition(from: AutonomyLevel, to: AutonomyLevel): boolean;
  describeLevel(level: AutonomyLevel): { name: string; description: string };
}

// Usage examples:
// Level 1: autonomy.canPerform('plan_execution', profile)
//   → { allowed: false, requiresApproval: true, isForbidden: false }
//
// Level 1: autonomy.canPerform('generate_insight', profile)
//   → { allowed: true, requiresApproval: false, isForbidden: false }
//
// Level 3: autonomy.canPerform('destructive_cleanup', profile)
//   → { allowed: false, requiresApproval: false, isForbidden: true }
```

**File Scope:** `packages/coding-agent/src/brain/goals/autonomy.ts`, `packages/coding-agent/test/brain/goals/autonomy.test.ts`

**Dependencies:** P15.A (types, AUTONOMY_CAPABILITIES)

---

### 7.D — Decision Classification V0

**Goal:** Classify any action into auto-decide, approval-required, or never-auto-decide based on rules and context.

**Requirements:**
* Built-in rules for common actions (from vision §5.4)
* Rule-based classification with priority ordering
* Extensible — new rules can be added
* Context-aware classification (some actions depend on state)
* All classifications logged for audit

**Acceptance Criteria:**
* [ ] Auto-decide actions not in approval queue
* [ ] Approval-required actions trigger approval request
* [ ] Never-auto-decide actions block immediately
* [ ] Rules prioritize correctly
* [ ] Custom rules can be added via API
* [ ] Classifications produce audit entries

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/decisions.ts

export interface ClassificationContext {
  action: string;
  autonomyLevel: AutonomyLevel;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  proposalType?: string;
  systemState?: 'idle' | 'executing' | 'integration_active';
  affectedArea?: string;
  isProtected?: boolean;
}

export class DecisionClassifier {
  private rules: DecisionRule[] = [];
  
  constructor();
  
  // Core classification
  classify(
    action: string,
    context: ClassificationContext,
  ): DecisionClassification;
  
  classifyWithContext(
    action: string,
    context: ClassificationContext,
  ): DecisionClassification;
  
  // Rule management
  addRule(rule: DecisionRule): void;
  removeRule(ruleId: string): void;
  getRules(): DecisionRule[];
  setRules(rules: DecisionRule[]): void;
  
  // Default rules
  private initDefaultRules(): void;
  
  // Helpers
  isAutoDecide(action: string, context?: ClassificationContext): boolean;
  isApprovalRequired(action: string, context?: ClassificationContext): boolean;
  isNeverAutoDecide(action: string, context?: ClassificationContext): boolean;
}

// Default rules seeded at construction:
const DEFAULT_RULES: DecisionRule[] = [
  // Auto-decide
  { id: 'auto_001', action: 'retry_transient_failure', decisionClass: 'auto_decide', priority: 100, description: 'Retry safe transient failures' },
  { id: 'auto_002', action: 'generate_draft_proposal', decisionClass: 'auto_decide', priority: 100, description: 'Generate draft proposals' },
  { id: 'auto_003', action: 'create_read_only_summary', decisionClass: 'auto_decide', priority: 100, description: 'Create read-only summaries' },
  { id: 'auto_004', action: 'low_risk_queue_reorder', decisionClass: 'auto_decide', priority: 90, description: 'Reorder queue for efficiency', conditions: [{ field: 'riskLevel', operator: 'eq', value: 'low' }] },
  
  // Approval required
  { id: 'appr_001', action: 'execute_generated_plan', decisionClass: 'approval_required', priority: 100, description: 'Execute a generated plan' },
  { id: 'appr_002', action: 'protected_system_mutation', decisionClass: 'approval_required', priority: 100, description: 'Mutate protected system' },
  { id: 'appr_003', action: 'memory_index_sensitive_source', decisionClass: 'approval_required', priority: 100, description: 'Index sensitive source' },
  { id: 'appr_004', action: 'architecture_change', decisionClass: 'approval_required', priority: 90, description: 'Change architecture' },
  { id: 'appr_005', action: 'extension_permission_expansion', decisionClass: 'approval_required', priority: 90, description: 'Expand extension permissions' },
  
  // Never auto-decide (hard stops)
  { id: 'forbid_001', action: 'secret_access', decisionClass: 'never_auto_decide', priority: 1000, description: 'Access secrets' },
  { id: 'forbid_002', action: 'destructive_cleanup', decisionClass: 'never_auto_decide', priority: 1000, description: 'Raw destructive cleanup' },
  { id: 'forbid_003', action: 'git_push', decisionClass: 'never_auto_decide', priority: 1000, description: 'Push to git' },
  { id: 'forbid_004', action: 'irreversible_deletion', decisionClass: 'never_auto_decide', priority: 1000, description: 'Irreversible deletion' },
  { id: 'forbid_005', action: 'bypass_validation_gate', decisionClass: 'never_auto_decide', priority: 1000, description: 'Bypass validation gates' },
];
```

**File Scope:** `packages/coding-agent/src/brain/goals/decisions.ts`, `packages/coding-agent/test/brain/goals/decisions.test.ts`

**Dependencies:** P15.A (types)

---

### 7.E — Goal Drift Detector

**Goal:** Monitor proposal rejection patterns vs active goals, detect drift, create goal review proposals.

**Requirements:**
* Track rejection patterns per goal
* Compare rejected proposals to goal alignment
* Threshold: 3+ rejections of same-goal-aligned proposals → drift
* Time window configurable (default 7 days)
* Create drift report, not auto-correction
* Integrate with memory (P14) for evidence

**Acceptance Criteria:**
* [ ] Detects drift when rejection threshold reached
* [ ] Creates drift report with evidence
* [ ] Does not auto-correct goals
* [ ] Drift report references specific proposals
* [ ] Configurable thresholds
* [ ] Memory evidence included

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/drift.ts

export interface DriftDetectorConfig {
  rejectionThreshold: number;   // default 3
  windowDays: number;           // default 7
  mismatchThreshold: number;    // default 0.5
  checkIntervalHours: number;   // default 24
}

export interface DriftCheckState {
  lastCheck: string;
  lastDriftIds: string[];
  rejectionCount: number;
}

export class GoalDriftDetector {
  private config: DriftDetectorConfig;
  private store: GoalStore;
  private state: DriftCheckState;
  
  constructor(store: GoalStore, config?: Partial<DriftDetectorConfig>);
  
  // Core detection
  async checkDrift(
    activeGoals: GoalRecord[],
    recentRejections: Array<{ proposal: unknown; goalIds: string[] }>,
  ): Promise<GoalDriftReport[]>;
  
  // Per-goal analysis
  async analyzeGoalDrift(
    goal: GoalRecord,
    rejectionHistory: Array<{ proposal: unknown; reason?: string }>,
  ): Promise<GoalDriftReport | null>;
  
  // Indicator computation
  private computeRejectionPattern(rejections: unknown[]): DriftIndicator[];
  private computeProposalMismatch(goal: GoalRecord, rejections: unknown[]): DriftIndicator[];
  private computeStaleness(goal: GoalRecord): DriftIndicator | null;
  private computePriorityShift(goal: GoalRecord, preferences: PreferenceRecord[]): DriftIndicator | null;
  
  // Proposal creation
  async createDriftProposal(report: GoalDriftReport): Promise<{ drift: GoalDriftReport; proposalId?: string }>;
  
  // Configuration
  setConfig(config: Partial<DriftDetectorConfig>): void;
  getConfig(): DriftDetectorConfig;
  
  // Scheduled check
  async runScheduledCheck(): Promise<GoalDriftReport[]>;
}
```

**File Scope:** `packages/coding-agent/src/brain/goals/drift.ts`, `packages/coding-agent/test/brain/goals/drift.test.ts`

**Dependencies:** P15.B (store), P14.A (memory types)

---

### 7.F — User Protocol Actions

**Goal:** Implement morning protocol, daytime protocol, night protocol, rejection protocol, and memory correction protocol from vision §11.

**Requirements:**
* Morning protocol: what ran, what completed, what stopped, what changed, learned, needs approval, top 3 next actions
* Daytime protocol: approve, reject, correct, change goals, enqueue, pause, ask why
* Night protocol: approved queue, autonomy level, stop conditions, notification preferences
* Rejection protocol: record proposal id, reason, category, suppression, memory update
* Memory correction protocol: mark rejected/superseded, stop use, audit trail, write corrected

**Acceptance Criteria:**
* [ ] Morning report endpoint returns structured data
* [ ] Daytime actions all functional
* [ ] Night protocol accepts configuration
* [ ] Rejection records are complete
* [ ] Memory correction propagates correctly

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/goals/protocol.ts

export interface MorningReportData {
  date: string;
  whatRan: Array<{ planId: string; planTitle: string; status: string }>;
  whatCompleted: Array<{ planId: string; planTitle: string }>;
  whatStopped: Array<{ planId: string; planTitle: string; reason: string }>;
  whatChanged: string[];
  whatLearned: string[];
  needsApproval: Array<{ type: string; id: string; description: string }>;
  top3NextActions: string[];
  artifactLinks: Array<{ label: string; path: string }>;
}

export interface NightProtocolConfig {
  queue: string[];
  autonomyLevel: AutonomyLevel;
  stopConditions: StopCondition[];
  maxDurationHours: number;
  notificationEmail?: string;
  generateMorningReport: boolean;
}

export type StopCondition =
  | 'integration_queue_dirty'
  | 'merge_conflict'
  | 'policy_violation'
  | 'low_confidence_unsafe'
  | 'user_intervention'
  | 'error_threshold_exceeded';

export interface RejectionRecord {
  id: string;
  proposalId: string;
  proposedAt: string;
  rejectedAt: string;
  rejectionReason?: string;
  category: string;
  affected: string[];
  suppressSimilar: boolean;
  memoryUpdated: boolean;
  updatedMemoryId?: string;
}

export interface MemoryCorrectionRecord {
  id: string;
  originalMemoryId: string;
  correctedMemoryId?: string;
  reason: string;
  action: 'rejected' | 'superseded' | 'corrected';
  createdAt: string;
  createdBy: string;
}

export class UserProtocol {
  constructor(
    private goalStore: GoalStore,
    private autonomyEngine: AutonomyEngine,
    private observationEngine?: unknown,
  );
  
  // Morning
  async getMorningData(): Promise<MorningReportData>;
  async generateMorningMarkdown(): Promise<string>;
  
  // Daytime
  async processApproval(requestId: string, approved: boolean, by: string): Promise<void>;
  async processRejection(proposalId: string, by: string, reason?: string): Promise<RejectionRecord>;
  async processMemoryCorrection(
    memoryId: string, correction: string, by: string,
  ): Promise<MemoryCorrectionRecord>;
  
  // Night
  async configureNightRun(config: NightProtocolConfig): Promise<{ sessionId: string }>;
  async startNightRun(sessionId: string): Promise<void>;
  async checkNightRunStatus(sessionId: string): Promise<{ status: string; progress: number }>;
  
  // Explain
  async explainDecision(action: string, context: Record<string, unknown>): Promise<DecisionExplanation>;
}

export interface DecisionExplanation {
  action: string;
  decision: DecisionClassification;
  reasoning: string;
  applicableRules: DecisionRule[];
  autonomyLevel: AutonomyLevel;
  appealOptions: string[];
}
```

**File Scope:** `packages/coding-agent/src/brain/goals/protocol.ts`, `packages/web-server/src/routes/brain/protocol.ts`

**Dependencies:** P15.B (store), P15.C (autonomy), P15.D (decisions)

---

### 7.G — Goal Board UI Primitive

**Goal:** Dashboard component showing active goals, their priorities, milestones, and status.

**Requirements:**
* Card-style goal display with priority indicator
* Milestone progress per goal
* Goal CRUD actions (add, edit, complete)
* Status filter tabs
* Goal drift alerts badge

**Acceptance Criteria:**
* [ ] Goals list renders with priority badge
* [ ] Milestone progress shows percentage
* [ ] Add goal form works
* [ ] Edit goal form works
* [ ] Complete goal action works
* [ ] Status filters work
* [ ] Drift badge appears when drift detected

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    goals/
      GoalBoard.tsx           # Main page component
      GoalCard.tsx            # Individual goal card
      GoalDetail.tsx          # Goal detail with milestones
      GoalForm.tsx            # Add/Edit form
      MilestoneTracker.tsx    # Milestone progress bar
      GoalFilters.tsx         # Status/priority filters
      DriftAlertBadge.tsx     # Drift indicator badge
      index.ts
```

**Data Flow:**
```
GoalBoard loads from GET /api/brain/goals
→ Displays GoalCards in grid
→ Each GoalCard shows priority badge, status, milestone progress
→ Click card → GoalDetail with full milestone list
→ GoalForm via Add/Edit button
→ DriftAlertBadge reads from GET /api/brain/goals/drift
```

**File Scope:** `packages/web-ui/dashboard/src/components/brain/goals/*.tsx`, `packages/web-ui/dashboard/src/pages/BrainGoals.tsx`

**Dependencies:** P15.F (API endpoints)

---

### 7.H — P15 Dogfood & Report

**Goal:** Run P15, create example goals and preferences, verify autonomy checks, verify decision classification, produce dogfood report.

**Requirements:**
* Create primary goal (from vision §9.3)
* Set initial preferences (from vision §9.4)
* Test each autonomy level
* Classify example actions
* Test drift detection
* Generate dogfood report

**Acceptance Criteria:**
* [ ] Goal CRUD works end-to-end
* [ ] Autonomy level checks work
* [ ] Decision classification works
* [ ] Drift detection works (if rejection history exists)
* [ ] Dashboard shows goals
* [ ] Dogfood report generated

**Dogfood Report Template:**

```markdown
# P15 Dogfood Report

## Environment
- Pi version:
- Goals enabled: true
- P14 memory available: true/false

## Goals
- Total goals: X
- Active: X
- Completed: X
- Primary goal set: yes/no

## Preferences
- Total preferences: X
- By category: { ... }

## Autonomy
- Current level: X
- Level changes tested: [1,2,3,4]
- Emergency stop tested: yes/no

## Decision Classification
- Rules loaded: X
- Actions tested: X
- Auto-decide: X
- Approval required: X
- Forbidden: X

## Drift Detection
- Drift reports: X
- Threshold reached: X times

## API Performance
- Goal CRUD latency: Xms
- Preference latency: Xms

## Issues Found
- [List]

## Next Steps
- [Recommendations for P16]
```

**File Scope:** `docs/pi/v2/dogfood/p15-dogfood-report.md`

---

## 8. Combined Implementation Order

```text
Phase: P15 — Goals, Preferences & Decision Policy
==================================================

Batch 1 (Foundation):
  P15.A — Goal & Preference Domain Model

Batch 2 (Persistence):
  P15.B — Goal Store

Batch 3 (Core Logic):
  P15.C — Autonomy Profile Engine
  P15.D — Decision Classification V0
  P15.E — Goal Drift Detector

Batch 4 (User Interface):
  P15.F — User Protocol Actions
  P15.G — Goal Board UI Primitive

Batch 5 (Validation):
  P15.H — P15 Dogfood & Report
```

**Dependency Rationale:**
- Types (P15.A) must exist first
- Store (P15.B) depends on types
- Autonomy, decisions, drift depend on store
- Protocol depends on store + autonomy + decisions
- UI depends on API
- Dogfood needs everything working

---

## 9. API Endpoints

```
# Goals
GET    /api/brain/goals                          # List goals (filters: status, priority)
POST   /api/brain/goals                          # Create goal
GET    /api/brain/goals/{id}                     # Get goal detail
PUT    /api/brain/goals/{id}                     # Update goal
DELETE /api/brain/goals/{id}                     # Delete goal
POST   /api/brain/goals/{id}/complete            # Mark goal completed
POST   /api/brain/goals/{id}/pause               # Pause goal
POST   /api/brain/goals/{id}/resume              # Resume goal
GET    /api/brain/goals/stats                    # Goal statistics

# Preferences
GET    /api/brain/preferences                    # List preferences (filter: category)
POST   /api/brain/preferences                    # Set preference
DELETE /api/brain/preferences/{id}               # Delete preference

# Autonomy
GET    /api/brain/autonomy                       # Get current profile
PUT    /api/brain/autonomy                       # Update profile
POST   /api/brain/autonomy/level                 # Change level
POST   /api/brain/autonomy/emergency_stop        # Emergency stop
POST   /api/brain/autonomy/release               # Release emergency stop
GET    /api/brain/autonomy/capabilities          # Get level capabilities
GET    /api/brain/autonomy/check?action=xxx      # Check if action allowed

# Decision Classification
GET    /api/brain/decisions/rules                # Get decision rules
PUT    /api/brain/decisions/rules                # Set decision rules
POST   /api/brain/decisions/classify             # Classify an action
POST   /api/brain/decisions/explain              # Explain a classification

# Protocol
GET    /api/brain/protocol/morning               # Morning report data
POST   /api/brain/protocol/night                 # Configure night run
GET    /api/brain/protocol/night/{sessionId}     # Night run status

# Drift
GET    /api/brain/goals/drift                    # List drift reports
GET    /api/brain/goals/drift/{id}               # Get drift report
POST   /api/brain/goals/drift/{id}/resolve       # Resolve drift
```

---

## 10. Definition of Done

P15 is complete when ALL are true:

* [ ] Goal & Preference Domain Model — types compile, test fixtures created
* [ ] Goal Store — CRUD works, preferences persist, autonomy profile loaded
* [ ] Autonomy Profile Engine — level checks correct, capabilities derived
* [ ] Decision Classification V0 — actions classified correctly, rules extensible
* [ ] Goal Drift Detector — detects drift at threshold, reports created
* [ ] User Protocol Actions — morning/night/rejection protocols implemented
* [ ] Goal Board UI — goals displayed, CRUD works, drift badge shown
* [ ] P15 Dogfood Report — complete report generated
* [ ] Integration queue is clean or intentionally blocked with handoff
* [ ] No forbidden commands or files were used
* [ ] Typecheck/build/test requirements passed

---

## 11. Rollback Playbook

**Trigger conditions:**
* Goal corruption — goals don't load or save correctly
* Autonomy misconfiguration — Pi allows forbidden action
* Decision classifier false negatives — blocked safe actions
* Drift false positives — excessive alerts

**Rollback procedure:**
1. Set environment variable `GOALS_ENABLED=false`
2. Default autonomy level to 1 (Advisor only)
3. Keep goal files as read-only
4. Decision classifier falls back to `approval_required` for everything
5. Goal UI pages return "not available" state

**Expected outcome:** Memory and observations continue working autonomously, actions require approval by default.

---

## 12. What Next Phase Inherits

**P16 inherits:**
* Goal store with active goals
* Preference records for scoring
* Decision classifier for auto-queuing
* Autonomy profile for proposal generation level

**P16 may add:**
* Proposal domain model
* Proposal generator that uses goals
* Proposal scoring that uses preferences
* Auto-queue logic using decision classifier


---

# Part 2 — Agent Brief

## Mission

Implement all P15 — P15 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
* Goal drift reports must not modify goals directly
* Autonomy level changes require approval

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
    "phase": "P15",
    "title": "Goals, Preferences & Decision Policy",
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
      "title": "Goal Model & Store",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; all others depend on goal types"
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
        "queueOptimizationNotes": "Foundation; all others depend on goal types"
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
      "title": "User Preference Profiles",
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
        "safeParallelismNotes": "Depends on goal types; no file overlap with 7.A"
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
        "queueOptimizationNotes": "Depends on goal types; no file overlap with 7.A"
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
      "id": "7.C",
      "title": "Autonomy Level System",
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
        "safeParallelismNotes": "Depends on goal types; separate file set"
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
        "queueOptimizationNotes": "Depends on goal types; separate file set"
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
      "title": "Decision Classifier",
      "dependencies": [
        "7.A",
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
        "safeParallelismNotes": "Depends on goals and autonomy"
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
        "queueOptimizationNotes": "Depends on goals and autonomy"
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
      "title": "Goals REST API",
      "dependencies": [
        "7.A",
        "7.B",
        "7.C"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on core goals subsystems"
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
        "queueOptimizationNotes": "Depends on core goals subsystems"
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
      "title": "Goals & Preferences UI",
      "dependencies": [
        "7.E"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.F must complete before dependent workspaces can start.",
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
      "id": "7.G",
      "title": "P15 Dogfood & Report",
      "dependencies": [
        "7.E",
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
  "phase": "P15",
  "title": "P15 Dogfood & Report",
  "primaryGoal": "Implement and validate the P15 second-brain component.",
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
  "completionGate": "All P15 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P16"
}
```

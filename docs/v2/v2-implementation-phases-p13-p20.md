# Pi V2 — Implementation Phases P13-P20

**Path:** `docs/pi/v2/v2-implementation-phases-p13-p20.md`  
**Status:** Authoritative Implementation Guide  
**Date:** 2026-05-19  
**Purpose:** Complete implementation guide for the V2 second-brain cognitive operating system phases P13-P20, mapping the vision to executable workstreams with explicit API contracts, data models, and execution policies.

This document serves as the index and architectural overview for all V2 phase implementations. Each phase file under `docs/pi/phases/` contains full specification.

---

## Phase Overview

| Phase | Title | Goal | Architecture Component |
|-------|-------|------|------------------------|
| **P13** | Brain Core Vertical Slice & Orchestrator Daemon | Build first usable Brain Core: deterministic observations, brain timeline, retry/failure signals, first reflection summary, safe daemon lifecycle | Observation Engine V0, Brain Timeline, Daemon |
| **P14** | Memory V0, Provenance & Conflict Model | Durable typed memory with lifecycle, scoring, conflict detection, correction flow | Memory Engine V0 |
| **P15** | Goals, Preferences & Decision Policy | Explicit goal model, autonomy profile, decision classification | Goal & Intention Model |
| **P16** | Proposal Engine V0 | Evidence-backed proposals with scoring, risk assessment, deduplication, cooldowns | Proposal Engine |
| **P17** | Plan Factory & Reflection Loop | Convert proposals to executable plans, generate source-backed reflections | Plan Factory, Reflection Engine |
| **P18** | Trust, Policy, Audit & Approval Controls | Centralized trust controls, policy enforcement, audit ledger, approval gates | Trust Layer |
| **P19** | Full Second-Brain Dashboard & Autonomy UX | Complete dashboard: brain state viewer, proposal inbox, memory explorer, goal board, autonomy controls | Dashboard V2 |
| **P20** | V2 Dogfood: Overnight Autonomous Roadmap Execution | End-to-end cognitive loop validation: overnight queues, reports, reflections, memory, trust assessment | Full Integration |

---

## P13 Implementation Details

### Vertical Slice Scope (Milestone 0 — "Pi Sees")

P13 builds the foundational observation capabilities. Without P13, later phases have no input signals.

**Core Components:**
1. **Brain Domain Model** (`packages/coding-agent/src/brain/types.ts`)
   - `BrainObservation`: `{ id, timestamp, source, signalType, severity, evidence, provenance, metadata }`
   - `BrainSignal`: `{ id, observationIds, pattern, summary, confidence }`
   - `BrainTimelineEvent`: `{ id, eventType, timestamp, data, workspaceId, planExecId }`

2. **Brain Timeline Store** (`.pi/brain-timeline.ndjson`)
   - Append-only NDJSON append
   - Line corruption tolerance via parse-skip
   - Rotation guard at 100MB

3. **Observation Engine V0**
   - Queue health observer: monitors plan queue vs integration queue state
   - Execution journal observer: watches `.pi/execution-journal/*.json`
   - Retry/failure signal extractor: parses workspace outcomes for patterns

4. **Safe Brain Daemon Lifecycle**
   - Starts on Pi startup, stops on graceful shutdown
   - Produces heartbeat events every 60s
   - No recursion, no external API calls without policy

5. **Brain API Endpoints** (`/api/brain/*`)
   - `GET /api/brain/timeline` — paginated timeline events
   - `GET /api/brain/observations` — filtered observations
   - `GET /api/brain/signals` — active signals

6. **Minimal Brain State Viewer** (Dashboard)
   - Timeline visualization (last 100 events)
   - Signal summary cards
   - Observation count by severity

**API Contracts:**
```typescript
interface BrainObservation {
  id: string;
  timestamp: string; // ISO 8601
  source: 'queue' | 'execution' | 'integration' | 'validation' | 'user';
  signalType: 'retry_hotspot' | 'failure_pattern' | 'queue_blocked' | 'integration_dirty' | 'validation_failure';
  severity: 'info' | 'warning' | 'critical';
  evidence: SourceRef[];
  provenance: ProvenanceInfo;
  metadata: Record<string, unknown>;
}

interface BrainSignal {
  id: string;
  observationIds: string[];
  pattern: string;
  summary: string;
  confidence: number; // 0-1
  createdAt: string;
  resolvedAt?: string;
}

interface BrainTimelineEvent {
  id: string;
  eventType: 'observation' | 'signal' | 'reflection' | 'daemon_heartbeat' | 'daemon_start' | 'daemon_stop';
  timestamp: string;
  data: Record<string, unknown>;
  workspaceId?: string;
  planExecId?: string;
}
```

**Workstreams:**
- P13.A: Brain Domain Model (types, fixtures, tests)
- P13.B: Brain Timeline Store (persistence, reader, rotation)
- P13.C: Observation Engine V0 (queue, journal, signal extraction)
- P13.D: Queue Health Observer (plan vs integration state)
- P13.E: Execution Journal Observer (workspace outcome parsing)
- P13.F: Retry/Failure Signal Extractor (pattern detection)
- P13.G: First Reflection Summary (post-plan reflection)
- P13.H: Safe Brain Daemon Lifecycle (start/stop/heartbeat)
- P13.I: Brain API Endpoints (REST endpoints)
- P13.J: Minimal Brain State Viewer (dashboard UI)
- P13.K: P13 Dogfood & Report

**Dependencies:**
- None required — this is the foundational layer
- Must use existing P12.5 stores (read-only)

**Rollback path:**
- Disable via `BRAIN_ENABLED=false` env var
- Keep timeline store read-only
- Remove API routes via config

---

## P14 Implementation Details

### Memory V0 (Milestone 1a — "Pi Remembers")

P14 builds durable memory with provenance and conflict resolution.

**Core Components:**
1. **Memory Domain Model** (`packages/coding-agent/src/brain/memory/types.ts`)
   - `MemoryRecord`: `{ id, type, content, lifecycle, confidence, provenance, createdAt, expiresAt, sourceRefs }`
   - `MemoryConflict`: `{ id, recordIds, conflictType, scores, resolution }`
   - `MemorySourceRef`: `{ type, path, lineStart?, lineEnd?, commit?, timestamp }`

2. **Memory Store** (`.pi/brain/memory/*.json`)
   - JSON file backend per memory record
   - Index file for fast lookup by type/lifecycle
   - Conflict store separately

3. **Memory Lifecycle Engine**
   - States: `candidate` | `active` | `disputed` | `superseded` | `expired` | `rejected_by_user` | `needs_review`
   - Automatic expiry after 90 days (configurable)
   - User approval triggers promotion to `active`

4. **Memory Scoring Engine**
   - Confidence: evidence count × source quality weight × recency
   - Conflict score: contradiction detection via semantic overlap
   - Relevance: keyword + type + lifecycle weight

5. **Conflict Detection**
   - Same-type memory with contradictory content
   - Scores above threshold trigger `disputed` state
   - Resolution: user chooses, or auto-pick highest confidence

6. **Memory Correction API**
   - `POST /api/brain/memory/{id}/reject` — mark rejected
   - `POST /api/brain/memory/{id}/supersede` — create replacement
   - `POST /api/brain/memory/{id}/approve` — promote to active

**API Contracts:**
```typescript
type MemoryType = 
  | 'project_memory'
  | 'architecture_memory'
  | 'plan_memory'
  | 'failure_memory'
  | 'decision_memory'
  | 'execution_memory'
  | 'idea_memory'
  | 'user_preference_memory';

type MemoryLifecycle = 
  | 'candidate'
  | 'active'
  | 'disputed'
  | 'superseded'
  | 'expired'
  | 'rejected_by_user'
  | 'needs_review';

interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  lifecycle: MemoryLifecycle;
  confidence: number; // 0-1
  provenance: ProvenanceInfo;
  sourceRefs: MemorySourceRef[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersededBy?: string;
  affectedBy?: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}

interface MemoryConflict {
  id: string;
  recordIds: [string, string];
  conflictType: 'contradiction' | 'duplicate' | 'staleness';
  scores: { [recordId: string]: number };
  resolution?: 'auto_resolved' | 'user_selected' | 'pending';
  resolvedBy?: string;
  resolvedAt?: string;
}

interface MemoryQuery {
  types?: MemoryType[];
  lifecycle?: MemoryLifecycle[];
  tags?: string[];
  searchText?: string;
  minConfidence?: number;
  limit?: number;
}
```

**Workstreams:**
- P14.A: Memory Domain Model
- P14.B: Memory Store (persistence layer)
- P14.C: Memory Lifecycle Engine
- P14.D: Memory Scoring Engine
- P14.E: Conflict Detection
- P14.F: Memory Correction API
- P14.G: Memory Review UI Primitive
- P14.H: P14 Dogfood & Report

**Dependencies:**
- P13: Uses observations as memory source
- P13: Uses brain timeline for provenance

**Rollback path:**
- Disable memory layer via `MEMORY_ENABLED=false`
- Existing memories remain as read-only files

---

## P15 Implementation Details

### Goals & Decision Policy (Milestone 1b — "Pi Understands Goals")

P15 gives Pi explicit goals, preferences, and decision classification.

**Core Components:**
1. **Goal Domain Model** (`packages/coding-agent/src/brain/goals/types.ts`)
   - `GoalRecord`: `{ id, title, description, priority, status, createdAt, targetDate?, milestones }`
   - `PreferenceRecord`: `{ id, category, key, value, source, confidence }`
   - `AutonomyProfile`: `{ level: 1-4, approvedCategories, forbiddenActions, approvalThresholds }`

2. **Goal Store** (`.pi/brain/goals/*.json`)
   - Goal records with milestone tracking
   - Preference key-value store
   - Autonomy profile per user

3. **Autonomy Profile Engine**
   - Levels: Advisor (1), Planner (2), Operator (3), Autonomous Strategist (4)
   - Level 1: Generate insights, suggest — default ON
   - Level 2: Generate plans, queue bundles — default ON, approval required
   - Level 3: Run approved queues — default approval-gated
   - Level 4: Propose roadmap changes — default OFF

4. **Decision Classification V0**
   - Auto-decide: low-risk queue reordering, retry transient failures, generate drafts
   - Approval required: execute plans, protected system mutations, architecture changes
   - Never auto-decide: secrets, destructive cleanup, git push, irreversible deletion

5. **Goal Drift Detector**
   - Monitors rejection patterns vs active goals
   - Creates goal review proposals when drift detected
   - Thresholds: 3+ rejections of goal-aligned proposals = drift

6. **Goal Board UI Primitive**
   - Active goals list
   - Priority indicators
   - Progress tracking

**API Contracts:**
```typescript
type AutonomyLevel = 1 | 2 | 3 | 4;

type GoalStatus = 'active' | 'completed' | 'paused' | 'cancelled' | 'needs_review';

type DecisionClass = 'auto_decide' | 'approval_required' | 'never_auto_decide';

interface GoalRecord {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
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

interface PreferenceRecord {
  id: string;
  category: 'execution' | 'planning' | 'memory' | 'proposal' | 'dashboard';
  key: string;
  value: string | boolean | number;
  source: 'user_explicit' | 'user_implicit' | 'system_default' | 'learned';
  confidence: number;
  updatedAt: string;
}

interface AutonomyProfile {
  userId: string;
  level: AutonomyLevel;
  approvedCategories: string[];
  forbiddenActions: string[];
  approvalThresholds: {
    [action: string]: 'auto' | 'approval' | 'forbidden';
  };
  maxAutonomousSpend?: number; // in compute minutes
  updatedAt: string;
}

interface DecisionClassification {
  action: string;
  decisionClass: DecisionClass;
  confidence: number;
  requiresApprovalFrom?: string;
  policyRefs: string[];
}
```

**Workstreams:**
- P15.A: Goal & Preference Domain Model
- P15.B: Goal Store
- P15.C: Autonomy Profile Engine
- P15.D: Decision Classification V0
- P15.E: Goal Drift Detector
- P15.F: User Protocol Actions
- P15.G: Goal Board UI Primitive
- P15.H: P15 Dogfood & Report

**Dependencies:**
- P14: Memory retrieval for goal context
- P13: Observations for drift detection

**Rollback path:**
- Disable goal layer via `GOALS_ENABLED=false`
- Profile defaults to level 1 (Advisor only)

---

## P16 Implementation Details

### Proposal Engine V0 (Milestone 2a — "Pi Proposes")

P16 generates useful evidence-backed proposals with scoring.

**Core Components:**
1. **Proposal Domain Model** (`packages/coding-agent/src/brain/proposals/types.ts`)
   - `Proposal`: `{ id, type, title, description, evidence, risk, score, status, createdAt, expiresAt }`
   - `ProposalEvidence`: `{ memoryIds, observationIds, sourceRefs, confidence }`
   - `ProposalRiskAssessment`: `{ level, factors, mitigation }`
   - `ProposalScore`: `{ total, novelty, confidence, urgency, feasibility }`

2. **Proposal Generator**
   - Triggered by: observation accumulation, memory patterns, goal alignment, reflection output
   - Generates: memory proposals, plan proposals, goal revision proposals, autonomy adjustment proposals
   - Deduplication via content hash
   - Cooldown: same proposal type within 24h requires new evidence

3. **Proposal Scoring**
   - Total = (novelty × 0.2) + (confidence × 0.3) + (urgency × 0.2) + (feasibility × 0.3)
   - Threshold for auto-queue: score ≥ 0.7 AND confidence ≥ 0.6
   - Below threshold: goes to approval inbox

4. **Proposal Inbox** (Dashboard)
   - Top 3 proposals displayed
   - Accept/Reject/Correct actions
   - Proposal detail view with evidence

**API Contracts:**
```typescript
type ProposalType = 
  | 'memory_proposal'
  | 'plan_proposal'
  | 'goal_revision_proposal'
  | 'autonomy_adjustment_proposal'
  | 'reflection_proposal'
  | 'safety_proposal';

type ProposalStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'expired'
  | 'executed';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface Proposal {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  evidence: ProposalEvidence;
  risk: ProposalRiskAssessment;
  score: ProposalScore;
  status: ProposalStatus;
  createdAt: string;
  expiresAt?: string;
  submittedBy: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  executedAsPlanId?: string;
  relatedProposalIds: string[];
  metadata: Record<string, unknown>;
}

interface ProposalEvidence {
  memoryIds: string[];
  observationIds: string[];
  sourceRefs: MemorySourceRef[];
  confidence: number;
}

interface ProposalRiskAssessment {
  level: RiskLevel;
  factors: string[];
  mitigation: string[];
  affectedSystems: string[];
}

interface ProposalScore {
  total: number;
  novelty: number;     // 0-1: how new is this
  confidence: number;  // 0-1: evidence quality
  urgency: number;     // 0-1: how time-sensitive
  feasibility: number; // 0-1: can we execute it
}

interface ProposalQuery {
  status?: ProposalStatus[];
  type?: ProposalType[];
  minScore?: number;
  limit?: number;
  offset?: number;
}
```

**Workstreams:**
- P16.A: Proposal Domain Model
- P16.B: Proposal Generator
- P16.C: Proposal Scoring Engine
- P16.D: Deduplication & Cooldown
- P16.E: Top-3 Inbox Logic
- P16.F: Proposal API Endpoints
- P16.G: Proposal Inbox UI Primitive
- P16.H: P16 Dogfood & Report

**Dependencies:**
- P14: Memory records as evidence
- P13: Observations as triggers
- P15: Goals for relevance scoring

**Rollback path:**
- Disable proposal engine via `PROPOSALS_ENABLED=false`
- Pending proposals remain in queue as drafts

---

## P17 Implementation Details

### Plan Factory & Reflection Loop (Milestone 2b — "Pi Plans & Reflects")

P17 converts proposals into executable plans and generates reflections.

**Core Components:**
1. **Plan Factory** (`packages/coding-agent/src/brain/plan-factory/`)
   - Input: Approved proposal
   - Output: Phase markdown (markdown file + JSON contract)
   - Uses master template v2.5.1
   - Auto-populates: workstreams, dependencies, metadata

2. **Reflection Engine** (`packages/coding-agent/src/brain/reflection/`)
   - Triggered: after plan completion
   - Input: execution journal, validation results, workspace outcomes
   - Output: reflection report + memory update proposals + future plan suggestions
   - Must be source-backed — no hallucinations

3. **Reflection Output Artifacts**
   - `.pi/brain/reflections/{planExecId}/reflection-summary.md`
   - `.pi/brain/reflections/{planExecId}/reflection-summary.json`
   - Contains: what ran, what worked, what failed, what should be remembered

**API Contracts:**
```typescript
interface ReflectionInput {
  planExecId: string;
  planId: string;
  executionJournal: ExecutionJournalEntry[];
  workspaceOutcomes: WorkspaceOutcome[];
  validationResults: ValidationResult[];
  integrationState: IntegrationState;
  duration: number;
}

interface ReflectionReport {
  id: string;
  planExecId: string;
  summary: string;
  whatRan: string[];
  whatWorked: string[];
  whatFailed: string[];
  whatSlowedDown: string[];
  memoriesToCreate: Partial<MemoryRecord>[];
  proposalsToGenerate: Partial<Proposal>[];
  futurePhaseSuggestions: FuturePhaseSuggestion[];
  createdAt: string;
  confidence: number;
}

interface FuturePhaseSuggestion {
  title: string;
  rationale: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  estimatedWorkstreams: number;
  relatedMemoryIds: string[];
}

interface PlanFactoryInput {
  proposalId: string;
  goalId?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  autonomyLevel?: 1 | 2 | 3 | 4;
}

interface PlanFactoryOutput {
  phaseMarkdownPath: string;
  phaseJsonContract: PlanExecutionContract;
  generatedAt: string;
  confidence: number;
}
```

**Workstreams:**
- P17.A: Plan Factory Engine
- P17.B: Master Template Integration
- P17.C: Reflection Engine
- P17.D: Source-Backed Summary Generator
- P17.E: Memory Update Proposal Generator
- P17.F: Future Phase Suggestion Engine
- P17.G: Reflection API Endpoints
- P17.H: Reflection Viewer UI
- P17.I: P17 Dogfood & Report

**Dependencies:**
- P16: Approved proposals as input
- P13: Execution journal for reflection
- P14: Memory creation from reflection

**Rollback path:**
- Disable plan factory via `PLAN_FACTORY_ENABLED=false`
- Disable reflection via `REFLECTION_ENABLED=false`

---

## P18 Implementation Details

### Trust, Policy, Audit & Approval Controls

P18 centralizes trust boundaries and ensures autonomy is bounded.

**Core Components:**
1. **Policy Engine** (`packages/coding-agent/src/brain/policy/`)
   - Policy rules in JSON: `rules/*.json`
   - Decision: allow, deny, approval_required, forbidden
   - Logs all decisions to audit

2. **Approval Gate** (`packages/coding-agent/src/brain/approvals/`)
   - Queue for pending approvals
   - User action: approve, reject, defer
   - Timeout: 24h default (configurable)

3. **Audit Ledger** (`.pi/brain/audit/*.ndjson`)
   - Every decision logged with provenance
   - Append-only, immutable
   - Queryable by: timestamp, actor, decision type

4. **Provenance Tracker**
   - Links every action to source observations/memories
   - Enables "why did Pi do this?" questions
   - Exports evidence chains for review

**API Contracts:**
```typescript
type PolicyDecision = 'allow' | 'deny' | 'approval_required' | 'forbidden';

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
  decision: PolicyDecision;
  metadata: Record<string, unknown>;
}

interface PolicyCondition {
  action: string;
  contextMatch?: Record<string, unknown>;
  threshold?: number;
}

interface ApprovalRequest {
  id: string;
  proposalId: string;
  action: string;
  rationale: string;
  risk: ProposalRiskAssessment;
  requestedAt: string;
  deadline?: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  rejectedBy?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  actor: 'pi' | 'user' | 'system';
  action: string;
  decision: PolicyDecision;
  policyRuleId?: string;
  proposalId?: string;
  planExecId?: string;
  memoryId?: string;
  evidence: SourceRef[];
  result: 'success' | 'failure';
  metadata: Record<string, unknown>;
}
```

**Workstreams:**
- P18.A: Policy Engine V0
- P18.B: Policy Rule Store
- P18.C: Approval Gate
- P18.D: Approval Queue API
- P18.E: Audit Ledger
- P18.F: Provenance Tracker
- P18.G: Trust Dashboard UI
- P18.H: P18 Dogfood & Report

**Dependencies:**
- All prior phases feed into policy decisions
- Audit requires all components

**Rollback path:**
- Set all policies to `approval_required`
- Keep audit ledger for debugging

---

## P19 Implementation Details

### Full Second-Brain Dashboard & Autonomy UX

P19 exposes the full V2 experience through the dashboard.

**Core Components:**
1. **Brain State Viewer**
   - Live observation stream
   - Active signals
   - Memory summary charts
   - Goal progress

2. **Proposal Inbox**
   - Top 3 prioritized
   - Accept/Reject/Correct
   - Evidence detail view

3. **Memory Explorer**
   - Search by type, tag, text
   - Lifecycle filters
   - Memory detail + edit

4. **Goal Board**
   - Active goals with progress
   - Priority visualization
   - Milestone tracking

5. **Autonomy Controls**
   - Level 1-4 toggle
   - Approval threshold config
   - Forbidden actions list
   - Emergency stop button

6. **Reflection Timeline**
   - Past reflections
   - Memory creation status
   - Future suggestions

7. **Overnight Run Panel**
   - Queue selection
   - Autonomy level
   - Stop conditions
   - Schedule timing

**Dashboard API Endpoints:**
```typescript
// Brain State
GET  /api/brain/state           // Current brain status
GET  /api/brain/observations    // Filtered observations
GET  /api/brain/signals         // Active signals
GET  /api/brain/timeline        // Paginated timeline

// Proposals
GET  /api/brain/proposals       // Filtered proposals
POST /api/brain/proposals/{id}/accept
POST /api/brain/proposals/{id}/reject
POST /api/brain/proposals/{id}/correct

// Memory
GET  /api/brain/memory          // Search memories
POST /api/brain/memory          // Add memory
PUT  /api/brain/memory/{id}     // Update memory
POST /api/brain/memory/{id}/reject
POST /api/brain/memory/{id}/supersede

// Goals
GET  /api/brain/goals           // List goals
POST /api/brain/goals           // Create goal
PUT  /api/brain/goals/{id}      // Update goal
GET  /api/brain/goals/{id}/progress

// Autonomy
GET  /api/brain/autonomy        // Current profile
PUT  /api/brain/autonomy        // Update profile
POST /api/brain/autonomy/emergency_stop

// Approvals
GET  /api/brain/approvals       // Pending approvals
POST /api/brain/approvals/{id}/approve
POST /api/brain/approvals/{id}/reject

// Reflection
GET  /api/brain/reflections     // Past reflections
GET  /api/brain/reflections/{planExecId}

// Overnight
POST /api/brain/overnight/queue // Queue for overnight
GET  /api/brain/overnight/status
```

**Workstreams:**
- P19.A: Brain State Viewer Component
- P19.B: Proposal Inbox Component
- P19.C: Memory Explorer Component
- P19.D: Goal Board Component
- P19.E: Autonomy Controls Component
- P19.F: Reflection Timeline Component
- P19.G: Overnight Run Panel
- P19.H: Dashboard API Integration
- P19.I: P19 Dogfood & Report

**Dependencies:**
- All prior phases (P13-P18)

---

## P20 Implementation Details

### V2 Dogfood: Overnight Autonomous Roadmap Execution

P20 validates the complete loop end-to-end.

**Validation Criteria:**
1. Overnight run completes without human intervention
2. Morning report shows actionable summary
3. Memory persists and is queryable post-run
4. Reflections generate useful memory updates
5. Trust controls prevent unauthorized actions
6. Approval queue processes correctly when needed

**Test Scenarios:**
1. **Full autonomous run**: Level 3 autonomy, approved queue, sleeps through
2. **Approval needed**: Proposal generated, queued for approval, waits
3. **Safety stop**: Integration dirty, queue stops, handoff created
4. **Reflection loop**: Plan completes, reflection runs, memories created
5. **Morning report**: Report generated with correct summary

**Workstreams:**
- P20.A: Overnight Run Orchestration
- P20.B: Morning Report Generator
- P20.C: Full Loop Validation
- P20.D: Trust Assessment
- P20.E: Dogfood Report

---

## Phase Dependencies Summary

```text
                    P13 ──┐
                          ├──── P14 ──┐
                          │           ├──── P15 ──┐
                          │           │           ├──── P16 ──┐
                          │           │           │           ├──── P17 ──┤
                          │           │           │           │           ├──── P18 ──┤
                          │           │           │           │           │           ├──── P19 ──┤
                          │           │           │           │           │           │           └──── P20

Independent:     P13
After P13:       P14
After P14:       P15
After P15:       P16
After P16:       P17
After P17:       P18
After P18:       P19
After P19:       P20

All phases depend on P12.5 execution core (must remain stable).
```

---

## Execution Policies (Global)

```yaml
brain:
  enabled_by_default: false
  daemon_heartbeat_interval: 60
  timeline_rotation_threshold_mb: 100
  observation_batch_size: 10

memory:
  default_ttl_days: 90
  conflict_threshold: 0.7
  auto_activate_confidence: 0.8
  max_active_memories: 1000

proposals:
  auto_queue_threshold: 0.7
  min_confidence_for_auto: 0.6
  cooldown_hours: 24
  top_display_count: 3
  max_pending: 50

goals:
  drift_rejection_threshold: 3
  review_proposal_on_drift: true

autonomy:
  default_level: 1
  max_level: 4
  level_3_requires_approval: true
  level_4_default_off: true

reflection:
  enabled: true
  auto_memory_creation: false
  source_backed_only: true

policy:
  default_decision: approval_required
  audit_retention_days: 365
  auto_expire_approvals_hours: 24

overnight:
  max_duration_hours: 8
  default_stop_conditions:
    - integration_queue_dirty
    - merge_conflict
    - policy_violation
    - low_confidence_unsafe
    - user_intervention
```

---

## Rollback Coordination

If V2 must be rolled back at any phase:

1. **P13-P14 rollback**: Disable brain, disable memory — execution continues unaffected
2. **P15-P17 rollback**: Disable goals, proposals, plan factory — manual planning required
3. **P18-P20 rollback**: Disable policies to approval-required, keep audit for debugging

All rollbacks preserve artifacts in `.pi/brain/` for post-mortem analysis.

---

## Success Criteria Per Phase

| Phase | Criterion |
|-------|-----------|
| P13 | Brain timeline shows observations; daemon runs; API returns data |
| P14 | Memory persists; lifecycle transitions work; conflict detection triggers |
| P15 | Goals queryable; autonomy level changes take effect; decisions classified |
| P16 | Proposals generated; scoring accurate; inbox shows top-3 |
| P17 | Plans generated from proposals; reflections create memory proposals |
| P18 | Policy decisions logged; approvals process; audit entries queryable |
| P19 | Dashboard shows all components; UI actions trigger API correctly |
| P20 | Overnight runs complete; morning reports accurate; full loop validated |

---

## Related Documents

- `docs/pi/v2/second-brain-vision.md` — Vision and architecture
- `docs/pi/v2/changed-files-analysis.md` — File-level impact
- `docs/llm-implementation-agent-master-template.md` — Execution contract template
- `docs/pi/phases/phase_p13_*.md` through `phase_p20_*.md` — Individual phase specs

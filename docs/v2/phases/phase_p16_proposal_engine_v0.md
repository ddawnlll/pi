# Phase P16 — Proposal Engine V0

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P16`  
**One-line goal:** Generate useful evidence-backed proposals with scoring, risk assessment, deduplication, cooldowns, and a top-3 proposal inbox.  
**Why now:** P14 has memory, P15 has goals. P16 combines observations + memory + goals into actionable proposals. This is Milestone 2a — "Pi Proposes".  
**Blast radius:** Proposal generation, scoring, risk assessment, deduplication, cooldown, inbox; `packages/coding-agent`, `packages/web-server`, `packages/web-ui/dashboard`.  
**Rollback path:** Disable via `PROPOSALS_ENABLED=false`, pending proposals remain as drafts, no new auto-generation.  
**Scale mode:** `stable_3`
**Safe parallelism target:** 3  
**Done when:** P16 exit criteria pass, proposals generated correctly, scoring matches thresholds, deduplication works, top-3 inbox shows prioritized proposals, integration queue clean.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P16` |
| Title | `Proposal Engine V0` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Proposals, scoring, risk assessment, deduplication, cooldown, inbox` |
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
| P16.A — Proposal Domain Model | Pi Worker Agent | User / owner | Reviewer | User |
| P16.B — Proposal Generator | Pi Worker Agent | User / owner | Reviewer | User |
| P16.C — Proposal Scoring Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P16.D — Deduplication & Cooldown | Pi Worker Agent | User / owner | Reviewer | User |
| P16.E — Top-3 Inbox Logic | Pi Worker Agent | User / owner | Reviewer | User |
| P16.F — Proposal API | Pi Worker Agent | User / owner | Reviewer | User |
| P16.G — Proposal Inbox UI | Pi Worker Agent | User / owner | Reviewer | User |
| P16.H — P16 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Generate useful evidence-backed proposals from observations + memory + goals. P16 is where Pi stops being a passive executor and starts actively recommending actions that serve the user's goals.

### 2.1 Proposal Types (from Vision §13.4)

| Type | Description | Trigger |
|------|-------------|---------|
| `memory_proposal` | Create, update, or correct a memory record | Observation accumulation, memory conflict, staleness |
| `plan_proposal` | Generate a new implementation phase plan | Goal alignment + memory pattern + opportunity |
| `goal_revision_proposal` | Change, add, or archive goals | Goal drift detected |
| `autonomy_adjustment_proposal` | Change autonomy level or approval thresholds | Behavior pattern, trust assessment shift |
| `reflection_proposal` | Generate post-plan reflection | Plan completion |
| `safety_proposal` | Policy, security, or safety improvement | Safety signal, policy violation pattern |

### 2.2 Scoring Model (from Vision §6.3)

```
Total Score = (novelty × 0.2) + (confidence × 0.3) + (urgency × 0.2) + (feasibility × 0.3)

Thresholds:
  - Auto-queue threshold: total ≥ 0.7 AND confidence ≥ 0.6
  - Top-3 display: highest scoring proposals
  - Below auto-queue: goes to approval inbox
```

### 2.3 What P16 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Proposal Domain Model | `src/brain/proposals/types.ts` | Proposal types, statuses, scoring |
| Proposal Generator | `src/brain/proposals/generator.ts` | Generate proposals from triggers |
| Scoring Engine | `src/brain/proposals/scoring.ts` | Score proposals by dimension |
| Deduplication | `src/brain/proposals/dedup.ts` | Content-hash dedup + cooldown |
| Inbox Logic | `src/brain/proposals/inbox.ts` | Top-3 prioritization |
| Proposal API | `/api/brain/proposals/*` | CRUD + accept/reject |
| Proposal Inbox UI | Dashboard component | Top-3 display + actions |

---

## 3. What Carried Over — Must Stay Stable

* [x] P15 goals, preferences, autonomy profile, decision classification
* [x] P14 memory store and lifecycle
* [x] P13 brain observations and candidate signals
* [x] P12.5 plan queue
* [x] Integration queue gate
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

* [ ] Every proposal must carry evidence references (memory IDs or observation IDs)
* [ ] Proposals without evidence confidence ≥ 0.3 are rejected at generation
* [ ] Auto-queue only for proposals meeting score and confidence thresholds
* [ ] Cooldown prevents same-type proposals within 24 hours
* [ ] User rejection creates record with suppression option

---

## 4. Background / What Was Wrong

Pi V1 generated nothing — it only executed. The V2 cognitive loop (observe → remember → think → propose → plan → execute → reflect → improve) has a gap at "think" and "propose".

### 4.1 V1 Limitations Addressed

| V1 Limitation | P16 Solution |
|---------------|--------------|
| No idea generation | Proposal generator from observations+memory+goals |
| No action ranking | Scoring engine with quantifiable dimensions |
| No duplicate prevention | Content-hash deduplication |
| No cooldown | Type-based cooldown timer |
| No prioritization | Top-3 inbox with score ordering |
| No evidence linking | Every proposal references evidence |

### 4.2 Example Proposal Flow

```
Observation: "Workspace A retried 5 times"
→ Memory lookup: similar patterns in failure_memory
→ Goal check: aligns with "reduce retries" goal
→ Proposal: "Add retry budget check to plan splitting logic"
→ Score: novelty=0.6, confidence=0.7, urgency=0.5, feasibility=0.8
→ Total: 0.67 (below auto-queue) → approval inbox
→ User: accepts
→ P17: converts to phase plan
```

---

## 5. Current Failure State / Known Blockers

* `p16_proposal_domain_model` = not implemented
* `p16_proposal_generator` = not implemented
* `p16_proposal_scoring` = not implemented
* `p16_proposal_deduplication` = not implemented
* `p16_proposal_inbox` = not implemented
* `p16_proposal_api` = not implemented
* `p16_proposal_ui` = not implemented
* `worktree_isolation` = optional
* `integration_queue` = enabled and required
* `scale_mode_readiness` = experimental_6 ready

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| Proposal flood overwhelms user | med | high | Top-3 display; scoring threshold; cooldown |
| Low-quality proposals waste trust | med | med | Evidence requirement; confidence threshold |
| Duplicate proposals noisy | med | low | Content-hash dedup; cooldown |
| LLM hallucination in proposal evidence | med | high | Evidence must reference real memory/observation IDs |
| Auto-queue executes bad plan | low | critical | Only proposals meeting high thresholds auto-queued |
| Score gaming (LLM optimizes for score) | low | low | Scores computed by runtime; LLM doesn't see formula |

---

## 7. Workstreams

### 7.A — Proposal Domain Model

**Goal:** Define Proposal, ProposalEvidence, ProposalRiskAssessment, ProposalScore, ProposalQuery, and all supporting types.

**Requirements:**
* Implement in runtime-owned TypeScript code
* Every proposal has evidence references and risk assessment
* Status lifecycle: draft → pending_approval → approved/rejected/superseded/expired/executed
* Typed proposal categories (from vision §13.4)
* Query interface for filtering and sorting

**Acceptance Criteria:**
* [ ] All types compile without errors
* [ ] Status lifecycle complete
* [ ] Evidence references required
* [ ] Risk assessment fields complete
* [ ] Test fixtures cover all proposal types

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/proposals/types.ts

import type { MemorySourceRef, MemoryRecord } from '../memory/types';
import type { GoalRecord } from '../goals/types';
import type { BrainObservation } from '../types';

// ===== Enums =====

export type ProposalType =
  | 'memory_proposal'
  | 'plan_proposal'
  | 'goal_revision_proposal'
  | 'autonomy_adjustment_proposal'
  | 'reflection_proposal'
  | 'safety_proposal';

export type ProposalStatus =
  | 'draft'             // Being generated
  | 'pending_approval'  // Awaiting user decision
  | 'approved'          // User accepted
  | 'rejected'          // User rejected
  | 'superseded'        // Replaced by newer proposal
  | 'expired'           // Time-based expiry (default 30 days)
  | 'executed';         // Plan created from this

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ===== Core Types =====

export interface ProposalEvidence {
  memoryIds: string[];
  observationIds: string[];
  sourceRefs: MemorySourceRef[];
  confidence: number;        // 0-1, how strong is the evidence
  evidenceSummary: string;
}

export interface ProposalRiskAssessment {
  level: RiskLevel;
  factors: string[];
  mitigation: string[];
  affectedSystems: string[];
  impactDescription: string;
}

export interface ProposalScore {
  total: number;       // 0-1, weighted combination
  novelty: number;     // 0-1, how different from existing proposals
  confidence: number;  // 0-1, evidence quality + source trust
  urgency: number;     // 0-1, time-sensitivity score
  feasibility: number; // 0-1, can we execute this (resource check)
}

export interface Proposal {
  id: string; // ULID
  type: ProposalType;
  title: string;
  description: string;
  evidence: ProposalEvidence;
  risk: ProposalRiskAssessment;
  score: ProposalScore;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;      // default +30 days
  submittedBy: string;     // 'pi' or 'user'
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  executedAsPlanId?: string;  // P17 creates plan from this
  relatedProposalIds: string[];
  relatedGoalIds: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}

// ===== Input Types =====

export interface ProposalCreateInput {
  type: ProposalType;
  title: string;
  description: string;
  evidence: ProposalEvidence;
  risk: ProposalRiskAssessment;
  score?: ProposalScore;
  relatedGoalIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProposalUpdateInput {
  status?: ProposalStatus;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  executedAsPlanId?: string;
  tags?: string[];
}

// ===== Query Types =====

export interface ProposalQuery {
  status?: ProposalStatus[];
  type?: ProposalType[];
  minScore?: number;
  maxScore?: number;
  tag?: string;
  relatedGoalId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'score' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface ProposalStats {
  totalProposals: number;
  byStatus: Record<ProposalStatus, number>;
  byType: Record<ProposalType, number>;
  averageScore: number;
  acceptanceRate: number;
  pendingApprovalCount: number;
  expiredCount: number;
}

// ===== Inbox Types =====

export interface InboxEntry {
  proposal: Proposal;
  rank: number;        // 1-3 for top-3
  reason: string;      // Why this proposal is here
  recommendation: 'auto_approve' | 'review' | 'reject';
  relatedMemorySummaries: string[];
  relatedObservationSummaries: string[];
}

export interface InboxView {
  entries: InboxEntry[];
  totalPending: number;
  lastUpdated: string;
}
```

**File Scope:** `packages/coding-agent/src/brain/proposals/types.ts`, `packages/coding-agent/test/brain/proposals/types.test.ts`, `packages/coding-agent/test/fixtures/proposals/*.json`

**Dependencies:** P14.A (MemorySourceRef), P15.A (GoalRecord), P13.A (BrainObservation)

---

### 7.B — Proposal Generator

**Goal:** Generate proposals from triggers: observation accumulation, memory patterns, goal alignment, plan completion.

**Requirements:**
* Trigger from: N observations accumulated, memory pattern detected, goal alignment scan, plan completion signal
* Generates typed proposals with evidence references
* LLM generates proposal content but runtime validates evidence
* No proposal without at least one evidence reference
* Proposal body structured for downstream consumption

**Acceptance Criteria:**
* [ ] Observation trigger: accumulates N observations → generates proposal
* [ ] Memory trigger: detects pattern → generates proposal
* [ ] Goal trigger: aligns goals with observations → generates proposal
* [ ] Plan completion trigger: generates reflection proposal
* [ ] Evidence validation rejects proposals with missing refs

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/proposals/generator.ts

export interface GeneratorConfig {
  observationAccumulationThreshold: number;   // default 5
  memoryPatternWindowHours: number;           // default 72
  goalAlignmentScanIntervalHours: number;     // default 24
  cooldownHours: number;                      // default 24
  maxProposalsPerBatch: number;               // default 3
  enableAutoGeneration: boolean;              // default false
}

export type GenerationTrigger =
  | { type: 'observations'; observationIds: string[] }
  | { type: 'memory_pattern'; memoryIds: string[]; pattern: string }
  | { type: 'goal_alignment'; goalIds: string[]; observationIds: string[] }
  | { type: 'plan_completion'; planExecId: string; reflectionId: string }
  | { type: 'safety_signal'; signal: string; observationIds: string[] }
  | { type: 'manual'; userId: string; input: string };

export class ProposalGenerator {
  private config: GeneratorConfig;
  private store: ProposalStore;
  private dedup: ProposalDeduplication;
  
  constructor(store: ProposalStore, dedup: ProposalDeduplication, config?: Partial<GeneratorConfig>);
  
  // Core generation
  async generate(trigger: GenerationTrigger): Promise<Proposal[]>;
  async generateFromObservations(observations: BrainObservation[]): Promise<Proposal[]>;
  async generateFromMemoryPattern(memories: MemoryRecord[], pattern: string): Promise<Proposal[]>;
  async generateGoalAlignmentProposal(goal: GoalRecord, observations: BrainObservation[]): Promise<Proposal[]>;
  async generateReflectionProposal(reflection: ReflectionReport): Promise<Proposal[]>;
  async generateSafetyProposal(signal: string, observations: BrainObservation[]): Promise<Proposal[]>;
  
  // Builder
  private buildProposal(
    type: ProposalType,
    title: string,
    description: string,
    evidence: ProposalEvidence,
    risk: ProposalRiskAssessment,
    goals?: GoalRecord[],
  ): ProposalCreateInput;
  
  // Evidence assembly
  private buildEvidence(
    memoryIds: string[],
    observationIds: string[],
    sourceRefs: MemorySourceRef[],
    confidence: number,
  ): ProposalEvidence;
  
  // Risk assessment
  private assessRisk(
    type: ProposalType,
    affectedSystems: string[],
    impact: string,
  ): ProposalRiskAssessment;
  
  // Validation
  validateEvidence(evidence: ProposalEvidence): boolean;
  validateRisk(risk: ProposalRiskAssessment): boolean;
  
  // Triggers
  checkObservationTrigger(observations: BrainObservation[]): BrainObservation[];
  checkMemoryPatternTrigger(memories: MemoryRecord[]): MemoryRecord[];
  checkGoalTrigger(goals: GoalRecord[], observations: BrainObservation[]): boolean;
  
  // Configuration
  setConfig(config: Partial<GeneratorConfig>): void;
}
```

**File Scope:** `packages/coding-agent/src/brain/proposals/generator.ts`, `packages/coding-agent/test/brain/proposals/generator.test.ts`

**Dependencies:** P16.A (types), P16.D (dedup), P13.A (BrainObservation), P14.A (MemoryRecord), P15.A (GoalRecord)

---

### 7.C — Proposal Scoring Engine

**Goal:** Score proposals across four dimensions: novelty, confidence, urgency, feasibility. Compute total score for auto-queue decision.

**Requirements:**
* Novelty: compare to existing proposals (higher for unique ones)
* Confidence: evidence quality × source trust
* Urgency: time-sensitivity based on observations
* Feasibility: resource check (do we have capabilities?)
* Total: weighted combination
* Auto-queue: total ≥ 0.7 AND confidence ≥ 0.6

**Acceptance Criteria:**
* [ ] Novelty correctly scores unique vs repeat proposals
* [ ] Confidence increases with evidence quality
* [ ] Urgency reflects time-sensitivity
* [ ] Feasibility checks available capabilities
* [ ] Thresholds enforced: auto-queue only at ≥0.7 and ≥0.6

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/proposals/scoring.ts

export interface ScoringConfig {
  weights: {
    novelty: number;     // default 0.2
    confidence: number;  // default 0.3
    urgency: number;     // default 0.2
    feasibility: number; // default 0.3
  };
  autoQueueThreshold: number;     // default 0.7
  autoQueueConfidenceMin: number; // default 0.6
  noveltyLookbackDays: number;    // default 14
}

export class ProposalScoringEngine {
  private config: ScoringConfig;
  
  constructor(config?: Partial<ScoringConfig>);
  
  // Full scoring
  async score(
    proposal: ProposalCreateInput,
    existingProposals: Proposal[],
    context?: { goals?: GoalRecord[]; autonomyLevel?: number },
  ): Promise<ProposalScore>;
  
  // Dimension scoring
  calculateNovelty(
    proposal: ProposalCreateInput,
    existingProposals: Proposal[],
  ): number;
  
  calculateConfidence(
    evidence: ProposalEvidence,
  ): number;
  
  calculateUrgency(
    proposal: ProposalCreateInput,
    goals?: GoalRecord[],
  ): number;
  
  calculateFeasibility(
    proposal: ProposalCreateInput,
    autonomyLevel?: number,
  ): number;
  
  // Helpers
  calculateTotal(score: Omit<ProposalScore, 'total'>): number;
  shouldAutoQueue(score: ProposalScore): boolean;
  
  // Configuration
  setConfig(config: Partial<ScoringConfig>): void;
}

// Novelty calculation:
// novelty = 1 - (maxSimilarity / existingProposals.length)
// where similarity = word overlap + type match + length similarity
// Returns 0.0 to 1.0

// Confidence calculation:
// confidence = evidence.confidence × sourceQuality
// where sourceQuality = quality of referenced sources (observations > memories)
// Returns 0.0 to 1.0

// Urgency calculation:
// urgency = observationRecency × observationFrequency × goalUrgency
// Returns 0.0 to 1.0

// Feasibility calculation:
// feasibility = capabilityCheck × resourceCheck × complexityCheck
// Returns 0.0 to 1.0

// Total formula:
// total = novelty × 0.2 + confidence × 0.3 + urgency × 0.2 + feasibility × 0.3

// Score calibration strategy:
// Weights are initialized to the vision-default values above.
// After 50 proposals with user feedback, audit weight effectiveness:
//   - If confidence score consistently misaligns with user acceptance rate → adjust confidence weight up/down by 0.05.
//   - If high-novelty proposals are rejected at >60% rate → decrease novelty weight by 0.05.
//   - If urgency consistently drives acceptance but feasibility is ignored → swap 0.05 weight from feasibility to urgency.
// Auto-queue threshold (0.7) is conservative by design; bias toward human review until calibration data exists.
```

**File Scope:** `packages/coding-agent/src/brain/proposals/scoring.ts`, `packages/coding-agent/test/brain/proposals/scoring.test.ts`

**Dependencies:** P16.A (types)

---

### 7.D — Deduplication & Cooldown

**Goal:** Prevent duplicate proposals using content hashing and enforce type-based cooldown periods.

**Requirements:**
* Content hash based on proposal type + title + description similarity
* Same content within 24h → suppressed
* Same proposal type within cooldown → suppressed (unless new evidence)
* Log suppressed proposals for audit
+ Cooldown: memory_proposal=12h, plan_proposal=24h, others=24h

**Acceptance Criteria:**
* [ ] Exact duplicate detected by content hash
* [ ] Similar proposal within cooldown suppressed
* [ ] Different evidence → allowed even within cooldown
* [ ] Suppressed proposals logged
* [ ] Configurable cooldown per type

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/proposals/dedup.ts

export interface DedupConfig {
  cooldowns: Record<ProposalType, number>; // hours
  similarityThreshold: number;             // default 0.8
  enabled: boolean;
  hashAlgorithm: 'sha256' | 'similarity';
}

export const DEFAULT_COOLDOWNS: Record<ProposalType, number> = {
  memory_proposal: 12,       // 12 hours
  plan_proposal: 24,         // 24 hours
  goal_revision_proposal: 24,
  autonomy_adjustment_proposal: 48,
  reflection_proposal: 12,
  safety_proposal: 0,        // no cooldown for safety
};

export class ProposalDeduplication {
  private config: DedupConfig;
  private history: Map<string, { proposal: ProposalCreateInput; timestamp: string }[]> = new Map();
  
  constructor(config?: Partial<DedupConfig>);
  
  // Duplicate check
  isDuplicate(
    proposal: ProposalCreateInput,
    recentProposals: Proposal[],
  ): { isDuplicate: boolean; matchReason?: string; similarProposalId?: string };
  
  // Cooldown check
  isInCooldown(
    proposal: ProposalCreateInput,
    recentProposals: Proposal[],
  ): { isInCooldown: boolean; remainingHours?: number };
  
  // Content hashing
  hashProposal(proposal: ProposalCreateInput): string;
  calculateSimilarity(a: ProposalCreateInput, b: ProposalCreateInput): number;
  
  // Suppression
  shouldSuppress(
    proposal: ProposalCreateInput,
    recentProposals: Proposal[],
  ): { suppress: boolean; reason?: string };
  
  // History
  recordHistory(proposal: ProposalCreateInput): void;
  getHistory(type?: ProposalType): typeof this.history;
  clearHistory(before: string): void;
  
  // Configuration
  setConfig(config: Partial<DedupConfig>): void;
  getCooldownForType(type: ProposalType): number;
}
```

**File Scope:** `packages/coding-agent/src/brain/proposals/dedup.ts`, `packages/coding-agent/test/brain/proposals/dedup.test.ts`

**Dependencies:** P16.A (types)

---

### 7.E — Top-3 Inbox Logic

**Goal:** Select and rank the top 3 proposals for user display. Sort by score, diversify by type, consider urgency.

**Requirements:**
* Pick pending_approval proposals
* Sort by score (highest first)
* Limit to top 3 by default (configurable)
* Diversify: at most 2 proposals of same type
* Include evidence summary for each
* Reason for recommendation: auto_approve, review, or reject

**Acceptance Criteria:**
* [ ] Returns exactly top 3 (or fewer if not enough)
* [ ] No more than 2 of same type
* [ ] Sorted by score descending
* [ ] Each entry has evidence summary
* [ ] Clear recommendation label
* [ ] Updates on accept/reject

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/proposals/inbox.ts

export interface InboxConfig {
  topCount: number;           // default 3
  maxPerType: number;         // default 2
  includeExpiring: boolean;   // default true
  expirePendingDays: number;  // default 7
}

export class ProposalInbox {
  private config: InboxConfig;
  private store: ProposalStore;
  
  constructor(store: ProposalStore, config?: Partial<InboxConfig>);
  
  // Core inbox
  async getInbox(): Promise<InboxView>;
  async refreshInbox(): Promise<void>;
  
  // Selection logic
  private selectTopProposals(proposals: Proposal[]): Proposal[];
  private diversifyProposals(proposals: Proposal[]): Proposal[];
  private rankProposals(proposals: Proposal[]): Proposal[];
  
  // Recommendation
  private recommend(proposal: Proposal): InboxEntry['recommendation'];
  private buildReason(proposal: Proposal): string;
  
  // Expiry
  async checkExpired(): Promise<Proposal[]>;
  async expireOldProposals(): Promise<number>;
  
  // Stats
  async getInboxStats(): Promise<{
    totalPending: number;
    autoApproved: number;
    urgentCount: number;
    expiredCount: number;
  }>;
}
```

**File Scope:** `packages/coding-agent/src/brain/proposals/inbox.ts`, `packages/coding-agent/test/brain/proposals/inbox.test.ts`

**Dependencies:** P16.A (types), P16.B (store)

---

### 7.F — Proposal API

**Goal:** REST API for proposal CRUD, accept/reject, inbox, stats.

**Acceptance Criteria:**
* [ ] All endpoints return correct data
* [ ] Accept sets status to approved, creates audit entry
* [ ] Reject sets status to rejected, records reason
* [ ] Inbox returns top 3
* [ ] Stats endpoint works
* [ ] Error handling for invalid IDs

**API Specifications:**

```
GET    /api/brain/proposals                    # List proposals (query: status, type, minScore, limit, offset)
POST   /api/brain/proposals                    # Create proposal
GET    /api/brain/proposals/{id}               # Get single proposal
PUT    /api/brain/proposals/{id}               # Update proposal
DELETE /api/brain/proposals/{id}               # Delete proposal
POST   /api/brain/proposals/{id}/accept        # Accept proposal (body: { approvedBy: string })
POST   /api/brain/proposals/{id}/reject        # Reject proposal (body: { rejectedBy: string, reason?: string })
POST   /api/brain/proposals/{id}/correct       # Correct proposal (body: { corrections: Partial<Proposal> })
POST   /api/brain/proposals/{id}/expire        # Manually expire
GET    /api/brain/proposals/inbox              # Top-3 inbox view
GET    /api/brain/proposals/stats              # Proposal statistics
GET    /api/brain/proposals/{id}/evidence      # Get evidence detail
```

**File Scope:** `packages/web-server/src/routes/brain/proposals.ts`, `packages/coding-agent/src/brain/proposals/api.ts`

**Dependencies:** P16.B (generator), P16.E (inbox)

---

### 7.G — Proposal Inbox UI

**Goal:** Dashboard component showing top-3 proposals with accept/reject/correct actions.

**Requirements:**
* Top-3 proposal cards with score display
* Accept, reject, correct buttons
* Evidence expandable drawer
* Empty state when no pending proposals
* Toast notifications on actions

**Acceptance Criteria:**
* [ ] Top-3 proposals displayed
* [ ] Accept button XHRs correctly
* [ ] Reject with reason modal works
* [ ] Evidence drawer shows references
* [ ] Inbox refreshes after action
* [ ] Empty state shown correctly

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    proposals/
      ProposalInbox.tsx              # Main inbox page
      ProposalCard.tsx               # Proposal card with score
      EvidenceDrawer.tsx             # Expandable evidence view
      AcceptButton.tsx               # Accept action
      RejectButton.tsx               # Reject with modal
      CorrectForm.tsx                # Correction form
      EmptyState.tsx                 # Empty state
      index.ts
```

**Dashboard Page:** `/brain/inbox`

**File Scope:** `packages/web-ui/dashboard/src/components/brain/proposals/*.tsx`, `packages/web-ui/dashboard/src/pages/BrainInbox.tsx`

---

### 7.H — P16 Dogfood & Report

**Goal:** Run P16 end-to-end: generate proposals from real signals, verify scoring and inbox, test accept/reject.

**Requirements:**
* Process observations → generate proposals
* Score proposals and verify threshold logic
* Test deduplication with duplicate content
* Test inbox returns top 3
* Accept and reject proposals via API

**Acceptance Criteria:**
* [ ] Proposals generated from observation accumulation
* [ ] Scoring thresholds correct
* [ ] Duplication prevented
* [ ] Inbox shows top 3
* [ ] Accept/reject works

**Dogfood Report Template** — see P15 pattern.

---

## 8. Combined Implementation Order

```text
Phase: P16 — Proposal Engine V0
=================================

Batch 1 (Foundation):
  P16.A — Proposal Domain Model

Batch 2 (Core Logic):
  P16.B — Proposal Generator
  P16.C — Proposal Scoring Engine
  P16.D — Deduplication & Cooldown

Batch 3 (Inbox & API):
  P16.E — Top-3 Inbox Logic
  P16.F — Proposal API

Batch 4 (UI & Validation):
  P16.G — Proposal Inbox UI
  P16.H — P16 Dogfood & Report
```

---

## 9. Definition of Done

* [ ] Proposal types defined, test fixtures created
* [ ] Generator creates proposals from all triggers
* [ ] Scoring calculates correct dimensions
* [ ] Deduplication prevents repeats
* [ ] Inbox returns prioritized top 3
* [ ] API endpoints functional
* [ ] Inbox UI shows proposals with actions
* [ ] Dogfood report generated
* [ ] Integration queue clean
* [ ] Tests pass

---

## 10. Rollback

Set `PROPOSALS_ENABLED=false`. Existing proposals remain as drafts. No auto-generation.


---

# Part 2 — Agent Brief

## Mission

Implement all P16 — P16 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
* LLM-generated proposals must be validated for structure
* Scoring must not block proposal ingestion

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
    "phase": "P16",
    "title": "Proposal Engine V0",
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
      "title": "Proposal Model & Ingest Pipeline",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; all others depend on proposal types"
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
        "queueOptimizationNotes": "Foundation; all others depend on proposal types"
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
      "title": "Scoring & Prioritization",
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
        "safeParallelismNotes": "Depends on proposal types"
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
        "queueOptimizationNotes": "Depends on proposal types"
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
      "title": "Inbox Management",
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
        "safeParallelismNotes": "Depends on proposal types"
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
        "queueOptimizationNotes": "Depends on proposal types"
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
      "title": "Proposal REST API",
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
        "safeParallelismNotes": "Depends on scoring and inbox"
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
        "queueOptimizationNotes": "Depends on scoring and inbox"
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
      "title": "Proposal Inbox UI",
      "dependencies": [
        "7.D"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
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
      "id": "7.F",
      "title": "P16 Dogfood & Report",
      "dependencies": [
        "7.D",
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
  "phase": "P16",
  "title": "P16 Dogfood & Report",
  "primaryGoal": "Implement and validate the P16 second-brain component.",
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
  "completionGate": "All P16 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P17"
}
```

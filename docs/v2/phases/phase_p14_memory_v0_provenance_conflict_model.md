# Phase P14 — Memory V0, Provenance & Conflict Model

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P14`  
**One-line goal:** Create durable, typed, provenance-backed memory with lifecycle states, scoring, conflict detection, and correction flow.  
**Why now:** P13 can observe and produce candidate signals. P14 turns those candidates into safe memory without allowing stale or conflicting memories to silently drive decisions. This is Milestone 1a — "Pi Remembers".  
**Blast radius:** Memory schema, lifecycle, scoring, conflict detection, correction flow; `packages/coding-agent`, `packages/web-server`, `packages/web-ui/dashboard`, and V2 docs/tests.  
**Rollback path:** Disable newly added V2 capability flags (`MEMORY_ENABLED=false`), keep deterministic stores read-only, revert phase commits independently, fall back to prior behavior.  
**Scale mode:** `experimental_6`  
**Safe parallelism target:** 3  
**Done when:** P14 exit criteria pass, npm validation passes, memory persists correctly, conflict detection triggers, API returns data.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P14` |
| Title | `Memory V0, Provenance & Conflict Model` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Memory schema, lifecycle, scoring, conflict detection, correction flow` |
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
| P14.A — Memory Domain Model | Pi Worker Agent | User / owner | Reviewer | User |
| P14.B — Memory Store | Pi Worker Agent | User / owner | Reviewer | User |
| P14.C — Memory Lifecycle Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P14.D — Memory Scoring Engine | Pi Worker Agent | User / owner | Reviewer | User |
| P14.E — Conflict Detection | Pi Worker Agent | User / owner | Reviewer | User |
| P14.F — Memory Correction API | Pi Worker Agent | User / owner | Reviewer | User |
| P14.G — Memory Review UI Primitive | Pi Worker Agent | User / owner | Reviewer | User |
| P14.H — P14 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Create durable, typed, provenance-backed memory with lifecycle states, scoring, conflict detection, and correction flow.

P14 delivers **Milestone 1a — "Pi Remembers"**. Memory is the highest-risk V2 subsystem. Incorrect memory creates incorrect decisions. Therefore, V2 memory must be layered, source-backed, conflict-aware, and correctable by the user.

### 2.1 Three-Layer Memory Model

```text
Raw Evidence Layer
  └── Immutable source records: logs, execution journals, plan summaries, git commits, validation output.
      ↓ (Observations + Analysis)
Derived Memory Layer
  └── Pi-generated summaries or patterns extracted from raw evidence.
      ↓ (Policy + Confidence threshold)
Operating Beliefs Layer
  └── Active knowledge that is allowed to influence decisions and planning.
```

Only Operating Beliefs should directly influence decisions. Derived Memory can become an Operating Belief only when confidence, evidence quality, and policy allow it.

### 2.2 What P14 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Memory Domain Model | TypeScript types in `src/brain/memory/types.ts` | Typed memory records with lifecycle |
| Memory Store | `.pi/brain/memory/*.json` | JSON file persistence |
| Memory Lifecycle Engine | `src/brain/memory/lifecycle.ts` | State transitions: candidate→active→etc |
| Memory Scoring Engine | `src/brain/memory/scoring.ts` | Confidence, relevance, conflict scores |
| Conflict Detection | `src/brain/memory/conflicts.ts` | Detect contradictory memories |
| Memory Correction API | `/api/brain/memory/*` endpoints | User correction workflow |
| Memory Review UI | Dashboard component | Memory list, filters, detail |

### 2.3 Why This Order

P14 must come after P13 because:
1. Memory requires observations as input (from P13)
2. Memory stores prove source references to observations
3. First memories will be derived from P13 observations
4. Without P13, memory has no source to reference

---

## 3. What Carried Over — Must Stay Stable

* [x] P13 brain observations and candidate signals
* [x] P13 timeline and brain API
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

* [ ] Memory requires provenance — source references must exist
* [ ] New memory starts as `candidate` unless policy allows auto-activation
* [ ] Conflicting memories trigger `disputed` state
* [ ] Stale memory expires after TTL (default 90 days)
* [ ] User rejected memory must not influence decisions

---

## 4. Background / What Was Wrong

Pi V1 had no memory — every execution was isolated. V2 needs memory to:
- Remember what worked and what failed
- Store user preferences and goals
- Enable proposal generation based on past experience
- Support reflection that creates lasting knowledge

### 4.1 Memory Categories (from Vision)

| Category | Description |
|----------|-------------|
| `project_memory` | How the repo is structured and behaves |
| `architecture_memory` | Important design decisions and invariants |
| `plan_memory` | Plans that were run, generated, accepted, rejected, deferred |
| `failure_memory` | Recurring failures, retry hotspots, blocked states |
| `decision_memory` | User-approved or rejected decisions |
| `execution_memory` | Workspace outcomes, validation results |
| `idea_memory` | Generated ideas not yet implemented |
| `user_preference_memory` | Long-lived preferences affecting decisions |

---

## 5. Current Failure State / Known Blockers

* `p14_memory_domain_model` = not implemented
* `p14_memory_store` = not implemented
* `p14_memory_lifecycle_engine` = not implemented
* `p14_memory_scoring_engine` = not implemented
* `p14_conflict_detection` = not implemented
* `p14_memory_correction_api` = not implemented
* `p14_memory_ui` = not implemented
* `worktree_isolation` = optional for this phase
* `integration_queue` = enabled and required
* `scale_mode_readiness` = experimental_6 ready

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| Memory corruption causes bad decisions | low | critical | User rejection interface; manual correction; audit trail |
| Conflict detection false positives | med | med | Threshold tuning; user resolves disputed memories |
| Memory grows unbounded | med | high | TTL enforcement; max active memories limit |
| LLM hallucination enters memory | med | high | Provenance required; confidence threshold; candidate state |
| Stale memory used incorrectly | med | med | Lifecycle state checks; expiry enforcement |
| Memory query too slow | low | med | Index files; pagination; caching |
| User correction doesn't propagate | low | high | Correction triggers decision engine flush |

---

## 7. Workstreams

### 7.A — Memory Domain Model

**Goal:** Define MemoryRecord, MemorySourceRef, MemoryLifecycle, MemoryType, MemoryConflict, MemoryScore, MemoryQuery, and schemas.

**Requirements:**
* Implement in runtime-owned TypeScript code
* Memory requires source references (provenance)
* Lifecycle enum covers all states: candidate, active, disputed, superseded, expired, rejected_by_user, needs_review
* Test fixtures for all memory types

**Acceptance Criteria:**
* [ ] All types compile without errors
* [ ] Lifecycle enum has all required states
* [ ] Every memory requires source refs
* [ ] Serialization/deserialization works
* [ ] Test fixtures cover all types

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/memory/types.ts

export type MemoryType = 
  | 'project_memory'
  | 'architecture_memory'
  | 'plan_memory'
  | 'failure_memory'
  | 'decision_memory'
  | 'execution_memory'
  | 'idea_memory'
  | 'user_preference_memory';

export type MemoryLifecycle = 
  | 'candidate'      // New, awaiting review
  | 'active'         // Approved, influencing decisions
  | 'disputed'       // Contradicted, needs resolution
  | 'superseded'     // Replaced by newer memory
  | 'expired'        // Time-based expiry
  | 'rejected_by_user'  // User explicitly rejected
  | 'needs_review'; // Requires human review

export interface MemorySourceRef {
  type: 'observation' | 'journal' | 'plan' | 'reflection' | 'user' | 'external';
  path: string;
  id: string;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string;
}

export interface MemoryRecord {
  id: string; // ULID
  type: MemoryType;
  title: string;
  content: string;
  summary?: string;
  lifecycle: MemoryLifecycle;
  confidence: number; // 0-1
  provenance: {
    sourceRefs: MemorySourceRef[];
    derivedFrom?: string[]; // parent memory IDs
    validatedBy: 'system' | 'user' | 'llm_validated';
  };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersededBy?: string;
  affectedBy?: string[];
  tags: string[];
  category?: string;
  metadata: Record<string, unknown>;
}

export interface MemoryConflict {
  id: string;
  recordIds: [string, string];
  conflictType: 'contradiction' | 'duplicate' | 'staleness';
  scores: { [recordId: string]: number };
  resolution?: 'auto_resolved' | 'user_selected' | 'pending';
  resolvedBy?: string;
  resolvedAt?: string;
  evidence?: string;
}

export interface MemoryScore {
  confidence: number;
  relevance: number;
  recency: number;
  evidenceQuality: number;
  total: number;
}

export interface MemoryQuery {
  types?: MemoryType[];
  lifecycle?: MemoryLifecycle[];
  tags?: string[];
  searchText?: string;
  minConfidence?: number;
  minRelevance?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence' | 'relevance';
  sortOrder?: 'asc' | 'desc';
}

export interface MemoryStats {
  totalMemories: number;
  byType: Record<MemoryType, number>;
  byLifecycle: Record<MemoryLifecycle, number>;
  avgConfidence: number;
  conflictCount: number;
  expiredCount: number;
}
```

**File Scope:** `packages/coding-agent/src/brain/memory/types.ts`, `packages/coding-agent/test/brain/memory/types.test.ts`, `packages/coding-agent/test/fixtures/memory/*.json`

**Dependencies:** P13.A (types), P13.C (observations for provenance)

---

### 7.B — Memory Store

**Goal:** Persist memory under `.pi/brain/memory/` with JSON files and index for fast lookup.

**Requirements:**
* One JSON file per memory record
* Index file for type/lifecycle/tag lookup
* File naming: `{id}.json`
* Thread-safe writes
* Atomic writes (write to temp, rename)
* Handle missing/corrupt files gracefully

**Acceptance Criteria:**
* [ ] Memory persists to JSON files
* [ ] Index updates on create/update/delete
* [ ] Query by type returns correct results
* [ ] Query by lifecycle returns correct results
* [ ] Atomic writes prevent corruption

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/memory/store.ts

export interface MemoryStoreConfig {
  basePath: string;
  indexPath: string;
  maxFileSizeBytes: number;
}

export interface MemoryIndex {
  byId: Record<string, MemoryIndexEntry>;
  byType: Record<MemoryType, string[]>;
  byLifecycle: Record<MemoryLifecycle, string[]>;
  byTag: Record<string, string[]>;
  lastUpdated: string;
}

export interface MemoryIndexEntry {
  id: string;
  type: MemoryType;
  lifecycle: MemoryLifecycle;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export class MemoryStore {
  private config: MemoryStoreConfig;
  private index: MemoryIndex;
  private writeLock: Promise<void>;
  
  constructor(config?: Partial<MemoryStoreConfig>);
  
  // CRUD operations
  async create(memory: MemoryRecord): Promise<MemoryRecord>;
  async get(id: string): Promise<MemoryRecord | null>;
  async update(id: string, updates: Partial<MemoryRecord>): Promise<MemoryRecord>;
  async delete(id: string): Promise<void>;
  
  // Queries
  async query(query: MemoryQuery): Promise<MemoryRecord[]>;
  async findByType(type: MemoryType): Promise<MemoryRecord[]>;
  async findByLifecycle(lifecycle: MemoryLifecycle): Promise<MemoryRecord[]>;
  async findByTag(tag: string): Promise<MemoryRecord[]>;
  async search(text: string, limit?: number): Promise<MemoryRecord[]>;
  
  // Stats
  async getStats(): Promise<MemoryStats>;
  
  // Index management
  async rebuildIndex(): Promise<void>;
  
  // Internal
  private loadIndex(): Promise<MemoryIndex>;
  private saveIndex(): Promise<void>;
  private atomicWrite(path: string, data: string): Promise<void>;
}
```

**Directory Structure:**
```
.pi/
  brain/
    memory/
      index.json          # Master index
      {ulid}.json        # Individual memory records
      conflicts/
        {ulid}.json      # Conflict records
```

**File Scope:** `packages/coding-agent/src/brain/memory/store.ts`, `packages/coding-agent/src/brain/memory/index.ts`

**Dependencies:** P14.A (types)

---

### 7.C — Memory Lifecycle Engine

**Goal:** Manage memory state transitions with policy rules. Handle candidate→active promotion, expiry, supersession, rejection.

**Requirements:**
* Auto-promote candidate to active when confidence ≥ 0.8 (configurable)
* Expire memories after TTL (default 90 days)
* Mark superseded when new memory of same type replaces it
* Handle rejected_by_user lifecycle state
* Support needs_review for human attention
* Emit timeline events on state transitions

**Acceptance Criteria:**
* [ ] Candidate memories can be promoted to active
* [ ] Expired memories transition to expired state
* [ ] Superseded state creates chain of memory
* [ ] Rejected memories don't appear in active queries
* [ ] Timeline events emitted on transitions
* [ ] Policy rules are configurable

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/memory/lifecycle.ts

export interface LifecycleConfig {
  autoActivateConfidence: number;  // default 0.8
  defaultTtlDays: number;          // default 90
  needsReviewConfidence: number;   // default 0.5
  checkIntervalHours: number;      // default 24
}

export interface LifecycleTransition {
  memoryId: string;
  fromState: MemoryLifecycle;
  toState: MemoryLifecycle;
  reason: string;
  triggeredBy: 'system' | 'user' | 'policy';
  timestamp: string;
}

export class MemoryLifecycleEngine {
  private config: LifecycleConfig;
  private memoryStore: MemoryStore;
  
  constructor(memoryStore: MemoryStore, config?: Partial<LifecycleConfig>);
  
  // State transitions
  async activate(memoryId: string, reason?: string): Promise<MemoryRecord>;
  async deactivate(memoryId: string, reason?: string): Promise<MemoryRecord>;
  async supersede(memoryId: string, replacementId: string): Promise<MemoryRecord>;
  async reject(memoryId: string, reason?: string): Promise<MemoryRecord>;
  async restore(memoryId: string): Promise<MemoryRecord>;
  
  // Scheduled operations
  async checkExpired(): Promise<MemoryRecord[]>;
  async checkNeedsReview(): Promise<MemoryRecord[]>;
  async runExpirationCheck(): Promise<LifecycleTransition[]>;
  
  // Configuration
  setConfig(config: Partial<LifecycleConfig>): void;
  getConfig(): LifecycleConfig;
  
  // Events
  onTransition(callback: (transition: LifecycleTransition) => void): void;
}
```

**File Scope:** `packages/coding-agent/src/brain/memory/lifecycle.ts`

**Dependencies:** P14.B (store)

---

### 7.D — Memory Scoring Engine

**Goal:** Calculate confidence, relevance, and conflict scores for memories.

**Requirements:**
* Confidence: evidence count × source quality weight × recency
* Relevance: keyword match + type weight + lifecycle weight + tag match
* Recency: newer memories score higher, decay over time
* Source quality: system > user > LLM (without validation)
* Conflict scoring: contradictory memories get opposing scores

**Acceptance Criteria:**
* [ ] Confidence calculation works correctly
* [ ] Relevance scoring matches query terms
* [ ] Recency decay is configurable
* [ ] Conflict detection uses scores
* [ ] Scores update on memory changes

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/memory/scoring.ts

export interface ScoringConfig {
  weights: {
    evidenceCount: number;
    sourceQuality: number;
    recency: number;
    tagMatch: number;
    keywordMatch: number;
  };
  recencyDecayDays: number;
  sourceQualityScores: Record<string, number>; // system: 1.0, user: 0.9, llm_validated: 0.8, llm_unvalidated: 0.3
}

export class MemoryScoringEngine {
  private config: ScoringConfig;
  
  constructor(config?: Partial<ScoringConfig>);
  
  // Score calculation
  calculateConfidence(memory: MemoryRecord): number;
  calculateRelevance(memory: MemoryRecord, query: MemoryQuery): number;
  calculateRecencyScore(memory: MemoryRecord): number;
  
  // Conflict scoring
  calculateConflictScore(memoryA: MemoryRecord, memoryB: MemoryRecord): number;
  
  // Batch scoring
  scoreMemories(memories: MemoryRecord[], query?: MemoryQuery): Map<string, MemoryScore>;
  
  // Configuration
  setConfig(config: Partial<ScoringConfig>): void;
}

// Confidence formula:
// confidence = (evidenceCount / maxEvidence) * sourceQuality * recencyScore
// where maxEvidence = 10, recencyScore decays from 1.0 to 0.5 over recencyDecayDays

// Relevance formula:
// relevance = (keywordMatch ? 0.4 : 0) + (typeMatch ? 0.3 : 0) + (tagMatch ? 0.3 : 0) * tagCount / maxTags
```

**File Scope:** `packages/coding-agent/src/brain/memory/scoring.ts`

**Dependencies:** P14.A (types)

---

### 7.E — Conflict Detection

**Goal:** Detect contradictory, duplicate, or stale memories, trigger disputed state, support resolution.

**Requirements:**
* Same-type memories with contradicting content → conflict
* Similar summaries with different conclusions → conflict
* Scores above threshold (0.7) trigger disputed state
* Resolution: user picks winner, or auto-pick highest confidence
* Preserve conflict record for audit

**Acceptance Criteria:**
* [ ] Contradictory memories detected
* [ ] Duplicate detection works
* [ ] Stale memory flags old active memories
* [ ] Disputed state triggers correctly
* [ ] Conflict resolution worklow complete
* [ ] Conflict records persist

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/memory/conflicts.ts

export interface ConflictConfig {
  contradictionThreshold: number;  // default 0.7
  duplicateSimilarityThreshold: number;  // default 0.9
  stalenessThresholdDays: number;  // default 180
  autoResolve: boolean;
}

export interface ConflictAnalysis {
  memoryId: string;
  conflictingWith: string[];
  conflictTypes: ('contradiction' | 'duplicate' | 'staleness')[];
  scores: number[];
}

export class ConflictDetectionEngine {
  private config: ConflictConfig;
  private memoryStore: MemoryStore;
  private conflictStore: Map<string, MemoryConflict> = new Map();
  
  constructor(memoryStore: MemoryStore, config?: Partial<ConflictConfig>);
  
  // Detection
  async detectConflicts(memory: MemoryRecord): Promise<ConflictAnalysis[]>;
  async runFullDetection(): Promise<MemoryConflict[]>;
  
  // Conflict management
  async getConflicts(): Promise<MemoryConflict[]>;
  async getConflict(id: string): Promise<MemoryConflict | null>;
  async resolveConflict(conflictId: string, winnerId: string, resolution: string): Promise<void>;
  async autoResolveConflict(conflictId: string): Promise<void>;
  
  // Scheduled detection
  async runScheduledDetection(): Promise<MemoryConflict[]>;
  
  // Configuration
  setConfig(config: Partial<ConflictConfig>): void;
}
```

**File Scope:** `packages/coding-agent/src/brain/memory/conflicts.ts`

**Dependencies:** P14.B (store), P14.D (scoring)

---

### 7.F — Memory Correction API

**Goal:** REST API for memory CRUD, correction workflow, query.

**Requirements:**
* Standard CRUD: create, read, update, delete
* Correction: reject, supersede, activate, deactivate
* Query with filters
* Stats endpoint
* No raw LLM output as memory content (must be validated)

**Acceptance Criteria:**
* [ ] POST /api/brain/memory — create memory
* [ ] GET /api/brain/memory — list with filters
* [ ] GET /api/brain/memory/{id} — get single
* [ ] PUT /api/brain/memory/{id} — update
* [ ] DELETE /api/brain/memory/{id} — delete
* [ ] POST /api/brain/memory/{id}/reject — mark rejected
* [ ] POST /api/brain/memory/{id}/supersede — create replacement
* [ ] POST /api/brain/memory/{id}/activate — promote to active
* [ ] GET /api/brain/memory/stats — memory statistics

**API Specifications:**

```
POST /api/brain/memory
Body: { type, title, content, tags, sourceRefs }
Response: MemoryRecord

GET /api/brain/memory
Query: types, lifecycle, tags, searchText, minConfidence, limit, offset
Response: { memories: MemoryRecord[], total: number }

GET /api/brain/memory/{id}
Response: MemoryRecord

PUT /api/brain/memory/{id}
Body: Partial<MemoryRecord>
Response: MemoryRecord

DELETE /api/brain/memory/{id}
Response: { success: true }

POST /api/brain/memory/{id}/reject
Body: { reason?: string }
Response: MemoryRecord

POST /api/brain/memory/{id}/supersede
Body: { replacement: Partial<MemoryRecord> }
Response: { original: MemoryRecord, replacement: MemoryRecord }

POST /api/brain/memory/{id}/activate
Response: MemoryRecord

GET /api/brain/memory/stats
Response: MemoryStats
```

**File Scope:** `packages/web-server/src/routes/brain/memory.ts`, `packages/coding-agent/src/brain/memory/api.ts`

**Dependencies:** P14.B (store), P14.C (lifecycle)

---

### 7.G — Memory Review UI Primitive

**Goal:** Dashboard component for viewing, filtering, editing memories.

**Requirements:**
* Memory list with filters
* Memory detail view
* Lifecycle badges
* Edit capability (update content)
* Correction actions (reject, activate)
* Search functionality

**Acceptance Criteria:**
* [ ] List shows memories with pagination
* [ ] Filters work (type, lifecycle, tags)
* [ ] Detail view shows full memory
* [ ] Edit updates memory
* [ ] Reject/activate actions work
* [ ] Search returns results

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    memory/
      MemoryList.tsx         # List with filters
      MemoryDetail.tsx       # Full memory view
      MemoryEdit.tsx         # Edit form
      MemoryTags.tsx         # Tag display
      index.ts
```

**Dashboard Pages:**
- `/brain/memory` — memory explorer
- `/brain/memory/:id` — memory detail

**File Scope:** `packages/web-ui/dashboard/src/components/brain/memory/*.tsx`

**Dependencies:** P14.F (API)

---

### 7.H — P14 Dogfood & Report

**Goal:** Run P14, create example memories, verify conflict detection, produce dogfood report.

**Requirements:**
* Run brain daemon (from P13)
* Process observations → create memories
* Create conflicting memories to test detection
* Verify lifecycle transitions
* Verify query returns correct results
* Generate dogfood report

**Acceptance Criteria:**
* [ ] Observations process into memories
* [ ] Conflict detection triggers on contradictory memories
* [ ] Lifecycle transitions work
* [ ] Query works correctly
* [ ] Dashboard shows memories
* [ ] Dogfood report generated

**Dogfood Report Template:**

```markdown
# P14 Dogfood Report

## Environment
- Pi version:
- Memory enabled: true
- P13 observations available: true/false

## Memory Stats
- Total memories: X
- By type: { ... }
- By lifecycle: { ... }

## Conflict Detection
- Conflicts detected: X
- Auto-resolved: X
- User-resolved: X
- Pending: X

## Lifecycle Transitions
- Activated: X
- Expired: X
- Superseded: X

## API Performance
- Query latency: Xms
- Create latency: Xms

## Issues Found
- [List]

## Next Steps
- [Recommendations for P15]
```

**File Scope:** `docs/pi/v2/dogfood/p14-dogfood-report.md`

---

## 8. Combined Implementation Order

```text
Phase: P14 — Memory V0, Provenance & Conflict Model
=====================================================

Batch 1 (Foundation):
  P14.A — Memory Domain Model

Batch 2 (Storage):
  P14.B — Memory Store

Batch 3 (Core Logic):
  P14.C — Memory Lifecycle Engine
  P14.D — Memory Scoring Engine
  P14.E — Conflict Detection

Batch 4 (API & UI):
  P14.F — Memory Correction API
  P14.G — Memory Review UI Primitive

Batch 5 (Validation):
  P14.H — P14 Dogfood & Report
```

**Dependency Rationale:**
- Types (P14.A) must exist first
- Store (P14.B) depends on types
- Lifecycle/soring/conflicts depend on store
- API depends on store and lifecycle
- UI depends on API
- Dogfood needs everything working

---

## 9. Definition of Done

P14 is complete when ALL are true:

* [ ] Memory Domain Model — types compile, all states defined
* [ ] Memory Store — creates, reads, updates, deletes work
* [ ] Memory Lifecycle Engine — transitions work correctly
* [ ] Memory Scoring Engine — scores calculate correctly
* [ ] Conflict Detection — detects contradictory memories
* [ ] Memory Correction API — all endpoints work
* [ ] Memory Review UI — list, detail, edit work
* [ ] P14 Dogfood Report — complete report generated
* [ ] Integration queue is clean or blocked with handoff
* [ ] No forbidden commands used
* [ ] Typecheck/build/test pass

---

## 10. Rollback Playbook

**Trigger conditions:**
* Memory corruption causes bad decisions
* Conflict detection produces excessive false positives
* Memory store corrupts data
* UI crashes on memory pages

**Rollback procedure:**
1. Set `MEMORY_ENABLED=false`
2. Keep memory files read-only
3. Memory API returns empty results
4. Fall back to P13 behavior (observations without memory)
5. Preserve `.pi/brain/memory/` for debugging

---

## 11. What Next Phase Inherits

**P15 inherits:**
* Memory store with persisted memories
* Memory types and lifecycle
* Conflict detection capability
* Memory API endpoints

**P15 may add:**
* Goal domain model
* Goal store
* Autonomy profile engine

# Part 2 — Agent Brief

## Mission

Implement all P14 — P14 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
* Memory candidates must start in `candidate` lifecycle
* Conflict resolution must produce audit entries

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
    "phase": "P14",
    "title": "Memory V0, Provenance & Conflict Model",
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
      "title": "Memory Domain Model & Store",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; all others depend on types"
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
        "queueOptimizationNotes": "Foundation; all others depend on types"
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
      "title": "Lifecycle Engine",
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
        "safeParallelismNotes": "Depends on memory store"
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
        "queueOptimizationNotes": "Depends on memory store"
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
      "title": "Memory Scoring",
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
        "safeParallelismNotes": "Independent of lifecycle engine"
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
        "queueOptimizationNotes": "Independent of lifecycle engine"
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
      "title": "Conflict Detection",
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
        "safeParallelismNotes": "Depends on lifecycle and scoring"
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
        "queueOptimizationNotes": "Depends on lifecycle and scoring"
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
      "title": "Correction API",
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
        "safeParallelismNotes": "Depends on conflict detection"
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
        "queueOptimizationNotes": "Depends on conflict detection"
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
      "title": "Memory REST API",
      "dependencies": [
        "7.B",
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
        "safeParallelismNotes": "Depends on core memory subsystems"
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
        "queueOptimizationNotes": "Depends on core memory subsystems"
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
      "title": "Memory Dashboard UI",
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
      "id": "7.H",
      "title": "P14 Dogfood & Report",
      "dependencies": [
        "7.F",
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
  "phase": "P14",
  "title": "P14 Dogfood & Report",
  "primaryGoal": "Implement and validate the P14 second-brain component.",
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
  "completionGate": "All P14 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P15"
}
```

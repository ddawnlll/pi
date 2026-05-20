# Phase P13 — Brain Core Vertical Slice & Orchestrator Daemon

**Template:** LLM Implementation Agent — Master Template v2.5  
**Version:** 2.5.1  
**Created:** 2026-05-19  
**Package manager:** npm only  
**Status:** Authoritative Implementation  
**Last Updated:** 2026-05-19

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P13`  
**One-line goal:** Build the first usable Brain Core slice: deterministic observations, brain timeline, retry/failure signals, first reflection summary, minimal brain state viewer, and safe daemon lifecycle.  
**Why now:** P13 ends blind construction. Before memory, proposals, planning, or autonomy can be trusted, Pi must first observe project and execution state with provenance and display what it sees. This is Milestone 0 — "Pi Sees".  
**Blast radius:** Observation Engine V0, brain timeline, safe daemon, minimal brain viewer; `packages/coding-agent`, `packages/web-server`, `packages/web-ui/dashboard`, and V2 docs/tests.  
**Rollback path:** Disable newly added V2 capability flags (`BRAIN_ENABLED=false`), keep deterministic stores read-only, revert phase commits independently, fall back to prior queue/execution behavior.  
**Scale mode:** `experimental_6`  
**Safe parallelism target:** 3  
**Done when:** P13 exit criteria pass, npm validation passes, integration queue is clean, Brain API returns data, daemon heartbeat confirmed.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P13` |
| Title | `Brain Core Vertical Slice & Orchestrator Daemon` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Observation Engine V0, brain timeline, safe daemon, minimal brain viewer` |
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
| P13.A — Brain Domain Model | Pi Worker Agent | User / owner | Reviewer | User |
| P13.B — Brain Timeline Store | Pi Worker Agent | User / owner | Reviewer | User |
| P13.C — Observation Engine V0 | Pi Worker Agent | User / owner | Reviewer | User |
| P13.D — Queue Health Observer | Pi Worker Agent | User / owner | Reviewer | User |
| P13.E — Execution Journal Observer | Pi Worker Agent | User / owner | Reviewer | User |
| P13.F — Retry/Failure Signal Extractor | Pi Worker Agent | User / owner | Reviewer | User |
| P13.G — First Reflection Summary | Pi Worker Agent | User / owner | Reviewer | User |
| P13.H — Safe Brain Daemon Lifecycle | Pi Worker Agent | User / owner | Reviewer | User |
| P13.I — Brain API Endpoints | Pi Worker Agent | User / owner | Reviewer | User |
| P13.J — Minimal Brain State Viewer | Pi Worker Agent | User / owner | Reviewer | User |
| P13.K — P13 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Build the first usable Brain Core slice: deterministic observations, brain timeline, retry/failure signals, first reflection summary, minimal brain state viewer, and safe daemon lifecycle.

This phase implements one vertical slice of the Pi V2 second-brain roadmap. It follows the V2 principle: **LLM proposes, runtime validates, policy decides, executor acts, audit records**. All safety-critical behavior must remain deterministic and runtime-owned.

P13 delivers **Milestone 0 — "Pi Sees"**. Before memory, proposals, planning, or autonomy can exist, Pi must first observe project and execution state with provenance and display what it sees. This is the foundational observation layer that all subsequent V2 phases depend on.

This phase uses `experimental_6` scale mode for future readiness but targets `3` safe effective parallelism because it changes cognitive/runtime infrastructure and needs stability.

### 2.1 What P13 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Brain Domain Model | TypeScript types in `src/brain/types.ts` | Typed observations, signals, timeline events |
| Brain Timeline Store | `.pi/brain-timeline.ndjson` | Append-only event log with rotation |
| Observation Engine V0 | `src/brain/observation/engine.ts` | Collects structured events from execution |
| Queue Health Observer | `src/brain/observation/queue-health.ts` | Monitors plan vs integration queue state |
| Execution Journal Observer | `src/brain/observation/execution-journal.ts` | Watches workspace outcomes |
| Retry/Failure Signal Extractor | `src/brain/observation/signals.ts` | Pattern detection for hotspots |
| Safe Brain Daemon | `src/brain/daemon/index.ts` | Lifecycle management, heartbeat |
| Brain API | `/api/brain/*` endpoints | REST API for observations, signals, timeline |
| Brain State Viewer | Dashboard component | Minimal UI showing brain state |

### 2.2 Why This Order

P13 must come first because:
1. Memory (P14) requires observations as input
2. Goals (P15) require observations for drift detection
3. Proposals (P16) require both observations and memory
4. Planning (P17) requires the proposal output
5. Without P13, later phases have no signals to operate on

---

## 3. What Carried Over — Must Stay Stable

* [x] P12.5 plan-level queue and zipped bundle runner
* [x] Existing execution journal and plan summaries
* [x] Existing integration queue and dirty gate
* [x] Existing dashboard shell
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

* [ ] Brain daemon runs as separate process or background task
* [ ] Observations require `provenance` field with source references
* [ ] No observation may contain unvalidated LLM output directly
* [ ] Timeline uses append-only NDJSON with corruption tolerance
* [ ] API endpoints validate all input before storage

---

## 4. Background / What Was Wrong

Pi V1 can execute plans, but V2 vision requires Pi to **observe, remember, interpret, propose, plan, execute approved work, reflect, and improve**. The current gap is that Pi does not observe its own execution state in a structured, queryable way.

### 4.1 V1 Limitations Addressed by P13

| V1 Limitation | P13 Solution |
|---------------|--------------|
| No structured observations | `BrainObservation` type with mandatory provenance |
| No execution signal extraction | Retry/failure pattern detection |
| No timeline of brain events | `.pi/brain-timeline.ndjson` append-only log |
| No daemon lifecycle | Safe brain daemon with heartbeat |
| No brain API | REST endpoints for all brain data |
| No brain UI | Minimal brain state viewer |

### 4.2 What P13 Does NOT Solve

- Memory persistence → P14
- Goal tracking → P15
- Proposal generation → P16
- Plan creation → P17
- Policy enforcement → P18
- Full dashboard → P19

---

## 5. Current Failure State / Known Blockers

* `p13_brain_domain_model` = not implemented
* `p13_brain_timeline_store` = not implemented
* `p13_observation_engine_v0` = not implemented
* `p13_queue_health_observer` = not implemented
* `p13_execution_journal_observer` = not implemented
* `p13_retry_failure_signal_extractor` = not implemented
* `p13_daemon_lifecycle` = not implemented
* `p13_brain_api` = not implemented
* `p13_brain_viewer` = not implemented
* `worktree_isolation` = optional for this phase
* `integration_queue` = enabled and required as a cleanliness gate
* `scale_mode_readiness` = experimental_6 ready
* `safe_effective_parallelism` = expected 3

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| LLM output mutates runtime state directly | low | critical | Runtime-only mutation boundary; all state changes go through type-safe handlers |
| Observation flood overwhelms timeline | med | high | Batch observations (max 10 per batch), apply severity filtering |
| Timeline corruption causes data loss | low | high | Line corruption tolerance via parse-skip; rotation at 100MB |
| Daemon crash causes orphan state | low | med | Heartbeat every 60s; startup validation; graceful shutdown |
| API endpoint exposes sensitive data | low | critical | Validate output sanitization; no raw LLM output in responses |
| Memory for observations grows unbounded | med | med | TTL on observation metadata (7 days default); compaction |
| Dashboard bypasses policy enforcement | low | critical | All UI actions go through API; runtime validates |
| npm validation missing or flaky | med | med | Use targeted npm fallbacks; document missing scripts |

---

## 7. Workstreams

### 7.A — Brain Domain Model

**Goal:** Define BrainObservation, BrainSignal, BrainTimelineEvent, SourceRef, ProvenanceInfo, severity enums, serialization helpers, and test fixtures.

**Requirements:**
* Implement the scoped capability in runtime-owned TypeScript code
* Preserve provenance — every observation requires source references
* Do not allow LLM output to mutate execution, memory, queue, policy, or approval state directly
* All types must export JSON schema for validation

**Acceptance Criteria:**
* [ ] Core types compile without TypeScript errors
* [ ] Every observation requires `provenance` field with source references
* [ ] Serialization/deserialization round-trips correctly
* [ ] Invalid observations fail fast with descriptive errors
* [ ] Test fixtures cover all observation types

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/types.ts

export type SignalType = 
  | 'retry_hotspot'
  | 'failure_pattern'
  | 'queue_blocked'
  | 'integration_dirty'
  | 'validation_failure'
  | 'memory_conflict'
  | 'goal_drift'
  | 'proposal_generated';

export type Severity = 'info' | 'warning' | 'critical';

export type EventSource = 'queue' | 'execution' | 'integration' | 'validation' | 'user' | 'system';

export interface SourceRef {
  type: 'file' | 'journal' | 'queue' | 'memory' | 'proposal' | 'plan' | 'workspace';
  path: string;
  lineStart?: number;
  lineEnd?: number;
  commit?: string;
  timestamp?: string;
  id?: string;
}

export interface ProvenanceInfo {
  observationSources: SourceRef[];
  derivationChain: SourceRef[];
  confidence: number; // 0-1
  validatedBy: string; // system, user, or LLM with validation
}

export interface BrainObservation {
  id: string; // ULID
  timestamp: string; // ISO 8601
  source: EventSource;
  signalType: SignalType;
  severity: Severity;
  title: string;
  description: string;
  evidence: SourceRef[];
  provenance: ProvenanceInfo;
  metadata: Record<string, unknown>;
}

export interface BrainSignal {
  id: string; // ULID
  observationIds: string[];
  pattern: string;
  summary: string;
  confidence: number; // 0-1
  severity: Severity;
  createdAt: string;
  resolvedAt?: string;
  metadata: Record<string, unknown>;
}

export interface BrainTimelineEvent {
  id: string; // ULID
  eventType: 'observation' | 'signal' | 'reflection' | 'daemon_heartbeat' | 'daemon_start' | 'daemon_stop' | 'daemon_error';
  timestamp: string;
  data: Record<string, unknown>;
  workspaceId?: string;
  planExecId?: string;
  severity: Severity;
}
```

**File Scope:** `packages/coding-agent/src/brain/types.ts`, `packages/coding-agent/test/brain/types.test.ts`, `packages/coding-agent/test/fixtures/brain/*.json`

**Isolation & Parallelism Notes:**
* Workspace ID: `P13.A`
* Queue priority: `critical`
* Can run independently — no dependencies
* No file overlap with other workstreams

---

### 7.B — Brain Timeline Store

**Goal:** Persist observations and events to `.pi/brain-timeline.ndjson` with append-only writes, line corruption tolerance, rotation guard, and query API.

**Requirements:**
* Append-only log — no in-place updates
* Line corruption tolerance — skip unparseable lines, log error
* Rotation when file exceeds 100MB
* Read API with pagination and filtering
* Thread-safe writes (single writer pattern)

**Acceptance Criteria:**
* [ ] Append writes are atomic (write to temp, rename)
* [ ] Corrupt lines are skipped with error logged
* [ ] Rotation triggers at 100MB, creates `.pi/brain-timeline.{timestamp}.ndjson`
* [ ] Query API returns paginated results with filters
* [ ] Reader handles empty/missing files gracefully

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/timeline/store.ts

export interface TimelineQuery {
  eventTypes?: BrainTimelineEvent['eventType'][];
  severities?: Severity[];
  since?: string;
  until?: string;
  workspaceId?: string;
  planExecId?: string;
  limit?: number;
  offset?: number;
}

export interface TimelineWriteOptions {
  atomic?: boolean; // default true
  flush?: boolean;  // default true
}

export class BrainTimelineStore {
  private readonly filePath: string;
  private readonly rotationThreshold: number;
  private readonly maxLineLength: number;
  private writeStream?: fs.WriteStream;
  
  constructor(options: {
    filePath?: string;
    rotationThreshold?: number;
    maxLineLength?: number;
  } = {});
  
  async append(event: BrainTimelineEvent, options?: TimelineWriteOptions): Promise<void>;
  async query(query: TimelineQuery): Promise<BrainTimelineEvent[]>;
  async rotate(): Promise<string>; // returns new file path
  async getStats(): Promise<{ fileSize: number; lineCount: number; oldestEntry?: string; newestEntry?: string }>;
  
  // Internal
  private async ensureWriteStream(): Promise<void>;
  private parseLine(line: string, index: number): BrainTimelineEvent | null;
}
```

**File Scope:** `packages/coding-agent/src/brain/timeline/store.ts`, `packages/coding-agent/src/brain/timeline/index.ts`, `packages/coding-agent/test/brain/timeline.test.ts`

**Dependencies:** P13.A (types)

---

### 7.C — Observation Engine V0

**Goal:** Collect structured events from repo state, execution state, queues, validation, and user actions. Batch observations and dispatch to timeline.

**Requirements:**
* Source events from: plan queue, integration queue, execution journal, validation output
* Batch observations (max 10 per batch) to reduce I/O
* Apply severity filtering — info events may be filtered
* Validate observation completeness before dispatch
* No recursive observation (observe execution, not observer)

**Acceptance Criteria:**
* [ ] ObservationEngine collects from all defined sources
* [ ] Batch size capped at 10
* [ ] Severity filtering configurable
* [ ] Observation dispatch timestamps correctly
* [ ] Source validation rejects incomplete observations

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/observation/engine.ts

export interface ObservationConfig {
  batchSize: number;
  minSeverity: Severity;
  sources: EventSource[];
  enabledSources: Set<EventSource>;
}

export class ObservationEngine {
  private config: ObservationConfig;
  private buffer: BrainObservation[] = [];
  private flushTimer?: NodeJS.Timeout;
  
  constructor(config?: Partial<ObservationConfig>);
  
  // Collect from specific sources
  async collectFromQueue(): Promise<BrainObservation[]>;
  async collectFromIntegration(): Promise<BrainObservation[]>;
  async collectFromExecution(): Promise<BrainObservation[]>;
  async collectFromValidation(): Promise<BrainObservation[]>;
  
  // Main observation method
  observe(observation: Omit<BrainObservation, 'id' | 'timestamp'>): void;
  
  // Flush buffer to timeline
  async flush(): Promise<void>;
  
  // Lifecycle
  start(): void;
  async stop(): Promise<void>;
  
  // Configuration
  setConfig(config: Partial<ObservationConfig>): void;
  getConfig(): ObservationConfig;
}
```

**File Scope:** `packages/coding-agent/src/brain/observation/engine.ts`, `packages/coding-agent/src/brain/observation/index.ts`, `packages/coding-agent/test/brain/observation.test.ts`

**Dependencies:** P13.A (types), P13.B (timeline store)

---

### 7.D — Queue Health Observer

**Goal:** Monitor plan queue vs integration queue state, detect blocking conditions, emit observations when queue health changes.

**Requirements:**
* Observe: plan queue size, integration queue dirty state, active plan count
* Detect: queue blocked (integration dirty), queue starvation (no progress), queue backed up (size > threshold)
* Emit observations with source `queue`
* Track state changes to avoid duplicate observations

**Acceptance Criteria:**
* [ ] Monitors plan queue state correctly
* [ ] Detects integration dirty blocking
* [ ] Emits queue_blocked signal when detected
* [ ] Tracks state to avoid duplicate alerts
* [ ] Integrates with ObservationEngine

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/observation/queue-health.ts

export interface QueueHealthState {
  planQueueSize: number;
  integrationQueueDirty: boolean;
  activePlanCount: number;
  lastChangeAt: string;
  blockedReason?: string;
}

export class QueueHealthObserver {
  private state: QueueHealthState;
  private pollInterval: number;
  private threshold: { maxQueueSize: number; maxActivePlans: number };
  
  constructor(options?: { pollInterval?: number; maxQueueSize?: number; maxActivePlans?: number });
  
  async check(): Promise<QueueHealthState>;
  async observeChanges(): Promise<BrainObservation[]>;
  
  // State access
  getState(): QueueHealthState;
  isBlocked(): boolean;
}
```

**File Scope:** `packages/coding-agent/src/brain/observation/queue-health.ts`

**Dependencies:** P13.C (ObservationEngine)

---

### 7.E — Execution Journal Observer

**Goal:** Watch execution journal entries, parse workspace outcomes, emit observations about execution patterns.

**Requirements:**
* Read from `.pi/execution-journal/*.json`
* Detect: workspace success, workspace failure, retry count, duration trends
* Emit observations with source `execution`
* Track execution patterns for signal generation

**Acceptance Criteria:**
* [ ] Reads execution journal correctly
* [ ] Parses workspace outcomes
* [ ] Detects retry patterns
* [ ] Emits execution observations
* [ ] Handles missing/corrupt journal files gracefully

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/observation/execution-journal.ts

export interface WorkspaceOutcome {
  workspaceId: string;
  planExecId: string;
  status: 'success' | 'failure' | 'retry' | 'skipped';
  retryCount: number;
  duration: number;
  errorTypes?: string[];
  validationPassed?: boolean;
}

export class ExecutionJournalObserver {
  private journalPath: string;
  private lastProcessedTimestamp?: string;
  
  constructor(journalPath?: string);
  
  async scan(): Promise<WorkspaceOutcome[]>;
  async getOutcomesSince(timestamp: string): Promise<WorkspaceOutcome[]>;
  async computeStats(): Promise<{
    totalWorkspaces: number;
    successRate: number;
    avgRetryCount: number;
    avgDuration: number;
    failureTypes: Record<string, number>;
  }>;
  
  // Observation generation
  async generateObservations(): Promise<BrainObservation[]>;
}
```

**File Scope:** `packages/coding-agent/src/brain/observation/execution-journal.ts`

**Dependencies:** P13.C (ObservationEngine)

---

### 7.F — Retry/Failure Signal Extractor

**Goal:** Analyze observation patterns to detect retry hotspots and failure patterns, generate BrainSignal when threshold exceeded.

**Requirements:**
* Track retry counts and failure types per workspace/plan
* Trigger signal when: 3+ retries, same failure 2x, failure rate > 50%
* Generate signals with confidence based on observation count
* Support signal resolution when pattern clears

**Acceptance Criteria:**
* [ ] Tracks retry counts correctly
* [ ] Detects hotspot threshold (3+ retries)
* [ ] Generates retry_hotspot signals
* [ ] Generates failure_pattern signals
* [ ] Resolves signals when pattern clears
* [ ] Confidence scoring works

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/observation/signals.ts

export interface SignalThresholdConfig {
  retryHotspotThreshold: number;      // default 3
  failurePatternThreshold: number;    // default 2
  failureRateThreshold: number;       // default 0.5
  observationWindowHours: number;     // default 24
}

export class SignalExtractor {
  private config: SignalThresholdConfig;
  private activeSignals: Map<string, BrainSignal> = new Map();
  private observationBuffer: BrainObservation[] = [];
  
  constructor(config?: Partial<SignalThresholdConfig>);
  
  // Process observations for pattern detection
  process(observation: BrainObservation): BrainSignal | null;
  
  // Analyze patterns
  async analyzeRetryPatterns(): Promise<BrainSignal[]>;
  async analyzeFailurePatterns(): Promise<BrainSignal[]>;
  
  // Signal management
  getActiveSignals(): BrainSignal[];
  getSignalById(id: string): BrainSignal | undefined;
  resolveSignal(id: string, resolution: string): void;
  
  // Configuration
  setConfig(config: Partial<SignalThresholdConfig>): void;
}
```

**File Scope:** `packages/coding-agent/src/brain/observation/signals.ts`

**Dependencies:** P13.A (types), P13.C (ObservationEngine)

---

### 7.G — First Reflection Summary

**Goal:** Generate first post-plan reflection summary demonstrating the reflection loop. Post-plan analysis that answers: what ran, what worked, what failed.

**Requirements:**
* Trigger after plan completion (via execution hook)
* Read execution journal, validation results, workspace outcomes
* Generate source-backed summary (no hallucinations)
* Store reflection in timeline as event type
* Output to `.pi/brain/reflections/{planExecId}/reflection-summary.md`

**Acceptance Criteria:**
* [ ] Triggered after plan completion
* [ ] Reads all relevant data sources
* [ ] Generates summary with evidence references
* [ ] Stores reflection to timeline
* [ ] Writes markdown artifact
* [ ] No unvalidated LLM output in reflection

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/reflection/first-reflection.ts

export interface ReflectionConfig {
  outputDir: string;
  minWorkspaceCount: number;
  includePatterns: string[];
}

export interface ReflectionInput {
  planExecId: string;
  planId: string;
  executionJournal: ExecutionJournalEntry[];
  workspaceOutcomes: WorkspaceOutcome[];
  validationResults: ValidationResult[];
  integrationState: IntegrationState;
  duration: number;
}

export interface ReflectionSummary {
  id: string;
  planExecId: string;
  summary: string;
  whatRan: string[];
  whatWorked: string[];
  whatFailed: string[];
  whatSlowedDown: string[];
  evidence: SourceRef[];
  createdAt: string;
}

export class FirstReflectionEngine {
  private config: ReflectionConfig;
  
  constructor(config?: Partial<ReflectionConfig>);
  
  async reflect(input: ReflectionInput): Promise<ReflectionSummary>;
  async storeReflection(reflection: ReflectionSummary): Promise<void>;
  async writeMarkdown(reflection: ReflectionSummary): Promise<string>;
}
```

**File Scope:** `packages/coding-agent/src/brain/reflection/first-reflection.ts`, `packages/coding-agent/src/brain/reflection/index.ts`

**Dependencies:** P13.A (types), P13.E (ExecutionJournalObserver)

---

### 7.H — Safe Brain Daemon Lifecycle

**Goal:** Brain daemon runs as background process, manages observation intervals, produces heartbeat, handles graceful shutdown.

**Requirements:**
* Start on Pi startup (after P12.5 core initialized)
* Stop on graceful shutdown (SIGTERM/SIGINT)
* Heartbeat event every 60 seconds
* No recursion — daemon observes, doesn't observe itself infinitely
* No external API calls without policy config
* Startup validation of required directories

**Acceptance Criteria:**
* [ ] Daemon starts after core initialization
* [ ] Heartbeat events written to timeline
* [ ] Graceful shutdown completes within 10 seconds
* [ ] Startup validation checks pass
* [ ] No memory leaks over extended runtime (tested with 1hr run)

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/daemon/index.ts

export interface DaemonConfig {
  heartbeatInterval: number;  // default 60000ms
  observationInterval: number; // default 30000ms
  enabled: boolean;
  dataDir: string;
}

export interface DaemonState {
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  startedAt: string;
  lastHeartbeat: string;
  observationCount: number;
  errorCount: number;
}

export class BrainDaemon {
  private config: DaemonConfig;
  private state: DaemonState;
  private heartbeatTimer?: NodeJS.Timeout;
  private observationTimer?: NodeJS.Timeout;
  private observationEngine?: ObservationEngine;
  
  constructor(config?: Partial<DaemonConfig>);
  
  // Lifecycle
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  // State
  getState(): DaemonState;
  isRunning(): boolean;
  
  // Internal
  private heartbeat(): Promise<void>;
  private observe(): Promise<void>;
  private validate(): Promise<boolean>;
}
```

**File Scope:** `packages/coding-agent/src/brain/daemon/index.ts`, `packages/coding-agent/src/brain/index.ts` (entry point)

**Dependencies:** P13.B (timeline), P13.C (observation), P13.D/E/F (observers)

---

### 7.I — Brain API Endpoints

**Goal:** REST API for brain state, observations, signals, timeline. Integrates with web-server.

**Requirements:**
* GET endpoints for: timeline, observations, signals
* Pagination support for all list endpoints
* Filtering by: event type, severity, date range, workspace, plan
* Response validation before sending
* No raw LLM output in responses

**Acceptance Criteria:**
* [ ] GET /api/brain/timeline works with pagination
* [ ] GET /api/brain/observations works with filters
* [ ] GET /api/brain/signals returns active signals
* [ ] GET /api/brain/state returns daemon state
* [ ] All endpoints validate input
* [ ] Rate limiting applied

**API Specifications:**

```
GET /api/brain/timeline
Query params:
  - eventType?: string (comma-separated)
  - severity?: string (comma-separated)
  - since?: ISO8601
  - until?: ISO8601
  - workspaceId?: string
  - planExecId?: string
  - limit?: number (default 50, max 200)
  - offset?: number (default 0)
Response: { events: BrainTimelineEvent[], total: number, hasMore: boolean }

GET /api/brain/observations
Query params:
  - signalType?: string
  - severity?: string
  - source?: string
  - since?: ISO8601
  - limit?: number
Response: { observations: BrainObservation[], total: number }

GET /api/brain/signals
Query params:
  - resolved?: boolean (default false)
  - limit?: number
Response: { signals: BrainSignal[], total: number }

GET /api/brain/state
Response: {
  daemon: DaemonState,
  observationCount: number,
  signalCount: number,
  lastObservationAt: string
}
```

**File Scope:** `packages/web-server/src/routes/brain.ts`, `packages/coding-agent/src/brain/api/index.ts`

**Dependencies:** P13.A (types), P13.B (timeline), P13.F (signals), P13.H (daemon)

---

### 7.J — Minimal Brain State Viewer

**Goal:** Dashboard component showing brain state: timeline visualization, signal summary cards, observation counts by severity.

**Requirements:**
* Timeline visualization (last 100 events)
* Signal summary cards (count by severity)
* Observation count display
* Refresh button (manual refresh, no auto-refresh for now)
* Error state handling

**Acceptance Criteria:**
* [ ] Timeline shows last 100 events
* [ ] Signal cards display counts by severity
* [ ] Observation counts by source/severity shown
* [ ] Refresh button triggers API call
* [ ] Error state shows message, not crash
* [ ] Responsive layout (works on desktop)

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    BrainStateViewer.tsx      # Main container
    TimelineList.tsx          # Timeline events list
    SignalSummaryCards.tsx    # Signal counts by severity
    ObservationCounts.tsx     # Observation statistics
    index.ts                  # Exports
```

**File Scope:** `packages/web-ui/dashboard/src/components/brain/*.tsx`, `packages/web-ui/dashboard/src/pages/BrainState.tsx`

**Dependencies:** P13.I (API endpoints)

---

### 7.K — P13 Dogfood & Report

**Goal:** Run P13 in self-hosting mode, validate all components work together, produce dogfood report.

**Requirements:**
* Run brain daemon locally
* Execute 1+ test plans while daemon running
* Verify observations generated
* Verify signals detected (if retry patterns exist)
* Verify timeline populated
* Verify API returns data
* Verify dashboard shows state

**Acceptance Criteria:**
* [ ] Daemon starts without errors
* [ ] Test plan execution triggers observations
* [ ] Timeline shows events
* [ ] API returns valid data
* [ ] Dashboard displays brain state
* [ ] Dogfood report generated

**Dogfood Report Template:**

```markdown
# P13 Dogfood Report

## Environment
- Pi version: 
- Brain enabled: true
- Daemon status: running

## Observations Generated
- Total observations: X
- By source: { ... }
- By severity: { ... }

## Signals Detected
- Total signals: X
- Active: X
- Resolved: X

## Timeline
- Total events: X
- First event: timestamp
- Last event: timestamp

## API Response Times
- /api/brain/timeline: Xms
- /api/brain/observations: Xms
- /api/brain/signals: Xms

## Dashboard
- Status: working / errors
- Components rendered: yes

## Issues Found
- [List any issues]

## Next Steps
- [Recommendations for P14]
```

**File Scope:** `docs/pi/v2/dogfood/p13-dogfood-report.md`

---

## 8. Combined Implementation Order

```text
Phase: P13 — Brain Core Vertical Slice
=======================================

Batch 1 (Foundational):
  P13.A — Brain Domain Model
  P13.B — Brain Timeline Store

Batch 2 (Observation Layer):
  P13.C — Observation Engine V0
  P13.D — Queue Health Observer
  P13.E — Execution Journal Observer
  P13.F — Retry/Failure Signal Extractor

Batch 3 (Daemon & Integration):
  P13.G — First Reflection Summary
  P13.H — Safe Brain Daemon Lifecycle
  P13.I — Brain API Endpoints

Batch 4 (UI & Final):
  P13.J — Minimal Brain State Viewer
  P13.K — P13 Dogfood & Report
```

**Dependency Rationale:**
- Types (P13.A) must exist before any other work
- Timeline store (P13.B) needed by observation engine
- Observers (P13.D/E/F) feed observation engine
- Observation engine (P13.C) needed by daemon
- Daemon (P13.H) needs observation + timeline before starting
- API (P13.I) needs all data sources
- Dashboard (P13.J) needs API
- Dogfood (P13.K) needs everything working

---

## 9. Definition of Done

P13 is complete when ALL are true:

* [ ] Brain Domain Model — types compile, tests pass, fixtures created
* [ ] Brain Timeline Store — append works, query works, rotation works
* [ ] Observation Engine V0 — collects from all sources, batches correctly
* [ ] Queue Health Observer — detects blocked queue, emits observations
* [ ] Execution Journal Observer — parses workspace outcomes, detects patterns
* [ ] Retry/Failure Signal Extractor — generates signals on threshold
* [ ] First Reflection Summary — generates reflection after plan completion
* [ ] Safe Brain Daemon — starts, runs heartbeat, shuts down gracefully
* [ ] Brain API Endpoints — all endpoints return valid data
* [ ] Minimal Brain State Viewer — dashboard shows brain state
* [ ] P13 Dogfood Report — complete report generated
* [ ] Integration queue is clean or intentionally blocked with handoff
* [ ] No forbidden commands or files were used
* [ ] Typecheck/build/test requirements passed

---

## 10. Rollback Playbook

**Trigger conditions:**
* Brain daemon crashes repeatedly (>3 times in 10 minutes)
* Timeline corruption causes data loss
* API endpoints return 500 errors
* Dashboard crashes on brain page
* Memory growth from observation flood

**Rollback procedure:**
1. Set environment variable `BRAIN_ENABLED=false`
2. Stop daemon process
3. Keep timeline store read-only (don't delete)
4. Remove API routes from web-server config
5. Set scale mode to `stable_3` if needed
6. Fall back to previous execution behavior
7. Preserve `.pi/brain/` artifacts for debugging

**Expected outcome:** Execution core unaffected, V2 capability disabled.

---

## 11. What Next Phase Inherits

**P14 inherits:**
* Brain domain model types
* Brain timeline store with data
* Observation engine (for memory source)
* Active signals (for memory categories)
* API endpoints that need memory integration

**P14 may add:**
* Memory domain model types
* Memory persistence layer
* Memory lifecycle management
* Conflict detection
* Memory query API
* Memory viewer UI

---

# Part 2 — Agent Brief

## Mission

Implement all P13 — P13 Dogfood & Report — workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
* Daemon panic must not cascade to executor
* Observation engine must not block on full queue

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
    "phase": "P13",
    "title": "Brain Core Vertical Slice & Orchestrator Daemon",
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
      "title": "Brain Types, Timeline & State",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation types; all others depend on this"
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
        "queueOptimizationNotes": "Foundation types; all others depend on this"
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
      "title": "Observation Engine",
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
        "safeParallelismNotes": "Depends on types; no file overlap with 7.A after types defined"
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
        "queueOptimizationNotes": "Depends on types; no file overlap with 7.A after types defined"
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
      "title": "Queue Health Monitor",
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
        "safeParallelismNotes": "Depends on types; no file overlap with 7.A"
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
        "queueOptimizationNotes": "Depends on types; no file overlap with 7.A"
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
      "title": "Execution Journal",
      "dependencies": [
        "7.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.D must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on types; no file overlap with 7.A"
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
        "queueOptimizationNotes": "Depends on types; no file overlap with 7.A"
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
      "title": "Signal Collectors & Extractors",
      "dependencies": [
        "7.B",
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
        "safeParallelismNotes": "Depends on observation engine and journal"
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
        "queueOptimizationNotes": "Depends on observation engine and journal"
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
      "title": "Brain API",
      "dependencies": [
        "7.B",
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
        "safeParallelismNotes": "Depends on observation and signals"
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
        "queueOptimizationNotes": "Depends on observation and signals"
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
      "title": "Daemon & Orchestrator",
      "dependencies": [
        "7.B",
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
        "safeParallelismNotes": "Depends on all prior workstreams"
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
        "queueOptimizationNotes": "Depends on all prior workstreams"
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
      "id": "7.H",
      "title": "First Reflection Hook",
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
        "safeParallelismNotes": "Lightweight hook; no heavy deps"
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
        "queueOptimizationNotes": "Lightweight hook; no heavy deps"
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
      "title": "P13 Dogfood & Report",
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
        "safeParallelismNotes": "Validation only; no file creation"
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
        "queueOptimizationNotes": "Validation only; no file creation"
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
  "phase": "P13",
  "title": "P13 Dogfood & Report",
  "primaryGoal": "Implement and validate the P13 second-brain component.",
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
  "completionGate": "All P13 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P14"
}
```

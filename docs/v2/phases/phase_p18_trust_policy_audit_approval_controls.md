# Phase P18 - Trust, Policy, Audit & Approval Controls

**Template:** LLM Implementation Agent - Master Template v2.5
**Version:** 2.5.1
**Created:** 2026-05-19
**Package manager:** npm only
**Status:** Authoritative Implementation
**Last Updated:** 2026-05-19

---

# Part 1 - Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P18`
**One-line goal:** Centralize trust controls so Pi can enforce why an action is allowed, blocked, or approval-gated, with a complete audit trail and decision explanation for every action.
**Why now:** All prior phases (P13-P17) built capabilities. P18 makes them safe. Without trust boundaries, autonomy is dangerous. This is Milestone 3a - "Pi Operates Safely".
**Blast radius:** Policy engine, rule store, approval gate, audit ledger, provenance tracker; `packages/coding-agent/src/brain/policy/`, `packages/coding-agent/src/brain/approvals/`, `packages/coding-agent/src/brain/audit/`, `packages/web-server`, `packages/web-ui/dashboard`.
**Rollback path:** All policies default to `approval_required`, audit kept for debugging.
**Scale mode:** `stable_3`
**Safe parallelism target:** 3
**Done when:** Policy decisions enforced for all actions, approval requests flow correctly, every decision logged to audit, provenance explains any decision, trust dashboard shows state, integration queue clean.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P18` |
| Title | `Trust, Policy, Audit & Approval Controls` |
| Status | `Authoritative Implementation` |
| Last updated | `2026-05-19` |
| Delivery status | `Not started` |
| Target environment | `Local Pi runtime` |
| Primary focus | `Policy engine, approval gates, audit ledger, provenance tracker` |
| Product-code changes | `Allowed - Pi runtime/dashboard/tests/docs only` |
| Selected scale mode | `stable_3` |
| Requested max workers | `6` |
| Expected DAG effective parallelism | `6` |
| Expected safe effective parallelism | `6` |
| Worktree isolation | `Optional` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| P18.A - Policy Engine V0 | Pi Worker Agent | User / owner | Reviewer | User |
| P18.B - Policy Rule Store | Pi Worker Agent | User / owner | Reviewer | User |
| P18.C - Approval Gate | Pi Worker Agent | User / owner | Reviewer | User |
| P18.D - Approval Queue API | Pi Worker Agent | User / owner | Reviewer | User |
| P18.E - Audit Ledger | Pi Worker Agent | User / owner | Reviewer | User |
| P18.F - Provenance Tracker | Pi Worker Agent | User / owner | Reviewer | User |
| P18.G - Trust Dashboard UI | Pi Worker Agent | User / owner | Reviewer | User |
| P18.H - P18 Dogfood & Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

Ensure autonomy remains bounded, observable, reversible, and approved where needed. Every decision must be logged and explainable.

### 2.1 Policy Decision Outcomes

| Outcome | Meaning | When | User Sees |
|---------|---------|------|-----------|
| `allow` | Action executes without approval | Low risk, trusted context | - (automatic) |
| `deny` | Action blocked, no approval possible | Policy-flagged concern | "Blocked by policy: X" |
| `approval_required` | Queued for user approval | Medium/high risk, needs judgment | Approval request notification |
| `forbidden` | Permanently blocked, policy-defined | Hard safety boundary | "Forbidden: this action is never allowed" |

### 2.2 Trust Requirements (from Vision §14)

Pi must:
1. Never execute forbidden actions
2. Always ask for approval when required
3. Log every decision to append-only audit
4. Explain any decision with provenance chain
5. Support emergency stop (blocks all autonomous actions)
6. Support policy rule override (with audit trail)

### 2.3 What P18 Produces

| Component | Output | Purpose |
|-----------|--------|---------|
| Policy Engine V0 | `src/brain/policy/engine.ts` | Evaluate actions against rules |
| Policy Rule Store | `src/brain/policy/rules.ts` | Persist and manage policy rules |
| Approval Gate | `src/brain/approvals/gate.ts` | Queue and process approvals |
| Approval Queue API | `/api/brain/approvals/*` | User approval actions |
| Audit Ledger | `src/brain/audit/ledger.ts` | Append-only decision log |
| Provenance Tracker | `src/brain/policy/provenance.ts` | Link decisions to evidence |
| Trust Dashboard | UI component | Policy state, approvals, audit |

---

## 3. What Carried Over - Must Stay Stable

* [x] P17 plan factory - generated plans must pass policy before queuing
* [x] P16 proposals - proposals classified by DecisionClassifier before generation
* [x] P15 goals/autonomy/decisions - autonomy profile feeds into policy context
* [x] P14 memory - memory operations subject to policy
* [x] P13 observations - observation collection is always allowed (read-only)
* [x] P12.5 execution core - executor calls policy engine before acting
* [x] Integration queue gate - policy on queue operations
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

* [ ] Every action must pass through policy engine before execution
* [ ] Audit entries are append-only - no deletion, no modification
* [ ] Forbidden actions cannot be overridden by autonomy level
* [ ] Approval requests auto-expire after deadline (default 24h)
* [ ] Emergency stop overrides all policy decisions

---

## 4. Background / What Was Wrong

Pi V1 had no trust model - it executed whatever the plan said. V2 autonomy requires bounded authority.

### 4.1 V1 Limitations Addressed by P18

| V1 Limitation | P18 Solution |
|---------------|--------------|
| No action authorization | Policy engine evaluates every action |
| No user approval flow | Approval gate queues requests |
| No decision audit trail | Append-only audit ledger |
| No decision explanation | Provenance tracker links to evidence |
| No emergency stop | Emergency stop blocks all autonomous actions |
| No policy customization | Rule store with CRUD API |

### 4.2 Example: Policy Evaluation Flow

```
Proposal: "Create new memory from workspace results"
  ↓
Policy Engine receives: { action: 'memory_creation', autonomyLevel: 3, ... }
  ↓
Evaluates rules in priority order:
  1. forbid_001 (secret_access) → no match
  2. forbid_002 (destructive_cleanup) → no match
  3. appr_001 (execute_generated_plan) → no match
  4. auto_001 (retry_transient_failure) → no match
  ...
  5. exec_default (catch-all for execution actions) → match! decision: 'allow'
  ↓
Policy Engine returns: { decision: 'allow', matchedRule: exec_default, ... }
  ↓
Audit Ledger logs: { action: 'memory_creation', decision: 'allow', ... }
  ↓
Memory creation proceeds
```

---

## 5. Current Failure State / Known Blockers

* `p18_policy_engine` = not implemented
* `p18_policy_rule_store` = not implemented
* `p18_approval_gate` = not implemented
* `p18_approval_api` = not implemented
* `p18_audit_ledger` = not implemented
* `p18_provenance_tracker` = not implemented
* `p18_trust_dashboard` = not implemented
* `worktree_isolation` = optional for this phase
* `integration_queue` = enabled and required
* `scale_mode_readiness` = experimental_6 ready

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:---:|:---:|---|
| Policy rule mismatch allows unauthorized action | low | critical | Default to deny; explicit allow rules; testing |
| Approval gate deadlock (no user response) | med | med | Auto-expire after 24h; user notification |
| Audit ledger corruption | low | high | Append-only; atomic writes; rotation |
| Emergency stop not responsive | low | critical | Service-level kill switch separate from runtime |
| Provenance chain broken | med | med | Graceful fallback to partial chain; log error |
| Policy rule conflict (same action, different decisions) | low | high | Priority ordering; highest priority wins; detect conflicts |
| Approval bypass via invalid request ID | low | high | Validate all request IDs in store |
| TL;DR - what if user doesn't read audit | med | low | Dashboard summary; morning report includes audit highlights |

---

## 7. Workstreams

### 7.A - Policy Engine V0

**Goal:** Evaluate any action against policy rules and return a decision (allow/deny/approval_required/forbidden).

**Requirements:**
* Rule-based evaluation with priority ordering (higher priority evaluated first)
* Match against action name (supports glob patterns: "memory_*")
+ Context-aware (autonomy level, risk level, affected system)
* Cache recent decisions for performance
* Default to `deny` if no matching rule (fail safe)
* Integration with AuditLedger for decision logging

**Acceptance Criteria:**
* [ ] Evaluates single action correctly
* [ ] Priority ordering works (higher wins)
* [ ] Glob patterns match ("memory_*" matches "memory_creation")
* [ ] Context filtering works (by autonomy level, risk level)
* [ ] Default deny when no rule matches
* [ ] Cache returns correct cached result
* [ ] All decisions produce AuditEntry

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/policy/engine.ts

export type PolicyDecision = 'allow' | 'deny' | 'approval_required' | 'forbidden';

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
  decision: PolicyDecision;
  priority: number;                    // higher = evaluated first
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyCondition {
  action: string;                      // action name, supports glob "memory_*"
  actionType?: ProposalType;           // narrow to proposal type
  minAutonomyLevel?: AutonomyLevel;    // minimum level for this rule to apply
  maxAutonomyLevel?: AutonomyLevel;    // maximum level
  riskLevel?: RiskLevel | RiskLevel[];
  affectedArea?: string;
  contextMatch?: Record<string, unknown>;
  timeRestriction?: {
    start: string;                     // HH:mm
    end: string;
    timezone?: string;
  };
}

export interface PolicyContext {
  action: string;
  actionType?: ProposalType;
  actor: 'pi' | 'user' | 'system';
  autonomyLevel: AutonomyLevel;
  riskLevel?: RiskLevel;
  proposalId?: string;
  memoryId?: string;
  planExecId?: string;
  affectedSystem?: string;
  metadata: Record<string, unknown>;
}

export interface PolicyResult {
  decision: PolicyDecision;
  matchedRule: PolicyRule | null;
  allEvaluatedRules: Array<{ rule: PolicyRule; matched: boolean; reason?: string }>;
  explanation: string;
  evaluatedAt: string;
  durationMs: number;
}

export class PolicyEngine {
  private ruleStore: PolicyRuleStore;
  private cache: Map<string, { result: PolicyResult; cachedAt: number }>;
  private cacheTtlMs: number;  // default 5000ms

  constructor(ruleStore: PolicyRuleStore, config?: { cacheTtlMs?: number });

  // Core evaluation
  async evaluate(context: PolicyContext): Promise<PolicyResult>;

  async evaluateWithAudit(
    context: PolicyContext,
    auditLedger: AuditLedger,
  ): Promise<PolicyResult & { auditEntry: AuditEntry }>;

  // Matching
  private findMatchingRules(context: PolicyContext): PolicyRule[];
  private evaluateCondition(condition: PolicyCondition, context: PolicyContext): boolean;
  private matchGlob(pattern: string, value: string): boolean;
  private sortByPriority(rules: PolicyRule[]): PolicyRule[];

  // Explanation
  explain(result: PolicyResult): string;
  explainSimple(decision: PolicyDecision, rule: PolicyRule | null): string;

  // Convenience
  async canAutoExecute(context: PolicyContext): Promise<boolean>;
  async requiresApproval(context: PolicyContext): Promise<boolean>;
  async isForbidden(context: PolicyContext): Promise<boolean>;

  // Cache management
  clearCache(): void;
  invalidateForAction(action: string): void;
  private cacheKey(context: PolicyContext): string;

  // Default (fallback)
  private getDefaultDecision(): PolicyDecision;  // returns 'deny'
}
```

**File Scope:** `packages/coding-agent/src/brain/policy/engine.ts`, `packages/coding-agent/test/brain/policy/engine.test.ts`, `packages/coding-agent/test/fixtures/policy/test-rules.json`

**Dependencies:** P18.B (PolicyRuleStore)

---

### 7.B - Policy Rule Store

**Goal:** Persist, load, and manage policy rules. Support CRUD, default rules, conflict detection.

**Requirements:**
* JSON file persistence under `.pi/brain/policy/rules/`
* Auto-load default rules on first init
* Conflict detection: rules matching same action with different decisions at same priority
* Export/import rule sets
* Error recovery: backup on save, rollback on failure

**Acceptance Criteria:**
* [ ] Rules persist and load correctly
* [ ] Default rules loaded on first init
* [ ] CRUD operations work
* [ ] Conflict detection identifies overlapping rules
* [ ] Backup on save prevents data loss
* [ ] Multi-file export/import

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/policy/rules.ts

export interface RuleStoreConfig {
  basePath: string;        // .pi/brain/policy/rules/
  autoSave: boolean;       // default true
  backupOnSave: boolean;   // default true
}

export interface RuleConflict {
  ruleA: PolicyRule;
  ruleB: PolicyRule;
  matchAction: string;
  conflictType: 'different_decision' | 'overlap' | 'redundant';
}

export class PolicyRuleStore {
  private config: RuleStoreConfig;
  private rules: PolicyRule[] = [];

  constructor(config?: Partial<RuleStoreConfig>);

  // Lifecycle
  async initialize(): Promise<void>;

  // CRUD
  getRules(): PolicyRule[];
  getRule(id: string): PolicyRule | null;
  addRule(rule: PolicyRule): Promise<void>;
  updateRule(id: string, updates: Partial<PolicyRule>): Promise<void>;
  removeRule(id: string): Promise<void>;

  // Query
  findMatching(context: PolicyContext): PolicyRule[];
  findByAction(action: string): PolicyRule[];
  findByDecision(decision: PolicyDecision): PolicyRule[];

  // Conflicts
  detectConflicts(): RuleConflict[];
  findConflictsForRule(rule: PolicyRule): RuleConflict[];

  // Defaults
  getDefaultRules(): PolicyRule[];
  resetToDefaults(): Promise<void>;
  isDefaultRule(id: string): boolean;

  // Persistence
  async save(): Promise<void>;
  async load(): Promise<void>;
  private getFilePath(): string;
  private createBackup(): Promise<void>;
}

// Default rules loaded on first init:
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // === Allow (low risk, high trust) ===
  {
    id: 'allow_001', name: 'Retry transient failures',
    description: 'Allow Pi to retry transient network or service failures automatically',
    condition: { action: 'retry_transient_failure' },
    decision: 'allow', priority: 100, enabled: true,
  },
  {
    id: 'allow_002', name: 'Generate draft proposals',
    description: 'Allow Pi to generate draft proposals from observations and memory',
    condition: { action: 'generate_draft_proposal' },
    decision: 'allow', priority: 100, enabled: true,
  },
  {
    id: 'allow_003', name: 'Create read-only summaries',
    description: 'Allow Pi to create read-only summaries of execution results',
    condition: { action: 'create_read_only_summary' },
    decision: 'allow', priority: 100, enabled: true,
  },
  {
    id: 'allow_004', name: 'Observe system state',
    description: 'Allow Pi to observe execution state, queue state, and file state',
    condition: { action: 'observe_system_state' },
    decision: 'allow', priority: 100, enabled: true,
  },
  {
    id: 'allow_005', name: 'Query memory',
    description: 'Allow Pi to query memory records for planning and proposals',
    condition: { action: 'memory_query' },
    decision: 'allow', priority: 100, enabled: true,
  },

  // === Approval Required (medium risk) ===
  {
    id: 'appr_001', name: 'Execute generated plans',
    description: 'Require user approval before executing any generated plan',
    condition: { action: 'execute_generated_plan' },
    decision: 'approval_required', priority: 90, enabled: true,
  },
  {
    id: 'appr_002', name: 'Protected system mutation',
    description: 'Require approval for changes to protected systems (core, config, etc.)',
    condition: { action: 'protected_system_mutation' },
    decision: 'approval_required', priority: 90, enabled: true,
  },
  {
    id: 'appr_003', name: 'Create memory from observations',
    description: 'Require approval before creating new memory records from LLM output',
    condition: { action: 'memory_creation' },
    decision: 'approval_required', priority: 90, enabled: true,
  },
  {
    id: 'appr_004', name: 'Architecture changes',
    description: 'Require approval for any architectural changes across packages',
    condition: { action: 'architecture_change' },
    decision: 'approval_required', priority: 90, enabled: true,
  },
  {
    id: 'appr_005', name: 'Extension permission changes',
    description: 'Require approval to expand or modify extension permissions',
    condition: { action: 'extension_permission_expansion' },
    decision: 'approval_required', priority: 90, enabled: true,
  },
  {
    id: 'appr_006', name: 'Autonomy level change',
    description: 'Require approval to change autonomy level above current',
    condition: { action: 'autonomy_level_change' },
    decision: 'approval_required', priority: 90, enabled: true,
  },

  // === Forbidden (hard stops, cannot be overridden) ===
  {
    id: 'forbid_001', name: 'Access secrets',
    description: 'Never access secret keys, tokens, or passwords',
    condition: { action: 'secret_access' },
    decision: 'forbidden', priority: 1000, enabled: true,
  },
  {
    id: 'forbid_002', name: 'Destructive cleanup',
    description: 'Never run raw rm -rf or other destructive cleanup',
    condition: { action: 'destructive_cleanup' },
    decision: 'forbidden', priority: 1000, enabled: true,
  },
  {
    id: 'forbid_003', name: 'Git push',
    description: 'Never push to git autonomously',
    condition: { action: 'git_push' },
    decision: 'forbidden', priority: 1000, enabled: true,
  },
  {
    id: 'forbid_004', name: 'Irreversible deletion',
    description: 'Never perform irreversible file deletion',
    condition: { action: 'irreversible_deletion' },
    decision: 'forbidden', priority: 1000, enabled: true,
  },
  {
    id: 'forbid_005', name: 'Bypass validation gates',
    description: 'Never bypass validation gates (typecheck, build, test)',
    condition: { action: 'bypass_validation_gate' },
    decision: 'forbidden', priority: 1000, enabled: true,
  },
];
```

**File Scope:** `packages/coding-agent/src/brain/policy/rules.ts`, `packages/coding-agent/test/brain/policy/rules.test.ts`

**Dependencies:** P18.A (PolicyRule type)

---

### 7.C - Approval Gate

**Goal:** Queue, process, and expire approval requests for policy decisions that require user approval.

**Requirements:**
* Create approval request from PolicyContext + Proposal
* Process: approve, reject, defer
* Auto-expire after configurable deadline (default 24h)
* Notify on approval request creation (future: email)
* Persist approval requests for audit

**Acceptance Criteria:**
* [ ] ApprovalRequest created from policy decision
* [ ] Approve sets status to approved, logs audit entry
* [ ] Reject sets status to rejected, logs audit entry with reason
* [ ] Defer extends deadline
* [ ] Auto-expire after deadline
* [ ] Query pending, approved, rejected, expired
* [ ] Persistence survives restart

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/approvals/gate.ts

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  proposalId: string;
  action: string;
  rationale: string;
  risk: ProposalRiskAssessment;
  requestedAt: string;
  deadline: string;                   // default +24h
  requestedBy: string;
  status: ApprovalStatus;
  approvedBy?: string;
  rejectedBy?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  policyRuleId?: string;
  policyContext: PolicyContext;
}

export interface ApprovalConfig {
  defaultDeadlineHours: number;       // default 24
  autoExpireCheckIntervalMs: number;  // default 3600000 (1h)
  requireReasonOnRejection: boolean;  // default true
  maxPendingPerType: number;          // default 10
}

export class ApprovalGate {
  private config: ApprovalConfig;
  private pending: Map<string, ApprovalRequest> = new Map();
  private history: ApprovalRequest[] = [];
  private expireTimer?: NodeJS.Timeout;
  private persistencePath: string;

  constructor(
    private policyEngine: PolicyEngine,
    private auditLedger: AuditLedger,
    config?: Partial<ApprovalConfig>,
  );

  // Lifecycle
  async initialize(): Promise<void>;

  // Request
  async requestApproval(context: PolicyContext, proposal: Proposal): Promise<ApprovalRequest>;
  canRequestAnotherApproval(type: string): boolean;

  // Actions
  async approve(requestId: string, approvedBy: string): Promise<ApprovalRequest>;
  async reject(requestId: string, rejectedBy: string, reason?: string): Promise<ApprovalRequest>;
  async defer(requestId: string, hours?: number): Promise<ApprovalRequest>;

  // Query
  getPending(): ApprovalRequest[];
  getApproved(): ApprovalRequest[];
  getRejected(): ApprovalRequest[];
  getExpired(): ApprovalRequest[];
  getById(id: string): ApprovalRequest | null;
  getByProposal(proposalId: string): ApprovalRequest[];

  // Expiry
  startExpiryCheck(): void;
  stopExpiryCheck(): void;
  async checkExpired(): Promise<ApprovalRequest[]>;
  private isExpired(request: ApprovalRequest): boolean;

  // Persistence
  async save(): Promise<void>;
  async load(): Promise<void>;

  // Stats
  getStats(): ApprovalStats;

  // Configuration
  setConfig(config: Partial<ApprovalConfig>): void;
  getConfig(): ApprovalConfig;
}

export interface ApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  avgResponseTimeMs: number;
  pendingByType: Record<string, number>;
}
```

**File Scope:** `packages/coding-agent/src/brain/approvals/gate.ts`, `packages/coding-agent/src/brain/approvals/store.ts`, `packages/coding-agent/test/brain/approvals/gate.test.ts`

**Dependencies:** P18.A (PolicyEngine), P18.E (AuditLedger)

---

### 7.D - Approval Queue API

**Goal:** REST API for listing, approving, rejecting, and deferring approval requests.

**Acceptance Criteria:**
* [ ] GET /api/brain/approvals - list pending
* [ ] GET /api/brain/approvals/{id} - get single
* [ ] POST /api/brain/approvals/{id}/approve - approve
* [ ] POST /api/brain/approvals/{id}/reject - reject with reason
* [ ] POST /api/brain/approvals/{id}/defer - extend deadline
* [ ] GET /api/brain/approvals/stats - stats
* [ ] GET /api/brain/approvals/history - completed approvals

**API Specifications:**

```
GET /api/brain/approvals
Query: status? (pending|approved|rejected|expired), limit?, offset?
Response: { approvals: ApprovalRequest[], total: number, stats: ApprovalStats }

GET /api/brain/approvals/{id}
Response: ApprovalRequest

POST /api/brain/approvals/{id}/approve
Body: { approvedBy: string }
Response: ApprovalRequest

POST /api/brain/approvals/{id}/reject
Body: { rejectedBy: string, reason?: string }
Response: ApprovalRequest

POST /api/brain/approvals/{id}/defer
Body: { newDeadline?: string, reason?: string }
Response: ApprovalRequest

GET /api/brain/approvals/stats
Response: ApprovalStats

GET /api/brain/approvals/history
Query: limit?, offset?, since?, until?
Response: { approvals: ApprovalRequest[], total: number }
```

**File Scope:** `packages/web-server/src/routes/brain/approvals.ts`, `packages/coding-agent/src/brain/approvals/api.ts`

**Dependencies:** P18.C (ApprovalGate)

---

### 7.E - Audit Ledger

**Goal:** Append-only, immutable decision log for every policy evaluation.

**Requirements:**
* Append-only - no in-place updates or deletion
* Line-delimited JSON (`.ndjson`) for easy tailing
* Auto-rotate at configurable size (default 100MB)
* Query by actor, action, decision, date range
* Thread-safe writes (single writer with lock)
* Corruption-tolerant reader (skip unparseable lines, log error)

**Acceptance Criteria:**
* [ ] Append writes atomically (write to temp, rename)
* [ ] Query returns filtered results
* [ ] Rotation triggers at configured size
* [ ] Corruption tolerance: bad lines skipped with error log
* [ ] Stats computed correctly
* [ ] Empty file handled gracefully

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/audit/ledger.ts

export interface AuditEntry {
  id: string;                          // ULID
  timestamp: string;                   // ISO 8601
  actor: 'pi' | 'user' | 'system';
  action: string;
  decision: PolicyDecision;
  policyRuleId?: string;
  policyRuleName?: string;
  proposalId?: string;
  planExecId?: string;
  memoryId?: string;
  approvalRequestId?: string;
  evidence: SourceRef[];
  result: 'success' | 'failure' | 'blocked';
  durationMs?: number;
  context: {
    autonomyLevel: AutonomyLevel;
    riskLevel?: RiskLevel;
  };
  metadata: Record<string, unknown>;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  decision?: PolicyDecision;
  result?: 'success' | 'failure' | 'blocked';
  startDate?: string;
  endDate?: string;
  proposalId?: string;
  planExecId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEntries: number;
  byDecision: Record<PolicyDecision, number>;
  byActor: Record<string, number>;
  byResult: Record<string, number>;
  byDate: Record<string, number>;
  dateRange: { first: string; last: string };
  fileSize: number;
  fileCount: number;
}

export class AuditLedger {
  private basePath: string;
  private rotationThresholdBytes: number;
  private writeStream?: fs.WriteStream;
  private writeLock: Promise<void> = Promise.resolve();
  private buffer: AuditEntry[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(options?: {
    basePath?: string;                    // default: .pi/brain/audit/
    rotationThresholdBytes?: number;      // default: 100MB
    flushIntervalMs?: number;             // default: 5000ms
    batchSize?: number;                   // default: 50
  });

  // Append
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry>;

  // Query
  async query(filters: AuditQuery): Promise<AuditEntry[]>;
  async get(id: string): Promise<AuditEntry | null>;

  // Convenience queries
  async findByActor(actor: string, limit?: number): Promise<AuditEntry[]>;
  async findByAction(action: string, limit?: number): Promise<AuditEntry[]>;
  async findByDateRange(start: string, end: string): Promise<AuditEntry[]>;
  async findByProposal(proposalId: string): Promise<AuditEntry[]>;
  async findByPlanExec(planExecId: string): Promise<AuditEntry[]>;
  async recentDecisions(count?: number): Promise<AuditEntry[]>;
  async findBlockedActions(limit?: number): Promise<AuditEntry[]>;

  // Stats
  async getStats(): Promise<AuditStats>;

  // Flush
  async flush(): Promise<void>;
  private scheduleFlush(): void;
  private flushBuffer(): Promise<void>;

  // File management
  private getCurrentFilePath(): string;
  private candidateFilePath(date?: Date): string;
  private needsRotation(): Promise<boolean>;
  private async rotateIfNeeded(): Promise<void>;

  // Internal
  private generateId(): string;
  private ensureWriteStream(): Promise<void>;
  private parseEntry(line: string): AuditEntry | null;
  private serializeEntry(entry: AuditEntry): string;
}
```

**File Structure:**
```
.pi/brain/audit/
├── 2026/
│   ├── 05/
│   │   ├── 19.ndjson              # YYYY/MM/DD.ndjson
│   │   ├── 19.rotated.1.ndjson    # After rotation
│   │   └── 19.rotated.2.ndjson
│   └── 06/
│       └── 01.ndjson
└── current.ndjson                  # Symlink or active file
```

**File Scope:** `packages/coding-agent/src/brain/audit/ledger.ts`, `packages/coding-agent/test/brain/audit/ledger.test.ts`, `packages/coding-agent/test/fixtures/audit/sample-entries.ndjson`

**Dependencies:** None (standalone append-only log)

---

### 7.F - Provenance Tracker

**Goal:** Track decision provenance chains so every action can be explained with its evidence lineage.

**Requirements:**
* Link every decision to its input context (proposal, memory, observation refs)
* Maintain directed provenance chain: decision → policy evaluation → evidence
* Support "why did Pi do X?" explanations
* Persist provenance records to `.pi/brain/audit/provenance/`

**Acceptance Criteria:**
* [ ] ProvenanceRecord created for every policy evaluation
* [ ] Chain links to proposal, memory, observation, policy rule
* [ ] Explanation generation includes chain traversal
* [ ] Query by target ID returns full chain
* [ ] Persistence survives restart

**Implementation Details:**

```typescript
// packages/coding-agent/src/brain/policy/provenance.ts

export type ProvenanceTargetType = 'proposal' | 'plan' | 'memory' | 'decision' | 'approval';

export type ProvenanceRelationship =
  | 'derived_from'
  | 'supported_by'
  | 'triggered_by'
  | 'corrected_by'
  | 'evaluated_by'
  | 'resulted_in';

export interface ProvenanceLink {
  sourceId: string;
  sourceType: ProvenanceTargetType;
  relationship: ProvenanceRelationship;
  timestamp: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface ProvenanceRecord {
  id: string;
  targetId: string;
  targetType: ProvenanceTargetType;
  links: ProvenanceLink[];
  createdAt: string;
  updatedAt: string;
}

export class ProvenanceTracker {
  private persistencePath: string;
  private records: Map<string, ProvenanceRecord> = new Map();

  constructor(options?: { persistencePath?: string });

  // Track
  async track(
    targetId: string,
    targetType: ProvenanceTargetType,
    links: ProvenanceLink[],
  ): Promise<ProvenanceRecord>;

  async addLink(
    targetId: string,
    link: ProvenanceLink,
  ): Promise<ProvenanceRecord>;

  // Query
  async getProvenance(targetId: string): Promise<ProvenanceRecord | null>;
  async getChain(targetId: string): Promise<ProvenanceLink[]>;

  // Explanation
  async explainDecision(decisionAuditEntry: AuditEntry): Promise<string>;
  async explainProposal(proposalId: string): Promise<string>;
  async explainMemory(memoryId: string): Promise<string>;

  private buildExplanationChain(
    targetId: string,
    visited: Set<string>,
    depth: number,
  ): string[];

  // Persistence
  async save(): Promise<void>;
  async load(): Promise<void>;
  private getFilePath(): string;

  // Stats
  async getStats(): Promise<{
    totalRecords: number;
    totalLinks: number;
    byType: Record<ProvenanceTargetType, number>;
  }>;
}
```

**File Scope:** `packages/coding-agent/src/brain/policy/provenance.ts`, `packages/coding-agent/test/brain/policy/provenance.test.ts`

**Dependencies:** P18.E (AuditEntry)

---

### 7.G - Trust Dashboard UI

**Goal:** Dashboard showing policy state, approval queue, audit stats, emergency stop.

**Acceptance Criteria:**
* [ ] Policy rules list with enable/disable toggle
* [ ] Approval queue summary with action buttons
* [ ] Audit stats with time-series chart
* [ ] Emergency stop button (big red)
* [ ] Decision explanation viewer

**Component Structure:**

```
packages/web-ui/dashboard/src/components/
  brain/
    trust/
      PolicyRuleList.tsx             # Rules table with toggle
      ApprovalQueueSummary.tsx       # Pending/approved/rejected counts
      ApprovalActionButton.tsx       # Approve/Reject/Defer
      AuditStats.tsx                 # Statistics charts
      DecisionExplainer.tsx          # Explain a decision by ID
      EmergencyStopButton.tsx        # Big red button
      index.ts
```

**Dashboard Page:** `/brain/trust`

**File Scope:** `packages/web-ui/dashboard/src/components/brain/trust/*.tsx`, `packages/web-ui/dashboard/src/pages/BrainTrust.tsx`

**Dependencies:** P18.A, P18.C, P18.E (API endpoints)

---

### 7.H - P18 Dogfood & Report

**Goal:** Trust controls work end-to-end: policy blocks forbidden actions, approval flows work, audit captures everything.

**Acceptance Criteria:**
* [ ] Policy engine correctly evaluates test actions
* [ ] Forbidden actions blocked and audited
* [ ] Approval request created, approved, confirmed in audit
* [ ] Emergency stop blocks autonomous actions
* [ ] Dashboard shows all states

**Dogfood Report:** Match P15-P17 report format.

---

## 8. Combined Implementation Order

```text
Phase: P18 - Trust, Policy, Audit & Approval Controls
======================================================

Batch 1 (Core):
  P18.A - Policy Engine V0
  P18.B - Policy Rule Store
  P18.E - Audit Ledger

Batch 2 (Approvals):
  P18.C - Approval Gate
  P18.D - Approval Queue API
  P18.F - Provenance Tracker

Batch 3 (UI):
  P18.G - Trust Dashboard UI

Batch 4 (Validation):
  P18.H - P18 Dogfood & Report
```

**Dependency Rationale:**
- Policy engine needs rule store
- Audit ledger is independent (can build first)
- Approval gate needs policy engine + audit
- Provenance tracker needs audit
- UI needs all APIs

---

## 9. API Endpoints (Full List)

```
# Policy
GET    /api/brain/policy/rules                        # List all rules
GET    /api/brain/policy/rules/:id                    # Get single rule
POST   /api/brain/policy/rules                        # Create rule
PUT    /api/brain/policy/rules/:id                    # Update rule
DELETE /api/brain/policy/rules/:id                    # Delete rule
PUT    /api/brain/policy/rules/:id/toggle             # Enable/disable rule
POST   /api/brain/policy/reset                        # Reset to defaults
POST   /api/brain/policy/evaluate                     # Evaluate action
POST   /api/brain/policy/explain                      # Explain decision
GET    /api/brain/policy/conflicts                    # List rule conflicts

# Approvals
GET    /api/brain/approvals                           # List approvals
GET    /api/brain/approvals/:id                       # Get single
POST   /api/brain/approvals/:id/approve               # Approve
POST   /api/brain/approvals/:id/reject                # Reject
POST   /api/brain/approvals/:id/defer                 # Defer
GET    /api/brain/approvals/stats                     # Stats
GET    /api/brain/approvals/history                   # History

# Audit
GET    /api/brain/audit                               # Query audit
GET    /api/brain/audit/:id                           # Get single
GET    /api/brain/audit/stats                         # Stats
GET    /api/brain/audit/recent                        # Recent decisions

# Provenance
GET    /api/brain/provenance/:targetId                # Get provenance
GET    /api/brain/provenance/:targetId/explain        # Human-readable explanation

# Emergency
POST   /api/brain/emergency/stop                      # Emergency stop
POST   /api/brain/emergency/release                   # Release stop
GET    /api/brain/emergency/status                    # Check stop status
```

---

## 10. Definition of Done

P18 is complete when ALL are true:

* [ ] Policy Engine - evaluates actions correctly, default deny, glob matching
* [ ] Policy Rule Store - CRUD works, default rules loaded, conflicts detected
* [ ] Approval Gate - requests created, approved/rejected/expired
* [ ] Approval API - all endpoints functional
* [ ] Audit Ledger - append-only, queryable, rotation works
* [ ] Provenance Tracker - decision chains built, explanations generated
* [ ] Trust Dashboard UI - policy rules, approvals, audit, emergency stop
* [ ] P18 Dogfood Report - complete report generated
* [ ] Integration queue is clean or intentionally blocked with handoff
* [ ] No forbidden commands or files were used
* [ ] Typecheck/build/test requirements passed

---

## 11. Rollback Playbook

**Trigger conditions:**
* Policy misconfiguration blocks legitimate actions
* Approval gate fails to process requests
* Audit ledger corruption
* Emergency stop fails

**Rollback procedure:**
1. Set all decision defaults to `approval_required`
2. Audit entries remain readable (read-only)
3. Disable emergency stop if malfunctioning
4. Keep provenance files for post-mortem

---

## 12. What Next Phase Inherits

**P19 inherits:**
* Policy engine integrated into all actions
* Approval queue with pending requests
* Audit ledger with history
* Provenance tracker for explanations

**P19 may add:**
* Trust/audit views to dashboard
* Approval action buttons in inbox
* Emergency stop in header
* Audit visualizations


---

# Part 2 - Agent Brief

## Mission

Implement all P18 - P18 Dogfood & Report - workstreams end-to-end. Create every file specified in the changed-files analysis. Ensure all TypeScript interfaces match the spec, all API endpoints return correct types, and all UI components handle loading/error/empty states. Run `npm run check` after completion.

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
* Auth audit entries are append-only - no deletion
* Forbidden actions cannot be overridden by autonomy level

---

# Part 3 - Machine-Readable Execution Contract

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
    "phase": "P18",
    "title": "Trust, Policy, Audit & Approval Controls",
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
      "title": "Policy Engine V0",
      "dependencies": [
        "7.B"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.A must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on rule store"
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
        "queueOptimizationNotes": "Depends on rule store"
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
      "title": "Policy Rule Store",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.B must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; no deps"
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
        "queueOptimizationNotes": "Foundation; no deps"
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
      "title": "Approval Gate",
      "dependencies": [
        "7.A",
        "7.E"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.C must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on policy engine and audit ledger"
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
        "queueOptimizationNotes": "Depends on policy engine and audit ledger"
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
      "title": "Approval Queue API",
      "dependencies": [
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
        "safeParallelismNotes": "Depends on approval gate"
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
        "queueOptimizationNotes": "Depends on approval gate"
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
      "title": "Audit Ledger",
      "dependencies": [],
      "parallelGroup": "batch_1",
      "dependencyReason": "7.E must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation; no deps; can build independently"
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
        "queueOptimizationNotes": "Foundation; no deps; can build independently"
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
      "title": "Provenance Tracker",
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
        "safeParallelismNotes": "Depends on audit ledger"
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
        "queueOptimizationNotes": "Depends on audit ledger"
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
      "title": "Trust Dashboard UI",
      "dependencies": [
        "7.A",
        "7.C",
        "7.E"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "7.G must complete before dependent workspaces can start.",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on policy, approvals, audit"
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
        "queueOptimizationNotes": "Depends on policy, approvals, audit"
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
      "title": "P18 Dogfood & Report",
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

# Part 4 - Machine-Readable Summary

```json
{
  "contractVersion": "2.5.1",
  "phase": "P18",
  "title": "P18 Dogfood & Report",
  "primaryGoal": "Implement and validate the P18 second-brain component.",
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
  "completionGate": "All P18 workstreams implemented, tested, and dogfood report generated.",
  "nextPhase": "P19"
}
```

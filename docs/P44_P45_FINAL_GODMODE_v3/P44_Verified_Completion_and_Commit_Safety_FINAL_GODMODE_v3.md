# P44 — Verified Completion Spine & Workspace-Scoped Commit Safety

**Template:** Pi LLM Implementation Agent Master Template v4.1.1  
**Phase:** P44  
**Version:** EXPANDED — Vision-Locked  
**Status:** Ready for implementation  
**Last Updated:** 2026-06-04  
**Selected Mode:** stable_3  
**Target Promotion Mode:** stable_3  
**Max Parallel Workspaces:** 3  
**Worktree Required:** false  
**Patch Transaction Default:** false  
**PostgreSQL Authoritative State:** required  
**JSON Runtime Fallback:** forbidden  
**ExecutionKernel Authority:** required  
**CompletionGate Version:** v2  
**New Commit Boundary:** WorkspaceCommitGate  
**Primary Slogan:** No completion without evidence.  
**Secondary Slogan:** No commit outside the workspace write-set.  

---

## 0. Executive Summary

P44 fixes the trust problem that currently makes Pi stressful to use on real projects.

A worker may say:

```txt
VERDICT: COMPLETE
```

but that statement alone must never:

```txt
transition a workspace to COMPLETE
unblock dependencies
commit files
hide validation gaps
override CompletionGate
override the ExecutionKernel
```

P44 creates a verified completion pipeline:

```txt
Worker final response
  -> TerminalVerdictParser
  -> WorkerCompletionReport parser
  -> EvidenceLedger
  -> CompletionGate v2
  -> PostImplementationAuditor
  -> WorkspaceCommitGate
  -> explicit scoped commit
  -> ExecutionKernel workspace_complete transition
```

After P44, Pi can answer:

```txt
What did the worker claim?
What did the worker actually change?
Which acceptance criteria are satisfied?
Which evidence proves that?
Which files are allowed to be committed?
Which files were actually staged and committed?
Why was completion accepted or blocked?
```

P44 is the minimum trust foundation before P45 async assembly or any higher parallelism.

---

## 0.1 Preface: The Vision (from P44 Vision Document)

P44 exists because Pi must stop trusting worker self-report.

The fundamental shift:

```txt
OLD: "worker said it is done" -> done
NEW: "worker said it is done" -> not enough
     "worker proved it is done" -> gate verifies evidence
       -> commit gate stages only owned files
       -> ExecutionKernel transitions state
```

### 0.1.1 Three Separate Truths

The operator experience is built around three separate truths that the dashboard must keep distinct:

| Truth | Question | Source | Authority |
|-------|----------|--------|-----------|
| **Claim** | "What did the worker say?" | Live log, `VERDICT: COMPLETE` | Worker self-report |
| **Evidence** | "What did the worker actually do?" | EvidenceLedger, AC coverage, tests, negative checks | CompletionGate v2 |
| **Commit** | "What files were touched and staged?" | git diff, WorkspaceWriteSet, staged files | WorkspaceCommitGate |

These three truths must never conflate. A dashboard that shows "COMPLETE" because the live log says `VERDICT: COMPLETE` is lying to the operator. P44 ensures the dashboard answers each question independently.

### 0.1.2 Why Commit Scope Is Part of Completion

Completion without scoped commit safety is still unsafe.

A worker might implement the right thing — pass all acceptance criteria, run all tests — then accidentally commit unrelated work with:

```bash
git add .
```

That one command can commit:

- Another workspace's files
- Human edits
- Debug files
- Stale failed-attempt changes
- Temporary logs

So P44 treats commit scope as a first-class trust boundary, not an afterthought:

```txt
CompletionGate v2  -> verifies done-ness (evidence)
WorkspaceCommitGate -> verifies commit scope (boundary)
Both must pass.      -> ExecutionKernel transitions
```

### 0.1.3 Minimum Useful P44

If the team is tired or deadline pressure mounts, P44-lite is enough:

1. `VERDICT: COMPLETE` is claim-only, not authority.
2. Missing evidence blocks completion.
3. Target command evidence is required.
4. Stale completion (wrong attemptId) is ignored.
5. Terminal attempts cannot remain RUNNING.
6. CompletionGate block reason must be visible in the dashboard.
7. Validation commands cannot use `|| true` or `|| exit 0`.
8. Commit path stages only workspace-owned files.
9. `git add .`, `git add -A`, and `git commit -a` are forbidden.
10. Fake-complete and commit-scope gauntlet tests exist.

That is enough to make Pi substantially safer for real projects.

---

## 1. Why P44 Exists

There are two independent but related failure modes.

### 1.1 Fake Complete

A worker can claim completion even when:

```txt
a requested task was skipped
target command was not run
tests failed
tests were not found
negative requirements were not checked
the final report is prose-only
the final response belongs to a stale attempt
CompletionGate rejected the result but the dashboard hides the reason
the attempt remains RUNNING after terminal output
```

### 1.2 Overbroad Commit

A workspace can complete and commit too broadly if the commit path stages the whole repository.

Forbidden production behaviors:

```bash
git add .
git add -A
git commit -a
```

These can accidentally commit:

```txt
another workspace's files
human edits
debug files
partially generated files
stale failed-attempt changes
temporary logs
unreported artifacts
```

P44 fixes both by requiring evidence-backed completion and workspace-scoped commit safety.

---

## 2. Core Doctrine

```txt
D001 Worker verdict is a claim.
D002 CompletionGate v2 is the authority for completion.
D003 ExecutionKernel is the authority for state transitions.
D004 WorkspaceCommitGate is the authority for staged/committed files.
D005 Self-report is not evidence.
D006 Every required acceptance criterion needs evidence.
D007 Every "must not" requirement needs a negative check.
D008 Every validation requirement needs command evidence.
D009 Every terminal verdict must match the current attempt generation.
D010 Every commit must be scoped to the accepted workspace write-set.
D011 Completion and commit are separate gates.
D012 A workspace can be COMPLETE only after both gates pass when commit is required.
```

---

## 3. Non-Negotiable Invariants

```txt
I-P44-001 No production validation command may contain `|| true` or `|| exit 0`.
I-P44-002 Watch mode is not validation.
I-P44-003 `0 tests found` is failure.
I-P44-004 A prose-only "all done" report is not a valid completion report.
I-P44-005 Missing acceptance evidence blocks completion.
I-P44-006 Missing target command evidence blocks completion when target command exists.
I-P44-007 Failed negative assertion blocks completion.
I-P44-008 Stale attempt COMPLETE is ignored with explicit event.
I-P44-009 Terminal attempt cannot remain RUNNING.
I-P44-010 CompletionGate block reason must be visible in read model/dashboard.
I-P44-011 WorkspaceCommitGate must reject staged files outside accepted write-set.
I-P44-012 WorkspaceCommitGate must reject `git add .`, `git add -A`, and `git commit -a` in production worker commit path.
I-P44-013 Human edits must not be committed by a worker unless explicitly included in the workspace write-set.
I-P44-014 Evidence/report artifacts outside source scope require explicit allowlist.
I-P44-015 JSON runtime fallback remains forbidden.
```

---

## 4. Required Data Contracts

### 4.1 AcceptanceCriterion

```ts
export type AcceptanceRequirementLevel = "required" | "optional" | "deferred";

export interface AcceptanceCriterion {
  id: string; // AC-P44-03-001
  workspaceId: string;
  text: string;
  level: AcceptanceRequirementLevel;
  evidenceRequired: boolean;
  negative?: boolean;
  validationRequirementId?: string;
  forbiddenPatterns?: string[];
  deferReason?: string;
}
```

Rules:

```txt
id must match /^AC-[A-Z0-9]+-[0-9]{2}-[0-9]{3}$/.
required criteria cannot be deferred by a worker.
negative criteria require negative_check evidence.
deferred criteria require deferReason.
phase-critical criteria cannot be deferred.
```

### 4.2 EvidenceItem

```ts
export type EvidenceKind =
  | "file_changed"
  | "file_created"
  | "file_deleted"
  | "test_command"
  | "grep_check"
  | "ast_check"
  | "runtime_output"
  | "event_journal"
  | "report_artifact"
  | "negative_check"
  | "manual_observation";

export interface EvidenceItem {
  id: string;
  acceptanceCriterionId: string;
  kind: EvidenceKind;
  source: string;
  command?: string;
  exitCode?: number;
  outputExcerpt?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  contentHash?: string;
  timestamp: string;
}
```

Evidence validity rules:

```txt
test_command evidence requires command, exitCode, and output excerpt.
exitCode must be 0 unless evidence is proving failure behavior.
"0 tests found" cannot be successful test evidence.
manual_observation cannot satisfy required implementation AC without another evidence kind.
negative_check evidence must include checked pattern or assertion.
```

### 4.3 EvidenceLedger

```ts
export interface EvidenceLedger {
  workspaceId: string;
  attemptId: string;
  items: EvidenceItem[];
  acceptanceCoverage: Record<string, {
    status: "pass" | "missing" | "failed" | "deferred";
    evidenceIds: string[];
    reason?: string;
  }>;
  createdAt: string;
}
```

### 4.4 WorkerCompletionReport

```ts
export interface WorkerCompletionReport {
  workspaceId: string;
  attemptId: string;
  verdictClaim: "COMPLETE" | "FAILED" | "BLOCKED";
  filesChanged: string[];
  commandsRun: Array<{
    command: string;
    exitCode: number;
    startedAt: string;
    completedAt: string;
    outputArtifactPath?: string;
    validationRequirementId?: string;
    noTestsFoundDetected?: boolean;
  }>;
  acceptanceCoverage: Record<string, {
    status: "pass" | "missing" | "failed" | "deferred";
    evidenceIds: string[];
    reason?: string;
  }>;
  negativeChecks: Record<string, {
    status: "pass" | "failed" | "not_run";
    evidenceIds: string[];
  }>;
  limitations: string[];
  finalRisk: "low" | "medium" | "high";
}
```

### 4.5 CompletionGateResult

```ts
export interface CompletionGateResult {
  workspaceId: string;
  attemptId: string;
  verdictClaim: "COMPLETE" | "FAILED" | "BLOCKED";
  gateVerdict: "accepted" | "blocked";
  reasons: string[];
  missingAcceptanceCriteria: string[];
  failedNegativeChecks: string[];
  missingValidationEvidence: string[];
  staleAttempt: boolean;
  terminalState: "complete_allowed" | "blocked" | "failed" | "stale_ignored";
}
```

### 4.6 WorkspaceWriteSet

```ts
export interface WorkspaceWriteSet {
  workspaceId: string;
  attemptId: string;
  allowedToEdit: string[];
  actualChangedFiles: string[];
  evidenceFiles: string[];
  acceptedWriteSet: string[];
  allowlistedArtifacts: string[];
}
```

### 4.7 WorkspaceCommitGateResult

```ts
export interface WorkspaceCommitGateResult {
  workspaceId: string;
  attemptId: string;
  verdict: "accepted" | "blocked";
  acceptedWriteSet: string[];
  stagedFiles: string[];
  illegalFiles: string[];
  unreportedModifiedFiles: string[];
  omittedChangedFiles: string[];
  humanEditSuspects: string[];
  reasons: string[];
}
```

---

## 4.8 Integration Note: Mapping to Existing Code

P44 does not build from scratch. The existing codebase already has completion infrastructure. Below is the mapping from existing types/modules to the new P44 data contracts and modules. Every P44 workspace should reference this table.

| P44 Contract / Module | Existing Code | Migration |
|----------------------|---------------|-----------|
| `AcceptanceCriterion` | Inline in workspace schema, `PlanNode.acceptanceCriteria` | Extract to typed interface with `AcceptanceRequirementLevel` |
| `EvidenceLedger` | Does not exist — evidence is implicit in command history | New module; replaces ad-hoc tracking |
| `EvidenceItem` | `CommandHistoryEntry` in `completion-gate.ts` | Extend to cover file evidence, negative checks, artifacts |
| `WorkerCompletionReport` | Inline in worker prompt template, parsed ad-hoc | Formal parser with schema validation |
| `CompletionGate v2` | `evaluateWorkspaceCompletion()` in `completion-gate.ts` | Replace or wrap with v2 algorithm (evidence-first) |
| `WorkspaceCompletionResult` | `WorkspaceCompletionResult` in `completion-gate.ts` | Replace `canComplete` boolean with `gateVerdict: "accepted" \| "blocked"` |
| `CompletionGateRegistry` | `CompletionGateRegistry` class in `completion-gate.ts` | Extend to emit runtime events |
| `WorkspaceWriteSet` | `WriteSetDriftResult` in `completion-gate.ts` | Formalize with `allowedToEdit` + `acceptedWriteSet` |
| `WorkspaceCommitGate` | `checkWriteSetDrift()` in `completion-gate.ts` | Upgrade to full gate with `illegalFiles`, `humanEditSuspects` |
| `TerminalVerdictParser` | Regex in `workspace-agent-executor.ts` line 1122: `content.includes("VERDICT: COMPLETE")` | Replace with structured parser with `attemptId` validation |
| `GovernanceLedger` | `GovernanceLedger` in `governance-ledger.ts` + `evaluateGovernanceLedgerCompliance()` | Keep as-is; P44 adds evidence dimension |
| `ForbiddenShortcutScanner` | Does not exist | New module; scans for `git add .`, `|| true`, etc. |
| `PostImplementationAuditor` | Does not exist | New module; compares claims to actual repo diff |

### 4.8.1 File Migration Roadmap

| Old / Existing File | New File (P44) | Action |
|--------------------|----------------|--------|
| `src/core/completion-gate.ts` | splits into `src/core/completion/` module | Extract evidence, commit gate, v2 algorithm |
| `src/core/governance-ledger.ts` | stays but gains evidence recording | Add `recordEvidence()` method |
| `src/core/workspace-agent-executor.ts` (line 1122) | uses `TerminalVerdictParser` | Replace inline regex with parser |
| (new) | `src/core/completion/acceptance-criteria.ts` | Create |
| (new) | `src/core/completion/evidence-ledger.ts` | Create |
| (new) | `src/core/completion/evidence-types.ts` | Create |
| (new) | `src/core/completion/completion-gate-v2.ts` | Create |
| (new) | `src/core/completion/completion-gate-result.ts` | Create |
| (new) | `src/core/completion/terminal-verdict-parser.ts` | Create |
| (new) | `src/core/completion/terminal-reconciler.ts` | Create |
| (new) | `src/core/completion/negative-assertions.ts` | Create |
| (new) | `src/core/completion/forbidden-shortcut-scanner.ts` | Create |
| (new) | `src/core/completion/worker-report-contract.ts` | Create |
| (new) | `src/core/completion/post-implementation-auditor.ts` | Create |
| (new) | `src/core/completion/workspace-commit-gate.ts` | Create |
| (new) | `src/core/completion/workspace-write-set.ts` | Create |
| (new) | `src/core/auto-commit.ts` | Create |
| (new) | `src/core/git-runner.ts` | Create |

---

## 5. CompletionGate v2 Algorithm

```txt
Input:
  current workspace state
  current attemptId/generation
  WorkerCompletionReport
  AcceptanceCriterion[]
  EvidenceLedger
  command event history
  forbidden pattern scan results

Algorithm:
  1. Verify report.attemptId == currentAttemptId.
     If false, emit terminal_verdict_stale_ignored.
  2. Verify verdictClaim is terminal.
  3. For every required AC:
       if no coverage entry -> missing
       if coverage status != pass -> failed/missing
       if evidenceRequired and evidenceIds empty -> missing evidence
  4. For every negative AC:
       require negative_check evidence
       require check result pass
  5. For every validationRequirement:
       require command evidence with exitCode 0
       reject no-tests-found
       reject watch-mode command
       reject command containing silent pass guard
  6. Run forbidden shortcut scanner.
  7. If any missing/failed:
       gateVerdict = blocked
       emit completion_gate_blocked with exact reason
  8. Else:
       gateVerdict = accepted
       emit completion_gate_accepted
```

### 5.1 Migration from CompletionGate v1 to v2

The existing `evaluateWorkspaceCompletion()` function in `completion-gate.ts` uses a different algorithm:

```txt
v1 algorithm (current):
  1. Check workspace stage is COMPLETED or READY_FOR_REVIEW
  2. Check there are no error/critical failure signals
  3. Check targetCommand was executed
  4. Check validation satisfied
  5. Check equivalent validation satisfied
  6. Check governance ledger compliance
  7. Return canComplete: boolean + blockReasons[]
```

```txt
v2 algorithm (P44):
  1. Parse WorkerCompletionReport from worker output
  2. Verify attemptId matches current generation
  3. Check AcceptanceCriterion[] against EvidenceLedger
  4. Run ForbiddenShortcutScanner
  5. Run NegativeAssertion checks
  6. Return CompletionGateResult with gateVerdict + explicit reasons
```

**Migration strategy:** Do not delete v1 immediately. Instead, add v2 as a parallel gate in `completion/completion-gate-v2.ts`. The workspace-agent-executor calls v2 after the worker produces a final response. During P44 rollout, both gates run — v2 blocks if evidence is missing, v1's checks become a subset of v2's. After P44 workspace tests pass, deprecate v1 and remove it.

### 5.2 Completeness Map: v1 Checks -> v2 Evidence

| v1 Check | v2 Evidence Equivalent |
|----------|----------------------|
| Workspace stage COMPLETED | `report.verdictClaim === "COMPLETE"` |
| No error/critical signals | `EvidenceLedger` items with `exitCode: 0` for all validation commands |
| Target command executed | `WorkerCompletionReport.commandsRun[]` with matching command and `exitCode: 0` |
| Validation satisfied | `EvidenceLedger.acceptanceCoverage[].status === "pass"` |
| Governance ledger compliance | `GovernanceLedger.recordEvidence()` entries |
| Equivalent validation satisfied | `WorkerCompletionReport.commandsRun[].status()` with equivalent match |

---

## 6. WorkspaceCommitGate Algorithm

```txt
Input:
  workspaceId
  attemptId
  canEdit / ownership manifest
  WorkerCompletionReport.filesChanged
  git diff --name-only
  git status --porcelain
  EvidenceLedger
  allowed evidence artifact globs

Algorithm:
  1. Compute actualChangedFiles from git diff/status.
  2. Compute allowedToEdit from workspace canEdit and ownership metadata.
  3. Compute acceptedWriteSet:
       filesChanged ∩ allowedToEdit
       plus explicitly allowlisted evidence/report artifacts
  4. Detect illegalFiles:
       actualChangedFiles - allowedToEdit - allowlistedArtifacts
  5. Detect unreportedModifiedFiles:
       actualChangedFiles - report.filesChanged - allowlistedArtifacts
  6. Detect omittedChangedFiles:
       report.filesChanged - actualChangedFiles
  7. Reject if illegalFiles not empty.
  8. Reject if unreportedModifiedFiles not empty.
  9. Reject if staged files differ from acceptedWriteSet.
  10. Stage exactly acceptedWriteSet.
  11. Re-read staged files.
  12. Commit only if stagedFiles == acceptedWriteSet.
```

Forbidden commit commands:

```bash
git add .
git add -A
git commit -a
```

Allowed commit pattern:

```bash
git add -- <file1> <file2> <file3>
git diff --cached --name-only
git commit -m "<workspace-scoped message>"
```

### 6.1 Git Runner Abstraction

The WorkspaceCommitGate must not shell out to git directly in unit tests. Create a `GitRunner` interface:

```ts
export interface GitRunner {
  diffNameOnly(): Promise<string[]>;          // git diff --name-only
  statusPorcelain(): Promise<string>;         // git status --porcelain
  stageFiles(files: string[]): Promise<void>; // git add -- <file> ...
  diffCached(): Promise<string>;              // git diff --cached --name-only
  commit(message: string): Promise<void>;     // git commit -m
  isDirty(): Promise<boolean>;                // any unstaged changes?
}
```

A `RealGitRunner` shells out. A `FakeGitRunner` returns configured state for tests.

---

## 7. Runtime Events

P44 standardizes these events:

```txt
worker_verdict_claimed
evidence_ledger_recorded
completion_gate_started
completion_gate_accepted
completion_gate_blocked
acceptance_coverage_missing
negative_check_failed
terminal_verdict_stale_ignored
terminal_attempt_finalized
workspace_commit_gate_started
workspace_commit_gate_blocked
workspace_commit_write_set_accepted
workspace_commit_staged
workspace_commit_created
workspace_commit_aborted
workspace_complete
```

Blocked events must include:

```txt
workspaceId
attemptId
reason
missingAcceptanceCriteria
failedEvidence
illegalFiles
stagedFiles
acceptedWriteSet
```

---

## 8. Dashboard / Read Model Requirements

The dashboard answers three separate questions, each from a different source of truth:

### 8.1 Claim (Worker Self-Report)

```json
{
  "claim": {
    "source": "live_log | WorkerCompletionReport",
    "value": "COMPLETE | FAILED | BLOCKED",
    "attemptId": "attempt-xxx",
    "timestamp": "..."
  }
}
```

The dashboard must display this as "Worker Claim: COMPLETE" — never as "STATUS: COMPLETE".

### 8.2 Evidence (CompletionGate Verdict)

```json
{
  "evidence": {
    "source": "CompletionGate v2",
    "verdict": "accepted | blocked",
    "missingAcceptanceCriteria": ["AC-..."],
    "failedNegativeChecks": [...],
    "missingValidationEvidence": [...],
    "reason": "..." 
  }
}
```

The dashboard must show this separately from the claim. A blocked gate means the workspace is not complete regardless of what the worker said.

### 8.3 Commit (WorkspaceCommitGate Verdict)

```json
{
  "commit": {
    "source": "WorkspaceCommitGate",
    "verdict": "accepted | blocked",
    "acceptedWriteSet": ["src/..."],
    "stagedFiles": ["src/..."],
    "committedFiles": ["src/..."],
    "illegalFiles": [],
    "reason": "..."
  }
}
```

### 8.4 Summary Display

The dashboard must show:

```txt
Worker verdict claim
CompletionGate verdict
WorkspaceCommitGate verdict
missing acceptance criteria
target command evidence
negative check results
actual changed files
accepted write-set
staged files
committed files
illegal files
stale attempt ignored events
terminal attempt final state
```

The UI must never show a workspace as complete merely because live logs contain `VERDICT: COMPLETE`.

### 8.5 Read Model Schema

```ts
export interface WorkspaceReadModel {
  workspaceId: string;
  planExecId: string;
  
  // Claim
  workerVerdictClaim?: "COMPLETE" | "FAILED" | "BLOCKED";
  claimAttemptId?: string;
  claimTimestamp?: string;

  // Evidence / Gate
  gateVerdict?: "accepted" | "blocked" | "pending";
  completionGateReasons?: string[];
  missingAcceptanceCriteria?: string[];
  failedNegativeChecks?: string[];
  missingValidationEvidence?: string[];
  staleAttemptIgnored?: boolean;

  // Commit
  commitGateVerdict?: "accepted" | "blocked" | "pending";
  acceptedWriteSet?: string[];
  stagedFiles?: string[];
  committedFiles?: string[];
  illegalFiles?: string[];
  commitGateReason?: string;

  // State
  terminalAttemptState?: "complete_allowed" | "blocked" | "failed" | "stale_ignored" | "running";
}
```

---

## 9. P44 Workspaces

Each workspace below is a self-contained unit of work. Implement in order. Do not skip ahead — later workspaces depend on earlier types, contracts, and infrastructure.

### P44.00 — Fake Complete & Commit Scope RCA

**Goal:** Audit current completion and commit behavior.

**Rationale (from vision):** Before building gates, we must know what we're gating. This RCA answers: "What existing pathways allow fake complete or overbroad commit today?"

**Expected files:**

```txt
docs/pi/p44/fake-complete-rca.md
docs/pi/p44/commit-scope-rca.md
docs/pi/p44/completion-path-diagram.md
reports/p44-verified-completion/completion-path-grep.txt
reports/p44-verified-completion/commit-path-grep.txt
```

**Commands:**

```bash
mkdir -p reports/p44-verified-completion
grep -R "VERDICT: COMPLETE\|workspace_complete\|completion_gate_blocked\|stale_attempt_completion_ignored\|transitionWorkspace" packages/web-server/src packages/coding-agent/src packages/execution-service/src -n > reports/p44-verified-completion/completion-path-grep.txt
grep -R "git add \.\|git add -A\|git commit -a\|git add" packages/web-server/src packages/coding-agent/src packages/execution-service/src scripts -n > reports/p44-verified-completion/commit-path-grep.txt
test -s reports/p44-verified-completion/completion-path-grep.txt
test -s reports/p44-verified-completion/commit-path-grep.txt
make test
```

**Acceptance Criteria:**

```txt
AC-P44-00-001 completion path grep artifact exists.
AC-P44-00-002 commit path grep artifact exists.
AC-P44-00-003 RCA identifies verdict parser, gate, transition, and commit locations.
AC-P44-00-004 RCA lists every production `git add .`, `git add -A`, or `git commit -a` risk if present.
AC-P44-00-005 RCA maps every completion pathway to the integration table in section 4.8.
```

---

### P44.01 — Acceptance Criteria & Traceability Schema

**Goal:** Define the typed AcceptanceCriterion interface and validation rules.

**Rationale (from vision):** Without typed ACs, there is no way to verify what the worker was supposed to do. The traceability schema is the foundation for evidence.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/acceptance-criteria.ts
packages/coding-agent/src/core/completion/traceability-schema.ts
packages/coding-agent/test/completion/traceability-schema.test.ts
docs/pi/p44/traceability-schema.md
```

**Required tests:**

```txt
validates stable AC ids
rejects invalid AC ids
rejects required AC without evidence
allows optional AC with no evidence only when optional
requires defer reason for deferred AC
rejects phase-critical AC deferral
rejects negative AC without negative_check marker
```

**Command:**

```bash
npx vitest --run packages/coding-agent/test/completion/traceability-schema.test.ts
npx tsgo --noEmit 2>&1
```

---

### P44.02 — Evidence Ledger

**Goal:** Implement EvidenceLedger and EvidenceItem types with validation.

**Rationale (from vision):** The ledger is the core data structure that answers "What did the worker actually do?" Every byte of evidence is tracked, hashed, and linked to a specific acceptance criterion.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/evidence-ledger.ts
packages/coding-agent/src/core/completion/evidence-types.ts
packages/coding-agent/test/completion/evidence-ledger.test.ts
docs/pi/p44/evidence-ledger.md
```

**Required tests:**

```txt
attaches multiple evidence items to one AC
rejects zero tests found evidence
rejects non-zero exit test evidence for pass status
serializes and round-trips JSON
supports negative_check evidence
supports report_artifact evidence
rejects manual_observation as sole evidence for required implementation AC
validates contentHash for file evidence
```

---

### P44.03 — CompletionGate v2

**Goal:** Build the evidence-first completion gate.

**Rationale (from vision):** CompletionGate v2 replaces the old boolean `canComplete` check with a rich evidence-verified gate that answers "Was it done? How do we know?"

**Expected files:**

```txt
packages/coding-agent/src/core/completion/completion-gate-v2.ts
packages/coding-agent/src/core/completion/completion-gate-result.ts
packages/coding-agent/test/completion/completion-gate-v2.test.ts
```

**Required tests:**

```txt
blocks complete without evidence
blocks partial evidence and reports exact missing AC IDs
accepts all evidence
blocks missing target command evidence
blocks no-tests-found command
blocks silent pass guard command (`|| true`)
emits machine-readable block reason
does not mutate workspace state directly
rejects stale attempt ID
rejects non-terminal verdict claim
```

---

### P44.04 — Terminal Verdict Reconciliation

**Goal:** Parse terminal verdicts from worker output and reconcile with CompletionGate v2.

**Rationale (from vision):** The worker saying `VERDICT: COMPLETE` in live logs should never be confused with the gate's verdict. This module ensures only the gate's verdict drives state transitions.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/terminal-verdict-parser.ts
packages/coding-agent/src/core/completion/terminal-reconciler.ts
packages/coding-agent/test/completion/terminal-reconciler.test.ts
```

**Required tests:**

```txt
current attempt complete transitions when gate accepts
stale complete is ignored (different attemptId)
gate-rejected complete becomes blocked with exact reason
terminal attempt cannot remain RUNNING
live log echo cannot falsely complete non-final response
parses structured verdict from text output
extracts attemptId from verdict text
```

---

### P44.05 — Negative Assertion & Forbidden Shortcut Scanner

**Goal:** Scan for forbidden patterns and negative assertions.

**Rationale (from vision):** "Must not" requirements are invisible to standard ACs. This module ensures they are checked explicitly and that forbidden shortcuts (fake completions, silent pass guards) are caught.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/negative-assertions.ts
packages/coding-agent/src/core/completion/forbidden-shortcut-scanner.ts
packages/coding-agent/test/completion/negative-assertions.test.ts
```

**Required tests:**

```txt
grep negative check passes when pattern absent
grep negative check fails when pattern present
forbidden fake/static/stub shortcut blocks completion
forbidden `|| true` in validation command blocks completion
forbidden `git add .` in worker path blocks completion
forbidden `git add -A` in worker path blocks completion
negative check creates evidence ledger item
scanner results are machine-readable JSON
```

---

### P44.06 — Worker Report Contract

**Goal:** Define and validate the WorkerCompletionReport schema.

**Rationale (from vision):** The worker's self-report is the starting point — it's a claim that must be verified. This module ensures the claim is at least structurally valid before the gate evaluates it.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/worker-report-contract.ts
packages/coding-agent/test/completion/worker-report-contract.test.ts
docs/pi/p44/worker-report-contract.md
```

**Required tests:**

```txt
parses valid structured report from JSON
rejects prose-only "all done"
rejects missing acceptanceCoverage
rejects missing commandsRun when validation required
rejects report with mismatched attemptId
rejects report with missing workspaceId
parses filesChanged list correctly
```

---

### P44.07 — Post-Implementation Auditor

**Goal:** After the worker is done and the gate accepts, audit the real repo diff against worker claims.

**Rationale (from vision):** Even if the gate accepts, the operator should be able to see what actually changed versus what the worker claimed changed. This auditor is the post-hoc check that keeps the operator in the loop.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/post-implementation-auditor.ts
packages/coding-agent/test/completion/post-implementation-auditor.test.ts
scripts/run-post-implementation-audit.ts
```

**Required tests:**

```txt
compares worker claims (filesChanged) to actual repo diff
catches missing required AC that the worker claimed was satisfied
catches fake/static shortcut in actual diff
emits audit JSON with comparison details
reports files that were claimed changed but did not actually change
reports files that changed but were not claimed
```

---

### P44.08 — WorkspaceCommitGate

**Goal:** Gate the commit phase by workspace write-set.

**Rationale (from vision):** Completion without scoped commit safety is still unsafe. This gate ensures that only the workspace's own files are staged and committed.

**Expected files:**

```txt
packages/coding-agent/src/core/completion/workspace-commit-gate.ts
packages/coding-agent/src/core/completion/workspace-write-set.ts
packages/coding-agent/test/completion/workspace-commit-gate.test.ts
```

**Required tests:**

```txt
accepts exact workspace write-set
rejects unrelated modified file
rejects unreported modified file
rejects omitted claimed file
rejects human edit unless explicitly in write-set
allows allowlisted evidence artifact
blocks git add dot command pattern
blocks git add dashA command pattern
blocks git commit dashA command pattern
correctly computes allowedToEdit from ownership manifest
```

---

### P44.09 — Scoped Commit Integration

**Goal:** Integrate the WorkspaceCommitGate with real git operations.

**Rationale (from vision):** Gates are worthless if the actual commit path bypasses them. This workspace wires the WorkspaceCommitGate into the real commit flow, using the GitRunner abstraction to enable testability.

**Expected files:**

```txt
packages/coding-agent/src/core/auto-commit.ts
packages/coding-agent/src/core/git-runner.ts
packages/coding-agent/src/core/workspace-agent-executor.ts
packages/coding-agent/test/completion/scoped-commit-integration.test.ts
```

**Required behavior:**

```txt
stages exact acceptedWriteSet
checks staged file list before commit
aborts commit if staged != acceptedWriteSet
emits workspace_commit_created with committedFiles
emits workspace_commit_aborted with reason
uses GitRunner interface (not direct shell calls)
```

**Required tests:**

```txt
commit only allowed files
do not commit unrelated dirty file
do not commit another workspace file
abort if staged list changes before commit
uses FakeGitRunner in unit tests
emits correct events on success and failure
```

---

### P44.10 — Dashboard / Read Model Visibility

**Goal:** Expose all gate verdicts in the read model.

**Rationale (from vision):** The dashboard must show**Rationale (from vision):** The dashboard must show three separate truths (claim, evidence, commit) rather than conflating them. Without this workspace, the UI could show "COMPLETE" based on worker self-report alone.

**Expected fields:**

```txt
verdictClaim
gateVerdict
commitGateVerdict
missingAcceptanceCriteria
completionGateReasons
acceptedWriteSet
stagedFiles
committedFiles
illegalFiles
staleAttemptIgnored
terminalAttemptState
```

**Required tests:**

```txt
read model exposes completion gate visibility
read model exposes commit gate visibility
dashboard distinguishes worker claim from authoritative state
stale attempt error is not current truth
read model WorkspaceReadModel serializes correctly
```

---

### P44.11 — Fake Complete & Commit Scope Gauntlet

**Goal:** Run end-to-end scenarios that verify the gates catch real failure modes.

**Rationale (from vision):** The gauntlet is the final proof that P44 actually prevents fake completes and overbroad commits. Without it, the gates are untested in production-like scenarios.

**Fake-complete scenarios:**

```txt
G-FC-01 complete claim with missing AC -> blocked
G-FC-02 complete claim with no target command -> blocked
G-FC-03 no tests found -> blocked
G-FC-04 fake/static shortcut remains -> blocked
G-FC-05 negative assertion fails -> blocked
G-FC-06 old attempt completes late -> stale ignored
G-FC-07 current attempt full evidence -> accepted
G-FC-08 block reason visible -> visible
G-FC-09 no terminal attempt remains RUNNING -> terminal
G-FC-10 read model prefers gate truth -> visible
```

**Commit-scope scenarios:**

```txt
G-CS-01 allowed files only -> commit succeeds
G-CS-02 allowed + unrelated file -> commit blocked
G-CS-03 git add . attempted -> blocked
G-CS-04 git add -A attempted -> blocked
G-CS-05 another workspace file modified -> write_set_violation
G-CS-06 report omits modified file -> unreported_modified_files
G-CS-07 human edit exists -> not staged/committed
G-CS-08 allowlisted evidence artifact -> included only if allowlisted
```

**Commands:**

```bash
node scripts/run-execution-stability-gauntlet.ts --scenario fake-complete --output reports/p44-fake-complete-gauntlet.json
node scripts/run-execution-stability-gauntlet.ts --scenario commit-scope --output reports/p44-commit-scope-gauntlet.json
node scripts/run-execution-stability-gauntlet.ts --scenario fake-complete --monte-carlo 100 --assert-deterministic --output reports/p44-fake-complete-monte-carlo.json
```

No `|| true`.

---

### P44.12 — Master Template Update

**Goal:** Update the LLM implementation agent master template with P44 rules.

**Rationale (from vision):** P44 must be self-sustaining. Future plans (P45 and beyond) need to produce evidence-ledger-compatible outputs from the start.

**Expected files:**

```txt
docs/llm-implementation-agent-master-template.md
docs/pi/p44/master-template-update.md
docs/pi/p44/planner-prompt-rules.md
```

**Required template rules:**

```txt
stable AC IDs required
evidence ledger required
CompletionGate v2 required
WorkspaceCommitGate required
worker self-report is not evidence
no broad git add commands
validation commands cannot silently pass
```

---

### P44.13 — Final Promotion Report

**Goal:** Produce the promotion report and run final validation.

**Rationale (from vision):** The promotion report is the formal artifact that proves P44 is green. Future phases (P45) gate on this report existing and passing.

**Expected files:**

```txt
reports/p44-verified-completion/<timestamp>/summary.md
docs/pi/p44/p44-implementation-summary.md
```

**Final validation:**

```bash
make test
make test-full
node scripts/run-execution-stability-gauntlet.ts --scenario fake-complete --monte-carlo 100 --assert-deterministic --output reports/p44-fake-complete-monte-carlo.json
node scripts/run-execution-stability-gauntlet.ts --scenario commit-scope --output reports/p44-commit-scope-gauntlet.json
```

---

## 10. P44-Lite Emergency Scope

If deadline pressure requires P44-lite, these are the minimum non-negotiables:

```txt
1. VERDICT: COMPLETE is only a claim.
2. Missing target command evidence blocks completion.
3. Missing required acceptance evidence blocks completion.
4. Stale attempt COMPLETE is ignored.
5. Terminal attempts cannot remain RUNNING.
6. completion_gate_blocked reason is visible.
7. Validation commands cannot use `|| true`.
8. Commit path stages only workspace-owned files.
9. `git add .`, `git add -A`, and `git commit -a` are forbidden.
10. Fake-complete and commit-scope tests exist.
```

---

## 11. Machine-Readable Contract

```json
{
  "phase": "P44",
  "title": "Verified Completion Spine & Workspace-Scoped Commit Safety",
  "version": "EXPANDED_VISION",
  "selectedMode": "stable_3",
  "targetPromotionMode": "stable_3",
  "maxParallelWorkspaces": 3,
  "coreDoctrine": [
    "Worker verdict is a claim, not authority.",
    "No completion without evidence.",
    "No commit outside the workspace write-set.",
    "CompletionGate verifies completion; WorkspaceCommitGate verifies staging/commit scope.",
    "ExecutionKernel remains the state authority.",
    "PostgreSQL remains runtime truth; JSON fallback is forbidden."
  ],
  "mustPass": [
    "make test",
    "make test-full",
    "fake-complete gauntlet",
    "commit-scope gauntlet"
  ],
  "forbidden": [
    "git add .",
    "git add -A",
    "git commit -a",
    "validation command with || true",
    "zero tests found as pass",
    "worker self-report as evidence"
  ]
}
```

---

## Appendix A: Complete File Index

All files that P44 creates or modifies, grouped by workspace:

### New Files

| File | Workspace |
|------|-----------|
| `packages/coding-agent/src/core/completion/acceptance-criteria.ts` | P44.01 |
| `packages/coding-agent/src/core/completion/traceability-schema.ts` | P44.01 |
| `packages/coding-agent/src/core/completion/evidence-ledger.ts` | P44.02 |
| `packages/coding-agent/src/core/completion/evidence-types.ts` | P44.02 |
| `packages/coding-agent/src/core/completion/completion-gate-v2.ts` | P44.03 |
| `packages/coding-agent/src/core/completion/completion-gate-result.ts` | P44.03 |
| `packages/coding-agent/src/core/completion/terminal-verdict-parser.ts` | P44.04 |
| `packages/coding-agent/src/core/completion/terminal-reconciler.ts` | P44.04 |
| `packages/coding-agent/src/core/completion/negative-assertions.ts` | P44.05 |
| `packages/coding-agent/src/core/completion/forbidden-shortcut-scanner.ts` | P44.05 |
| `packages/coding-agent/src/core/completion/worker-report-contract.ts` | P44.06 |
| `packages/coding-agent/src/core/completion/post-implementation-auditor.ts` | P44.07 |
| `packages/coding-agent/src/core/completion/workspace-commit-gate.ts` | P44.08 |
| `packages/coding-agent/src/core/completion/workspace-write-set.ts` | P44.08 |
| `packages/coding-agent/src/core/git-runner.ts` | P44.09 |
| `packages/coding-agent/src/core/auto-commit.ts` | P44.09 |
| `scripts/run-post-implementation-audit.ts` | P44.07 |

### Modified Files

| File | Change | Workspace |
|------|--------|-----------|
| `packages/coding-agent/src/core/completion-gate.ts` | Add v2 integration point; keep v1 for parallel run | P44.03 |
| `packages/coding-agent/src/core/governance-ledger.ts` | Add `recordEvidence()` method | P44.02 |
| `packages/coding-agent/src/core/workspace-agent-executor.ts` | Replace inline `VERDICT: COMPLETE` regex with TerminalVerdictParser | P44.04, P44.09 |
| `packages/coding-agent/src/core/plan-state.ts` | Add WorkspaceReadModel fields | P44.10 |
| `docs/llm-implementation-agent-master-template.md` | Add P44 rules | P44.12 |

### Test Files

| File | Workspace |
|------|-----------|
| `packages/coding-agent/test/completion/traceability-schema.test.ts` | P44.01 |
| `packages/coding-agent/test/completion/evidence-ledger.test.ts` | P44.02 |
| `packages/coding-agent/test/completion/completion-gate-v2.test.ts` | P44.03 |
| `packages/coding-agent/test/completion/terminal-reconciler.test.ts` | P44.04 |
| `packages/coding-agent/test/completion/negative-assertions.test.ts` | P44.05 |
| `packages/coding-agent/test/completion/worker-report-contract.test.ts` | P44.06 |
| `packages/coding-agent/test/completion/post-implementation-auditor.test.ts` | P44.07 |
| `packages/coding-agent/test/completion/workspace-commit-gate.test.ts` | P44.08 |
| `packages/coding-agent/test/completion/scoped-commit-integration.test.ts` | P44.09 |

### Documentation Files

| File | Workspace |
|------|-----------|
| `docs/pi/p44/fake-complete-rca.md` | P44.00 |
| `docs/pi/p44/commit-scope-rca.md` | P44.00 |
| `docs/pi/p44/completion-path-diagram.md` | P44.00 |
| `docs/pi/p44/traceability-schema.md` | P44.01 |
| `docs/pi/p44/evidence-ledger.md` | P44.02 |
| `docs/pi/p44/worker-report-contract.md` | P44.06 |
| `docs/pi/p44/master-template-update.md` | P44.12 |
| `docs/pi/p44/planner-prompt-rules.md` | P44.12 |
| `docs/pi/p44/p44-implementation-summary.md` | P44.13 |

---

## Appendix B: Dependency Graph Between Workspaces

```txt
P44.00 (RCA) - no deps
  |
P44.01 (AC schema) - no deps
  |
P44.02 (Evidence ledger) - depends on P44.01 types
  |
  +---> P44.03 (CompletionGate v2) - depends on P44.01, P44.02
  |       |
  |       +---> P44.04 (Terminal Reconciler) - depends on P44.03
  |       |
  |       +---> P44.05 (Negative/Shortcut scanner) - depends on P44.02
  |       |
  |       +---> P44.06 (Worker report contract) - no deps
  |       |
  |       +---> P44.07 (Post-implementation auditor) - depends on P44.01, P44.06
  |
P44.08 (WorkspaceCommitGate) - depends on P44.02, P44.06
  |
  +---> P44.09 (Scoped commit integration) - depends on P44.08
  |
P44.10 (Dashboard/Read model) - depends on P44.03, P44.09
  |
P44.11 (Gauntlet) - depends on all above
  |
P44.12 (Template update) - depends on P44.01-P44.09
  |
P44.13 (Promotion report) - depends on P44.11
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Claim** | Worker's self-reported `VERDICT: COMPLETE` — not authoritative |
| **Evidence** | Machine-verifiable proof (test output, file diff, exit code) linked to an AC |
| **EvidenceLedger** | Collection of all evidence items per workspace/attempt |
| **CompletionGate v2** | Gate that verifies evidence before allowing completion |
| **WorkspaceCommitGate** | Gate that verifies commit scope before allowing commit |
| **WorkspaceWriteSet** | Set of files a workspace is allowed to create/modify |
| **Attempt** | A single execution of a workspace (has unique `attemptId`) |
| **Stale attempt** | An attempt whose `attemptId` does not match the current generation |
| **Silent pass guard** | `\|\| true` or `\|\| exit 0` appended to a validation command |
| **Negative assertion** | A "must not" requirement checked via negative_check evidence |
| **Fake complete** | A worker claiming `VERDICT: COMPLETE` without actually satisfying all ACs |
| **Overbroad commit** | A commit that includes files outside the workspace write-set |

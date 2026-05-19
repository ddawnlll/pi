# Pi V2 — Second Brain Vision

**Path:** `docs/pi/v2/second-brain-vision.md`  
**Status:** Revised Draft  
**Date:** 2026-05-19  
**Audience:** Pi owner, implementation agents, future orchestrator/planner agents  
**Purpose:** Define the V2 product and architecture direction for evolving Pi from an autonomous coding executor into a policy-governed personal second-brain operating system.

---

## 0. Executive Summary

Pi V1 proved that an autonomous coding system can parse implementation plans, split work into workspaces, execute with agent workers, validate, recover, and integrate changes safely.

Pi V2 changes the center of gravity.

V1 was primarily an execution system:

```text
User writes plan -> Pi executes plan -> Pi validates and integrates output
```

V2 must become a cognitive operating system:

```text
Pi observes -> remembers -> interprets -> proposes -> plans -> queues -> executes approved work -> reflects -> improves
```

The central V2 principle is:

```text
Pi V2 is not an LLM that acts autonomously.
Pi V2 is a policy-governed runtime that uses LLMs to produce evidence-backed observations, proposals, and plans, then executes only validated and approved work through safe queues.
```

The goal is not blind autonomy. The goal is trusted autonomy: Pi should act independently where risk is low, ask for approval where judgment matters, and stop immediately when safety, policy, evidence, or confidence boundaries are crossed.

---

## 1. Why V2? Concrete V1 Pain Points

Pi V1 can execute, but it does not yet truly learn, remember, or initiate useful work.

A concrete example:

```text
P11 completed successfully, but several early workspaces required many retries.
Pi executed the work, but it did not independently identify this as a planning smell, remember it as a future warning, or generate a follow-up proposal to reduce similar retry hotspots.
```

This is the gap V2 must close.

### 1.1 V1 Limitations

Pi V1 can:

- Parse executable plans.
- Run workspaces.
- Track execution state.
- Retry failures.
- Use worktrees.
- Process integration queues.
- Validate output.
- Produce summaries.

But Pi V1 cannot reliably:

- Notice recurring patterns without being asked.
- Remember lessons as durable operating knowledge.
- Resolve conflicting memories or stale assumptions.
- Maintain an explicit model of user goals.
- Generate useful new ideas from observed signals.
- Convert those ideas into executable plans automatically.
- Decide which actions are safe to take without approval.
- Explain decisions with evidence and policy references.
- Reflect after each run and improve future planning.

### 1.2 V2 Outcome

Pi V2 should reduce the user’s cognitive load by turning project signals into decisions, plans, and safe execution queues.

A successful V2 system should make the user feel:

```text
Pi notices things before I ask.
Pi remembers what happened before.
Pi proposes useful next actions.
Pi writes plans I would have written myself.
Pi runs approved work while I sleep.
Pi stops when it should.
Pi explains why it suggested something.
Pi gets better over time.
```

---

## 2. Product Thesis

The user should be able to treat Pi as a cognitive partner for building and evolving large software systems.

Pi should be able to answer questions like:

- What is the most important thing to work on next?
- Which parts of the system are slowing us down?
- Which failures keep repeating?
- Which workspaces should be split before execution?
- Which plans can run overnight safely?
- Which decisions require approval?
- What did we learn from the last run?
- What should Pi do differently next time?
- Why did Pi recommend this?
- Which memory or evidence supports this recommendation?

V2 is not a replacement for the user’s judgment. It is a system for making judgment cheaper, faster, better-informed, and easier to delegate safely.

---

## 3. V2 North Star

Pi should become the user’s personal engineering brain.

A successful V2 system should be able to:

1. Observe repository, execution, queue, failure, and decision signals.
2. Build durable memory with provenance and conflict resolution.
3. Maintain an explicit, revisable model of user goals and preferences.
4. Generate new ideas based on observed bottlenecks and opportunities.
5. Convert ideas into executable phase plans.
6. Queue validated plans safely.
7. Execute approved work while respecting integration gates.
8. Reflect after every run.
9. Update memory and propose improvements.
10. Surface everything in a dashboard that makes trust and control obvious.

---

## 4. Runtime vs LLM Boundary

The V2 architecture must explicitly separate Pi runtime responsibilities from LLM responsibilities.

### 4.1 Core Rule

```text
LLM proposes.
Runtime validates.
Policy decides.
Executor acts.
Audit records.
```

### 4.2 Pi Runtime Responsibilities

The TypeScript/Node runtime owns deterministic system behavior:

- State machines.
- Plan queue state.
- Integration queue state.
- Worktree safety.
- Validation gates.
- File access policy.
- Approval gates.
- Audit ledger.
- Memory persistence.
- Memory conflict state.
- Queue runner behavior.
- Hard stops.
- Recovery and rollback.

The runtime must never delegate safety-critical state transitions to an LLM.

### 4.3 LLM Responsibilities

LLMs are used for cognitive work that benefits from language understanding:

- Summarizing observations.
- Explaining failure patterns.
- Drafting proposals.
- Drafting plans.
- Comparing alternatives.
- Generating reflection summaries.
- Producing human-readable reasoning summaries.

LLMs must not directly mutate execution state, memory state, queue state, policy state, or approval state.

### 4.4 Rule Engine Responsibilities

The rule engine decides what is allowed:

- Whether a proposal requires approval.
- Whether a plan may be enqueued.
- Whether memory may be written automatically.
- Whether a queue may continue.
- Whether an action violates policy.
- Whether confidence is high enough for auto-action.

### 4.5 Memory Engine Responsibilities

The memory engine owns durable knowledge:

- Storing memory records.
- Ranking memories.
- Resolving conflicts.
- Expiring stale memory.
- Marking memory disputed or rejected.
- Retrieving relevant memories for planning and proposals.

---

## 5. Core Cognitive Loop

The V2 cognitive loop is:

```text
Observe -> Remember -> Think -> Decide -> Plan -> Execute -> Reflect -> Improve
```

### 5.1 Observe

Pi collects safe, structured observations from:

- Git history.
- Changed files.
- Plan queue state.
- Integration queue state.
- Execution journal events.
- Worker transcripts.
- Plan summaries.
- Validation failures.
- Retry patterns.
- Merge conflicts.
- User approvals and rejections.
- Dashboard control actions.

Every observation must carry provenance.

### 5.2 Remember

Pi stores useful knowledge as durable memory records. Memory is not a raw log dump. It is typed, searchable, ranked, source-backed, and lifecycle-managed.

Memory categories:

- `project_memory` — how the repo is structured and behaves.
- `architecture_memory` — important design decisions and invariants.
- `plan_memory` — plans that were run, generated, accepted, rejected, or deferred.
- `failure_memory` — recurring failures, retry hotspots, blocked states, and conflict patterns.
- `decision_memory` — user-approved or rejected decisions.
- `execution_memory` — workspace outcomes, validation results, and performance patterns.
- `idea_memory` — generated ideas not yet implemented.
- `user_preference_memory` — long-lived preferences that affect future decisions.

### 5.3 Think

Pi synthesizes observations and memories into evidence-backed interpretations.

Thinking output must be safe summaries, not private chain-of-thought.

Pi may store:

- Observation summary.
- Inference summary.
- Evidence references.
- Confidence score.
- Proposed next action.
- Decision classification.

Pi must not store raw private reasoning.

### 5.4 Decide

Pi classifies decisions by autonomy level and policy.

Decision classes:

```text
Auto-decide:
  low-risk queue reordering
  retrying transient network failures
  generating draft proposals
  creating read-only summaries

Approval required:
  executing generated plans
  protected system mutations
  memory indexing of sensitive sources
  architecture changes
  extension permission expansion

Never auto-decide:
  secrets access
  destructive cleanup
  git push
  irreversible deletion
  bypassing validation gates
```

### 5.5 Plan

Pi converts ideas into executable implementation plans using the active master template.

Plan generation must include:

- Phase purpose.
- Workstreams.
- Dependencies.
- Queue priority.
- Continuous scheduling metadata.
- Validation gates.
- Rollback playbook.
- Machine-readable execution contract.
- Machine-readable summary.

### 5.6 Execute

Pi runs approved plans through the plan-level queue.

Execution must respect:

- One active plan per project.
- No next plan while integration queue is dirty.
- No unapproved graph optimization.
- No watch-mode validation.
- No forbidden files or commands.
- No direct execution from uploaded bundles.

### 5.7 Reflect

After every plan, Pi generates a source-backed reflection.

Reflection answers:

```text
What did we try?
What changed?
What worked?
What failed?
What slowed us down?
What should be remembered?
What should be proposed next?
Which future phase should be generated or modified?
```

### 5.8 Improve

Pi uses reflection to update memory, generate proposals, and improve future plans.

Improvement is proposal-first, policy-gated, and auditable.

---

## 6. Memory Architecture

Memory is the highest-risk V2 subsystem. Incorrect memory creates incorrect decisions.

V2 memory must therefore be layered, source-backed, conflict-aware, and correctable by the user.

### 6.1 Three-Layer Memory Model

```text
Raw Evidence
  Immutable source records: logs, execution journals, plan summaries, git commits, validation output.

Derived Memory
  Pi-generated summaries or patterns extracted from raw evidence.

Operating Beliefs
  Active knowledge that is allowed to influence decisions and planning.
```

Only Operating Beliefs should directly influence decisions.

Derived Memory can become an Operating Belief only when confidence, evidence quality, and policy allow it.

### 6.2 Memory Lifecycle

Memory records have lifecycle states:

```text
candidate
active
disputed
superseded
expired
rejected_by_user
needs_review
```

Lifecycle rules:

- New LLM-generated memory starts as `candidate` unless the policy allows automatic activation.
- User-approved memory may become `active`.
- Memory contradicted by newer evidence becomes `disputed` or `superseded`.
- Memory rejected by the user becomes `rejected_by_user` and must not influence future decisions.
- Stale memory becomes `expired` unless renewed by evidence.

### 6.3 Memory Conflict Resolution

Conflicting memories must not be resolved by recency alone.

Initial scoring model:

```text
memory_score =
  source_authority * 0.35
+ outcome_validity * 0.30
+ recency * 0.15
+ confidence * 0.15
+ user_confirmation * 0.05
```

Definitions:

- `source_authority`: direct execution evidence beats weak summary.
- `outcome_validity`: memory that predicted successful outcomes ranks higher.
- `recency`: newer evidence gets a small advantage.
- `confidence`: system confidence in extraction.
- `user_confirmation`: user-approved memory gets a boost.

Conflict handling:

```text
If two active memories conflict:
  1. Rank by memory_score.
  2. Mark lower-ranked memory as disputed or superseded.
  3. Preserve both records for audit.
  4. Use only the winning memory for decisions.
  5. Ask for user review if scores are close or risk is high.
```

### 6.4 Memory Expiration

Different memory types expire differently:

```text
project_memory:
  expires when file structure or package ownership changes significantly

architecture_memory:
  expires only when explicitly superseded or contradicted

failure_memory:
  decays over time unless repeated

execution_memory:
  decays as repo changes

user_preference_memory:
  does not expire automatically, but can be revised by the user

idea_memory:
  expires or archives after repeated rejection or inactivity
```

### 6.5 Memory Correction Protocol

If the user says a memory is wrong, Pi must:

1. Mark the memory `rejected_by_user`.
2. Stop using it for decisions.
3. Preserve the audit trail.
4. Ask whether a corrected memory should be created.
5. Link the correction to the rejected memory.

---

## 7. Learning Mechanism

V2 learning is not fine-tuning by default.

Initial V2 learning is:

```text
Learning = evidence-backed memory updates
         + retrieval into future planning
         + rule/policy suggestions
         + proposal scoring feedback
         + user approval/rejection history
```

### 7.1 Learning Loop

```text
Plan completes
-> Reflection report generated
-> Memory update proposals generated
-> User or policy approves memory writes
-> Future proposal/plan generation retrieves relevant memory
-> Outcome validates or weakens memory
-> Confidence and lifecycle state update
```

### 7.2 Reflection Inputs

Reflection uses:

- Plan summary.
- Execution journal.
- Queue events.
- Validation output.
- Retry attempts.
- Integration queue state.
- User approvals and rejections.

### 7.3 Reflection Outputs

Reflection produces:

```text
reflection_report.md
memory_update_proposals.json
proposal_triggers.json
risk_notes.json
```

### 7.4 Initial Learning Triggers

```text
if workspace.attempts >= 4:
  create failure_memory proposal

if same failure category appears >= 3 times:
  create improvement proposal

if integration queue blocked:
  create queue_health observation

if user rejects similar proposal twice:
  downgrade future similar proposals

if generated plan succeeds:
  increase confidence of memories used during planning

if generated plan fails due to planning assumptions:
  mark relevant memories disputed or lower confidence
```

---

## 8. Proposal System

The proposal system must avoid proposal flood.

Every proposal needs a score:

```text
proposal_score =
  impact * 0.30
+ urgency * 0.20
+ confidence * 0.20
+ strategic_alignment * 0.20
- implementation_cost * 0.05
- risk * 0.05
```

Proposal fields:

- Title.
- Summary.
- Evidence references.
- Impact.
- Urgency.
- Confidence.
- Risk.
- Implementation cost.
- Strategic alignment.
- Recommended action.
- Approval requirement.

Proposal throttling:

- Show top 3 high-value proposals by default.
- Batch low-priority proposals into a weekly digest.
- Deduplicate repeated proposal hashes.
- Apply cooldown to rejected proposal categories.
- Escalate only when repeated evidence appears.

---

## 9. Goal & Intention Model

The goal model must be dynamic, not static.

### 9.1 Goal Records

A goal record includes:

- Goal title.
- Goal description.
- Priority.
- Status.
- Evidence of relevance.
- Last confirmed time.
- Owner.
- Expiration or review date.

### 9.2 Goal Revision

Pi should detect possible goal drift when:

- User repeatedly rejects proposals aligned with an old goal.
- User accepts proposals aligned with a new theme.
- User manually changes autonomy settings.
- Long-running roadmap phases become stale.
- New high-priority blockers emerge.

Goal drift does not automatically rewrite goals. It creates a goal review proposal.

### 9.3 Initial Primary Goal

```text
Build Pi into a trusted second brain that can propose, plan, queue, execute approved work, and learn from outcomes.
```

### 9.4 Initial Preferences

```text
Prefer executable plans over ad-hoc changes.
Prefer queueable phases.
Prefer safe automation.
Prefer approval before risky system mutation.
Prefer source-backed memory.
Prefer morning reports after overnight runs.
```

---

## 10. Autonomy Model

Pi V2 exposes explicit autonomy levels.

### Level 1 — Advisor

Pi observes, remembers, summarizes, and suggests.

Capabilities:

- Generate insights.
- Identify bottlenecks.
- Summarize failures.
- Propose ideas.
- Draft phase plans.

Default: ON.

### Level 2 — Planner

Pi converts ideas into executable plans and queue bundles.

Capabilities:

- Generate phase plans.
- Generate bundle manifests.
- Validate plans.
- Recommend queue order.
- Prepare approval inbox items.

Default: ON, approval required before execution.

### Level 3 — Operator

Pi runs approved queues and handles safe operational decisions.

Capabilities:

- Run approved plan queues.
- Retry safe transient failures.
- Pause on dirty integration queue.
- Stop on policy violations.
- Produce morning reports.

Default: approval-gated.

### Level 4 — Autonomous Strategist

Pi proposes roadmap changes, generates new phases, and optimizes its own process.

Capabilities:

- Create new roadmap proposals.
- Recommend architecture direction.
- Generate self-improvement plans.
- Ask for approval on strategic changes.

Default: OFF until V2 dogfood proves trust.

---

## 11. User Interaction Protocol

Second brain behavior is a human-machine protocol, not just system architecture.

### 11.1 Morning Protocol

After overnight work, Pi shows:

- What ran.
- What completed.
- What stopped and why.
- What changed.
- What it learned.
- What needs approval.
- Top 3 suggested next actions.
- Links to artifacts and logs.

### 11.2 Daytime Protocol

During the day, the user can:

- Approve proposals.
- Reject proposals.
- Correct memory.
- Change goals.
- Enqueue plans.
- Pause autonomy.
- Ask why Pi suggested something.
- Ask what Pi is currently thinking about in safe summary form.

### 11.3 Night Protocol

Before sleep, the user selects:

- Approved queue or bundle.
- Autonomy level.
- Stop conditions.
- Notification/reporting preferences.

During the night, Pi:

- Runs approved queue only.
- Stops on dirty integration state, conflict, policy violation, or low-confidence unsafe condition.
- Writes a morning report.

### 11.4 Rejection Protocol

If the user rejects a proposal, Pi must record:

- Proposal id.
- Rejection reason if provided.
- Affected category.
- Whether similar proposals should be suppressed.
- Whether memory should be updated.

### 11.5 Memory Correction Protocol

If the user corrects memory, Pi must:

- Mark old memory rejected or superseded.
- Stop using it for decisions.
- Preserve audit trail.
- Write corrected memory only with approval or clear user instruction.

---

## 12. V2 System Architecture

```text
Second-Brain Dashboard
  -> Brain State Viewer
  -> Brain Inbox
  -> Proposal Inbox
  -> Memory Explorer
  -> Goal Board
  -> Autonomy Controls
  -> Reflection Timeline
  -> Overnight Run Panel

Brain Core
  -> Observation Engine
  -> Memory Engine
  -> Goal & Intention Model
  -> Proposal Engine
  -> Decision Engine
  -> Plan Factory
  -> Reflection Engine

Execution Core
  -> PlanQueue
  -> Bundle Intake
  -> Plan Runner
  -> Workspace Scheduler
  -> Worktree Executor
  -> Integration Queue
  -> Validation Gates

Trust Layer
  -> Policy Engine
  -> Approval Gates
  -> Audit Ledger
  -> Provenance Tracker
  -> Rollback/Handoff Artifacts
```

---

## 13. Major V2 Components

### 13.1 Observation Engine

Collects structured events from repo state, execution state, queues, validation, and user actions.

Outputs:

- `BrainObservation`
- `BrainSignal`
- `BrainTimelineEvent`

### 13.2 Memory Engine

Stores typed memories with provenance, lifecycle state, confidence, and conflict resolution.

Outputs:

- `MemoryRecord`
- `MemoryConflict`
- `MemoryQueryResult`
- `MemorySnapshot`

### 13.3 Goal & Intention Model

Represents user goals, preferences, current priorities, autonomy settings, and goal revision proposals.

Outputs:

- `GoalRecord`
- `PreferenceRecord`
- `AutonomyProfile`
- `GoalReviewProposal`

### 13.4 Proposal Engine

Turns observations and memories into useful, scored proposals.

Outputs:

- `Proposal`
- `ProposalEvidence`
- `ProposalRiskAssessment`
- `ProposalScore`

### 13.5 Decision Engine

Determines whether a proposal can be auto-applied, queued for approval, or blocked.

Outputs:

- `DecisionRecord`
- `ApprovalRequest`
- `DecisionAuditEntry`

### 13.6 Plan Factory

Generates executable implementation plans from accepted proposals.

Outputs:

- Phase markdown files.
- Bundle manifests.
- Queue-ready plan entries.

### 13.7 Reflection Engine

Runs after plan completion and generates learning artifacts.

Outputs:

- `ReflectionReport`
- `MemoryUpdateProposal`
- `FuturePlanProposal`
- `RiskNote`

### 13.8 Trust, Policy & Audit Layer

Ensures autonomy remains bounded, observable, reversible, and approved where needed.

Outputs:

- Policy decisions.
- Audit entries.
- Approval inbox items.
- Handoff artifacts.

---

## 14. Failure Modes & Recovery

V2 must define how it fails before it is trusted to run overnight.

| Failure Mode | Detection | Recovery |
|---|---|---|
| Memory corruption | User rejection, contradiction score, failed outcome after memory use | Mark memory disputed/rejected; remove from active retrieval; ask for correction |
| Proposal flood | Too many proposals, low acceptance rate, repeated categories | Raise proposal threshold; show top 3; batch low-priority proposals; apply cooldown |
| Goal drift | Accepted work no longer matches active goals; repeated rejection of goal-aligned proposals | Create goal review proposal; freeze strategic proposals until reviewed |
| Approval deadlock | Queue blocked by too many approval requests | Group approvals; classify low-risk auto-approvable actions; show approval summary |
| Reflection hallucination | Reflection claim lacks evidence reference | Reject claim; require source-backed summaries only |
| Decision loop | Same proposal repeatedly generated | Deduplicate by proposal hash; apply cooldown; mark repeated proposal suppressed |
| LLM/API outage | Provider failure or repeated timeout | Pause cognitive tasks; continue deterministic queue state; do not create new LLM decisions |
| Dirty integration loop | Integration queue remains dirty beyond threshold | Stop plan queue; create handoff artifact; require user action |
| Bad generated plan | Doctor fails; low confidence; user rejection | Keep as draft; do not enqueue; generate repair proposal |
| Over-autonomy | Pi attempts action beyond autonomy profile | Hard stop; audit; require policy review |
| Stale memory use | Memory used after expiration or supersession | Block decision; refresh memory; recompute proposal |
| Unsafe bundle execution | Bundle contains unsafe paths or unapproved plans | Reject bundle; keep validation report; do not enqueue |

---

## 15. Success Metrics

V2 must be measurable.

### 15.1 Quantitative Metrics

Planning:

- Percentage of generated plans accepted.
- Average proposal-to-plan conversion time.
- Number of useful proposals per week.
- Number of plans generated from reflection.

Execution:

- Retry rate reduction.
- Failed workspace rate.
- Blocked integration queue frequency.
- Overnight plan completion count.
- Time saved per phase.

Memory:

- Memory hit rate during planning.
- Rejected memory rate.
- Disputed memory count.
- Stale memory count.
- Percentage of proposals with evidence-backed memory references.

Trust:

- Approval acceptance rate.
- Policy stop correctness.
- Unsafe actions blocked.
- Number of times the user asks for explanation.
- Number of explanations judged useful.

### 15.2 Qualitative Success Criteria

V2 is successful when the user can say:

```text
Pi notices problems before I ask.
Pi generates plans I would have written myself.
Pi remembers past decisions correctly.
Pi stops when it should.
Pi's morning report is actionable.
I trust Pi to run approved queues overnight.
```

---

## 16. Vertical Slice Roadmap

The roadmap must avoid blind long-horizon construction. Every milestone should produce a usable system.

### Milestone 0 — Pi Sees

Phase: P13

Outcome:

```text
Pi observes project and execution signals and shows a minimal brain state viewer.
```

### Milestone 1 — Pi Remembers and Understands Goals

Phases: P14–P15

Outcome:

```text
Pi stores source-backed memory, resolves conflicts, and uses explicit goals/preferences to classify decisions.
```

### Milestone 2 — Pi Proposes and Plans

Phases: P16–P17

Outcome:

```text
Pi generates evidence-backed proposals, turns accepted proposals into executable plans, and reflects after runs.
```

### Milestone 3 — Pi Operates Safely

Phases: P18–P20

Outcome:

```text
Pi uses strong policy/audit controls, exposes full second-brain UX, and proves overnight approved-queue execution.
```

---

## 17. Revised V2 Roadmap

### P13 — Brain Core Vertical Slice & Orchestrator Daemon

Build the first usable brain slice.

Deliverables:

- Observation engine V0.
- Brain event timeline.
- Queue health observer.
- Execution journal observer.
- Retry/failure signal extraction.
- First reflection summary.
- Minimal brain state viewer.
- Safe daemon lifecycle controls.

P13 must not make irreversible decisions. It should make Pi capable of seeing, summarizing, and preparing decisions.

### P14 — Memory V0, Provenance & Conflict Model

Create durable, typed, provenance-backed memory with lifecycle and conflict handling.

Deliverables:

- Memory schema.
- Memory store.
- Memory lifecycle states.
- Memory conflict scoring.
- Memory correction flow.
- Memory review UI primitive.

### P15 — Goals, Preferences & Decision Policy

Model the user’s goals and decision boundaries.

Deliverables:

- Goal records.
- Preference records.
- Autonomy profile.
- Decision classes.
- Approval thresholds.
- Goal review proposals.
- User interaction protocol implementation.

### P16 — Proposal Engine V0

Generate useful evidence-backed proposals without flooding the user.

Deliverables:

- Proposal scoring.
- Proposal inbox.
- Evidence-backed proposals.
- Duplicate proposal suppression.
- Cooldown rules.
- Top-3 proposal view.

P16 should not auto-execute generated plans.

### P17 — Plan Factory & Reflection Loop

Convert accepted proposals into executable plans and learn from completed runs.

Deliverables:

- Proposal-to-plan generator.
- Phase generation.
- Bundle manifest generation.
- Post-run reflection.
- Memory update proposals.
- Proposal triggers.

### P18 — Trust, Policy, Audit & Approval Controls

Add strong governance for increasing autonomy.

Deliverables:

- Central policy engine.
- Approval gates.
- Audit ledger.
- Decision replay.
- Risk-based autonomy controls.
- Explanation records.

### P19 — Full Second-Brain Dashboard & Autonomy UX

Make the second brain visible, controllable, and understandable.

Deliverables:

- Brain Inbox.
- Proposal Inbox.
- Memory Explorer.
- Goal Board.
- Autonomy Controls.
- Reflection Timeline.
- Overnight Run Panel.

### P20 — V2 Dogfood: Overnight Autonomous Roadmap Execution

Validate the full loop end-to-end.

Deliverables:

- Overnight roadmap execution bundle.
- Morning report.
- Reflection report.
- Trust assessment.
- V2 readiness report.

---

## 18. Product UX Principles

### 18.1 Make Pi’s Thinking Inspectable

Pi should never feel like a black box. It should show:

- What it observed.
- What it remembered.
- What it inferred.
- What it proposes.
- What it wants approval for.
- What it will do next.

### 18.2 Keep Control Clear

Every autonomous action should be classified:

```text
Auto-run allowed
Approval required
Blocked by policy
Blocked by low confidence
Blocked by dirty integration state
```

### 18.3 Prefer Plans Over Ad-Hoc Mutations

Pi should not directly mutate complex systems when a plan is more appropriate. V2 should bias toward generated implementation plans and queued execution.

### 18.4 Stop Early, Explain Clearly

When Pi stops, it should explain:

- What blocked it.
- What artifact was produced.
- What the user can approve, retry, requeue, or inspect.

### 18.5 Use Memory Carefully

Memory should improve decisions without creating unsafe assumptions. Sensitive or protected memory indexing should require approval.

---

## 19. Trust Model

Pi V2 must maintain trust through five guarantees:

1. **Provenance:** every conclusion links back to source artifacts.
2. **Approval:** risky actions require explicit approval.
3. **Auditability:** decisions can be replayed and inspected.
4. **Reversibility:** generated plans include rollback paths.
5. **Bounded autonomy:** autonomy levels are explicit and adjustable.

---

## 20. Key Data Models

### BrainObservation

```ts
interface BrainObservation {
  id: string;
  type: "queue" | "execution" | "git" | "validation" | "failure" | "user_action";
  summary: string;
  source: {
    artifact: string;
    planExecId?: string;
    workspaceId?: string;
    commit?: string;
  };
  severity: "info" | "warning" | "critical";
  createdAt: string;
}
```

### MemoryRecord

```ts
interface MemoryRecord {
  id: string;
  type:
    | "project_memory"
    | "architecture_memory"
    | "plan_memory"
    | "failure_memory"
    | "decision_memory"
    | "execution_memory"
    | "idea_memory"
    | "user_preference_memory";
  lifecycle: "candidate" | "active" | "disputed" | "superseded" | "expired" | "rejected_by_user" | "needs_review";
  summary: string;
  content: string;
  sourceRefs: Array<{
    artifact: string;
    planExecId?: string;
    workspaceId?: string;
    commit?: string;
  }>;
  confidence: number;
  score: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  validUntil?: string | null;
  supersedes?: string[];
  disputedBy?: string[];
}
```

### Proposal

```ts
interface Proposal {
  id: string;
  title: string;
  summary: string;
  evidenceRefs: string[];
  recommendedAction:
    | "create_plan"
    | "queue_plan"
    | "update_memory"
    | "ask_user"
    | "defer"
    | "block";
  impact: number;
  urgency: number;
  confidence: number;
  strategicAlignment: number;
  implementationCost: number;
  risk: number;
  score: number;
  approvalRequired: boolean;
  createdAt: string;
}
```

### DecisionRecord

```ts
interface DecisionRecord {
  id: string;
  proposalId?: string;
  decision: "auto_approved" | "approval_requested" | "rejected" | "blocked" | "deferred";
  reason: string;
  policyRefs: string[];
  evidenceRefs: string[];
  confidence: number;
  createdAt: string;
}
```

### ReflectionReport

```ts
interface ReflectionReport {
  id: string;
  planExecId: string;
  summary: string;
  whatWorked: string[];
  whatFailed: string[];
  bottlenecks: string[];
  memoryUpdateProposalIds: string[];
  futureProposalIds: string[];
  evidenceRefs: string[];
  createdAt: string;
}
```

---

## 21. Operational Concerns

This section addresses production-readiness questions that affect system behavior at scale.

### 21.1 Observation Triggers

Observation is not continuous polling. Triggers are event-driven:

```text
Git events:     push, branch create/delete, tag create
Queue events:   plan enqueued, plan started, plan completed, plan failed
Execution:      workspace started, workspace completed, workspace failed, retry triggered
Validation:     gate passed, gate failed, integration dirty, merge conflict
User actions:   approval, rejection, memory correction, goal change, dashboard interaction
Time-based:     6-hour heartbeat for stale memory detection
```

Observation does not spawn LLM calls. It only collects and indexes.

### 21.2 Exit Criteria per Phase

Each phase must demonstrate measurable readiness before proceeding:

| Phase | Exit Criteria |
|-------|---------------|
| P13 | 1. Brain Inbox receives observations within 5s of trigger
|     | 2. Minimal memory lifecycle (candidate → active) functional
|     | 3. Dashboard displays observation stream |
| P14 | 1. Memory scoring formula produces non-random rankings on blind test
|     | 2. Conflict detection fires when duplicate observations arrive
|     | 3. User can correct memory and see immediate dashboard update |
| P15 | 1. Goal draft proposal generated within 3 distinct drift scenarios
|     | 2. User approval/rejection of goal changes recorded in audit
|     | 3. Goals persist across restart |
| P16 | 1. Proposal scoring formula produces non-random rankings
|     | 2. Approval threshold correctly gates auto vs. require-approval
|     | 3. Proposal deduplication prevents decision loops |
| P17 | 1. Generated plan passes Doctor validation (non-zero confidence)
|     | 2. Rollback artifacts generated with every plan
|     | 3. Plan queue respects integration dirty check |
| P18 | 1. Reflection report generated after every plan completion
|     | 2. Memory update proposals derived from reflection
|     | 3. Reflection claim覆盖率 >95% (claims backed by evidence refs) |
| P19 | 1. User completes morning/evening protocol cycle
|     | 2. Overnight run completes without human intervention
|     | 3. Morning report reflects overnight activity accurately |
| P20 | 1. End-to-end cognitive loop runs for 7 consecutive days
|     | 2. Trust model boundaries never breached
|     | 3. System maintains <50ms memory retrieval at operating scale |

### 21.3 Cost Model

V2 has direct LLM costs per cognitive operation:

```text
Observation summary:     ~$0.01 (once per event batch, not per event)
Memory synthesis:        ~$0.03 per derived memory record
Proposal generation:     ~$0.05 per proposal
Plan generation:         ~$0.10 per phase plan
Reflection:              ~$0.04 per reflection report
```

Budget envelope for active project:

```text
Max LLM calls per cognitive cycle:  15
Max cycles per day:                   10  (covers observe→reflect loop 10x)
Estimated daily cost at full load:   $15-20
Monthly envelope:                    $450-600
```

If budget threshold exceeded:
- Proposal generation degrades to on-demand only (not auto-triggered)
- User receives warning in dashboard
- Overnight runs use pre-generated proposals only

### 21.4 Memory Scaling Strategy

At 10,000+ memories, naive O(n²) conflict resolution becomes untenable.

Hybrid retrieval architecture:

```text
Layer 1 — Exact Match (Redis/Map)
  Key: memory_id, type, tag
  O(1) retrieval for known memory

Layer 2 — Inverted Index (memory_type → memory_ids)
  O(k) where k = results for type filter
  Used for "find all failure_memory about X"

Layer 3 — Vector Embeddings (for semantic search)
  Used when user queries natural language
  Target: <100ms p99 for 10k vectors

Layer 4 — Scoring & Ranking
  Memory score computed at write time, stored as field
  Sort by score at read time
```

Conflict resolution strategy:

```text
On new memory write:
  1. Find memories of same type with overlapping tags
  2. Compute score delta
  3. If delta > 0.3, auto-mark lower as superseded
  4. If delta <= 0.3, flag for human review

Target performance:
  - Memory write: <50ms
  - Conflict check: <100ms
  - Retrieval (any layer): <50ms p95, <100ms p99
```

### 21.5 Policy Versioning

Policies are code. They must be versioned and migrated.

```text
Policy file: policies/v2-schema.json

{ "version": "2.3.0", "migratedFrom": "2.2.0", "rules": [...] }

Migration rules:
  - Breaking changes (autonomy level shifts) require explicit user approval
  - Non-breaking additions apply automatically
  - Policy history preserved in audit ledger
  - Current policy version visible in dashboard
```

### 21.6 Multi-Project Memory Isolation

If Pi serves multiple repositories:

```text
Memory includes project_id tag

Retrieval scope:
  - Default: current project only
  - Cross-project: requires explicit flag and approval
  - Shared memory (user_preference_memory): always included

Decision rules:
  - project_memory and architecture_memory scoped to project
  - failure_memory can be cross-project (learn from Repo A's errors in Repo B)
  - Requires user permission for cross-project suggestion
```

### 21.7 Observability Metrics

System health metrics:

```text
Cognitive metrics:
  - observation_rate: events/minute collected
  - memory_write_latency: p50, p95, p99
  - proposal_generation_duration: seconds
  - proposal_acceptance_rate: approved / total
  - reflection_coverage: claims with evidence refs / total claims

Queue metrics:
  - plan_queue_depth
  - integration_queue_dirty_duration
  - active_plan_count

Cost metrics:
  - llm_calls_per_cycle
  - daily_cost_rolling_average
  - budget_remaining_percentage

Alert thresholds:
  - proposal_acceptance_rate < 20% for 24h → investigate
  - memory_conflict_count > 10/day → scoring calibration needed
  - cycle_duration > 30s → scaling issue
  - budget < 10% → user notification
```

---

## 22. Guardrails

Pi V2 must never auto-execute:

- Secret access.
- Destructive cleanup.
- `git push`.
- Irreversible deletion.
- Protected system mutation without approval.
- Memory indexing of forbidden sources.
- Extension permission expansion without approval.
- Plan execution without approved graph when approval is required.
- Next plan execution while integration queue is dirty.
- LLM-generated state mutation without runtime validation.
- Reflection claims without evidence references.

---

## 22. Initial V2 Operating Mode

Recommended initial settings:

```yaml
advisor: enabled
planner: enabled
operator: approval_gated
autonomous_strategist: disabled
memory_indexing: approval_required_by_source
protected_system_mutation: approval_required
destructive_actions: disabled
git_push: disabled
overnight_mode: approved_queue_only
proposal_display_limit: 3
memory_conflict_review: enabled
source_backed_reflection_required: true
```

This gives Pi enough autonomy to become useful without becoming unsafe.

---

## 23. Risk & Rollback Strategy

### 23.1 Risk: Bad Memory Influences Planning

Rollback:

1. Mark memory `rejected_by_user` or `disputed`.
2. Remove it from active retrieval.
3. Re-run proposal scoring without that memory.
4. Preserve audit trail.

### 23.2 Risk: Proposal Engine Produces Noise

Rollback:

1. Increase proposal threshold.
2. Limit visible proposals to top 3.
3. Add cooldown for rejected categories.
4. Disable auto-proposal generation if needed.

### 23.3 Risk: Goal Model Drifts

Rollback:

1. Freeze strategic proposals.
2. Ask user for goal review.
3. Revert to last confirmed goal snapshot.

### 23.4 Risk: Plan Factory Generates Bad Plans

Rollback:

1. Keep generated plan as draft only.
2. Do not enqueue.
3. Require doctor and approval.
4. Create repair proposal.

### 23.5 Risk: Overnight Execution Stops Unexpectedly

Rollback:

1. Stop plan queue.
2. Preserve artifacts.
3. Generate morning incident report.
4. Require user action before resume.

---

## 24. Open Questions

1. Should Pi be allowed to auto-generate plans without asking first?
2. Should Pi be allowed to auto-enqueue generated plans, or only draft them?
3. Which memory sources require approval before indexing?
4. What confidence threshold is required for auto-decisions?
5. Should user preferences live in memory, settings, or both?
6. How should Pi explain rejected alternatives?
7. Should the Proposal Engine optimize for speed, safety, or strategic value by default?
8. What should the morning report include?
9. How much dashboard control should exist for autonomy levels?
10. When is V2 trusted enough to enable Autonomous Strategist mode?

---

## 25. Recommended Next Step

Create the first executable V2 phase:

```text
docs/pi/phases/phase_p13_brain_core_orchestrator_daemon.md
```

P13 should build the Brain Core vertical slice and Orchestrator Daemon, but it should remain conservative:

- Observation-first.
- Minimal brain viewer included.
- Proposal-ready.
- Approval-gated.
- Fully auditable.
- No irreversible decisions.

P13 should make Pi capable of seeing, summarizing, and preparing decisions.

---

## 26. Compact Mental Model

```text
V1: Execute my plans.
V2: Help me decide what plans should exist, generate them, queue them, execute approved work, and learn from the outcome.
```

The V2 promise:

```text
Less manual planning.
Less repeated context loading.
Less forgotten history.
Better overnight execution.
More useful ideas.
Safer autonomy.
```


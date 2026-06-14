It# ACCP Auto-Routing Vision v2 — User Routes Over Internal Report Types

## Status

```yaml
vision_id: ACCP_AUTO_ROUTING_VISION_V2
status: revised_after_external_reviews
primary_review_basis: Claude Sonnet 4.6 Max RIR review
secondary_review_basis: MiniMax-M3 local Pi agent RIR review
intended_use:
  - architecture review
  - ACCP route registry planning
  - TUI routing UX design
  - router implementation planning
not_intended_as:
  - final implementation contract
  - completed route registry
  - authority to mutate, complete, or promote work
```

## Executive Summary

ACCP currently has many internal report/core types. Exposing these directly to daily users creates UX overload and increases the chance of false completion, wrong report selection, and wrong promotion authority.

The revised design keeps the internal report matrix, but hides it behind a smaller user-facing routing layer:

```text
Daily user sees: Auto + 6 user-facing routes
Power user sees: Expert / Direct exact report type override
System keeps: internal ACCP report types and chains
Router selects: route family + exact report type or chain
CompletionGate decides: evidence authority, completion, and promotion
```

The core principle remains:

```text
Report type is not user intent.
Report type is compiler/runtime internal machinery.
Route selection is not completion authority.
```

This revision incorporates two external critiques. The most important changes are:

1. Rename and clean up the 6 user-facing routes.
2. Remove confusing terms like `Route` and `Negative Control` from user-facing route names.
3. Correct internal type misassignments: `BSR` is not Plan/Spec, `FPR` is not Execute/Build, and `ECR` must not sit between `FVR` and `PRR` in the critical bugfix chain.
4. Add explicit hard stops before any implementation begins.
5. Add multi-intent decomposition for requests like “plan, implement, verify, commit”.
6. Treat Auto routing as suggestive by default, with hard-gated execution and promotion.
7. Add route-decision evidence artifacts so routing decisions are auditable.
8. Keep `Abort / Cancel` and `Reroute` as control actions, not main routes.

---

## Design Goals

```yaml
goals:
  - Hide internal report complexity from daily users.
  - Preserve full ACCP report-type power internally.
  - Make routing auditable and testable.
  - Prevent wrong route from authorizing mutation, completion, or promotion.
  - Support report chains for multi-phase tasks.
  - Support bugfix lifecycle routing.
  - Support P50 stack-up live E2E gauntlet routing.
  - Keep TUI simple while exposing enough route state for trust.
```

## Non-Goals

```yaml
non_goals:
  - Do not remove existing internal report types.
  - Do not make Auto routing completion authority.
  - Do not make PRR proof by itself.
  - Do not expose all 24 internal types to daily users.
  - Do not add new top-level routes unless they solve an actual daily UX problem.
  - Do not let Expert/Direct bypass hard stops.
```

---

## Final User-Facing Taxonomy

The daily TUI should expose the following route set:

```yaml
user_facing_routes:
  - Auto
  - Intake / Inventory
  - Plan / Spec
  - Execute / Build
  - Verify / Validate
  - Review / Promote
  - Repair / Debug
  - Expert / Direct
```

`Expert / Direct` is not one of the six normal branches. It is an escape hatch for exact report type selection. It must remain gated by the same hard stops.

Control actions should exist but not be counted as routes:

```yaml
control_actions:
  - Abort / Cancel
  - Reroute
  - Pause
  - Resume
```

These are important, especially for wrong Auto route decisions, but they should not expand the core taxonomy.

---

## Route 1 — Intake / Inventory

### User meaning

```text
What exists? What is the current state? What evidence, services, tests, routes, and risks exist?
```

### Used when

- Repo, stack, task, or evidence state is unknown.
- The user asks to analyze, inspect, audit, inventory, scan, or discover.
- A large phase starts and the system needs a current-state map.
- Live stack or production-adjacent work is requested without fresh stack inventory.

### Candidate internal report types

```yaml
primary:
  - RIR
supporting:
  - HIR
  - inventory reports if present in the registry
```

### Examples

```text
Analyze whether the repo already has make stack-up, web-server, dashboard, and execution-service for P50.
```

```yaml
route_decision:
  route: Intake / Inventory
  internal_report_type: RIR
  reason: Current-state inventory is needed before planning or implementation.
```

---

## Route 2 — Plan / Spec

### User meaning

```text
Define what we are going to do, with scope, file ownership, waves, acceptance, gates, evidence, and hard stops.
```

### Used when

- User asks for plan, spec, PlanSpec, architecture, blueprint, roadmap, prompt, implementation contract.
- Work must be decomposed before coding.
- Mutation is requested but no PlanLock / execution contract exists.
- P50 or other large gauntlets need an acceptance contract.

### Candidate internal report types

```yaml
primary:
  - PIR
  - IPR
supporting:
  - PlanSpec
  - PlanLock
```

### Explicit correction

`BSR` must not be assigned to Plan / Spec by default. It belongs to Repair / Debug. If planning needs discovery, the router should run an Intake step first, then Plan.

### Examples

```text
Plan P50 as a make stack-up live E2E promotion gauntlet.
```

```yaml
route_decision:
  route: Plan / Spec
  internal_report_type: IPR
  reason: The user wants implementation scope, gates, and acceptance criteria.
```

---

## Route 3 — Execute / Build

### User meaning

```text
Implement the authorized plan. Write code, wire systems, run execution steps, and commit if allowed.
```

### Used when

- User asks to implement, build, write, add, wire, create, modify, apply, run, execute, or commit.
- A valid PlanSpec/PlanLock exists or user explicitly authorizes a small local mutation.
- The task is forward-progress implementation, not bug repair.

### Candidate internal report types

```yaml
primary:
  - ECR
supporting:
  - EXR
  - MER
```

### Explicit correction

`FPR` must not be assigned to Execute / Build. `FPR` is a Repair / Debug artifact for fix patches.

### Examples

```text
Implement make p50-stack-up-live-e2e and make test-promotion.
```

```yaml
route_decision:
  route: Execute / Build
  internal_report_type: ECR
  reason: The task is authorized implementation/mutation.
```

---

## Route 4 — Verify / Validate

### User meaning

```text
Prove that it works. Run tests, collect evidence, validate runtime behavior, and produce gate results.
```

### Used when

- User asks to test, verify, validate, prove, check evidence, run gates, or inspect runtime proof.
- Implementation exists but is not proven.
- A Review / Promote request lacks current TVR/FVR evidence.

### Candidate internal report types

```yaml
primary:
  - TVR
  - FVR
supporting:
  - evidence capsules if present in the registry
```

### Boundary with Review / Promote

Verify answers:

```text
Does it actually work, and what evidence proves it?
```

Review answers:

```text
Given the evidence, is it ready to promote or close?
```

Review must not run if Verify evidence is missing, stale, unit-only, or failed.

---

## Route 5 — Review / Promote

### User meaning

```text
Is this ready? Can this phase close? Can this be promoted, merged, or accepted?
```

### Used when

- User asks for final verdict, readiness, sign-off, merge, release, promotion, closeout.
- Current Verify evidence exists.
- Completion/promotion decision is needed.

### Candidate internal report types

```yaml
primary:
  - PRR
  - RAR
supporting:
  - scorecard
```

### Hard boundary

`PRR` is a verdict artifact, not proof by itself. It must be blocked unless current TVR/FVR evidence is PASS and evidence requirements are satisfied.

---

## Route 6 — Repair / Debug

### User meaning

```text
Something failed or is suspicious. Reproduce it, find root cause, fix it, and validate the fix.
```

### Used when

- User says bug, fail, HOLD, blocker, broken, regression, false PASS, root cause, why, debug, repair, fix.
- Existing tests/gates fail.
- A PASS is suspicious or lacks runtime evidence.
- Mutation is corrective rather than forward implementation.

### Candidate internal report types

```yaml
primary:
  - BSR
  - BRR
  - RCA
  - FPR
  - FVR
supporting:
  - HIR
  - RAR
  - PRR
```

### Boundary with Execute / Build

Both Execute and Repair can mutate code. The difference is intent and evidence context:

```yaml
execute:
  purpose: forward implementation of an authorized plan
  typical_report: ECR

repair:
  purpose: defect/regression/false-pass correction
  typical_chain: BSR -> BRR -> RCA -> FPR -> FVR -> PRR
```

---

## Expert / Direct

### User meaning

```text
I know the exact internal report type I want.
```

### Used when

- Power user explicitly selects a report type.
- A strict ACCP report is needed for a known purpose.

### Requirements

```yaml
requirements:
  exact_type_picker_grouped_by_domain: true
  hard_stops_still_apply: true
  no_completion_authority_bypass: true
  no_mutation_authority_bypass: true
  no_promotion_authority_bypass: true
```

### UX rule

Do not present a flat list of 24 types by default. Group advanced report types under domains:

```yaml
advanced_groups:
  discovery_inventory:
    - RIR
    - HIR
  planning:
    - PIR
    - IPR
    - PlanSpec
    - PlanLock
  execution:
    - ECR
    - EXR
    - MER
  verification:
    - TVR
    - FVR
  review_promotion:
    - RAR
    - PRR
  repair_debug:
    - BSR
    - BRR
    - RCA
    - FPR
    - FVR
    - HIR
```

The exact authoritative list must be sourced from the ACCP report registry before implementation.

---

## Corrected Bugfix Routing

### Small obvious bug

Use when:

- A failing test already identifies the exact behavior.
- Suspect file/scope is obvious.
- Single package or single workspace.
- No authority, promotion, write-boundary, or live-stack risk.

```yaml
small_bug_chain:
  - BRR
  - FPR
  - FVR
  - PRR
```

### Unknown bug

Use when:

- Symptom exists but suspect area is unclear.
- Multiple suspect files or packages exist.
- Reproduction path is not yet pinned down.

```yaml
unknown_bug_chain:
  - BSR
  - BRR
  - RCA
  - FPR
  - FVR
  - PRR
```

### Critical bug

Use when:

- Severity is critical.
- Production impact is confirmed.
- Bug touches auth, write boundary, promotion gate, secrets, schema migration, or authority path.
- Blast radius is more than three workspaces.
- False PASS, gate bypass, or mutation authority bypass is suspected.

```yaml
critical_bug_chain:
  - BSR
  - BRR
  - RCA
  - HIR
  - FPR
  - FVR
  - PRR
```

### Explicit correction

`ECR` must not be inserted between `FVR` and `PRR` in the critical bugfix chain. If execution evidence needs to be recorded, it should be referenced by FPR/FVR evidence or handled under the Execute domain. It must not create a new mutation-like step after validation and before promotion.

### Bugfix feedback loops

Bugfix chains are not purely linear. The router must support loops:

```yaml
feedback_loops:
  BRR_cannot_reproduce:
    next: BSR
    reason: Need broader search or better repro fixture.

  RCA_hypothesis_rejected:
    next: BSR
    reason: Suspect area was wrong.

  FVR_fails_same_bug:
    next: RCA
    reason: Fix did not address root cause.

  FVR_fails_regression:
    next: RCA_or_FPR
    reason: Patch introduced a new failure.

  PRR_hold_missing_runtime_evidence:
    next: Verify / Validate
    reason: Review cannot invent evidence.
```

---

## P50 Routing Chain

P50 is the Stack-Up Live Execution Correctness Gauntlet. Its primary evidence path is the repository's own `make stack-up` live stack. Synthetic/Python mini-server evidence may only serve as a negative-control or fallback fixture; it cannot satisfy the main P50 promotion gate.

### P50 route chain

```yaml
P50_route_chain:
  - branch: Intake / Inventory
    internal_report_types:
      - RIR
    purpose: Inventory real stack, make targets, web-server, API, dashboard, execution-service, evidence paths.

  - branch: Plan / Spec
    internal_report_types:
      - IPR
      - PlanSpec
      - PlanLock
    purpose: Define make stack-up live E2E gauntlet contract, gates, evidence, metrics, and hard stops.

  - branch: Execute / Build
    internal_report_types:
      - ECR
      - EXR
      - MER
    purpose: Implement make targets, runner, metrics collector, evidence writer, CI/promotion target.

  - branch: Verify / Validate
    internal_report_types:
      - TVR
      - FVR
    purpose: Prove real stack, real task submission, multi-plan execution, ACCP artifacts, metrics, and regression health.

  - branch: Review / Promote
    internal_report_types:
      - PRR
      - RAR
    purpose: Decide promotion readiness from current TVR/FVR evidence.

  - branch: Repair / Debug
    condition: only_if_HOLD_or_FAIL
    internal_report_types:
      - BSR
      - BRR
      - RCA
      - FPR
      - FVR
    purpose: Repair failing blocker and re-enter validation.
```

### P50 hard rules

```yaml
P50_hard_rules:
  - RIR must confirm live stack reachability before Plan/Spec proceeds.
  - PlanLock must exist before ECR/EXR/MER.
  - make stack-up is the primary evidence path.
  - no synthetic server may satisfy the main promotion gate.
  - TVR must capture real API/task submission traces.
  - FVR must confirm regression health.
  - averageParallelism and peakParallelism must be computed from live execution events.
  - PRR must be blocked if TVR or FVR is missing, stale, HOLD, or FAIL.
  - Repair loop must re-run FVR before returning to PRR.
```

---

## Multi-Intent Decomposition

Users often ask for multiple phases in one sentence:

```text
Plan it, implement it, test it, and commit it.
```

The router must not collapse this into one route. It must decompose into an ordered chain.

### Canonical phase order

```yaml
canonical_order:
  - Intake / Inventory
  - Plan / Spec
  - Execute / Build
  - Verify / Validate
  - Review / Promote

conditional_detours:
  - Repair / Debug
```

### Decomposition example

```yaml
user_request: "Plan P50, implement the gauntlet, verify it, and decide if promotion is allowed."
route_chain:
  - Plan / Spec
  - Execute / Build
  - Verify / Validate
  - Review / Promote
confirmation_required: true
```

### Rules

```yaml
multi_intent_rules:
  - Do not merge separate canonical phases into one report.
  - Do not promote before verify.
  - Do not execute before PlanLock unless explicit small local mutation override exists.
  - Re-evaluate hard stops at each phase boundary.
  - Show the decomposed chain to the user before mutation or promotion.
```

---

## Auto-Routing Architecture

### Layer 0 — Safety preflight

```yaml
safety_preflight:
  read_repo_state: true
  read_evidence_state: true
  detect_dirty_state: true
  detect_live_or_production_target: true
  detect_authority_boundary: true
  detect_stale_phase_state: true
```

### Layer 1 — Intent extraction

```yaml
intent:
  intake_requested: boolean
  planning_requested: boolean
  mutation_requested: boolean
  verification_requested: boolean
  promotion_requested: boolean
  failure_context_present: boolean
  bugfix_context_present: boolean
  cancel_or_abort_requested: boolean
  exact_report_type_requested: boolean
```

### Layer 2 — State signals

```yaml
repo_state_signals:
  - PlanSpec exists / missing / stale
  - PlanLock exists / missing
  - working tree clean / dirty
  - last CI status
  - current branch and commit
  - live stack health
  - open PR state

evidence_state_signals:
  - TVR exists and current
  - FVR exists and current
  - FVR verdict PASS/HOLD/FAIL
  - PRR exists but claim-only
  - runtime evidence present/missing
  - evidence stale by TTL
  - scorecard exists/missing

risk_signals:
  - auth/write-boundary/promotion-gate path touched
  - live-stack or production-adjacent work
  - cross-service or cross-workspace mutation
  - critical severity
  - false PASS suspicion
```

### Layer 3 — Candidate route scoring

```yaml
route_scoring:
  inputs:
    - user_text_signals
    - repo_state_signals
    - evidence_state_signals
    - risk_signals
  output:
    - candidate_routes_with_scores
    - primary_signal
    - blocked_routes
    - required_hard_stops
```

### Layer 4 — Hard stop filtering

Hard stops must run before any route is accepted. A route with high confidence can still be blocked.

### Layer 5 — Confidence and user confirmation

This revision uses a staged trust model rather than unconditional Auto.

```yaml
confidence_policy:
  auto_accept_non_mutating:
    threshold: 0.85
    allowed_routes:
      - Intake / Inventory
      - Verify / Validate
    requires_no_hard_stops: true

  auto_accept_mutating_or_promoting:
    threshold: 0.90
    allowed_only_if:
      - PlanLock or explicit user authorization exists
      - no authority-boundary risk
      - no hard stops
      - user has enabled Auto for risky actions

  ask_user:
    range: [0.60, 0.85]
    show_top_candidates: 2

  force_manual_or_intake:
    below: 0.60
    action: ask_user_or_default_to_intake
```

Raw LLM confidence must not be treated as calibrated truth. The router should be tested against labeled routing samples and negative prompts before Auto is trusted.

### Layer 6 — Route decision evidence

Every route decision must be stored as evidence.

```yaml
route_decision_artifact:
  path_pattern: reports/accp/route-decisions/<timestamp>-<task-id>.route-decision.json
  fields:
    - task_id
    - user_request_hash
    - selected_route
    - selected_internal_report_type_or_chain
    - confidence
    - primary_signal
    - candidate_routes
    - hard_stops_checked
    - hard_stops_triggered
    - repo_state_snapshot_hash
    - evidence_state_snapshot_hash
    - user_confirmation_required
    - user_confirmation_received
    - timestamp
```

---

## Hard Stop Registry v1

These are mandatory before implementation.

```yaml
hard_stops:
  - id: HS-001
    condition: Execute / Build requested but no PlanLock exists for non-trivial mutation.
    action: Block ECR/EXR/MER; route to Plan / Spec or ask for explicit small-change override.

  - id: HS-002
    condition: Review / Promote requested but no current FVR or TVR PASS exists.
    action: Block PRR/RAR; route to Verify / Validate.

  - id: HS-003
    condition: Multi-workspace FPR requested but no RCA exists.
    action: Block FPR; require RCA.

  - id: HS-004
    condition: Wave N+1 execution requested while wave N gate is not PASS.
    action: Block next wave; require repair or validation.

  - id: HS-005
    condition: Code mutation attempted while active route is Verify / Validate.
    action: Block mutation; require Execute / Build or Repair / Debug re-route.

  - id: HS-006
    condition: PRR requested while any active-chain FVR is FAIL, BLOCK, or HOLD.
    action: Block PRR; require Repair / Debug or Verify / Validate.

  - id: HS-007
    condition: Critical bug detected but no HIR/escalation artifact exists.
    action: Block FPR; require HIR or equivalent halt/isolate decision.

  - id: HS-008
    condition: Router confidence below threshold and user has not selected route.
    action: Block route execution; ask user or default to Intake / Inventory for read-only discovery.

  - id: HS-009
    condition: Live-stack or production-adjacent mutation requested but no fresh RIR exists.
    action: Block mutation; run Intake / Inventory first.

  - id: HS-010
    condition: Multi-intent chain violates canonical phase order.
    action: Block chain; present corrected order for confirmation.

  - id: HS-011
    condition: PRR requested with unit-only evidence for runtime-visible feature.
    action: Block PRR; require runtime/live evidence.

  - id: HS-012
    condition: Repair / Debug entered without diagnostic trigger artifact, failing test, error log, HOLD/FAIL, or user-provided symptom.
    action: Block repair chain; require BSR or diagnostic trigger.

  - id: HS-013
    condition: Expert / Direct override selected but required evidence or authority gate is missing.
    action: Block exact-type execution; show missing gate.

  - id: HS-014
    condition: Route decision attempts to authorize completion, mutation, or promotion by itself.
    action: Block; route decision is advisory only.

  - id: HS-015
    condition: Evidence artifact is stale relative to commit, branch, or TTL.
    action: Block Review / Promote; route to Verify / Validate.

  - id: HS-016
    condition: Chain length exceeds configured maximum without user confirmation.
    action: Pause and ask user to split or confirm extended chain.
```

---

## TUI UX v2

### Default Auto display

Daily users should not need to see internal report codes by default.

```text
ACCP: Auto · Route: Repair / Debug · Step: Reproduce bug · Confidence: 88%
```

Expandable detail:

```text
Internal chain: BSR → BRR → RCA → FPR → FVR → PRR
Hard stops: 0 triggered
Evidence: route-decision.json
```

### Low-confidence display

```text
ACCP: Low confidence · Pick route:
1. Verify / Validate — 64% — user asked to prove behavior
2. Repair / Debug — 58% — failure context detected
Esc: Abort · M: Expert / Direct
```

Show top 2 rather than top 3 to reduce decision overload. If still ambiguous, ask a targeted clarification.

### During multi-step chain

```text
ACCP: Auto · Chain: Plan → Execute → Verify → Review
Current: Execute / Build · Next: TVR · 2/4
Esc: Abort · Tab: Reroute · Enter: Continue
```

### Expert / Direct picker

```text
Expert / Direct
Discovery: RIR, HIR
Planning: PIR, IPR, PlanSpec, PlanLock
Execution: ECR, EXR, MER
Verification: TVR, FVR
Review: RAR, PRR
Repair: BSR, BRR, RCA, FPR, FVR, HIR
```

Exact report type selection must show warnings if hard stops block that type.

---

## Route Registry v1 Sketch

```yaml
accp_route_registry:
  version: "1.0.0"
  user_routes:
    intake_inventory:
      label: "Intake / Inventory"
      primary_types: [RIR]
      supporting_types: [HIR]
      mutation_allowed: false
      promotion_allowed: false

    plan_spec:
      label: "Plan / Spec"
      primary_types: [PIR, IPR]
      supporting_types: [PlanSpec, PlanLock]
      mutation_allowed: false
      promotion_allowed: false

    execute_build:
      label: "Execute / Build"
      primary_types: [ECR]
      supporting_types: [EXR, MER]
      mutation_allowed: true
      requires_planlock: true
      promotion_allowed: false

    verify_validate:
      label: "Verify / Validate"
      primary_types: [TVR, FVR]
      mutation_allowed: false
      promotion_allowed: false
      runtime_evidence_required_for_runtime_features: true

    review_promote:
      label: "Review / Promote"
      primary_types: [PRR, RAR]
      mutation_allowed: false
      promotion_allowed: true
      requires_current_verify_pass: true

    repair_debug:
      label: "Repair / Debug"
      primary_types: [BSR, BRR, RCA, FPR, FVR]
      supporting_types: [HIR, PRR, RAR]
      mutation_allowed: true
      requires_diagnostic_trigger: true

  control_actions:
    abort_cancel:
      writes_chain_abort_artifact: true
    reroute:
      writes_route_decision_artifact: true
```

The registry must be generated or verified against the authoritative ACCP type registry. Do not hardcode unknown or deprecated report types without validation.

---

## Required Tests

### Unit tests

```yaml
unit_tests:
  - Route inference for labeled intent samples across all routes.
  - Confidence threshold behavior at exact boundaries.
  - BSR excluded from Plan / Spec.
  - FPR excluded from Execute / Build.
  - ECR excluded from critical bugfix chain between FVR and PRR.
  - Small/unknown/critical bug chain selector.
  - Hard stop HS-001 through HS-016 triggers.
  - Exact report type override still enforces hard stops.
  - Multi-intent decomposition follows canonical order.
```

### Integration tests

```yaml
integration_tests:
  - Unknown bugfix chain: BSR -> BRR -> RCA -> FPR -> FVR -> PRR.
  - Critical bugfix chain with HIR gate before FPR.
  - P50 chain: RIR -> IPR/PlanLock -> ECR -> TVR/FVR -> PRR/RAR.
  - Repair loop injection after FVR FAIL.
  - Review blocked by stale or missing TVR/FVR.
  - Mutation blocked in Verify / Validate route.
  - TUI displays Auto, low-confidence, and Expert / Direct states correctly.
  - Route decision artifact is written and hash-linked.
```

### Live tests

```yaml
live_tests:
  - P50 stack-up route chain on real local stack.
  - Wrong-route negative prompt set.
  - Multi-intent live chain with user confirmation gate.
  - Critical bug / authority-boundary escalation path.
  - Abort / Reroute preserves chain state.
```

### Negative tests

```yaml
negative_tests:
  - Execute without PlanLock is blocked.
  - PRR without FVR/TVR PASS is blocked.
  - PRR with unit-only runtime evidence is blocked.
  - FPR without RCA for multi-workspace bug is blocked.
  - Low-confidence route does not auto-execute mutation.
  - Expert / Direct cannot bypass hard stops.
  - False PASS / missing runtime evidence routes to Repair or Verify, not Review.
```

---

## Implementation Plan

### Phase 1 — Registry and hard stops only

```yaml
phase_1:
  deliverables:
    - final route taxonomy
    - authoritative internal type list
    - accp-route-registry schema
    - hard stop registry HS-001..HS-016
    - route-decision artifact schema
  no_auto_execution: true
  no_mutation_by_router: true
```

### Phase 2 — Deterministic router and tests

```yaml
phase_2:
  deliverables:
    - rule-based route scorer
    - bugfix chain selector
    - multi-intent decomposition
    - route decision evidence writer
    - unit/negative tests
  auto_mode: suggest_only
```

### Phase 3 — TUI route UX

```yaml
phase_3:
  deliverables:
    - Auto route footer/card
    - low-confidence picker
    - Expert / Direct grouped picker
    - Abort / Reroute controls
    - chain progress display
```

### Phase 4 — Live integration and calibration

```yaml
phase_4:
  deliverables:
    - P50 route chain integration
    - live route tests
    - confidence calibration set
    - Auto-accept for safe read-only routes
    - gated Auto-accept for risky routes only after evidence
```

---

## Acceptance Criteria

```yaml
acceptance:
  daily_user_not_forced_to_choose_24_types: true
  exact_type_available_under_expert_direct: true
  six_main_routes_locked: true
  abort_and_reroute_available_as_controls: true
  route_decision_logged_as_evidence: true
  route_decision_not_completion_authority: true
  PRR_blocked_without_current_verify_pass: true
  Execute_blocked_without_PlanLock_for_nontrivial_mutation: true
  bugfix_chains_supported: true
  P50_route_chain_supported: true
  multi_intent_decomposition_supported: true
  hard_stops_tested: true
  wrong_route_negative_tests_pass: true
```

---

## Open Questions Before Implementation

```yaml
open_questions:
  - What is the authoritative complete list of internal ACCP report types?
  - What is the final definition of HIR in the current registry?
  - Are PIR and IPR distinct in the current implementation, and what is their exact boundary?
  - Are EXR and MER official, current, and accepted by the compiler?
  - Where should route-decision artifacts live permanently?
  - What TTL makes evidence stale for Review / Promote?
  - Should Auto-accept be enabled immediately for read-only routes only?
  - Who can use Expert / Direct in the TUI?
```

---

## Requested Review From Next Model

The next reviewer should evaluate this revised vision, not the original version.

```yaml
review_request:
  report_type: RIR
  scoring_scale: 100
  questions:
    - Is the revised 6-route taxonomy implementation-ready?
    - Are the hard stops sufficient to prevent wrong route promotion/mutation/completion?
    - Is the bugfix chain corrected?
    - Is the P50 chain correctly represented?
    - Is Auto routing safe as suggest-first with gated auto-accept?
    - Are Abort/Reroute correctly modeled as control actions rather than main routes?
    - Is the TUI design understandable for daily users?
    - What must be changed before Phase 1 implementation?
```

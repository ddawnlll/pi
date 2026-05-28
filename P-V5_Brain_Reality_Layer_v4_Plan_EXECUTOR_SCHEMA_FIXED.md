# LLM Implementation Agent — ExecutionKernel & Intent-Driven Execution Template v4.0

**Phase:** `P-V5`  
**Title:** Brain Reality Layer  
**Contract Version:** `4.0.0`  
**Template Version:** `4.0.0`  
**Last Updated:** 2026-05-27  
**Execution Class:** `implementation`  
**Selected Scale Mode:** `stable_6`  
**Requested Max Workers:** `6`  
**Expected DAG Effective Parallelism:** `3`  
**Expected Safe Effective Parallelism:** `3`  
**Workspace Count:** `20`  
**Batch Count:** `9`  
**Primary Product Goal:** Make Pi's second-brain layer real, queryable, evidence-backed, memory-aware, dashboard-visible, approval-gated, and safe.

> **Parser compatibility fix:** Workspaces are declared at the top-level `workspaces[]` key in Part 3 JSON. `planExecution.maxParallelWorkspaces` remains the source for max parallelism, while `parallelismReview` carries the batch and safe-batch previews.

---

## Overview

This plan implements **P-V5 — Brain Reality Layer** using the v4 ExecutionKernel and intent-driven execution template. V5 is not a new fantasy architecture. It is the productization layer that turns the existing V2/P13-P20 brain concepts into a daily usable engineering brain.

The intended user experience is:

```text
Pi observes project activity.
Pi remembers what mattered.
Pi explains what happened with evidence.
Pi proposes useful next actions.
Pi drafts plans and bugfixes.
Pi asks for approval before risky action.
Pi shows its safe activity stream.
Pi prepares overnight readiness but does not run unsafe work.
```

The core V5 doctrine is:

```text
Brain observes.
Brain remembers.
Brain explains.
Brain proposes.
Brain drafts.
Policy gates.
ExecutionKernel acts.
Audit records.
```

Brain workers and dashboard actions must never directly mutate execution state. They may emit events, evidence, signals, proposals, drafts, and handoff requests. Actual execution state transitions remain owned by the V4 ExecutionKernel.

---


> Executor schema fix: this version keeps top-level `workspaces[]` and adds both `capabilityManifest.canEdit` and legacy `capabilities.canEdit` to every workspace so runtime file locking does not acquire an empty file set. It also adds legacy workspace fields such as `parallelism`, `worktree`, `integration`, `targetCommand`, `roleBudget`, `maxRetries`, and `riskLevel` while preserving the V4 ExecutionKernel contract.

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

| Field | Value |
|---|---|
| Phase | `P-V5` |
| Title | `Brain Reality Layer` |
| One-line goal | Make Pi's brain actually usable: temporal memory, evidence-backed Ask Pi, repo scanner, proposal/draft generation, proactive push, reflection, dashboard visibility, and overnight readiness. |
| Why now | V4/P26/P30 execution correctness work gives the substrate needed for a safer brain layer; V5 must remain advisory unless kernel gates pass. |
| Blast radius | `packages/coding-agent/src/brain/**`, `packages/web-server/src/**`, `packages/web-ui/dashboard/src/**`, `docs/pi/v5/**`, tests and reports. |
| Rollback path | Disable `BRAIN_V5_ENABLED`, hide V5 dashboard routes, and keep existing V2/P19 brain pages operational. |
| Repair class | `implementation` |
| Execution automation | `enabled only if V4 admission gates pass` |
| Autonomous execution allowed | `true for this implementation plan only after V4 admission; false for generated plans/drafts without approval` |
| Agent repo mutation allowed | `true after admission` |
| Promotion gate status | `requires stable_6 / ExecutionKernel gate` |
| Scale mode | `stable_6` |
| Safe parallelism target | `3` |
| Done when | The E2E dogfood gauntlet proves temporal QA, evidence-backed Ask Pi, memory injection, repo scanner, proposals, drafts, push, reflection, overnight readiness, brain stream, and state-mutation safety. |

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P-V5` |
| Title | `Brain Reality Layer` |
| Status | `Planned` |
| Last updated | `2026-05-27` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Second-brain reality layer and dashboard productization` |
| Product-code changes | `Allowed` |
| Repair class | `implementation` |
| Execution automation | `enabled after V4 admission` |
| Selected repair mode | `stable_6` |
| Target promotion mode | `stable_6` |
| Autonomous execution allowed | `true for this plan after admission` |
| Agent repo mutation allowed | `true after admission` |
| Promotion gate status | `pending` |
| Selected scale mode | `stable_6` |
| Requested max workers | `6` |
| Expected DAG effective parallelism | `3` |
| Expected safe effective parallelism | `3` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| Backend Brain V5 | Implementation Agent | Pi Owner | ExecutionKernel / Policy reviewers | Dashboard users |
| Dashboard Brain Console | Implementation Agent | Pi Owner | UX / Trust reviewers | Dashboard users |
| E2E Dogfood | Implementation Agent | Pi Owner | Runtime / CI reviewers | Future agents |

---

## 2. Purpose

P-V5 implements the Brain Reality Layer: the set of backend, API, and dashboard capabilities required for Pi to feel like a working second brain rather than a static dashboard. The phase focuses on temporal awareness, evidence indexing, memory retrieval and injection, conversational brain queries, repo scanning, signal generation, proposals, drafts, proactive push, reflection, overnight readiness, and live brain visibility.

V5 intentionally keeps the runtime boundary strict. The brain may observe, retrieve, infer, propose, and draft, but it must not mutate execution state. Every claim must be evidence-backed or explicitly uncertain. Every generated plan must contain a memory retrieval/injection report. Every risky action remains approval-gated.

The phase also upgrades the dashboard from a plan-run monitor into a Brain Reality Console: project-level overview, Ask Pi, temporal journal, evidence drawer, memory injection UI, repo scanner, proposal inbox v2, Draft Studio, brain stream, run-context explanations, and Trust & Approvals.

---

## 3. What Carried Over — Must Stay Stable

- Existing execution monitoring dashboard remains functional.
- Existing Brain State, Memory, Reflections, Overnight, Goals, Trust, Pi Inbox, Digest, and Observability pages remain accessible or are migrated behind stable route aliases.
- Existing P13-P20 brain data remains readable.
- Existing Proposal Inbox and Memory UI behavior is preserved until V5 replacements are feature-flagged.
- Worktree isolation remains available when requested by scale mode.
- Integration queue remains enabled when required by scale mode.
- Global validation lock remains active for heavy validation.
- Completion gate hardening remains active.
- Merge conflicts produce handoff artifacts and do not mark the plan complete.
- The next plan does not start while the integration queue is dirty.
- `git push` remains forbidden.
- Raw destructive cleanup remains forbidden.
- Watch-mode validation remains forbidden.
- ExecutionKernel remains the source of truth for state transitions; executors, actors, diagnostics, and brain workers emit events only.

---

## 4. Background / What Was Wrong

V4/V2 currently has pieces of a brain: timeline, observations, memory store, proposals, reflections, dashboard pages, inbox, digest, observability, and chat. However, the user experience is fragmented. The system can store some signals, but it cannot reliably answer natural-language questions such as "what got stuck last week?", "why did this workspace retry?", or "what should we do tonight?" with evidence, memory, and suggested action in one place.

The biggest missing pieces are:

- temporal rollups and pattern analysis,
- evidence index shared by answers/proposals/drafts,
- memory retrieval and injection into generated work,
- repo scanner that creates actionable signals,
- proposal and draft generation that is visibly evidence-backed,
- dashboard pages that expose these capabilities coherently,
- safe brain stream visibility,
- overnight readiness instead of unsafe overnight execution.

V5 closes that gap without weakening execution safety.

---

## 5. Current Failure State / Known Blockers

- `temporal_journal_v2` = not implemented
- `evidence_index` = incomplete
- `memory_retrieval_injection` = incomplete
- `brain_query_api` = not implemented
- `repo_scanner_v2` = not implemented
- `proposal_engine_v2` = incomplete
- `draft_generator_v2` = not implemented
- `brain_overview_dashboard` = not implemented
- `ask_pi_evidence_ui` = not implemented
- `overnight_readiness_gate` = incomplete
- `brain_stream_safe_ui` = not implemented
- `worktree_isolation` = required for stable_6
- `integration_queue` = required for stable_6
- `scale_mode_readiness` = must pass before execution
- `safe_effective_parallelism` = expected 3 despite requested 6 because several UI/API files overlap

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Brain workers accidentally mutate execution state | medium | critical | Type/API boundary; hard stop; state authority tests; read-only actor permissions |
| Evidence-free answers create false trust | medium | high | no-evidence/no-confident-answer guard; AnswerCard confidence display |
| Memory injection uses stale or disputed memories | medium | high | lifecycle-aware retrieval; injection report; conflict warnings |
| Dashboard duplication increases confusion | medium | medium | sidebar IA cleanup; canonical Memory and Proposal pages |
| Proposal generation becomes spammy | medium | medium | cooldown keys; dedupe; notification policy |
| Overnight UI encourages unsafe execution | low | critical | readiness-first UI; operator disabled by default; kernel gate required |
| UI/API file overlap causes merge conflicts | medium | medium | safe parallelism 3; integration queue; writeSet drift detection |
| E2E dogfood becomes flaky | medium | medium | deterministic fixtures; targeted validation; telemetry correlation |
| Worktree path escapes `.pi/worktrees` | low | critical | path scope checks; stop execution on escape |
| Integration queue merges unvalidated diff | low | high | require workspace validation and integration validation |
| Cleanup deletes wrong files | low | critical | raw destructive cleanup forbidden; scoped cleanup only |

---

## 7. Workstreams

### V5.00 — V5 Contract, Flags & Safety Doctrine

**Area:** `backend/core`  
**Batch:** `B0`  
**Queue priority:** `critical`  
**Depends on:** `none`

**Goal:** Define the V5 capability boundary, feature flags, shared types, and safety doctrine so every later workspace agrees that Brain V5 is advisory by default and never mutates execution state directly.

**Requirements:**
- Add V5 feature flags for read-only, advisory, push, drafting, and overnight operator readiness.
- Define shared Brain V5 domain types and mode enum.
- Add hard-stop constants for direct brain execution mutation, missing evidence, missing memory injection, unsafe overnight execution, and generated-plan execution without approval.
- Document the V5 doctrine in repo docs and expose it in dashboard mode labels.

**Acceptance Criteria:**
- BRAIN_V5_ENABLED, BRAIN_V5_READ_ONLY_MODE, BRAIN_V5_PUSH_ENABLED, BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false are represented in settings/config.
- Brain V5 code paths can determine OFF, READ_ONLY, ADVISORY, DRAFTING, and OPERATOR_READY states.
- Any direct execution-state mutation from brain modules is rejected or impossible by type/API boundary.
- The plan doctor can report that V5 is advisory unless operator gates pass.

**Isolation & Parallelism Notes:**
- Expected parallel group: `foundation`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/v5/**, packages/coding-agent/src/brain/types.ts, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts ...`.
- Rollback: Disable BRAIN_V5_ENABLED and remove the V5 route registration while keeping old brain pages untouched.

### V5.01 — Temporal Journal v2

**Area:** `backend/brain`  
**Batch:** `B1`  
**Queue priority:** `critical`  
**Depends on:** `V5.00`

**Goal:** Create daily, weekly, monthly, and entity-scoped temporal journals that answer what happened, what repeated, and what changed over time.

**Requirements:**
- Implement append/query storage for temporal events derived from existing brain timeline, execution journals, plan summaries, proposals, approvals, and validation results.
- Add rollup engine for day/week/month summaries.
- Add pattern extraction for repeated validation signatures, retry hotspots, dirty integration stalls, file hotspots, and plan quality trends.
- Expose read-only query APIs.

**Acceptance Criteria:**
- The system can answer 'what got stuck last week?' from stored temporal rollups.
- Temporal events include evidence references and stable entity IDs where possible.
- Rollups are deterministic and can be regenerated from source events.
- No private chain-of-thought is stored; only safe summaries and evidence-backed facts.

**Isolation & Parallelism Notes:**
- Expected parallel group: `data_foundation`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts`.
- Rollback: Disable temporal v2 route registration and fall back to existing /api/brain/timeline data.

### V5.02 — Evidence Index

**Area:** `backend/brain`  
**Batch:** `B1`  
**Queue priority:** `critical`  
**Depends on:** `V5.00`

**Goal:** Create a unified evidence index for git, execution, validation, memory, proposal, reflection, and user decision artifacts.

**Requirements:**
- Define EvidenceRef, EvidenceChain, EvidenceSourceType, and confidence contribution fields.
- Index evidence without treating raw logs or filesystem artifacts as runtime truth.
- Support querying evidence by entity, plan execution, workspace, signal, proposal, memory, and draft.
- Provide a no-evidence/no-confident-answer guard for Brain Query and Proposal generation.

**Acceptance Criteria:**
- Every Brain V5 answer, proposal, memory injection report, and draft can reference evidenceRefs.
- Evidence refs can point to git files, validation logs, execution journal events, memory records, proposals, reflections, and approvals.
- Missing evidence downgrades confidence or blocks confident claims.
- Evidence index is read-only with respect to execution state.

**Isolation & Parallelism Notes:**
- Expected parallel group: `data_foundation`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts`.
- Rollback: Disable evidence v2 lookups and return low-confidence responses until index rebuild is fixed.

### V5.03 — Memory Retrieval v2

**Area:** `backend/brain`  
**Batch:** `B2`  
**Queue priority:** `critical`  
**Depends on:** `V5.02`

**Goal:** Make memory useful during planning, proposals, query answers, and drafting through lifecycle-aware retrieval and ranking.

**Requirements:**
- Implement retrieval by query, entity, plan context, proposal context, and repo area.
- Respect lifecycle: active memories may influence decisions; expired, superseded, rejected, and disputed memories must be excluded or flagged.
- Return rank score, confidence, staleness, source quality, conflict warnings, and ignored-memory reasons.
- Avoid sensitive memory indexing without policy approval.

**Acceptance Criteria:**
- A retry-hotspot query retrieves relevant failure_memory records with source refs.
- Rejected/superseded memories cannot silently influence planning context.
- Retrieval output is stable enough to display in a UI report.
- The retrieval layer never writes memory by itself.

**Isolation & Parallelism Notes:**
- Expected parallel group: `memory_scanner`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/memory/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts`.
- Rollback: Fallback to existing memory search and mark generated plans as missing MemoryRetrievalReport.

### V5.04 — Context Builder & Memory Injection

**Area:** `backend/brain`  
**Batch:** `B3`  
**Queue priority:** `critical`  
**Depends on:** `V5.03`

**Goal:** Build the context pack used by query, proposal, draft, and plan generation, including memory injection reports and evidence packs.

**Requirements:**
- Implement BrainContextBuilder for temporal, evidence, memory, repo, policy, and user-request context.
- Implement MemoryInjector for generated plans, proposals, drafts, and answers.
- Persist or return MemoryInjectionReport with retrieved, injected, ignored, stale, disputed, and blocked memory entries.
- Make generated plan drafts invalid when no memory retrieval report is produced.

**Acceptance Criteria:**
- Generated plan drafts include memoryRetrievalReport, injectedMemoryIds, ignoredMemoryIds with reasons, and evidence pack summary.
- Injection does not bypass policy, conflict, or lifecycle rules.
- The injection report is renderable in dashboard Draft Studio and Memory UI.
- No generated content can claim memory support without included evidence refs.

**Isolation & Parallelism Notes:**
- Expected parallel group: `context_signal`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/context/**, packages/coding-agent/src/brain/memory/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/** ...`.
- Rollback: Disable V5 plan/draft generation and return a handoff explaining missing memory injection.

### V5.05 — Repo Scanner v2

**Area:** `backend/brain`  
**Batch:** `B2`  
**Queue priority:** `high`  
**Depends on:** `V5.02`

**Goal:** Convert repository history, diff, changed files, and failure correlations into actionable signals rather than raw file lists.

**Requirements:**
- Implement git-history scanner, diff-risk scanner, hotspot detector, failure correlator, and stale-plan-area detector.
- Compute file hotspots, module churn, large diff risk, conflict risk, test/coverage gaps where available, and validation failure correlation.
- Expose a project scan API and scan result artifact.
- Generate candidate signals and proposal seeds without executing changes.

**Acceptance Criteria:**
- 'Scan project' returns hotspots, risky diffs, failure correlations, stale plan areas, and proposal candidates.
- Scanner output is evidence-backed and safe to run read-only.
- Large diff and repeated failure correlations are represented as candidate signals.
- Scanner never calls git push or mutates repo state.

**Isolation & Parallelism Notes:**
- Expected parallel group: `memory_scanner`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/scanner/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts`.
- Rollback: Disable scanner routes and keep existing manual git/file views.

### V5.06 — Signal & Anomaly Engine

**Area:** `backend/brain`  
**Batch:** `B3`  
**Queue priority:** `critical`  
**Depends on:** `V5.01, V5.02, V5.05`

**Goal:** Turn temporal, evidence, scanner, validation, memory, and execution facts into deduplicated active signals.

**Requirements:**
- Implement signature grouping for repeated validation errors and retry hotspots.
- Implement anomaly rules for dirty integration stalls, large diff risk, memory conflict affecting plan generation, and plan quality drift.
- Add severity, confidence, cooldown key, evidence refs, related memories, and suggested next action.
- Keep all signals advisory unless approved through policy.

**Acceptance Criteria:**
- Repeated validation signature after threshold creates validation_repeat signal.
- A memory conflict that affects a proposal creates a decision-impact warning signal.
- Signals dedupe through cooldown keys and do not spam.
- Signals can feed proposals, push, overview, and Ask Pi answers.

**Isolation & Parallelism Notes:**
- Expected parallel group: `context_signal`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/signals/**, packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/scanner/**, packages/coding-agent/src/brain/v5/** ...`.
- Rollback: Disable V5 signal generation and display raw observations only.

### V5.07 — Brain Query API

**Area:** `backend/api`  
**Batch:** `B4`  
**Queue priority:** `critical`  
**Depends on:** `V5.01, V5.02, V5.03, V5.06`

**Goal:** Provide the tool-backed Ask Pi backend for temporal, memory, repo, execution, proposal, why, and next-action queries.

**Requirements:**
- Add POST /api/projects/:id/brain/query and supporting suggested-query/explain endpoints.
- Return answer, evidence, confidence, related memories, related signals, suggested action, and approval requirement.
- Support query routing across temporal journal, evidence index, memory retrieval, repo scan result, execution state, proposals, and reflections.
- Refuse or downgrade confident claims when evidence is absent.

**Acceptance Criteria:**
- Ask Pi can answer 'what got stuck most last week?' from temporal rollups.
- Ask Pi can answer 'why did this workspace retry?' from evidence, signals, and memory.
- Every answer contains evidenceRefs or an explicit insufficient-evidence explanation.
- Brain Query API does not mutate execution state.

**Isolation & Parallelism Notes:**
- Expected parallel group: `brain_engines`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-server/src/brain-v5-routes.ts, packages/web-server/src/index.ts, packages/coding-agent/src/brain/query/**, packages/coding-agent/src/brain/context/** ...`.
- Rollback: Disable /brain/query routes and keep existing chat endpoint.

### V5.08 — Proposal Engine v2

**Area:** `backend/brain`  
**Batch:** `B4`  
**Queue priority:** `critical`  
**Depends on:** `V5.04, V5.05, V5.06`

**Goal:** Upgrade proposals into evidence-backed action items with risk, expected impact, dedupe, cooldown, related memories, and draft status.

**Requirements:**
- Define ProposalV2 schema and migration/adapter for existing proposal UI/API.
- Generate proposals from signals, scanner output, reflection output, and user requests.
- Score proposals for risk, impact, urgency, confidence, memory support, and policy requirement.
- Deduplicate and cooldown similar proposals.

**Acceptance Criteria:**
- Proposal cards can explain problem, why now, evidence count, related memories, risk, expected impact, draft availability, and approval requirement.
- No proposal is marked execution-ready without user approval.
- Duplicate proposals are suppressed or marked duplicate.
- Proposal generation is advisory and cannot enqueue execution directly.

**Isolation & Parallelism Notes:**
- Expected parallel group: `brain_engines`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/proposals/**, packages/coding-agent/src/brain/context/**, packages/coding-agent/src/brain/signals/**, packages/web-server/src/brain-v5-routes.ts ...`.
- Rollback: Fallback to existing ProposalInbox and disable V2 proposal generation.

### V5.09 — Draft Generator v2

**Area:** `backend/brain`  
**Batch:** `B5`  
**Queue priority:** `critical`  
**Depends on:** `V5.04, V5.08`

**Goal:** Generate explanation, bugfix, phase-plan, validation, and rollback drafts from proposals using V4-compatible templates and memory injection.

**Requirements:**
- Implement draft domain model with draft type, source proposal, evidence refs, memory injection report, missing info, confidence, and approval state.
- Implement V4 phase plan draft adapter that preserves v3/v4 envelope and includes machine-readable contract preview.
- Add regenerate/edit/export/send-to-plan-intake workflows.
- Ensure draft generation never enqueues or executes by itself.

**Acceptance Criteria:**
- A selected proposal can produce explanation, bugfix, phase plan, validation plan, and rollback drafts.
- Every generated phase plan draft includes memory injection report and evidence chain.
- Drafts are persisted or exportable and can be sent to Plan Intake for validation.
- Generated plans require explicit approval before queueing.

**Isolation & Parallelism Notes:**
- Expected parallel group: `action_backends`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/drafts/**, packages/coding-agent/src/brain/plan-factory/**, packages/coding-agent/src/brain/context/**, packages/web-server/src/brain-v5-routes.ts ...`.
- Rollback: Disable Draft Studio backends and keep proposals as text-only advisory items.

### V5.10 — Reflection Loop v2

**Area:** `backend/brain`  
**Batch:** `B4`  
**Queue priority:** `high`  
**Depends on:** `V5.01, V5.02, V5.03, V5.08`

**Goal:** Convert completed runs into source-backed reflections, candidate memories, and future proposals.

**Requirements:**
- Implement reflection input builder from temporal journal, execution journal, validation results, workspace outcomes, integration state, evidence, and memories.
- Generate safe reflection reports: what changed, what worked, what failed, what slowed us down, what should be remembered, and what should be proposed next.
- Create memory candidates and proposal candidates without auto-activating or auto-executing risky actions.
- Integrate reflection output into temporal rollups and dashboard pages.

**Acceptance Criteria:**
- Post-run reflection can generate memory candidates and future proposals with source refs.
- Reflection claims are evidence-backed and include confidence.
- Rejected/corrected reflections are auditable.
- Reflection loop does not mark plans complete and does not mutate execution state.

**Isolation & Parallelism Notes:**
- Expected parallel group: `brain_engines`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/reflection/**, packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/evidence/**, packages/web-server/src/brain-v5-routes.ts`.
- Rollback: Disable reflection v2 and keep existing reflection reports read-only.

### V5.11 — Proactive Push & Pi Inbox Wiring

**Area:** `backend/api-ui-bridge`  
**Batch:** `B5`  
**Queue priority:** `high`  
**Depends on:** `V5.06, V5.08`

**Goal:** Route important signals and proposals to notifications, Pi Inbox, and digests without spam.

**Requirements:**
- Implement notification policy with severity, cooldown, routing, dedupe, and user preferences.
- Create inbox messages for critical signals, repeated validation failures, memory conflicts, approvals, and readiness blockers.
- Add digest integration for daily and morning summaries.
- Avoid push spam and preserve user control.

**Acceptance Criteria:**
- Repeated validation failure creates one actionable notification after threshold and respects cooldown.
- Each notification includes what happened, why it matters, evidence, suggested action, and auto-action status.
- Inbox and digest entries can be marked read/dismissed without deleting evidence.
- Push remains disabled unless BRAIN_V5_PUSH_ENABLED is true.

**Isolation & Parallelism Notes:**
- Expected parallel group: `action_backends`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/push/**, packages/coding-agent/src/brain/signals/**, packages/web-server/src/brain-v5-routes.ts, packages/web-server/src/index.ts ...`.
- Rollback: Disable Brain V5 push policy and keep inbox/digest existing behavior.

### V5.12 — Overnight Readiness & Approved Queue

**Area:** `backend/brain`  
**Batch:** `B5`  
**Queue priority:** `high`  
**Depends on:** `V5.08, V5.09, V5.11`

**Goal:** Implement safe overnight readiness, blocker analysis, approved queue preview, and morning report preview without unsafe autonomous execution.

**Requirements:**
- Implement Tonight Readiness checker for kernel status, approved plans, dirty integration, validation lanes, memory conflicts, budget, approvals, and stop conditions.
- Implement approved queue model that cannot run unapproved generated drafts.
- Generate morning report preview for planned overnight sessions.
- Block operator execution unless ExecutionKernel/stable gates pass and BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=true.

**Acceptance Criteria:**
- Dirty integration state blocks overnight readiness and creates a handoff/blocker item.
- Missing approval blocks queue execution but still shows why and how to fix.
- Morning report preview can be generated before the run.
- No actual overnight execution path is enabled by this workspace unless explicit operator gates pass.

**Isolation & Parallelism Notes:**
- Expected parallel group: `action_backends`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/src/brain/overnight/**, packages/coding-agent/src/brain/policy/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts`.
- Rollback: Disable Overnight V2 routes and keep existing overnight page read-only.

### V5.13 — Dashboard IA & Navigation Cleanup

**Area:** `dashboard/layout`  
**Batch:** `B1`  
**Queue priority:** `critical`  
**Depends on:** `V5.00`

**Goal:** Make Brain V5 first-class in the dashboard navigation while removing duplicate/confusing Proposal and Memory entry points.

**Requirements:**
- Restructure sidebar information architecture into Brain, Execution, and Platform sections.
- Merge duplicate proposal and memory entry points into single canonical pages with source tags.
- Add topbar Brain status: mode, signal count, approval count, Ask Pi button.
- Preserve navigation state and avoid breaking existing run/task/platform views.

**Acceptance Criteria:**
- The user can reach Overview, Ask Pi, Temporal Journal, Memory, Repo Scanner, Signals, Proposals, Drafts, Reflections, Overnight, and Trust from a consistent Brain section.
- P11/P19 duplicate Memory and Proposal entries no longer confuse the user.
- Topbar clearly distinguishes Brain OFF/READ_ONLY/ADVISORY/DRAFTING/OPERATOR_READY.
- Existing run view and project selection still work.

**Isolation & Parallelism Notes:**
- Expected parallel group: `data_foundation`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/App.tsx, packages/web-ui/dashboard/src/components/LeftNav.tsx, packages/web-ui/dashboard/src/components/sidebar/**, packages/web-ui/dashboard/src/components/topbar/** ...`.
- Rollback: Feature-flag the V5 navigation and restore existing Platform/Brain entries.

### V5.14 — Brain Overview / Command Center UI

**Area:** `dashboard/brain`  
**Batch:** `B6`  
**Queue priority:** `critical`  
**Depends on:** `V5.07, V5.08, V5.11, V5.13`

**Goal:** Create the default Brain V5 command center that summarizes today, this week, active signals, proposals, approvals, and overnight readiness.

**Requirements:**
- Build BrainOverviewPage with today/week cards, active signals, recommended next actions, proposal summary, approval summary, and readiness summary.
- Use hooks/API from temporal, query, proposals, push/inbox, and readiness backends.
- Include empty/loading/error states and evidence drawers where applicable.
- Make this the project-level Brain landing page.

**Acceptance Criteria:**
- Opening a project shows what Pi noticed today and what needs attention.
- The page answers at a glance: active risk, approvals needed, proposed next actions, and overnight readiness.
- Every recommendation can open evidence or Ask Pi explanation.
- The overview works when backend data is empty.

**Isolation & Parallelism Notes:**
- Expected parallel group: `primary_ui`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx, packages/web-ui/dashboard/src/components/brain/overview/**, packages/web-ui/dashboard/src/hooks/useBrainOverview.ts, packages/web-ui/dashboard/src/api/brain.ts ...`.
- Rollback: Hide BrainOverviewPage behind feature flag and route to existing BrainStatePage.

### V5.15 — Ask Pi UI & Evidence Drawer

**Area:** `dashboard/brain`  
**Batch:** `B6`  
**Queue priority:** `critical`  
**Depends on:** `V5.07, V5.13`

**Goal:** Create the conversational brain interface with answer cards, confidence, evidence refs, related memories, and suggested actions.

**Requirements:**
- Build BrainQueryPanel, BrainAnswerCard, suggested question chips, query history, and evidence drawer.
- Integrate with POST /brain/query and explain endpoints.
- Distinguish general chat from Ask Pi / Brain Query mode.
- Support queries about temporal patterns, retries, proposals, memory support, overnight readiness, and current brain activity.

**Acceptance Criteria:**
- The user can ask 'What got stuck most this week?' and receive an evidence-backed answer card.
- The user can ask 'Why did workspace X retry?' and see evidence, confidence, related memories, and suggested actions.
- No answer presents confident claims without evidence or an explicit uncertainty note.
- Evidence Drawer is reusable across Brain pages.

**Isolation & Parallelism Notes:**
- Expected parallel group: `primary_ui`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/components/brain/query/**, packages/web-ui/dashboard/src/components/brain/evidence/**, packages/web-ui/dashboard/src/hooks/useBrainQuery.ts, packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts ...`.
- Rollback: Disable Ask Pi route and keep existing ChatPanel unchanged.

### V5.16 — Temporal, Memory & Repo Scanner Pages

**Area:** `dashboard/brain`  
**Batch:** `B6`  
**Queue priority:** `high`  
**Depends on:** `V5.01, V5.03, V5.04, V5.05, V5.13`

**Goal:** Expose Temporal Journal, Memory V2, and Repo Scanner pages with actionable views and injection/retrieval reports.

**Requirements:**
- Build Temporal Journal day/week/month/entity views.
- Build Memory V2 tabs: Records, Retrieval, Injection, Conflicts, Staleness, Provenance.
- Build Repo Scanner page: scan button, hotspot table, diff risk panel, failure correlation panel, and proposal candidates.
- Integrate shared evidence drawer and loading/error/empty states.

**Acceptance Criteria:**
- Temporal page shows daily/weekly/monthly rollups and pattern tables.
- Memory page can show retrieval and injection reports with ignored/stale/conflict reasons.
- Repo Scanner page can run a scan and display hotspots, diff risk, failure correlations, and proposal candidates.
- All pages behave safely when APIs return no data.

**Isolation & Parallelism Notes:**
- Expected parallel group: `primary_ui`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx, packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx, packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx, packages/web-ui/dashboard/src/components/brain/temporal/** ...`.
- Rollback: Feature-flag new pages and fall back to existing BrainMemoryPage/BrainStatePage.

### V5.17 — Proposal Inbox v2 & Draft Studio

**Area:** `dashboard/brain`  
**Batch:** `B7`  
**Queue priority:** `critical`  
**Depends on:** `V5.08, V5.09, V5.13`

**Goal:** Upgrade Proposal Inbox and add Draft Studio for reviewing evidence-backed proposals and generated drafts before approval.

**Requirements:**
- Upgrade proposal cards with problem, why now, evidence count, related memories, risk, impact, draft availability, approval requirement, cooldown/duplicate status.
- Add actions: approve, reject, correct, defer, mark duplicate, explain why, show evidence, generate draft.
- Build Draft Studio tabs for Explanation, Bugfix Draft, Phase Plan Draft, Validation Plan, and Rollback Plan.
- Show MemoryInjectionPanel and PlanContractPreview.

**Acceptance Criteria:**
- A proposal can generate drafts but cannot execute or enqueue without explicit approval.
- Draft Studio shows evidence, memories used, safety checks, missing info, and plan contract preview.
- Export markdown and send-to-plan-intake flows are available.
- Reject/correct actions create auditable feedback.

**Isolation & Parallelism Notes:**
- Expected parallel group: `action_ui`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/features/proposal-inbox/**, packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx, packages/web-ui/dashboard/src/components/brain/drafts/**, packages/web-ui/dashboard/src/components/brain/proposals/** ...`.
- Rollback: Hide Draft Studio and preserve existing ProposalInbox behavior.

### V5.18 — Run View Brain Context, Brain Stream & Trust UI

**Area:** `dashboard/execution-brain`  
**Batch:** `B7`  
**Queue priority:** `high`  
**Depends on:** `V5.06, V5.10, V5.11, V5.12, V5.13`

**Goal:** Connect Brain V5 to the live execution dashboard through context strips, safe brain stream, right-sidebar tabs, and Trust & Approvals center.

**Requirements:**
- Add Brain Context Strip to run view with relevant memories, active risks, similar past failures, generated suggestions, and confidence.
- Add WorkerDetail Brain tab for related memories, retry explanation, failure signature, suggested fix, and proposal creation.
- Add right sidebar tabs: Live, Brain, Inbox.
- Add BrainStreamPanel showing safe event summaries, not private chain-of-thought.
- Upgrade Trust & Approvals center with pending approvals, policy decisions, forbidden actions, audit trail, memory conflicts, kernel readiness, emergency stop, and overnight readiness blockers.

**Acceptance Criteria:**
- Execution run view surfaces relevant brain context without leaving the run.
- Validation failure can trigger explain failure, find similar failures, generate bugfix draft, and create proposal actions.
- Brain stream shows safe event summaries such as scanning, signal created, memory retrieved, proposal drafted, waiting for approval.
- Trust UI clearly shows what is auto-allowed, approval-required, or blocked.

**Isolation & Parallelism Notes:**
- Expected parallel group: `action_ui`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/web-ui/dashboard/src/App.tsx, packages/web-ui/dashboard/src/components/WorkerDetail.tsx, packages/web-ui/dashboard/src/components/right-sidebar/**, packages/web-ui/dashboard/src/components/brain/stream/** ...`.
- Rollback: Feature-flag Brain Context Strip and right-sidebar Brain tab; preserve existing run view.

### V5.19 — E2E Dogfood, Telemetry, Docs & Regression

**Area:** `cross-cutting`  
**Batch:** `B8`  
**Queue priority:** `critical`  
**Depends on:** `V5.14, V5.15, V5.16, V5.17, V5.18`

**Goal:** Prove the complete Brain Reality Layer through end-to-end dogfood, regression tests, telemetry correlation, docs, and demo scripts.

**Requirements:**
- Create E2E dogfood gauntlet covering temporal QA, retry explanation, memory injection, repo scanner, push, draft, reflection, overnight readiness, brain stream, and state mutation safety.
- Add API/UI integration tests and fixtures.
- Add telemetry events and correlation from telemetry event to diagnostic packet to brain signal to proposal.
- Write user-facing docs and operator guide.
- Record final validation report and known limitations.

**Acceptance Criteria:**
- The demo question 'What got stuck most last week and what should we do tonight?' works end-to-end.
- Repo scan creates hotspots, risk, signals, and proposal candidates.
- Proposal generates draft with memory injection report and evidence chain.
- Overnight readiness blocks unsafe execution and creates blockers/handoff.
- Run view explains workspace risk and retry reasons.
- Reflection creates memory candidates and future proposals.
- Automated tests prove Brain modules cannot mutate execution state directly.

**Isolation & Parallelism Notes:**
- Expected parallel group: `dogfood`.
- Requires worktree isolation because the phase runs in strict V4 mode.
- Integration queue merge is required after targeted validation.
- Known write scope: `packages/coding-agent/test/**, packages/web-server/test/**, packages/web-ui/dashboard/src/**/*.test.*, docs/pi/v5/** ...`.
- Rollback: Disable BRAIN_V5_ENABLED and keep generated reports/docs for debugging.


---

## 8. Combined Implementation Order

### Batch Preview

### B0

- V5.00 — V5 Contract, Flags & Safety Doctrine

### B1

- V5.01 — Temporal Journal v2
- V5.02 — Evidence Index
- V5.13 — Dashboard IA & Navigation Cleanup

### B2

- V5.03 — Memory Retrieval v2
- V5.05 — Repo Scanner v2

### B3

- V5.04 — Context Builder & Memory Injection
- V5.06 — Signal & Anomaly Engine

### B4

- V5.07 — Brain Query API
- V5.08 — Proposal Engine v2
- V5.10 — Reflection Loop v2

### B5

- V5.09 — Draft Generator v2
- V5.11 — Proactive Push & Pi Inbox Wiring
- V5.12 — Overnight Readiness & Approved Queue

### B6

- V5.14 — Brain Overview / Command Center UI
- V5.15 — Ask Pi UI & Evidence Drawer
- V5.16 — Temporal, Memory & Repo Scanner Pages

### B7

- V5.17 — Proposal Inbox v2 & Draft Studio
- V5.18 — Run View Brain Context, Brain Stream & Trust UI

### B8

- V5.19 — E2E Dogfood, Telemetry, Docs & Regression

### Critical Paths

```text
Primary:
V5.00 -> V5.02 -> V5.03 -> V5.04 -> V5.08 -> V5.09 -> V5.17 -> V5.19

Secondary:
V5.00 -> V5.01 -> V5.06 -> V5.07 -> V5.15 -> V5.19

Dashboard:
V5.00 -> V5.13 -> V5.14 -> V5.18 -> V5.19
```

### Workspace Dependency Table

| ID | Workspace | Batch | Area | Depends on | Priority |
|---|---|---|---|---|---|
| V5.00 | V5 Contract, Flags & Safety Doctrine | B0 | backend/core | — | critical |
| V5.01 | Temporal Journal v2 | B1 | backend/brain | V5.00 | critical |
| V5.02 | Evidence Index | B1 | backend/brain | V5.00 | critical |
| V5.03 | Memory Retrieval v2 | B2 | backend/brain | V5.02 | critical |
| V5.04 | Context Builder & Memory Injection | B3 | backend/brain | V5.03 | critical |
| V5.05 | Repo Scanner v2 | B2 | backend/brain | V5.02 | high |
| V5.06 | Signal & Anomaly Engine | B3 | backend/brain | V5.01, V5.02, V5.05 | critical |
| V5.07 | Brain Query API | B4 | backend/api | V5.01, V5.02, V5.03, V5.06 | critical |
| V5.08 | Proposal Engine v2 | B4 | backend/brain | V5.04, V5.05, V5.06 | critical |
| V5.09 | Draft Generator v2 | B5 | backend/brain | V5.04, V5.08 | critical |
| V5.10 | Reflection Loop v2 | B4 | backend/brain | V5.01, V5.02, V5.03, V5.08 | high |
| V5.11 | Proactive Push & Pi Inbox Wiring | B5 | backend/api-ui-bridge | V5.06, V5.08 | high |
| V5.12 | Overnight Readiness & Approved Queue | B5 | backend/brain | V5.08, V5.09, V5.11 | high |
| V5.13 | Dashboard IA & Navigation Cleanup | B1 | dashboard/layout | V5.00 | critical |
| V5.14 | Brain Overview / Command Center UI | B6 | dashboard/brain | V5.07, V5.08, V5.11, V5.13 | critical |
| V5.15 | Ask Pi UI & Evidence Drawer | B6 | dashboard/brain | V5.07, V5.13 | critical |
| V5.16 | Temporal, Memory & Repo Scanner Pages | B6 | dashboard/brain | V5.01, V5.03, V5.04, V5.05, V5.13 | high |
| V5.17 | Proposal Inbox v2 & Draft Studio | B7 | dashboard/brain | V5.08, V5.09, V5.13 | critical |
| V5.18 | Run View Brain Context, Brain Stream & Trust UI | B7 | dashboard/execution-brain | V5.06, V5.10, V5.11, V5.12, V5.13 | high |
| V5.19 | E2E Dogfood, Telemetry, Docs & Regression | B8 | cross-cutting | V5.14, V5.15, V5.16, V5.17, V5.18 | critical |

### Safe Parallelism Notes

Requested max workers is 6, but expected safe effective parallelism is 3. The DAG exposes several 2-3 wide batches, but dashboard/API files overlap heavily:

```text
packages/web-ui/dashboard/src/api/brain.ts
packages/web-ui/dashboard/src/types-brain-v5.ts
packages/web-server/src/brain-v5-routes.ts
packages/web-ui/dashboard/src/App.tsx
packages/web-ui/dashboard/src/components/sidebar/**
packages/web-ui/dashboard/src/features/proposal-inbox/**
```

The scheduler may reduce effective parallelism when writeSet overlap, validation lane pressure, integration queue order, or worktree readiness requires it.

---

## 9. Definition of Done

P-V5 is complete when ALL are true:

- Brain V5 flags and safety doctrine are implemented.
- Temporal Journal v2 can answer day/week/month and entity questions.
- Evidence Index backs every confident answer, proposal, draft, signal, and memory injection report.
- Memory Retrieval and Injection are mandatory for generated plans and drafts.
- Repo Scanner v2 produces actionable signals and proposal candidates.
- Ask Pi returns evidence-backed answers with confidence and suggested actions.
- Proposal Engine v2 and Draft Generator v2 are approval-gated and do not auto-execute.
- Reflection Loop v2 creates source-backed memory candidates and future proposals.
- Proactive Push routes high-value signals without spam.
- Overnight v2 provides readiness and approved queue preview while blocking unsafe execution.
- Dashboard exposes Brain Overview, Ask Pi, Temporal, Memory, Repo Scanner, Proposals, Draft Studio, Brain Stream, Trust, and Run Context.
- E2E dogfood and regression tests pass.
- No Brain worker can mutate execution state directly.
- DAG batch preview has been reviewed.
- Safe batch preview has been reviewed.
- Selected scale mode readiness passes.
- Worktree isolation is active for stable_6.
- Integration queue is clean or intentionally blocked with handoff.
- No forbidden commands or files were used.
- Typecheck/build/test requirements pass.

---

## 10. Rollback Playbook

**Trigger conditions:**

- Brain module mutates or can mutate execution state directly.
- Ask Pi produces confident answer without evidence.
- Generated plan lacks memory retrieval/injection report.
- Overnight readiness allows unsafe execution.
- Proposal engine auto-enqueues or executes generated work.
- Dashboard replaces existing execution monitoring in a breaking way.
- Worktree creation or cleanup behaves unsafely.
- Integration queue merges incorrect or unvalidated diffs.
- Safe scale mode causes resource exhaustion or state corruption.

**Rollback procedure:**

1. Set `BRAIN_V5_ENABLED=false`.
2. Set `BRAIN_V5_PUSH_ENABLED=false`.
3. Set `BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false`.
4. Hide V5 dashboard routes and restore existing BrainState/Memory/Reflections/Overnight pages.
5. Disable `/api/projects/:id/brain/query`, repo scanner, draft generator, and readiness endpoints.
6. Preserve V5 reports and artifacts under `reports/pv5-brain-reality-layer/`.
7. Preserve `.pi/worktrees/{planExecId}/` for debugging if worktree output exists.
8. Revert V5 commits by workspace if needed.
9. Keep existing V2/P19 brain pages read-only until replacement is fixed.

---

## 11. What Next Phase Inherits

The next phase inherits:

- Brain V5 feature flags and safety doctrine.
- Temporal Journal v2.
- Evidence Index.
- Memory Retrieval and Injection reports.
- Ask Pi / Brain Query API.
- Repo Scanner v2.
- Signal and anomaly engine.
- Proposal Engine v2.
- Draft Generator v2 with V4 plan adapter.
- Reflection Loop v2.
- Proactive Push and Pi Inbox wiring.
- Overnight readiness and approved queue preview.
- Brain Reality Console dashboard surfaces.
- E2E dogfood gauntlet and telemetry correlation.
- V4 ExecutionKernel-compatible boundaries.

The next phase may add stronger operator mode, remote/cloud sandbox execution, deeper plan optimization, long-horizon roadmap proposals, richer governance controls, and multi-project intelligence.

---

# Part 2 — Agent Brief

## Mission

Implement **P-V5 — Brain Reality Layer** in English, using the V4 ExecutionKernel and intent-driven execution contract. The mission is to make Pi's brain real in daily use: temporal awareness, evidence-backed answers, memory retrieval/injection, repo scanning, proposals, drafts, proactive notifications, reflection, overnight readiness, and dashboard visibility.

The agent must optimize for correctness, safety, provenance, and user trust. The goal is not blind autonomy. The goal is an evidence-backed, approval-gated cognitive partner.

## Hard Requirements

1. Preserve the v4 ExecutionKernel doctrine: brain workers and diagnostics are read-only/advisory for execution state.
2. No Brain V5 module may directly mutate attempt state, plan lifecycle state, queue state, policy state, or approval state.
3. Every confident Brain answer, proposal, signal, draft, and memory injection report must include evidence refs.
4. Generated plans and drafts must include memory retrieval/injection reports.
5. Generated plans must not auto-execute or auto-enqueue without explicit approval.
6. Overnight V2 must be readiness-first and operator-disabled by default.
7. Proactive Push must deduplicate and cooldown notifications.
8. The dashboard must make safety/control visible: OFF, READ_ONLY, ADVISORY, DRAFTING, OPERATOR_READY.
9. Existing dashboard run/task/platform workflows must remain functional.
10. Do not exceed selected scale-mode worker cap.
11. Do not merge workspace output without passed workspace validation.
12. Do not mark a plan complete if integration validation fails.
13. Do not start the next plan while integration queue state is dirty.
14. Do not run watch-mode validation.
15. Do not run `git push`.
16. Do not run raw destructive cleanup commands.
17. Do not access secrets or forbidden files.
18. If queue optimization is enabled, the queue must respect workspace-level `queuePriority`.
19. Queue optimization must not bypass validation or approval.
20. Priority-based reordering must not starve lower-priority workspaces.

## Execution Policies

```yaml
execution_automation:
  autonomous_execution_enabled: true
  requires_v4_admission_gate_pass: true
  requires_execution_kernel_stable: true
  agent_may_mutate_repo: true
  agent_may_run_commands: true
  generated_plans_require_explicit_approval: true
  overnight_operator_enabled_by_default: false

bounded_liveness:
  no_indefinite_waits: true
  llm_provider_timeout_required: true
  llm_stream_idle_watchdog_required: true
  validation_timeout_required: true
  process_tree_kill_required: true
  git_lock_bypass_forbidden: true
  state_write_serialization_required: true

scale:
  selected_mode: stable_6
  requested_max_parallel_workspaces: 6
  expected_dag_effective_parallelism: 3
  expected_safe_effective_parallelism: 3
  worktree_required: true
  integration_queue_required: true
  validation_lock_required: true

brain_v5:
  default_mode: advisory
  read_only_mode_supported: true
  direct_execution_state_mutation: forbidden
  generated_plan_execution: approval_required
  evidence_required_for_confident_answer: true
  memory_injection_required_for_generated_plan: true
  proactive_push_default: configurable
  overnight_operator_default: false
```

## Safety Stops

Hard stop execution for:

- `brain_direct_execution_state_mutation`
- `generated_plan_execution_without_explicit_approval`
- `overnight_operator_without_execution_kernel_stable`
- `memory_injection_missing_for_generated_plan`
- `evidence_missing_for_confident_answer`
- `llm_call_without_provider_timeout`
- `llm_stream_without_idle_watchdog`
- `validation_command_without_timeout`
- `validation_process_without_process_group`
- `validation_watch_or_dev_server_command`
- `git_lock_bypass_detected`
- `state_store_write_without_serialization`
- `dependency_cycles`
- `invalid_dependency_patches`
- `required_preflight_review_not_approved`
- `stale_approved_graph_hash`
- `worktree_path_escape`
- `raw_destructive_worktree_cleanup`
- `integration_merge_without_passed_workspace_validation`
- `integration_validation_failure`
- `merge_conflict_without_handoff_artifact`
- `unsafe_scale_mode`
- `queue_starting_next_plan_while_integration_queue_dirty`
- `forbidden_file_access`
- `secrets_access`
- `git_push`
- `watch_mode_validation_command`

---

# Part 2.5 — V4 ExecutionKernel Doctrine

## 2.5.1 Single Authority Model

V5 implements brain capabilities on top of the V4 single-authority model:

```text
All actors emit events.
WorkspaceAttemptController mutates attempt state.
PlanSupervisor mutates plan state.
PostgreSQL stores authoritative runtime truth.
Brain workers diagnose and propose only.
```

Brain modules may read events, snapshots, memories, evidence, repo state, proposals, and reflections. They may emit evidence packets, signals, proposals, drafts, and handoff recommendations. They may not mutate attempt state, create attempts directly, mark a plan complete, mark a workspace failed, bypass admission, or bypass approval.

## 2.5.2 Attempt and Plan State Boundary

The Brain Reality Layer must treat execution state as read-only. It may explain state but not author it. Any action that could modify runtime state must go through the existing V4 admission gate and controller-mediated path.

## 2.5.3 Evidence and Memory Doctrine

Raw logs are evidence, not truth. Memories are operating knowledge only when lifecycle and policy allow them. V5 must distinguish:

```text
Raw evidence
Derived memory
Operating belief
Generated proposal
Generated draft
Approved execution item
```

Only approved execution items may reach execution queues.

## 2.5.4 Dashboard Control Doctrine

The dashboard must make all control boundaries visible:

```text
Auto-run allowed
Approval required
Blocked by policy
Blocked by low confidence
Blocked by dirty integration state
Blocked by missing kernel readiness
```

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "4.0.0",
  "templateVersion": "4.0.0",
  "legacyCompatibility": {
    "v3EnvelopePreserved": true,
    "legacyValidatorMode": "v3_compatible_extensions",
    "fallbackContractVersionForLegacyParser": "3.0.0",
    "legacyMechanismFieldsAreHints": true,
    "unknownV4FieldsPolicy": "ignore_for_read_only_legacy_consumers_reject_for_execution_without_v4_validator"
  },
  "executionClass": "implementation",
  "executionBackend": "postgres",
  "project": {
    "name": "Pi Monorepo",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "brain-v5",
      "dashboard",
      "second-brain",
      "execution-kernel-compatible"
    ]
  },
  "intent": {
    "parallelism": 6,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": {
      "mode": "trusted_local",
      "untrustedCodeAllowed": false,
      "networkPolicy": "host_default",
      "secretsPolicy": "forbidden_files_and_env_allowlist"
    },
    "deadlines": {
      "llmRequestMs": 120000,
      "llmStreamIdleMs": 300000,
      "workspaceOverallMs": 1800000,
      "validationDefaultMs": 600000,
      "validationHeavyMs": 1200000,
      "schedulerNoProgressMs": 300000
    },
    "productIntent": {
      "brainModeDefault": "advisory",
      "overnightOperatorDefault": false,
      "generatedPlansRequireApproval": true,
      "directExecutionStateMutationByBrain": "forbidden"
    }
  },
  "derivedExecutionProfile": {
    "generatedBy": "ExecutionProfileDeriver",
    "deriverVersion": "4.0.0",
    "readOnly": false,
    "worktreeRequired": true,
    "integrationQueueRequired": true,
    "gitRunnerQueueRequired": true,
    "validationLanesRequired": true,
    "attemptScopedArtifactsRequired": true,
    "deadlineWatchdogRequired": true,
    "admissionGateMode": "strict",
    "writeSetDriftPolicy": "warn_and_flag_integration",
    "explain": [
      "strict safety level requires admission gate, event journal, and bounded liveness",
      "high conflict risk requires worktree isolation, integration queue, GitRunner queue, and writeSet drift detection",
      "dashboard/API overlap means requested parallelism is 6 but safe effective parallelism is expected to be 3",
      "Brain workers remain read-only/advisory for execution state"
    ]
  },
  "persistence": {
    "authoritativeBackend": "postgres",
    "jsonRuntimeFallbackAllowed": false,
    "eventJournalBackend": "postgres",
    "transitionBackend": "postgres",
    "controllerInboxBackend": "postgres",
    "handoffQueueBackend": "postgres",
    "rawLogsBackend": "filesystem",
    "artifactIndexBackend": "postgres",
    "debugExportAllowed": true
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": true,
    "agentMayMutateRepo": true,
    "agentMayRunCommands": true,
    "manualPatchApplicationRequired": false,
    "humanApprovalRequiredForEveryPatch": false,
    "requiresV4AdmissionGatePass": true,
    "requiresExecutionKernelStable": true
  },
  "executionKernel": {
    "enabled": true,
    "stateAuthority": "workspace_attempt_controller",
    "planAuthority": "plan_supervisor",
    "stateAuthorityTokenRequired": true,
    "admissionGateRequired": true,
    "eventSourcedAttempts": true,
    "attemptEventJournalRequired": true,
    "directStateMutationForbidden": true,
    "actorsEmitEventsOnly": true,
    "policiesSuggestOnly": true,
    "brainWorkersReadOnly": true,
    "retryRequiresTerminalAttempt": true,
    "everyNonTerminalStateHasDeadline": true,
    "controllerSerializesDecisionsNotWork": true,
    "controllerLeadership": {
      "required": true,
      "mode": "postgres_advisory_lock_plus_expected_version",
      "transitionRequiresExpectedVersion": true,
      "onVersionConflict": "reject_and_emit_controller_conflict"
    }
  },
  "attemptLifecycle": {
    "initialState": "queued",
    "terminalStates": [
      "succeeded",
      "failed_retryable",
      "failed_final",
      "aborted",
      "timed_out",
      "quarantined",
      "handoff_required"
    ],
    "nonTerminalStates": [
      "queued",
      "leasing_worktree",
      "running",
      "validating",
      "waiting_for_validation_lane",
      "integration_queued",
      "integrating",
      "aborting",
      "killing_process_tree",
      "stale"
    ],
    "retryableTerminalStates": [
      "failed_retryable",
      "timed_out",
      "quarantined"
    ],
    "retryForbiddenFromNonTerminal": true,
    "deadlineRequiredForNonTerminalStates": true,
    "handoffRequiredCreatesQueueItem": true
  },
  "planLifecycle": {
    "completionPredicateRequired": true,
    "cannotCompleteWithRequiredNonTerminalWorkspaces": true,
    "cannotCompleteWithUnresolvedRequiredHandoff": true,
    "finalValidationRequiredBeforeCompleted": true,
    "states": [
      "created",
      "preflight",
      "running",
      "blocked_with_reason",
      "awaiting_handoff",
      "final_validation",
      "completed",
      "completed_with_warnings",
      "failed_final",
      "stopping",
      "stopped"
    ]
  },
  "actorPermissions": {
    "workspaceAttemptController": {
      "mayMutateAttemptState": true,
      "mayCreateRetryAttempt": true
    },
    "planSupervisor": {
      "mayMutatePlanState": true,
      "mayReserveSchedulerSlots": true
    },
    "executorActor": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "validationActor": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "gitRunner": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "leaseMonitor": {
      "mayMutateAttemptState": false,
      "mayEmitEvents": true
    },
    "retryPolicy": {
      "mayMutateAttemptState": false,
      "mayCreateRetryAttempt": false,
      "maySuggestRetry": true
    },
    "brainWorkers": {
      "mayMutateExecutionState": false,
      "mayEmitDiagnosis": true,
      "mayProposeAction": true
    },
    "diagnostics": {
      "mayMutateExecutionState": false,
      "mayEmitEvidence": true
    }
  },
  "admissionGate": {
    "required": true,
    "allEntrypointsMustUseGate": true,
    "coveredEntrypoints": [
      "cli_plan_run",
      "dashboard_run",
      "api_plan_run",
      "retry_endpoint",
      "cleanup_rerun_endpoint",
      "brain_worker_trigger",
      "overnight_runner",
      "proposal_executor"
    ],
    "rejectWhen": [
      "postgres_unavailable_for_authoritative_runtime",
      "json_runtime_fallback_detected",
      "unsafe_parallelism_requested",
      "execution_kernel_disabled",
      "state_authority_not_single",
      "brain_worker_direct_mutation_detected",
      "generated_plan_execution_without_explicit_approval",
      "overnight_operator_requested_without_stable_kernel"
    ]
  },
  "resourceCoordination": {
    "nestedLocksForbidden": true,
    "holdLockAcrossAwaitForbidden": true,
    "stateLocks": {
      "scope": "attempt",
      "maxHoldMs": 1000
    },
    "planLock": {
      "scope": "plan",
      "maxHoldMs": 1000,
      "purpose": "slot_reservation_only"
    },
    "gitRunner": {
      "mode": "queue",
      "repoMutationTimeoutMs": 60000,
      "lockBypassForbidden": true
    },
    "validationLanes": {
      "heavy": {
        "maxConcurrent": 1
      },
      "targeted": {
        "maxConcurrent": 3
      }
    },
    "worktreeLeases": {
      "attemptScoped": true,
      "heartbeatRequired": true,
      "quarantineOnStale": true
    },
    "stateStore": {
      "writesThroughControllerOnly": true,
      "transactionOrWriteQueueRequired": true
    }
  },
  "deadlineWatchdog": {
    "required": true,
    "intervalSeconds": 15,
    "emitsEventsOnly": true,
    "eventType": "deadline_exceeded",
    "supervised": true,
    "onWatchdogUnavailable": "block_new_execution_or_downgrade"
  },
  "handoffQueue": {
    "required": true,
    "createdByStates": [
      "handoff_required"
    ],
    "allowedActions": [
      "retry_requested",
      "close_failed",
      "manual_resolution",
      "followup_plan_requested"
    ],
    "controllerMediatedRetryRequired": true
  },
  "legacyMigration": {
    "enabled": true,
    "strategy": "strangler_fig",
    "phases": [
      "M0_shadow",
      "M1_compatibility_adapter",
      "M2_actor_conversion",
      "M3_enforcement",
      "M4_cleanup"
    ],
    "dualAuthorityForbidden": true,
    "legacyWritesEmitAuditEvents": true,
    "legacyMechanismFieldsAreHints": true
  },
  "planExecution": {
    "phase": "P-V5",
    "title": "Brain Reality Layer",
    "mode": "v4_implementation",
    "maxParallelWorkspaces": 6,
    "expectedDagEffectiveParallelism": 3,
    "expectedSafeEffectiveParallelism": 3,
    "scheduling": {
      "continuous": true,
      "slotCount": 6,
      "priorityStrategy": "critical_path_first"
    },
    "stateBackend": "postgres",
    "jsonFallbackEnabled": false,
    "dashboardEnabled": true,
    "autoCommit": false,
    "autoPush": false,
    "scale": {
      "defaultMode": "stable_6",
      "selectedMode": "stable_6",
      "modes": {
        "stable_3": {
          "maxParallelWorkspaces": 3,
          "worktreeRequired": false,
          "integrationQueueRequired": false
        },
        "stable_6": {
          "maxParallelWorkspaces": 6,
          "worktreeRequired": true,
          "integrationQueueRequired": true,
          "validationLockRequired": true,
          "archiveRequired": true,
          "completionGateRequired": true,
          "executionKernelRequired": true
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
        "strategy": "critical_path_first",
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
      "persistApprovedGraph": true
    },
    "planIntake": {
      "enabled": true,
      "runOnUpload": true,
      "parserPriority": [
        "part3_json",
        "contractVersion_and_executionClass",
        "v4_admission_gate",
        "execution_kernel_gate",
        "bounded_liveness",
        "doctor",
        "execution_gate"
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
    },
    "batchPreview": {
      "B0": [
        "V5.00"
      ],
      "B1": [
        "V5.01",
        "V5.02",
        "V5.13"
      ],
      "B2": [
        "V5.03",
        "V5.05"
      ],
      "B3": [
        "V5.04",
        "V5.06"
      ],
      "B4": [
        "V5.07",
        "V5.08",
        "V5.10"
      ],
      "B5": [
        "V5.09",
        "V5.11",
        "V5.12"
      ],
      "B6": [
        "V5.14",
        "V5.15",
        "V5.16"
      ],
      "B7": [
        "V5.17",
        "V5.18"
      ],
      "B8": [
        "V5.19"
      ]
    },
    "criticalPaths": [
      [
        "V5.00",
        "V5.02",
        "V5.03",
        "V5.04",
        "V5.08",
        "V5.09",
        "V5.17",
        "V5.19"
      ],
      [
        "V5.00",
        "V5.01",
        "V5.06",
        "V5.07",
        "V5.15",
        "V5.19"
      ],
      [
        "V5.00",
        "V5.13",
        "V5.14",
        "V5.18",
        "V5.19"
      ]
    ]
  },
  "workspaces": [
    {
      "id": "V5.00",
      "title": "V5 Contract, Flags & Safety Doctrine",
      "required": true,
      "batch": "B0",
      "parallelGroup": "foundation",
      "dependencies": [],
      "hardDeps": [],
      "softDeps": [],
      "canRunWith": [],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/core",
      "goal": "Define the V5 capability boundary, feature flags, shared types, and safety doctrine so every later workspace agrees that Brain V5 is advisory by default and never mutates execution state directly.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/v5/**",
        "packages/coding-agent/src/brain/types.ts",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts",
        "docs/pi/v5/**"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/v5/**",
        "packages/coding-agent/src/brain/types.ts",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts",
        "docs/pi/v5/**"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/v5/**",
          "packages/coding-agent/src/brain/types.ts",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "docs/pi/v5/**"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- brain-v5-safety"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable BRAIN_V5_ENABLED and remove the V5 route registration while keeping old brain pages untouched.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "BRAIN_V5_ENABLED, BRAIN_V5_READ_ONLY_MODE, BRAIN_V5_PUSH_ENABLED, BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false are represented in settings/config.",
        "Brain V5 code paths can determine OFF, READ_ONLY, ADVISORY, DRAFTING, and OPERATOR_READY states.",
        "Any direct execution-state mutation from brain modules is rejected or impossible by type/API boundary.",
        "The plan doctor can report that V5 is advisory unless operator gates pass."
      ],
      "description": "Define the V5 capability boundary, feature flags, shared types, and safety doctrine so every later workspace agrees that Brain V5 is advisory by default and never mutates execution state directly.",
      "dependencyReason": "Foundation workspace with no dependencies.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/v5/**",
          "packages/coding-agent/src/brain/types.ts",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "docs/pi/v5/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B0 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/v5/**",
          "packages/coding-agent/src/brain/types.ts",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "docs/pi/v5/**"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-v5-safety",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/v5/**",
          "packages/coding-agent/src/brain/types.ts",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "docs/pi/v5/**"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-v5-safety",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.00 — V5 Contract, Flags & Safety Doctrine.\nGoal: Define the V5 capability boundary, feature flags, shared types, and safety doctrine so every later workspace agrees that Brain V5 is advisory by default and never mutates execution state directly.\nAllowed files: packages/coding-agent/src/brain/v5/**, packages/coding-agent/src/brain/types.ts, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts, docs/pi/v5/**\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: BRAIN_V5_ENABLED, BRAIN_V5_READ_ONLY_MODE, BRAIN_V5_PUSH_ENABLED, BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false are represented in settings/config.; Brain V5 code paths can determine OFF, READ_ONLY, ADVISORY, DRAFTING, and OPERATOR_READY states.; Any direct execution-state mutation from brain modules is rejected or impossible by type/API boundary.; The plan doctor can report that V5 is advisory unless operator gates pass.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.01",
      "title": "Temporal Journal v2",
      "required": true,
      "batch": "B1",
      "parallelGroup": "data_foundation",
      "dependencies": [
        "V5.00"
      ],
      "hardDeps": [
        "V5.00"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.02",
        "V5.13"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Create daily, weekly, monthly, and entity-scoped temporal journals that answer what happened, what repeated, and what changed over time.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- temporal"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable temporal v2 route registration and fall back to existing /api/brain/timeline data.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "The system can answer 'what got stuck last week?' from stored temporal rollups.",
        "Temporal events include evidence references and stable entity IDs where possible.",
        "Rollups are deterministic and can be regenerated from source events.",
        "No private chain-of-thought is stored; only safe summaries and evidence-backed facts."
      ],
      "description": "Create daily, weekly, monthly, and entity-scoped temporal journals that answer what happened, what repeated, and what changed over time.",
      "dependencyReason": "Depends on V5.00 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "V5.02",
          "V5.13"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B1 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- temporal",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- temporal",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.01 — Temporal Journal v2.\nGoal: Create daily, weekly, monthly, and entity-scoped temporal journals that answer what happened, what repeated, and what changed over time.\nAllowed files: packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: The system can answer 'what got stuck last week?' from stored temporal rollups.; Temporal events include evidence references and stable entity IDs where possible.; Rollups are deterministic and can be regenerated from source events.; No private chain-of-thought is stored; only safe summaries and evidence-backed facts.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.02",
      "title": "Evidence Index",
      "required": true,
      "batch": "B1",
      "parallelGroup": "data_foundation",
      "dependencies": [
        "V5.00"
      ],
      "hardDeps": [
        "V5.00"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.01",
        "V5.13"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Create a unified evidence index for git, execution, validation, memory, proposal, reflection, and user decision artifacts.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- evidence"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable evidence v2 lookups and return low-confidence responses until index rebuild is fixed.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Every Brain V5 answer, proposal, memory injection report, and draft can reference evidenceRefs.",
        "Evidence refs can point to git files, validation logs, execution journal events, memory records, proposals, reflections, and approvals.",
        "Missing evidence downgrades confidence or blocks confident claims.",
        "Evidence index is read-only with respect to execution state."
      ],
      "description": "Create a unified evidence index for git, execution, validation, memory, proposal, reflection, and user decision artifacts.",
      "dependencyReason": "Depends on V5.00 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "V5.01",
          "V5.13"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B1 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- evidence",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- evidence",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.02 — Evidence Index.\nGoal: Create a unified evidence index for git, execution, validation, memory, proposal, reflection, and user decision artifacts.\nAllowed files: packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Every Brain V5 answer, proposal, memory injection report, and draft can reference evidenceRefs.; Evidence refs can point to git files, validation logs, execution journal events, memory records, proposals, reflections, and approvals.; Missing evidence downgrades confidence or blocks confident claims.; Evidence index is read-only with respect to execution state.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.03",
      "title": "Memory Retrieval v2",
      "required": true,
      "batch": "B2",
      "parallelGroup": "memory_scanner",
      "dependencies": [
        "V5.02"
      ],
      "hardDeps": [
        "V5.02"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.05"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Make memory useful during planning, proposals, query answers, and drafting through lifecycle-aware retrieval and ranking.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/memory/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/memory/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- memory-retrieval"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Fallback to existing memory search and mark generated plans as missing MemoryRetrievalReport.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "A retry-hotspot query retrieves relevant failure_memory records with source refs.",
        "Rejected/superseded memories cannot silently influence planning context.",
        "Retrieval output is stable enough to display in a UI report.",
        "The retrieval layer never writes memory by itself."
      ],
      "description": "Make memory useful during planning, proposals, query answers, and drafting through lifecycle-aware retrieval and ranking.",
      "dependencyReason": "Depends on V5.02 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "V5.05"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B2 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- memory-retrieval",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- memory-retrieval",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.03 — Memory Retrieval v2.\nGoal: Make memory useful during planning, proposals, query answers, and drafting through lifecycle-aware retrieval and ranking.\nAllowed files: packages/coding-agent/src/brain/memory/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: A retry-hotspot query retrieves relevant failure_memory records with source refs.; Rejected/superseded memories cannot silently influence planning context.; Retrieval output is stable enough to display in a UI report.; The retrieval layer never writes memory by itself.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.04",
      "title": "Context Builder & Memory Injection",
      "required": true,
      "batch": "B3",
      "parallelGroup": "context_signal",
      "dependencies": [
        "V5.03"
      ],
      "hardDeps": [
        "V5.03"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.06"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Build the context pack used by query, proposal, draft, and plan generation, including memory injection reports and evidence packs.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/context/**",
        "packages/coding-agent/src/brain/memory/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/context/**",
        "packages/coding-agent/src/brain/memory/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- memory-injection"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable V5 plan/draft generation and return a handoff explaining missing memory injection.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Generated plan drafts include memoryRetrievalReport, injectedMemoryIds, ignoredMemoryIds with reasons, and evidence pack summary.",
        "Injection does not bypass policy, conflict, or lifecycle rules.",
        "The injection report is renderable in dashboard Draft Studio and Memory UI.",
        "No generated content can claim memory support without included evidence refs."
      ],
      "description": "Build the context pack used by query, proposal, draft, and plan generation, including memory injection reports and evidence packs.",
      "dependencyReason": "Depends on V5.03 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "V5.06"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B3 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- memory-injection",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/memory/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- memory-injection",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.04 — Context Builder & Memory Injection.\nGoal: Build the context pack used by query, proposal, draft, and plan generation, including memory injection reports and evidence packs.\nAllowed files: packages/coding-agent/src/brain/context/**, packages/coding-agent/src/brain/memory/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Generated plan drafts include memoryRetrievalReport, injectedMemoryIds, ignoredMemoryIds with reasons, and evidence pack summary.; Injection does not bypass policy, conflict, or lifecycle rules.; The injection report is renderable in dashboard Draft Studio and Memory UI.; No generated content can claim memory support without included evidence refs.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.05",
      "title": "Repo Scanner v2",
      "required": true,
      "batch": "B2",
      "parallelGroup": "memory_scanner",
      "dependencies": [
        "V5.02"
      ],
      "hardDeps": [
        "V5.02"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.03"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Convert repository history, diff, changed files, and failure correlations into actionable signals rather than raw file lists.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/scanner/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/scanner/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- repo-scanner"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable scanner routes and keep existing manual git/file views.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "'Scan project' returns hotspots, risky diffs, failure correlations, stale plan areas, and proposal candidates.",
        "Scanner output is evidence-backed and safe to run read-only.",
        "Large diff and repeated failure correlations are represented as candidate signals.",
        "Scanner never calls git push or mutates repo state."
      ],
      "description": "Convert repository history, diff, changed files, and failure correlations into actionable signals rather than raw file lists.",
      "dependencyReason": "Depends on V5.02 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "V5.03"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B2 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- repo-scanner",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- repo-scanner",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.05 — Repo Scanner v2.\nGoal: Convert repository history, diff, changed files, and failure correlations into actionable signals rather than raw file lists.\nAllowed files: packages/coding-agent/src/brain/scanner/**, packages/coding-agent/src/brain/evidence/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: 'Scan project' returns hotspots, risky diffs, failure correlations, stale plan areas, and proposal candidates.; Scanner output is evidence-backed and safe to run read-only.; Large diff and repeated failure correlations are represented as candidate signals.; Scanner never calls git push or mutates repo state.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.06",
      "title": "Signal & Anomaly Engine",
      "required": true,
      "batch": "B3",
      "parallelGroup": "context_signal",
      "dependencies": [
        "V5.01",
        "V5.02",
        "V5.05"
      ],
      "hardDeps": [
        "V5.01",
        "V5.02",
        "V5.05"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.04"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Turn temporal, evidence, scanner, validation, memory, and execution facts into deduplicated active signals.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/signals/**",
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/scanner/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/signals/**",
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/scanner/**",
        "packages/coding-agent/src/brain/v5/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/signals/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- signals"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable V5 signal generation and display raw observations only.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Repeated validation signature after threshold creates validation_repeat signal.",
        "A memory conflict that affects a proposal creates a decision-impact warning signal.",
        "Signals dedupe through cooldown keys and do not spam.",
        "Signals can feed proposals, push, overview, and Ask Pi answers."
      ],
      "description": "Turn temporal, evidence, scanner, validation, memory, and execution facts into deduplicated active signals.",
      "dependencyReason": "Depends on V5.01, V5.02, V5.05 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "V5.04"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/signals/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B3 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/signals/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- signals",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/signals/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/scanner/**",
          "packages/coding-agent/src/brain/v5/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- signals",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.06 — Signal & Anomaly Engine.\nGoal: Turn temporal, evidence, scanner, validation, memory, and execution facts into deduplicated active signals.\nAllowed files: packages/coding-agent/src/brain/signals/**, packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/scanner/**, packages/coding-agent/src/brain/v5/**, packages/web-server/src/brain-v5-routes.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Repeated validation signature after threshold creates validation_repeat signal.; A memory conflict that affects a proposal creates a decision-impact warning signal.; Signals dedupe through cooldown keys and do not spam.; Signals can feed proposals, push, overview, and Ask Pi answers.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.07",
      "title": "Brain Query API",
      "required": true,
      "batch": "B4",
      "parallelGroup": "brain_engines",
      "dependencies": [
        "V5.01",
        "V5.02",
        "V5.03",
        "V5.06"
      ],
      "hardDeps": [
        "V5.01",
        "V5.02",
        "V5.03",
        "V5.06"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.08",
        "V5.10"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/api",
      "goal": "Provide the tool-backed Ask Pi backend for temporal, memory, repo, execution, proposal, why, and next-action queries.",
      "allowedFiles": [
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-server/src/index.ts",
        "packages/coding-agent/src/brain/query/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-server/src/index.ts",
        "packages/coding-agent/src/brain/query/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/coding-agent/src/brain/query/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- brain-query"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable /brain/query routes and keep existing chat endpoint.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Ask Pi can answer 'what got stuck most last week?' from temporal rollups.",
        "Ask Pi can answer 'why did this workspace retry?' from evidence, signals, and memory.",
        "Every answer contains evidenceRefs or an explicit insufficient-evidence explanation.",
        "Brain Query API does not mutate execution state."
      ],
      "description": "Provide the tool-backed Ask Pi backend for temporal, memory, repo, execution, proposal, why, and next-action queries.",
      "dependencyReason": "Depends on V5.01, V5.02, V5.03, V5.06 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [
          "V5.08",
          "V5.10"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/coding-agent/src/brain/query/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B4 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/coding-agent/src/brain/query/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-query",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/coding-agent/src/brain/query/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-query",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.07 — Brain Query API.\nGoal: Provide the tool-backed Ask Pi backend for temporal, memory, repo, execution, proposal, why, and next-action queries.\nAllowed files: packages/web-server/src/brain-v5-routes.ts, packages/web-server/src/index.ts, packages/coding-agent/src/brain/query/**, packages/coding-agent/src/brain/context/**, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Ask Pi can answer 'what got stuck most last week?' from temporal rollups.; Ask Pi can answer 'why did this workspace retry?' from evidence, signals, and memory.; Every answer contains evidenceRefs or an explicit insufficient-evidence explanation.; Brain Query API does not mutate execution state.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.08",
      "title": "Proposal Engine v2",
      "required": true,
      "batch": "B4",
      "parallelGroup": "brain_engines",
      "dependencies": [
        "V5.04",
        "V5.05",
        "V5.06"
      ],
      "hardDeps": [
        "V5.04",
        "V5.05",
        "V5.06"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.07",
        "V5.10"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Upgrade proposals into evidence-backed action items with risk, expected impact, dedupe, cooldown, related memories, and draft status.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/proposals/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/coding-agent/src/brain/signals/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/proposals/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/coding-agent/src/brain/signals/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/proposals/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- proposals"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Fallback to existing ProposalInbox and disable V2 proposal generation.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Proposal cards can explain problem, why now, evidence count, related memories, risk, expected impact, draft availability, and approval requirement.",
        "No proposal is marked execution-ready without user approval.",
        "Duplicate proposals are suppressed or marked duplicate.",
        "Proposal generation is advisory and cannot enqueue execution directly."
      ],
      "description": "Upgrade proposals into evidence-backed action items with risk, expected impact, dedupe, cooldown, related memories, and draft status.",
      "dependencyReason": "Depends on V5.04, V5.05, V5.06 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [
          "V5.07",
          "V5.10"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/proposals/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B4 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/proposals/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- proposals",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/proposals/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- proposals",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.08 — Proposal Engine v2.\nGoal: Upgrade proposals into evidence-backed action items with risk, expected impact, dedupe, cooldown, related memories, and draft status.\nAllowed files: packages/coding-agent/src/brain/proposals/**, packages/coding-agent/src/brain/context/**, packages/coding-agent/src/brain/signals/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Proposal cards can explain problem, why now, evidence count, related memories, risk, expected impact, draft availability, and approval requirement.; No proposal is marked execution-ready without user approval.; Duplicate proposals are suppressed or marked duplicate.; Proposal generation is advisory and cannot enqueue execution directly.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.09",
      "title": "Draft Generator v2",
      "required": true,
      "batch": "B5",
      "parallelGroup": "action_backends",
      "dependencies": [
        "V5.04",
        "V5.08"
      ],
      "hardDeps": [
        "V5.04",
        "V5.08"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.11",
        "V5.12"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Generate explanation, bugfix, phase-plan, validation, and rollback drafts from proposals using V4-compatible templates and memory injection.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/drafts/**",
        "packages/coding-agent/src/brain/plan-factory/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/drafts/**",
        "packages/coding-agent/src/brain/plan-factory/**",
        "packages/coding-agent/src/brain/context/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/drafts/**",
          "packages/coding-agent/src/brain/plan-factory/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- drafts"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable Draft Studio backends and keep proposals as text-only advisory items.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "A selected proposal can produce explanation, bugfix, phase plan, validation plan, and rollback drafts.",
        "Every generated phase plan draft includes memory injection report and evidence chain.",
        "Drafts are persisted or exportable and can be sent to Plan Intake for validation.",
        "Generated plans require explicit approval before queueing."
      ],
      "description": "Generate explanation, bugfix, phase-plan, validation, and rollback drafts from proposals using V4-compatible templates and memory injection.",
      "dependencyReason": "Depends on V5.04, V5.08 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [
          "V5.11",
          "V5.12"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/drafts/**",
          "packages/coding-agent/src/brain/plan-factory/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B5 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/drafts/**",
          "packages/coding-agent/src/brain/plan-factory/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- drafts",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/drafts/**",
          "packages/coding-agent/src/brain/plan-factory/**",
          "packages/coding-agent/src/brain/context/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- drafts",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.09 — Draft Generator v2.\nGoal: Generate explanation, bugfix, phase-plan, validation, and rollback drafts from proposals using V4-compatible templates and memory injection.\nAllowed files: packages/coding-agent/src/brain/drafts/**, packages/coding-agent/src/brain/plan-factory/**, packages/coding-agent/src/brain/context/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: A selected proposal can produce explanation, bugfix, phase plan, validation plan, and rollback drafts.; Every generated phase plan draft includes memory injection report and evidence chain.; Drafts are persisted or exportable and can be sent to Plan Intake for validation.; Generated plans require explicit approval before queueing.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.10",
      "title": "Reflection Loop v2",
      "required": true,
      "batch": "B4",
      "parallelGroup": "brain_engines",
      "dependencies": [
        "V5.01",
        "V5.02",
        "V5.03",
        "V5.08"
      ],
      "hardDeps": [
        "V5.01",
        "V5.02",
        "V5.03",
        "V5.08"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.07",
        "V5.08"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Convert completed runs into source-backed reflections, candidate memories, and future proposals.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/reflection/**",
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/reflection/**",
        "packages/coding-agent/src/brain/temporal/**",
        "packages/coding-agent/src/brain/evidence/**",
        "packages/web-server/src/brain-v5-routes.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/reflection/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- reflection"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable reflection v2 and keep existing reflection reports read-only.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Post-run reflection can generate memory candidates and future proposals with source refs.",
        "Reflection claims are evidence-backed and include confidence.",
        "Rejected/corrected reflections are auditable.",
        "Reflection loop does not mark plans complete and does not mutate execution state."
      ],
      "description": "Convert completed runs into source-backed reflections, candidate memories, and future proposals.",
      "dependencyReason": "Depends on V5.01, V5.02, V5.03, V5.08 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [
          "V5.07",
          "V5.08"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/reflection/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B4 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/reflection/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- reflection",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/reflection/**",
          "packages/coding-agent/src/brain/temporal/**",
          "packages/coding-agent/src/brain/evidence/**",
          "packages/web-server/src/brain-v5-routes.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- reflection",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.10 — Reflection Loop v2.\nGoal: Convert completed runs into source-backed reflections, candidate memories, and future proposals.\nAllowed files: packages/coding-agent/src/brain/reflection/**, packages/coding-agent/src/brain/temporal/**, packages/coding-agent/src/brain/evidence/**, packages/web-server/src/brain-v5-routes.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Post-run reflection can generate memory candidates and future proposals with source refs.; Reflection claims are evidence-backed and include confidence.; Rejected/corrected reflections are auditable.; Reflection loop does not mark plans complete and does not mutate execution state.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.11",
      "title": "Proactive Push & Pi Inbox Wiring",
      "required": true,
      "batch": "B5",
      "parallelGroup": "action_backends",
      "dependencies": [
        "V5.06",
        "V5.08"
      ],
      "hardDeps": [
        "V5.06",
        "V5.08"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.09",
        "V5.12"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/api-ui-bridge",
      "goal": "Route important signals and proposals to notifications, Pi Inbox, and digests without spam.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/push/**",
        "packages/coding-agent/src/brain/signals/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-server/src/index.ts",
        "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/push/**",
        "packages/coding-agent/src/brain/signals/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-server/src/index.ts",
        "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/push/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- push"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable Brain V5 push policy and keep inbox/digest existing behavior.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Repeated validation failure creates one actionable notification after threshold and respects cooldown.",
        "Each notification includes what happened, why it matters, evidence, suggested action, and auto-action status.",
        "Inbox and digest entries can be marked read/dismissed without deleting evidence.",
        "Push remains disabled unless BRAIN_V5_PUSH_ENABLED is true."
      ],
      "description": "Route important signals and proposals to notifications, Pi Inbox, and digests without spam.",
      "dependencyReason": "Depends on V5.06, V5.08 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [
          "V5.09",
          "V5.12"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/push/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B5 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/push/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- push",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/push/**",
          "packages/coding-agent/src/brain/signals/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-server/src/index.ts",
          "packages/web-ui/dashboard/src/hooks/usePiInbox.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- push",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.11 — Proactive Push & Pi Inbox Wiring.\nGoal: Route important signals and proposals to notifications, Pi Inbox, and digests without spam.\nAllowed files: packages/coding-agent/src/brain/push/**, packages/coding-agent/src/brain/signals/**, packages/web-server/src/brain-v5-routes.ts, packages/web-server/src/index.ts, packages/web-ui/dashboard/src/hooks/usePiInbox.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Repeated validation failure creates one actionable notification after threshold and respects cooldown.; Each notification includes what happened, why it matters, evidence, suggested action, and auto-action status.; Inbox and digest entries can be marked read/dismissed without deleting evidence.; Push remains disabled unless BRAIN_V5_PUSH_ENABLED is true.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.12",
      "title": "Overnight Readiness & Approved Queue",
      "required": true,
      "batch": "B5",
      "parallelGroup": "action_backends",
      "dependencies": [
        "V5.08",
        "V5.09",
        "V5.11"
      ],
      "hardDeps": [
        "V5.08",
        "V5.09",
        "V5.11"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.09",
        "V5.11"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "backend/brain",
      "goal": "Implement safe overnight readiness, blocker analysis, approved queue preview, and morning report preview without unsafe autonomous execution.",
      "allowedFiles": [
        "packages/coding-agent/src/brain/overnight/**",
        "packages/coding-agent/src/brain/policy/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/src/brain/overnight/**",
        "packages/coding-agent/src/brain/policy/**",
        "packages/web-server/src/brain-v5-routes.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/src/brain/overnight/**",
          "packages/coding-agent/src/brain/policy/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- overnight-readiness"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable Overnight V2 routes and keep existing overnight page read-only.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Dirty integration state blocks overnight readiness and creates a handoff/blocker item.",
        "Missing approval blocks queue execution but still shows why and how to fix.",
        "Morning report preview can be generated before the run.",
        "No actual overnight execution path is enabled by this workspace unless explicit operator gates pass."
      ],
      "description": "Implement safe overnight readiness, blocker analysis, approved queue preview, and morning report preview without unsafe autonomous execution.",
      "dependencyReason": "Depends on V5.08, V5.09, V5.11 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [
          "V5.09",
          "V5.11"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/brain/overnight/**",
          "packages/coding-agent/src/brain/policy/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B5 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/brain/overnight/**",
          "packages/coding-agent/src/brain/policy/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- overnight-readiness",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/src/brain/overnight/**",
          "packages/coding-agent/src/brain/policy/**",
          "packages/web-server/src/brain-v5-routes.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- overnight-readiness",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.12 — Overnight Readiness & Approved Queue.\nGoal: Implement safe overnight readiness, blocker analysis, approved queue preview, and morning report preview without unsafe autonomous execution.\nAllowed files: packages/coding-agent/src/brain/overnight/**, packages/coding-agent/src/brain/policy/**, packages/web-server/src/brain-v5-routes.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Dirty integration state blocks overnight readiness and creates a handoff/blocker item.; Missing approval blocks queue execution but still shows why and how to fix.; Morning report preview can be generated before the run.; No actual overnight execution path is enabled by this workspace unless explicit operator gates pass.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.13",
      "title": "Dashboard IA & Navigation Cleanup",
      "required": true,
      "batch": "B1",
      "parallelGroup": "data_foundation",
      "dependencies": [
        "V5.00"
      ],
      "hardDeps": [
        "V5.00"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.01",
        "V5.02"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/layout",
      "goal": "Make Brain V5 first-class in the dashboard navigation while removing duplicate/confusing Proposal and Memory entry points.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/LeftNav.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/**",
        "packages/web-ui/dashboard/src/components/topbar/**",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/LeftNav.tsx",
        "packages/web-ui/dashboard/src/components/sidebar/**",
        "packages/web-ui/dashboard/src/components/topbar/**",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/components/sidebar/**",
          "packages/web-ui/dashboard/src/components/topbar/**",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- dashboard-navigation"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Feature-flag the V5 navigation and restore existing Platform/Brain entries.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "The user can reach Overview, Ask Pi, Temporal Journal, Memory, Repo Scanner, Signals, Proposals, Drafts, Reflections, Overnight, and Trust from a consistent Brain section.",
        "P11/P19 duplicate Memory and Proposal entries no longer confuse the user.",
        "Topbar clearly distinguishes Brain OFF/READ_ONLY/ADVISORY/DRAFTING/OPERATOR_READY.",
        "Existing run view and project selection still work."
      ],
      "description": "Make Brain V5 first-class in the dashboard navigation while removing duplicate/confusing Proposal and Memory entry points.",
      "dependencyReason": "Depends on V5.00 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "V5.01",
          "V5.02"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/components/sidebar/**",
          "packages/web-ui/dashboard/src/components/topbar/**",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B1 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/components/sidebar/**",
          "packages/web-ui/dashboard/src/components/topbar/**",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- dashboard-navigation",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/components/sidebar/**",
          "packages/web-ui/dashboard/src/components/topbar/**",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- dashboard-navigation",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.13 — Dashboard IA & Navigation Cleanup.\nGoal: Make Brain V5 first-class in the dashboard navigation while removing duplicate/confusing Proposal and Memory entry points.\nAllowed files: packages/web-ui/dashboard/src/App.tsx, packages/web-ui/dashboard/src/components/LeftNav.tsx, packages/web-ui/dashboard/src/components/sidebar/**, packages/web-ui/dashboard/src/components/topbar/**, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: The user can reach Overview, Ask Pi, Temporal Journal, Memory, Repo Scanner, Signals, Proposals, Drafts, Reflections, Overnight, and Trust from a consistent Brain section.; P11/P19 duplicate Memory and Proposal entries no longer confuse the user.; Topbar clearly distinguishes Brain OFF/READ_ONLY/ADVISORY/DRAFTING/OPERATOR_READY.; Existing run view and project selection still work.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.14",
      "title": "Brain Overview / Command Center UI",
      "required": true,
      "batch": "B6",
      "parallelGroup": "primary_ui",
      "dependencies": [
        "V5.07",
        "V5.08",
        "V5.11",
        "V5.13"
      ],
      "hardDeps": [
        "V5.07",
        "V5.08",
        "V5.11",
        "V5.13"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.15",
        "V5.16"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/brain",
      "goal": "Create the default Brain V5 command center that summarizes today, this week, active signals, proposals, approvals, and overnight readiness.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/overview/**",
        "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/overview/**",
        "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/overview/**",
          "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- brain-overview"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Hide BrainOverviewPage behind feature flag and route to existing BrainStatePage.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Opening a project shows what Pi noticed today and what needs attention.",
        "The page answers at a glance: active risk, approvals needed, proposed next actions, and overnight readiness.",
        "Every recommendation can open evidence or Ask Pi explanation.",
        "The overview works when backend data is empty."
      ],
      "description": "Create the default Brain V5 command center that summarizes today, this week, active signals, proposals, approvals, and overnight readiness.",
      "dependencyReason": "Depends on V5.07, V5.08, V5.11, V5.13 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_7",
        "canRunWith": [
          "V5.15",
          "V5.16"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/overview/**",
          "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B6 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/overview/**",
          "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-overview",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/overview/**",
          "packages/web-ui/dashboard/src/hooks/useBrainOverview.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-overview",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.14 — Brain Overview / Command Center UI.\nGoal: Create the default Brain V5 command center that summarizes today, this week, active signals, proposals, approvals, and overnight readiness.\nAllowed files: packages/web-ui/dashboard/src/pages/BrainOverviewPage.tsx, packages/web-ui/dashboard/src/components/brain/overview/**, packages/web-ui/dashboard/src/hooks/useBrainOverview.ts, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Opening a project shows what Pi noticed today and what needs attention.; The page answers at a glance: active risk, approvals needed, proposed next actions, and overnight readiness.; Every recommendation can open evidence or Ask Pi explanation.; The overview works when backend data is empty.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.15",
      "title": "Ask Pi UI & Evidence Drawer",
      "required": true,
      "batch": "B6",
      "parallelGroup": "primary_ui",
      "dependencies": [
        "V5.07",
        "V5.13"
      ],
      "hardDeps": [
        "V5.07",
        "V5.13"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.14",
        "V5.16"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/brain",
      "goal": "Create the conversational brain interface with answer cards, confidence, evidence refs, related memories, and suggested actions.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/components/brain/query/**",
        "packages/web-ui/dashboard/src/components/brain/evidence/**",
        "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
        "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/components/brain/query/**",
        "packages/web-ui/dashboard/src/components/brain/evidence/**",
        "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
        "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/components/brain/query/**",
          "packages/web-ui/dashboard/src/components/brain/evidence/**",
          "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
          "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- ask-pi"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable Ask Pi route and keep existing ChatPanel unchanged.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "The user can ask 'What got stuck most this week?' and receive an evidence-backed answer card.",
        "The user can ask 'Why did workspace X retry?' and see evidence, confidence, related memories, and suggested actions.",
        "No answer presents confident claims without evidence or an explicit uncertainty note.",
        "Evidence Drawer is reusable across Brain pages."
      ],
      "description": "Create the conversational brain interface with answer cards, confidence, evidence refs, related memories, and suggested actions.",
      "dependencyReason": "Depends on V5.07, V5.13 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_7",
        "canRunWith": [
          "V5.14",
          "V5.16"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/components/brain/query/**",
          "packages/web-ui/dashboard/src/components/brain/evidence/**",
          "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
          "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B6 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/brain/query/**",
          "packages/web-ui/dashboard/src/components/brain/evidence/**",
          "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
          "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- ask-pi",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/components/brain/query/**",
          "packages/web-ui/dashboard/src/components/brain/evidence/**",
          "packages/web-ui/dashboard/src/hooks/useBrainQuery.ts",
          "packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- ask-pi",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.15 — Ask Pi UI & Evidence Drawer.\nGoal: Create the conversational brain interface with answer cards, confidence, evidence refs, related memories, and suggested actions.\nAllowed files: packages/web-ui/dashboard/src/components/brain/query/**, packages/web-ui/dashboard/src/components/brain/evidence/**, packages/web-ui/dashboard/src/hooks/useBrainQuery.ts, packages/web-ui/dashboard/src/hooks/useEvidenceRefs.ts, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: The user can ask 'What got stuck most this week?' and receive an evidence-backed answer card.; The user can ask 'Why did workspace X retry?' and see evidence, confidence, related memories, and suggested actions.; No answer presents confident claims without evidence or an explicit uncertainty note.; Evidence Drawer is reusable across Brain pages.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.16",
      "title": "Temporal, Memory & Repo Scanner Pages",
      "required": true,
      "batch": "B6",
      "parallelGroup": "primary_ui",
      "dependencies": [
        "V5.01",
        "V5.03",
        "V5.04",
        "V5.05",
        "V5.13"
      ],
      "hardDeps": [
        "V5.01",
        "V5.03",
        "V5.04",
        "V5.05",
        "V5.13"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.14",
        "V5.15"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/brain",
      "goal": "Expose Temporal Journal, Memory V2, and Repo Scanner pages with actionable views and injection/retrieval reports.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
        "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
        "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/temporal/**",
        "packages/web-ui/dashboard/src/components/brain/memory/**",
        "packages/web-ui/dashboard/src/components/brain/scanner/**",
        "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
        "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
        "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
        "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
        "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/temporal/**",
        "packages/web-ui/dashboard/src/components/brain/memory/**",
        "packages/web-ui/dashboard/src/components/brain/scanner/**",
        "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
        "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
        "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/temporal/**",
          "packages/web-ui/dashboard/src/components/brain/memory/**",
          "packages/web-ui/dashboard/src/components/brain/scanner/**",
          "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
          "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
          "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- brain-pages"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Feature-flag new pages and fall back to existing BrainMemoryPage/BrainStatePage.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Temporal page shows daily/weekly/monthly rollups and pattern tables.",
        "Memory page can show retrieval and injection reports with ignored/stale/conflict reasons.",
        "Repo Scanner page can run a scan and display hotspots, diff risk, failure correlations, and proposal candidates.",
        "All pages behave safely when APIs return no data."
      ],
      "description": "Expose Temporal Journal, Memory V2, and Repo Scanner pages with actionable views and injection/retrieval reports.",
      "dependencyReason": "Depends on V5.01, V5.03, V5.04, V5.05, V5.13 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_7",
        "canRunWith": [
          "V5.14",
          "V5.15"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/temporal/**",
          "packages/web-ui/dashboard/src/components/brain/memory/**",
          "packages/web-ui/dashboard/src/components/brain/scanner/**",
          "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
          "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
          "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B6 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/temporal/**",
          "packages/web-ui/dashboard/src/components/brain/memory/**",
          "packages/web-ui/dashboard/src/components/brain/scanner/**",
          "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
          "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
          "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-pages",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx",
          "packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/temporal/**",
          "packages/web-ui/dashboard/src/components/brain/memory/**",
          "packages/web-ui/dashboard/src/components/brain/scanner/**",
          "packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts",
          "packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts",
          "packages/web-ui/dashboard/src/hooks/useRepoScanner.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-pages",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.16 — Temporal, Memory & Repo Scanner Pages.\nGoal: Expose Temporal Journal, Memory V2, and Repo Scanner pages with actionable views and injection/retrieval reports.\nAllowed files: packages/web-ui/dashboard/src/pages/BrainTemporalPage.tsx, packages/web-ui/dashboard/src/pages/BrainMemoryPage.tsx, packages/web-ui/dashboard/src/pages/BrainRepoScannerPage.tsx, packages/web-ui/dashboard/src/components/brain/temporal/**, packages/web-ui/dashboard/src/components/brain/memory/**, packages/web-ui/dashboard/src/components/brain/scanner/**, packages/web-ui/dashboard/src/hooks/useTemporalJournal.ts, packages/web-ui/dashboard/src/hooks/useMemoryInjection.ts, packages/web-ui/dashboard/src/hooks/useRepoScanner.ts, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Temporal page shows daily/weekly/monthly rollups and pattern tables.; Memory page can show retrieval and injection reports with ignored/stale/conflict reasons.; Repo Scanner page can run a scan and display hotspots, diff risk, failure correlations, and proposal candidates.; All pages behave safely when APIs return no data.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.17",
      "title": "Proposal Inbox v2 & Draft Studio",
      "required": true,
      "batch": "B7",
      "parallelGroup": "action_ui",
      "dependencies": [
        "V5.08",
        "V5.09",
        "V5.13"
      ],
      "hardDeps": [
        "V5.08",
        "V5.09",
        "V5.13"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.18"
      ],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/brain",
      "goal": "Upgrade Proposal Inbox and add Draft Studio for reviewing evidence-backed proposals and generated drafts before approval.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/proposal-inbox/**",
        "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/drafts/**",
        "packages/web-ui/dashboard/src/components/brain/proposals/**",
        "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
        "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/features/proposal-inbox/**",
        "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
        "packages/web-ui/dashboard/src/components/brain/drafts/**",
        "packages/web-ui/dashboard/src/components/brain/proposals/**",
        "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
        "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/features/proposal-inbox/**",
          "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/drafts/**",
          "packages/web-ui/dashboard/src/components/brain/proposals/**",
          "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
          "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- proposal-draft-ui"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Hide Draft Studio and preserve existing ProposalInbox behavior.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "A proposal can generate drafts but cannot execute or enqueue without explicit approval.",
        "Draft Studio shows evidence, memories used, safety checks, missing info, and plan contract preview.",
        "Export markdown and send-to-plan-intake flows are available.",
        "Reject/correct actions create auditable feedback."
      ],
      "description": "Upgrade Proposal Inbox and add Draft Studio for reviewing evidence-backed proposals and generated drafts before approval.",
      "dependencyReason": "Depends on V5.08, V5.09, V5.13 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_8",
        "canRunWith": [
          "V5.18"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/proposal-inbox/**",
          "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/drafts/**",
          "packages/web-ui/dashboard/src/components/brain/proposals/**",
          "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
          "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B7 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/proposal-inbox/**",
          "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/drafts/**",
          "packages/web-ui/dashboard/src/components/brain/proposals/**",
          "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
          "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- proposal-draft-ui",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/proposal-inbox/**",
          "packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx",
          "packages/web-ui/dashboard/src/components/brain/drafts/**",
          "packages/web-ui/dashboard/src/components/brain/proposals/**",
          "packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts",
          "packages/web-ui/dashboard/src/hooks/useBrainProposals.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- proposal-draft-ui",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.17 — Proposal Inbox v2 & Draft Studio.\nGoal: Upgrade Proposal Inbox and add Draft Studio for reviewing evidence-backed proposals and generated drafts before approval.\nAllowed files: packages/web-ui/dashboard/src/features/proposal-inbox/**, packages/web-ui/dashboard/src/pages/BrainDraftStudioPage.tsx, packages/web-ui/dashboard/src/components/brain/drafts/**, packages/web-ui/dashboard/src/components/brain/proposals/**, packages/web-ui/dashboard/src/hooks/useBrainDrafts.ts, packages/web-ui/dashboard/src/hooks/useBrainProposals.ts, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: A proposal can generate drafts but cannot execute or enqueue without explicit approval.; Draft Studio shows evidence, memories used, safety checks, missing info, and plan contract preview.; Export markdown and send-to-plan-intake flows are available.; Reject/correct actions create auditable feedback.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.18",
      "title": "Run View Brain Context, Brain Stream & Trust UI",
      "required": true,
      "batch": "B7",
      "parallelGroup": "action_ui",
      "dependencies": [
        "V5.06",
        "V5.10",
        "V5.11",
        "V5.12",
        "V5.13"
      ],
      "hardDeps": [
        "V5.06",
        "V5.10",
        "V5.11",
        "V5.12",
        "V5.13"
      ],
      "softDeps": [],
      "canRunWith": [
        "V5.17"
      ],
      "cannotRunWith": [],
      "queuePriority": "high",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "dashboard/execution-brain",
      "goal": "Connect Brain V5 to the live execution dashboard through context strips, safe brain stream, right-sidebar tabs, and Trust & Approvals center.",
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/right-sidebar/**",
        "packages/web-ui/dashboard/src/components/brain/stream/**",
        "packages/web-ui/dashboard/src/components/brain/trust/**",
        "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
        "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
        "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/right-sidebar/**",
        "packages/web-ui/dashboard/src/components/brain/stream/**",
        "packages/web-ui/dashboard/src/components/brain/trust/**",
        "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
        "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
        "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
        "packages/web-ui/dashboard/src/api/brain.ts",
        "packages/web-ui/dashboard/src/types-brain-v5.ts"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/right-sidebar/**",
          "packages/web-ui/dashboard/src/components/brain/stream/**",
          "packages/web-ui/dashboard/src/components/brain/trust/**",
          "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
          "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
          "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": [
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts",
          "packages/web-server/src/brain-v5-routes.ts"
        ]
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- run-brain-context"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 0,
        "watchModeForbidden": true,
        "timeoutMs": 600000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Feature-flag Brain Context Strip and right-sidebar Brain tab; preserve existing run view.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "Execution run view surfaces relevant brain context without leaving the run.",
        "Validation failure can trigger explain failure, find similar failures, generate bugfix draft, and create proposal actions.",
        "Brain stream shows safe event summaries such as scanning, signal created, memory retrieved, proposal drafted, waiting for approval.",
        "Trust UI clearly shows what is auto-allowed, approval-required, or blocked."
      ],
      "description": "Connect Brain V5 to the live execution dashboard through context strips, safe brain stream, right-sidebar tabs, and Trust & Approvals center.",
      "dependencyReason": "Depends on V5.06, V5.10, V5.11, V5.12, V5.13 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_8",
        "canRunWith": [
          "V5.17"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/right-sidebar/**",
          "packages/web-ui/dashboard/src/components/brain/stream/**",
          "packages/web-ui/dashboard/src/components/brain/trust/**",
          "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
          "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
          "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B7 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "high",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/right-sidebar/**",
          "packages/web-ui/dashboard/src/components/brain/stream/**",
          "packages/web-ui/dashboard/src/components/brain/trust/**",
          "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
          "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
          "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- run-brain-context",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/right-sidebar/**",
          "packages/web-ui/dashboard/src/components/brain/stream/**",
          "packages/web-ui/dashboard/src/components/brain/trust/**",
          "packages/web-ui/dashboard/src/hooks/useBrainStream.ts",
          "packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts",
          "packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts",
          "packages/web-ui/dashboard/src/api/brain.ts",
          "packages/web-ui/dashboard/src/types-brain-v5.ts"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- run-brain-context",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.18 — Run View Brain Context, Brain Stream & Trust UI.\nGoal: Connect Brain V5 to the live execution dashboard through context strips, safe brain stream, right-sidebar tabs, and Trust & Approvals center.\nAllowed files: packages/web-ui/dashboard/src/App.tsx, packages/web-ui/dashboard/src/components/WorkerDetail.tsx, packages/web-ui/dashboard/src/components/right-sidebar/**, packages/web-ui/dashboard/src/components/brain/stream/**, packages/web-ui/dashboard/src/components/brain/trust/**, packages/web-ui/dashboard/src/hooks/useBrainStream.ts, packages/web-ui/dashboard/src/hooks/useApprovalQueue.ts, packages/web-ui/dashboard/src/hooks/useOvernightReadiness.ts, packages/web-ui/dashboard/src/api/brain.ts, packages/web-ui/dashboard/src/types-brain-v5.ts\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: Execution run view surfaces relevant brain context without leaving the run.; Validation failure can trigger explain failure, find similar failures, generate bugfix draft, and create proposal actions.; Brain stream shows safe event summaries such as scanning, signal created, memory retrieved, proposal drafted, waiting for approval.; Trust UI clearly shows what is auto-allowed, approval-required, or blocked.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    },
    {
      "id": "V5.19",
      "title": "E2E Dogfood, Telemetry, Docs & Regression",
      "required": true,
      "batch": "B8",
      "parallelGroup": "dogfood",
      "dependencies": [
        "V5.14",
        "V5.15",
        "V5.16",
        "V5.17",
        "V5.18"
      ],
      "hardDeps": [
        "V5.14",
        "V5.15",
        "V5.16",
        "V5.17",
        "V5.18"
      ],
      "softDeps": [],
      "canRunWith": [],
      "cannotRunWith": [],
      "queuePriority": "critical",
      "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood.",
      "area": "cross-cutting",
      "goal": "Prove the complete Brain Reality Layer through end-to-end dogfood, regression tests, telemetry correlation, docs, and demo scripts.",
      "allowedFiles": [
        "packages/coding-agent/test/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**/*.test.*",
        "docs/pi/v5/**",
        "reports/pv5-brain-reality-layer/**",
        "packages/coding-agent/src/brain/**",
        "packages/web-server/src/**",
        "packages/web-ui/dashboard/src/**"
      ],
      "forbiddenFiles": [
        ".env",
        ".env.*",
        "**/secrets/**"
      ],
      "readSet": [],
      "writeSet": [
        "packages/coding-agent/test/**",
        "packages/web-server/test/**",
        "packages/web-ui/dashboard/src/**/*.test.*",
        "docs/pi/v5/**",
        "reports/pv5-brain-reality-layer/**",
        "packages/coding-agent/src/brain/**",
        "packages/web-server/src/**",
        "packages/web-ui/dashboard/src/**"
      ],
      "conflictScope": {
        "declaredWriteSet": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/src/**/*.test.*",
          "docs/pi/v5/**",
          "reports/pv5-brain-reality-layer/**",
          "packages/coding-agent/src/brain/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/**"
        ],
        "driftDetection": {
          "enabled": true,
          "driftThresholdFiles": 5,
          "onDriftDetected": "warn_and_flag_integration"
        },
        "knownOverlap": []
      },
      "validation": {
        "commands": [
          "npm run typecheck",
          "npm test -- brain-v5",
          "npm test -- dashboard",
          "npm run build",
          "npm run lint"
        ],
        "targeted": true,
        "canRunTargetedOnly": true,
        "estimatedHeavyValidationSeconds": 900,
        "watchModeForbidden": true,
        "timeoutMs": 1200000,
        "killProcessTreeOnTimeout": true,
        "maxOutputBytes": 52428800,
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "managedRunnerRequired": true,
        "processGroupRequired": true,
        "killTreeOnTimeout": true
      },
      "rollback": {
        "strategy": "Disable BRAIN_V5_ENABLED and keep generated reports/docs for debugging.",
        "requiresHumanApproval": true
      },
      "humanApproval": {
        "requiredBeforeMerge": true,
        "requiredBeforeExecution": false,
        "approvalNotes": "Workspace output may be merged only after targeted validation and review. Generated plans/drafts remain approval-gated."
      },
      "acceptanceCriteria": [
        "The demo question 'What got stuck most last week and what should we do tonight?' works end-to-end.",
        "Repo scan creates hotspots, risk, signals, and proposal candidates.",
        "Proposal generates draft with memory injection report and evidence chain.",
        "Overnight readiness blocks unsafe execution and creates blockers/handoff.",
        "Run view explains workspace risk and retry reasons.",
        "Reflection creates memory candidates and future proposals.",
        "Automated tests prove Brain modules cannot mutate execution state directly."
      ],
      "description": "Prove the complete Brain Reality Layer through end-to-end dogfood, regression tests, telemetry correlation, docs, and demo scripts.",
      "dependencyReason": "Depends on V5.14, V5.15, V5.16, V5.17, V5.18 because this workspace consumes their types, APIs, stores, or UI shells.",
      "manualApplicationRequired": false,
      "humanApprovalRequired": false,
      "autonomousExecutionAllowed": true,
      "rollbackRequired": true,
      "targetedValidationRequired": true,
      "patchReview": {
        "required": false,
        "reviewer": "implementation_owner"
      },
      "parallelism": {
        "expectedBatch": "batch_9",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/src/**/*.test.*",
          "docs/pi/v5/**",
          "reports/pv5-brain-reality-layer/**",
          "packages/coding-agent/src/brain/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "May run with other workspaces in B8 only when capabilityManifest.canEdit scopes do not overlap and validation lane pressure is acceptable."
      },
      "worktree": {
        "required": true,
        "isolationMode": "worktree",
        "cleanupPolicy": "quarantine_on_failure"
      },
      "integration": {
        "queueRequired": true,
        "requiresWorkspaceValidation": true,
        "requiresIntegrationValidation": true,
        "conflictHandoffRequired": true,
        "queuePriority": "critical",
        "queueOptimizationNotes": "Critical path workspaces are high/critical priority. UI-only and non-blocking pages are high/normal unless they unblock dogfood."
      },
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 2,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/src/**/*.test.*",
          "docs/pi/v5/**",
          "reports/pv5-brain-reality-layer/**",
          "packages/coding-agent/src/brain/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/**"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-v5",
          "npm test -- dashboard",
          "npm run build",
          "npm run lint",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "capabilities": {
        "canEdit": [
          "packages/coding-agent/test/**",
          "packages/web-server/test/**",
          "packages/web-ui/dashboard/src/**/*.test.*",
          "docs/pi/v5/**",
          "reports/pv5-brain-reality-layer/**",
          "packages/coding-agent/src/brain/**",
          "packages/web-server/src/**",
          "packages/web-ui/dashboard/src/**"
        ],
        "cannotEdit": [
          ".env",
          ".env.*",
          "**/secrets/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test -- brain-v5",
          "npm test -- dashboard",
          "npm run build",
          "npm run lint",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish",
          "vitest --watch",
          "jest --watch",
          "npm run dev",
          "vite --host"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_start",
          "file_lock_acquired",
          "workspace_completed"
        ],
        "logLevel": "info"
      },
      "executorPrompt": "Implement workspace V5.19 — E2E Dogfood, Telemetry, Docs & Regression.\nGoal: Prove the complete Brain Reality Layer through end-to-end dogfood, regression tests, telemetry correlation, docs, and demo scripts.\nAllowed files: packages/coding-agent/test/**, packages/web-server/test/**, packages/web-ui/dashboard/src/**/*.test.*, docs/pi/v5/**, reports/pv5-brain-reality-layer/**, packages/coding-agent/src/brain/**, packages/web-server/src/**, packages/web-ui/dashboard/src/**\nDo not edit forbidden files: .env, .env.*, **/secrets/**\nAcceptance criteria: The demo question 'What got stuck most last week and what should we do tonight?' works end-to-end.; Repo scan creates hotspots, risk, signals, and proposal candidates.; Proposal generates draft with memory injection report and evidence chain.; Overnight readiness blocks unsafe execution and creates blockers/handoff.; Run view explains workspace risk and retry reasons.; Reflection creates memory candidates and future proposals.; Automated tests prove Brain modules cannot mutate execution state directly.\nRespect V4 ExecutionKernel doctrine: brain code must not mutate execution state directly; actors emit events only."
    }
  ],
  "parallelismReview": {
    "requestedMaxParallelWorkspaces": 6,
    "selectedScaleMode": "stable_6",
    "dagEffectiveParallelism": 3,
    "safeEffectiveParallelism": 3,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches_with_safe_batch_preview",
    "batchPreview": {
      "batches": [
        {
          "batch": 1,
          "name": "B0",
          "workspaceIds": [
            "V5.00"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "name": "B1",
          "workspaceIds": [
            "V5.01",
            "V5.02",
            "V5.13"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 3,
          "name": "B2",
          "workspaceIds": [
            "V5.03",
            "V5.05"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 4,
          "name": "B3",
          "workspaceIds": [
            "V5.04",
            "V5.06"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 5,
          "name": "B4",
          "workspaceIds": [
            "V5.07",
            "V5.08",
            "V5.10"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 6,
          "name": "B5",
          "workspaceIds": [
            "V5.09",
            "V5.11",
            "V5.12"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 7,
          "name": "B6",
          "workspaceIds": [
            "V5.14",
            "V5.15",
            "V5.16"
          ],
          "effectiveParallelism": 3
        },
        {
          "batch": 8,
          "name": "B7",
          "workspaceIds": [
            "V5.17",
            "V5.18"
          ],
          "effectiveParallelism": 2
        },
        {
          "batch": 9,
          "name": "B8",
          "workspaceIds": [
            "V5.19"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 2.2222222222222223,
      "criticalPaths": [
        [
          "V5.00",
          "V5.02",
          "V5.03",
          "V5.04",
          "V5.08",
          "V5.09",
          "V5.17",
          "V5.19"
        ],
        [
          "V5.00",
          "V5.01",
          "V5.06",
          "V5.07",
          "V5.15",
          "V5.19"
        ],
        [
          "V5.00",
          "V5.13",
          "V5.14",
          "V5.18",
          "V5.19"
        ]
      ],
      "serializedTailLength": 1
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 1,
          "name": "B0",
          "workspaceIds": [
            "V5.00"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "name": "B1",
          "workspaceIds": [
            "V5.01",
            "V5.02",
            "V5.13"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 3,
          "name": "B2",
          "workspaceIds": [
            "V5.03",
            "V5.05"
          ],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "name": "B3",
          "workspaceIds": [
            "V5.04",
            "V5.06"
          ],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "name": "B4",
          "workspaceIds": [
            "V5.07",
            "V5.08",
            "V5.10"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 6,
          "name": "B5",
          "workspaceIds": [
            "V5.09",
            "V5.11",
            "V5.12"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 7,
          "name": "B6",
          "workspaceIds": [
            "V5.14",
            "V5.15",
            "V5.16"
          ],
          "safeEffectiveParallelism": 3,
          "blockedParallelismReasons": []
        },
        {
          "batch": 8,
          "name": "B7",
          "workspaceIds": [
            "V5.17",
            "V5.18"
          ],
          "safeEffectiveParallelism": 2,
          "blockedParallelismReasons": []
        },
        {
          "batch": 9,
          "name": "B8",
          "workspaceIds": [
            "V5.19"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        }
      ],
      "overallSafeEffectiveParallelism": 2.2222222222222223,
      "bottlenecks": [
        "dashboard_api_file_overlap",
        "shared_type_files",
        "validation_lane_pressure",
        "integration_queue_serializes_merges"
      ],
      "blockedParallelismReasons": [
        "Requested parallelism is 6, but safe effective parallelism is expected to be 3 because several dashboard/API/type files overlap."
      ]
    },
    "doctorWarnings": [
      "safe_effective_parallelism_below_requested_parallelism"
    ],
    "persistedArtifacts": [
      "dependency_graph",
      "batch_preview",
      "safe_batch_preview",
      "critical_path",
      "scale_mode_readiness",
      "approved_graph_hash"
    ]
  },
  "boundedLiveness": {
    "required": true,
    "noIndefiniteWaits": true,
    "llm": {
      "providerRequestTimeoutMs": 120000,
      "streamIdleTimeoutMs": 300000,
      "workspaceOverallTimeoutMs": 1800000,
      "maxConsecutiveProviderTimeouts": 2,
      "onCircuitOpen": "fail_workspace_not_plan"
    },
    "validation": {
      "defaultTimeoutMs": 600000,
      "heavyTimeoutMs": 1200000,
      "killProcessTreeOnTimeout": true,
      "watchModeForbidden": true,
      "stdinClosed": true,
      "ciEnvRequired": true,
      "maxOutputBytes": 52428800
    },
    "git": {
      "repoMutationLockTimeoutMs": 60000,
      "lockBypassForbidden": true,
      "onLockTimeout": "fail_fast_and_retry_or_handoff"
    },
    "scheduler": {
      "stallDetectionEnabled": true,
      "noProgressTimeoutMs": 300000,
      "onNoProgress": "emit_blocked_reason"
    },
    "stateStore": {
      "transactionOrWriteQueueRequired": true,
      "atomicSnapshotRequired": true,
      "journalLineAtomicityRequired": true
    }
  },
  "validationRuntime": {
    "managedRunnerRequired": true,
    "processGroupRequired": true,
    "killTreeOnTimeout": true,
    "maxOutputBytes": 52428800,
    "forbiddenInteractiveCommands": [
      "vitest --watch",
      "jest --watch",
      "npm run dev",
      "vite --host"
    ],
    "lanes": {
      "heavy": {
        "maxConcurrent": 1
      },
      "targeted": {
        "maxConcurrent": 3
      }
    }
  },
  "safety": {
    "hardStops": [
      "brain_direct_execution_state_mutation",
      "generated_plan_execution_without_explicit_approval",
      "overnight_operator_without_execution_kernel_stable",
      "memory_injection_missing_for_generated_plan",
      "evidence_missing_for_confident_answer",
      "llm_call_without_provider_timeout",
      "llm_stream_without_idle_watchdog",
      "validation_command_without_timeout",
      "validation_process_without_process_group",
      "validation_watch_or_dev_server_command",
      "git_lock_bypass_detected",
      "state_store_write_without_serialization",
      "dependency_cycles",
      "invalid_dependency_patches",
      "required_preflight_review_not_approved",
      "stale_approved_graph_hash",
      "worktree_path_escape",
      "raw_destructive_worktree_cleanup",
      "integration_merge_without_passed_workspace_validation",
      "integration_validation_failure",
      "merge_conflict_without_handoff_artifact",
      "unsafe_scale_mode",
      "queue_starting_next_plan_while_integration_queue_dirty",
      "forbidden_file_access",
      "secrets_access",
      "git_push",
      "watch_mode_validation_command"
    ],
    "forbiddenCommands": [
      "git push",
      "rm -rf",
      "vitest --watch",
      "jest --watch",
      "npm run dev",
      "vite --host"
    ],
    "forbiddenFiles": [
      ".env",
      ".env.*",
      "**/secrets/**",
      "**/private_keys/**"
    ]
  },
  "dogfoodMatrix": {
    "required": true,
    "scenarios": [
      "temporal_qa_weekly_stuck_summary",
      "retry_explanation_evidence_memory_signal",
      "memory_injection_for_generated_plan",
      "repo_scanner_hotspot_risk_proposal",
      "proactive_push_validation_repeat",
      "proposal_to_v4_draft",
      "post_run_reflection_to_memory_and_proposal",
      "overnight_readiness_blocks_dirty_integration",
      "safe_brain_stream",
      "brain_cannot_mutate_execution_state"
    ]
  },
  "definitionOfDone": [
    "Brain V5 feature flags and safety doctrine are implemented.",
    "Temporal Journal v2 can answer day/week/month and entity questions.",
    "Evidence Index backs every confident answer, proposal, draft, signal, and memory injection report.",
    "Memory Retrieval and Injection are mandatory for generated plans and drafts.",
    "Repo Scanner v2 produces actionable signals and proposal candidates.",
    "Ask Pi returns evidence-backed answers with confidence and suggested actions.",
    "Proposal Engine v2 and Draft Generator v2 are approval-gated and do not auto-execute.",
    "Reflection Loop v2 creates source-backed memory candidates and future proposals.",
    "Proactive Push routes high-value signals without spam.",
    "Overnight v2 provides readiness and approved queue preview while blocking unsafe execution.",
    "Dashboard exposes Brain Overview, Ask Pi, Temporal, Memory, Repo Scanner, Proposals, Draft Studio, Brain Stream, Trust, and Run Context.",
    "E2E dogfood and regression tests pass.",
    "No Brain worker can mutate execution state directly."
  ],
  "workspaceSchemaCompatibility": {
    "topLevelWorkspaces": true,
    "legacyCapabilityManifestIncluded": true,
    "legacyCapabilitiesIncluded": true,
    "reason": "Runtime file-lock scheduling currently reads workspace.capabilities.canEdit in some paths while v4 template examples use capabilityManifest.canEdit. Both are emitted to avoid empty file locks.",
    "expectedParse": {
      "workspaceCount": 20,
      "maxParallel": 6
    }
  }
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phase": "P-V5",
  "title": "Brain Reality Layer",
  "contractVersion": "4.0.0",
  "templateVersion": "4.0.0",
  "executionClass": "implementation",
  "status": "planned",
  "lastUpdated": "2026-05-27",
  "workspaceCount": 20,
  "batchCount": 9,
  "requestedMaxWorkers": 6,
  "expectedDagEffectiveParallelism": 3,
  "expectedSafeEffectiveParallelism": 3,
  "primaryCriticalPath": [
    "V5.00",
    "V5.02",
    "V5.03",
    "V5.04",
    "V5.08",
    "V5.09",
    "V5.17",
    "V5.19"
  ],
  "secondaryCriticalPath": [
    "V5.00",
    "V5.01",
    "V5.06",
    "V5.07",
    "V5.15",
    "V5.19"
  ],
  "tertiaryCriticalPath": [
    "V5.00",
    "V5.13",
    "V5.14",
    "V5.18",
    "V5.19"
  ],
  "safetyPosture": {
    "brainDirectExecutionStateMutation": "forbidden",
    "generatedPlanExecution": "approval_required",
    "overnightOperator": "disabled_by_default",
    "evidenceRequiredForConfidentAnswer": true,
    "memoryInjectionRequiredForGeneratedPlan": true
  },
  "doneWhen": [
    "Brain V5 feature flags and safety doctrine are implemented.",
    "Temporal Journal v2 can answer day/week/month and entity questions.",
    "Evidence Index backs every confident answer, proposal, draft, signal, and memory injection report.",
    "Memory Retrieval and Injection are mandatory for generated plans and drafts.",
    "Repo Scanner v2 produces actionable signals and proposal candidates.",
    "Ask Pi returns evidence-backed answers with confidence and suggested actions.",
    "Proposal Engine v2 and Draft Generator v2 are approval-gated and do not auto-execute.",
    "Reflection Loop v2 creates source-backed memory candidates and future proposals.",
    "Proactive Push routes high-value signals without spam.",
    "Overnight v2 provides readiness and approved queue preview while blocking unsafe execution.",
    "Dashboard exposes Brain Overview, Ask Pi, Temporal, Memory, Repo Scanner, Proposals, Draft Studio, Brain Stream, Trust, and Run Context.",
    "E2E dogfood and regression tests pass.",
    "No Brain worker can mutate execution state directly."
  ]
}
```

---

# Appendix A — E2E Dogfood Gauntlet

The final dogfood must prove these scenarios:

1. **Temporal QA:** Ask "What got stuck most last week?" and answer from temporal rollups.
2. **Retry explanation:** Simulate or use a workspace with 3 retries; explain why with evidence, memories, and signals.
3. **Memory injection:** Generate a plan draft and show memory retrieval/injection report.
4. **Repo scanner:** Run project scan and produce hotspots, risk, signal, and proposal candidates.
5. **Proactive push:** Repeated validation failure creates one cooldown-respecting notification.
6. **Draft generation:** Proposal generates explanation, bugfix, phase plan, validation, and rollback drafts.
7. **Reflection:** Completed run generates reflection, memory candidates, and future proposals.
8. **Overnight readiness:** Dirty integration or missing approval blocks queue and creates clear handoff.
9. **Brain stream:** UI shows safe events, not private chain-of-thought.
10. **State safety:** Tests prove Brain V5 cannot directly mutate execution state.

---

# Appendix B — User-Facing Success Demo

```text
User:
  Pi, what got stuck most last week and what should we do tonight?

Pi:
  1. Reads Temporal Journal weekly rollup.
  2. Shows repeated validation/retry patterns.
  3. Opens evidence refs for the top failures.
  4. Retrieves relevant past failure memories.
  5. Runs repo scanner or uses latest scan.
  6. Produces top-3 proposals.
  7. Generates a V4-compatible plan draft for the safest item.
  8. Shows memory injection report.
  9. Shows overnight readiness.
  10. Blocks execution until user approval and kernel readiness pass.
```

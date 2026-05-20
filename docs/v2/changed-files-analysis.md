# Pi V2 — Files That Should Change Completely

**Status:** Authoritative Implementation Plan  
**Date:** 2026-05-19  
**Purpose:** Detailed file-level impact analysis for the P13-P20 V2 implementation bundle.

---

## Complete Replacements / Authoritative Docs

These files should be created or replaced as authoritative V2 documents:

| File | Purpose | Phase |
|------|---------|-------|
| `docs/pi/v2/second_brain_vision.md` | Vision and architecture | All |
| `docs/pi/v2/v2-implementation-phases-p13-p20.md` | Implementation index | All |
| `docs/pi/v2/changed-files-analysis.md` | This file | All |
| `docs/pi/phases/phase_p13_brain_core_orchestrator_daemon.md` | Phase P13 spec | P13 |
| `docs/pi/phases/phase_p14_memory_v0_provenance_conflict_model.md` | Phase P14 spec | P14 |
| `docs/pi/phases/phase_p15_goals_preferences_decision_policy.md` | Phase P15 spec | P15 |
| `docs/pi/phases/phase_p16_proposal_engine_v0.md` | Phase P16 spec | P16 |
| `docs/pi/phases/phase_p17_plan_factory_reflection_loop.md` | Phase P17 spec | P17 |
| `docs/pi/phases/phase_p18_trust_policy_audit_approval_controls.md` | Phase P18 spec | P18 |
| `docs/pi/phases/phase_p19_second_brain_dashboard_autonomy_ux.md` | Phase P19 spec | P19 |
| `docs/pi/phases/phase_p20_v2_dogfood_overnight_execution.md` | Phase P20 spec | P20 |

---

## New Runtime Directories (Coding Agent)

These should be new files V2 brain layer over existing execution core:

### P13 — Brain Core (Observation Layer)

```
packages/coding-agent/src/brain/
├── types.ts                          # Brain domain types
├── index.ts                          # Brain module entry
├── timeline/
│   ├── store.ts                      # NDJSON append-only store
│   └── index.ts
├── observation/
│   ├── engine.ts                     # Observation engine V0
│   ├── queue-health.ts               # Queue health observer
│   ├── execution-journal.ts          # Execution journal observer
│   ├── signals.ts                    # Signal extractor
│   └── index.ts
├── reflection/
│   ├── first-reflection.ts           # Initial reflection engine
│   └── index.ts
├── daemon/
│   ├── index.ts                      # Brain daemon lifecycle
│   └── types.ts
└── api/
    └── index.ts                      # Brain API module
```

### P14 — Memory Layer

```
packages/coding-agent/src/brain/memory/
├── types.ts                          # Memory domain types
├── store.ts                          # JSON file persistence
├── lifecycle.ts                      # Lifecycle state machine
├── scoring.ts                        # Confidence/relevance scoring
├── conflicts.ts                      # Conflict detection
├── api.ts                            # Memory API module
└── index.ts
```

### P15 — Goals & Decisions

```
packages/coding-agent/src/brain/goals/
├── types.ts                          # Goal domain types
├── store.ts                          # Goal/preference store
├── autonomy.ts                       # Autonomy profile engine
├── decisions.ts                      # Decision classifier
├── drift.ts                          # Goal drift detector
├── api.ts                            # Goals API module
└── index.ts
```

### P16 — Proposals

```
packages/coding-agent/src/brain/proposals/
├── types.ts                          # Proposal domain types
├── generator.ts                      # Proposal generation
├── scoring.ts                        # Proposal scoring
├── dedup.ts                          # Deduplication & cooldown
├── inbox.ts                          # Top-3 inbox logic
├── api.ts                            # Proposal API module
└── index.ts
```

### P17 — Plan Factory & Reflection

```
packages/coding-agent/src/brain/plan-factory/
├── engine.ts                         # Plan factory engine
├── template.ts                       # Master template integration
├── types.ts
└── index.ts

packages/coding-agent/src/brain/reflection/
├── engine.ts                         # Reflection engine
├── summarizer.ts                     # Source-backed summarizer
├── memory-proposals.ts               # Memory update proposals
├── future-suggestions.ts             # Future phase suggestions
├── api.ts                            # Reflection API
└── index.ts
```

### P18 — Trust & Policy

```
packages/coding-agent/src/brain/policy/
├── engine.ts                         # Policy engine
├── rules.ts                          # Policy rule store
├── provenance.ts                     # Provenance tracker
└── index.ts

packages/coding-agent/src/brain/approvals/
├── gate.ts                           # Approval gate
├── store.ts                          # Approval request store
├── api.ts                            # Approval API
└── index.ts

packages/coding-agent/src/brain/audit/
├── ledger.ts                         # Audit ledger
└── index.ts
```

### P19 — Second Brain Dashboard

```
packages/web-ui/dashboard/src/
├── pages/
│   ├── Brain.tsx                     # /brain - brain state viewer
│   ├── BrainInbox.tsx                # /brain/inbox - proposal inbox
│   ├── BrainMemory.tsx               # /brain/memory - memory explorer
│   ├── BrainGoals.tsx                # /brain/goals - goal board
│   ├── BrainAutonomy.tsx             # /brain/autonomy - autonomy controls
│   ├── BrainReflections.tsx          # /brain/reflections - reflection timeline
│   └── BrainOvernight.tsx            # /brain/overnight - overnight panel
├── components/
│   └── brain/
│       ├── BrainStateViewer.tsx
│       ├── TimelineList.tsx
│       ├── SignalSummaryCards.tsx
│       ├── ObservationCounts.tsx
│       ├── proposals/
│       │   ├── ProposalInbox.tsx
│       │   ├── ProposalCard.tsx
│       │   └── EvidenceDrawer.tsx
│       ├── memory/
│       │   ├── MemoryList.tsx
│       │   ├── MemoryDetail.tsx
│       │   ├── MemoryEdit.tsx
│       │   └── MemoryTags.tsx
│       ├── goals/
│       │   ├── GoalBoard.tsx
│       │   ├── GoalCard.tsx
│       │   └── MilestoneTracker.tsx
│       ├── autonomy/
│       │   ├── AutonomyControls.tsx
│       │   ├── LevelSelector.tsx
│       │   └── EmergencyStopButton.tsx
│       ├── reflections/
│       │   ├── ReflectionTimeline.tsx
│       │   └── ReflectionCard.tsx
│       └── overnight/
│           ├── OvernightPanel.tsx
│           ├── PlanSelector.tsx
│           └── RunHistory.tsx
├── hooks/
│   ├── useBrainStatus.ts
│   ├── useBrainTimeline.ts
│   ├── useMemoryRecords.ts
│   ├── useProposals.ts
│   ├── useGoalBoard.ts
│   ├── useAutonomyControls.ts
│   ├── useReflections.ts
│   └── useOvernight.ts
└── api/
    └── brain.ts                      # Brain API client
```

### P20 — Overnight Execution

```
packages/coding-agent/src/brain/overnight/
├── orchestrator.ts                   # Overnight run orchestration
├── morning-report.ts                 # Morning report generator
├── validation.ts                     # Full loop validation
├── trust-assessment.ts               # Trust assessment
├── types.ts
└── index.ts
```

---

## New Web Server Routes

```
packages/web-server/src/routes/
├── brain/
│   ├── timeline.ts                   # GET /api/brain/timeline
│   ├── observations.ts               # GET /api/brain/observations
│   ├── signals.ts                    # GET /api/brain/signals
│   ├── state.ts                      # GET /api/brain/state
│   ├── memory.ts                     # CRUD /api/brain/memory
│   ├── goals.ts                      # CRUD /api/brain/goals
│   ├── preferences.ts                # GET/POST /api/brain/preferences
│   ├── autonomy.ts                   # GET/PUT /api/brain/autonomy
│   ├── proposals.ts                  # CRUD + actions /api/brain/proposals
│   ├── approvals.ts                  # Actions /api/brain/approvals
│   ├── reflections.ts                # GET /api/brain/reflections
│   ├── policy.ts                     # GET/PUT /api/brain/policy/rules
│   ├── audit.ts                      # GET /api/brain/audit
│   └── index.ts                      # Router aggregator
└── index.ts                          # Import brain routes
```

---

## New Persisted Artifacts

```
.pi/
├── brain-timeline.ndjson             # Timeline events (P13)
├── brain/
│   ├── memory/
│   │   ├── index.json                # Memory index
│   │   ├── {ulid}.json               # Individual memories
│   │   └── conflicts/
│   │       └── {ulid}.json           # Conflict records
│   ├── goals/
│   │   ├── goals.json                # Goals list
│   │   ├── preferences.json          # Preferences store
│   │   └── autonomy.json             # Autonomy profiles
│   ├── proposals/
│   │   ├── index.json                # Proposals index
│   │   └── {ulid}.json               # Individual proposals
│   ├── reflections/
│   │   └── {planExecId}/
│   │       ├── reflection-summary.md
│   │       └── reflection-summary.json
│   ├── policy/
│   │   └── rules/
│   │       └── {ruleId}.json         # Policy rules
│   ├── audit/
│   │   └── {year}/{month}/{day}.ndjson # Audit entries
│   └── overnight/
│       ├── sessions.json             # Run sessions
│       └── reports/
│           └── {date}.md             # Morning reports
```

---

## Existing Files to Modify

These files should be modified carefully, not fully rewritten:

| Existing File | Modification |
|---------------|--------------|
| `packages/web-server/src/index.ts` | Import brain routes |
| `packages/web-server/src/app.ts` | Add brain middleware |
| `packages/web-ui/dashboard/src/App.tsx` | Add brain routes |
| `packages/web-ui/dashboard/src/Navigation.tsx` | Add brain nav items |
| `packages/coding-agent/src/index.ts` | Export brain module |
| `packages/coding-agent/package.json` | Add brain dependencies |

---

## Existing Files NOT to Rewrite (Extend via Adapters)

These are foundational and should be extended through adapters/hooks:

| File | Reason |
|------|--------|
| `packages/coding-agent/src/core/autonomous-executor.ts` | Core execution — extend via hooks only |
| `packages/coding-agent/src/core/workspace-agent-executor.ts` | Core execution — extend via hooks only |
| `packages/coding-agent/src/core/plan-state.ts` | State management — add brain state separately |
| `packages/coding-agent/src/core/json-state-store.ts` | State store — brain has separate store |
| `packages/coding-agent/src/integration/integration-queue.ts` | Integration queue — hook into brain observer |
| `packages/coding-agent/src/scheduler/dynamic-scheduler.ts` | Scheduler — add brain-aware scheduling |
| `packages/coding-agent/src/failure/failure-classifier.ts` | Failures — hook into brain observation |
| `packages/coding-agent/src/failure/retry-router.ts` | Retries — hook into brain signals |

---

## Test Files to Create

```
packages/coding-agent/test/
├── brain/
│   ├── types.test.ts
│   ├── timeline/
│   │   └── store.test.ts
│   ├── observation/
│   │   ├── engine.test.ts
│   │   └── signals.test.ts
│   ├── memory/
│   │   ├── store.test.ts
│   │   ├── lifecycle.test.ts
│   │   ├── scoring.test.ts
│   │   └── conflicts.test.ts
│   ├── goals/
│   │   ├── store.test.ts
│   │   ├── autonomy.test.ts
│   │   └── decisions.test.ts
│   ├── proposals/
│   │   ├── generator.test.ts
│   │   ├── scoring.test.ts
│   │   └── dedup.test.ts
│   ├── plan-factory/
│   │   └── engine.test.ts
│   ├── reflection/
│   │   └── engine.test.ts
│   └── policy/
│       ├── engine.test.ts
│       └── audit.test.ts
└── fixtures/
    ├── brain/
    │   ├── observations.json
    │   ├── signals.json
    │   ├── memories.json
    │   ├── goals.json
    │   └── proposals.json
    └── v2/
        └── phases/
            └── *.md
```

---

## Implementation Order

```text
Phase P13 — Brain Core (Foundation)
├── Create src/brain/types.ts
├── Create src/brain/timeline/
├── Create src/brain/observation/
├── Create src/brain/daemon/
├── Create brain API routes
└── Create dashboard components (minimal)

Phase P14 — Memory
├── Extend src/brain/memory/
├── Add memory API routes
└── Add memory dashboard

Phase P15 — Goals
├── Extend src/brain/goals/
├── Add goals API routes
└── Add goal board dashboard

Phase P16 — Proposals
├── Extend src/brain/proposals/
├── Add proposal API routes
└── Add proposal inbox dashboard

Phase P17 — Plan Factory & Reflection
├── Create src/brain/plan-factory/
├── Create src/brain/reflection/
├── Add reflection API
└── Add reflection viewer

Phase P18 — Trust & Policy
├── Create src/brain/policy/
├── Create src/brain/approvals/
├── Create src/brain/audit/
├── Add approval API
└── Add trust dashboard

Phase P19 — Full Dashboard
├── Complete all dashboard components
├── Add overnight panel
└── Integrate all pages

Phase P20 — Dogfood
├── Create overnight orchestrator
├── Create morning report generator
├── Run validation scenarios
└── Generate dogfood report
```

---

## Principle

V2 should be implemented as an **additive brain layer** over the existing execution core. The execution core should not be rewritten unless a narrow interface change is necessary. This reduces risk and keeps P12.5 queue behavior stable while V2 evolves.

**Key architectural separation:**
- Execution core: deterministic, stateful, safety-critical
- Brain layer: cognitive, advisory, evidence-backed
- Trust layer: policy decision, audit logging, approval gates
- Dashboard: read/write UI that calls through API (never bypasses runtime)

---

## Related Documents

- `docs/pi/v2/second_brain_vision.md` — Vision and architecture
- `docs/pi/v2/v2-implementation-phases-p13-p20.md` — Phase overview
- `docs/llm-implementation-agent-master-template.md` — Execution contract template
- Phase files (`phase_p*.md`) in `docs/pi/phases/`

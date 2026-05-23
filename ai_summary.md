# Pi Monorepo — File Analysis Summary

**Date:** 2026-05-23  
**Scope:** `packages/ai/`, `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`, `packages/db/`, reference docs, reports  
**Purpose:** Understand what every file does across the autonomous execution system, V2 cognitive OS (P13-P20 brain module), prompt cache architecture, P6 large-project scale reliability, P11 continuous self-improvement, and chat UI.

---

## Recent Commits (last 31, oldest to newest)

### 1. `fix(coding-agent): fix all P13-P20 code review findings and pre-existing type errors` (16e3ec2e)

Fixes 7 findings from docs/findings_v20.md and resolves 98 pre-existing type errors blocking the pre-commit hook.

- **Findings fixed:** Missing brain API exports (getBrainState, getObservations, getSignals, getTimeline); promise-chain mutex for OvernightOrchestrator and InMemoryBrainTimelineStore; double-check locking in MemoryStore.get(); LRU eviction in PolicyEngine cache; fsync in MemoryStore.atomicWrite; SessionStore JSDoc
- **New file:** `brain/api.ts` with 24 web-server API functions (audit, autonomy, memory, overnight, policy)
- **Type fixes:** Test file types across 15 files, added missing methods to SessionStore

- **Files:** 17 files across `packages/coding-agent/`, `packages/ai/`

### 2. `feat(pP9): complete workspace P9.G7 — Governance ledger integration & audit trail wiring` (8976fde07)

Dogfood/safety reports for P9.G4 (dry-run validation) and P9.G7 (governance ledger integration). Adds 5 report files totaling 501 lines.

- **Files:** `reports/p9g4-dryrun-validation/*`, `reports/p9g7-governance-ledger/*`

### 3. `feat(pP9): complete workspace P9.I — P9 dogfood and safety report` (77aa6e155)

P9 dogfood and safety report — 4 report files covering dogfood results, safety verification, and Definition-of-Done checklist totaling 611 lines.

- **Files:** `reports/p9i-dogfood-safety/*`

### 4. `chore: fix lint infos in remediation-runtime-p9-g4.test.ts and proposal-routes.ts` (4583d0e29)

Large cross-cutting P11 commit introducing the full continuous self-improvement ecosystem:
- **Budget enforcer:** `budget-enforcer.ts` + tests (475+482 lines)
- **Remediation pipeline:** `remediation-policy-engine.ts`, `remediation-runtime.ts`, `proposal-execution-pipeline.ts` with full test suites
- **Governance ledger:** `governance-ledger.ts` (703 lines)
- **Planner:** `planner.ts` updated with proposal generation + tests
- **Workspace schema:** extended with proposal/revision fields
- **Database package (`packages/db/`):** **restored** — proposal repository, plan-revision repository, migration `006_add_proposal_source_and_revisions`, updated types, test suite
- **Web server:** proposal routes expanded, server index updated with new endpoints
- **Dashboard:** `LeadAgentDashboard`, `ProposalCard`, `App.tsx` updated for proposal UI
- **Extension runtime:** `runtime-host.ts`, extension registry types

- **Files:** 41 files across `packages/ai/`, `packages/coding-agent/`, `packages/db/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 5. `feat(pP10R): complete workspace 10.0 — Spec cleanup and executable DAG normalization` (bf5ac607f)

Documentation-only commit: `docs/p10-dashboard-redesign-plan-p10r.md` (1557 lines) — redesigned version of the P10 dashboard plan.

- **Files:** `docs/p10-dashboard-redesign-plan-p10r.md`

### 6. `fix(web-ui): rename 'ref' prop to 'ctx' in ContextRefPill to avoid React 19 reserved prop error` (3761f6ccb)

React 19 treats `ref` as a reserved prop. Renamed to `ctx` in the component and all 3 call sites in `ChatPanel.tsx`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 7. `fix(p6.5): wire worktree config through autonomous executor and bump schema to v2.3.2` (0a0732f34)

Wired worktree config through `AutonomousExecutor` so P6 worktree isolation actually activates. Bumped `CONTRACT_SCHEMA_VERSION` to 2.3.2, added to `ACCEPTED_SCHEMA_VERSIONS`. Updated master template default to `experimental_6` with worktree. Fixed `scale-routes.ts` readiness endpoint to reflect actual config.

- **Files:** 8 files across `packages/coding-agent/`, `packages/web-server/`, `docs/`

### 8. `feat(web-ui): convert chat panel to centered dialog with markdown rendering` (b5faddfd5)

Converted `ChatPanel` from cramped sidebar/tabs into a centered dialog (max-w-3xl, max-h-[80vh]) using framer-motion `AnimatePresence`. Added `react-markdown` with `remark-gfm` and `rehype-highlight` for markdown rendering and syntax highlighting. Removed left sidebar and right overlay Chat usages.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`, `App.tsx`, `package.json`, `package-lock.json`

### 9. `feat(web-ui): add colored tool badges, thinking animation, and smooth message fade-in to chat` (7f63c055a)

Added per-tool colored badges (blue=read, amber=write, violet=edit, emerald=bash, cyan=search) with pulse animations. `ThinkingDots` animation while waiting for first tokens. Smooth fade-in/slide-up via framer-motion for messages and stream chunks.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 10. `feat(web-ui): add chat status bar with provider/model selector, context meter, and compact button` (d4c8a2be2)

`ChatStatusBar` with provider/model dropdown (fetches from `/api/ai-models`, persists to settings). Context usage bar with token count (estimated ~0.3 tokens/char), color-coded thresholds. Compact button calling `POST /api/chat/compact`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 11. `feat(web-ui): add search bar to model selection dropdown` (8384c7eb5)

Search input at top of model selector dropdown filters providers/models in real-time. Escape closes, clicking outside resets. Fixed-height scrollable list.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 12. `feat(web-ui): add persistent chat threads with session switching` (864ee27c6)

Backend: `GET /chat/history` returns all sessions with metadata; `POST /api/chat` now saves user messages before processing. Frontend: thread sidebar toggleable from header, lists sessions with active highlight, 'New' button for fresh threads. Dialog widened to max-w-4xl.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 13. `feat(web-ui): add 17 improvements to chat dialog` (e50ee226f)

Message editing (ArrowUp on empty, pencil button), regeneration (RefreshCw button), copy code block button with language label, table scroll hint, fullscreen toggle, timestamps (relative), copy message button, scroll-to-bottom floating button.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 14. `chore(web-ui): remove unused Clock import in ChatPanel` (56e928c3d)

One-line cleanup.

### 15. `fix(web-server): add plan-handoff markdown type and fix pre-existing TS error` (bd32be4bb)

Added `'plan-handoff'` to `PlanMarkdownEvent` union, implemented handler in `updatePlanMarkdown` setting status to `'awaiting_handoff'`. Extended `replaceHeader()`/`formatHeader()` type unions. Fixed pre-existing TS2454 unassigned-variable error.

- **Files:** 8 files across `packages/coding-agent/` and `packages/web-server/`

### 16. `fix(coding-agent): fix TOCTOU memory guard, stale completion bus signal, execSync in scale-routes and readiness doctor` (dc5bd8f73)

- `cleanup-review.ts`: moved memory check inside cleanup lock to avoid TOCTOU race
- `plan-runner.ts`: `WorktreeCompletionBus.reset()` clears stale `lastSignal` on bus reuse
- `scale-routes.ts`: replaced all `execSync` git calls with `execAsync`
- `production-readiness-doctor.ts`: converted to fully async, removed `execSync`

- **Files:** 5 files across `packages/coding-agent/` and `packages/web-server/`

### 17. `fix(coding-agent): add validation lock to bash tool, orphan process killing, and global spawn interceptor` (bed08f546)

Serializes validation commands across all parallel workers to prevent vitest process stack exhaustion. Kills orphan child processes left by agent sessions. Global `child_process.spawn` interceptor kills previous validation process before starting new one. Massive journal NDJSON artifact included (17.5K lines).

- **Files:** `packages/coding-agent/src/core/tools/bash.ts`, `autonomous-executor.ts`, `cleanup-review.ts`, `utils/shell.ts`

### 18. `feat(web): add rerun cleanup button to dashboard and API endpoint` (771181973)

`POST /api/projects/:projectId/plans/:planExecId/rerun-cleanup` triggers cleanup review re-execution. Dashboard `PlanSummaryPanel.tsx` rerun button with spinner and auto-refresh.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx`

### 19. `fix(p6.5): fix 12 security and reliability bugs across ai, coding-agent, and web-server` (02cf69cbb)

- Critical: replaced shell command injection in file search with pure Node.js walk; separated OAuth state from PKCE verifier; stopped caching env secrets in `/proc/self/environ`
- High: properly handle `start()` rejected promise; eliminated race condition in `runPlan()` double-execution guard; OS-assigned port for OAuth callback
- Medium: byte-cap in-memory log buffer; Fastify 10MB body limit; CORS restricted to explicit local origins; documented JsonStateStore fallback divergence

- **Files:** 5 files across `packages/ai/` and `packages/web-server/`

### 20. `fix(coding-agent): resolve TS build errors in runtime-host and index` (94d30736a)

Fixed non-null assertion in `runtime-host.ts` (discriminated union narrowing). Removed stale P11.A platform type re-exports from `index.ts` referencing renamed/removed identifiers.

- **Files:** `packages/coding-agent/src/core/extensions/runtime-host.ts`, `packages/coding-agent/src/index.ts`

### 21. `feat(web-ui): add @-triggered telescope file search to chat panel` (42c509f1c)

Type `@` in chat textarea to open file browser popup. Empty shows directory tree (browsable). Typing does debounced `find -iname` search with relevance scoring. Backend: `GET /api/projects/:projectId/files/browse` and `GET /api/projects/:projectId/files/search`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 22. `fix(web-ui): prevent infinite re-render in LeadAgentDashboard` (09387c4da)

Derived `selectedProposal` from proposals list via `useMemo` instead of render-time `setState`. Removed dead `setSelectedProposal` state and unused `ProposalResponse` import.

- **Files:** `packages/web-ui/dashboard/src/components/LeadAgentDashboard.tsx`

### 23. `fix(web-ui): improve extensions error message when backend routes are missing` (33c0721d3)

Detects 404 responses in `useExtensions` hook and shows a clear "backend not configured" message.

- **Files:** `packages/web-ui/dashboard/src/hooks/useExtensions.ts`

### 24. `feat(web-server): implement extensions API routes` (5cbcb0f96)

REST API for extension lifecycle management (P11.P): list, health check, install (npm:/git:/local), update, rollback, enable/disable. Wraps `ExtensionRegistry` with audit logging.

- **Files:** `packages/web-server/src/extensions-routes.ts`, `packages/web-server/src/index.ts`, `packages/coding-agent/package.json`

### 25. `feat(p11): complete remaining P11 workspaces — plan intake, graph diff, audit ledger, skill API, dashboard UIs, and integration` (d73c25755)

Major P11 completion (workspaces C, I, K, M, O, Q, R, S, T):
- `plan-intake-analyzer.ts` — auto-analyze plans, detect bottlenecks, compute critical path
- `graph-diff-engine.ts` — original-vs-optimized graph diffs, safety checks, approval lifecycle
- `skills-routes.ts` — Fastify skill backend API (install, update, remove, enable/disable, test, invoke, recommend)
- `platform-audit-ledger.ts` — platform-level audit events for orchestrator/plans/extensions/skills/memory/policy
- Dashboard: `PlanIntakePanel.tsx`, `MemoryCockpit.tsx`, `PolicyAuditCenter.tsx` — full feature UIs
- Integration test: `p11-ecosystem-integration.test.ts` (7 tests covering full self-improvement lifecycle)

- **Files:** 12 files across `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 26. `fix(p11): integrate worktree orphan files and start orchestrator daemon` (bea4b16f6)

- `orchestrator-daemon.ts` (P11.B) — periodic scan loop for continuous observation
- `organic-forbidden-patterns.ts`, `organic-memory-schema.ts` (P11.F) — memory schema files
- `memory-routes.ts`, `policy-audit-routes.ts` (P11.L/P11.R) — web server routes
- Tests: `capability-policy-engine.test.ts`, `plan-graph-diff.test.ts`
- Dashboard: `AutonomyCenter.tsx`

- **Files:** 12 files across `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 27. `fix(orchestrator): wire ProposalInbox into daemon and fix type errors` (ca340a906)

Wired `ProposalInbox` into `OrchestratorDaemon` — submits generated proposals after each scan cycle. Fixed `PlannerOutput`, `BatchPlanResult`, `CriticalPathInfo`, `PredictedParallelism` types.

- **Files:** `packages/coding-agent/src/main.ts`, `packages/coding-agent/src/orchestrator/orchestrator-daemon.ts`

### 28. `chore(cleanup): commit pre-redesign state` (7f80f27b4)

Checkpoint commit before scheduler redesign. Includes untracked P11 files: `patch-approval-engine.ts`, `plan-graph-diff.ts`, `DagDiffViewer.tsx`, `OptimizerApprovalPanel.tsx`, `PlanIntakePanel.tsx` (original), `PolicyAuditCenter.tsx` (original), `SafeBatchPreview.tsx`, `MemoryCockpitPanel.tsx`, hooks (`useMemoryMetrics.ts`, `useOptimizerApproval.ts`). Also deleted `platform/index.ts`.

- **Files:** 13 files across `packages/coding-agent/` and `packages/web-ui/dashboard/`

### 29. `fix(validation): include v2.3.2 and v2.4.0 in isV230Plus check` (01f9339af)

Without this, plans with `contractVersion "2.3.2"` or `"2.4.0"` with `maxParallelWorkspaces > 3` failed validation even with `experimental_6` mode. Added missing versions.

- **Files:** `packages/coding-agent/src/core/workspace-schema.ts`

### 30. `feat(p6.5): batchless ready queue, scheduler interface, DynamicParallelScheduler wiring` (ced1ade9a)

- `Scheduler` interface in `workspace-scheduler.ts` — `DynamicParallelScheduler` implements it
- `GlobalReadyQueue` — batch-barrier-free ready queue with priority sort
- `WorktreePool` — prewarm, acquire/release lease lifecycle, crash recovery via `.pi/scheduler/leases/`
- Workspace schema: added `hardDeps`, `softDeps`, `readSet`, `writeSet` fields
- Priority scorer: `criticalPathRemaining * 100 + downstreamBlocking * 20 + ageBoost - conflictRiskPenalty`
- Master template: `worktree.enabled` defaults to `true`

- **Files:** 6 files across `packages/coding-agent/` and `docs/`

### 31. `feat(p6.5): add Scheduler interface, v2.5 schema, continuous scheduling defaults` (06416c555)

- Created `scheduler.ts` with shared `Scheduler` interface + all scheduling types (`SkipReason`, `SchedulingDecision`, `SchedulerDiagnostics`, etc.)
- `WorkspaceScheduler` (v1) and `DynamicParallelScheduler` (v2) both implement the interface; v2 is default
- Schema v2.5.0: continuous scheduling is now the default execution mode
- Master template defaults: `worktree.enabled: true`, `scheduling.continuous: true`, `slotCount: 6`, `priorityStrategy: critical_path_first`
- Added validation rules 52-54 for continuous scheduling

- **Files:** 7 files across `packages/coding-agent/` and `docs/`

---

Bu repo **Pi** adinda bir AI yazilim gelistirme asistanini barindirir. Iki ana sistemden olusur:

1. **Execution Engine (P2/P6/P6.5/P11)**: Planlari parse eder, workspace'lere boler, DAG scheduler ile paralel calistirir, worktree isolation ile izole eder, hata durumunda remediate eder. Kod yazma araclarini calistiran kisim budur.
2. **V2 Cognitive OS / Brain (P13-P20)**: Gozlem → Hafiza → Oneri → Yansitma → Plan → Uygula → Denetim dongusunu calistiran "beyin" moduludur. Pi'ye bilinc kazandirmayi amaclar.

---

## V2 Brain — Cognitive OS (packages/coding-agent/src/brain/)

Pi'nin V2 beyni, **8 fazda** insa edilmis moduler bir "cognitive operating system"dur. Her faz bagimsiz bir alt modul olup, birbirleriyle `brain/index.ts` uzerinden entegre olurlar. Toplam **~50 kaynak dosya + 38 test dosyasi + 10 web-server route dosyasi**.

```
                       ┌─────────────────────────────────────┐
                       │         ObservationEngine           │  P13
                       │  (queues, journals, retry sinyall)  │
                       └──────────────┬──────────────────────┘
                                      │ signals
                                      ▼
                       ┌─────────────────────────────────────┐
                       │       InMemoryBrainTimelineStore     │  P13
                       │     (time-series event log, mutex)  │
                       └──────────────┬──────────────────────┘
                                      │ observations
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   MemoryStore    │   │   GoalStore +        │   │  ProposalGenerator   │
│  (P14, dosya-    │   │   DecisionClassifier │   │  (P16, oneri uretir) │
│   backed, fsync) │   │   (P15, otonomi)     │   │                      │
└────────┬─────────┘   └──────────┬───────────┘   └──────────┬───────────┘
         │                       │                           │
         ▼                       ▼                           ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ ReflectionEngine │   │   PolicyEngine +     │   │   ApprovalGate       │
│  (P17, yansitma)  │   │   AuditLedger (P18) │   │  (P18, onay katmani) │
└────────┬─────────┘   └──────────┬───────────┘   └──────────┬───────────┘
         │                       │                           │
         ▼                       ▼                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      OvernightOrchestrator (P20)                       │
│   schedule → start → execute → stop → morning-report → dogfood-report │
└────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  brain/api.ts    │  ← 24 fonksiyonluk API
                              │  10 web-server   │     katmani
                              │  route dosyasi   │
                              └──────────────────┘
```

### P13 — Observation & Timeline (Core Brain)

| File | Ne is yapar? |
|---|---|
| `brain/types.ts` | Core tipler: `BrainObservation`, `BrainSignal`, `BrainTimelineEvent`, `SignalType` (retry_failure, queue_stuck, pattern_repeat, error_rate), `EventSource` |
| `brain/observation-engine.ts` | `ObservationEngine` — 3 observer: `QueueHealthObserver` (kilitlenmis planlari izler), `ExecutionJournalObserver` (journal'daki hatalari okur), `RetryFailureSignalExtractor` (3+'li retry'leri, tekrar eden hatalari tespit eder). Raw observation → Signal donusumu yapar. |
| `brain/timeline-store.ts` | `InMemoryBrainTimelineStore` — Time-series event log. Promise-chain mutex (`withMutex`) ile append/list/count/getRange/getBySource metodlari korunur. Map<epoch, event[]> yapisinda tutar. |
| `brain/index.ts` | Tum brain modullerinin barrel export'u. Ayrica `setBrainStore()` DI fonksiyonu ile store inject edilir. |

### P14 — Memory (Persistent Store + Scoring + Conflicts)

**Dosya sistemi**: `.pi/memory/’ altinda JSON formatinda saklanir. Her dosya bir `MemoryEntry` icerir. `MemoryStore` acilista index.json’u okur, tum dosyalari memory-map'e ceker.

| File | Ne is yapar? |
|---|---|
| `brain/memory/types.ts` | `MemoryEntry` (id, content, source, tags, timestamp, score, tier, metadata), `MemoryQuery`, `MemoryScoringResult`, `MemoryConflictResult`, `MemoryLifecycleResult` |
| `brain/memory/store.ts` | `MemoryStore` — File-backed persistent store. **Double-check locking** ile get(): once index'te ara (okuma kilidi disinda), bulamazsa yazma kilidi altinda dogrudan dosyadan oku (TOCTOU onlemi). **fsync** ile `atomicWrite`: dosyayi ac → yaz → fsync → kapat → rename. Index ile hizli sorgu, tag bazli filtreleme. |
| `brain/memory/scoring.ts` | `MemoryScoringEngine` — Her entry'yi relevance/importance/recency bazinda puanlar. Bilesik skor hesaplar ve store'a geri yazar. |
| `brain/memory/conflicts.ts` | `ConflictDetector` — 3 tur cakisma: **duplicate** (birebir ayni icerik), **semantic** (benzer anlam), **contradiction** (zit ifadeler). Her cakisma icin taraflari, tipi, siddetini raporlar. |
| `brain/memory/lifecycle.ts` | `MemoryLifecycleManager` — Tier-based lifecycle: hot/warm/cold tier, archival (belirli yastaki entry'leri arsive), pruning (onemsiz entry'leri sil). |
| `brain/memory/api.ts` | CRUD API: `createMemory`, `getMemory`, `updateMemory`, `deleteMemory`, `rejectMemory`, `getMemories`, `getMemoryStats`. |
| `brain/memory/index.ts` | Memory barrel exports. |
| **Test:** `test/brain/memory/*.test.ts` | 7 test dosyasi: store, api, conflicts, scoring, types. |

### P15 — Goals & Autonomy Profile

Pi'nin kendi kendine ne kadar karar alabilecegini belirleyen sistemdir. 4 otonomi seviyesi vardir (1=manuel, 2=onayli, 3=operator, 4=otonom).

| File | Ne is yapar? |
|---|---|
| `brain/goals/types.ts` | `GoalIndex`, `GoalIndexEntry`, `GoalWithMetadata`, `GoalQuery` |
| `brain/goals/store.ts` | `GoalStore` — JSON dosyasina yazilan hedef index'i. `addGoal`, `getGoal`, `updateGoal`, `removeGoal`, `query` (aktif/hedefe ulasilmis/basarisiz filtreleme), `getStats`. |
| `brain/goals/decisions.ts` | `DecisionClassifier` — Bir aksiyonu 3 kategoriye ayirir: `allow` (izin ver), `deny` (yasak), `escalate` (onay gerektirir). Karar `DecisionRule` + `EvidenceDetail` ile aciklanir. `explainDecision(rule, evidence)` ile neden-sonuc dokumantasyonu. |
| `brain/goals/drift.ts` | `GoalDriftDetector` — Pi'nin hedeflerinden sapip sapmadigini tespit eder. GoalStore'u periyodik olarak kontrol eder, sapma varsa `GoalDriftAlert` uretir. |
| `brain/goals/profile-engine.ts` | `AutonomyEngine` — `AutonomyProfile` (seviye 1-4), `ProfileLevelChangeEvent` (yukseltme/dusurme olaylari). `evaluateAction(action)` → onay gerekli mi? seklinde calisir. |
| `brain/goals/protocol.ts` | `UserProtocol` — Kullanicinin belirledigi izin kurallari (allowed/denied/escalated actions listesi). Her kuralda `evidenceRequired` alani vardir. |
| **Test:** `test/brain/goals/*.test.ts` | 6 test dosyasi: decisions, drift, profile-engine, protocol, store, types. |

### P16 — Proposals (Observation → Change Proposal)

Gozlemlerden harekete gecirilebilir oneriler ureten sistemdir. "Su dosyada refactoring yapalim" gibi.

| File | Ne is yapar? |
|---|---|
| `brain/proposals/types.ts` | `MemoryProposalOutput`, `ProposalCreateResult`, `ProposalAcceptResult`, `ProposalRejectResult`, `ProposalCorrectResult`, `ProposalExpireResult` |
| `brain/proposals/generator.ts` | `MemoryProposalGenerator` — Observation/Signal alir, `MemoryProposalOutput` uretir. Her oneri: `action` (ne yapilmali), `rationale` (neden), `impact` (etki analizi), `risk` (risk degerlendirmesi), `evidence` (kanit). |
| `brain/proposals/scoring.ts` | `ProposalScoringEngine` — Onerileri 3 boyutta puanlar: **impact** (etki buyuklugu), **risk** (risk seviyesi), **urgency** (aciliyet). Bilesik skor hesaplar. |
| `brain/proposals/store.ts` | `ProposalStore` — Kalici proposal depolama. Durum bilgisi: created/active/accepted/rejected/expired/implemented. |
| `brain/proposals/dedup.ts` | `ProposalDedupEngine` — Icerik hash'i + benzerlik puani ile ayni onerinin tekrarini engeller. `findDuplicates(newProposal)` → varsa mevcut oneriyi dondurur. |
| `brain/proposals/inbox.ts` | `ProposalInbox` — Onay bekleyen onerilerin kuyrugu. `submit(proposal)` → `needsApproval(threshold)` → `approve(id)` / `reject(id)`. |
| `brain/proposals/api.ts` | Proposal API: CRUD + accept/reject/expire + stats. |
| **Test:** `test/brain/proposals/*.test.ts` | 8 test dosyasi (api, dedup, dogfood-verification, generator, inbox, scoring, store, types). `dogfood-verification.test.ts` E2E testidir. |

### P17 — Reflection & Planning (Gecmisten Ogrenme)

Pi gecmis calismalarini analiz eder, "ne iyi gitti, ne kotu gitti" diye ozet cikarir, ve gelecek planlar icin oneriler sunar.

| File | Ne is yapar? |
|---|---|
| `brain/reflection/types.ts` | `ReflectionReport` (id, planExecId, summary, whatWorked[], whatFailed[], workspaceCount, successRate, etc.), `ReflectionEvent`, `ReflectionStats`, `ReflectionListQuery` |
| `brain/reflection/engine.ts` | `ReflectionEngine` — Bir plan execution'indan calisma raporu cikarir: planExecId'ye gore tum workspace sonuclarini toplar, basari/basarisizlik/retry sayilarini hesaplar, ozet metni olusturur. |
| `brain/reflection/api.ts` | `BrainReflectionApi` — `generateReflection`, `getReflection`, `listReflections`, `getReflectionStats`. |
| `brain/reflection/summarizer.ts` | `ReflectionSummarizer` — Uzun reflection raporlarindan kisa, oz ozetler cikarir. `summarize(report)` → kisa metin. |
| `brain/reflection/future-suggestions.ts` | `FutureSuggestionGenerator` — Reflection pattern'lerinden yola cikarak gelecek planlar icin oneriler olusturur. Mesela "son 3 seferde X testi hep basarisiz olmus, suna bak". |
| `brain/reflection/memory-proposals.ts` | `MemoryProposalGenerator` — Reflection'dan Memory'ye akan oneriler. |
| `brain/plan-factory/engine.ts` | `PlanFactory` — Reflection verisinden yeni bir execution plani uretir. `computePhaseTitle()` public metod ile baslik olusturur. |
| `brain/plan-factory/template.ts` | `MasterTemplateIntegration` — PlanFactory ciktisini master template'e gomen standalone markdown dosyasi uretir. `generateFallbackTemplate()` public. |
| `brain/plan-factory/types.ts` | `PlanBlueprint`, `PhaseTitleBuilder` tipleri. |
| `brain/plan-factory/index.ts` | Plan factory barrel exports. |
| **Test:** `test/brain/reflection/*.test.ts` | 5 test dosyasi (engine, api, summarizer, future-suggestions, memory-proposals). |
| **Test:** `test/brain/plan-factory/*.test.ts` | 2 test dosyasi (engine, template). |
| **Test:** `test/brain/p17-dogfood-verification.test.ts` | E2E dogfood testi. 110+ test, tum P17 akisini kapsar. |

### P18 — Policy, Trust, Audit, Approvals

Guvenlik katmani. Hangi aksiyonlara izin verilecegini, hangilerinin onay gerektirecegini, hangilerinin yasak oldugunu belirler. Her seyi denetim loguna yazar.

| File | Ne is yapar? |
|---|---|
| `brain/policy/types.ts` | `PolicyRule` (id, action, effect: allow/deny/escalate, conditions[], priority), `RuleIndex`, `RuleIndexEntry` |
| `brain/policy/engine.ts` | `PolicyEngine` — Kurallari LRU cache ile degerlendirir. **LRU eviction**: cache hit'te entry'yi delete + re-set yaparak Map insertion order'ini gunceller; `setCacheEntry` en eski key'i atar. `evaluate(action, context)` → `{ effect, matchedRule, explanation }`. |
| `brain/policy/store.ts` | `RuleStore` — Kural CRUD. `addRule`, `getRule`, `updateRule`, `removeRule`, `listRules`, `toggleRule` (aktif/pasif). `createEmptyIndex()` public (test icin). `index` property public (test icin). |
| `brain/policy/provenance.ts` | `ProvenanceTracker` — Kural degisikliklerini ve karar gecmisini kaydeder. `track(change)` → kim, ne zaman, neyi degistirdi. |
| `brain/approvals/gate.ts` | `ApprovalGate` — Cok katmanli onay sistemi. 3 mod: `self_service` (otomatik), `manager_approval` (admin onayi), `paused` (duraklatilmis). `requestApproval(action, context)` → ApprovalTicket. |
| `brain/approvals/api.ts` | `createApprovalGate`, `createApprovalQueueApi`, `getApprovalQueue`, `needsApproval`. |
| `brain/audit/ledger.ts` | `AuditLedger` — Append-only audit log. `.pi/audit/’ altinda JSON dosyalari. `basePath` public (test icin). `append(event)`, `search(query)`, `getStats()`, `getEntries()` |
| **Test:** `test/brain/policy/*.test.ts` | 3 test dosyasi (engine, store, provenance). |
| **Test:** `test/brain/approvals/*.test.ts` | 2 test dosyasi (api, gate). |
| **Test:** `test/brain/audit/*.test.ts` | 1 test dosyasi (ledger). |
| **Test:** `test/brain/p18-dogfood-verification.test.ts` | E2E dogfood testi. |

### P19 — Web Server Brain Routes

10 adet Fastify route dosyasi, `brain/api.ts` uzerinden coding-agent beynine baglanir.

| File | Route | API Fonksiyonu |
|---|---|---|
| `routes/brain/state.ts` | `GET /api/brain/state` | `getBrainState` — Tur store'lardan anlik durum snapshot'i |
| `routes/brain/audit.ts` | `GET /api/brain/audit` | `getAuditEntries`, `getAuditStats` |
| `routes/brain/autonomy.ts` | `GET /api/brain/autonomy` | `getAutonomyProfile`, `getEmergencyStatus`, `updateAutonomyProfile`, `releaseStop` |
| `routes/brain/memories.ts` | `GET/POST/DELETE /api/brain/memories` | `getMemories`, `getMemory`, `getMemoryStats`, `createMemory`, `deleteMemory` |
| `routes/brain/overnight.ts` | `POST/GET /api/brain/overnight` | `OvernightOrchestrator` lifecycle (schedule, startNow, stop, pause, resume, getStatus, getHistory), `getOvernightHistory` |
| `routes/brain/policy.ts` | `GET/POST /api/brain/policy` | `getPolicyRules`, `toggleRule`, `evaluateAction` |
| `routes/brain/approvals.ts` | Approval API routes | ApprovalQueueApi |
| `routes/brain/proposals.ts` | Proposal API routes | BrainProposalApi |
| `routes/brain/protocol.ts` | Protocol API routes | UserProtocol |
| `routes/brain/reflections.ts` | Reflection API routes | BrainReflectionApi |

### P20 — Overnight Execution (Gece Otonom Calistirma)

Gece boyunca plansiz calistirma yapar, sabah rapor verir. Tam bir "gece vardiyasi" sistemidir.

| File | Ne is yapar? |
|---|---|
| `brain/overnight/orchestrator.ts` | `OvernightOrchestrator` — **Promise-chain mutex** (`withSessionMutex`) ile schedule/start/stop/pause/resume islemleri korunur. `OvernightSession` objesi: id, planExecIds[], status (scheduled/running/completed/stopped/failed), progress, createdAt, startedAt, completedAt, stopReason. `getHistory(limit)` gecmis session'lari dondurur. `checkStopConditions()` → stop nedenlerini kontrol eder (max_duration_reached, error_threshold_exceeded, vb.). |
| `brain/overnight/morning-report.ts` | `MorningReportGenerator` — Tamamlanan seans icin sabah raporu uretir: kac plan tamamlandi, kac basarisiz, ne kadar surdu, genel ozet. `renderMarkdown(report)` → kullaniciya gosterilecek markdown. |
| `brain/overnight/validation.ts` | `FullLoopValidator` — 5 built-in senaryo: `full_autonomous`, `safety_stop`, `error_recovery`, `resource_cleanup`, `rollback_test`. `listScenarios()`, `runScenarioById(id)`, `runAllScenarios()`. |
| `brain/overnight/trust-assessment.ts` | `TrustAssessor` — 4 boyutlu guven skoru: **safety** (guvenlik), **reliability** (guvenilirlik), **transparency** (seffaflik), **userControl** (kullanici kontrolu). Her boyut icin kriter listesi ve `assessDimension(name)` metodu. `assess()` → tum boyutlardan bilesik skor (0-100). |
| `brain/overnight/dogfood-report.ts` | `DogfoodReportGenerator` — Dogfood verification raporu. Scenarios + trust assessment'i birlestirir, sign-off mekanizmasi icerir. |
| `brain/overnight/index.ts` | Barrel export + `SessionStore` (in-memory ephemeral session store, update/getAll/remove/clear metodlari). |
| **Test:** `test/brain/overnight/*.test.ts` | 3 test dosyasi: orchestrator, morning-report, p20-dogfood-overnight. |

### brain/api.ts — Unified API Layer

24 fonksiyonluk API katmani. `brain/index.ts` uzerinden re-export edilir. Her web-server route dosyasi bu API'yi cagirir.

| Fonksiyon | Modul |
|---|---|
| `getAuditEntries`, `getAuditStats` | AuditLedger |
| `getAutonomyProfile`, `getEmergencyStatus`, `updateAutonomyProfile`, `releaseStop`, `emergencyStop` | AutonomyEngine |
| `getMemories`, `getMemory`, `getMemoryStats`, `createMemory`, `deleteMemory`, `updateMemory`, `rejectMemory` | Memory |
| `getObservations`, `getSignals`, `getTimeline`, `getBrainState` | Brain Core (P13) |
| `getPolicyRules`, `toggleRule`, `evaluateAction`, `getOvernightHistory` | Policy + Overnight |
| `activateMemory`, `getProvenance` | Memory + Provenance |

### Thread Safety Patterns

Butun V2 beyni, asagidaki thread safety pattern'lerini kullanir (JS single-thread olsa da async interleaving'e karsi):

| Pattern | Kullanildigi Yerler |
|---|---|
| **Promise-chain mutex** (`withMutex`) | `InMemoryBrainTimelineStore` (turn), `OvernightOrchestrator` (session lifecycle), `MemoryStore` (atomic operations) |
| **Double-check locking** | `MemoryStore.get()`: once index'te ara (hizli), bulamazsa lock alip dogrudan dosyadan oku (TOCTOU onlemi) |
| **LRU eviction (Map re-insertion)** | `PolicyEngine` cache: hit'te delete+re-set, setChe'de ilk key'i at |
| **fsync before rename** | `MemoryStore.atomicWrite()`: dosyayi ac → write → fsync → kapat → rename. Guclu crash safety. |

---

## Reference Documents

| File | Purpose |
|---|---|
| `docs/findings_v20.md` | P13-P20 code review findings (7 items: API exports, mutex, double-check locking, LRU, fsync, SessionStore docs) |
| `docs/llm-implementation-agent-master-template.md` | **Canonical plan template v2.5.0** — Updated with continuous scheduling defaults, worktree isolation enabled |
| `docs/pi_autonomous_multiagent_plan_executor.md` | **Phase P2 plan** — Plan parser, workspace schema, DAG scheduler, autonomous execution loop |
| `docs/pi/performance/prompt-cache-architecture.md` | **Prompt cache architecture** (P5.5.A) — Cacheable prefix/dynamic suffix split |
| `docs/pi/stability/p5-5-performance-cache-report.md` | **P5.5 stability report** — E2E validation metrics, cache hit rates |
| `docs/phase_p_6_large_project_scale_reliability.md` | **Phase P6 plan** — Worktree isolation, dynamic scheduling, integration queue |
| `docs/pi/scale/worktree-isolation.md` | **Worktree isolation design** — Git worktrees for isolated workspace executions |
| `docs/pi/stability/p6-large-project-scale-report.md` | **P6 stability report** |
| `docs/phase_p_9_remediation.md` | **Phase P9 plan** — Remediation for self-healing plan execution |
| `docs/p10-dashboard-redesign-plan-p10r.md` | **P10 dashboard redesign plan** (1557 lines) |
| `docs/p11.0-verification-report.md` | **P11 verification report** |
| `docs/p11_ecosystem_continuous_self_improvement_implementation_plan.md` | **P11 implementation plan** |

### Reports Directory

| Report | Description |
|---|---|
| `reports/p9h-remediation/` | P9.H remediation plan, dry-run report, optimized DAG, risk report, rollback plan, audit log |
| `reports/p9g4-dryrun-validation/` | P9.G4 dry-run validation — assumptions report, validation report, error records |
| `reports/p9g7-governance-ledger/` | P9.G7 governance ledger integration overview |
| `reports/p9i-dogfood-safety/` | P9.I dogfood and safety report — dogfood report, safety report, DoD verification |

---

## File Tree — `packages/ai`

```
packages/ai/
  src/
    prompt-cache.ts                # PromptCachePolicy — cacheable prefix/dynamic suffix split, prefix hashing, assembly
    index.ts                       # Re-exports prompt-cache.ts in addition to existing exports
    models.generated.ts            # Updated model data (multiple commits)
    env-api-keys.ts                # Security fix: stopped caching env secrets in /proc/self/environ fallback
    oauth.ts                       # OAuth state/PKCE verifier separated for security
    utils/
      oauth/
        anthropic.ts               # OAuth security improvements
        pkce.ts                    # PKCE verifier separated from OAuth state
    ... (other source files unchanged structurally)
  test/
    prompt-cache-policy.test.ts    # 450-line exhaustive test suite for prompt cache policy
```

### `src/prompt-cache.ts` — Prompt Cache Architecture

Core prompt caching logic separating cacheable prefix from dynamic suffix:

| Export | Purpose |
|---|---|
| `CACHE_PREFIX_VERSION` | Current prefix version constant (v1) — bump when safety/policy rules change |
| `PromptAssembly` | Result type: version + prefix (cacheable) + suffix (dynamic messages) |
| `PromptPrefix` | Cacheable portion: systemPrompt, tools, pinnedMessages |
| `assemblePrompt(context, options)` | Splits context into prefix/suffix based on pinnedMessageCount |
| `computePrefixHash(prefix)` | Stable hash of prefix content (deterministic, order-independent for tools) |
| `computeContextPrefixHash(context, options)` | Hash directly from Context |
| `prefixHashStableAcrossSuffixChange(a, b)` | Verify hash stability across suffix-only changes |

---

## File Tree — `packages/coding-agent`

```
packages/coding-agent/src/
  cli/
    plan-commands.ts               # Updated for P6.5: worktree config, schema v2.3.2+, continuous scheduling
  context/
    context-builder.ts             # Static/dynamic context split, context section classification, budget enforcement
    context-section.ts             # ContextSection types + cacheability rules (static/semi-static/dynamic)
    workspace-packet.ts            # WorkspacePacket — deterministic contract hashing, state separated from contract
  core/
    agent-session-runtime.ts       # Agent session runtime
    agent-session-services.ts      # Agent session services
    agent-session.ts               # Core agent session
    auth-guidance.ts               # Auth guidance messages
    auth-storage.ts                # Auth credential storage
    auto-commit.ts                 # Auto-commit logic
    autonomous-executor.ts         # AutonomousExecutor — orchestrates workspaces, abort support, worktree config wiring, GlobalReadyQueue, DynamicParallelScheduler integration, orphan process killing
    bash-executor.ts               # Bash execution with validation lock
    budget-enforcer.ts             # NEW (P11) — Budget enforcement for proposal execution (475 lines)
    capability-policy-engine.ts    # NEW (P11) — Capability policy engine for extension/skill permissions (1011 lines)
    cleanup-review.ts              # Cleanup/review worker — TOCTOU fixed, async exec, orphan process killing, rerun-cleanup endpoint support
    compaction/                    # Context compaction (branch-summarization, compaction, utils)
    completion-gate.ts             # Completion gate — block reasons written to workspace state error field
    context-budget.ts              # Context budget limits per role
    context-packet.ts              # Context packet assembly
    continuous-executor.ts         # NEW (P6.5) — Continuous scheduling executor (247 lines)
    dag-analyzer.ts                # DAG analysis for plan optimization
    dag-optimizer.ts               # DAG optimizer
    database-state-store.ts        # PostgreSQL state store — cache_hit_rate from cache_usage events
    defaults.ts                    # Default configuration values
    dependency-patch.ts            # Dependency patch utilities
    detection-engine.ts            # Detection engine for plan issues
    detection-types.ts             # Detection type definitions
    diagnostics.ts                 # Diagnostics utilities
    draft-planner.ts               # Draft plan generation
    edit-attempt-tracker.ts        # Edit attempt tracking
    edit-audit-events.ts           # Edit audit event types
    edit-failure-handoff.ts        # Edit failure handoff
    edit-strategy-policy.ts        # Edit strategy policy
    edit-strategy-types.ts         # Edit strategy types
    event-bus.ts                   # Event bus
    exec.ts                        # Command execution utilities
    execution-archive.ts           # Execution archiving
    execution-simulator.ts         # Execution simulation
    execution-stats.ts             # Execution statistics
    execution-visibility.ts        # Execution visibility events
    export-html/                   # HTML export (ansi-to-html, tool-renderer, index)
    extensions/                    # Extension system
      index.ts                     # Extension exports
      loader.ts                    # Extension loader
      registry.ts                  # Extension registry (572 lines)
      runner.ts                    # Extension runner
      runtime-host.ts              # NEW — Extension runtime host (561 lines)
      types.ts                     # Extension types (117 lines)
      validate.ts                  # Extension manifest validation (318 lines)
      wrapper.ts                   # Extension tool wrapper
    false-positive-tracker.ts      # False positive tracking for tests
    file-policy.ts                 # File access policy
    footer-data-provider.ts        # Footer data provider
    governance-ledger.ts           # NEW (P11) — Governance ledger for audit trail (703 lines)
    graph-diff-engine.ts           # NEW (P11) — Original-vs-optimized graph diffs (886 lines)
    index.ts                       # P11: extension exports, skill exports, orchestrator exports, platform audit exports; removed stale P11.A types
    json-state-store.ts            # JSON state store — cache_hit_rate from cache_usage events; security fixes
    keybindings.ts                 # Keybinding configuration
    log-failure-detector.ts        # Log-based failure detection
    messages.ts                    # Message utilities
    model-registry.ts              # Model registry
    model-resolver.ts              # Model resolver
    output-guard.ts                # Output guard
    package-manager.ts             # Package manager for skill packages
    patch-approval-engine.ts       # NEW (P11) — Patch approval engine (668 lines)
    patch-plan.ts                  # Patch plan utilities
    plan-control.ts                # Plan control signals
    plan-graph-diff.ts             # NEW (P11) — Plan graph diff logic (568 lines)
    plan-intake-analyzer.ts        # NEW (P11) — Automated plan intake analysis (638 lines)
    plan-parser.ts                 # Plan parser — P6 contract format support
    plan-queue-runner.ts           # Plan queue runner
    plan-state.ts                  # Plan state types — cache_usage, cleanup/review, proposal journal events
    planner-feedback-loop.ts       # Planner feedback loop
    planner.ts                     # Planner — proposal generation integration (111+ lines)
    platform-audit-ledger.ts       # NEW (P11) — Platform-level audit events (535 lines)
    production-readiness-doctor.ts # — Converted to fully async, no execSync
    prompt-templates.ts            # Prompt template management
    proposal-execution-pipeline.ts # NEW (P11) — Full proposal execution pipeline (1013 lines)
    proposal-inbox.ts              # NEW (P11) — Proposal inbox for orchestrator
    provider-display-names.ts      # Provider display names
    remediation-policy-engine.ts   # NEW (P11) — Remediation policy engine (875 lines)
    remediation-runtime.ts         # NEW (P11) — Remediation runtime (1385 lines)
    replay-metadata.ts             # Replay metadata
    resolve-config-value.ts        # Config value resolution
    resource-loader.ts             # Resource loading
    resume-confidence.ts           # Resume confidence scoring
    retry-handler.ts               # Retry handling
    role-packets.ts                # Role packet definitions
    safety-doctor.ts               # Safety pre-flight checks
    safety-profile.ts              # Safety profiles
    scheduler-diagnostics.ts       # Scheduler diagnostics tracking
    scheduler.ts                   # NEW (P6.5) — Shared Scheduler interface + scheduling types (SkipReason, SchedulingDecision, SchedulerDiagnostics) (223 lines)
    sdk.ts                         # SDK entry point
    self-modification-firewall.ts  # Self-modification safety firewall
    session-cwd.ts                 # Session working directory
    session-manager.ts             # Session management
    settings-manager.ts            # Settings management
    skill-manifest.ts              # Skill manifest parsing
    skill-output-artifact.ts       # NEW (P11) — Skill output artifact handling (333 lines)
    skill-package-manager.ts       # NEW (P11) — Skill package manager (881 lines)
    skill-package.ts               # NEW (P11) — Skill package model (294 lines)
    skill-quality.ts               # NEW (P11) — Skill quality scoring (460 lines)
    skill-registry.ts              # Skill registry
    skill-runner.ts                # Skill execution
    skills.ts                      # Skill management
    slash-commands.ts              # Slash command handling
    source-info.ts                 # Source information
    state-store.ts                 # State store interface
    system-prompt.ts               # System prompt building
    telemetry.ts                   # Telemetry
    timings.ts                     # Timing utilities
    token-metering.ts              # Token metering
    tools/                         # Tool implementations
      bash.ts                      # P6.5: validation lock wrapping ops.exec()
      edit-diff.ts                 # Diff-based edit tool
      edit.ts                      # Edit tool
      file-mutation-queue.ts       # File mutation queue
      find.ts                      # Find tool (security: pure Node.js walk, no shell injection)
      grep.ts                      # Grep tool
      index.ts                     # Tool exports
      ls.ts                        # Ls tool
      output-accumulator.ts        # Output accumulator
      path-utils.ts                # Path utilities
      read.ts                      # Read tool
      render-utils.ts              # Render utilities
      tool-definition-wrapper.ts   # Tool definition wrapper
      truncate.ts                  # Output truncation
      write.ts                     # Write tool
    truncation-detector.ts         # Truncation detection
    unsafe-suggestion-guard.ts     # Unsafe suggestion guard
    utils/
      shell.ts                     # P6.5: installValidationSpawnLock() — global spawn interceptor for validation
    validation-lock.ts             # AsyncLock with reset() for test cleanup
    validation-result.ts           # Validation result types
    watch-mode-guard.ts            # Watch mode guard
    worker-concurrency.ts          # Worker concurrency management
    worker-memory-guard.ts         # Worker memory guard — TOCTOU fixed
    workspace-agent-executor.ts    # WorkspaceAgentExecutor — cache_usage events, worker_status events, thinking buffer, abort support, worktree config
    workspace-scheduler.ts         # NEW (P6.5) — Scheduler interface + DynamicParallelScheduler (continuous scheduling, priority scorer, GlobalReadyQueue, WorktreePool)
    workspace-schema.ts            # Schema v2.3.2, v2.4.0, v2.5.0; hardDeps/softDeps/readSet/writeSet; isV230Plus validation
    write-gate.ts                  # Write gate
  memory/
    organic-forbidden-patterns.ts  # NEW (P11.F) — Organic memory forbidden patterns (360 lines)
    organic-memory-schema.ts       # NEW (P11.F) — Organic memory schema (352 lines)
  orchestrator/
    orchestrator-daemon.ts         # NEW (P11.B) — Periodic scan loop for continuous observation, ProposalInbox integration (512+ lines)
  brain/
    (See V2 Brain — Cognitive OS section above for complete brain/ file tree)
  memory/
    execution-memory.ts            # ExecutionMemory — relevance scoring
    execution-memory-store.ts      # ExecutionMemoryStore — prior run reuse, summarization, scoring
  retrieval/
    local-repo-index.ts            # LocalRepoIndex — snippet-level search
    retrieval-service.ts           # RetrievalService — context fetching
  repo-graph/
    repo-symbol-graph.ts           # RepoSymbolGraph — maps files to tests
    repo-graph-builder.ts          # Builds symbol graph
  scheduler/
    dynamic-scheduler.ts           # P6.5: implements Scheduler interface, v2 default, GlobalReadyQueue, WorktreePool, continuous scheduling
    scale-mode-policy.ts           # Scale mode policy
  integration/
    integration-queue.ts           # Integration queue
    integration-branch.ts          # Integration branch
    merge-conflict-handoff.ts      # Merge conflict resolution
  validation/
    validation-planner.ts          # ValidationPlanner — decision tree
    test-impact-analyzer.ts        # Test impact analysis
  worktree/
    worktree-manager.ts            # Worktree manager — fixed execAsync (no execSync)
    worktree-cleanup.ts            # Worktree cleanup — improved
    worktree-types.ts              # Worktree type definitions
    worktree-workspace-executor.ts # P6.5: worktree config wiring, worktree workspace execution
  failure/
    failure-classifier.ts          # Failure classification
    retry-router.ts                # Retry routing strategy
  doctor/
    scale-readiness-doctor.ts      # Scale readiness — converted to async (no execSync)

test/
  budget-enforcer.test.ts          # NEW — 482 lines
  capability-policy-engine.test.ts # NEW (P11) — 19 lines (initial)
  continuous-executor.test.ts      # NEW (P6.5)
  planner.test.ts                  # NEW — 424 lines
  plan-graph-diff.test.ts          # NEW (P11) — 463 lines
  proposal-execution-pipeline.test.ts  # NEW (P11) — 872 lines
  remediation-policy-engine.test.ts    # NEW (P11) — 566 lines
  remediation-runtime.test.ts          # NEW (P11) — 533 lines
  remediation-runtime-p9-g3.test.ts    # NEW (P11) — 699 lines
  remediation-runtime-p9-g4.test.ts    # NEW (P11) — 1173 lines
  remediation-runtime-p9-g7.test.ts    # NEW (P11) — 671 lines
  skill-output-artifact.test.ts    # NEW (P11)
  skill-package-manager.test.ts    # NEW (P11)
  skill-package.test.ts            # NEW (P11)
  skill-quality.test.ts            # NEW (P11)
  (plus all existing test files from P5.5/P6 era)
  suite/regressions/
    orchestrator-proposal-generator.test.ts  # NEW (P11)
    p11-ecosystem-integration.test.ts        # NEW (P11) — 223 lines, 7 integration tests
    (plus all existing regression tests)
```

---

## File Tree — `packages/web-server`

```
packages/web-server/
  src/
    index.ts                       # Fastify server — chat history/threads API, chat compact, extensions routes, rerun-cleanup, file browse/search, security limits (CORS, body limit)
    plan-runner.ts                 # Background plan execution — worktree config, completion bus reset, cleanup review rerun, abort on stop
    plan-markdown.ts               # Plan markdown handling — added 'plan-handoff' type, 'awaiting_handoff' status
    scale-routes.ts                # P6 scale routes — fixed async (no execSync), readiness reflects actual config
    extensions-routes.ts           # NEW (P11.P) — Extension lifecycle API (list, install, update, rollback, enable/disable)
    skills-routes.ts               # NEW (P11.K) — Skill backend API (install, update, remove, test, invoke, recommend)
    proposal-routes.ts             # P11 — Updated with expanded proposal endpoints
    memory-routes.ts               # NEW (P11.L) — Memory management API routes
    policy-audit-routes.ts         # NEW (P11.R) — Policy audit API routes
    orchestrator-routes.ts         # NEW (P11) — Orchestrator API routes
    performance-routes.ts          # P5.5.G — Performance telemetry dashboard routes
    artifact-routes.ts             # Artifact management routes
    docs-export.ts                 # Documentation export
    execution-archive.ts           # Execution archiving
    log-stream-routes.ts           # Log streaming routes
    plan-preview.ts                # Plan preview routes
    state-store-provider.ts        # State store provider singleton
  routes/
    brain/                         # V2 Brain routes (see P19 section for details)
      state.ts
      audit.ts
      autonomy.ts
      memories.ts
      overnight.ts
      policy.ts
      approvals.ts
      proposals.ts
      protocol.ts
      reflections.ts
  test/
    scale-routes.test.ts           # 423 lines
    performance-routes.test.ts     # 508 lines
    log-buffer.test.ts             # 164 lines
```

---

## File Tree — `packages/web-ui/dashboard`

```
packages/web-ui/dashboard/src/
  App.tsx                          # Chat dialog integration, platform nav group with LeftNav, extensions/skills panels
  app.css                          # Animations for ThinkingAnimation, fade-in log lines, chat tool badges
  types.ts                         # PerformanceMetric types + chat-related types
  types-artifacts.ts               # Artifact types
  main.tsx                         # Entry point
  components/
    ChatPanel.tsx                  # COMPLETELY REWORKED — centered dialog (max-w-4xl), markdown rendering, colored tool badges, thinking animation, status bar (provider/model selector, context meter, compact button), searchable model dropdown, persistent threads, @-triggered telescope file search, message editing, regeneration, code copy, fullscreen, timestamps, scroll-to-bottom
    DagDiffViewer.tsx              # NEW (P11) — DAG diff visualization (438 lines)
    OptimizerApprovalPanel.tsx     # NEW (P11) — Plan optimizer approval UI (593 lines)
    SafeBatchPreview.tsx           # NEW (P11) — Safe batch preview UI (363 lines)
    LeadAgentDashboard.tsx         # P11 — Fixed infinite re-render, proposal selection
    ProposalCard.tsx               # P11 — Updated proposal display
    PlanIntakePanel.tsx            # NEW (P11) — Plan intake analysis UI (427 lines)
    PolicyAuditCenter.tsx          # NEW (P11) — Policy audit UI (382 lines)
    MemoryCockpitPanel.tsx         # NEW (P11) — Memory health metrics UI (750 lines)
    ExtensionsManager.tsx          # Extension management UI
    SkillsManager.tsx              # Skill management UI
    PlanSummaryPanel.tsx           # Updated — rerun cleanup button
    WorkerDetail.tsx               # Updated — live agent state, failed/blocked banners
    LiveLogTerminal.tsx            # Updated — fade-in animations
    ThinkingAnimation.tsx          # Animated agent state
    PerformancePanel.tsx           # P5.5.G — Performance telemetry dashboard
    ScaleCockpitPanel.tsx          # Scale mode cockpit UI
    ScaleModeSettings.tsx          # P6 scale mode settings
    WorktreeStatusPanel.tsx        # P6 worktree status
    SchedulerStatusPanel.tsx       # P6.5 scheduler status UI
    IntegrationQueuePanel.tsx      # P6 integration queue
    MergeConflictPanel.tsx         # P6 merge conflict
    WorkerP6LifecycleTab.tsx       # P6 worker lifecycle
    WorktreeCleanupDialog.tsx      # Worktree cleanup dialog
  features/
    autonomy/
      AutonomyCenter.tsx           # NEW (P11) — Autonomy center UI
      AutonomyProposalCard.tsx     # NEW (P11) — Autonomy proposal card
      OrchestratorHealthPanel.tsx  # NEW (P11) — Orchestrator health panel
    memory/
      MemoryCockpit.tsx            # NEW (P11) — Memory cockpit feature UI (386 lines)
      MemoryCockpitPanel.tsx       # NEW (P11) — Memory cockpit panel (750 lines)
      index.ts                     # Memory feature exports (7 lines)
    plan-intake/
      PlanIntakePanel.tsx          # NEW (P11) — Plan intake feature UI (427 lines)
    policy-audit/
      PolicyAuditCenter.tsx        # NEW (P11) — Policy audit center feature UI (382 lines)
    settings/
      RegistrySettings.tsx         # Registry settings UI
  hooks/
    useMemoryMetrics.ts            # NEW (P11) — Memory metrics hook (311 lines)
    useOptimizerApproval.ts        # NEW (P11) — Optimizer approval hook (319 lines)
    useOrchestratorHealth.ts       # NEW (P11) — Orchestrator health hook
    useProposals.ts                # P11 — Proposals hook
    useExtensions.ts               # Updated — better 404 error message
    usePerformanceMetrics.ts       # P5.5.G — Performance metrics hook
    useScaleStatus.ts              # P6 scale status hook
    useSkills.ts                   # Skills hook
  stubs/
    child_process.ts, crypto.ts, fs-promises.ts, fs.ts, os.ts, path.ts  # Dashboard Node.js stubs
  utils/
    format.ts                      # Formatting utilities
    performance-metrics.ts         # Performance metrics utilities
```

---

## File Tree — `packages/db` (Restored in P11)

```
packages/db/
  src/
    index.ts                       # Restored — db package entry point
    types.ts                       # Updated with proposal and plan-revision types (21 lines added)
    migrations/
      index.ts                     # Updated migration registry
      006_add_proposal_source_and_revisions.ts  # NEW — adds proposal source and revision tracking
    repositories/
      index.ts                     # Updated repository exports
      plan-execution.ts            # Updated plan execution queries
      plan-revision.ts             # NEW — plan revision repository (149 lines)
      proposal.ts                  # NEW — proposal repository (67 lines)
  test/
    repositories.test.ts           # NEW — 331 lines of repository tests
```

---

## Execution Infrastructure (P2, P6, P6.5)

Plan upload → parse → schedule → execute → cleanup akisini yoneten sistem. Worktree isolation, continuous scheduling, parallel workspace calistirma.

### Core Files (`packages/coding-agent/src/core/`)

| File | Description |
|---|---|
| `autonomous-executor.ts` | AutonomousExecutor — orchestre les workspaces, integration GlobalReadyQueue + DynamicParallelScheduler, orphane process killing, abort. |
| `workspace-scheduler.ts` | WorkspaceScheduler (v1) + DynamicParallelScheduler (v2, default). GlobalReadyQueue (batch-barrier-free), WorktreePool (prewarm, lease, crash recovery). Priority scorer: criticalPathRemaining * 100 + downstreamBlocking * 20 + ageBoost - conflictRiskPenalty. |
| `scheduler.ts` | Scheduler interface + types (SkipReason, SchedulingDecision, SchedulerDiagnostics) |
| `continuous-executor.ts` | Continuous scheduling executor (P6.5, default mode) |
| `workspace-agent-executor.ts` | Per-workspace LLM execution, aborts, cache tracking, live status events |
| `workspace-schema.ts` | Schema v2.3.2/2.4.0/2.5.0, hardDeps/softDeps/readSet/writeSet, isV230Plus validation |
| `plan-parser.ts` | Plan parser — P6 contract format |
| `plan-queue-runner.ts` | Plan queue runner |
| `cleanup-review.ts` | Cleanup/review worker — re-runnable, orphan process killing, TOCTOU-fixed |
| `completion-gate.ts` | Block reasons written to workspace state error field |
| `bash-executor.ts` | Bash execution with validation lock |
| `tools/` | Tool implementations: `bash.ts` (validation lock), `edit.ts`, `read.ts`, `write.ts`, `find.ts` (Node.js walk, no shell injection), `grep.ts`, `ls.ts` |
| `utils/shell.ts` | `installValidationSpawnLock()` — global spawn interceptor |

### Parallel Execution Support (`scheduler/`, `worktree/`, `integration/`, `failure/`, `validation/`)

| Directory | Files | Description |
|---|---|---|
| `scheduler/` | `dynamic-scheduler.ts`, `scale-mode-policy.ts` | DynamicParallelScheduler implementation, scale mode policy |
| `worktree/` | `worktree-manager.ts`, `worktree-cleanup.ts`, `worktree-types.ts`, `worktree-workspace-executor.ts` | Git worktree isolation, cleanup, workspace execution in worktrees |
| `integration/` | `integration-queue.ts`, `integration-branch.ts`, `merge-conflict-handoff.ts` | Parallel workspace merging |
| `failure/` | `failure-classifier.ts`, `retry-router.ts` | Failure classification and retry strategies |
| `validation/` | `validation-planner.ts`, `test-impact-analyzer.ts` | Targeted test selection |

### Doctor & Safety

| File | Description |
|---|---|
| `production-readiness-doctor.ts` | Fully async, no execSync |
| `safety-doctor.ts` | Pre-flight safety checks |
| `safety-profile.ts` | Safety profiles |
| `scale-readiness-doctor.ts` | Scale readiness checks (async) |
| `self-modification-firewall.ts` | Self-modification safety checks |

### State Stores

| File | Description |
|---|---|
| `state-store.ts` | IStateStore interface |
| `json-state-store.ts` | JSON file state store |
| `database-state-store.ts` | PostgreSQL state store |
| `session-manager.ts` | Session management |
| `settings-manager.ts` | Settings management |

---

## P11 — Continuous Self-Improvement Ecosystem

P6/P6.5 execution engine'inin ustune insa edilmis, kendini iyilestirme ekosistemi.

### Orchestrator

| File | Description |
|---|---|
| `orchestrator/orchestrator-daemon.ts` | Periodic scan loop for continuous observation. ProposalInbox integration (512+ lines) |
| `core/proposal-inbox.ts` | Queues generated proposals for approval |

### Remediation

| File | Description |
|---|---|
| `core/remediation-policy-engine.ts` | Policy-driven remediation (875 lines) |
| `core/remediation-runtime.ts` | Self-healing execution (1385 lines) |
| `core/governance-ledger.ts` | Audit trail (703 lines) |
| `core/platform-audit-ledger.ts` | Platform-level audit events (535 lines) |

### Plan Analysis & Optimization

| File | Description |
|---|---|
| `core/plan-intake-analyzer.ts` | Automated plan intake analysis, bottleneck detection, critical path (638 lines) |
| `core/graph-diff-engine.ts` | Original-vs-optimized graph diffs, safety checks, approval lifecycle (886 lines) |
| `core/plan-graph-diff.ts` | Plan graph diff logic (568 lines) |
| `core/patch-approval-engine.ts` | Patch approval lifecycle (668 lines) |
| `core/proposal-execution-pipeline.ts` | Full proposal execution pipeline (1013 lines) |

### Skills & Extensions

| File | Description |
|---|---|
| `core/budget-enforcer.ts` | Budget enforcement for proposal execution (475 lines) |
| `core/capability-policy-engine.ts` | Extension/skill permissions (1011 lines) |
| `core/skill-package-manager.ts` | Skill publishing/versioning (881 lines) |
| `core/skill-package.ts` | Skill package model (294 lines) |
| `core/skill-quality.ts` | Skill quality scoring (460 lines) |
| `core/skill-output-artifact.ts` | Artifact handling (333 lines) |
| `extensions/runtime-host.ts` | Extension runtime host (561 lines) |
| `extensions/registry.ts` | Extension registry (572 lines) |
| `extensions/validate.ts` | Extension manifest validation (318 lines) |

### Organic Memory (P11.F)

| File | Description |
|---|---|
| `memory/organic-forbidden-patterns.ts` | Forbidden patterns (360 lines) |
| `memory/organic-memory-schema.ts` | Memory schema (352 lines) |

---

## Web Server (`packages/web-server/`)

Fastify server on port 3000. Serves dashboard UI, REST API, SSE streams, WebSocket logs.

### Brain Routes (`src/routes/brain/`)

See P19 section above. 10 route files, all backed by `brain/api.ts`.

### Main Server (`src/index.ts`)

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/chat/history` | Chat session history |
| `POST /api/chat` | Save user messages before processing |
| `POST /api/chat/compact` | Compact chat context |
| `GET /api/projects/:id/files/browse` | Directory listing (@-triggered browser) |
| `GET /api/projects/:id/files/search` | File search |
| `POST /api/projects/:id/plans/:execId/rerun-cleanup` | Re-trigger cleanup review |
| `GET /api/extensions*` | Extension lifecycle API |
| `GET /api/skills*` | Skill backend API |

Security: Fastify body limit 10MB, CORS restricted to local origins.

### Other Server Files

| File | Description |
|---|---|
| `plan-runner.ts` | Background plan execution — worktree config, completion bus reset, abort |
| `plan-markdown.ts` | Plan markdown handling (+ 'plan-handoff' type) |
| `scale-routes.ts` | Scale mode routes (async, reflect actual config) |
| `extensions-routes.ts` | Extension lifecycle API (445 lines) |
| `skills-routes.ts` | Skill backend API (497 lines) |
| `proposal-routes.ts` | Proposal endpoints |
| `memory-routes.ts` | Memory management routes |
| `policy-audit-routes.ts` | Policy audit routes |
| `orchestrator-routes.ts` | Orchestrator routes |

---

## Web UI Dashboard (`packages/web-ui/dashboard/`)

React + Vite dashboard with chat dialog, plan monitoring, and V2 brain UIs.

### Main Chat

| File | Description |
|---|---|
| `components/ChatPanel.tsx` | Centered dialog (max-w-4xl), markdown rendering (react-markdown), colored tool badges, thinking animation, status bar (provider/model selector, context meter, compact button), searchable model dropdown, persistent threads, @-triggered file search, message editing, regeneration, code copy, fullscreen, timestamps. Most heavily modified component (9+ commits). |

### V2 Brain Dashboard Components

| File | Description |
|---|---|
| `components/LeadAgentDashboard.tsx` | P11 — Proposal selection, fixed infinite re-render |
| `components/ProposalCard.tsx` | Proposal display |
| `components/PlanIntakePanel.tsx` | Plan intake analysis UI (427 lines) |
| `components/PolicyAuditCenter.tsx` | Policy audit UI (382 lines) |
| `components/MemoryCockpitPanel.tsx` | Memory health metrics UI (750 lines) |
| `components/DagDiffViewer.tsx` | DAG diff visualization (438 lines) |
| `components/OptimizerApprovalPanel.tsx` | Plan optimizer approval UI (593 lines) |
| `components/SafeBatchPreview.tsx` | Safe batch preview UI (363 lines) |
| `features/autonomy/AutonomyCenter.tsx` | Autonomy center with orchestration health |
| `features/memory/MemoryCockpit.tsx` | Memory cockpit feature panel (386 lines) |
| `features/plan-intake/PlanIntakePanel.tsx` | Plan intake feature UI (427 lines) |
| `features/policy-audit/PolicyAuditCenter.tsx` | Policy audit center (382 lines) |

### Execution Monitoring Components

| File | Description |
|---|---|
| `components/PlanSummaryPanel.tsx` | Rerun cleanup button |
| `components/WorkerDetail.tsx` | Live agent state, failed/blocked banners |
| `components/LiveLogTerminal.tsx` | Live log streaming with fade-in |
| `components/PerformancePanel.tsx` | P5.5.G performance telemetry |
| `components/ScaleCockpitPanel.tsx` | Scale mode cockpit |
| `components/ScaleModeSettings.tsx` | P6 scale mode settings |
| `components/WorktreeStatusPanel.tsx` | Worktree status |
| `components/SchedulerStatusPanel.tsx` | P6.5 scheduler status |
| `components/IntegrationQueuePanel.tsx` | Integration queue |
| `components/MergeConflictPanel.tsx` | Merge conflict |
| `components/ExtensionsManager.tsx` | Extension management |
| `components/SkillsManager.tsx` | Skill management |

### Hooks

| Hook | Description |
|---|---|
| `useMemoryMetrics.ts` | P11 — Memory metrics (311 lines) |
| `useOptimizerApproval.ts` | P11 — Optimizer approval (319 lines) |
| `useOrchestratorHealth.ts` | P11 — Orchestrator health |
| `useProposals.ts` | P11 — Proposals |
| `useExtensions.ts` | Extension management (404 detection) |
| `usePerformanceMetrics.ts` | P5.5 performance metrics |

---

## Supporting Packages

### `packages/ai/` — AI Provider Abstraction

| File | Description |
|---|---|
| `src/prompt-cache.ts` | PromptCachePolicy — cacheable prefix/dynamic suffix split, prefix hashing, versioned assembly |
| `src/index.ts` | Re-exports prompt-cache |
| `src/models.generated.ts` | Generated model data |
| `src/env-api-keys.ts` | Security: no env secret caching |
| `src/oauth.ts` | OAuth state/PKCE separation |
| `utils/oauth/anthropic.ts`, `pkce.ts` | OAuth security improvements |
| `test/prompt-cache-policy.test.ts` | 450-line test suite |

### `packages/db/` — PostgreSQL Persistence (Restored in P11)

| File | Description |
|---|---|
| `src/index.ts` | Entry point |
| `src/types.ts` | Proposal and plan-revision types |
| `src/migrations/006_add_proposal_source_and_revisions.ts` | Adds proposal source and revision tracking |
| `src/repositories/proposal.ts` | Proposal repository (67 lines) |
| `src/repositories/plan-revision.ts` | Plan revision repository (149 lines) |
| `test/repositories.test.ts` | 331-line test suite |

---

## File Tree — Brain Tests

```
packages/coding-agent/test/brain/
  approvals/
    api.test.ts
    gate.test.ts
  audit/
    ledger.test.ts
  goals/
    decisions.test.ts
    drift.test.ts
    profile-engine.test.ts
    protocol.test.ts
    store.test.ts
    types.test.ts
  memory/
    api.test.ts
    conflicts.test.ts
    scoring.test.ts
    types.test.ts
  overnight/
    morning-report.test.ts
    orchestrator.test.ts
    p20-dogfood-overnight.test.ts
  plan-factory/
    engine.test.ts
    template.test.ts
  policy/
    engine.test.ts
    provenance.test.ts
    store.test.ts
  proposals/
    api.test.ts
    dedup.test.ts
    dogfood-verification.test.ts
    generator.test.ts
    inbox.test.ts
    scoring.test.ts
    store.test.ts
    types.test.ts
  reflection/
    engine.test.ts
    future-suggestions.test.ts
    memory-proposals.test.ts
    summarizer.test.ts
  observation-engine.test.ts
  p17-dogfood-verification.test.ts
  p18-dogfood-verification.test.ts
  timeline-store.test.ts
  types.test.ts
```

Dogfood testleri (p17, p18, p20) E2E akislari test eder, her fazin butunlesik calistigini dogrular.

---

## Key New/Updated Files (from last 31 commits)

### Scheduler Architecture (P6.5)

| File | Description |
|---|---|
| `core/scheduler.ts` | Shared `Scheduler` interface + scheduling types (`SkipReason`, `SchedulingDecision`, `SchedulerDiagnostics`) |
| `core/workspace-scheduler.ts` | `WorkspaceScheduler` (v1) and `DynamicParallelScheduler` (v2) implementing the interface |
| `core/continuous-executor.ts` | Continuous scheduling executor — default execution mode |
| `core/workspace-schema.ts` | Schema v2.3.2, v2.4.0, v2.5.0; added `hardDeps`, `softDeps`, `readSet`, `writeSet` fields |
| `scheduler/dynamic-scheduler.ts` | Implements Scheduler interface, v2 default, GlobalReadyQueue, WorktreePool, continuous scheduling |
| `core/autonomous-executor.ts` | Updated for P6.5: worktree config wiring, DynamicParallelScheduler integration, orphan process killing |
| `core/cleanup-review.ts` | TOCTOU fixed, async exec, orphan process killing, rerun-cleanup support |
| `core/tools/bash.ts` | Validation lock wrapping ops.exec() |
| `core/utils/shell.ts` | `installValidationSpawnLock()` — global spawn interceptor |
| `core/production-readiness-doctor.ts` | Converted to fully async |
| `worktree/worktree-manager.ts` | Fixed execAsync (no execSync) |

### P11 Ecosystem (Continuous Self-Improvement)

| File | Description |
|---|---|
| `core/budget-enforcer.ts` | Budget enforcement for proposal execution (475 lines) |
| `core/capability-policy-engine.ts` | Capability policy engine for extensions/skills permissions (1011 lines) |
| `core/governance-ledger.ts` | Governance ledger for audit trail (703 lines) |
| `core/graph-diff-engine.ts` | Original-vs-optimized graph diffs, safety checks, approval lifecycle (886 lines) |
| `core/patch-approval-engine.ts` | Patch approval engine (668 lines) |
| `core/plan-graph-diff.ts` | Plan graph diff logic (568 lines) |
| `core/plan-intake-analyzer.ts` | Automated plan intake analysis (638 lines) |
| `core/platform-audit-ledger.ts` | Platform-level audit events (535 lines) |
| `core/proposal-execution-pipeline.ts` | Full proposal execution pipeline (1013 lines) |
| `core/proposal-inbox.ts` | Proposal inbox for orchestrator |
| `core/remediation-policy-engine.ts` | Remediation policy engine (875 lines) |
| `core/remediation-runtime.ts` | Remediation runtime (1385 lines) |
| `core/skill-output-artifact.ts` | Skill output artifact handling (333 lines) |
| `core/skill-package-manager.ts` | Skill package manager (881 lines) |
| `core/skill-package.ts` | Skill package model (294 lines) |
| `core/skill-quality.ts` | Skill quality scoring (460 lines) |
| `extensions/runtime-host.ts` | Extension runtime host (561 lines) |
| `memory/organic-forbidden-patterns.ts` | Organic memory forbidden patterns (360 lines) |
| `memory/organic-memory-schema.ts` | Organic memory schema (352 lines) |
| `orchestrator/orchestrator-daemon.ts` | Periodic scan loop for continuous observation, ProposalInbox (512+ lines) |

### V2 Brain — Cognitive OS (P13-P20)

| File | Description |
|---|---|
| **Observation & Timeline (P13)** | |
| `brain/types.ts` | Core brain types (BrainObservation, BrainSignal, BrainTimelineEvent, SignalType, EventSource) |
| `brain/observation-engine.ts` | ObservationEngine — watches queues, journals, retries; extracts signals from raw observations |
| `brain/timeline-store.ts` | InMemoryBrainTimelineStore — time-series event log with mutex-guarded append/list/count |
| `brain/index.ts` | Barrel re-exports for all brain modules + setBrainStore() DI |
| **Memory (P14)** | |
| `brain/memory/store.ts` | MemoryStore — file-backed persistent store with scoring, query, fsync crash safety, double-check locking |
| `brain/memory/scoring.ts` | MemoryScoringEngine — relevance/importance/recency scoring |
| `brain/memory/conflicts.ts` | Conflict detection — duplicate/semantic/contradiction checks |
| `brain/memory/lifecycle.ts` | Memory lifecycle — tier management, archival, pruning |
| `brain/memory/types.ts` | Memory types (MemoryEntry, MemoryQuery, MemoryScoringResult) |
| `brain/memory/api.ts` | Memory API — createMemory, getMemory, updateMemory, deleteMemory, rejectMemory |
| `brain/memory/index.ts` | Memory barrel exports |
| **Goals & Autonomy (P15)** | |
| `brain/goals/store.ts` | GoalStore — persistent goal index with CRUD + query |
| `brain/goals/types.ts` | Goal types (GoalIndex, GoalIndexEntry, GoalWithMetadata) |
| `brain/goals/decisions.ts` | DecisionClassifier — classify actions (allow/deny/escalate) based on rules and evidence |
| `brain/goals/drift.ts` | GoalDriftDetector — detect when behavior deviates from stated goals |
| `brain/goals/profile-engine.ts` | AutonomyEngine — autonomy level profile, profile change events |
| `brain/goals/protocol.ts` | UserProtocol — defines allowed/denied/escalated actions per user |
| **Proposals (P16)** | |
| `brain/proposals/generator.ts` | MemoryProposalGenerator — generates change proposals from observations |
| `brain/proposals/scoring.ts` | ProposalScoringEngine — scores proposals by impact/risk/urgency |
| `brain/proposals/store.ts` | ProposalStore — persistent proposal storage |
| `brain/proposals/dedup.ts` | ProposalDedupEngine — prevents duplicate proposals |
| `brain/proposals/inbox.ts` | ProposalInbox — queues proposals for approval |
| `brain/proposals/api.ts` | Proposal API — CRUD for proposals |
| `brain/proposals/types.ts` | Proposal types (MemoryProposalOutput, ProposalCreateResult, etc.) |
| **Reflection & Planning (P17)** | |
| `brain/reflection/engine.ts` | ReflectionEngine — generates structured reflection reports from execution history |
| `brain/reflection/api.ts` | Reflection API — generate, list, get, getStats |
| `brain/reflection/summarizer.ts` | ReflectionSummarizer — produces concise summaries from reports |
| `brain/reflection/future-suggestions.ts` | FutureSuggestionGenerator — suggests future plans based on reflection patterns |
| `brain/reflection/memory-proposals.ts` | MemoryProposalGenerator — generates memory-backed proposals from reflections |
| `brain/reflection/types.ts` | Reflection types (ReflectionReport, ReflectionEvent, ReflectionStats) |
| `brain/plan-factory/engine.ts` | PlanFactory — generates execution plans from reflection data |
| `brain/plan-factory/template.ts` | MasterTemplateIntegration — produces standalone markdown plan files |
| `brain/plan-factory/types.ts` | Plan factory types (PlanBlueprint, PhaseTitleBuilder) |
| `brain/plan-factory/index.ts` | Plan factory barrel exports |
| **Policy & Trust (P18)** | |
| `brain/policy/engine.ts` | PolicyEngine — rule evaluation, LRU cache, allow/deny/escalate decisions |
| `brain/policy/store.ts` | RuleStore — persistent rule CRUD, toggling, factory defaults |
| `brain/policy/provenance.ts` | ProvenanceTracker — tracks rule changes and decision history |
| `brain/policy/types.ts` | Policy types (PolicyRule, RuleIndex, RuleIndexEntry) |
| **Approvals (P18)** | |
| `brain/approvals/gate.ts` | ApprovalGate — multi-tier approval (self-service/manager/paused) |
| `brain/approvals/api.ts` | Approval API — createGate, queue approval, needs-approval queries |
| **Audit (P18)** | |
| `brain/audit/ledger.ts` | AuditLedger — append-only audit log with file-based storage, search, stats |
| **Overnight Execution (P20)** | |
| `brain/overnight/orchestrator.ts` | OvernightOrchestrator — session lifecycle with mutex-guarded start/stop/pause/resume |
| `brain/overnight/morning-report.ts` | MorningReportGenerator — produces user-facing morning summary |
| `brain/overnight/validation.ts` | FullLoopValidator — 5 built-in validation scenarios |
| `brain/overnight/trust-assessment.ts` | TrustAssessor — multi-dimension trust scoring (safety, reliability, transparency, control) |
| `brain/overnight/dogfood-report.ts` | DogfoodReportGenerator — generates comprehensive dogfood verification reports |
| `brain/overnight/index.ts` | Overnight barrel exports + SessionStore (in-memory ephemeral session store) |
| **API Layer** | |
| `brain/api.ts` | Unified API — 24 functions bridging brain modules to web-server routes (audit, autonomy, memory, overnight, policy, reflections, state) |
| **Web Server Routes (P19)** | |
| `routes/brain/state.ts` | GET /api/brain/state — aggregate brain state snapshot |
| `routes/brain/audit.ts` | GET /api/brain/audit — audit entries and stats |
| `routes/brain/autonomy.ts` | GET /api/brain/autonomy — autonomy profile and config |
| `routes/brain/memories.ts` | GET/POST/DELETE /api/brain/memories — memory CRUD |
| `routes/brain/overnight.ts` | POST/GET /api/brain/overnight — overnight session lifecycle |
| `routes/brain/policy.ts` | GET /api/brain/policy — policy rules and emergency status |
| `routes/brain/approvals.ts` | Approval API routes |
| `routes/brain/proposals.ts` | Proposal API routes |
| `routes/brain/protocol.ts` | Protocol API routes |
| `routes/brain/reflections.ts` | Reflection API routes |

### Key Bugfixes (last 31 commits)

| Fix | Commit | Description |
|---|---|---|
| Security | 02cf69cbb | Shell injection replaced with Node.js walk; OAuth state/PKCE separation; env secret caching removed |
| Security | 02cf69cbb | Byte-cap log buffer; Fastify 10MB body limit; CORS restricted to local origins |
| Reliability | dc5bd8f73 | TOCTOU race in memory guard; stale completion bus signal; all execSync → execAsync |
| Reliability | bed08f546 | Validation lock for bash tool; orphan process killing; global spawn interceptor |
| Reliability | 02cf69cbb | Race condition in runPlan() double-execution guard; OS-assigned OAuth port |
| Validation | 01f9339af | isV230Plus includes v2.3.2 and v2.4.0 |
| Runtime | 94d30736a | TS build errors in runtime-host.ts and index.ts |
| V2 Brain | 16e3ec2e | 7 P13-P20 code review fixes (mutex, LRU, fsync, API exports, double-check locking, SessionStore docs) |
| V2 Brain | 16e3ec2e | 98 pre-existing TS errors fixed across 15 test files and web-server routes |
| UI | 3761f6ccb | React 19 'ref' prop renamed to 'ctx' |
| UI | 09387c4da | Infinite re-render in LeadAgentDashboard |

---

## Data Flow — Plan Upload to Completion

1. **User uploads plan** via `PlanUploadDialog` → `usePlanRunner` validates via POST `/api/projects/:id/plans/validate` → safety doctor check
2. **User confirms** → POST `/api/projects/:id/plans/run` → `runPlan()` in `plan-runner.ts`
3. **Plan is parsed**, queue validated, safety doctor runs, plan file saved to `.pi/plans/`
4. **AutonomousExecutor** created → `initialize()` → `executePlanInBackground()`
5. **Execution loop** (P6.5): `DynamicParallelScheduler.getNextWorkspaces()` → GlobalReadyQueue priority scoring → WorktreePool lease → `executeWorkspace()` for each → abort if stop/pause → live `worker_status` events → cache usage tracked → thinking stream buffered
6. **Dashboard polls** `/api/projects/:id/plans/:execId` every 5s, SSE pushes real-time events, WebSocket streams live logs
7. **On all workspaces complete**: cleanup/review worker runs → reviews changes, runs tests, catches bugs → auto-commits fixes → writes `plan-summary.json` to `.pi/executions/{planExecId}/`
8. **On completion**: plan auto-commits and marks complete
9. **On stop signal**: `executor.stopAllActiveWorkspaces()` → each in-flight `WorkspaceAgentExecutor.abort()` → `session.agent.abort()` → ongoing LLM call aborted → clean FAILED state
10. **On crash**: `resumeStrandedExecutions()` scans `.pi/` for queue snapshots at server startup and resumes; WorktreePool leases recovered from `.pi/scheduler/leases/`
11. **P11 orchestrator**: `OrchestratorDaemon` runs periodic scan → `PlanIntakeAnalyzer` analyzes → proposals generated → `ProposalInbox` submits → `ProposalExecutionPipeline` executes → `GovernanceLedger` records
12. **V2 Brain**: V2 Brain runs alongside — `ObservationEngine` monitors plan execution, `MemoryStore` records outcomes, `ReflectionEngine` analyzes results, `PolicyEngine` enforces rules, `OvernightOrchestrator` runs scheduled overnight execution

---

## Architecture Overview

```
Browser (Vite + React Dashboard)
  │
  ├── /api/brain/* ────────────►  Web Server ──► brain/api.ts ──► V2 Brain (P13-P20)
  ├── /api/plans/* ────────────►              │                    │
  ├── /api/chat/* ─────────────►              │                    ├── ObservationEngine
  ├── /api/extensions/* ───────►              │                    ├── MemoryStore
  ├── /api/skills/* ───────────►              │                    ├── GoalStore / AutonomyEngine
  ├── SSE events ──────────────►              │                    ├── ProposalGenerator / Inbox
  └── WebSocket ───────────────►              │                    ├── ReflectionEngine
                                              │                    ├── PolicyEngine / AuditLedger
                                              │                    └── OvernightOrchestrator
                                              │
                                              ├── Plan Runner ──► AutonomousExecutor ──► WorkspaceAgent
                                              │                                      │
                                              │                                      ├── DynamicParallelScheduler
                                              │                                      ├── GlobalReadyQueue
                                              │                                      ├── WorktreePool
                                              │                                      └── Tools (bash/edit/read/write)
                                              │
                                              ├── P11 OrchestratorDaemon
                                              │
                                              └── State Store (PostgreSQL JSON)
                                                    │
                                                    ├── .pi/brain/ (memory, audit, proposals, reflections)
                                                    ├── .pi/plans/*.md
                                                    ├── .pi/workspaces/{id}/
                                                    ├── .pi/scheduler/leases/
                                                    └── PostgreSQL (optional)
```

---

## Phase Coverage Summary

| Phase | Scope | Status |
|---|---|---|
| P2 | Autonomous multi-agent plan execution | Stable, operational |
| P5.5 | Performance, cache, retrieval acceleration | Complete, metrics verified |
| P6 | Large-project scale reliability | Complete, worktree isolation active |
| P6.5 | Scheduler redesign, continuous scheduling | Complete, v2.5 schema default |
| P9 | Remediation, governance ledger | Complete, reports written |
| P10 | Dashboard redesign | Planning phase |
| P11 | Continuous self-improvement ecosystem | Complete, integration tests pass |
| **P13** | **Brain Core — Observation & Timeline** | **Complete** — ObservationEngine, InMemoryBrainTimelineStore |
| **P14** | **Memory — Persistent Store, Scoring, Conflicts** | **Complete** — MemoryStore, ScoringEngine, ConflictDetector |
| **P15** | **Goals — Store, Autonomy, Decisions** | **Complete** — GoalStore, AutonomyEngine, DecisionClassifier, GoalDriftDetector |
| **P16** | **Proposals — Generator, Scoring, Inbox** | **Complete** — Proposal generator, scorer, dedup, inbox, API |
| **P17** | **Reflection — Engine, Summarizer, Plan Factory** | **Complete** — ReflectionEngine, PlanFactory, Morning suggestions |
| **P18** | **Policy & Trust — Rules, Audit, Approvals** | **Complete** — PolicyEngine, RuleStore, ProvenanceTracker, AuditLedger, ApprovalGate |
| **P19** | **Dashboard — Brain Web UI Routes** | **Complete** — All /api/brain/* routes wired |
| **P20** | **Overnight — Orchestration, Reports, Validation** | **Complete** — OvernightOrchestrator, MorningReport, DogfoodReport, TrustAssessor |

---

## Package Status Changes

- **`packages/db/`**: Removed in P6 cleanup → **Restored** in P11 with proposal/plan-revision support, migration 006
- **`packages/coding-agent/src/brain/api.ts`**: **New** — Unified 24-function API layer for web-server routes
- **`packages/coding-agent/src/platform/`**: Deleted in P11 checkpoint

## Key Metrics (from P5.5 dogfood report)

| Metric | Value |
|---|---|
| Cacheable prefix tokens | ~5,200 tokens stable across workspace calls |
| Dynamic suffix tokens | 1,800-3,200 tokens per workspace |
| Avg cache hit rate | 59.0% |
| Validation time reduction | 68% (102s → 33s avg) |
| Prefix hash stability | 100% stable within session, 0 false cache invalidations |

# Pi Monorepo — File Analysis Summary

**Date:** 2026-05-18  
**Scope:** `packages/ai/`, `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`, `packages/db/`, reference docs, reports  
**Purpose:** Understand what every file does across the autonomous execution system, prompt cache architecture, P6 large-project scale reliability, P9 remediation, P10 dashboard redesign, P11 continuous self-improvement, P6.5 scheduler redesign, and chat UI

---

## Recent Commits (last 30, oldest to newest)

### 1. `feat(pP9): complete workspace P9.G7 — Governance ledger integration & audit trail wiring` (8976fde07)

Dogfood/safety reports for P9.G4 (dry-run validation) and P9.G7 (governance ledger integration). Adds 5 report files totaling 501 lines.

- **Files:** `reports/p9g4-dryrun-validation/*`, `reports/p9g7-governance-ledger/*`

### 2. `feat(pP9): complete workspace P9.I — P9 dogfood and safety report` (77aa6e155)

P9 dogfood and safety report — 4 report files covering dogfood results, safety verification, and Definition-of-Done checklist totaling 611 lines.

- **Files:** `reports/p9i-dogfood-safety/*`

### 3. `chore: fix lint infos in remediation-runtime-p9-g4.test.ts and proposal-routes.ts` (4583d0e29)

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

### 4. `feat(pP10R): complete workspace 10.0 — Spec cleanup and executable DAG normalization` (bf5ac607f)

Documentation-only commit: `docs/p10-dashboard-redesign-plan-p10r.md` (1557 lines) — redesigned version of the P10 dashboard plan.

- **Files:** `docs/p10-dashboard-redesign-plan-p10r.md`

### 5. `fix(web-ui): rename 'ref' prop to 'ctx' in ContextRefPill to avoid React 19 reserved prop error` (3761f6ccb)

React 19 treats `ref` as a reserved prop. Renamed to `ctx` in the component and all 3 call sites in `ChatPanel.tsx`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 6. `fix(p6.5): wire worktree config through autonomous executor and bump schema to v2.3.2` (0a0732f34)

Wired worktree config through `AutonomousExecutor` so P6 worktree isolation actually activates. Bumped `CONTRACT_SCHEMA_VERSION` to 2.3.2, added to `ACCEPTED_SCHEMA_VERSIONS`. Updated master template default to `experimental_6` with worktree. Fixed `scale-routes.ts` readiness endpoint to reflect actual config.

- **Files:** 8 files across `packages/coding-agent/`, `packages/web-server/`, `docs/`

### 7. `feat(web-ui): convert chat panel to centered dialog with markdown rendering` (b5faddfd5)

Converted `ChatPanel` from cramped sidebar/tabs into a centered dialog (max-w-3xl, max-h-[80vh]) using framer-motion `AnimatePresence`. Added `react-markdown` with `remark-gfm` and `rehype-highlight` for markdown rendering and syntax highlighting. Removed left sidebar and right overlay Chat usages.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`, `App.tsx`, `package.json`, `package-lock.json`

### 8. `feat(web-ui): add colored tool badges, thinking animation, and smooth message fade-in to chat` (7f63c055a)

Added per-tool colored badges (blue=read, amber=write, violet=edit, emerald=bash, cyan=search) with pulse animations. `ThinkingDots` animation while waiting for first tokens. Smooth fade-in/slide-up via framer-motion for messages and stream chunks.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 9. `feat(web-ui): add chat status bar with provider/model selector, context meter, and compact button` (d4c8a2be2)

`ChatStatusBar` with provider/model dropdown (fetches from `/api/ai-models`, persists to settings). Context usage bar with token count (estimated ~0.3 tokens/char), color-coded thresholds. Compact button calling `POST /api/chat/compact`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 10. `feat(web-ui): add search bar to model selection dropdown` (8384c7eb5)

Search input at top of model selector dropdown filters providers/models in real-time. Escape closes, clicking outside resets. Fixed-height scrollable list.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 11. `feat(web-ui): add persistent chat threads with session switching` (864ee27c6)

Backend: `GET /chat/history` returns all sessions with metadata; `POST /api/chat` now saves user messages before processing. Frontend: thread sidebar toggleable from header, lists sessions with active highlight, 'New' button for fresh threads. Dialog widened to max-w-4xl.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 12. `feat(web-ui): add 17 improvements to chat dialog` (e50ee226f)

Message editing (ArrowUp on empty, pencil button), regeneration (RefreshCw button), copy code block button with language label, table scroll hint, fullscreen toggle, timestamps (relative), copy message button, scroll-to-bottom floating button.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 13. `chore(web-ui): remove unused Clock import in ChatPanel` (56e928c3d)

One-line cleanup.

### 14. `fix(web-server): add plan-handoff markdown type and fix pre-existing TS error` (bd32be4bb)

Added `'plan-handoff'` to `PlanMarkdownEvent` union, implemented handler in `updatePlanMarkdown` setting status to `'awaiting_handoff'`. Extended `replaceHeader()`/`formatHeader()` type unions. Fixed pre-existing TS2454 unassigned-variable error.

- **Files:** 8 files across `packages/coding-agent/` and `packages/web-server/`

### 15. `fix(coding-agent): fix TOCTOU memory guard, stale completion bus signal, execSync in scale-routes and readiness doctor` (dc5bd8f73)

- `cleanup-review.ts`: moved memory check inside cleanup lock to avoid TOCTOU race
- `plan-runner.ts`: `WorktreeCompletionBus.reset()` clears stale `lastSignal` on bus reuse
- `scale-routes.ts`: replaced all `execSync` git calls with `execAsync`
- `production-readiness-doctor.ts`: converted to fully async, removed `execSync`

- **Files:** 5 files across `packages/coding-agent/` and `packages/web-server/`

### 16. `fix(coding-agent): add validation lock to bash tool, orphan process killing, and global spawn interceptor` (bed08f546)

Serializes validation commands across all parallel workers to prevent vitest process stack exhaustion. Kills orphan child processes left by agent sessions. Global `child_process.spawn` interceptor kills previous validation process before starting new one. Massive journal NDJSON artifact included (17.5K lines).

- **Files:** `packages/coding-agent/src/core/tools/bash.ts`, `autonomous-executor.ts`, `cleanup-review.ts`, `utils/shell.ts`

### 17. `feat(web): add rerun cleanup button to dashboard and API endpoint` (771181973)

`POST /api/projects/:projectId/plans/:planExecId/rerun-cleanup` triggers cleanup review re-execution. Dashboard `PlanSummaryPanel.tsx` rerun button with spinner and auto-refresh.

- **Files:** `packages/web-server/src/index.ts`, `packages/web-ui/dashboard/src/components/PlanSummaryPanel.tsx`

### 18. `fix(p6.5): fix 12 security and reliability bugs across ai, coding-agent, and web-server` (02cf69cbb)

- Critical: replaced shell command injection in file search with pure Node.js walk; separated OAuth state from PKCE verifier; stopped caching env secrets in `/proc/self/environ`
- High: properly handle `start()` rejected promise; eliminated race condition in `runPlan()` double-execution guard; OS-assigned port for OAuth callback
- Medium: byte-cap in-memory log buffer; Fastify 10MB body limit; CORS restricted to explicit local origins; documented JsonStateStore fallback divergence

- **Files:** 5 files across `packages/ai/` and `packages/web-server/`

### 19. `fix(coding-agent): resolve TS build errors in runtime-host and index` (94d30736a)

Fixed non-null assertion in `runtime-host.ts` (discriminated union narrowing). Removed stale P11.A platform type re-exports from `index.ts` referencing renamed/removed identifiers.

- **Files:** `packages/coding-agent/src/core/extensions/runtime-host.ts`, `packages/coding-agent/src/index.ts`

### 20. `feat(web-ui): add @-triggered telescope file search to chat panel` (42c509f1c)

Type `@` in chat textarea to open file browser popup. Empty shows directory tree (browsable). Typing does debounced `find -iname` search with relevance scoring. Backend: `GET /api/projects/:projectId/files/browse` and `GET /api/projects/:projectId/files/search`.

- **Files:** `packages/web-ui/dashboard/src/components/ChatPanel.tsx`

### 21. `fix(web-ui): prevent infinite re-render in LeadAgentDashboard` (09387c4da)

Derived `selectedProposal` from proposals list via `useMemo` instead of render-time `setState`. Removed dead `setSelectedProposal` state and unused `ProposalResponse` import.

- **Files:** `packages/web-ui/dashboard/src/components/LeadAgentDashboard.tsx`

### 22. `fix(web-ui): improve extensions error message when backend routes are missing` (33c0721d3)

Detects 404 responses in `useExtensions` hook and shows a clear "backend not configured" message.

- **Files:** `packages/web-ui/dashboard/src/hooks/useExtensions.ts`

### 23. `feat(web-server): implement extensions API routes` (5cbcb0f96)

REST API for extension lifecycle management (P11.P): list, health check, install (npm:/git:/local), update, rollback, enable/disable. Wraps `ExtensionRegistry` with audit logging.

- **Files:** `packages/web-server/src/extensions-routes.ts`, `packages/web-server/src/index.ts`, `packages/coding-agent/package.json`

### 24. `feat(p11): complete remaining P11 workspaces — plan intake, graph diff, audit ledger, skill API, dashboard UIs, and integration` (d73c25755)

Major P11 completion (workspaces C, I, K, M, O, Q, R, S, T):
- `plan-intake-analyzer.ts` — auto-analyze plans, detect bottlenecks, compute critical path
- `graph-diff-engine.ts` — original-vs-optimized graph diffs, safety checks, approval lifecycle
- `skills-routes.ts` — Fastify skill backend API (install, update, remove, enable/disable, test, invoke, recommend)
- `platform-audit-ledger.ts` — platform-level audit events for orchestrator/plans/extensions/skills/memory/policy
- Dashboard: `PlanIntakePanel.tsx`, `MemoryCockpit.tsx`, `PolicyAuditCenter.tsx` — full feature UIs
- Integration test: `p11-ecosystem-integration.test.ts` (7 tests covering full self-improvement lifecycle)

- **Files:** 12 files across `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 25. `fix(p11): integrate worktree orphan files and start orchestrator daemon` (bea4b16f6)

- `orchestrator-daemon.ts` (P11.B) — periodic scan loop for continuous observation
- `organic-forbidden-patterns.ts`, `organic-memory-schema.ts` (P11.F) — memory schema files
- `memory-routes.ts`, `policy-audit-routes.ts` (P11.L/P11.R) — web server routes
- Tests: `capability-policy-engine.test.ts`, `plan-graph-diff.test.ts`
- Dashboard: `AutonomyCenter.tsx`

- **Files:** 12 files across `packages/coding-agent/`, `packages/web-server/`, `packages/web-ui/dashboard/`

### 26. `fix(orchestrator): wire ProposalInbox into daemon and fix type errors` (ca340a906)

Wired `ProposalInbox` into `OrchestratorDaemon` — submits generated proposals after each scan cycle. Fixed `PlannerOutput`, `BatchPlanResult`, `CriticalPathInfo`, `PredictedParallelism` types.

- **Files:** `packages/coding-agent/src/main.ts`, `packages/coding-agent/src/orchestrator/orchestrator-daemon.ts`

### 27. `chore(cleanup): commit pre-redesign state` (7f80f27b4)

Checkpoint commit before scheduler redesign. Includes untracked P11 files: `patch-approval-engine.ts`, `plan-graph-diff.ts`, `DagDiffViewer.tsx`, `OptimizerApprovalPanel.tsx`, `PlanIntakePanel.tsx` (original), `PolicyAuditCenter.tsx` (original), `SafeBatchPreview.tsx`, `MemoryCockpitPanel.tsx`, hooks (`useMemoryMetrics.ts`, `useOptimizerApproval.ts`). Also deleted `platform/index.ts`.

- **Files:** 13 files across `packages/coding-agent/` and `packages/web-ui/dashboard/`

### 28. `fix(validation): include v2.3.2 and v2.4.0 in isV230Plus check` (01f9339af)

Without this, plans with `contractVersion "2.3.2"` or `"2.4.0"` with `maxParallelWorkspaces > 3` failed validation even with `experimental_6` mode. Added missing versions.

- **Files:** `packages/coding-agent/src/core/workspace-schema.ts`

### 29. `feat(p6.5): batchless ready queue, scheduler interface, DynamicParallelScheduler wiring` (ced1ade9a)

- `Scheduler` interface in `workspace-scheduler.ts` — `DynamicParallelScheduler` implements it
- `GlobalReadyQueue` — batch-barrier-free ready queue with priority sort
- `WorktreePool` — prewarm, acquire/release lease lifecycle, crash recovery via `.pi/scheduler/leases/`
- Workspace schema: added `hardDeps`, `softDeps`, `readSet`, `writeSet` fields
- Priority scorer: `criticalPathRemaining * 100 + downstreamBlocking * 20 + ageBoost - conflictRiskPenalty`
- Master template: `worktree.enabled` defaults to `true`

- **Files:** 6 files across `packages/coding-agent/` and `docs/`

### 30. `feat(p6.5): add Scheduler interface, v2.5 schema, continuous scheduling defaults` (06416c555)

- Created `scheduler.ts` with shared `Scheduler` interface + all scheduling types (`SkipReason`, `SchedulingDecision`, `SchedulerDiagnostics`, etc.)
- `WorkspaceScheduler` (v1) and `DynamicParallelScheduler` (v2) both implement the interface; v2 is default
- Schema v2.5.0: continuous scheduling is now the default execution mode
- Master template defaults: `worktree.enabled: true`, `scheduling.continuous: true`, `slotCount: 6`, `priorityStrategy: critical_path_first`
- Added validation rules 52-54 for continuous scheduling

- **Files:** 7 files across `packages/coding-agent/` and `docs/`

---

## Reference Documents

| File | Purpose |
|---|---|
| `docs/llm-implementation-agent-master-template.md` | **Canonical plan template v2.5.0** — Updated with continuous scheduling defaults, worktree isolation enabled by default, P6.5 scheduler interface. |
| `docs/llm-implementation-agent-master-template-v2.4.md` | **Pre-redesign v2.4 snapshot** — Checkpoint before full scheduler redesign. |
| `docs/pi_autonomous_multiagent_plan_executor.md` | **Phase P2 plan** — Concrete instance of the master template describing the full scope: plan parser, workspace schema, state store, DAG scheduler, packet builders, autonomous execution loop, 3-worker scheduler, retry loop, auto-commit, doctor/safety, CLI commands, and an E2E dry run. |
| `docs/pi/performance/prompt-cache-architecture.md` | **Prompt cache architecture** (workspace 5.5.A) — Cacheable prefix / dynamic suffix split, stable prefix hashing, version bump strategy. |
| `docs/pi/stability/p5-5-performance-cache-report.md` | **P5.5 stability report & dogfood** (workspace 5.5.H) — E2E validation metrics, cache hit rates, validation time reduction, safety assurance. |
| `docs/phase_p_6_large_project_scale_reliability.md` | **Phase P6 plan** — Large project scale reliability: worktree isolation, dynamic scheduling, integration queue, merge conflict resolution, test impact analysis, failure classification. |
| `docs/pi/scale/worktree-isolation.md` | **Worktree isolation design** — How Pi uses git worktrees to isolate workspace executions and prevent cross-contamination. |
| `docs/pi/stability/p6-large-project-scale-report.md` | **P6 stability report** — Dogfood results for large-project scale mode. |
| `docs/phase_p_9_remediation.md` | **Phase P9 plan** — Remediation architecture for self-healing plan execution. |
| `docs/p10-dashboard-redesign-plan-p10r.md` | **P10 dashboard redesign plan** (1557 lines) — Redesigned dashboard with plan intake, optimizer, memory cockpit, policy audit center, autonomy center. |
| `docs/p11.0-verification-report.md` | **P11 verification report** — E2E integration test results for continuous self-improvement ecosystem. |
| `docs/p11_ecosystem_continuous_self_improvement_implementation_plan.md` | **P11 implementation plan** — Full continuous self-improvement ecosystem: orchestrator daemon, plan intake, graph diff, patch approval, skill marketplace, platform audit, memory integration. |

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

### Key additions

#### `src/prompt-cache.ts` — Prompt Cache Architecture

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

### Key New/Updated Files (from last 30 commits)

#### Scheduler Architecture (P6.5)

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

#### P11 Ecosystem (Continuous Self-Improvement)

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

#### Key Bugfixes (last 30 commits)

| Fix | Commit | Description |
|---|---|---|
| Security | 02cf69cbb | Shell injection replaced with Node.js walk; OAuth state/PKCE separation; env secret caching removed |
| Security | 02cf69cbb | Byte-cap log buffer; Fastify 10MB body limit; CORS restricted to local origins |
| Reliability | dc5bd8f73 | TOCTOU race in memory guard; stale completion bus signal; all execSync → execAsync |
| Reliability | bed08f546 | Validation lock for bash tool; orphan process killing; global spawn interceptor |
| Reliability | 02cf69cbb | Race condition in runPlan() double-execution guard; OS-assigned OAuth port |
| Validation | 01f9339af | isV230Plus includes v2.3.2 and v2.4.0 |
| Runtime | 94d30736a | TS build errors in runtime-host.ts and index.ts |
| UI | 3761f6ccb | React 19 'ref' prop renamed to 'ctx' |
| UI | 09387c4da | Infinite re-render in LeadAgentDashboard |

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
  test/
    scale-routes.test.ts           # 423 lines
    performance-routes.test.ts     # 508 lines
    log-buffer.test.ts             # 164 lines
```

### Key Changes

#### `src/index.ts`

New endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/chat/history` | Chat session history with metadata and active session messages |
| POST | `/api/chat` | Save user messages before processing (persistent threads) |
| POST | `/api/chat/compact` | Compact chat context |
| GET | `/api/projects/:projectId/files/browse` | Directory listing for @-triggered file browser |
| GET | `/api/projects/:projectId/files/search` | File search via find -iname for @-triggered telescope |
| POST | `/api/projects/:projectId/plans/:planExecId/rerun-cleanup` | Re-trigger cleanup review |
| GET | `/api/extensions` | List installed extensions |
| GET | `/api/extensions/health` | Extension health check |
| POST | `/api/extensions/install` | Install extension |
| POST | `/api/extensions/update` | Update extension(s) |
| POST | `/api/extensions/rollback` | Rollback extension |
| POST | `/api/extensions/enable` | Enable extension |
| POST | `/api/extensions/disable` | Disable extension |
| GET | `/api/projects/:projectId/plans/:planExecId/summary` | Returns cleanup review summary |

Security hardening: Fastify body limit (10MB), CORS restricted to local origins.

#### `src/plan-runner.ts`

- Extracts worktree config from parsed plan execution
- `WorktreeCompletionBus.reset()` clears stale `lastSignal` on bus reuse
- Supports rerun cleanup via POST endpoint
- Calls `executor.stopAllActiveWorkspaces()` on stop control signal

#### `src/scale-routes.ts`

- All `execSync` git calls replaced with `execAsync` (no event loop blocking)
- Readiness endpoint reflects actual config (not hardcoded defaults)

#### `src/extensions-routes.ts` (NEW)

REST API for extension lifecycle (P11.P): list, health check, install (npm:/git:/local), update, rollback, enable/disable. Wraps `ExtensionRegistry` with audit logging. 445 lines.

#### `src/skills-routes.ts` (NEW)

Fastify-based skill backend API (P11.K): install, update, remove, enable/disable, test, invoke, recommend. 497 lines.

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
    ChatPanel.tsx                  # COMPLETELY REWORKED — centered dialog (max-w-4xl), markdown rendering (react-markdown + rehype-highlight), colored tool badges, thinking animation, message fade-in, status bar (provider/model selector, context meter, compact button), searchable model dropdown, persistent chat threads with session switching, @-triggered telescope file search, message editing, regeneration, code copy, fullscreen, timestamps, scroll-to-bottom
    DagDiffViewer.tsx              # NEW (P11) — DAG diff visualization (438 lines)
    OptimizerApprovalPanel.tsx     # NEW (P11) — Plan optimizer approval UI (593 lines)
    SafeBatchPreview.tsx           # NEW (P11) — Safe batch preview UI (363 lines)
    LeadAgentDashboard.tsx         # P11 — Fixed infinite re-render, proposal selection
    ProposalCard.tsx               # P11 — Updated proposal display
    PlanIntakePanel.tsx            # NEW (P11) — Plan intake analysis UI (480+ lines, later updated to 427 lines)
    PolicyAuditCenter.tsx          # NEW (P11) — Policy audit UI (866 lines, later updated to 382 lines)
    MemoryCockpitPanel.tsx         # NEW (P11) — Memory health metrics UI (750 lines)
    ExtensionsManager.tsx          # Extension management UI (existing)
    SkillsManager.tsx              # Skill management UI (existing)
    PlanSummaryPanel.tsx           # Updated — rerun cleanup button
    WorkerDetail.tsx               # Updated — live agent state, failed/blocked banners
    LiveLogTerminal.tsx            # Updated — fade-in animations
    ThinkingAnimation.tsx          # Existing — animated agent state
    PerformancePanel.tsx           # P5.5.G — Performance telemetry dashboard
    ScaleCockpitPanel.tsx          # Scale mode cockpit UI
    ScaleModeSettings.tsx          # P6 scale mode settings
    WorktreeStatusPanel.tsx        # P6 worktree status
    SchedulerStatusPanel.tsx       # P6.5 scheduler status UI
    IntegrationQueuePanel.tsx      # P6 integration queue
    MergeConflictPanel.tsx         # P6 merge conflict
    WorkerP6LifecycleTab.tsx       # P6 worker lifecycle
    WorktreeCleanupDialog.tsx      # Worktree cleanup dialog
    ... (other existing components)
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
    ... (other existing hooks)
  stubs/
    child_process.ts, crypto.ts, fs-promises.ts, fs.ts, os.ts, path.ts  # Dashboard Node.js stubs
  utils/
    format.ts                      # Formatting utilities
    performance-metrics.ts         # Performance metrics utilities
```

### Key Component Changes

#### `ChatPanel.tsx` — Completely Reworked

The most heavily modified component, with 9+ commits touching it across the last 30:

| Change | Description |
|---|---|
| Centered dialog | Converted from cramped sidebar overlay/tab to centered dialog (max-w-4xl) using framer-motion AnimatePresence |
| Markdown rendering | Added react-markdown + remark-gfm + rehype-highlight for rich rendering |
| Tool badges | Per-tool colored badges (read=blue, write=amber, edit=violet, bash=emerald, search=cyan) with pulse animations |
| Thinking animation | ThinkingDots animation while waiting for first tokens |
| Message fade-in | Smooth fade-in/slide-up via framer-motion |
| Chat status bar | Provider/model selector dropdown, context usage bar, compact button |
| Model search | Search input filtering providers/models in real-time |
| Persistent threads | Session sidebar, history loading, session switching, new thread creation |
| Message editing | ArrowUp on empty input, pencil button on user messages |
| Regeneration | RefreshCw button on last assistant message |
| Code copy | Copy button + language label on code blocks |
| Table scroll hint | Scroll indicator bar for wide tables |
| Fullscreen | Maximize2/Minimize2 toggle in header |
| Timestamps | Relative time display ('2m ago', '1h ago') |
| Copy message | Copy button on hover per message bubble |
| Scroll-to-bottom | Floating button when not at bottom |
| @-triggered search | File browser popup with directory tree + telescope search |
| React 19 fix | 'ref' prop renamed to 'ctx' to avoid reserved prop error |

#### New P11 Feature Components

- **`DagDiffViewer.tsx`** — Visual diff between original and optimized DAGs
- **`OptimizerApprovalPanel.tsx`** — UI for approving/rejecting optimization proposals
- **`SafeBatchPreview.tsx`** — Preview batch plan execution safety
- **`PlanIntakePanel.tsx`** — Plan intake analysis with bottlenecks, critical path, diagnostics
- **`PolicyAuditCenter.tsx`** — Audit timeline with filters, policy summary, protected systems
- **`MemoryCockpitPanel.tsx`** — Memory health metrics, source breakdown, provenance, compaction/prune actions
- **`AutonomyCenter.tsx`** — Autonomy center with orchestration health
- **`AutonomyProposalCard.tsx`** — Individual proposal card in autonomy view
- **`OrchestratorHealthPanel.tsx`** — Orchestrator daemon health status
- **`MemoryCockpit.tsx`** — Memory cockpit feature panel

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

`packages/db/` was removed in P6 cleanup, then restored in P11 with proposal/plan-revision support.

---

## Architecture Overview

```
Browser (Dashboard UI — React + Vite)
  │
  ├── HTTP polling (5-10s intervals)
  ├── SSE streams (real-time events + logs)
  ├── WebSocket (live workspace logs)
  └── Chat dialog (persistent threads, markdown, @-file search, model selection)
        │
        ▼
Web Server (Fastify on :3000)
  │
  ├── REST API endpoints
  │   ├── Chat: history, sessions, compact, save messages
  │   ├── Files: browse, search (@-triggered telescope)
  │   ├── Extensions: install, update, rollback, enable/disable, health
  │   ├── Skills: install, update, remove, test, invoke, recommend
  │   ├── Performance: telemetry metrics
  │   ├── Memory: management API
  │   ├── Policy audit: audit timeline, policy summary
  │   ├── Proposals: CRUD + execution
  │   ├── Scale mode: worktree, scheduler, integration queue
  │   └── Plans: validate, run, summary, rerun-cleanup
  │
  ├── Background Plan Runner (plan-runner.ts)
  │   ├── P6.5: worktree config, DynamicParallelScheduler, continuous scheduling
  │   ├── Abort on stop control signal
  │   ├── Cleanup/review worker (supports rerun)
  │   └── Auto-commit on success
  │
  ├── P11 Orchestrator Daemon (via coding-agent)
  │   ├── Periodic scan loop for continuous observation
  │   ├── Proposal generation and submission via ProposalInbox
  │   └── Governance ledger / audit trail
  │
  ├── State Store Provider (singleton)
  │   ├── IStateStore (PostgreSQL or JSON fallback)
  │   └── SettingsManager
  │
  └── Reads/Writes
      ├── .pi/plan-state.json
      ├── .pi/execution-journal.ndjson
      ├── .pi/workspaces/{id}/attempts/{n}/*.log
      ├── .pi/plans/*.md
      ├── .pi/{execId}.workspace-queue.json (crash recovery)
      ├── .pi/executions/{planExecId}/plan-summary.json
      ├── .pi/scheduler/leases/ (worktree pool crash recovery)
      └── PostgreSQL (when backend=postgres, restored in P11)

Coding Agent (packages/coding-agent/)
  │
  ├── Context Layer
  │   ├── Prompt cache (ai/src/prompt-cache.ts)
  │   ├── Context sections (context/)
  │   └── Workspace packets
  │
  ├── Execution Layer
  │   ├── AutonomousExecutor — DynamicParallelScheduler, GlobalReadyQueue, continuous scheduling
  │   ├── WorkspaceAgentExecutor — per-workspace LLM execution, abort, cache tracking, live status
  │   ├── ContinuousExecutor — continuous scheduling mode
  │   └── Cleanup review — re-runnable
  │
  ├── Scheduler (P6.5 — completely redesigned)
  │   ├── Scheduler interface (core/scheduler.ts)
  │   ├── WorkspaceScheduler v1 + DynamicParallelScheduler v2 (core/workspace-scheduler.ts)
  │   ├── GlobalReadyQueue — batch-barrier-free, priority-scored
  │   ├── WorktreePool — prewarm, lease lifecycle, crash recovery
  │   ├── Priority scorer: criticalPathRemaining, downstreamBlocking, ageBoost, conflictRiskPenalty
  │   └── Workspace schema: hardDeps/softDeps/readSet/writeSet, continuous scheduling validation
  │
  ├── P11 Continuous Self-Improvement
  │   ├── OrchestratorDaemon — periodic scan, proposal generation
  │   ├── PlanIntakeAnalyzer — auto-analysis, bottleneck detection
  │   ├── GraphDiffEngine — original-vs-optimized diffs
  │   ├── PatchApprovalEngine — patch approval lifecycle
  │   ├── ProposalExecutionPipeline — full proposal execution
  │   ├── RemediationRuntime — self-healing execution
  │   ├── RemediationPolicyEngine — policy-driven remediation
  │   ├── GovernanceLedger — audit trail
  │   ├── PlatformAuditLedger — platform-level events
  │   ├── BudgetEnforcer — resource budget tracking
  │   ├── CapabilityPolicyEngine — extension/skill permissions
  │   ├── SkillPackageManager — skill publishing/versioning
  │   ├── SkillQuality — skill quality scoring
  │   ├── SkillOutputArtifact — artifact handling
  │   └── OrganicMemory — forbidden patterns, memory schema
  │
  ├── Memory & Retrieval
  │   ├── ExecutionMemory — prior run reuse + relevance scoring
  │   ├── LocalRepoIndex — snippet-level content search
  │   └── RetrievalService — context fetching
  │
  ├── P6 Scale Mode
  │   ├── DynamicScheduler — multi-workspace scheduling
  │   ├── IntegrationQueue/Branch/MergeConflict — parallel workspace merging
  │   ├── WorktreeManager — git worktree isolation
  │   ├── TestImpactAnalyzer — targeted test selection
  │   ├── RepoSymbolGraph — file-to-test mapping
  │   ├── FailureClassifier/RetryRouter — categorized retry logic
  │   └── ScaleReadinessDoctor — pre-flight checks
  │
  └── Validation
      └── ValidationPlanner — decision tree

```

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

## Key Metrics (from P5.5 dogfood report)

| Metric | Value |
|---|---|
| Cacheable prefix tokens | ~5,200 tokens stable across workspace calls |
| Dynamic suffix tokens | 1,800-3,200 tokens per workspace |
| Avg cache hit rate | 59.0% |
| Validation time reduction | 68% (102s → 33s avg) |
| Prefix hash stability | 100% stable within session, 0 false cache invalidations |
| Cache unknown vs 0% | Clearly distinguished in UI (was hardcoded, now real data) |

## Package Status Changes

- **`packages/db/`**: Removed in P6 cleanup → **Restored** in P11 with proposal/plan-revision support, migration 006
- **`packages/coding-agent/src/platform/`**: Deleted (`platform/index.ts` removed in P11 checkpoint)
- **`packages/ai/`**: Security fixes (OAuth state/PKCE separation, env secret caching removed)

## Phase Coverage Summary

| Phase | Scope | Status |
|---|---|---|
| P2 | Autonomous multi-agent plan execution | Stable, operational |
| P5.5 | Performance, cache, retrieval acceleration | Complete, metrics verified |
| P6 | Large-project scale reliability | Complete, worktree isolation active |
| P6.5 | Scheduler redesign, continuous scheduling | Complete, v2.5 schema default |
| P9 | Remediation, governance ledger | Complete, reports written |
| P10 | Dashboard redesign | Planning phase (documentation) |
| P11 | Continuous self-improvement ecosystem | Complete, integration tests pass |
| P10R | Dashboard redesign (revised) | Documentation phase |

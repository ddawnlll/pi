# P11 — Ecosystem & Continuous Self-Improvement Platform

**Version:** 1.0.0  
**Last Updated:** 2026-05-16  
**Plan status:** Planned  
**Delivery status:** Not started  
**Template target:** LLM Implementation Agent — Master Template v2.4.0  
**Execution backend:** PostgreSQL with JSON fallback  
**Scale mode:** `experimental_6`  
**Runnable workspace count:** 21 total (`P11.0` plus `P11.A` through `P11.T`)  
**Implementation workspace count:** 20 (`P11.A` through `P11.T`)  
**DAG batch count:** 7  
**Peak DAG effective parallelism:** 6  
**Peak safe effective parallelism:** 6  

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P11`  
**One-line goal:** Turn Pi from a powerful autonomous execution system into a platform with continuous self-improvement, installable extensions, reusable skills, organic memory, plan-intake optimization, and dashboard-native governance.  
**Why now:** P6-P10 establish large-project reliability, planning intelligence, proposal generation, approval-gated remediation, and dashboard redesign. The next missing layer is ecosystem and continuous self-improvement: Pi should be able to observe itself, propose improvements, recommend skills/extensions, optimize uploaded plans, and safely route improvements through approval-gated execution.  
**Blast radius:** Orchestrator runtime, planner/plan-intake optimizer, extension runtime, skill runtime, memory/retrieval systems, policy engine, audit ledger, dashboard platform surfaces, web-server APIs, docs, tests, and dogfood reports.  
**Rollback path:** Disable P11 orchestrator daemon, disable extension/skill activation, keep registries read-only, disable organic memory writes, fall back to manual plan intake and existing approval-gated execution.  
**Scale mode:** `experimental_6`  
**Safe parallelism target:** `6 peak / ~3 weighted`  
**Done when:** Pi can continuously observe project health, propose self-improvements, analyze and optimize uploaded plans before execution, manage extensions and skills from dashboard, use organic memory safely, audit every platform action, and dogfood one safe self-improvement end-to-end without unauthorized mutation.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P11` |
| Title | `Ecosystem & Continuous Self-Improvement Platform` |
| Status | `Planned` |
| Last updated | `2026-05-16` |
| Delivery status | `Not started` |
| Target environment | `Local / Staging` |
| Primary focus | `Always-on orchestrator, plan-intake optimization, extension/skill ecosystem, organic memory, platform dashboard, and self-improvement loop` |
| Product-code changes | `Allowed, with approval and protected-system gates` |
| Selected scale mode | `experimental_6` |
| Requested max workers | `6` |
| Expected DAG effective parallelism | `6 peak / 3.0 weighted` |
| Expected safe effective parallelism | `6 peak / 3.0 weighted` |
| Worktree isolation | `Required` |
| Integration queue | `Required` |
| Validation lock | `Required` |
| Dashboard enabled | `Required` |
| Plan-intake optimizer | `Required` |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| `P11.0` — Spec, master-template v2.4 alignment, and executable contract normalization | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.A` — Platform capability manifest and shared contracts | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.B` — Always-on orchestrator daemon, scheduler, and health loop | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.C` — Plan intake analyzer and auto DAG optimizer core | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.D` — Extension registry, package format, and runtime host | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.E` — Skill registry, package format, and skill runner | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.F` — Organic vector memory store and schema | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.G` — Policy and permission model with protected capability gates | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.H` — Orchestrator proposal generation and self-improvement triggers | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.I` — Plan graph diff and optimizer patch approval engine | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.J` — Extension install, update, rollback, and health backend APIs | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.K` — Skill install, test, use, and recommendation backend APIs | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.L` — Memory ingestion, retrieval, provenance, and compaction pipeline | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.M` — Audit ledger events for platform actions | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.N` — Autonomy and Self-Improvement Center UI | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.O` — Plan Intake and DAG Diff UI | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.P` — Extensions and Skills Manager UI | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.Q` — Memory Cockpit UI | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.R` — Policy and Audit Center UI | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.S` — Dashboard shell, navigation integration, and registry settings | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |
| `P11.T` — Integration, migrations, E2E validation, dogfood, and final report | Implementation agent | Human operator | Platform/runtime/dashboard owner | Product / engineering stakeholders |

---

## 2. Purpose

P11 completes the transition from Pi as an autonomous execution runtime into Pi as a self-improving engineering platform. P6 made large-project execution reliable through isolated worktrees, integration queue, targeted validation, and scale-mode readiness. P7-P10 add planning intelligence, proposal generation, approval-gated remediation, and dashboard redesign. P11 builds the missing ecosystem layer: a continuously running orchestrator, plan-intake optimizer, extension registry, skill registry, organic memory base, policy center, and platform dashboard.

The central product behavior is simple: when a plan is uploaded, Pi should not merely parse and run it. Pi should automatically analyze it, recompute the DAG, compute safe effective parallelism, detect accidental serialization, propose an optimized graph, explain the original-vs-optimized diff, run dry-run forecasts, and require approval before applying graph patches or execution. Authored batch previews remain useful as human hints, but Pi must recompute and persist the approved graph before execution.

The second core behavior is continuous self-improvement. Pi should keep observing its own execution history, queue bottlenecks, validation failures, extension gaps, skill gaps, dashboard usability problems, and memory retrieval quality. It may propose improvements and draft plans, but it must not autonomously mutate protected systems. Planning approval, execution approval, dry-run validation, change budgets, protected-system approval, and audit ledger rules remain mandatory.

The third behavior is platformization. Extensions and skills must become installable, updateable, disableable, testable, permission-reviewed, and visible from the dashboard. Organic memory must become inspectable, provenance-backed, safe from forbidden-source indexing, and measurable for token savings and retrieval quality. Every platform action must emit an audit event.

---

## 3. What Carried Over — Must Stay Stable

* [ ] Human approval remains the gate for graph patch application and execution.
* [ ] Proposal approval for planning must not imply execution approval.
* [ ] Protected-system changes require explicit self-modification approval.
* [ ] Extensions and skills are denied by default until permission-reviewed.
* [ ] Memory indexing must not include secrets or forbidden files.
* [ ] Plan-intake optimizer is advisory until approved.
* [ ] Authored batch previews are advisory; computed approved graph is authoritative.
* [ ] Worktree isolation remains required for `experimental_6`.
* [ ] Integration queue remains required and processes merges safely.
* [ ] Global validation lock remains active for heavy validation.
* [ ] Completion gate hardening remains active.
* [ ] Merge conflicts produce handoff artifacts and do not mark the plan complete.
* [ ] The next plan does not start while the integration queue is dirty.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.
* [ ] The executor remains the source of truth for state transitions.
* [ ] Dashboard controls request actions but do not directly mutate execution state.

---

## 4. Background / What Was Wrong

Pi can now execute large plans more safely and can support approval-gated remediation. The next bottleneck is product-level operability. If extensions exist but cannot be discovered, installed, updated, rolled back, or permission-reviewed from the dashboard, the system remains a runtime rather than a platform. If skills exist but are not packaged, tested, recommended, or invoked through an auditable runner, agent behavior remains ad hoc. If memory exists only as cache/retrieval fragments but not as an organic, provenance-backed memory base, Pi cannot improve its planning and debugging quality over time.

Another gap is plan intake. A user should be able to upload a master plan and immediately receive a computed DAG analysis, safe batch preview, critical-path report, bottleneck diagnosis, queue-priority recommendation, and optimized graph proposal. Pi should catch accidental serialization, unsafe over-parallelization, missing dependency evidence, and stale authored previews before execution.

Finally, continuous self-improvement needs a dashboard-native loop. Pi should be able to say: "I observed this bottleneck, here is the evidence, here is the proposed improvement, here is the optimized implementation plan, here is the dry-run forecast, here is the approval gate, and here is the rollback path." Without P11, those capabilities remain scattered across planner, proposal, remediation, memory, extension, and dashboard systems.

---

## 5. Current Failure State / Known Blockers

* `always_on_orchestrator_daemon` = `missing as productized platform surface`
* `plan_upload_auto_dag_optimization` = `needs v2.4 lifecycle and dashboard approval flow`
* `extension_repository` = `missing or not dashboard-installable`
* `extension_runtime_host` = `needs permission and health model`
* `skill_registry` = `missing or not dashboard-operable`
* `skill_runner` = `needs manifest, test, invocation, and audit controls`
* `organic_vector_memory_base` = `not productized as provenance-backed memory cockpit`
* `memory_safety` = `must block forbidden-source indexing before chunking`
* `platform_policy_center` = `needed for extension/skill/memory/orchestrator permissions`
* `platform_audit_timeline` = `needed for end-to-end self-improvement traceability`
* `dashboard_platform_nav` = `missing Platform group for autonomy/extensions/skills/memory/policy`
* `self_improvement_dogfood` = `not yet proven end-to-end`

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Orchestrator starts mutating state directly | med | critical | Policy gate; read-only by default; executor-mediated controls only |
| Optimizer applies graph patch without approval | med | critical | Approval-required optimizer mode; approved graph hash; stale approval detection |
| Extension bypasses protected-system rules | med | critical | Deny-by-default permission model; sandboxed hooks; explicit self-modification approval |
| Skill executes unsafe commands | med | high | Skill capabilityManifest; forbidden command validation; policy audit |
| Memory indexes secrets or forbidden files | low | critical | Pre-ingestion forbidden-source filter; blocked-source telemetry; tests |
| Memory retrieval causes stale or misleading context | med | high | Provenance, freshness, stale markers, conflict detection, why-used explanations |
| Dashboard action mutates executor state directly | low | high | Dashboard requests only; executor validates and applies state transitions |
| Extension/skill registry supply-chain risk | med | high | Local registry first, checksums, compatibility matrix, signed package placeholder |
| Too many platform surfaces create same-file conflicts | med | med | Component-only UI workspaces; single shell integration workspace |
| Experimental 6 overloads validation resources | med | med | Worktree isolation, integration queue, validation lock, safe batch preview |
| Dogfood self-improvement changes protected files unexpectedly | low | critical | Explicit protected-system approval; dry-run; budget; audit; rollback artifact |

---

## 7. Workstreams

### P11.0 — Spec, master-template v2.4 alignment, and executable contract normalization

**Goal:** Normalize the P11 plan, align it with the v2.4 plan-intake contract, and guarantee that Part 3 JSON is the authoritative executable source before product-code work begins.

**Dependencies:** `none`  
**Expected batch:** `batch_0`  
**Queue priority:** `critical`  
**Risk level:** `medium`  
**Conflict scope:** `docs/**, plans/**, templates/**`

**Requirements:**
* Produce a valid executable contract for P11 using the v2.4 plan-intake and optimizer semantics.
* Define the full dependency graph, safe batch preview, critical path, and queue priorities.
* State clearly that generated previews are advisory until recomputed and approved by Pi during plan intake.
* Avoid any runnable workspace IDs that can collide with previous P10/P10R identifiers.

**Acceptance Criteria:**
* Part 3 JSON parses successfully with no unresolved placeholders.
* The workspace graph is acyclic and all dependency references point to existing workspaces.
* The plan encodes 21 runnable workspaces: P11.0 plus P11.A through P11.T.
* Peak batch width is <= 6 and dashboard shell wiring is isolated to one workspace.

**Isolation & Parallelism Notes:**
* Can run with: `none`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Runs alone because a malformed contract can cause the executor to parse the plan incorrectly. This mirrors the P10R lesson: normalize the executable DAG before code work begins.

### P11.A — Platform capability manifest and shared contracts

**Goal:** Create shared domain contracts for orchestrator, plan intake, extension, skill, memory, policy, audit, and dashboard surfaces.

**Dependencies:** `P11.0`  
**Expected batch:** `batch_1`  
**Queue priority:** `critical`  
**Risk level:** `medium`  
**Conflict scope:** `packages/coding-agent/src/platform/**, packages/web-server/src/platform/**, packages/web-ui/dashboard/src/platform/**`

**Requirements:**
* Define typed capability manifests for extensions, skills, memory providers, orchestrator jobs, and plan-intake optimizers.
* Define stable shared event names for platform actions and audit telemetry.
* Define compatibility metadata for Pi runtime version, dashboard version, and plan contract version.
* Expose shared contracts without introducing implementation-specific coupling between runtime and dashboard.

**Acceptance Criteria:**
* Shared TypeScript types compile and are imported by downstream workspaces.
* Capability manifests include permissions, version, compatibility, hooks, and audit requirements.
* No downstream workspace needs to redefine platform enums locally.
* Contract tests cover manifest validation and invalid capability declarations.

**Isolation & Parallelism Notes:**
* Can run with: `none`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Foundation workspace. It must complete before all parallel platform pillars start.

### P11.B — Always-on orchestrator daemon, scheduler, and health loop

**Goal:** Implement the continuously running orchestration layer that observes projects, schedules scans, manages budgets, and emits health state without bypassing approvals.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/orchestrator/**, packages/web-server/src/orchestrator/**`

**Requirements:**
* Add a durable orchestrator daemon with start, pause, stop, resume, and health states.
* Support scheduled repo scans, run-history scans, queue scans, dashboard-metric scans, and proposal refresh scans.
* Enforce rate limits, token budgets, per-project scan cadence, and backoff on repeated failures.
* Never mutate code, queue state, protected systems, or execution graphs directly.

**Acceptance Criteria:**
* The orchestrator can run continuously and expose current status through API/state store.
* The scheduler records last scan, next scan, skipped scan reasons, and failure backoff.
* Pause/resume is executor-mediated and auditable.
* Mutation attempts are blocked and logged as policy events.

**Isolation & Parallelism Notes:**
* Can run with: `P11.C, P11.D, P11.E, P11.F, P11.G`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Can run with P11.C-G because it owns orchestrator lifecycle and does not edit plan optimizer, extension, skill, memory, or policy internals except through shared contracts.

### P11.C — Plan intake analyzer and auto DAG optimizer core

**Goal:** Analyze uploaded plans automatically, recompute DAG and safe DAG previews, detect bottlenecks, and propose optimization patches before execution approval.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/plan-intake/**, packages/coding-agent/src/planner/**, packages/coding-agent/src/dag/**`

**Requirements:**
* Run automatically on plan upload or plan edit.
* Parse Part 3 JSON first and use Markdown fallback only as recovery mode.
* Compute original dependency graph, DAG batches, safe batches, critical path, serialized tail, and queue priority hints.
* Detect accidental serialization, suspicious missing dependencies, same-file conflicts, unsafe over-parallelization, and validation-lock bottlenecks.
* Generate optimizer proposals without applying graph mutations until approved.

**Acceptance Criteria:**
* Plan intake creates an analysis artifact for valid and recoverable plans.
* Authored batch previews are treated as advisory and recomputed previews are generated.
* Optimizer proposals include evidence, expected speedup, risk, changed fields, and rollback path.
* Execution remains blocked until plan intake and graph approval are current.

**Isolation & Parallelism Notes:**
* Can run with: `P11.B, P11.D, P11.E, P11.F, P11.G`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Core of the new v2.4 plan lifecycle. Does not share file ownership with orchestrator daemon or package registries.

### P11.D — Extension registry, package format, and runtime host

**Goal:** Create the extension ecosystem foundation: registry metadata, installable package format, runtime host, compatibility checks, and sandbox boundaries.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/extensions/**, packages/web-server/src/extensions/**`

**Requirements:**
* Define extension manifest fields: name, version, source, checksum, hooks, UI surfaces, runtime permissions, and compatibility matrix.
* Support local registry and future remote registry source abstractions.
* Implement a runtime host that loads enabled extensions through permission-checked hooks.
* Isolate extension failures so an extension crash does not crash core execution.

**Acceptance Criteria:**
* A test extension can be registered, enabled, loaded, disabled, and unloaded safely.
* Invalid manifests and incompatible versions are rejected before activation.
* Extension hooks cannot bypass executor-mediated state changes.
* Runtime host emits health, error, and audit events.

**Isolation & Parallelism Notes:**
* Can run with: `P11.B, P11.C, P11.E, P11.F, P11.G`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Can run in parallel with skill and memory foundations because package models are isolated behind shared contracts.

### P11.E — Skill registry, package format, and skill runner

**Goal:** Implement reusable, testable skill packages that the orchestrator and workspaces can invoke through permissioned workflows.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/skills/**, packages/web-server/src/skills/**`

**Requirements:**
* Define skill manifest fields: name, version, inputs, outputs, allowed tools, allowed files, forbidden files, examples, tests, and quality gates.
* Implement a skill registry for installed and available skills.
* Implement a runner that can invoke a skill within a workspace context while preserving permissions and audit records.
* Expose skill test execution and failure reporting without allowing arbitrary unsafe commands.

**Acceptance Criteria:**
* A sample skill can be installed, listed, tested, invoked, disabled, and removed.
* Skill invocation respects capabilityManifest and forbidden command/file policies.
* Skill outputs can be attached to plan-intake, proposal, or remediation artifacts.
* Skill quality metadata is visible to downstream API/UI workspaces.

**Isolation & Parallelism Notes:**
* Can run with: `P11.B, P11.C, P11.D, P11.F, P11.G`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Parallel-safe with extension registry because it owns separate package/runtime namespaces.

### P11.F — Organic vector memory store and schema

**Goal:** Add an organic memory foundation for semantic, episodic, procedural, and execution memory, with provenance and safety constraints.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/memory/**, packages/coding-agent/src/retrieval/**`

**Requirements:**
* Define memory types: semantic, episodic, procedural, decision, failure, fix, proposal, plan, and validation memory.
* Add vector-like retrieval abstraction while allowing local fallback implementations.
* Record provenance for every memory item: source file/run/proposal/commit/log and timestamp.
* Protect secrets and forbidden files from indexing.
* Support compaction, decay, conflict detection, stale-memory marking, and explicit deletion.

**Acceptance Criteria:**
* Memory schema supports embedding metadata, content hash, source pointer, freshness, and safety classification.
* Forbidden file patterns are blocked before memory ingestion.
* Memory records can be queried by project, plan, workspace, capability, and semantic relevance.
* Tests cover provenance, stale memory, and forbidden-source exclusion.

**Isolation & Parallelism Notes:**
* Can run with: `P11.B, P11.C, P11.D, P11.E, P11.G`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Foundation only; ingestion/retrieval pipeline is implemented in P11.L after policy hooks exist.

### P11.G — Policy and permission model with protected capability gates

**Goal:** Create the common permission system for orchestrator, extensions, skills, memory, plan optimization, and self-improvement actions.

**Dependencies:** `P11.A`  
**Expected batch:** `batch_2`  
**Queue priority:** `critical`  
**Risk level:** `critical`  
**Conflict scope:** `packages/coding-agent/src/policy/**, packages/coding-agent/src/safety/**`

**Requirements:**
* Define permission scopes for read, analyze, propose, plan, dry-run, install, enable, execute, memory-index, memory-query, and protected-system modification.
* Require explicit self-modification approval for protected systems such as executor, validator, policy, queue, planner, and orchestrator runtime.
* Support deny-by-default for unknown extension and skill capabilities.
* Expose policy decisions as structured audit events.

**Acceptance Criteria:**
* Policy engine can evaluate extension, skill, orchestrator, memory, and optimizer actions.
* Protected-system mutations require explicit self-modification approval beyond normal approval.
* Unsafe actions are blocked before execution or activation.
* Policy tests include denied, allowed, requires-approval, and stale-approval cases.

**Isolation & Parallelism Notes:**
* Can run with: `P11.B, P11.C, P11.D, P11.E, P11.F`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Critical safety foundation. Downstream workspaces H-M depend on it.

### P11.H — Orchestrator proposal generation and self-improvement triggers

**Goal:** Connect continuous orchestration to proposal generation so Pi can suggest improvements to Pi itself without direct mutation.

**Dependencies:** `P11.B, P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/orchestrator/**, packages/coding-agent/src/proposals/**`

**Requirements:**
* Convert orchestrator observations into proposal candidates with evidence, confidence, risk, expected impact, and approval requirements.
* Support self-improvement categories: performance, reliability, dashboard UX, extension gap, skill gap, memory gap, validation bottleneck, and queue bottleneck.
* Detect stale proposals and superseded proposals.
* Never enqueue or execute a proposal without approval.

**Acceptance Criteria:**
* The orchestrator can create proposal records from scan findings.
* Each proposal has evidence links, confidence, risk level, policy classification, and suggested next action.
* Self-modification proposals are flagged separately and require explicit approval.
* Proposal generation is idempotent and avoids duplicate spam.

**Isolation & Parallelism Notes:**
* Can run with: `P11.I, P11.J, P11.K, P11.L, P11.M`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Parallel-safe with plan diff, extension APIs, skill APIs, memory pipeline, and audit events because it consumes their contracts rather than editing their internals.

### P11.I — Plan graph diff and optimizer patch approval engine

**Goal:** Turn auto DAG optimizer output into reviewable original-vs-optimized graph diffs and approval-gated dependency patches.

**Dependencies:** `P11.C, P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/plan-intake/**, packages/coding-agent/src/approval/**`

**Requirements:**
* Represent optimizer patches as structured changes to dependencies, parallel groups, queue priorities, canRunWith, cannotRunWith, and conflict scopes.
* Reject patch proposals that alter safety hard stops, forbidden files, forbidden commands, or capability permissions automatically.
* Compute before/after effective parallelism, safe effective parallelism, critical path length, serialized tail length, and expected speedup.
* Persist approved graph hash and mark approval stale when source plan or graph changes.

**Acceptance Criteria:**
* Original and optimized graph diffs can be generated for a plan with at least ten workspaces.
* Invalid patches are rejected with actionable reasons.
* Approved graph hash is persisted and executor uses the approved graph, not stale authored previews.
* Approval state transitions are audited.

**Isolation & Parallelism Notes:**
* Can run with: `P11.H, P11.J, P11.K, P11.L, P11.M`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Consumes P11.C analyzer output and P11.G policy decisions.

### P11.J — Extension install, update, rollback, and health backend APIs

**Goal:** Expose backend APIs for extension discovery, install, update, enable, disable, rollback, logs, and health.

**Dependencies:** `P11.D, P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `high`  
**Risk level:** `high`  
**Conflict scope:** `packages/web-server/src/extensions/**, packages/coding-agent/src/extensions/**`

**Requirements:**
* Add APIs for available extensions, installed extensions, install requests, enable/disable, update, rollback, uninstall, logs, and health.
* Require permission review before activation and compatibility validation before install.
* Store extension state durably per project.
* Support local registry sources first and keep remote registry as an abstraction.

**Acceptance Criteria:**
* Extension lifecycle APIs work for a local test extension.
* Enable/install operations are policy-checked and auditable.
* Rollback restores prior extension version or disables the extension safely if rollback is unavailable.
* APIs return structured errors for invalid manifests, denied permissions, and incompatible versions.

**Isolation & Parallelism Notes:**
* Can run with: `P11.H, P11.I, P11.K, P11.L, P11.M`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Depends on extension runtime and policy gate. UI work starts after this API exists.

### P11.K — Skill install, test, use, and recommendation backend APIs

**Goal:** Expose backend APIs that make skills discoverable, testable, invokable, and recommendable for plans, proposals, and workspaces.

**Dependencies:** `P11.E, P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `high`  
**Risk level:** `high`  
**Conflict scope:** `packages/web-server/src/skills/**, packages/coding-agent/src/skills/**`

**Requirements:**
* Add APIs for available skills, installed skills, install/update/remove, enable/disable, test run, invocation history, and recommendation.
* Expose capability, permission, example, and quality metadata to dashboard.
* Allow plan-intake/orchestrator surfaces to recommend skills without auto-installing or auto-running them.
* Enforce capabilityManifest and policy checks on every invocation.

**Acceptance Criteria:**
* A sample skill can be installed, tested, and invoked through backend API.
* Skill test failures are captured with logs and quality status.
* Skill recommendations can be attached to proposals or workspaces.
* Denied skill invocations produce policy audit events.

**Isolation & Parallelism Notes:**
* Can run with: `P11.H, P11.I, P11.J, P11.L, P11.M`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Parallel-safe with extension API because it owns a separate API namespace.

### P11.L — Memory ingestion, retrieval, provenance, and compaction pipeline

**Goal:** Implement memory indexing and retrieval flows with provenance, safety filtering, token savings telemetry, stale-memory handling, and compaction.

**Dependencies:** `P11.F, P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `high`  
**Risk level:** `high`  
**Conflict scope:** `packages/coding-agent/src/memory/**, packages/coding-agent/src/retrieval/**, packages/web-server/src/memory/**`

**Requirements:**
* Ingest safe sources: plans, proposals, run summaries, validation outcomes, failure classifications, accepted fixes, extension/skill metadata, and dashboard metrics.
* Reject forbidden files and secrets before chunking or indexing.
* Expose retrieval with provenance and why-this-memory-was-used explanations.
* Track retrieval hit rate, token savings, stale-memory rate, conflict rate, and pruning decisions.
* Support reindex, prune, compact, and forget operations.

**Acceptance Criteria:**
* Memory pipeline indexes a representative plan/run/proposal set and retrieves relevant memories with source provenance.
* Forbidden sources are blocked and counted.
* Retrieval responses include confidence and source pointers.
* Compaction preserves provenance and marks superseded memory.

**Isolation & Parallelism Notes:**
* Can run with: `P11.H, P11.I, P11.J, P11.K, P11.M`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Consumes memory schema and policy gates. UI depends on this pipeline.

### P11.M — Audit ledger events for platform actions

**Goal:** Add a platform-level audit ledger for orchestrator decisions, plan-intake optimizer suggestions, extension lifecycle events, skill invocations, memory operations, and policy decisions.

**Dependencies:** `P11.G`  
**Expected batch:** `batch_3`  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Conflict scope:** `packages/coding-agent/src/audit/**, packages/web-server/src/audit/**`

**Requirements:**
* Define audit event types for orchestrator, plan intake, optimizer, extension, skill, memory, policy, registry, and self-improvement actions.
* Record actor, target, project, request, policy decision, approval state, before/after where applicable, and rollback pointer.
* Provide query APIs for dashboard audit timelines.
* Ensure no autonomous self-improvement action can complete without audit trace.

**Acceptance Criteria:**
* Audit events are emitted for allowed, denied, pending-approval, approved, rejected, and rollback actions.
* Events can be filtered by project, capability, workspace, proposal, extension, skill, and memory source.
* Audit event persistence is tested.
* Audit schema supports future enterprise export without changing core event semantics.

**Isolation & Parallelism Notes:**
* Can run with: `P11.H, P11.I, P11.J, P11.K, P11.L`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Fan-out support workspace for UI and dogfood. Does not block H-L except where direct event schemas are needed; safe to run in the same batch.

### P11.N — Autonomy and Self-Improvement Center UI

**Goal:** Build the dashboard surface for orchestrator status, scan cadence, health, latest proposals, self-improvement triggers, and approval-required actions.

**Dependencies:** `P11.H, P11.M`  
**Expected batch:** `batch_4`  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Conflict scope:** `packages/web-ui/dashboard/src/features/autonomy/**`

**Requirements:**
* Show orchestrator status, health, last scan, next scan, skipped reasons, backoff, budgets, and rate limits.
* Show top proposal candidates with confidence, risk, expected impact, evidence, and required approval type.
* Provide pause/resume/request-scan actions through executor-mediated API calls.
* Clearly separate read-only observations from executable actions.

**Acceptance Criteria:**
* Autonomy screen renders orchestrator health and proposal cards from backend data.
* Actions are disabled or marked pending when policy requires approval.
* Self-modification proposals are visually distinguished.
* Loading, empty, error, and stale states are implemented.

**Isolation & Parallelism Notes:**
* Can run with: `P11.O, P11.P, P11.Q, P11.R`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Component-only UI. No final dashboard shell wiring in this workspace.

### P11.O — Plan Intake and DAG Diff UI

**Goal:** Build the dashboard surface for uploaded plan analysis, doctor results, original vs optimized DAG diff, safe batch preview, and optimization approval.

**Dependencies:** `P11.I, P11.M`  
**Expected batch:** `batch_4`  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Conflict scope:** `packages/web-ui/dashboard/src/features/plan-intake/**`

**Requirements:**
* Show parse status, doctor warnings/errors, normalized contract status, original graph, optimized graph, and graph diff.
* Show effective parallelism, safe effective parallelism, critical path, serialized tail, and bottleneck reasons.
* Provide approve/reject/request-changes controls for optimizer patches.
* Show why authored batch previews are advisory and recomputed previews are authoritative after approval.

**Acceptance Criteria:**
* Plan-intake UI can display a multi-workspace plan analysis and optimizer patch diff.
* Optimization approval writes an approval request through backend API rather than mutating executor state directly.
* The UI highlights unsafe optimizer changes and blocked reasons.
* Graph and safe batch previews render loading, empty, error, and stale states.

**Isolation & Parallelism Notes:**
* Can run with: `P11.N, P11.P, P11.Q, P11.R`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Component-only UI. No App shell route wiring here.

### P11.P — Extensions and Skills Manager UI

**Goal:** Build a combined platform manager for extensions and skills: install, update, enable, disable, rollback, test, permissions, compatibility, and logs.

**Dependencies:** `P11.J, P11.K, P11.M`  
**Expected batch:** `batch_4`  
**Queue priority:** `high`  
**Risk level:** `medium`  
**Conflict scope:** `packages/web-ui/dashboard/src/features/platform-marketplace/**`

**Requirements:**
* Show available and installed extensions with version, compatibility, permissions, source, status, and health.
* Show available and installed skills with capability, examples, quality, test status, and invocation history.
* Support install/update/rollback/enable/disable/test actions through backend APIs.
* Show permission review before activation.

**Acceptance Criteria:**
* Extension and skill cards render from backend data.
* Install/enable/test flows display policy decisions and audit links.
* Rollback and disable flows are visible and safe.
* Compatibility warnings and invalid manifest errors are actionable.

**Isolation & Parallelism Notes:**
* Can run with: `P11.N, P11.O, P11.Q, P11.R`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Combines extension and skill UI to keep P11 to 20 implementation workspaces.

### P11.Q — Memory Cockpit UI

**Goal:** Build the dashboard surface for organic memory health, indexed sources, retrieval quality, provenance, token savings, stale memories, and safe management actions.

**Dependencies:** `P11.L, P11.M`  
**Expected batch:** `batch_4`  
**Queue priority:** `normal`  
**Risk level:** `medium`  
**Conflict scope:** `packages/web-ui/dashboard/src/features/memory/**`

**Requirements:**
* Show indexed source counts by type and project.
* Show retrieval hit rate, token savings, stale-memory count, blocked-source count, conflict count, and pruning/compaction status.
* Show top memories used for a selected plan/proposal with provenance and why-used explanations.
* Support reindex, compact, prune, and forget requests through policy-checked APIs.

**Acceptance Criteria:**
* Memory Cockpit renders health metrics and source breakdowns.
* Users can inspect memory provenance without exposing forbidden content.
* Memory management actions are policy-gated and auditable.
* Loading, empty, error, stale, and blocked-source states are implemented.

**Isolation & Parallelism Notes:**
* Can run with: `P11.N, P11.O, P11.P, P11.R`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Component-only UI. Memory actions must not directly mutate memory state from the browser.

### P11.R — Policy and Audit Center UI

**Goal:** Build a dashboard surface for permissions, protected systems, approvals, policy decisions, denied actions, audit timeline, and rollback pointers.

**Dependencies:** `P11.M`  
**Expected batch:** `batch_4`  
**Queue priority:** `normal`  
**Risk level:** `medium`  
**Conflict scope:** `packages/web-ui/dashboard/src/features/policy-audit/**`

**Requirements:**
* Show protected systems and which capabilities require explicit approval.
* Show extension, skill, memory, orchestrator, and optimizer permissions.
* Show audit timeline with filters by action, actor, capability, proposal, plan, workspace, extension, skill, memory source, and policy result.
* Provide approval request views without allowing direct executor-state mutation.

**Acceptance Criteria:**
* Policy & Audit Center can display allow/deny/pending/approved/rejected events.
* Protected-system approval requests are clearly separated from normal approvals.
* Audit filters and detail view work for representative event types.
* Rollback pointers are visible when available.

**Isolation & Parallelism Notes:**
* Can run with: `P11.N, P11.O, P11.P, P11.Q`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Component-only UI. Safe to run with other dashboard feature screens because it owns a distinct feature directory.

### P11.S — Dashboard shell, navigation integration, and registry settings

**Goal:** Wire P11 dashboard surfaces into the shell, routes, navigation, and registry settings without parallel same-file conflicts.

**Dependencies:** `P11.N, P11.O, P11.P, P11.Q, P11.R`  
**Expected batch:** `batch_5`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `packages/web-ui/dashboard/src/App.tsx, packages/web-ui/dashboard/src/components/LeftNav.tsx, packages/web-ui/dashboard/src/routes/**, packages/web-ui/dashboard/src/features/settings/**`

**Requirements:**
* Add a Platform navigation group with Autonomy, Plan Intake, Extensions & Skills, Memory, Policy & Audit, and Registry Settings.
* Wire feature screens exactly once into the dashboard shell.
* Add registry settings for local registry paths, remote registry placeholders, trusted channels, and update policy.
* Avoid duplicate legacy routes and preserve existing P10R layout primitives.

**Acceptance Criteria:**
* New Platform nav entries route to the correct screens.
* Dashboard shell compiles without duplicate component mounts.
* Registry settings render and save through backend API or state stub as appropriate.
* No other workspace owns App.tsx or final nav wiring.

**Isolation & Parallelism Notes:**
* Can run with: `none`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Runs alone because shell and navigation files are high-conflict. This preserves the P10R pattern.

### P11.T — Integration, migrations, E2E validation, dogfood, and final report

**Goal:** Run final integration, migrations, build/typecheck/E2E validation, and dogfood where Pi proposes, plans, dry-runs, and safely ships one small self-improvement.

**Dependencies:** `P11.S`  
**Expected batch:** `batch_6`  
**Queue priority:** `critical`  
**Risk level:** `high`  
**Conflict scope:** `test/**, docs/pi/stability/**, packages/**`

**Requirements:**
* Run typecheck, build, targeted tests, integration tests, and dashboard E2E/visual smoke where available.
* Validate database/state migrations or JSON fallback schema changes.
* Dogfood the full self-improvement loop: orchestrator observation -> proposal -> plan-intake optimization -> dry-run -> approval gate -> bounded execution -> validation -> audit.
* Attach final report with metrics, known limitations, rollback instructions, and follow-up work.

**Acceptance Criteria:**
* Typecheck, build, and required tests pass or failures are documented with handoff artifacts.
* Dogfood proves no unauthorized mutation, no forbidden commands, and no unapproved protected-system change.
* Final report includes proposal quality, accepted proposal rate, optimizer speedup estimate, memory token savings, extension/skill health, and audit completeness.
* P11 Definition of Done is verified.

**Isolation & Parallelism Notes:**
* Can run with: `none`
* Same-file parallelism allowed: `false`
* Worktree required: `true`
* Integration queue required: `true`
* Notes: Final validation and dogfood tail. Runs alone by design.

---

## 8. Combined Implementation Order

```text
Batch 0: P11.0
Batch 1: P11.A
Batch 2: P11.B + P11.C + P11.D + P11.E + P11.F + P11.G
Batch 3: P11.H + P11.I + P11.J + P11.K + P11.L + P11.M
Batch 4: P11.N + P11.O + P11.P + P11.Q + P11.R
Batch 5: P11.S
Batch 6: P11.T
```

### Batching rationale

* **Batch 0** runs alone because it normalizes the executable plan and v2.4 contract semantics.
* **Batch 1** runs alone because shared contracts must stabilize before platform pillars begin.
* **Batch 2** uses the full 6-worker capacity across independent platform foundations: orchestrator, plan intake, extensions, skills, memory, and policy.
* **Batch 3** again uses full 6-worker capacity across backend integrations that depend on the foundations.
* **Batch 4** runs five dashboard feature workspaces in parallel. They are component-only and must not wire the final dashboard shell.
* **Batch 5** runs dashboard shell/nav integration alone to avoid `App.tsx`, route, and navigation conflicts.
* **Batch 6** runs final integration, validation, migration checks, dogfood, and final report alone.

### Capacity table

| Batch | Workspaces | Width | Capacity Used |
|---:|---|---:|---:|
| 0 | `P11.0` | 1 | 1/6 |
| 1 | `P11.A` | 1 | 1/6 |
| 2 | `P11.B, P11.C, P11.D, P11.E, P11.F, P11.G` | 6 | 6/6 |
| 3 | `P11.H, P11.I, P11.J, P11.K, P11.L, P11.M` | 6 | 6/6 |
| 4 | `P11.N, P11.O, P11.P, P11.Q, P11.R` | 5 | 5/6 |
| 5 | `P11.S` | 1 | 1/6 |
| 6 | `P11.T` | 1 | 1/6 |

---

## 9. Definition of Done

P11 is complete when ALL are true:

* [ ] P11 executable contract parses and validates.
* [ ] Plan-intake lifecycle runs automatically on upload or plan edit.
* [ ] Pi recomputes DAG and safe DAG previews rather than trusting authored previews.
* [ ] Optimizer can generate original-vs-optimized graph diffs.
* [ ] Optimizer patches require approval before application.
* [ ] Always-on orchestrator daemon exposes health, cadence, budgets, and proposal generation state.
* [ ] Orchestrator can propose self-improvements without mutating code, queue, or protected systems.
* [ ] Extension registry supports install, enable, disable, update, rollback, logs, health, compatibility, and permission review.
* [ ] Skill registry supports install, test, invoke, recommendation, quality metadata, and permission review.
* [ ] Organic memory supports safe ingestion, retrieval, provenance, freshness, stale markers, compaction, pruning, and token-savings telemetry.
* [ ] Policy engine governs orchestrator, optimizer, extension, skill, and memory actions.
* [ ] Protected-system changes require explicit self-modification approval.
* [ ] Platform audit ledger records all relevant actions and policy decisions.
* [ ] Dashboard includes Platform navigation for Autonomy, Plan Intake, Extensions & Skills, Memory, Policy & Audit, and Registry Settings.
* [ ] Dashboard actions are executor-mediated and do not mutate execution state directly.
* [ ] P11 dogfood proves Pi can propose, plan, dry-run, and safely ship one small self-improvement.
* [ ] No unauthorized mutation occurs during dogfood.
* [ ] No forbidden commands or files are used.
* [ ] Typecheck, build, targeted tests, integration validation, and dashboard smoke/E2E checks pass or have handoff artifacts.
* [ ] Integration queue is clean or intentionally blocked with handoff.
* [ ] Rollback instructions and final report are attached.

---

## 10. Rollback Playbook

**Trigger conditions:**

* Orchestrator mutates code, queue, protected system, or execution graph without approval.
* Optimizer applies dependency patches without approval.
* Extension or skill bypasses capability permissions.
* Memory indexes forbidden files, credentials, or secrets.
* Dashboard control directly mutates executor state.
* Protected-system mutation occurs without explicit self-modification approval.
* Integration queue merges an unvalidated platform diff.
* Dogfood produces unauthorized mutation or missing audit trail.
* Scale mode readiness becomes stale or invalid.

**Rollback procedure:**

1. Disable always-on orchestrator daemon.
2. Set scale mode to `stable_3` and `maxParallelWorkspaces` to `3` or lower.
3. Disable extension activation; keep extension registry read-only.
4. Disable skill invocation; keep skill registry read-only.
5. Disable memory writes and indexing; keep read-only query disabled if safety is uncertain.
6. Disable plan-intake optimizer patch application; keep analyzer read-only if safe.
7. Pause integration queue processing.
8. Preserve `.pi/worktrees/{planExecId}/`, platform audit logs, memory snapshots, registry snapshots, and optimizer artifacts.
9. Fall back to existing manual plan approval and P9 approval-gated remediation.
10. Revert P11 commits independently in reverse dependency order if needed.

---

## 11. What Next Phase Inherits

P12 inherits:

* Always-on orchestrator daemon and scheduler.
* Plan-intake analyzer and auto DAG optimizer.
* Original-vs-optimized graph diff and optimizer approval engine.
* Extension registry and runtime host.
* Skill registry and runner.
* Organic memory store and retrieval pipeline.
* Policy and permission model for platform capabilities.
* Platform audit ledger.
* Dashboard Platform navigation and management surfaces.
* Self-improvement proposal loop.
* P11 dogfood evidence.

P12 may add:

* Remote extension registry and signed package verification.
* Cloud or remote workers.
* Enterprise audit export.
* Team-level approval roles.
* Multi-project orchestrator scheduling.
* Release orchestration and deployment approvals.
* Marketplace publishing workflow.
* Advanced memory evaluation and retrieval benchmarking.

---

# Part 2 — Agent Brief

## Mission

Implement P11 so Pi becomes a self-improving platform rather than only an autonomous executor. The agent must build the orchestrator, plan-intake optimizer, extension and skill ecosystem, organic memory base, policy/audit layer, and dashboard surfaces while preserving approval-gated execution, protected-system safety, worktree isolation, integration queue correctness, and validation integrity.

The agent must optimize for safe parallelism, not raw concurrency. P11 can use six workers only because worktree isolation, integration queue, validation lock, archive support, and completion gate hardening are assumed active under `experimental_6`.

## Hard Requirements

1. Implement only the workstreams defined in this P11 plan.
2. Do not exceed 6 concurrent workspaces.
3. Do not run any workspace outside worktree isolation.
4. Do not bypass integration queue or validation requirements.
5. Do not mutate protected systems without explicit self-modification approval.
6. Do not allow orchestrator, extensions, skills, memory, or optimizer to mutate executor state directly.
7. Do not apply optimizer graph patches without approval.
8. Do not trust authored batch previews as authoritative; recompute and persist approved graph.
9. Do not index forbidden files or secrets into memory.
10. Do not install or enable extensions or skills without permission review.
11. Do not run watch-mode validation.
12. Do not run `git push`.
13. Do not run raw destructive cleanup commands.
14. Do not access secrets or forbidden files.
15. Dashboard controls must remain executor-mediated.
16. All platform actions must emit audit events.
17. Dogfood must prove no unauthorized mutation.

## Execution Policies

```yaml
scale:
  default_mode: experimental_6
  selected_mode: experimental_6
  max_parallel_workspaces: 6
  fallback_mode: stable_3

worktree:
  enabled_by_default: true
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

plan_intake:
  enabled: true
  run_on_upload: true
  parse_part3_json_first: true
  markdown_fallback_recovery_only: true
  recompute_dag_preview: true
  recompute_safe_batch_preview: true
  auto_optimizer_proposal: true
  approval_required_before_graph_patch: true
  approval_required_before_execution: true

optimizer:
  mode: advisory_until_approved
  objectives:
    - maximize_safe_effective_parallelism
    - minimize_critical_path
    - minimize_validation_lock_contention
    - minimize_same_file_conflicts
    - prioritize_critical_path_queue_merges

platform_capabilities:
  orchestrator_default_mode: read_only
  extension_activation_requires_permission_review: true
  skill_invocation_requires_permission_review: true
  memory_indexing_forbidden_files_blocked: true
  protected_system_approval_required: true

validation:
  global_validation_lock_required: true
  targeted_validation_enabled: true
  final_integration_validation_required: true
  watch_mode_forbidden: true
```

## Safety Stops

Hard stop execution for:

* Dependency cycles.
* Invalid dependency patches.
* Required plan intake not completed.
* Optimizer patch without approval.
* Stale approved graph hash.
* Worktree path escaping `.pi/worktrees`.
* Raw destructive cleanup.
* Integration merge without workspace validation.
* Integration validation failure.
* Merge conflict without handoff artifact.
* Unsafe scale mode.
* Queue starting next plan while integration queue is dirty.
* Forbidden file access.
* Secrets access.
* `git push`.
* Watch-mode validation command.
* Extension permission denied.
* Skill permission denied.
* Memory forbidden-source indexing attempt.
* Protected-system mutation without explicit self-modification approval.
* Dashboard direct state mutation.

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract for Pi's PostgreSQL-backed multi-project autonomous execution system. Pi parses this section first to build the execution plan. Markdown headings are recovery only.

```json
{
  "contractVersion": "2.4.0",
  "executionBackend": "postgres",
  "project": {
    "name": "pi",
    "rootPath": ".",
    "type": "repo",
    "tags": [
      "p11",
      "ecosystem",
      "continuous-self-improvement",
      "extensions",
      "skills",
      "memory",
      "plan-intake"
    ]
  },
  "planExecution": {
    "phase": "P11",
    "title": "Ecosystem & Continuous Self-Improvement Platform",
    "mode": "autonomous",
    "maxParallelWorkspaces": 6,
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
      "watch_mode_validation",
      "execution_without_dry_run",
      "execution_without_approval",
      "protected_system_mutation_without_explicit_approval",
      "extension_permission_denied",
      "skill_permission_denied",
      "memory_forbidden_source_indexing",
      "optimizer_patch_without_approval"
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
      "warnings": [
        "Integration queue serializes merges after workspace completion.",
        "Final shell integration and dogfood run alone by design."
      ],
      "prerequisites": [
        {
          "key": "worktree_isolation",
          "required": true,
          "met": true,
          "message": "Required and enabled for experimental_6."
        },
        {
          "key": "integration_queue",
          "required": true,
          "met": true,
          "message": "Required and enabled for experimental_6."
        },
        {
          "key": "validation_lock",
          "required": true,
          "met": true,
          "message": "Required and active for experimental_6."
        },
        {
          "key": "archive",
          "required": true,
          "met": true,
          "message": "Required for experimental_6."
        },
        {
          "key": "completion_gate",
          "required": true,
          "met": true,
          "message": "Required and active for experimental_6."
        }
      ]
    },
    "expectedDagEffectiveParallelismMin": 3,
    "expectedSafeEffectiveParallelismMin": 3,
    "dagEffectiveParallelism": 6,
    "safeEffectiveParallelism": 6,
    "preflightStatus": "required",
    "approvalState": "pending",
    "batchingStrategy": "dag_topological_batches",
    "safeBatchingStrategy": "dag_batches_with_p6_safety_constraints",
    "batchPreview": {
      "batches": [
        {
          "batch": 0,
          "workspaceIds": [
            "P11.0"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 1,
          "workspaceIds": [
            "P11.A"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P11.B",
            "P11.C",
            "P11.D",
            "P11.E",
            "P11.F",
            "P11.G"
          ],
          "effectiveParallelism": 6
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P11.H",
            "P11.I",
            "P11.J",
            "P11.K",
            "P11.L",
            "P11.M"
          ],
          "effectiveParallelism": 6
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P11.N",
            "P11.O",
            "P11.P",
            "P11.Q",
            "P11.R"
          ],
          "effectiveParallelism": 5
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P11.S"
          ],
          "effectiveParallelism": 1
        },
        {
          "batch": 6,
          "workspaceIds": [
            "P11.T"
          ],
          "effectiveParallelism": 1
        }
      ],
      "overallEffectiveParallelism": 3.0,
      "criticalPath": [
        "P11.0",
        "P11.A",
        "P11.C",
        "P11.I",
        "P11.O",
        "P11.S",
        "P11.T"
      ],
      "criticalPathLength": 7,
      "serializedTailLength": 2
    },
    "safeBatchPreview": {
      "batches": [
        {
          "batch": 0,
          "workspaceIds": [
            "P11.0"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 1,
          "workspaceIds": [
            "P11.A"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 2,
          "workspaceIds": [
            "P11.B",
            "P11.C",
            "P11.D",
            "P11.E",
            "P11.F",
            "P11.G"
          ],
          "safeEffectiveParallelism": 6,
          "blockedParallelismReasons": []
        },
        {
          "batch": 3,
          "workspaceIds": [
            "P11.H",
            "P11.I",
            "P11.J",
            "P11.K",
            "P11.L",
            "P11.M"
          ],
          "safeEffectiveParallelism": 6,
          "blockedParallelismReasons": []
        },
        {
          "batch": 4,
          "workspaceIds": [
            "P11.N",
            "P11.O",
            "P11.P",
            "P11.Q",
            "P11.R"
          ],
          "safeEffectiveParallelism": 5,
          "blockedParallelismReasons": []
        },
        {
          "batch": 5,
          "workspaceIds": [
            "P11.S"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        },
        {
          "batch": 6,
          "workspaceIds": [
            "P11.T"
          ],
          "safeEffectiveParallelism": 1,
          "blockedParallelismReasons": []
        }
      ],
      "overallSafeEffectiveParallelism": 3.0,
      "bottlenecks": [
        "foundation_contract_bottleneck",
        "dashboard_shell_single_owner",
        "integration_validation_serialization",
        "dogfood_final_tail"
      ],
      "blockedParallelismReasons": [
        "P11.0 and P11.A are intentionally serialized foundations.",
        "P11.S owns dashboard shell and navigation wiring alone.",
        "P11.T performs final integration, validation, and dogfood alone."
      ]
    },
    "optimizationReview": {
      "originalGraphHash": null,
      "proposedGraphHash": null,
      "approvedGraphHash": null,
      "originalDagEffectiveParallelism": null,
      "proposedDagEffectiveParallelism": 6,
      "originalSafeEffectiveParallelism": null,
      "proposedSafeEffectiveParallelism": 6,
      "criticalPathDelta": null,
      "serializedTailDelta": null,
      "suggestions": [],
      "approvalState": "pending"
    },
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
      "queue_optimization_strategy_invalid_for_mode",
      "optimizer_patch_without_approval",
      "extension_permission_requires_review",
      "skill_permission_requires_review",
      "memory_forbidden_source_indexing"
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
      "plan_intake_analysis",
      "optimizer_proposal",
      "graph_diff",
      "extension_registry_snapshot",
      "skill_registry_snapshot",
      "memory_index_snapshot",
      "platform_audit_timeline"
    ]
  },
  "workspaces": [
    {
      "id": "P11.0",
      "title": "Spec, master-template v2.4 alignment, and executable contract normalization",
      "dependencies": [],
      "parallelGroup": "batch_0",
      "dependencyReason": "Foundation or preflight workspace with no dependencies.",
      "parallelism": {
        "expectedBatch": "batch_0",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "docs/**",
          "plans/**",
          "templates/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Runs alone because a malformed contract can cause the executor to parse the plan incorrectly. This mirrors the P10R lesson: normalize the executable DAG before code work begins."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "docs/**",
        "plans/**",
        "templates/**"
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
      ],
      "acceptanceCriteria": [
        "Part 3 JSON parses successfully with no unresolved placeholders.",
        "The workspace graph is acyclic and all dependency references point to existing workspaces.",
        "The plan encodes 21 runnable workspaces: P11.0 plus P11.A through P11.T.",
        "Peak batch width is <= 6 and dashboard shell wiring is isolated to one workspace."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "docs/**",
          "plans/**",
          "templates/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.A",
      "title": "Platform capability manifest and shared contracts",
      "dependencies": [
        "P11.0"
      ],
      "parallelGroup": "batch_1",
      "dependencyReason": "Depends on P11.0",
      "parallelism": {
        "expectedBatch": "batch_1",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/platform/**",
          "packages/web-server/src/platform/**",
          "packages/web-ui/dashboard/src/platform/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation workspace. It must complete before all parallel platform pillars start."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/platform/**",
        "packages/web-server/src/platform/**",
        "packages/web-ui/dashboard/src/platform/**"
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
      ],
      "acceptanceCriteria": [
        "Shared TypeScript types compile and are imported by downstream workspaces.",
        "Capability manifests include permissions, version, compatibility, hooks, and audit requirements.",
        "No downstream workspace needs to redefine platform enums locally.",
        "Contract tests cover manifest validation and invalid capability declarations."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/platform/**",
          "packages/web-server/src/platform/**",
          "packages/web-ui/dashboard/src/platform/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.B",
      "title": "Always-on orchestrator daemon, scheduler, and health loop",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.C",
          "P11.D",
          "P11.E",
          "P11.F",
          "P11.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/orchestrator/**",
          "packages/web-server/src/orchestrator/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run with P11.C-G because it owns orchestrator lifecycle and does not edit plan optimizer, extension, skill, memory, or policy internals except through shared contracts."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/orchestrator/**",
        "packages/web-server/src/orchestrator/**"
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
      ],
      "acceptanceCriteria": [
        "The orchestrator can run continuously and expose current status through API/state store.",
        "The scheduler records last scan, next scan, skipped scan reasons, and failure backoff.",
        "Pause/resume is executor-mediated and auditable.",
        "Mutation attempts are blocked and logged as policy events."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/orchestrator/**",
          "packages/web-server/src/orchestrator/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.C",
      "title": "Plan intake analyzer and auto DAG optimizer core",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.B",
          "P11.D",
          "P11.E",
          "P11.F",
          "P11.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/plan-intake/**",
          "packages/coding-agent/src/planner/**",
          "packages/coding-agent/src/dag/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Core of the new v2.4 plan lifecycle. Does not share file ownership with orchestrator daemon or package registries."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/plan-intake/**",
        "packages/coding-agent/src/planner/**",
        "packages/coding-agent/src/dag/**"
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
      ],
      "acceptanceCriteria": [
        "Plan intake creates an analysis artifact for valid and recoverable plans.",
        "Authored batch previews are treated as advisory and recomputed previews are generated.",
        "Optimizer proposals include evidence, expected speedup, risk, changed fields, and rollback path.",
        "Execution remains blocked until plan intake and graph approval are current."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/plan-intake/**",
          "packages/coding-agent/src/planner/**",
          "packages/coding-agent/src/dag/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.D",
      "title": "Extension registry, package format, and runtime host",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.B",
          "P11.C",
          "P11.E",
          "P11.F",
          "P11.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/extensions/**",
          "packages/web-server/src/extensions/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Can run in parallel with skill and memory foundations because package models are isolated behind shared contracts."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/extensions/**",
        "packages/web-server/src/extensions/**"
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
      ],
      "acceptanceCriteria": [
        "A test extension can be registered, enabled, loaded, disabled, and unloaded safely.",
        "Invalid manifests and incompatible versions are rejected before activation.",
        "Extension hooks cannot bypass executor-mediated state changes.",
        "Runtime host emits health, error, and audit events."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/extensions/**",
          "packages/web-server/src/extensions/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.E",
      "title": "Skill registry, package format, and skill runner",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.B",
          "P11.C",
          "P11.D",
          "P11.F",
          "P11.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/skills/**",
          "packages/web-server/src/skills/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Parallel-safe with extension registry because it owns separate package/runtime namespaces."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/skills/**",
        "packages/web-server/src/skills/**"
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
      ],
      "acceptanceCriteria": [
        "A sample skill can be installed, listed, tested, invoked, disabled, and removed.",
        "Skill invocation respects capabilityManifest and forbidden command/file policies.",
        "Skill outputs can be attached to plan-intake, proposal, or remediation artifacts.",
        "Skill quality metadata is visible to downstream API/UI workspaces."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/skills/**",
          "packages/web-server/src/skills/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.F",
      "title": "Organic vector memory store and schema",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.B",
          "P11.C",
          "P11.D",
          "P11.E",
          "P11.G"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/memory/**",
          "packages/coding-agent/src/retrieval/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Foundation only; ingestion/retrieval pipeline is implemented in P11.L after policy hooks exist."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/memory/**",
        "packages/coding-agent/src/retrieval/**"
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
      ],
      "acceptanceCriteria": [
        "Memory schema supports embedding metadata, content hash, source pointer, freshness, and safety classification.",
        "Forbidden file patterns are blocked before memory ingestion.",
        "Memory records can be queried by project, plan, workspace, capability, and semantic relevance.",
        "Tests cover provenance, stale memory, and forbidden-source exclusion."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/memory/**",
          "packages/coding-agent/src/retrieval/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.G",
      "title": "Policy and permission model with protected capability gates",
      "dependencies": [
        "P11.A"
      ],
      "parallelGroup": "batch_2",
      "dependencyReason": "Depends on P11.A",
      "parallelism": {
        "expectedBatch": "batch_2",
        "canRunWith": [
          "P11.B",
          "P11.C",
          "P11.D",
          "P11.E",
          "P11.F"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/policy/**",
          "packages/coding-agent/src/safety/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Critical safety foundation. Downstream workspaces H-M depend on it."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/policy/**",
        "packages/coding-agent/src/safety/**"
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
      ],
      "acceptanceCriteria": [
        "Policy engine can evaluate extension, skill, orchestrator, memory, and optimizer actions.",
        "Protected-system mutations require explicit self-modification approval beyond normal approval.",
        "Unsafe actions are blocked before execution or activation.",
        "Policy tests include denied, allowed, requires-approval, and stale-approval cases."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "critical",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/policy/**",
          "packages/coding-agent/src/safety/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.H",
      "title": "Orchestrator proposal generation and self-improvement triggers",
      "dependencies": [
        "P11.B",
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.B, P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.I",
          "P11.J",
          "P11.K",
          "P11.L",
          "P11.M"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/orchestrator/**",
          "packages/coding-agent/src/proposals/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Parallel-safe with plan diff, extension APIs, skill APIs, memory pipeline, and audit events because it consumes their contracts rather than editing their internals."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/orchestrator/**",
        "packages/coding-agent/src/proposals/**"
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
      ],
      "acceptanceCriteria": [
        "The orchestrator can create proposal records from scan findings.",
        "Each proposal has evidence links, confidence, risk level, policy classification, and suggested next action.",
        "Self-modification proposals are flagged separately and require explicit approval.",
        "Proposal generation is idempotent and avoids duplicate spam."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/orchestrator/**",
          "packages/coding-agent/src/proposals/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.I",
      "title": "Plan graph diff and optimizer patch approval engine",
      "dependencies": [
        "P11.C",
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.C, P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.H",
          "P11.J",
          "P11.K",
          "P11.L",
          "P11.M"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/plan-intake/**",
          "packages/coding-agent/src/approval/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Consumes P11.C analyzer output and P11.G policy decisions."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/plan-intake/**",
        "packages/coding-agent/src/approval/**"
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
      ],
      "acceptanceCriteria": [
        "Original and optimized graph diffs can be generated for a plan with at least ten workspaces.",
        "Invalid patches are rejected with actionable reasons.",
        "Approved graph hash is persisted and executor uses the approved graph, not stale authored previews.",
        "Approval state transitions are audited."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/plan-intake/**",
          "packages/coding-agent/src/approval/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.J",
      "title": "Extension install, update, rollback, and health backend APIs",
      "dependencies": [
        "P11.D",
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.D, P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.H",
          "P11.I",
          "P11.K",
          "P11.L",
          "P11.M"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-server/src/extensions/**",
          "packages/coding-agent/src/extensions/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Depends on extension runtime and policy gate. UI work starts after this API exists."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-server/src/extensions/**",
        "packages/coding-agent/src/extensions/**"
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
      ],
      "acceptanceCriteria": [
        "Extension lifecycle APIs work for a local test extension.",
        "Enable/install operations are policy-checked and auditable.",
        "Rollback restores prior extension version or disables the extension safely if rollback is unavailable.",
        "APIs return structured errors for invalid manifests, denied permissions, and incompatible versions."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/extensions/**",
          "packages/coding-agent/src/extensions/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.K",
      "title": "Skill install, test, use, and recommendation backend APIs",
      "dependencies": [
        "P11.E",
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.E, P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.H",
          "P11.I",
          "P11.J",
          "P11.L",
          "P11.M"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-server/src/skills/**",
          "packages/coding-agent/src/skills/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Parallel-safe with extension API because it owns a separate API namespace."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-server/src/skills/**",
        "packages/coding-agent/src/skills/**"
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
      ],
      "acceptanceCriteria": [
        "A sample skill can be installed, tested, and invoked through backend API.",
        "Skill test failures are captured with logs and quality status.",
        "Skill recommendations can be attached to proposals or workspaces.",
        "Denied skill invocations produce policy audit events."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/skills/**",
          "packages/coding-agent/src/skills/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.L",
      "title": "Memory ingestion, retrieval, provenance, and compaction pipeline",
      "dependencies": [
        "P11.F",
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.F, P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.H",
          "P11.I",
          "P11.J",
          "P11.K",
          "P11.M"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/memory/**",
          "packages/coding-agent/src/retrieval/**",
          "packages/web-server/src/memory/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Consumes memory schema and policy gates. UI depends on this pipeline."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/memory/**",
        "packages/coding-agent/src/retrieval/**",
        "packages/web-server/src/memory/**"
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
      ],
      "acceptanceCriteria": [
        "Memory pipeline indexes a representative plan/run/proposal set and retrieves relevant memories with source provenance.",
        "Forbidden sources are blocked and counted.",
        "Retrieval responses include confidence and source pointers.",
        "Compaction preserves provenance and marks superseded memory."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/memory/**",
          "packages/coding-agent/src/retrieval/**",
          "packages/web-server/src/memory/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.M",
      "title": "Audit ledger events for platform actions",
      "dependencies": [
        "P11.G"
      ],
      "parallelGroup": "batch_3",
      "dependencyReason": "Depends on P11.G",
      "parallelism": {
        "expectedBatch": "batch_3",
        "canRunWith": [
          "P11.H",
          "P11.I",
          "P11.J",
          "P11.K",
          "P11.L"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/coding-agent/src/audit/**",
          "packages/web-server/src/audit/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Fan-out support workspace for UI and dogfood. Does not block H-L except where direct event schemas are needed; safe to run in the same batch."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/coding-agent/src/audit/**",
        "packages/web-server/src/audit/**"
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
      ],
      "acceptanceCriteria": [
        "Audit events are emitted for allowed, denied, pending-approval, approved, rejected, and rollback actions.",
        "Events can be filtered by project, capability, workspace, proposal, extension, skill, and memory source.",
        "Audit event persistence is tested.",
        "Audit schema supports future enterprise export without changing core event semantics."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/audit/**",
          "packages/web-server/src/audit/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.N",
      "title": "Autonomy and Self-Improvement Center UI",
      "dependencies": [
        "P11.H",
        "P11.M"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Depends on P11.H, P11.M",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "P11.O",
          "P11.P",
          "P11.Q",
          "P11.R"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/autonomy/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Component-only UI. No final dashboard shell wiring in this workspace."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/autonomy/**"
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
      ],
      "acceptanceCriteria": [
        "Autonomy screen renders orchestrator health and proposal cards from backend data.",
        "Actions are disabled or marked pending when policy requires approval.",
        "Self-modification proposals are visually distinguished.",
        "Loading, empty, error, and stale states are implemented."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/autonomy/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.O",
      "title": "Plan Intake and DAG Diff UI",
      "dependencies": [
        "P11.I",
        "P11.M"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Depends on P11.I, P11.M",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "P11.N",
          "P11.P",
          "P11.Q",
          "P11.R"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/plan-intake/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Component-only UI. No App shell route wiring here."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/plan-intake/**"
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
      ],
      "acceptanceCriteria": [
        "Plan-intake UI can display a multi-workspace plan analysis and optimizer patch diff.",
        "Optimization approval writes an approval request through backend API rather than mutating executor state directly.",
        "The UI highlights unsafe optimizer changes and blocked reasons.",
        "Graph and safe batch previews render loading, empty, error, and stale states."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/plan-intake/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.P",
      "title": "Extensions and Skills Manager UI",
      "dependencies": [
        "P11.J",
        "P11.K",
        "P11.M"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Depends on P11.J, P11.K, P11.M",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "P11.N",
          "P11.O",
          "P11.Q",
          "P11.R"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/platform-marketplace/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Combines extension and skill UI to keep P11 to 20 implementation workspaces."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/platform-marketplace/**"
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
      ],
      "acceptanceCriteria": [
        "Extension and skill cards render from backend data.",
        "Install/enable/test flows display policy decisions and audit links.",
        "Rollback and disable flows are visible and safe.",
        "Compatibility warnings and invalid manifest errors are actionable."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/platform-marketplace/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.Q",
      "title": "Memory Cockpit UI",
      "dependencies": [
        "P11.L",
        "P11.M"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Depends on P11.L, P11.M",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "P11.N",
          "P11.O",
          "P11.P",
          "P11.R"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/memory/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Component-only UI. Memory actions must not directly mutate memory state from the browser."
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
        "queuePriority": "normal",
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/memory/**"
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
      ],
      "acceptanceCriteria": [
        "Memory Cockpit renders health metrics and source breakdowns.",
        "Users can inspect memory provenance without exposing forbidden content.",
        "Memory management actions are policy-gated and auditable.",
        "Loading, empty, error, stale, and blocked-source states are implemented."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/memory/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.R",
      "title": "Policy and Audit Center UI",
      "dependencies": [
        "P11.M"
      ],
      "parallelGroup": "batch_4",
      "dependencyReason": "Depends on P11.M",
      "parallelism": {
        "expectedBatch": "batch_4",
        "canRunWith": [
          "P11.N",
          "P11.O",
          "P11.P",
          "P11.Q"
        ],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/features/policy-audit/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Component-only UI. Safe to run with other dashboard feature screens because it owns a distinct feature directory."
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
        "queuePriority": "normal",
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": false,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/features/policy-audit/**"
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
      ],
      "acceptanceCriteria": [
        "Policy & Audit Center can display allow/deny/pending/approved/rejected events.",
        "Protected-system approval requests are clearly separated from normal approvals.",
        "Audit filters and detail view work for representative event types.",
        "Rollback pointers are visible when available."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/features/policy-audit/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.S",
      "title": "Dashboard shell, navigation integration, and registry settings",
      "dependencies": [
        "P11.N",
        "P11.O",
        "P11.P",
        "P11.Q",
        "P11.R"
      ],
      "parallelGroup": "batch_5",
      "dependencyReason": "Depends on P11.N, P11.O, P11.P, P11.Q, P11.R",
      "parallelism": {
        "expectedBatch": "batch_5",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/routes/**",
          "packages/web-ui/dashboard/src/features/settings/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Runs alone because shell and navigation files are high-conflict. This preserves the P10R pattern."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/LeftNav.tsx",
        "packages/web-ui/dashboard/src/routes/**",
        "packages/web-ui/dashboard/src/features/settings/**"
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
      ],
      "acceptanceCriteria": [
        "New Platform nav entries route to the correct screens.",
        "Dashboard shell compiles without duplicate component mounts.",
        "Registry settings render and save through backend API or state stub as appropriate.",
        "No other workspace owns App.tsx or final nav wiring."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/LeftNav.tsx",
          "packages/web-ui/dashboard/src/routes/**",
          "packages/web-ui/dashboard/src/features/settings/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "P11.T",
      "title": "Integration, migrations, E2E validation, dogfood, and final report",
      "dependencies": [
        "P11.S"
      ],
      "parallelGroup": "batch_6",
      "dependencyReason": "Depends on P11.S",
      "parallelism": {
        "expectedBatch": "batch_6",
        "canRunWith": [],
        "cannotRunWith": [],
        "conflictScope": [
          "test/**",
          "docs/pi/stability/**",
          "packages/**"
        ],
        "sameFileParallelismAllowed": false,
        "safeParallelismNotes": "Final validation and dogfood tail. Runs alone by design."
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
        "queueOptimizationNotes": "Priority reflects critical-path position, downstream fan-out, and platform safety impact."
      },
      "validation": {
        "profile": "targeted_then_final",
        "heavyCommandUsesGlobalLock": true,
        "watchModeForbidden": true
      },
      "allowedFiles": [
        "test/**",
        "docs/pi/stability/**",
        "packages/**"
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
      ],
      "acceptanceCriteria": [
        "Typecheck, build, and required tests pass or failures are documented with handoff artifacts.",
        "Dogfood proves no unauthorized mutation, no forbidden commands, and no unapproved protected-system change.",
        "Final report includes proposal quality, accepted proposal rate, optimizer speedup estimate, memory token savings, extension/skill health, and audit completeness.",
        "P11 Definition of Done is verified."
      ],
      "targetCommand": null,
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "test/**",
          "docs/pi/stability/**",
          "packages/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "**/credentials/**",
          "**/secrets/**"
        ],
        "canRun": [
          "typecheck",
          "targeted_tests",
          "build_if_required"
        ],
        "cannotRun": [
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
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "workspace_validation_completed",
          "integration_queue_entry"
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
  "contractVersion": "2.4.0",
  "phase": "P11",
  "title": "Ecosystem & Continuous Self-Improvement Platform",
  "primaryGoal": "Make Pi a self-improving platform with always-on orchestration, plan-intake DAG optimization, extension and skill ecosystems, organic memory, policy governance, and dashboard-native controls.",
  "projectName": "pi",
  "stateBackend": "postgres",
  "selectedScaleMode": "experimental_6",
  "maxParallelWorkspaces": 6,
  "runnableWorkspaceCount": 21,
  "implementationWorkspaceCount": 20,
  "batchCount": 7,
  "peakDagEffectiveParallelism": 6,
  "peakSafeEffectiveParallelism": 6,
  "requiresWorktreeIsolation": true,
  "requiresIntegrationQueue": true,
  "queueOptimizationEnabled": true,
  "queueOptimizationStrategy": "critical_path_first",
  "planIntakeEnabled": true,
  "autoDagOptimizationEnabled": true,
  "extensionRegistryRequired": true,
  "skillRegistryRequired": true,
  "organicMemoryRequired": true,
  "safeEffectiveParallelismTarget": 6,
  "notInScope": [
    "Remote cloud workers",
    "Public marketplace publishing",
    "Enterprise SSO/RBAC",
    "Production deployment automation",
    "Autonomous protected-system mutation without approval",
    "Autonomous execution without dry-run and explicit approval"
  ],
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
    "watch_mode_validation",
    "execution_without_dry_run",
    "execution_without_approval",
    "protected_system_mutation_without_explicit_approval",
    "extension_permission_denied",
    "skill_permission_denied",
    "memory_forbidden_source_indexing",
    "optimizer_patch_without_approval"
  ],
  "completionGate": "P11 is complete only after platform capabilities, dashboard surfaces, policy/audit controls, plan-intake optimizer, organic memory, extension/skill managers, integration validation, and self-improvement dogfood all pass.",
  "nextPhase": "P12"
}
```

---

# Annex A — P11 DAG at a Glance

```text
Batch 0: P11.0
Batch 1: P11.A
Batch 2: P11.B + P11.C + P11.D + P11.E + P11.F + P11.G
Batch 3: P11.H + P11.I + P11.J + P11.K + P11.L + P11.M
Batch 4: P11.N + P11.O + P11.P + P11.Q + P11.R
Batch 5: P11.S
Batch 6: P11.T
```

# Annex B — Why P11 Uses 21 Runnable Workspaces

P11 uses **21 runnable workspaces** because `P11.0` is not a product implementation feature; it is a spec/preflight normalization workspace that guarantees the executable contract is valid before downstream work begins. The implementation scope itself contains **20 implementation workspaces**: `P11.A` through `P11.T`.

This distinction is intentional:

* `P11.0` protects the executor from malformed plan contracts.
* `P11.A` creates shared platform contracts.
* `P11.B` through `P11.G` build six independent platform foundations.
* `P11.H` through `P11.M` build six backend integration layers.
* `P11.N` through `P11.R` build five dashboard feature surfaces.
* `P11.S` wires the dashboard shell alone.
* `P11.T` runs final validation and dogfood alone.

# Annex C — Dashboard Navigation Target

P11 should add a new **Platform** navigation group:

```text
Platform
- Autonomy
- Plan Intake
- Extensions & Skills
- Memory
- Policy & Audit
- Registry Settings
```

These entries must be wired only in `P11.S`.

# Annex D — Dogfood Scenario

The final dogfood in `P11.T` should demonstrate this full loop:

```text
Orchestrator observes a real Pi bottleneck
  -> creates a self-improvement proposal with evidence
  -> plan-intake optimizer analyzes the generated plan
  -> optimizer proposes an improved DAG
  -> user/operator approves optimizer patch
  -> dry-run forecast is generated
  -> execution approval is required
  -> bounded execution runs through worktrees and integration queue
  -> validation passes
  -> audit ledger records proposal, approvals, dry-run, execution, validation, and rollback
  -> final report compares expected vs actual outcome
```

The dogfood improvement should be intentionally small and low-risk, such as improving a dashboard empty state, adding a missing health metric, or tightening a non-sensitive validation rule. It must not be a protected-system mutation unless explicit self-modification approval is tested as part of the scenario.

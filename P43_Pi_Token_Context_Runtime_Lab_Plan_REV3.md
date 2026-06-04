# P43 — Pi Token Context Runtime Lab

**Revision:** Red-team hardened revision 3  
**Template:** LLM Implementation Agent — ExecutionKernel & Intent-Driven Execution Template v4.1.1  
**Phase ID:** `P43`  
**Title:** Pi Token Context Runtime Lab: Savings Ledger, Smart Read, Change Ledger  
**Date:** 2026-06-03  
**Execution class:** `implementation`  
**Selected scale mode:** `stable_6` / `patch_transaction`  
**Workstreams:** `20`  
**Primary objective:** Prove and implement the first production-safe token-saving substrate for Pi coding-agent without destabilizing code-edit correctness.

---

# Revision 3 — Red-Team Fixes Applied

This revision intentionally patches the weaknesses identified after the first and second P43 reviews. The plan no longer treats token savings as a matter of optimistic local estimates; it requires provider usage calibration, context/ledger cross-checking, raw cache retention guarantees, grammar/LSP preflight, and an uncontrolled dogfood run before recommending P44.

| Red-team issue | Revision 2 fix |
|---|---|
| Token estimator can overstate savings with `chars / 4` heuristics | Added P43.03 Provider Usage Calibration. P44 promotion uses actual provider usage where available, not estimate-only savings. |
| Active Context Registry and Change Ledger can disagree | Added P43.08 ACR × Change Ledger Semantics Gate. Delta reread is blocked after context eviction until exact/symbol context is restored. |
| Adapter workstreams can serialize on shared core files | Added P43.00 interface freeze. Adapters depend on frozen contracts and must not edit core interfaces. |
| Delta checkpoint policy was underspecified | P43.16 defines default checkpoint thresholds: 3–5 deltas require symbol snapshot; 10+ deltas require exact reread. |
| LLM-assisted fallback can consume more tokens than it saves | P43.15 hard-caps fallback at a configured budget and falls back to exact/raw when budget is exceeded. |
| Raw cache retention was vague | P43.05 defines max bytes, LRU, TTL, soft warnings, hard behavior, and no silent eviction. |
| Tree-sitter/LSP availability was assumed | P43.14 adds grammar/LSP preflight; missing runtime capability becomes warning + generic fallback. |
| Lab fixtures can overstate real-world savings | P43.17 requires at least one uncontrolled real Pi dogfood session. |
| ACR × Change Ledger matrix can miss cross-state combinations | P43.08 now requires an explicit state-machine diagram and exhaustive cross-state matrix; any untested combination is a hard final-validation failure. |
| Provider calibration can silently degrade to estimate-only on local endpoints | P43.03/P43.17 now require at least one OpenAI or Anthropic provider-calibrated dogfood session with minimum actual usage coverage before P44 eligibility. |
| Observe/shadow/active feature-flag wiring ownership was implicit | Added P43.09.5 Tool Event Mode Wiring Aggregator to own read/edit/write/bash event wiring and feature-flag mode transitions before adapters integrate. |

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** `P43`  
**One-line goal:** Build a lab-first Token Context Runtime for Pi that measures token savings, exposes `/savings`, implements provider-calibrated ledger metrics, read hash cache, active context registry, smart read adapters, raw fallback, and change ledger while preserving filesystem truth.  
**Why now:** RTK-style bash compression helps terminal output, but the largest Pi coding-agent token cost remains repeated reads, full-file context, edit/write payload baselines, and stale rereads. P43 proves the hypothesis in a controlled lab before enabling aggressive production behavior.  
**Blast radius:** `packages/coding-agent` token telemetry, read/write/edit/bash observation layer, `smart_read` tool, language adapters, test fixtures, lab reports, savings UI.  
**Rollback path:** Disable `tokenContext.enabled`; set mode to `disabled` or `observe_only`; unregister `smart_read`; keep ledger/raw-cache as debug artifacts only.  
**Repair class:** `implementation`  
**Execution automation:** `enabled after preflight approval`  
**Selected repair mode:** `stable_6`  
**Target promotion mode:** `stable_6` for lab execution; P44 for production optimizer rollout  
**Autonomous execution allowed:** `true`, only after preflight approval and patch_transaction readiness  
**Agent repo mutation allowed:** `true`, through PatchCoordinator only  
**Promotion gate status:** `pending`  
**Scale mode:** `stable_6`  
**Safe parallelism target:** `4` effective workers, 6 codegen workers with 1 patch apply lane  
**Done when:** Lab proves at least 40% promotion-grade token saving, stale-cache escape is zero, hash mismatch fallback is 100%, final validation passes, and P43 final report recommends P44 rollout or explicit rollback.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | `P43` |
| Title | `Pi Token Context Runtime Lab` |
| Status | `Planned` |
| Last updated | `2026-06-03` |
| Delivery status | `Not started` |
| Target environment | `Local sandbox / staging dogfood` |
| Primary focus | `Token Context Runtime lab, measurement, smart read, change ledger` |
| Product-code changes | `Allowed, behind feature flags and patch_transaction` |
| Repair class | `implementation` |
| Execution automation | `enabled after preflight approval` |
| Selected repair mode | `stable_6` |
| Target promotion mode | `P44 production optimizer rollout` |
| Autonomous execution allowed | `true, gated` |
| Agent repo mutation allowed | `true, PatchCoordinator only` |
| Promotion gate status | `pending` |
| Selected scale mode | `stable_6` |
| Requested max workers | `6 codegen workers` |
| Expected DAG effective parallelism | `4-6` |
| Expected safe effective parallelism | `4` |
| Worktree isolation | `Disabled for stable_6` |
| Integration queue | `Disabled for patch_transaction; patchApplyQueue used instead` |
| Isolation mode | `patch_transaction` |
| Patch isolation | `Required` |
| Patch apply queue | `Required` |
| Patch apply lanes | `1` |
| Repository mutation authority | `patch_coordinator` |
| PatchCoordinator | `Required` |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| `P43.00` — Interface Freeze and Red-Team Risk Patch | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.01` — Token Context Lab Harness and A/B Replay Foundation | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.02` — Savings Ledger and JSONL Store | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.03` — Provider Usage Calibration and Token Estimator Accuracy Gate | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.04` — /savings Menu, Widget, and Export Commands | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.05` — Raw Cache Retention Policy and Exact Fallback Guarantee | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.06` — Read Hash Cache and Snapshot Store | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.07` — Active Context Registry | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.08` — ACR × Change Ledger Semantics Gate | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.09` — Smart Read Core Tool and Adapter Registry | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.09.5` — Tool Event Mode Wiring Aggregator | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.10` — TypeScript and JavaScript Smart Read Adapter | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.11` — Python Smart Read Adapter | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.12` — JSON and YAML Smart Read Adapters | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.13` — Rust Smart Read Adapter | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.14` — Grammar, Tree-sitter, and Optional LSP Preflight | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.15` — Generic Adapter and Budget-Capped LLM-Assisted Fallback | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.16` — Change Ledger, Delta Reread, and Checkpoint Policy | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.17` — Replay, Synthetic Fixture, and Uncontrolled Dogfood Matrix | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |
| `P43.18` — Final Validation, Targeted Repair, and P44 Recommendation Report | Implementation Agent | PlanSupervisor | Token/runtime reviewer | Dashboard |

---

## 2. Purpose

P43 creates a **Token Context Runtime Lab** for Pi coding-agent. The goal is not to blindly compress context. The goal is to prove, with replayable evidence, that Pi can reduce repeated read, large-file, test-output, and change-tracking token costs without destabilizing code-edit correctness.

The central invariant is:

```text
Cache saves tokens.
Ledger explains changes.
Smart read selects and exposes exact context.
Filesystem and git verify truth.
```

P43 is intentionally lab-first. The first deliverable is measurement: base Pi versus optimized Pi under identical fixtures and real dogfood. Only after the metrics are visible do the safe optimizers become active. Riskier systems such as guarded smart edit, vector DB advisory retrieval, and worker-model write are not part of the production default for this phase.

P43 uses stable_6 patch_transaction semantics. Workers generate PatchArtifacts; PatchCoordinator is the single repository mutation authority; writeSet/fileHash guards and rollback are required. Heavy validation is deferred to final validation, but validation visibility remains live through dashboard/lab artifacts.

---

## 3. What Carried Over — Must Stay Stable

* [ ] Filesystem and git remain the source of truth.
* [ ] PostgreSQL remains authoritative runtime state.
* [ ] JSON runtime fallback remains forbidden for production execution.
* [ ] ExecutionKernel remains the source of truth for execution state transitions.
* [ ] PatchCoordinator remains the only repository mutation authority in patch_transaction mode.
* [ ] Workers must not directly mutate the repository in patch_transaction mode.
* [ ] PatchArtifact, writeSet guard, fileHash guard, and rollback remain required.
* [ ] Smart read summaries, outlines, vector candidates, and LLM fallback outputs are not mutation-safe.
* [ ] Exact symbol/range/raw content plus current file hash is required before mutation.
* [ ] Raw fallback must exist for every compacted read unless fresh filesystem read is available.
* [ ] If uncertain, spend tokens instead of risking stale or incomplete context.
* [ ] `git push` remains forbidden.
* [ ] Raw destructive cleanup remains forbidden.
* [ ] Watch-mode validation remains forbidden.

---

## 4. Background / What Was Wrong

Pi can already save some tokens by avoiding full rewrites and by using RTK-style terminal-output compression. However, that only covers part of the cost. Long coding-agent sessions repeatedly read the same files, reread changed files as full blobs, include entire large files when only one symbol matters, and lack a reliable way to show which token-saving mechanisms actually helped.

The dangerous version of a token optimizer would compress aggressively and accidentally blind the model. P43 avoids that by separating deterministic truth from semantic relevance:

```text
Deterministic truth: hash, ranges, patches, filesystem reads, parser/LSP symbol ranges.
Adaptive relevance: which symbol is likely needed for this prompt.
Mutation safety: exact snippet/range/raw read plus hash verification only.
```

The first version of P43 was strong on safety but needed stronger measurement and red-team gates. This revision adds provider usage calibration, ACR/change-ledger interaction rules, raw cache retention, grammar/LSP preflight, LLM fallback budget caps, explicit delta checkpoint thresholds, and uncontrolled dogfood evidence.

---

## 5. Current Failure State / Known Blockers

* `provider_usage_calibration` = `not implemented`
* `savings_ledger` = `not implemented`
* `/savings_menu` = `not implemented`
* `read_hash_cache` = `not implemented`
* `raw_cache_retention_policy` = `not implemented`
* `active_context_registry` = `not implemented`
* `acr_change_ledger_semantics` = `not implemented`
* `smart_read_core` = `not implemented`
* `smart_read_ts_js_adapter` = `not implemented`
* `smart_read_python_adapter` = `not implemented`
* `smart_read_json_yaml_adapter` = `not implemented`
* `smart_read_rust_adapter` = `not implemented`
* `grammar_lsp_preflight` = `not implemented`
* `llm_fallback_budget_cap` = `not implemented`
* `change_ledger` = `not implemented`
* `uncontrolled_dogfood_matrix` = `not implemented`
* `scale_mode_readiness` = `pending preflight`
* `safe_effective_parallelism` = `target 4, to be confirmed by intake`

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Token estimator overstates savings | high | critical | Provider usage calibration; P44 promotion on actual usage where available. |
| ACR and Change Ledger disagree | medium | critical | P43.08 semantics gate; exact/symbol reread after eviction. |
| Adapter workers serialize on smart-read core | medium | high | P43.00 interface freeze; adapter modules isolated. |
| Long delta chains confuse model or kill savings | medium | high | P43.16 explicit checkpoint policy and exact-snippet comparison. |
| LLM fallback consumes more tokens than it saves | medium | high | Hard token budget cap and raw/exact fallback. |
| Raw cache silently evicts exact fallback | medium | medium | Retention policy, LRU warning, fresh filesystem fallback. |
| Tree-sitter/LSP missing in runtime | medium | medium | Preflight; fail open to generic adapter; no silent install by default. |
| Synthetic fixtures overstate real sessions | medium | medium | P43.17 uncontrolled dogfood required. |
| Summary/outline used for mutation | low | critical | `mutationSafe=false`; edit requires exact snippet/range/raw + hash. |
| PatchTransaction apply bottleneck | medium | medium | 6 codegen workers, 1 apply lane; shared fan-in handled by aggregator workspaces. |

---

## 7. Workstreams

### P43.00 — Interface Freeze and Red-Team Risk Patch

**Role:** `implementation`  
**Goal:** Freeze the Token Context Runtime contracts before adapter workers start, and encode the red-team fixes as explicit gates instead of informal notes.

**Requirements:**
* Define stable TypeScript contracts for SmartReadAdapter, SmartReadResult, TokenSavingEvent, RawCacheHandle, ActiveContextRecord, ChangeLedgerEvent, ProviderUsageSample, and FallbackEvent.
* Define red-team gates: provider calibration required, ACR/ChangeLedger eviction semantics, raw cache retention, grammar/LSP preflight, LLM fallback hard-cap, delta checkpoint policy, and uncontrolled dogfood requirement.
* Adapters must not import each other or mutate the core contracts after this workspace is accepted.
* Add a contract version string and compatibility guard so later workspaces fail tests if they drift from the frozen interface.

**Acceptance Criteria:**
* Core contracts compile and have snapshot/golden tests.
* Risk gates are documented as machine-readable config defaults and human-readable plan doctrine.
* Adapter workspaces can implement against the frozen interface without touching core contract files.
* Any later contract change requires an explicit aggregator or repair workspace.

**Allowed Files:**
* `packages/coding-agent/src/token-context/contracts/**`
* `packages/coding-agent/src/token-context/config/**`
* `packages/coding-agent/test/token-context/contracts/**`
* `docs/token-context/p43-risk-gates.md`

**Isolation & Parallelism Notes:**
* Depends on: `none`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Freeze the Token Context Runtime core interfaces first. Encode all red-team fixes as explicit gates and defaults. Do not implement optimizers yet.
```

---

### P43.01 — Token Context Lab Harness and A/B Replay Foundation

**Role:** `implementation`  
**Goal:** Create the lab harness that runs base Pi versus optimized/shadow Pi on identical tasks and produces comparable token, duration, correctness, fallback, and stability reports.

**Requirements:**
* Support baseline, observe-only, shadow, and active modes.
* Run identical task fixtures under identical repo commit and model configuration where possible.
* Record final diff hash, test status, tool-call sequence, token usage, duration, fallback count, and human-intervention flags.
* Do not enable active optimization in this workspace.

**Acceptance Criteria:**
* A/B replay runner emits JSON and Markdown reports.
* Optimizers-disabled mode produces identical tool behavior to base Pi.
* Lab report contains per-tool and per-mechanism token accounting fields, even when values are zero.
* Fixture runner can be invoked by final validation without watch mode.

**Allowed Files:**
* `packages/coding-agent/src/token-context/lab/**`
* `packages/coding-agent/test/token-context/lab/**`
* `packages/coding-agent/scripts/token-context-lab/**`
* `packages/coding-agent/package.json`

**Isolation & Parallelism Notes:**
* Depends on: `P43.00`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement the token-context lab harness only. Preserve base Pi behavior when optimizers are disabled. Produce deterministic fixture/replay artifacts.
```

---

### P43.02 — Savings Ledger and JSONL Store

**Role:** `implementation`  
**Goal:** Implement the durable Savings Ledger used by every observer and optimizer to record raw/optimized token counts, actual provider usage when available, mechanism names, confidence, and safety metadata.

**Requirements:**
* JSONL session store must be append-only and fail-open.
* Ledger records mechanism, toolName, rawTokensEstimate, optimizedTokensEstimate, savedTokensEstimate, actualProviderTokens when available, confidence, and divergence metadata.
* Ledger crash must never crash an agent session.
* Corrupt records must be skipped with warnings, not fatal errors.

**Acceptance Criteria:**
* Aggregates by tool, mechanism, file, workspace, session, and plan.
* Ledger supports export-ready summaries and raw event replay.
* Fail-open behavior is unit tested.
* Estimated savings are labelled estimated and never promoted as actual.

**Allowed Files:**
* `packages/coding-agent/src/token-context/ledger/**`
* `packages/coding-agent/test/token-context/ledger/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.00, P43.01`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement the savings ledger and durable JSONL store. Do not modify read/edit/write/bash behavior yet. All ledger writes must be best-effort and fail-open.
```

---

### P43.03 — Provider Usage Calibration and Token Estimator Accuracy Gate

**Role:** `implementation`  
**Goal:** Prevent inflated confidence by calibrating local token estimates against actual provider usage per model/provider/tool path and making P44 promotion depend on actual, not merely estimated, savings.

**Requirements:**
* Implement provider usage sample ingestion for input/output/cache token fields when providers expose usage.
* Track estimated-vs-actual divergence per provider/model/tool/mechanism.
* Mark char/4 or byte-based estimates as provisional only.
* Gate P44 recommendation on actual session saving where provider usage exists; estimated-only savings may support research but not production promotion.
* Define minimum actual provider calibration coverage for P44 eligibility: at least one OpenAI or Anthropic provider-calibrated dogfood session, and at least 80% of provider-backed model turns in that session must expose actual usage fields.
* If only local/estimate-only providers are available, final report may pass P43 lab research goals but must block P44 production recommendation.

**Acceptance Criteria:**
* Calibration report shows raw estimated, optimized estimated, actual provider input/output/cache tokens, and divergence ratio.
* If divergence exceeds configured threshold, /savings warns that estimates are not promotion-grade.
* Golden tests cover Unicode, code-heavy files, JSON, Rust lifetimes, and long identifier cases.
* P44 promotion gate reads actualProviderSavingRatio when available.
* P44 promotion is blocked when actual provider calibration coverage is below threshold, even if estimated savings exceed 40%.
* Calibration report identifies which providers are actual-usage-grade, estimate-only, or unsupported.

**Allowed Files:**
* `packages/coding-agent/src/token-context/calibration/**`
* `packages/coding-agent/test/token-context/calibration/**`
* `packages/coding-agent/src/token-context/ledger/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.02`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement provider usage calibration. Do not trust chars/4 as a production metric. Report divergence and make promotion-grade savings depend on actual provider usage where available.
```

---

### P43.04 — /savings Menu, Widget, and Export Commands

**Role:** `implementation`  
**Goal:** Expose savings visibility through CLI/TUI commands and a concise widget without injecting savings noise into model prompts.

**Requirements:**
* Implement /savings summary, tools, mechanisms, files, raw, reset, export --json, and export --csv.
* Show actual-vs-estimated divergence and promotion-grade/estimate-only status.
* Show stability counters: fallbacks, hash mismatches caught, stale-cache escapes, ACR evictions, raw-cache evictions, LLM-fallback misses.
* Widget must be compact and must not be included in ordinary LLM context.

**Acceptance Criteria:**
* /savings works with empty, partial, and corrupted ledger files.
* Widget displays saved tokens, actual/estimated status, fallback count, and warnings.
* Exports include schemaVersion and can be used by the lab report generator.
* No extra savings report text is injected into routine prompts.

**Allowed Files:**
* `packages/coding-agent/src/token-context/ui/**`
* `packages/coding-agent/src/token-context/commands/**`
* `packages/coding-agent/test/token-context/ui/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.02, P43.03`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement savings visibility commands and widget. Surface actual/estimated divergence and safety warnings. Keep the model prompt clean.
```

---

### P43.05 — Raw Cache Retention Policy and Exact Fallback Guarantee

**Role:** `implementation`  
**Goal:** Define and implement explicit raw cache retention so smart read and compact results always have predictable exact fallback behavior instead of silent eviction.

**Requirements:**
* Configure maxBytes, maxEntryBytes, compression, LRU eviction, soft-limit warning, hard-limit behavior, TTL, and cache-full fallback semantics.
* Raw cache eviction must be logged to Savings Ledger and visible in /savings warnings.
* If a raw handle is evicted, system must fall back to fresh filesystem read, not pretend handle is available.
* Cache full conditions must have test fixtures.

**Acceptance Criteria:**
* Default raw cache policy is explicit, e.g. maxBytes configured and documented.
* No silent eviction breaks raw fallback guarantee.
* Cache pressure emits doctor warning and ledger event.
* Raw fallback succeeds through filesystem reread when handle is unavailable.

**Allowed Files:**
* `packages/coding-agent/src/token-context/raw-cache/**`
* `packages/coding-agent/test/token-context/raw-cache/**`
* `packages/coding-agent/src/token-context/config/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.02`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement raw cache retention and exact fallback semantics. Silent eviction is forbidden; cache pressure must be visible and safe.
```

---

### P43.06 — Read Hash Cache and Snapshot Store

**Role:** `implementation`  
**Goal:** Implement content-addressed read snapshots so repeated reads of unchanged content can be avoided or compacted while preserving filesystem truth and raw fallback.

**Requirements:**
* Each read snapshot records path, range, content hash, file hash, raw handle, token estimate, mtime/size metadata, and timestamp.
* External file changes must be detected by current filesystem hash comparison.
* Cache hit never overrides filesystem truth.
* Repeated read saving must be recorded to ledger as estimated until provider calibration proves actual saving.

**Acceptance Criteria:**
* Unchanged file and active context may return compact unchanged result.
* Changed file marks cache dirty and forces delta/exact/raw path.
* External mutation test catches modifications made outside the agent.
* Hash collision is treated as theoretical; implementation still stores range/path/file identity with content hash.

**Allowed Files:**
* `packages/coding-agent/src/token-context/read-cache/**`
* `packages/coding-agent/test/token-context/read-cache/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.02, P43.05`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement read hash cache and snapshot store. Filesystem remains source of truth; cache is a derived optimization layer only.
```

---

### P43.07 — Active Context Registry

**Role:** `implementation`  
**Goal:** Track whether file content, outline, exact symbol body, exact range, summary, or hash-only handle is currently active in the model context so unchanged reads do not blind the model.

**Requirements:**
* Record coverage kind: full, outline, exactSymbol, exactRange, summary, hashOnly.
* Record conservative turn/window aging and eviction events.
* If active context is unknown or evicted, spend tokens: return compact summary or require exact read, not bare UNCHANGED.
* ACR events must be visible to Change Ledger semantics and Savings Ledger.

**Acceptance Criteria:**
* Context active/inactive transitions are deterministic and tested.
* No blind unchanged response when content is inactive or uncertain.
* Eviction events are emitted and recorded.
* Registry uncertainty chooses safety over savings.

**Allowed Files:**
* `packages/coding-agent/src/token-context/active-context/**`
* `packages/coding-agent/test/token-context/active-context/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.06`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement Active Context Registry. Do not trust read cache alone; if active context is unknown, require summary or exact context.
```

---

### P43.08 — ACR × Change Ledger Semantics Gate

**Role:** `implementation`  
**Goal:** Define the interaction rules between Active Context Registry and Change Ledger before implementing delta reread, preventing the case where ledger knows a file but the model has no live copy.

**Requirements:**
* If a file is evicted from active context, delta reread alone is forbidden until an exact symbol/range snapshot is restored.
* If ledger says known but ACR says inactive, response must include compact summary plus suggested exact reads, or force exact read before mutation.
* If ACR and ledger disagree, trust filesystem and force fresh smart_read exact/raw as needed.
* Expose a policy function used by both smart_read and change ledger.
* Add a state-machine diagram docs artifact covering ACR states active/inactive/evicted/dirty/changed/unknown crossed with ledger states none/known/changed/deltaAvailable/checkpointAvailable/stale/unknown.
* Treat every untested cross-state combination as a hard validation failure, not a warning.

**Acceptance Criteria:**
* Cross-check tests exhaustively cover ACR states active, inactive, evicted, dirty, changed, unknown against ledger states none, known, changed, deltaAvailable, checkpointAvailable, stale, unknown.
* Delta reread is blocked after ACR eviction unless checkpoint/exact snapshot exists.
* Policy emits ledger events for avoided unsafe savings.
* No mutation-safe result is produced from stale or summary-only context.
* `docs/token-context/acr-change-ledger-state-machine.md` contains the state-machine diagram and the test coverage matrix.
* P43.18 fails hard if any required ACR × Change Ledger combination remains untested.

**Allowed Files:**
* `packages/coding-agent/src/token-context/policy/**`
* `packages/coding-agent/test/token-context/policy/**`
* `docs/token-context/acr-change-ledger-semantics.md`
* `docs/token-context/acr-change-ledger-state-machine.md`

**Isolation & Parallelism Notes:**
* Depends on: `P43.07`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement ACR × Change Ledger policy before the ledger itself. Prevent delta rereads from being used when the model has no live context copy. Add the explicit state-machine diagram and exhaustive cross-state hard-fail coverage matrix.
```

---

### P43.09 — Smart Read Core Tool and Adapter Registry

**Role:** `implementation`  
**Goal:** Implement the smart_read core tool, adapter registry, mode semantics, confidence model, mutation safety policy, raw fallback, and stable response format.

**Requirements:**
* Support modes: outline, symbols, symbol, range, changed, exact, raw.
* Every result includes path, fileHash, mode, adapterId, confidence, mutationSafe, rawHandle, includedRanges, omittedRanges, suggestedNextReads, and tokenEstimate.
* Outline/summary/generic/LLM fallback modes are mutationSafe=false.
* Exact symbol/range/raw may be mutationSafe=true only when current file hash and range resolution are verified.

**Acceptance Criteria:**
* Core smart_read works with no language adapter by using generic fallback.
* Exact mutation policy is enforced: no mutation from summary-only or outline-only context.
* Raw fallback works even when adapter parse fails.
* Adapter API is stable and imported by all language adapters without core mutation.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/core/**`
* `packages/coding-agent/src/token-context/smart-read/index.ts`
* `packages/coding-agent/test/token-context/smart-read/core/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.00, P43.06, P43.07, P43.08`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement smart_read core and adapter registry against frozen contracts. Enforce mutation safety rules and raw fallback. Do not implement individual language adapters here.
```

---

### P43.09.5 — Tool Event Mode Wiring Aggregator

**Role:** `implementation`  
**Goal:** Explicitly own the observe/shadow/active feature-flag wiring for read/edit/write/bash tool events so mode integration is not assumed by Smart Read core or replay validation.

**Requirements:**
* Wire Token Context Runtime modes into read, edit, write, and bash tool-event observation paths without changing behavior in `observe_only`.
* Implement feature flags for disabled, observe_only, shadow, active_safe, and active_experimental modes.
* Route read events to hash cache, ACR, smart_read, raw cache, and savings ledger according to mode.
* Route edit/write events to no-full-rewrite telemetry, raw snapshot preservation, change-ledger capture, and savings ledger without enabling smart edit.
* Route bash events to RTK telemetry/compression hooks where configured, preserving raw output fallback.
* Ensure all mode transitions are explicit, logged, and visible in `/savings` and lab reports.

**Acceptance Criteria:**
* `observe_only` mode is behavior-identical to base Pi except telemetry artifacts.
* `shadow` mode records optimized hypothetical outputs but sends original results to the model.
* `active_safe` mode may activate read hash cache, smart_read exact/outline, and safe change-ledger behavior only when guards pass.
* `active_experimental` remains disabled by default and cannot enable guarded smart edit or vector advisory in P43.
* Feature-flag state is included in every TokenSavingEvent and replay artifact.
* Mode wiring has integration tests for read/edit/write/bash event paths.

**Allowed Files:**
* `packages/coding-agent/src/token-context/wiring/**`
* `packages/coding-agent/src/token-context/feature-flags/**`
* `packages/coding-agent/test/token-context/wiring/**`
* `docs/token-context/tool-event-mode-wiring.md`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09`
* Queue priority: `critical`
* Aggregator: `true`
* This is a thin aggregator that owns shared tool-event wiring before language adapters integrate.
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement the explicit tool-event mode wiring aggregator. Wire disabled/observe/shadow/active_safe/active_experimental modes into read/edit/write/bash events without enabling unsafe behavior.
```

---

### P43.10 — TypeScript and JavaScript Smart Read Adapter

**Role:** `implementation`  
**Goal:** Implement first-class deterministic TS/JS adapter using Tree-sitter and optional TypeScript LSP enrichment for imports, exports, classes, functions, methods, symbols, and exact range reads.

**Requirements:**
* Use deterministic parser output first; LSP enrichment is optional and fail-open.
* Support .ts, .tsx, .js, .jsx, .mts, .cts where feasible.
* Extract imports, exports, top-level declarations, class methods, function ranges, and common test blocks.
* Ambiguous syntax reduces confidence and suggests broader exact range/raw read.

**Acceptance Criteria:**
* Golden fixture symbol extraction accuracy target is at least 95% for supported TS/JS fixture set.
* LSP missing/crashing does not fail adapter; it logs warning and returns parser-only outline.
* Exact symbol read returns exact current filesystem slice with fileHash.
* Adapter does not touch smart-read core contracts.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/adapters/ts-js/**`
* `packages/coding-agent/test/token-context/smart-read/adapters/ts-js/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09, P43.09.5, P43.14`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement TS/JS smart-read adapter. Tree-sitter/deterministic extraction first; TypeScript LSP enrichment optional and fail-open.
```

---

### P43.11 — Python Smart Read Adapter

**Role:** `implementation`  
**Goal:** Implement first-class Python adapter using deterministic AST/Tree-sitter extraction and optional Pyright/LSP enrichment.

**Requirements:**
* Extract imports, module constants, classes, functions, async functions, methods, decorators, and pytest/unittest test functions.
* Support exact reads for function/class/method ranges.
* Handle syntax errors by lowering confidence and falling back to generic chunking.
* Pyright/LSP enrichment is optional.

**Acceptance Criteria:**
* Golden fixture symbol extraction accuracy target is at least 95%.
* Decorated functions and nested classes are represented with correct ranges where parser supports them.
* Syntax-error fixture does not crash smart_read.
* Adapter does not mutate core contracts.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/adapters/python/**`
* `packages/coding-agent/test/token-context/smart-read/adapters/python/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09, P43.09.5, P43.14`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement Python smart-read adapter. Deterministic AST/Tree-sitter extraction first; LSP optional; parser failure falls back safely.
```

---

### P43.12 — JSON and YAML Smart Read Adapters

**Role:** `implementation`  
**Goal:** Implement first-class structured-data adapters for JSON and YAML using key-path outlines, selected-path exact reads, large-array summaries, anchors, and schema-like hints where available.

**Requirements:**
* JSON outline lists top-level keys, nested key paths, array sizes, selected values only when small, and JSON pointer suggestions.
* YAML outline lists documents, key paths, anchors/aliases where available, and selected range suggestions.
* Large arrays/objects are summarized without dumping entire values.
* Exact path/range reads must preserve original formatting where needed for mutation.

**Acceptance Criteria:**
* JSON/YAML key path extraction accuracy target is at least 98% on golden fixtures.
* package.json scripts/dependencies exact read works.
* Invalid JSON/YAML lowers confidence and falls back safely.
* Adapter never claims mutationSafe=true for summary-only key outline.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/adapters/json-yaml/**`
* `packages/coding-agent/test/token-context/smart-read/adapters/json-yaml/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09, P43.09.5, P43.14`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement JSON/YAML smart-read adapters with path-based summaries and exact selected-path/range reads. Large values must not be dumped by default.
```

---

### P43.13 — Rust Smart Read Adapter

**Role:** `implementation`  
**Goal:** Implement first-class Rust adapter using Tree-sitter and optional rust-analyzer enrichment for use/mod declarations, structs, enums, traits, impl blocks, functions, methods, tests, and macro-aware confidence reduction.

**Requirements:**
* Extract use/mod declarations, structs, enums, traits, impl blocks, functions, methods, and #[cfg(test)] sections.
* Macro-heavy areas must reduce confidence and suggest exact/raw reads.
* rust-analyzer enrichment is optional and fail-open due to indexing cost.
* Exact reads return verified current filesystem ranges.

**Acceptance Criteria:**
* Golden fixture symbol extraction accuracy target is at least 95% for non-macro-heavy Rust fixtures.
* Macro ambiguity does not produce mutationSafe summaries.
* Missing rust-analyzer produces warning only.
* Adapter does not mutate core contracts.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/adapters/rust/**`
* `packages/coding-agent/test/token-context/smart-read/adapters/rust/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09, P43.09.5, P43.14`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement Rust smart-read adapter. Use deterministic parser first; rust-analyzer optional; macro ambiguity lowers confidence and requires exact/raw read.
```

---

### P43.14 — Grammar, Tree-sitter, and Optional LSP Preflight

**Role:** `implementation`  
**Goal:** Add a preflight capability layer that detects parser grammars and optional LSP availability per language before adapters run, installs only when allowed, and fails open to generic adapters when unavailable.

**Requirements:**
* Detect tree-sitter grammar availability per configured language.
* LSP auto-install is disabled by default; if enabled, install only allowlisted tools into user/project cache with pinned versions where supported.
* Missing parser/LSP is a warning, not a plan failure, unless an adapter test explicitly requires it.
* Preflight report is visible in doctor and lab output.

**Acceptance Criteria:**
* Grammar missing fixture falls back to generic adapter and records warning.
* LSP crash does not crash Pi or smart_read.
* Auto-install obeys config and never installs silently by default.
* Doctor report distinguishes parser missing, LSP missing, and adapter disabled.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/preflight/**`
* `packages/coding-agent/src/token-context/smart-read/lsp/**`
* `packages/coding-agent/src/token-context/config/**`
* `packages/coding-agent/test/token-context/smart-read/preflight/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09`
* Queue priority: `critical`
* Aggregator: `true`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement grammar and optional LSP preflight. Fail open to generic smart read when unavailable. Do not silently install external tools by default.
```

---

### P43.15 — Generic Adapter and Budget-Capped LLM-Assisted Fallback

**Role:** `implementation`  
**Goal:** Implement generic chunk/section fallback and optional budget-capped LLM-assisted outline for unsupported languages, with mutationSafe always false and hard raw fallback when budget is exceeded.

**Requirements:**
* Generic fallback uses deterministic chunks, headings, braces/indentation hints, changed ranges, and small excerpts.
* LLM-assisted fallback is opt-in, hard capped at configured token budget, e.g. 500–800 tokens, and aborted if it would exceed budget.
* LLM fallback may suggest candidate ranges only; it cannot authorize mutation and cannot synthesize exact code.
* If fallback budget is exceeded, use raw/exact read and record miss in ledger.

**Acceptance Criteria:**
* Unsupported language fixture returns generic outline with mutationSafe=false.
* LLM fallback budget cap is enforced and tested.
* Open-ended LLM call inside read operation cannot consume more tokens than configured cap without falling back.
* Fallback misses appear in /savings and lab reports.

**Allowed Files:**
* `packages/coding-agent/src/token-context/smart-read/fallback/**`
* `packages/coding-agent/test/token-context/smart-read/fallback/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.09`
* Queue priority: `high`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement generic and LLM-assisted fallback. LLM fallback is budget-capped, optional, candidate-only, and never mutation-safe.
```

---

### P43.16 — Change Ledger, Delta Reread, and Checkpoint Policy

**Role:** `implementation`  
**Goal:** Record file changes as beforeHash/afterHash, patches, changed ranges, and changed symbols so changed files can be represented compactly without unsafe long delta chains.

**Requirements:**
* Record edit/write/tool mutation events with beforeHash, afterHash, patch, changedRanges, changedSymbols where available, toolCallId, and saving estimate.
* Default checkpoint policy must be explicit: after 3–5 deltas require symbol snapshot; after 10+ deltas require exact reread, configurable but golden-tested.
* If delta token estimate exceeds exact snippet token estimate, return exact snippet instead of delta.
* Delta reread must obey ACR × Change Ledger semantics gate.

**Acceptance Criteria:**
* Patch and changed range generation are tested.
* Long delta chain triggers checkpoint exactly as configured.
* ACR eviction blocks delta-only reread before mutation.
* Ledger is advisory; filesystem/hash verification remains authoritative.

**Allowed Files:**
* `packages/coding-agent/src/token-context/change-ledger/**`
* `packages/coding-agent/test/token-context/change-ledger/**`

**Isolation & Parallelism Notes:**
* Depends on: `P43.06, P43.08, P43.09, P43.09.5`
* Queue priority: `critical`
* Aggregator: `false`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement Change Ledger and delta reread with explicit checkpoint policy. Do not allow long delta chains or ACR-evicted delta-only mutation.
```

---

### P43.17 — Replay, Synthetic Fixture, and Uncontrolled Dogfood Matrix

**Role:** `verification`  
**Goal:** Build the validation matrix that proves token-saving hypotheses across controlled fixtures and at least one uncontrolled real Pi dogfood session, preventing fixture-biased promotion.

**Requirements:**
* Include repeated-read, large-file navigation, edit-after-read, file-changed-after-read, external mutation, long-delta-chain, test-failure, unsupported-language fallback, grammar-missing, and vector-disabled scenarios.
* Include at least one uncontrolled dogfood session on real Pi work, not only synthetic fixtures.
* Include at least one OpenAI or Anthropic provider-calibrated dogfood session with actual usage fields; local estimate-only endpoints cannot satisfy the P44 calibration gate.
* Report token savings as actual when provider usage exists and estimated otherwise.
* Compare base Pi versus optimized Pi for final diff, tests, duration, tool sequence, and fallback events.

**Acceptance Criteria:**
* Lab matrix can run in CI/local without watch mode.
* Uncontrolled dogfood result is present in final report even if savings are lower than synthetic fixtures.
* No P44 recommendation can be issued from synthetic-only evidence.
* No P44 recommendation can be issued without the provider-calibrated dogfood coverage threshold from P43.03.
* Regression replay artifacts are persisted.

**Allowed Files:**
* `packages/coding-agent/test/token-context/fixtures/**`
* `packages/coding-agent/test/token-context/replay/**`
* `packages/coding-agent/scripts/token-context-lab/**`
* `docs/token-context/lab-matrix.md`

**Isolation & Parallelism Notes:**
* Depends on: `P43.01, P43.02, P43.03, P43.04, P43.05, P43.06, P43.07, P43.08, P43.09, P43.09.5, P43.10, P43.11, P43.12, P43.13, P43.14, P43.15, P43.16`
* Queue priority: `critical`
* Aggregator: `true`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Implement the replay and dogfood matrix. Include real uncontrolled dogfood, not just synthetic fixtures. Gate P44 on actual evidence.
```

---

### P43.18 — Final Validation, Targeted Repair, and P44 Recommendation Report

**Role:** `verification`  
**Goal:** Run final validation, consume failures, apply targeted repair if allowed, and produce the final recommendation: promote to P44, keep observe-only, or roll back specific mechanisms.

**Requirements:**
* Run deterministic unit tests, golden tests, mutation-safety tests, replay tests, and dogfood matrix.
* If validation fails, produce targeted repair instructions and rerun relevant tests or create handoff_required.
* Final report must distinguish actual provider savings, estimated savings, speed impact, stability regression, and fallback rate.
* P44 recommendation must be conservative and mechanism-specific.
* Validate the ACR × Change Ledger state-machine coverage matrix and fail hard on any untested required combination.
* Validate provider-calibrated dogfood coverage before allowing any P44 production recommendation.

**Acceptance Criteria:**
* Final validation passes or produces handoff_required with artifacts.
* Report includes minimum 40% lab target status, actual/estimated divergence, actual provider coverage ratio, stale-cache escape count, hash mismatch fallback rate, ACR eviction behavior, ACR × Change Ledger matrix coverage, raw-cache pressure, grammar/LSP warnings, tool-event mode wiring status, and dogfood evidence.
* P44 recommendation never relies on estimate-only savings when actual provider usage exists.
* P44 recommendation is blocked if no OpenAI/Anthropic provider-calibrated dogfood session reaches minimum actual usage coverage.
* Any untested required ACR × Change Ledger combination blocks completion.
* Plan cannot complete if final validation fails.

**Allowed Files:**
* `reports/token-context/p43/**`
* `packages/coding-agent/test/token-context/**`
* `docs/token-context/p44-recommendation.md`

**Isolation & Parallelism Notes:**
* Depends on: `P43.17`
* Queue priority: `critical`
* Aggregator: `true`
* Uses `patch_transaction` isolation. Workers produce PatchArtifacts and do not directly mutate repository.
* Heavy validation is deferred to P43.18 unless a smoke check is explicitly safe.

**Executor Prompt:**

```text
Run final validation and produce the P43 final report. If failures are targeted and safe, repair and rerun. Otherwise create handoff_required. Do not overclaim savings.
```

---

## 8. Combined Implementation Order

```text
Batch 0: P43.00
Batch 1: P43.01
Batch 2: P43.02 + P43.05
Batch 3: P43.03 + P43.04 + P43.06
Batch 4: P43.07
Batch 5: P43.08
Batch 6: P43.09
Batch 7: P43.09.5 + P43.14 + P43.15
Batch 8: P43.10 + P43.11 + P43.12 + P43.13
Batch 9: P43.16
Batch 10: P43.17
Batch 11: P43.18
```

The plan intentionally freezes contracts before adapters run. This prevents TypeScript, Python, JSON/YAML, and Rust workers from all editing the same Smart Read core files. P43.09.5 is the explicit tool-event mode wiring aggregator. P43.14 is an aggregator-like preflight workspace because it touches shared capability wiring. P43.17 and P43.18 are final validation/reporting aggregators.

---

## 9. Definition of Done

P43 is complete when ALL are true:

* [ ] P43.00–P43.18 required workspaces, including P43.09.5, are terminal or correctly handed off.
* [ ] Part 3 JSON remains valid and parseable.
* [ ] Savings Ledger records per-tool and per-mechanism events.
* [ ] Provider usage calibration exists and reports estimated-vs-actual divergence.
* [ ] At least one OpenAI or Anthropic provider-calibrated dogfood session reaches the minimum actual usage coverage threshold for P44 eligibility.
* [ ] `/savings` displays actual/estimated status, warnings, tools, mechanisms, files, and exports.
* [ ] Raw cache retention policy prevents silent fallback breakage.
* [ ] Read hash cache detects external file mutation.
* [ ] Active Context Registry prevents blind `UNCHANGED` responses.
* [ ] ACR × Change Ledger semantics block delta-only rereads after context eviction.
* [ ] ACR × Change Ledger state-machine diagram exists and every required cross-state combination is tested; untested combinations are hard failures.
* [ ] Smart read core enforces mutationSafe rules.
* [ ] Tool-event feature-flag wiring owns disabled/observe/shadow/active_safe/active_experimental paths for read/edit/write/bash.
* [ ] TS/JS, Python, JSON/YAML, and Rust adapters pass golden fixtures.
* [ ] Grammar/LSP preflight exists and fails open.
* [ ] LLM-assisted fallback is budget-capped and mutation-unsafe.
* [ ] Change Ledger records beforeHash, afterHash, patches, changed ranges, and checkpoints.
* [ ] Replay matrix includes synthetic fixtures and at least one uncontrolled dogfood session.
* [ ] Minimum 40% promotion-grade token saving is met or final report recommends observe-only/rollback.
* [ ] Stale cache escape count is zero.
* [ ] Hash mismatch fallback rate is 100% in relevant fixtures.
* [ ] Raw fallback success rate is 100% unless fresh filesystem reread replaces evicted handles.
* [ ] Final validation passes.
* [ ] No forbidden commands or files were used.
* [ ] No mutation was made from summary-only, outline-only, vector, or LLM fallback context.
* [ ] PatchCoordinator, PatchArtifact, WriteSetGuard, FileHashGuard, rollback, and final validation requirements are satisfied.

---

## 10. Rollback Playbook

**Trigger conditions:**

* Provider-calibrated savings are materially below target and synthetic estimates are misleading.
* Any stale-cache escape occurs.
* ACR and Change Ledger produce inconsistent state that is not safely handled.
* Raw fallback fails without fresh filesystem fallback.
* Smart read returns mutationSafe=true from non-exact context.
* LLM fallback exceeds budget or returns exact code claims.
* Adapter parse crash breaks read behavior instead of falling back.
* Final validation fails and targeted repair cannot resolve it.

**Rollback procedure:**

1. Set `tokenContext.enabled=false`.
2. Set `smartRead.enabled=false`.
3. Keep `savingsLedger.enabled=true` only if telemetry is safe; otherwise set to observe-only off.
4. Disable active read cache and change ledger responses.
5. Keep raw artifacts under `reports/token-context/p43/` and `.pi/token-context/` for debugging.
6. Revert or disable adapter registrations.
7. Re-run baseline Pi validation.
8. Produce handoff_required if any repo mutation cannot be safely rolled back.

---

## 11. What Next Phase Inherits

P44 may inherit:

* Provider-calibrated Savings Ledger.
* `/savings` menu and exports.
* Read hash cache with raw fallback.
* Active Context Registry.
* Smart Read core and first-class adapters for TS/JS, Python, JSON, YAML, and Rust.
* Grammar/LSP preflight.
* Budget-capped LLM fallback.
* Change Ledger with checkpoint policy.
* Lab replay and dogfood matrix.

P44 may add, only if P43 evidence supports it:

* Production rollout controls.
* Guarded smart edit.
* Vector DB advisory retrieval.
* Worker-model write.
* Dashboard-level cost projections.
* More language adapters.

---

# Part 2 — Agent Brief

## Mission

Implement P43 as a lab-first Token Context Runtime for Pi coding-agent. The mission is to measure and prove token savings before production rollout, then enable only the safe optimizers that preserve code-edit correctness.

The agent must preserve correctness over savings. If uncertainty exists, spend tokens. If compact context is insufficient for mutation, request exact symbol/range/raw content. If cache and filesystem disagree, trust filesystem. If LLM-assisted fallback is used, it can only identify candidate ranges and cannot authorize mutation.

## Hard Requirements

1. Do not use estimated token savings as promotion-grade evidence when actual provider usage exists.
2. Do not return bare `UNCHANGED` when active context is inactive or unknown.
3. Do not use delta reread after ACR eviction until exact/symbol context is restored.
4. Do not allow silent raw-cache eviction to break raw fallback.
5. Do not make LSP or grammar availability a hard runtime dependency.
6. Do not silently install LSP servers by default.
7. Do not allow LLM fallback to exceed configured budget.
8. Do not mark summary, outline, vector, generic fallback, or LLM fallback as mutationSafe.
9. Do not mutate from non-exact context.
10. Do not change smart-read core contracts from adapter workspaces.
11. Do not bypass PatchCoordinator in patch_transaction mode.
12. Do not run watch-mode validation.
13. Do not run `git push`.
14. Do not run raw destructive cleanup.
15. Do not claim P44 readiness without uncontrolled dogfood evidence.

## Execution Policies

```yaml
execution_automation:
  autonomous_execution_enabled: true
  preflight_approval_required: true
  agent_may_mutate_repo: true
  repository_mutation_authority: patch_coordinator
  workers_may_mutate_repository_directly: false

token_context:
  rollout: observe_then_shadow_then_active_safe
  filesystem_truth_required: true
  mutation_requires_exact_context: true
  summary_mutation_safe: false
  outline_mutation_safe: false
  vector_mutation_safe: false
  llm_fallback_mutation_safe: false
  when_uncertain: spend_tokens

validation:
  deferred_validation: true
  final_validation_workspace: P43.18
  watch_mode_forbidden: true
  no_test_files_found_is_failure: true
  uncontrolled_dogfood_required: true
```

## Safety Stops

Hard stop execution for:

* Provider usage calibration missing from final report.
* Raw cache retention policy missing.
* ACR × Change Ledger semantics missing.
* LLM fallback without hard token budget.
* Summary/outline/LLM fallback marked mutationSafe.
* Delta chain without checkpoint policy.
* Smart read exact result without current file hash.
* Mutation without exact symbol/range/raw read.
* Vector DB used as source of truth.
* Repository mutation outside PatchCoordinator.
* JSON runtime fallback enabled.
* Watch-mode validation command.
* `git push`.
* Raw destructive cleanup.

---

# Part 2.5 — v4 ExecutionKernel Doctrine

P43 follows the v4.1.1 ExecutionKernel doctrine.

```text
Workers do work.
Actors emit events.
Policies suggest.
Brain workers diagnose and propose.
Only ExecutionKernel mutates execution state.
Only PatchCoordinator mutates the repository in patch_transaction mode.
```

For P43 specifically:

```text
Savings Ledger is evidence, not execution truth.
Read cache is derived, not authoritative.
Change Ledger explains transitions, not current truth.
Smart read chooses compact context, not mutation authority.
Filesystem and git verify exact current content.
```

Patch transaction state must remain bounded. All non-terminal attempt states require deadlines. Final validation is mandatory and plan completion is blocked by unresolved handoff, required workspace failure, or failed final validation.

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "4.1.1",
  "templateVersion": "4.1.1",
  "phaseId": "P43",
  "title": "Pi Token Context Runtime Lab — Revised Red-Team Hardened Plan",
  "executionClass": "implementation",
  "status": "planned",
  "legacyCompatibility": {
    "v3EnvelopePreserved": true,
    "legacyMechanismFieldsPreservedAsCompatibilityInputs": true,
    "part3JsonIsAuthoritative": true,
    "markdownHumanAuthorityPreserved": true
  },
  "intent": {
    "parallelism": 6,
    "safetyLevel": "strict",
    "conflictRisk": "medium_high",
    "executionEnvironment": {
      "mode": "local_sandbox"
    },
    "primaryGoal": "prove and implement lab-first token saving for Pi coding-agent without stability regression",
    "minimumLabTarget": {
      "actualOrPromotionGradeTokenSavingRatio": 0.4,
      "staleCacheEscapes": 0,
      "hashMismatchFallbackRate": 1.0
    },
    "speedTarget": {
      "normalProjectSpeed": "1.15x-1.40x after tuning",
      "debugHeavySpeed": "1.30x-1.60x after tuning",
      "smallTaskSlowdownMax": "10%"
    }
  },
  "persistence": {
    "authoritativeRuntimeBackend": "postgres",
    "jsonRuntimeFallbackAllowed": false,
    "filesystemArtifactsAreEvidenceOnly": true,
    "artifactRoots": [
      "reports/token-context/p43",
      ".pi/token-context",
      ".pi/patch-artifacts"
    ]
  },
  "derivedExecutionProfile": {
    "selectedScaleMode": "stable_6",
    "executorType": "patch_transaction",
    "maxCodegenWorkers": 6,
    "patchApplyLanes": 1,
    "patchIsolationRequired": true,
    "worktreeRequired": false,
    "patchCoordinatorRequired": true,
    "repositoryMutationAuthority": "patch_coordinator",
    "singleRepositoryWriterRequired": true,
    "targetedValidationRequired": true,
    "finalIntegrationValidationRequired": true,
    "completionGateRequired": true,
    "expectedSafeEffectiveParallelism": 4
  },
  "executionAutomation": {
    "autonomousExecutionEnabled": true,
    "agentMayMutateRepo": true,
    "agentMayRunCommands": true,
    "manualPatchApplicationRequired": false,
    "humanApprovalRequiredForEveryPatch": false,
    "preflightApprovalRequired": true
  },
  "executionKernel": {
    "enabled": true,
    "stateAuthorityRequired": true,
    "actorsEmitEventsOnly": true,
    "attemptTransitionsRequireExpectedVersion": true,
    "planSupervisorCompletionPredicateRequired": true,
    "deadlineWatchdogRequired": true,
    "handoffQueueRequired": true
  },
  "patchTransaction": {
    "enabled": true,
    "patchCoordinatorRequired": true,
    "patchApplyQueueRequired": true,
    "applyLanes": 1,
    "patchArtifactRequired": true,
    "writeSetGuardRequired": true,
    "fileHashGuardRequired": true,
    "rollbackRequired": true,
    "workersMayMutateRepository": false,
    "aggregatorWorkspaceConventionRequired": true
  },
  "tokenContextRuntime": {
    "mode": "lab_first",
    "defaultRollout": "observe_then_shadow_then_active_safe",
    "productionDefaultAfterP43": [
      "savings_ledger",
      "provider_calibration",
      "rtk_telemetry",
      "read_hash_cache",
      "active_context_registry",
      "smart_read_core",
      "deterministic_adapters",
      "change_ledger_when_gated"
    ],
    "gatedOrDeferred": [
      "guarded_smart_edit",
      "vector_db_advisory",
      "worker_model_write",
      "vector_db_authoritative_forbidden"
    ],
    "invariants": [
      "Filesystem and git remain source of truth.",
      "Cache saves tokens but never authorizes mutation.",
      "Ledger explains changes but does not replace exact file verification.",
      "Summary, outline, vector, and LLM fallback are mutationSafe=false.",
      "Exact symbol/range/raw plus current file hash are required before mutation.",
      "When uncertain, spend tokens."
    ],
    "providerUsageCalibration": {
      "required": true,
      "p44PromotionUsesActualProviderUsageWhenAvailable": true,
      "estimatedSavingsLabelRequired": true,
      "divergenceWarningThresholdRatio": 0.2,
      "minimumActualProviderCoverageRatioForP44": 0.8,
      "requiredCalibratedDogfoodProvider": "openai_or_anthropic",
      "estimateOnlyProvidersCannotPromoteP44": true
    },
    "rawCacheRetention": {
      "required": true,
      "maxBytesDefault": "500MB configurable",
      "lruEviction": true,
      "softLimitWarning": true,
      "silentEvictionForbidden": true,
      "evictedHandleFallback": "fresh_filesystem_read"
    },
    "acrChangeLedgerSemantics": {
      "required": true,
      "deltaRereadAfterContextEvictionForbiddenWithoutExactSnapshot": true,
      "ledgerKnownButContextInactiveRequiresSummaryOrExactRead": true,
      "disagreementForcesFreshFilesystemRead": true,
      "stateMachineDiagramRequired": true,
      "untestedCrossStateCombinationHardFailure": true,
      "acrStates": [
        "active",
        "inactive",
        "evicted",
        "dirty",
        "changed",
        "unknown"
      ],
      "ledgerStates": [
        "none",
        "known",
        "changed",
        "deltaAvailable",
        "checkpointAvailable",
        "stale",
        "unknown"
      ]
    },
    "smartRead": {
      "firstClassAdapters": [
        "typescript",
        "javascript",
        "python",
        "json",
        "yaml",
        "rust"
      ],
      "adapterCoreFreezeRequired": true,
      "modes": [
        "outline",
        "symbols",
        "symbol",
        "range",
        "changed",
        "exact",
        "raw"
      ],
      "treeSitterPreferred": true,
      "lspOptional": true,
      "lspAutoInstallDefault": false,
      "grammarAvailabilityPreflightRequired": true,
      "llmAssistedFallback": {
        "enabled": "opt_in",
        "mutationSafe": false,
        "hardTokenBudget": 800,
        "onBudgetExceeded": "raw_or_exact_fallback"
      }
    },
    "changeLedger": {
      "enabled": "after_policy_gate",
      "checkpointDefaultDeltas": 5,
      "forceExactRereadAfterDeltas": 10,
      "sendExactSnippetWhenDeltaMoreExpensive": true,
      "beforeHashAfterHashRequired": true
    },
    "toolEventModeWiring": {
      "required": true,
      "workspace": "P43.09.5",
      "modes": [
        "disabled",
        "observe_only",
        "shadow",
        "active_safe",
        "active_experimental"
      ],
      "toolEvents": [
        "read",
        "edit",
        "write",
        "bash"
      ],
      "observeOnlyBehaviorIdenticalToBase": true,
      "shadowSendsOriginalResultToModel": true,
      "activeExperimentalDefaultEnabled": false
    }
  },
  "admissionGate": {
    "preflightRequired": true,
    "doctorRequired": true,
    "hardStops": [
      "json_runtime_fallback_enabled",
      "state_mutation_outside_execution_kernel",
      "repository_mutation_outside_patch_coordinator",
      "missing_provider_calibration_for_promotion_claim",
      "acr_change_ledger_semantics_missing",
      "raw_cache_retention_policy_missing",
      "silent_raw_cache_eviction",
      "llm_fallback_without_budget_cap",
      "summary_or_outline_marked_mutation_safe",
      "delta_chain_without_checkpoint_policy",
      "vector_db_used_as_source_of_truth",
      "mutation_without_exact_read_or_hash_guard",
      "watch_mode_validation_command",
      "git_push",
      "raw_destructive_cleanup"
    ]
  },
  "validation": {
    "deferredValidationDoctrine": true,
    "finalValidationWorkspace": "P43.18",
    "finalRepairConvention": true,
    "watchModeForbidden": true,
    "noTestFilesFoundIsFailure": true,
    "targetCommands": [
      "pnpm --filter coding-agent test -- token-context",
      "pnpm --filter coding-agent typecheck",
      "pnpm --filter coding-agent lint"
    ],
    "acceptedEquivalentCommands": [
      "pnpm test -- token-context --runInBand"
    ],
    "dogfoodRequired": true,
    "uncontrolledDogfoodRequired": true,
    "providerCalibratedDogfoodRequired": true,
    "providerCalibratedDogfoodProvider": "openai_or_anthropic",
    "minimumActualProviderCoverageRatio": 0.8,
    "acrChangeLedgerMatrixHardFail": true
  },
  "successCriteria": {
    "minimumPromotionGradeTokenSavingRatio": 0.4,
    "targetTokenSavingRatio": "0.45-0.65 production-safe package",
    "staleCacheEscapes": 0,
    "hashMismatchFallbackRate": 1.0,
    "rawFallbackSuccessRate": 1.0,
    "finalTestPassRateNotLowerThanBaseline": true,
    "smallTaskSlowdownMaxRatio": 0.1,
    "normalTaskSpeedTargetMin": 1.15,
    "debugHeavySpeedTargetMin": 1.3,
    "minimumActualProviderCoverageRatioForP44": 0.8,
    "providerCalibratedDogfoodRequiredForP44": true,
    "acrChangeLedgerUntestedCombinations": 0
  },
  "riskRegister": [
    {
      "risk": "Token estimator overstates savings due to chars/4 heuristic",
      "likelihood": "high",
      "impact": "critical",
      "mitigation": "Provider usage calibration; P44 promotion uses actual provider usage where available; divergence warnings."
    },
    {
      "risk": "ACR evicts file while Change Ledger treats it as known",
      "likelihood": "medium",
      "impact": "critical",
      "mitigation": "ACR × Change Ledger semantics gate; force exact/symbol reread after eviction before delta reread mutation."
    },
    {
      "risk": "Adapter workers modify shared smart-read core and serialize integration",
      "likelihood": "medium",
      "impact": "high",
      "mitigation": "P43.00 contract freeze; adapter modules cannot touch core contracts; aggregator only for preflight/wiring."
    },
    {
      "risk": "Long delta chain either becomes confusing or checkpoint threshold kills savings",
      "likelihood": "medium",
      "impact": "high",
      "mitigation": "Explicit default checkpoint threshold; golden tests; exact snippet when cheaper than delta."
    },
    {
      "risk": "LLM-assisted fallback consumes more tokens than it saves",
      "likelihood": "medium",
      "impact": "high",
      "mitigation": "Hard budget cap; fallback miss recorded; raw/exact fallback when cap exceeded."
    },
    {
      "risk": "Raw cache silently evicts handles and breaks fallback guarantee",
      "likelihood": "medium",
      "impact": "medium",
      "mitigation": "Retention policy, LRU warnings, raw handle miss forces fresh filesystem read."
    },
    {
      "risk": "Tree-sitter grammar or LSP unavailable in runtime environment",
      "likelihood": "medium",
      "impact": "medium",
      "mitigation": "Preflight check; fail open to generic adapter; no silent install by default."
    },
    {
      "risk": "Synthetic fixtures overstate real savings",
      "likelihood": "medium",
      "impact": "medium",
      "mitigation": "Uncontrolled dogfood required in lab matrix; P44 recommendation includes real result."
    }
  ],
  "workspaces": [
    {
      "id": "P43.00",
      "title": "Interface Freeze and Red-Team Risk Patch",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [],
      "aggregator": false,
      "goal": "Freeze the Token Context Runtime contracts before adapter workers start, and encode the red-team fixes as explicit gates instead of informal notes.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/contracts/**",
        "packages/coding-agent/src/token-context/config/**",
        "packages/coding-agent/test/token-context/contracts/**",
        "docs/token-context/p43-risk-gates.md"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/contracts/**",
        "packages/coding-agent/src/token-context/config/**",
        "docs/token-context/p43-risk-gates.md"
      ],
      "requirements": [
        "Define stable TypeScript contracts for SmartReadAdapter, SmartReadResult, TokenSavingEvent, RawCacheHandle, ActiveContextRecord, ChangeLedgerEvent, ProviderUsageSample, and FallbackEvent.",
        "Define red-team gates: provider calibration required, ACR/ChangeLedger eviction semantics, raw cache retention, grammar/LSP preflight, LLM fallback hard-cap, delta checkpoint policy, and uncontrolled dogfood requirement.",
        "Adapters must not import each other or mutate the core contracts after this workspace is accepted.",
        "Add a contract version string and compatibility guard so later workspaces fail tests if they drift from the frozen interface."
      ],
      "acceptanceCriteria": [
        "Core contracts compile and have snapshot/golden tests.",
        "Risk gates are documented as machine-readable config defaults and human-readable plan doctrine.",
        "Adapter workspaces can implement against the frozen interface without touching core contract files.",
        "Any later contract change requires an explicit aggregator or repair workspace."
      ],
      "executorPrompt": "Freeze the Token Context Runtime core interfaces first. Encode all red-team fixes as explicit gates and defaults. Do not implement optimizers yet.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.01",
      "title": "Token Context Lab Harness and A/B Replay Foundation",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.00"
      ],
      "aggregator": false,
      "goal": "Create the lab harness that runs base Pi versus optimized/shadow Pi on identical tasks and produces comparable token, duration, correctness, fallback, and stability reports.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/lab/**",
        "packages/coding-agent/test/token-context/lab/**",
        "packages/coding-agent/scripts/token-context-lab/**",
        "packages/coding-agent/package.json"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/lab/**",
        "packages/coding-agent/test/token-context/lab/**",
        "packages/coding-agent/scripts/token-context-lab/**"
      ],
      "requirements": [
        "Support baseline, observe-only, shadow, and active modes.",
        "Run identical task fixtures under identical repo commit and model configuration where possible.",
        "Record final diff hash, test status, tool-call sequence, token usage, duration, fallback count, and human-intervention flags.",
        "Do not enable active optimization in this workspace."
      ],
      "acceptanceCriteria": [
        "A/B replay runner emits JSON and Markdown reports.",
        "Optimizers-disabled mode produces identical tool behavior to base Pi.",
        "Lab report contains per-tool and per-mechanism token accounting fields, even when values are zero.",
        "Fixture runner can be invoked by final validation without watch mode."
      ],
      "executorPrompt": "Implement the token-context lab harness only. Preserve base Pi behavior when optimizers are disabled. Produce deterministic fixture/replay artifacts.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.02",
      "title": "Savings Ledger and JSONL Store",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.00",
        "P43.01"
      ],
      "aggregator": false,
      "goal": "Implement the durable Savings Ledger used by every observer and optimizer to record raw/optimized token counts, actual provider usage when available, mechanism names, confidence, and safety metadata.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/ledger/**",
        "packages/coding-agent/test/token-context/ledger/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/ledger/**",
        "packages/coding-agent/test/token-context/ledger/**"
      ],
      "requirements": [
        "JSONL session store must be append-only and fail-open.",
        "Ledger records mechanism, toolName, rawTokensEstimate, optimizedTokensEstimate, savedTokensEstimate, actualProviderTokens when available, confidence, and divergence metadata.",
        "Ledger crash must never crash an agent session.",
        "Corrupt records must be skipped with warnings, not fatal errors."
      ],
      "acceptanceCriteria": [
        "Aggregates by tool, mechanism, file, workspace, session, and plan.",
        "Ledger supports export-ready summaries and raw event replay.",
        "Fail-open behavior is unit tested.",
        "Estimated savings are labelled estimated and never promoted as actual."
      ],
      "executorPrompt": "Implement the savings ledger and durable JSONL store. Do not modify read/edit/write/bash behavior yet. All ledger writes must be best-effort and fail-open.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.03",
      "title": "Provider Usage Calibration and Token Estimator Accuracy Gate",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.02"
      ],
      "aggregator": false,
      "goal": "Prevent inflated confidence by calibrating local token estimates against actual provider usage per model/provider/tool path and making P44 promotion depend on actual, not merely estimated, savings.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/calibration/**",
        "packages/coding-agent/test/token-context/calibration/**",
        "packages/coding-agent/src/token-context/ledger/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/calibration/**",
        "packages/coding-agent/test/token-context/calibration/**",
        "packages/coding-agent/src/token-context/ledger/**"
      ],
      "requirements": [
        "Implement provider usage sample ingestion for input/output/cache token fields when providers expose usage.",
        "Track estimated-vs-actual divergence per provider/model/tool/mechanism.",
        "Mark char/4 or byte-based estimates as provisional only.",
        "Gate P44 recommendation on actual session saving where provider usage exists; estimated-only savings may support research but not production promotion."
      ],
      "acceptanceCriteria": [
        "Calibration report shows raw estimated, optimized estimated, actual provider input/output/cache tokens, and divergence ratio.",
        "If divergence exceeds configured threshold, /savings warns that estimates are not promotion-grade.",
        "Golden tests cover Unicode, code-heavy files, JSON, Rust lifetimes, and long identifier cases.",
        "P44 promotion gate reads actualProviderSavingRatio when available.",
        "At least one OpenAI or Anthropic calibrated dogfood session is required for P44 eligibility",
        "Actual provider coverage ratio must be >= 0.8 for P44 recommendation"
      ],
      "executorPrompt": "Implement provider usage calibration. Do not trust chars/4 as a production metric. Report divergence and make promotion-grade savings depend on actual provider usage where available.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.04",
      "title": "/savings Menu, Widget, and Export Commands",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.02",
        "P43.03"
      ],
      "aggregator": false,
      "goal": "Expose savings visibility through CLI/TUI commands and a concise widget without injecting savings noise into model prompts.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/ui/**",
        "packages/coding-agent/src/token-context/commands/**",
        "packages/coding-agent/test/token-context/ui/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/ui/**",
        "packages/coding-agent/src/token-context/commands/**",
        "packages/coding-agent/test/token-context/ui/**"
      ],
      "requirements": [
        "Implement /savings summary, tools, mechanisms, files, raw, reset, export --json, and export --csv.",
        "Show actual-vs-estimated divergence and promotion-grade/estimate-only status.",
        "Show stability counters: fallbacks, hash mismatches caught, stale-cache escapes, ACR evictions, raw-cache evictions, LLM-fallback misses.",
        "Widget must be compact and must not be included in ordinary LLM context."
      ],
      "acceptanceCriteria": [
        "/savings works with empty, partial, and corrupted ledger files.",
        "Widget displays saved tokens, actual/estimated status, fallback count, and warnings.",
        "Exports include schemaVersion and can be used by the lab report generator.",
        "No extra savings report text is injected into routine prompts."
      ],
      "executorPrompt": "Implement savings visibility commands and widget. Surface actual/estimated divergence and safety warnings. Keep the model prompt clean.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.05",
      "title": "Raw Cache Retention Policy and Exact Fallback Guarantee",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.02"
      ],
      "aggregator": false,
      "goal": "Define and implement explicit raw cache retention so smart read and compact results always have predictable exact fallback behavior instead of silent eviction.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/raw-cache/**",
        "packages/coding-agent/test/token-context/raw-cache/**",
        "packages/coding-agent/src/token-context/config/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/raw-cache/**",
        "packages/coding-agent/test/token-context/raw-cache/**",
        "packages/coding-agent/src/token-context/config/**"
      ],
      "requirements": [
        "Configure maxBytes, maxEntryBytes, compression, LRU eviction, soft-limit warning, hard-limit behavior, TTL, and cache-full fallback semantics.",
        "Raw cache eviction must be logged to Savings Ledger and visible in /savings warnings.",
        "If a raw handle is evicted, system must fall back to fresh filesystem read, not pretend handle is available.",
        "Cache full conditions must have test fixtures."
      ],
      "acceptanceCriteria": [
        "Default raw cache policy is explicit, e.g. maxBytes configured and documented.",
        "No silent eviction breaks raw fallback guarantee.",
        "Cache pressure emits doctor warning and ledger event.",
        "Raw fallback succeeds through filesystem reread when handle is unavailable."
      ],
      "executorPrompt": "Implement raw cache retention and exact fallback semantics. Silent eviction is forbidden; cache pressure must be visible and safe.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.06",
      "title": "Read Hash Cache and Snapshot Store",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.02",
        "P43.05"
      ],
      "aggregator": false,
      "goal": "Implement content-addressed read snapshots so repeated reads of unchanged content can be avoided or compacted while preserving filesystem truth and raw fallback.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/read-cache/**",
        "packages/coding-agent/test/token-context/read-cache/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/read-cache/**",
        "packages/coding-agent/test/token-context/read-cache/**"
      ],
      "requirements": [
        "Each read snapshot records path, range, content hash, file hash, raw handle, token estimate, mtime/size metadata, and timestamp.",
        "External file changes must be detected by current filesystem hash comparison.",
        "Cache hit never overrides filesystem truth.",
        "Repeated read saving must be recorded to ledger as estimated until provider calibration proves actual saving."
      ],
      "acceptanceCriteria": [
        "Unchanged file and active context may return compact unchanged result.",
        "Changed file marks cache dirty and forces delta/exact/raw path.",
        "External mutation test catches modifications made outside the agent.",
        "Hash collision is treated as theoretical; implementation still stores range/path/file identity with content hash."
      ],
      "executorPrompt": "Implement read hash cache and snapshot store. Filesystem remains source of truth; cache is a derived optimization layer only.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.07",
      "title": "Active Context Registry",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.06"
      ],
      "aggregator": false,
      "goal": "Track whether file content, outline, exact symbol body, exact range, summary, or hash-only handle is currently active in the model context so unchanged reads do not blind the model.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/active-context/**",
        "packages/coding-agent/test/token-context/active-context/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/active-context/**",
        "packages/coding-agent/test/token-context/active-context/**"
      ],
      "requirements": [
        "Record coverage kind: full, outline, exactSymbol, exactRange, summary, hashOnly.",
        "Record conservative turn/window aging and eviction events.",
        "If active context is unknown or evicted, spend tokens: return compact summary or require exact read, not bare UNCHANGED.",
        "ACR events must be visible to Change Ledger semantics and Savings Ledger."
      ],
      "acceptanceCriteria": [
        "Context active/inactive transitions are deterministic and tested.",
        "No blind unchanged response when content is inactive or uncertain.",
        "Eviction events are emitted and recorded.",
        "Registry uncertainty chooses safety over savings."
      ],
      "executorPrompt": "Implement Active Context Registry. Do not trust read cache alone; if active context is unknown, require summary or exact context.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.08",
      "title": "ACR × Change Ledger Semantics Gate",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.07"
      ],
      "aggregator": false,
      "goal": "Define the interaction rules between Active Context Registry and Change Ledger before implementing delta reread, preventing the case where ledger knows a file but the model has no live copy.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/policy/**",
        "packages/coding-agent/test/token-context/policy/**",
        "docs/token-context/acr-change-ledger-semantics.md",
        "docs/token-context/acr-change-ledger-state-machine.md"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/policy/**",
        "packages/coding-agent/test/token-context/policy/**",
        "docs/token-context/acr-change-ledger-semantics.md"
      ],
      "requirements": [
        "If a file is evicted from active context, delta reread alone is forbidden until an exact symbol/range snapshot is restored.",
        "If ledger says known but ACR says inactive, response must include compact summary plus suggested exact reads, or force exact read before mutation.",
        "If ACR and ledger disagree, trust filesystem and force fresh smart_read exact/raw as needed.",
        "Expose a policy function used by both smart_read and change ledger."
      ],
      "acceptanceCriteria": [
        "Cross-check tests cover active, inactive, evicted, dirty, changed, and unknown states.",
        "Delta reread is blocked after ACR eviction unless checkpoint/exact snapshot exists.",
        "Policy emits ledger events for avoided unsafe savings.",
        "No mutation-safe result is produced from stale or summary-only context.",
        "State-machine diagram documents every ACR x ledger state combination",
        "Untested required cross-state combinations are hard validation failures"
      ],
      "executorPrompt": "Implement ACR × Change Ledger policy before the ledger itself. Prevent delta rereads from being used when the model has no live context copy. Add the explicit state-machine diagram and exhaustive cross-state hard-fail coverage matrix.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.09",
      "title": "Smart Read Core Tool and Adapter Registry",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.00",
        "P43.06",
        "P43.07",
        "P43.08"
      ],
      "aggregator": false,
      "goal": "Implement the smart_read core tool, adapter registry, mode semantics, confidence model, mutation safety policy, raw fallback, and stable response format.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/core/**",
        "packages/coding-agent/src/token-context/smart-read/index.ts",
        "packages/coding-agent/test/token-context/smart-read/core/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/core/**",
        "packages/coding-agent/src/token-context/smart-read/index.ts",
        "packages/coding-agent/test/token-context/smart-read/core/**"
      ],
      "requirements": [
        "Support modes: outline, symbols, symbol, range, changed, exact, raw.",
        "Every result includes path, fileHash, mode, adapterId, confidence, mutationSafe, rawHandle, includedRanges, omittedRanges, suggestedNextReads, and tokenEstimate.",
        "Outline/summary/generic/LLM fallback modes are mutationSafe=false.",
        "Exact symbol/range/raw may be mutationSafe=true only when current file hash and range resolution are verified."
      ],
      "acceptanceCriteria": [
        "Core smart_read works with no language adapter by using generic fallback.",
        "Exact mutation policy is enforced: no mutation from summary-only or outline-only context.",
        "Raw fallback works even when adapter parse fails.",
        "Adapter API is stable and imported by all language adapters without core mutation."
      ],
      "executorPrompt": "Implement smart_read core and adapter registry against frozen contracts. Enforce mutation safety rules and raw fallback. Do not implement individual language adapters here.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.09.5",
      "title": "Tool Event Mode Wiring Aggregator",
      "role": "implementation",
      "dependencies": [
        "P43.09"
      ],
      "aggregator": true,
      "queuePriority": "critical",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/wiring/**",
        "packages/coding-agent/src/token-context/feature-flags/**",
        "packages/coding-agent/test/token-context/wiring/**",
        "docs/token-context/tool-event-mode-wiring.md"
      ],
      "acceptanceCriteria": [
        "disabled/observe_only/shadow/active_safe/active_experimental modes are explicit and logged",
        "observe_only behavior is identical to base Pi except telemetry artifacts",
        "shadow records optimized hypothetical outputs but sends original results to the model",
        "active_safe enables only guarded read/hash/smart_read/change-ledger behavior",
        "active_experimental is disabled by default and cannot enable P44-deferred mechanisms",
        "read/edit/write/bash tool-event wiring has integration tests"
      ],
      "validation": {
        "targetCommand": "pnpm --filter coding-agent test -- token-context/wiring",
        "watchModeForbidden": true,
        "deferredHeavyValidation": true
      },
      "executorPrompt": "Implement the explicit tool-event mode wiring aggregator for disabled/observe/shadow/active_safe/active_experimental modes across read/edit/write/bash events."
    },
    {
      "id": "P43.10",
      "title": "TypeScript and JavaScript Smart Read Adapter",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.09",
        "P43.09.5",
        "P43.14"
      ],
      "aggregator": false,
      "goal": "Implement first-class deterministic TS/JS adapter using Tree-sitter and optional TypeScript LSP enrichment for imports, exports, classes, functions, methods, symbols, and exact range reads.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/adapters/ts-js/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/ts-js/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/adapters/ts-js/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/ts-js/**"
      ],
      "requirements": [
        "Use deterministic parser output first; LSP enrichment is optional and fail-open.",
        "Support .ts, .tsx, .js, .jsx, .mts, .cts where feasible.",
        "Extract imports, exports, top-level declarations, class methods, function ranges, and common test blocks.",
        "Ambiguous syntax reduces confidence and suggests broader exact range/raw read."
      ],
      "acceptanceCriteria": [
        "Golden fixture symbol extraction accuracy target is at least 95% for supported TS/JS fixture set.",
        "LSP missing/crashing does not fail adapter; it logs warning and returns parser-only outline.",
        "Exact symbol read returns exact current filesystem slice with fileHash.",
        "Adapter does not touch smart-read core contracts."
      ],
      "executorPrompt": "Implement TS/JS smart-read adapter. Tree-sitter/deterministic extraction first; TypeScript LSP enrichment optional and fail-open.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.11",
      "title": "Python Smart Read Adapter",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.09",
        "P43.09.5",
        "P43.14"
      ],
      "aggregator": false,
      "goal": "Implement first-class Python adapter using deterministic AST/Tree-sitter extraction and optional Pyright/LSP enrichment.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/adapters/python/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/python/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/adapters/python/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/python/**"
      ],
      "requirements": [
        "Extract imports, module constants, classes, functions, async functions, methods, decorators, and pytest/unittest test functions.",
        "Support exact reads for function/class/method ranges.",
        "Handle syntax errors by lowering confidence and falling back to generic chunking.",
        "Pyright/LSP enrichment is optional."
      ],
      "acceptanceCriteria": [
        "Golden fixture symbol extraction accuracy target is at least 95%.",
        "Decorated functions and nested classes are represented with correct ranges where parser supports them.",
        "Syntax-error fixture does not crash smart_read.",
        "Adapter does not mutate core contracts."
      ],
      "executorPrompt": "Implement Python smart-read adapter. Deterministic AST/Tree-sitter extraction first; LSP optional; parser failure falls back safely.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.12",
      "title": "JSON and YAML Smart Read Adapters",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.09",
        "P43.09.5",
        "P43.14"
      ],
      "aggregator": false,
      "goal": "Implement first-class structured-data adapters for JSON and YAML using key-path outlines, selected-path exact reads, large-array summaries, anchors, and schema-like hints where available.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/adapters/json-yaml/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/json-yaml/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/adapters/json-yaml/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/json-yaml/**"
      ],
      "requirements": [
        "JSON outline lists top-level keys, nested key paths, array sizes, selected values only when small, and JSON pointer suggestions.",
        "YAML outline lists documents, key paths, anchors/aliases where available, and selected range suggestions.",
        "Large arrays/objects are summarized without dumping entire values.",
        "Exact path/range reads must preserve original formatting where needed for mutation."
      ],
      "acceptanceCriteria": [
        "JSON/YAML key path extraction accuracy target is at least 98% on golden fixtures.",
        "package.json scripts/dependencies exact read works.",
        "Invalid JSON/YAML lowers confidence and falls back safely.",
        "Adapter never claims mutationSafe=true for summary-only key outline."
      ],
      "executorPrompt": "Implement JSON/YAML smart-read adapters with path-based summaries and exact selected-path/range reads. Large values must not be dumped by default.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.13",
      "title": "Rust Smart Read Adapter",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.09",
        "P43.09.5",
        "P43.14"
      ],
      "aggregator": false,
      "goal": "Implement first-class Rust adapter using Tree-sitter and optional rust-analyzer enrichment for use/mod declarations, structs, enums, traits, impl blocks, functions, methods, tests, and macro-aware confidence reduction.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/adapters/rust/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/rust/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/adapters/rust/**",
        "packages/coding-agent/test/token-context/smart-read/adapters/rust/**"
      ],
      "requirements": [
        "Extract use/mod declarations, structs, enums, traits, impl blocks, functions, methods, and #[cfg(test)] sections.",
        "Macro-heavy areas must reduce confidence and suggest exact/raw reads.",
        "rust-analyzer enrichment is optional and fail-open due to indexing cost.",
        "Exact reads return verified current filesystem ranges."
      ],
      "acceptanceCriteria": [
        "Golden fixture symbol extraction accuracy target is at least 95% for non-macro-heavy Rust fixtures.",
        "Macro ambiguity does not produce mutationSafe summaries.",
        "Missing rust-analyzer produces warning only.",
        "Adapter does not mutate core contracts."
      ],
      "executorPrompt": "Implement Rust smart-read adapter. Use deterministic parser first; rust-analyzer optional; macro ambiguity lowers confidence and requires exact/raw read.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.14",
      "title": "Grammar, Tree-sitter, and Optional LSP Preflight",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.09"
      ],
      "aggregator": true,
      "goal": "Add a preflight capability layer that detects parser grammars and optional LSP availability per language before adapters run, installs only when allowed, and fails open to generic adapters when unavailable.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/preflight/**",
        "packages/coding-agent/src/token-context/smart-read/lsp/**",
        "packages/coding-agent/src/token-context/config/**",
        "packages/coding-agent/test/token-context/smart-read/preflight/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/preflight/**",
        "packages/coding-agent/src/token-context/smart-read/lsp/**",
        "packages/coding-agent/src/token-context/config/**"
      ],
      "requirements": [
        "Detect tree-sitter grammar availability per configured language.",
        "LSP auto-install is disabled by default; if enabled, install only allowlisted tools into user/project cache with pinned versions where supported.",
        "Missing parser/LSP is a warning, not a plan failure, unless an adapter test explicitly requires it.",
        "Preflight report is visible in doctor and lab output."
      ],
      "acceptanceCriteria": [
        "Grammar missing fixture falls back to generic adapter and records warning.",
        "LSP crash does not crash Pi or smart_read.",
        "Auto-install obeys config and never installs silently by default.",
        "Doctor report distinguishes parser missing, LSP missing, and adapter disabled."
      ],
      "executorPrompt": "Implement grammar and optional LSP preflight. Fail open to generic smart read when unavailable. Do not silently install external tools by default.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.15",
      "title": "Generic Adapter and Budget-Capped LLM-Assisted Fallback",
      "role": "implementation",
      "priority": "high",
      "dependencies": [
        "P43.09"
      ],
      "aggregator": false,
      "goal": "Implement generic chunk/section fallback and optional budget-capped LLM-assisted outline for unsupported languages, with mutationSafe always false and hard raw fallback when budget is exceeded.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/smart-read/fallback/**",
        "packages/coding-agent/test/token-context/smart-read/fallback/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/smart-read/fallback/**",
        "packages/coding-agent/test/token-context/smart-read/fallback/**"
      ],
      "requirements": [
        "Generic fallback uses deterministic chunks, headings, braces/indentation hints, changed ranges, and small excerpts.",
        "LLM-assisted fallback is opt-in, hard capped at configured token budget, e.g. 500–800 tokens, and aborted if it would exceed budget.",
        "LLM fallback may suggest candidate ranges only; it cannot authorize mutation and cannot synthesize exact code.",
        "If fallback budget is exceeded, use raw/exact read and record miss in ledger."
      ],
      "acceptanceCriteria": [
        "Unsupported language fixture returns generic outline with mutationSafe=false.",
        "LLM fallback budget cap is enforced and tested.",
        "Open-ended LLM call inside read operation cannot consume more tokens than configured cap without falling back.",
        "Fallback misses appear in /savings and lab reports."
      ],
      "executorPrompt": "Implement generic and LLM-assisted fallback. LLM fallback is budget-capped, optional, candidate-only, and never mutation-safe.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.16",
      "title": "Change Ledger, Delta Reread, and Checkpoint Policy",
      "role": "implementation",
      "priority": "critical",
      "dependencies": [
        "P43.06",
        "P43.08",
        "P43.09",
        "P43.09.5"
      ],
      "aggregator": false,
      "goal": "Record file changes as beforeHash/afterHash, patches, changed ranges, and changed symbols so changed files can be represented compactly without unsafe long delta chains.",
      "allowedFiles": [
        "packages/coding-agent/src/token-context/change-ledger/**",
        "packages/coding-agent/test/token-context/change-ledger/**"
      ],
      "conflictScope": [
        "packages/coding-agent/src/token-context/change-ledger/**",
        "packages/coding-agent/test/token-context/change-ledger/**"
      ],
      "requirements": [
        "Record edit/write/tool mutation events with beforeHash, afterHash, patch, changedRanges, changedSymbols where available, toolCallId, and saving estimate.",
        "Default checkpoint policy must be explicit: after 3–5 deltas require symbol snapshot; after 10+ deltas require exact reread, configurable but golden-tested.",
        "If delta token estimate exceeds exact snippet token estimate, return exact snippet instead of delta.",
        "Delta reread must obey ACR × Change Ledger semantics gate."
      ],
      "acceptanceCriteria": [
        "Patch and changed range generation are tested.",
        "Long delta chain triggers checkpoint exactly as configured.",
        "ACR eviction blocks delta-only reread before mutation.",
        "Ledger is advisory; filesystem/hash verification remains authoritative."
      ],
      "executorPrompt": "Implement Change Ledger and delta reread with explicit checkpoint policy. Do not allow long delta chains or ACR-evicted delta-only mutation.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.17",
      "title": "Replay, Synthetic Fixture, and Uncontrolled Dogfood Matrix",
      "role": "verification",
      "priority": "critical",
      "dependencies": [
        "P43.01",
        "P43.02",
        "P43.03",
        "P43.04",
        "P43.05",
        "P43.06",
        "P43.07",
        "P43.08",
        "P43.09",
        "P43.09.5",
        "P43.10",
        "P43.11",
        "P43.12",
        "P43.13",
        "P43.14",
        "P43.15",
        "P43.16"
      ],
      "aggregator": true,
      "goal": "Build the validation matrix that proves token-saving hypotheses across controlled fixtures and at least one uncontrolled real Pi dogfood session, preventing fixture-biased promotion.",
      "allowedFiles": [
        "packages/coding-agent/test/token-context/fixtures/**",
        "packages/coding-agent/test/token-context/replay/**",
        "packages/coding-agent/scripts/token-context-lab/**",
        "docs/token-context/lab-matrix.md"
      ],
      "conflictScope": [
        "packages/coding-agent/test/token-context/fixtures/**",
        "packages/coding-agent/test/token-context/replay/**",
        "packages/coding-agent/scripts/token-context-lab/**",
        "docs/token-context/lab-matrix.md"
      ],
      "requirements": [
        "Include repeated-read, large-file navigation, edit-after-read, file-changed-after-read, external mutation, long-delta-chain, test-failure, unsupported-language fallback, grammar-missing, and vector-disabled scenarios.",
        "Include at least one uncontrolled dogfood session on real Pi work, not only synthetic fixtures.",
        "Report token savings as actual when provider usage exists and estimated otherwise.",
        "Compare base Pi versus optimized Pi for final diff, tests, duration, tool sequence, and fallback events."
      ],
      "acceptanceCriteria": [
        "Lab matrix can run in CI/local without watch mode.",
        "Uncontrolled dogfood result is present in final report even if savings are lower than synthetic fixtures.",
        "No P44 recommendation can be issued from synthetic-only evidence.",
        "Regression replay artifacts are persisted.",
        "Provider-calibrated dogfood coverage threshold is met before P44 recommendation",
        "Tool-event mode wiring is covered in replay artifacts"
      ],
      "executorPrompt": "Implement the replay and dogfood matrix. Include real uncontrolled dogfood, not just synthetic fixtures. Gate P44 on actual evidence.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    },
    {
      "id": "P43.18",
      "title": "Final Validation, Targeted Repair, and P44 Recommendation Report",
      "role": "verification",
      "priority": "critical",
      "dependencies": [
        "P43.17"
      ],
      "aggregator": true,
      "goal": "Run final validation, consume failures, apply targeted repair if allowed, and produce the final recommendation: promote to P44, keep observe-only, or roll back specific mechanisms.",
      "allowedFiles": [
        "reports/token-context/p43/**",
        "packages/coding-agent/test/token-context/**",
        "docs/token-context/p44-recommendation.md"
      ],
      "conflictScope": [
        "reports/token-context/p43/**",
        "docs/token-context/p44-recommendation.md"
      ],
      "requirements": [
        "Run deterministic unit tests, golden tests, mutation-safety tests, replay tests, and dogfood matrix.",
        "If validation fails, produce targeted repair instructions and rerun relevant tests or create handoff_required.",
        "Final report must distinguish actual provider savings, estimated savings, speed impact, stability regression, and fallback rate.",
        "P44 recommendation must be conservative and mechanism-specific."
      ],
      "acceptanceCriteria": [
        "Final validation passes or produces handoff_required with artifacts.",
        "Report includes minimum 40% lab target status, actual/estimated divergence, stale-cache escape count, hash mismatch fallback rate, ACR eviction behavior, raw-cache pressure, grammar/LSP warnings, and dogfood evidence.",
        "P44 recommendation never relies on estimate-only savings when actual provider usage exists.",
        "Plan cannot complete if final validation fails.",
        "Final validation fails if any required ACR x Change Ledger combination is untested",
        "P44 recommendation blocked without provider-calibrated dogfood coverage >= 0.8",
        "Final report includes tool-event mode wiring status"
      ],
      "executorPrompt": "Run final validation and produce the P43 final report. If failures are targeted and safe, repair and rerun. Otherwise create handoff_required. Do not overclaim savings.",
      "validation": {
        "policy": "deferred",
        "targetedCommands": [
          "pnpm --filter coding-agent test -- token-context"
        ],
        "finalValidationRequired": true,
        "watchModeForbidden": true,
        "timeoutMs": 120000,
        "outputCapBytes": 2000000
      },
      "patchTransaction": {
        "mustProducePatchArtifact": true,
        "mustUseWriteSetGuard": true,
        "mustUseFileHashGuard": true,
        "rollbackRequired": true,
        "workersMayMutateRepository": false,
        "repositoryMutationAuthority": "patch_coordinator"
      },
      "safety": {
        "noMutationFromSummaryOnlyContext": true,
        "filesystemTruthRequired": true,
        "failOpenOnTelemetryFailure": true
      }
    }
  ],
  "completionPredicate": {
    "requiredWorkspacesMustBeTerminal": true,
    "unresolvedHandoffBlocksCompletion": true,
    "finalValidationRequired": true,
    "finalValidationFailureBlocksCompletion": true,
    "p44RecommendationRequired": true
  }
}
```

---

# Part 4 — Machine-Readable Summary

```json
{
  "phaseId": "P43",
  "title": "Pi Token Context Runtime Lab — Revision 3 Residual-Risk Hardened Plan",
  "workstreamCount": 20,
  "selectedScaleMode": "stable_6",
  "executorType": "patch_transaction",
  "minimumLabTarget": "40% promotion-grade token saving",
  "targetSafeSaving": "45-65%",
  "largeTaskSpeedGain": "1.30-1.60x after tuning",
  "redTeamFixesApplied": [
    "provider usage calibration",
    "ACR x Change Ledger semantics",
    "adapter interface freeze",
    "explicit delta checkpoint policy",
    "budget-capped LLM fallback",
    "raw cache retention policy",
    "grammar/LSP preflight",
    "uncontrolled dogfood requirement",
    "ACR x Change Ledger exhaustive state-machine hard-fail matrix",
    "OpenAI/Anthropic provider-calibrated dogfood coverage threshold",
    "explicit tool-event mode wiring aggregator"
  ],
  "productionDefaultRecommendation": "P43 may recommend P44 only if actual/provider-calibrated saving >= 40%, at least one OpenAI/Anthropic calibrated dogfood session reaches >=80% usage coverage, stale-cache escape = 0, ACR x Change Ledger untested combinations = 0, and final validation passes.",
  "deferred": "guarded smart edit, vector DB advisory, worker write, vector source-of-truth forbidden"
}
```

---

# Appendix A — Lab Acceptance Matrix

| Gate | Required result |
|---|---|
| Metrics coverage | >= 95% tool calls have ledger coverage or explicit no-op event |
| Actual/estimated divergence | Reported per provider/model/tool; warnings if >20% |
| Minimum saving | >= 40% promotion-grade saving or no P44 promotion |
| Target safe package | 45–65% expected after tuning |
| Stale cache escape | 0 |
| Hash mismatch fallback | 100% in fixtures |
| Raw fallback | 100% through handle or fresh filesystem reread |
| LLM fallback budget | Hard cap enforced |
| ACR eviction | Blocks unsafe delta-only reread |
| Delta chain | Checkpoint policy enforced |
| Golden adapters | TS/JS/Python/Rust >=95%; JSON/YAML >=98% on fixtures |
| Dogfood | At least one uncontrolled real Pi session |
| Final validation | Passed or handoff_required |

# Appendix B — Expected Outcomes

| Package | Expected token saving | Expected risk after tests | Expected speed impact |
|---|---:|---:|---:|
| Ledger + calibration only | 0–3% | 0–2% | neutral |
| RTK/bash + ledger | 15–35% on debug-heavy sessions | 2–5% | positive for logs/tests |
| Read hash cache + ACR | 20–45% | 4–10% | positive on repeated reads |
| Smart read + deterministic adapters | 35–60% | 6–14% | positive on large files |
| Change ledger with checkpoints | 45–70% | 8–16% | positive on long edit loops |
| P43 target safe package | 45–65% | 8–16% | 1.15–1.40x normal, 1.30–1.60x debug-heavy |

# Appendix C — Non-Goals

* Guarded smart edit is not production default in P43.
* Vector DB advisory retrieval is not production default in P43.
* Vector DB as source of truth is forbidden.
* Worker-model write is deferred.
* Full multi-language ecosystem is deferred beyond TS/JS/Python/JSON/YAML/Rust.
* P43 does not claim universal savings; it proves or rejects a measured rollout hypothesis.

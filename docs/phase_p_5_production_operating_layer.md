# Phase P5 — Production Operating Layer, Project Memory & Multi-Plan Queue

**Author:** Pi Development Team  
**Template:** LLM Implementation Agent — Master Template v2.1.0  
**Created:** 2026-05-13  
**Target system:** Pi autonomous coding runtime  
**Goal:** Turn Pi from a single-plan autonomous executor into a production-grade project automation runner with durable execution archives, project memory, skill resolution, safety profiles, live worker transcripts, and a multi-plan queue.

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** P5  
**One-line goal:** Upgrade Pi from a visible single-plan executor into a production operating layer that can queue multiple plans, archive every run, export project memory, resolve skills, enforce safety profiles, and show live worker activity.  
**Why now:** P4 makes execution observable, committable, and human-controlled at plan completion. P5 builds the operational layer needed to use Pi continuously on real projects: plan queues, durable artifacts, skill-aware execution, project-level settings, better logs, and replayable runs.  
**Blast radius:** `packages/web-server/src/`, `packages/coding-agent/src/`, `packages/web-ui/dashboard/src/`, `docs/pi/`, `.pi/executions/`, `.pi/plan-queue/`, `.pi/skills/`, and related tests. Product application source changes are forbidden except docs generated under `docs/pi/`.  
**Rollback path:** Disable the plan queue runner, disable docs export, disable skill auto-resolution, disable experimental worker counts, and fall back to P4 single-plan execution. Runtime artifacts can be removed from `.pi/executions/` and `.pi/plan-queue/` without touching product code.  
**Done when:** Pi can accept multiple plans into a project queue, validate and reorder them in the dashboard, run them sequentially with clean commit gates between plans, archive all execution artifacts, export human-readable docs, resolve local skills, enforce configurable safety profiles, stream live worker action summaries, and provide replay/retry metadata for failed workspaces.

---

## 1. Header

| Field | Value |
|---|---|
| Phase | P5 |
| Title | Production Operating Layer, Project Memory & Multi-Plan Queue |
| Status | Planned |
| Last updated | 2026-05-13 |
| Delivery status | Not started |
| Target environment | Local Pi runtime |
| Primary focus | Production operations, project memory, plan queue, skills, safety settings, observability |
| Product-code changes | Restricted — Pi runtime/dashboard/docs only |

### 1.1 RACI

| Workstream | R | A | C | I |
|---|---|---|---|---|
| 5.A — Execution Archive / Plan Vault | Pi Worker Agent | User / owner | Reviewer | User |
| 5.B — Docs Export & Project Memory | Pi Worker Agent | User / owner | Reviewer | User |
| 5.C — Artifact Browser UI | Pi Worker Agent | User / owner | Reviewer | User |
| 5.D — Skill Registry & Skill Resolver v1 | Pi Worker Agent | User / owner | Reviewer | User |
| 5.E — Safety Profiles & Settings | Pi Worker Agent | User / owner | Reviewer | User |
| 5.F — Live Worker Transcript | Pi Worker Agent | User / owner | Reviewer | User |
| 5.G — Chat as Project Tab | Pi Worker Agent | User / owner | Reviewer | User |
| 5.H — Logs v2: Narrative, Audit, Decision Streams | Pi Worker Agent | User / owner | Reviewer | User |
| 5.I — Production Readiness Doctor | Pi Worker Agent | User / owner | Reviewer | User |
| 5.J — Replay / Resume / Retry Metadata | Pi Worker Agent | User / owner | Reviewer | User |
| 5.K — Multi-Plan Queue Runner | Pi Worker Agent | User / owner | Reviewer | User |
| 5.L — Interactive Plan Queue UI | Pi Worker Agent | User / owner | Reviewer | User |
| 5.M — Worker Concurrency Settings & Experimental 6-Worker Mode | Pi Worker Agent | User / owner | Reviewer | User |
| 5.N — P5 Dogfood & Stability Report | Pi Worker Agent | User / owner | Reviewer | User |

---

## 2. Purpose

P4 makes Pi execution visible and controllable: auto-commit, living plan markdown, structured tool-call events, post-plan handoff, workspace diffs, retry history, event-driven execution, retry policies, and structured logs. P5 builds on that by making Pi usable as an ongoing project automation layer rather than a one-plan-at-a-time runner.

After P4, Pi can run a plan and show what happened. But production use requires more: every run must be durably archived, plans must be queued and ordered, execution artifacts must be browsable, project docs must be generated, safety behavior must be configurable, skills must be resolved per workspace, and users must see what each worker is doing in real time.

P5 introduces a project-level operating model:

```text
upload multiple plans
→ validate each plan
→ queue plans
→ reorder plans in dashboard
→ run one active plan at a time
→ archive all artifacts
→ commit/handoff/export docs
→ verify clean working tree
→ start next queued plan
```

P5 deliberately does not try to solve large-scale parallelism fully. Stable execution remains capped at 3 workers. An experimental 4–6 worker mode may be added behind explicit settings and doctor warnings, but true 6+ worker production reliability is deferred to P6 with git worktree isolation and merge queues.

---

## 3. What Carried Over — Must Stay Stable

* [x] P1 token budget gateway remains mandatory.
* [x] 1M context remains disabled by default.
* [x] Full repo injection remains forbidden by default.
* [x] Full chat history injection remains forbidden by default.
* [x] Large-file full injection remains forbidden by default.
* [x] P2 bounded autonomous execution model remains intact.
* [x] Same-file parallelism remains disabled.
* [x] P3 reliability and recovery fixes must not regress.
* [x] P4 structured tool-call events remain the source of truth for command visibility.
* [x] P4 auto-commit must never run `git push`.
* [x] P4 post-plan handoff remains the gate before a queued next plan can start.
* [x] `autoPush: false` remains non-negotiable.
* [x] Executor remains the only component that mutates execution state.
* [x] Dashboard may write control/queue requests but must not directly mutate workspace execution state.
* [x] JSON Part 3 remains the machine-readable execution contract.
* [x] Existing REST/SSE APIs must remain backward compatible.

---

## 4. Background / What Was Wrong

P4 solves execution visibility but not production operations. Users can observe and finish a plan, but the larger workflow is still fragmented.

Current missing production behaviors:

* Uploaded plans are not preserved as full execution bundles.
* Parsed contracts, doctor results, workspace packets, tool calls, transcripts, diffs, test results, and final summaries are not stored together under one durable execution directory.
* Plans can be run one at a time, but users cannot upload several plans into a queue and let Pi process them sequentially.
* There is no project-level queue UI for ordering, skipping, pausing, or resuming future plans.
* Docs export is manual or inconsistent.
* Skill loading/resolution is not integrated with plan execution.
* Safety behavior lives in plan contracts and code paths, but users cannot choose project-level safety profiles from settings.
* Worker logs show terminal output and tool calls, but not enough live user-readable action and decision summaries.
* Chat is not organized as a first-class project tab.
* Failed workspaces are hard to replay or retry with the original context.
* Increasing worker count beyond 3 is unsafe without explicit experimental gating.

P5 fixes these operational gaps without taking on the P6 problem of true high-parallelism execution across git worktrees.

---

## 5. Current Failure State / Known Blockers

* `execution_archive` = not implemented — no complete `.pi/executions/{planExecId}/` bundle.
* `docs_export` = incomplete — no reliable project-memory export to `docs/pi/`.
* `artifact_browser` = not implemented — artifacts exist in scattered places, not browsable as one run graph.
* `skill_registry` = not implemented — no local skill manifest, resolver, or project allowlist.
* `safety_profiles` = not implemented — no project-level Strict/Balanced/Full Auto profiles.
* `live_worker_transcript` = incomplete — logs show outputs, not worker action/decision summaries.
* `chat_project_tab` = not implemented — chat is not a first-class project workflow tab.
* `logs_v2` = incomplete — raw, structured, narrative, audit, and decision logs are not separated.
* `production_readiness_doctor` = not implemented — doctor cannot assess archive/queue/skills/settings readiness.
* `replay_retry_metadata` = incomplete — failed workspace replay/retry is not first-class.
* `multi_plan_queue` = not implemented — plans cannot be queued and executed sequentially.
* `interactive_queue_ui` = not implemented — no drag/reorder/skip/pause/resume plan queue UI.
* `worker_count_settings` = incomplete — no safe UI for stable vs experimental concurrency.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Plan queue starts next plan on dirty working tree | med | high | Require clean working tree gate before starting next queued plan |
| Multiple plans conflict semantically | med | high | Run only one active plan at a time in P5; add doctor warnings for overlapping file scopes |
| Docs export commits noisy generated files | med | med | Make docs export configurable; write only under `docs/pi/`; include generated-file headers |
| Execution archive grows too large | med | med | Add retention settings and size caps; truncate large logs with pointers to raw files |
| Skill resolver runs untrusted code | med | high | P5 supports local manifest resolution only by default; remote fetch disabled unless explicitly enabled |
| Safety profile too permissive | med | high | Strict profile default; Full Auto requires explicit enablement and doctor warning |
| Live transcript leaks raw hidden reasoning | low | high | Emit user-facing decision summaries/action rationales only; never store private chain-of-thought |
| Experimental 6-worker mode destabilizes execution | med | high | Keep stable max at 3; 4–6 worker mode behind explicit experimental flag and doctor warning |
| Queue reorder while plan is active corrupts schedule | low | med | Allow reordering queued plans only; active plan cannot be moved |
| Replay uses stale context | med | med | Store replay manifest with plan hash, workspace packet hash, git commit base, and artifact paths |
| Artifact browser exposes forbidden files | low | high | Browser lists only generated artifacts under `.pi/` and `docs/pi/`; never reads secrets/env files |
| Archive write failure blocks plan completion | low | med | Archive failure warns and stops queue, but does not corrupt completed workspace commits |

---

## 7. Workstreams

### 5.A — Execution Archive / Plan Vault

**Goal:** Create a durable execution archive for every plan run under `.pi/executions/{planExecId}/`, containing all plan, contract, safety, workspace, log, diff, test, and summary artifacts.

**Requirements:**
* Create `.pi/executions/{planExecId}/` at plan start.
* Save original uploaded plan as `original-plan.md`.
* Save parsed contract as `parsed-contract.json`.
* Save doctor output as `doctor-report.json`.
* Save dry-run output, when available, as `dry-run-report.json`.
* Save workspace DAG as `workspace-dag.json`.
* Save safety policy snapshot as `safety-policy.json`.
* Save commit map as `commits.json`.
* For each workspace, create `.pi/executions/{planExecId}/workspaces/{workspaceId}/`.
* Workspace archive contains `packet.md`, `tool-calls.ndjson`, `events.ndjson`, `decisions.ndjson`, `files-touched.json`, `test-results/`, `reviewer-verdict.md`, and `diff.patch` when available.
* Archive writes are append-safe and atomic where possible.
* Archive writer must never read or copy forbidden files.

**Acceptance Criteria:**
* Starting a plan creates `.pi/executions/{planExecId}/`.
* The archive includes original plan, parsed contract, doctor report, DAG, safety policy, and per-workspace folders.
* Completed workspace archive contains packet, tool calls, changed files, verdict, and diff patch when available.
* Archive paths are linked from plan detail API.
* Archive failure logs a warning and stops the plan queue before the next plan starts.

---

### 5.B — Docs Export & Project Memory

**Goal:** Export human-readable plan and execution summaries under `docs/pi/` so Pi's work becomes durable project memory, not only runtime state.

**Requirements:**
* Create `docs/pi/plans/` and `docs/pi/executions/` when docs export is enabled.
* Export a normalized plan document to `docs/pi/plans/{phase}-{slug}.md`.
* Export final execution summary to `docs/pi/executions/{date}-{phase}-{planExecId}-summary.md`.
* Summary includes phase, title, workspace results, commits, files changed, test results, safety warnings, unresolved follow-ups, and next recommended plan.
* Generated docs include a header indicating they are Pi-generated.
* Docs export must be optional via project settings.
* Docs export only writes under `docs/pi/`.

**Acceptance Criteria:**
* Completed plan exports a summary file under `docs/pi/executions/` when enabled.
* Export includes workspace status table and commit hashes.
* Export includes failed/blocked workspace details when applicable.
* Export never writes outside `docs/pi/`.
* Disabling docs export prevents generated docs from being written.

---

### 5.C — Artifact Browser UI

**Goal:** Add an Artifacts tab to the dashboard that lets users browse all generated plan and workspace artifacts from the execution archive.

**Requirements:**
* Add project-level `Artifacts` tab.
* Show plan archive tree: original plan, contract, doctor report, dry-run report, final summary, commits, workspace folders.
* Workspace artifact view shows packet, tool calls, decisions, test results, diff, reviewer verdict, and files touched.
* Large text artifacts are paginated or truncated with a clear notice.
* Binary/unknown artifacts are shown as downloadable/openable entries only if safe.
* Artifact browser reads only `.pi/executions/` and `docs/pi/` generated outputs.
* Add API endpoints for listing and reading generated artifacts.

**Acceptance Criteria:**
* Dashboard shows Artifacts tab for selected project/run.
* User can open a workspace packet, final summary, diff patch, and tool-call log.
* Large artifacts are truncated with a clear continuation/download option.
* Forbidden files and arbitrary repo files cannot be browsed through this UI.

---

### 5.D — Skill Registry & Skill Resolver v1

**Goal:** Add a local skill registry and resolver so Pi can recommend and attach relevant skills to workspaces before execution.

**Requirements:**
* Create local skill registry directory `.pi/skills/` or configurable project skill path.
* Define `skill.json` manifest format with name, version, description, supported task types, allowed tools, checksum, and entrypoint docs.
* Add `SkillRegistry` service for listing and validating installed skills.
* Add `SkillResolver` service that maps workspace metadata to recommended skills.
* Add project-level skill allowlist.
* Doctor validates required skills are installed and checksums match.
* Auto-fetch from remote registries is disabled by default in P5.
* Skill resolver may recommend skills, but missing optional skills must not block execution.
* Required skills block execution if missing.

**Acceptance Criteria:**
* Dashboard Skills tab lists installed local skills.
* Plan doctor reports missing required skills.
* Workspace detail shows recommended and attached skills.
* Remote skill fetch is disabled by default.
* No skill code is executed unless allowed by project settings and manifest validation passes.

---

### 5.E — Safety Profiles & Settings

**Goal:** Add project-level safety profiles that control automation behavior without editing every plan contract manually.

**Requirements:**
* Add safety profile setting: `strict`, `balanced`, `full_auto`.
* Default profile is `strict`.
* `strict`: destructive commands blocked, auto-run queue disabled, dependency install blocked, handoff required.
* `balanced`: auto-commit allowed, tests/typecheck allowed, queue auto-run optional, dependency install requires approval.
* `full_auto`: queue auto-run allowed, docs export allowed, auto-commit allowed, but `git push`, secrets, private keys, and raw destructive commands remain blocked.
* `rm -rf` remains forbidden in every profile.
* Introduce safe deletion policy placeholder: destructive shell deletion stays blocked; future safe delete uses scoped/quarantine API.
* Settings UI shows effective permissions for selected profile.
* Plan doctor merges plan-level safety with project-level profile and reports conflicts.

**Acceptance Criteria:**
* Settings UI can select Strict/Balanced/Full Auto.
* Strict is default for new projects.
* `git push` and `rm -rf` remain blocked in all profiles.
* Full Auto requires explicit confirmation before enabling.
* Doctor reports when plan asks for behavior not allowed by selected profile.

---

### 5.F — Live Worker Transcript

**Goal:** Show live user-readable worker activity in WorkerDetail: current goal, current step, latest action, decision summary, validation result, blocker, and next action.

**Requirements:**
* Add structured event types: `worker_status`, `worker_decision_summary`, `worker_next_action`, `worker_blocker`, `worker_context_used`, `worker_file_focus`, `worker_validation_result`.
* Events contain user-facing summaries only, not raw hidden chain-of-thought.
* WorkerDetail shows a live transcript timeline.
* Transcript entries are archived to `decisions.ndjson` and `events.ndjson`.
* Transcript is filterable by status/action/validation/blocker.
* Transcript rendering works for active, completed, failed, and replayed workspaces.

**Acceptance Criteria:**
* Active workspace shows current goal and current step.
* Worker decision summaries appear in real time.
* Test/typecheck failures appear as validation result events.
* Blocked workspace shows blocker event with reason.
* No raw private chain-of-thought is emitted or stored.

---

### 5.G — Chat as Project Tab

**Goal:** Move chat from a sidebar-style secondary area into a first-class project tab connected to plans, runs, artifacts, and follow-up generation.

**Requirements:**
* Add project-level `Chat` tab.
* Chat can reference selected project, selected plan, selected run, and selected workspace.
* Chat has quick actions: summarize run, explain failure, generate follow-up plan, summarize artifacts, inspect queue.
* Right sidebar remains available for event feed, active worker status, alerts, and handoff prompts.
* Chat messages may link to generated artifacts but must not directly mutate execution state.

**Acceptance Criteria:**
* Project has a Chat tab.
* Chat can summarize a selected run using generated artifacts.
* Chat can generate a follow-up plan draft without executing it automatically.
* Right sidebar no longer needs to carry the main chat workflow.

---

### 5.H — Logs v2: Narrative, Audit, Decision Streams

**Goal:** Split logs into clear streams so users can understand what happened without reading raw terminal output.

**Requirements:**
* Maintain separate log streams:
  * raw logs: stdout/stderr/test output
  * structured logs: machine-readable events
  * narrative logs: user-readable worker story
  * audit logs: safety/commit/settings/queue actions
  * decision logs: worker decision summaries/action rationales
* Each stream is written per workspace and aggregated per plan.
* Dashboard log viewer supports stream filters.
* Audit logs include queue reorder, queue auto-run start, safety profile changes, commit actions, docs export, skill resolution, and archive writes.
* Logs must respect P4 batching and avoid per-line state-store writes.

**Acceptance Criteria:**
* Logs tab can filter raw/structured/narrative/audit/decision streams.
* Queue reorder and safety profile changes appear in audit log.
* Worker summaries appear in narrative and decision logs.
* Raw stdout remains available but is no longer the only source of truth.

---

### 5.I — Production Readiness Doctor

**Goal:** Extend `pi plan doctor` into a production readiness doctor that validates archive, queue, skills, safety profile, docs export, and replay readiness before execution.

**Requirements:**
* Add production readiness checks:
  * archive path writable
  * docs export path writable if enabled
  * Part 3 JSON valid
  * no unresolved placeholders
  * DAG acyclic
  * autoPush false
  * safety profile compatible with plan
  * required skills installed
  * skill checksums valid
  * broad `canEdit` patterns warned
  * targetCommand missing warned
  * plan queue state healthy
  * clean working tree required if queue auto-run is enabled
  * replay manifest can be created
* Doctor output has PASS/WARN/FAIL sections.
* Failing checks block execution; warnings do not.

**Acceptance Criteria:**
* Doctor reports production readiness summary.
* Missing required skill fails doctor.
* Broad file scopes produce warnings.
* Dirty working tree fails queue auto-run readiness.
* Doctor output is available in dashboard and archived as `doctor-report.json`.

---

### 5.J — Replay / Resume / Retry Metadata

**Goal:** Make failed or blocked workspaces replayable and retryable with the same archived context.

**Requirements:**
* Store `replay-manifest.json` per plan.
* Store per-workspace `workspace-replay.json` with workspace packet hash, base commit, files touched, target command, last error, and artifact paths.
* Add APIs/CLI commands for:
  * retry failed workspace
  * replay workspace in dry-run mode
  * resume plan from failed workspace
  * summarize failed run into follow-up plan
* Replay must not mutate repo unless explicitly run as retry.
* Retry must respect current safety profile and working tree cleanliness.

**Acceptance Criteria:**
* Failed workspace has replay metadata.
* User can retry a failed workspace from dashboard or CLI.
* Dry-run replay reads archived artifacts without modifying files.
* Retry is blocked if working tree is dirty or safety profile disallows it.

---

### 5.K — Multi-Plan Queue Runner

**Goal:** Allow users to upload multiple plans into a project-level queue and run them sequentially, automatically moving to the next plan only after the current plan completes all gates.

**Requirements:**
* Add plan queue store under `.pi/plan-queue/` and/or state backend.
* Queue item states: `queued`, `validating`, `ready`, `running`, `awaiting_handoff`, `complete`, `failed`, `skipped`, `canceled`.
* Only one active plan may run per project in P5.
* Queue runner can be enabled/disabled in settings.
* Auto-run next plan is disabled by default.
* If enabled, queue runner starts next ready plan after current plan completes.
* Before starting next plan, runner verifies:
  * current plan terminal state is complete
  * handoff is resolved
  * commits are complete or explicitly skipped
  * docs export completed or disabled
  * execution archive completed
  * working tree is clean
  * no unresolved safety warnings block continuation
* On failure, default behavior is stop queue.
* Queue supports pause/resume/stop-after-current.

**Acceptance Criteria:**
* Multiple uploaded plans can be queued.
* Queue runner starts first ready plan when user triggers run.
* When a plan completes and gates pass, next plan starts if auto-run is enabled.
* Dirty working tree prevents next plan from starting.
* Failed plan stops queue by default.
* Queue state survives server restart.

---

### 5.L — Interactive Plan Queue UI

**Goal:** Add an interactive Plan Queue dashboard tab for upload, reorder, skip, pause, resume, and inspect queued plans.

**Requirements:**
* Add `Plan Queue` tab.
* Support multi-plan upload.
* Show each queue item with title, phase, status, risk, workspace count, doctor status, estimated blast radius, and last updated time.
* Allow drag-and-drop reorder for queued/ready items.
* Active/running item cannot be moved.
* Buttons: Run next, Pause queue, Resume queue, Stop after current, Skip, Remove, Move to top.
* Reorder actions emit audit log events.
* Queue UI shows current settings: auto-run on/off, stop-on-failure, require clean tree.

**Acceptance Criteria:**
* User can upload multiple plans and see them in queue.
* User can reorder queued plans interactively.
* Active plan is locked in place.
* Queue audit log records reorder/skip/remove actions.
* Queue UI updates live when plan status changes.

---

### 5.M — Worker Concurrency Settings & Experimental 6-Worker Mode

**Goal:** Add project settings for worker concurrency while keeping stable execution capped at 3 and gating 4–6 workers behind explicit experimental mode.

**Requirements:**
* Add `maxParallelWorkspaces` setting to project settings.
* Stable mode allows 1–3 workers.
* Experimental mode allows 4–6 workers.
* Experimental mode is disabled by default.
* Enabling experimental mode requires explicit confirmation.
* Doctor warns when experimental mode is enabled.
* Experimental 4–6 workers require:
  * one active plan only
  * no same-file overlap
  * no broad `canEdit` patterns
  * serialized commits
  * target command concurrency limit
  * archive enabled
  * queue stop-on-failure enabled
* Existing plan contracts with `maxParallelWorkspaces <= 3` remain valid.

**Acceptance Criteria:**
* Settings UI supports stable 1–3 workers.
* 4–6 workers cannot be selected unless experimental mode is enabled.
* Doctor warns on experimental worker mode.
* Queue runner refuses experimental worker mode if archive is disabled or queue stop-on-failure is disabled.
* Stable default remains 3 workers.

---

### 5.N — P5 Dogfood & Stability Report

**Goal:** Validate P5 with a real multi-plan dogfood run and publish stability findings.

**Requirements:**
* Create a safe dogfood batch with at least 3 plans.
* Plans must be docs/tests/minor config only.
* Queue all plans.
* Validate doctor/dry-run/archive/docs export/queue reorder/auto-run behavior.
* Validate one failed workspace retry path.
* Validate safety profile switching.
* Validate skill registry with at least one local dummy skill.
* Validate stable worker count 3.
* Optionally validate experimental 4-worker dry-run; do not require 6-worker success.
* Publish `docs/pi/stability/p5-stability-report.md`.

**Acceptance Criteria:**
* Multi-plan queue dogfood completes or produces documented failures.
* Archive exists for every plan.
* Docs export exists for completed plans.
* Stability report documents queue behavior, archive behavior, logs, worker transcript, skill resolver, safety profiles, and concurrency findings.
* No `git push` occurs.

---

## 8. Combined Implementation Order

```text
5.A → 5.B → 5.C
5.D → 5.E → 5.I
5.H → 5.F
5.K → 5.L
5.G after 5.C
5.J after 5.A + 5.H
5.M after 5.E + 5.K
5.N last
```

Rationale:

* `5.A` is foundational. Every later feature depends on durable artifacts and a predictable archive layout.
* `5.B` and `5.C` build the human-readable and UI-facing layers on top of the archive.
* `5.D`, `5.E`, and `5.I` form the policy and validation chain: skills, safety profiles, and production readiness checks.
* `5.H` establishes the log streams that `5.F` displays as live worker transcripts.
* `5.K` implements the backend queue runner, and `5.L` adds the interactive UI.
* `5.G` can start after artifact structure exists, because chat should reference runs/artifacts.
* `5.J` needs archive and logs to create reliable replay metadata.
* `5.M` depends on safety settings and queue runner gates because experimental concurrency is unsafe without them.
* `5.N` validates the whole system and must run last.

Parallelism guidance:

* `5.A` must start first.
* `5.B` and `5.D` can run in parallel after `5.A` scaffolding exists.
* `5.C`, `5.H`, and `5.K` can run in parallel if they do not touch the same dashboard files.
* `5.N` is strictly last.

---

## 9. Definition of Done

P5 is complete when ALL are true:

* [ ] Every plan run creates `.pi/executions/{planExecId}/`.
* [ ] Archive contains original plan, parsed contract, doctor report, DAG, safety snapshot, commits, and workspace artifacts.
* [ ] Docs export writes plan/execution summaries under `docs/pi/` when enabled.
* [ ] Dashboard has Artifacts tab for browsing generated artifacts.
* [ ] Dashboard has Skills tab and local skill registry works.
* [ ] Project settings expose Strict/Balanced/Full Auto safety profiles.
* [ ] `git push` and `rm -rf` remain blocked in all safety profiles.
* [ ] WorkerDetail shows live worker transcript with action and decision summaries.
* [ ] Logs are separated into raw, structured, narrative, audit, and decision streams.
* [ ] Chat is available as a project-level tab.
* [ ] Production readiness doctor reports PASS/WARN/FAIL.
* [ ] Failed workspace retry/replay metadata is available.
* [ ] Multiple plans can be uploaded into a project queue.
* [ ] Queue items can be reordered interactively before running.
* [ ] Queue runner executes one active plan at a time.
* [ ] Queue runner only starts next plan after commit/handoff/archive/docs/clean-tree gates pass.
* [ ] Stable worker setting remains 1–3.
* [ ] Experimental 4–6 worker setting is disabled by default and doctor-warned.
* [ ] P5 dogfood batch validates archive, docs export, queue, skills, safety profiles, transcripts, logs, and replay metadata.
* [ ] TypeScript compiles cleanly.
* [ ] P4 behavior remains backward compatible.

---

## 10. Rollback Playbook

**Trigger conditions:**
* Queue runner starts a new plan on dirty working tree.
* Queue runner starts more than one active plan for the same project.
* Archive writer copies or exposes forbidden files.
* Skill resolver executes untrusted or unapproved skill code.
* Safety profile permits `git push`, raw `rm -rf`, secrets access, or forbidden file edits.
* Experimental worker mode causes commit or state corruption.
* Dashboard queue reorder corrupts queue state.

**Rollback procedure:**
1. Disable queue auto-run in project settings.
2. Set `activePlanConcurrency` to `1` and `maxParallelWorkspaces` to `3`.
3. Disable experimental worker mode.
4. Disable docs export if generated docs are noisy or incorrect.
5. Disable skill auto-resolution and use manual workspace execution.
6. Fall back to P4 single-plan run flow.
7. Preserve `.pi/executions/` for debugging unless it contains sensitive data.
8. Revert P5 workstream commits independently if needed.

**Runtime cleanup:**

```text
.pi/plan-queue/       can be deleted to clear queued plans
.pi/executions/       can be archived or deleted after review
docs/pi/              generated docs can be reverted via git
```

---

## 11. What Phase P6 Inherits

P6 inherits:

* Durable execution archive / Plan Vault
* Docs export / Project Memory
* Artifact Browser
* Local Skill Registry and Skill Resolver v1
* Safety Profiles in Settings
* Live Worker Transcript
* Logs v2 streams
* Production Readiness Doctor
* Replay / Resume / Retry metadata
* Multi-Plan Queue Runner
* Interactive Plan Queue UI
* Stable worker settings and experimental concurrency gate

P6 may add:

* Git worktree isolation per workspace
* Merge queue / integration branch
* Dynamic scheduler beyond 3 workers
* Safe 6+ worker production mode
* Test impact analysis
* Repo symbol graph and ownership map
* Cross-plan dependency detection
* Smarter conflict prediction

---

# Part 2 — Agent Brief

## Mission

Implement P5 — Production Operating Layer, Project Memory & Multi-Plan Queue.

You are upgrading Pi from a single-plan autonomous executor into a project-level automation runner. Your job is to make plan execution durable, auditable, queueable, skill-aware, configurable, and understandable in real time.

P5 must preserve all P1–P4 safety guarantees. Do not trade reliability for speed. Stable execution remains one active plan per project and up to 3 workers per active plan. Experimental 4–6 worker mode may be exposed only behind explicit settings and doctor warnings.

---

## Hard Requirements

1. `autoPush` must remain `false` in every code path.
2. `git push` must remain forbidden in every safety profile.
3. Raw `rm -rf` must remain forbidden in every safety profile.
4. Queue runner must run only one active plan per project in P5.
5. Queue runner must not start next plan unless working tree is clean.
6. Queue runner must not start next plan until current plan handoff is resolved.
7. Queue runner must stop on plan failure by default.
8. Stable worker count remains 1–3.
9. Experimental 4–6 worker mode must be disabled by default and doctor-warned.
10. Execution archive must never copy forbidden files or secrets.
11. Skill auto-fetch from remote registries must be disabled by default.
12. Required skills must be validated before execution.
13. Live worker transcript must not expose raw private chain-of-thought.
14. Docs export must write only under `docs/pi/`.
15. Dashboard must not directly mutate workspace execution state.
16. All new state mutations must go through queue/control/executor APIs.
17. P4 single-plan execution must remain backward compatible.
18. TypeScript strict mode: no new `as any`, `@ts-ignore`, or `@ts-expect-error`.
19. No new npm dependencies without explicit approval.
20. No product application source changes outside Pi runtime/dashboard/docs.

---

## Execution Policies

```yaml
stable_default_workers: 3
stable_hard_cap_workers: 3
experimental_workers_enabled_by_default: false
experimental_worker_range: [4, 6]
same_file_parallelism: false
active_plan_concurrency_per_project: 1
queue_auto_run_enabled_by_default: false
queue_stop_on_failure_default: true
require_clean_working_tree_before_next_plan: true
require_handoff_between_plans: true
auto_commit: true
auto_push: false
docs_export_enabled_by_default: true
skill_remote_fetch_enabled_by_default: false
safety_profile_default: strict
```

---

## Safety Stops

Hard stop execution only for:

* secrets or env file access
* forbidden file edits
* raw destructive commands
* `git push` or remote git writes
* unresolved plan placeholders
* invalid Part 3 JSON contract
* dependency cycles
* budget violations
* missing required skills
* dirty working tree before queued next plan
* archive path escaping `.pi/executions/`
* docs export path escaping `docs/pi/`
* queue corruption or duplicate active plan
* experimental worker mode without explicit enablement

---

# Part 3 — Machine-Readable Execution Contract

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "json",
  "project": {
    "name": "pi-mono",
    "rootPath": "/Users/hootie/src/pi",
    "type": "repo",
    "tags": [
      "p5",
      "production-operating-layer",
      "project-memory",
      "multi-plan-queue",
      "skills",
      "safety-profiles"
    ]
  },
  "planExecution": {
    "phase": "P5",
    "title": "Production Operating Layer, Project Memory & Multi-Plan Queue",
    "mode": "autonomous",
    "maxParallelWorkspaces": 3,
    "stateBackend": "json",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": true,
    "autoPush": false,
    "postPlanHandoff": true,
    "queueEnabled": true,
    "queueAutoRun": false,
    "activePlanConcurrency": 1,
    "defaultRetryPolicy": {
      "flashEscalationAttempt": 4,
      "reviewerEscalationAttempt": 7
    },
    "docsExport": {
      "enabled": true,
      "root": "docs/pi"
    },
    "executionArchive": {
      "enabled": true,
      "root": ".pi/executions"
    },
    "skills": {
      "enabled": true,
      "localRegistryRoot": ".pi/skills",
      "remoteFetchEnabled": false
    },
    "safetyProfile": "strict",
    "experimentalConcurrency": {
      "enabled": false,
      "maxParallelWorkspaces": 6
    }
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "paused_or_stopped_only",
    "allowQueuePause": true,
    "allowQueueResume": true,
    "allowStopAfterCurrentPlan": true,
    "allowQueueReorder": true
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "budget_violations",
      "dependency_cycles",
      "git_push",
      "dirty_working_tree_before_next_plan",
      "missing_required_skills",
      "archive_path_escape",
      "docs_export_path_escape",
      "duplicate_active_plan"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf",
      "npm publish",
      "terraform destroy",
      "kubectl delete",
      "git reset --hard",
      "git clean -fd"
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
    "safetyProfiles": {
      "strict": {
        "queueAutoRunAllowed": false,
        "dependencyInstallAllowed": false,
        "handoffRequired": true,
        "autoCommitAllowed": false,
        "experimentalConcurrencyAllowed": false
      },
      "balanced": {
        "queueAutoRunAllowed": true,
        "dependencyInstallAllowed": "approval_required",
        "handoffRequired": true,
        "autoCommitAllowed": true,
        "experimentalConcurrencyAllowed": false
      },
      "full_auto": {
        "queueAutoRunAllowed": true,
        "dependencyInstallAllowed": "approval_required",
        "handoffRequired": false,
        "autoCommitAllowed": true,
        "experimentalConcurrencyAllowed": true,
        "stillForbidden": [
          "git push",
          "rm -rf",
          "secrets",
          "forbidden_files"
        ]
      }
    }
  },
  "workspaces": [
    {
      "id": "5.A",
      "title": "Execution Archive / Plan Vault",
      "dependencies": [],
      "allowedFiles": [
        "packages/web-server/src/execution-archive.ts",
        "packages/web-server/src/plan-runner.ts",
        "packages/coding-agent/src/state-store.ts",
        "packages/coding-agent/src/json-state-store.ts",
        "packages/web-server/test/execution-archive.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        ".pi/executions/{planExecId}/ created at plan start",
        "original plan, parsed contract, doctor report, DAG, safety policy, commit map archived",
        "per-workspace archive folders created",
        "workspace archive contains packet, events, tool calls, files touched, verdict, diff when available",
        "archive writer never copies forbidden files",
        "TypeScript compiles cleanly"
      ],
      "targetCommand": "npm run typecheck && npm test -- execution-archive",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/execution-archive.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/coding-agent/src/state-store.ts",
          "packages/coding-agent/src/json-state-store.ts",
          "packages/web-server/test/execution-archive.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "archive_written"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.B",
      "title": "Docs Export & Project Memory",
      "dependencies": [
        "5.A"
      ],
      "allowedFiles": [
        "packages/web-server/src/docs-export.ts",
        "packages/web-server/src/plan-runner.ts",
        "packages/web-server/test/docs-export.test.ts",
        "docs/pi/README.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "docs/pi/plans and docs/pi/executions created when docs export is enabled",
        "completed plan exports summary markdown",
        "summary includes workspace results, commits, tests, safety warnings, follow-ups",
        "docs export never writes outside docs/pi",
        "docs export can be disabled"
      ],
      "targetCommand": "npm run typecheck && npm test -- docs-export",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/docs-export.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/web-server/test/docs-export.test.ts",
          "docs/pi/README.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "docs_exported"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.C",
      "title": "Artifact Browser UI",
      "dependencies": [
        "5.A",
        "5.B"
      ],
      "allowedFiles": [
        "packages/web-server/src/index.ts",
        "packages/web-server/src/artifact-routes.ts",
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/ArtifactBrowser.tsx",
        "packages/web-ui/dashboard/src/hooks/useArtifacts.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Artifacts tab added to dashboard",
        "artifact tree lists generated run artifacts",
        "workspace packet, final summary, diff patch, and tool-call log can be opened",
        "large artifacts are truncated safely",
        "artifact browser cannot browse arbitrary repo files"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/index.ts",
          "packages/web-server/src/artifact-routes.ts",
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/ArtifactBrowser.tsx",
          "packages/web-ui/dashboard/src/hooks/useArtifacts.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
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
      "id": "5.D",
      "title": "Skill Registry & Skill Resolver v1",
      "dependencies": [
        "5.A"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/skills/skill-registry.ts",
        "packages/coding-agent/src/skills/skill-resolver.ts",
        "packages/coding-agent/src/skills/skill-manifest.ts",
        "packages/coding-agent/test/skill-registry.test.ts",
        "packages/web-ui/dashboard/src/components/SkillsTab.tsx",
        "packages/web-ui/dashboard/src/hooks/useSkills.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "local skill manifest format defined",
        "SkillRegistry lists and validates local skills",
        "SkillResolver recommends skills for workspaces",
        "required missing skills fail doctor",
        "remote skill fetch disabled by default",
        "Skills tab lists local skills"
      ],
      "targetCommand": "npm run typecheck && npm test -- skill-registry",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/skills/**",
          "packages/coding-agent/test/skill-registry.test.ts",
          "packages/web-ui/dashboard/src/components/SkillsTab.tsx",
          "packages/web-ui/dashboard/src/hooks/useSkills.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "skills_resolved"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.E",
      "title": "Safety Profiles & Settings",
      "dependencies": [
        "5.D"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/safety/safety-profiles.ts",
        "packages/web-server/src/settings-routes.ts",
        "packages/web-server/src/state-store-provider.ts",
        "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
        "packages/web-ui/dashboard/src/hooks/useSettings.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Strict/Balanced/Full Auto profiles implemented",
        "Strict is default",
        "git push and rm -rf blocked in all profiles",
        "Full Auto requires explicit confirmation",
        "Settings UI displays effective permissions",
        "doctor reports plan/profile conflicts"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/safety/safety-profiles.ts",
          "packages/web-server/src/settings-routes.ts",
          "packages/web-server/src/state-store-provider.ts",
          "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
          "packages/web-ui/dashboard/src/hooks/useSettings.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "safety_profile_updated"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.F",
      "title": "Live Worker Transcript",
      "dependencies": [
        "5.H"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/workspace-agent-executor.ts",
        "packages/coding-agent/src/worker-transcript.ts",
        "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
        "packages/web-ui/dashboard/src/components/WorkerTranscript.tsx",
        "packages/web-ui/dashboard/src/hooks/useWorkerTranscript.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "worker_status and worker_decision_summary events emitted",
        "WorkerDetail shows live transcript timeline",
        "validation and blocker events visible",
        "transcript archived to decisions/events ndjson",
        "raw private chain-of-thought is never emitted"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/workspace-agent-executor.ts",
          "packages/coding-agent/src/worker-transcript.ts",
          "packages/web-ui/dashboard/src/components/WorkerDetail.tsx",
          "packages/web-ui/dashboard/src/components/WorkerTranscript.tsx",
          "packages/web-ui/dashboard/src/hooks/useWorkerTranscript.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "worker_status",
          "worker_decision_summary",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.G",
      "title": "Chat as Project Tab",
      "dependencies": [
        "5.C"
      ],
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/ProjectChatTab.tsx",
        "packages/web-ui/dashboard/src/hooks/useProjectChat.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Project Chat tab added",
        "chat can reference selected plan/run/workspace/artifact",
        "quick actions added for summarize run, explain failure, generate follow-up plan",
        "right sidebar reserved for event feed and alerts",
        "chat does not directly mutate execution state"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/ProjectChatTab.tsx",
          "packages/web-ui/dashboard/src/hooks/useProjectChat.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/coding-agent/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
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
      "id": "5.H",
      "title": "Logs v2: Narrative, Audit, Decision Streams",
      "dependencies": [
        "5.A"
      ],
      "allowedFiles": [
        "packages/web-server/src/pi-logger.ts",
        "packages/coding-agent/src/log-streams.ts",
        "packages/coding-agent/src/json-state-store.ts",
        "packages/web-ui/dashboard/src/components/LogsTab.tsx",
        "packages/web-ui/dashboard/src/hooks/useLogStreams.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "raw, structured, narrative, audit, decision log streams implemented",
        "dashboard log filters added",
        "queue reorder and safety changes appear in audit log",
        "worker summaries appear in narrative/decision logs",
        "P4 log batching preserved"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/pi-logger.ts",
          "packages/coding-agent/src/log-streams.ts",
          "packages/coding-agent/src/json-state-store.ts",
          "packages/web-ui/dashboard/src/components/LogsTab.tsx",
          "packages/web-ui/dashboard/src/hooks/useLogStreams.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "audit_log_written"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.I",
      "title": "Production Readiness Doctor",
      "dependencies": [
        "5.D",
        "5.E"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/cli/plan-doctor.ts",
        "packages/coding-agent/src/doctor/production-readiness-doctor.ts",
        "packages/coding-agent/test/production-readiness-doctor.test.ts",
        "packages/web-ui/dashboard/src/components/DoctorReport.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "doctor reports PASS/WARN/FAIL production readiness",
        "missing required skill fails doctor",
        "broad file scopes warn",
        "dirty working tree fails queue auto-run readiness",
        "doctor report archived and shown in dashboard"
      ],
      "targetCommand": "npm run typecheck && npm test -- production-readiness-doctor",
      "roleBudget": "reviewer",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/cli/plan-doctor.ts",
          "packages/coding-agent/src/doctor/production-readiness-doctor.ts",
          "packages/coding-agent/test/production-readiness-doctor.test.ts",
          "packages/web-ui/dashboard/src/components/DoctorReport.tsx"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "doctor_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.J",
      "title": "Replay / Resume / Retry Metadata",
      "dependencies": [
        "5.A",
        "5.H"
      ],
      "allowedFiles": [
        "packages/web-server/src/replay-routes.ts",
        "packages/coding-agent/src/replay/replay-manifest.ts",
        "packages/coding-agent/src/cli/plan-replay.ts",
        "packages/web-ui/dashboard/src/components/ReplayPanel.tsx",
        "packages/web-ui/dashboard/src/hooks/useReplay.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "replay-manifest.json written per plan",
        "workspace-replay.json written per workspace",
        "failed workspace can be retried from dashboard or CLI",
        "dry-run replay reads archive without modifying files",
        "retry blocked on dirty working tree or safety conflict"
      ],
      "targetCommand": "npm run typecheck && npm test -- replay",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/replay-routes.ts",
          "packages/coding-agent/src/replay/**",
          "packages/coding-agent/src/cli/plan-replay.ts",
          "packages/web-ui/dashboard/src/components/ReplayPanel.tsx",
          "packages/web-ui/dashboard/src/hooks/useReplay.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "replay_manifest_written"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.K",
      "title": "Multi-Plan Queue Runner",
      "dependencies": [
        "5.A",
        "5.B",
        "5.I"
      ],
      "allowedFiles": [
        "packages/web-server/src/plan-queue-runner.ts",
        "packages/web-server/src/plan-queue-store.ts",
        "packages/web-server/src/plan-runner.ts",
        "packages/web-server/src/index.ts",
        "packages/web-server/test/plan-queue-runner.test.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "multiple plans can be queued",
        "only one active plan per project runs in P5",
        "queue runner starts next ready plan only after current plan gates pass",
        "dirty working tree prevents next plan start",
        "failed plan stops queue by default",
        "queue state survives restart"
      ],
      "targetCommand": "npm run typecheck && npm test -- plan-queue-runner",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-server/src/plan-queue-runner.ts",
          "packages/web-server/src/plan-queue-store.ts",
          "packages/web-server/src/plan-runner.ts",
          "packages/web-server/src/index.ts",
          "packages/web-server/test/plan-queue-runner.test.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/web-ui/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm test",
          "git status"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "plan_queued",
          "queue_started",
          "queue_stopped"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.L",
      "title": "Interactive Plan Queue UI",
      "dependencies": [
        "5.K"
      ],
      "allowedFiles": [
        "packages/web-ui/dashboard/src/App.tsx",
        "packages/web-ui/dashboard/src/components/PlanQueueTab.tsx",
        "packages/web-ui/dashboard/src/components/PlanQueueItem.tsx",
        "packages/web-ui/dashboard/src/hooks/usePlanQueue.ts"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "Plan Queue tab added",
        "multi-plan upload supported",
        "queued plans can be reordered interactively",
        "active/running plan cannot be moved",
        "run next, pause, resume, stop-after-current, skip, remove, move-to-top controls work",
        "reorder/skip/remove actions emit audit logs"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "packages/web-ui/dashboard/src/App.tsx",
          "packages/web-ui/dashboard/src/components/PlanQueueTab.tsx",
          "packages/web-ui/dashboard/src/components/PlanQueueItem.tsx",
          "packages/web-ui/dashboard/src/hooks/usePlanQueue.ts"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/coding-agent/**"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "queue_reordered"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.M",
      "title": "Worker Concurrency Settings & Experimental 6-Worker Mode",
      "dependencies": [
        "5.E",
        "5.K"
      ],
      "allowedFiles": [
        "packages/coding-agent/src/scheduler/concurrency-policy.ts",
        "packages/coding-agent/src/doctor/production-readiness-doctor.ts",
        "packages/web-server/src/settings-routes.ts",
        "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
        "packages/web-ui/dashboard/src/components/ConcurrencySettings.tsx"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key"
      ],
      "acceptanceCriteria": [
        "stable worker setting supports 1-3",
        "experimental 4-6 workers disabled by default",
        "explicit confirmation required to enable experimental mode",
        "doctor warns when experimental mode is enabled",
        "experimental mode requires archive enabled and stop-on-failure enabled",
        "stable default remains 3 workers"
      ],
      "targetCommand": "npm run typecheck && npm run build",
      "roleBudget": "lead",
      "maxRetries": 3,
      "riskLevel": "high",
      "capabilityManifest": {
        "canEdit": [
          "packages/coding-agent/src/scheduler/concurrency-policy.ts",
          "packages/coding-agent/src/doctor/production-readiness-doctor.ts",
          "packages/web-server/src/settings-routes.ts",
          "packages/web-ui/dashboard/src/components/SettingsDialog.tsx",
          "packages/web-ui/dashboard/src/components/ConcurrencySettings.tsx"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key"
        ],
        "canRun": [
          "npm run typecheck",
          "npm run build"
        ],
        "cannotRun": [
          "git push",
          "rm -rf",
          "npm publish"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed",
          "concurrency_policy_updated"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "5.N",
      "title": "P5 Dogfood & Stability Report",
      "dependencies": [
        "5.A",
        "5.B",
        "5.C",
        "5.D",
        "5.E",
        "5.F",
        "5.G",
        "5.H",
        "5.I",
        "5.J",
        "5.K",
        "5.L",
        "5.M"
      ],
      "allowedFiles": [
        "docs/pi/stability/p5-stability-report.md",
        "docs/pi/plans/p5-dogfood-batch.md",
        "docs/pi/executions/p5-dogfood-summary.md"
      ],
      "forbiddenFiles": [
        ".env*",
        "**/*.pem",
        "**/*.key",
        "packages/**/src/**"
      ],
      "acceptanceCriteria": [
        "safe multi-plan dogfood batch created",
        "queue behavior validated",
        "archive exists for every dogfood plan",
        "docs export exists for completed plans",
        "skill resolver validated with local dummy skill",
        "safety profiles validated",
        "failed workspace retry path validated",
        "stability report published",
        "no git push occurs"
      ],
      "targetCommand": "npm run typecheck && git status",
      "roleBudget": "reviewer",
      "maxRetries": 1,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "docs/pi/stability/p5-stability-report.md",
          "docs/pi/plans/p5-dogfood-batch.md",
          "docs/pi/executions/p5-dogfood-summary.md"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "**/*.key",
          "packages/**/src/**"
        ],
        "canRun": [
          "npm run typecheck",
          "git status"
        ],
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

# Part 4 — Machine-Readable Summary

```json
{
  "contractVersion": "2.1.0",
  "phase": "P5",
  "title": "Production Operating Layer, Project Memory & Multi-Plan Queue",
  "primaryGoal": "Turn Pi into a project-level automation runner with durable execution archives, project memory, skill resolution, safety profiles, live worker transcripts, and sequential multi-plan queue execution.",
  "projectName": "pi-mono",
  "stateBackend": "json",
  "notInScope": [
    "git worktree isolation per workspace",
    "merge queue or integration branch workflow",
    "safe production 6+ worker default",
    "parallel active plans in the same project",
    "remote git push or PR creation",
    "remote skill marketplace",
    "full semantic repo index",
    "test impact analysis v2",
    "cross-plan dependency resolver",
    "enterprise approval engine"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations",
    "dependency_cycles",
    "git_push",
    "dirty_working_tree_before_next_plan",
    "missing_required_skills",
    "archive_path_escape",
    "docs_export_path_escape",
    "duplicate_active_plan"
  ],
  "completionGate": "P5 is complete when every run is archived, docs export works, artifacts are browsable, local skills resolve, safety profiles are configurable, workers stream live action summaries, logs are separated by stream, chat is project-level, failed workspaces have replay metadata, multiple plans can be queued/reordered/executed sequentially, and experimental 4-6 worker mode is gated behind explicit settings and doctor warnings.",
  "nextPhase": "P6"
}
```


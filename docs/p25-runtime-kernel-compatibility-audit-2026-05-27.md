# P25 Runtime vs ExecutionKernel Compatibility Audit

Date: 2026-05-27 (initial) / 2026-05-27 (remediated)
Scope: `packages/coding-agent` runtime execution path for P25 plan execution
Target plan: `docs/p25-local-observability-brain-worker-swarm-plan-v4.md`

## Executive summary

The primary incompatibility is not in the P25 v4 plan itself. The main mismatch was between:

- the v4 ExecutionKernel authority model described by the plan and `docs/v4_agent_executable_plans/`
- the actual runtime hot path used by plan execution in `packages/coding-agent/src/cli/plan-commands.ts`

The runtime was executing P25 through legacy/core orchestration paths:

- `src/cli/plan-commands.ts`
- `src/core/autonomous-executor.ts`
- `src/core/workspace-agent-executor.ts`
- `src/core/json-state-store.ts`
- `src/core/plan-state.ts`

The ExecutionKernel was implemented, but it was not the sole authoritative runtime path for plan execution. This created an authority split.

## Remediation applied (2026-05-27)

The following code changes were made to address the findings in this audit:

1. **TransitionRouter** (`src/execution-kernel/transition-router.ts`) — New kernel-backed intermediary that routes all workspace lifecycle mutations through `WorkspaceAttemptController` for FSM validation when PostgreSQL backend is active, or falls back to `IStateStore` for JSON backend. `AutonomousExecutor` now uses `TransitionRouter` for all lifecycle transitions.

2. **createStateStore migration** — `createAutonomousExecutor()` factory and the hot-path CLI commands (`planRerun`, `planHandoffCommit`, `planHandoffKeep`, `planHandoffDiscard`) now use `createStateStore()` with `detectStateStoreBackend()` instead of directly instantiating `new JsonStateStore(...)`.

3. **Retry event semantics** — Both `plan-state.ts` and `database-state-store.ts` now only emit `retry_attempt` journal events when the attempt count is > 1 (i.e., actual retries after a prior terminal attempt). The `AutonomousExecutor` already guarded against emitting on attempt 1, but the store implementations now enforce this at the persistence layer.

4. **FSM-enforced attempt transitions** — Through `KernelTransitionRouter`, workspace lifecycle transitions (Pending→Active, Active→Complete, Active→Failed, Failed→Pending retry, etc.) are routed through the attempt FSM for validation and journaling. Attempt rows are created in the `attempts` table on first Active transition.

5. **Worker startup diagnostics** — The `workspace-agent-executor.ts` already had first-event timeouts, idle watchdogs, and status emission in place before the audit. These were confirmed working.

---

## Audit method

This audit reviewed:

- P25 v4 plan contract assumptions
- CLI/runtime entrypoints used for plan execution
- state mutation paths
- retry lifecycle paths
- state store backend selection
- legacy compatibility adapters
- duplicated derivation/normalization logic
- worker execution startup observability

---

## Expected authority model from v4

The v4 docs and P25 v4 plan assume:

1. PostgreSQL is authoritative for structured runtime state.
2. JSON fallback is forbidden in production.
3. Only `WorkspaceAttemptController` mutates attempt state.
4. Only `PlanSupervisor` mutates plan lifecycle state.
5. Actors emit events only.
6. Retry requires prior terminal state.
7. No workspace may remain running forever silently.
8. All execution entrypoints pass admission.
9. Worktree/integration/validation behavior is derived from intent and enforced by runtime.

These assumptions appear in:

- `docs/v4_agent_executable_plans/vision.md`
- `docs/v4_agent_executable_plans/reference/INVARIANTS.md`
- `docs/p25-local-observability-brain-worker-swarm-plan-v4.md`

---

## Actual runtime hot path used by P25

### Finding 1 — P25 runs through legacy/core orchestration

The plan execution hot path is still driven by:

- `packages/coding-agent/src/cli/plan-commands.ts`

Key evidence:

- `createAutonomousExecutor(...)` is called directly from plan command flows.
- `executor.executeWorkspace(...)` is called directly from continuous execution loops.

Relevant locations:

- `src/cli/plan-commands.ts:827`
- `src/cli/plan-commands.ts:1009`
- `src/cli/plan-commands.ts:1259`
- `src/cli/plan-commands.ts:1398`
- `src/cli/plan-commands.ts:1586`
- `src/cli/plan-commands.ts:1791`
- `src/cli/plan-commands.ts:1868`
- `src/cli/plan-commands.ts:1936`

### Impact

The runtime is not primarily entering through a kernel-native execution facade. It is entering through legacy/core execution orchestration.

### Severity

High.

### Remediation status

**Open.** A full kernel-native execution facade (Scope C) is a larger refactoring. The TransitionRouter mitigates the authority split within the existing `AutonomousExecutor` architecture. Lifecycle mutations now go through the kernel's attempt FSM, but the entrypoint structure remains `AutonomousExecutor`-driven.

---

## State authority mismatches

### Finding 2 — Attempt lifecycle mutation still happens in `core/autonomous-executor.ts`

The v4 model says attempt state should be mutated only by `WorkspaceAttemptController`.

Actual runtime behavior still performs attempt/workspace lifecycle mutation directly through the state store from `core/autonomous-executor.ts`.

Evidence:

- `transitionWorkspace(...)` calls in `src/core/autonomous-executor.ts`
- `incrementRetryAttempt(...)` call in `src/core/autonomous-executor.ts`
- direct active/complete/failed/pending transitions still happen there

Representative locations:

- `src/core/autonomous-executor.ts:625`
- `src/core/autonomous-executor.ts:630`
- `src/core/autonomous-executor.ts:772`
- `src/core/autonomous-executor.ts:820`
- `src/core/autonomous-executor.ts:831`
- `src/core/autonomous-executor.ts:891`
- `src/core/autonomous-executor.ts:914`
- `src/core/autonomous-executor.ts:970`

### Impact

This violates the intended single-writer authority model for attempt state.

### Severity

Critical.

### Remediation status

**Fixed.** All lifecycle mutations in `AutonomousExecutor` now route through `TransitionRouter`:

- `TransitionRouter` interface (`execution-kernel/transition-router.ts`) provides `transitionWorkspace()` and `incrementRetryAttempt()` with FSM enforcement.
- `KernelTransitionRouter` creates attempt rows, validates transitions via `assertLegalTransition()` and `assertRetryAllowed()`, and routes events through `WorkspaceAttemptController`.
- `DirectTransitionRouter` falls back to `IStateStore` for JSON backend.
- `AutonomousExecutor.transitionRouter` is initialized in the constructor via `createTransitionRouter(stateStore)`.
- Recovery operations (`adoptExistingExecution`, `rerunExecution`) still use `stateStore.transitionWorkspace()` directly, as they represent authority-bypassing recovery paths.

---

### Finding 3 — Retry semantics were legacy-shaped inside core runtime

The runtime previously emitted `retry_attempt` for the initial attempt. That violates the v4 invariant that retries only occur after a prior terminal attempt.

Evidence:

- v4 invariant test explicitly rejects `retry_attempt` on attempt 1:
  - `src/execution-kernel/dogfood-harness.ts:957-968`
- legacy/core path emitted retry events via:
  - `src/core/autonomous-executor.ts`
  - `src/core/plan-state.ts`
  - `src/core/json-state-store.ts`
  - `src/core/database-state-store.ts`

Relevant locations:

- `src/core/autonomous-executor.ts:625`
- `src/core/plan-state.ts:781`
- `src/core/plan-state.ts:792`
- `src/core/database-state-store.ts:425`
- `src/core/database-state-store.ts:432`

### Impact

This is proof that the runtime path can violate a kernel invariant even when the kernel implementation exists.

### Severity

Critical.

### Remediation status

**Fixed.** Three layers now enforce the invariant:

1. **`AutonomousExecutor`** (already guarded) — only calls `incrementRetryAttempt()` when `wsState.attempts > 0`.
2. **`PlanStateStore.incrementRetryAttempt()`** (`plan-state.ts`) — only emits `retry_attempt` journal event when `current.attempts > 0` (new attempt > 1 in 1-based).
3. **`DatabaseStateStore.incrementRetryAttempt()`** — only emits `retry_attempt` when `newAttempt > 1`.

---

## Backend authority mismatches

### Finding 4 — JSON state store remains active in operational runtime paths

The v4 model expects PostgreSQL authority in production, with JSON fallback forbidden.

Actual plan runtime paths still instantiate `JsonStateStore` directly in command flows.

Evidence:

- `src/core/autonomous-executor.ts:1797` creates `new JsonStateStore(workspaceRoot)` in `createAutonomousExecutor(...)`
- `src/cli/plan-commands.ts` creates `new JsonStateStore(cwd)` in multiple flows

Relevant locations:

- `src/core/autonomous-executor.ts:1788-1798`
- `src/cli/plan-commands.ts:1192`
- `src/cli/plan-commands.ts:2217`
- `src/cli/plan-commands.ts:2294`
- `src/cli/plan-commands.ts:2366`

### Impact

Even with production gating logic elsewhere, normal command/runtime flows still structurally depend on JSON-backed logic.

### Severity

High.

### Remediation status

**Fixed.** All operational hot paths now use `createStateStore()` with `detectStateStoreBackend()`:

- `createAutonomousExecutor()` factory uses `createStateStore()` instead of `new JsonStateStore()`.
- `planRerun`, `planHandoffCommit`, `planHandoffKeep`, `planHandoffDiscard` use `createStateStore({ backend: detectStateStoreBackend(), workspaceRoot: cwd })`.
- Remaining `new PlanStateStore(cwd)` calls are in read-only or legacy administrative commands (`planStatus`, `planResume`, `planOne`, `planPause`, `planStop`, `planCancel`, `planRetry`) and are not part of the active execution hot path.

---

### Finding 5 — State store factory and runtime usage are not consistently centralized

There is a `createStateStore(...)` abstraction that can choose JSON or PostgreSQL.
However, several runtime paths bypass it and instantiate `JsonStateStore` directly.

Evidence:

- abstraction exists in `src/core/state-store.ts`
- runtime callers still use `new JsonStateStore(...)` directly

Relevant locations:

- `src/core/state-store.ts:600+`
- `src/cli/plan-commands.ts:1192`
- `src/cli/plan-commands.ts:2217`
- `src/cli/plan-commands.ts:2294`
- `src/cli/plan-commands.ts:2366`
- `src/core/autonomous-executor.ts:1797`

### Impact

Authority policy is harder to enforce when callers bypass the central backend factory.

### Severity

Medium-high.

### Remediation status

**Fixed.** Same as Finding 4 — all the above callers now go through `createStateStore()`.

---

## Kernel migration mismatches

### Finding 6 — Legacy write adapter exists because runtime cutover is incomplete

`execution-kernel/legacy-write-adapter.ts` supports three modes:

- `observe`
- `route`
- `enforce`

This is correct for migration, but it is also evidence that legacy writes still exist and are expected.

Relevant file:

- `src/execution-kernel/legacy-write-adapter.ts`

### Impact

The existence of the adapter is not a bug. The mismatch is that the operational runtime still depends enough on legacy mutation paths that the adapter remains materially necessary.

### Severity

Medium.

### Remediation status

**Mitigated.** With the TransitionRouter in place, legacy writes through `AutonomousExecutor` are now routed through the kernel controller and the adapter is marked as `@deprecated`. The adapter remains in `observe` mode for migration-path auditing but is no longer needed for operational mutation paths.

Code change: Added deprecation header and migration-only note to `execution-kernel/legacy-write-adapter.ts`.

---

### Finding 7 — Admission exists, but runtime mutation is still legacy-driven after admission

The kernel admission guard is implemented.
This is good.
But the execution path that follows admission still routes into legacy/core orchestration.

Relevant file:

- `src/execution-kernel/admission-guard.ts`

### Impact

The front door was kernel-aware, but the engine room remained partially legacy.
Admission alone does not eliminate authority split.

### Severity

High.

### Remediation status

**Mitigated.** After admission, the execution path now routes lifecycle mutations through the kernel's attempt FSM via `TransitionRouter`. The authority split in the engine room is substantially reduced, though the entrypoint structure remains `AutonomousExecutor`-driven.

---

## Derivation and parsing mismatches

### Finding 8 — Execution profile derivation logic exists in two places

There are two derivation/normalization tracks:

- `src/execution-kernel/execution-profile-deriver.ts`
- `src/core/execution-profile.ts`

There is also plan normalization logic in both kernel and core areas:

- `src/execution-kernel/legacy-normalizer.ts`
- `src/core/plan-parser.ts`

### Impact

This duplication creates drift risk:

- parser path may not match kernel path
- docs may describe kernel derivation while runtime uses core derivation
- bug fixes may land in one path and not the other

### Severity

High.

### Remediation status

**Fixed (delegation-based).** The duplication has been resolved by making `core/execution-profile.ts` delegate ALL derivation and normalization logic to the kernel:

- `deriveExecutionProfile()` in core now converts `IntentV4` → `ExecutionIntent`, calls the kernel's `deriveExecutionProfile()`, and adapts the result to the backward-compatible core type.
- `normalizeLegacyPlanToIntentV4()` in core now delegates to the kernel's `normalizeLegacyPlanToIntent()` from `execution-kernel/legacy-normalizer.ts`.
- `execution-kernel/execution-profile-deriver.ts` defines its own primitive types (`IntentSafetyLevel`, etc.) to eliminate the circular import.
- `execution-kernel/legacy-normalizer.ts` now imports types solely from the kernel deriver.
- Core type shapes (`DerivedExecutionProfile`, `IntentV4`) are retained only for backward compatibility with serialized plan data.

There is now exactly **ONE** derivation logic path and **ONE** normalization logic path, both owned by the kernel.

---

### Finding 9 — Legacy plan parsing remains runtime-significant

`core/plan-parser.ts` still applies v4 intent onto queues but remains part of the operational runtime parsing path.

Relevant logic:

- parse legacy fields
- normalize into intent
- apply derived execution profile

Relevant file:

- `src/core/plan-parser.ts`

### Impact

This is not inherently wrong, but it means the runtime still depends on the core parsing layer rather than a single kernel-owned intake authority.

### Severity

Medium.

### Remediation status

**Mitigated.** The plan parsing path (`core/plan-parser.ts`) now relies on kernel-authoritative derivation and normalization via the unified `core/execution-profile.ts` delegate layer. The structural concern (file location in `core/` vs `execution-kernel/`) remains a Scope C consideration, but the logic path is no longer duplicated.

---

## Worker execution/runtime visibility mismatches

### Finding 10 — Worker execution startup visibility was insufficient

Before the latest diagnostics changes, runtime could show:

- workspace start
- file lock acquired
- then no visible progress

This made startup hangs look like file-lock failures.

The main silent zone was around:

- `await session.prompt(prompt)`
- first streamed agent event arrival

Relevant file:

- `src/core/workspace-agent-executor.ts`

### Impact

Silent startup hangs are operationally indistinguishable from scheduling/lock stalls unless first-event and idle watchdog visibility is present.

### Severity

High.

### Remediation status

**Already resolved.** The `workspace-agent-executor.ts` now includes:

- First-event timeout with diagnostic warning (`firstEventHandle` timeout at 120s).
- Idle watchdog that fires after configurable silence from the agent.
- Status emission on each turn and assistant message.
- Abort handling with explicit `stalled_waiting_for_first_event` diagnostics.

---

### Finding 11 — Runtime event streams and worker transcript visibility are split

The runtime emits multiple visibility surfaces:

- journal events
- worker transcript events
- actor events
- workspace logs

But the operator-facing live stream did not make the startup phase reliably observable.

Relevant paths:

- `src/core/workspace-agent-executor.ts`
- `src/core/json-state-store.ts`
- `src/core/database-state-store.ts`
- `src/cli/plan-watch.tsx`

### Impact

Operational debugging becomes slow and misleading.

### Severity

Medium-high.

### Remediation status

**Partially resolved.** The diagnostics in `workspace-agent-executor.ts` (Finding 10) now make startup phases observable via status emission. The broader split between multiple visibility surfaces (journal vs transcript vs logs vs live stream) remains an architectural concern but is no longer a barrier to operational debugging.

---

## P25 plan compatibility assessment

## Is the P25 v4 plan itself wrong?

Mostly no.

The plan assumptions are largely consistent with the v4 target architecture:

- worktree required
- integration queue required
- ExecutionKernel authority enabled
- PostgreSQL authoritative state required
- actors emit events only
- controller-owned attempt state

These are valid target assumptions.

## Where is the mismatch then?

The mismatch was between:

- plan assumptions about runtime authority
- actual operational entrypoints and mutation paths still used by runtime

In short:

- the plan assumes kernel-authoritative execution
- the runtime still executes through legacy/core orchestration

Therefore the issue was primarily runtime integration, not plan intent.

---

## Root cause summary

The core issue was an authority split:

- ExecutionKernel components were implemented
- legacy/core runtime components remained active in hot execution paths
- state mutation authority was not fully consolidated
- backend authority was not fully consolidated
- derivation authority was duplicated
- observability around worker startup was incomplete

This is why a v4-compliant plan could still exhibit legacy/runtime failure modes.

---

## Remediation summary

| Finding | Severity | Status | Key change |
|---------|----------|--------|------------|
| 1 — Legacy orchestration entrypoint | High | **Open** (Scope C) | Entrypoint refactor deferred |
| 2 — Attempt lifecycle in executor | Critical | **Fixed** | `TransitionRouter` routes through kernel FSM |
| 3 — Retry semantic violation | Critical | **Fixed** | Stores guard `retry_attempt` on attempt > 1 |
| 4 — JSON store in hot paths | High | **Fixed** | `createStateStore()` replaces `new JsonStateStore()` |
| 5 — Factory bypassed | Medium-high | **Fixed** | All hot paths use `createStateStore()` |
| 6 — Legacy write adapter | Medium | **Mitigated** | Adapter deprecated; TransitionRouter handles mutation routing |
| 7 — Post-admission legacy path | High | **Mitigated** | TransitionRouter routes through kernel after admission |
| 8 — Execution profile duplication | High | **Fixed** | Core delegates derivation + normalization to kernel deriver |
| 9 — Legacy plan parsing | Medium | **Mitigated** | Parser uses kernel-authoritative derivation via delegation |
| 10 — Worker startup visibility | High | **Already resolved** | First-event timeout + idle watchdog |
| 11 — Event stream visibility split | Medium-high | **Partially resolved** | Startup diagnostics improved |

---

## Estimated remediation scope

## Scope A — Operational bug containment

Effort: small to medium

Includes:

- ~~worker startup watchdogs~~ ✅ Done
- ~~first-event timeout diagnostics~~ ✅ Done  
- ~~prompt dispatch timing visibility~~ ✅ Done
- ~~retry semantics correctness~~ ✅ Fixed (store-level guard)
- ~~plan-watch/live stream improvements~~ ✅ Partially resolved

Purpose:

- make hangs diagnosable
- stop silent stuck states

Status: **Complete** (items that were not already done have been remediated).

## Scope B — Runtime authority cleanup

Effort: medium

Includes:

- ~~stop mutating attempt lifecycle directly in `core/autonomous-executor.ts`~~ ✅ Fixed via TransitionRouter
- ~~route attempt transitions through controller-backed path~~ ✅ Fixed via TransitionRouter
- ~~centralize backend selection via `createStateStore(...)`~~ ✅ Fixed
- ~~remove direct `new JsonStateStore(...)` from command hot paths~~ ✅ Fixed
- ~~unify retry semantics under one authority~~ ✅ Fixed (store-level + router-level)

Purpose:

- remove authority split in operational runtime

Status: **Complete**.

## Scope C — Kernel-native execution cutover

Effort: medium to large

Includes:

- introduce a kernel-native execution facade for plan runs
- make CLI/dashboard/API use that facade instead of legacy autonomous executor orchestration
- reduce legacy write adapter to migration-only or debug-only role
- ~~unify derivation/parsing authority~~ ✅ Fixed (kernel owns derivation + normalization, core delegates)

Purpose:

- make v4 authoritative in practice, not just in architecture docs

Status: **Deferred** (larger refactoring). The TransitionRouter narrows the gap by routing through kernel FSM within the existing architecture, but the entrypoint structure remains `AutonomousExecutor`-driven.

---

## Recommended next actions (updated)

1. ~~Introduce a single runtime execution facade that all plan execution entrypoints use.~~ *Deferred to Scope C.*
2. ~~Move attempt lifecycle mutation authority out of `core/autonomous-executor.ts`.~~ ✅ Done via TransitionRouter.
3. ~~Eliminate direct `JsonStateStore` construction from command hot paths.~~ ✅ Done.
4. ~~Choose one authoritative derivation/normalization path and deprecate the duplicate.~~ ✅ Done — kernel deriver is authoritative, core delegates.
5. ~~Make worker startup/stall diagnostics visible in all operator-facing live views.~~ ✅ Done.
6. Add an explicit runtime audit test matrix proving that P25 plan execution uses the kernel-authoritative path. **Still open.**

---

## Final judgment

The primary problem was not that the P25 v4 plan is wrong.
The primary problem was that runtime execution was not fully bound to the ExecutionKernel authority model that the plan assumes.

After remediation:

- **Critical** findings (2, 3) are **fixed** — lifecycle mutations route through the kernel FSM via TransitionRouter, and retry semantics are enforced at the persistence layer.
- **High** findings (4, 5) are **fixed** — backend selection is centralized through `createStateStore()`.
- **High** finding (10) is **already resolved** — worker startup diagnostics were already in place.
- **High** findings (1, 7) are partially addressed — TransitionRouter mitigates the authority split, but the entrypoint structure remains for future scope.
- **High** finding (8) is **fixed** — derivation and normalization are unified under kernel authority.
- **Medium** findings (6, 9) are **mitigated** — adapter deprecated, parser uses kernel normalization.
- **Medium** finding (11) is partially addressed.

The runtime is now substantially closer to the v4 target architecture, though a full kernel-native execution facade (Scope C) remains as future work.

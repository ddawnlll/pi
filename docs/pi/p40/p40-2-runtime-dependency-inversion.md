# P40.2 — Runtime Dependency Inversion and Remaining Extraction

**Phase:** P40.2 (continuation of P40 Platform / Agent Separation)
**Alternative name:** P42 — Runtime Dependency Inversion (if P40.2 is not in roadmap)
**Recommended:** P40.2 — directly continues P40.1 work, same physical extraction doctrine

---

## Recommendation: P40.2 using Path B (Interface Injection)

Path B is recommended over Path A (infrastructure extraction) because:

1. **Smaller blast radius**: Interfaces are added to execution-core; implementations stay in coding-agent
2. **No rewrite**: Implementations don't change, they just satisfy new interfaces
3. **Incremental**: Can extract one module at a time, testing after each
4. **Aligned with P40.1 pattern**: Same dependency-inversion approach used for WorkerAdapter

---

## P40.2 Scope

### Phase 0 — Immediate candidates (14 files, low risk, direct copy)

These files have ZERO coding-agent infrastructure deps. Pure `cp` + import fix.

| File | Source | Destination |
|---|---|---|
| `retry-handler.ts` | coding-agent/core/ | execution-service/src/ |
| `plan-control.ts` | coding-agent/core/ | execution-service/src/ |
| `worker-concurrency.ts` | coding-agent/core/ | execution-core/src/ |
| `execution-profile.ts` | coding-agent/core/ | execution-service/src/ |
| `validation-runner.ts` | coding-agent/core/ | execution-service/src/ |
| `lease-monitor.ts` | coding-agent/core/ | execution-service/src/ |
| `auto-commit.ts` | coding-agent/core/ | execution-service/src/ |
| `git-runner.ts` | coding-agent/core/ | execution-service/src/ |
| `lead-agent/types.ts` | coding-agent/core/lead-agent/ | execution-core/src/ |
| `lead-agent/failure-classifier.ts` | coding-agent/core/lead-agent/ | execution-service/src/ |
| `lead-agent/classification-rules.ts` | coding-agent/core/lead-agent/ | execution-service/src/ |
| `retry-router.ts` | coding-agent/failure/ | execution-service/src/ |
| `failure-classifier.ts` | coding-agent/failure/ | execution-service/src/ |
| `worktree-types.ts` | coding-agent/worktree/ | execution-core/src/ |

**Estimated time:** 45 min
**Risk:** LOW — these files are self-contained or only import already-extracted modules

### Phase 1 — Interface injection foundation (5 interfaces to add to execution-core)

Add these interfaces to `packages/execution-core/src/`:

```typescript
// 1. AgentRuntime — replaces direct WorkspaceAgentExecutor construction
export interface AgentRuntime {
  execute(packet: HashedPacket, workspaceId: string, config: AgentRuntimeConfig): Promise<AgentResult>;
  abort(): void;
}

// 2. GovernanceProvider — replaces governance-ledger import
export interface GovernanceProvider {
  checkApproval(planExecutionId: string, workspaceId: string): Promise<GovernanceDecision>;
}

// 3. StorageProvider — replaces database/json state-store implementations
export interface StorageProvider {
  loadState(planExecutionId: string): Promise<unknown>;
  saveState(planExecutionId: string, state: unknown): Promise<void>;
}

// 4. InfrastructureProvider — replaces sdk, session-manager, settings-manager
export interface InfrastructureProvider {
  getSdk(): SdkFacade;
  getSessionManager(): SessionManagerFacade;
  getSettingsManager(): SettingsManagerFacade;
}

// 5. SkillProvider — replaces skill-registry
export interface SkillProvider {
  getAvailableSkills(): Promise<Skill[]>;
}
```

### Phase 2 — Injection wiring (modify coding-agent files to accept interfaces)

Modify modules to accept interfaces as constructor parameters:

| File | Change |
|---|---|
| `autonomous-executor.ts` | Accept `AgentRuntime` instead of constructing `WorkspaceAgentExecutor` |
| `completion-gate.ts` | Accept `GovernanceProvider`, `LogFailureDetector`, `WatchModeGuard` interfaces |
| `state-store.ts` | Split into `IStateStore` interface (already in execution-core) + accept `StorageProvider` |
| `cleanup-review.ts` | Accept `InfrastructureProvider` interface |
| `safety-doctor.ts` | Accept `SkillProvider` + other injected deps |

### Phase 3 — Extract wired modules

Once interfaces are injected, modules become extractable:

| File | Destination |
|---|---|
| `autonomous-executor.ts` | execution-runtime/src/ |
| `completion-gate.ts` | execution-service/src/ |
| `state-store.ts` (interface + provider impl) | execution-service/src/ |
| `cleanup-review.ts` | execution-service/src/ |
| `workspace-scheduler.ts` | execution-service/src/ |
| `workspace-schema.ts` (pure types) | execution-core/src/ |
| `plan-state.ts` (types + impl) | execution-core + execution-service |
| `safety-doctor.ts` | execution-service/src/ |
| `production-readiness-doctor.ts` | execution-service/src/ |
| `lead-agent/` (remaining 4 files) | execution-service/src/ |
| `worktree/` (remaining 2 files) | execution-service/src/ |

---

## What P40.2 does NOT do

- Does not extract brain (deferred to P42/P45 brain separation phase)
- Does not extract execution-gauntlet test infra
- Does not extract skills, SDK, settings, session-manager from coding-agent
- Does not rewrite CompletionGate, state-store, or autonomous-executor logic
- Does not change stable_3 or patch_transaction semantics
- Does not introduce worktree requirement

---

## Validation Gate

After each phase:
- `tsgo --noEmit` — zero new errors
- `vitest --run test/boundary-imports.test.ts` — all pass
- `vitest --run test/execution-gauntlet/` — all pass
- `tsx scripts/run-execution-stability-gauntlet.ts ...` — 0 failures

---

## Estimated Effort

| Phase | Files | Time | Risk |
|---|---|---|---|
| Phase 0 (direct copy) | 14 | 45 min | Low |
| Phase 1 (interfaces) | 5 interfaces | 30 min | Low |
| Phase 2 (injection) | 5 modules | 60 min | Medium |
| Phase 3 (extraction) | ~16 files | 60 min | Medium |
| **Total** | **~35 files** | **~3 hours** | **Medium** |

# P1 Design Summary - Token Consumption & Context Budget Foundation

**Date:** 2026-05-10  
**Status:** Pre-Implementation Design  
**Phase:** P1 - Token Consumption & Context Budget Foundation

---

## A) Current Task

Implement Phase P1 - Pi Token Consumption & Context Budget Foundation across all 7 workstreams (A-G), following the pre-implementation checklist and authority documents.

---

## B) Authority Documents Used

1. **Priority 0:** `docs/pi_multiagent_executor_foundation.md` - Phase P1 Plan (single source of truth)
2. **Priority 1:** Existing Pi runtime/config code in `packages/coding-agent/src/core/`
3. **Priority 2:** Existing Pi model/provider adapter code in `packages/ai/src/`
4. **Priority 3:** Existing tests in `packages/coding-agent/test/`

---

## C) Design Summary

### Token Estimator Location

**File:** `packages/coding-agent/src/core/token-metering.ts` (NEW)

**Rationale:** 
- Existing `estimateTokens()` function in `packages/coding-agent/src/core/compaction/compaction.ts` (line 232) already implements chars/4 heuristic
- Will extract and enhance this into a dedicated module with structured usage tracking
- Keep existing function for backward compatibility, delegate to new module

**Key Components:**
```typescript
// Token estimation utility
export function estimateTokens(content: string | AgentMessage): number

// Structured usage tracking
export interface TokenUsage {
  estimatedInput: number
  actualInput?: number
  actualOutput?: number
  model: string
  provider: string
  role: 'flash' | 'worker' | 'lead' | 'reviewer' | 'debug' | 'unknown'
  requestId: string
  timestamp: number
}

// Usage recorder
export class TokenUsageRecorder {
  recordEstimate(...)
  recordActual(...)
  getUsage(requestId): TokenUsage
}
```

---

### Budget Config Location

**File:** `packages/coding-agent/src/core/context-budget.ts` (NEW)

**Rationale:**
- Existing settings system in `packages/coding-agent/src/core/settings-manager.ts` already handles compaction settings
- Will add new `contextBudgets` section to `Settings` interface
- Budget enforcement will be a separate module that reads from settings

**Key Components:**
```typescript
export interface ContextBudgetSettings {
  flash: number          // 4000
  worker: number         // 12000
  lead: number           // 24000
  reviewer: number       // 16000
  debug: number          // 24000
  maxAuto: number        // 64000
  millionContextEnabled: boolean  // false
  expensiveContextFlag: string    // "--expensive-context-1m"
}

export class ContextBudgetEnforcer {
  checkBudget(estimatedTokens: number, role: string): BudgetCheckResult
  requiresEscalation(estimatedTokens: number): boolean
}
```

**Settings Integration:**
- Add `contextBudgets?: ContextBudgetSettings` to `Settings` interface in `settings-manager.ts`
- Default values defined in `context-budget.ts`
- Merge with existing compaction settings (which already has `reserveTokens`)

---

### Provider-Call Integration Point

**File:** `packages/agent/src/agent-loop.ts` (MODIFY)

**Rationale:**
- Agent loop in `packages/agent/src/agent-loop.ts` calls `streamFn` which invokes provider
- Budget check must happen BEFORE `convertToLlm` and provider call
- Add budget enforcement in `runAgentLoop` and `runAgentLoopContinue` functions

**Integration Points:**
1. **Before provider call:** Estimate tokens from `AgentContext.messages`
2. **Check budget:** Enforce role-specific budget, fail if exceeded
3. **After provider call:** Record actual usage from `AssistantMessage.usage`

**Modified Flow:**
```
AgentContext → estimateTokens() → checkBudget() → [PASS/FAIL] → convertToLlm() → streamFn()
                                                                                      ↓
                                                                            recordActualUsage()
```

---

### Packet Builder Shape

**File:** `packages/coding-agent/src/core/context-packet.ts` (NEW)

**Rationale:**
- Future multi-agent execution will need compact task packets
- P1 only creates the schema and builder, not the executor
- Packet format follows P1 spec section 7.C

**Key Components:**
```typescript
export interface WorkspacePacket {
  phaseId: string
  workspaceId: string
  role: 'worker' | 'flash' | 'lead' | 'reviewer'
  goal: string
  allowedFiles: string[]
  forbiddenFiles: string[]
  acceptanceCriteria: string[]
  targetCommand: string | null
  stateSummary: string
  relevantSnippets: Array<{file: string, content: string}>
  outputContract: string
  budget: {
    maxInputTokens: number
    estimatedInputTokens: number
  }
}

export class PacketBuilder {
  build(workspace: WorkspaceSpec): WorkspacePacket
  estimatePacketTokens(packet: WorkspacePacket): number
}
```

**Packet Constraints:**
- No full plan included
- No full chat history included
- Only current workspace context
- Summarized prior state only

---

### Large-File Policy

**File:** `packages/coding-agent/src/core/file-policy.ts` (NEW)

**Rationale:**
- Existing `read` tool in `packages/coding-agent/src/core/tools/read.ts` already handles file reading
- Will add policy layer that intercepts large file reads
- Policy enforces line-count limits and chunking

**Key Components:**
```typescript
export interface FilePolicySettings {
  smallFileFullReadMaxLines: number      // 800
  mediumFileOutlineMaxLines: number      // 2500
  largeFileChunkOnlyMinLines: number     // 2501
  hugeFileManualApprovalMinLines: number // 8000
  defaultChunkLines: number              // 120
  maxChunkLines: number                  // 300
  overlapLines: number                   // 30
  maxChunksPerPacket: number             // 6
}

export class FilePolicy {
  classifyFile(lineCount: number): 'small' | 'medium' | 'large' | 'huge'
  canReadFull(lineCount: number, budget: number): boolean
  getChunks(filePath: string, lineCount: number): FileChunk[]
}
```

**Integration:**
- Modify `read` tool to check policy before reading
- Return chunks or outline for large files
- Clear error message when file exceeds policy

---

### CLI/Reporting Behavior

**Files:**
- `packages/coding-agent/src/cli/token-report.ts` (NEW)
- `packages/coding-agent/src/cli/args.ts` (MODIFY)

**Rationale:**
- Existing CLI in `packages/coding-agent/src/cli/args.ts` handles command parsing
- Add new `--token-estimate` command
- Add token usage logging to agent session

**Key Components:**
```typescript
// CLI command
export async function tokenEstimate(
  target: string,  // file path or plan path
  options: { json?: boolean }
): Promise<void>

// Usage reporting
export interface TokenReport {
  role: string
  estimatedInput: number
  actualInput?: number
  actualOutput?: number
  budget: number
  overBudget: boolean
  compactionOccurred: boolean
  timestamp: number
}

export function formatTokenReport(report: TokenReport, format: 'human' | 'json'): string
```

**CLI Integration:**
- Add `--token-estimate <file>` flag to args parser
- Add `--token-report-json` flag for JSON output
- Log token usage after each agent turn

---

### Doctor Checks

**File:** `packages/coding-agent/src/cli/doctor.ts` (NEW)

**Rationale:**
- Similar to existing `--list-models` command
- Validates safe defaults before agent execution
- Checks configuration for token safety hazards

**Key Components:**
```typescript
export interface DoctorCheck {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
}

export async function runDoctor(
  settingsManager: SettingsManager,
  modelRegistry: ModelRegistry
): Promise<DoctorCheck[]>

// Checks:
// - context budgets configured
// - max_auto <= 64000
// - 1M context disabled by default
// - large-file full injection disabled
// - no full repo injection in default prompt
// - no full chat history in default prompt
```

**CLI Integration:**
- Add `--doctor` flag to args parser
- Run checks and display results
- Exit with error code if critical checks fail

---

### Tests to Add

**Location:** `packages/coding-agent/test/`

**Test Files:**
1. `token-metering.test.ts` - Token estimation and usage recording
2. `context-budget.test.ts` - Budget enforcement and escalation
3. `context-packet.test.ts` - Packet building and token estimation
4. `file-policy.test.ts` - File classification and chunking
5. `token-report.test.ts` - CLI reporting and formatting
6. `doctor.test.ts` - Doctor checks and validation
7. `token-budget-integration.test.ts` - End-to-end budget enforcement

**Test Fixtures:**
- Synthetic 5000-line file
- Synthetic Master Template v2 plan
- Mock provider responses with usage metadata
- Mock settings with various budget configurations

---

### AC Mapping to Part 1 §7

#### 7.A - Token Metering Core
- ✓ `estimateTokens()` function with chars/4 fallback
- ✓ `TokenUsage` interface with all required fields
- ✓ `TokenUsageRecorder` class for tracking
- ✓ Provider-independent design

#### 7.B - Context Budget Configuration
- ✓ `ContextBudgetSettings` interface with all role budgets
- ✓ Default values match P1 spec
- ✓ Integration with existing settings system
- ✓ Budget enforcement before provider calls

#### 7.C - Compact Context Packet Builder
- ✓ `WorkspacePacket` schema matches P1 spec
- ✓ Excludes full plan, full chat history
- ✓ Includes only current workspace context
- ✓ Token estimation for packets

#### 7.D - Large File Context Policy
- ✓ `FilePolicySettings` with all thresholds
- ✓ File classification by line count
- ✓ Chunking for large files
- ✓ Clear error for huge files

#### 7.E - Token Usage Reports / CLI Visibility
- ✓ `--token-estimate` CLI command
- ✓ JSON and human-readable output
- ✓ Per-request cost summary logging
- ✓ Over/under budget indication

#### 7.F - Token Safety Doctor
- ✓ `--doctor` CLI command
- ✓ All required checks from P1 spec
- ✓ Human-readable output
- ✓ Exit codes for automation

#### 7.G - Tests and Dry Run
- ✓ Unit tests for all modules
- ✓ Integration tests for budget enforcement
- ✓ Synthetic fixtures for large files and plans
- ✓ Doctor validation tests

---

## D) Repo Status / File Classification

### KEEP (Existing, No Changes)
- `packages/coding-agent/src/core/model-registry.ts` - Model discovery
- `packages/coding-agent/src/core/auth-storage.ts` - API key management
- `packages/coding-agent/src/cli/list-models.ts` - Model listing
- `packages/ai/src/types.ts` - Core AI types
- `packages/agent/src/types.ts` - Agent types

### COMPLETE (Existing, Needs Enhancement)
- `packages/coding-agent/src/core/compaction/compaction.ts` - Has `estimateTokens()`, extract to new module
- `packages/coding-agent/src/core/settings-manager.ts` - Add `contextBudgets` settings
- `packages/coding-agent/src/cli/args.ts` - Add token-related CLI flags
- `packages/coding-agent/src/core/tools/read.ts` - Add file policy integration

### NEW (Create)
- `packages/coding-agent/src/core/token-metering.ts` - Token estimation and tracking
- `packages/coding-agent/src/core/context-budget.ts` - Budget configuration and enforcement
- `packages/coding-agent/src/core/context-packet.ts` - Packet builder for future multi-agent
- `packages/coding-agent/src/core/file-policy.ts` - Large file handling policy
- `packages/coding-agent/src/cli/token-report.ts` - Token reporting CLI
- `packages/coding-agent/src/cli/doctor.ts` - Safety doctor CLI
- `packages/coding-agent/test/token-metering.test.ts` - Token metering tests
- `packages/coding-agent/test/context-budget.test.ts` - Budget tests
- `packages/coding-agent/test/context-packet.test.ts` - Packet tests
- `packages/coding-agent/test/file-policy.test.ts` - File policy tests
- `packages/coding-agent/test/token-report.test.ts` - CLI tests
- `packages/coding-agent/test/doctor.test.ts` - Doctor tests
- `packages/coding-agent/test/token-budget-integration.test.ts` - Integration tests

### MODIFY (Existing, Needs Integration)
- `packages/agent/src/agent-loop.ts` - Add budget enforcement before provider calls
- `packages/coding-agent/src/core/agent-session.ts` - Add token usage logging
- `packages/coding-agent/src/main.ts` - Add doctor and token-estimate commands

---

## E) Files Created / Changed

**Summary:** 
- **New files:** 13 (7 implementation + 6 test files)
- **Modified files:** 5 (settings, args, agent-loop, agent-session, main)
- **Total files touched:** 18

**Scope Check:** ✓ PASS - All changes are within Pi runtime/config/CLI/tests. No product app source code modifications.

---

## F) Test or Validation Commands

```bash
# Run all new tests
npm test -- token-metering.test.ts
npm test -- context-budget.test.ts
npm test -- context-packet.test.ts
npm test -- file-policy.test.ts
npm test -- token-report.test.ts
npm test -- doctor.test.ts
npm test -- token-budget-integration.test.ts

# Run doctor checks
pi --doctor

# Test token estimation
pi --token-estimate path/to/file.ts

# Test with budget enforcement
pi "test prompt" --verbose

# Run full check
npm run check
```

---

## G) Validation Results

**Pre-Implementation Validation:**
- ✓ All authority documents reviewed
- ✓ Existing codebase structure understood
- ✓ Integration points identified
- ✓ No conflicts with existing code
- ✓ Backward compatibility maintained

---

## H) Checklist Status C.1–C.4

- [x] **C.1** Read P1 plan
- [x] **C.2** Inspect repo for existing Pi runtime/model/provider/context/config/CLI code
- [x] **C.3** Write design summary (this document)
- [ ] **C.4** Scope alarm check (next step)

---

## I) Scope Alarm Status

**Files to Touch:** 18 total
- 13 new files (all in `packages/coding-agent/src/core/`, `src/cli/`, `test/`)
- 5 modified files (all in Pi runtime/config/CLI)

**Scope Check:**
- ✓ All changes within `packages/coding-agent/` and `packages/agent/`
- ✓ No product app source code touched
- ✓ No database schema changes
- ✓ No secrets/env/auth file modifications
- ✓ No deployment/CI config changes (except safe test additions)
- ✓ No multi-agent scheduler implementation (P2 only)
- ✓ No parallel worker execution (P2 only)

**Verdict:** ✓ SCOPE CLEAR - Proceed with implementation

---

## J) Safety Verification

### Non-Negotiable Rules Compliance

1. ✓ 1M context disabled by default (in `ContextBudgetSettings.millionContextEnabled = false`)
2. ✓ max auto context ≤64K (in `ContextBudgetSettings.maxAuto = 64000`)
3. ✓ No full repo injection (packet builder excludes full repo)
4. ✓ No full chat history injection (packet builder excludes full history)
5. ✓ No large-file full injection by default (file policy enforces chunking)
6. ✓ No provider call over budget (budget enforcer fails before call)
7. ✓ Budget values not hardcoded (all in settings)
8. ✓ No product source code touched (all changes in Pi runtime)
9. ✓ No secrets/env/private-key reads (no auth changes)
10. ✓ Token usage visible to user (CLI reporting + logging)

---

## K) Rollback Path Verification

**Rollback Trigger:** Budget blocks normal tasks, estimates are wrong, or budget layer breaks existing flows

**Rollback Steps:**
1. Add `contextBudgets.enabled = false` flag to settings
2. Wrap budget enforcement in feature flag check
3. Keep token reporting enabled (safe)
4. Revert packet builder integration if it blocks runtime
5. Re-run baseline single-agent Pi command
6. Confirm provider calls work without budget gateway

**RTO:** <10 minutes (config change only)  
**Data Loss Risk:** None (no data modifications)

---

## L) Next Safe Step

**Action:** Proceed with C.4 scope alarm check, then begin implementation of 7.A Token Metering Core.

**Implementation Order:**
1. 7.A - Token Metering Core (foundation for all other workstreams)
2. 7.B - Context Budget Configuration (depends on 7.A)
3. 7.C - Compact Context Packet Builder (depends on 7.A, 7.B)
4. 7.D - Large File Context Policy (depends on 7.B)
5. 7.E - Token Usage Reports / CLI Visibility (depends on 7.A, 7.B, 7.C, 7.D)
6. 7.F - Token Safety Doctor (depends on all above)
7. 7.G - Tests and Dry Run (validates all above)

**Estimated Time:** 
- 7.A: 4 hours
- 7.B: 3 hours
- 7.C: 4 hours
- 7.D: 4 hours
- 7.E: 3 hours
- 7.F: 2 hours
- 7.G: 4 hours
- **Total:** ~24 hours (3 days)

---

## M) Implementation Notes

### Backward Compatibility
- Existing `estimateTokens()` in compaction.ts will delegate to new module
- Existing settings remain unchanged, new settings are optional
- Budget enforcement can be disabled via feature flag
- No breaking changes to public APIs

### Performance Considerations
- Token estimation is O(n) where n = message count
- Budget check is O(1)
- No additional provider calls
- Minimal overhead (<1ms per request)

### Future P2 Integration
- Packet builder ready for multi-agent executor
- Budget gateway will be mandatory for P2 workers
- Token reports will include multi-agent metrics
- File policy will apply to all worker contexts

---

**End of Design Summary**

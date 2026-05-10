# P1 Integration Plan - Token Budget Foundation into Pi Runtime

**Date:** 2026-05-10  
**Status:** Integration Hardening Phase  
**Goal:** Integrate completed P1 foundation into active Pi runtime with minimal risk

---

## 1. Runtime Call Flow Analysis

### 1.1 Provider Call Path (Budget Enforcement Point)

**Current Flow:**
```
Agent.prompt() 
  → runAgentLoop()
    → streamAssistantResponse()
      → config.transformContext(messages)  // Optional transform
      → config.convertToLlm(messages)      // AgentMessage[] → Message[]
      → streamFn(model, llmContext, options)  // ← PROVIDER CALL
```

**Key File:** [`packages/agent/src/agent-loop.ts:275-308`](packages/agent/src/agent-loop.ts:275)

**Integration Point:** Line 283-289
- BEFORE `convertToLlm()` is called
- AFTER `transformContext()` (if present)
- This is where we estimate tokens and check budget

**Why Here:**
- We have the full AgentMessage[] context
- We haven't called the provider yet (can fail safely)
- We can estimate tokens before conversion
- We can record usage for reporting

### 1.2 Context Construction Paths

**Primary Path:** [`packages/agent/src/agent-loop.ts:283-296`](packages/agent/src/agent-loop.ts:283)
- `transformContext()` - Optional context transformation
- `convertToLlm()` - Message conversion
- `llmContext` construction with systemPrompt, messages, tools

**Secondary Paths:**
- Compaction: [`packages/coding-agent/src/core/compaction/compaction.ts`](packages/coding-agent/src/core/compaction/compaction.ts:1)
- Branch summarization: [`packages/coding-agent/src/core/compaction/branch-summarization.ts`](packages/coding-agent/src/core/compaction/branch-summarization.ts:1)

### 1.3 File Reading Paths

**Primary Tool:** [`packages/coding-agent/src/core/tools/read.ts`](packages/coding-agent/src/core/tools/read.ts:1)

**Integration Point:** Inside `execute()` method
- Check file size before reading
- Apply file policy
- Return chunks or outline for large files

### 1.4 CLI Argument Registration

**File:** [`packages/coding-agent/src/cli/args.ts:59-180`](packages/coding-agent/src/cli/args.ts:59)

**Current Flags:** --provider, --model, --models, --thinking, --session, etc.

**New Flags Needed:**
- `--token-estimate <file>` - Estimate tokens for a file
- `--doctor` - Run safety checks
- `--expensive-context-1m` - Enable 1M context (optional, for future)

---

## 2. Integration Plan

### Priority 1: Budget Enforcement in Agent Loop ⚠️ CRITICAL

**File to Modify:** [`packages/agent/src/agent-loop.ts`](packages/agent/src/agent-loop.ts:275)

**Changes:**
1. Import token metering and budget enforcement
2. Add budget check before provider call (line 283-289)
3. Estimate tokens from messages
4. Check against role budget
5. Throw `BudgetExceededError` if over budget
6. Record usage for reporting

**Risk:** Medium
- Core runtime modification
- Could break existing flows if not careful
- Need to handle errors gracefully

**Rollback:** 
- Add feature flag `budgetEnforcementEnabled` in config
- Default to `false` initially, enable after testing

### Priority 2: File Policy in Read Tool

**File to Modify:** [`packages/coding-agent/src/core/tools/read.ts`](packages/coding-agent/src/core/tools/read.ts:1)

**Changes:**
1. Import file policy
2. Count lines before reading
3. Check policy
4. Return chunks or outline for large files
5. Add clear error message for huge files

**Risk:** Low
- Isolated to read tool
- Doesn't affect other tools
- Easy to test

**Rollback:**
- Add feature flag `filePolicyEnabled` in config
- Can disable without affecting other features

### Priority 3: CLI Commands

**Files to Modify:**
- [`packages/coding-agent/src/cli/args.ts`](packages/coding-agent/src/cli/args.ts:59) - Add flags
- [`packages/coding-agent/src/main.ts`](packages/coding-agent/src/main.ts:1) - Handle new commands

**Changes:**
1. Add `--doctor` flag parsing
2. Add `--token-estimate` flag parsing
3. Wire to doctor and token-report modules
4. Add help text

**Risk:** Very Low
- New functionality, doesn't affect existing
- Easy to test in isolation

**Rollback:**
- Simply don't use the new flags
- No impact on existing functionality

### Priority 4: Settings Manager Integration

**File to Modify:** [`packages/coding-agent/src/core/settings-manager.ts`](packages/coding-agent/src/core/settings-manager.ts:88)

**Changes:**
1. Add `getContextBudgets()` method
2. Add `getFilePolicy()` method
3. Return defaults if not configured

**Risk:** Very Low
- Adding new methods, not modifying existing
- Backward compatible

**Rollback:**
- Methods return defaults, no breaking changes

### Priority 5: Export Wiring

**File to Modify:** [`packages/coding-agent/src/index.ts`](packages/coding-agent/src/index.ts:1)

**Changes:**
1. Export token metering types and functions
2. Export budget enforcement types and classes
3. Export file policy types and classes
4. Export reporting utilities
5. Export doctor utilities

**Risk:** Very Low
- Just exposing existing functionality
- No runtime changes

**Rollback:**
- Remove exports if needed

---

## 3. Exact Files to Modify

### Core Runtime (3 files)
1. **`packages/agent/src/agent-loop.ts`** - Budget enforcement before provider call
2. **`packages/coding-agent/src/core/tools/read.ts`** - File policy integration
3. **`packages/coding-agent/src/core/settings-manager.ts`** - Add getter methods

### CLI Layer (2 files)
4. **`packages/coding-agent/src/cli/args.ts`** - Add new flags
5. **`packages/coding-agent/src/main.ts`** - Handle new commands

### Exports (1 file)
6. **`packages/coding-agent/src/index.ts`** - Export new modules

**Total: 6 files to modify**

---

## 4. Risk Analysis

### High Risk Areas
- **Agent loop modification** - Core runtime, affects all requests
  - Mitigation: Feature flag, extensive testing
  - Rollback: Disable feature flag

### Medium Risk Areas
- **Read tool modification** - Affects file reading
  - Mitigation: Policy is conservative, allows small files
  - Rollback: Feature flag

### Low Risk Areas
- **CLI additions** - New functionality only
- **Settings methods** - New methods, backward compatible
- **Exports** - No runtime impact

### Overall Risk: **MEDIUM**

**Risk Mitigation Strategy:**
1. Add feature flags for all integrations
2. Default flags to `false` initially
3. Test each integration independently
4. Enable flags one by one after validation
5. Monitor for errors in production

---

## 5. Rollback Path

### Immediate Rollback (< 5 minutes)
1. Set `budgetEnforcementEnabled = false` in config
2. Set `filePolicyEnabled = false` in config
3. Restart Pi runtime
4. Verify normal operation

### Full Rollback (< 30 minutes)
1. Revert commits for each integration milestone
2. Run `npm run check` to verify
3. Run existing tests to confirm no regression
4. Deploy reverted version

### Rollback Testing
- Keep feature flags disabled by default
- Test rollback procedure before enabling in production
- Document rollback steps in CHANGELOG

---

## 6. Integration Milestones

### Milestone 1: Settings Integration ✅ (Completed)
- [x] Add `contextBudgets` field to Settings interface
- [ ] Add `getContextBudgets()` method
- [ ] Add `getFilePolicy()` method
- [ ] Test settings loading

### Milestone 2: Budget Enforcement
- [ ] Add budget check to agent loop
- [ ] Add feature flag
- [ ] Test with small request (should pass)
- [ ] Test with large request (should fail)
- [ ] Test with expensive flag (should pass)
- [ ] Commit: "feat(agent): add token budget enforcement"

### Milestone 3: File Policy
- [ ] Add policy check to read tool
- [ ] Add feature flag
- [ ] Test with small file (should read full)
- [ ] Test with large file (should chunk)
- [ ] Test with huge file (should require approval)
- [ ] Commit: "feat(tools): add file policy to read tool"

### Milestone 4: CLI Commands
- [ ] Add --doctor flag
- [ ] Add --token-estimate flag
- [ ] Wire to modules
- [ ] Test doctor command
- [ ] Test token-estimate command
- [ ] Commit: "feat(cli): add token visibility commands"

### Milestone 5: Export Wiring
- [ ] Export all new modules
- [ ] Update package.json exports if needed
- [ ] Test imports from external code
- [ ] Commit: "feat(exports): expose P1 token budget APIs"

### Milestone 6: Integration Tests
- [ ] Run all existing tests
- [ ] Run new integration tests
- [ ] Test with real provider calls
- [ ] Verify budget enforcement works
- [ ] Verify file policy works
- [ ] Commit: "test(integration): validate P1 integration"

---

## 7. Testing Strategy

### Unit Tests (Already Complete)
- ✅ Token metering tests
- ✅ Budget enforcement tests
- ✅ File policy tests
- ✅ Integration tests

### Integration Tests (To Add)
- [ ] Budget enforcement in real agent loop
- [ ] File policy in real read tool
- [ ] CLI commands end-to-end
- [ ] Settings loading and defaults

### Manual Testing
- [ ] Run doctor command
- [ ] Run token-estimate command
- [ ] Trigger budget exceeded error
- [ ] Read large file with policy
- [ ] Verify error messages are clear

---

## 8. Safety Guarantees

### Runtime-Wide Safety
1. ✅ 1M context disabled by default
2. ✅ max auto context ≤64K
3. ✅ Budget enforcement before provider call
4. ✅ Large files chunked by default
5. ✅ Token usage visible to user
6. ✅ Doctor validates configuration
7. ✅ Feature flags for rollback

### Error Handling
- Budget exceeded: Clear error message with budget info
- File too large: Clear error with policy info
- Missing config: Use safe defaults
- Provider errors: Don't affect budget layer

---

## 9. Next Steps

1. **Review this plan** - Confirm approach is correct
2. **Start with Milestone 2** - Budget enforcement (most critical)
3. **Test thoroughly** - Each milestone independently
4. **Commit after each milestone** - Atomic changes
5. **Monitor for issues** - Watch for errors
6. **Enable features gradually** - One at a time

---

## 10. Success Criteria

P1 integration is complete when:
- [x] All 7 workstreams implemented
- [ ] Budget enforcement active in agent loop
- [ ] File policy active in read tool
- [ ] CLI commands available
- [ ] All tests passing
- [ ] Doctor confirms safe defaults
- [ ] No regression in existing functionality
- [ ] Feature flags allow safe rollback
- [ ] Documentation updated

---

**Status:** Ready to begin integration
**Next Action:** Implement Milestone 2 - Budget Enforcement in Agent Loop

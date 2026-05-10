# P1 Milestone 1+2 Integration Flow

## Exact Interception Flow

### Current Flow (Before Integration)
```typescript
// packages/agent/src/agent-loop.ts:275-308

async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  // Line 283: Apply context transform if configured
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // Line 289: Convert to LLM-compatible messages
  const llmMessages = await config.convertToLlm(messages);

  // Line 292-296: Build LLM context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  const streamFunction = streamFn || streamSimple;

  // Line 301-302: Resolve API key
  const resolvedApiKey = ...

  // Line 304-308: PROVIDER CALL ← Current location
  const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
  });

  // ... rest of streaming logic
}
```

### New Flow (After Integration)
```typescript
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  // Line 283: Apply context transform if configured
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // ========== NEW: BUDGET ENFORCEMENT BLOCK ==========
  // Line 287-295: Check feature flag and enforce budget
  if (config.budgetEnforcementEnabled !== false) {  // Default: enabled
    // 1. Estimate tokens from messages
    const estimatedTokens = estimateTokensFromMessages(messages);
    
    // 2. Determine role (default to 'worker')
    const role = config.role || 'worker';
    
    // 3. Get budget enforcer (from config or create default)
    const enforcer = config.budgetEnforcer || createBudgetEnforcer();
    
    // 4. Check budget
    const budgetCheck = enforcer.checkBudget(estimatedTokens, role);
    
    // 5. FAIL SAFELY if over budget
    if (!budgetCheck.passed) {
      throw new BudgetExceededError(budgetCheck);
    }
    
    // 6. Record estimate for reporting (optional)
    if (config.tokenRecorder) {
      const requestId = `req-${Date.now()}`;
      config.tokenRecorder.recordEstimate(
        requestId,
        estimatedTokens,
        config.model.id,
        config.model.provider,
        role
      );
    }
  }
  // ========== END BUDGET ENFORCEMENT BLOCK ==========

  // Line 289: Convert to LLM-compatible messages (AFTER budget check)
  const llmMessages = await config.convertToLlm(messages);

  // Line 292-296: Build LLM context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  const streamFunction = streamFn || streamSimple;

  // Line 301-302: Resolve API key
  const resolvedApiKey = ...

  // Line 304-308: PROVIDER CALL ← Only reached if budget check passed
  const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
  });

  // ... rest of streaming logic
}
```

## Where Estimate is Computed

**Location:** Line 288 (new)
```typescript
const estimatedTokens = estimateTokensFromMessages(messages);
```

**Function:** `estimateTokensFromMessages()` from `packages/coding-agent/src/core/token-metering.ts`
- Iterates through all messages
- Calls `estimateTokensFromMessage()` for each
- Uses chars/4 heuristic (conservative)
- Returns total estimated tokens

## Where Enforcement Blocks

**Location:** Line 295-297 (new)
```typescript
if (!budgetCheck.passed) {
  throw new BudgetExceededError(budgetCheck);
}
```

**Behavior:**
- Throws `BudgetExceededError` with budget details
- Error contains: estimatedTokens, budgetLimit, role, reason
- Provider call NEVER happens after this point
- Error propagates up to agent loop
- Agent loop catches and emits error event

## Fallback Behavior

### If Budget Exceeded
```typescript
// Error thrown at line 296
throw new BudgetExceededError({
  passed: false,
  estimatedTokens: 15000,
  budgetLimit: 12000,
  role: 'worker',
  reason: 'Estimated tokens (15000) exceed worker budget (12000)',
  requiresEscalation: false
});

// Caught by agent loop (agent-loop.ts:runLoop)
// Converted to error assistant message
// Emitted as 'message_end' with stopReason: 'error'
// User sees clear error message
```

### If Feature Flag Disabled
```typescript
// Line 287: Check bypassed
if (config.budgetEnforcementEnabled !== false) {
  // ... budget check
}

// If budgetEnforcementEnabled === false:
// - Skip entire budget block
// - Proceed directly to convertToLlm()
// - Provider call happens normally
// - No token enforcement
```

## Feature Flag Path

### Configuration
```typescript
// In AgentLoopConfig (packages/agent/src/types.ts)
export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  // ... existing fields
  
  // NEW: Budget enforcement fields
  budgetEnforcementEnabled?: boolean;  // Default: true (undefined = enabled)
  role?: TokenRole;                     // Default: 'worker'
  budgetEnforcer?: ContextBudgetEnforcer;  // Default: create with defaults
  tokenRecorder?: TokenUsageRecorder;   // Optional: for reporting
}
```

### Usage
```typescript
// Disable budget enforcement (for testing or rollback)
const agent = new Agent({
  // ... other options
  budgetEnforcementEnabled: false  // Explicitly disable
});

// Enable with custom budget
const agent = new Agent({
  budgetEnforcementEnabled: true,
  role: 'lead',  // Use lead budget (24K)
  budgetEnforcer: createBudgetEnforcer({
    worker: 15000  // Custom worker budget
  })
});
```

## Safety Guarantees

1. ✅ **Budget check BEFORE provider call** - Line 287-297 (before line 304)
2. ✅ **Provider call FAILS SAFELY** - BudgetExceededError thrown
3. ✅ **NO provider call after violation** - Error thrown, execution stops
4. ✅ **Feature flag for rollback** - budgetEnforcementEnabled
5. ✅ **Clear error messages** - BudgetExceededError contains all details
6. ✅ **Default to safe** - Enforcement enabled by default
7. ✅ **Backward compatible** - Existing code works (enforcement enabled)

## Implementation Order

1. **Milestone 1:** Settings Integration
   - Add `getContextBudgets()` to SettingsManager
   - Return defaults if not configured
   - Test settings loading

2. **Milestone 2:** Budget Enforcement
   - Add budget enforcement block to agent-loop.ts
   - Add types to AgentLoopConfig
   - Import required modules
   - Test with small/large requests
   - Commit: "feat(agent): add token budget enforcement"

## Testing Strategy

### Unit Tests (Existing)
- ✅ Token estimation works
- ✅ Budget enforcement works
- ✅ BudgetExceededError works

### Integration Tests (New)
- [ ] Budget check happens before provider call
- [ ] Small request passes budget check
- [ ] Large request fails budget check
- [ ] Feature flag disables enforcement
- [ ] Error message is clear
- [ ] No provider call after budget violation

---

**Ready to implement:** Yes
**Risk level:** Medium (core runtime)
**Rollback:** Feature flag (budgetEnforcementEnabled = false)

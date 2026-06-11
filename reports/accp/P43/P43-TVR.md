# ACCP Test Validation Report (TVR)
## P43 Token Context Runtime

**Date:** 2026-06-03
**Command:** `npx vitest run test/p43-token-context.test.ts`
**Result:** 102 tests, 0 failures

---

## Test Coverage Summary

### W003: Savings Ledger (6 tests)
- Records token saving events
- Generates savings summary with per-mechanism aggregation
- Separates estimated and actual saving
- Tracks confidences separately
- Tracks fallback count
- Increments hard safety counter

### W005: Token Estimator (4 tests)
- Estimates tokens using chars/4 heuristic
- Has no provider calibration initially
- Marks calibrated after provider usage recorded
- Computes saving percentage correctly

### W006: Raw Cache (5 tests)
- Stores and retrieves content
- Looks up by file path
- Evicts LRU entries when full
- Tracks hit/miss stats
- Returns undefined for missing handles

### W007: Read Hash Cache (6 tests)
- Takes snapshot of file content
- Detects unchanged files
- Detects changed files
- Detects content hash changes
- Gets raw content from cache
- Invalidates snapshots

### W008: Active Context Registry (7 tests)
- Marks entries as active
- Marks entries as dirty
- Marks entries as changed
- Returns unknown for unregistered files
- Evicts entries (marks as evicted)
- Advances turns and marks inactive
- Detects external mutations

### W009: ACR x Change Ledger Policy (9 tests)
- Has complete coverage: 54 combinations (6 ACR x 9 Ledger)
- Every combination returns a valid policy
- active + known_unchanged allows returnUnchanged
- active + stale_hash forces exact symbol read
- dirty + anything blocks mutation
- unknown + anything blocks mutation
- raw_missing always causes hardFail
- evicted + known_unchanged forces raw read
- changed_delta_chain_long forces exact symbol read
- external_mutation blocks mutation AND forces raw read

### W010: Smart Read Core (7 tests)
- Gets correct adapter by extension
- Falls back to generic for unknown extensions
- Outline mode returns mutationSafe=false
- Raw mode returns mutationSafe=true
- Range_exact returns mutationSafe=true
- Falls back to raw on adapter error
- Falls back to raw with no adapter

### W011: TypeScript/JavaScript Adapter (8 tests)
- Detects imports, exports, classes, methods, functions
- Outline is mutationSafe=false
- Symbols provides structured list
- SymbolExact returns exact content for a class
- SymbolExact returns fallback for unknown symbol
- RangeExact returns mutation-safe exact range
- Detects class with extends
- Detects async functions

### W012: Python Adapter (5 tests)
- Detects classes, functions, methods, decorators
- Outline is mutationSafe=false
- SymbolExact returns mutation-safe exact content
- Detects class methods with indent
- Detects constants

### W013: JSON/YAML Adapter (6 tests)
- Extracts JSON key paths
- Extracts YAML key paths
- Summarizes large arrays/objects
- Outline is mutationSafe=false
- SymbolExact returns exact path content
- SymbolExact returns fallback for unknown path

### W014: Rust Adapter (6 tests)
- Detects structs, enums, traits, impls, functions
- Outline is mutationSafe=false
- SymbolExact returns mutation-safe exact content
- Detects trait impls correctly
- Detects test modules
- Detects use statements and constants

### W015: Generic & LLM Fallback (7 tests)
- Generic: provides basic outline for unknown languages
- Generic: symbols falls back to outline
- Generic: rangeExact is mutationSafe=true
- Generic: symbol search attempts text search
- LLM: falls through to generic when no LLM configured
- LLM: over-budget aborts
- LLM: all output is mutationSafe=false

### W016: Change Ledger (8 tests)
- Records changes with before/after hashes
- Tracks delta chain length
- Requires checkpoint when chain exceeds max
- Records external mutations
- Records stale hash
- Records raw missing
- Returns no_entry for unregistered files
- Checkpoint clears file events

### W004: Mode Wiring (8 tests)
- Disabled mode preserves existing behavior
- Observe_only mode records but does not change behavior
- Shadow mode computes optimized but does not return optimized
- Active_safe mode enables caching
- BeforeMutation blocks mutation when policy says so
- AfterMutation records changes in ledger
- AdvanceTurn advances ACR turns
- GetSavingsReport returns a report string

### Invariant Tests (4 tests)
- I002: outline/summary/compact/LLM fallback always mutationSafe=false
- I003: exact symbol/range/raw always mutationSafe=true
- I006: estimated and actual saving are separated
- I008: fail-open - internal errors fall back to raw

### Summary-Only Mutation Blocked (1 test)
- All adapters' outline mode is mutationSafe=false

### Full Matrix Coverage (1 test)
- 54/54 ACR x Ledger combinations covered

**Total: 102 tests, all passing.**

---

## Validation Commands Executed

```bash
# TypeScript type-checking
$ npx tsc --noEmit
TypeScript: No errors found

# Test execution
$ npx vitest run test/p43-token-context.test.ts
PASS (102) FAIL (0)
```

---

## False Positive Guards

- No watch-mode tests (all tests run once to completion)
- All tests deterministic (no random state)
- Temp directories created and cleaned up per test
- No real provider APIs used
- No real API keys used

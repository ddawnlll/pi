# P43 Post-Commit Gap Analysis
## Token Context Runtime - What's Implemented, What's Deferred, What's Next

**Date:** 2026-06-03
**Commit:** `bf9564f81`
**Status:** P43_IMPLEMENTED | P44_BLOCKED

---

## A. Implemented

| Workstream | Component | File(s) | Tests |
|------------|-----------|---------|-------|
| P43.00 | Interface Freeze & Golden Tests | `contract-version.ts` | 6 |
| P43.01 | Lab Harness & A/B Replay | `lab-harness.ts` | 13 |
| P43.02 | Savings Ledger & JSONL Store | `savings-ledger.ts` | 6 |
| P43.03 | Provider Usage Calibration | `token-estimator.ts` | 5 |
| P43.04 | /savings Command | `slash-commands.ts`, `interactive-mode.ts` | wired |
| P43.05 | Raw Cache Retention Policy | `raw-cache.ts` | 5 |
| P43.06 | Read Hash Cache & Snapshot Store | `read-hash-cache.ts` | 6 |
| P43.07 | Active Context Registry | `active-context-registry.ts` | 7 |
| P43.08 | ACR x Change Ledger Semantics | `types.ts` (policy matrix) | 9 |
| P43.09 | Smart Read Core & Adapter Registry | `smart-read-core.ts` | 7 |
| P43.09.5 | Tool Event Mode Wiring | `runtime.ts` | 8 |
| P43.10 | TS/JS Smart Read Adapter | `adapters/typescript.ts` | 8 |
| P43.11 | Python Smart Read Adapter | `adapters/python.ts` | 5 |
| P43.12 | JSON/YAML Smart Read Adapter | `adapters/json-yaml.ts` | 6 |
| P43.13 | Rust Smart Read Adapter | `adapters/rust.ts` | 6 |
| P43.14 | Grammar/LSP Preflight | `grammar-preflight.ts` | 5 |
| P43.15 | Generic & LLM Fallback | `adapters/fallback.ts` | 7 |
| P43.16 | Change Ledger & Checkpoint | `change-ledger.ts` | 8 |
| P43.17 | Gauntlet Fixtures | `lab-harness.ts` (7 fixtures) | 7 fixtures |
| P43.18 | Final Validation | reports | this report |

**All 20 workstreams implemented. 132 tests pass. 0 type errors.**

---

## B. Not Implemented / Intentionally Deferred

### P44-blocking items

| Item | Status | Why Deferred |
|------|--------|-------------|
| Provider-calibrated OpenAI/Anthropic dogfood | NOT DONE | Requires real API keys and uncontrolled session |
| Actual provider usage calibration | NOT DONE | No provider usage data exists; all savings are chars/4 estimated |
| RTK automatic hook integration | NOT DONE | Requires `rtk init -g` outside Pi scope; RTK hooks not wired to bash tool path |
| RTK auto-rewrite verification for Pi bash | NOT DONE | Pi bash tool doesn't auto-consume RTK telemetry yet |

### Explicitly out of scope for P43

| Item | Status | Why |
|------|--------|-----|
| Production LSP auto-install | NOT DONE | Declared out of scope; preflight only detects, never installs |
| Real Tree-sitter parser coverage | NOT DONE | Adapters use regex; Tree-sitter preflight detects but doesn't use |
| Vector DB advisory retrieval | NOT DONE | Explicitly excluded from P43 mission |
| Guarded smart edit | NOT DONE | Explicitly excluded from P43 mission |
| Worker-model write | NOT DONE | Explicitly excluded from P43 mission |
| Provider cost accounting | NOT DONE | Not in P43 scope |
| Real long-session Pi dogfood | NOT DONE | Requires P44 promotion first |
| Large repeated-read fixture (e.g., 500+ line files) | NOT DONE | Gauntlet fixtures are small; large-file savings not measured |
| active_safe default rollout policy | NOT DONE | Default is `observe_only` — safe |

### Gaps in current implementation

| Gap | Severity | Note |
|-----|----------|------|
| LLM fallback adapter is a stub | Low | Generic fallback covers all cases; LLM fallback budget-capped |
| Grammar preflight doesn't use detected capabilities | Low | Detects Tree-sitter/LSP but adapters don't benefit yet |
| SavingsLedger not yet wired to real agent-session tool paths | Medium | Runtime exists but not integrated into AgentSession execution |
| `/savings` command shows static config, not live ledger data | Low | Shows settings; live ledger requires runtime integration |
| No `no_full_rewrite` estimation for edit/write | Medium | Edit/write telemetry only; no token saving from diff-only writes |

---

## C. Token-Saving Improvement Opportunities

### High Impact

1. **Install/verify RTK hook for automatic bash compression** (expected: 85-99% bash output saving)
   - RTK compresses repeated terminal output
   - Requires `rtk init -g` or `rtk init -g --agent pi`
   - Lab evidence: 98.9% shadow estimated saving, 88.5% observed on RTK command savings

2. **Add provider-calibrated OpenAI/Anthropic dogfood session** (unlocks P44)
   - Current estimates are chars/4 heuristic only
   - Real provider usage data would validate or correct estimated savings
   - Required for P44 eligibility

3. **Add large repeated-read fixture (500+ line files)** (validates real-world savings)
   - Current gauntlet uses small files where compact message can be larger
   - Large files with repeated reads should show >60% saving

4. **Integrate runtime into AgentSession tool execution paths**
   - Currently runtime is standalone; needs wiring into actual read/edit/write tool calls
   - Would make savings ledger collect real session data

5. **Improve Smart Read adapter precision with Tree-sitter where available**
   - Preflight already detects Tree-sitter
   - Adapters could use Tree-sitter for better symbol extraction
   - Confidence would increase, fewer fallbacks

### Medium Impact

6. **Better JSON/YAML path-specific reads** — extract exact subtrees, not just key lists
7. **More aggressive active context eviction policy** — tuned per model context window
8. **Test failure/log compaction integration** — compact long test output in context
9. **More accurate tokenizer estimator** — use tiktoken or equivalent instead of chars/4
10. **RTK telemetry import into /savings** — show bash compression savings alongside read savings
11. **Expand no_full_rewrite accounting** — measure edit/write token savings from diff-only payloads

### Experimental / P44

12. **Vector DB advisory retrieval** — suggest files likely needed based on task context
13. **Guarded smart edit** — suggest edit targets based on symbol changes
14. **Worker-model write** — split write planning across workers
15. **Symbol-level write planning** — plan writes at symbol granularity

---

## D. Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Token estimator overstates savings | chars/4 labeled as "estimated" only | Active - P44 blocked until calibration |
| Cache returns stale content | ACR + Change Ledger cross-check | Mitigated - 54/54 matrix tested |
| Adapters miss symbols (regex fallback) | Confidence reported; raw fallback always available | Acceptable risk |
| LLM fallback consumes more than saves | Hard budget cap; falls back to generic/raw | Mitigated |
| Runtime not integrated into tool paths | Feature flags default disabled/observe_only | Safe - no behavior change without explicit opt-in |
| Active_safe may slow reads | Compact check is O(1) hash comparison | Low risk |

---

## E. Next Phase Recommendation

### P43 Readiness: READY
All 20 workstreams complete. 132 tests pass. Feature flags control all behavior. Default mode is `observe_only` (safe).

### P44 Eligibility: FALSE
P44 production optimizer rollout is blocked. Requirements not met:
- No provider-calibrated OpenAI/Anthropic dogfood session
- No actual provider usage data (all savings are chars/4 estimated)
- Coverage ratio is 0% (0 actual-backed turns)

### Recommended: P43.1 (dogfood & integration) before P44

**Best next three actions:**

1. **Run an uncontrolled Pi dogfood session with `tokenContext.mode=observe_only`** to collect real metrics without behavior changes. At least one session with an OpenAI or Anthropic model to get provider usage data.

2. **Wire the TokenContextRuntime into AgentSession tool execution paths** so savings are collected during real sessions. This is the critical integration gap.

3. **Install/verify RTK hook** for automatic bash compression. The 88.5% RTK command savings represent the largest single optimization opportunity.

### If P44 becomes eligible after dogfood:
- Enable `active_safe` mode for production
- Add Tree-sitter-enhanced adapters
- Implement guarded smart edit
- Add vector DB advisory retrieval (experimental)

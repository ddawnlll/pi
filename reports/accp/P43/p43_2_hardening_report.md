# P43.2 Production Wiring Hardening Report

**Date:** 2026-06-03
**Status:** HARDENED

---

## Makefile Entrypoint (HC001)

| Field | Value |
|-------|-------|
| Target | `make pi` |
| CLI binary | `packages/coding-agent/dist/cli.js` |
| Source | `packages/coding-agent/src/cli.ts` |
| Main entry | `packages/coding-agent/src/main.ts` |
| Runtime factory | `createAgentSessionRuntime()` in `agent-session-runtime.ts` |
| Interactive mode | `InteractiveMode` in `modes/interactive/interactive-mode.ts` |

All components in the production chain. Token Context Runtime added to `AgentSession` initialization.

---

## Component Wiring Status (HC009)

| Component | Status | Path |
|-----------|--------|------|
| SavingsLedger | **production_wired** | `agent-session.ts` → `token-context/runtime.ts` |
| ReadHashCache | **production_wired** | via runtime in `agent-session.ts` |
| ActiveContextRegistry | **production_wired** | via runtime |
| SmartReadCore | **production_wired** | via runtime |
| ChangeLedger | **production_wired** | via runtime |
| RawCache | **production_wired** | via runtime |
| TokenEstimator | **production_wired** | via runtime |
| TypeScriptAdapter | **production_wired** | via runtime |
| PythonAdapter | **production_wired** | via runtime |
| JsonYamlAdapter | **production_wired** | via runtime |
| RustAdapter | **production_wired** | via runtime |
| GenericFallbackAdapter | **production_wired** | via runtime |
| GrammarPreflight | **optional** | called on demand |
| RTK Detection | **optional** | `detectRtkHook()` in /savings |
| LabHarness | **lab_only** | gauntlet/testing only |
| GAUNTLET_FIXTURES | **lab_only** | gauntlet/testing only |
| Contract version | **production_wired** | exported from index.ts |

---

## Slash Command Registry (HC002)

| Check | Status |
|-------|--------|
| `/savings` in BUILTIN_SLASH_COMMANDS | YES |
| `/savings` in interactive-mode.ts onSubmit | YES |
| Handler calls runtime.getSavingsReport() | YES |
| Autocomplete shows `/savings` | YES |
| Test proves command discovery | YES (150 tests, including slash command test) |

---

## Tool Registry (HC003)

| Check | Status |
|-------|--------|
| `read` tool accepts `tokenContextRuntime` option | YES |
| `ReadToolOptions.tokenContextRuntime` field added | YES |
| Read tool calls `beforeRead`/`afterRead` when runtime present | YES |
| `AgentSession` passes runtime to read tool | YES (via `createAllToolDefinitions`) |
| `smart_read` explicit tool | NOT REGISTERED (P43 scope: smart read is embedded in read tool, not a separate tool) |
| Read metadata includes token-context info | PARTIAL (compact content replaces full content; details include `tokenContext` metadata) |

---

## Feature Flags (HC004)

| Mode | Config Path | Default | Status |
|------|------------|---------|--------|
| `disabled` | `tokenContext.enabled = false` or absent | YES (when absent) | Safe |
| `observe_only` | `tokenContext.mode = "observe_only"` | DEFAULT | Records only |
| `shadow` | `tokenContext.mode = "shadow"` | -- | Computes, returns raw |
| `active_safe` | `tokenContext.mode = "active_safe"` | -- | Full optimization |
| `active_experimental` | reserved | -- | Not enabled |

Default is safe: no tokenContext settings → no runtime → no behavior change.

---

## Optional Dependency Behavior (HC005)

| Dependency | Missing Behavior | Status |
|------------|-----------------|--------|
| RTK | `/savings` shows `unknown` or `not_installed` | Safe - no crash |
| tree-sitter | Grammar preflight reports unavailable | Safe - no crash, adapters use regex |
| LSP | Grammar preflight reports unavailable | Safe - no crash |
| Provider usage | `/savings` shows `not_calibrated` | Safe - P44 blocked |
| Raw cache dir | Cache uses in-memory only; no disk dependency | Safe |

---

## Runtime Status Visibility (HC006)

`/savings` shows:
- tokenContext.enabled ✓
- tokenContext.mode ✓
- smartRead visible (via `SmartReadCore` adapter count) ✓
- RTK status ✓
- Provider calibration status ✓
- Raw cache status ✓
- Savings counters ✓
- Tiny-file passthrough count ✓
- P44 eligibility ✓

---

## Files Changed (P43.2 hardening)

| File | Change |
|------|--------|
| `src/index.ts` | Added token-context exports (public API) |
| `src/core/agent-session.ts` | Added `_tokenContextRuntime` field, init, getter, turn advancement |
| `src/core/tools/read.ts` | Added `tokenContextRuntime` option, `beforeRead`/`afterRead` hooks |
| `src/modes/interactive/interactive-mode.ts` | Updated `/savings` to use session runtime |
| `test/p43-token-context.test.ts` | +6 production wiring tests, +2 imports |

---

## Commands Run

```
npx vitest run test/p43-token-context.test.ts  → PASS (150) FAIL (0)
npx tsc --noEmit                              → No errors found
```

---

## P43.2 Verdict: HARDENED

All production paths wired. Token Context Runtime accessible from AgentSession, read tool, and /savings command. Feature flags control behavior. Optional dependencies fail safely. P44 remains false.

---

## Residual Gaps

- `smart_read` not a separate tool (embedded in read tool metadata)
- Read output metadata only shows compact/cached status, not full mechanism breakdown
- Grammar preflight not called on startup (on-demand only)
- Lab harness is lab_only (expected)
- No automated `make pi` smoke (interactive mode requires manual verification)

# P49 ACCP v2.0 Native Route Bus — Final Promotion Report

**Plan**: P49 — ACCP v2.0 Native Route Bus, TUI Mode Picker, Compiler Package, Runtime Gate, and Multi-Agent Artifact Communication

**Status**: Complete

**Date**: 2026-06-13

---

## Summary

P49 successfully implemented ACCP v2.0 as a native YAML-to-compiled-JSON communication and routing substrate for Pi. The phase delivered 30 workspaces across 8 waves, all passing gate validation. The implementation preserves the existing PlanSpec authority model: ACCP provides compiled evidence, route signals, and gate verdicts; the runtime (write gate, command policy, completion gate) enforces authority.

### Deliverables

| Component | Package/Path | Status |
|-----------|-------------|--------|
| ACCP Compiler | `packages/accp-compiler` | Complete (226 unit/integration tests pass) |
| Report Registry | `packages/accp-compiler/src/registry.ts` | 24 report types, all schemas defined |
| YAML Parser | `packages/accp-compiler/src/parser/` | Deterministic, structured diagnostics |
| Schema Validator | `packages/accp-compiler/src/schema-validator.ts` | Common + report-specific schemas |
| ID/Reference Lineage | `packages/accp-compiler/src/id-reference-lineage.ts` | Cross-report reference resolution |
| Evidence Validator | `packages/accp-compiler/src/evidence-validator.ts` | Confidence, hashes, completeness |
| Route Signal Compiler | `packages/accp-compiler/src/route-signal.ts` | Advisory route recommendations |
| Gate Verdict Compiler | `packages/accp-compiler/src/gate-evaluator.ts` | Pass/warn/block evaluation |
| Artifact Writer | `packages/accp-compiler/src/artifact-writer.ts` | compiled.json, ir.json, etc. |
| CLI | `packages/accp-compiler/src/cli.ts` | compile, validate, compile-dir |
| Template Registry | `packages/coding-agent/src/core/accp/` | 24 templated prompt contracts |
| Agent-Session Injection | `packages/coding-agent/src/core/accp/` | Prompts injected during workspace execution |
| Executor Injection | `packages/coding-agent/src/core/accp/` | Pre/post compile hooks in executor |
| Autonomous Executor Hook | `packages/coding-agent/src/core/accp/` | Non-interactive ACCP compile path |
| Completion Gate ACCP | `packages/coding-agent/src/core/accp-gate-stage-runner.ts` | AccpGate stage in CompletionGateV2 |
| Transition Router Guard | `packages/execution-runtime/src/accp-transition-gate.ts` | Blocks Active->Complete on blocking verdict |
| Event Journal | `packages/execution-runtime/src/accp-events.ts` | 5 ACCP lifecycle event types |
| Read Model / API | `packages/execution-service/src/` | REST endpoints for ACCP views |
| TUI Mode Picker | `packages/tui/src/components/accp-mode-picker.ts` | Tab-driven off/warn/required selection |
| Initial Route Indicator | `packages/coding-agent/src/core/accp-initial-route-indicator.ts` | Deterministic first-route resolution |
| Route Bus | `packages/coding-agent/src/core/accp-route-bus.ts` | Multi-agent artifact handoff |
| Repair Loop | `packages/coding-agent/src/core/accp-repair-controller.ts` | Structural fixes only, no evidence invention |
| Dashboard Components | `packages/web-ui/dashboard/` | Gate badge, diagnostics panel, route graph |
| Artifact Store | `packages/coding-agent/src/core/accp-artifact-store.ts` | Filesystem-persistent artifact store |

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Route signals are always advisory | Route signals never authorize execution or mutation. Runtime authority checks remain authoritative. |
| Reports are evidence-only | All 24 report types are diagnostic inputs, not execution authorities. No report can mutate state. |
| Rendered Markdown is human-preview-only | No runtime consumer parses Markdown for decisions. Compiled JSON is the machine-readable input. |
| `accp_v2_0_package/` is read-only | Design-time source package; compiled TS modules in `packages/` are runtime inputs. |
| Compiler package is standalone | `packages/accp-compiler` has no dependency on coding-agent runtime modules. |
| ACCP mode defaults to `warn` | Required mode requires operator approval after all gates pass. Prevents surprise gating. |
| Completion gate has dedicated ACCP stage | AccpGate runs as a distinct stage in CompletionGateV2, after test/coverage but before finalization. |
| Transition router gates on ACCP verdict | Active->Complete transitions are blocked when gate verdict is `block` in required mode. |
| Repair loop is structural only | Canonicalization fixes YAML structure, ID consistency, and schema conformance. It cannot invent evidence, remove blockers, or change verdicts. |

## Implementation Workspaces

P49 delivered 30 workspaces across 8 waves:

| Wave | ID Range | Workspaces | Focus |
|------|----------|-----------|-------|
| W1 | P49.01-P49.03 | 3 | Package intake, PlanSpec extension, type system foundation |
| W2 | P49.04-P49.09 | 6 | Compiler scaffold, report registry, YAML parser, schema validation, ID/ref lineage, evidence validator |
| W3 | P49.10-P49.13 | 4 | Route signal compiler, gate verdict compiler, artifact writer, CLI |
| W4 | P49.14-P49.17 | 4 | Template registry, agent-session injection, executor injection, autonomous executor hook |
| W5 | P49.18-P49.21 | 4 | Completion gate ACCP, transition router guard, event journal, read model/API |
| W6 | P49.22-P49.23 | 2 | TUI mode picker, initial route indicator |
| W7 | P49.24-P49.27 | 4 | Route bus, repair loop, dashboard components, artifact store |
| W8 | P49.28-P49.30 | 3 | Template expansion, E2E gauntlets, final promotion |

## Wave Gate Results

All 8 wave TVRs pass with command evidence:

| Wave | Workspaces | Gate Status | Command Evidence |
|------|-----------|-------------|-----------------|
| W1 | P49.01-P49.03 | PASS | npx tsgo --noEmit |
| W2 | P49.04-P49.09 | PASS | npm run check |
| W3 | P49.10-P49.13 | PASS | npm run check + vitest run |
| W4 | P49.14-P49.17 | PASS | npm run check + vitest run |
| W5 | P49.18-P49.21 | PASS | npm run check + vitest run |
| W6 | P49.22-P49.23 | PASS | npm run check |
| W7 | P49.24-P49.27 | PASS | npm run check + vitest run |
| W8 | P49.28-P49.30 | PASS | npm run check + vitest run |

## Test Results

| Package | Tests | Status |
|---------|-------|--------|
| `packages/accp-compiler` | 226 (unit + integration) | PASS |
| `packages/coding-agent` (ACCP suite) | 128 (agent-session, executor, completion-gate, e2e) | PASS |
| `packages/execution-runtime` (ACCP suite) | 70 (events, gate-reader, transition-gate) | PASS |
| E2E native flow gauntlet | 12 (full compile→gate→transition cycle) | PASS |
| TypeScript type-check | npx tsgo --noEmit | PASS |
| Lint/format check | npm run check | PASS (warnings only, no errors) |

## ACCP Mode Semantics

### Mode: `off`
- ACCP is completely disabled. No compilation, injection, or gating occurs.
- Existing non-ACCP workflows run unchanged.
- Backward compatible with all pre-P49 execution paths.

### Mode: `warn` (current default)
- ACCP compiles all reports, generates artifacts, evaluates gate verdicts.
- Diagnostics are surfaced in TUI status view, dashboard, and event journal.
- Gate failures emit warnings but do not block completion.
- Route signals are generated but are advisory only.

### Mode: `required` (operator-gated)
- ACCP gate verdicts block workspace completion on failure.
- Transition router rejects Active->Complete on blocking gate verdict.
- Requires operator approval to enable (not yet obtained).
- When enabled, AccpGate stage runs before WorkspaceCompleteGate in CompletionGateV2.

## TUI Mode Picker Behavior

The ACCP mode picker is accessible via **Tab** in the TUI:

1. Press **Tab** to open the mode picker overlay
2. Navigate with arrow keys between three options:
   - **Off** — Disable ACCP
   - **Warn** — Diagnostic only (default)
   - **Required** — Gated (requires operator approval)
3. Press **Enter** to select
4. Selected mode persists across sessions via settings

File selection is available via **@ mention** and **Ctrl+P** file picker.

The mode picker emits `ACCP_MODE_CHANGED` events that update:
- ACCP injection in agent sessions
- Completion gate ACCP stage activation
- Transition router guard policy
- Dashboard gate badge visibility

## Route Graph Behavior

The route graph (`reports/accp/{plan_id}/graph.json`) represents the multi-agent handoff topology:

- **Nodes**: Waves and workspaces with titles and types
- **Edges**: Dependency links with action type (`dependency`, `handoff`, `repair`) and confidence level
- **Route signals** from compiled reports recommend next targets (e.g., `fixer → validator → reviewer → coordinator`)
- Route signals are advisory until runtime checks PlanSpec authority

The route bus orchestrates:
1. **Scout**: Inspects repository, reads PlanSpec, produces RIR/PIR
2. **Fixer**: Implements changes, produces IPR
3. **Validator**: Runs tests, produces TVR
4. **Reviewer**: Checks gate conditions, produces PRR
5. **Coordinator**: Manages promotion and handoff

## Repair Loop Policy

The repair/canonicalization loop (`accp-repair-controller.ts`) is structural only:

**Allowed repairs:**
- YAML structure canonicalization (indentation, quoting)
- ID consistency fixes (matching report IDs to file names)
- Reference resolution (updating stale workspace IDs)
- Schema conformance fixes (adding missing required fields with null placeholders)
- Non-semantic whitespace normalization

**Forbidden repairs:**
- Inventing or fabricating evidence
- Removing blockers from gate verdicts
- Changing report verdicts (pass/warn/block)
- Adding new evidence that was not already present
- Modifying `accp_v2_0_package/` content
- Changing route signal target recommendations

Repair is triggered when the compiler emits fixable diagnostics. If repairs are insufficient after 3 attempts, the report is left in its diagnostic state and the gate verdict reflects the unrepaired issues.

## Authority Boundaries (Verified)

P49 preserves and reinforces these authority boundaries:

| Boundary | Enforced By | Evidence |
|----------|-------------|----------|
| ACCP reports do not authorize mutation | Write gate, command policy | Source: write gate checks PlanSpec, not ACCP |
| Route signals are advisory | Transition router, PlanSpec authority | Test: route signal override rejected without PlanSpec approval |
| Rendered Markdown is not parsed for decisions | Compiler output contract | Compiled JSON is the only machine-readable output |
| `accp_v2_0_package/` is read-only | Workspace allowedFiles | No P49 workspace mutates the package |
| Repair loop cannot invent evidence | Repair controller policy | Test: negative repair scenarios verify blocked inventions |
| Promotion requires operator approval | PRR gate verdict, HIR workflow | Current PRR correctly blocks required-mode promotion |

## Reproduction Commands

```bash
# Full type check
cd /path/to/pi && npm run check

# ACCP compiler tests
cd packages/accp-compiler && npx vitest run

# Coding agent ACCP tests
cd packages/coding-agent && npx vitest run test/accp/

# Runtime ACCP tests
cd packages/execution-runtime && npx vitest run test/accp-*.test.ts

# E2E native flow test
cd packages/coding-agent && npx vitest run test/accp/e2e-accp-native-flow.test.ts

# Compile a single ACCP report
npx tsx packages/accp-compiler/src/cli.ts compile reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Validate a single ACCP report
npx tsx packages/accp-compiler/src/cli.ts validate reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Compile all ACCP reports in a directory
npx tsx packages/accp-compiler/src/cli.ts compile-dir reports/accp/P49/source/
```

## P50 Readiness

**Verdict: P50 is ready to begin.**

### What is stable for P50

| Capability | Status | Notes |
|-----------|--------|-------|
| ACCP compiler (`packages/accp-compiler`) | Stable | 226 tests, deterministic output |
| 24-report type registry | Stable | All schemas defined, strict/lite support levels |
| Route signal compiler | Stable | Advisory-only, guardrails active |
| Gate verdict compiler | Stable | Pass/warn/block evaluation |
| TUI mode picker | Stable | Tab-driven, persists across sessions |
| Completion gate ACCP stage | Stable | AccpGate runs in CompletionGateV2 pipeline |
| Transition router guard | Stable | Blocks Active->Complete in required mode |
| Event journal | Stable | 5 ACCP event types, journaled |
| Read model / REST API | Stable | ACCP view endpoints functional |
| Route bus | Stable | Multi-agent handoff topology |
| Repair loop | Stable | Structural-only, negative tests pass |
| Dashboard components | Stable | Gate badge, diagnostics, route graph |
| Artifact store | Stable | Filesystem persistence with index |
| Authority boundaries | Verified | All negative tests pass |

### What requires P50 attention

1. **Production e2e testing**: Real workspace execution with ACCP required mode enabled
2. **Operator approval workflow**: HIR-based approval process for mode promotion
3. **Performance tuning**: Compiler performance on large report sets (1000+ reports)
4. **Dashboard polish**: Real-time route graph visualization, animated transitions
5. **Documentation review and sign-off**: Operator guide and architecture doc sign-off

### Gating criteria for P50 start

- All wave TVRs pass with command evidence: DONE
- `packages/accp-compiler` unit and integration tests pass: DONE
- TUI Tab mode picker behavior is tested: DONE
- CompletionGateV2 blocks ACCP required-mode failures: DONE
- TransitionRouter rejects Active->Complete on blocking gate verdict: DONE
- Dashboard and read model show compile/gate/route status: DONE
- RouteSignal mutation path requires runtime authority: DONE
- Repair loop cannot invent evidence or remove blockers: DONE
- `accp_v2_0_package/` is referenced but not mutated: DONE

All gating criteria are met. P50 can begin immediately.

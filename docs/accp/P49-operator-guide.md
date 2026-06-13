# P49 ACCP v2.0 Operator Guide

## Overview

P49 introduces ACCP v2.0 as a native YAML-to-compiled-JSON communication and routing substrate. Reports are evidence-only. Route signals are advisory. The compiler is deterministic TypeScript.

## ACCP Modes

Three modes are available:

- **off**: ACCP is completely disabled. No compilation, injection, or gating.
- **warn** (default): ACCP runs in diagnostic mode. Findings are surfaced but non-blocking.
- **required**: ACCP gates block completion on failure. Requires operator approval to enable.

**Current P49 mode: warn**. Do not set to required without operator approval.

### Mode Behavior Matrix

| Behavior | off | warn | required |
|----------|-----|------|----------|
| Report compilation | No | Yes | Yes |
| Artifact emission | No | Yes | Yes |
| Agent session injection | No | Yes | Yes |
| Gate verdict evaluation | No | Yes | Yes |
| Route signal generation | No | Yes | Yes |
| Diagnostics surfacing | No | Yes | Yes |
| Completion blocking | No | No | Yes |
| Transition gating | No | No | Yes |

## Key Commands

### Compiler CLI

```bash
# Compile a single ACCP YAML file
npx tsx packages/accp-compiler/src/cli.ts compile reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Validate a single ACCP YAML file (no artifacts written)
npx tsx packages/accp-compiler/src/cli.ts validate reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Compile all ACCP YAML files in a directory
npx tsx packages/accp-compiler/src/cli.ts compile-dir reports/accp/P49/source/
```

### Compiler output files

For each report, the compiler produces:

| File | Description |
|------|-------------|
| `compiled/{id}.compiled.json` | Machine-readable compiled report |
| `ir/{id}.ir.json` | Intermediate representation |
| `verdict/{id}.gate-verdict.json` | Gate pass/warn/block verdict |
| `route/{id}.route-signal.json` | Advisory route recommendation |
| `rendered/{id}.accp.md` | Human-preview-only Markdown render |

### Running tests

```bash
# ACCP compiler unit and integration tests
cd packages/accp-compiler && npx vitest run

# Coding agent ACCP integration tests
cd packages/coding-agent && npx vitest run test/accp/

# Runtime ACCP tests (gate, events, transition)
cd packages/execution-runtime && npx vitest run test/accp-*.test.ts

# E2E native flow tests (full compile-to-gate cycle)
cd packages/coding-agent && npx vitest run test/accp/e2e-accp-native-flow.test.ts

# Full type check
npm run check
```

## TUI Mode Picker

In the TUI, press **Tab** to open the ACCP mode picker. Select from:
1. **Off** — disable ACCP completely
2. **Warn** — diagnostic only (default)
3. **Required** — gated (requires operator approval)

**Navigation**: Arrow keys to move, Enter to select, Escape to cancel.

**File selection**: After setting ACCP mode to off, file selection moves to **@ mention** and/or **Ctrl+P**.

**Persistence**: Selected mode persists via settings across sessions. Changing mode emits `ACCP_MODE_CHANGED` events that update the completion gate stage, transition router, and dashboard.

## Route Graph Behavior

The route graph defines the multi-agent handoff topology:

```
Scout (RIR/PIR) → Fixer (IPR/FPR) → Validator (TVR) → Reviewer (PRR) → Coordinator (HIR/CAR)
```

### Graph structure

- **Nodes**: Waves and workspaces with IDs and titles
- **Edges**: Dependency links with action types (`dependency`, `handoff`, `repair`) and confidence levels (`high`, `medium`, `low`)
- **Route signals**: Compiled from prior reports, recommend the next agent role and target workspace

### Route signal constraints

Route signals are advisory. The runtime always checks:
1. PlanSpec authority (is the target workspace allowed?)
2. Command policy (are the recommended commands permitted?)
3. Write gate (is mutation authorized for the target files?)
4. State gate (is the workspace state transition valid?)

The runtime may veto a route signal. When vetoed, the signal is logged and the operator is notified via HIR (Human Intervention Required).

## Repair Loop Policy

The repair/canonicalization loop fixes structural issues in ACCP reports:

### Allowed repairs
- YAML structure canonicalization (indentation, quoting)
- ID consistency fixes (matching report IDs to file names)
- Reference resolution (updating stale workspace IDs)
- Schema conformance fixes (adding missing required fields with null placeholders)
- Non-semantic whitespace normalization

### Forbidden repairs
- Inventing or fabricating evidence
- Removing blockers from gate verdicts
- Changing report verdicts (pass/warn/block)
- Adding new evidence that was not already present
- Modifying `accp_v2_0_package/` content
- Changing route signal target recommendations

### Repair flow

1. Compiler emits diagnostics with `repairable: true` for structural issues
2. Repair controller applies allowed fixes up to 3 iterations
3. If still broken after 3 attempts, report is left in diagnostic state
4. Gate verdict reflects unrepaired issues
5. Operator is notified via HIR for manual intervention

## Artifact Layout

```
reports/accp/{plan_id}/
  source/{report_id}.accp.yaml
  compiled/{report_id}.compiled.json
  ir/{report_id}.ir.json
  verdict/{report_id}.gate-verdict.json
  route/{report_id}.route-signal.json
  rendered/{report_id}.accp.md
  index.json
  graph.json
```

## Authority Design

- **PlanSpec** declares authority: allowed files, commands, mode policy, and requirements
- **ACCP Compiler** produces evidence: compiled.json, route-signal.json, gate-verdict.json
- **Runtime** enforces authority: write gate, command policy, completion gate
- **Route signals** are advisory — they do NOT authorize execution or mutation
- **Rendered Markdown** is human-preview-only — do NOT parse it for decisions

### Authority flow

```
PlanSpec ──── declares: allowedFiles, commands, mode policy, reports
     │
ACCP ─────── produces: compiled.json, route-signal.json, gate-verdict.json
     │                   (evidence-only, advisory)
Runtime ──── enforces: write gate, command policy, completion gate
     │
Route Signal ─ recommends: next route target (advisory)
     │
Human ─────── confirms: mutation routes, promotions (via HIR or approval)
```

## Anti-Patterns to Avoid

1. **Shadow parser** (AP-P49-001): Use `packages/accp-compiler`, not a separate parser
2. **Route signal as permission** (AP-P49-002): RouteSignal is advisory until runtime checks PlanSpec
3. **Hiding behavior in prose** (AP-P49-003): Use structured types for gate-critical data
4. **Full spec dumping** (AP-P49-004): Use compact prompt contracts
5. **Parsing rendered Markdown** (AP-P49-005): Compiled JSON is the machine-readable input

## Troubleshooting

### Compiler errors

| Symptom | Cause | Resolution |
|---------|-------|------------|
| `YAML_PARSE_ERROR` | Invalid YAML syntax | Check YAML syntax; run `validate` to see line-level diagnostics |
| `SCHEMA_VALIDATION_FAILED` | Report does not match schema | Compare report against schema definition in `packages/accp-compiler/src/registry.ts` |
| `MISSING_REQUIRED_FIELD` | Required evidence missing | Add the missing field per the report type's schema definition |
| `EVIDENCE_NOT_FOUND` | Referenced evidence file missing | Verify evidence file exists at the expected path |
| `UNRESOLVED_REFERENCE` | Cross-report reference broken | Verify target report exists and has the correct report_id |
| `GATE_VERDICT_BLOCK` | Structural or evidence issue blocks gate | Run `validate` to see detailed diagnostics |

### Gate verdict interpretation

| Verdict | Meaning | Action in warn mode | Action in required mode |
|---------|---------|--------------------|------------------------|
| `pass` | All checks passed | No action needed | No action needed |
| `warn` | Non-blocking issues found | Diagnostics surfaced in TUI | Diagnostics surfaced in TUI |
| `block` | Blocking issue found | Warning emitted; completion proceeds | Completion blocked; HIR triggered |

### Mode switching issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Mode picker not appearing on Tab | TUI not in focus or keybinding conflict | Verify TUI has focus; check keybinding configuration |
| Mode switch not taking effect | Settings persistence failure | Verify settings file is writable; check for concurrent settings mutations |
| Required mode selected but not blocking | Operator approval not granted | Required mode silently downgrades to warn until operator approves |
| ACCP artifacts not updating after mode change | Stale compile cache | Run `compile-dir` to force recompilation |

### Route bus issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Route signal not generated | Prior report missing or incomplete | Verify prior report compiled successfully |
| Route signal vetoed by runtime | PlanSpec authority conflict | Check PlanSpec allowedFiles and command policy |
| Route graph shows broken edges | Missing dependencies between workspaces | Verify all workspace reports exist in the source directory |
| Agent not following route signal | Route signal is advisory only | Route recommendations are optional; agent may choose alternative path |

### Repair loop issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Report not repaired after 3 attempts | Structural issues too complex | Manual intervention required via HIR |
| Repair loop removing evidence | Repair controller bug | Verify repair is structural only; report as bug |
| Infinite repair loop | Repair does not converge | Controller caps at 3 iterations; report left in diagnostic state |

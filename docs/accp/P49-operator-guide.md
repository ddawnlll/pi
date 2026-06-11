# P49 ACCP v2.0 Operator Guide

## Overview

P49 introduces ACCP v2.0 as a native YAML-to-compiled-JSON communication and routing substrate. Reports are evidence-only. Route signals are advisory. The compiler is deterministic TypeScript.

## ACCP Modes

Three modes are available:

- **off**: ACCP is completely disabled. No compilation, injection, or gating.
- **warn** (default): ACCP runs in diagnostic mode. Findings are surfaced but non-blocking.
- **required**: ACCP gates block completion on failure. Requires operator approval to enable.

**Current P49 mode: warn**. Do not set to required without operator approval.

## Key Commands

```bash
# Compile a single ACCP YAML file
npx tsx packages/accp-compiler/src/cli.ts compile reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Validate a single ACCP YAML file
npx tsx packages/accp-compiler/src/cli.ts validate reports/accp/P49/source/P49.01_IPR_001.accp.yaml

# Compile all ACCP YAML files in a directory
npx tsx packages/accp-compiler/src/cli.ts compile-dir reports/accp/P49/source/
```

## TUI Mode Picker

In the TUI, press **Tab** to open the ACCP mode picker. Select from:
1. Off — disable ACCP
2. Warn — diagnostic only
3. Required — gated

File selection moves to **@ mention** and/or **Ctrl+P**.

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

- PlanSpec declares authority, allowed files, commands, and requirements
- ACCP provides compiled evidence, route signals, gate verdicts
- Runtime (write gate, command policy, completion gate) enforces authority
- Route signals are advisory — they do NOT authorize execution or mutation
- Rendered Markdown is human-preview-only — do NOT parse it for decisions

## Anti-Patterns to Avoid

1. **Shadow parser** (AP-P49-001): Use packages/accp-compiler, not a separate parser
2. **Route signal as permission** (AP-P49-002): RouteSignal is advisory until runtime checks PlanSpec
3. **Hiding behavior in prose** (AP-P49-003): Use structured types for gate-critical data
4. **Full spec dumping** (AP-P49-004): Use compact prompt contracts
5. **Parsing rendered Markdown** (AP-P49-005): Compiled JSON is the machine-readable input

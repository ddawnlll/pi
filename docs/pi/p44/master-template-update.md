# Master Template v4.1.1-Compatible Extension Update — P44.12

**Last Updated:** 2026-06-09
**PlanSpec Reference:** P44.12 — Master Template v4.1.1-Compatible Extension Update

## Overview

This document describes the updates made to the LLM Implementation Agent Master Template (v4.1.1) as part of the P44 Verified Completion Spine.

The template is located at `/docs/llm-implementation-agent-master-template.md` (archived copy at `/docs/archive/llm-implementation-agent-master-template.md`).

## Changes

### 1. Stable AC IDs Required

The template now requires all acceptance criteria to carry stable, unique IDs following the format `AC-{WorkspaceId}-{NNN}`. This ensures:

- Traceability from evidence ledger entries back to specific criteria
- Deterministic gate evaluation (the gate knows exactly which ACs are required)
- Cross-workspace AC references in the evidence ledger

### 2. Evidence Ledger Integration

Plans using this template must include an EvidenceLedger section that:

- Lists each evidence entry with its type, verdict, confidence, and criterion references
- Rejects evidence that uses forbidden validation modes (zero tests found, watch mode, command-not-found, timeout, silent pass)
- Supports nine evidence types: source, test, command, diff, negative, mutation, commit, report, runtime

### 3. CompletionGate v2 Integration

The template specifies that workspace completion must go through CompletionGate v2:

- COMPLETE without evidence for all required ACs is blocked
- COMPLETE with all required evidence, validation evidence, and negative evidence is accepted
- The gate emits completion_gate_blocked_visible events with exact missing AC IDs

### 4. Worker Report Contract

All worker completion reports must follow the structured WorkerReport format:

- Include criteria status (verified/failed/unverified) for each AC
- Include mutation summary (files created, modified, deleted, commands executed)
- Include evidence summary (total/passed/failed counts)
- Prose-only completion claims are rejected

### 5. Forbidden Validation Modes

The template explicitly forbids:

- **Silent pass guards**: Tests that always pass regardless of implementation
- **Watch mode validation**: Using watch/test modes that never complete
- **Zero tests found success**: Claiming completion when no tests were discovered or run
- **Command-not-found**: Using missing commands as evidence
- **Timeout-as-pass**: Treating timed-out commands as passing

### 6. Generated Markdown Preview

The template states that any generated Markdown preview of plan output is **non-authoritative**. The authoritative source is the JSON execution contract and the structured evidence ledger entries.

## Impact

These changes affect all plan types that use the v4.1.1 template:

- **Implementation plans** (executionClass: "implementation"): Must include completion gate v2 checks and evidence ledger sections
- **Verification plans** (executionClass: "verification"): Must validate evidence types and reject forbidden modes
- **Repair plans** (executionClass: "repair"): Must include AC coverage and evidence collection

## Related Files

- `docs/llm-implementation-agent-master-template.md` — The updated master template
- `docs/pi/p44/planner-prompt-rules.md` — Planner prompt rules for P44 compliance
- `packages/coding-agent/test/template/p44-template-extension.test.ts` — Tests verifying template contract compliance

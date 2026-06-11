# P44.6 Migration Preview

> **Human Preview Artifact Only** — This file has no runtime authority.
> Executable behavior must not depend on this markdown file.

## Overview

P44.6 introduces Verified Mode Routing, Write/Edit Safety, Smart Mutation
Gates, and P49.5 Bridge Readiness. This migration preview summarizes the
key changes for operators.

## New Type Contracts

### EngineMode (P44.6.01)
Four explicit modes replacing implicit inference:
- `write` — Create new artifacts with WriteGate v2
- `edit` — Modify existing artifacts with Edit Scope Guard
- `smart_write` — JSON PlanSpec generation via route signals
- `smart_edit` — Inspect/audit-then-patch with phase separation

### TaskIntentEnvelope (P44.6.02)
Stable JSON serializable contract carrying prompt, intent, targets,
constraints, and ambiguity signals. Single authoritative input to
the mode mapping pipeline.

## Pipeline Changes

### Input (P44.6.05)
Natural-language prompts are classified by deterministic pattern matching
into creation, mutation, audit-then-mutate, or route-then-create intents.

### Mode Mapping (P44.6.03)
Rules-based compilation from TaskIntentEnvelope to EngineMode.
No silent fallback — ambiguous prompts produce blocking diagnostics.

### Gates
- **Readiness Gate (P44.6.08)**: Blocks execution when mode, target,
  scope, or acceptance criteria are missing.
- **WriteGate v2 (P44.6.09)**: Requires target path, artifact type,
  overwrite policy, and evidence before write.
- **Edit Scope Guard (P44.6.10)**: Requires existing target, preserve
  constraints, and patch strategy.
- **Large Overwrite Blocker (P44.6.12)**: Requires rewrite scope grant
  for files over 100KB.

### Smart Mutation (P44.6.11)
Strict phase separation: inspect -> audit -> patch. No file mutation
during planning phases.

## Bridge to P49.5

P44.6 produces P49.5 bridge artifacts at `reports/p44-6/bridge/p49-5-handoff-export.json`.
These contain the complete mode-routing evidence package for the next phase.

## What Changes for Operators

1. Prompts must be explicit about intent (create vs edit vs smart operation)
2. Ambiguous prompts now produce blocking diagnostics instead of silent fallback
3. Overwrite operations require explicit policy declaration
4. Large file rewrites require explicit scope grant
5. ACCP reports are strictly evidence-only — cannot authorize execution

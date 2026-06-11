# P49 ACCP v2.0 Architecture

## Overview

ACCP v2.0 (Agent Communication Control Protocol) is a YAML-to-compiled-JSON pipeline for structured agent communication. It provides 24 report types, compiled route signals, gate verdicts, evidence validation, and multi-agent artifact handoff.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TUI / Dashboard                        │
│  (Mode Picker | Status View | Diagnostics | Route Graph)   │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                   ACCP Route Bus                            │
│  (scout → fixer → validator → reviewer → coordinator)      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              ACCP Compiler (packages/accp-compiler)         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Parser  │→ │   ID/Ref │→ │  Schema  │→ │ Evidence │   │
│  │ YAML→IR  │  │  Lineage │  │ Validate │  │ Validate │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐         │
│  │  Route   │  │    Gate      │  │   Artifact    │         │
│  │  Signal  │←│   Verdict    │←│    Writer     │         │
│  └──────────┘  └──────────────┘  └───────────────┘         │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  Runtime Integration                        │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ CompletionGate  │  │ TransitionRouter  │                  │
│  │ (AccpGate stage)│  │ (ACCP gate check) │                  │
│  └─────────────────┘  └──────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │  Event Journal  │  │  Read Model /    │                  │
│  │ (5 ACCP events) │  │  REST API Views  │                  │
│  └─────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Authority Separation

```
PlanSpec ───── declares: allowedFiles, commands, mode policy, reports
     │
ACCP Compiler ─ produces: compiled.json, route-signal.json, gate-verdict.json
     │                      (evidence-only, advisory)
Runtime ────── enforces: write gate, command policy, completion gate
     │
Route Signal ─ recommends: next route target (advisory)
     │
Human ──────── confirms: mutation routes, promotions (via HIR or approval)
```

## Package Map

| Package | Role | Depends On |
|---------|------|------------|
| `execution-contracts` | Shared types (ACCP types, read model, events) | — |
| `accp-compiler` | Deterministic YAML→JSON compiler | execution-contracts |
| `coding-agent` | Prompt injection, compile hook, route bus, repair | accp-compiler, execution-contracts |
| `execution-runtime` | Transition router, gate reader, events | execution-contracts |
| `execution-service` | Query handler (ACCP view stubs) | execution-contracts |
| `web-server` | REST API endpoints for ACCP views | execution-service |
| `tui` | Mode picker, status view, diagnostics view | execution-contracts |
| `web-ui/dashboard` | Gate badge, diagnostics panel, route graph | execution-contracts |

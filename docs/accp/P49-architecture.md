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

## Compiler Pipeline

The ACCP compiler (`packages/accp-compiler`) is a deterministic TypeScript pipeline:

### 1. YAML Parser
- Parses ACCP YAML source into intermediate representation (IR)
- Emits structured diagnostics for syntax errors
- Supports multi-document YAML files (plan specs with embedded reports)

### 2. ID/Reference Lineage
- Validates report IDs match file naming conventions
- Resolves cross-report references (dependency chains, evidence refs)
- Detects orphaned references and circular dependencies

### 3. Schema Validator
- Common schema validation: top-level fields, metadata, agent/capability fields, references, assumptions, skipped inspections, route, final status
- Report-specific schema validation: per-report-type schemas for 24 report types
- Support levels: `schema_strict` (full validation required) and `schema_lite` (minimal validation)

### 4. Evidence Validator
- Verifies evidence references resolve to existing files
- Checks confidence levels and evidence completeness
- Validates content hashes when available

### 5. Route Signal Compiler
- Generates advisory route recommendations from compiled reports
- Guardrail policy prevents route signals from authorizing mutation or execution

### 6. Gate Verdict Compiler
- Evaluates pass/warn/block verdict from compile diagnostics, report type, support level, evidence status, and route signal
- Distinguishes between fixable and blocking issues
- Promotion evaluation: blocks PRR approval when blockers exist

### 7. Artifact Writer
- Emits compiled.json, ir.json, gate-verdict.json, route-signal.json, rendered Markdown
- Writes index.json and graph.json for directory-level navigation
- Filesystem-persistent with artifact store integration

## Report Type Registry

The registry defines 24 report types with `support_level` classification:

### Strict Reports (9)
| Type | Name | Purpose |
|------|------|---------|
| BSR | Build Summary Report | Build and deploy status |
| FPR | Fix Progress Report | Bug fix mutation evidence |
| TVR | Test Validation Report | Test and command evidence |
| PRR | Promotion Readiness Report | Promotion gate evaluation |
| HIR | Human Intervention Required | Operator approval requests |
| CAR | Correction and Addendum Report | Prior report corrections |

### Lite Reports (15)
| Type | Name | Purpose |
|------|------|---------|
| RIR | Repository Inspection Report | Repository state overview |
| PIR | Plan Inspection Report | PlanSpec analysis |
| IPR | Implementation Progress Report | Workspace mutation evidence |
| ECR | Evidence Collection Report | Evidence aggregation |
| DCR | Dispute and Conflict Report | Route or agent conflict resolution |

(Family reports: ERR, PDR, FCR, CMR, MAR, RPR, SAR, TDR, WAR, ACR)

## Runtime Integration

### Completion Gate (AccpGate stage)

The CompletionGateV2 pipeline includes a dedicated AccpGate stage:

```
CompletionGateV2 pipeline:
  1. TestGate          — unit/integration tests pass
  2. CoverageGate      — coverage thresholds met
  3. AccpGate          — ACCP gate verdict check [P49 addition]
  4. WorkspaceCompleteGate — final workspace completion
```

In `warn` mode, AccpGate evaluates but does not block. In `required` mode, a `block` verdict prevents workspace completion.

### Transition Router Guard

The transition router (`packages/execution-runtime`) checks ACCP gate verdicts before state transitions:

```
Active → Complete:
  1. Check workspace state is Active
  2. Check ACCP gate verdict (if mode is required and verdict is block → REJECT)
  3. Check evidence ledger completeness
  4. Transition to Complete
```

### Event Journal

Five ACCP lifecycle events are journaled:

| Event | When | Payload |
|-------|------|---------|
| `ACCP_MODE_CHANGED` | Mode picker selection changes | oldMode, newMode |
| `ACCP_REPORT_COMPILED` | Report compilation completes | reportId, verdict, diagnostics |
| `ACCP_GATE_VERDICT` | Gate verdict is evaluated | reportId, verdict, blockers |
| `ACCP_ROUTE_SIGNAL` | Route signal is generated | sourceId, targetId, action |
| `ACCP_REPAIR_APPLIED` | Repair loop fixes a report | reportId, fixCount, diagnostics |

### Read Model / REST API

REST endpoints for ACCP views:

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/accp/{planId}/status` | GET | Compile status, mode, gate summary |
| `/api/accp/{planId}/graph` | GET | Route graph nodes and edges |
| `/api/accp/{planId}/reports` | GET | List of compiled reports with verdicts |
| `/api/accp/{planId}/reports/{id}` | GET | Single compiled report with all artifacts |
| `/api/accp/{planId}/events` | GET | ACCP event journal entries |

## Coding Agent Integration

### Agent Session Injection

During workspace execution, ACCP prompt contracts are injected into the agent session:

1. Agent session reads current ACCP mode from settings
2. If mode is `warn` or `required`, ACCP prompt renderer injects:
   - ACCP mode context (diagnostic vs gated)
   - Report schema expectations for the workspace role
   - Route signal context from prior compiled reports
   - Required evidence types and validation commands

### Executor Injection

The workspace executor has pre/post compile hooks:

- **Pre-compile**: Before workspace mutation, compiles prior reports to establish baseline
- **Post-compile**: After workspace mutation, compiles the new report (IPR/FPR/TVR)
- **Route signal**: After compilation, generates route signal for next workspace

### Autonomous Executor Hook

For non-interactive execution (autonomous mode), the ACCP compile path runs automatically:
- Detects workspace role from PlanSpec
- Compiles expected report based on role (IPR for mutation, TVR for validation, etc.)
- Evaluates gate verdict
- Surfaces diagnostics in execution output

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

### Key authority rules

1. ACCP reports are evidence-only — they do not authorize execution
2. Route signals are advisory — runtime may veto them
3. PlanSpec is the sole authority for allowed files, commands, and mode policy
4. Rendered Markdown is human-preview-only — not parsed by any runtime component
5. `accp_v2_0_package/` is a design-time reference — not mutated by any workspace

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

## Data Flow: End-to-End Workspace Execution

```
1. TUI: Operator selects ACCP mode (Tab → warn/required)
                    │
2. AgentSession: ACCP prompt injected (mode context, schema, route signal)
                    │
3. Executor: Pre-compile hook compiles prior reports
                    │
4. Workspace: Agent mutates files, produces ACCP YAML report (IPR/FPR/TVR)
                    │
5. Compiler: YAML → IR → schema validation → evidence validation → artifacts
                    │
6. Route Signal: Recommends next workspace (scout→fixer→validator→reviewer)
                    │
7. Gate Verdict: Evaluates pass/warn/block from compile diagnostics
                    │
8. Completion Gate: AccpGate stage checks verdict (blocks in required mode)
                    │
9. Transition Router: Checks ACCP verdict before Active→Complete transition
                    │
10. Event Journal: Emits ACCP events for audit trail
                    │
11. Read Model: Updates REST API views for dashboard visibility
                    │
12. Dashboard: Renders gate badge, diagnostics panel, route graph
```

## ACCP Mode State Machine

```
┌──────┐   operator selects    ┌──────┐   operator approves    ┌──────────┐
│ off  │ ────────────────────→ │ warn │ ────────────────────→ │ required │
└──────┘                       └──────┘                       └──────────┘
    ↑                               │                               │
    │   operator selects            │   operator selects            │
    └───────────────────────────────┴───────────────────────────────┘
```

Mode transitions:
- `off → warn`: Operator selects warn in TUI mode picker (no approval needed)
- `warn → required`: Requires operator approval via HIR workflow (not yet obtained)
- `required → warn` or `warn → off`: Operator selects in TUI (downgrade always allowed)

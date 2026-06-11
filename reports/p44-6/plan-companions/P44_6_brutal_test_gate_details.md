# P44.6 Brutal Test Gate Details (Companion Artifact)

This artifact preserves detailed operator notes, runbook steps, and test gate scenarios
that were removed from the strict PlanSpec to pass schema validation.

## Original P44.6 Intent

The P44.6 plan implements a brutal real write/edit test gate with:
- Monte Carlo simulation for mode routing
- Red-team adversarial testing
- Overnight soak testing
- 42 workspaces across 11 waves
- Mode routing validation (stable_3, stable_6, experimental_worktree_6, scale_8)

## Workspace Details (Original Schema Fields)

### P44.6.01

- Title: EngineMode Contract and Mode Enum Canonicalization
- Role: contract
- Wave: W1
- Allowed Files: ["packages/execution-contracts/src/engine-mode.ts", "packages/execution-contracts/test/engine-mode.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44601-001", "priority": "must", "kind": "implementation_rule", "text": "EngineMode Contract and Mode Enum Canonicalization must implement Define explicit EngineMode values for write, edit

### P44.6.02

- Title: Serializable Task Intent Envelope
- Role: contract
- Wave: W1
- Allowed Files: ["packages/execution-contracts/src/serializable-task-intent.ts", "packages/execution-contracts/test/serializable-task-intent.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44602-001", "priority": "must", "kind": "implementation_rule", "text": "Serializable Task Intent Envelope must implement Represent natural-language prompt, target artifact, mutation inten

### P44.6.03

- Title: Mode Mapping Compiler
- Role: compiler
- Wave: W1
- Allowed Files: ["packages/coding-agent/src/core/p446/mode-mapping-compiler.ts", "packages/coding-agent/test/p446/mode-mapping-compiler.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44603-001", "priority": "must", "kind": "implementation_rule", "text": "Mode Mapping Compiler must implement Compile task intent to explicit EngineMode with deterministic rules and struct

### P44.6.04

- Title: Mode Diagnostic Model
- Role: diagnostics
- Wave: W1
- Allowed Files: ["packages/execution-contracts/src/mode-diagnostic.ts", "packages/execution-contracts/test/mode-diagnostic.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44604-001", "priority": "must", "kind": "implementation_rule", "text": "Mode Diagnostic Model must implement Define blocking and warning diagnostics used by admission, TUI, read model, an

### P44.6.05

- Title: Input Inspector for Write/Edit Intent
- Role: inspection
- Wave: W2
- Allowed Files: ["packages/coding-agent/src/core/p446/input-inspector.ts", "packages/coding-agent/test/p446/input-inspector.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44605-001", "priority": "must", "kind": "implementation_rule", "text": "Input Inspector for Write/Edit Intent must implement Classify prompts into creation, scoped mutation, audit-then-mu

### P44.6.06

- Title: Target Artifact Resolver
- Role: inspection
- Wave: W2
- Allowed Files: ["packages/coding-agent/src/core/p446/target-artifact-resolver.ts", "packages/coding-agent/test/p446/target-artifact-resolver.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44606-001", "priority": "must", "kind": "implementation_rule", "text": "Target Artifact Resolver must implement Resolve whether the requested target exists, is new, is multi-file, or is u

### P44.6.07

- Title: Acceptance Criteria Normalizer
- Role: criteria
- Wave: W2
- Allowed Files: ["packages/coding-agent/src/core/p446/acceptance-normalizer.ts", "packages/coding-agent/test/p446/acceptance-normalizer.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44607-001", "priority": "must", "kind": "implementation_rule", "text": "Acceptance Criteria Normalizer must implement Convert implicit user success conditions into explicit acceptance cri

### P44.6.08

- Title: P44.6 Readiness Gate
- Role: gate
- Wave: W2
- Allowed Files: ["packages/coding-agent/src/core/p446/readiness-gate.ts", "packages/coding-agent/test/p446/readiness-gate.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44608-001", "priority": "must", "kind": "implementation_rule", "text": "P44.6 Readiness Gate must implement Block execution when mode, target, scope, acceptance criteria, or evidence requ

### P44.6.09

- Title: WriteGate v2 Mode-Aware Policy
- Role: mutation_safety
- Wave: W3
- Allowed Files: ["packages/coding-agent/src/core/write-gate.ts", "packages/coding-agent/test/p446/write-gate-mode-aware.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44609-001", "priority": "must", "kind": "implementation_rule", "text": "WriteGate v2 Mode-Aware Policy must implement Require create-new operations to prove target path, artifact type, ov

### P44.6.10

- Title: Edit Scope Guard
- Role: mutation_safety
- Wave: W3
- Allowed Files: ["packages/coding-agent/src/core/p446/edit-scope-guard.ts", "packages/coding-agent/test/p446/edit-scope-guard.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44610-001", "priority": "must", "kind": "implementation_rule", "text": "Edit Scope Guard must implement Reject edit operations that cannot identify existing target, allowed file scope, pr

### P44.6.11

- Title: SmartMutation Planner Contract
- Role: mutation_safety
- Wave: W3
- Allowed Files: ["packages/coding-agent/src/core/mutation/smart-mutation-engine.ts", "packages/coding-agent/test/p446/smart-mutation-planner.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44611-001", "priority": "must", "kind": "implementation_rule", "text": "SmartMutation Planner Contract must implement Separate inspect/audit phase from patch phase and compile a mutation 

### P44.6.12

- Title: Large Overwrite and Rewrite Blocker
- Role: mutation_safety
- Wave: W3
- Allowed Files: ["packages/coding-agent/src/core/p446/large-overwrite-blocker.ts", "packages/coding-agent/test/p446/large-overwrite-blocker.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44612-001", "priority": "must", "kind": "implementation_rule", "text": "Large Overwrite and Rewrite Blocker must implement Prevent large existing source-file rewrites unless the plan expl

### P44.6.13

- Title: Tool Runtime Write/Edit Adapter
- Role: runtime
- Wave: W4
- Allowed Files: ["packages/coding-agent/src/core/tools/write.ts", "packages/coding-agent/src/core/tools/edit.ts", "packages/coding-agent/test/p446/tool-runtime-write-edit-adapter.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44613-001", "priority": "must", "kind": "implementation_rule", "text": "Tool Runtime Write/Edit Adapter must implement Route production write and edit tool paths through P44.6 mode-aware 

### P44.6.14

- Title: Engine Invocation Timeout and Circuit Breaker Wrapper
- Role: runtime
- Wave: W4
- Allowed Files: ["packages/coding-agent/src/core/p446/engine-invocation-wrapper.ts", "packages/coding-agent/test/p446/engine-invocation-wrapper.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44614-001", "priority": "must", "kind": "implementation_rule", "text": "Engine Invocation Timeout and Circuit Breaker Wrapper must implement Add real timeout, cancellation, retry budget, 

### P44.6.15

- Title: EventRecorder Shadow Conditional Fix
- Role: runtime
- Wave: W4
- Allowed Files: ["packages/coding-agent/src/core/p446/event-recorder-guard.ts", "packages/coding-agent/test/p446/event-recorder-guard.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44615-001", "priority": "must", "kind": "implementation_rule", "text": "EventRecorder Shadow Conditional Fix must implement Fix shadow conditional behavior so event recording is not silen

### P44.6.16

- Title: Production Runtime Scan Adapter Path
- Role: runtime
- Wave: W4
- Allowed Files: ["packages/coding-agent/src/execution-runtime/p446-runtime-scan-adapter.ts", "packages/coding-agent/test/p446/runtime-scan-adapter.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44616-001", "priority": "must", "kind": "implementation_rule", "text": "Production Runtime Scan Adapter Path must implement Connect existing runtime scan loop to exactly one production ad

### P44.6.17

- Title: Smart Write Artifact Schema Selector
- Role: smart_write
- Wave: W5
- Allowed Files: ["packages/coding-agent/src/core/p446/smart-write-schema-selector.ts", "packages/coding-agent/test/p446/smart-write-schema-selector.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44617-001", "priority": "must", "kind": "implementation_rule", "text": "Smart Write Artifact Schema Selector must implement Choose JSON artifact schema for smart write requests before gen

### P44.6.18

- Title: Smart Write Route Signal Compiler
- Role: smart_write
- Wave: W5
- Allowed Files: ["packages/coding-agent/src/core/p446/smart-write-route-signal.ts", "packages/coding-agent/test/p446/smart-write-route-signal.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44618-001", "priority": "must", "kind": "implementation_rule", "text": "Smart Write Route Signal Compiler must implement Compile route signals such as ROUTE_TO_WRITE, ROUTE_TO_PLAN_JSON, 

### P44.6.19

- Title: JSON Plan Artifact Writer
- Role: smart_write
- Wave: W5
- Allowed Files: ["packages/coding-agent/src/core/p446/json-plan-artifact-writer.ts", "packages/coding-agent/test/p446/json-plan-artifact-writer.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44619-001", "priority": "must", "kind": "implementation_rule", "text": "JSON Plan Artifact Writer must implement Ensure plan-like smart write outputs are JSON PlanSpec artifacts, not mark

### P44.6.20

- Title: Compile Diagnostics for Smart Write
- Role: smart_write
- Wave: W5
- Allowed Files: ["packages/coding-agent/src/core/p446/smart-write-compile-diagnostics.ts", "packages/coding-agent/test/p446/smart-write-compile-diagnostics.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44620-001", "priority": "must", "kind": "implementation_rule", "text": "Compile Diagnostics for Smart Write must implement Return machine-readable diagnostics when artifact schema, route,

### P44.6.21

- Title: Smart Edit Audit Finding Contract
- Role: smart_edit
- Wave: W6
- Allowed Files: ["packages/execution-contracts/src/audit-finding.ts", "packages/execution-contracts/test/audit-finding.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44621-001", "priority": "must", "kind": "implementation_rule", "text": "Smart Edit Audit Finding Contract must implement Represent smart edit findings as stable blockers/warnings with fil

### P44.6.22

- Title: Smart Edit Patch Scope Compiler
- Role: smart_edit
- Wave: W6
- Allowed Files: ["packages/coding-agent/src/core/p446/smart-edit-patch-scope-compiler.ts", "packages/coding-agent/test/p446/smart-edit-patch-scope-compiler.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44622-001", "priority": "must", "kind": "implementation_rule", "text": "Smart Edit Patch Scope Compiler must implement Compile audit findings into minimal patch scopes and reject patches 

### P44.6.23

- Title: Smart Edit Regression Guard
- Role: smart_edit
- Wave: W6
- Allowed Files: ["packages/coding-agent/src/core/p446/smart-edit-regression-guard.ts", "packages/coding-agent/test/p446/smart-edit-regression-guard.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44623-001", "priority": "must", "kind": "implementation_rule", "text": "Smart Edit Regression Guard must implement Require targeted validation or negative evidence before smart edit claim

### P44.6.24

- Title: Patch Evidence Binder
- Role: smart_edit
- Wave: W6
- Allowed Files: ["packages/coding-agent/src/core/p446/patch-evidence-binder.ts", "packages/coding-agent/test/p446/patch-evidence-binder.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44624-001", "priority": "must", "kind": "implementation_rule", "text": "Patch Evidence Binder must implement Bind diff hunks, commands, and source evidence to acceptance criterion IDs and

### P44.6.25

- Title: P44.6 Event Types
- Role: visibility
- Wave: W7
- Allowed Files: ["packages/execution-contracts/src/events.ts", "packages/execution-runtime/src/event-schema.ts", "packages/execution-contracts/test/p446-events.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44625-001", "priority": "must", "kind": "implementation_rule", "text": "P44.6 Event Types must implement Add mode inspection, compile, gate, route, mutation, and evidence events without w

### P44.6.26

- Title: Read Model Mode Truth Fields
- Role: visibility
- Wave: W7
- Allowed Files: ["packages/execution-contracts/src/read-model.ts", "packages/coding-agent/test/p446/read-model-mode-truth.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44626-001", "priority": "must", "kind": "implementation_rule", "text": "Read Model Mode Truth Fields must implement Expose authoritative mode, gate verdict, diagnostics, route signal, and

### P44.6.27

- Title: Web Server P44.6 Read Endpoints
- Role: visibility
- Wave: W7
- Allowed Files: ["packages/web-server/src/read-model-routes.ts", "packages/web-server/test/p446-read-model-routes.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44627-001", "priority": "must", "kind": "implementation_rule", "text": "Web Server P44.6 Read Endpoints must implement Serve read-only P44.6 status, diagnostics, and route signal endpoint

### P44.6.28

- Title: TUI Mode and Diagnostic Visibility
- Role: visibility
- Wave: W7
- Allowed Files: ["packages/tui/src/components/p446-mode-status.ts", "packages/tui/src/tui.ts", "packages/tui/test/p446-mode-status.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44628-001", "priority": "must", "kind": "implementation_rule", "text": "TUI Mode and Diagnostic Visibility must implement Display selected EngineMode, readiness verdict, blocking diagnost

### P44.6.29

- Title: ACCP Mode Report Validator
- Role: report
- Wave: W8
- Allowed Files: ["packages/coding-agent/src/core/p446/accp-mode-report-validator.ts", "packages/coding-agent/test/p446/accp-mode-report-validator.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44629-001", "priority": "must", "kind": "implementation_rule", "text": "ACCP Mode Report Validator must implement Validate that ACCP reports are evidence-only and cannot authorize mode tr

### P44.6.30

- Title: Evidence Ledger Export for Mode Decisions
- Role: report
- Wave: W8
- Allowed Files: ["packages/coding-agent/src/core/p446/mode-evidence-ledger-export.ts", "packages/coding-agent/test/p446/mode-evidence-ledger-export.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44630-001", "priority": "must", "kind": "implementation_rule", "text": "Evidence Ledger Export for Mode Decisions must implement Export mode mapping, gate verdicts, patch evidence, and va

### P44.6.31

- Title: TVR and PRR Mapping for P44.6
- Role: report
- Wave: W8
- Allowed Files: ["packages/coding-agent/src/core/p446/p446-report-mapping.ts", "packages/coding-agent/test/p446/p446-report-mapping.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44631-001", "priority": "must", "kind": "implementation_rule", "text": "TVR and PRR Mapping for P44.6 must implement Map validation and promotion readiness to TVR and PRR report requireme

### P44.6.32

- Title: CAR Correction Path for Mode Report Failures
- Role: report
- Wave: W8
- Allowed Files: ["packages/coding-agent/src/core/p446/mode-report-correction.ts", "packages/coding-agent/test/p446/mode-report-correction.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44632-001", "priority": "must", "kind": "implementation_rule", "text": "CAR Correction Path for Mode Report Failures must implement Require CAR when a mode report is malformed, stale, con

### P44.6.33

- Title: P49.5 Bridge Artifact Export
- Role: bridge
- Wave: W9
- Allowed Files: ["packages/coding-agent/src/core/p446/p495-bridge-export.ts", "packages/coding-agent/test/p446/p495-bridge-export.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44633-001", "priority": "must", "kind": "implementation_rule", "text": "P49.5 Bridge Artifact Export must implement Export the P49.5 bridge artifacts needed to hand P44.6 evidence to the 

### P44.6.34

- Title: P49.5 Readiness Guard
- Role: bridge
- Wave: W9
- Allowed Files: ["packages/coding-agent/src/core/p446/p495-readiness-guard.ts", "packages/coding-agent/test/p446/p495-readiness-guard.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44634-001", "priority": "must", "kind": "implementation_rule", "text": "P49.5 Readiness Guard must implement Block promotion unless mode mapping, mutation safety, runtime scan, and eviden

### P44.6.35

- Title: P45 Boundary Guard
- Role: bridge
- Wave: W9
- Allowed Files: ["packages/coding-agent/src/core/p446/p45-boundary-guard.ts", "packages/coding-agent/test/p446/p45-boundary-guard.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44635-001", "priority": "must", "kind": "implementation_rule", "text": "P45 Boundary Guard must implement Forbid async assembly, static partitioner, deterministic assembler, and P45 runti

### P44.6.36

- Title: v4.1.1 Adapter Compatibility Pack
- Role: bridge
- Wave: W9
- Allowed Files: ["packages/coding-agent/src/core/p446/v411-adapter.ts", "packages/coding-agent/test/p446/v411-adapter.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44636-001", "priority": "must", "kind": "implementation_rule", "text": "v4.1.1 Adapter Compatibility Pack must implement Compile P44.6 PlanSpec fields into the v4.1.1 execution adapter wi

### P44.6.37

- Title: Deterministic Unit Test Matrix
- Role: testing
- Wave: W10
- Allowed Files: ["packages/coding-agent/test/p446/deterministic-mode-matrix.test.ts", "packages/coding-agent/src/core/p446/test-fixtures.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44637-001", "priority": "must", "kind": "implementation_rule", "text": "Deterministic Unit Test Matrix must implement Cover all four modes, ambiguous prompts, forbidden overwrites, missin

### P44.6.38

- Title: Production Runtime Integration Test Path
- Role: testing
- Wave: W10
- Allowed Files: ["packages/coding-agent/test/p446/runtime-integration-real-scan-path.test.ts", "packages/test-fixtures/p446/runtime-scan-fixtures.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44638-001", "priority": "must", "kind": "implementation_rule", "text": "Production Runtime Integration Test Path must implement Run real production scan path tests rather than mock-only p

### P44.6.39

- Title: Monte Carlo Prompt and Mutation Red Team
- Role: testing
- Wave: W10
- Allowed Files: ["packages/coding-agent/test/p446/monte-carlo-mode-redteam.test.ts", "packages/test-fixtures/p446/redteam-prompts.json"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44639-001", "priority": "must", "kind": "implementation_rule", "text": "Monte Carlo Prompt and Mutation Red Team must implement Stress ambiguous natural language, prompt injection, markdo

### P44.6.40

- Title: Fake Complete and Silent Pass Gauntlet
- Role: testing
- Wave: W10
- Allowed Files: ["packages/coding-agent/test/p446/fake-complete-silent-pass-gauntlet.test.ts", "packages/test-fixtures/p446/fake-complete-cases.json"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44640-001", "priority": "must", "kind": "implementation_rule", "text": "Fake Complete and Silent Pass Gauntlet must implement Prove that self-reported done, no-tests-found, watch-mode out

### P44.6.41

- Title: Migration and Operator Preview Pack
- Role: migration
- Wave: W11
- Allowed Files: ["packages/coding-agent/src/core/p446/migration-preview.ts", "packages/coding-agent/test/p446/migration-preview.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44641-001", "priority": "must", "kind": "implementation_rule", "text": "Migration and Operator Preview Pack must implement Generate non-authoritative human preview and migration notes fro

### P44.6.42

- Title: Final Promotion Pack
- Role: final
- Wave: W11
- Allowed Files: ["packages/coding-agent/src/core/p446/final-promotion-pack.ts", "packages/coding-agent/test/p446/final-promotion-pack.test.ts"]
- Forbidden Files: [".env", ".env.*", "node_modules/**", ".git/**", "package-lock.json", "pnpm-lock.yaml", "packages/coding-agent/src/p45/**", "packages/coding-agent/src/async-assembly/**", "packages/coding-agent/src/static-partitioner/**", "packages/coding-agent/src/deterministic-assembler/**"]
- Instructions: [{"id": "WI-P44642-001", "priority": "must", "kind": "implementation_rule", "text": "Final Promotion Pack must implement Assemble final promotion evidence, readiness report, mutation report, and P49.5

## Wave Details (Original Schema Fields)

### W1: Contract Foundation

- Workspace IDs: ["P44.6.01", "P44.6.02", "P44.6.03", "P44.6.04"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44601-UNIT', 'CMD-P44602-UNIT', 'CMD-P44603-UNIT', 'CMD-P44604-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W1.json', 'reports/p446-mode-routing/w1-evidence-ledger.json', 'reports/p446-mode-routing/w1-gate-verdict.json']}
- Dependencies: []

### W2: Input Inspection and Readiness

- Workspace IDs: ["P44.6.05", "P44.6.06", "P44.6.07", "P44.6.08"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44605-UNIT', 'CMD-P44606-UNIT', 'CMD-P44607-UNIT', 'CMD-P44608-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W2.json', 'reports/p446-mode-routing/w2-evidence-ledger.json', 'reports/p446-mode-routing/w2-gate-verdict.json']}
- Dependencies: ["W1"]

### W3: Write/Edit Mutation Safety

- Workspace IDs: ["P44.6.09", "P44.6.10", "P44.6.11", "P44.6.12"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44609-UNIT', 'CMD-P44610-UNIT', 'CMD-P44611-UNIT', 'CMD-P44612-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W3.json', 'reports/p446-mode-routing/w3-evidence-ledger.json', 'reports/p446-mode-routing/w3-gate-verdict.json']}
- Dependencies: ["W2"]

### W4: Runtime Wiring

- Workspace IDs: ["P44.6.13", "P44.6.14", "P44.6.15", "P44.6.16"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44613-UNIT', 'CMD-P44614-UNIT', 'CMD-P44615-UNIT', 'CMD-P44616-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W4.json', 'reports/p446-mode-routing/w4-evidence-ledger.json', 'reports/p446-mode-routing/w4-gate-verdict.json']}
- Dependencies: ["W3"]

### W5: Smart Write Path

- Workspace IDs: ["P44.6.17", "P44.6.18", "P44.6.19", "P44.6.20"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44617-UNIT', 'CMD-P44618-UNIT', 'CMD-P44619-UNIT', 'CMD-P44620-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W5.json', 'reports/p446-mode-routing/w5-evidence-ledger.json', 'reports/p446-mode-routing/w5-gate-verdict.json']}
- Dependencies: ["W2", "W3"]

### W6: Smart Edit Path

- Workspace IDs: ["P44.6.21", "P44.6.22", "P44.6.23", "P44.6.24"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44621-UNIT', 'CMD-P44622-UNIT', 'CMD-P44623-UNIT', 'CMD-P44624-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W6.json', 'reports/p446-mode-routing/w6-evidence-ledger.json', 'reports/p446-mode-routing/w6-gate-verdict.json']}
- Dependencies: ["W3"]

### W7: Visibility and Read Model

- Workspace IDs: ["P44.6.25", "P44.6.26", "P44.6.27", "P44.6.28"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44625-UNIT', 'CMD-P44626-UNIT', 'CMD-P44627-UNIT', 'CMD-P44628-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W7.json', 'reports/p446-mode-routing/w7-evidence-ledger.json', 'reports/p446-mode-routing/w7-gate-verdict.json']}
- Dependencies: ["W4", "W5", "W6"]

### W8: ACCP Evidence Reports

- Workspace IDs: ["P44.6.29", "P44.6.30", "P44.6.31", "P44.6.32"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44629-UNIT', 'CMD-P44630-UNIT', 'CMD-P44631-UNIT', 'CMD-P44632-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W8.json', 'reports/p446-mode-routing/w8-evidence-ledger.json', 'reports/p446-mode-routing/w8-gate-verdict.json']}
- Dependencies: ["W7"]

### W9: P49.5 and P45 Boundary Bridge

- Workspace IDs: ["P44.6.33", "P44.6.34", "P44.6.35", "P44.6.36"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44633-UNIT', 'CMD-P44634-UNIT', 'CMD-P44635-UNIT', 'CMD-P44636-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W9.json', 'reports/p446-mode-routing/w9-evidence-ledger.json', 'reports/p446-mode-routing/w9-gate-verdict.json']}
- Dependencies: ["W8"]

### W10: Real Test Gauntlets

- Workspace IDs: ["P44.6.37", "P44.6.38", "P44.6.39", "P44.6.40"]
- Batch Size: 3
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44637-UNIT', 'CMD-P44638-UNIT', 'CMD-P44639-UNIT', 'CMD-P44640-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W10.json', 'reports/p446-mode-routing/w10-evidence-ledger.json', 'reports/p446-mode-routing/w10-gate-verdict.json']}
- Dependencies: ["W9"]

### W11: Migration and Final Promotion

- Workspace IDs: ["P44.6.41", "P44.6.42"]
- Batch Size: 2
- Gate: {'required': True, 'commandRefs': ['CMD-TYPECHECK-TSGO', 'CMD-P44641-UNIT', 'CMD-P44642-UNIT'], 'requiredArtifacts': ['reports/accp/P44.6/tvr_wave_W11.json', 'reports/p446-mode-routing/w11-evidence-ledger.json', 'reports/p446-mode-routing/w11-gate-verdict.json']}
- Dependencies: ["W10"]

## Companion Matrices Reference

See companion JSON at `P44_6_brutal_test_gate_matrices.json` for:
- Mode routing matrices (stable_3, stable_6, experimental_worktree_6, scale_8)
- Monte Carlo simulation configuration
- Red-team test scenarios

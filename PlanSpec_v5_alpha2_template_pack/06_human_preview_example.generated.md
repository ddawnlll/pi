# Generated Human Preview — PlanSpec v5 alpha2 Example

**Non-authoritative. Do not execute this Markdown.**

Source of truth: `01_planspec_v5_alpha2_template.example.json`

## Improvements in alpha2

- Strict schema for security-critical fields.
- Risk-tiered command policy instead of prefix whitelist.
- Runtime command grant for autonomous discovery.
- Typed enforcement registry.
- Evidence confidence enum.
- P45 bridge boundary enforcement.
- Real distinct validation cases.
- Deterministic PlanLock example with real hashes.

## Waves
### W1 — Foundation
AC schema, EvidenceLedger, and Worker Report Contract.

- `P44.01` — Acceptance Criteria and Traceability Schema
- `P44.02` — EvidenceLedger
- `P44.06` — Worker Report Contract

### W2 — Gate Core
CompletionGate v2, terminal reconciler, and negative scanner.

- `P44.03` — CompletionGate v2
- `P44.04` — Terminal Verdict Reconciliation
- `P44.05` — Negative Assertion and Forbidden Shortcut Scanner

### W3 — Commit Safety
WorkspaceCommitGate and scoped commit integration.

- `P44.08` — WorkspaceCommitGate
- `P44.09` — Scoped Commit Integration

### W4 — Audit and Mutation Wiring
PostImplementationAuditor and WriteGate/SmartMutation tool wiring.

- `P44.07` — Post-Implementation Auditor
- `P44.WG` — WriteGate and SmartMutation Tool Wiring

### W5 — Visibility
Read model truth fields.

- `P44.10` — Read Model Visibility

### W6 — Gauntlets
Fake-complete, commit-scope, and mutation-safety gauntlets.

- `P44.11` — Fake Complete, Commit Scope, and Mutation Safety Gauntlets

### W7 — Bridge
v4.1.1-compatible template extension and P45 bridge outputs.

- `P44.12` — Master Template v4.1.1-Compatible Extension Update
- `P45.B1` — Accepted WriteSet Export and Ownership Summary
- `P45.B2` — Assembler-Only Candidate Discovery and P45 Readiness Doctor
- `P45.B3` — Evidence Ledger and Mutation Report Export

### W8 — Final Promotion
Final validation and promotion readiness.

- `P44.13` — Final Promotion Report

# ACCP v2.0.1 Addendum — Diagnostics, Repair Loop, and Prompt Contracts

This addendum fills the practical implementation gaps in ACCP v2.0.

It should be treated as the recommended starting point for P46 implementation.

## 1. Diagnostic Code Registry

Compiler diagnostics should use stable machine-readable codes.

### Parse diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_PARSE_YAML_INVALID` | yes | YAML cannot be parsed. |
| `ACCP_PARSE_EMPTY_DOCUMENT` | yes | Source file is empty. |
| `ACCP_PARSE_MULTIDOC_NOT_ALLOWED` | yes | Multiple YAML documents are present. |

### Common schema diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_SCHEMA_MISSING_TOP_LEVEL_KEY` | yes | Required top-level key is missing. |
| `ACCP_SCHEMA_UNKNOWN_REPORT_TYPE` | yes | `report.type` is not in the 24-type registry. |
| `ACCP_SCHEMA_INVALID_SUPPORT_LEVEL` | yes | Report requests unsupported compiler behavior. |
| `ACCP_SCHEMA_MISSING_REQUIRED_SECTION` | yes | Required report-specific section is missing. |
| `ACCP_SCHEMA_EMPTY_REQUIRED_FIELD` | yes | Required field is empty. |
| `ACCP_SCHEMA_UNKNOWN_SECTION` | no | Unknown section appears in non-strict mode. |

### ID diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_ID_INVALID_FORMAT` | yes | Stable ID does not match `[A-Z]{1,3}[0-9]{3}`. |
| `ACCP_ID_DUPLICATE` | yes | Stable ID is duplicated in one report. |
| `ACCP_ID_PREFIX_UNEXPECTED` | no | ID prefix is valid but unusual for this section. |

### Reference diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_REF_UNRESOLVED` | yes | Cross-report reference cannot be resolved. |
| `ACCP_REF_AMBIGUOUS_SHORT_FORM` | yes | Short ref is ambiguous in the report graph. |
| `ACCP_REF_TARGET_TYPE_MISMATCH` | yes | Target ref exists but is the wrong kind. |

### Semantic diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_SEMANTIC_CONFIRMED_BUG_MISSING_EVIDENCE` | yes | Confirmed bug lacks evidence. |
| `ACCP_SEMANTIC_LIKELY_BUG_MISSING_FIX_DIRECTION` | yes | Likely bug lacks minimal fix direction. |
| `ACCP_SEMANTIC_TVR_PASS_WITHOUT_COMMAND_EVIDENCE` | yes | TVR claims pass without valid command evidence. |
| `ACCP_SEMANTIC_MUTATION_WITHOUT_DIFF_INTEGRITY` | yes | Mutation report lacks diff integrity. |
| `ACCP_SEMANTIC_MUTATION_WITHOUT_ROLLBACK_PLAN` | yes | Mutation report lacks rollback plan. |
| `ACCP_SEMANTIC_PRR_APPROVES_WITH_BLOCKERS` | yes | PRR approves promotion while blocking findings exist. |

### Evidence diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_EVIDENCE_PATH_NOT_FOUND` | yes | Evidence path does not exist. |
| `ACCP_EVIDENCE_LINE_RANGE_INVALID` | yes | Evidence line range is outside file bounds. |
| `ACCP_EVIDENCE_FILE_HASH_MISMATCH` | yes | Evidence hash does not match snapshot. |
| `ACCP_EVIDENCE_COMMAND_EXIT_CODE_MISSING` | yes | Command result lacks exit code. |
| `ACCP_EVIDENCE_NO_TESTS_FOUND_FALSE_POSITIVE` | yes | Validation reported pass but no tests were found. |
| `ACCP_EVIDENCE_COMMAND_NOT_FOUND` | yes | Validation command was not found. |
| `ACCP_EVIDENCE_TIMEOUT` | yes | Validation command timed out. |
| `ACCP_EVIDENCE_WATCH_MODE` | yes | Watch-mode command cannot satisfy validation. |

### Route diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_ROUTE_TARGET_REF_UNRESOLVED` | yes | `next_route.target_refs` contains unresolved ref. |
| `ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY` | yes | Route recommends mutation without PlanSpec/runtime authority. |
| `ACCP_ROUTE_AUTO_ADVANCE_UNSAFE` | no | Route claims auto-advance safe but runtime policy disagrees. |
| `ACCP_ROUTE_UNKNOWN_NEXT_REPORT` | yes | Recommended next report is not registered. |

### Gate diagnostics

| Code | Fatal | Meaning |
|---|---:|---|
| `ACCP_GATE_BLOCKING_FINDING_OPEN` | no | Open finding blocks promotion/completion. |
| `ACCP_GATE_REQUIRED_TVR_MISSING` | yes | Required validation report is missing. |
| `ACCP_GATE_REQUIRED_HIR_MISSING` | yes | Required handoff report is missing. |
| `ACCP_GATE_STALE_REPORT` | yes | Report is stale after next commit/merge. |

## 2. ACCP Repair / Canonicalization Loop

The repair model may fix structure only.

It must not:
- add new claims
- invent evidence
- change task scope
- convert suspected bugs into confirmed bugs
- change command results
- change exit codes
- remove blocking findings

Repair prompt:

```text
You are repairing an ACCP v2.0 YAML report after compiler diagnostics.

Return only corrected ACCP YAML.
Do not add new claims.
Do not invent evidence.
Do not change task scope.
Do not alter command results.
Do not remove blocking findings.
Only fix structure, missing required empty placeholders, stable ID formatting, YAML syntax, and section placement.

Compiler diagnostics:
{diagnostics}

Original source:
{source}
```

## 3. Ready-To-Use Prompt Contracts

Normal worker prompts should use compact contracts, not the full spec.

### BSR contract

```text
Return exactly one ACCP v2.0 YAML document.
source_format must be "ACCP-YAML".
report.type must be "BSR".
Task mode: bug_search, read_only.
Do not modify files.
No prose outside YAML.
Use stable IDs.
confirmed_bug and likely_bug require evidence.
P0/P1 bugs block promotion.
Include prioritized_fix_plan, validation_recommendations, final_status, and next_route.
```

### FPR contract

```text
Return exactly one ACCP v2.0 YAML document.
source_format must be "ACCP-YAML".
report.type must be "FPR".
Task mode: fix_patch.
Mutation is allowed only within authorized PlanSpec/workspace scope.
Reference the bug being fixed.
Include fixes, diff_integrity, rollback_plan, validation_handoff, final_status, and next_route.
Do not claim validation passed unless command evidence exists.
```

### TVR contract

```text
Return exactly one ACCP v2.0 YAML document.
source_format must be "ACCP-YAML".
report.type must be "TVR".
Task mode: validation_only.
Run only allowed validation commands.
Include command_results with exit_code and false_positive_guards.
If no tests were found, validation did not pass.
Include regressions, final_status, and next_route.
```

### PRR contract

```text
Return exactly one ACCP v2.0 YAML document.
source_format must be "ACCP-YAML".
report.type must be "PRR".
Task mode: promotion_readiness, read_only.
Review compiled ACCP artifacts and gate evidence.
Do not approve promotion if blocking findings, missing TVR, missing rollback, stale reports, or authority conflicts exist.
Include gate_checks, open_risks, decisions, final_status, and next_route.
```

## 4. Legacy Artifact Policy

ACCP v2.0 compiler does not parse legacy `.accp.md` or ACCP-Lite source.

Legacy reports may be referenced as historical context only:

```yaml
references:
  - ref: "legacy:ACCP.v1.2#P46_PLAN_REVIEW"
    purpose: "Historical planning context only; not compiler-trusted."
```

Legacy reports must not be used as gate-blocking or gate-passing evidence.

A v2.0 `CAR`, `RIR`, or `PIR` may summarize and supersede legacy artifacts when needed.

## 5. Core Compiler Implementation Set

P46 strict/gate-critical set:

- BSR
- FPR
- TVR
- PRR
- HIR
- CAR

P46 schema-lite set:

- RIR
- PIR
- IPR
- ECR
- DCR

Registered/template-only set:

- BRR
- RCA
- FVR
- FER
- FDR
- FCR
- FIR
- FGR
- WBR
- WDR
- WER
- WQR

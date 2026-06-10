---
short_name: ACCP
title: Agentic Coding Communication Protocol
version: 2.0.0
status: draft
format_profile: ACCP-YAML
canonical_file: accp_v2_0_yaml_compiler_profile.md
last_updated: 2026-06-10
breaking_change_from:
  - ACCP v1.2
  - ACCP-Lite v1.0
---

# ACCP v2.0 — YAML-Native Agentic Coding Communication Protocol

## 0. Executive Decision

ACCP v2.0 makes a deliberate breaking change:

- ACCP source reports are now canonical YAML documents.
- XML-like wrappers are removed.
- Markdown is no longer the canonical machine source format.
- Runtime consumers must read compiled JSON artifacts, not raw ACCP source.
- All 24 official report types are registered from the beginning.
- Support is staged by capability level, not by whether the type exists.
- ACCP remains an evidence and communication layer, not execution authority.

The purpose of v2.0 is not to create more paperwork.

The purpose is to make agentic coding communication:

- serializable
- compilable
- schema-validatable
- evidence-linked
- lineage-aware
- route-aware
- completion-gate usable
- safe for cheaper/flash models

## 1. Why v2.0 Exists

Earlier ACCP formats were human-friendly and parser-aware, but not strict enough as canonical runtime input.

Problems solved by v2.0:

1. Hybrid XML-wrapper plus YAML-like body is removed.
2. Strict YAML source format becomes the only native source profile.
3. Every report has a machine-readable report type.
4. Every report can compile into JSON artifacts.
5. Route decisions can be derived from compiled artifacts.
6. Gate verdicts become deterministic compiler outputs.
7. Cheap models can produce structured reports without gaining execution authority.
8. The runtime does not trust prose.

Core principle:

```text
Agent recommends.
Compiler validates and normalizes.
Runtime decides.
```

## 2. Non-Goals

ACCP v2.0 does not:

- authorize repository mutation
- replace PlanSpec
- replace execution contracts
- replace AdmissionGate
- replace completion gate
- replace CI
- replace human approval
- allow the agent to autonomously change mode
- make LLM judgment the source of runtime truth

ACCP reports are evidence artifacts and routing recommendations.

Execution authority remains with:

- PlanSpec
- runtime authority model
- workspace contract
- command policy
- patch/mutation controller
- CI
- human approval where required

## 3. Source and Artifact Model

### 3.1 Canonical source

Native ACCP v2.0 source files use:

```text
.accp.yaml
```

Example:

```text
reports/accp/P46/source/P46_BSR_001.accp.yaml
```

### 3.2 Compiler outputs

The compiler emits JSON artifacts:

```text
reports/accp/{plan_id}/compiled/{report_id}.compiled.json
reports/accp/{plan_id}/ir/{report_id}.ir.json
reports/accp/{plan_id}/verdict/{report_id}.gate-verdict.json
reports/accp/{plan_id}/route/{report_id}.route-signal.json
reports/accp/{plan_id}/index.json
reports/accp/{plan_id}/graph.json
reports/accp/{plan_id}/rendered/{report_id}.accp.md
```

### 3.3 Runtime rule

Runtime must not consume raw `.accp.yaml` directly.

Runtime consumes:

- `.compiled.json`
- `.ir.json`
- `.gate-verdict.json`
- `.route-signal.json`
- `index.json`
- `graph.json`

Markdown is a rendered human view.

## 4. ACCP-YAML Strict Source Profile

ACCP v2.0 uses a strict YAML subset.

### 4.1 Required top-level keys

Every report must include:

```yaml
accp_version: "2.0.0"
source_format: "ACCP-YAML"
report:
  id: "..."
  type: "..."
  family: "..."
  kind: "..."
  status: "draft|complete|partial|blocked|superseded"
meta: {}
agent: {}
capabilities: {}
references: []
assumptions: {}
skipped_inspections: {}
final_status: {}
```

Report-specific sections are added by the registry.

### 4.2 YAML rules

- Use a single YAML document.
- Do not use XML wrappers.
- Do not use Markdown headings as data.
- Do not use Markdown code fences inside YAML fields.
- Do not put required data only in prose.
- Use quoted strings for enums and timestamps.
- Use `true` / `false` for booleans.
- Use `unknown`, `not_found`, or `not_applicable` for unavailable values.
- Do not leave important fields blank.
- Stable ID maps must be YAML objects.
- Lists must use normal YAML arrays.
- Multi-line text must use `|` when needed.
- Unknown top-level keys are warnings in non-strict mode and fatal in strict mode.

### 4.3 Stable ID regex

All stable IDs must match:

```text
[A-Z]{1,3}[0-9]{3}
```

Examples:

```text
F001
G001
BG001
FX001
VT001
NR001
DC001
```

## 5. Support Levels

ACCP v2.0 registers all 24 report types immediately, but support is staged.

```ts
type ACCPSupportLevel =
  | "known"
  | "template_available"
  | "schema_lite"
  | "schema_strict"
  | "gate_blocking";
```

### 5.1 Support level definitions

| Level | Meaning |
|---|---|
| `known` | Type exists in registry. Compiler recognizes it and can reject unknown types. |
| `template_available` | Prompt/template exists. Agent can be asked to produce it. |
| `schema_lite` | Compiler validates wrapper-free YAML shape, required top-level keys, stable IDs, and required section presence. |
| `schema_strict` | Compiler validates required fields, enums, semantic rules, evidence constraints, route rules, and report-specific invariants. |
| `gate_blocking` | Runtime completion/promotion gate can trust compiled verdicts from this report type as blocking inputs. |

### 5.2 Gate eligibility rule

Only reports with `schema_strict` or `gate_blocking` support can influence gate verdicts.

Only reports with `gate_blocking` support can independently block completion or promotion in strict runtime mode.

## 6. The 24 Official Report Types

### 6.1 Full family overview

```text
Core:          8
Bugfix:       5
Feature:      5
Writing:      4
Coordination: 2
-----------------
Total:       24
```

### 6.2 Core reports — 8

| Type | Name | Purpose |
|---|---|---|
| `RIR` | Repo Inspection Report | Discover repository state, architecture, boundaries, contracts, tests, and risks. |
| `PIR` | Plan Inspection Report | Review plan or PlanSpec before implementation. |
| `IPR` | Implementation Patch Report | Report general implementation or patch work. |
| `TVR` | Test Validation Report | Report validation command results with command evidence. |
| `HIR` | Handoff / Intervention Report | Stop and ask for human intervention or authority decision. |
| `RAR` | Regression Analysis Report | Analyze validation regression or newly broken behavior. |
| `PRR` | Promotion Readiness Report | Decide whether a workspace, plan, branch, release, or runtime mode is promotable. |
| `CAR` | Correction / Amendment Report | Correct or supersede a previous ACCP report. |

### 6.3 Bugfix reports — 5

| Type | Name | Purpose |
|---|---|---|
| `BSR` | Bug Search Report | Search for bugs, classify them, prioritize them, attach evidence, and recommend fixes. |
| `BRR` | Bug Reproduction Report | Reproduce or fail to reproduce a bug with evidence. |
| `RCA` | Root Cause Analysis Report | Explain root cause of a confirmed or likely bug. |
| `FPR` | Fix Patch Report | Report patch that fixes a referenced bug. |
| `FVR` | Fix Validation Report | Validate that a fix closes the bug and does not regress. |

### 6.4 Feature reports — 5

| Type | Name | Purpose |
|---|---|---|
| `FER` | Feature Exploration Report | Explore feature need, constraints, alternatives, and current repo state. |
| `FDR` | Feature Design Report | Define feature design, architecture, state/data flow, and tradeoffs. |
| `FCR` | Feature Contract Report | Define API, schema, event, PlanSpec, runtime, UI, or integration contracts. |
| `FIR` | Feature Implementation Report | Report feature implementation changes. |
| `FGR` | Feature Gate Report | Evaluate feature acceptance criteria and feature-readiness gates. |

### 6.5 Writing reports — 4

| Type | Name | Purpose |
|---|---|---|
| `WBR` | Writing Brief Report | Define writing objective, audience, sources, constraints, and success criteria. |
| `WDR` | Writing Draft Report | Produce draft content and declare sources/claims. |
| `WER` | Writing Edit Report | Report revision, edit, restructuring, or style changes. |
| `WQR` | Writing Quality Review Report | Review writing quality, unsupported claims, completeness, style fit, and consistency. |

### 6.6 Coordination reports — 2

| Type | Name | Purpose |
|---|---|---|
| `ECR` | Evidence Capsule Report | Small portable evidence packet for multi-agent handoff. |
| `DCR` | Decision / Conflict Report | Record agent conflict, decision, route conflict, or authority conflict. |

## 7. v2.0 Initial Support Matrix

All 24 types are registered in v2.0.

The first compiler release should not make all 24 gate-blocking.

| Type | Family | P46 Support | P47 Support | P48/P49 Target | Gate Eligible Now? |
|---|---|---:|---:|---:|---|
| `RIR` | core | `schema_lite` | `schema_strict` | `schema_strict` | no |
| `PIR` | core | `schema_lite` | `schema_strict` | `schema_strict` | no |
| `IPR` | core | `schema_strict` | `gate_blocking` | `gate_blocking` | conditional |
| `TVR` | core | `schema_strict` | `gate_blocking` | `gate_blocking` | yes |
| `HIR` | core | `schema_strict` | `gate_blocking` | `gate_blocking` | yes |
| `RAR` | core | `schema_lite` | `schema_strict` | `gate_blocking` | conditional |
| `PRR` | core | `schema_strict` | `gate_blocking` | `gate_blocking` | yes |
| `CAR` | core | `schema_strict` | `schema_strict` | `schema_strict` | conditional |
| `BSR` | bugfix | `schema_strict` | `gate_blocking` | `gate_blocking` | yes |
| `BRR` | bugfix | `schema_lite` | `schema_strict` | `gate_blocking` | conditional |
| `RCA` | bugfix | `schema_lite` | `schema_strict` | `schema_strict` | no |
| `FPR` | bugfix | `schema_strict` | `gate_blocking` | `gate_blocking` | yes |
| `FVR` | bugfix | `schema_lite` | `schema_strict` | `gate_blocking` | conditional |
| `FER` | feature | `template_available` | `schema_lite` | `schema_strict` | no |
| `FDR` | feature | `template_available` | `schema_lite` | `schema_strict` | no |
| `FCR` | feature | `template_available` | `schema_lite` | `schema_strict` | no |
| `FIR` | feature | `template_available` | `schema_lite` | `schema_strict` | no |
| `FGR` | feature | `template_available` | `schema_lite` | `gate_blocking` | conditional |
| `WBR` | writing | `template_available` | `schema_lite` | `schema_strict` | no |
| `WDR` | writing | `template_available` | `schema_lite` | `schema_strict` | no |
| `WER` | writing | `template_available` | `schema_lite` | `schema_strict` | no |
| `WQR` | writing | `template_available` | `schema_lite` | `schema_strict` | no |
| `ECR` | coordination | `schema_lite` | `schema_strict` | `schema_strict` | no |
| `DCR` | coordination | `schema_lite` | `schema_strict` | `gate_blocking` | conditional |

## 8. Required Common Sections

All reports must include these top-level keys:

```yaml
accp_version: "2.0.0"
source_format: "ACCP-YAML"
report: {}
meta: {}
agent: {}
capabilities: {}
references: []
assumptions: {}
skipped_inspections: {}
final_status: {}
```

Most reports should also include:

```yaml
scope: {}
evidence: {}
gaps_and_risks: {}
decisions: {}
next_route: {}
```

## 9. Common Metadata Schema

```yaml
accp_version: "2.0.0"
source_format: "ACCP-YAML"

report:
  id: "P46_BSR_001"
  type: "BSR"
  family: "bugfix"
  kind: "bug_search"
  status: "complete"

meta:
  plan_id: "P46"
  workspace_id: "W03"
  repo_root: "."
  git_commit: "unknown"
  git_branch: "unknown"
  report_generated_at: "unknown"
  report_stale_after: "on_next_commit"
  inspection_mode: "read_only"
  confidence: "medium"

agent:
  agent_id: "unknown"
  agent_role: "repo_agent"
  model_name: "unknown"
  model_version: "unknown"
  session_id: "unknown"
  prompt_hash: "unknown"
  context_used_percent: "unknown"
  context_window_remaining: "unknown"

capabilities:
  can_read_files: true
  can_run_commands: false
  can_edit_files: false
  can_access_network: false
  tools_available: []
  max_depth_inspected: "unknown"
```

## 10. Common Route Signal

Every report may include `next_route`.

In Pi-native workflows, `next_route` should be required for all reports produced by autonomous agents.

```yaml
next_route:
  NR001:
    recommended_next_report: "FPR"
    recommended_next_action: "fix"
    target_refs:
      - "BSR#BG001"
    mutation_policy_needed: "mutation_allowed"
    auto_advance_safe: "conditional"
    requires_human_confirmation: true
    reason:
      - "Fix requires repo mutation and PlanSpec authority check."
    confidence: "medium"
```

### 10.1 Runtime route rule

The runtime must not blindly follow `next_route`.

Rules:

```text
read_only + high confidence + no blockers:
  auto-advance may be allowed

validation_only + explicit PlanSpec validation permission:
  auto-advance may be allowed

mutation_allowed:
  require PlanSpec authority or human confirmation

auto_advance_safe: yes:
  advisory only; runtime must verify

target_refs:
  must resolve in compiled report graph

unknown or unresolved target refs:
  route is invalid or requires human confirmation
```

## 11. Compiled Route Signal JSON

Compiler normalizes YAML `next_route` into:

```json
{
  "currentReportId": "P46_BSR_001",
  "currentReportType": "BSR",
  "recommendedNextReport": "FPR",
  "recommendedNextAction": "fix",
  "targetRefs": ["BSR#BG001"],
  "mutationPolicyNeeded": "mutation_allowed",
  "autoAdvanceSafe": "conditional",
  "requiresHumanConfirmation": true,
  "confidence": "medium",
  "valid": true,
  "diagnostics": []
}
```

## 12. Gate Verdict JSON

The compiler emits:

```json
{
  "reportId": "P46_BSR_001",
  "reportType": "BSR",
  "valid": true,
  "fatalErrors": [],
  "warnings": [],
  "blockingFindings": ["BG001"],
  "requiresHir": false,
  "requiresTvr": true,
  "blocksPromotion": true,
  "compiledAt": "2026-06-10T00:00:00Z",
  "staleAfter": "on_next_commit"
}
```

## 13. Compiler Pipeline

ACCP v2.0 compiler stages:

```text
1. LOAD
   Read .accp.yaml source.

2. YAML PARSE
   Parse strict YAML.

3. COMMON SCHEMA VALIDATION
   Validate common top-level keys.

4. REPORT REGISTRY VALIDATION
   Validate report.type exists in 24-type registry.

5. REPORT-SPECIFIC SCHEMA VALIDATION
   Validate required sections and fields.

6. ID VALIDATION
   Validate stable IDs and duplicate IDs.

7. REFERENCE VALIDATION
   Validate cross-report refs and target refs.

8. SEMANTIC VALIDATION
   Validate report-specific invariants.

9. EVIDENCE VALIDATION
   Validate file paths, line ranges, command evidence, hashes where available.

10. LINEAGE VALIDATION
   Validate report graph and required chains.

11. ROUTE SIGNAL NORMALIZATION
   Compile next_route into route-signal.json.

12. GATE VERDICT EMISSION
   Compile report into gate-verdict.json.

13. ARTIFACT EMISSION
   Emit compiled.json, ir.json, index.json, graph.json, rendered markdown.
```

## 14. Severity and Gate Rules

### 14.1 Priority

Bugfix reports use priority:

| Priority | Meaning |
|---|---|
| `P0` | Critical; security, data loss, corrupted state, unsafe mutation, unrecoverable failure. |
| `P1` | High; core workflow broken, gate bypass, state transition break, patch/apply correctness issue. |
| `P2` | Medium; important edge case, flaky behavior, misleading report, degraded correctness. |
| `P3` | Low; minor bug or non-blocking mismatch. |
| `P4` | Hygiene; maintainability or cleanup issue. |

### 14.2 Severity

Reports use severity:

```text
low
medium
high
critical
```

### 14.3 Blocking default

Default blocking rules:

```text
critical severity:
  blocks promotion unless explicitly marked non-blocking with evidence

P0 or P1 confirmed bug:
  blocks promotion

validation_status fail|blocked:
  blocks promotion

missing command evidence for required validation:
  blocks promotion

mutation without diff integrity:
  fatal

mutation without rollback plan:
  fatal

PRR approved_to_promote yes while blocking findings exist:
  fatal

route target refs missing:
  route invalid
```

## 15. Command Evidence

Validation commands must be structured.

```yaml
command_results:
  VT001:
    command: "pnpm test"
    cwd: "."
    started_at: "unknown"
    duration_seconds: "unknown"
    exit_code: 0
    output_excerpt: "12 passed"
    output_truncated: false
    validation_satisfied: true
    false_positive_guards:
      watch_mode: false
      no_tests_found: false
      command_not_found: false
      timeout: false
    confidence: "high"
```

Validation cannot pass if:

- command evidence is missing
- exit code is non-zero
- command was watch-mode
- no tests were found unexpectedly
- command was not found
- command timed out
- output is ambiguous and not investigated

## 16. Diff Integrity

Mutation reports must include diff integrity.

```yaml
diff_integrity:
  base_git_commit: "unknown"
  working_tree_clean_before: "unknown"
  working_tree_clean_after: "unknown"
  files_changed_count: 1
  total_added_lines: "unknown"
  total_removed_lines: "unknown"
  patch_size_lines: "unknown"
  diff_hash: "unknown"
  changed_files:
    F001:
      path: "packages/example.ts"
      change_type: "modified"
      added_lines: "unknown"
      removed_lines: "unknown"
      before_hash: "unknown"
      after_hash: "unknown"
      confidence: "medium"
```

If no mutation occurred:

```yaml
diff_integrity:
  no_repo_mutation_performed: true
```

## 17. Rollback Plan

Mutation and handoff reports must include rollback information.

```yaml
rollback_plan:
  RB001:
    action: "revert_file"
    target_files:
      - "packages/example.ts"
    command_or_manual_step: "git checkout -- packages/example.ts"
    risk: "low"
    validation_after_rollback:
      - "pnpm test"
```

If no mutation occurred:

```yaml
rollback_plan:
  no_repo_mutation_performed: true
  rollback_required: false
```

## 18. Cross-Report References

Short form:

```text
BSR#BG001
FPR#FX001
TVR#VT001
PRR#PR001
```

Long form:

```text
BSR.v2.0#P46_BSR_001:BG001
```

Rules:

- Short form is allowed only when graph context is unambiguous.
- Long form is preferred for compiled graph storage.
- Unknown refs must be diagnostics.
- Blocking refs must be preserved in graph.json.

## 19. Initial Route Indicator

The first task may begin with a natural language prompt.

That natural language prompt should be converted into a small route indicator, not a full intent framework.

```ts
interface InitialRouteIndicator {
  rawUserPrompt: string;
  taskKind:
    | "inspect"
    | "bug_search"
    | "bug_fix"
    | "implement"
    | "validate"
    | "promote"
    | "unknown";
  requestedReportType: ACCPReportType;
  mutationPolicy:
    | "read_only"
    | "mutation_allowed"
    | "validation_only";
  targetRefs: string[];
  targetPaths: string[];
  confidence: "high" | "medium" | "low";
  requiresConfirmation: boolean;
}
```

Safety rules:

```text
unknown:
  default to PIR + read_only

mutation_allowed + confidence not high:
  require confirmation

referenced finding not found:
  require confirmation or HIR

read_only:
  may auto-start
```

## 20. Workspace ACCP Contract

PlanSpec workspaces should be able to declare required ACCP output.

```yaml
accp:
  required_report_type: "IPR"
  required_sections:
    - "implementation_summary"
    - "changes"
    - "diff_integrity"
    - "rollback_plan"
    - "validation_handoff"
    - "final_status"
  mutation_policy: "mutation_allowed"
  compile_required: false
  on_compile_fail: "warn"
  artifact_directory: "reports/accp/{plan_id}/"
  command_evidence_required: true
  rollback_plan_required_for_mutation: true
  cross_report_references_required: true
```

P46:

```yaml
compile_required: false
on_compile_fail: "warn"
```

P47:

```yaml
compile_required: true
on_compile_fail: "block"
```

## 21. Report-Specific Required Sections Matrix

This is the initial v2.0 section matrix.

Names are YAML keys.

| Type | Required Sections |
|---|---|
| `RIR` | `repo_tree`, `domain_map`, `contracts_and_schemas`, `tests_and_gates`, `gaps_and_risks`, `final_status` |
| `PIR` | `plan_summary`, `scope_review`, `contract_review`, `workspace_review`, `gaps_and_risks`, `decisions`, `final_status` |
| `IPR` | `scope`, `implementation_summary`, `changes`, `diff_integrity`, `validation_handoff`, `rollback_plan`, `final_status` |
| `TVR` | `validation_summary`, `command_results`, `validation_not_run`, `regressions`, `final_status` |
| `HIR` | `blocker_summary`, `state_at_pause`, `rollback_plan`, `options`, `next_required_input`, `final_status` |
| `RAR` | `regression_summary`, `evidence`, `candidate_causes`, `blast_radius`, `minimal_fix_scope`, `decisions`, `final_status` |
| `PRR` | `promotion_target`, `gate_checks`, `open_risks`, `signoff_requirements`, `decisions`, `final_status` |
| `CAR` | `corrections`, `affected_downstream_reports`, `final_status` |
| `BSR` | `bug_search_scope`, `search_method`, `bug_findings`, `prioritized_fix_plan`, `validation_recommendations`, `final_status` |
| `BRR` | `bug_reference`, `reproduction_environment`, `reproduction_steps`, `reproduction_results`, `final_status` |
| `RCA` | `bug_reference`, `causal_chain`, `root_cause`, `discarded_hypotheses`, `final_status` |
| `FPR` | `scope`, `fix_summary`, `fixes`, `diff_integrity`, `rollback_plan`, `validation_handoff`, `final_status` |
| `FVR` | `fix_reference`, `validation_summary`, `command_results`, `regression_check`, `final_status` |
| `FER` | `feature_prompt`, `current_state`, `user_value`, `alternatives`, `risks`, `final_status` |
| `FDR` | `feature_reference`, `design_summary`, `architecture`, `data_flow`, `tradeoffs`, `final_status` |
| `FCR` | `feature_reference`, `contracts`, `schemas`, `events`, `compatibility`, `final_status` |
| `FIR` | `feature_reference`, `scope`, `implementation_summary`, `changes`, `diff_integrity`, `final_status` |
| `FGR` | `feature_reference`, `acceptance_criteria`, `gate_checks`, `validation_summary`, `final_status` |
| `WBR` | `writing_goal`, `audience`, `source_material`, `constraints`, `success_criteria`, `final_status` |
| `WDR` | `brief_reference`, `draft_summary`, `draft_content`, `claims`, `open_questions`, `final_status` |
| `WER` | `draft_reference`, `edit_summary`, `changes`, `style_constraints`, `final_status` |
| `WQR` | `writing_reference`, `quality_checks`, `unsupported_claims`, `missing_sections`, `final_status` |
| `ECR` | `claim`, `evidence`, `needed_next`, `final_status` |
| `DCR` | `conflict_summary`, `positions`, `decision_options`, `recommendation`, `final_status` |

## 22. Minimal BSR YAML Example

```yaml
accp_version: "2.0.0"
source_format: "ACCP-YAML"

report:
  id: "P46_BSR_001"
  type: "BSR"
  family: "bugfix"
  kind: "bug_search"
  status: "complete"

meta:
  plan_id: "P46"
  workspace_id: "unknown"
  repo_root: "."
  git_commit: "unknown"
  git_branch: "unknown"
  report_generated_at: "unknown"
  report_stale_after: "on_next_commit"
  inspection_mode: "read_only"
  confidence: "medium"

agent:
  agent_id: "coding-agent"
  agent_role: "reviewer"
  model_name: "unknown"
  model_version: "unknown"
  session_id: "unknown"
  prompt_hash: "unknown"
  context_used_percent: "unknown"
  context_window_remaining: "unknown"

capabilities:
  can_read_files: true
  can_run_commands: true
  can_edit_files: false
  can_access_network: false
  tools_available:
    - "read"
    - "bash"
    - "grep"
  max_depth_inspected: "unknown"

references: []

assumptions:
  AS001:
    assumption: "No prior ACCP report was provided."
    reason: "This is the first report in the chain."
    confidence: "high"
    how_to_verify: "Check reports/accp/P46/index.json."

skipped_inspections:
  S001:
    item: "Runtime source lines"
    reason: "Example only."
    risk: "medium"
    needed_next: "Run real repo inspection."

bug_search_scope:
  in_scope:
    - "Completion gate ACCP integration."
  out_of_scope:
    - "No file mutation."
  target_bug_classes:
    - "validation_bypass"
    - "report_integrity_bug"
  explicitly_not_changed:
    - "No files were modified."

search_method:
  strategy:
    - "Inspect completion and promotion control paths."
    - "Trace worker output to runtime gate."
  commands: []
  files_read: []
  limitations:
    - "Example document only; not based on actual repo inspection."

bug_findings:
  BG001:
    title: "Completion gate lacks ACCP verdict check."
    classification: "likely_bug"
    priority: "P1"
    severity: "high"
    confidence: "medium"
    affected_area: "validation"
    affected_files:
      - path: "packages/execution-runtime/src/completion-gate.ts"
        symbol: "evaluateWorkspaceCompletionV2"
        lines: "unknown"
    observed_behavior:
      - "Workspace completion may be decided without compiled ACCP evidence."
    expected_behavior:
      - "Completion gate should read ACCPGateVerdict."
    evidence:
      - id: "EV001"
        type: "missing_evidence"
        detail: "Requires repo inspection."
        path: "unknown"
        lines: "unknown"
    why_this_is_a_bug:
      - "Runtime cannot verify agent completion claims without compiled evidence."
    impact:
      - "Flash model may claim completion without structured proof."
    likely_root_cause:
      - "ACCP compiler/gate integration not yet implemented."
    reproduction:
      status: "static_evidence_only"
      steps:
        - "Inspect completion gate and worker output flow."
    minimal_fix:
      fix_id: "FX001"
      summary: "Add non-blocking ACCP gate reader."
      recommended_files:
        - "packages/execution-runtime/src/accp/accp-gate-reader.ts"
        - "packages/execution-runtime/src/accp/accp-promotion-evaluator.ts"
      forbidden_scope_expansion:
        - "Do not make gate blocking in P46."
      implementation_notes:
        - "P46 should warn only; P47 can block."
      risk: "medium"
    validation_after_fix:
      - id: "VT001"
        command: "pnpm test"
        cwd: "."
        expected_result: "ACCP gate reader tests pass."
    priority_reason:
      - "Completion verification is core to ACCP value."
    confidence_reason:
      - "Based on integration plan, not live repo inspection."

prioritized_fix_plan:
  FX001:
    fixes_bug: "BSR#BG001"
    priority: "P1"
    action: "add_guard"
    summary: "Wire non-blocking ACCP verdict reader into completion gate."
    minimal_files:
      - "packages/execution-runtime/src/accp/accp-gate-reader.ts"
      - "packages/execution-runtime/src/accp/accp-promotion-evaluator.ts"
    estimated_blast_radius: "medium"
    validation_required:
      - "VT001"
    blocks_promotion: true

validation_recommendations:
  VT001:
    purpose: "Validate ACCP gate reader and non-blocking completion behavior."
    command: "pnpm test"
    cwd: "."
    expected_pass_signal: "Relevant ACCP runtime tests pass."
    false_positive_guards:
      watch_mode: false
      no_tests_found: false
      command_not_found: false
      timeout: false

decisions:
  DC001:
    recommendation: "fix_next"
    applies_to:
      - "BG001"
    reason:
      - "ACCP completion verification depends on this integration."
    confidence: "medium"

next_route:
  NR001:
    recommended_next_report: "FPR"
    recommended_next_action: "fix"
    target_refs:
      - "BSR#BG001"
    mutation_policy_needed: "mutation_allowed"
    auto_advance_safe: "conditional"
    requires_human_confirmation: true
    reason:
      - "Fix requires repo mutation and PlanSpec authority check."
    confidence: "medium"

final_status:
  bug_search_status: "complete"
  repo_mutation_performed: false
  highest_priority: "P1"
  must_fix_before_promotion:
    - "BG001"
  safe_to_continue_without_fix: "conditional"
  requires_tvr: true
  requires_hir: false
  self_assessment:
    required_sections_complete: "yes"
    evidence_coverage: "low"
    unresolved_gaps:
      - "Example not based on live repo inspection."
    confidence_in_own_completeness: "medium"
```

## 23. Minimal Prompt Contract for Agents

For normal worker runs, do not paste the entire ACCP spec.

Use compact contracts:

```text
Return exactly one ACCP v2.0 YAML document.
source_format must be ACCP-YAML.
report.type must be BSR.
No prose outside YAML.
Do not modify files.
Use stable IDs.
confirmed or likely bugs require evidence.
P0/P1 bugs block promotion.
Include next_route.
```

Full ACCP v2.0 should be used for:

- compiler design
- schema authoring
- high-risk audit
- deep repo inspection
- protocol upgrades

## 24. Cheap Model Strategy

ACCP v2.0 is designed to make cheap/flash models safer.

Cheap models may be used for:

- initial route indicator
- ACCP report drafting in low-risk modes
- ACCP repair/canonicalization after compiler diagnostics
- dashboard summaries

Cheap models must not be used as sole authority for:

- gate verdict
- promotion readiness
- evidence validation
- mutation authorization
- snapshot/hash validation
- command result truth

Compiler and runtime authority must be deterministic TypeScript code.

## 25. Migration Strategy

This v2.0 draft intentionally does not include legacy parsing.

Migration recommendation:

```text
New Pi-native ACCP workflows:
  use .accp.yaml only

Manual human copy-paste workflows:
  may continue using ACCP-Lite outside the compiler path

Runtime:
  consumes compiled JSON only

Markdown:
  generated rendered view only
```

No legacy `.accp.md` source compatibility is required for Pi-native v2.0.

## 26. P46 / P47 / P48 / P49 Roadmap

### P46 — Foundation

- Add all 24 report types to registry.
- Add support level metadata.
- Add common YAML source schema.
- Add WorkspaceACCPContract.
- Add compiler stub.
- Add strict schemas for BSR, FPR, TVR, PRR, HIR, CAR.
- Emit compiled JSON, gate verdict, and route signal.
- Runtime gate reads verdict in non-blocking warning mode.

### P47 — Runtime enforcement

- Worker outputs must compile.
- Compile failure blocks workspace completion for gate-critical reports.
- Event journal records compile and gate events.
- TUI shows ACCP status and diagnostics.
- Evidence validation and lineage validation become stricter.

### P48 — Template expansion

- Feature family moves from template/schema-lite to schema-strict.
- Writing family moves from template/schema-lite to schema-strict.
- BRR, RCA, FVR become strict bugfix specialists.
- FGR can become gate-blocking for feature workflows.

### P49 — Multi-agent ACCP bus

- ECR and DCR become strict coordination artifacts.
- Agents subscribe to compiled ACCP artifacts.
- Runtime routes via route signals.
- Dashboard shows report graph and lineage.
- Brain emits strategy/decision artifacts.

## 27. Bottom Line

ACCP v2.0 is the YAML-native compiler profile.

The core shift:

```text
Before:
  agent writes prose-like report

After:
  agent emits serializable YAML source
  compiler emits verified JSON artifacts
  runtime gates on compiled evidence
```

The winning safety model:

```text
Do not trust the model.
Do not trust prose.
Do not trust raw source alone.

Trust deterministic compiler output,
verified evidence,
and runtime authority checks.
```

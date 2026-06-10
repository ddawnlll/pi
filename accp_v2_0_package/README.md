# ACCP v2.0 Package

This package contains the YAML-native ACCP v2.0 draft and implementation starter materials.

ACCP v2.0 is a breaking change from ACCP v1.2 and ACCP-Lite:

- Canonical source format is `.accp.yaml`.
- XML-like wrappers are removed.
- Runtime consumers read compiled JSON artifacts, not raw source.
- All 24 report types are registered.
- Support is staged by support level:
  - `known`
  - `template_available`
  - `schema_lite`
  - `schema_strict`
  - `gate_blocking`

## Package contents

```text
docs/
  accp_v2_0_yaml_compiler_profile.md
  accp_v2_0_1_addendum.md

examples/
  bsr_minimal.accp.yaml
  fpr_minimal.accp.yaml
  tvr_minimal.accp.yaml
  prr_minimal.accp.yaml

prompts/
  bsr_prompt_contract.txt
  fpr_prompt_contract.txt
  tvr_prompt_contract.txt
  prr_prompt_contract.txt
  repair_prompt_contract.txt

registry/
  report_registry.json
  support_matrix.json
  diagnostic_codes.json

schemas/
  accp_common.schema.json
  accp_bsr.schema.json
  accp_gate_verdict.schema.json
  accp_route_signal.schema.json
```

## Recommended P46 usage

1. Add all 24 report types to `execution-contracts`.
2. Implement common YAML parse + common schema validation.
3. Add strict schemas for:
   - BSR
   - FPR
   - TVR
   - PRR
   - HIR
   - CAR
4. Emit:
   - `.compiled.json`
   - `.ir.json`
   - `.gate-verdict.json`
   - `.route-signal.json`
5. Wire completion gate in non-blocking warning mode.

## Important safety rule

Do not trust model prose.
Do not trust raw ACCP source alone.
Trust deterministic compiler output, verified evidence, and runtime authority checks.

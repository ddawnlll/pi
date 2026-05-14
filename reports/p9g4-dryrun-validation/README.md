# P9.G4 — Dry-Run & Validation Recording

## Goal

Implement dry-run and validation recording for the remediation runtime, enabling:
1. Recording of dry-run assumptions and results before execution approval
2. Validation outcomes (targeted + integration) with pass/fail details
3. Traceable error records for validation failures

## Acceptance Criteria

| AC | Description | Status | Artifact |
|---|---|---|---|
| AC1 | Dry-run assumptions and results are recorded before execution approval | PASS | [01-dryrun-assumptions-report.md](./01-dryrun-assumptions-report.md) |
| AC2 | Validation outcomes (targeted + integration) recorded with pass/fail details | PASS | [02-validation-report.md](./02-validation-report.md) |
| AC3 | Validation failures produce traceable error records | PASS | [03-error-records.md](./03-error-records.md) |

## Artifacts

| File | Description |
|---|---|
| `01-dryrun-assumptions-report.md` | Recorded assumptions, verification status, dry-run simulation results |
| `02-validation-report.md` | Per-test validation outcomes with pass/fail/skip, failure analysis |
| `03-error-records.md` | Traceable error record schema, index, grouping, and lifecycle |
| `README.md` | This index file |

## Implementation

### Test File

**Path:** `packages/coding-agent/test/remediation-runtime-p9-g4.test.ts`

Contains 39 tests across 6 suites covering all 3 acceptance criteria:

- **AC1** (7 tests): Dry-run assumptions and results before execution approval
- **AC2** (18 tests): Targeted and integration validation outcomes with pass/fail
- **AC3** (9 tests): Traceable error records for validation failures
- **Integration** (5 tests): Full lifecycle with mixed outcomes

### Key Types (defined inline in test file)

| Type | Purpose |
|---|---|
| `DryRunAssumption` | An assumption recorded before dry-run execution |
| `ValidationOutcome` | Result of a targeted or integration validation |
| `ValidationFailure` | Traceable error record for a validation failure |
| `ValidationSummary` | Summary counts across all validations |
| `DryRunValidationRecord` | Complete dry-run and validation record |

### Workspace Conflicts

- `src/**` is LOCKED by P9.G2 — all source-level modifications deferred
- P9.G4 types are defined inline in the test file (not imported from `src/`)
- Once P9.G2 releases the lock, P9.G4 types should be promoted to the runtime source

## Usage

```bash
# Run P9.G4 tests
cd packages/coding-agent
npx vitest --run test/remediation-runtime-p9-g4.test.ts

# Run specific AC
npx vitest --run test/remediation-runtime-p9-g4.test.ts -t "AC1"
npx vitest --run test/remediation-runtime-p9-g4.test.ts -t "AC2"
npx vitest --run test/remediation-runtime-p9-g4.test.ts -t "AC3"
```

# P31 — Intent Template v4 and Legacy Normalizer

## Purpose

Replace mechanism-heavy plan configuration with intent-driven v4 contracts.

## Agent mode

The agent may edit docs, parser, plan intake, doctor, and tests.

## Key principle

Humans write intent. System derives mechanisms.

```text
Human writes:
  parallelism
  safetyLevel
  conflictRisk
  deadlines
  executionEnvironment
  workspaces

System derives:
  worktree requirement
  integration queue
  validation lanes
  GitRunner queue
  admission mode
  writeSet drift behavior
  sandbox requirements
```

## Workspaces

### P31.A — v4 intent schema

Fields:

```json
{
  "contractVersion": "4.0.0",
  "executionClass": "implementation",
  "intent": {
    "parallelism": 6,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": { "mode": "trusted_local" },
    "deadlines": {}
  },
  "workspaces": []
}
```

### P31.B — ExecutionProfileDeriver

Implement fixed derivation matrix from `reference/DERIVATION_MATRIX_V4.md`.

Acceptance:

```text
- deterministic derivation;
- no user-authored mechanism flags as authority;
- explain mode shows why mechanisms were enabled.
```

### P31.C — LegacyPlanNormalizer

Map v3 fields into v4 intent:

```text
maxParallelWorkspaces -> intent.parallelism
scale.selectedMode -> intent.parallelism/safetyLevel hint
worktreeRequired -> deprecated hint only
integrationQueueRequired -> deprecated hint only
validationLockRequired -> deprecated hint only
```

Acceptance:

```text
- old plans still parse;
- deprecated fields warn;
- derived profile is fresh and authoritative.
```

### P31.D — Doctor updates

Acceptance:

```text
- doctor validates derived profile, not user mechanism flags;
- warns on deprecated v3 fields;
- rejects impossible intent.
```

### P31.E — Template docs

Update canonical template docs to v4.

## Validation

```bash
pnpm --filter coding-agent test -- plan-parser plan-intake doctor execution-profile
pnpm --filter coding-agent typecheck
```

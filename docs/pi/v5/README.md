# V5 — Contract, Flags & Safety Doctrine

## Overview

V5 defines the capability boundary, feature flags, shared types, and safety doctrine
that govern all Brain V5 code paths. Every later workspace (V5.01+) operates within
this contract: **Brain V5 is advisory by default and never mutates execution state
directly**.

## Core Doctrine

### V4 ExecutionKernel Doctrine (inherited)

Brain code must not mutate execution state directly. Actors emit events only.

- **Allowed**: Emitting timeline events (observations, signals), actor events
  (proposals, evidence records)
- **Forbidden**: Direct calls to `StateWriter.transition()`, `MutationGuard.tryMutate()`,
  or any execution-graph mutation from brain modules

### V5 Safety Doctrine (extends V4)

1. **V5 is advisory by default** — In `ADVISORY` mode, V5 can emit observations and
   signals but cannot push changes to execution. Operator gates must pass to reach
   `DRAFTING` or `OPERATOR_READY`.

2. **No direct state mutation** — Every V5 event goes through `V5MutationGuard`,
   which validates against the current mode and allowed event type set.

3. **Explicit opt-in** — All V5 capability flags default to `false`/safe values.
   Users must explicitly enable them.

## Capability Flags

| Flag | Setting Key | Default | Description |
|------|-------------|---------|-------------|
| `BRAIN_V5_ENABLED` | `brainV5.enabled` | `false` | Master switch for all V5 code paths |
| `BRAIN_V5_READ_ONLY_MODE` | `brainV5.readOnlyMode` | `true` | When enabled, V5 cannot emit any events |
| `BRAIN_V5_PUSH_ENABLED` | `brainV5.pushEnabled` | `false` | Allows V5 to push approved changes to execution |
| `BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED` | `brainV5.overnightOperatorEnabled` | `false` | Allows V5 to run autonomous overnight operator sessions |

### Example `settings.json`

```json
{
  "brainV5": {
    "enabled": true,
    "readOnlyMode": false,
    "pushEnabled": true,
    "overnightOperatorEnabled": false
  }
}
```

## Operating Modes

V5 derives a single operating mode from the four flags. Modes are ordered from
least to most capable:

| Mode | Rank | Flags | Capabilities |
|------|------|-------|-------------|
| `OFF` | 0 | `enabled=false` | No V5 code paths execute |
| `READ_ONLY` | 1 | `enabled=true, readOnlyMode=true` | Observe only, no events emitted |
| `ADVISORY` | 2 | `enabled=true, readOnlyMode=false, pushEnabled=false` | Emit observation/signal events, cannot push |
| `DRAFTING` | 3 | `enabled=true, readOnlyMode=false, pushEnabled=true, overnightOperatorEnabled=false` | Emit approved change proposals |
| `OPERATOR_READY` | 4 | All flags enabled | Full autonomous operation |

### Mode Derivation Logic

```
if !enabled → OFF
else if readOnlyMode → READ_ONLY
else if !pushEnabled → ADVISORY
else if !overnightOperatorEnabled → DRAFTING
else → OPERATOR_READY
```

## Type/API Boundary

### Allowed Event Types (V5 → Execution Kernel)

V5 modules can emit:
- **Timeline events** (`BrainTimelineEvent`): observations, signals — always allowed
  in ADVISORY+
- **Actor events** (limited set): `proposal_submitted`, `proposal_evidence_recorded`,
  `workspace_started`, `workspace_running`, `tool_event`

### Forbidden Operations

V5 modules must **never**:
- Call `StateWriter.transition()` or any state transition API
- Call `MutationGuard.tryMutate()` or any mutation API directly
- Emit actor events like `retry_requested`, `validation_started`, `validation_passed`,
  `lease_stale_detected`, `cleanup_completed`, `llm_timeout`

All forbidden operations are enforced at compile time (type boundary) and at runtime
(`V5MutationGuard.validate()` / `V5MutationGuard.emit()`).

## Operator Gates

Before V5 can move from `ADVISORY` to `DRAFTING`+, three gates must pass:

1. **Push Enabled Gate** — `brainV5.pushEnabled` must be `true` in settings
2. **Safety Profile Gate** — The active safety profile must permit V5 mutations
3. **Execution Context Gate** — The current workspace/plan context must allow V5 actions

When all gates pass, V5 enters DRAFTING mode (or OPERATOR_READY if overnight is also enabled).

## Plan Doctor Integration

The plan doctor (`pi plan doctor`) reports V5 advisory status:

- **OFF mode**: "Brain V5 is disabled. No V5 suggestions or observations are available."
- **READ_ONLY mode**: "Brain V5 is in read-only mode. V5 can observe but cannot emit events or suggestions."
- **ADVISORY mode**: "Brain V5 is in advisory mode. V5 can emit observations and signals but cannot push changes."
- **DRAFTING mode**: "Brain V5 is in drafting mode. V5 can emit approved change proposals for execution."
- **OPERATOR_READY mode**: "Brain V5 is fully operational. V5 can run autonomous operator sessions."

## File Layout

```
packages/coding-agent/src/brain/v5/
  index.ts          — Barrel exports
  types.ts          — Shared types, enums, mode definitions
  config.ts         — Config resolution from SettingsManager
  mutation-guard.ts — V5MutationGuard (event emission validation)
  plan-doctor.ts    — Plan doctor integration (V5 advisory reporting)
packages/web-server/src/brain-v5-routes.ts     — REST API endpoints
packages/web-ui/dashboard/src/types-brain-v5.ts — Dashboard type definitions
docs/pi/v5/README.md                           — This document
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/brain-v5/status` | Current V5 mode and capability flags |
| GET | `/brain-v5/doctor` | V5 plan doctor report |
| GET | `/brain-v5/gates` | V5 operator gate status |

## Testing

Key test scenarios for V5:

1. **Mode derivation tests** — Verify all 5 modes derive correctly from flag combinations
2. **Mutation guard tests** — Verify that:
   - OFF mode rejects all events
   - READ_ONLY mode rejects all events
   - ADVISORY mode allows timeline events but rejects actor events
   - DRAFTING mode allows both timeline and allowed actor events
   - OPERATOR_READY mode allows everything (within allowed set)
   - Forbidden event types are always rejected
3. **Operator gate tests** — Verify gate logic
4. **Plan doctor tests** — Verify report content per mode

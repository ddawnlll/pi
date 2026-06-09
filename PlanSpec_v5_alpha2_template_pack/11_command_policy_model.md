# Command Policy Model — PlanSpec v5 alpha2

Alpha2 uses risk-tiered command policy.

## Layers

1. `exactAllowedCommands` for final and canonical validation.
2. `commandClasses` for safe autonomous discovery and bounded test families.
3. `runtimeCommandGrant` for unexpected but justified commands.
4. `hardDeniedCommands` for commands that never run.

Final validation must use exact allowed command references. Discovery commands cannot satisfy final promotion.

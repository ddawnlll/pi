# Migration Guide — v4.1.1 to PlanSpec v5 alpha2

## Steps

1. Extract v4.1.1 Part 3 JSON.
2. Map header fields to `metadata`.
3. Map selected mode and parallelism to `intent`.
4. Map doctrine to `authority`.
5. Map workspace list to `workspaces[]`.
6. Convert command strings into `commands.exactAllowedCommands`, `commands.commandClasses`, or runtime grant policy.
7. Convert prose requirements into `brief.hardRequirements[]` with typed `enforcedBy`.
8. Convert ACs into `workspaces[].acceptanceCriteria[]`.
9. Add allowedFiles and forbiddenFiles.
10. Validate with `02_planspec_v5_alpha2_schema.json`.
11. Compile to PlanLock.
12. Execute only PlanLock and worker packets.

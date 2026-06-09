# Compiler and Lock Algorithm — PlanSpec v5 alpha2

## Pipeline

```text
plan.spec.json
  -> JSON parse
  -> JSON Schema validation
  -> cross-reference validation
  -> canonical JSON normalization
  -> hash computation
  -> PlanLock generation
  -> worker packet generation
  -> non-authoritative Markdown render
```

## Cross-reference checks

- Every wave workspaceId exists.
- Every workspace dependency exists.
- Every workspace waveId exists.
- Every validation commandRef exists in exactAllowedCommands.
- Every `enforcedBy` value exists in enforcementRegistry.
- Final validation commandRefs are exact commands.
- P45 forbidden runtime paths are not in allowedFiles.

## Example canonical hash

```text
sha256:eb3430943d5a5aaa7c16978f9e7b5617c5a8b54d4f18e841e4adace1fa72a21a
```

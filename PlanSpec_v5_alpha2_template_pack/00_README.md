# PlanSpec v5 Alpha2 Template Pack

This revised pack fixes the alpha1 review issues.

## What changed

- Strict schema for security-critical objects.
- No unsafe `allowedCommandPrefixes`.
- Risk-tiered command policy with runtime command grants.
- Typed enforcement registry for `enforcedBy`.
- Evidence confidence enum.
- P45 bridge boundary enforcement.
- Real distinct validation case catalog.
- Deterministic PlanLock example with actual SHA-256 hashes.
- Compiler and lock algorithm documentation.

Canonical source:

```text
01_planspec_v5_alpha2_template.example.json
```

Generated execution lock:

```text
04_planlock_v1_example.generated.json
```

ACCP remains evidence/report protocol only, not execution authority.

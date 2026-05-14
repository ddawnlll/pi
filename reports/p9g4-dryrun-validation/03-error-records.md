# P9.G4 Traceable Error Records

**Generated:** 2026-05-15
**Workspace:** P9.G4 — Dry-Run & Validation Recording
**Status:** COMPLETE

## 1. Error Record Schema

Each validation failure produces a `ValidationFailure` record with the following schema:

```typescript
interface ValidationFailure {
  traceId: string;        // Unique trace ID (format: "trace-{origin}-{seq}")
  error: string;          // Human-readable error message
  errorType: string;      // Error class for grouping (e.g., "TypeError", "FileNotFoundError")
  filePath?: string;      // File path related to the failure
  lineNumber?: number;    // Line number related to the failure
  stackTrace?: string;    // Stack trace (if available)
  context?: object;       // Structured debugging context
}
```

## 2. Error Record Index

| Trace ID | Error Type | File | Summary |
|---|---|---|---|
| `trace-fail-001` | `TypeError` | `src/utils.ts:42` | Type assignment error in targeted validation |
| `trace-cycle-001` | `CircularDependencyError` | — | Cross-workspace cycle in integration validation |
| `trace-targeted-4` | `TargetedCheckError` | — | Mixed scenario targeted failure |
| `trace-integration-3` | `IntegrationCheckError` | — | Mixed scenario integration failure |
| `trace-abc-123` | `FileNotFoundError` | `src/missing.ts` | Missing file in validation |
| `trace-ctx-001` | `LockContentionError` | `src/**` | Workspace lock conflict with P9.G2 |
| `trace-f1` | `FileNotFoundError` | `src/a.ts` | File A not found |
| `trace-f2` | `TypeError` | `src/b.ts:15` | File B type error |
| `trace-f3` | `CircularDependencyError` | — | Workspace C cycle |

## 3. Error Grouping by Type

| Error Type | Count | Trace IDs |
|---|---|---|
| `FileNotFoundError` | 2 | `trace-abc-123`, `trace-f1` |
| `TypeError` | 2 | `trace-fail-001`, `trace-f2` |
| `CircularDependencyError` | 2 | `trace-cycle-001`, `trace-f3` |
| `TargetedCheckError` | 1 | `trace-targeted-4` |
| `IntegrationCheckError` | 1 | `trace-integration-3` |
| `LockContentionError` | 1 | `trace-ctx-001` |
| **TOTAL** | **9** | |

## 4. Traceable Error Lifecycle

### Creation

Errors are created during validation execution when a check fails:

```
ValidationRunner.run("file-existence")
  -> checkFile("src/a.ts")
  -> Promise.reject(new FileNotFoundError("File not found: src/a.ts"))
  -> ValidationFailure {
       traceId: "trace-f1",
       error: "File not found: src/a.ts",
       errorType: "FileNotFoundError",
       filePath: "src/a.ts"
     }
```

### Propagation

The error record is attached to the `ValidationOutcome`:

```
ValidationOutcome {
  id: "val-targeted-001",
  status: "fail",
  error: ValidationFailure { traceId: "trace-f1", ... }
}
```

### Traceability

`traceId` enables end-to-end tracing:

```
ValidationOutcome.id
  -> ValidationOutcome.error.traceId
    -> ValidationFailure.context (debugging context)
    -> Error origin (filePath:lineNumber)
```

## 5. P9.G2 Lock Contention — Special Error Record

The P9.G2 lock contention on `src/**` is recorded as a special validation failure:

```json
{
  "traceId": "trace-ctx-001",
  "error": "Workspace lock contention detected",
  "errorType": "LockContentionError",
  "context": {
    "lockedBy": "P9.G2",
    "targetPath": "src/**",
    "acquiredAt": "2026-05-15T09:00:00Z",
    "retryCount": 3,
    "strategy": "flash"
  }
}
```

This error record is traceable and includes sufficient context for debugging:
- **lockedBy:** Identifies the holding workspace (P9.G2)
- **targetPath:** The locked resource path
- **acquiredAt:** When the lock was acquired
- **retryCount:** Number of retry attempts (3)
- **strategy:** Retry strategy (flash)

## 6. Key Design Decisions

1. **traceId is mandatory** — Every failure must have a unique trace ID. This ensures no failure goes untracked.
2. **Error grouping by errorType** — Enables trend analysis: "how many FileNotFoundErrors occurred?"
3. **Minimal fields supported** — Only `traceId`, `error`, and `errorType` are required. Optional fields enable detailed debugging without burdening simple cases.
4. **Context is structured (not freeform)** — Using `Record<string, unknown>` enables machine-readable analysis.

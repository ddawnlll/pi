# P44.02 — EvidenceLedger and Artifact Evidence Model

## Overview

The EvidenceLedger is an in-memory store for evidence entries that support or contradict workspace acceptance criteria. Each entry records a piece of evidence with its type, verdict, confidence level, and traceability links to criteria.

The **Artifact Evidence Model** extends this by providing a structured way to represent files, build output, reports, and other artifacts produced during workspace execution as evidence entries.

## Contract Schema

**Version**: 4.1.1  
**Module**: `packages/coding-agent/src/core/completion/`

## Architecture

```
┌─────────────────────────────────────────────────┐
│                EvidenceLedger                     │
│  ┌──────────────────────────────────────────┐   │
│  │  Map<id, EvidenceLedgerEntry>             │   │
│  │  + add()   + get()   + has()   + remove() │   │
│  │  + query() + getByCriterion()             │   │
│  │  + getByVerdict() + getByType()           │   │
│  │  + getSummary() + getFailures()           │   │
│  │  + toJSON() + fromJSON() + buildReport()  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│            EvidenceLedgerEntry                    │
│  { id, type, description, source, timestamp,     │
│    verdict, confidence, content, metadata,        │
│    producedBy, criterionIds, planLockHash,        │
│    workspaceLockHash }                            │
└─────────────────────────────────────────────────┘
```

## Evidence Types

| Type | Description |
|------|-------------|
| `test_run` | Output from running a test suite or test command |
| `source_file` | Source file content or metadata |
| `manual_review` | Manual review result |
| `artifact` | Artifact produced by a workspace (file, report, build output) |
| `log_output` | Log output from a command execution |
| `static_analysis` | Type-checking or linting result |
| `command_result` | Command exit code and output |
| `build_output` | Build/compilation output |
| `benchmark` | Performance benchmark result |
| `security_scan` | Security scan result |
| `approval` | Human approval or sign-off |
| `automated_analysis` | Automated analysis result |
| `external_reference` | External system reference or link |
| `other` | Other evidence type |

## Evidence Confidence Levels

| Level | Description |
|-------|-------------|
| `high` | Strong, trustworthy evidence (e.g., automated test pass) |
| `medium` | Moderate confidence (e.g., manual review) |
| `low` | Weak evidence (e.g., log heuristic) |
| `unknown` | No confidence assessment available |

## Evidence Verdicts

| Verdict | Description |
|---------|-------------|
| `pass` | Evidence supports the criterion |
| `fail` | Evidence contradicts the criterion |
| `inconclusive` | Evidence is ambiguous |
| `not_evaluated` | Evidence has not been evaluated yet |

## Usage

### Creating a Ledger

```typescript
import { EvidenceLedger } from "./evidence-ledger.js";
import { formatEvidenceId } from "./evidence-types.js";

const ledger = new EvidenceLedger("P44.02");
```

### Adding Evidence

```typescript
ledger.add({
  id: formatEvidenceId("P4402", 1),  // "EV-P4402-001"
  type: "test_run",
  description: "Unit tests pass",
  source: "npm test -- --run",
  timestamp: Date.now(),
  verdict: "pass",
  confidence: "high",
  content: "Tests: 42 passed, 0 failed",
  criterionIds: ["AC-P4402-001"],
  producedBy: "worker-tests",
});
```

### Adding Artifact Evidence

The Artifact Evidence Model provides a dedicated helper for creating artifact-type entries:

```typescript
import { createArtifactEvidence } from "./evidence-types.js";

const artifact = createArtifactEvidence({
  id: "EV-P4402-002",
  description: "Compiled application bundle",
  source: "dist/app.js",
  verdict: "pass",
  confidence: "high",
  fileSize: 24576,
  mimeType: "application/javascript",
  fileHash: "sha256-abc123def456",
  criterionIds: ["AC-P4402-001", "AC-P4402-002"],
  producedBy: "worker-build",
});

ledger.add(artifact);
```

### Querying Evidence

```typescript
// By type
const testRuns = ledger.getByType("test_run");

// By verdict
const failures = ledger.getByVerdict("fail");

// By criterion
const criterionEvidence = ledger.getByCriterion("AC-P4402-001");

// Complex filter
const results = ledger.query({
  type: "test_run",
  verdict: "pass",
  minConfidence: "high",
  after: Date.now() - 3600000,  // last hour
});
```

### Summary Statistics

```typescript
const summary = ledger.getSummary();
// { total: 5, byType: { test_run: 3, artifact: 2 }, ... }

const passRate = ledger.getPassRate();
// 0.8 (80%)

const filteredSummary = ledger.getFilteredSummary({ type: "test_run" });
```

### Serialization

```typescript
// Serialize to JSON
const snapshot = ledger.toJSON();
console.log(snapshot.scopeId, snapshot.total, snapshot.entries);

// Restore from JSON
const restored = EvidenceLedger.fromJSON(snapshot);
```

### Generating Reports

```typescript
// Full report
console.log(ledger.buildReport());

// Filtered report
console.log(ledger.buildReport({ type: "test_run" }));
```

## Integration Points

| Component | Relationship |
|-----------|-------------|
| **AcceptanceCriteriaRegistry (P44.01)** | Evidence entries are linked to criteria via `criterionIds` and traceability links |
| **WorkerReportContract (P44.06)** | Evidence summaries feed into worker reports |
| **CompletionGate** | Blocking completion when critical evidence is missing or failing |

## Artifact Evidence Model

The Artifact Evidence Model is the representation of workspace-produced files as evidence entries. It uses the `"artifact"` type in `EvidenceLedgerEntry` and supports artifact-specific metadata fields via the `createArtifactEvidence()` helper.

### Artifact-specific metadata

When using `createArtifactEvidence()`, the following artifact-specific fields are automatically stored in `metadata`:

| Field | Type | Description |
|-------|------|-------------|
| `fileSize` | `number` | Size of the artifact in bytes |
| `mimeType` | `string` | MIME type of the artifact (e.g., `application/javascript`) |
| `fileHash` | `string` | Cryptographic hash of the artifact (e.g., `sha256-...`) |

Any additional properties passed via the `metadata` option are merged in.

### Example: Build Artifact as Evidence

```typescript
const buildArtifact = createArtifactEvidence({
  id: "EV-P4402-003",
  description: "Production build output",
  source: "dist/main.bundle.js",
  verdict: "pass",
  confidence: "high",
  fileSize: 94208,
  mimeType: "application/javascript",
  fileHash: "sha256-e3b0c44298fc1c14...",
  metadata: {
    buildTime: "12.4s",
    compiler: "esbuild 0.19.0",
  },
  criterionIds: ["AC-P4402-003"],
  producedBy: "worker-build",
});
```

## API Reference

### `formatEvidenceId(prefix, sequence)`

Formats a scope prefix and sequence number into a canonical evidence ID.

- `prefix`: Scope identifier (e.g., `"P4402"`, `"P44.02"`)
- `sequence`: Sequence number (zero-padded to 3 digits)
- Returns: `"EV-P4402-001"` format

### `createArtifactEvidence(overrides)`

Creates an `EvidenceLedgerEntry` with `type: "artifact"` and structured artifact metadata.

- `overrides.id` (required): Unique evidence identifier
- `overrides.description` (required): Human-readable description
- `overrides.source` (required): File path or source location
- `overrides.verdict` (optional, default `"not_evaluated"`): Evidence verdict
- `overrides.confidence` (optional, default `"medium"`): Confidence level
- `overrides.content` (optional, default `""`): Full content or summary
- `overrides.fileSize` (optional): File size in bytes
- `overrides.mimeType` (optional): MIME type
- `overrides.fileHash` (optional): Cryptographic hash
- `overrides.criterionIds` (optional, default `[]`): Related criterion IDs
- `overrides.producedBy` (optional): Producing scope/worker
- `overrides.metadata` (optional): Additional structured metadata
- `overrides.planLockHash` (optional): Plan lock hash (v5 ACCP mode)
- `overrides.workspaceLockHash` (optional): Workspace lock hash (v5 ACCP mode)

### `computeEvidenceSummary(entries)`

Computes aggregate statistics over an array of evidence entries.

### `meetsMinConfidence(confidence, minConfidence)`

Checks if a confidence level meets or exceeds a minimum threshold. Ordering: `high > medium > low > unknown`.

### `EvidenceLedger` class

| Method | Description |
|--------|-------------|
| `constructor(scopeId)` | Create a new ledger for the given scope |
| `add(...entries)` | Add/update evidence entries |
| `get(id)` | Get an entry by ID |
| `has(id)` | Check if an entry exists |
| `remove(id)` | Remove an entry (returns boolean) |
| `getAll()` | Get all entries |
| `query(filter)` | Query with multi-criteria filter |
| `getByCriterion(id)` | Get entries linked to a criterion |
| `getByVerdict(verdict)` | Get entries by verdict |
| `getByType(type)` | Get entries by type |
| `getSummary()` | Summary statistics for all entries |
| `getFilteredSummary(filter)` | Summary for filtered entries |
| `getPassRate()` | Fraction of entries with "pass" verdict |
| `getFailures()` | Get all entries with "fail" verdict |
| `getHighConfidenceEvidence()` | Get entries with high confidence |
| `clear()` | Remove all entries |
| `toJSON()` | Serialize to a snapshot object |
| `static fromJSON(snapshot)` | Restore from a snapshot |
| `buildReport(filter?)` | Generate human-readable report |

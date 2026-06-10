# Traceability Schema (P44.01)

## Overview

The Traceability Schema defines the formal relationships between acceptance criteria and the evidence artifacts that verify them. It is part of the Acceptance Criteria & Traceability system (P44.01).

Each traceability link connects a criterion (identified by an `AC-*` ID) to an evidence entry (identified by an `EV-*` ID), describing the nature of the relationship and providing optional context.

## Schema Version

Current version: `1.0.0` (defined as `TRACEABILITY_SCHEMA_VERSION` in `traceability-schema.ts`)

## Core Types

### TraceabilityRelationship

The nature of the relationship between a criterion and evidence:

| Relationship | Description |
|---|---|
| `proves` | Evidence directly proves the criterion is satisfied |
| `supports` | Evidence partially supports the criterion |
| `contradicts` | Evidence contradicts the criterion (indicates failure) |
| `references` | Evidence is contextually related but not directly proving |

### TraceabilityLink

A link connecting a criterion ID to an evidence entry ID:

```typescript
interface TraceabilityLink {
  criterionId: string;  // e.g., "AC-P4401-001"
  evidenceId: string;   // e.g., "EV-P4401-001"
  relationship: TraceabilityRelationship;
  explanation: string;  // optional context
  createdAt: number;    // epoch ms
}
```

### TraceabilityReport

A structured summary of all links:

```typescript
interface TraceabilityReport {
  scopeId: string;
  schemaVersion: string;
  totalCriteria: number;
  totalEvidence: number;
  totalLinks: number;
  byRelationship: Record<TraceabilityRelationship, number>;
  generatedAt: number;
  links: TraceabilityLink[];
}
```

## Module Structure

### `traceability-schema.ts`

The standalone schema module that defines:

- **Types**: `TraceabilityRelationship`, `TraceabilityLink`, `TraceabilityLinkInput`, `TraceabilityReport`
- **Link creation**: `createLink()`, `createTraceabilityLink()`
- **Validation**: `validateLink()`, `isValidLink()`
- **Queries**: `filterLinksByRelationship()`, `getLinksForCriterion()`, `getLinksForEvidence()`
- **Analysis**: `buildCriterionLinkMap()`, `buildEvidenceLinkMap()`, `countLinksByRelationship()`
- **Reporting**: `buildReport()`, `buildTraceabilityReport()`

### `acceptance-criteria.ts`

Consumes the traceability schema and re-exports its types and functions for backward compatibility:

```typescript
// Re-exports from traceability-schema.ts:
export { createTraceabilityLink } from "./traceability-schema.js";
export type { TraceabilityLink as CriterionTraceabilityLink } from "./traceability-schema.js";
```

The `AcceptanceCriteriaRegistry` class integrates traceability links as first-class state:

```typescript
registry.addTraceabilityLink(link);
registry.getTraceabilityLinks();
registry.getLinksForCriterion(criterionId);
registry.buildReport(evidenceEntries);
```

## Usage

### Creating links

```typescript
import { createTraceabilityLink } from "./traceability-schema.js";

const link = createTraceabilityLink(
  "AC-P4401-001",
  "EV-P4401-001",
  "proves",
  "Integration test verifies the criterion"
);
```

### Validating links

```typescript
import { validateLink, isValidLink } from "./traceability-schema.js";

const errors = validateLink(link);
// Returns string[] – empty means valid

if (isValidLink(link)) {
  // link passes validation
}
```

### Querying links

```typescript
import { getLinksForCriterion, filterLinksByRelationship } from "./traceability-schema.js";

// All links for a criterion
const links = getLinksForCriterion(allLinks, "AC-P4401-001");

// Only "proves" relationships
const provingLinks = filterLinksByRelationship(allLinks, "proves");
```

### Building reports

```typescript
// Structured report
const report = buildReport("P44.01", links);
console.log(report.totalLinks); // 5

// Human-readable report (with evidence descriptions)
const readable = buildTraceabilityReport(links, evidenceEntries);
```

### Using with AcceptanceCriteriaRegistry

```typescript
const registry = new AcceptanceCriteriaRegistry("P44.01");
registry.register(criterion);
registry.addTraceabilityLink(link);

// Check completeness
if (registry.isComplete()) {
  // All required/blocking criteria satisfied
}

// Get blocking reasons
const reasons = registry.getBlockingReasons();

// Serialize for artifacts
const report = registry.toJSON();
```

## Integration Points

| Component | Integration |
|---|---|
| EvidenceLedger (P44.02) | Traceability links reference evidence entries by ID |
| WorkerReportContract (P44.06) | Reports include criterion status and evidence summaries |
| CompletionGate | Blocks completion when criteria have unmet traceability requirements |

## Backward Compatibility

The type `CriterionTraceabilityLink` (from `acceptance-criteria.ts`) is a type alias for `TraceabilityLink` (from `traceability-schema.ts`). Both can be used interchangeably. Code importing from `acceptance-criteria.ts` continues to work unchanged.

## Contract Schema

- Schema: 4.1.2
- Source: `packages/coding-agent/src/core/completion/traceability-schema.ts`
- Tests: `packages/coding-agent/test/completion/acceptance-criteria.test.ts`
- Integration tests: `packages/coding-agent/test/p44/p44_01.test.ts`

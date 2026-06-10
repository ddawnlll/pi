# Planner Prompt Rules — P44.12 Extension

**Last Updated:** 2026-06-09
**PlanSpec Reference:** P44.12

## Scope

These prompt rules augment the Master Template v4.1.1 with P44 Verified Completion Spine requirements. Planners generating implementation, verification, or repair plans must follow these rules when P44 completion gates, evidence ledger, and commit safety are in scope.

## Rule 1: Stable AC IDs

Every acceptance criterion MUST have a stable, unique ID following the format:

```
AC-{WorkspaceId}-{NNN}
```

where `{NNN}` is a zero-padded three-digit sequence number.

**Examples:**
- `AC-P4401-001`
- `AC-P4403-012`
- `AC-P44WG-001`

IDs must not change between plan versions unless the criterion itself is modified. Deleted criteria leave the ID vacant (do not reuse).

## Rule 2: Evidence Types

All evidence must be one of the nine canonical types:

| Type | Description | Example |
|------|-------------|---------|
| `source` | Source code file | Implementation of a module |
| `test` | Test file or test run output | Passing test suite |
| `command` | Command execution output | `npm run check` output |
| `diff` | Git diff or file comparison | Before/after of changes |
| `negative` | Negative assertion check | Absence of forbidden patterns |
| `mutation` | Mutation record | Write gate log entry |
| `commit` | Git commit reference | Commit hash for workspace |
| `report` | Structured report | Worker completion report |
| `runtime` | Execution data | Performance metrics |

## Rule 3: Completion Gate Requirements

When CompletionGate v2 is active:

1. COMPLETE requires evidence for ALL acceptance criteria
2. Missing evidence for any AC blocks COMPLETE with exact missing AC IDs listed
3. Validation evidence must come from real test runs — forbidden evidence sources include:
   - Zero tests found / no tests discovered
   - Watch mode output that never completes
   - Command not found errors
   - Timed out command output
   - Silent pass guards (tests that always pass)
4. Plan lock hash and workspace lock hash must be echoed in worker output when planspec_locked mode is enabled
5. Lock hash mismatch or missing echo blocks COMPLETE

## Rule 4: Evidence Ledger

The evidence ledger must be populated before completion evaluation:

1. Every evidence entry must have: id, type, description, source, timestamp, verdict (pass/fail), confidence (high/medium/low), content, and criterionIds
2. Entries must be queryable by criterion ID
3. The ledger must serialize to JSON without losing data
4. Rejected evidence (invalid types, missing fields) must be reported

## Rule 5: Negative Assertions

Plans that include `negative` acceptance criteria must specify:

1. The forbidden pattern (regex or exact string)
2. The search scope (file glob patterns)
3. Whether it is a grep check or AST-based check
4. The expected negative outcome (pattern must NOT be found)

## Rule 6: Workspace Commit Gate

When WorkspaceCommitGate is active:

1. Only files matching the workspace's `allowedFiles` or `canEdit` may be staged
2. `git add .`, `git add -A`, and `git commit -a` are forbidden in production worker commit paths
3. The commit must only include files in the accepted write set
4. If staged files change after gate approval, the commit must abort

## Rule 7: Post-Implementation Auditor

After implementation, the auditor must:

1. Compare claimed changed files to actual git diff output
2. Verify all required acceptance criteria were addressed
3. Report `completeAllowed: false` for fake-complete scenarios

## Rule 8: P45 Bridge Safety

Bridge artifacts for P45:

1. Only write to `packages/coding-agent/src/core/p44/p45-bridge/` paths
2. Never write to `packages/coding-agent/src/p45/`, `async-assembly/`, `static-partitioner/`, or `deterministic-assembler/`
3. Bridge artifacts are read-only for P45 consumption

## Rule 9: Validation Evidence Integrity

Validation is only valid when:

1. A named test runner was invoked (vitest, ava, jest, mocha, etc.)
2. The test command exited with code 0
3. At least one test was found and ran
4. Not in watch/interactive mode
5. Not timed out

## Rule 10: Report Format

Worker completion reports must follow the structured `WorkerReport` format:

```typescript
interface WorkerReport {
  reportId: string;
  schemaVersion: string;
  workerId: string;
  workspaceId: string;
  planId: string;
  startedAt: number;
  completedAt: number;
  verdict: "pass" | "fail" | "inconclusive" | "not_started" | "in_progress";
  criteriaStatus: Array<{
    id: string;
    description: string;
    status: "verified" | "failed" | "unverified";
    evidenceIds: string[];
    notes: string;
  }>;
  mutations: {
    created: string[];
    modified: string[];
    deleted: string[];
    commandsExecuted: string[];
    editCount: number;
  };
  evidenceSummary: {
    total: number;
    passed: number;
    failed: number;
  };
  summary: string;
}
```

## References

- Master Template: `/docs/llm-implementation-agent-master-template.md`
- Template Update Doc: `/docs/pi/p44/master-template-update.md`
- PlanSpec v5 Alpha2: `/docs/P44_PlanSpec_v5_alpha2.json`

# P44.6 — Deep Research Summary

## Repo Root Discovery

- **Repo root:** `/Users/hootie/src/pi` (resolved via `git rev-parse --show-toplevel`)
- **All paths in reports are repo-relative.**

---

## Artifacts Written

| Artifact | Path | Size |
|---|---|---|
| RIR | `reports/accp/P44.6/source/P44_6_RIR_001.accp.yaml` | 13.1KB |
| PIR | `reports/accp/P44.6/source/P44_6_PIR_001.accp.yaml` | 9.8KB |
| BSR | `reports/accp/P44.6/source/P44_6_BSR_001.accp.yaml` | 11.3KB |
| FDR | `reports/accp/P44.6/source/P44_6_FDR_001.accp.yaml` | 15.8KB |
| Summary | `reports/p44-6/research/P44_6_deep_research_summary.md` | this file |
| Workspace graph | `reports/p44-6/research/P44_6_recommended_workspace_graph.json` | next artifact |

## Missing Inputs

No missing inputs were found that block the research. All required inspection targets exist:

- PlanSpec v5 Alpha2 template pack at `PlanSpec_v5_alpha2_template_pack/`
- Zod-based PlanSpec v5 RC1 schema at `packages/coding-agent/src/core/planspec-v5-schema.ts`
- Existing write/edit tools at `packages/coding-agent/src/core/tools/write.ts` and `edit.ts`
- SmartMutationEngine (`mutation/`), WriteGate (`write-gate.ts`), CompletionGate v2 (`completion/`)
- Snapshot artifact store at `packages/execution-contracts/src/snapshot-artifact.ts`
- P44.5 FDR/FCR reports for prior art
- ACCP report mapping documented

**However, there is no pre-existing `smart_write`, `smart_edit`, or `ArtifactGenerationGate` module.**

---

## Top 5 Findings

### F001: Repo Root and Path Normalization

`resolveToCwd()` in `path-utils.ts` resolves relative paths against the working directory but returns absolute paths as-is. There is no enforcement that paths are anchored to `git rev-parse --show-toplevel`. P44.6 must add `RepoPathResolver` that normalizes all paths against the dynamic repo root and rejects paths outside it.

### F002: Existing Write/Edit Tooling Has Major Gaps

The `write` tool (12.5KB at `packages/coding-agent/src/core/tools/write.ts`) supports two paths:
1. **SmartMutationEngine path** — delegates to `sme.mutate()` which handles atomic write, hash verification, parser validation, and rollback
2. **Direct write path** — plain `fs.writeFile()` with no validation beyond file system error handling

Neither path has:
- Schema validation (Zod or JSON Schema)
- Truncation detection (byte count comparison)
- Input manifest preflight
- HIR routing on failure

The `edit` tool (20.2KB at `packages/coding-agent/src/core/tools/edit.ts`) has no temp-copy validation, no AST awareness, and no schema validation.

### F003: Large Artifact Truncation Risk is Real and Unaddressed

The direct write path uses `content.length` (JavaScript string length, not byte length) for reporting. There is no post-write byte count comparison. The SmartMutationEngine verifies content hash after write but does not compare expected vs actual byte count. A truncated write with the correct hash (partial content matching the hash of the full content) would pass.

The `TruncationDetector` type is referenced in `WriteGate` but no implementation was found. The `WriteGate.processWriteResult()` calls `this.truncationDetector` but this appears to be a no-op.

### F004: Schema Validation Exists But Is Not Wired Into Write Path

Two PlanSpec schemas exist:
1. **JSON Schema (alpha2):** `PlanSpec_v5_alpha2_template_pack/02_planspec_v5_alpha2_schema.json` — 36 `additionalProperties: false` constraints, no runtime validator in `packages/`
2. **Zod Schema (RC1):** `packages/coding-agent/src/core/planspec-v5-schema.ts` — used by `compilePlanSpecAlpha2` for plan compilation, but not integrated into the write tool

Neither schema is checked before or after write operations. Generated JSON artifacts bypass schema validation entirely.

### F005: Failure Routing Gap is the Root Cause

The critical finding is **silent continuation after failure**. Current behavior:
- Missing input file: agent continues (reads another file or guesses content)
- Path mismatch: agent writes to wrong location
- Write failure: agent receives error string but continues
- Parse failure: optional rollback in mutation engine but no HIR
- Schema failure: caught at compile time, not write time

**No system-level hard stop exists.** P44.6 must route all failure classes to HIR with ArtifactFailureRouter.

---

## Recommended P44.6 Workspace Graph

```
P44.6.00  Artifact Preflight Contract and Input Manifest
    ├── ArtifactGenerationGate
    ├── InputManifestBuilder
    └── RepoPathResolver

P44.6.01  SafeArtifactWriter / smart_write     (depends on P44.6.00)
    └── SafeArtifactWriter + smart_write tool

P44.6.02  SafeArtifactEditor / smart_edit       (depends on P44.6.00)
    └── SafeArtifactEditor + smart_edit tool

P44.6.03  Artifact Validation Runner            (depends on P44.6.00)
    └── ArtifactValidationRunner

P44.6.04  Artifact Failure Router               (depends on P44.6.00-03)
    └── ArtifactFailureRouter

P44.6.05  PlanSpec and ACCP Generation Gauntlets (depends on P44.6.01-04)
    └── End-to-end tests
```

Estimated order: P44.6.00 → P44.6.01 + P44.6.02 + P44.6.03 → P44.6.04 → P44.6.05

---

## Should P44.6 Include smart_write?

**Yes, mandatory.** smart_write is the core deliverable. The existing `write` tool lacks:
- Input manifest preflight
- Truncation detection
- Schema validation
- HIR routing
- Companion artifact separation

SafeArtifactWriter (smart_write) must reuse `atomicWriteFile`, `validateFileContent`, and `checkWriteSet` from the existing SmartMutationEngine but add:
- `Buffer.byteLength` pre-computation and post-write comparison
- Schema validation integration
- Forbidden direct-write-above-threshold
- HIR routing on any failure

---

## Should P44.6 Include smart_edit?

**Yes, but minimal deterministic scope only.** smart_edit must:
- Use anchor/oldText/newText replacement (same as existing edit tool)
- Copy file to temp before editing
- Validate temp copy (parse, schema)
- Replace original only on validation pass
- Refuse if anchor not found

No AST-aware editing, no range-based editing, no multi-hunk orchestration beyond what the existing edit tool already supports.

---

## Would Common Research Workers Be Over-Engineering?

**Yes.** A generic common research-worker system with plugin architecture, coordinator, or swarm discovery is explicitly out of scope for P44.6. The problem is a specific failure class (verified write/edit), not insufficient research generality. Research workers, if needed, belong in P45+.

---

## Recommended Next ACCP Route

**FCR (Contract Freeze Report)** — route to FCR when the design recommendations in FDR are accepted. The FCR should:
1. Freeze workspace graph (P44.6.00 through P44.6.05)
2. Freeze module boundaries and responsibilities
3. Freeze acceptance criteria (AC-P446-001 through AC-P446-012)
4. Freeze over-engineering boundary (must-not-build list)
5. Freeze reuse strategy (existing mutation primitives, not new infrastructure)

**If blocked** (e.g., design direction rejected, workspace graph disputed): route to HIR.

# Workspace 7.A — Plan Factory Engine

**Status:** Complete
**Date:** 2026-05-22

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Creates phase markdown file from proposal input | ✅ | `engine.ts:createPlan()` writes markdown to `docs/pi/phases/`; test confirms file exists |
| 2 | Generates JSON execution contract matching v2.5.1 schema | ✅ | `buildJsonContract()` produces `PlanExecutionContract` with version `2.5.1`; test validates contract fields |
| 3 | Workstreams generated based on proposal scope | ✅ | `generateWorkstreams()` estimates count from description length + evidence count; tests verify count bounds |
| 4 | Dependencies correctly computed (no cycles) | ✅ | `generateDependencies()` creates sequential blocking deps; tests confirm acyclicity via DFS cycle detection |
| 5 | Batches layout non-overlapping workstreams | ✅ | `generateBatches()` uses Kahn's algorithm for topological sort; tests confirm no overlaps and correct ordering |
| 6 | Validates output before returning | ✅ | `validatePlan()` checks contract fields, dependency consistency; tests confirm errors detected |
| 7 | Test: proposal → plan → validate → output | ✅ | Full pipeline integration test (`engine.test.ts` "should complete full pipeline") passes |

## Deliverables

### Source Files

- `packages/coding-agent/src/brain/plan-factory/types.ts` — Core types: `PlanFactoryConfig`, `PlanFactoryInput`, `PlanFactoryOutput`, `PlanExecutionContract`, `WorkstreamDef`, `ValidationResult`, `ProposalAnalysis`
- `packages/coding-agent/src/brain/plan-factory/engine.ts` — `PlanFactory` class with: proposal analysis, workstream generation, dependency computation (topological sort), batch layout (Kahn's algorithm), template population, I/O, validation
- `packages/coding-agent/src/brain/plan-factory/template.ts` — `MasterTemplateIntegration` with: template loading/parsing, segment population, contract generation, validation
- `packages/coding-agent/src/brain/plan-factory/index.ts` — Public API exports

### Tests

- `packages/coding-agent/test/brain/plan-factory/engine.test.ts` — 32 tests: construction, `createPlan`, phase ID computation, workstream generation, dependency acyclicity, batch non-overlap, validation, JSON contract, markdown output, risk analysis, config, edge cases, full pipeline integration

### Test Fixtures

- `packages/coding-agent/test/fixtures/plan-factory/valid-proposal.json` — Reference proposal fixture for integration testing

## VERDICT: COMPLETE

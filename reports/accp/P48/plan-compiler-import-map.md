# P48 Plan Compiler Import Map

## Summary

Audit of all parser/runtime imports in the pi repository. Identifies every import site
for the legacy parsing functions that must be replaced with `compilePlanSpecAlpha2()`.

## Parser Functions Requiring Migration

| Function | File | Status |
|---|---|---|
| `parsePlan()` | `packages/coding-agent/src/core/plan-parser.ts` | Must be removed from runtime path |
| `loadPlan()` | `packages/coding-agent/src/core/plan-parser.ts` | Must be removed from runtime path |
| `formatParseResult()` | `packages/coding-agent/src/core/plan-parser.ts` | Must be removed from runtime path |
| `parsePlanSpecJsonOnly()` | `packages/coding-agent/src/core/planspec-v5-parser.ts` | Must be removed from runtime path |
| `parsePlanSpecCombined()` | `packages/coding-agent/src/core/planspec-v5-parser.ts` | Must be removed from runtime path |
| `parsePlanSpecV5()` | `packages/coding-agent/src/core/planspec-v5-schema.ts` | Must be removed from runtime path |
| `validatePlanSpecSemantics()` | `packages/coding-agent/src/core/planspec-v5-semantic-validator.ts` | Must be removed from runtime path |
| `parsePlanSpecV5Alpha2()` | `packages/coding-agent/src/core/planspec-v5-alpha2-parser.ts` | Must be removed from runtime path |

## Import Sites

### 1. `packages/coding-agent/src/index.ts` (public exports)

```ts
// Line 181
export { formatParseResult, loadPlan, type ParseOptions, type ParseResult, parsePlan } from "./core/plan-parser.js";
// Lines 194-197
export { parsePlanSpecCombined, parsePlanSpecJsonOnly } from "./core/planspec-v5-parser.js";
export { type PlanSpecV5ParseResult, parsePlanSpecV5 } from "./core/planspec-v5-schema.js";
export { validatePlanSpecSemantics } from "./core/planspec-v5-semantic-validator.js";
```

### 2. `packages/coding-agent/src/core/index.ts`

```ts
// Line 310: exports findMissingWorkspaceLabels, scanMarkdownWorkstreamHeadings, ParsedSource
} from "./plan-parser.js";
```

### 3. `packages/web-server/src/index.ts` (web routes)

```ts
// Line 62-63
import { parsePlan, parsePlanSpecJsonOnly } from "@earendil-works/pi-coding-agent";

// Line 1859: POST /api/projects/:projectId/plans/validate
const v5ParseResult = parsePlanSpecJsonOnly(planContent);

// Line 1881: fallback in validate route
const parseResult = parsePlan(planContent);

// Line 2128: plan run route
const parseResult = parsePlan(planContent);

// Line 2209: plan run route v5 attempt
const v5Result = parsePlanSpecJsonOnly(planContent);

// Line 3059: plan bulk upload
const parseResult = parsePlan(plan.planContent);
```

### 4. `packages/web-server/src/plan-runner.ts` (plan runner)

```ts
// Lines 20-22
import {
  parsePlan,
  parsePlanSpecJsonOnly,
  parsePlanSpecV5,
} from "@earendil-works/pi-coding-agent";

// Line 516: runPlan() — v5 JSON parse
const v5Parse = parsePlanSpecJsonOnly(planContent);

// Line 518: runPlan() — v5 schema validation
const v5Schema = parsePlanSpecV5(planContent);

// Line 595: runPlan() — fallback after failed v5
parseResult = parsePlan(planContent);

// Line 601: runPlan() — non-JSON input
parseResult = parsePlan(planContent);

// Line 2362: resumePlan()
const parseResult = parsePlan(planContent);
```

### 5. `packages/coding-agent/src/core/autonomous-executor.ts`

```ts
// Line 636: dynamic import for planspec_locked mode
const { parsePlanSpecJsonOnly } = await import("./planspec-v5-parser.js");
// Line 639
const parseResult = parsePlanSpecJsonOnly(planSpecJson as string);
```

### 6. `packages/coding-agent/src/cli/plan-commands.ts` (CLI)

```ts
// Line 46
import { formatParseResult, loadPlan } from "../core/plan-parser.js";
// Multiple usages throughout for plan doctor, plan dry-run, plan run
```

### 7. `packages/coding-agent/src/core/planspec-v5-parser.ts`

```ts
// Line 13: imports from plan-parser
import { type ParseOptions, type ParseResult, parsePlan } from "./plan-parser.js";
// Line 14: imports from planspec-v5-schema
import { PlanSpecV5Schema } from "./planspec-v5-schema.js";
// Line 15: imports from planspec-v5-semantic-validator
import { validatePlanSpecSemantics } from "./planspec-v5-semantic-validator.js";
// Line 16: imports from planspec-v5-types
import type { PlanSpecV5 } from "./planspec-v5-types.js";
```

### 8. `packages/coding-agent/src/core/planlock-admission.ts`

```ts
// Line 18
import type { PlanSpecV5 } from "./planspec-v5-types.js";
```

### 9. `packages/coding-agent/src/core/workspace-schema.ts`

```ts
// Line 430: comment reference to plan-parser.ts
```

## Frontend

### 10. `packages/web-ui/dashboard/src/utils/planParser.ts`

Frontend local Markdown/JSON plan parser. Used by dashboard for client-side parsing.

### 11. `packages/web-ui/dashboard/src/utils/planValidator.ts`

Frontend local plan validator. Used by dashboard for client-side validation.

## Runtime Entrypoints

| Entrypoint | Current Parser | Target |
|---|---|---|
| `POST /api/projects/:projectId/plans/validate` | `parsePlanSpecJsonOnly()` then `parsePlan()` | `compilePlanSpecAlpha2()` |
| `POST /api/projects/:projectId/plans/run` | `parsePlanSpecJsonOnly()` then `parsePlan()` | `compilePlanSpecAlpha2()` |
| `plan-runner.ts runPlan()` | `parsePlanSpecJsonOnly()`, `parsePlanSpecV5()`, `parsePlan()` chain | `compilePlanSpecAlpha2()` |
| `plan-runner.ts resumePlan()` | `parsePlan()` | `compilePlanSpecAlpha2()` |
| `autonomous-executor.ts` planspec_locked mode | `parsePlanSpecJsonOnly()` | `compilePlanSpecAlpha2()` |
| CLI plan commands | `loadPlan()`, `formatParseResult()` | `compilePlanSpecAlpha2()` |
| `plan-parser.ts findMissingWorkspaceLabels()` | Internal | Remove or migrate |
| `plan-parser.ts scanMarkdownWorkstreamHeadings()` | Internal | Remove or migrate |

## Existing Test Files to Update/Remove

- `packages/coding-agent/test/plan-parser.test.ts` — legacy Markdown parsing tests
- `packages/coding-agent/test/planspec-v5-rc1.test.ts` — RC1 tests
- `packages/coding-agent/test/planspec-v5-final-gauntlet.test.ts` — RC1 gauntlet
- `packages/coding-agent/test/v5-e2e-integration.test.ts` — v5 integration tests
- `packages/coding-agent/test/v5-real-smoke-gauntlet.test.ts` — v5 smoke tests
- `packages/coding-agent/test/p31-plan-parser-v4.test.ts` — v4 parser tests
- `packages/coding-agent/test/plan-commands.test.ts` — CLI tests using loadPlan/formatParseResult

## Existing Files to Delete (after migration)

1. `packages/coding-agent/src/core/plan-parser.ts`
2. `packages/coding-agent/src/core/planspec-v5-parser.ts`
3. `packages/coding-agent/src/core/planspec-v5-schema.ts`
4. `packages/coding-agent/src/core/planspec-v5-types.ts`
5. `packages/coding-agent/src/core/planspec-v5-semantic-validator.ts`
6. `packages/coding-agent/src/core/planspec-v5-alpha2-parser.ts`
7. `packages/coding-agent/src/core/planspec-v5-alpha2-types.ts`
8. `packages/web-ui/dashboard/src/utils/planParser.ts`
9. `packages/web-ui/dashboard/src/utils/planValidator.ts`

## Validation

- Typecheck: `npm run check`

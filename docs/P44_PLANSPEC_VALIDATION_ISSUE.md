# P44_PlanSpec_v5_single_file_final.json - Validation Issue Analysis

## Problem

The file `/Users/hootie/src/pi/docs/P44_PlanSpec_v5_single_file_final.json` fails validation with error:
```
Could not find workstreams section
Parse: failed to parse plan
```

## Root Cause

**The file uses P44 schema structure, but the server's legacy parser expects Markdown format.**

### Current File Structure (P44-style)
- Uses fields like: `kind`, `metadata`, `compatibility`, `intent`, `enforcementRegistry`, `security`, `commands`, `locking`, `brief`, `validation`, `evidence`, `reports`, `p45Bridge`, `renderHints`, `migration`, `workstreams`, `normalPlanCompatibility`
- Has 18 workspaces with P44-style acceptance criteria
- Missing ALL PlanSpec v5 required fields

### What PlanSpec v5 Requires
- `accpVersion`: "1.2"
- `planspecVersion`: "5.0.0"
- `taskId`: string
- `taskName`: string
- `executionClass`: string
- `workspaceGroup`: string
- `allowProductionCodeChanges`: boolean
- `allowTestCodeChanges`: boolean
- `allowReportFiles`: boolean
- `requireRepoInspectionFirst`: boolean
- `requireValidationEvidence`: boolean
- `requireRollbackPlan`: boolean
- `requireFinalAccpReport`: boolean
- `authority`: object with specification, executionState, completion
- `waves`: array
- `workspaces`: array with PlanSpec v5 structure
- `templates`: array
- `validationCases`: array

### Server Parser Issue

The server's `/api/projects/:projectId/plans/validate` endpoint uses `parsePlan()` which is the **legacy Markdown parser**, not the PlanSpec v5 JSON parser.

The legacy parser:
1. Expects Markdown format with `## Workstreams` section
2. Does NOT support PlanSpec v5 JSON format
3. Looks for patterns like `### 7.A -- Title` or `## P42.00 -- Title`

## Solution Options

### Option 1: Convert File to PlanSpec v5 Format (Recommended Long-term)

Restructure the entire file to match PlanSpec v5 schema:
- Add all required top-level fields
- Convert workspaces to PlanSpec v5 format
- Convert acceptance criteria to simple `{id, description}` format
- Add waves array
- Add templates and validationCases arrays

This is a major restructuring task.

### Option 2: Wait for Server Support (Recommended Short-term)

The server needs to be updated to:
1. Detect JSON vs Markdown input
2. Use PlanSpec v5 parser for JSON files
3. Provide proper validation errors for schema mismatches

### Option 3: Create Minimal PlanSpec v5 Test File

Create a simple PlanSpec v5 file that validates correctly, then gradually add P44 content.

## Immediate Next Steps

1. **Clarify Intent**: Is this file supposed to be:
   - A P44 document (uses P44 schema)?
   - A PlanSpec v5 document (needs conversion)?
   - A hybrid document (needs new schema)?

2. **Server Update**: The server needs PlanSpec v5 JSON support before this file can be validated.

3. **File Conversion**: If this should be PlanSpec v5, it needs complete restructuring.

## Validation Results

```
✓ JSON syntax is valid
✓ Has 'workspaces' array (18 items)
✓ Has 'workstreams' array
✗ Schema validation: E_SCHEMA_INVALID (99+ errors)
✗ Missing all PlanSpec v5 required fields
✗ Server parser expects Markdown, not JSON
```

## Recommendation

**Do NOT attempt to validate this file until:**
1. The server supports PlanSpec v5 JSON parsing, AND
2. The file is converted to proper PlanSpec v5 format

The current file is a P44 document that cannot be parsed by either the legacy Markdown parser OR the PlanSpec v5 JSON parser without significant changes.

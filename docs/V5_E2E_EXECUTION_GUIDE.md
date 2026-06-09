# V5 End-to-End Execution Guide

## Overview

This guide explains how to execute a real V5 PlanSpec end-to-end, from validation through actual workspace execution.

## Test Plan: Python Blog App

We've created a realistic V5 PlanSpec for a Python Flask blog application with:
- **Backend Workspace** (WS-BACKEND): Flask REST API with CRUD operations
- **Frontend Workspace** (WS-FRONTEND): Jinja2 templates for displaying posts

The plan demonstrates:
- Multi-workspace execution with dependencies
- Wave-based orchestration
- Acceptance criteria tracking
- Validation evidence requirements
- P45 boundary enforcement
- Worker report echo extraction
- CompletionGate V2 evaluation

## Files Created

### 1. PlanSpec Fixture
**Location**: `/Users/hootie/src/pi/test-fixtures/v5-e2e-python-blog-planspec.json`

A complete, schema-valid PlanSpec v5.0.0 file that can be executed against the pi server.

### 2. Integration Tests
**Location**: `/Users/hootie/src/pi/packages/coding-agent/test/v5-e2e-integration.test.ts`

12 comprehensive tests covering:
- PlanSpec parsing and validation
- Lock hash computation
- WorkerPacketV5 derivation
- Command policy enforcement
- P45 boundary checks
- Worker echo extraction
- Completion gate evaluation
- Wave dependency verification

### 3. Execution Script
**Location**: `/Users/hootie/src/pi/scripts/v5-e2e-execution-test.sh`

A bash script that:
- Validates the PlanSpec JSON
- Creates a temporary workspace
- Runs schema and semantic validation
- Checks if the pi server is running
- Provides execution instructions

## Running the Tests

### Unit/Integration Tests

```bash
cd /Users/hootie/src/pi/packages/coding-agent
npx vitest --run test/v5-e2e-integration.test.ts
```

Expected output: `PASS (12) FAIL (0)`

### Execution Script

```bash
cd /Users/hootie/src/pi
./scripts/v5-e2e-execution-test.sh
```

This will:
1. Validate the PlanSpec JSON structure
2. Create a temporary workspace in `/tmp/v5-e2e-test-$$`
3. Run PlanSpec schema validation
4. Run PlanSpec semantic validation
5. Check if the pi server is running
6. Display execution instructions

## Executing Against the Server

### Option 1: Via CLI (Recommended)

```bash
# Create a workspace directory
mkdir -p /tmp/v5-blog-test
cd /tmp/v5-blog-test

# Copy the PlanSpec
cp /Users/hootie/src/pi/test-fixtures/v5-e2e-python-blog-planspec.json ./planspec.json

# Execute via pi CLI
pi execute --plan planspec.json
```

### Option 2: Via HTTP API

If the pi server is running on port 3000:

```bash
curl -X POST http://localhost:3000/api/plans/execute \
  -H 'Content-Type: application/json' \
  -d @/Users/hootie/src/pi/test-fixtures/v5-e2e-python-blog-planspec.json
```

### Option 3: Via Dashboard

1. Start the pi server: `npm run dev`
2. Open the dashboard in your browser
3. Upload the PlanSpec JSON file
4. Click "Execute"

## Expected Execution Flow

When the plan executes, here's what happens:

### Phase 1: PlanSpec Validation
1. ✅ JSON-only parse
2. ✅ Schema validation (v5.0.0)
3. ✅ Semantic validation (workspace refs, command refs, etc.)

### Phase 2: PlanLock Admission
4. ✅ Compute canonical JSON hash
5. ✅ Compute workspace lock hashes
6. ✅ Admit PlanSpec with lock binding

### Phase 3: WorkerPacket Derivation
7. ✅ Derive WorkerPacketV5 for WS-BACKEND
   - Includes planLockHash
   - Includes workspaceLockHash
   - Includes allowed files: `backend/**`
   - Includes forbidden files: `packages/coding-agent/src/p45/**`
   - Includes 5 acceptance criteria
   - Sets `completionEchoRequired: true`

8. ✅ Derive WorkerPacketV5 for WS-FRONTEND
   - Depends on WS-BACKEND
   - Includes allowed files: `backend/templates/**`, `backend/static/**`
   - Includes 5 acceptance criteria

### Phase 4: Backend Execution (Wave 1)
9. ✅ Execute WS-BACKEND
   - Create Flask project structure
   - Install dependencies (pip install flask flask-sqlalchemy)
   - Create models, routes, tests
   - Run validation command: `cd backend && python -m pytest test_backend.py -v`

10. ✅ Extract worker report echo
    - Parse structured JSON from worker output
    - Verify planLockHash matches
    - Verify workspaceLockHash matches
    - Verify workspaceId matches

11. ✅ Populate EvidenceLedger
    - Record command execution evidence
    - Record test results
    - Link evidence to acceptance criteria

12. ✅ Evaluate CompletionGate V2
    - Check lock hashes match
    - Check worker echo is present and valid
    - Check AC evidence satisfaction (5/5)
    - Check validation command passed
    - Allow completion if all checks pass

### Phase 5: Frontend Execution (Wave 2)
13. ✅ Execute WS-FRONTEND (after WS-BACKEND completes)
    - Create templates directory structure
    - Create base template, post list, single post, create post form
    - Integrate with Flask backend routes
    - Run validation command: `ls -la backend/templates/`

14. ✅ Extract worker report echo
15. ✅ Populate EvidenceLedger
16. ✅ Evaluate CompletionGate V2

### Phase 6: Final Verdict
17. ✅ Generate final ACCP report
18. ✅ Summarize evidence coverage
19. ✅ Report completion status

## Verification Checklist

After execution, verify:

- [ ] PlanSpec was parsed without errors
- [ ] Schema validation passed
- [ ] Semantic validation passed
- [ ] PlanLock was admitted with correct hashes
- [ ] WorkerPacketV5 was derived for both workspaces
- [ ] Backend workspace executed successfully
- [ ] Frontend workspace executed successfully (after backend)
- [ ] Worker report echo was extracted and verified
- [ ] EvidenceLedger was populated with command/test evidence
- [ ] CompletionGate V2 evaluated both workspaces
- [ ] All acceptance criteria were satisfied
- [ ] Final verdict was generated
- [ ] P45 boundary was enforced (no writes to forbidden paths)
- [ ] Reports were generated in `reports/` directory

## Troubleshooting

### PlanSpec Validation Fails

Check the error message from the schema validator. Common issues:
- Wrong `accpVersion` (must be "1.2")
- Wrong `planspecVersion` (must be "5.0.0")
- Missing required fields
- Invalid wave/workspace references

### Execution Hangs

Check:
- Is the pi server running?
- Are there any permission issues in the workspace directory?
- Are dependencies installing correctly?

### Completion Gate Blocks

Check:
- Did the worker report include lock hashes?
- Did all acceptance criteria have evidence?
- Did validation commands pass?
- Were there any P45 boundary violations?

## Next Steps

After successful execution:

1. **Review the generated reports** in the `reports/` directory
2. **Examine the EvidenceLedger** to see what evidence was collected
3. **Check the completion gate decisions** to understand why workspaces completed or failed
4. **Use this as a template** for creating your own V5 plans

## Reusability

This test plan is designed to be:
- **Re-testable**: Can be executed multiple times
- **Modifiable**: Easy to adapt for different projects
- **Educational**: Demonstrates all V5 features
- **Realistic**: Uses actual technologies (Flask, Jinja2, SQLite)

You can copy and modify this PlanSpec for your own projects by:
1. Changing the task ID and name
2. Updating workspace descriptions and acceptance criteria
3. Modifying commands for your tech stack
4. Adjusting validation cases for your needs

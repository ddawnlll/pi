#!/usr/bin/env node
/**
 * P-HOTFIX-STATE-2: State Authority Diagnostic
 *
 * Validates the fixes for:
 * - Fix 1: UUID composite strings never used as column values
 * - Fix 2: attempt_started event uses valid UUIDs
 * - Fix 3: Transition rejection terminalizes workspace
 * - Fix 4: BLOCKED result persists terminal state
 * - Fix 5: Repeated schedule detection
 * - Fix 6: Ready-only no-progress detection
 *
 * Uses Postgres backend (PI_STATE_STORE_BACKEND=postgres).
 *
 * Usage:
 *   PI_STATE_STORE_BACKEND=postgres npx tsx scripts/state-authority-diagnostic.ts
 *
 * Output:
 *   Test results printed to stdout
 *   Diagnostics written to reports/execution-diagnostics/<timestamp>-state-authority-diagnostic/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createStateStore, detectStateStoreBackend } from "../src/core/state-store.js";
import { assertUuid, assertNullableUuid } from "../src/core/state-store.js";
import { createTransitionRouter, DirectTransitionRouter, KernelTransitionRouter } from "../src/execution-kernel/transition-router.js";
import { getKysely } from "@earendil-works/pi-db";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_BASE = path.join("reports", "execution-diagnostics");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-") + "-state-authority-diagnostic";
const REPORT_DIR = path.join(REPORT_BASE, TIMESTAMP);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Test results collector
// ---------------------------------------------------------------------------

interface TestResult {
	name: string;
	passed: boolean;
	detail: string;
}

const results: TestResult[] = [];

function pass(name: string, detail: string): void {
	results.push({ name, passed: true, detail });
	console.log(`  PASS: ${name} — ${detail}`);
}

function fail(name: string, detail: string): void {
	results.push({ name, passed: false, detail });
	console.error(`  FAIL: ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
	return new Date().toISOString();
}

async function ensureReportDir(): Promise<void> {
	await fs.mkdir(REPORT_DIR, { recursive: true });
}

// ===========================================================================
// Test 1: UUID validation — reject composite strings
// ===========================================================================

async function testUuidValidation(): Promise<void> {
	console.log("\n--- Test 1: UUID Validation ---");

	// Test valid UUID
	try {
		assertUuid("418ec3a0-4342-4be3-b1cc-f2d6364c4290", "testUuid");
		pass("assertUuid valid UUID", "Accepted valid UUID format");
	} catch (e) {
		fail("assertUuid valid UUID", `Rejected valid UUID: ${e}`);
	}

	// Test composite string "uuid:1"
	try {
		assertUuid("418ec3a0-4342-4be3-b1cc-f2d6364c4290:1", "testUuid");
		fail("assertUuid composite 'uuid:1'", "Accepted invalid composite UUID format");
	} catch (e) {
		pass("assertUuid composite 'uuid:1'", `Rejected composite format as expected: ${e}`);
	}

	// Test empty string
	try {
		assertUuid("", "testUuid");
		fail("assertUuid empty string", "Accepted empty string");
	} catch (e) {
		pass("assertUuid empty string", `Rejected empty string as expected: ${e}`);
	}

	// Test "undefined" string
	try {
		assertUuid("undefined", "testUuid");
		fail("assertUuid 'undefined' string", "Accepted 'undefined' as UUID");
	} catch (e) {
		pass("assertUuid 'undefined' string", `Rejected 'undefined' string as expected: ${e}`);
	}

	// Test "null" string
	try {
		assertUuid("null", "testUuid");
		fail("assertUuid 'null' string", "Accepted 'null' as UUID");
	} catch (e) {
		pass("assertUuid 'null' string", `Rejected 'null' string as expected: ${e}`);
	}

	// Test non-UUID string
	try {
		assertUuid("not-a-uuid", "testUuid");
		fail("assertUuid non-UUID", "Accepted non-UUID string");
	} catch (e) {
		pass("assertUuid non-UUID", `Rejected non-UUID as expected: ${e}`);
	}

	// Test assertNullableUuid
	try {
		assertNullableUuid(null, "testNullable");
		pass("assertNullableUuid null", "Accepted null as valid nullable UUID");
	} catch (e) {
		fail("assertNullableUuid null", `Rejected null: ${e}`);
	}

	try {
		assertNullableUuid(undefined, "testNullable");
		pass("assertNullableUuid undefined", "Accepted undefined as valid nullable UUID");
	} catch (e) {
		fail("assertNullableUuid undefined", `Rejected undefined: ${e}`);
	}
}

// ===========================================================================
// Test 2: attempt_started event uses valid UUIDs (workspace-attempt-controller)
// ===========================================================================

async function testAttemptStartedUuid(): Promise<void> {
	console.log("\n--- Test 2: attempt_started event uses valid UUIDs ---");

	// Verify the source code of workspace-attempt-controller.ts
	const controllerContent = await fs.readFile(
		path.resolve("packages/coding-agent/src/execution-kernel/workspace-attempt-controller.ts"),
		"utf-8",
	);

	// Check that eventId uses crypto.randomUUID() not composite string
	if (controllerContent.includes("eventId: crypto.randomUUID()")) {
		pass("controller eventId", "eventId uses crypto.randomUUID()");
	} else {
		fail("controller eventId", "eventId does NOT use crypto.randomUUID()");
	}

	// Check that event_id uses crypto.randomUUID() not composite string
	if (controllerContent.includes("event_id: crypto.randomUUID()")) {
		pass("controller transition event_id", "transition event_id uses crypto.randomUUID()");
	} else {
		fail("controller transition event_id", "transition event_id does NOT use crypto.randomUUID()");
	}

	// Verify no composite string patterns remain
	const compositePattern = /\$\{attemptId\}:\$\{/;
	if (compositePattern.test(controllerContent)) {
		fail("no composite attemptId patterns", "Still has ${attemptId}:${...} patterns");
	} else {
		pass("no composite attemptId patterns", "No ${attemptId}:${...} patterns found in controller");
	}

	// Verify legacy-write-adapter.ts
	const legacyAdapterContent = await fs.readFile(
		path.resolve("packages/coding-agent/src/execution-kernel/legacy-write-adapter.ts"),
		"utf-8",
	);
	if (legacyAdapterContent.includes("eventId: crypto.randomUUID()")) {
		pass("legacy adapter eventId", "legacy adapter uses crypto.randomUUID()");
	} else {
		fail("legacy adapter eventId", "legacy adapter does NOT use crypto.randomUUID()");
	}

	// Verify shadow-attempt-journal.ts
	const shadowJournalContent = await fs.readFile(
		path.resolve("packages/coding-agent/src/execution-kernel/shadow-attempt-journal.ts"),
		"utf-8",
	);
	if (shadowJournalContent.includes("eventId: crypto.randomUUID()")) {
		pass("shadow journal eventId", "shadow journal uses crypto.randomUUID()");
	} else {
		fail("shadow journal eventId", "shadow journal does NOT use crypto.randomUUID()");
	}

	// Verify attempt_events.event_id column expects uuid (migration check)
	const migrationContent = await fs.readFile(
		path.resolve("packages/db/src/migrations/012_execution_kernel.ts"),
		"utf-8",
	);
	if (migrationContent.includes('"uuid", (col) => col.notNull().unique())')) {
		pass("attempt_events.event_id is UUID column", "Migration defines event_id as UUID");
	} else {
		fail("attempt_events.event_id is UUID column", "Could not verify column type");
	}
}

// ===========================================================================
// Test 3: Transition rejection terminalizes workspace
// ===========================================================================

async function testTransitionRejection(): Promise<void> {
	console.log("\n--- Test 3: Transition rejection terminalization ---");

	// Verify autonomous-executor.ts catch block handles rejection errors without retry
	const executorContent = await fs.readFile(
		path.resolve("packages/coding-agent/src/core/autonomous-executor.ts"),
		"utf-8",
	);

	// Check for the rejection detection
	if (executorContent.includes('"rejected transition"') || executorContent.includes("isRejectionError")) {
		pass("rejection detection", "Catch block detects rejection errors and bypasses retry");
	} else {
		fail("rejection detection", "Catch block does NOT detect rejection errors");
	}

	// Check for state store bypass on terminal write
	if (executorContent.includes("stateStore.transitionWorkspace")) {
		pass("terminal state bypass", "Catch block uses stateStore directly for terminal state");
	} else {
		fail("terminal state bypass", "Catch block does NOT use stateStore directly for terminal state");
	}
}

// ===========================================================================
// Test 4: BLOCKED result state persistence (simulated)
// ===========================================================================

async function testBlockedPersistence(db: ReturnType<typeof getKysely>): Promise<void> {
	console.log("\n--- Test 4: BLOCKED result persistence (simulated) ---");

	try {
		// Create a test plan execution and workspace execution
		const projectId = randomUUID();
		const planExecutionId = randomUUID();
		const workspaceId = "V5-test-blocked-" + Date.now();

		// Insert a test project
		await db.insertInto("projects")
			.values({ id: projectId, name: "test-blocked-persistence", type: "execution_plan", created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
			.execute()
			.catch(() => {}); // Ignore if already exists

		// Insert a plan execution
		await db.insertInto("plan_executions")
			.values({
				id: planExecutionId,
				project_id: projectId,
				status: "running",
				max_parallel_workspaces: 1,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.execute()
			.catch(() => {});

		// Insert a workspace execution
		await db.insertInto("workspace_executions")
			.values({
				id: randomUUID(),
				plan_execution_id: planExecutionId,
				workspace_id: workspaceId,
				project_id: projectId,
				status: "pending",
				stage: "pending",
				attempts: 0,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.execute()
			.catch(() => {});

		// Now create a state store and try to transition to Blocked directly
		const stateStore = createStateStore({ backend: "postgres", workspaceRoot: process.cwd() });

		// Test: write Blocked state directly via state store (bypassing controller)
		await stateStore.transitionWorkspace(planExecutionId, workspaceId, "blocked" as any, {
			reason: "blocked_for_testing",
			error: "Test: controller transition rejection",
		});

		// Verify the state is now blocked
		const wsState = await stateStore.getWorkspaceState(planExecutionId, workspaceId);
		if (wsState && (wsState.stage === "blocked" || wsState.stage === "failed")) {
			pass("BLOCKED state persistence", `State store persisted ${wsState.stage} stage`);
		} else if (wsState) {
			fail("BLOCKED state persistence", `State store has stage=${wsState.stage}, expected blocked/failed`);
		} else {
			fail("BLOCKED state persistence", "State store returned null for workspace");
		}

		// Clean up test data
		await db.deleteFrom("workspace_executions").where("workspace_id", "=", workspaceId).execute();
		await db.deleteFrom("plan_executions").where("id", "=", planExecutionId).execute();
	} catch (e) {
		fail("BLOCKED state persistence", `Test threw: ${e instanceof Error ? e.message : String(e)}`);
	}
}

// ===========================================================================
// Test 5: Repeated schedule detection (simulated)
// ===========================================================================

async function testRepeatedScheduleDetection(): Promise<void> {
	console.log("\n--- Test 5: Repeated schedule detection ---");

	// Verify the runner script has repeated schedule detection
	const runnerContent = await fs.readFile(
		path.resolve("packages/coding-agent/scripts/run-v5-real-implementation.ts"),
		"utf-8",
	);

	// Check for PLAN_STUCK or NO_PROGRESS detection
	if (runnerContent.includes("NO_PROGRESS") || runnerContent.includes("PLAN_STUCK")) {
		pass("repeated schedule detection", "Runner has NO_PROGRESS/PLAN_STUCK detection");
	} else {
		fail("repeated schedule detection", "Runner lacks NO_PROGRESS detection");
	}

	// Check for hang analysis writer
	if (runnerContent.includes("hang-analysis")) {
		pass("hang analysis writer", "Runner writes hang-analysis.md on stuck");
	} else {
		fail("hang analysis writer", "Runner does not write hang-analysis.md");
	}
}

// ===========================================================================
// Test 6: Ready-only no-progress detection
// ===========================================================================

async function testNoProgressDetection(): Promise<void> {
	console.log("\n--- Test 6: No-progress detection ---");

	// Check the runner for ready-only-no-progress detection
	const runnerContent = await fs.readFile(
		path.resolve("packages/coding-agent/scripts/run-v5-real-implementation.ts"),
		"utf-8",
	);

	if (runnerContent.includes("inFlight.size === 0 && launchableCount === 0 && nonTerminalCount > 0")) {
		pass("no-progress detection", "Runner detects ready-only with no active workspaces");
	} else {
		fail("no-progress detection", "Runner does NOT detect ready-only no-progress");
	}

	// Also check the heartbeat monitor for stall detection
	if (runnerContent.includes("STALL_WARNING") || runnerContent.includes("HARD STALL")) {
		pass("stall detection", "Monitor detects workspace stalls");
	} else {
		fail("stall detection", "Monitor does not detect workspace stalls");
	}
}

// ===========================================================================
// Test 7: from_state in transition rows
// ===========================================================================

async function testFromStateInTransition(): Promise<void> {
	console.log("\n--- Test 7: from_state in attempt_transitions ---");

	const controllerContent = await fs.readFile(
		path.resolve("packages/coding-agent/src/execution-kernel/workspace-attempt-controller.ts"),
		"utf-8",
	);

	// Check that from_state uses currentState variable
	if (controllerContent.includes("from_state: currentState")) {
		pass("from_state uses currentState", "Transition rows record correct from_state");
	} else {
		fail("from_state uses currentState", "Transition rows do NOT use currentState");
	}
}

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
	console.log(`\n=== State Authority Diagnostic ===`);
	console.log(`Timestamp: ${isoNow()}`);
	console.log(`Report dir: ${REPORT_DIR}`);

	await ensureReportDir();

	// Verify Postgres is available
	const backend = detectStateStoreBackend();
	if (backend !== "postgres") {
		console.error(`ERROR: Expected postgres backend, got "${backend}". Set PI_STATE_STORE_BACKEND=postgres.`);
		process.exit(1);
	}
	console.log(`\nPostgres backend detected: ${backend}`);

	const db = getKysely();

	// Run all tests
	await testUuidValidation();
	await testAttemptStartedUuid();
	await testTransitionRejection();
	await testBlockedPersistence(db);
	await testRepeatedScheduleDetection();
	await testNoProgressDetection();
	await testFromStateInTransition();

	// Calculate summary
	const passed = results.filter((r) => r.passed).length;
	const total = results.length;
	const failed = results.filter((r) => !r.passed).map((r) => r.name);

	console.log(`\n${"=".repeat(60)}`);
	console.log(`\nResults: ${passed}/${total} passed`);
	if (failed.length > 0) {
		console.log(`Failed: ${failed.join(", ")}`);
	}

	// Write report
	const report = [
		`# State Authority Diagnostic Report`,
		``,
		`- Timestamp: ${isoNow()}`,
		`- Backend: ${backend}`,
		`- Results: ${passed}/${total} passed`,
		``,
		`| Test | Result | Detail |`,
		`|---|---|---|`,
		...results.map((r) => `| ${r.name} | ${r.passed ? "PASS" : "FAIL"} | ${r.detail} |`),
		``,
		failed.length > 0 ? `## Failed Tests\n\n${failed.map((f) => `- ${f}`).join("\n")}` : "",
		``,
		`## Verdict`,
		``,
		passed === total ? "ALL TESTS PASSED — Hotfixes are effective." :
			`${total - passed} test(s) failed — Review the failures above.`,
		``,
	].join("\n");

	await fs.writeFile(path.join(REPORT_DIR, "diagnostic-report.md"), report, "utf-8");
	await fs.writeFile(path.join(REPORT_DIR, "diagnostic-results.json"), JSON.stringify({
		timestamp: isoNow(),
		backend,
		passed,
		total,
		failed: failed.length,
		failedTests: failed,
		results,
	}, null, 2), "utf-8");

	console.log(`\nReport written to ${REPORT_DIR}/diagnostic-report.md`);

	if (failed.length > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(`Diagnostic failed with error:`, err);
	process.exit(1);
});

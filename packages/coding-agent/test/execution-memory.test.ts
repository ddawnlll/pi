/**
 * Execution Memory Tests - P5.5.E
 *
 * Tests for workspace execution memory functionality:
 * 1. Successful workspace creates memory entry
 * 2. Failed workspace creates failure memory entry
 * 3. New workspace retrieves relevant prior memory
 * 4. Memory excludes raw hidden reasoning
 * 5. Memory can be disabled
 */

import { describe, expect, it } from "vitest";
import { createExecutionMemory, ExecutionMemory, type ExecutionMemoryEntry } from "../src/memory/execution-memory.js";
import { InMemoryExecutionMemoryStore } from "../src/memory/execution-memory-store.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create an ExecutionMemory with a fresh in-memory store for each test.
 */
function createTestMemory(
	overrides?: Partial<import("../src/memory/execution-memory.js").ExecutionMemoryConfig>,
): ExecutionMemory {
	const store = new InMemoryExecutionMemoryStore();
	return new ExecutionMemory({ enabled: true, ...overrides }, store);
}

// ============================================================================
// 1. Successful workspace creates memory entry
// ============================================================================

describe("successful workspace → memory entry", () => {
	it("records a completed workspace", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordSuccess(
			"5.5.E",
			"Implement execution memory system",
			["Successful workspace creates memory entry", "Failed workspace creates failure memory entry"],
			"Created ExecutionMemory class with recordSuccess and recordFailure methods. Added keyword-based relevance matching.",
			["src/memory/execution-memory.ts", "src/memory/execution-memory-store.ts"],
			["npm run typecheck", "npm test"],
		);

		expect(entry).not.toBeNull();
		expect(entry!.workspaceId).toBe("5.5.E");
		expect(entry!.goal).toBe("Implement execution memory system");
		expect(entry!.acceptanceCriteria).toEqual([
			"Successful workspace creates memory entry",
			"Failed workspace creates failure memory entry",
		]);
		expect(entry!.verdict).toBe("COMPLETE");
		expect(entry!.isFailure).toBe(false);
		expect(entry!.timestamp).toBeGreaterThan(0);
		expect(entry!.id).toBeTruthy();
		expect(entry!.filesModified).toEqual(["src/memory/execution-memory.ts", "src/memory/execution-memory-store.ts"]);
		expect(entry!.commandsRun).toEqual(["npm run typecheck", "npm test"]);
	});

	it("stores entry and makes it retrievable", async () => {
		const mem = createTestMemory();

		await mem.recordSuccess(
			"5.5.E",
			"Implement execution memory system",
			["Successful workspace creates memory entry"],
			"Created ExecutionMemory class.",
		);

		const all = await mem.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].workspaceId).toBe("5.5.E");
		expect(all[0].verdict).toBe("COMPLETE");
	});

	it("stores entries from multiple workspaces", async () => {
		const mem = createTestMemory();

		await mem.recordSuccess("1.A", "Setup project scaffolding", [], "Created project structure.");
		await mem.recordSuccess("2.B", "Implement core logic", [], "Implemented core module.");
		await mem.recordSuccess("3.C", "Write unit tests", [], "Added test coverage.");

		const all = await mem.getAll();
		expect(all).toHaveLength(3);

		const workspaceIds = all.map((e) => e.workspaceId);
		expect(workspaceIds).toContain("1.A");
		expect(workspaceIds).toContain("2.B");
		expect(workspaceIds).toContain("3.C");
	});
});

// ============================================================================
// 2. Failed workspace creates failure memory entry
// ============================================================================

describe("failed workspace → failure memory entry", () => {
	it("records a workspace that failed", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordFailure(
			"5.5.E",
			"Fix database migration",
			["Migration runs without errors"],
			"Migration failed due to foreign key constraint violation on table 'users'",
			"FAILED",
		);

		expect(entry).not.toBeNull();
		expect(entry!.workspaceId).toBe("5.5.E");
		expect(entry!.verdict).toBe("FAILED");
		expect(entry!.isFailure).toBe(true);
		expect(entry!.error).toBe("Migration failed due to foreign key constraint violation on table 'users'");
	});

	it("records a blocked workspace", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordFailure(
			"5.5.E",
			"Deploy to production",
			["Deployment pipeline passes"],
			"Deployment blocked: production approval pending",
			"BLOCKED",
		);

		expect(entry).not.toBeNull();
		expect(entry!.verdict).toBe("BLOCKED");
		expect(entry!.isFailure).toBe(true);
	});

	it("defaults verdict to FAILED when not specified", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordFailure("5.5.E", "Some task", [], "Something went wrong");

		expect(entry!.verdict).toBe("FAILED");
	});

	it("tracks files and commands even on failure", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordFailure(
			"5.5.E",
			"Refactor auth module",
			["Tests pass"],
			"Type error in auth.ts:52",
			"FAILED",
			"Attempted to refactor auth module but encountered type errors",
			["src/auth.ts"],
			["npm run typecheck"],
		);

		expect(entry!.filesModified).toEqual(["src/auth.ts"]);
		expect(entry!.commandsRun).toEqual(["npm run typecheck"]);
	});

	it("stores both success and failure entries together", async () => {
		const mem = createTestMemory();

		await mem.recordSuccess("1.A", "Setup project", [], "Project setup complete.");
		await mem.recordFailure("2.B", "Complex task", [], "Task failed.");

		const all = await mem.getAll();
		expect(all).toHaveLength(2);

		const failures = all.filter((e) => e.isFailure);
		const successes = all.filter((e) => !e.isFailure);

		expect(failures).toHaveLength(1);
		expect(failures[0].workspaceId).toBe("2.B");
		expect(successes).toHaveLength(1);
		expect(successes[0].workspaceId).toBe("1.A");
	});
});

// ============================================================================
// 3. New workspace retrieves relevant prior memory
// ============================================================================

describe("retrieve relevant prior memory", () => {
	it("finds related memory entries by goal similarity", async () => {
		const mem = createTestMemory();

		// Store some memory entries about different topics
		await mem.recordSuccess(
			"1.A",
			"Set up database schema for user accounts",
			["Tables created"],
			"Created users, roles, and permissions tables with proper indexes.",
			["db/schema.sql"],
		);
		await mem.recordSuccess(
			"2.B",
			"Implement REST API endpoints for user CRUD",
			["All endpoints return 200"],
			"Implemented GET/POST/PUT/DELETE for /api/users with validation.",
			["src/routes/users.ts"],
		);
		await mem.recordSuccess(
			"3.C",
			"Add CSS styling for landing page",
			["Page looks good on mobile"],
			"Added responsive CSS with flexbox layout, color scheme, and typography.",
			["src/styles/landing.css"],
		);

		// Now query with a database-related goal
		const results = await mem.getRelevantMemory("Refactor database queries for better performance", [
			"Queries run under 100ms",
		]);

		// Should find the database schema entry (and maybe the API one)
		expect(results.length).toBeGreaterThanOrEqual(1);

		const foundWsIds = results.map((e) => e.workspaceId);
		expect(foundWsIds).toContain("1.A");
	});

	it("returns multiple results sorted by relevance", async () => {
		const mem = createTestMemory();

		// Add entries with varied relevance to a query about "API testing"
		await mem.recordSuccess("1.A", "Write API tests for user endpoints", [], "Added test file for users API.");
		await mem.recordSuccess("2.B", "Set up CI/CD pipeline", [], "GitHub Actions workflow for build and test.");
		await mem.recordSuccess("3.C", "Write integration tests for database", [], "Added integration test suite.");

		// Query about API testing
		const results = await mem.getRelevantMemory("Add API test coverage for admin routes", [
			"All admin endpoints tested",
		]);

		expect(results.length).toBeGreaterThanOrEqual(1);

		// The most relevant should be #1 (API tests)
		expect(results[0].workspaceId).toBe("1.A");
	});

	it("returns empty array when no relevant memory exists", async () => {
		const mem = createTestMemory();

		await mem.recordSuccess("1.A", "Build UI components", [], "Created button and input components.");

		const results = await mem.getRelevantMemory("Train machine learning model", ["Model accuracy > 95%"]);

		expect(results).toHaveLength(0);
	});

	it("respects maxResults parameter", async () => {
		const mem = createTestMemory({ minRelevanceScore: 0 });

		for (let i = 1; i <= 10; i++) {
			await mem.recordSuccess(`ws-${i}`, "Write test for module", [], `Added tests for module ${i}.`);
		}

		const results = await mem.getRelevantMemory("Write tests for the system", ["All tests pass"], 3);

		expect(results.length).toBeLessThanOrEqual(3);
	});
});

// ============================================================================
// 4. Memory excludes raw hidden reasoning
// ============================================================================

describe("exclude raw hidden reasoning", () => {
	it("strips <thinking> blocks from summaries", async () => {
		const mem = createTestMemory();

		const summary =
			"<thinking>I need to check if the file exists first. Then I'll read the contents and parse them.</thinking>" +
			"Added file reading logic to the module.";

		const entry = await mem.recordSuccess("1.A", "Implement file reader", ["Reads files correctly"], summary, [
			"src/reader.ts",
		]);

		expect(entry!.summary).not.toContain("<thinking>");
		expect(entry!.summary).toContain("Added file reading logic to the module.");
	});

	it("strips <reasoning> blocks from summaries", async () => {
		const mem = createTestMemory();

		const summary =
			"<reasoning>The approach should handle edge cases for empty input.</reasoning>" +
			"Implemented input validation with edge case handling.";

		const entry = await mem.recordSuccess("1.A", "Implement input validation", ["Validates all inputs"], summary);

		expect(entry!.summary).not.toContain("<reasoning>");
		expect(entry!.summary).toContain("Implemented input validation with edge case handling.");
	});

	it("strips <think> blocks from summaries", async () => {
		const mem = createTestMemory();

		const summary =
			"<think>This might cause issues with large files.</think>" +
			"Added streaming file processing to handle large files.";

		const entry = await mem.recordSuccess(
			"1.A",
			"Implement streaming file processing",
			["Handles large files"],
			summary,
		);

		expect(entry!.summary).not.toContain("<think>");
		expect(entry!.summary).toContain("Added streaming file processing");
	});

	it("strips ```thinking code blocks from summaries", async () => {
		const mem = createTestMemory();

		const summary =
			"```thinking\nLet me trace through this algorithm:\n1. Parse input\n2. Process\n3. Output\n```\n" +
			"Implemented the parsing algorithm with step-by-step processing.";

		const entry = await mem.recordSuccess("1.A", "Implement parsing algorithm", ["Parses correctly"], summary);

		expect(entry!.summary).not.toContain("```thinking");
		expect(entry!.summary).toContain("Implemented the parsing algorithm");
	});

	it("strips multiple reasoning blocks", async () => {
		const mem = createTestMemory();

		const summary =
			"<thinking>First consideration.</thinking>Did step one. " +
			"<thinking>Second consideration.</thinking>Did step two.";

		const entry = await mem.recordSuccess("1.A", "Multi-step implementation", ["All steps done"], summary);

		expect(entry!.summary).not.toContain("<thinking>");
		expect(entry!.summary).toContain("Did step one.");
		expect(entry!.summary).toContain("Did step two.");
	});

	it("preserves non-reasoning content in summaries", async () => {
		const mem = createTestMemory();

		const summary =
			"<thinking>I'll use the builder pattern here.</thinking>" +
			"Used the builder pattern to construct the configuration object. " +
			"The pattern allows flexible construction with clear separation of concerns.";

		const entry = await mem.recordSuccess(
			"1.A",
			"Implement configuration builder",
			["Builder pattern used"],
			summary,
		);

		expect(entry!.summary).toContain("builder pattern");
		expect(entry!.summary).toContain("configuration object");
		expect(entry!.summary).toContain("flexible construction");
	});
});

// ============================================================================
// 5. Memory can be disabled
// ============================================================================

describe("memory can be disabled", () => {
	it("returns null from recordSuccess when disabled via config", async () => {
		const mem = createTestMemory({ enabled: false });

		const entry = await mem.recordSuccess("1.A", "Some task", [], "Task completed.");

		expect(entry).toBeNull();
	});

	it("returns null from recordFailure when disabled via config", async () => {
		const mem = createTestMemory({ enabled: false });

		const entry = await mem.recordFailure("1.A", "Some task", [], "Task failed.");

		expect(entry).toBeNull();
	});

	it("returns empty results from getRelevantMemory when disabled", async () => {
		const mem = createTestMemory({ enabled: false });

		await mem.recordSuccess("1.A", "Database setup", [], "Created tables.");
		const results = await mem.getRelevantMemory("Database stuff", []);

		expect(results).toHaveLength(0);
	});

	it("returns empty array from getAll when disabled", async () => {
		const mem = createTestMemory({ enabled: false });

		await mem.recordSuccess("1.A", "Task", [], "Done.");
		const all = await mem.getAll();

		expect(all).toHaveLength(0);
	});

	it("returns 0 from count when disabled", async () => {
		const mem = createTestMemory({ enabled: false });

		await mem.recordSuccess("1.A", "Task", [], "Done.");
		const count = await mem.count();

		expect(count).toBe(0);
	});

	it("can be toggled at runtime with disable()/enable()", async () => {
		const mem = createTestMemory({ enabled: true });

		// Enabled: should store
		const entry1 = await mem.recordSuccess("1.A", "Task A", [], "Task A done.");
		expect(entry1).not.toBeNull();

		// Disable: should not store
		mem.disable();
		const entry2 = await mem.recordSuccess("2.B", "Task B", [], "Task B done.");
		expect(entry2).toBeNull();

		// Re-enable: should store again
		mem.enable();
		const entry3 = await mem.recordSuccess("3.C", "Task C", [], "Task C done.");
		expect(entry3).not.toBeNull();

		const all = await mem.getAll();
		expect(all).toHaveLength(2); // Only entries 1 and 3
	});

	it("isEnabled() reflects current state", async () => {
		const mem = createTestMemory({ enabled: true });
		expect(mem.isEnabled()).toBe(true);

		mem.disable();
		expect(mem.isEnabled()).toBe(false);

		mem.enable();
		expect(mem.isEnabled()).toBe(true);
	});
});

// ============================================================================
// Additional edge cases and store tests
// ============================================================================

describe("execution memory edge cases", () => {
	it("handles empty acceptance criteria", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordSuccess("1.A", "Simple task", [], "Done.");
		expect(entry!.acceptanceCriteria).toEqual([]);
	});

	it("handles very long goals", async () => {
		const mem = createTestMemory();

		const longGoal = "A".repeat(10000);
		const entry = await mem.recordSuccess("1.A", longGoal, ["Criterion"], "Done.");
		expect(entry!.goal.length).toBe(10000);
	});

	it("prunes old entries", async () => {
		// Use a very short max age
		const store = new InMemoryExecutionMemoryStore();
		const mem = new ExecutionMemory({ enabled: true, maxAgeMs: 1, maxEntries: 100 }, store);

		// Store an entry
		await mem.recordSuccess("1.A", "Task", [], "Done.");

		// Wait for it to expire
		await new Promise((r) => setTimeout(r, 10));

		// Store another entry (triggers prune)
		await mem.recordSuccess("2.B", "Another task", [], "Done too.");

		const all = await mem.getAll();
		expect(all).toHaveLength(1); // Old entry should be pruned
		expect(all[0].workspaceId).toBe("2.B");
	});

	it("prunes excess entries by count", async () => {
		const store = new InMemoryExecutionMemoryStore();
		const mem = new ExecutionMemory({ enabled: true, maxEntries: 3, maxAgeMs: 100000 }, store);

		await mem.recordSuccess("1.A", "Task 1", [], "Done 1.");
		await mem.recordSuccess("2.B", "Task 2", [], "Done 2.");
		await mem.recordSuccess("3.C", "Task 3", [], "Done 3.");
		// Adding a fourth should trigger pruning of the oldest (1.A)
		await mem.recordSuccess("4.D", "Task 4", [], "Done 4.");

		const all = await mem.getAll();
		expect(all).toHaveLength(3);
		expect(all.find((e) => e.workspaceId === "1.A")).toBeUndefined();
	});

	it("clear() removes all entries", async () => {
		const mem = createTestMemory();

		await mem.recordSuccess("1.A", "Task", [], "Done.");
		await mem.recordFailure("2.B", "Task", [], "Failed.");

		expect(await mem.count()).toBe(2);

		await mem.clear();

		expect(await mem.count()).toBe(0);
		expect(await mem.getAll()).toEqual([]);
	});

	it("getConfig returns a copy of the config", async () => {
		const mem = new ExecutionMemory({ enabled: true, maxEntries: 50 });

		const config = mem.getConfig();
		expect(config.maxEntries).toBe(50);
		expect(config.enabled).toBe(true);

		// Verify it's a copy (mutating doesn't affect internal state)
		config.maxEntries = 999;
		expect(mem.getConfig().maxEntries).toBe(50);
	});
});

describe("InMemoryExecutionMemoryStore", () => {
	it("stores and retrieves entries", async () => {
		const store = new InMemoryExecutionMemoryStore();

		const entry: ExecutionMemoryEntry = {
			id: "test-1",
			workspaceId: "1.A",
			goal: "Test goal",
			acceptanceCriteria: [],
			verdict: "COMPLETE",
			summary: "Done.",
			filesModified: [],
			commandsRun: [],
			isFailure: false,
			timestamp: Date.now(),
		};

		await store.store(entry);
		const retrieved = await store.getById("test-1");
		expect(retrieved).toEqual(entry);
	});

	it("returns null for non-existent entries", async () => {
		const store = new InMemoryExecutionMemoryStore();
		const result = await store.getById("non-existent");
		expect(result).toBeNull();
	});

	it("deletes entries by ID", async () => {
		const store = new InMemoryExecutionMemoryStore();
		await store.store({
			id: "test-1",
			workspaceId: "1.A",
			goal: "Test",
			acceptanceCriteria: [],
			verdict: "COMPLETE",
			summary: "Done.",
			filesModified: [],
			commandsRun: [],
			isFailure: false,
			timestamp: 100,
		});
		await store.store({
			id: "test-2",
			workspaceId: "2.B",
			goal: "Test 2",
			acceptanceCriteria: [],
			verdict: "COMPLETE",
			summary: "Done 2.",
			filesModified: [],
			commandsRun: [],
			isFailure: false,
			timestamp: 200,
		});

		await store.deleteById("test-1");
		const all = await store.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe("test-2");
	});

	it("clears all entries", async () => {
		const store = new InMemoryExecutionMemoryStore();
		await store.store({
			id: "test-1",
			workspaceId: "1.A",
			goal: "Test",
			acceptanceCriteria: [],
			verdict: "COMPLETE",
			summary: "Done.",
			filesModified: [],
			commandsRun: [],
			isFailure: false,
			timestamp: 100,
		});

		await store.clear();
		expect(await store.count()).toBe(0);
	});
});

// ============================================================================
// Factory function
// ============================================================================

describe("createExecutionMemory factory", () => {
	it("creates an ExecutionMemory with default config", () => {
		const mem = createExecutionMemory();
		expect(mem).toBeInstanceOf(ExecutionMemory);
		expect(mem.isEnabled()).toBe(true);
	});

	it("creates with overridden config", () => {
		const mem = createExecutionMemory({ enabled: false, maxEntries: 10 });
		expect(mem.isEnabled()).toBe(false);
		expect(mem.getConfig().maxEntries).toBe(10);
	});
});

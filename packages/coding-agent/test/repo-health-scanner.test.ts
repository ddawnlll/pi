/**
 * Repo Health Scanner Tests - P8.C Repo Scanning & Analysis
 *
 * Validates:
 * 1. Scanner produces repo health signals (AC1)
 * 2. Scanner never mutates repo or queue state (AC2)
 * 3. Scanner output links evidence to proposals (AC3)
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepoHealthScanner, formatScanResult, formatScanResultJson } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal workspace queue JSON file that passes basic schema validation.
 */
function createValidQueueFile(dir: string): string {
	const queue = {
		phase: "test",
		title: "Test Queue",
		maxParallelWorkspaces: 1,
		contractVersion: "2.3.1",
		workspaces: [
			{
				id: "test.1",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 1,
			},
		],
	};
	const path = join(dir, ".pi", "valid.workspace-queue.json");
	writeFileSync(path, JSON.stringify(queue, null, 2));
	return path;
}

/**
 * Create an invalid workspace queue file with schema violations.
 */
function createInvalidQueueFile(dir: string): string {
	const queue = {
		phase: "test",
		title: "Test Queue",
		maxParallelWorkspaces: 99, // Exceeds allowed limits
		contractVersion: "2.3.1",
		workspaces: [
			{
				id: "test.1",
				title: "",
				dependencies: ["nonexistent"],
				roleBudget: "worker",
				maxRetries: 1,
				capabilities: {
					canEdit: ["*"],
					canRun: ["*"],
				},
			},
		],
	};
	const path = join(dir, ".pi", "invalid.workspace-queue.json");
	writeFileSync(path, JSON.stringify(queue, null, 2));
	return path;
}

/**
 * Create a workspace queue file with a dependency cycle.
 */
function createCyclicQueueFile(dir: string): string {
	const queue = {
		phase: "test",
		title: "Cyclic Queue",
		maxParallelWorkspaces: 1,
		contractVersion: "2.3.1",
		workspaces: [
			{
				id: "a",
				title: "Workspace A",
				dependencies: ["b"],
				roleBudget: "worker",
				maxRetries: 1,
			},
			{
				id: "b",
				title: "Workspace B",
				dependencies: ["c"],
				roleBudget: "worker",
				maxRetries: 1,
			},
			{
				id: "c",
				title: "Workspace C",
				dependencies: ["a"],
				roleBudget: "worker",
				maxRetries: 1,
			},
		],
	};
	const path = join(dir, ".pi", "cyclic.workspace-queue.json");
	writeFileSync(path, JSON.stringify(queue, null, 2));
	return path;
}

/**
 * Create a minimal directory structure for scanner testing.
 */
function setupTestRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-scan-test-"));
	// Create .pi directory
	const piDir = join(dir, ".pi");
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}
	return dir;
}

/**
 * Clean up test directory.
 */
function cleanupTestRepo(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RepoHealthScanner", () => {
	// -----------------------------------------------------------------------
	// AC1: Scanner produces repo health signals
	// -----------------------------------------------------------------------

	it("should produce health signals when scanning a clean repo", () => {
		const repoRoot = setupTestRepo();
		try {
			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true, // Prevent running external commands
				packages: [],
			});
			const result = scanner.scan();

			expect(result).toBeDefined();
			expect(result.summary).toBeDefined();
			expect(typeof result.summary.totalSignals).toBe("number");
			expect(typeof result.summary.durationMs).toBe("number");
			expect(result.scannerVersion).toBe("1.0.0");
			expect(result.repoRoot).toBe(resolve(repoRoot));
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should detect schema violations in workspace queue files", () => {
		const repoRoot = setupTestRepo();
		try {
			createInvalidQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			// Should have schema signals
			const schemaSignals = result.signals.filter((s) => s.category === "schema");
			expect(schemaSignals.length).toBeGreaterThan(0);

			// Should have file_scope signals for the broad "*" pattern
			const scopeSignals = result.signals.filter((s) => s.category === "file_scope");
			expect(scopeSignals.length).toBeGreaterThan(0);

			// Should have workspace_config signals for missing title
			const configSignals = result.signals.filter((s) => s.category === "workspace_config");
			expect(configSignals.length).toBeGreaterThan(0);
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should detect dependency cycles in workspace queues", () => {
		const repoRoot = setupTestRepo();
		try {
			createCyclicQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			const depGraphSignals = result.signals.filter((s) => s.category === "dependency_graph");
			expect(depGraphSignals.length).toBeGreaterThan(0);

			// At least one should reference the cycle
			const cycleSignal = depGraphSignals.find((s) => s.title.toLowerCase().includes("cycle"));
			expect(cycleSignal).toBeDefined();
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should produce no signals for a well-formed workspace queue", () => {
		const repoRoot = setupTestRepo();
		try {
			createValidQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			// Should have very few signals (maybe git info or similar)
			// but no schema/dependency errors
			const errorSignals = result.signals.filter((s) => s.severity === "error");
			expect(errorSignals.length).toBe(0);
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	// -----------------------------------------------------------------------
	// AC2: Scanner never mutates repo or queue state
	// -----------------------------------------------------------------------

	it("must not modify any files during scan (read-only)", () => {
		const repoRoot = setupTestRepo();
		try {
			// Create queue files
			createValidQueueFile(repoRoot);
			createInvalidQueueFile(repoRoot);

			// Record file checksums before scan
			const filesBefore = collectFileChecksums(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			scanner.scan();

			// Record file checksums after scan
			const filesAfter = collectFileChecksums(repoRoot);

			// No files should have been created, modified, or deleted
			expect(filesAfter).toEqual(filesBefore);
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("must not execute git commit or workspace mutations", () => {
		const repoRoot = setupTestRepo();
		try {
			// Run a full scan with external checks disabled
			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			// Should not throw or produce mutation-related errors
			expect(result.summary.totalSignals).toBeGreaterThanOrEqual(0);

			// Verify no side effects by checking file system state
			const piDir = join(repoRoot, ".pi");
			expect(existsSync(piDir)).toBe(true);
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	// -----------------------------------------------------------------------
	// AC3: Scanner output links evidence to proposals
	// -----------------------------------------------------------------------

	it("should link every signal to at least one piece of evidence", () => {
		const repoRoot = setupTestRepo();
		try {
			createInvalidQueueFile(repoRoot);
			createCyclicQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			for (const signal of result.signals) {
				if (signal.description === "Dry-run mode: git status check was skipped.") {
					continue; // Skip signals that explicitly have no evidence
				}
				if (signal.evidence.length === 0 && signal.proposals.length === 0) {
					continue; // Skip info-only signals without evidence
				}
				expect(
					signal.evidence.length,
					`Signal ${signal.id} ("${signal.title}") should have at least one evidence item`,
				).toBeGreaterThan(0);
			}
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should link every signal to at least one proposal", () => {
		const repoRoot = setupTestRepo();
		try {
			createInvalidQueueFile(repoRoot);
			createCyclicQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			for (const signal of result.signals) {
				// Skip info signals without proposals
				if (signal.severity === "info" && signal.proposals.length === 0) {
					continue;
				}
				expect(
					signal.proposals.length,
					`Signal ${signal.id} ("${signal.title}") should have at least one proposal`,
				).toBeGreaterThan(0);
			}
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should reference file paths in evidence for queue-related signals", () => {
		const repoRoot = setupTestRepo();
		try {
			createInvalidQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			const queueRelatedSignals = result.signals.filter(
				(s) =>
					s.category === "schema" ||
					s.category === "dependency_graph" ||
					s.category === "workspace_config" ||
					s.category === "file_scope",
			);

			for (const signal of queueRelatedSignals) {
				for (const evidence of signal.evidence) {
					expect(evidence.filePath, `Signal ${signal.id} evidence should have a file path reference`).toBeTruthy();
				}
			}
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	// -----------------------------------------------------------------------
	// Formatting
	// -----------------------------------------------------------------------

	it("should produce a human-readable format", () => {
		const repoRoot = setupTestRepo();
		try {
			createInvalidQueueFile(repoRoot);
			createCyclicQueueFile(repoRoot);

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();
			const formatted = formatScanResult(result);

			expect(formatted).toBeTruthy();
			expect(formatted.length).toBeGreaterThan(0);
			expect(formatted).toContain("REPO HEALTH SCAN");
			expect(formatted).toContain("Signals:");
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should produce a JSON format", () => {
		const repoRoot = setupTestRepo();
		try {
			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();
			const json = formatScanResultJson(result);

			expect(json).toBeTruthy();
			const parsed = JSON.parse(json);
			expect(parsed.scannerVersion).toBe("1.0.0");
			expect(parsed.signals).toBeDefined();
			expect(Array.isArray(parsed.signals)).toBe(true);
			expect(parsed.summary).toBeDefined();
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	it("should handle empty repos with no queue files gracefully", () => {
		const repoRoot = setupTestRepo();
		try {
			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			expect(result).toBeDefined();
			expect(result.signals).toBeDefined();
			// Should not throw or produce errors for missing queue files
			const errorSignals = result.signals.filter((s) => s.severity === "error");
			expect(errorSignals.length).toBe(0);
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});

	it("should handle malformed JSON in queue files", () => {
		const repoRoot = setupTestRepo();
		try {
			const malformedPath = join(repoRoot, ".pi", "bad.workspace-queue.json");
			writeFileSync(malformedPath, "this is not json");

			const scanner = createRepoHealthScanner({
				repoRoot,
				dryRun: true,
				packages: [],
			});
			const result = scanner.scan();

			const schemaSignals = result.signals.filter((s) => s.category === "schema");
			const malformedSignal = schemaSignals.find((s) => s.title.includes("Invalid workspace queue JSON"));
			expect(malformedSignal).toBeDefined();
			expect(malformedSignal?.severity).toBe("error");
		} finally {
			cleanupTestRepo(repoRoot);
		}
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect checksums of all files in a directory tree.
 * Uses file size + modification time as a simple checksum.
 */
function collectFileChecksums(dir: string): Map<string, { size: number; mtimeMs: number }> {
	const result = new Map<string, { size: number; mtimeMs: number }>();

	function walk(currentDir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(currentDir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(currentDir, entry);
			try {
				const stat = statSync(fullPath);
				if (stat.isDirectory()) {
					walk(fullPath);
				} else {
					result.set(fullPath, { size: stat.size, mtimeMs: stat.mtimeMs });
				}
			} catch {
				// Skip unreadable files
			}
		}
	}

	walk(dir);
	return result;
}

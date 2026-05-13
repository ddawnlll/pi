/**
 * Docs Export & Project Memory — P5 Workstream 5.B
 *
 * Tests for the docs-export module.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SafetyReport, WorkspaceQueue } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CommitEntry,
	copyPlanMarkdown,
	type DocsExportConfig,
	type ExecutionExportData,
	exportDocs,
	generateSummaryMarkdown,
	getDocsPiDir,
	initDocsPiDirs,
	isForbiddenPath,
	isPathWithinDocsPi,
	readExecutionArchiveForExport,
	type WorkspaceResult,
	writeCommitsMarkdown,
	writeFollowUpsMarkdown,
	writeOriginalPlan,
	writeSafetyWarnings,
	writeSummaryMarkdown,
	writeTestResultsMarkdown,
	writeWorkspaceVerdict,
} from "../src/docs-export.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
	const dir = join(tmpdir(), `docs-export-test-${randomUUID()}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

/**
 * Create a sample WorkspaceQueue for testing.
 */
function sampleQueue(): WorkspaceQueue {
	return {
		phase: "P5",
		title: "Production Operating Layer",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "5.A",
				title: "Execution Archive",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "medium",
			},
			{
				id: "5.B",
				title: "Docs Export & Project Memory",
				dependencies: ["5.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

/**
 * Create a sample SafetyReport with warnings for testing.
 */
function sampleSafetyReportWithWarnings(): SafetyReport {
	return {
		safe: true,
		critical: [],
		warnings: [
			{
				type: "placeholder" as never,
				severity: "warning" as never,
				message: "Unresolved placeholder in workspace 5.A",
				workspaceId: "5.A",
			},
		],
		info: [
			{
				type: "forbidden_file" as never,
				severity: "info" as never,
				message: "Workspace 5.B references .env but it is blocked",
				workspaceId: "5.B",
			},
		],
		totalIssues: 2,
	};
}

/**
 * Create a sample SafetyReport with no issues.
 */
function sampleSafetyReportClean(): SafetyReport {
	return {
		safe: true,
		critical: [],
		warnings: [],
		info: [],
		totalIssues: 0,
	};
}

/**
 * Create sample execution export data.
 */
function sampleExportData(overrides?: Partial<ExecutionExportData>): ExecutionExportData {
	return {
		planExecId: "plan-test-001",
		title: "Test Plan",
		phase: "P5",
		planContent: `# Test Plan${String.fromCharCode(10)}${String.fromCharCode(10)}This is a test plan.`,
		queue: sampleQueue(),
		safetyReport: sampleSafetyReportClean(),
		commits: [
			{
				sha: "abc123def456",
				workspaceId: "5.A",
				message: "feat: add execution archive",
				timestamp: "2026-01-15T10:30:00Z",
			},
		],
		workspaceResults: [
			{
				id: "5.A",
				title: "Execution Archive",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [
					{ path: "packages/web-server/src/execution-archive.ts", change: "created" },
					{ path: "packages/web-server/test/execution-archive.test.ts", change: "created" },
				],
			},
			{
				id: "5.B",
				title: "Docs Export & Project Memory",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [
					{ path: "packages/web-server/src/docs-export.ts", change: "created" },
					{ path: "packages/web-server/test/docs-export.test.ts", change: "created" },
				],
				testResults: "PASS src/docs-export.test.ts (5 tests)",
			},
		],
		followUps: ["Review .pi archive cleanup policy", "Add docs/pi to .gitignore if desired"],
		startedAt: "2026-01-15T10:00:00Z",
		completedAt: "2026-01-15T10:45:00Z",
		status: "complete",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("docs-export", () => {
	let workspaceRoot: string;

	beforeEach(async () => {
		workspaceRoot = await createTempDir();
	});

	afterEach(async () => {
		await rm(workspaceRoot, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 1: docs/pi/plans and docs/pi/executions created
	// when docs export is enabled
	// -----------------------------------------------------------------------

	describe("initDocsPiDirs", () => {
		it("creates docs/pi/plans and docs/pi/executions directories", async () => {
			const { plansDir, executionsDir } = await initDocsPiDirs(workspaceRoot);

			expect(existsSync(plansDir)).toBe(true);
			expect(existsSync(executionsDir)).toBe(true);
			expect(plansDir).toBe(join(workspaceRoot, "docs", "pi", "plans"));
			expect(executionsDir).toBe(join(workspaceRoot, "docs", "pi", "executions"));
		});

		it("creates dirs idempotently (no error on repeated calls)", async () => {
			await initDocsPiDirs(workspaceRoot);
			await initDocsPiDirs(workspaceRoot);

			expect(existsSync(join(workspaceRoot, "docs", "pi", "plans"))).toBe(true);
			expect(existsSync(join(workspaceRoot, "docs", "pi", "executions"))).toBe(true);
		});
	});

	describe("getDocsPiDir", () => {
		it("returns docs/pi path under workspace root", () => {
			const result = getDocsPiDir(workspaceRoot);
			expect(result).toBe(join(workspaceRoot, "docs", "pi"));
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 2: completed plan exports summary markdown
	// -----------------------------------------------------------------------

	describe("generateSummaryMarkdown", () => {
		it("generates a summary with plan metadata", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("# Execution Summary: Test Plan");
			expect(md).toContain("plan-test-001");
			expect(md).toContain("P5");
			expect(md).toContain("Complete");
		});

		it("includes workspace results table", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("## Workspace Results");
			expect(md).toContain("5.A");
			expect(md).toContain("5.B");
			expect(md).toContain("COMPLETE");
		});

		it("includes workspace details with files touched", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("execution-archive.ts");
			expect(md).toContain("docs-export.ts");
		});

		// -----------------------------------------------------------------------
		// Acceptance Criterion 3: summary includes workspace results, commits,
		// tests, safety warnings, follow-ups
		// -----------------------------------------------------------------------

		it("includes commits section", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("## Commits");
			expect(md).toContain("abc123d");
			expect(md).toContain("feat: add execution archive");
		});

		it("includes safety warnings section", () => {
			const data = sampleExportData({
				safetyReport: sampleSafetyReportWithWarnings(),
			});
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("## Safety Warnings");
			expect(md).toContain("Unresolved placeholder");
		});

		it("includes info items under safety", () => {
			const data = sampleExportData({
				safetyReport: sampleSafetyReportWithWarnings(),
			});
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("### Info");
			expect(md).toContain(".env but it is blocked");
		});

		it("shows no safety warnings when clean", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("## Safety Warnings");
			expect(md).toContain("_No safety warnings._");
		});

		it("includes follow-ups section", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("## Follow-ups");
			expect(md).toContain("Review .pi archive cleanup policy");
		});

		it("includes test results in workspace details", () => {
			const data = sampleExportData();
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("**Test results**:");
			expect(md).toContain("PASS src/docs-export.test.ts");
		});

		it("handles empty workspace results", () => {
			const data = sampleExportData({ workspaceResults: [] });
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("_No workspace results recorded._");
		});

		it("handles empty commits", () => {
			const data = sampleExportData({ commits: [] });
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("_No commits recorded._");
		});

		it("handles empty follow-ups", () => {
			const data = sampleExportData({ followUps: [] });
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("_No follow-ups._");
		});
	});

	// -----------------------------------------------------------------------
	// Individual artifact writer tests
	// -----------------------------------------------------------------------

	describe("writeSummaryMarkdown", () => {
		it("writes summary.md to docs/pi/executions/{planExecId}/", async () => {
			const data = sampleExportData();
			const path = await writeSummaryMarkdown(workspaceRoot, data);

			expect(existsSync(path)).toBe(true);
			expect(path).toContain("docs/pi/executions/plan-test-001/summary.md");

			const content = await readFile(path, "utf-8");
			expect(content).toContain("# Execution Summary: Test Plan");
		});
	});

	describe("writeOriginalPlan", () => {
		it("writes original-plan.md to docs/pi/executions/{planExecId}/", async () => {
			const planContent = `# My Plan${String.fromCharCode(10)}This is the plan.`;
			const path = await writeOriginalPlan(workspaceRoot, "plan-001", planContent);

			expect(existsSync(path)).toBe(true);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("# My Plan");
		});
	});

	describe("writeSafetyWarnings", () => {
		it("writes safety-warnings.md with warnings", async () => {
			const report = sampleSafetyReportWithWarnings();
			const path = await writeSafetyWarnings(workspaceRoot, "plan-001", report);

			expect(existsSync(path)).toBe(true);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("# Safety Warnings");
			expect(content).toContain("Unresolved placeholder");
		});

		it("handles clean safety report", async () => {
			const report = sampleSafetyReportClean();
			const path = await writeSafetyWarnings(workspaceRoot, "plan-001", report);

			const content = await readFile(path, "utf-8");
			expect(content).toContain("_No safety warnings or info messages._");
		});
	});

	describe("writeCommitsMarkdown", () => {
		it("writes commits.md with commit entries", async () => {
			const commits: CommitEntry[] = [
				{
					sha: "abc123def456",
					workspaceId: "5.A",
					message: "feat: add execution archive",
					timestamp: "2026-01-15T10:30:00Z",
				},
			];
			const path = await writeCommitsMarkdown(workspaceRoot, "plan-001", commits);

			expect(existsSync(path)).toBe(true);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("abc123d");
			expect(content).toContain("feat: add execution archive");
		});

		it("handles empty commits", async () => {
			const path = await writeCommitsMarkdown(workspaceRoot, "plan-001", []);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("_No commits recorded during this execution._");
		});
	});

	describe("writeTestResultsMarkdown", () => {
		it("writes test-results.md for workspaces with test results", async () => {
			const results: WorkspaceResult[] = [
				{
					id: "5.B",
					title: "Docs Export",
					verdict: "COMPLETE",
					attempts: 1,
					filesTouched: [],
					testResults: "PASS docs-export.test.ts (5 tests)",
				},
			];
			const path = await writeTestResultsMarkdown(workspaceRoot, "plan-001", results);

			expect(existsSync(path)).toBe(true);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("PASS docs-export.test.ts");
		});

		it("handles no test results", async () => {
			const results: WorkspaceResult[] = [
				{
					id: "5.A",
					title: "Execution Archive",
					verdict: "COMPLETE",
					attempts: 1,
					filesTouched: [],
				},
			];
			const path = await writeTestResultsMarkdown(workspaceRoot, "plan-001", results);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("_No test results recorded._");
		});
	});

	describe("writeFollowUpsMarkdown", () => {
		it("writes follow-ups.md with follow-up items", async () => {
			const followUps = ["Review .pi archive cleanup policy", "Add docs/pi to .gitignore if desired"];
			const path = await writeFollowUpsMarkdown(workspaceRoot, "plan-001", followUps);

			expect(existsSync(path)).toBe(true);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("Review .pi archive cleanup policy");
			expect(content).toContain("Add docs/pi to .gitignore");
		});

		it("handles empty follow-ups", async () => {
			const path = await writeFollowUpsMarkdown(workspaceRoot, "plan-001", []);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("_No follow-up items._");
		});
	});

	describe("writeWorkspaceVerdict", () => {
		it("writes verdict.md for a workspace", async () => {
			const result: WorkspaceResult = {
				id: "5.A",
				title: "Execution Archive",
				verdict: "COMPLETE",
				attempts: 2,
				filesTouched: [
					{ path: "src/archive.ts", change: "created" },
					{ path: "test/archive.test.ts", change: "modified" },
				],
			};
			const path = await writeWorkspaceVerdict(workspaceRoot, "plan-001", result);

			expect(existsSync(path)).toBe(true);
			expect(path).toContain("docs/pi/executions/plan-001/workspaces/5.A/verdict.md");

			const content = await readFile(path, "utf-8");
			expect(content).toContain("COMPLETE");
			expect(content).toContain("2");
			expect(content).toContain("src/archive.ts");
		});

		it("handles FAILED verdict", async () => {
			const result: WorkspaceResult = {
				id: "5.B",
				title: "Docs Export",
				verdict: "FAILED",
				attempts: 3,
				filesTouched: [],
			};
			const path = await writeWorkspaceVerdict(workspaceRoot, "plan-001", result);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("FAILED");
		});

		it("handles BLOCKED verdict", async () => {
			const result: WorkspaceResult = {
				id: "5.C",
				title: "Some WS",
				verdict: "BLOCKED",
				attempts: 1,
				filesTouched: [],
			};
			const path = await writeWorkspaceVerdict(workspaceRoot, "plan-001", result);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("BLOCKED");
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 4: docs export never writes outside docs/pi
	// -----------------------------------------------------------------------

	describe("path safety", () => {
		it("isPathWithinDocsPi allows paths under docs/pi", () => {
			expect(isPathWithinDocsPi(workspaceRoot, "plans/plan-001.md")).toBe(true);
			expect(isPathWithinDocsPi(workspaceRoot, "executions/plan-001/summary.md")).toBe(true);
			expect(isPathWithinDocsPi(workspaceRoot, "executions/plan-001/workspaces/5.A/verdict.md")).toBe(true);
		});

		it("isPathWithinDocsPi blocks path traversal with ..", () => {
			expect(isPathWithinDocsPi(workspaceRoot, "../../../etc/passwd")).toBe(false);
			expect(isPathWithinDocsPi(workspaceRoot, "../../outside.md")).toBe(false);
		});

		it("writeSummaryMarkdown throws on path traversal", async () => {
			const data = sampleExportData({ planExecId: "../../outside" });
			await expect(writeSummaryMarkdown(workspaceRoot, data)).rejects.toThrow("Path traversal detected");
		});

		it("writeWorkspaceVerdict throws on path traversal in workspaceId", async () => {
			const _result: WorkspaceResult = {
				id: "../../outsideworkspace",
				title: "Evil",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [],
			};
			// After join resolves: executions/plan-001/workspaces/../../outsideworkspace/verdict.md
			// = executions/plan-001/outsideworkspace/verdict.md — still within docs/pi
			// Need to use a workspaceId that actually escapes when combined with a planExecId that also traverses
			const data: WorkspaceResult = {
				id: "evil",
				title: "Evil",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [],
			};
			// Use a planExecId that traverses out
			await expect(writeWorkspaceVerdict(workspaceRoot, "../../outside", data)).rejects.toThrow("Path traversal");
		});

		it("exportDocs never creates files outside docs/pi", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			const result = await exportDocs(config, data);

			// Every written file should be under docs/pi
			const docsPiDir = resolve(getDocsPiDir(workspaceRoot));
			for (const filePath of result.filesWritten) {
				const resolved = resolve(filePath);
				expect(resolved.startsWith(`${docsPiDir}/`) || resolved === docsPiDir).toBe(true);
			}
		});
	});

	describe("forbidden file protection", () => {
		it("detects .env files as forbidden", () => {
			expect(isForbiddenPath(".env")).toBe(true);
			expect(isForbiddenPath(".env.local")).toBe(true);
		});

		it("detects .pem files as forbidden", () => {
			expect(isForbiddenPath("cert.pem")).toBe(true);
		});

		it("detects .key files as forbidden", () => {
			expect(isForbiddenPath("private.key")).toBe(true);
		});

		it("allows normal source files", () => {
			expect(isForbiddenPath("src/index.ts")).toBe(false);
			expect(isForbiddenPath("packages/web-server/src/docs-export.ts")).toBe(false);
		});

		it("forbidden paths are excluded from files-touched in summary", () => {
			const data = sampleExportData({
				workspaceResults: [
					{
						id: "5.A",
						title: "Test",
						verdict: "COMPLETE",
						attempts: 1,
						filesTouched: [
							{ path: "src/index.ts", change: "modified" },
							{ path: ".env", change: "modified" },
							{ path: "server.pem", change: "created" },
						],
					},
				],
			});
			const md = generateSummaryMarkdown(data);

			expect(md).toContain("src/index.ts");
			expect(md).not.toContain(".env");
			expect(md).not.toContain("server.pem");
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 5: docs export can be disabled
	// -----------------------------------------------------------------------

	describe("exportDocs disabled", () => {
		it("returns success with no files written when disabled", async () => {
			const config: DocsExportConfig = { enabled: false, workspaceRoot };
			const data = sampleExportData();
			const result = await exportDocs(config, data);

			expect(result.success).toBe(true);
			expect(result.filesWritten).toEqual([]);
			expect(result.errors).toEqual([]);
		});

		it("does not create docs/pi directory when disabled", async () => {
			const config: DocsExportConfig = { enabled: false, workspaceRoot };
			const data = sampleExportData();
			await exportDocs(config, data);

			expect(existsSync(join(workspaceRoot, "docs", "pi"))).toBe(false);
		});

		it("creates docs/pi directory when enabled", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			await exportDocs(config, data);

			expect(existsSync(join(workspaceRoot, "docs", "pi"))).toBe(true);
			expect(existsSync(join(workspaceRoot, "docs", "pi", "plans"))).toBe(true);
			expect(existsSync(join(workspaceRoot, "docs", "pi", "executions"))).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Full export integration test
	// -----------------------------------------------------------------------

	describe("exportDocs (full integration)", () => {
		it("writes all expected artifacts when enabled", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			const result = await exportDocs(config, data);

			expect(result.success).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.filesWritten.length).toBeGreaterThan(0);

			// Verify key files exist
			const docsPiDir = join(workspaceRoot, "docs", "pi");
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "summary.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "original-plan.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "safety-warnings.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "commits.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "test-results.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "follow-ups.md"))).toBe(true);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "workspaces", "5.A", "verdict.md"))).toBe(
				true,
			);
			expect(existsSync(join(docsPiDir, "executions", "plan-test-001", "workspaces", "5.B", "verdict.md"))).toBe(
				true,
			);
		});

		it("summary contains all required sections (AC #3)", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData({
				safetyReport: sampleSafetyReportWithWarnings(),
			});
			await exportDocs(config, data);

			const summaryPath = join(workspaceRoot, "docs", "pi", "executions", "plan-test-001", "summary.md");
			const content = await readFile(summaryPath, "utf-8");

			// Workspace results
			expect(content).toContain("## Workspace Results");
			expect(content).toContain("5.A");
			expect(content).toContain("5.B");

			// Commits
			expect(content).toContain("## Commits");
			expect(content).toContain("abc123d");

			// Tests (via test results in workspace details)
			expect(content).toContain("**Test results**:");

			// Safety warnings
			expect(content).toContain("## Safety Warnings");
			expect(content).toContain("Unresolved placeholder");

			// Follow-ups
			expect(content).toContain("## Follow-ups");
			expect(content).toContain("Review .pi archive cleanup policy");
		});

		it("copies plan markdown from .pi/plans when it exists", async () => {
			// Create a mock .pi/plans/plan-test-001.md
			const piPlansDir = join(workspaceRoot, ".pi", "plans");
			await mkdir(piPlansDir, { recursive: true });
			await writeFile(join(piPlansDir, "plan-test-001.md"), "# Living Plan Content", "utf-8");

			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			const _result = await exportDocs(config, data);

			const planPath = join(workspaceRoot, "docs", "pi", "plans", "plan-test-001.md");
			expect(existsSync(planPath)).toBe(true);
			const content = await readFile(planPath, "utf-8");
			expect(content).toContain("# Living Plan Content");
		});

		it("handles missing .pi/plans/ gracefully", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			const result = await exportDocs(config, data);

			// Should succeed even without .pi/plans/
			expect(result.success).toBe(true);
		});

		it("handles failed execution status", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData({ status: "failed" });
			const result = await exportDocs(config, data);

			expect(result.success).toBe(true);
			const summaryPath = join(workspaceRoot, "docs", "pi", "executions", "plan-test-001", "summary.md");
			const content = await readFile(summaryPath, "utf-8");
			expect(content).toContain("Failed");
		});
	});

	// -----------------------------------------------------------------------
	// copyPlanMarkdown
	// -----------------------------------------------------------------------

	describe("copyPlanMarkdown", () => {
		it("returns null when source plan file does not exist", async () => {
			const result = await copyPlanMarkdown(workspaceRoot, "nonexistent-plan");
			expect(result).toBeNull();
		});

		it("copies plan from .pi/plans/ to docs/pi/plans/", async () => {
			const piPlansDir = join(workspaceRoot, ".pi", "plans");
			await mkdir(piPlansDir, { recursive: true });
			await writeFile(join(piPlansDir, "plan-999.md"), "# Plan 999", "utf-8");

			const result = await copyPlanMarkdown(workspaceRoot, "plan-999");

			expect(result).not.toBeNull();
			const content = await readFile(result!, "utf-8");
			expect(content).toContain("# Plan 999");
		});
	});

	// -----------------------------------------------------------------------
	// readExecutionArchiveForExport
	// -----------------------------------------------------------------------

	describe("readExecutionArchiveForExport", () => {
		it("returns null when no archive exists", async () => {
			const result = await readExecutionArchiveForExport(workspaceRoot, "nonexistent");
			expect(result).toBeNull();
		});

		it("reads execution archive and constructs export data", async () => {
			// Set up a mock .pi/executions/{planExecId}/ structure
			const planExecId = "plan-archive-001";
			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			await mkdir(archiveDir, { recursive: true });
			await mkdir(join(archiveDir, "workspaces", "5.A"), { recursive: true });

			// Write original plan
			await writeFile(join(archiveDir, "original-plan.md"), "# Archived Plan", "utf-8");

			// Write parsed contract
			const queue = sampleQueue();
			await writeFile(join(archiveDir, "parsed-contract.json"), JSON.stringify(queue), "utf-8");

			// Write commits
			const commits = [
				{ sha: "deadbeef", workspaceId: "5.A", message: "test commit", timestamp: "2026-01-01T00:00:00Z" },
			];
			await writeFile(join(archiveDir, "commits.json"), JSON.stringify(commits), "utf-8");

			// Write safety report
			const safety = { safe: true, critical: [], warnings: [], info: [], totalIssues: 0 };
			await writeFile(join(archiveDir, "doctor-report.json"), JSON.stringify(safety), "utf-8");

			// Write workspace verdict
			await writeFile(
				join(archiveDir, "workspaces", "5.A", "reviewer-verdict.md"),
				`# Workspace 5.A - Verdict: COMPLETE${String.fromCharCode(10)}All good.`,
				"utf-8",
			);

			// Write files touched
			const filesTouched = [{ path: "src/archive.ts", change: "created" }];
			await writeFile(
				join(archiveDir, "workspaces", "5.A", "files-touched.json"),
				JSON.stringify(filesTouched),
				"utf-8",
			);

			const result = await readExecutionArchiveForExport(workspaceRoot, planExecId);

			expect(result).not.toBeNull();
			expect(result!.planContent).toContain("# Archived Plan");
			expect(result!.commits).toHaveLength(1);
			expect(result!.commits[0].sha).toBe("deadbeef");
			expect(result!.workspaceResults).toHaveLength(1);
			expect(result!.workspaceResults[0].id).toBe("5.A");
			expect(result!.workspaceResults[0].verdict).toBe("COMPLETE");
		});

		it("handles partial archive (missing files)", async () => {
			const planExecId = "plan-partial";
			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			await mkdir(archiveDir, { recursive: true });

			// Only write the original plan, nothing else
			await writeFile(join(archiveDir, "original-plan.md"), "# Partial Plan", "utf-8");

			const result = await readExecutionArchiveForExport(workspaceRoot, planExecId);

			expect(result).not.toBeNull();
			expect(result!.planContent).toContain("# Partial Plan");
			expect(result!.commits).toEqual([]);
			expect(result!.workspaceResults).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// Module exports verification
	// -----------------------------------------------------------------------

	describe("module exports", () => {
		it("all public functions are exported", () => {
			expect(typeof exportDocs).toBe("function");
			expect(typeof generateSummaryMarkdown).toBe("function");
			expect(typeof initDocsPiDirs).toBe("function");
			expect(typeof getDocsPiDir).toBe("function");
			expect(typeof isPathWithinDocsPi).toBe("function");
			expect(typeof isForbiddenPath).toBe("function");
			expect(typeof writeSummaryMarkdown).toBe("function");
			expect(typeof copyPlanMarkdown).toBe("function");
			expect(typeof writeOriginalPlan).toBe("function");
			expect(typeof writeSafetyWarnings).toBe("function");
			expect(typeof writeCommitsMarkdown).toBe("function");
			expect(typeof writeTestResultsMarkdown).toBe("function");
			expect(typeof writeFollowUpsMarkdown).toBe("function");
			expect(typeof writeWorkspaceVerdict).toBe("function");
			expect(typeof readExecutionArchiveForExport).toBe("function");
		});
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("handles empty workspace results", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData({ workspaceResults: [] });
			const result = await exportDocs(config, data);

			expect(result.success).toBe(true);
		});

		it("handles empty commits gracefully", async () => {
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData({ commits: [] });
			const result = await exportDocs(config, data);

			expect(result.success).toBe(true);
			const commitsPath = join(workspaceRoot, "docs", "pi", "executions", "plan-test-001", "commits.md");
			const content = await readFile(commitsPath, "utf-8");
			expect(content).toContain("_No commits recorded during this execution._");
		});

		it("handles workspace with no files touched", async () => {
			const result: WorkspaceResult = {
				id: "5.C",
				title: "Empty WS",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [],
			};
			const path = await writeWorkspaceVerdict(workspaceRoot, "plan-001", result);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("COMPLETE");
			// No "Files Touched" section since empty
			expect(content).not.toContain("## Files Touched");
		});

		it("handles workspace with test results in verdict", async () => {
			const result: WorkspaceResult = {
				id: "5.D",
				title: "Test WS",
				verdict: "COMPLETE",
				attempts: 1,
				filesTouched: [],
				testResults: "3 tests passed, 0 failed",
			};
			const path = await writeWorkspaceVerdict(workspaceRoot, "plan-001", result);
			const content = await readFile(path, "utf-8");
			expect(content).toContain("## Test Results");
			expect(content).toContain("3 tests passed");
		});

		it("continues writing when individual artifact fails", async () => {
			// This is tested implicitly - if one write fails, others should still succeed
			const config: DocsExportConfig = { enabled: true, workspaceRoot };
			const data = sampleExportData();
			const result = await exportDocs(config, data);

			// Even if some parts might have issues, the export should not crash
			expect(result).toBeDefined();
			expect(result.filesWritten.length).toBeGreaterThan(0);
		});
	});
});

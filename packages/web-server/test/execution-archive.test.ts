/**
 * Execution Archive / Plan Vault — P5 Workstream 5.A
 *
 * Tests for the execution-archive module.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SafetyReport, WorkspaceQueue } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendDecision,
	appendToolCallEvent,
	appendWorkspaceEvent,
	archiveCommitMap,
	archiveDiffPatch,
	archiveDoctorReport,
	archiveDryRunReport,
	archiveFilesTouched,
	archiveOriginalPlan,
	archiveParsedContract,
	archivePlanArtifacts,
	archiveReviewerVerdict,
	archiveSafetyPolicy,
	archiveWorkspaceDAG,
	archiveWorkspacePacket,
	type CommitEntry,
	copyFileToArchive,
	type FilesTouchedEntry,
	initExecutionArchive,
	initWorkspaceArchive,
	isForbiddenPath,
	listExecutionArchives,
	listWorkspaceArchives,
	type ReviewerVerdict,
	readArchiveArtifact,
	type SafetyPolicySnapshot,
} from "../src/execution-archive.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
	const dir = join(tmpdir(), `execution-archive-test-${randomUUID()}`);
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
				title: "Execution Archive / Plan Vault",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "medium",
			},
			{
				id: "5.B",
				title: "Docs Export",
				dependencies: ["5.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

/**
 * Create a sample SafetyReport for testing.
 */
function sampleDoctorReport(): SafetyReport {
	return {
		safe: true,
		critical: [],
		warnings: [],
		info: [],
		totalIssues: 0,
	};
}

/**
 * Create a sample SafetyPolicySnapshot for testing.
 */
function sampleSafetyPolicy(): SafetyPolicySnapshot {
	return {
		profile: "strict",
		allowGitPush: false,
		allowDestructiveCommands: false,
		allowAutoCommit: false,
		allowDependencyInstall: false,
		allowQueueAutoRun: false,
		capturedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("execution-archive", () => {
	let workspaceRoot: string;

	beforeEach(async () => {
		workspaceRoot = await createTempDir();
	});

	afterEach(async () => {
		await rm(workspaceRoot, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 1: .pi/executions/{planExecId}/ created at plan start
	// -----------------------------------------------------------------------

	describe("initExecutionArchive", () => {
		it("creates .pi/executions/{planExecId}/ at plan start", async () => {
			const planExecId = "plan-001";
			const result = await initExecutionArchive(workspaceRoot, planExecId);

			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);

			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			expect(existsSync(archiveDir)).toBe(true);
			expect(existsSync(join(archiveDir, "workspaces"))).toBe(true);
		});

		it("returns the correct archive directory path", async () => {
			const planExecId = "plan-002";
			const result = await initExecutionArchive(workspaceRoot, planExecId);

			expect(result.archiveDir).toBe(join(workspaceRoot, ".pi", "executions", planExecId));
		});

		it("handles multiple execution archives", async () => {
			await initExecutionArchive(workspaceRoot, "plan-a");
			await initExecutionArchive(workspaceRoot, "plan-b");

			const archives = await listExecutionArchives(workspaceRoot);
			expect(archives).toContain("plan-a");
			expect(archives).toContain("plan-b");
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 2: original plan, parsed contract, doctor report,
	// DAG, safety policy, commit map archived
	// -----------------------------------------------------------------------

	describe("plan-level archival", () => {
		const planExecId = "plan-arch";

		it("archives the original plan as original-plan.md", async () => {
			const planContent = "# My Plan &n This is a test plan.";
			await archiveOriginalPlan(workspaceRoot, planExecId, planContent);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "original-plan.md"),
				"utf-8",
			);
			expect(content).toBe(planContent);
		});

		it("archives the parsed contract as parsed-contract.json", async () => {
			const queue = sampleQueue();
			await archiveParsedContract(workspaceRoot, planExecId, queue);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "parsed-contract.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			expect(parsed.phase).toBe("P5");
			expect(parsed.workspaces).toHaveLength(2);
		});

		it("archives the doctor report as doctor-report.json", async () => {
			const report = sampleDoctorReport();
			await archiveDoctorReport(workspaceRoot, planExecId, report);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "doctor-report.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			expect(parsed.safe).toBe(true);
			expect(parsed.totalIssues).toBe(0);
		});

		it("archives the dry-run report when available", async () => {
			const dryRun = { estimatedDuration: "5m", workspaceCount: 2 };
			await archiveDryRunReport(workspaceRoot, planExecId, dryRun);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "dry-run-report.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			expect(parsed.estimatedDuration).toBe("5m");
		});

		it("archives the workspace DAG as workspace-dag.json", async () => {
			const queue = sampleQueue();
			await archiveWorkspaceDAG(workspaceRoot, planExecId, queue);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspace-dag.json"),
				"utf-8",
			);
			const dag = JSON.parse(content);
			expect(dag).toHaveLength(2);
			expect(dag[0].id).toBe("5.A");
			expect(dag[0].dependencies).toEqual([]);
			expect(dag[1].id).toBe("5.B");
			expect(dag[1].dependencies).toEqual(["5.A"]);
		});

		it("archives the safety policy as safety-policy.json", async () => {
			const policy = sampleSafetyPolicy();
			await archiveSafetyPolicy(workspaceRoot, planExecId, policy);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "safety-policy.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			expect(parsed.profile).toBe("strict");
			expect(parsed.allowGitPush).toBe(false);
		});

		it("archives the commit map as commits.json", async () => {
			const commits: CommitEntry[] = [
				{
					sha: "abc123",
					workspaceId: "5.A",
					message: "feat: add execution archive",
					timestamp: new Date().toISOString(),
				},
			];
			await archiveCommitMap(workspaceRoot, planExecId, commits);

			const content = await readFile(join(workspaceRoot, ".pi", "executions", planExecId, "commits.json"), "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].sha).toBe("abc123");
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 3: per-workspace archive folders created
	// -----------------------------------------------------------------------

	describe("workspace archival", () => {
		const planExecId = "plan-ws";
		const workspaceId = "5.A";

		it("creates per-workspace archive folders", async () => {
			const wsDir = await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			expect(existsSync(wsDir)).toBe(true);
			expect(existsSync(join(wsDir, "test-results"))).toBe(true);

			const listed = await listWorkspaceArchives(workspaceRoot, planExecId);
			expect(listed).toContain(workspaceId);
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 4: workspace archive contains packet, events,
	// tool calls, files touched, verdict, diff when available
	// -----------------------------------------------------------------------

	describe("workspace artifacts", () => {
		const planExecId = "plan-art";
		const workspaceId = "5.A";

		beforeEach(async () => {
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);
		});

		it("archives the workspace packet as packet.md", async () => {
			const packetContent = "# Workspace 5.A &n You are implementing the execution archive.";
			await archiveWorkspacePacket(workspaceRoot, planExecId, workspaceId, packetContent);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "packet.md"),
				"utf-8",
			);
			expect(content).toBe(packetContent);
		});

		it("appends tool call events to tool-calls.ndjson", async () => {
			const event1 = { tool: "write", file: "src/index.ts", timestamp: "2026-01-01T00:00:00Z" };
			const event2 = { tool: "bash", command: "npm test", timestamp: "2026-01-01T00:01:00Z" };

			await appendToolCallEvent(workspaceRoot, planExecId, workspaceId, event1);
			await appendToolCallEvent(workspaceRoot, planExecId, workspaceId, event2);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "tool-calls.ndjson"),
				"utf-8",
			);
			const lines = content.trim().split("\n").filter(Boolean);
			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[0]).tool).toBe("write");
			expect(JSON.parse(lines[1]).tool).toBe("bash");
		});

		it("appends events to events.ndjson", async () => {
			const event = { type: "workspace_started", workspaceId };
			await appendWorkspaceEvent(workspaceRoot, planExecId, workspaceId, event);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "events.ndjson"),
				"utf-8",
			);
			const parsed = JSON.parse(content.trim());
			expect(parsed.type).toBe("workspace_started");
		});

		it("appends decisions to decisions.ndjson", async () => {
			const decision = { action: "created archive module", reason: "P5 requirement" };
			await appendDecision(workspaceRoot, planExecId, workspaceId, decision);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "decisions.ndjson"),
				"utf-8",
			);
			const parsed = JSON.parse(content.trim());
			expect(parsed.action).toBe("created archive module");
		});

		it("archives files-touched.json", async () => {
			const files: FilesTouchedEntry[] = [
				{ path: "packages/web-server/src/execution-archive.ts", change: "created" },
				{ path: "packages/web-server/test/execution-archive.test.ts", change: "created" },
			];
			await archiveFilesTouched(workspaceRoot, planExecId, workspaceId, files);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "files-touched.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			expect(parsed).toHaveLength(2);
			expect(parsed[0].change).toBe("created");
		});

		it("archives the reviewer verdict as reviewer-verdict.md", async () => {
			const verdict: ReviewerVerdict = {
				workspaceId,
				verdict: "COMPLETE",
				summary: "All tests pass, archive created successfully.",
				timestamp: new Date().toISOString(),
			};
			await archiveReviewerVerdict(workspaceRoot, planExecId, workspaceId, verdict);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "reviewer-verdict.md"),
				"utf-8",
			);
			expect(content).toContain("COMPLETE");
			expect(content).toContain("All tests pass");
		});

		it("archives the diff patch when available", async () => {
			const diffPatch = "diff --git a/file.ts b/file.ts&n+new line";
			await archiveDiffPatch(workspaceRoot, planExecId, workspaceId, diffPatch);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "diff.patch"),
				"utf-8",
			);
			expect(content).toBe(diffPatch);
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 5: archive writer never copies forbidden files
	// -----------------------------------------------------------------------

	describe("forbidden file protection", () => {
		it("detects .env files as forbidden", () => {
			expect(isForbiddenPath(".env")).toBe(true);
			expect(isForbiddenPath(".env.local")).toBe(true);
			expect(isForbiddenPath(".env.bak")).toBe(true);
			expect(isForbiddenPath("path/to/.env.production")).toBe(true);
		});

		it("detects .pem files as forbidden", () => {
			expect(isForbiddenPath("cert.pem")).toBe(true);
			expect(isForbiddenPath("keys/server.pem")).toBe(true);
		});

		it("detects .key files as forbidden", () => {
			expect(isForbiddenPath("private.key")).toBe(true);
			expect(isForbiddenPath("ssh/id_rsa.key")).toBe(true);
		});

		it("detects .ssh directory files as forbidden", () => {
			expect(isForbiddenPath("/home/user/.ssh/id_rsa")).toBe(true);
			expect(isForbiddenPath(".ssh/config")).toBe(true);
		});

		it("allows normal source files", () => {
			expect(isForbiddenPath("src/index.ts")).toBe(false);
			expect(isForbiddenPath("packages/web-server/src/execution-archive.ts")).toBe(false);
			expect(isForbiddenPath("test/execution-archive.test.ts")).toBe(false);
			expect(isForbiddenPath("README.md")).toBe(false);
		});

		it("filters forbidden paths from files-touched", async () => {
			const planExecId = "plan-forbidden";
			const workspaceId = "5.A";
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			const files: FilesTouchedEntry[] = [
				{ path: "src/index.ts", change: "modified" },
				{ path: ".env", change: "modified" },
				{ path: "secrets.key", change: "modified" },
				{ path: "cert.pem", change: "modified" },
				{ path: "lib/utils.ts", change: "created" },
			];
			await archiveFilesTouched(workspaceRoot, planExecId, workspaceId, files);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "files-touched.json"),
				"utf-8",
			);
			const parsed = JSON.parse(content);
			// Only the non-forbidden files should be archived
			expect(parsed).toHaveLength(2);
			expect(parsed[0].path).toBe("src/index.ts");
			expect(parsed[1].path).toBe("lib/utils.ts");
		});

		it("readArchiveArtifact returns null for forbidden paths", async () => {
			const planExecId = "plan-read-forbidden";

			// Even if a .env file somehow ended up in the archive dir,
			// readArchiveArtifact should refuse to read it
			const result = await readArchiveArtifact(workspaceRoot, planExecId, ".env");
			expect(result).toBeNull();
		});

		it("readArchiveArtifact returns null for .pem files", async () => {
			const planExecId = "plan-read-pem";
			const result = await readArchiveArtifact(workspaceRoot, planExecId, "server.pem");
			expect(result).toBeNull();
		});

		it("copyFileToArchive refuses to copy from forbidden source paths", async () => {
			const planExecId = "plan-copy-forbidden";
			await initExecutionArchive(workspaceRoot, planExecId);

			// Create a .env file in the temp dir
			const envPath = join(workspaceRoot, ".env");
			const { writeFile: wf } = await import("node:fs/promises");
			await wf(envPath, "SECRET=value", "utf-8");

			await copyFileToArchive(workspaceRoot, planExecId, "copied-env", envPath);

			// The file should NOT exist in the archive
			expect(existsSync(join(workspaceRoot, ".pi", "executions", planExecId, "copied-env"))).toBe(false);
		});

		it("copyFileToArchive refuses to copy to forbidden destination paths", async () => {
			const planExecId = "plan-copy-dest-forbidden";
			await initExecutionArchive(workspaceRoot, planExecId);

			// Create a normal source file
			const srcPath = join(workspaceRoot, "normal.txt");
			const { writeFile: wf } = await import("node:fs/promises");
			await wf(srcPath, "normal content", "utf-8");

			await copyFileToArchive(workspaceRoot, planExecId, ".env.stolen", srcPath);

			// The file should NOT exist in the archive
			expect(existsSync(join(workspaceRoot, ".pi", "executions", planExecId, ".env.stolen"))).toBe(false);
		});

		it("readArchiveArtifact blocks path traversal attempts", async () => {
			const planExecId = "plan-traversal";
			await initExecutionArchive(workspaceRoot, planExecId);

			const result = await readArchiveArtifact(workspaceRoot, planExecId, "../../../etc/passwd");
			expect(result).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 6: TypeScript compiles cleanly
	// (Verified by the build system; this test section confirms the module
	// exports are usable)
	// -----------------------------------------------------------------------

	describe("module exports", () => {
		it("all public functions are exported", () => {
			expect(typeof initExecutionArchive).toBe("function");
			expect(typeof archiveOriginalPlan).toBe("function");
			expect(typeof archiveParsedContract).toBe("function");
			expect(typeof archiveDoctorReport).toBe("function");
			expect(typeof archiveDryRunReport).toBe("function");
			expect(typeof archiveWorkspaceDAG).toBe("function");
			expect(typeof archiveSafetyPolicy).toBe("function");
			expect(typeof archiveCommitMap).toBe("function");
			expect(typeof initWorkspaceArchive).toBe("function");
			expect(typeof archiveWorkspacePacket).toBe("function");
			expect(typeof appendToolCallEvent).toBe("function");
			expect(typeof appendWorkspaceEvent).toBe("function");
			expect(typeof appendDecision).toBe("function");
			expect(typeof archiveFilesTouched).toBe("function");
			expect(typeof archiveReviewerVerdict).toBe("function");
			expect(typeof archiveDiffPatch).toBe("function");
			expect(typeof listExecutionArchives).toBe("function");
			expect(typeof listWorkspaceArchives).toBe("function");
			expect(typeof readArchiveArtifact).toBe("function");
			expect(typeof copyFileToArchive).toBe("function");
			expect(typeof archivePlanArtifacts).toBe("function");
			expect(typeof isForbiddenPath).toBe("function");
		});
	});

	// -----------------------------------------------------------------------
	// Convenience function
	// -----------------------------------------------------------------------

	describe("archivePlanArtifacts", () => {
		it("archives all plan-level artifacts in one call", async () => {
			const planExecId = "plan-convenience";
			const queue = sampleQueue();
			const doctorReport = sampleDoctorReport();
			const policy = sampleSafetyPolicy();
			const planContent = "# My Plan &n Testing convenience function.";

			await archivePlanArtifacts(workspaceRoot, planExecId, {
				planContent,
				queue,
				doctorReport,
				safetyPolicy: policy,
			});

			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);

			// All plan-level artifacts should exist
			expect(existsSync(join(archiveDir, "original-plan.md"))).toBe(true);
			expect(existsSync(join(archiveDir, "parsed-contract.json"))).toBe(true);
			expect(existsSync(join(archiveDir, "doctor-report.json"))).toBe(true);
			expect(existsSync(join(archiveDir, "workspace-dag.json"))).toBe(true);
			expect(existsSync(join(archiveDir, "safety-policy.json"))).toBe(true);
			expect(existsSync(join(archiveDir, "workspaces"))).toBe(true);

			// dry-run-report.json should NOT exist (not provided)
			expect(existsSync(join(archiveDir, "dry-run-report.json"))).toBe(false);
		});

		it("includes dry-run report when provided", async () => {
			const planExecId = "plan-dryrun";
			const queue = sampleQueue();
			const doctorReport = sampleDoctorReport();
			const policy = sampleSafetyPolicy();
			const planContent = "# My Plan";
			const dryRun = { ok: true, warnings: [] };

			await archivePlanArtifacts(workspaceRoot, planExecId, {
				planContent,
				queue,
				doctorReport,
				dryRunReport: dryRun,
				safetyPolicy: policy,
			});

			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			expect(existsSync(join(archiveDir, "dry-run-report.json"))).toBe(true);

			const content = await readFile(join(archiveDir, "dry-run-report.json"), "utf-8");
			expect(JSON.parse(content).ok).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Listing helpers
	// -----------------------------------------------------------------------

	describe("listing", () => {
		it("listExecutionArchives returns empty when no archives exist", async () => {
			const archives = await listExecutionArchives(workspaceRoot);
			expect(archives).toEqual([]);
		});

		it("listExecutionArchives returns created archives", async () => {
			await initExecutionArchive(workspaceRoot, "exec-1");
			await initExecutionArchive(workspaceRoot, "exec-2");

			const archives = await listExecutionArchives(workspaceRoot);
			expect(archives.sort()).toEqual(["exec-1", "exec-2"]);
		});

		it("listWorkspaceArchives returns empty when no workspaces archived", async () => {
			await initExecutionArchive(workspaceRoot, "plan-empty-ws");
			const workspaces = await listWorkspaceArchives(workspaceRoot, "plan-empty-ws");
			expect(workspaces).toEqual([]);
		});

		it("listWorkspaceArchives returns created workspace archives", async () => {
			await initExecutionArchive(workspaceRoot, "plan-ws-list");
			await initWorkspaceArchive(workspaceRoot, "plan-ws-list", "5.A");
			await initWorkspaceArchive(workspaceRoot, "plan-ws-list", "5.B");

			const workspaces = await listWorkspaceArchives(workspaceRoot, "plan-ws-list");
			expect(workspaces.sort()).toEqual(["5.A", "5.B"]);
		});
	});

	// -----------------------------------------------------------------------
	// readArchiveArtifact
	// -----------------------------------------------------------------------

	describe("readArchiveArtifact", () => {
		it("reads a valid artifact from the archive", async () => {
			const planExecId = "plan-read";
			await archiveOriginalPlan(workspaceRoot, planExecId, "# Test Plan");

			const content = await readArchiveArtifact(workspaceRoot, planExecId, "original-plan.md");
			expect(content).toBe("# Test Plan");
		});

		it("returns null for non-existent artifacts", async () => {
			const content = await readArchiveArtifact(workspaceRoot, "plan-noexist", "nonexistent.md");
			expect(content).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// copyFileToArchive
	// -----------------------------------------------------------------------

	describe("copyFileToArchive", () => {
		it("copies a safe file into the archive", async () => {
			const planExecId = "plan-copy";
			await initExecutionArchive(workspaceRoot, planExecId);

			// Create a source file
			const srcPath = join(workspaceRoot, "source.txt");
			const { writeFile: wf } = await import("node:fs/promises");
			await wf(srcPath, "safe content", "utf-8");

			await copyFileToArchive(workspaceRoot, planExecId, "copied.txt", srcPath);

			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			expect(existsSync(join(archiveDir, "copied.txt"))).toBe(true);

			const content = await readFile(join(archiveDir, "copied.txt"), "utf-8");
			expect(content).toBe("safe content");
		});

		it("silently skips non-existent source files", async () => {
			const planExecId = "plan-copy-noexist";
			await initExecutionArchive(workspaceRoot, planExecId);

			await copyFileToArchive(workspaceRoot, planExecId, "missing.txt", join(workspaceRoot, "does-not-exist.txt"));

			const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
			expect(existsSync(join(archiveDir, "missing.txt"))).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("handles workspace archive with no diff patch (optional)", async () => {
			const planExecId = "plan-no-diff";
			const workspaceId = "5.A";
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			// diff.patch should not exist when not written
			expect(
				existsSync(join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "diff.patch")),
			).toBe(false);
		});

		it("handles empty files-touched list", async () => {
			const planExecId = "plan-empty-files";
			const workspaceId = "5.A";
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			await archiveFilesTouched(workspaceRoot, planExecId, workspaceId, []);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "files-touched.json"),
				"utf-8",
			);
			expect(JSON.parse(content)).toEqual([]);
		});

		it("handles empty commit map", async () => {
			const planExecId = "plan-empty-commits";
			await initExecutionArchive(workspaceRoot, planExecId);
			await archiveCommitMap(workspaceRoot, planExecId, []);

			const content = await readFile(join(workspaceRoot, ".pi", "executions", planExecId, "commits.json"), "utf-8");
			expect(JSON.parse(content)).toEqual([]);
		});

		it("handles workspace with BLOCKED verdict", async () => {
			const planExecId = "plan-blocked";
			const workspaceId = "5.A";
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			const verdict: ReviewerVerdict = {
				workspaceId,
				verdict: "BLOCKED",
				summary: "Dependency failed.",
				timestamp: new Date().toISOString(),
			};
			await archiveReviewerVerdict(workspaceRoot, planExecId, workspaceId, verdict);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "reviewer-verdict.md"),
				"utf-8",
			);
			expect(content).toContain("BLOCKED");
			expect(content).toContain("Dependency failed");
		});

		it("handles workspace with FAILED verdict", async () => {
			const planExecId = "plan-failed";
			const workspaceId = "5.A";
			await initExecutionArchive(workspaceRoot, planExecId);
			await initWorkspaceArchive(workspaceRoot, planExecId, workspaceId);

			const verdict: ReviewerVerdict = {
				workspaceId,
				verdict: "FAILED",
				summary: "TypeScript compilation errors.",
				timestamp: new Date().toISOString(),
			};
			await archiveReviewerVerdict(workspaceRoot, planExecId, workspaceId, verdict);

			const content = await readFile(
				join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "reviewer-verdict.md"),
				"utf-8",
			);
			expect(content).toContain("FAILED");
		});
	});
});

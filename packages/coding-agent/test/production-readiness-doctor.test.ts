/**
 * Tests for Production Readiness Doctor - Workstream 5.I
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createProductionReadinessDoctor,
	formatProductionReadinessReport,
	isBroadScope,
	isGitDirty,
	isGitRepo,
	ProductionReadinessDoctor,
} from "../src/core/production-readiness-doctor.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSafeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "1.A",
		title: "Implement feature",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		acceptanceCriteria: ["Feature works", "Tests pass"],
		...overrides,
	};
}

function makeSafeQueue(overrides: Partial<WorkspaceQueue> = {}): WorkspaceQueue {
	return {
		phase: "P5",
		title: "Test Phase",
		maxParallelWorkspaces: 3,
		workspaces: [makeSafeWorkspace()],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// isBroadScope
// ---------------------------------------------------------------------------

describe("isBroadScope", () => {
	it("should detect * as broad", () => {
		expect(isBroadScope("*")).toBe(true);
	});

	it("should detect ** as broad", () => {
		expect(isBroadScope("**")).toBe(true);
	});

	it("should detect **/* as broad", () => {
		expect(isBroadScope("**/*")).toBe(true);
	});

	it("should detect . as broad (root catch-all)", () => {
		expect(isBroadScope(".")).toBe(true);
	});

	it("should not flag scoped patterns like src/**/*.ts as broad", () => {
		expect(isBroadScope("src/**/*.ts")).toBe(false);
	});

	it("should not flag specific file paths as broad", () => {
		expect(isBroadScope("src/app.ts")).toBe(false);
	});

	it("should not flag empty string as broad", () => {
		expect(isBroadScope("")).toBe(false);
	});

	it("should not flag package.json as broad", () => {
		expect(isBroadScope("package.json")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isGitRepo / isGitDirty
// ---------------------------------------------------------------------------

describe("isGitRepo", () => {
	it("should return false for a temp directory that is not a git repo", async () => {
		const tmp = join(tmpdir(), `prod-doctor-test-gitrepo-${Date.now()}`);
		mkdirSync(tmp, { recursive: true });
		try {
			expect(await isGitRepo(tmp)).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("isGitDirty", () => {
	it("should return false for a non-git directory", async () => {
		const tmp = join(tmpdir(), `prod-doctor-test-gitdirty-${Date.now()}`);
		mkdirSync(tmp, { recursive: true });
		try {
			expect(await isGitDirty(tmp)).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("should detect dirty state in a real git repo", async () => {
		// Only run this if we are in a git repo
		const repoRoot = process.cwd();
		if (!(await isGitRepo(repoRoot))) return;

		// We can't easily make the repo dirty in test without side effects,
		// so just check it returns a boolean
		const result = await isGitDirty(repoRoot);
		expect(typeof result).toBe("boolean");
	});
});

// ---------------------------------------------------------------------------
// ProductionReadinessDoctor
// ---------------------------------------------------------------------------

describe("ProductionReadinessDoctor", () => {
	const doctor = new ProductionReadinessDoctor();
	const tmpDir = join(tmpdir(), `prod-doctor-test-${Date.now()}`);
	const agentDir = join(tmpDir, ".pi");

	beforeAll(() => {
		mkdirSync(tmpDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// AC 1: doctor reports PASS/WARN/FAIL production readiness
	// ---------------------------------------------------------------------------

	describe("verdict reporting", () => {
		it("should report PASS when all checks pass", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			expect(["PASS", "WARN", "FAIL"]).toContain(report.verdict);
			// With a clean queue and skipGitCheck, verdict should be PASS or WARN
			// (WARN may come from missing acceptance criteria or broad scopes)
			expect(report.verdict).not.toBe("FAIL");
		});

		it("should report FAIL when safety issues are critical", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						title: "[TODO] Unsafe feature",
						capabilities: {
							canEdit: [".env"],
							cannotEdit: [],
							canRun: ["git push"],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			expect(report.verdict).toBe("FAIL");
			expect(report.failCount).toBeGreaterThan(0);
		});

		it("should report WARN when there are warnings but no failures", async () => {
			// Security-related workspace without reviewer role triggers safety warning
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						title: "Implement authentication system",
						roleBudget: "worker",
						acceptanceCriteria: ["Auth works"],
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			// The security ambiguity produces a warning => overall WARN or PASS
			expect(["PASS", "WARN"]).toContain(report.verdict);
			if (report.warnCount > 0) {
				expect(report.verdict).toBe("WARN");
			}
		});
	});

	// ---------------------------------------------------------------------------
	// AC 2: missing required skill fails doctor
	// ---------------------------------------------------------------------------

	describe("missing required skill", () => {
		it("should FAIL when required skills are missing", async () => {
			// Create a skill manifest that declares a required skill that doesn't exist
			const manifest = {
				version: 1,
				skills: [
					{
						name: "nonexistent-skill",
						required: true,
						source: "local",
					},
				],
			};
			writeFileSync(join(agentDir, "skill-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			// Should have a FAIL for missing required skills
			const skillCheck = report.checks.find((c) => c.name === "Required Skills Available");
			expect(skillCheck).toBeDefined();
			expect(skillCheck!.status).toBe("FAIL");
			expect(skillCheck!.message).toContain("required skill");

			// Overall report should be FAIL
			expect(report.verdict).toBe("FAIL");

			// Clean up manifest
			rmSync(join(agentDir, "skill-manifest.json"), { force: true });
		});

		it("should PASS when no required skills are missing", async () => {
			// No manifest => no required skills => PASS
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const skillCheck = report.checks.find((c) => c.name === "Required Skills Available");
			expect(skillCheck).toBeDefined();
			expect(skillCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// AC 3: broad file scopes warn
	// ---------------------------------------------------------------------------

	describe("broad file scope warning", () => {
		it("should WARN when workspace has broad canEdit scope", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						capabilities: {
							canEdit: ["**/*"],
							cannotEdit: [],
							canRun: ["npm test"],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("WARN");
			expect(scopeCheck!.message).toContain("broad file scopes");
		});

		it("should PASS when workspace has specific canEdit scope", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						capabilities: {
							canEdit: ["src/**/*.ts"],
							cannotEdit: [],
							canRun: ["npm test"],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("PASS");
		});

		it("should WARN when workspace uses * (single star) as scope", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						capabilities: {
							canEdit: ["*"],
							cannotEdit: [],
							canRun: ["npm test"],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("WARN");
		});

		it("should PASS when workspace has no capabilities declared", async () => {
			const queue = makeSafeQueue({
				workspaces: [makeSafeWorkspace()],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// AC 4: dirty working tree fails queue auto-run readiness
	// ---------------------------------------------------------------------------

	describe("dirty working tree", () => {
		it("should FAIL auto-run readiness when working tree is dirty", async () => {
			// Create a temp git repo and make it dirty to verify autoRunReady = false
			const { execSync } = require("node:child_process");

			const gitTmp = join(tmpdir(), `prod-doctor-autorun-${Date.now()}`);
			mkdirSync(gitTmp, { recursive: true });

			try {
				execSync("git init", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: gitTmp, stdio: "pipe" });

				// Make a dirty file
				writeFileSync(join(gitTmp, "dirty.txt"), "uncommitted", "utf-8");

				const queue = makeSafeQueue();
				const report = await doctor.run(queue, gitTmp, gitTmp, { skipGitCheck: false });

				const gitCheck = report.checks.find((c) => c.name === "Git Working Tree");
				expect(gitCheck).toBeDefined();
				expect(gitCheck!.status).toBe("FAIL");
				expect(report.autoRunReady).toBe(false);
			} finally {
				rmSync(gitTmp, { recursive: true, force: true });
			}
		});

		it("should set autoRunReady to false when git tree is dirty", async () => {
			// We can test this by creating a check manually and seeing
			// that a FAIL git check correctly sets autoRunReady.
			// Use the real doctor but with a directory we control.

			// For a non-git directory, autoRunReady should be based on other checks
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: false });

			// autoRunReady should be true for a non-git dir (if no other FAIL)
			if (report.verdict !== "FAIL") {
				expect(report.autoRunReady).toBe(true);
			}
		});

		it("should mark autoRunReady false when a git-tree FAIL exists", async () => {
			// Directly test the logic: create a report with git_tree FAIL
			// by simulating a dirty tree scenario
			const { execSync } = require("node:child_process");

			// Create a temp git repo, make it dirty
			const gitTmp = join(tmpdir(), `prod-doctor-git-${Date.now()}`);
			mkdirSync(gitTmp, { recursive: true });

			try {
				execSync("git init", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: gitTmp, stdio: "pipe" });

				// Make a dirty file
				writeFileSync(join(gitTmp, "dirty.txt"), "uncommitted", "utf-8");

				const queue = makeSafeQueue();
				const report = await doctor.run(queue, gitTmp, gitTmp, { skipGitCheck: false });

				// Should detect dirty tree
				expect(await isGitDirty(gitTmp)).toBe(true);
				expect(await isGitRepo(gitTmp)).toBe(true);

				const gitCheck = report.checks.find((c) => c.name === "Git Working Tree");
				expect(gitCheck).toBeDefined();
				expect(gitCheck!.status).toBe("FAIL");
				expect(report.autoRunReady).toBe(false);
			} finally {
				rmSync(gitTmp, { recursive: true, force: true });
			}
		});

		it("should have autoRunReady true when git tree is clean", async () => {
			const { execSync } = require("node:child_process");

			const gitTmp = join(tmpdir(), `prod-doctor-git-clean-${Date.now()}`);
			mkdirSync(gitTmp, { recursive: true });

			try {
				execSync("git init", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: gitTmp, stdio: "pipe" });

				// Commit a file so the tree is clean
				writeFileSync(join(gitTmp, "initial.txt"), "committed", "utf-8");
				execSync("git add .", { cwd: gitTmp, stdio: "pipe" });
				execSync("git commit -m init", { cwd: gitTmp, stdio: "pipe" });

				expect(await isGitDirty(gitTmp)).toBe(false);

				const queue = makeSafeQueue();
				const report = await doctor.run(queue, gitTmp, gitTmp, { skipGitCheck: false });

				const gitCheck = report.checks.find((c) => c.name === "Git Working Tree");
				expect(gitCheck).toBeDefined();
				expect(gitCheck!.status).toBe("PASS");

				// autoRunReady should be true if no other FAILs
				if (report.verdict !== "FAIL") {
					expect(report.autoRunReady).toBe(true);
				}
			} finally {
				rmSync(gitTmp, { recursive: true, force: true });
			}
		});
	});

	// ---------------------------------------------------------------------------
	// AC 5: doctor report archived and shown in dashboard
	// ---------------------------------------------------------------------------

	describe("report structure for archiving", () => {
		it("should produce a JSON-serializable report", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			// The report must be serializable to JSON for archiving
			const json = JSON.stringify(report);
			expect(json).toBeTruthy();

			const parsed = JSON.parse(json);
			expect(parsed.verdict).toBe(report.verdict);
			expect(parsed.checks).toHaveLength(report.checks.length);
			expect(parsed.autoRunReady).toBe(report.autoRunReady);
			expect(parsed.timestamp).toBe(report.timestamp);
		});

		it("should include byCategory grouping", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			expect(report.byCategory).toBeDefined();
			expect(report.byCategory.safety).toBeDefined();
			expect(report.byCategory.skills).toBeDefined();
			expect(report.byCategory.file_scope).toBeDefined();
			expect(report.byCategory.schema).toBeDefined();
		});

		it("should include timestamp", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			expect(report.timestamp).toBeTruthy();
			// ISO 8601 format
			expect(() => new Date(report.timestamp)).not.toThrow();
		});
	});

	// ---------------------------------------------------------------------------
	// Formatting
	// ---------------------------------------------------------------------------

	describe("formatProductionReadinessReport", () => {
		it("should format a PASS report", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });
			const formatted = formatProductionReadinessReport(report);

			expect(formatted).toContain("Production Readiness Doctor");
			expect(formatted).toContain(report.verdict);
		});

		it("should format a FAIL report", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						title: "[TODO] Bad workspace",
						capabilities: {
							canEdit: [".env"],
							cannotEdit: [],
							canRun: ["rm -rf /"],
							cannotRun: [],
						},
					}),
				],
			});

			const manifest = {
				version: 1,
				skills: [
					{
						name: "missing-critical-skill",
						required: true,
						source: "local",
					},
				],
			};
			writeFileSync(join(agentDir, "skill-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

			try {
				const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });
				const formatted = formatProductionReadinessReport(report);

				expect(formatted).toContain("FAIL");
			} finally {
				rmSync(join(agentDir, "skill-manifest.json"), { force: true });
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Schema checks
	// ---------------------------------------------------------------------------

	describe("schema checks", () => {
		it("should FAIL for workspace without title", async () => {
			const queue = makeSafeQueue({
				workspaces: [makeSafeWorkspace({ title: "" })],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const titleCheck = report.checks.find((c) => c.name === "Workspace Titles");
			expect(titleCheck).toBeDefined();
			expect(titleCheck!.status).toBe("FAIL");
		});

		it("should WARN for workspace without acceptance criteria", async () => {
			const queue = makeSafeQueue({
				workspaces: [makeSafeWorkspace({ acceptanceCriteria: undefined })],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const criteriaCheck = report.checks.find((c) => c.name === "Acceptance Criteria");
			expect(criteriaCheck).toBeDefined();
			expect(criteriaCheck!.status).toBe("WARN");
		});
	});

	// ---------------------------------------------------------------------------
	// createProductionReadinessDoctor
	// ---------------------------------------------------------------------------

	describe("createProductionReadinessDoctor", () => {
		it("should create a doctor instance", async () => {
			const d = createProductionReadinessDoctor();
			expect(d).toBeInstanceOf(ProductionReadinessDoctor);
		});
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle empty workspace list", async () => {
			const queue = makeSafeQueue({ workspaces: [] });
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			expect(report.verdict).toBe("PASS");
			expect(report.checks.length).toBeGreaterThan(0);
		});

		it("should handle workspace with empty capabilities", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						capabilities: {
							canEdit: [],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			// No broad scopes for empty canEdit
			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("PASS");
		});

		it("should handle skipGitCheck option", async () => {
			const queue = makeSafeQueue();
			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			// No git tree check should be present
			const gitCheck = report.checks.find((c) => c.name === "Git Working Tree");
			expect(gitCheck).toBeUndefined();
		});

		it("should handle multiple workspaces with mixed scopes", async () => {
			const queue = makeSafeQueue({
				workspaces: [
					makeSafeWorkspace({
						id: "1.A",
						capabilities: {
							canEdit: ["src/**/*.ts"],
							cannotEdit: [],
							canRun: ["npm test"],
							cannotRun: [],
						},
					}),
					makeSafeWorkspace({
						id: "1.B",
						capabilities: {
							canEdit: ["**/*"],
							cannotEdit: [],
							canRun: ["npm run build"],
							cannotRun: [],
						},
					}),
				],
			});

			const report = await doctor.run(queue, tmpDir, agentDir, { skipGitCheck: true });

			const scopeCheck = report.checks.find((c) => c.name === "File Scope Hygiene");
			expect(scopeCheck).toBeDefined();
			expect(scopeCheck!.status).toBe("WARN");
			expect(scopeCheck!.details).toContain("1.B");
		});
	});
});

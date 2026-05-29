/**
 * Tests for Local Production Readiness Doctor — Workspace 25.T
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	createLocalProductionReadinessDoctor,
	formatLocalReadinessReport,
	LocalProductionReadinessDoctor,
} from "../src/doctor/local-production-readiness-doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary project directory with optional files for testing.
 */
function createTempProject(files: Record<string, string> = {}): string {
	const tmpDir = join(tmpdir(), `local-readiness-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(tmpDir, { recursive: true });

	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = join(tmpDir, filePath);
		const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
		if (dir && dir !== fullPath) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(fullPath, content, "utf-8");
	}

	return tmpDir;
}

// ---------------------------------------------------------------------------
// LocalProductionReadinessDoctor
// ---------------------------------------------------------------------------

describe("LocalProductionReadinessDoctor", () => {
	const doctor = new LocalProductionReadinessDoctor();
	let tmpDir: string;

	afterAll(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------------------
	// AC 1: doctor reports PASS/WARN/FAIL
	// ---------------------------------------------------------------------------

	describe("verdict reporting", () => {
		it("should produce PASS, WARN, or FAIL verdict", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({
					name: "test-project",
					scripts: {
						test: "vitest run",
						build: "tsc",
					},
				}),
				"node_modules/.package-lock.json": "",
				"tsconfig.json": "{}",
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
			});

			const report = await doctor.run(tmpDir, { skipGitCheck: true, skipDependencyCheck: true });

			expect(["PASS", "WARN", "FAIL"]).toContain(report.verdict);
			expect(report.checks.length).toBeGreaterThan(0);
			expect(report.timestamp).toBeTruthy();
			expect(() => new Date(report.timestamp)).not.toThrow();
		});

		it("should report PASS when all checks pass with good environment", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({
					name: "test-project",
					scripts: {
						test: "vitest run",
						build: "tsc",
						lint: "eslint .",
					},
				}),
				"node_modules/.package-lock.json": "",
				"tsconfig.json": "{}",
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				".env.example": "PORT=3000",
				".eslintrc.json": "{}",
				".prettierrc": "{}",
				"vitest.config.ts": "export default {}",
				// Build output to avoid WARN
				"dist/index.js": "module.exports = {};",
				// CI/CD config to avoid WARN
				".github/workflows/ci.yml": "name: CI",
				// Budget/cooldown/loop-prevention files for brain-worker checks
				"packages/coding-agent/src/brain-workers/runtime/budget-controls.ts":
					"export const budgetLimits = { maxSteps: 10 };",
				"packages/coding-agent/src/brain-workers/runtime/cooldowns.ts":
					"export const cooldownIntervals = { minIntervalMs: 5000 };",
				"packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts":
					"export const loopPrevention = { maxRecursionDepth: 5 };",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			// Environment, build, config, linting, testing, autonomous should pass
			expect(report.verdict).toBe("PASS");
			expect(report.failCount).toBe(0);
		});

		it("should report FAIL when critical environment checks fail", async () => {
			tmpDir = createTempProject({});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			// Should fail because package.json, node_modules, etc. are missing
			expect(report.failCount).toBeGreaterThan(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Environment checks
	// ---------------------------------------------------------------------------

	describe("checkEnvironment", () => {
		it("should check Node.js version", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const checks = doctor.checkEnvironment(tmpDir, []);

			const nodeCheck = checks.find((c) => c.name === "Node.js Version");
			expect(nodeCheck).toBeDefined();
			// Node.js should be available in the test environment
			expect(nodeCheck!.status).toBe("PASS");
		});

		it("should check npm version", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const checks = doctor.checkEnvironment(tmpDir, []);

			const npmCheck = checks.find((c) => c.name === "npm Version");
			expect(npmCheck).toBeDefined();
			// npm should be available
			expect(npmCheck!.status).toBe("PASS");
		});

		it("should PASS TypeScript check when tsconfig.json and typescript installed", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const checks = doctor.checkEnvironment(tmpDir, []);

			const tsCheck = checks.find((c) => c.name === "TypeScript Configuration");
			expect(tsCheck).toBeDefined();
			expect(tsCheck!.status).toBe("PASS");
		});

		it("should FAIL TypeScript check when tsconfig exists but package not installed", async () => {
			tmpDir = createTempProject({
				"tsconfig.json": "{}",
			});

			const checks = doctor.checkEnvironment(tmpDir, []);

			const tsCheck = checks.find((c) => c.name === "TypeScript Configuration");
			expect(tsCheck).toBeDefined();
			expect(tsCheck!.status).toBe("FAIL");
		});
	});

	// ---------------------------------------------------------------------------
	// Git checks
	// ---------------------------------------------------------------------------

	describe("checkGit", () => {
		it("should accept non-git directory", async () => {
			tmpDir = createTempProject();

			const checks = await doctor.checkGit(tmpDir, []);

			const gitCheck = checks.find((c) => c.name === "Git Working Tree");
			expect(gitCheck).toBeDefined();
			// Non-git dir should pass (skipped check)
			expect(gitCheck!.status).toBe("PASS");
		});

		it("should detect git repo and report clean/pass", async () => {
			const { execSync } = await import("node:child_process");

			const gitTmp = createTempProject({
				"initial.txt": "committed content",
			});

			try {
				execSync("git init", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: gitTmp, stdio: "pipe" });
				execSync("git add .", { cwd: gitTmp, stdio: "pipe" });
				execSync("git commit -m init", { cwd: gitTmp, stdio: "pipe" });

				const checks = await doctor.checkGit(gitTmp, []);
				const gitCheck = checks.find((c) => c.name === "Git Working Tree");
				expect(gitCheck).toBeDefined();
				expect(gitCheck!.status).toBe("PASS");
			} finally {
				rmSync(gitTmp, { recursive: true, force: true });
			}
		});

		it("should detect dirty git repo and report FAIL", async () => {
			const { execSync } = await import("node:child_process");

			const gitTmp = createTempProject({
				"initial.txt": "committed content",
			});

			try {
				execSync("git init", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: gitTmp, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: gitTmp, stdio: "pipe" });
				execSync("git add .", { cwd: gitTmp, stdio: "pipe" });
				execSync("git commit -m init", { cwd: gitTmp, stdio: "pipe" });

				// Make it dirty
				writeFileSync(join(gitTmp, "dirty.txt"), "uncommitted", "utf-8");

				const checks = await doctor.checkGit(gitTmp, []);
				const gitCheck = checks.find((c) => c.name === "Git Working Tree");
				expect(gitCheck).toBeDefined();
				expect(gitCheck!.status).toBe("FAIL");
				expect(gitCheck!.resolution).toBeTruthy();
			} finally {
				rmSync(gitTmp, { recursive: true, force: true });
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Build checks
	// ---------------------------------------------------------------------------

	describe("checkBuild", () => {
		it("should report WARN when no build output directories exist", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({
					name: "test-project",
				}),
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkBuild(tmpDir, diagnostics);

			const buildCheck = checks.find((c) => c.name === "Build Outputs");
			expect(buildCheck).toBeDefined();
			expect(buildCheck!.status).toBe("WARN");
		});

		it("should PASS when build output directory exists", async () => {
			tmpDir = createTempProject({
				"dist/index.js": "module.exports = {};",
				"package.json": JSON.stringify({
					name: "test-project",
					scripts: { build: "tsc" },
				}),
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkBuild(tmpDir, diagnostics);

			const buildCheck = checks.find((c) => c.name === "Build Outputs");
			expect(buildCheck).toBeDefined();
			expect(buildCheck!.status).toBe("PASS");
		});

		it("should PASS when build script exists in package.json", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({
					name: "test-project",
					scripts: { build: "tsc" },
				}),
				"dist/index.js": "module.exports = {};",
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkBuild(tmpDir, diagnostics);

			const scriptCheck = checks.find((c) => c.name === "Build Script");
			expect(scriptCheck).toBeDefined();
			expect(scriptCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// Dependency checks
	// ---------------------------------------------------------------------------

	describe("checkDependencies", () => {
		it("should FAIL when node_modules is missing", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({ name: "test-project" }),
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkDependencies(tmpDir, diagnostics);

			const depCheck = checks.find((c) => c.name === "Dependencies Installed");
			expect(depCheck).toBeDefined();
			expect(depCheck!.status).toBe("FAIL");
			expect(depCheck!.resolution).toBeTruthy();
		});

		it("should FAIL when package.json is missing", async () => {
			tmpDir = createTempProject({
				"node_modules/some-pkg/index.js": "module.exports = {};",
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkDependencies(tmpDir, diagnostics);

			const pkgCheck = checks.find((c) => c.name === "Package Configuration");
			expect(pkgCheck).toBeDefined();
			expect(pkgCheck!.status).toBe("FAIL");
		});

		it("should PASS when dependencies are installed with lock file", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({
					name: "test-project",
					dependencies: {},
				}),
				"package-lock.json": JSON.stringify({
					name: "test-project",
					lockfileVersion: 3,
				}),
				"node_modules/.package-lock.json": "",
			});

			const diagnostics: string[] = [];
			const checks = await doctor.checkDependencies(tmpDir, diagnostics);

			const lockCheck = checks.find((c) => c.name === "Lock File");
			expect(lockCheck).toBeDefined();
			expect(lockCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// Config file checks
	// ---------------------------------------------------------------------------

	describe("checkConfigFiles", () => {
		it("should WARN when no CI/CD config exists", () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkConfigFiles(tmpDir, undefined, diagnostics);

			const ciCheck = checks.find((c) => c.name === "CI/CD Configuration");
			expect(ciCheck).toBeDefined();
			expect(ciCheck!.status).toBe("WARN");
		});

		it("should PASS when CI/CD config exists", () => {
			tmpDir = createTempProject({
				".github/workflows/ci.yml": "name: CI",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkConfigFiles(tmpDir, undefined, diagnostics);

			const ciCheck = checks.find((c) => c.name === "CI/CD Configuration");
			expect(ciCheck).toBeDefined();
			expect(ciCheck!.status).toBe("PASS");
		});

		it("should FAIL when extra config paths are missing", () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkConfigFiles(tmpDir, ["config/required.json", ".some-config"], diagnostics);

			const extraCheck = checks.find((c) => c.name === "Required Configuration Files");
			expect(extraCheck).toBeDefined();
			expect(extraCheck!.status).toBe("FAIL");
			expect(extraCheck!.resolution).toBeTruthy();
		});

		it("should PASS when extra config paths exist", () => {
			tmpDir = createTempProject({
				"config/required.json": "{}",
				".some-config": "value",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkConfigFiles(tmpDir, ["config/required.json", ".some-config"], diagnostics);

			const extraCheck = checks.find((c) => c.name === "Required Configuration Files");
			expect(extraCheck).toBeDefined();
			expect(extraCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// Linting checks
	// ---------------------------------------------------------------------------

	describe("checkLinting", () => {
		it("should PASS when ESLint is configured", () => {
			tmpDir = createTempProject({
				".eslintrc.json": "{}",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkLinting(tmpDir, diagnostics);

			const eslintCheck = checks.find((c) => c.name === "ESLint Configuration");
			expect(eslintCheck).toBeDefined();
			expect(eslintCheck!.status).toBe("PASS");
		});

		it("should WARN when no ESLint config exists", () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkLinting(tmpDir, diagnostics);

			const eslintCheck = checks.find((c) => c.name === "ESLint Configuration");
			expect(eslintCheck).toBeDefined();
			expect(eslintCheck!.status).toBe("WARN");
		});

		it("should PASS when Prettier is configured", () => {
			tmpDir = createTempProject({
				".prettierrc": "{}",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkLinting(tmpDir, diagnostics);

			const prettierCheck = checks.find((c) => c.name === "Prettier Configuration");
			expect(prettierCheck).toBeDefined();
			expect(prettierCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// Testing checks
	// ---------------------------------------------------------------------------

	describe("checkTesting", () => {
		it("should PASS when test framework is configured", () => {
			tmpDir = createTempProject({
				"vitest.config.ts": "export default {}",
				"package.json": JSON.stringify({
					name: "test-project",
					scripts: { test: "vitest run" },
					devDependencies: { vitest: "^1.0.0" },
				}),
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkTesting(tmpDir, diagnostics);

			const frameworkCheck = checks.find((c) => c.name === "Test Framework Configuration");
			expect(frameworkCheck).toBeDefined();
			expect(frameworkCheck!.status).toBe("PASS");
		});

		it("should WARN when no test framework is found", () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({ name: "test-project" }),
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkTesting(tmpDir, diagnostics);

			const frameworkCheck = checks.find((c) => c.name === "Test Framework Configuration");
			expect(frameworkCheck).toBeDefined();
			expect(frameworkCheck!.status).toBe("WARN");
		});
	});

	// ---------------------------------------------------------------------------
	// Autonomous behavior checks: budget controls, cooldowns, loop prevention
	// ---------------------------------------------------------------------------

	describe("budget controls", () => {
		it("should FAIL when no budget controls exist", async () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkBudgetControls(tmpDir, diagnostics);

			const budgetCheck = checks.find((c) => c.name === "Budget Controls");
			expect(budgetCheck).toBeDefined();
			expect(budgetCheck!.status).toBe("FAIL");
			expect(budgetCheck!.resolution).toBeTruthy();
		});

		it("should PASS when budget controls exist at expected path", async () => {
			tmpDir = createTempProject({
				"packages/coding-agent/src/brain-workers/runtime/budget-controls.ts":
					"export const budgetLimits = { maxSteps: 10 };",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkBudgetControls(tmpDir, diagnostics);

			const budgetCheck = checks.find((c) => c.name === "Budget Controls");
			expect(budgetCheck).toBeDefined();
			expect(budgetCheck!.status).toBe("PASS");
		});
	});

	describe("cooldowns", () => {
		it("should FAIL when no cooldown configuration exists", async () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkCooldowns(tmpDir, diagnostics);

			const cooldownCheck = checks.find((c) => c.name === "Cooldowns");
			expect(cooldownCheck).toBeDefined();
			expect(cooldownCheck!.status).toBe("FAIL");
			expect(cooldownCheck!.resolution).toBeTruthy();
		});

		it("should PASS when cooldowns exist at expected path", async () => {
			tmpDir = createTempProject({
				"packages/coding-agent/src/brain-workers/runtime/cooldowns.ts":
					"export const cooldownIntervals = { minIntervalMs: 5000 };",
			});

			const diagnostics: string[] = [];
			const checks = doctor.checkCooldowns(tmpDir, diagnostics);

			const cooldownCheck = checks.find((c) => c.name === "Cooldowns");
			expect(cooldownCheck).toBeDefined();
			expect(cooldownCheck!.status).toBe("PASS");
		});
	});

	describe("loop prevention", () => {
		it("should FAIL when no loop prevention exists", async () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkLoopPrevention(tmpDir, diagnostics);

			const loopCheck = checks.find((c) => c.name === "Loop Prevention");
			expect(loopCheck).toBeDefined();
			expect(loopCheck!.status).toBe("FAIL");
			expect(loopCheck!.resolution).toBeTruthy();
		});

		it("should PASS when stop condition handling is verified", async () => {
			tmpDir = createTempProject({});

			const diagnostics: string[] = [];
			const checks = doctor.checkLoopPrevention(tmpDir, diagnostics);

			const stopCheck = checks.find((c) => c.name === "Stop Condition Handling");
			expect(stopCheck).toBeDefined();
			expect(stopCheck!.status).toBe("PASS");
		});
	});

	// ---------------------------------------------------------------------------
	// Report structure
	// ---------------------------------------------------------------------------

	describe("report structure", () => {
		it("should produce JSON-serializable report", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({ name: "test-project" }),
				"node_modules/.package-lock.json": "",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			const json = JSON.stringify(report);
			expect(json).toBeTruthy();

			const parsed = JSON.parse(json);
			expect(parsed.verdict).toBe(report.verdict);
			expect(parsed.checks).toHaveLength(report.checks.length);
			expect(parsed.autoRunReady).toBe(report.autoRunReady);
			expect(parsed.timestamp).toBe(report.timestamp);
		});

		it("should include diagnostics array", async () => {
			tmpDir = createTempProject({});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			expect(report.diagnostics).toBeDefined();
			expect(Array.isArray(report.diagnostics)).toBe(true);
		});

		it("should include byCategory with all expected categories", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			expect(report.byCategory).toBeDefined();
			expect(report.byCategory.environment).toBeDefined();
			expect(report.byCategory.git).toBeDefined();
			expect(report.byCategory.build).toBeDefined();
			expect(report.byCategory.config).toBeDefined();
			expect(report.byCategory.budget).toBeDefined();
			expect(report.byCategory.cooldown).toBeDefined();
			expect(report.byCategory.loop_prevention).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Formatting
	// ---------------------------------------------------------------------------

	describe("formatLocalReadinessReport", () => {
		it("should format a PASS report", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			const formatted = formatLocalReadinessReport(report);
			expect(formatted).toContain("Local Production Readiness Doctor");
			expect(formatted).toContain(report.verdict);
		});

		it("should format a FAIL report", async () => {
			tmpDir = createTempProject({});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			const formatted = formatLocalReadinessReport(report);
			expect(formatted).toContain("FAIL");
			expect(formatted).toContain("RECOMMENDATIONS");
		});
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle skipGitCheck option", async () => {
			tmpDir = createTempProject({
				"package.json": JSON.stringify({ name: "test-project" }),
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			const gitCheck = report.checks.find((c) => c.name === "Git Working Tree");
			expect(gitCheck).toBeDefined();
			expect(gitCheck!.status).toBe("PASS");
		});

		it("should handle skipDependencyCheck option", async () => {
			tmpDir = createTempProject({
				"node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "5.0.0" }),
				"tsconfig.json": "{}",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			const depCheck = report.checks.find((c) => c.name === "Dependencies Installed");
			expect(depCheck).toBeUndefined();
		});

		it("should handle custom config paths", async () => {
			tmpDir = createTempProject({
				"my-config.json": "{}",
			});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
				configPaths: ["my-config.json"],
			});

			const configCheck = report.checks.find((c) => c.name === "Required Configuration Files");
			expect(configCheck).toBeDefined();
			expect(configCheck!.status).toBe("PASS");
		});

		it("should set autoRunReady correctly", async () => {
			tmpDir = createTempProject({});

			const report = await doctor.run(tmpDir, {
				skipGitCheck: true,
				skipDependencyCheck: true,
			});

			// autoRunReady should be false when there are FAILs
			if (report.failCount > 0) {
				expect(report.autoRunReady).toBe(false);
			} else {
				expect(report.autoRunReady).toBe(true);
			}
		});
	});

	// ---------------------------------------------------------------------------
	// createLocalProductionReadinessDoctor
	// ---------------------------------------------------------------------------

	describe("createLocalProductionReadinessDoctor", () => {
		it("should create a doctor instance", () => {
			const d = createLocalProductionReadinessDoctor();
			expect(d).toBeInstanceOf(LocalProductionReadinessDoctor);
		});
	});
});

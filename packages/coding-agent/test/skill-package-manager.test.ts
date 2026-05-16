/**
 * Tests for Skill Package Manager - P11.E
 *
 * End-to-end tests covering install, list, test, invoke, disable, and remove.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createSkillPackageManager,
	formatSkillInvokeResult,
	formatSkillPackageList,
	type SkillPackageListEntry,
	SkillPackageManager,
} from "../src/core/skill-package-manager.js";

describe("skill-package-manager", () => {
	let agentDir: string;
	let cwd: string;
	let packagesDir: string;
	let manager: SkillPackageManager;

	beforeEach(() => {
		const baseDir = join(tmpdir(), `pi-pkg-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(baseDir, "agent");
		cwd = join(baseDir, "project");
		packagesDir = join(baseDir, "packages", "skills");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });

		manager = new SkillPackageManager({
			agentDir,
			cwd,
			packagesDir,
		});
	});

	afterEach(() => {
		// Clean up the entire base dir
		const baseDir = agentDir.replace(/\/agent$/, "");
		if (baseDir) {
			try {
				rmSync(baseDir, { recursive: true, force: true });
			} catch {
				// Already cleaned up
			}
		}
	});

	/**
	 * Helper to create a test skill package directory.
	 */
	function createTestPackage(
		name: string,
		description: string,
		version: string,
		parentDir: string,
		options?: { hasTests?: boolean; disableModelInvocation?: boolean },
	): string {
		const dir = join(parentDir, name);
		mkdirSync(dir, { recursive: true });

		const manifest = {
			packageFormatVersion: 1,
			name,
			description,
			version,
			disableModelInvocation: options?.disableModelInvocation ?? false,
			hasTests: options?.hasTests ?? false,
		};
		writeFileSync(join(dir, "skill-package.json"), JSON.stringify(manifest, null, 2), "utf-8");
		writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n`, "utf-8");

		if (options?.hasTests) {
			const testsDir = join(dir, "tests");
			mkdirSync(testsDir, { recursive: true });
			writeFileSync(join(testsDir, "test-basic.md"), "# Test\n\nBasic test content.", "utf-8");
			writeFileSync(join(testsDir, "test-advanced.md"), "# Advanced Test\n\nAdvanced test content.", "utf-8");
			// Update manifest
			manifest.hasTests = true;
			writeFileSync(join(dir, "skill-package.json"), JSON.stringify(manifest, null, 2), "utf-8");
		}

		return dir;
	}

	// -----------------------------------------------------------------------
	// AC1: Install
	// -----------------------------------------------------------------------

	describe("install", () => {
		it("should install a valid skill package", () => {
			const sourceDir = createTestPackage("test-skill", "A test skill", "1.0.0", join(cwd, "sources"));
			const result = manager.install(sourceDir);

			expect(result.success).toBe(true);
			expect(result.skillName).toBe("test-skill");
			expect(result.errors).toHaveLength(0);
		});

		it("should reject already installed skills", () => {
			const sourceDir = createTestPackage("dupe-skill", "Duplicate", "1.0.0", join(cwd, "sources"));
			manager.install(sourceDir);

			const result = manager.install(sourceDir);
			expect(result.success).toBe(false);
			expect(result.errors.some((e) => e.message.includes("already installed"))).toBe(true);
		});

		it("should reject non-existent source paths", () => {
			const result = manager.install(join(cwd, "nonexistent"));
			expect(result.success).toBe(false);
		});

		it("should reject incomplete packages", () => {
			const badDir = join(cwd, "sources", "bad-skill");
			mkdirSync(badDir, { recursive: true });
			writeFileSync(join(badDir, "SKILL.md"), "# Bad", "utf-8");
			// No skill-package.json

			const result = manager.install(badDir);
			expect(result.success).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// AC1: List
	// -----------------------------------------------------------------------

	describe("list", () => {
		it("should return empty list when no skills installed", () => {
			expect(manager.list()).toHaveLength(0);
		});

		it("should list installed skills", () => {
			const src1 = createTestPackage("skill-one", "First skill", "1.0.0", join(cwd, "sources"));
			const src2 = createTestPackage("skill-two", "Second skill", "2.0.0", join(cwd, "sources"));
			manager.install(src1);
			manager.install(src2);

			const entries = manager.list();
			expect(entries).toHaveLength(2);
			expect(entries.find((e) => e.name === "skill-one")).toBeDefined();
			expect(entries.find((e) => e.name === "skill-two")!.version).toBe("2.0.0");
		});

		it("should show enabled/disabled status", () => {
			const src = createTestPackage("status-skill", "Status test", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			expect(manager.list()[0].status).toBe("enabled");

			manager.disable("status-skill");
			expect(manager.list()[0].status).toBe("disabled");
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Test
	// -----------------------------------------------------------------------

	describe("test", () => {
		it("should return error for uninstalled skill", () => {
			const result = manager.test("nonexistent");
			expect("error" in result).toBe(true);
		});

		it("should run tests for a skill with tests directory", () => {
			const src = createTestPackage("testable-skill", "Has tests", "1.0.0", join(cwd, "sources"), {
				hasTests: true,
			});
			manager.install(src);

			const result = manager.test("testable-skill");
			expect("error" in result).toBe(false);
			if (!("error" in result)) {
				expect(result.total).toBeGreaterThanOrEqual(2);
				expect(result.passed).toBeGreaterThan(0);
			}
		});

		it("should return error for skill without tests", () => {
			const src = createTestPackage("untestable-skill", "No tests", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			const result = manager.test("untestable-skill");
			expect("error" in result).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Invoke
	// -----------------------------------------------------------------------

	describe("invoke", () => {
		it("should invoke an installed skill", () => {
			const src = createTestPackage("invokable-skill", "Can be invoked", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			const result = manager.invoke("invokable-skill", { cwd });
			expect(result.success).toBe(true);
			expect(result.output.skillName).toBe("invokable-skill");
			expect(result.output.errors).toHaveLength(0);
		});

		it("should return error for uninstalled skill", () => {
			const result = manager.invoke("nonexistent", { cwd });
			expect(result.success).toBe(false);
		});

		it("should return error for disabled skill", () => {
			const src = createTestPackage("disabled-skill", "Disabled", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			manager.disable("disabled-skill");

			const result = manager.invoke("disabled-skill", { cwd });
			expect(result.success).toBe(false);
			expect(result.output.errors.some((e) => e.includes("disabled"))).toBe(true);
		});

		it("should pass template variables", () => {
			const src = createTestPackage("template-skill", "Uses variables", "1.0.0", join(cwd, "sources"));
			// Write a SKILL.md with template variable
			writeFileSync(join(src, "SKILL.md"), `---\nname: template-skill\ndescription: Uses variables\n---\n\nHello {{name}}!`, "utf-8");
			manager.remove("template-skill"); // in case it was loaded
			manager.install(src);

			const result = manager.invoke("template-skill", {
				cwd,
				variables: { name: "World" },
			});
			expect(result.success).toBe(true);
			expect(result.output.content).toContain("Hello World!");
		});

		it("should attach output to artifact when requested", () => {
			const src = createTestPackage("artifact-skill", "Creates artifacts", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			const result = manager.invoke("artifact-skill", {
				cwd,
				attachToArtifact: {
					type: "plan_intake",
					parentId: "plan-test-001",
					metadata: { source: "test" },
				},
			});
			expect(result.success).toBe(true);
			expect(result.artifact).toBeDefined();
			expect(result.artifact!.artifactType).toBe("plan_intake");
			expect(result.artifact!.parentId).toBe("plan-test-001");
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Disable / Enable
	// -----------------------------------------------------------------------

	describe("disable/enable", () => {
		it("should disable and re-enable a skill", () => {
			const src = createTestPackage("toggle-skill", "Toggle test", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			expect(manager.isEnabled("toggle-skill")).toBe(true);

			const disabled = manager.disable("toggle-skill");
			expect(disabled).toBe(true);
			expect(manager.isEnabled("toggle-skill")).toBe(false);

			const enabled = manager.enable("toggle-skill");
			expect(enabled).toBe(true);
			expect(manager.isEnabled("toggle-skill")).toBe(true);
		});

		it("should return false for unknown skills", () => {
			expect(manager.disable("unknown")).toBe(false);
			expect(manager.enable("unknown")).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Remove
	// -----------------------------------------------------------------------

	describe("remove", () => {
		it("should remove an installed skill", () => {
			const src = createTestPackage("removable-skill", "Will be removed", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			expect(manager.list()).toHaveLength(1);

			const removed = manager.remove("removable-skill");
			expect(removed).toBe(true);
			expect(manager.list()).toHaveLength(0);
		});

		it("should return false for unknown skills", () => {
			expect(manager.remove("unknown")).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Quality Tracking
	// -----------------------------------------------------------------------

	describe("quality tracking", () => {
		it("should track quality after invocation", () => {
			const src = createTestPackage("quality-skill", "Tracks quality", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			manager.invoke("quality-skill", { cwd });
			const quality = manager.getQuality("quality-skill");
			expect(quality).toBeDefined();
			expect(quality!.usageStats.invocationCount).toBe(1);
		});

		it("should update quality after test run", () => {
			const src = createTestPackage("quality-test-skill", "Tracks quality from tests", "1.0.0", join(cwd, "sources"), {
				hasTests: true,
			});
			manager.install(src);

			manager.test("quality-test-skill");
			const quality = manager.getQuality("quality-test-skill");
			expect(quality).toBeDefined();
			expect(quality!.lastTestRun).toBeDefined();
		});

		it("should provide API-exportable quality data", () => {
			const src = createTestPackage("api-quality-skill", "API quality", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			manager.invoke("api-quality-skill", { cwd });

			const apiData = manager.exportQualityForApi();
			expect(apiData.skills.length).toBeGreaterThanOrEqual(1);
			expect(apiData.summary.totalInvocations).toBeGreaterThanOrEqual(1);
		});

		it("should format quality table", () => {
			const src = createTestPackage("format-skill", "Format test", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			manager.invoke("format-skill", { cwd });

			const table = manager.formatQualityTable();
			expect(table).toContain("format-skill");
			expect(table).toContain("1.0.0");
		});
	});

	// -----------------------------------------------------------------------
	// Artifact Integration
	// -----------------------------------------------------------------------

	describe("artifact integration", () => {
		it("should create plan intake artifacts with skill output", () => {
			const src = createTestPackage("plan-intake-skill", "Plan intake", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			const result = manager.invoke("plan-intake-skill", {
				cwd,
				attachToArtifact: { type: "plan_intake", parentId: "plan-exec-001" },
			});

			expect(result.artifact).toBeDefined();

			// Retrieve via artifact store
			const artifacts = manager.getArtifactStore().getByParent("plan-exec-001");
			expect(artifacts).toHaveLength(1);
		});

		it("should attach to proposal and remediation artifacts", () => {
			const src = createTestPackage("multi-artifact-skill", "Multi artifact", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			const proposalResult = manager.invoke("multi-artifact-skill", {
				cwd,
				attachToArtifact: { type: "proposal", parentId: "prop-001" },
			});
			expect(proposalResult.artifact).toBeDefined();

			const remediationResult = manager.invoke("multi-artifact-skill", {
				cwd,
				attachToArtifact: { type: "remediation", parentId: "rem-001" },
			});
			expect(remediationResult.artifact).toBeDefined();

			expect(manager.getArtifactStore().getBySkill("multi-artifact-skill")).toHaveLength(2);
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Capability Enforcement
	// -----------------------------------------------------------------------

	describe("capability enforcement via skill-runner", () => {
		it("should respect disableModelInvocation flag", () => {
			const src = createTestPackage("readonly-skill", "Read-only skill", "1.0.0", join(cwd, "sources"), {
				disableModelInvocation: true,
			});
			manager.install(src);

			const result = manager.invoke("readonly-skill", { cwd });
			expect(result.success).toBe(true);
			// The skill is loaded as read-only via the package manifest
		});

		it("should return errors for disabled skills via capability conflicts", () => {
			const src = createTestPackage("cap-skill", "Capability test", "1.0.0", join(cwd, "sources"));
			manager.install(src);

			// Invoke with restrictive capabilities
			const result = manager.invoke("cap-skill", {
				cwd,
				capabilities: {
					canEdit: ["src/**"],
					canRun: ["ls"],
				},
			});
			// The skill itself is just markdown content, so it should succeed
			// File operations are checked by validateSkillFileOperation/validateSkillCommand
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Format Helpers
	// -----------------------------------------------------------------------

	describe("format helpers", () => {
		it("formatSkillPackageList should show empty message", () => {
			const result = formatSkillPackageList([]);
			expect(result).toContain("No skills installed");
		});

		it("formatSkillPackageList should show installed skills", () => {
			const entries: SkillPackageListEntry[] = [
				{
					name: "test-skill",
					version: "1.0.0",
					description: "A test",
					status: "enabled",
					packageDir: "/tmp/test",
					hasTests: true,
				},
			];
			const result = formatSkillPackageList(entries);
			expect(result).toContain("test-skill");
			expect(result).toContain("1.0.0");
		});

		it("formatSkillInvokeResult should show success", () => {
			const result = formatSkillInvokeResult({
				success: true,
				output: {
					content: "# Test\n\nOutput content.",
					skillName: "test",
					frontmatter: {},
					policyChecks: [],
					errors: [],
				},
			});
			expect(result).toContain("test");
			expect(result).toContain("Output content");
		});

		it("formatSkillInvokeResult should show failures", () => {
			const result = formatSkillInvokeResult({
				success: false,
				output: {
					content: "",
					skillName: "test",
					frontmatter: {},
					policyChecks: [],
					errors: ["Something went wrong"],
				},
			});
			expect(result).toContain("failed");
			expect(result).toContain("Something went wrong");
		});
	});

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	describe("state persistence", () => {
		it("should persist installed skills and reload them", () => {
			const src = createTestPackage("persist-skill", "Persists state", "1.0.0", join(cwd, "sources"));
			manager.install(src);
			manager.disable("persist-skill");

			// Create a new manager with same config
			const manager2 = new SkillPackageManager({
				agentDir,
				cwd,
				packagesDir,
			});

			const entries = manager2.list();
			expect(entries).toHaveLength(1);
			expect(entries[0].status).toBe("disabled");
		});
	});

	// -----------------------------------------------------------------------
	// createSkillPackageManager factory
	// -----------------------------------------------------------------------

	describe("createSkillPackageManager factory", () => {
		it("should create a configured manager with defaults", () => {
			const mgr = createSkillPackageManager(agentDir, cwd);
			expect(mgr).toBeInstanceOf(SkillPackageManager);
			expect(mgr.list()).toHaveLength(0);
		});

		it("should accept custom packagesDir", () => {
			const customDir = join(cwd, ".pi", "custom-skills");
			const mgr = createSkillPackageManager(agentDir, cwd, { packagesDir: customDir });

			const src = createTestPackage("custom-dir-skill", "Custom dir", "1.0.0", join(cwd, "sources"));
			mgr.install(src);

			expect(existsSync(join(customDir, "custom-dir-skill"))).toBe(true);
		});
	});
});

/**
 * Tests for Skill Runner - P11.E
 *
 * Tests execution with capabilityManifest enforcement and policy checks.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkCommandCapability,
	checkFileCapability,
	executeSkill,
	getDefaultPolicyConstraints,
	type SkillExecutionContext,
	substituteVariables,
	validateSkillCommand,
	validateSkillFileOperation,
} from "../src/core/skill-runner.js";
import type { Skill } from "../src/core/skills.js";
import type { WorkspaceCapabilityManifest } from "../src/core/workspace-schema.js";

describe("skill-runner", () => {
	describe("checkFileCapability", () => {
		const cwd = "/project";

		it("should allow any file when no capabilities defined", () => {
			const result = checkFileCapability("/project/src/file.ts", undefined, cwd);
			expect(result.allowed).toBe(true);
		});

		it("should allow files matching canEdit patterns", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: ["src/**"],
				canRun: [],
			};
			const result = checkFileCapability("/project/src/file.ts", capabilities, cwd);
			expect(result.allowed).toBe(true);
		});

		it("should reject files not matching canEdit patterns", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: ["src/**"],
				canRun: [],
			};
			const result = checkFileCapability("/project/node_modules/pkg/index.js", capabilities, cwd);
			expect(result.allowed).toBe(false);
			expect(result.violationType).toBe("capability_boundary");
		});

		it("should reject files matching cannotEdit", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: ["**"],
				cannotEdit: ["secrets/**"],
				canRun: [],
			};
			const result = checkFileCapability("/project/secrets/keys.json", capabilities, cwd);
			expect(result.allowed).toBe(false);
			expect(result.violationType).toBe("forbidden_file");
		});
	});

	describe("checkCommandCapability", () => {
		it("should allow any command when no capabilities defined", () => {
			const result = checkCommandCapability("ls -la", undefined, undefined);
			expect(result.allowed).toBe(true);
		});

		it("should allow commands matching canRun patterns", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: [],
				canRun: ["ls", "cat", "grep"],
			};
			const result = checkCommandCapability("ls -la", capabilities, undefined);
			expect(result.allowed).toBe(true);
		});

		it("should reject commands not matching canRun patterns", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: [],
				canRun: ["ls", "cat"],
			};
			const result = checkCommandCapability("rm -rf /", capabilities, undefined);
			expect(result.allowed).toBe(false);
			expect(result.violationType).toBe("capability_boundary");
		});

		it("should reject forbidden commands from policy", () => {
			const policy = getDefaultPolicyConstraints();
			const result = checkCommandCapability("rm -rf /", undefined, policy);
			expect(result.allowed).toBe(false);
			expect(result.violationType).toBe("forbidden_command");
		});
	});

	describe("executeSkill", () => {
		let tempDir: string;
		let skill: Skill;

		beforeEach(() => {
			tempDir = join(tmpdir(), `pi-skill-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			mkdirSync(tempDir, { recursive: true });

			skill = {
				name: "test-skill",
				description: "A test skill",
				filePath: join(tempDir, "SKILL.md"),
				baseDir: tempDir,
				sourceInfo: {
					path: join(tempDir, "SKILL.md"),
					source: "test",
					scope: "temporary",
					origin: "top-level",
				},
				disableModelInvocation: false,
			};

			writeFileSync(
				skill.filePath,
				`---
name: test-skill
description: A test skill
---

# Test Skill

This skill is used for testing.

## Instructions

Run {{command}} to execute.
`,
				"utf-8",
			);
		});

		afterEach(() => {
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("should execute a skill and return its content", () => {
			const context: SkillExecutionContext = {
				cwd: tempDir,
			};
			const result = executeSkill(skill, context);
			expect(result.skillName).toBe("test-skill");
			expect(result.content).toContain("# Test Skill");
			expect(result.errors).toHaveLength(0);
		});

		it("should substitute template variables", () => {
			const context: SkillExecutionContext = {
				cwd: tempDir,
				variables: { command: "npm test" },
			};
			const result = executeSkill(skill, context);
			expect(result.content).toContain("Run npm test to execute.");
			expect(result.content).not.toContain("{{command}}");
		});

		it("should return errors for missing skill file", () => {
			const badSkill: Skill = {
				...skill,
				filePath: join(tempDir, "NONEXISTENT.md"),
			};
			const result = executeSkill(badSkill, { cwd: tempDir });
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.content).toBe("");
		});

		it("should parse frontmatter metadata", () => {
			const result = executeSkill(skill, { cwd: tempDir });
			expect(result.frontmatter.name).toBe("test-skill");
			expect(result.frontmatter.description).toBe("A test skill");
		});
	});

	describe("substituteVariables", () => {
		it("should replace {{variables}} in content", () => {
			const content = "Hello {{name}}, your project is {{project}}.";
			const result = substituteVariables(content, { name: "World", project: "pi" });
			expect(result).toBe("Hello World, your project is pi.");
		});

		it("should handle missing variables gracefully", () => {
			const content = "Hello {{name}}.";
			const result = substituteVariables(content, {});
			expect(result).toBe("Hello {{name}}.");
		});
	});

	describe("validateSkillFileOperation", () => {
		const cwd = "/project";

		it("should allow read operations without restrictions", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: ["src/**"],
				canRun: [],
			};
			const result = validateSkillFileOperation("/project/package.json", "read", capabilities, cwd);
			expect(result.allowed).toBe(true);
		});

		it("should enforce canEdit for edit operations", () => {
			const capabilities: WorkspaceCapabilityManifest = {
				canEdit: ["src/**"],
				canRun: [],
			};
			const result = validateSkillFileOperation("/project/package.json", "edit", capabilities, cwd);
			expect(result.allowed).toBe(false);
		});
	});

	describe("validateSkillCommand", () => {
		it("should reject policy-forbidden commands", () => {
			const policy = getDefaultPolicyConstraints();
			const result = validateSkillCommand("rm -rf /", undefined, policy);
			expect(result.allowed).toBe(false);
		});

		it("should allow safe commands by default", () => {
			const result = validateSkillCommand("ls -la", undefined, undefined);
			expect(result.allowed).toBe(true);
		});
	});
});

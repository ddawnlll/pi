/**
 * Tests for Skill Package Format - P11.E
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createSkillPackage,
	loadSkillPackage,
	validateSkillPackageManifest,
	validateSkillPackageStructure,
} from "../src/core/skill-package.js";

describe("skill-package", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-skill-pkg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("validateSkillPackageManifest", () => {
		it("should validate a correct manifest", () => {
			const errors = validateSkillPackageManifest({
				name: "test-skill",
				description: "A test skill",
				version: "1.0.0",
				packageFormatVersion: 1,
			});
			expect(errors).toHaveLength(0);
		});

		it("should require name", () => {
			const errors = validateSkillPackageManifest({
				description: "A test skill",
				version: "1.0.0",
			});
			expect(errors.some((e) => e.field === "name")).toBe(true);
		});

		it("should require description", () => {
			const errors = validateSkillPackageManifest({
				name: "test-skill",
				version: "1.0.0",
			});
			expect(errors.some((e) => e.field === "description")).toBe(true);
		});

		it("should require version", () => {
			const errors = validateSkillPackageManifest({
				name: "test-skill",
				description: "A test skill",
			});
			expect(errors.some((e) => e.field === "version")).toBe(true);
		});

		it("should reject invalid package format version", () => {
			const errors = validateSkillPackageManifest({
				name: "test-skill",
				description: "A test skill",
				version: "1.0.0",
				packageFormatVersion: 2 as unknown as 1,
			});
			expect(errors.some((e) => e.field === "packageFormatVersion")).toBe(true);
		});

		it("should reject invalid name characters", () => {
			const errors = validateSkillPackageManifest({
				name: "Invalid Name!",
				description: "A test skill",
				version: "1.0.0",
			});
			expect(errors.some((e) => e.field === "name")).toBe(true);
		});
	});

	describe("validateSkillPackageStructure", () => {
		it("should validate a valid package structure", () => {
			const pkgDir = createSkillPackage("test-skill", "A test skill", "1.0.0", tempDir);
			const errors = validateSkillPackageStructure(pkgDir);
			expect(errors).toHaveLength(0);
		});

		it("should reject missing directory", () => {
			const errors = validateSkillPackageStructure(join(tempDir, "nonexistent"));
			expect(errors.length).toBeGreaterThan(0);
		});

		it("should reject missing skill-package.json", () => {
			const dir = join(tempDir, "broken-skill");
			mkdirSync(dir, { recursive: true });
			const errors = validateSkillPackageStructure(dir);
			expect(errors.some((e) => e.field === "skill-package.json")).toBe(true);
		});

		it("should reject missing SKILL.md", () => {
			const dir = join(tempDir, "broken-skill");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "skill-package.json"), JSON.stringify({ name: "test" }), "utf-8");
			const errors = validateSkillPackageStructure(dir);
			expect(errors.some((e) => e.field === "SKILL.md")).toBe(true);
		});
	});

	describe("loadSkillPackage", () => {
		it("should load a valid skill package", () => {
			const pkgDir = createSkillPackage("test-skill", "A test skill", "1.0.0", tempDir);
			const { pkg, errors } = loadSkillPackage(pkgDir);
			expect(errors).toHaveLength(0);
			expect(pkg).not.toBeNull();
			expect(pkg!.manifest.name).toBe("test-skill");
			expect(pkg!.manifest.description).toBe("A test skill");
			expect(pkg!.manifest.version).toBe("1.0.0");
			expect(pkg!.skillFile).toBe(join(pkgDir, "SKILL.md"));
		});

		it("should return errors for invalid manifest", () => {
			const dir = join(tempDir, "bad-skill");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "skill-package.json"), JSON.stringify({}), "utf-8");
			writeFileSync(join(dir, "SKILL.md"), "# Bad skill", "utf-8");

			const { pkg, errors } = loadSkillPackage(dir);
			expect(pkg).toBeNull();
			expect(errors.length).toBeGreaterThan(0);
		});

		it("should detect tests directory", () => {
			const pkgDir = createSkillPackage("test-skill", "A test skill", "1.0.0", tempDir);
			const testsDir = join(pkgDir, "tests");
			mkdirSync(testsDir, { recursive: true });
			writeFileSync(join(testsDir, "test1.md"), "# Test", "utf-8");

			// Update manifest to indicate tests exist
			const manifestPath = join(pkgDir, "skill-package.json");
			const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
			manifest.hasTests = true;
			writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

			const { pkg } = loadSkillPackage(pkgDir);
			expect(pkg).not.toBeNull();
			expect(pkg!.testsDir).toBe(testsDir);
		});
	});

	describe("createSkillPackage", () => {
		it("should create a valid skill package", () => {
			const pkgDir = createSkillPackage("my-skill", "My custom skill", "0.1.0", tempDir);
			expect(existsSync(pkgDir)).toBe(true);
			expect(existsSync(join(pkgDir, "skill-package.json"))).toBe(true);
			expect(existsSync(join(pkgDir, "SKILL.md"))).toBe(true);

			// Verify the manifest content
			const manifest = JSON.parse(
				readFileSync(join(pkgDir, "skill-package.json"), "utf-8"),
			);
			expect(manifest.name).toBe("my-skill");
			expect(manifest.description).toBe("My custom skill");
			expect(manifest.version).toBe("0.1.0");
		});
	});
});

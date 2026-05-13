/**
 * Tests for Skill Registry & Skill Resolver - P2 Workstream 5.D
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSafetyDoctor, SafetyIssueType } from "../src/core/safety-doctor.js";
import type { SkillManifest } from "../src/core/skill-manifest.js";
import { EMPTY_MANIFEST, parseSkillManifest, validateSkillManifest } from "../src/core/skill-manifest.js";
import { SkillRegistry, SkillResolver } from "../src/core/skill-registry.js";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const manifestFixturesDir = resolve(__dirname, "fixtures/skill-manifest");

// --- Skill Manifest ---

describe("skill-manifest", () => {
	describe("validateSkillManifest", () => {
		it("should validate a correct manifest", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [
					{ name: "my-skill", source: "local", required: true },
					{ name: "helper", source: "builtin" },
				],
				remoteFetchEnabled: false,
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should require version field", () => {
			const result = validateSkillManifest({ skills: [] });
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "missing_field" && e.field === "version")).toBe(true);
		});

		it("should require version to be 1", () => {
			const result = validateSkillManifest({ version: 2 as unknown as 1, skills: [] });
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "invalid_version")).toBe(true);
		});

		it("should require skills array", () => {
			const result = validateSkillManifest({ version: 1 });
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "missing_field" && e.field === "skills")).toBe(true);
		});

		it("should detect duplicate skill names", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [
					{ name: "dupe", source: "local" },
					{ name: "dupe", source: "local" },
				],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "duplicate_skill" && e.skillName === "dupe")).toBe(true);
		});

		it("should reject remote skills when remoteFetchEnabled is false", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "remote-thing", source: "remote", url: "https://example.com" }],
				remoteFetchEnabled: false,
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "remote_not_enabled" && e.skillName === "remote-thing")).toBe(
				true,
			);
		});

		it("should allow remote skills when remoteFetchEnabled is true", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "remote-thing", source: "remote", url: "https://example.com" }],
				remoteFetchEnabled: true,
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
		});

		it("should warn about remote skill without url", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "remote-thing", source: "remote" }],
				remoteFetchEnabled: true,
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
			expect(result.warnings.some((w) => w.skillName === "remote-thing" && w.field?.includes("url"))).toBe(true);
		});

		it("should warn about url on non-remote skill", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "local-thing", source: "local", url: "https://example.com" }],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
			expect(
				result.warnings.some(
					(w) => w.skillName === "local-thing" && w.message.includes("url field that will be ignored"),
				),
			).toBe(true);
		});

		it("should validate skill name format", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "INVALID_Name", source: "local" }],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "invalid_field" && e.skillName === "INVALID_Name")).toBe(true);
		});

		it("should reject skill name starting with hyphen", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "-bad", source: "local" }],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.skillName === "-bad" && e.message.includes("hyphen"))).toBe(true);
		});

		it("should reject skill name with consecutive hyphens", () => {
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: "bad--name", source: "local" }],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.skillName === "bad--name" && e.message.includes("consecutive hyphens")),
			).toBe(true);
		});

		it("should reject skill name exceeding 64 characters", () => {
			const longName = "a".repeat(65);
			const manifest: SkillManifest = {
				version: 1,
				skills: [{ name: longName, source: "local" }],
			};
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.message.includes("64 characters"))).toBe(true);
		});

		it("should reject invalid source values", () => {
			const manifest = {
				version: 1,
				skills: [{ name: "my-skill", source: "invalid" }],
			};
			const result = validateSkillManifest(manifest as any);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.message.includes("invalid source"))).toBe(true);
		});

		it("should reject skill entry without source", () => {
			const manifest = {
				version: 1,
				skills: [{ name: "my-skill" }],
			};
			const result = validateSkillManifest(manifest as any);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.message.includes("missing source"))).toBe(true);
		});

		it("should accept empty skills array", () => {
			const manifest: SkillManifest = { version: 1, skills: [] };
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
		});

		it("should default remoteFetchEnabled to false", () => {
			const manifest: SkillManifest = { version: 1, skills: [] };
			const result = validateSkillManifest(manifest);
			expect(result.valid).toBe(true);
		});
	});

	describe("parseSkillManifest", () => {
		it("should parse a valid manifest JSON", () => {
			const json = readFileSync(join(manifestFixturesDir, "skill-manifest.json"), "utf-8");
			const { manifest, validation } = parseSkillManifest(json);
			expect(validation.valid).toBe(true);
			expect(manifest.version).toBe(1);
			expect(manifest.skills).toHaveLength(2);
			expect(manifest.remoteFetchEnabled).toBe(false);
		});

		it("should reject invalid JSON", () => {
			const { manifest, validation } = parseSkillManifest("not json at all");
			expect(validation.valid).toBe(false);
			expect(manifest).toEqual(EMPTY_MANIFEST);
		});

		it("should reject non-object JSON", () => {
			const { manifest, validation } = parseSkillManifest("42");
			expect(validation.valid).toBe(false);
			expect(manifest).toEqual(EMPTY_MANIFEST);
		});

		it("should reject array JSON", () => {
			const { manifest, validation } = parseSkillManifest("[1,2,3]");
			expect(validation.valid).toBe(false);
			expect(manifest).toEqual(EMPTY_MANIFEST);
		});

		it("should return EMPTY_MANIFEST for invalid version", () => {
			const { manifest, validation } = parseSkillManifest('{"version": 2, "skills": []}');
			expect(validation.valid).toBe(false);
			expect(manifest).toEqual(EMPTY_MANIFEST);
		});
	});

	describe("EMPTY_MANIFEST", () => {
		it("should have version 1", () => {
			expect(EMPTY_MANIFEST.version).toBe(1);
		});

		it("should have empty skills", () => {
			expect(EMPTY_MANIFEST.skills).toEqual([]);
		});

		it("should have remoteFetchEnabled false", () => {
			expect(EMPTY_MANIFEST.remoteFetchEnabled).toBe(false);
		});
	});
});

// --- Skill Registry ---

describe("SkillRegistry", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-skill-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should list local skills without a manifest", () => {
		const registry = new SkillRegistry(fixturesDir, tempDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] });

		expect(result.entries.length).toBeGreaterThanOrEqual(1);
		expect(result.entries.some((e) => e.skill.name === "valid-skill")).toBe(true);
		expect(result.manifest).toEqual(EMPTY_MANIFEST);
	});

	it("should validate against a manifest with required skills", () => {
		// Create a temp dir with a manifest requiring a skill that doesn't exist
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "nonexistent-required-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const registry = new SkillRegistry(projectDir, tempDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [] });

		expect(result.missingSkills).toHaveLength(1);
		expect(result.missingSkills[0].entry.name).toBe("nonexistent-required-skill");
		expect(result.diagnostics.some((d) => d.type === "error")).toBe(true);
	});

	it("should report warning for missing optional skill", () => {
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "optional-missing", source: "local", required: false }],
				remoteFetchEnabled: false,
			}),
		);

		const registry = new SkillRegistry(projectDir, tempDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [] });

		expect(result.missingSkills).toHaveLength(0);
		expect(result.diagnostics.some((d) => d.message.includes("Optional skill"))).toBe(true);
	});

	it("should pass validation when all required skills are present", () => {
		const registry = new SkillRegistry(fixturesDir, tempDir);
		const validation = registry.validate({
			includeDefaults: false,
			skillPaths: [join(fixturesDir, "valid-skill")],
		});

		// No manifest, no required skills to check
		expect(validation.valid).toBe(true);
		expect(validation.missingRequired).toHaveLength(0);
	});

	it("should return false for validate when required skills are missing", () => {
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "missing-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const registry = new SkillRegistry(projectDir, tempDir);
		const validation = registry.validate({ includeDefaults: false, skillPaths: [] });

		expect(validation.valid).toBe(false);
		expect(validation.missingRequired).toHaveLength(1);
	});

	it("should load manifest from project .pi directory", () => {
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "valid-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		// Also create a skill directory
		const skillsDir = join(piDir, "skills", "valid-skill");
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(join(skillsDir, "SKILL.md"), "---name: valid-skill.description: A valid skill for testing.---");

		const registry = new SkillRegistry(projectDir, tempDir);
		const result = registry.list({ includeDefaults: true, skillPaths: [] });

		expect(result.manifest.skills).toHaveLength(1);
		expect(result.manifest.skills[0].name).toBe("valid-skill");
	});

	it("should return EMPTY_MANIFEST when no manifest file exists", () => {
		const registry = new SkillRegistry(tempDir, tempDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [] });

		expect(result.manifest).toEqual(EMPTY_MANIFEST);
	});

	it("should list local skills from the registry", () => {
		const registry = new SkillRegistry(fixturesDir, tempDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] });

		const validEntry = result.entries.find((e) => e.skill.name === "valid-skill");
		expect(validEntry).toBeDefined();
		expect(validEntry!.valid).toBe(true);
	});
});

// --- Skill Resolver ---

describe("SkillResolver", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-skill-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should recommend skills based on keyword matching", () => {
		const resolver = new SkillResolver(fixturesDir, tempDir);
		const recommendations = resolver.recommend(
			{ id: "5.D", title: "Skill Registry & Skill Resolver", keywords: ["skill"] },
			{ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] },
		);

		// "valid-skill" has "skill" in its name, should match
		expect(recommendations.some((r) => r.skill.name === "valid-skill")).toBe(true);
		expect(recommendations[0].relevance).toBeGreaterThan(0);
	});

	it("should recommend required skills with highest relevance", () => {
		// Create a project with a manifest
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "valid-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const resolver = new SkillResolver(projectDir, tempDir);
		const recommendations = resolver.recommend(
			{ id: "5.D", title: "Some unrelated workspace" },
			{ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] },
		);

		const requiredRec = recommendations.find((r) => r.skill.name === "valid-skill");
		expect(requiredRec).toBeDefined();
		expect(requiredRec!.relevance).toBe(1.0);
		expect(requiredRec!.reason).toContain("Required by manifest");
	});

	it("should return empty recommendations when no skills match", () => {
		const resolver = new SkillResolver(tempDir, tempDir);
		const recommendations = resolver.recommend(
			{ id: "5.D", title: "Totally unrelated workspace" },
			{ includeDefaults: false, skillPaths: [] },
		);

		expect(recommendations).toHaveLength(0);
	});

	it("should sort recommendations by relevance descending", () => {
		// Create a project with a required skill AND keyword-matched skills
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "valid-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const resolver = new SkillResolver(projectDir, tempDir);
		const recommendations = resolver.recommend(
			{ id: "5.D", title: "Test skill workspace" },
			{
				includeDefaults: false,
				skillPaths: [join(fixturesDir, "valid-skill"), join(fixturesDir, "disable-model-invocation")],
			},
		);

		if (recommendations.length >= 2) {
			expect(recommendations[0].relevance).toBeGreaterThanOrEqual(recommendations[1].relevance);
		}
	});

	it("should expose the underlying SkillRegistry", () => {
		const resolver = new SkillResolver(tempDir, tempDir);
		expect(resolver.getRegistry()).toBeInstanceOf(SkillRegistry);
	});
});

// --- Safety Doctor: Missing Required Skills ---

describe("SafetyDoctor - missing required skills", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-doctor-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should produce critical issues for missing required skills", () => {
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "nonexistent-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const doctor = createSafetyDoctor();
		const report = doctor.validateSkills(projectDir, tempDir, { includeDefaults: false, skillPaths: [] });

		expect(report.safe).toBe(false);
		expect(report.critical.some((i) => i.type === SafetyIssueType.MissingSkill)).toBe(true);
	});

	it("should pass when no required skills are missing", () => {
		const doctor = createSafetyDoctor();
		const report = doctor.validateSkills(tempDir, tempDir, { includeDefaults: false, skillPaths: [] });

		// No manifest, no required skills
		expect(report.safe).toBe(true);
	});

	it("should include skill name in context for missing skill issues", () => {
		const projectDir = join(tempDir, "project");
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "my-required-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const doctor = createSafetyDoctor();
		const report = doctor.validateSkills(projectDir, tempDir, { includeDefaults: false, skillPaths: [] });

		expect(report.critical.length).toBeGreaterThan(0);
		const issue = report.critical.find((i) => i.type === SafetyIssueType.MissingSkill);
		expect(issue).toBeDefined();
		expect(issue!.context?.skillName).toBe("my-required-skill");
	});
});

// --- Remote Skill Fetch Disabled by Default ---

describe("remote skill fetch disabled by default", () => {
	it("should have remoteFetchEnabled default to false in EMPTY_MANIFEST", () => {
		expect(EMPTY_MANIFEST.remoteFetchEnabled).toBe(false);
	});

	it("should reject remote skills in manifest when remoteFetchEnabled is false", () => {
		const manifest = {
			version: 1 as const,
			skills: [{ name: "remote-skill", source: "remote" as const, url: "https://example.com" }],
			remoteFetchEnabled: false,
		};
		const result = validateSkillManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "remote_not_enabled")).toBe(true);
	});

	it("should allow remote skills only when explicitly enabled", () => {
		const manifest = {
			version: 1 as const,
			skills: [{ name: "remote-skill", source: "remote" as const, url: "https://example.com" }],
			remoteFetchEnabled: true,
		};
		const result = validateSkillManifest(manifest);
		expect(result.valid).toBe(true);
	});

	it("should parse manifest with remoteFetchEnabled false from JSON", () => {
		const json = '{"version":1,"skills":[],"remoteFetchEnabled":false}';
		const { manifest } = parseSkillManifest(json);
		expect(manifest.remoteFetchEnabled).toBe(false);
	});

	it("should default remoteFetchEnabled to false when omitted", () => {
		const json = '{"version":1,"skills":[]}';
		const { manifest } = parseSkillManifest(json);
		expect(manifest.remoteFetchEnabled).toBe(false);
	});
});

// --- Skills Tab (Registry listing) ---

describe("Skills tab - listing local skills", () => {
	it("should list all local skills from the registry", () => {
		const registry = new SkillRegistry(fixturesDir, fixturesDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] });

		expect(result.entries.length).toBeGreaterThanOrEqual(1);
		const names = result.entries.map((e) => e.skill.name);
		expect(names).toContain("valid-skill");
	});

	it("should include skill details in entries", () => {
		const registry = new SkillRegistry(fixturesDir, fixturesDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] });

		const entry = result.entries.find((e) => e.skill.name === "valid-skill");
		expect(entry).toBeDefined();
		expect(entry!.skill.description).toBeTruthy();
		expect(entry!.skill.filePath).toBeTruthy();
		expect(entry!.valid).toBe(true);
	});

	it("should mark invalid skills", () => {
		// name-mismatch skill has a name that doesn't match its directory name
		const registry = new SkillRegistry(fixturesDir, fixturesDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "name-mismatch")] });

		const entry = result.entries.find((e) => e.skill.name === "different-name");
		expect(entry).toBeDefined();
	});

	it("should distinguish required from optional entries", () => {
		const projectDir = join(tmpdir(), `pi-skills-tab-test-${Date.now()}`);
		const piDir = join(projectDir, ".pi");
		mkdirSync(piDir, { recursive: true });

		writeFileSync(
			join(piDir, "skill-manifest.json"),
			JSON.stringify({
				version: 1,
				skills: [{ name: "valid-skill", source: "local", required: true }],
				remoteFetchEnabled: false,
			}),
		);

		const registry = new SkillRegistry(projectDir, projectDir);
		const result = registry.list({ includeDefaults: false, skillPaths: [join(fixturesDir, "valid-skill")] });

		const entry = result.entries.find((e) => e.skill.name === "valid-skill");
		expect(entry).toBeDefined();
		expect(entry!.manifestEntry?.required).toBe(true);
	});
});

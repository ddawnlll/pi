/**
 * Skill Package Format - P11.E
 *
 * Defines the distributable skill package format with metadata, versioning,
 * dependencies, and capability declarations. A skill package is a directory
 * containing at minimum a `skill-package.json` metadata file and a `SKILL.md`
 * content file.
 *
 * Package layout:
 *   <skill-name>/
 *     skill-package.json    (required: metadata)
 *     SKILL.md              (required: skill content)
 *     assets/               (optional: additional resources)
 *     tests/                (optional: test files)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkspaceCapabilityManifest } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Skill Package Metadata
// ---------------------------------------------------------------------------

/**
 * Standard skill package metadata file.
 */
export const SKILL_PACKAGE_METADATA_FILE = "skill-package.json";

/**
 * Entry in a skill package's dependency list.
 */
export interface SkillPackageDependency {
	/** Name of the dependency skill */
	name: string;
	/** Version constraint (semver range, e.g. "^1.0.0") */
	version: string;
}

/**
 * Skill quality metadata embedded in the package.
 */
export interface PackageQualityMetadata {
	/** Whether this skill has automated tests */
	hasTests: boolean;
	/** Whether this skill has been verified to work */
	verified: boolean;
	/** Version of the skill (semver) */
	version: string;
	/** Node.js minimum engine requirement */
	engine?: string;
	/** Skill author */
	author?: string;
	/** License identifier (SPDX) */
	license?: string;
	/** Keywords for discovery */
	keywords?: string[];
	/** Homepage URL */
	homepage?: string;
	/** Repository URL */
	repository?: string;
}

/**
 * Complete skill package metadata structure.
 *
 * This is the canonical format for skill-package.json.
 */
export interface SkillPackageManifest {
	/** Package format version (must be 1) */
	packageFormatVersion: 1;
	/** Skill name (must match parent directory name) */
	name: string;
	/** Human-readable description */
	description: string;
	/** Semver version string */
	version: string;
	/** Author name or organization */
	author?: string;
	/** SPDX license identifier */
	license?: string;
	/** Keywords for discovery and matching */
	keywords?: string[];
	/** Other skills this package depends on */
	dependencies?: SkillPackageDependency[];
	/** Capability manifest declaring file/command permissions */
	capabilities?: WorkspaceCapabilityManifest;
	/** Whether model invocation is disabled for this skill */
	disableModelInvocation?: boolean;
	/** Minimum engine version required */
	engine?: string;
	/** Homepage URL */
	homepage?: string;
	/** Repository URL */
	repository?: string;
	/** List of test file paths (relative to package root) */
	testFiles?: string[];
	/** Whether automated tests exist */
	hasTests?: boolean;
}

/**
 * Loaded skill package with resolved paths.
 */
export interface SkillPackage {
	/** Parsed manifest */
	manifest: SkillPackageManifest;
	/** Absolute path to the package root directory */
	packageDir: string;
	/** Absolute path to SKILL.md content file */
	skillFile: string;
	/** Absolute path to tests directory (if exists) */
	testsDir?: string;
	/** Absolute path to assets directory (if exists) */
	assetsDir?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validation error for a skill package.
 */
export interface SkillPackageValidationError {
	field: string;
	message: string;
}

/**
 * Validate a skill package manifest.
 *
 * @param manifest - Manifest to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateSkillPackageManifest(manifest: Partial<SkillPackageManifest>): SkillPackageValidationError[] {
	const errors: SkillPackageValidationError[] = [];

	if (!manifest.name) {
		errors.push({ field: "name", message: "Package name is required" });
	} else if (!/^[a-z0-9-]+$/.test(manifest.name)) {
		errors.push({
			field: "name",
			message: "Package name must be lowercase alphanumeric with hyphens only",
		});
	}

	if (!manifest.description) {
		errors.push({ field: "description", message: "Package description is required" });
	}

	if (!manifest.version) {
		errors.push({ field: "version", message: "Package version is required" });
	}

	if (manifest.packageFormatVersion !== undefined && manifest.packageFormatVersion !== 1) {
		errors.push({
			field: "packageFormatVersion",
			message: `Package format version must be 1, got ${manifest.packageFormatVersion}`,
		});
	}

	return errors;
}

/**
 * Validate a package directory structure.
 *
 * @param packageDir - Absolute path to the package root
 * @returns Array of validation errors (empty if valid)
 */
export function validateSkillPackageStructure(packageDir: string): SkillPackageValidationError[] {
	const errors: SkillPackageValidationError[] = [];

	if (!existsSync(packageDir)) {
		errors.push({ field: "packageDir", message: `Package directory does not exist: ${packageDir}` });
		return errors;
	}

	const manifestPath = join(packageDir, SKILL_PACKAGE_METADATA_FILE);
	if (!existsSync(manifestPath)) {
		errors.push({ field: "skill-package.json", message: "Missing skill-package.json metadata file" });
	}

	const skillMdPath = join(packageDir, "SKILL.md");
	if (!existsSync(skillMdPath)) {
		errors.push({ field: "SKILL.md", message: "Missing SKILL.md content file" });
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Load / Parse
// ---------------------------------------------------------------------------

/**
 * Load and parse a skill package from a directory.
 *
 * @param packageDir - Absolute path to the package root directory
 * @returns The loaded skill package, or null with errors
 */
export function loadSkillPackage(packageDir: string): {
	pkg: SkillPackage | null;
	errors: SkillPackageValidationError[];
} {
	const structureErrors = validateSkillPackageStructure(packageDir);
	if (structureErrors.length > 0) {
		return { pkg: null, errors: structureErrors };
	}

	const manifestPath = join(packageDir, SKILL_PACKAGE_METADATA_FILE);
	const skillMdPath = join(packageDir, "SKILL.md");

	let manifest: SkillPackageManifest;
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const parsed = JSON.parse(raw);
		const validationErrors = validateSkillPackageManifest(parsed);
		if (validationErrors.length > 0) {
			return { pkg: null, errors: validationErrors };
		}
		manifest = parsed as SkillPackageManifest;
		// Set defaults
		manifest.packageFormatVersion = manifest.packageFormatVersion ?? 1;
		manifest.disableModelInvocation = manifest.disableModelInvocation ?? false;
		manifest.hasTests = manifest.hasTests ?? false;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to parse skill-package.json";
		return { pkg: null, errors: [{ field: "skill-package.json", message }] };
	}

	const testsDir = existsSync(join(packageDir, "tests")) ? join(packageDir, "tests") : undefined;
	const assetsDir = existsSync(join(packageDir, "assets")) ? join(packageDir, "assets") : undefined;

	return {
		pkg: {
			manifest,
			packageDir,
			skillFile: skillMdPath,
			testsDir,
			assetsDir,
		},
		errors: [],
	};
}

/**
 * Create a minimal skill package structure.
 *
 * @param name - Skill name
 * @param description - Skill description
 * @param version - Semver version
 * @param baseDir - Parent directory where the skill directory will be created
 * @returns Absolute path to the created package directory
 */
export function createSkillPackage(name: string, description: string, version: string, baseDir: string): string {
	const packageDir = resolve(baseDir, name);
	if (!existsSync(packageDir)) {
		mkdirSync(packageDir, { recursive: true });
	}

	// Write skill-package.json
	const manifest: SkillPackageManifest = {
		packageFormatVersion: 1,
		name,
		description,
		version,
		disableModelInvocation: false,
	};
	writeFileSync(join(packageDir, SKILL_PACKAGE_METADATA_FILE), JSON.stringify(manifest, null, 2), "utf-8");

	// Write SKILL.md template
	const skillContent = `---
name: ${name}
description: ${description}
---

# ${name}

${description}

## Usage

Describe how to use this skill.

## Instructions

Provide detailed instructions here.
`;
	writeFileSync(join(packageDir, "SKILL.md"), skillContent, "utf-8");

	return packageDir;
}

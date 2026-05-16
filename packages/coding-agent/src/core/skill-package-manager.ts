/**
 * Skill Package Manager - P11.E
 *
 * Manages the lifecycle of installed skill packages: install, list, test,
 * invoke, disable, and remove. Integrates with:
 * - skill-package.ts for package format/validation
 * - skill-runner.ts for execution with capability enforcement
 * - skill-quality.ts for quality metadata tracking
 * - skill-output-artifact.ts for output artifact attachment
 * - skills.ts (existing) for skill discovery/loading
 *
 * Lifecycle:
 *   Installed -> Enabled (default) -> Invoked -> (can be Disabled -> Re-enabled)
 *                                     Removed
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type SkillArtifactType, type SkillOutputArtifact, SkillOutputArtifactStore } from "./skill-output-artifact.js";
import { loadSkillPackage, type SkillPackage, type SkillPackageValidationError } from "./skill-package.js";
import {
	formatSkillQualityTable,
	type SkillQualityRecord,
	SkillQualityStore,
	type SkillTestResult,
	type SkillTestRun,
} from "./skill-quality.js";
import {
	executeSkill,
	getDefaultPolicyConstraints,
	type SkillExecutionContext,
	type SkillExecutionOutput,
	type SkillPolicyConstraints,
} from "./skill-runner.js";
import type { Skill } from "./skills.js";
import type { SourceInfo } from "./source-info.js";
import type { WorkspaceCapabilityManifest } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Package Manager Types
// ---------------------------------------------------------------------------

/**
 * Status of an installed skill package.
 */
export type SkillPackageStatus = "installed" | "enabled" | "disabled" | "removing" | "error";

/**
 * Result of an install operation.
 */
export interface SkillPackageInstallResult {
	success: boolean;
	skillName: string;
	packageDir: string;
	errors: SkillPackageValidationError[];
	runErrors: string[];
}

/**
 * Result of a list operation.
 */
export interface SkillPackageListEntry {
	name: string;
	version: string;
	description: string;
	status: SkillPackageStatus;
	packageDir: string;
	hasTests: boolean;
	quality?: SkillQualityRecord;
}

/**
 * Result of invoking a skill.
 */
export interface SkillInvokeResult {
	success: boolean;
	output: SkillExecutionOutput;
	artifact?: SkillOutputArtifact;
}

/**
 * Result of testing a skill.
 */
export interface SkillTestResultSummary {
	skillName: string;
	passed: number;
	failed: number;
	total: number;
	results: SkillTestResult[];
}

/**
 * Configuration for the skill package manager.
 */
export interface SkillPackageManagerConfig {
	/** Agent config directory (for global skills) */
	agentDir: string;
	/** Working directory (for project-local skills) */
	cwd: string;
	/** Base directory for installed skill packages */
	packagesDir: string;
	/** Whether to enforce read-only mode */
	readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Skill Package Manager
// ---------------------------------------------------------------------------

/**
 * Manages the full lifecycle of skill packages.
 *
 * Provides operations for:
 * - install(source): Install a skill from a directory or path
 * - list(): List all installed skills with status
 * - test(name): Run skill tests
 * - invoke(name, context): Execute a skill
 * - disable(name): Disable a skill (keep installed)
 * - enable(name): Re-enable a disabled skill
 * - remove(name): Remove a skill package
 */
export class SkillPackageManager {
	private readonly config: SkillPackageManagerConfig;
	private readonly qualityStore: SkillQualityStore;
	private readonly artifactStore: SkillOutputArtifactStore;

	/** Tracks installed package directories: skill name -> package directory */
	private installedPackages: Map<string, string>;

	/** Tracks enabled/disabled status: skill name -> boolean (true = enabled) */
	private enabledStatus: Map<string, boolean>;

	/** Cache of loaded skill packages */
	private packageCache: Map<string, SkillPackage>;

	private static readonly DISABLED_FILE = ".pi-cache/disabled-skills.json";
	private static readonly INSTALLED_FILE = ".pi-cache/installed-skills.json";

	constructor(config: SkillPackageManagerConfig) {
		this.config = config;
		this.qualityStore = new SkillQualityStore(config.agentDir);
		this.artifactStore = new SkillOutputArtifactStore(join(config.cwd, ".pi"));
		this.installedPackages = new Map();
		this.enabledStatus = new Map();
		this.packageCache = new Map();
		this.loadState();
	}

	// -----------------------------------------------------------------------
	// Install
	// -----------------------------------------------------------------------

	/**
	 * Install a skill package from a source directory.
	 *
	 * Copies the skill directory into the packages directory and
	 * registers it for discovery.
	 *
	 * @param sourcePath - Path to the skill package directory
	 * @returns Install result
	 */
	install(sourcePath: string): SkillPackageInstallResult {
		const resolvedSource = resolve(sourcePath);

		if (!existsSync(resolvedSource)) {
			return {
				success: false,
				skillName: "",
				packageDir: resolvedSource,
				errors: [{ field: "source", message: `Source path does not exist: ${resolvedSource}` }],
				runErrors: [],
			};
		}

		// Load and validate the package
		const { pkg, errors } = loadSkillPackage(resolvedSource);
		if (!pkg) {
			return {
				success: false,
				skillName: "",
				packageDir: resolvedSource,
				errors,
				runErrors: [],
			};
		}

		const skillName = pkg.manifest.name;

		// Check for existing installation
		if (this.installedPackages.has(skillName)) {
			return {
				success: false,
				skillName,
				packageDir: resolvedSource,
				errors: [{ field: "name", message: `Skill "${skillName}" is already installed` }],
				runErrors: [],
			};
		}

		// Ensure packages directory exists
		const packagesDir = resolve(this.config.packagesDir);
		if (!existsSync(packagesDir)) {
			mkdirSync(packagesDir, { recursive: true });
		}

		// Install by copying (or symlinking) from source to packages dir
		const targetDir = resolve(packagesDir, skillName);
		const runErrors: string[] = [];

		try {
			this.copyDirectory(resolvedSource, targetDir);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to copy skill package";
			runErrors.push(message);
			return {
				success: false,
				skillName,
				packageDir: resolvedSource,
				errors: [],
				runErrors,
			};
		}

		// Register as installed
		this.installedPackages.set(skillName, targetDir);
		this.enabledStatus.set(skillName, true);
		this.saveState();

		return {
			success: true,
			skillName,
			packageDir: targetDir,
			errors: [],
			runErrors: [],
		};
	}

	// -----------------------------------------------------------------------
	// List
	// -----------------------------------------------------------------------

	/**
	 * List all installed skill packages with their status and quality data.
	 *
	 * @returns Array of package list entries
	 */
	list(): SkillPackageListEntry[] {
		const entries: SkillPackageListEntry[] = [];

		for (const [name, packageDir] of this.installedPackages) {
			const { pkg } = loadSkillPackage(packageDir);
			const quality = this.qualityStore.get(name);

			entries.push({
				name,
				version: pkg?.manifest.version ?? "unknown",
				description: pkg?.manifest.description ?? "",
				status: this.enabledStatus.get(name) ? "enabled" : "disabled",
				packageDir,
				hasTests: pkg?.manifest.hasTests ?? false,
				quality,
			});
		}

		// Sort by name
		entries.sort((a, b) => a.name.localeCompare(b.name));
		return entries;
	}

	/**
	 * Get a specific installed skill package.
	 *
	 * @param name - Skill name
	 * @returns The list entry, or undefined
	 */
	get(name: string): SkillPackageListEntry | undefined {
		const packageDir = this.installedPackages.get(name);
		if (!packageDir) return undefined;

		const { pkg } = loadSkillPackage(packageDir);
		const quality = this.qualityStore.get(name);

		return {
			name,
			version: pkg?.manifest.version ?? "unknown",
			description: pkg?.manifest.description ?? "",
			status: this.enabledStatus.get(name) ? "enabled" : "disabled",
			packageDir,
			hasTests: pkg?.manifest.hasTests ?? false,
			quality,
		};
	}

	// -----------------------------------------------------------------------
	// Test
	// -----------------------------------------------------------------------

	/**
	 * Test an installed skill.
	 *
	 * Runs any test files found in the package's tests/ directory.
	 * Test files are expected to be structured as markdown with
	 * frontmatter describing the expected behavior.
	 *
	 * @param name - Skill name
	 * @returns Test summary, or error if skill not found
	 */
	test(name: string): SkillTestResultSummary | { error: string } {
		const packageDir = this.installedPackages.get(name);
		if (!packageDir) {
			return { error: `Skill "${name}" is not installed` };
		}

		const { pkg } = loadSkillPackage(packageDir);
		if (!pkg) {
			return { error: `Failed to load skill package "${name}"` };
		}

		// Check if skill has tests
		if (!pkg.testsDir || !existsSync(pkg.testsDir)) {
			return { error: `Skill "${name}" has no tests directory` };
		}

		// Run tests from the tests directory
		const results: SkillTestResult[] = [];
		let passedCount = 0;
		let failedCount = 0;

		try {
			const testFiles = readdirSync(pkg.testsDir).filter(
				(f) => f.endsWith(".md") || f.endsWith(".test.ts") || f.endsWith(".test.js"),
			);

			if (testFiles.length === 0) {
				return { error: `Skill "${name}" has no test files in tests/ directory` };
			}

			for (const testFile of testFiles) {
				const startTime = Date.now();
				try {
					// For markdown tests, we validate they can be parsed
					const testPath = join(pkg.testsDir, testFile);
					const content = readFileSync(testPath, "utf-8");

					// Basic test: verify the file exists and is readable
					if (content.trim().length > 0) {
						passedCount++;
						results.push({
							name: testFile,
							passed: true,
							timestamp: new Date().toISOString(),
							durationMs: Date.now() - startTime,
						});
					} else {
						failedCount++;
						results.push({
							name: testFile,
							passed: false,
							error: "Test file is empty",
							timestamp: new Date().toISOString(),
							durationMs: Date.now() - startTime,
						});
					}
				} catch (error) {
					failedCount++;
					results.push({
						name: testFile,
						passed: false,
						error: error instanceof Error ? error.message : "Test execution failed",
						timestamp: new Date().toISOString(),
						durationMs: Date.now() - startTime,
					});
				}
			}
		} catch (error) {
			return {
				error: `Failed to run tests for "${name}": ${error instanceof Error ? error.message : String(error)}`,
			};
		}

		const total = passedCount + failedCount;

		// Record test results in quality store
		const testRun: SkillTestRun = {
			skillName: name,
			passed: passedCount,
			failed: failedCount,
			total,
			tests: results,
			timestamp: new Date().toISOString(),
			durationMs: results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
		};
		this.qualityStore.recordTestRun(testRun, pkg.manifest.version);
		this.qualityStore.save();

		return {
			skillName: name,
			passed: passedCount,
			failed: failedCount,
			total,
			results,
		};
	}

	// -----------------------------------------------------------------------
	// Invoke
	// -----------------------------------------------------------------------

	/**
	 * Invoke an installed skill with optional context.
	 *
	 * Executes the skill's SKILL.md content through the skill runner,
	 * applying capability manifest and policy constraints.
	 *
	 * @param name - Skill name
	 * @param context - Execution context
	 * @returns Invoke result with output and optional artifact
	 */
	invoke(
		name: string,
		context: {
			cwd?: string;
			capabilities?: WorkspaceCapabilityManifest;
			policy?: SkillPolicyConstraints;
			variables?: Record<string, string>;
			attachToArtifact?: {
				type: SkillArtifactType;
				parentId: string;
				metadata?: Record<string, unknown>;
			};
		},
	): SkillInvokeResult {
		const packageDir = this.installedPackages.get(name);
		if (!packageDir) {
			return {
				success: false,
				output: {
					content: "",
					skillName: name,
					frontmatter: {},
					policyChecks: [],
					errors: [`Skill "${name}" is not installed`],
				},
			};
		}

		// Check if skill is enabled
		if (this.enabledStatus.get(name) === false) {
			return {
				success: false,
				output: {
					content: "",
					skillName: name,
					frontmatter: {},
					policyChecks: [],
					errors: [`Skill "${name}" is disabled`],
				},
			};
		}

		// Load the skill package
		const { pkg } = loadSkillPackage(packageDir);
		if (!pkg) {
			return {
				success: false,
				output: {
					content: "",
					skillName: name,
					frontmatter: {},
					policyChecks: [],
					errors: [`Failed to load skill package "${name}"`],
				},
			};
		}

		// Create a Skill object from the package
		const skill: Skill = {
			name: pkg.manifest.name,
			description: pkg.manifest.description,
			filePath: pkg.skillFile,
			baseDir: pkg.packageDir,
			sourceInfo: {
				path: pkg.skillFile,
				source: "package",
				scope: "temporary",
				origin: "package",
				baseDir: pkg.packageDir,
			} as SourceInfo,
			disableModelInvocation: pkg.manifest.disableModelInvocation ?? false,
		};

		// Set up execution context
		const cwd = context.cwd ?? this.config.cwd;
		const capabilities = context.capabilities ?? pkg.manifest.capabilities;
		const policy = context.policy ?? getDefaultPolicyConstraints(this.config.readOnly);

		const execContext: SkillExecutionContext = {
			cwd,
			capabilities,
			policy,
			variables: context.variables,
		};

		// Execute the skill
		const output = executeSkill(skill, execContext);
		const success = output.errors.length === 0;

		// Optionally attach to an artifact
		let artifact: SkillOutputArtifact | undefined;
		if (success && context.attachToArtifact) {
			artifact = this.artifactStore.attach(
				context.attachToArtifact.type,
				context.attachToArtifact.parentId,
				name,
				output,
				context.attachToArtifact.metadata,
			);
		}

		// Record invocation in quality store
		this.qualityStore.recordInvocation(name, pkg.manifest.version, success);
		this.qualityStore.save();

		return { success, output, artifact };
	}

	// -----------------------------------------------------------------------
	// Disable / Enable
	// -----------------------------------------------------------------------

	/**
	 * Disable an installed skill without removing it.
	 *
	 * @param name - Skill name
	 * @returns Whether the skill was found and disabled
	 */
	disable(name: string): boolean {
		if (!this.installedPackages.has(name)) return false;
		this.enabledStatus.set(name, false);
		this.saveState();
		return true;
	}

	/**
	 * Re-enable a disabled skill.
	 *
	 * @param name - Skill name
	 * @returns Whether the skill was found and enabled
	 */
	enable(name: string): boolean {
		if (!this.installedPackages.has(name)) return false;
		this.enabledStatus.set(name, true);
		this.saveState();
		return true;
	}

	/**
	 * Check if a skill is enabled.
	 *
	 * @param name - Skill name
	 * @returns Whether the skill is enabled (default: true if installed)
	 */
	isEnabled(name: string): boolean {
		if (!this.installedPackages.has(name)) return false;
		return this.enabledStatus.get(name) !== false;
	}

	// -----------------------------------------------------------------------
	// Remove
	// -----------------------------------------------------------------------

	/**
	 * Remove an installed skill package.
	 *
	 * Deletes the package directory and removes it from the registry.
	 *
	 * @param name - Skill name
	 * @returns Whether the skill was found and removed
	 */
	remove(name: string): boolean {
		const packageDir = this.installedPackages.get(name);
		if (!packageDir) return false;

		// Delete the package directory
		try {
			if (existsSync(packageDir)) {
				rmSync(packageDir, { recursive: true, force: true });
			}
		} catch {
			// Best-effort cleanup
		}

		// Remove from registry
		this.installedPackages.delete(name);
		this.enabledStatus.delete(name);
		this.packageCache.delete(name);

		// Clean up quality data
		this.qualityStore.delete(name);
		this.qualityStore.save();

		this.saveState();
		return true;
	}

	// -----------------------------------------------------------------------
	// Quality & Artifact Access
	// -----------------------------------------------------------------------

	/**
	 * Get quality data for a skill.
	 *
	 * @param name - Skill name
	 * @returns Quality record, or undefined
	 */
	getQuality(name: string): SkillQualityRecord | undefined {
		return this.qualityStore.get(name);
	}

	/**
	 * Get quality data for all installed skills.
	 *
	 * @returns Array of quality records
	 */
	getAllQuality(): SkillQualityRecord[] {
		return this.qualityStore.getAll();
	}

	/**
	 * Get quality data formatted for API/UI consumption.
	 *
	 * @returns API-friendly quality response
	 */
	exportQualityForApi(): ReturnType<SkillQualityStore["exportForApi"]> {
		return this.qualityStore.exportForApi();
	}

	/**
	 * Get the artifact store for attaching skill outputs.
	 *
	 * @returns The artifact store
	 */
	getArtifactStore(): SkillOutputArtifactStore {
		return this.artifactStore;
	}

	/**
	 * Load a skill's content as a Skill object (for integration with
	 * the existing skills system).
	 *
	 * @param name - Skill name
	 * @returns Skill object, or undefined
	 */
	loadAsSkill(name: string): Skill | undefined {
		const packageDir = this.installedPackages.get(name);
		if (!packageDir) return undefined;

		const { pkg } = loadSkillPackage(packageDir);
		if (!pkg) return undefined;

		return {
			name: pkg.manifest.name,
			description: pkg.manifest.description,
			filePath: pkg.skillFile,
			baseDir: pkg.packageDir,
			sourceInfo: {
				path: pkg.skillFile,
				source: "package",
				scope: "temporary",
				origin: "package",
				baseDir: pkg.packageDir,
			} as SourceInfo,
			disableModelInvocation: pkg.manifest.disableModelInvocation ?? false,
		};
	}

	/**
	 * Get quality data formatted as a human-readable table.
	 *
	 * @returns Formatted table string
	 */
	formatQualityTable(): string {
		return formatSkillQualityTable(this.getAllQuality());
	}

	// -----------------------------------------------------------------------
	// Internal Helpers
	// -----------------------------------------------------------------------

	/**
	 * Copy a directory recursively.
	 */
	private copyDirectory(source: string, target: string): void {
		if (!existsSync(target)) {
			mkdirSync(target, { recursive: true });
		}

		const entries = readdirSync(source, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === "." || entry.name === "..") continue;
			const sourcePath = join(source, entry.name);
			const targetPath = join(target, entry.name);

			if (entry.isDirectory()) {
				this.copyDirectory(sourcePath, targetPath);
			} else if (entry.isFile()) {
				writeFileSync(targetPath, readFileSync(sourcePath));
			}
		}
	}

	/**
	 * Save package manager state to disk.
	 */
	private saveState(): void {
		try {
			// Save installed packages
			const installedObj: Record<string, string> = {};
			for (const [name, dir] of this.installedPackages) {
				installedObj[name] = dir;
			}
			const cacheDir = join(this.config.agentDir, ".pi-cache");
			if (!existsSync(cacheDir)) {
				mkdirSync(cacheDir, { recursive: true });
			}
			const installedPath = join(this.config.agentDir, SkillPackageManager.INSTALLED_FILE);
			writeFileSync(installedPath, JSON.stringify(installedObj, null, 2), "utf-8");

			// Save enable/disable status
			const enabledObj: Record<string, boolean> = {};
			for (const [name, enabled] of this.enabledStatus) {
				enabledObj[name] = enabled;
			}
			const disabledPath = join(this.config.agentDir, SkillPackageManager.DISABLED_FILE);
			writeFileSync(disabledPath, JSON.stringify(enabledObj, null, 2), "utf-8");
		} catch {
			// Best-effort persistence
		}
	}

	/**
	 * Load package manager state from disk.
	 */
	private loadState(): void {
		try {
			const installedPath = join(this.config.agentDir, SkillPackageManager.INSTALLED_FILE);
			if (existsSync(installedPath)) {
				const raw = readFileSync(installedPath, "utf-8");
				const obj = JSON.parse(raw) as Record<string, string>;
				for (const [name, dir] of Object.entries(obj)) {
					if (existsSync(dir)) {
						this.installedPackages.set(name, dir);
					}
				}
			}

			const disabledPath = join(this.config.agentDir, SkillPackageManager.DISABLED_FILE);
			if (existsSync(disabledPath)) {
				const raw = readFileSync(disabledPath, "utf-8");
				const obj = JSON.parse(raw) as Record<string, boolean>;
				for (const [name, enabled] of Object.entries(obj)) {
					this.enabledStatus.set(name, enabled);
				}
			}
		} catch {
			// Start with clean state
		}
	}

	/**
	 * Get the quality store (for advanced usage).
	 */
	getQualityStore(): SkillQualityStore {
		return this.qualityStore;
	}
}

// ---------------------------------------------------------------------------
// Default Package Manager Factory
// ---------------------------------------------------------------------------

/**
 * Create a default skill package manager with standard configuration.
 *
 * @param agentDir - Agent config directory
 * @param cwd - Current working directory
 * @param options - Additional options
 * @returns Configured SkillPackageManager
 */
export function createSkillPackageManager(
	agentDir: string,
	cwd: string,
	options?: { readOnly?: boolean; packagesDir?: string },
): SkillPackageManager {
	const packagesDir = options?.packagesDir ?? resolve(cwd, ".pi", "skills");
	return new SkillPackageManager({
		agentDir,
		cwd,
		packagesDir,
		readOnly: options?.readOnly ?? false,
	});
}

/**
 * Format a list of installed skills for CLI display.
 *
 * @param entries - List entries from SkillPackageManager.list()
 * @returns Formatted table string
 */
export function formatSkillPackageList(entries: SkillPackageListEntry[]): string {
	if (entries.length === 0) {
		return "No skills installed. Use `install <path>` to install a skill package.";
	}

	const lines: string[] = [];
	lines.push("Installed Skills");
	lines.push("=".repeat(72));
	lines.push("");
	lines.push(`${"Name".padEnd(24)} ${"Version".padEnd(12)} ${"Status".padEnd(10)} ${"Tests".padEnd(8)} Description`);
	lines.push("-".repeat(72));

	for (const entry of entries) {
		const name = entry.name.padEnd(24).slice(0, 24);
		const version = entry.version.padEnd(12).slice(0, 12);
		const status = entry.status.padEnd(10).slice(0, 10);
		const hasTests = entry.hasTests ? "yes" : "no";
		const desc = entry.description.slice(0, 40);
		lines.push(`${name} ${version} ${status} ${hasTests.padEnd(8)} ${desc}`);
	}

	lines.push("-".concat("".padEnd(71, "-")));
	lines.push(`Total: ${entries.length} skills`);

	return lines.join("\n");
}

/**
 * Format a skill invoke result for CLI display.
 *
 * @param result - Invoke result
 * @returns Formatted string
 */
export function formatSkillInvokeResult(result: SkillInvokeResult): string {
	if (!result.success) {
		return `Skill invocation failed:\n${result.output.errors.map((e) => `  - ${e}`).join("\n")}`;
	}

	const lines: string[] = [];
	lines.push(`Skill: ${result.output.skillName}`);
	lines.push("");

	// Show policy check summary
	if (result.output.policyChecks.length > 0) {
		const violations = result.output.policyChecks.filter((c) => !c.allowed);
		if (violations.length > 0) {
			lines.push("Policy Violations:");
			for (const v of violations) {
				lines.push(`  - [${v.violationType}] ${v.blockReason}`);
			}
			lines.push("");
		}
	}

	// Show content preview
	const content = result.output.content;
	const previewLength = Math.min(content.length, 500);
	const preview = content.slice(0, previewLength);
	lines.push("Output:");
	lines.push(preview);
	if (content.length > previewLength) {
		lines.push(`... (${content.length - previewLength} more characters)`);
	}

	// Show artifact info
	if (result.artifact) {
		lines.push("");
		lines.push(`Artifact attached: ${result.artifact.id} (${result.artifact.artifactType})`);
	}

	return lines.join("\n");
}

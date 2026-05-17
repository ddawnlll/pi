/**
 * Project Stack Validator
 *
 * Detects the actual tool stack of a project (package manager, test runner,
 * build system) and validates plan targetCommand entries against it.
 *
 * Every plan upload runs through this validator to catch mismatches like
 * using `pnpm` commands in a project that uses `npm` workspaces.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supported package managers.
 */
export type PackageManager = "npm" | "pnpm" | "yarn";

/**
 * Detected project tool stack.
 */
export interface ProjectStack {
	/** Package manager detected */
	packageManager: PackageManager;
	/** Whether the project uses npm workspaces */
	npmWorkspaces: boolean;
	/** Whether the project uses pnpm workspaces */
	pnpmWorkspaces: boolean;
	/** Whether the project uses yarn workspaces */
	yarnWorkspaces: boolean;
	/** Whether the project uses turborepo */
	usesTurborepo: boolean;
	/** Test runner detected (from devDependencies or scripts) */
	testRunner: string | null;
	/** Build tool detected */
	buildTool: string | null;
	/** Available npm scripts */
	scripts: Record<string, string>;
}

/**
 * Result of validating a targetCommand against a project stack.
 */
export interface TargetCommandValidation {
	/** Whether the command is valid for this project */
	valid: boolean;
	/** The command as-is */
	command: string;
	/** Human-readable explanation of the issue, if invalid */
	message?: string;
	/** Suggested fix, if invalid */
	suggestion?: string;
}

/**
 * Result of validating all targetCommands in a plan.
 */
export interface PlanStackValidation {
	/** Overall validation result */
	valid: boolean;
	/** Per-workspace validation results */
	workspaceResults: Record<string, TargetCommandValidation>;
	/** Global diagnostics */
	diagnostics: {
		severity: "error" | "warning" | "info";
		message: string;
	}[];
	/** Detected project stack */
	detectedStack: ProjectStack;
}

// ---------------------------------------------------------------------------
// Known patterns for command analysis
// ---------------------------------------------------------------------------

const PNPM_FILTER_PATTERN = /--filter\s+\S+/;
const PNPM_RECURSIVE_PATTERN = /pnpm\s+(test|run|exec|build|add|remove|update)/;
const NPM_WORKSPACE_PATTERN = /--workspace\s+\S+|--workspaces\b/;
const YARN_WORKSPACE_PATTERN = /yarn\s+(workspace|workspaces)\s/;

/**
 * Map of package manager to its unique command prefixes.
 */
const PACKAGE_MANAGER_COMMANDS: Record<PackageManager, RegExp> = {
	npm: /^npm\s/,
	pnpm: /^pnpm\s/,
	yarn: /^yarn\s/,
};

// ---------------------------------------------------------------------------
// Stack Detection
// ---------------------------------------------------------------------------

/**
 * Detect the project tool stack from the workspace root.
 *
 * Reads package.json, lockfiles, and other config files to determine
 * what tools the project actually uses.
 *
 * @param workspaceRoot - Absolute path to the project root
 * @returns Detected project stack
 */
export async function detectProjectStack(workspaceRoot: string): Promise<ProjectStack> {
	const stack: ProjectStack = {
		packageManager: "npm",
		npmWorkspaces: false,
		pnpmWorkspaces: false,
		yarnWorkspaces: false,
		usesTurborepo: false,
		testRunner: null,
		buildTool: null,
		scripts: {},
	};

	try {
		// Read package.json
		const pkgPath = join(workspaceRoot, "package.json");
		if (!existsSync(pkgPath)) {
			return stack;
		}

		const pkgRaw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(pkgRaw);

		// Detect package manager from packageManager field or lockfiles
		if (typeof pkg.packageManager === "string") {
			const pm = pkg.packageManager.split("@")[0]?.toLowerCase();
			if (pm === "pnpm") {
				stack.packageManager = "pnpm";
			} else if (pm === "yarn") {
				stack.packageManager = "yarn";
			}
		} else if (existsSync(join(workspaceRoot, "pnpm-lock.yaml"))) {
			stack.packageManager = "pnpm";
		} else if (existsSync(join(workspaceRoot, "yarn.lock"))) {
			stack.packageManager = "yarn";
		}
		// Default is npm (package-lock.json or no lockfile)

		// Detect workspaces
		if (Array.isArray(pkg.workspaces)) {
			if (stack.packageManager === "pnpm") {
				stack.pnpmWorkspaces = true;
			} else if (stack.packageManager === "yarn") {
				stack.yarnWorkspaces = true;
			} else {
				stack.npmWorkspaces = true;
			}
		}

		// Also check for pnpm-workspace.yaml
		if (existsSync(join(workspaceRoot, "pnpm-workspace.yaml"))) {
			stack.pnpmWorkspaces = true;
			if (stack.packageManager === "npm") {
				stack.packageManager = "pnpm";
			}
		}

		// Detect turborepo
		if (existsSync(join(workspaceRoot, "turbo.json"))) {
			stack.usesTurborepo = true;
		}

		// Detect test runner from devDependencies
		const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
		if (deps.vitest) {
			stack.testRunner = "vitest";
		} else if (deps.jest) {
			stack.testRunner = "jest";
		} else if (deps.mocha) {
			stack.testRunner = "mocha";
		} else if (deps.ava) {
			stack.testRunner = "ava";
		}

		// Detect build tool
		if (deps.vite) {
			stack.buildTool = "vite";
		} else if (deps.esbuild) {
			stack.buildTool = "esbuild";
		} else if (deps.typescript) {
			stack.buildTool = "tsc";
		} else if (deps.webpack) {
			stack.buildTool = "webpack";
		}

		// Capture scripts
		if (pkg.scripts && typeof pkg.scripts === "object") {
			stack.scripts = { ...pkg.scripts };
		}
	} catch {
		// Non-fatal — return defaults
	}

	return stack;
}

// ---------------------------------------------------------------------------
// Command Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single targetCommand against the detected project stack.
 *
 * Checks for:
 * - Package manager mismatch (e.g., pnpm command in npm project)
 * - Filter flag mismatch (e.g., --filter in npm project)
 * - Workspace flag mismatch (e.g., --workspace in pnpm project)
 *
 * @param command - The targetCommand string
 * @param stack - Detected project stack
 * @returns Validation result
 */
export function validateTargetCommand(
	command: string,
	stack: ProjectStack,
): TargetCommandValidation {
	const trimmed = command.trim();

	if (!trimmed) {
		return { valid: true, command: trimmed };
	}

	// Check for package manager prefix mismatch
	for (const [pm, pattern] of Object.entries(PACKAGE_MANAGER_COMMANDS)) {
		if (pattern.test(trimmed)) {
			if (pm !== stack.packageManager) {
				const suggestion = trimmed.replace(pattern, `${stack.packageManager} `);
				return {
					valid: false,
					command: trimmed,
					message: `Command uses "${pm}" but project uses "${stack.packageManager}"`,
					suggestion: `Replace with: ${suggestion}`,
				};
			}
		}
	}

	// Check for --filter flag (pnpm-specific) in non-pnpm projects
	if (PNPM_FILTER_PATTERN.test(trimmed) && stack.packageManager !== "pnpm") {
		const filterMatch = trimmed.match(PNPM_FILTER_PATTERN);
		const filterValue = filterMatch ? filterMatch[0].replace("--filter", "").trim() : "";
		return {
			valid: false,
			command: trimmed,
			message: `Command uses "--filter" which is pnpm-specific, but project uses "${stack.packageManager}"`,
			suggestion: stack.npmWorkspaces
				? `Replace with: cd packages/${filterValue} && ${trimmed.replace(PNPM_FILTER_PATTERN, "").trim()}`
				: `Remove --filter flag or switch to ${stack.packageManager} workspaces syntax`,
		};
	}

	// Warn about npm --workspace / --workspaces in pnpm projects
	if (NPM_WORKSPACE_PATTERN.test(trimmed) && stack.packageManager === "pnpm") {
		return {
			valid: true,
			command: trimmed,
			message: `Command uses npm workspace syntax but project uses pnpm. Consider using --filter instead.`,
		};
	}

	return { valid: true, command: trimmed };
}

/**
 * Validate all targetCommands in a plan against the project stack.
 *
 * @param workspaceRoot - Absolute path to the project root
 * @param workspaces - Array of workspace objects with targetCommand fields
 * @returns Plan stack validation result
 */
export async function validatePlanTargetCommands(
	workspaceRoot: string,
	workspaces: Array<{ id: string; targetCommand?: string }>,
): Promise<PlanStackValidation> {
	const stack = await detectProjectStack(workspaceRoot);
	const diagnostics: PlanStackValidation["diagnostics"] = [];
	const workspaceResults: Record<string, TargetCommandValidation> = {};

	diagnostics.push({
		severity: "info",
		message: `Detected package manager: ${stack.packageManager}`,
	});

	if (stack.npmWorkspaces) {
		diagnostics.push({ severity: "info", message: "Detected npm workspaces" });
	}
	if (stack.pnpmWorkspaces) {
		diagnostics.push({ severity: "info", message: "Detected pnpm workspaces" });
	}
	if (stack.testRunner) {
		diagnostics.push({ severity: "info", message: `Detected test runner: ${stack.testRunner}` });
	}

	let allValid = true;

	for (const ws of workspaces) {
		if (!ws.targetCommand) {
			workspaceResults[ws.id] = { valid: true, command: "" };
			continue;
		}

		const result = validateTargetCommand(ws.targetCommand, stack);
		workspaceResults[ws.id] = result;

		if (!result.valid) {
			allValid = false;
			diagnostics.push({
				severity: "error",
				message: `Workspace ${ws.id}: ${result.message}. ${result.suggestion ? `Suggestion: ${result.suggestion}` : ""}`,
			});
		}
	}

	return {
		valid: allValid,
		workspaceResults,
		diagnostics,
		detectedStack: stack,
	};
}

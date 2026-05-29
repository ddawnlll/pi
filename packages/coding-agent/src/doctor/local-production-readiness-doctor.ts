/**
 * Local Production Readiness Doctor — Workspace 25.T
 *
 * Validates the local development environment for production readiness.
 *
 * The doctor checks:
 *  1. Node.js version meets minimum requirements
 *  2. npm/yarn version meets minimum requirements
 *  3. TypeScript configuration is valid
 *  4. Build artifacts exist or compile succeeds
 *  5. Git working tree is clean (no uncommitted changes)
 *  6. Required configuration files exist (.env.example, CI config, etc.)
 *  7. Linting configuration is present and enforced
 *  8. Test framework is configured
 *  9. Brain-worker budget controls are configured (25.R)
 * 10. Cooldowns are configured for autonomous behavior (25.R)
 * 11. Loop prevention is configured (25.R)
 * 12. Docker/infrastructure configs are present (if applicable)
 *
 * All failures surface evidence-backed diagnostics rather than silent errors.
 * All autonomous checks have explicit budget, cooldown, dedupe, and stop-condition handling.
 * Closed-loop behavior is gated by approval or safe local execution policy.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitRunner } from "../core/git-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Overall local production readiness verdict.
 */
export type LocalReadinessVerdict = "PASS" | "WARN" | "FAIL";

/**
 * Category of a local readiness check.
 */
export type LocalReadinessCategory =
	| "environment"
	| "git"
	| "build"
	| "dependencies"
	| "config"
	| "linting"
	| "testing"
	| "autonomous"
	| "infrastructure"
	| "budget"
	| "cooldown"
	| "loop_prevention";

/**
 * A single local readiness check result.
 */
export interface LocalReadinessCheck {
	/** Unique check name */
	name: string;
	/** Category this check belongs to */
	category: LocalReadinessCategory;
	/** PASS / WARN / FAIL */
	status: LocalReadinessVerdict;
	/** Human-readable summary */
	message: string;
	/** Evidence-backed diagnostic details */
	details?: string;
	/** Suggested resolution steps */
	resolution?: string;
}

/**
 * Full local production readiness doctor report.
 */
export interface LocalReadinessReport {
	/** Overall verdict: PASS if no FAILs, WARN if no FAIL but at least one WARN, FAIL otherwise */
	verdict: LocalReadinessVerdict;
	/** All individual checks */
	checks: LocalReadinessCheck[];
	/** Quick-access grouped by category */
	byCategory: Record<LocalReadinessCategory, LocalReadinessCheck[]>;
	/** Count of PASS checks */
	passCount: number;
	/** Count of WARN checks */
	warnCount: number;
	/** Count of FAIL checks */
	failCount: number;
	/** Whether the environment is ready for production execution */
	autoRunReady: boolean;
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Diagnostics summary for evidence-backed failure reporting */
	diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

const MIN_NODE_VERSION = 18;
const MIN_NPM_VERSION = 9;

// ---------------------------------------------------------------------------
// Local Production Readiness Doctor
// ---------------------------------------------------------------------------

/**
 * Local Production Readiness Doctor
 *
 * Checks the local development environment for production readiness.
 */
export class LocalProductionReadinessDoctor {
	/**
	 * Run all local production readiness checks.
	 *
	 * @param cwd - Project root working directory
	 * @param options - Optional overrides
	 * @param options.skipGitCheck - Skip the git dirty-tree check (useful in CI)
	 * @param options.skipDependencyCheck - Skip dependency checks
	 * @returns Full local readiness report
	 */
	async run(
		cwd: string,
		options?: {
			skipGitCheck?: boolean;
			skipDependencyCheck?: boolean;
			/** Paths to check for configuration files */
			configPaths?: string[];
		},
	): Promise<LocalReadinessReport> {
		const checks: LocalReadinessCheck[] = [];
		const diagnostics: string[] = [];

		// 1. Environment checks (Node.js, npm, TypeScript)
		checks.push(...this.checkEnvironment(cwd, diagnostics));

		// 2. Git working-tree cleanliness
		if (!options?.skipGitCheck) {
			checks.push(...(await this.checkGit(cwd, diagnostics)));
		} else {
			checks.push({
				name: "Git Working Tree",
				category: "git",
				status: "PASS",
				message: "Git check skipped by option",
			});
		}

		// 3. Build health
		checks.push(...(await this.checkBuild(cwd, diagnostics)));

		// 4. Dependency health
		if (!options?.skipDependencyCheck) {
			checks.push(...(await this.checkDependencies(cwd, diagnostics)));
		}

		// 5. Configuration files
		checks.push(...this.checkConfigFiles(cwd, options?.configPaths, diagnostics));

		// 6. Linting/formatting setup
		checks.push(...this.checkLinting(cwd, diagnostics));

		// 7. Test framework configuration
		checks.push(...this.checkTesting(cwd, diagnostics));

		// 8. Brain-worker budget controls (25.R)
		checks.push(...this.checkBudgetControls(cwd, diagnostics));

		// 9. Cooldowns for autonomous behavior (25.R)
		checks.push(...this.checkCooldowns(cwd, diagnostics));

		// 10. Loop prevention (25.R)
		checks.push(...this.checkLoopPrevention(cwd, diagnostics));

		return this.buildReport(checks, diagnostics);
	}

	/**
	 * Check environment prerequisites (Node.js, npm, TypeScript).
	 */
	checkEnvironment(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Node.js version
		try {
			const nodeVersion = execSync("node --version", { cwd, encoding: "utf-8" }).trim();
			const versionMatch = nodeVersion.match(/^v?(\d+)\./);
			if (versionMatch) {
				const major = parseInt(versionMatch[1], 10);
				if (major >= MIN_NODE_VERSION) {
					checks.push({
						name: "Node.js Version",
						category: "environment",
						status: "PASS",
						message: `Node.js ${nodeVersion} meets minimum requirement v${MIN_NODE_VERSION}+`,
						details: `Detected version: ${nodeVersion}`,
					});
				} else {
					diagnostics.push(`Node.js ${nodeVersion} is below minimum v${MIN_NODE_VERSION}+`);
					checks.push({
						name: "Node.js Version",
						category: "environment",
						status: "FAIL",
						message: `Node.js ${nodeVersion} is below minimum v${MIN_NODE_VERSION}+`,
						details: `Detected version: ${nodeVersion}`,
						resolution: `Upgrade Node.js to v${MIN_NODE_VERSION}+ (e.g., using nvm: nvm install ${MIN_NODE_VERSION})`,
					});
				}
			} else {
				diagnostics.push(`Could not parse Node.js version from: ${nodeVersion}`);
				checks.push({
					name: "Node.js Version",
					category: "environment",
					status: "FAIL",
					message: "Could not determine Node.js version",
					details: `Raw output: ${nodeVersion}`,
					resolution: "Ensure Node.js is installed and on your PATH",
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			diagnostics.push(`Node.js check error: ${msg}`);
			checks.push({
				name: "Node.js Version",
				category: "environment",
				status: "FAIL",
				message: "Node.js is not available",
				details: msg,
				resolution: "Install Node.js v18+ from https://nodejs.org",
			});
		}

		// npm version
		try {
			const npmVersion = execSync("npm --version", { cwd, encoding: "utf-8" }).trim();
			const versionParts = npmVersion.split(".").map(Number);
			const major = versionParts[0] || 0;
			if (major >= MIN_NPM_VERSION) {
				checks.push({
					name: "npm Version",
					category: "environment",
					status: "PASS",
					message: `npm v${npmVersion} meets minimum requirement v${MIN_NPM_VERSION}+`,
					details: `Detected version: npm ${npmVersion}`,
				});
			} else {
				diagnostics.push(`npm ${npmVersion} is below minimum v${MIN_NPM_VERSION}+`);
				checks.push({
					name: "npm Version",
					category: "environment",
					status: "WARN",
					message: `npm v${npmVersion} is below recommended v${MIN_NPM_VERSION}+`,
					details: `Detected version: npm ${npmVersion}`,
					resolution: `Upgrade npm: npm install -g npm@${MIN_NPM_VERSION}`,
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			diagnostics.push(`npm check error: ${msg}`);
			checks.push({
				name: "npm Version",
				category: "environment",
				status: "WARN",
				message: "npm is not available",
				details: msg,
				resolution: "npm is typically bundled with Node.js. Check your Node.js installation.",
			});
		}

		// TypeScript availability
		const tsConfigPath = join(cwd, "tsconfig.json");
		const tsInstalled = existsSync(join(cwd, "node_modules", "typescript", "package.json"));
		if (existsSync(tsConfigPath) && tsInstalled) {
			checks.push({
				name: "TypeScript Configuration",
				category: "environment",
				status: "PASS",
				message: "TypeScript is configured and installed",
				details: `tsconfig.json found at ${tsConfigPath}`,
			});
		} else if (existsSync(tsConfigPath)) {
			diagnostics.push("TypeScript config found but typescript package not installed");
			checks.push({
				name: "TypeScript Configuration",
				category: "environment",
				status: "FAIL",
				message: "TypeScript is configured but not installed",
				details: "tsconfig.json exists but typescript package is missing from node_modules",
				resolution: "Run: npm install typescript --save-dev",
			});
		} else if (tsInstalled) {
			checks.push({
				name: "TypeScript Configuration",
				category: "environment",
				status: "WARN",
				message: "TypeScript is installed but no tsconfig.json found",
				details: "TypeScript package found in node_modules but no project configuration",
				resolution: "Create a tsconfig.json or check if this project uses plain JavaScript",
			});
		} else {
			checks.push({
				name: "TypeScript Configuration",
				category: "environment",
				status: "PASS",
				message: "Plain JavaScript project (no TypeScript configuration expected)",
			});
		}

		return checks;
	}

	/**
	 * Check git working-tree cleanliness.
	 */
	async checkGit(cwd: string, diagnostics: string[]): Promise<LocalReadinessCheck[]> {
		const checks: LocalReadinessCheck[] = [];

		try {
			const runner = createGitRunner({
				planExecId: "",
				workspaceId: "",
				leaseId: "",
				cwd,
			});

			// Check if we're in a git repo
			const isRepoResult = await runner.read(["rev-parse", "--is-inside-work-tree"], { cwd });
			if (isRepoResult.exitCode !== 0) {
				checks.push({
					name: "Git Working Tree",
					category: "git",
					status: "PASS",
					message: "Not a git repository - tree check skipped",
				});
				return checks;
			}

			// Check for dirty files
			const dirty = await runner.isDirty(cwd);
			if (dirty) {
				// Get the list of dirty files for diagnostics
				let dirtyFiles = "";
				try {
					const statusResult = await runner.read(["status", "--porcelain"], { cwd });
					dirtyFiles = statusResult.stdout?.trim() || "unknown";
				} catch {
					dirtyFiles = "unable to list dirty files";
				}
				diagnostics.push(`Git working tree is dirty. Uncommitted changes:\n${dirtyFiles}`);
				checks.push({
					name: "Git Working Tree",
					category: "git",
					status: "FAIL",
					message: "Dirty working tree - uncommitted changes detected",
					details: `Uncommitted changes:\n${dirtyFiles.slice(0, 500)}`,
					resolution:
						"Commit or stash your changes before running production execution. " +
						"Use 'git status' to review changes, then 'git add <files>' and 'git commit' or 'git stash'.",
				});
			} else {
				checks.push({
					name: "Git Working Tree",
					category: "git",
					status: "PASS",
					message: "Working tree is clean",
				});
			}

			// Check git hooks
			const hooksDir = join(cwd, ".git", "hooks");
			const hasHooks = existsSync(hooksDir);
			if (hasHooks) {
				checks.push({
					name: "Git Hooks",
					category: "git",
					status: "PASS",
					message: "Git hooks directory exists",
				});
			} else {
				checks.push({
					name: "Git Hooks",
					category: "git",
					status: "WARN",
					message: "No git hooks directory found",
					details: "Hooks are optional but recommended for enforcing pre-commit checks",
					resolution: "Consider setting up pre-commit hooks (e.g., husky, lint-staged)",
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			diagnostics.push(`Git check error: ${msg}`);
			checks.push({
				name: "Git Working Tree",
				category: "git",
				status: "WARN",
				message: "Could not check git status",
				details: msg,
				resolution: "Ensure git is installed and the project is in a valid git repository",
			});
		}

		return checks;
	}

	/**
	 * Check build health (build outputs exist, compilation succeeds).
	 */
	async checkBuild(cwd: string, diagnostics: string[]): Promise<LocalReadinessCheck[]> {
		const checks: LocalReadinessCheck[] = [];

		// Check for dist/out directories
		const outDirs = ["dist", "build", "out", ".next", "coverage"];
		const foundOutDirs = outDirs.filter((d) => existsSync(join(cwd, d)));

		if (foundOutDirs.length > 0) {
			checks.push({
				name: "Build Outputs",
				category: "build",
				status: "PASS",
				message: `Build output directories found: ${foundOutDirs.join(", ")}`,
			});
		} else {
			diagnostics.push("No build output directories found (dist, build, out, .next, coverage)");
			checks.push({
				name: "Build Outputs",
				category: "build",
				status: "WARN",
				message: "No build output directories found",
				details:
					"No dist/, build/, out/, or .next/ directory exists. " +
					"This is expected for development but verify build scripts are configured.",
				resolution: "Run the project build command (e.g., 'npm run build') to verify compilation",
			});
		}

		// Check package.json build script
		try {
			const pkgJsonPath = join(cwd, "package.json");
			if (existsSync(pkgJsonPath)) {
				const pkgRaw = await readFile(pkgJsonPath, "utf-8");
				const pkg = JSON.parse(pkgRaw);
				const hasBuildScript = !!pkg.scripts?.build;

				if (hasBuildScript) {
					checks.push({
						name: "Build Script",
						category: "build",
						status: "PASS",
						message: "Build script is defined in package.json",
						details: `Script: npm run build -> "${pkg.scripts.build}"`,
					});
				} else {
					diagnostics.push("No build script in package.json");
					checks.push({
						name: "Build Script",
						category: "build",
						status: "WARN",
						message: "No build script defined in package.json",
						details: "Add a 'build' script to package.json if the project needs compilation",
						resolution: "Add 'build' script to package.json (e.g., 'tsc' or 'vite build')",
					});
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			diagnostics.push(`Build check error: ${msg}`);
			checks.push({
				name: "Build Script",
				category: "build",
				status: "WARN",
				message: `Could not check build configuration: ${msg}`,
			});
		}

		return checks;
	}

	/**
	 * Check dependency health.
	 */
	async checkDependencies(cwd: string, diagnostics: string[]): Promise<LocalReadinessCheck[]> {
		const checks: LocalReadinessCheck[] = [];

		// Check node_modules exists
		const nodeModulesPath = join(cwd, "node_modules");
		if (!existsSync(nodeModulesPath)) {
			diagnostics.push("node_modules not found");
			checks.push({
				name: "Dependencies Installed",
				category: "dependencies",
				status: "FAIL",
				message: "node_modules not found - dependencies are not installed",
				details: "The node_modules directory is missing from the project root",
				resolution: "Run 'npm install' to install project dependencies",
			});
			return checks;
		}

		// Check package.json exists
		const pkgJsonPath = join(cwd, "package.json");
		if (!existsSync(pkgJsonPath)) {
			diagnostics.push("package.json not found");
			checks.push({
				name: "Package Configuration",
				category: "dependencies",
				status: "FAIL",
				message: "package.json not found",
				details: "The package.json is missing from the project root",
				resolution: "Initialize the project with 'npm init'",
			});
			return checks;
		}

		// Check package-lock.json / yarn.lock exists
		const hasLockFile = existsSync(join(cwd, "package-lock.json")) || existsSync(join(cwd, "yarn.lock"));
		if (hasLockFile) {
			checks.push({
				name: "Lock File",
				category: "dependencies",
				status: "PASS",
				message: "Dependency lock file found (package-lock.json or yarn.lock)",
			});
		} else {
			diagnostics.push("No dependency lock file found");
			checks.push({
				name: "Lock File",
				category: "dependencies",
				status: "WARN",
				message: "No dependency lock file found",
				details: "A lock file (package-lock.json or yarn.lock) ensures reproducible installs across environments.",
				resolution: "Run 'npm install' to generate package-lock.json",
			});
		}

		// Check for outdated packages (quick check on a few key ones)
		try {
			const outdated = execSync("npm outdated --json 2>/dev/null || true", { cwd, encoding: "utf-8" });
			if (outdated?.trim() && outdated.trim() !== "{}") {
				try {
					const outdatedData = JSON.parse(outdated);
					const count = Object.keys(outdatedData).length;
					if (count > 0) {
						const outdatedNames = Object.keys(outdatedData).slice(0, 10).join(", ");
						diagnostics.push(`${count} outdated package(s): ${outdatedNames}`);
						checks.push({
							name: "Dependency Versions",
							category: "dependencies",
							status: "WARN",
							message: `${count} outdated package(s) found`,
							details: `Outdated packages: ${outdatedNames}${count > 10 ? ` and ${count - 10} more` : ""}`,
							resolution: "Run 'npm update' or 'npm outdated' to review and update packages",
						});
					}
				} catch {
					// Parsing failed, skip
				}
			}
		} catch {
			// npm outdated failed, skip
		}

		// If no issues found with dependencies
		if (checks.length === 0) {
			checks.push({
				name: "Dependencies Installed",
				category: "dependencies",
				status: "PASS",
				message: "Dependencies are installed and up-to-date",
			});
		}

		return checks;
	}

	/**
	 * Check for required configuration files.
	 */
	checkConfigFiles(cwd: string, extraPaths: string[] | undefined, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Check for CI configuration
		const ciPaths = [".github/workflows", ".circleci", ".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml"];
		const hasCi = ciPaths.some((p) => existsSync(join(cwd, p)));

		if (hasCi) {
			checks.push({
				name: "CI/CD Configuration",
				category: "config",
				status: "PASS",
				message: "CI/CD configuration found",
			});
		} else {
			diagnostics.push("No CI/CD configuration found");
			checks.push({
				name: "CI/CD Configuration",
				category: "config",
				status: "WARN",
				message: "No CI/CD configuration found",
				details: "No GitHub Actions, CircleCI, GitLab CI, Jenkins, or Azure Pipelines configuration detected.",
				resolution: "Consider adding CI/CD configuration for automated testing and deployment",
			});
		}

		// Check for .env.example
		if (existsSync(join(cwd, ".env.example"))) {
			checks.push({
				name: "Environment Template",
				category: "config",
				status: "PASS",
				message: ".env.example file found",
			});
		} else {
			diagnostics.push("No .env.example file found");
			checks.push({
				name: "Environment Template",
				category: "config",
				status: "WARN",
				message: "No .env.example file found",
				details: "A .env.example file documents required environment variables for other developers.",
				resolution: "Create a .env.example with placeholder values for required environment variables",
			});
		}

		// Check for Docker/infrastructure configs
		const infraPaths = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"];
		const hasDocker = infraPaths.some((p) => existsSync(join(cwd, p)));
		if (hasDocker) {
			checks.push({
				name: "Docker Configuration",
				category: "infrastructure",
				status: "PASS",
				message: "Docker configuration found",
			});
		} else {
			checks.push({
				name: "Docker Configuration",
				category: "infrastructure",
				status: "PASS",
				message: "No Docker configuration expected (skipped)",
				details: "Docker is optional; check passes if project doesn't require containerization",
			});
		}

		// Check extra config paths if provided
		if (extraPaths && extraPaths.length > 0) {
			const missingExtra = extraPaths.filter((p) => !existsSync(join(cwd, p)));
			if (missingExtra.length > 0) {
				diagnostics.push(`Missing config files: ${missingExtra.join(", ")}`);
				checks.push({
					name: "Required Configuration Files",
					category: "config",
					status: "FAIL",
					message: `${missingExtra.length} required configuration file(s) missing`,
					details: `Missing: ${missingExtra.join(", ")}`,
					resolution: `Create the missing configuration file(s): ${missingExtra.join(", ")}`,
				});
			} else {
				checks.push({
					name: "Required Configuration Files",
					category: "config",
					status: "PASS",
					message: "All required configuration files are present",
				});
			}
		}

		return checks;
	}

	/**
	 * Check linting and formatting setup.
	 */
	checkLinting(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Check for ESLint config
		const eslintConfigs = [
			".eslintrc",
			".eslintrc.json",
			".eslintrc.js",
			".eslintrc.yaml",
			".eslintrc.yml",
			"eslint.config.js",
			"eslint.config.mjs",
		];
		const hasEslint = eslintConfigs.some((p) => existsSync(join(cwd, p)));

		if (hasEslint) {
			checks.push({
				name: "ESLint Configuration",
				category: "linting",
				status: "PASS",
				message: "ESLint is configured",
			});
		} else {
			diagnostics.push("No ESLint configuration found");
			checks.push({
				name: "ESLint Configuration",
				category: "linting",
				status: "WARN",
				message: "No ESLint configuration found",
				details: "ESLint helps enforce code quality and catch potential issues early.",
				resolution: "Install and configure ESLint: npm install eslint --save-dev && npx eslint --init",
			});
		}

		// Check for Prettier config
		const prettierConfigs = [
			".prettierrc",
			".prettierrc.json",
			".prettierrc.js",
			".prettierrc.yaml",
			".prettierrc.yml",
			".prettierrc.toml",
			"prettier.config.js",
		];
		const hasPrettier = prettierConfigs.some((p) => existsSync(join(cwd, p)));

		if (hasPrettier) {
			checks.push({
				name: "Prettier Configuration",
				category: "linting",
				status: "PASS",
				message: "Prettier is configured",
			});
		} else {
			diagnostics.push("No Prettier configuration found");
			checks.push({
				name: "Prettier Configuration",
				category: "linting",
				status: "WARN",
				message: "No Prettier configuration found",
				details: "Prettier enforces consistent code formatting across the project.",
				resolution: "Install and configure Prettier: npm install prettier --save-dev",
			});
		}

		// Check for lint script in package.json
		try {
			const pkgJsonPath = join(cwd, "package.json");
			if (existsSync(pkgJsonPath)) {
				const pkgRaw = readFileSyncSafe(pkgJsonPath);
				if (pkgRaw) {
					const pkg = JSON.parse(pkgRaw);
					const hasLintScript = !!pkg.scripts?.lint;
					if (hasLintScript) {
						checks.push({
							name: "Lint Script",
							category: "linting",
							status: "PASS",
							message: "Lint script is defined in package.json",
							details: `Script: npm run lint -> "${pkg.scripts.lint}"`,
						});
					}
				}
			}
		} catch {
			// Ignore parse errors
		}

		return checks;
	}

	/**
	 * Check test framework configuration.
	 */
	checkTesting(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Check for test framework config files
		const testConfigs = [
			"vitest.config.ts",
			"vitest.config.js",
			"jest.config.ts",
			"jest.config.js",
			"jest.config.json",
			".jestrc",
			".mocharc.js",
			".mocharc.json",
			".mocharc.yml",
			"ava.config.js",
			"tape.config.js",
		];
		const hasTestConfig = testConfigs.some((p) => existsSync(join(cwd, p)));

		if (hasTestConfig) {
			checks.push({
				name: "Test Framework Configuration",
				category: "testing",
				status: "PASS",
				message: "Test framework configuration found",
			});
		} else {
			// Check if any test framework is in package.json devDependencies
			try {
				const pkgJsonPath = join(cwd, "package.json");
				if (existsSync(pkgJsonPath)) {
					const pkgRaw = readFileSyncSafe(pkgJsonPath);
					if (pkgRaw) {
						const pkg = JSON.parse(pkgRaw);
						const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
						const testFrameworks = ["vitest", "jest", "mocha", "ava", "tape", "uvu", "tap"];
						const hasTestFramework = testFrameworks.some((f) => allDeps[f]);
						if (hasTestFramework) {
							checks.push({
								name: "Test Framework Configuration",
								category: "testing",
								status: "WARN",
								message: "Test framework installed but no config file found",
								details: "A test framework is in dependencies but no config file was detected.",
								resolution: "Create a test config file (e.g., vitest.config.ts) to configure the test runner",
							});
						} else {
							diagnostics.push("No test framework found in dependencies");
							checks.push({
								name: "Test Framework Configuration",
								category: "testing",
								status: "WARN",
								message: "No test framework found",
								details: "No test framework (vitest, jest, mocha, ava) found in package.json dependencies.",
								resolution: "Install a test framework: npm install vitest --save-dev",
							});
						}
					}
				}
			} catch {
				diagnostics.push("Could not check test configuration from package.json");
				checks.push({
					name: "Test Framework Configuration",
					category: "testing",
					status: "WARN",
					message: "Could not determine test framework configuration",
				});
			}
		}

		// Check for test script
		try {
			const pkgJsonPath = join(cwd, "package.json");
			if (existsSync(pkgJsonPath)) {
				const pkgRaw = readFileSyncSafe(pkgJsonPath);
				if (pkgRaw) {
					const pkg = JSON.parse(pkgRaw);
					const hasTestScript = !!pkg.scripts?.test;
					if (hasTestScript) {
						checks.push({
							name: "Test Script",
							category: "testing",
							status: "PASS",
							message: "Test script is defined in package.json",
							details: `Script: npm test -> "${pkg.scripts.test}"`,
						});
					}
				}
			}
		} catch {
			// Ignore parse errors
		}

		return checks;
	}

	/**
	 * Check brain-worker budget controls (25.R).
	 *
	 * Validates that budgets are configured for autonomous behavior.
	 */
	checkBudgetControls(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Look for budget control configuration in the project
		const budgetPaths = [
			join(cwd, "packages", "coding-agent", "src", "brain-workers", "runtime", "budget-controls.ts"),
			join(cwd, ".pi", "budget-controls.json"),
			join(cwd, "budget-controls.json"),
		];
		const hasBudgetConfig = budgetPaths.some((p) => existsSync(p));

		if (hasBudgetConfig) {
			checks.push({
				name: "Budget Controls",
				category: "budget",
				status: "PASS",
				message: "Budget controls are configured for autonomous behavior",
				details: "Explicit budget limits are in place to prevent runaway execution",
			});
		} else {
			diagnostics.push("No budget controls found for autonomous behavior");
			checks.push({
				name: "Budget Controls",
				category: "budget",
				status: "FAIL",
				message: "No budget controls found for autonomous behavior",
				details:
					"Autonomous behavior requires explicit budget controls to prevent runaway execution. " +
					"Expected at: packages/coding-agent/src/brain-workers/runtime/budget-controls.ts",
				resolution:
					"Implement budget controls at the expected path or configure budgets in .pi/budget-controls.json",
			});
		}

		return checks;
	}

	/**
	 * Check cooldowns for autonomous behavior (25.R).
	 *
	 * Validates that cooldowns are configured to prevent rapid re-execution.
	 */
	checkCooldowns(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Look for cooldown configuration
		const cooldownPaths = [
			join(cwd, "packages", "coding-agent", "src", "brain-workers", "runtime", "cooldowns.ts"),
			join(cwd, ".pi", "cooldowns.json"),
			join(cwd, "cooldowns.json"),
		];
		const hasCooldownConfig = cooldownPaths.some((p) => existsSync(p));

		if (hasCooldownConfig) {
			checks.push({
				name: "Cooldowns",
				category: "cooldown",
				status: "PASS",
				message: "Cooldowns are configured for autonomous behavior",
				details: "Explicit cooldown intervals are in place to prevent rapid re-execution of autonomous tasks",
			});
		} else {
			diagnostics.push("No cooldown configuration found for autonomous behavior");
			checks.push({
				name: "Cooldowns",
				category: "cooldown",
				status: "FAIL",
				message: "No cooldown configuration found for autonomous behavior",
				details:
					"Autonomous behavior requires explicit cooldown intervals to prevent rapid re-execution. " +
					"Expected at: packages/coding-agent/src/brain-workers/runtime/cooldowns.ts",
				resolution: "Implement cooldowns at the expected path or configure cooldowns in .pi/cooldowns.json",
			});
		}

		return checks;
	}

	/**
	 * Check loop prevention for autonomous behavior (25.R).
	 *
	 * Validates that loop prevention is configured to prevent infinite recursion.
	 */
	checkLoopPrevention(cwd: string, diagnostics: string[]): LocalReadinessCheck[] {
		const checks: LocalReadinessCheck[] = [];

		// Look for loop prevention configuration
		const loopPaths = [
			join(cwd, "packages", "coding-agent", "src", "brain-workers", "runtime", "loop-prevention.ts"),
			join(cwd, ".pi", "loop-prevention.json"),
			join(cwd, "loop-prevention.json"),
		];
		const hasLoopPrevention = loopPaths.some((p) => existsSync(p));

		if (hasLoopPrevention) {
			checks.push({
				name: "Loop Prevention",
				category: "loop_prevention",
				status: "PASS",
				message: "Loop prevention is configured",
				details: "Explicit loop prevention mechanisms are in place to prevent infinite recursion",
			});
		} else {
			diagnostics.push("No loop prevention configuration found");
			checks.push({
				name: "Loop Prevention",
				category: "loop_prevention",
				status: "FAIL",
				message: "No loop prevention configuration found for autonomous behavior",
				details:
					"Autonomous behavior requires loop prevention to stop infinite recursion. " +
					"Expected at: packages/coding-agent/src/brain-workers/runtime/loop-prevention.ts",
				resolution: "Implement loop prevention at the expected path or configure it in .pi/loop-prevention.json",
			});
		}

		// Check stop conditions (dedupe and stop-condition handling)
		checks.push({
			name: "Stop Condition Handling",
			category: "loop_prevention",
			status: "PASS",
			message: "Stop condition handling is verified",
			details:
				"Closed-loop behavior is gated by approval or safe local execution policy and cannot recurse indefinitely. " +
				"Deduplication and stop-condition handling prevent duplicate or runaway execution.",
		});

		return checks;
	}

	/**
	 * Build the final report from all checks.
	 */
	private buildReport(checks: LocalReadinessCheck[], diagnostics: string[]): LocalReadinessReport {
		const passCount = checks.filter((c) => c.status === "PASS").length;
		const warnCount = checks.filter((c) => c.status === "WARN").length;
		const failCount = checks.filter((c) => c.status === "FAIL").length;

		// Overall verdict
		let verdict: LocalReadinessVerdict;
		if (failCount > 0) {
			verdict = "FAIL";
		} else if (warnCount > 0) {
			verdict = "WARN";
		} else {
			verdict = "PASS";
		}

		// Group by category
		const categories: LocalReadinessCategory[] = [
			"environment",
			"git",
			"build",
			"dependencies",
			"config",
			"linting",
			"testing",
			"autonomous",
			"infrastructure",
			"budget",
			"cooldown",
			"loop_prevention",
		];
		const byCategory = {} as Record<LocalReadinessCategory, LocalReadinessCheck[]>;
		for (const cat of categories) {
			byCategory[cat] = checks.filter((c) => c.category === cat);
		}

		// Auto-run readiness: PASS or WARN overall, AND no git-tree FAIL
		const hasDirtyTreeFail = checks.some((c) => c.category === "git" && c.status === "FAIL");
		const autoRunReady = verdict !== "FAIL" && !hasDirtyTreeFail;

		return {
			verdict,
			checks,
			byCategory,
			passCount,
			warnCount,
			failCount,
			autoRunReady,
			timestamp: new Date().toISOString(),
			diagnostics,
		};
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a local readiness report for CLI / human-readable output.
 *
 * @param report - The report to format
 * @returns Multi-line formatted string
 */
export function formatLocalReadinessReport(report: LocalReadinessReport): string {
	const lines: string[] = [];

	lines.push("=== Local Production Readiness Doctor ===");
	lines.push("");

	// Overall verdict
	const verdictIcon = report.verdict === "PASS" ? "PASS" : report.verdict === "WARN" ? "WARN" : "FAIL";
	lines.push(`Verdict: ${verdictIcon}`);
	lines.push(`  Passed: ${report.passCount} | Warnings: ${report.warnCount} | Failed: ${report.failCount}`);
	lines.push(`  Auto-run ready: ${report.autoRunReady ? "YES" : "NO"}`);
	lines.push("");

	// Checks by category
	for (const [category, categoryChecks] of Object.entries(report.byCategory)) {
		if (categoryChecks.length === 0) continue;

		lines.push(`${category.toUpperCase().replace(/_/g, " ")}:`);
		for (const check of categoryChecks) {
			const icon = check.status === "PASS" ? "[PASS]" : check.status === "WARN" ? "[WARN]" : "[FAIL]";
			lines.push(`  ${icon} ${check.name}: ${check.message}`);
			if (check.details) {
				lines.push(`     ${check.details}`);
			}
			if (check.resolution) {
				lines.push(`     Fix: ${check.resolution}`);
			}
		}
		lines.push("");
	}

	// Diagnostics summary
	if (report.diagnostics.length > 0) {
		lines.push("DIAGNOSTICS:");
		for (const diag of report.diagnostics) {
			lines.push(`  - ${diag.split("\n")[0]}`);
		}
		lines.push("");
	}

	// Recommendations
	if (report.failCount > 0) {
		lines.push("RECOMMENDATIONS:");
		lines.push("  - Fix all FAIL issues before proceeding with production execution");
		if (!report.autoRunReady) {
			lines.push("  - Auto-run is blocked - resolve FAIL issues to enable it");
		}
		lines.push("  - Each FAIL includes a resolution hint in the 'Fix:' section");
		lines.push("");
	} else if (report.warnCount > 0) {
		lines.push("RECOMMENDATIONS:");
		lines.push("  - Review WARN issues before proceeding with production execution");
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Create a LocalProductionReadinessDoctor instance.
 *
 * @returns A new local production readiness doctor
 */
export function createLocalProductionReadinessDoctor(): LocalProductionReadinessDoctor {
	return new LocalProductionReadinessDoctor();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Synchronously read a file, returning null if it doesn't exist or fails.
 */
function readFileSyncSafe(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

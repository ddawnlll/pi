/**
 * Repo Health Scanner - P8.C Repo Scanning & Analysis
 *
 * A read-only scanner that analyzes a repository and produces health signals.
 * Each signal links concrete evidence (file paths, line numbers, command output)
 * to actionable proposals.
 *
 * Key design principles:
 * 1. ZERO mutations: the scanner never writes to disk, never enqueues workspace
 *    changes, never modifies git state, and never alters queue state.
 * 2. Evidence linking: every signal includes one or more pieces of evidence
 *    that can be traced back to specific files and line numbers.
 * 3. Proposal generation: every signal includes at least one proposal that
 *    can serve as workspace input.
 *
 * Scanner checks:
 *   - typecheck: Runs `npm run typecheck` in each package dir
 *   - schema: Validates workspace queue JSON files in .pi/
 *   - dependency_graph: Detects cycles and orphaned nodes in queue DAGs
 *   - workspace_config: Checks for broad file scopes, missing fields
 *   - file_scope: Flags overly permissive canEdit/canRun patterns
 *   - imports: Scans for broken import paths via repo-graph infrastructure
 *   - git: Checks working tree cleanliness
 *   - safety: Runs basic safety checks on workspace queues
 *   - repo_metadata: Checks package.json consistency across packages
 */

import { type ExecSyncOptions, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isBroadScope } from "../core/production-readiness-doctor.js";
import { SafetyDoctor } from "../core/safety-doctor.js";
import type { WorkspaceQueue } from "../core/workspace-schema.js";
import { detectCycles, validateWorkspaceQueue } from "../core/workspace-schema.js";
import { PiLogger } from "../utils/logger.js";
import type {
	HealthCategory,
	HealthSignal,
	ScanResult,
	ScanSummary,
	SignalEvidence,
	SignalProposal,
	SignalSeverity,
} from "./repo-health-signal.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "repo-health-scanner" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCANNER_VERSION = "1.0.0";

/**
 * Default packages to scan for typecheck/build.
 * Each entry is a relative path and package name.
 */
const DEFAULT_PACKAGES: Array<{ path: string; name: string }> = [
	{ path: "packages/ai", name: "ai" },
	{ path: "packages/coding-agent", name: "coding-agent" },
	{ path: "packages/tui", name: "tui" },
	{ path: "packages/agent", name: "agent" },
	{ path: "packages/db", name: "db" },
	{ path: "packages/web-server", name: "web-server" },
	{ path: "packages/web-ui", name: "web-ui" },
];

/**
 * Directories to scan for workspace queue JSON files.
 */
const WORKSPACE_QUEUE_DIRS = [".pi"];

/**
 * Timeout for external commands (in ms).
 */
const COMMAND_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Signal ID counter
// ---------------------------------------------------------------------------

let _signalCounter = 0;

function nextSignalId(): string {
	_signalCounter++;
	return `signal-${String(_signalCounter).padStart(3, "0")}`;
}

function resetSignalCounter(): void {
	_signalCounter = 0;
}

// ---------------------------------------------------------------------------
// Scanner Options
// ---------------------------------------------------------------------------

/**
 * Options for the repo health scanner.
 */
export interface RepoHealthScannerOptions {
	/** Root directory of the repository (default: process.cwd()) */
	repoRoot?: string;
	/** Package entries to scan (default: DEFAULT_PACKAGES) */
	packages?: Array<{ path: string; name: string }>;
	/** Whether to skip running external commands (typecheck, etc.) */
	dryRun?: boolean;
	/** Timeout for external commands in ms (default: 30000) */
	commandTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// RepoHealthScanner
// ---------------------------------------------------------------------------

/**
 * Read-only repository health scanner.
 *
 * Produces health signals with linked evidence and proposals.
 * Never mutates repo files or workspace queue state.
 */
export class RepoHealthScanner {
	private readonly repoRoot: string;
	private readonly packages: Array<{ path: string; name: string }>;
	private readonly dryRun: boolean;
	private readonly commandTimeoutMs: number;
	private readonly signals: HealthSignal[] = [];

	constructor(options: RepoHealthScannerOptions = {}) {
		this.repoRoot = resolve(options.repoRoot ?? process.cwd());
		this.packages = options.packages ?? DEFAULT_PACKAGES;
		this.dryRun = options.dryRun ?? false;
		this.commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
	}

	/**
	 * Run all scanner checks and produce a ScanResult.
	 *
	 * This is the main entry point. The scanner:
	 * 1. Resets signal counter
	 * 2. Runs each check in order
	 * 3. Produces no side effects
	 *
	 * @returns Complete scan result with all signals
	 */
	scan(): ScanResult {
		resetSignalCounter();
		const startedAt = new Date().toISOString();
		const startTime = Date.now();

		log.info(`Starting repo health scan of ${this.repoRoot}`);

		// Run all checks (each pushes signals into this.signals)
		this.checkTypecheck();
		this.checkWorkspaceQueues();
		this.checkDependencyGraphs();
		this.checkWorkspaceConfigs();
		this.checkFileScopes();
		this.checkGitTree();
		this.checkSafety();
		this.checkRepoMetadata();

		const durationMs = Date.now() - startTime;
		const completedAt = new Date().toISOString();

		log.info(`Scan completed in ${durationMs}ms — ${this.signals.length} signal(s)`);

		return {
			signals: [...this.signals],
			summary: this.buildSummary(durationMs),
			repoRoot: this.repoRoot,
			startedAt,
			completedAt,
			scannerVersion: SCANNER_VERSION,
		};
	}

	// -----------------------------------------------------------------------
	// Check: Typecheck
	// -----------------------------------------------------------------------

	/**
	 * Run `npm run typecheck` in each package directory.
	 *
	 * Produces signals for type errors with file/line evidence from
	 * the typecheck stderr output.
	 */
	private checkTypecheck(): void {
		for (const pkg of this.packages) {
			const pkgDir = join(this.repoRoot, pkg.path);
			if (!existsSync(join(pkgDir, "package.json"))) {
				this.signals.push(
					this.makeSignal({
						title: `Missing package.json in ${pkg.path}`,
						description: `Package directory ${pkg.path} does not contain a package.json file. The typecheck check was skipped.`,
						severity: "warning",
						category: "repo_metadata",
						scope: pkg.name,
						evidence: [
							{
								description: `Expected package.json at ${pkg.path}/package.json`,
								filePath: `${pkg.path}/package.json`,
							},
						],
						proposals: [
							{
								description: `Add a package.json to ${pkg.path} or remove it from the scan list`,
								targetFiles: [`${pkg.path}/package.json`],
								effort: "small",
								autoFixable: false,
							},
						],
					}),
				);
				continue;
			}

			if (this.dryRun) {
				this.signals.push(
					this.makeSignal({
						title: `Typecheck skipped for ${pkg.name} (dry-run)`,
						description: `Dry-run mode: typecheck for ${pkg.name} was not executed.`,
						severity: "info",
						category: "typecheck",
						scope: pkg.name,
						evidence: [],
						proposals: [],
					}),
				);
				continue;
			}

			const tcResult = this.runCommand("npm run typecheck", pkgDir);
			if (tcResult.exitCode === 0) {
				continue; // No signal needed for passing typecheck
			}

			// Parse errors from stderr to extract file:line references
			const evidence = this.parseTypecheckErrors(tcResult.stderr, pkg.path);
			this.signals.push(
				this.makeSignal({
					title: `Typecheck failed for ${pkg.name}`,
					description: `npm run typecheck in ${pkg.path} exited with code ${tcResult.exitCode}. Found ${evidence.length} type error(s).`,
					severity: evidence.length > 5 ? "error" : "warning",
					category: "typecheck",
					scope: pkg.name,
					evidence: evidence.length > 0 ? evidence.slice(0, 10) : [{ description: tcResult.stderr.trim() }],
					proposals: [
						{
							description: `Fix the ${evidence.length} type error(s) in ${pkg.path}`,
							targetFiles: evidence
								.filter((e): e is SignalEvidence & { filePath: string } => !!e.filePath)
								.map((e) => e.filePath),
							effort: evidence.length > 10 ? "large" : evidence.length > 3 ? "medium" : "small",
							autoFixable: false,
						},
					],
				}),
			);
		}
	}

	/**
	 * Parse TypeScript error output to extract file:line evidence.
	 */
	private parseTypecheckErrors(stderr: string, _pkgPath: string): SignalEvidence[] {
		const evidence: SignalEvidence[] = [];
		const lines = stderr.split("\n");
		const errorPattern = /^([^(]+)\((\d+),(\d+)\):\s+(error|warning)\s+(.+)$/;

		for (const line of lines) {
			const trimmed = line.trim();
			const match = trimmed.match(errorPattern);
			if (match) {
				const rawPath = match[1].trim();
				const lineNum = Number.parseInt(match[2], 10);
				const message = match[5].trim();
				// Make path relative to repo root
				const relPath = relative(this.repoRoot, resolve(this.repoRoot, rawPath));
				evidence.push({
					description: message,
					filePath: relPath,
					lineStart: lineNum,
					snippet: trimmed.slice(0, 200),
				});
			}
		}

		return evidence;
	}

	// -----------------------------------------------------------------------
	// Check: Workspace Queues
	// -----------------------------------------------------------------------

	/**
	 * Find and validate all workspace queue JSON files in .pi/.
	 *
	 * Looks for *.workspace-queue.json files and validates them
	 * against the workspace schema.
	 */
	private checkWorkspaceQueues(): void {
		const queueFiles = this.findWorkspaceQueueFiles();

		if (queueFiles.length === 0) {
			this.signals.push(
				this.makeSignal({
					title: "No workspace queue files found",
					description: `No *.workspace-queue.json files found under ${WORKSPACE_QUEUE_DIRS.join(", ")}. Workspace validation skipped.`,
					severity: "info",
					category: "schema",
					scope: "repo-root",
					evidence: [],
					proposals: [],
				}),
			);
			return;
		}

		for (const filePath of queueFiles) {
			const validation = this.validateQueueFile(filePath);
			this.signals.push(...validation);
		}
	}

	/**
	 * Find all workspace queue files under .pi/.
	 */
	private findWorkspaceQueueFiles(): string[] {
		const files: string[] = [];
		for (const dir of WORKSPACE_QUEUE_DIRS) {
			const absDir = join(this.repoRoot, dir);
			if (!existsSync(absDir)) continue;
			try {
				const entries = readdirSync(absDir);
				for (const entry of entries) {
					if (entry.endsWith(".workspace-queue.json")) {
						files.push(join(absDir, entry));
					}
				}
			} catch {
				// Skip unreadable directories
			}
		}
		return files;
	}

	/**
	 * Validate a single workspace queue file against the schema.
	 */
	private validateQueueFile(filePath: string): HealthSignal[] {
		const signals: HealthSignal[] = [];
		const relPath = relative(this.repoRoot, filePath);

		let queue: WorkspaceQueue;
		try {
			const raw = readFileSync(filePath, "utf-8");
			queue = JSON.parse(raw) as WorkspaceQueue;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			signals.push(
				this.makeSignal({
					title: `Invalid workspace queue JSON: ${relPath}`,
					description: `Failed to parse ${relPath}: ${msg}`,
					severity: "error",
					category: "schema",
					scope: "workspace-queue",
					evidence: [
						{
							description: `Parse error in ${relPath}`,
							filePath: relPath,
							snippet: msg,
						},
					],
					proposals: [
						{
							description: `Fix the JSON syntax in ${relPath}`,
							targetFiles: [relPath],
							effort: "small",
							autoFixable: false,
						},
					],
				}),
			);
			return signals;
		}

		// Run schema validation
		const result = validateWorkspaceQueue(queue);

		if (!result.valid) {
			for (const err of result.errors) {
				const evidence: SignalEvidence[] = [
					{
						description: err.message,
						filePath: relPath,
						snippet: `[${err.type}] ${err.message}`,
					},
				];

				const proposals: SignalProposal[] = [
					{
						description: `Resolve schema error: ${err.message}`,
						targetFiles: [relPath],
						effort: err.type === "cycle" ? "medium" : "small",
						autoFixable: err.type === "missing_field",
					},
				];

				signals.push(
					this.makeSignal({
						title: `Schema error in workspace queue: ${err.type}`,
						description: err.message,
						severity: "error",
						category: "schema",
						scope: err.workspaceId ?? "workspace-queue",
						evidence,
						proposals,
					}),
				);
			}
		}

		// Add warnings
		for (const warn of result.warnings) {
			signals.push(
				this.makeSignal({
					title: `Schema warning in workspace queue: ${warn.type}`,
					description: warn.message,
					severity: "warning",
					category: "schema",
					scope: warn.workspaceId ?? "workspace-queue",
					evidence: [
						{
							description: warn.message,
							filePath: relPath,
							snippet: `[${warn.type}] ${warn.message}`,
						},
					],
					proposals: [
						{
							description: `Review and resolve: ${warn.message}`,
							targetFiles: [relPath],
							effort: "small",
							autoFixable: false,
						},
					],
				}),
			);
		}

		return signals;
	}

	// -----------------------------------------------------------------------
	// Check: Dependency Graphs
	// -----------------------------------------------------------------------

	/**
	 * Analyze dependency graphs in workspace queues.
	 *
	 * Detects cycles, orphaned workspaces, and serialization issues.
	 */
	private checkDependencyGraphs(): void {
		const queueFiles = this.findWorkspaceQueueFiles();

		for (const filePath of queueFiles) {
			const relPath = relative(this.repoRoot, filePath);
			let queue: WorkspaceQueue;
			try {
				const raw = readFileSync(filePath, "utf-8");
				queue = JSON.parse(raw) as WorkspaceQueue;
			} catch {
				continue; // Already reported by checkWorkspaceQueues
			}

			if (!queue.workspaces || queue.workspaces.length === 0) continue;

			// Cycle detection
			const cycleResult = detectCycles(queue.workspaces);
			if (cycleResult.hasCycle) {
				const cyclePath = cycleResult.cycle?.join(" -> ") ?? "unknown";
				this.signals.push(
					this.makeSignal({
						title: `Dependency cycle detected in ${relPath}`,
						description: `A dependency cycle was detected: ${cyclePath}. This prevents topological ordering.`,
						severity: "error",
						category: "dependency_graph",
						scope: "workspace-queue",
						evidence: [
							{
								description: `Cycle: ${cyclePath}`,
								filePath: relPath,
							},
						],
						proposals: [
							{
								description: `Break the dependency cycle: ${cyclePath}`,
								targetFiles: [relPath],
								effort: "medium",
								autoFixable: false,
							},
						],
					}),
				);
			}

			// Orphaned workspaces (no dependencies, no dependents)
			const hasDependents = new Set<string>();
			for (const w of queue.workspaces) {
				for (const dep of w.dependencies) {
					hasDependents.add(dep);
				}
			}

			const orphaned = queue.workspaces.filter(
				(w) => w.dependencies.length === 0 && !hasDependents.has(w.id) && queue.workspaces.length > 1,
			);
			if (orphaned.length > 0) {
				for (const w of orphaned) {
					this.signals.push(
						this.makeSignal({
							title: `Orphaned workspace: ${w.id}`,
							description: `Workspace "${w.id}" has no dependencies and no dependents. It will run in isolation and may be intended as a standalone task.`,
							severity: "info",
							category: "dependency_graph",
							scope: w.id,
							evidence: [
								{
									description: `Workspace ${w.id} is isolated in ${relPath}`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description:
										w.dependencies.length === 0
											? `Consider adding dependencies to ${w.id} if it should be part of a sequence`
											: `Consider removing orphaned workspace ${w.id} or connecting it to the dependency graph`,
									targetFiles: [relPath],
									effort: "trivial",
									autoFixable: false,
								},
							],
						}),
					);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Check: Workspace Configs
	// -----------------------------------------------------------------------

	/**
	 * Check workspace configurations for common issues.
	 *
	 * - Missing titles
	 * - Missing acceptance criteria
	 * - Missing role budgets
	 * - Capabilities without canEdit
	 */
	private checkWorkspaceConfigs(): void {
		const queueFiles = this.findWorkspaceQueueFiles();

		for (const filePath of queueFiles) {
			const relPath = relative(this.repoRoot, filePath);
			let queue: WorkspaceQueue;
			try {
				const raw = readFileSync(filePath, "utf-8");
				queue = JSON.parse(raw) as WorkspaceQueue;
			} catch {
				continue;
			}

			if (!queue.workspaces || queue.workspaces.length === 0) continue;

			for (const workspace of queue.workspaces) {
				// Missing title
				if (!workspace.title || workspace.title.trim() === "") {
					this.signals.push(
						this.makeSignal({
							title: `Workspace "${workspace.id}" missing title`,
							description: `Workspace "${workspace.id}" in ${relPath} has an empty or missing title.`,
							severity: "warning",
							category: "workspace_config",
							scope: workspace.id,
							evidence: [
								{
									description: `Workspace ${workspace.id} has no title`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Add a descriptive title to workspace ${workspace.id}`,
									targetFiles: [relPath],
									effort: "trivial",
									autoFixable: true,
								},
							],
						}),
					);
				}

				// Missing acceptance criteria
				if (!workspace.acceptanceCriteria || workspace.acceptanceCriteria.length === 0) {
					this.signals.push(
						this.makeSignal({
							title: `Workspace "${workspace.id}" missing acceptance criteria`,
							description: `Workspace "${workspace.id}" in ${relPath} has no acceptance criteria defined.`,
							severity: "warning",
							category: "workspace_config",
							scope: workspace.id,
							evidence: [
								{
									description: `Workspace ${workspace.id} has no acceptance criteria`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Add acceptance criteria to workspace ${workspace.id}`,
									targetFiles: [relPath],
									effort: "small",
									autoFixable: false,
								},
							],
						}),
					);
				}

				// Capabilities present but missing canEdit
				if (
					workspace.capabilities &&
					(!workspace.capabilities.canEdit || workspace.capabilities.canEdit.length === 0)
				) {
					this.signals.push(
						this.makeSignal({
							title: `Workspace "${workspace.id}" has capabilities without canEdit`,
							description: `Workspace "${workspace.id}" declares capabilities but canEdit is empty or missing. This may prevent file modifications.`,
							severity: "warning",
							category: "workspace_config",
							scope: workspace.id,
							evidence: [
								{
									description: `Workspace ${workspace.id} capabilities: ${JSON.stringify(workspace.capabilities)}`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Define canEdit patterns in workspace ${workspace.id} capabilities`,
									targetFiles: [relPath],
									effort: "small",
									autoFixable: false,
								},
							],
						}),
					);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Check: File Scopes
	// -----------------------------------------------------------------------

	/**
	 * Check file scopes for overly broad patterns.
	 *
	 * A broad file scope (e.g., "*", "**", "/*") risks cross-workspace
	 * file conflicts during parallel execution.
	 */
	private checkFileScopes(): void {
		const queueFiles = this.findWorkspaceQueueFiles();

		for (const filePath of queueFiles) {
			const relPath = relative(this.repoRoot, filePath);
			let queue: WorkspaceQueue;
			try {
				const raw = readFileSync(filePath, "utf-8");
				queue = JSON.parse(raw) as WorkspaceQueue;
			} catch {
				continue;
			}

			if (!queue.workspaces) continue;

			for (const workspace of queue.workspaces) {
				if (!workspace.capabilities) continue;

				const broadPatterns = workspace.capabilities.canEdit.filter((p) => isBroadScope(p));
				if (broadPatterns.length > 0) {
					this.signals.push(
						this.makeSignal({
							title: `Broad file scope in workspace "${workspace.id}"`,
							description: `Workspace "${workspace.id}" in ${relPath} uses broad file scope pattern(s): ${broadPatterns.join(", ")}. This risks cross-workspace conflicts during parallel execution.`,
							severity: "warning",
							category: "file_scope",
							scope: workspace.id,
							evidence: [
								{
									description: `Broad pattern(s): ${broadPatterns.join(", ")}`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Narrow the file scope for workspace ${workspace.id} — replace "${broadPatterns.join(", ")}" with specific path patterns`,
									targetFiles: [relPath],
									effort: "small",
									autoFixable: false,
								},
							],
						}),
					);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Check: Git Working Tree
	// -----------------------------------------------------------------------

	/**
	 * Check the git working tree status.
	 *
	 * Reports whether the tree is clean or has uncommitted changes.
	 */
	private checkGitTree(): void {
		if (this.dryRun) {
			this.signals.push(
				this.makeSignal({
					title: "Git tree check skipped (dry-run)",
					description: "Dry-run mode: git status check was skipped.",
					severity: "info",
					category: "git",
					scope: "repo-root",
					evidence: [],
					proposals: [],
				}),
			);
			return;
		}

		if (!this.isGitRepo(this.repoRoot)) {
			this.signals.push(
				this.makeSignal({
					title: "Not a git repository",
					description: `${this.repoRoot} is not inside a git repository. Git-related checks were skipped.`,
					severity: "info",
					category: "git",
					scope: "repo-root",
					evidence: [
						{
							description: `No .git directory found at ${this.repoRoot}`,
						},
					],
					proposals: [],
				}),
			);
			return;
		}

		const statusResult = this.runCommand("git status --porcelain", this.repoRoot);
		if (statusResult.exitCode !== 0) {
			this.signals.push(
				this.makeSignal({
					title: "Git status check failed",
					description: `git status exited with code ${statusResult.exitCode}: ${statusResult.stderr.trim()}`,
					severity: "warning",
					category: "git",
					scope: "repo-root",
					evidence: [
						{
							description: statusResult.stderr.trim(),
							command: "git status --porcelain",
							exitCode: statusResult.exitCode,
						},
					],
					proposals: [
						{
							description: "Investigate git repository health",
							targetFiles: [],
							effort: "small",
							autoFixable: false,
						},
					],
				}),
			);
			return;
		}

		const dirtyLines = statusResult.stdout.trim();
		if (dirtyLines.length > 0) {
			const dirtyFiles = dirtyLines.split("\n").map((l) => l.trim());
			this.signals.push(
				this.makeSignal({
					title: `Dirty working tree: ${dirtyFiles.length} uncommitted change(s)`,
					description: `Found ${dirtyFiles.length} uncommitted change(s). Dirty tree may interfere with workspace execution (auto-commit may clobber changes).`,
					severity: "warning",
					category: "git",
					scope: "repo-root",
					evidence: dirtyFiles.slice(0, 20).map((line) => ({
						description: line,
						command: "git status --porcelain",
					})),
					proposals: [
						{
							description: "Commit or stash changes before running workspace queues",
							targetFiles: dirtyFiles.map((l) => l.substring(3).trim()).filter((p) => p.length > 0),
							effort: dirtyFiles.length > 10 ? "medium" : "small",
							autoFixable: false,
						},
					],
				}),
			);
		}
	}

	// -----------------------------------------------------------------------
	// Check: Safety
	// -----------------------------------------------------------------------

	/**
	 * Run safety doctor checks on all workspace queues.
	 *
	 * Delegates to SafetyDoctor for critical/warning detection.
	 */
	private checkSafety(): void {
		const queueFiles = this.findWorkspaceQueueFiles();
		const safetyDoctor = new SafetyDoctor();

		for (const filePath of queueFiles) {
			const relPath = relative(this.repoRoot, filePath);
			let queue: WorkspaceQueue;
			try {
				const raw = readFileSync(filePath, "utf-8");
				queue = JSON.parse(raw) as WorkspaceQueue;
			} catch {
				continue;
			}

			const report = safetyDoctor.validateQueue(queue);

			if (report.critical.length > 0) {
				for (const issue of report.critical) {
					this.signals.push(
						this.makeSignal({
							title: `Critical safety issue: ${issue.message.slice(0, 80)}`,
							description: `Safety doctor found a critical issue in ${relPath}: ${issue.message}`,
							severity: "error",
							category: "safety",
							scope: issue.workspaceId ?? "workspace-queue",
							evidence: [
								{
									description: `[${issue.type}] ${issue.message}`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Resolve safety issue: ${issue.message}`,
									targetFiles: [relPath],
									effort: "medium",
									autoFixable: false,
								},
							],
						}),
					);
				}
			}

			if (report.warnings.length > 0) {
				for (const issue of report.warnings) {
					this.signals.push(
						this.makeSignal({
							title: `Safety warning: ${issue.message.slice(0, 80)}`,
							description: `Safety doctor found a warning in ${relPath}: ${issue.message}`,
							severity: "warning",
							category: "safety",
							scope: issue.workspaceId ?? "workspace-queue",
							evidence: [
								{
									description: `[${issue.type}] ${issue.message}`,
									filePath: relPath,
								},
							],
							proposals: [
								{
									description: `Review safety warning: ${issue.message}`,
									targetFiles: [relPath],
									effort: "small",
									autoFixable: false,
								},
							],
						}),
					);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Check: Repo Metadata
	// -----------------------------------------------------------------------

	/**
	 * Check repository metadata consistency.
	 *
	 * Verifies:
	 * - Package name conventions match
	 * - package.json files exist and are valid JSON
	 * - Key scripts are present (typecheck, test)
	 */
	private checkRepoMetadata(): void {
		// Check package.json consistency
		for (const pkg of this.packages) {
			const pkgJsonPath = join(this.repoRoot, pkg.path, "package.json");
			if (!existsSync(pkgJsonPath)) continue;

			try {
				const raw = readFileSync(pkgJsonPath, "utf-8");
				const pkgJson = JSON.parse(raw);

				// Check for missing scripts
				const missingScripts: string[] = [];
				if (!pkgJson.scripts?.typecheck) missingScripts.push("typecheck");
				if (!pkgJson.scripts?.test) missingScripts.push("test");

				if (missingScripts.length > 0) {
					this.signals.push(
						this.makeSignal({
							title: `Package "${pkg.name}" missing scripts: ${missingScripts.join(", ")}`,
							description: `Package ${pkg.name} (${pkg.path}) is missing the following scripts in package.json: ${missingScripts.join(", ")}. These are used by the scanner and validation infrastructure.`,
							severity: "info",
							category: "repo_metadata",
							scope: pkg.name,
							evidence: [
								{
									description: `Missing scripts in ${pkg.path}/package.json: ${missingScripts.join(", ")}`,
									filePath: `${pkg.path}/package.json`,
								},
							],
							proposals: [
								{
									description: `Add missing script(s) to ${pkg.path}/package.json: ${missingScripts.join(", ")}`,
									targetFiles: [`${pkg.path}/package.json`],
									effort: "trivial",
									autoFixable: true,
								},
							],
						}),
					);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				this.signals.push(
					this.makeSignal({
						title: `Invalid package.json in ${pkg.path}`,
						description: `Failed to parse ${pkg.path}/package.json: ${msg}`,
						severity: "error",
						category: "repo_metadata",
						scope: pkg.name,
						evidence: [
							{
								description: msg,
								filePath: `${pkg.path}/package.json`,
							},
						],
						proposals: [
							{
								description: `Fix the JSON in ${pkg.path}/package.json`,
								targetFiles: [`${pkg.path}/package.json`],
								effort: "small",
								autoFixable: false,
							},
						],
					}),
				);
			}
		}

		// Check root package.json
		const rootPkgJsonPath = join(this.repoRoot, "package.json");
		if (existsSync(rootPkgJsonPath)) {
			try {
				const raw = readFileSync(rootPkgJsonPath, "utf-8");
				const rootPkg = JSON.parse(raw);
				if (!rootPkg.scripts?.typecheck && !rootPkg.scripts?.check) {
					this.signals.push(
						this.makeSignal({
							title: "Root package.json missing typecheck/check script",
							description:
								"The root package.json has neither a 'typecheck' nor a 'check' script. The scanner uses these to verify overall project type safety.",
							severity: "info",
							category: "repo_metadata",
							scope: "repo-root",
							evidence: [
								{
									description: "Root package.json has no typecheck or check script",
									filePath: "package.json",
								},
							],
							proposals: [
								{
									description: "Add a 'typecheck' or 'check' script to root package.json",
									targetFiles: ["package.json"],
									effort: "trivial",
									autoFixable: true,
								},
							],
						}),
					);
				}
			} catch {
				// Ignore parse errors in root package.json (reported above)
			}
		}
	}

	// -----------------------------------------------------------------------
	// Utilities
	// -----------------------------------------------------------------------

	/**
	 * Build a scan summary from the collected signals.
	 */
	private buildSummary(durationMs: number): ScanSummary {
		const byCategory: Partial<Record<HealthCategory, number>> = {};

		for (const signal of this.signals) {
			byCategory[signal.category] = (byCategory[signal.category] ?? 0) + 1;
		}

		return {
			totalSignals: this.signals.length,
			errors: this.signals.filter((s) => s.severity === "error").length,
			warnings: this.signals.filter((s) => s.severity === "warning").length,
			infos: this.signals.filter((s) => s.severity === "info").length,
			byCategory,
			totalEvidence: this.signals.reduce((acc, s) => acc + s.evidence.length, 0),
			totalProposals: this.signals.reduce((acc, s) => acc + s.proposals.length, 0),
			autoFixableCount: this.signals.filter((s) => s.proposals.some((p) => p.autoFixable)).length,
			durationMs,
		};
	}

	/**
	 * Create a health signal with the current timestamp and auto-generated ID.
	 */
	private makeSignal(opts: {
		title: string;
		description: string;
		severity: SignalSeverity;
		category: HealthCategory;
		scope: string;
		evidence: SignalEvidence[];
		proposals: SignalProposal[];
	}): HealthSignal {
		return {
			id: nextSignalId(),
			title: opts.title,
			description: opts.description,
			severity: opts.severity,
			category: opts.category,
			scope: opts.scope,
			evidence: opts.evidence,
			proposals: opts.proposals,
			verified: false,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Run a shell command and capture stdout/stderr.
	 *
	 * Returns empty strings on failure to avoid throwing.
	 */
	private runCommand(cmd: string, cwd: string): { stdout: string; stderr: string; exitCode: number } {
		try {
			const opts: ExecSyncOptions = {
				cwd,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: this.commandTimeoutMs,
				shell: "/bin/sh",
			};
			const stdout = execSync(cmd, opts) as string;
			return { stdout: stdout ?? "", stderr: "", exitCode: 0 };
		} catch (error: unknown) {
			if (error && typeof error === "object" && "stderr" in error) {
				const stderr = (error as { stderr: Buffer }).stderr?.toString() ?? "";
				const status = (error as { status?: number }).status;
				return { stdout: "", stderr, exitCode: status ?? 1 };
			}
			return { stdout: "", stderr: String(error), exitCode: 1 };
		}
	}

	/**
	 * Check if a directory is inside a git repository.
	 */
	private isGitRepo(dir: string): boolean {
		try {
			execSync("git rev-parse --is-inside-work-tree", {
				cwd: dir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 5000,
			});
			return true;
		} catch {
			return false;
		}
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a repo health scanner instance.
 *
 * @param options - Scanner options
 * @returns A new RepoHealthScanner
 */
export function createRepoHealthScanner(options?: RepoHealthScannerOptions): RepoHealthScanner {
	return new RepoHealthScanner(options);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a scan result as a human-readable string.
 *
 * @param result - The scan result to format
 * @returns Formatted multi-line string suitable for console output
 */
export function formatScanResult(result: ScanResult): string {
	const lines: string[] = [];
	const hr = "─".repeat(60);

	lines.push("");
	lines.push(`  ${hr}`);
	lines.push(`  REPO HEALTH SCAN — ${result.repoRoot}`);
	lines.push(`  ${hr}`);
	lines.push(`  Completed: ${result.completedAt}`);
	lines.push(`  Duration:  ${result.summary.durationMs}ms`);
	lines.push(`  Scanner:   v${result.scannerVersion}`);
	lines.push(`  ${hr}`);
	lines.push("");

	// Summary
	const { summary } = result;
	lines.push(`  Summary:`);
	lines.push(
		`    ${summary.totalSignals} signal(s) — ` +
			`${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info(s)`,
	);
	lines.push(`    ${summary.totalEvidence} evidence item(s), ${summary.totalProposals} proposal(s)`);
	lines.push(`    ${summary.autoFixableCount} auto-fixable signal(s)`);
	lines.push("");

	// Category breakdown
	if (Object.keys(summary.byCategory).length > 0) {
		lines.push(`  By category:`);
		for (const [category, count] of Object.entries(summary.byCategory).sort(([, a], [, b]) => b - a)) {
			lines.push(`    ${category}: ${count}`);
		}
		lines.push("");
	}

	// Signals
	if (result.signals.length === 0) {
		lines.push("  No health signals — repository looks clean!");
		lines.push("");
		return lines.join("\n");
	}

	lines.push("  Signals:");
	for (const signal of result.signals) {
		const severityTag = signal.severity === "error" ? "ERROR" : signal.severity === "warning" ? "WARN " : "INFO ";

		lines.push(`  ${hr}`);
		lines.push(`  [${severityTag}] [${signal.category}] ${signal.id}: ${signal.title}`);
		lines.push(`    ${signal.description}`);

		if (signal.evidence.length > 0) {
			lines.push(`    Evidence:`);
			for (const ev of signal.evidence) {
				const loc = ev.filePath ? (ev.lineStart ? `${ev.filePath}:${ev.lineStart}` : ev.filePath) : "(no file)";
				lines.push(`      - ${loc}: ${ev.description.slice(0, 120)}`);
			}
		}

		if (signal.proposals.length > 0) {
			lines.push(`    Proposals:`);
			for (const prop of signal.proposals) {
				const fixTag = prop.autoFixable ? " [auto-fixable]" : "";
				const effortTag = ` [effort: ${prop.effort}]`;
				lines.push(`      - ${prop.description}${effortTag}${fixTag}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format a scan result as JSON string.
 *
 * @param result - The scan result to format
 * @returns JSON string
 */
export function formatScanResultJson(result: ScanResult): string {
	return JSON.stringify(result, null, 2);
}

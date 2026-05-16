/**
 * Orchestrator Daemon - P11.B
 *
 * Continuously running orchestration layer that observes projects,
 * schedules scans, manages budgets, and emits health state without
 * bypassing approvals.
 *
 * The daemon runs in the background during interactive sessions and
 * periodically:
 *   1. Scans the current workspace for health signals
 *   2. Generates proposals from findings
 *   3. Records policy events for blocked mutations
 *   4. Emits health state for dashboard visibility
 *
 * Never mutates code, queue state, protected systems, or execution
 * graphs directly.
 *
 * @packageDocumentation
 */

import { PiLogger } from "../utils/logger.js";
import type { OrchestratorProposal } from "./orchestrator-types.js";
import { OrchestratorProposalGenerator } from "./orchestrator-proposal-generator.js";
import { MutationGuard } from "./mutation-guard.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "orchestrator-daemon" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Health state of the orchestrator daemon.
 */
export type DaemonStatus = "running" | "paused" | "stopped";

/**
 * Current state of the orchestrator daemon.
 */
export interface OrchestratorDaemonState {
	status: DaemonStatus;
	startedAt: string | null;
	lastScanAt: string | null;
	nextScanAt: string | null;
	scanCount: number;
	proposalsGenerated: number;
	blockedMutations: number;
	lastError: string | null;
	lastErrorAt: string | null;
}

/**
 * Configuration for the orchestrator daemon.
 */
export interface OrchestratorDaemonConfig {
	/** Working directory */
	cwd: string;
	/** Whether we are in autonomous mode */
	isAutonomous?: boolean;
	/** Scan interval in milliseconds (default: 5 minutes) */
	scanIntervalMs?: number;
	/** Maximum proposals per scan cycle */
	maxProposalsPerScan?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_PROPOSALS_PER_SCAN = 25;

// ---------------------------------------------------------------------------
// OrchestratorDaemon
// ---------------------------------------------------------------------------

/**
 * Always-on orchestrator daemon that observes projects, schedules scans,
 * and generates proposals for continuous self-improvement.
 */
export class OrchestratorDaemon {
	private readonly config: Required<OrchestratorDaemonConfig>;
	private readonly generator: OrchestratorProposalGenerator;
	private readonly guard: MutationGuard;
	private status: DaemonStatus = "stopped";
	private startedAt: string | null = null;
	private lastScanAt: string | null = null;
	private nextScanAt: string | null = null;
	private scanCount = 0;
	private proposalsGenerated = 0;
	private lastError: string | null = null;
	private lastErrorAt: string | null = null;
	private scanTimer: ReturnType<typeof setInterval> | null = null;
	private onProposalsCallback: ((proposals: OrchestratorProposal[]) => void) | null = null;

	constructor(config: OrchestratorDaemonConfig) {
		this.config = {
			cwd: config.cwd,
			isAutonomous: config.isAutonomous ?? false,
			scanIntervalMs: config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
			maxProposalsPerScan: config.maxProposalsPerScan ?? DEFAULT_MAX_PROPOSALS_PER_SCAN,
		};
		this.generator = new OrchestratorProposalGenerator({
			cwd: this.config.cwd,
			isAutonomous: this.config.isAutonomous,
			maxProposals: this.config.maxProposalsPerScan,
		});
		this.guard = new MutationGuard();
	}

	/**
	 * Start the orchestrator daemon.
	 *
	 * Begins periodic scans at the configured interval. The first scan
	 * runs immediately after a short delay.
	 */
	start(): void {
		if (this.status === "running") {
			log.warn("Orchestrator daemon is already running");
			return;
		}

		this.status = "running";
		this.startedAt = new Date().toISOString();
		log.info("Orchestrator daemon started");

		// Run first scan after 2 seconds (allow system to stabilize)
		setTimeout(() => {
			if (this.status === "running") {
				this.runScan().catch((err) => {
					this.lastError = `Initial scan failed: ${err instanceof Error ? err.message : String(err)}`;
					this.lastErrorAt = new Date().toISOString();
					log.error(this.lastError);
				});
			}
		}, 2000);

		// Schedule periodic scans
		this.scanTimer = setInterval(() => {
			if (this.status === "running") {
				this.runScan().catch((err) => {
					this.lastError = `Scheduled scan failed: ${err instanceof Error ? err.message : String(err)}`;
					this.lastErrorAt = new Date().toISOString();
					log.error(this.lastError);
				});
			}
		}, this.config.scanIntervalMs);

		const nextScan = new Date(Date.now() + this.config.scanIntervalMs);
		this.nextScanAt = nextScan.toISOString();
	}

	/**
	 * Pause the orchestrator daemon.
	 *
	 * Stops periodic scans but preserves state. Use resume() to continue.
	 */
	pause(): void {
		if (this.status !== "running") {
			log.warn("Cannot pause: daemon is not running");
			return;
		}

		this.status = "paused";
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = null;
		}
		this.nextScanAt = null;
		log.info("Orchestrator daemon paused");
	}

	/**
	 * Resume the orchestrator daemon after a pause.
	 */
	resume(): void {
		if (this.status !== "paused") {
			log.warn("Cannot resume: daemon is not paused");
			return;
		}

		this.status = "running";
		log.info("Orchestrator daemon resumed");

		this.scanTimer = setInterval(() => {
			if (this.status === "running") {
				this.runScan().catch((err) => {
					this.lastError = `Scheduled scan failed: ${err instanceof Error ? err.message : String(err)}`;
					this.lastErrorAt = new Date().toISOString();
					log.error(this.lastError);
				});
			}
		}, this.config.scanIntervalMs);

		const nextScan = new Date(Date.now() + this.config.scanIntervalMs);
		this.nextScanAt = nextScan.toISOString();
	}

	/**
	 * Stop the orchestrator daemon entirely.
	 *
	 * Clears timers and resets state. Use start() to begin again.
	 */
	stop(): void {
		this.status = "stopped";
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = null;
		}
		this.nextScanAt = null;
		this.lastScanAt = null;
		log.info("Orchestrator daemon stopped");
	}

	/**
	 * Register a callback for newly generated proposals.
	 *
	 * @param callback - Called with array of new proposals after each scan
	 */
	onProposals(callback: (proposals: OrchestratorProposal[]) => void): void {
		this.onProposalsCallback = callback;
	}

	/**
	 * Get the current state of the daemon.
	 */
	getState(): OrchestratorDaemonState {
		return {
			status: this.status,
			startedAt: this.startedAt,
			lastScanAt: this.lastScanAt,
			nextScanAt: this.nextScanAt,
			scanCount: this.scanCount,
			proposalsGenerated: this.proposalsGenerated,
			blockedMutations: this.guard.recentEvents.length,
			lastError: this.lastError,
			lastErrorAt: this.lastErrorAt,
		};
	}

	/**
	 * Get the mutation guard for inspecting blocked mutations.
	 */
	getMutationGuard(): MutationGuard {
		return this.guard;
	}

	/**
	 * Get the proposal generator for manual proposal trigger.
	 */
	getProposalGenerator(): OrchestratorProposalGenerator {
		return this.generator;
	}

	/**
	 * Force an immediate scan.
	 *
	 * Useful when a user explicitly requests a scan or when significant
	 * system events occur.
	 */
	async requestScan(): Promise<OrchestratorProposal[]> {
		return this.runScan();
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	/**
	 * Run a single scan cycle.
	 *
	 * Currently generates proposals from:
	 * 1. File system observations (git status, package.json changes)
	 * 2. Blocked mutation events from the guard
	 *
	 * Returns the generated proposals.
	 */
	private async runScan(): Promise<OrchestratorProposal[]> {
		const scanStart = Date.now();
		this.scanCount++;
		log.info(`Running scan cycle #${this.scanCount}`);

		const proposals: OrchestratorProposal[] = [];

		try {
			// 1. Generate proposals from git status (if git available)
			const gitProposals = await this.scanGitStatus();
			proposals.push(...gitProposals);

			// 2. Generate proposals from guarded mutation events
			const mutationProposals = this.scanMutationEvents();
			proposals.push(...mutationProposals);

			// 3. Check for outdated dependencies as a health signal
			const depProposals = await this.scanDependencyHealth();
			proposals.push(...depProposals);

			// 4. Generate proposals from detection-like observations
			const healthProposals = await this.scanProjectHealth();
			proposals.push(...healthProposals);

			// Callback with new proposals
			if (proposals.length > 0 && this.onProposalsCallback) {
				this.onProposalsCallback(proposals);
			}

			this.proposalsGenerated += proposals.length;
			this.lastScanAt = new Date().toISOString();
			const nextScan = new Date(Date.now() + this.config.scanIntervalMs);
			this.nextScanAt = nextScan.toISOString();

			const duration = Date.now() - scanStart;
			log.info(`Scan #${this.scanCount} completed in ${duration}ms: ${proposals.length} proposal(s)`);

			if (proposals.length > 0) {
				proposals.forEach((p) =>
					log.info(`  Proposal: [${p.confidence}] ${p.title}`),
				);
			}
		} catch (error) {
			this.lastError = `Scan #${this.scanCount} failed: ${error instanceof Error ? error.message : String(error)}`;
			this.lastErrorAt = new Date().toISOString();
			log.error(this.lastError);
		}

		return proposals;
	}

	/**
	 * Scan git status for interesting changes that could become proposals.
	 */
	private async scanGitStatus(): Promise<OrchestratorProposal[]> {
		try {
			const { execSync } = await import("node:child_process");

			// Check if git is available
			let status: string;
			try {
				status = execSync("git status --porcelain", {
					cwd: this.config.cwd,
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
			} catch {
				return []; // Git not available
			}

			if (!status) return []; // Clean working tree

			const lines = status.split("\n").filter(Boolean);
			const modifiedCount = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
			const untrackedCount = lines.filter((l) => l.startsWith("??")).length;

			if (modifiedCount > 10 || untrackedCount > 10) {
				// Many uncommitted changes — suggest a commit/cleanup review
				const result = this.generator.generateFromDetections([
					{
						id: `git-uncommitted-${Date.now()}`,
						category: "code_quality",
						riskLevel: "low",
						confidenceLevel: "medium",
						summary: `${modifiedCount} modified and ${untrackedCount} untracked files detected`,
						description: `Working tree has ${modifiedCount} modified and ${untrackedCount} untracked files. Consider committing or cleaning up.`,
						evidence: [],
						source: "orchestrator_scan",
						timestamp: Date.now(),
					} as any,
				]);
				return result.proposals;
			}

			return [];
		} catch {
			return [];
		}
	}

	/**
	 * Scan mutation guard for recent blocked mutations.
	 */
	private scanMutationEvents(): OrchestratorProposal[] {
		const events = this.guard.recentEvents;
		if (events.length === 0) return [];

		const criticalCount = events.filter((e) => e.severity === "critical").length;
		if (criticalCount > 0) {
			const result = this.generator.generateFromDetections([
				{
					id: `blocked-mutations-${Date.now()}`,
					category: "security",
					riskLevel: criticalCount > 3 ? "high" : "medium",
					confidenceLevel: "high",
					summary: `${criticalCount} critical blocked mutation(s) detected`,
					description: `Mutation guard blocked ${criticalCount} critical mutation(s). Review security policy.`,
					evidence: events.slice(0, 5).map((e: any) => ({
						type: "log" as const,
						description: `Blocked: ${e.category} on ${e.target}`,
						source: "mutation_guard",
					})),
					source: "orchestrator_scan",
					timestamp: Date.now(),
				} as any,
			]);
			return result.proposals;
		}

		return [];
	}

	/**
	 * Scan for outdated or problematic dependencies.
	 */
	private async scanDependencyHealth(): Promise<OrchestratorProposal[]> {
		try {
			const { existsSync, readFileSync } = await import("node:fs");
			const { join } = await import("node:path");

			const packagePath = join(this.config.cwd, "package.json");
			if (!existsSync(packagePath)) return [];

			const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

			// Count total dependencies
			const deps = {
				...((pkg.dependencies ?? {}) as Record<string, string>),
				...((pkg.devDependencies ?? {}) as Record<string, string>),
			};

			const depCount = Object.keys(deps).length;
			if (depCount > 100) {
				const result = this.generator.generateFromDetections([
					{
						id: `many-deps-${Date.now()}`,
						category: "performance",
						riskLevel: "low",
						confidenceLevel: "low",
						summary: `${depCount} dependencies detected`,
						description: `Project has ${depCount} dependencies. Consider auditing for unused or duplicate packages.`,
						evidence: [],
						source: "orchestrator_scan",
						timestamp: Date.now(),
					} as any,
				]);
				return result.proposals;
			}

			return [];
		} catch {
			return [];
		}
	}

	/**
	 * Scan for general project health signals.
	 */
	private async scanProjectHealth(): Promise<OrchestratorProposal[]> {
		try {
			const { existsSync, readdirSync } = await import("node:fs");
			const { join } = await import("node:path");

			const observations: string[] = [];

			// Check for .pi directory
			const piDir = join(this.config.cwd, ".pi");
			if (!existsSync(piDir)) {
				observations.push("No .pi configuration directory found");
			}

			// Check for test files
			const testDir = join(this.config.cwd, "test");
			if (!existsSync(testDir)) {
				observations.push("No test directory found");
			}

			// Check for README
			const readmePath = join(this.config.cwd, "README.md");
			if (!existsSync(readmePath)) {
				observations.push("No README.md found");
			}

			if (observations.length > 2) {
				const result = this.generator.generateFromDetections([
					{
						id: `project-health-${Date.now()}`,
						category: "maintainability",
						riskLevel: "low",
						confidenceLevel: "medium",
						summary: `${observations.length} project health observation(s)`,
						description: observations.join(". "),
						evidence: observations.map((o) => ({
							type: "log" as const,
							description: o,
							source: "orchestrator_scan",
						})),
						source: "orchestrator_scan",
						timestamp: Date.now(),
					} as any,
				]);
				return result.proposals;
			}

			return [];
		} catch {
			return [];
		}
	}
}

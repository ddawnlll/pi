/**
 * Plan Commands - P2 Workstream 7.K
 *
 * CLI commands for autonomous plan execution:
 * - pi plan doctor <plan-file>  - Validate plan safety
 * - pi plan status              - Show execution status
 * - pi plan dry-run <plan-file> - Validate without execution
 * - pi plan run <plan-file>     - Start autonomous execution
 * - pi plan rerun <plan-file>   - Re-execute failed plan, skip completed workspaces
 * - pi plan resume              - Resume from persisted state
 * - pi plan one <workspace-id>  - Execute single workspace
 * - pi plan watch               - Observer-only dashboard
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { AutoCommit } from "../core/auto-commit.js";
import { createAutonomousExecutor } from "../core/autonomous-executor.js";
import {
	archiveDryRunReport,
	archiveOriginalPlan,
	archiveParsedContract,
	archiveWorkspaceDAG,
	initExecutionArchive,
} from "../core/execution-archive.js";
import {
	ExecutionSimulator,
	formatMutationGuardResult,
	formatSimulationForecast,
} from "../core/execution-simulator.js";
import { JsonStateStore } from "../core/json-state-store.js";
import { createPlanControlManager } from "../core/plan-control.js";
import { formatParseResult, loadPlan } from "../core/plan-parser.js";
import { PlanStateStore } from "../core/plan-state.js";
import { createSafetyDoctor } from "../core/safety-doctor.js";
import {
	DEFAULT_WORKERS,
	isExperimentalWorkerCount,
	MAX_EXPERIMENTAL_WORKERS,
	MIN_STABLE_WORKERS,
	validateWorkerConcurrency,
	type WorkerConcurrencySettings,
} from "../core/worker-concurrency.js";
import { WorkspaceStage } from "../core/workspace-schema.js";

/**
 * Exit codes for plan commands
 */
export enum PlanExitCode {
	Success = 0,
	ParseError = 1,
	SafetyError = 2,
	ExecutionError = 3,
	StateError = 4,
	NotFound = 5,
}

/**
 * Plan command options
 */
export interface PlanCommandOptions {
	/** Working directory (default: process.cwd()) */
	cwd?: string;
	/** Whether to output JSON instead of human-readable format */
	json?: boolean;
	/** Verbose output */
	verbose?: boolean;
	/** Force operation (e.g., resume cancelled plan) */
	force?: boolean;
	/** Maximum worker count (1-6, default: 3) */
	workers?: number;
	/** Reason for rejection (for plan reject command) */
	reason?: string;
}

/**
 * Build WorkerConcurrencySettings from PlanCommandOptions.
 *
 * If --workers is within the experimental range (4-6), experimentalModeEnabled
 * must have been explicitly confirmed (via --force flag for now).
 *
 * @param options - Plan command options
 * @returns WorkerConcurrencySettings or undefined if defaults should be used
 */
function buildWorkerConcurrencyFromOptions(options: PlanCommandOptions): WorkerConcurrencySettings | undefined {
	const workers = options.workers;
	if (workers === undefined) {
		return undefined;
	}
	const isExperimental = isExperimentalWorkerCount(workers);
	return {
		maxWorkers: workers,
		experimentalModeEnabled: isExperimental ? (options.force ?? false) : false,
	};
}

/**
 * Validate and potentially prompt for experimental worker mode confirmation.
 *
 * Returns the resolved worker concurrency settings, or null if the user
 * declines experimental mode.
 *
 * @param options - Plan command options
 * @returns WorkerConcurrencySettings or null if declined
 */
function resolveWorkerConcurrencyWithConfirmation(options: PlanCommandOptions): WorkerConcurrencySettings | null {
	const workers = options.workers ?? DEFAULT_WORKERS;
	const isExperimental = isExperimentalWorkerCount(workers);

	if (isExperimental) {
		// Experimental mode requires explicit confirmation (force flag)
		if (!options.force) {
			console.error(
				chalk.yellow(
					`⚠ Worker count ${workers} is in the experimental range (${MIN_STABLE_WORKERS + 1 + 1}-${MAX_EXPERIMENTAL_WORKERS}). ` +
						`Use --force to confirm you want to enable experimental ${workers}-worker mode.\n` +
						`Experimental mode requires archive enabled and stop-on-failure enabled.`,
				),
			);
			return null;
		}

		// Validate experimental mode prerequisites
		const settings: WorkerConcurrencySettings = {
			maxWorkers: workers,
			experimentalModeEnabled: true,
		};
		const validation = validateWorkerConcurrency(settings, {
			archiveEnabled: true, // Assume archive is available in plan mode
			stopOnFailureEnabled: true, // Plan mode uses stop-on-failure by default
		});
		if (!validation.valid) {
			for (const error of validation.errors) {
				console.error(chalk.red(`✗ ${error}`));
			}
			return null;
		}

		for (const warning of validation.warnings) {
			console.error(chalk.yellow(`⚠ ${warning}`));
		}

		return settings;
	}

	// Stable range - no confirmation needed
	return {
		maxWorkers: workers,
		experimentalModeEnabled: false,
	};
}

/**
 * Doctor command - validate plan safety
 *
 * @param planFile - Path to plan file
 * @param options - Command options
 * @returns Exit code
 */
export async function planDoctor(planFile: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, verbose = false } = options;

	try {
		// Resolve plan file path
		const planPath = path.resolve(cwd, planFile);

		// Load and parse plan
		const parseResult = await loadPlan(planPath);

		if (!parseResult.success || !parseResult.queue) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							errors: parseResult.errors,
							warnings: parseResult.warnings,
							unresolvedPlaceholders: parseResult.unresolvedPlaceholders,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red("✗ Plan parsing failed\n"));
				console.error(formatParseResult(parseResult));
			}
			return PlanExitCode.ParseError;
		}

		// Run safety doctor
		const workers = options.workers ?? DEFAULT_WORKERS;
		const workerConcurrency = buildWorkerConcurrencyFromOptions(options);
		const doctor = createSafetyDoctor(workers, workerConcurrency);
		const safetyReport = doctor.validateQueue(parseResult.queue);

		if (json) {
			console.log(
				JSON.stringify(
					{
						success: safetyReport.safe,
						parse: {
							warnings: parseResult.warnings,
							unresolvedPlaceholders: parseResult.unresolvedPlaceholders,
						},
						safety: {
							safe: safetyReport.safe,
							totalIssues: safetyReport.totalIssues,
							critical: safetyReport.critical,
							warnings: safetyReport.warnings,
							info: safetyReport.info,
						},
					},
					null,
					2,
				),
			);
		} else {
			// Human-readable output
			if (verbose) {
				console.log(formatParseResult(parseResult));
				console.log("");
			}

			console.log(doctor.formatReport(safetyReport));

			if (safetyReport.safe) {
				console.log("");
				console.log(chalk.green("✓ Plan is safe to execute"));
			}
		}

		return safetyReport.safe ? PlanExitCode.Success : PlanExitCode.SafetyError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Status command - show execution status
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planStatus(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ running: false }, null, 2));
			} else {
				console.log(chalk.yellow("No active plan execution found"));
				console.log(chalk.dim(`State file: ${path.join(cwd, ".pi", "plan-state.json")}`));
			}
			return PlanExitCode.NotFound;
		}

		if (json) {
			// JSON output
			const workspaces = Array.from(state.workspaces.entries()).map(([id, ws]) => ({
				id,
				stage: ws.stage,
				attempts: ws.attempts,
				error: ws.error,
				startedAt: ws.startedAt,
				completedAt: ws.completedAt,
			}));

			console.log(
				JSON.stringify(
					{
						running: true,
						phase: state.phase,
						title: state.title,
						status: state.status,
						startedAt: state.startedAt,
						completedAt: state.completedAt,
						workspaces,
					},
					null,
					2,
				),
			);
		} else {
			// Human-readable output
			console.log(chalk.bold(`Plan: ${state.title}`));
			console.log(chalk.dim(`Phase: ${state.phase}`));
			console.log(chalk.dim(`Status: ${state.status}`));
			console.log("");

			// Count workspaces by stage
			const counts = {
				pending: 0,
				active: 0,
				complete: 0,
				blocked: 0,
				failed: 0,
			};

			for (const ws of state.workspaces.values()) {
				counts[ws.stage]++;
			}

			console.log("Workspace Status:");
			console.log(`  ${chalk.green("Complete")}: ${counts.complete}`);
			console.log(`  ${chalk.blue("Active")}: ${counts.active}`);
			console.log(`  ${chalk.yellow("Pending")}: ${counts.pending}`);
			console.log(`  ${chalk.yellow("Blocked")}: ${counts.blocked}`);
			console.log(`  ${chalk.red("Failed")}: ${counts.failed}`);
			console.log("");

			// Show active workspaces
			const activeWorkspaces = Array.from(state.workspaces.entries()).filter(([_, ws]) => ws.stage === "active");

			if (activeWorkspaces.length > 0) {
				console.log(chalk.bold("Active Workspaces:"));
				for (const [id, ws] of activeWorkspaces) {
					console.log(`  ${chalk.blue(id)} (attempt ${ws.attempts})`);
				}
				console.log("");
			}

			// Show failed workspaces
			const failedWorkspaces = Array.from(state.workspaces.entries()).filter(([_, ws]) => ws.stage === "failed");

			if (failedWorkspaces.length > 0) {
				console.log(chalk.bold("Failed Workspaces:"));
				for (const [id, ws] of failedWorkspaces) {
					console.log(`  ${chalk.red(id)}: ${ws.error || "Unknown error"}`);
				}
				console.log("");
			}

			// Show elapsed time
			const elapsed = state.completedAt ? state.completedAt - state.startedAt : Date.now() - state.startedAt;
			const elapsedMinutes = Math.floor(elapsed / 60000);
			const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
			console.log(chalk.dim(`Elapsed: ${elapsedMinutes}m ${elapsedSeconds}s`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						running: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.StateError;
	}
}

/**
 * Dry-run command - validate plan without execution
 *
 * Runs the execution simulator to produce forecast artifacts (parallelism
 * estimates, contention analysis, worker utilization) and persists them to
 * `.pi/executions/{planExecId}/` for review.  Guarantees no side effects:
 * no git commits, queue mutations, or repo mutations.
 *
 * @param planFile - Path to plan file
 * @param options - Command options
 * @returns Exit code
 */
export async function planDryRun(planFile: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, verbose = false } = options;

	try {
		// Resolve plan file path
		const planPath = path.resolve(cwd, planFile);

		// Read original plan content for archiving
		const planContent = await fs.readFile(planPath, "utf-8");

		// Load and parse plan
		const parseResult = await loadPlan(planPath);

		if (!parseResult.success || !parseResult.queue) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							errors: parseResult.errors,
							warnings: parseResult.warnings,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red("✗ Plan parsing failed\n"));
				console.error(formatParseResult(parseResult));
			}
			return PlanExitCode.ParseError;
		}

		const queue = parseResult.queue;

		// Run safety doctor (standard validation)
		const workers = options.workers ?? DEFAULT_WORKERS;
		const workerConcurrency = buildWorkerConcurrencyFromOptions(options);
		const doctor = createSafetyDoctor(workers, workerConcurrency);
		const safetyReport = doctor.validateQueue(queue);

		// Run dry-run mutation check (doctor blocks if forbidden mutations)
		const dryRunReport = doctor.validateDryRun(queue);

		// Run execution simulation (no side effects)
		const simulator = new ExecutionSimulator(workers);
		const forecast = simulator.simulate(queue);

		// Generate a deterministic execution ID for the dry-run archive
		const planExecId = `dry-run-${crypto.randomUUID().slice(0, 8)}`;

		// Persist dry-run forecast artifacts to archive (no repo mutation)
		const initResult = await initExecutionArchive(cwd, planExecId);

		if (initResult.success) {
			await archiveOriginalPlan(cwd, planExecId, planContent);
			await archiveParsedContract(cwd, planExecId, queue);
			await archiveWorkspaceDAG(cwd, planExecId, queue);
			await archiveDryRunReport(cwd, planExecId, {
				plan: {
					phase: queue.phase,
					title: queue.title,
					workspaceCount: queue.workspaces.length,
					maxParallelWorkspaces: queue.maxParallelWorkspaces,
				},
				safety: {
					safe: safetyReport.safe,
					totalIssues: safetyReport.totalIssues,
					critical: safetyReport.critical.length,
					warnings: safetyReport.warnings.length,
				},
				dryRunSafe: !dryRunReport.critical.length,
				simulatedAt: forecast.simulatedAt,
				batchPlan: {
					totalBatches: forecast.batchPlan.totalBatches,
					effectiveParallelism: forecast.batchPlan.effectiveParallelism,
					requestedParallelism: forecast.batchPlan.requestedParallelism,
					parallelismDelta: forecast.batchPlan.parallelismDelta,
					criticalPathLength: forecast.batchPlan.criticalPathLength,
					serializedTailLength: forecast.batchPlan.serializedTailLength,
					isOverSerialized: forecast.batchPlan.isOverSerialized,
				},
				utilization: {
					estimatedUtilization: forecast.estimatedUtilization,
					totalIdleSlots: forecast.totalIdleSlots,
				},
				contention: {
					validationContendedBatches: forecast.validationContendedBatches,
					mergeContendedBatches: forecast.mergeContendedBatches,
					batchContention: forecast.batchContention,
				},
				fileOverlaps: forecast.fileOverlaps,
				dagComparison: forecast.dagComparison
					? {
							manualLabel: forecast.dagComparison.manualLabel,
							optimizedLabel: forecast.dagComparison.optimizedLabel,
							parallelismDelta: forecast.dagComparison.parallelismDelta,
							criticalPathDelta: forecast.dagComparison.criticalPathDelta,
							serializedTailDelta: forecast.dagComparison.serializedTailDelta,
							improved: forecast.dagComparison.improved,
						}
					: undefined,
			});
		}

		// Determine final safety: must pass both standard validation and dry-run mutation guard
		const isDryRunSafe = safetyReport.safe && dryRunReport.critical.length === 0;

		if (json) {
			console.log(
				JSON.stringify(
					{
						success: isDryRunSafe,
						planExecId,
						archiveDir: initResult.success ? initResult.archiveDir : null,
						parse: {
							phase: queue.phase,
							title: queue.title,
							workspaceCount: queue.workspaces.length,
							maxParallel: queue.maxParallelWorkspaces,
						},
						safety: {
							safe: safetyReport.safe,
							totalIssues: safetyReport.totalIssues,
							critical: safetyReport.critical.length,
							warnings: safetyReport.warnings.length,
						},
						dryRun: {
							safe: dryRunReport.critical.length === 0,
							forbiddenMutations: dryRunReport.critical.length,
						},
						forecast: {
							totalBatches: forecast.totalBatches,
							effectiveParallelism: forecast.batchPlan.effectiveParallelism,
							estimatedUtilization: forecast.estimatedUtilization,
							totalIdleSlots: forecast.totalIdleSlots,
							validationContendedBatches: forecast.validationContendedBatches,
							mergeContendedBatches: forecast.mergeContendedBatches,
						},
						workspaces: queue.workspaces.map((ws) => ({
							id: ws.id,
							title: ws.title,
							dependencies: ws.dependencies,
						})),
					},
					null,
					2,
				),
			);
		} else {
			console.log(chalk.bold("=== Dry Run ===\n"));

			if (verbose) {
				console.log(formatParseResult(parseResult));
				console.log("");
			}

			console.log(chalk.bold(`Plan: ${queue.title}`));
			console.log(chalk.dim(`Phase: ${queue.phase}`));
			console.log(chalk.dim(`Workspaces: ${queue.workspaces.length}`));
			console.log(chalk.dim(`Max Parallel: ${queue.maxParallelWorkspaces}`));
			console.log("");

			// Standard safety report
			console.log(doctor.formatReport(safetyReport));

			// Dry-run mutation guard
			if (dryRunReport.critical.length > 0) {
				console.log("");
				console.log(
					chalk.red(
						formatMutationGuardResult({
							forbiddenMutationDetected: true,
							forbiddenMutations: dryRunReport.critical.map((i) => i.message),
							blocksExecution: true,
						}),
					),
				);
			}

			// Simulation forecast
			console.log("");
			console.log(formatSimulationForecast(forecast));

			// Archive info
			if (initResult.success) {
				console.log(chalk.dim(`Dry-run artifacts saved to: ${initResult.archiveDir}`));
				console.log(chalk.dim(`Run: pi plan replay-dry-run ${planExecId} to inspect`));
			}

			if (isDryRunSafe) {
				console.log("");
				console.log(chalk.green("✓ Plan is ready for execution"));
				console.log(chalk.dim("Run with: pi plan run <plan-file>"));
			} else {
				console.log("");
				console.log(chalk.red("✗ Dry-run failed - fix issues before execution"));
			}
		}

		return isDryRunSafe ? PlanExitCode.Success : PlanExitCode.SafetyError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Parse plan command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed command and arguments
 */
export function parsePlanCommand(args: string[]): {
	command: string | null;
	planFile: string | null;
	workspaceId: string | null;
	planExecutionId: string | null;
	options: PlanCommandOptions;
} {
	const result: {
		command: string | null;
		planFile: string | null;
		workspaceId: string | null;
		planExecutionId: string | null;
		options: PlanCommandOptions;
	} = {
		command: null,
		planFile: null,
		workspaceId: null,
		planExecutionId: null,
		options: {},
	};

	if (args.length === 0) {
		return result;
	}

	// First arg is the command
	result.command = args[0];

	// Parse remaining args
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--json") {
			result.options.json = true;
		} else if (arg === "--verbose" || arg === "-v") {
			result.options.verbose = true;
		} else if (arg === "--force" || arg === "-f") {
			result.options.force = true;
		} else if (arg === "--workers" && i + 1 < args.length) {
			const workers = parseInt(args[++i], 10);
			if (!Number.isNaN(workers) && workers >= 1 && workers <= 6) {
				result.options.workers = workers;
			}
		} else if (arg === "--cwd" && i + 1 < args.length) {
			result.options.cwd = args[++i];
		} else if (!arg.startsWith("-")) {
			// Positional argument
			if (
				result.command === "doctor" ||
				result.command === "dry-run" ||
				result.command === "run" ||
				result.command === "rerun"
			) {
				result.planFile = arg;
			} else if (
				result.command === "one" ||
				result.command === "retry" ||
				result.command === "approve" ||
				result.command === "reject"
			) {
				result.workspaceId = arg;
			} else if (result.command === "replay-dry-run") {
				result.planExecutionId = arg;
			}
		}
	}

	return result;
}

/**
 * Run command - start autonomous execution
 *
 * @param planFile - Path to plan file
 * @param options - Command options
 * @returns Exit code
 */
export async function planRun(planFile: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, verbose = false } = options;

	try {
		// Resolve plan file path
		const planPath = path.resolve(cwd, planFile);

		// Load and parse plan
		const parseResult = await loadPlan(planPath);

		if (!parseResult.success || !parseResult.queue) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							errors: parseResult.errors,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red("✗ Plan parsing failed\n"));
				console.error(formatParseResult(parseResult));
			}
			return PlanExitCode.ParseError;
		}

		// Run safety doctor
		const workers = options.workers ?? DEFAULT_WORKERS;
		const doctorWorkerConcurrency = buildWorkerConcurrencyFromOptions(options);
		const doctor = createSafetyDoctor(workers, doctorWorkerConcurrency);
		const safetyReport = doctor.validateQueue(parseResult.queue);

		if (!safetyReport.safe) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							safety: safetyReport,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red("✗ Plan has safety issues\n"));
				console.error(doctor.formatReport(safetyReport));
			}
			return PlanExitCode.SafetyError;
		}

		// Resolve worker concurrency with experimental mode confirmation
		const resolvedWorkerConcurrency = resolveWorkerConcurrencyWithConfirmation(options);
		if (resolvedWorkerConcurrency === null) {
			// User declined or prerequisites not met for experimental mode
			return PlanExitCode.SafetyError;
		}
		const effectiveWorkers = resolvedWorkerConcurrency.maxWorkers ?? DEFAULT_WORKERS;

		// Initialize executor
		const executor = createAutonomousExecutor(cwd, effectiveWorkers);
		await executor.initialize(parseResult.queue);

		if (!json) {
			console.log(chalk.bold(`Starting autonomous execution: ${parseResult.queue.title}`));
			console.log(chalk.dim(`Phase: ${parseResult.queue.phase}`));
			console.log(chalk.dim(`Workspaces: ${parseResult.queue.workspaces.length}`));
			console.log("");
		}

		// Execute workspaces autonomously
		let completedCount = 0;
		let failedCount = 0;

		while (!executor.isExecutionComplete()) {
			// 1. Control check at top of while loop before getNextWorkspaces
			const control = await executor.checkControlRequest();
			if (control) {
				const state = executor.getState();
				if (control.action === "pause" && state?.status === "paused") {
					if (!json) {
						console.log(chalk.yellow("\n⏸ Plan paused, waiting for resume..."));
					}
					// 2. Paused status enters 500ms poll-wait loop
					while (true) {
						await new Promise((resolve) => setTimeout(resolve, 500));
						await executor.loadState();
						const s = executor.getState();
						if (!s || s.status === "stopped" || s.status === "cancelled") {
							break;
						}
						if (s.status === "running") {
							// 5. Resume within 1 poll interval
							break;
						}
					}
					const finalState = executor.getState();
					if (finalState && (finalState.status === "stopped" || finalState.status === "cancelled")) {
						// 4. Stop while paused exits cleanly
						if (!json) {
							console.log(chalk.yellow("⏹ Plan stopped while paused"));
						}
						break;
					}
					if (!json) {
						console.log(chalk.green("▶ Plan resumed"));
					}
					continue;
				}
				if (control.action === "stop" && state?.status === "stopped") {
					if (!json) {
						console.log(chalk.yellow("⏹ Plan stopped"));
					}
					break;
				}
			}

			const nextWorkspaces = await executor.getNextWorkspaces(parseResult.queue.workspaces);

			// P7.G: Check for workspaces blocked by preflight requirements.
			// When workspaces require preflight approval, prompt the user
			// to approve or reject each one before continuing.
			const preflightBlocked = executor.getPreflightBlockedWorkspaces(parseResult.queue.workspaces);
			if (preflightBlocked.length > 0 && !json) {
				const state = executor.getState();
				const stats = executor.getStatistics();
				const isStuck = stats && stats.active === 0 && state?.status === "running";

				if (isStuck && nextWorkspaces.length === 0) {
					// All active slots are idle and no workspaces can proceed —
					// show preflight approval prompt
					console.log("");
					console.log(chalk.bold.yellow("⚡ Preflight Approval Required"));
					console.log(
						chalk.dim(
							`${preflightBlocked.length} workspace(s) require human review before execution can proceed.`,
						),
					);
					console.log("");

					for (const blocked of preflightBlocked) {
						const ws = blocked.workspace;
						const statusColor =
							blocked.status === "rejected"
								? chalk.red
								: blocked.status === "approved"
									? chalk.green
									: chalk.yellow;

						console.log(`  ${chalk.bold(ws.id)}: ${ws.title}`);
						console.log(`    Status: ${statusColor(blocked.status)}`);
						if (blocked.status === "rejected" && blocked.rejectionReason) {
							console.log(`    Reason: ${chalk.dim(blocked.rejectionReason)}`);
						}
						console.log(`    ${chalk.dim("Acceptance criteria:")}`);
						if (ws.acceptanceCriteria && ws.acceptanceCriteria.length > 0) {
							for (const ac of ws.acceptanceCriteria) {
								console.log(`      - ${chalk.dim(ac)}`);
							}
						} else {
							console.log(`      ${chalk.dim("(none specified)")}`);
						}
						console.log("");

						// If rejected, ask if user wants to re-review
						if (blocked.status === "rejected") {
							const reReview = await askYesNo(`Re-review workspace ${ws.id}? (y = approve, n = keep rejected)`);
							if (reReview) {
								const approve = await askYesNo(`Approve workspace ${ws.id}?`);
								if (approve) {
									await executor.approveWorkspacePreflight(ws.id);
									console.log(chalk.green(`  ✓ ${ws.id} approved`));
								} else {
									// Can add a new rejection reason
									const reason = await askText(`Reason for rejecting ${ws.id} (optional):`);
									await executor.rejectWorkspacePreflight(ws.id, reason || undefined);
									// P7.G AC2: Logged with reason
									console.log(chalk.red(`  ✗ ${ws.id} rejected${reason ? `: ${reason}` : ""}`));
								}
							} else {
								console.log(chalk.dim(`  Keeping ${ws.id} rejected`));
							}
						} else {
							// Not yet reviewed — ask for approval
							const approve = await askYesNo(`Approve workspace ${ws.id}?`);
							if (approve) {
								await executor.approveWorkspacePreflight(ws.id);
								console.log(chalk.green(`  ✓ ${ws.id} approved`));
							} else {
								const reason = await askText(`Reason for rejecting ${ws.id} (optional, logged for audit):`);
								await executor.rejectWorkspacePreflight(ws.id, reason || undefined);
								// P7.G AC2: Rejected suggestions are logged with reason
								console.log(chalk.red(`  ✗ ${ws.id} rejected${reason ? `: ${reason}` : ""}`));
							}
						}
						console.log("");
					}

					// Reload state after preflight decisions
					await executor.loadState();
					continue;
				} else if (isStuck) {
					// Some workspaces are active, but preflight-blocked workspaces remain
					if (verbose) {
						console.log(
							chalk.dim(`
  ${preflightBlocked.length} workspace(s) awaiting preflight approval.
  Run pi plan approve <ws-id> to approve a workspace.
  Run pi plan reject <ws-id> [reason] to reject.`),
						);
					}
				}
			}

			if (nextWorkspaces.length === 0) {
				// No workspaces ready - check if we're blocked
				const stats = executor.getStatistics();
				const state = executor.getState();
				// 3. Deadlock check gated on state.status === running
				if (stats && stats.blocked > 0 && stats.active === 0 && state?.status === "running") {
					if (!json) {
						console.error(chalk.red("\n✗ Execution blocked - no workspaces can proceed"));
					}
					await executor.failPlan("Execution blocked - dependency deadlock");
					return PlanExitCode.ExecutionError;
				}
				break;
			}

			// Execute next batch
			const results = await Promise.all(nextWorkspaces.map((ws) => executor.executeWorkspace(ws)));

			for (const result of results) {
				if (result.success) {
					completedCount++;
					if (!json) {
						console.log(chalk.green(`✓ ${result.workspaceId} completed`));
					}
				} else if (result.verdict === "FAILED") {
					failedCount++;
					if (!json) {
						console.error(chalk.red(`✗ ${result.workspaceId} failed: ${result.error}`));
					}
				} else if (result.verdict === "BLOCKED") {
					if (verbose && !json) {
						console.log(chalk.yellow(`⟳ ${result.workspaceId} will retry`));
					}
				}
			}
		}

		// Complete execution
		if (failedCount === 0) {
			await executor.completePlan();

			// Check if plan entered awaiting_handoff state (postPlanHandoff enabled)
			const handoffState = await executor.getState();
			if (handoffState?.status === "awaiting_handoff") {
				if (json) {
					console.log(
						JSON.stringify(
							{
								success: true,
								status: "awaiting_handoff",
								completed: completedCount,
								failed: failedCount,
								handoffOptions: ["handoff-commit", "handoff-keep", "handoff-discard"],
							},
							null,
							2,
						),
					);
				} else {
					console.log("");
					console.log(chalk.green(`✓ All workspaces complete — awaiting handoff`));
					console.log(chalk.dim(`Completed: ${completedCount} workspaces`));
					console.log("");
					console.log(chalk.bold("Handoff Options:"));
					console.log(`  ${chalk.cyan("pi plan handoff-commit")}   Commit all changes & finish`);
					console.log(`  ${chalk.cyan("pi plan handoff-keep")}     Return to editing (plan stays running)`);
					console.log(`  ${chalk.cyan("pi plan handoff-discard")}  Discard uncommitted changes & fail plan`);
					console.log("");
					console.log(chalk.dim("Plan will auto-commit after 30 minutes of inactivity"));
				}
				return PlanExitCode.Success;
			}

			if (json) {
				console.log(
					JSON.stringify(
						{
							success: true,
							completed: completedCount,
							failed: failedCount,
						},
						null,
						2,
					),
				);
			} else {
				console.log("");
				console.log(chalk.green(`✓ Plan execution complete`));
				console.log(chalk.dim(`Completed: ${completedCount} workspaces`));
			}
			return PlanExitCode.Success;
		}

		await executor.failPlan(`${failedCount} workspace(s) failed`);
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						completed: completedCount,
						failed: failedCount,
					},
					null,
					2,
				),
			);
		} else {
			console.log("");
			console.error(chalk.red(`✗ Plan execution failed`));
			console.error(chalk.dim(`Completed: ${completedCount}, Failed: ${failedCount}`));
		}
		return PlanExitCode.ExecutionError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Rerun command - re-execute a failed plan, skipping already-completed workspaces.
 *
 * Loads the plan file (required for the workspace queue), finds the existing
 * execution state, and resets failed/blocked workspaces back to pending while
 * keeping completed workspaces untouched. Then resumes the execution loop.
 *
 * This is the recommended way to recover from a failed plan execution without
 * losing the progress of workspaces that already completed successfully.
 *
 * Use --force to also reset blocked workspaces (default: only failed are reset).
 * Use --workers <N> to override the worker count.
 *
 * @param planFile - Path to plan file (same one used for `plan run`)
 * @param options - Command options
 * @returns Exit code
 */
export async function planRerun(planFile: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, verbose = false, force = false } = options;

	try {
		// Resolve plan file path
		const planPath = path.resolve(cwd, planFile);

		// Load and parse plan
		const parseResult = await loadPlan(planPath);

		if (!parseResult.success || !parseResult.queue) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							errors: parseResult.errors,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red("Plan parsing failed\n"));
				console.error(formatParseResult(parseResult));
			}
			return PlanExitCode.ParseError;
		}

		// Load existing state
		const stateStore = new JsonStateStore(cwd);
		const planStateStore = stateStore.getPlanStateStore();
		const currentState = await planStateStore.loadState();

		if (!currentState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No execution state found to rerun" }, null, 2));
			} else {
				console.error(chalk.red("No execution state found to rerun"));
				console.error(chalk.dim("Run 'pi plan run <plan-file>' first to start a plan execution"));
			}
			return PlanExitCode.NotFound;
		}

		// Check plan status is terminal
		if (
			currentState.status !== "failed" &&
			currentState.status !== "stopped" &&
			currentState.status !== "cancelled"
		) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							error: `Plan status is '${currentState.status}'. Rerun only works for failed/stopped/cancelled plans.`,
						},
						null,
						2,
					),
				);
			} else {
				console.log(
					chalk.yellow(
						`Plan status is '${currentState.status}'. Rerun is only for failed/stopped/cancelled plans.`,
					),
				);
				if (currentState.status === "paused") {
					console.error(chalk.dim("Use 'pi plan resume' to resume a paused plan"));
				} else if (currentState.status === "running") {
					console.error(
						chalk.dim("The plan is still running. Use 'pi plan watch' to monitor or 'pi plan pause' to pause."),
					);
				} else if (currentState.status === "complete" || currentState.status === "awaiting_handoff") {
					console.error(
						chalk.dim(
							"The plan already completed successfully. Use 'pi plan run <plan-file>' to start a new execution.",
						),
					);
				}
			}
			return PlanExitCode.StateError;
		}

		// Resolve worker concurrency
		const _workers = options.workers ?? DEFAULT_WORKERS;
		const resolvedWorkerConcurrency = resolveWorkerConcurrencyWithConfirmation(options);
		if (resolvedWorkerConcurrency === null) {
			return PlanExitCode.SafetyError;
		}
		const effectiveWorkers = resolvedWorkerConcurrency.maxWorkers ?? DEFAULT_WORKERS;

		// Create executor and load state
		const executor = createAutonomousExecutor(cwd, effectiveWorkers);
		const planExecutionId = stateStore.getCurrentPlanExecutionId();
		if (!planExecutionId) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No plan execution ID found" }, null, 2));
			} else {
				console.error(chalk.red("No plan execution ID found"));
			}
			return PlanExitCode.StateError;
		}

		// Load state into executor
		await executor.loadState();

		// Perform rerun: reset failed/blocked workspaces, keep completed
		const rerunResult = await executor.rerunExecution(parseResult.queue, {
			resetFailed: true,
			resetBlocked: force, // Only reset blocked with --force
		});

		if (!rerunResult.success) {
			if (json) {
				console.log(
					JSON.stringify(
						{
							success: false,
							error: rerunResult.error,
							reset: rerunResult.resetWorkspaces,
							kept: rerunResult.keptWorkspaces,
						},
						null,
						2,
					),
				);
			} else {
				console.error(chalk.red(`Rerun failed: ${rerunResult.error}`));
			}
			return PlanExitCode.StateError;
		}

		if (!json) {
			console.log(chalk.bold(`Rerunning plan: ${currentState.title}`));
			console.log(chalk.dim(`Phase: ${currentState.phase}`));
			console.log("");
			console.log(chalk.green(`Kept ${rerunResult.keptWorkspaces.length} completed workspace(s)`));
			if (rerunResult.keptWorkspaces.length > 0 && verbose) {
				for (const wsId of rerunResult.keptWorkspaces) {
					console.log(chalk.dim(`  ${wsId} (complete)`));
				}
			}
			console.log(chalk.yellow(`Reset ${rerunResult.resetWorkspaces.length} workspace(s) for re-execution`));
			for (const wsId of rerunResult.resetWorkspaces) {
				const wsState = currentState.workspaces.get(wsId);
				const prevStage = wsState?.stage ?? "unknown";
				console.log(chalk.dim(`  ${wsId} (was: ${prevStage})`));
			}
			console.log("");
		} else {
			console.log(
				JSON.stringify(
					{
						success: true,
						status: "running",
						reset: rerunResult.resetWorkspaces,
						kept: rerunResult.keptWorkspaces,
					},
					null,
					2,
				),
			);
		}

		// Continue execution from the reset state
		let completedCount = 0;
		let failedCount = 0;

		while (!executor.isExecutionComplete()) {
			// Control check at top of loop
			const control = await executor.checkControlRequest();
			if (control) {
				const state = executor.getState();
				if (control.action === "pause" && state?.status === "paused") {
					if (!json) {
						console.log(chalk.yellow("\nPlan paused, waiting for resume..."));
					}
					while (true) {
						await new Promise((resolve) => setTimeout(resolve, 500));
						await executor.loadState();
						const s = executor.getState();
						if (!s || s.status === "stopped" || s.status === "cancelled") {
							break;
						}
						if (s.status === "running") {
							break;
						}
					}
					const finalState = executor.getState();
					if (finalState && (finalState.status === "stopped" || finalState.status === "cancelled")) {
						if (!json) {
							console.log(chalk.yellow("Plan stopped while paused"));
						}
						break;
					}
					if (!json) {
						console.log(chalk.green("Plan resumed"));
					}
					continue;
				}
				if (control.action === "stop" && state?.status === "stopped") {
					if (!json) {
						console.log(chalk.yellow("Plan stopped"));
					}
					break;
				}
			}

			const nextWorkspaces = await executor.getNextWorkspaces(parseResult.queue.workspaces);

			if (nextWorkspaces.length === 0) {
				const stats = executor.getStatistics();
				const state = executor.getState();
				if (stats && stats.blocked > 0 && stats.active === 0 && state?.status === "running") {
					if (!json) {
						console.error(chalk.red("\nExecution blocked - no workspaces can proceed"));
					}
					await executor.failPlan("Execution blocked - dependency deadlock");
					return PlanExitCode.ExecutionError;
				}
				break;
			}

			const results = await Promise.all(nextWorkspaces.map((ws) => executor.executeWorkspace(ws)));

			for (const result of results) {
				if (result.success) {
					completedCount++;
					if (!json) {
						console.log(chalk.green(`+ ${result.workspaceId} completed`));
					}
				} else if (result.verdict === "FAILED") {
					failedCount++;
					if (!json) {
						console.error(chalk.red(`x ${result.workspaceId} failed: ${result.error}`));
					}
				} else if (result.verdict === "BLOCKED") {
					if (verbose && !json) {
						console.log(chalk.yellow(`${result.workspaceId} will retry`));
					}
				}
			}
		}

		// Complete execution
		if (failedCount === 0) {
			await executor.completePlan();

			// Check for awaiting_handoff state
			const handoffState = await executor.getState();
			if (handoffState?.status === "awaiting_handoff") {
				if (json) {
					console.log(
						JSON.stringify(
							{
								success: true,
								status: "awaiting_handoff",
								completed: completedCount,
								failed: failedCount,
								resetWorkspaces: rerunResult.resetWorkspaces,
								keptWorkspaces: rerunResult.keptWorkspaces,
							},
							null,
							2,
						),
					);
				} else {
					console.log("");
					console.log(chalk.green(`All workspaces complete - awaiting handoff`));
					console.log(chalk.dim(`Completed this run: ${completedCount} workspaces`));
				}
				return PlanExitCode.Success;
			}

			if (json) {
				console.log(
					JSON.stringify(
						{
							success: true,
							completed: completedCount,
							failed: failedCount,
							resetWorkspaces: rerunResult.resetWorkspaces,
							keptWorkspaces: rerunResult.keptWorkspaces,
						},
						null,
						2,
					),
				);
			} else {
				console.log("");
				console.log(chalk.green(`Plan rerun complete`));
				console.log(chalk.dim(`Completed this run: ${completedCount} workspaces`));
				console.log(chalk.dim(`Skipped (already done): ${rerunResult.keptWorkspaces.length} workspaces`));
			}
			return PlanExitCode.Success;
		}

		await executor.failPlan(`${failedCount} workspace(s) failed`);
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						completed: completedCount,
						failed: failedCount,
					},
					null,
					2,
				),
			);
		} else {
			console.log("");
			console.error(chalk.red(`Plan rerun failed`));
			console.error(chalk.dim(`Completed: ${completedCount}, Failed: ${failedCount}`));
			console.error(chalk.dim("Use 'pi plan rerun <plan-file>' to try again"));
		}
		return PlanExitCode.ExecutionError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Resume command - resume from persisted state
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planResume(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, force = false } = options;

	try {
		// Load state
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No state to resume" }, null, 2));
			} else {
				console.error(chalk.red("✗ No execution state found to resume"));
				console.error(chalk.dim(`State file: ${path.join(cwd, ".pi", "plan-state.json")}`));
			}
			return PlanExitCode.NotFound;
		}

		if (state.status === "complete") {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "Plan already complete" }, null, 2));
			} else {
				console.log(chalk.yellow("Plan execution already complete"));
			}
			return PlanExitCode.Success;
		}

		// Check if plan is cancelled
		if (state.status === "cancelled" && !force) {
			if (json) {
				console.log(
					JSON.stringify({ success: false, error: "Plan is cancelled. Use --force to resume anyway." }, null, 2),
				);
			} else {
				console.error(chalk.red("✗ Plan is cancelled"));
				console.error(chalk.dim("Use 'pi plan resume --force' to resume anyway (not recommended)"));
			}
			return PlanExitCode.StateError;
		}

		// Clear any pending control requests
		const controlManager = createPlanControlManager(cwd);
		await controlManager.clearControlRequest();

		// Resume the plan
		await stateStore.resumePlan();

		// Create executor and load state
		const executor = createAutonomousExecutor(cwd);
		await executor.loadState();

		// Get workspace definitions from state metadata
		// Note: In a real implementation, we'd need to store the original queue
		// For now, we'll reconstruct from state
		const workspaces = Array.from(state.workspaces.keys()).map((id) => ({
			id,
			title: `Workspace ${id}`,
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		}));

		if (!json) {
			console.log(chalk.bold(`Resuming execution: ${state.title}`));
			console.log(chalk.dim(`Phase: ${state.phase}`));
			if (force && state.status === "cancelled") {
				console.log(chalk.yellow("⚠ Resuming cancelled plan (forced)"));
			}
			console.log("");
		}

		// Continue execution
		let completedCount = 0;
		let failedCount = 0;

		while (!executor.isExecutionComplete()) {
			// 1. Control check at top of while loop before getNextWorkspaces
			const control = await executor.checkControlRequest();
			if (control) {
				const state = executor.getState();
				if (control.action === "pause" && state?.status === "paused") {
					if (!json) {
						console.log(chalk.yellow("\n⏸ Plan paused, waiting for resume..."));
					}
					// 2. Paused status enters 500ms poll-wait loop
					while (true) {
						await new Promise((resolve) => setTimeout(resolve, 500));
						await executor.loadState();
						const s = executor.getState();
						if (!s || s.status === "stopped" || s.status === "cancelled") {
							break;
						}
						if (s.status === "running") {
							// 5. Resume within 1 poll interval
							break;
						}
					}
					const finalState = executor.getState();
					if (finalState && (finalState.status === "stopped" || finalState.status === "cancelled")) {
						// 4. Stop while paused exits cleanly
						if (!json) {
							console.log(chalk.yellow("⏹ Plan stopped while paused"));
						}
						break;
					}
					if (!json) {
						console.log(chalk.green("▶ Plan resumed"));
					}
					continue;
				}
				if (control.action === "stop" && state?.status === "stopped") {
					if (!json) {
						console.log(chalk.yellow("⏹ Plan stopped"));
					}
					break;
				}
			}

			const nextWorkspaces = await executor.getNextWorkspaces(workspaces);

			if (nextWorkspaces.length === 0) {
				break;
			}

			const results = await Promise.all(nextWorkspaces.map((ws) => executor.executeWorkspace(ws)));

			for (const result of results) {
				if (result.success) {
					completedCount++;
					if (!json) {
						console.log(chalk.green(`✓ ${result.workspaceId} completed`));
					}
				} else if (result.verdict === "FAILED") {
					failedCount++;
					if (!json) {
						console.error(chalk.red(`✗ ${result.workspaceId} failed: ${result.error}`));
					}
				}
			}
		}

		if (failedCount === 0) {
			await executor.completePlan();
			if (json) {
				console.log(JSON.stringify({ success: true, completed: completedCount }, null, 2));
			} else {
				console.log("");
				console.log(chalk.green("✓ Plan execution complete"));
			}
			return PlanExitCode.Success;
		}

		if (json) {
			console.log(JSON.stringify({ success: false, failed: failedCount }, null, 2));
		} else {
			console.log("");
			console.error(chalk.red("✗ Plan execution failed"));
		}
		return PlanExitCode.ExecutionError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * One command - execute single workspace
 *
 * @param workspaceId - Workspace ID to execute
 * @param options - Command options
 * @returns Exit code
 */
export async function planOne(workspaceId: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		// Load state
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No state found" }, null, 2));
			} else {
				console.error(chalk.red("✗ No execution state found"));
				console.error(chalk.dim("Run 'pi plan run <plan-file>' first"));
			}
			return PlanExitCode.NotFound;
		}

		// Check if workspace exists
		const wsState = state.workspaces.get(workspaceId);
		if (!wsState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "Workspace not found" }, null, 2));
			} else {
				console.error(chalk.red(`✗ Workspace ${workspaceId} not found in plan`));
			}
			return PlanExitCode.NotFound;
		}

		// Create executor and load state
		const executor = createAutonomousExecutor(cwd);
		await executor.loadState();

		// Create workspace definition
		const workspace = {
			id: workspaceId,
			title: `Workspace ${workspaceId}`,
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		};

		if (!json) {
			console.log(chalk.bold(`Executing workspace: ${workspaceId}`));
			console.log(chalk.dim(`Current stage: ${wsState.stage}`));
			console.log(chalk.dim(`Attempts: ${wsState.attempts}`));
			console.log("");
		}

		// Execute workspace
		const result = await executor.executeWorkspace(workspace);

		if (json) {
			console.log(
				JSON.stringify(
					{
						success: result.success,
						workspaceId: result.workspaceId,
						verdict: result.verdict,
						error: result.error,
					},
					null,
					2,
				),
			);
		} else {
			if (result.success) {
				console.log(chalk.green(`✓ ${result.workspaceId} completed`));
			} else {
				console.error(chalk.red(`✗ ${result.workspaceId} ${result.verdict.toLowerCase()}`));
				if (result.error) {
					console.error(chalk.dim(`Error: ${result.error}`));
				}
			}
		}

		return result.success ? PlanExitCode.Success : PlanExitCode.ExecutionError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Approve command - approve a workspace's preflight requirement
 *
 * @param workspaceId - Workspace ID to approve
 * @param options - Command options
 * @returns Exit code
 */
export async function planApprove(workspaceId: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const executor = createAutonomousExecutor(cwd);
		const loaded = await executor.loadState();
		if (!loaded) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution" }, null, 2));
			} else {
				console.error(chalk.red("\u2717 No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		const state = executor.getState();
		if (!state || !state.workspaces.has(workspaceId)) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: `Workspace ${workspaceId} not found` }, null, 2));
			} else {
				console.error(chalk.red(`\u2717 Workspace ${workspaceId} not found in plan`));
			}
			return PlanExitCode.NotFound;
		}

		await executor.approveWorkspacePreflight(workspaceId);

		if (json) {
			console.log(JSON.stringify({ success: true, workspaceId, action: "approve" }, null, 2));
		} else {
			console.log(chalk.green(`\u2713 Workspace ${workspaceId} preflight approved`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Reject command - reject a workspace's preflight requirement
 *
 * P7.G AC2: Rejected suggestions are logged with reason where available.
 *
 * @param workspaceId - Workspace ID to reject
 * @param reason - Optional reason for rejection
 * @param options - Command options
 * @returns Exit code
 */
export async function planReject(workspaceId: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;
	// The first positional arg after "reject <ws-id>" is parsed in the CLI;
	// additional words require a quoted string: pi plan reject 7.A "reason here"
	// The parsePlanCommand function only captures workspaceId. We accept an
	// optional reason field in options.
	const reason = options.reason;

	try {
		const executor = createAutonomousExecutor(cwd);
		const loaded = await executor.loadState();
		if (!loaded) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution" }, null, 2));
			} else {
				console.error(chalk.red("\u2717 No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		const state = executor.getState();
		if (!state || !state.workspaces.has(workspaceId)) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: `Workspace ${workspaceId} not found` }, null, 2));
			} else {
				console.error(chalk.red(`\u2717 Workspace ${workspaceId} not found in plan`));
			}
			return PlanExitCode.NotFound;
		}

		await executor.rejectWorkspacePreflight(workspaceId, reason);

		if (json) {
			console.log(JSON.stringify({ success: true, workspaceId, action: "reject", reason: reason ?? null }, null, 2));
		} else {
			console.log(chalk.red(`\u2717 Workspace ${workspaceId} preflight rejected${reason ? `: ${reason}` : ""}`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Pause command - request graceful pause
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planPause(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		// Check if plan is running
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (state.status !== "running") {
			if (json) {
				console.log(JSON.stringify({ success: false, error: `Plan is ${state.status}` }, null, 2));
			} else {
				console.log(chalk.yellow(`Plan is already ${state.status}`));
			}
			return PlanExitCode.Success;
		}

		// Write control request
		const controlManager = createPlanControlManager(cwd);
		await controlManager.writeControlRequest("pause", "User requested pause");

		// Log to journal
		await stateStore.appendJournal({
			type: "plan_pause_requested",
			timestamp: Date.now(),
			data: { reason: "User requested pause" },
		});

		if (json) {
			console.log(JSON.stringify({ success: true, action: "pause" }, null, 2));
		} else {
			console.log(chalk.green("✓ Pause request recorded"));
			console.log(chalk.dim("Executor will pause after active workspaces complete"));
			console.log(chalk.dim(`Control file: ${controlManager.getControlFilePath()}`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Stop command - request graceful stop
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planStop(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		// Check if plan is running
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (state.status !== "running" && state.status !== "paused") {
			if (json) {
				console.log(JSON.stringify({ success: false, error: `Plan is ${state.status}` }, null, 2));
			} else {
				console.log(chalk.yellow(`Plan is already ${state.status}`));
			}
			return PlanExitCode.Success;
		}

		// Write control request
		const controlManager = createPlanControlManager(cwd);
		await controlManager.writeControlRequest("stop", "User requested stop");

		// Log to journal
		await stateStore.appendJournal({
			type: "plan_stop_requested",
			timestamp: Date.now(),
			data: { reason: "User requested stop" },
		});

		if (json) {
			console.log(JSON.stringify({ success: true, action: "stop" }, null, 2));
		} else {
			console.log(chalk.green("✓ Stop request recorded"));
			console.log(chalk.dim("Executor will stop gracefully after active workspaces complete"));
			console.log(chalk.dim(`Control file: ${controlManager.getControlFilePath()}`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Cancel command - hard cancellation
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planCancel(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		// Check if plan is running
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (state.status === "cancelled") {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "Plan already cancelled" }, null, 2));
			} else {
				console.log(chalk.yellow("Plan is already cancelled"));
			}
			return PlanExitCode.Success;
		}

		// Write control request
		const controlManager = createPlanControlManager(cwd);
		await controlManager.writeControlRequest("cancel", "User requested cancellation");

		// Log to journal
		await stateStore.appendJournal({
			type: "plan_cancel_requested",
			timestamp: Date.now(),
			data: { reason: "User requested cancellation" },
		});

		// Immediately cancel the plan
		await stateStore.cancelPlan("User requested cancellation");

		// Clear control request after cancellation
		await controlManager.clearControlRequest();

		if (json) {
			console.log(JSON.stringify({ success: true, action: "cancel" }, null, 2));
		} else {
			console.log(chalk.green("✓ Plan cancelled"));
			console.log(chalk.dim("Active workspaces marked as cancelled"));
			console.log(chalk.dim("Use 'pi plan resume --force' to resume (not recommended)"));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Handoff-commit command: finalize plan with rollup commit.
 *
 * Can only be used when plan is in awaiting_handoff state.
 * Triggers rollup commit with all remaining changes, then marks plan complete.
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planHandoffCommit(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const stateStore = new JsonStateStore(cwd);
		const planStateStore = stateStore.getPlanStateStore();
		const currentState = await planStateStore.loadState();

		if (!currentState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution found" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (currentState.status !== "awaiting_handoff") {
			if (json) {
				console.log(
					JSON.stringify(
						{ success: false, error: `Plan is ${currentState.status}, not awaiting handoff` },
						null,
						2,
					),
				);
			} else {
				console.log(chalk.yellow(`Plan is ${currentState.status}, not awaiting handoff`));
			}
			return PlanExitCode.Success;
		}

		// Perform rollup commit
		const autoCommit = new AutoCommit(cwd);
		await autoCommit.commitPlan(currentState.phase, currentState.title);

		// Mark plan complete in state store
		const planExecutionId = stateStore.getCurrentPlanExecutionId();
		if (planExecutionId) {
			await stateStore.handoffCommit(planExecutionId);
		}

		if (json) {
			console.log(JSON.stringify({ success: true, action: "handoff-commit" }, null, 2));
		} else {
			console.log(chalk.green("✓ Handoff committed — plan complete"));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Handoff-keep command: return plan to running status for further editing.
 *
 * Can only be used when plan is in awaiting_handoff state.
 * The plan transitions back to running status without committing or discarding.
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planHandoffKeep(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const stateStore = new JsonStateStore(cwd);
		const planStateStore = stateStore.getPlanStateStore();
		const currentState = await planStateStore.loadState();

		if (!currentState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution found" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (currentState.status !== "awaiting_handoff") {
			if (json) {
				console.log(
					JSON.stringify(
						{ success: false, error: `Plan is ${currentState.status}, not awaiting handoff` },
						null,
						2,
					),
				);
			} else {
				console.log(chalk.yellow(`Plan is ${currentState.status}, not awaiting handoff`));
			}
			return PlanExitCode.Success;
		}

		const planExecutionId = stateStore.getCurrentPlanExecutionId();
		if (planExecutionId) {
			await stateStore.handoffKeepEditing(planExecutionId);
		}

		if (json) {
			console.log(JSON.stringify({ success: true, action: "handoff-keep" }, null, 2));
		} else {
			console.log(chalk.green("✓ Handoff keep editing — plan returned to running status"));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Handoff-discard command: revert uncommitted workspace files and fail the plan.
 *
 * Can only be used when plan is in awaiting_handoff state.
 * Reverts all uncommitted git changes and marks the plan as failed.
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planHandoffDiscard(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const stateStore = new JsonStateStore(cwd);
		const planExecutionId = stateStore.getCurrentPlanExecutionId();

		const planStateStore = stateStore.getPlanStateStore();
		const currentState = await planStateStore.loadState();

		if (!currentState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No active plan execution found" }, null, 2));
			} else {
				console.error(chalk.red("✗ No active plan execution found"));
			}
			return PlanExitCode.NotFound;
		}

		if (currentState.status !== "awaiting_handoff") {
			if (json) {
				console.log(
					JSON.stringify(
						{ success: false, error: `Plan is ${currentState.status}, not awaiting handoff` },
						null,
						2,
					),
				);
			} else {
				console.log(chalk.yellow(`Plan is ${currentState.status}, not awaiting handoff`));
			}
			return PlanExitCode.Success;
		}

		if (planExecutionId) {
			await stateStore.handoffDiscard(planExecutionId, cwd);
		}

		if (json) {
			console.log(JSON.stringify({ success: true, action: "handoff-discard" }, null, 2));
		} else {
			console.log(chalk.red("✗ Handoff discard — changes reverted, plan failed"));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Watch command - observer-only dashboard
 *
 * Re-exported from plan-watch.ts
 */
export { planWatch } from "./plan-watch.js";

import { ReplayMetadataManager } from "../core/replay-metadata.js";

/**
 * Retry command - retry a failed workspace with pre-flight checks.
 *
 * Checks retry eligibility (stage, max retries, dirty tree, safety conflict)
 * before proceeding. Use --force to skip the dirty-tree and safety checks
 * (stage and max-retries checks are always enforced).
 *
 * @param workspaceId - Workspace ID to retry
 * @param options - Command options
 * @returns Exit code
 */
export async function planRetry(workspaceId: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false, force = false } = options;

	try {
		const stateStore = new PlanStateStore(cwd);
		const state = await stateStore.loadState();

		if (!state) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: "No execution state found" }, null, 2));
			} else {
				console.error(chalk.red("No execution state found"));
			}
			return PlanExitCode.NotFound;
		}

		const wsState = state.workspaces.get(workspaceId);
		if (!wsState) {
			if (json) {
				console.log(JSON.stringify({ success: false, error: `Workspace ${workspaceId} not found` }, null, 2));
			} else {
				console.error(chalk.red(`Workspace ${workspaceId} not found in plan`));
			}
			return PlanExitCode.NotFound;
		}

		// Build a workspace definition from state (minimal — used only for eligibility check)
		const workspace: import("../core/workspace-schema.js").Workspace = {
			id: workspaceId,
			title: `Workspace ${workspaceId}`,
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
		};

		const replayManager = new ReplayMetadataManager(cwd);

		if (!force) {
			try {
				await replayManager.gateRetry(workspace, wsState);
			} catch (gateError) {
				if (json) {
					console.log(
						JSON.stringify(
							{
								success: false,
								error: gateError instanceof Error ? gateError.message : String(gateError),
							},
							null,
							2,
						),
					);
				} else {
					console.error(chalk.red(gateError instanceof Error ? gateError.message : String(gateError)));
					console.error(chalk.dim("Use --force to bypass dirty-tree / safety checks (not recommended)"));
				}
				return PlanExitCode.SafetyError;
			}
		}

		// Perform the retry: reset workspace to pending and increment attempt
		await stateStore.transitionWorkspace(wsState.workspaceId, WorkspaceStage.Pending, {
			reason: "retry",
			previousStage: wsState.stage,
		});
		await stateStore.incrementRetryAttempt(wsState.workspaceId);

		// Write replay metadata
		await replayManager.writeWorkspaceReplay(workspace, wsState);

		if (json) {
			console.log(
				JSON.stringify(
					{
						success: true,
						workspaceId,
						attempts: wsState.attempts + 1,
						stage: "pending",
					},
					null,
					2,
				),
			);
		} else {
			console.log(chalk.green(`Retrying workspace ${workspaceId} (attempt ${wsState.attempts + 1})`));
		}

		return PlanExitCode.Success;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Replay dry-run command - read archive without modifying any files.
 *
 * Loads the replay manifest and all per-workspace replay files for the
 * given plan execution, validating consistency and reporting issues.
 * No files are modified; no state transitions are made.
 *
 * @param planExecutionId - Plan execution ID to inspect
 * @param options - Command options
 * @returns Exit code
 */
export async function planReplayDryRun(planExecutionId: string, options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

	try {
		const replayManager = new ReplayMetadataManager(cwd);
		const result = await replayManager.dryRunReplay(planExecutionId);

		if (json) {
			const output: Record<string, unknown> = {
				success: result.success,
				errors: result.errors,
				warnings: result.warnings,
				workspaceCount: result.workspaceReplays.size,
			};
			if (result.manifest) {
				output.phase = result.manifest.phase;
				output.title = result.manifest.title;
				output.status = result.manifest.status;
			}
			console.log(JSON.stringify(output, null, 2));
		} else {
			if (!result.success) {
				console.error(chalk.red("Replay dry-run failed"));
				for (const error of result.errors) {
					console.error(chalk.red(`  Error: ${error}`));
				}
			} else {
				console.log(chalk.green("Replay dry-run OK"));
				if (result.manifest) {
					console.log(chalk.dim(`Plan: ${result.manifest.title}`));
					console.log(chalk.dim(`Phase: ${result.manifest.phase}`));
					console.log(chalk.dim(`Status: ${result.manifest.status}`));
				}
				console.log(chalk.dim(`Workspaces: ${result.workspaceReplays.size}`));
			}
			for (const warning of result.warnings) {
				console.log(chalk.yellow(`  Warning: ${warning}`));
			}
		}

		return result.success ? PlanExitCode.Success : PlanExitCode.ExecutionError;
	} catch (error) {
		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				),
			);
		} else {
			console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		}
		return PlanExitCode.ExecutionError;
	}
}

/**
 * Print plan command help
 */
export function printPlanHelp(): void {
	console.log(chalk.bold("Pi Plan Commands"));
	console.log("");
	console.log("Autonomous multi-agent plan execution");
	console.log("");

	console.log(chalk.bold("Commands:"));
	console.log("  doctor <plan-file>        Validate plan safety");
	console.log("  status                    Show execution status");
	console.log("  dry-run <plan-file>       Validate without execution");
	console.log("  run <plan-file>           Start autonomous execution");
	console.log("  rerun <plan-file>        Re-execute failed plan, skip completed workspaces");
	console.log("  resume                    Resume from persisted state");
	console.log("  one <workspace-id>        Execute single workspace");
	console.log("  retry <workspace-id>      Retry a failed workspace");
	console.log("  replay-dry-run <exec-id>  Read archive without modifying files");
	console.log("  watch                     Observer-only dashboard");
	console.log("  pause                     Pause execution (graceful)");
	console.log("  stop                      Stop execution (graceful)");
	console.log("  cancel                    Cancel execution (hard)");
	console.log("  handoff-commit            Commit handoff and finalize plan");
	console.log("  handoff-keep              Return plan to running status");
	console.log("  handoff-discard           Discard changes and fail plan");
	console.log("  approve <workspace-id>    Approve preflight requirement for workspace");
	console.log("  reject <workspace-id> [reason]  Reject preflight requirement (reason logged)");
	console.log("");

	console.log(chalk.bold("Options:"));
	console.log("  --json                 Output JSON format");
	console.log("  --verbose, -v          Verbose output");
	console.log("  --force, -f            Force operation (bypass safety / dirty-tree checks)");
	console.log("  --workers <N>          Max concurrent workers (1-3 stable, 4-6 experimental, default: 3)");
	console.log("  --cwd <dir>            Working directory");
	console.log("");

	console.log(chalk.bold("Examples:"));
	console.log("  pi plan doctor docs/plan.md");
	console.log("  pi plan dry-run docs/plan.md");
	console.log("  pi plan run docs/plan.md");
	console.log("  pi plan rerun docs/plan.md");
	console.log("  pi plan status");
	console.log("  pi plan resume");
	console.log("  pi plan one 7.A");
	console.log("  pi plan retry 7.A");
	console.log("  pi plan replay-dry-run abc123");
	console.log("  pi plan watch");
	console.log("  pi plan pause");
	console.log("  pi plan stop");
	console.log("  pi plan cancel");
	console.log("  pi plan handoff-commit");
	console.log("  pi plan handoff-keep");
	console.log("  pi plan handoff-discard");
	console.log("  pi plan approve 7.A");
	console.log('  pi plan reject 7.A "Reason: too risky"');
}

// ---------------------------------------------------------------------------
// CLI Interaction Helpers (P7.G)
// ---------------------------------------------------------------------------

/**
 * Ask a yes/no question on the terminal.
 * Returns true for 'y' or 'yes', false for 'n' or 'no'.
 * Keeps asking until a valid answer is given.
 */
function askYesNo(question: string): Promise<boolean> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise<boolean>((resolve) => {
		const ask = () => {
			rl.question(`${chalk.cyan("?")} ${question} ${chalk.dim("(y/n)")} `, (answer) => {
				const trimmed = answer.trim().toLowerCase();
				if (trimmed === "y" || trimmed === "yes") {
					rl.close();
					resolve(true);
				} else if (trimmed === "n" || trimmed === "no") {
					rl.close();
					resolve(false);
				} else {
					console.log(chalk.dim("  Please answer 'y' or 'n'."));
					ask();
				}
			});
		};
		ask();
	});
}

/**
 * Ask for text input on the terminal.
 * Returns the entered text, or empty string if cancelled.
 *
 * @param question - The prompt to show
 * @returns The text entered by the user
 */
function askText(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise<string>((resolve) => {
		rl.question(`${chalk.cyan("?")} ${question} `, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Plan Commands - P2 Workstream 7.K
 *
 * CLI commands for autonomous plan execution:
 * - pi plan doctor <plan-file>  - Validate plan safety
 * - pi plan status              - Show execution status
 * - pi plan dry-run <plan-file> - Validate without execution
 * - pi plan run <plan-file>     - Start autonomous execution
 * - pi plan resume              - Resume from persisted state
 * - pi plan one <workspace-id>  - Execute single workspace
 * - pi plan watch               - Observer-only dashboard
 */

import * as path from "node:path";
import chalk from "chalk";
import { createAutonomousExecutor } from "../core/autonomous-executor.js";
import { formatParseResult, loadPlan } from "../core/plan-parser.js";
import { PlanStateStore } from "../core/plan-state.js";
import { createSafetyDoctor } from "../core/safety-doctor.js";

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
		const doctor = createSafetyDoctor();
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
 * @param planFile - Path to plan file
 * @param options - Command options
 * @returns Exit code
 */
export async function planDryRun(planFile: string, options: PlanCommandOptions = {}): Promise<number> {
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
		const doctor = createSafetyDoctor();
		const safetyReport = doctor.validateQueue(parseResult.queue);

		// Simulate scheduling (no actual execution)
		const executor = createAutonomousExecutor(cwd);
		await executor.initialize(parseResult.queue);

		const state = executor.getState();
		if (!state) {
			throw new Error("Failed to initialize execution state");
		}

		if (json) {
			const workspaces = Array.from(state.workspaces.entries()).map(([id, ws]) => ({
				id,
				stage: ws.stage,
			}));

			console.log(
				JSON.stringify(
					{
						success: safetyReport.safe,
						parse: {
							phase: parseResult.queue.phase,
							title: parseResult.queue.title,
							workspaceCount: parseResult.queue.workspaces.length,
							maxParallel: parseResult.queue.maxParallelWorkspaces,
						},
						safety: {
							safe: safetyReport.safe,
							totalIssues: safetyReport.totalIssues,
							critical: safetyReport.critical.length,
							warnings: safetyReport.warnings.length,
						},
						workspaces,
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

			console.log(chalk.bold(`Plan: ${parseResult.queue.title}`));
			console.log(chalk.dim(`Phase: ${parseResult.queue.phase}`));
			console.log(chalk.dim(`Workspaces: ${parseResult.queue.workspaces.length}`));
			console.log(chalk.dim(`Max Parallel: ${parseResult.queue.maxParallelWorkspaces}`));
			console.log("");

			console.log(doctor.formatReport(safetyReport));

			if (safetyReport.safe) {
				console.log("");
				console.log(chalk.green("✓ Plan is ready for execution"));
				console.log(chalk.dim("Run with: pi plan run <plan-file>"));
			} else {
				console.log("");
				console.log(chalk.red("✗ Plan has safety issues - fix before execution"));
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
 * Parse plan command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed command and arguments
 */
export function parsePlanCommand(args: string[]): {
	command: string | null;
	planFile: string | null;
	workspaceId: string | null;
	options: PlanCommandOptions;
} {
	const result: {
		command: string | null;
		planFile: string | null;
		workspaceId: string | null;
		options: PlanCommandOptions;
	} = {
		command: null,
		planFile: null,
		workspaceId: null,
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
		} else if (arg === "--cwd" && i + 1 < args.length) {
			result.options.cwd = args[++i];
		} else if (!arg.startsWith("-")) {
			// Positional argument
			if (result.command === "doctor" || result.command === "dry-run" || result.command === "run") {
				result.planFile = arg;
			} else if (result.command === "one") {
				result.workspaceId = arg;
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
		const doctor = createSafetyDoctor();
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

		// Initialize executor
		const executor = createAutonomousExecutor(cwd);
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
			const nextWorkspaces = executor.getNextWorkspaces(parseResult.queue.workspaces);

			if (nextWorkspaces.length === 0) {
				// No workspaces ready - check if we're blocked
				const stats = executor.getStatistics();
				if (stats && stats.blocked > 0 && stats.active === 0) {
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
 * Resume command - resume from persisted state
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function planResume(options: PlanCommandOptions = {}): Promise<number> {
	const { cwd = process.cwd(), json = false } = options;

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
			console.log("");
		}

		// Continue execution
		let completedCount = 0;
		let failedCount = 0;

		while (!executor.isExecutionComplete()) {
			const nextWorkspaces = executor.getNextWorkspaces(workspaces);

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
 * Watch command - observer-only dashboard
 *
 * Re-exported from plan-watch.ts
 */
export { planWatch } from "./plan-watch.js";

/**
 * Print plan command help
 */
export function printPlanHelp(): void {
	console.log(chalk.bold("Pi Plan Commands\n"));
	console.log("Autonomous multi-agent plan execution\n");

	console.log(chalk.bold("Commands:"));
	console.log("  doctor <plan-file>     Validate plan safety");
	console.log("  status                 Show execution status");
	console.log("  dry-run <plan-file>    Validate without execution");
	console.log("  run <plan-file>        Start autonomous execution");
	console.log("  resume                 Resume from persisted state");
	console.log("  one <workspace-id>     Execute single workspace");
	console.log("  watch                  Observer-only dashboard");
	console.log("");

	console.log(chalk.bold("Options:"));
	console.log("  --json                 Output JSON format");
	console.log("  --verbose, -v          Verbose output");
	console.log("  --cwd <dir>            Working directory");
	console.log("");

	console.log(chalk.bold("Examples:"));
	console.log("  pi plan doctor docs/plan.md");
	console.log("  pi plan dry-run docs/plan.md");
	console.log("  pi plan run docs/plan.md");
	console.log("  pi plan status");
	console.log("  pi plan resume");
	console.log("  pi plan one 7.A");
	console.log("  pi plan watch");
}

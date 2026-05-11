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

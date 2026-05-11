/**
 * Plan command CLI handler
 *
 * Handles `pi plan` subcommands for P2 autonomous execution.
 */

import {
	parsePlanCommand,
	planCancel,
	planDoctor,
	planDryRun,
	planOne,
	planPause,
	planResume,
	planRun,
	planStatus,
	planStop,
	planWatch,
	printPlanHelp,
} from "./cli/plan-commands.js";

/**
 * Handle plan commands
 *
 * @param args - Command line arguments
 * @returns True if a plan command was handled, false otherwise
 */
export async function handlePlanCommand(args: string[]): Promise<boolean> {
	if (args.length === 0 || args[0] !== "plan") {
		return false;
	}

	const parsed = parsePlanCommand(args.slice(1));

	if (!parsed.command) {
		printPlanHelp();
		process.exit(0);
	}

	const cwd = parsed.options.cwd || process.cwd();
	const json = parsed.options.json || false;
	const verbose = parsed.options.verbose || false;
	const force = parsed.options.force || false;

	let exitCode = 0;

	try {
		switch (parsed.command) {
			case "doctor":
				if (!parsed.planFile) {
					console.error("Error: doctor command requires a plan file");
					printPlanHelp();
					process.exit(1);
				}
				exitCode = await planDoctor(parsed.planFile, { cwd, json, verbose });
				break;

			case "status":
				exitCode = await planStatus({ cwd, json });
				break;

			case "dry-run":
				if (!parsed.planFile) {
					console.error("Error: dry-run command requires a plan file");
					printPlanHelp();
					process.exit(1);
				}
				exitCode = await planDryRun(parsed.planFile, { cwd, json, verbose });
				break;

			case "run":
				if (!parsed.planFile) {
					console.error("Error: run command requires a plan file");
					printPlanHelp();
					process.exit(1);
				}
				exitCode = await planRun(parsed.planFile, { cwd, json, verbose });
				break;

			case "resume":
				exitCode = await planResume({ cwd, json, force });
				break;

			case "one":
				if (!parsed.workspaceId) {
					console.error("Error: one command requires a workspace ID");
					printPlanHelp();
					process.exit(1);
				}
				exitCode = await planOne(parsed.workspaceId, { cwd, json });
				break;

			case "watch":
				await planWatch({ cwd });
				exitCode = 0;
				break;

			case "pause":
				exitCode = await planPause({ cwd, json });
				break;

			case "stop":
				exitCode = await planStop({ cwd, json });
				break;

			case "cancel":
				exitCode = await planCancel({ cwd, json });
				break;

			default:
				console.error(`Error: Unknown plan command: ${parsed.command}`);
				printPlanHelp();
				process.exit(1);
		}
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		exitCode = 1;
	}

	process.exit(exitCode);
}

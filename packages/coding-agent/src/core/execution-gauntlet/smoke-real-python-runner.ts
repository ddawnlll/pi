/**
 * Smoke-Real Python Web App Runner — P38.1.HOTFIX
 *
 * Orchestrates the smoke-real Python web app E2E test:
 * 1. Load markdown task fixtures from test-fixtures/gauntlet/python-webapp/
 * 2. Create empty temp project directory
 * 3. Execute PY1 (backend), PY2 (frontend) — may overlap
 * 4. Execute PY3 (tests/validation) — depends on PY1+PY2
 * 5. Run real Python validation command
 * 6. Start server, perform health check, terminate
 * 7. Report results for stable_3 and patch_transaction modes
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CombinedSummaryBuilder } from "./combined-summary.js";
import type { LiveMonitor } from "./live-monitor.js";
import type { MarkdownTaskSpec, TaskWorkerResult } from "./markdown-task-worker.js";
import { executeMarkdownTask, loadMarkdownTasks, runPythonWebAppValidation } from "./markdown-task-worker.js";
import { ParallelismMonitor } from "./parallelism-monitor.js";
import {
	healthCheck,
	killAllTrackedProcesses,
	startPythonServer,
	stopServer,
	waitForServer,
} from "./python-smoke-runner.js";
import type { ScenarioResult } from "./report-writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmokeRealPythonConfig {
	/** Execution mode */
	mode: "stable_3" | "patch_transaction";
	/** Path to markdown task fixtures */
	fixturesDir: string;
	/** Temp project root directory */
	projectDir: string;
	/** Live monitor instance */
	monitor: LiveMonitor;
	/** Combined summary builder */
	summary: CombinedSummaryBuilder;
	/** Run ID */
	runId: string;
	/** Timeout for the overall run */
	timeoutMs: number;
}

export interface SmokeRealPythonResult {
	mode: string;
	passed: boolean;
	durationMs: number;
	tasks: TaskWorkerResult[];
	validation: {
		command: string;
		exitCode: number;
		passed: boolean;
		outputArtifact: string;
		stdout: string;
		durationMs: number;
	};
	serverHealth: {
		started: boolean;
		port: number;
		healthOk: boolean;
	};
	parallelismSummary: {
		maxObservedActiveWorkers: number;
		averageActiveWorkers: number;
	};
	errors: string[];
	scenarios: ScenarioResult[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runSmokeRealPythonWebApp(config: SmokeRealPythonConfig): Promise<SmokeRealPythonResult> {
	const { mode, fixturesDir, projectDir, monitor, summary } = config;
	const startTime = Date.now();
	const errors: string[] = [];
	const allScenarios: ScenarioResult[] = [];

	await monitor.log(`Smoke-real Python web app started (mode: ${mode})`);
	await monitor.planStart("PYTHON_WEBAPP", mode);

	// -----------------------------------------------------------------------
	// Step 1: Create empty project directory
	// -----------------------------------------------------------------------
	await fs.mkdir(projectDir, { recursive: true });

	// Verify project is empty (no pre-generated solution files)
	const preExistingFiles = await listAllFiles(projectDir);
	if (preExistingFiles.length > 0) {
		errors.push(`Project directory not empty before execution: ${preExistingFiles.join(", ")}`);
	}

	// -----------------------------------------------------------------------
	// Step 2: Load markdown task fixtures
	// -----------------------------------------------------------------------
	await monitor.log("Loading markdown task fixtures...");
	const tasks = await loadMarkdownTasks(fixturesDir);

	if (tasks.length === 0) {
		errors.push("No markdown task fixtures found");
		return buildFailureResult(mode, errors, startTime);
	}

	await monitor.log(`Loaded ${tasks.length} tasks: ${tasks.map((t) => t.id).join(", ")}`);

	// -----------------------------------------------------------------------
	// Step 3: Execute PY1 and PY2 in parallel (stable_3 allows this)
	// -----------------------------------------------------------------------
	const py1 = tasks.find((t) => t.id === "PY1");
	const py2 = tasks.find((t) => t.id === "PY2");
	const py3 = tasks.find((t) => t.id === "PY3");

	const parallelMonitor = new ParallelismMonitor("PYTHON_WEBAPP", mode, 2);
	const taskResults: TaskWorkerResult[] = [];

	// Execute PY1 and PY2 concurrently
	const parallelPromises: Promise<TaskWorkerResult>[] = [];

	if (py1) {
		parallelPromises.push(executeTaskWithMonitor(py1, projectDir, monitor, parallelMonitor));
	}
	if (py2) {
		parallelPromises.push(executeTaskWithMonitor(py2, projectDir, monitor, parallelMonitor));
	}

	if (parallelPromises.length > 0) {
		// Record parallelism snapshot during concurrent execution
		parallelMonitor.sample({
			activeWorkers: parallelPromises.length,
			readyWorkers: 0,
			blockedWorkers: 0,
			completedWorkers: 0,
			failedWorkers: 0,
		});

		const results = await Promise.all(parallelPromises);
		taskResults.push(...results);

		parallelMonitor.sample({
			activeWorkers: 0,
			readyWorkers: 0,
			blockedWorkers: 0,
			completedWorkers: results.length,
			failedWorkers: 0,
		});
	}

	// Check for PY1/PY2 errors
	for (const tr of taskResults) {
		if (tr.exitCode !== 0) {
			errors.push(`Task ${tr.taskId} failed: ${tr.stderr}`);
		}
		await monitor.log(
			`Task ${tr.taskId}: exit=${tr.exitCode}, files=${Object.keys(tr.filesCreated).length}, errors=${tr.errors.length}`,
		);
	}

	// -----------------------------------------------------------------------
	// Step 4: Execute PY3 (depends on PY1+PY2)
	// -----------------------------------------------------------------------
	if (py3 && taskResults.every((t) => t.exitCode === 0)) {
		const py3Result = await executeTaskWithMonitor(py3, projectDir, monitor, parallelMonitor);
		taskResults.push(py3Result);

		if (py3Result.exitCode !== 0) {
			errors.push(`Task PY3 failed: ${py3Result.stderr}`);
		}
	}

	// -----------------------------------------------------------------------
	// Step 5: Run real Python validation
	// -----------------------------------------------------------------------
	await monitor.log("Running Python validation...");
	const validation = await runPythonWebAppValidation(projectDir);

	await monitor.log(
		`Validation: ${validation.passed ? "PASS" : "FAIL"}, exit=${validation.exitCode}, ` +
			`duration=${validation.durationMs}ms`,
	);

	if (!validation.passed) {
		errors.push(`Python validation failed (exit ${validation.exitCode}): ${validation.stderr}`);
	}

	// -----------------------------------------------------------------------
	// Step 6: Start server and perform health check
	// -----------------------------------------------------------------------
	let serverStarted = false;
	let serverPort = 0;
	let healthOk = false;

	if (validation.passed) {
		try {
			await monitor.log("Starting Python backend server...");
			const server = startPythonServer({ cwd: projectDir });

			const { port, url } = await waitForServer(server, 10_000);
			serverPort = port;
			serverStarted = true;

			await monitor.log(`Server started on port ${port}`);

			const health = await healthCheck(url, 5000);
			healthOk = health.ok;
			await monitor.log(`Health check: ${health.ok ? "OK" : "FAILED"}`);

			await stopServer(server);
		} catch (err) {
			errors.push(`Server health check failed: ${String(err)}`);
		}
	}

	// -----------------------------------------------------------------------
	// Step 7: Build combined summary
	// -----------------------------------------------------------------------
	summary.setPythonWebApp({
		tested: true,
		repoPath: projectDir,
		plans: [
			{
				id: "PY1_backend_web_server",
				verdict: taskResults.every((t) => (t.taskId === "PY1" ? t.exitCode === 0 : true)) ? "PASS" : "FAIL",
				workspaces: taskResults
					.filter((t) => t.taskId === "PY1")
					.map((t) => ({
						workspaceId: t.taskId,
						stage: t.exitCode === 0 ? "Complete" : "Failed",
						attempts: 1,
						errorMessage: t.errors.join("; ") || undefined,
					})),
			},
			{
				id: "PY2_frontend",
				verdict: taskResults.every((t) => (t.taskId === "PY2" ? t.exitCode === 0 : true)) ? "PASS" : "FAIL",
				workspaces: taskResults
					.filter((t) => t.taskId === "PY2")
					.map((t) => ({
						workspaceId: t.taskId,
						stage: t.exitCode === 0 ? "Complete" : "Failed",
						attempts: 1,
						errorMessage: t.errors.join("; ") || undefined,
					})),
			},
			{
				id: "PY3_tests_validation",
				verdict: taskResults.every((t) => (t.taskId === "PY3" ? t.exitCode === 0 : true)) ? "PASS" : "FAIL",
				workspaces: taskResults
					.filter((t) => t.taskId === "PY3")
					.map((t) => ({
						workspaceId: t.taskId,
						stage: t.exitCode === 0 ? "Complete" : "Failed",
						attempts: 1,
						errorMessage: t.errors.join("; ") || undefined,
					})),
			},
		],
		validation: {
			command: "python -m unittest discover -s tests -v",
			exitCode: validation.exitCode,
			passed: validation.passed,
			outputArtifact: validation.outputArtifact,
		},
	});

	// -----------------------------------------------------------------------
	// Step 8: Cleanup
	// -----------------------------------------------------------------------
	killAllTrackedProcesses();

	const durationMs = Date.now() - startTime;
	const passed = errors.length === 0 && validation.passed;

	await monitor.planEnd("PYTHON_WEBAPP", passed, durationMs);

	return {
		mode,
		passed,
		durationMs,
		tasks: taskResults,
		validation: {
			command: "python -m unittest discover -s tests -v",
			exitCode: validation.exitCode,
			passed: validation.passed,
			outputArtifact: validation.outputArtifact,
			stdout: validation.stdout,
			durationMs: validation.durationMs,
		},
		serverHealth: {
			started: serverStarted,
			port: serverPort,
			healthOk,
		},
		parallelismSummary: {
			maxObservedActiveWorkers: parallelMonitor.maxObserved,
			averageActiveWorkers: parallelMonitor.average,
		},
		errors,
		scenarios: allScenarios,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function executeTaskWithMonitor(
	task: MarkdownTaskSpec,
	projectDir: string,
	monitor: LiveMonitor,
	parallelMonitor: ParallelismMonitor,
): Promise<TaskWorkerResult> {
	await monitor.log(`Executing task ${task.id} (${task.name})...`);

	parallelMonitor.sample({
		activeWorkers: parallelMonitor.currentActive + 1,
		readyWorkers: 0,
		blockedWorkers: 0,
		completedWorkers: 0,
		failedWorkers: 0,
	});

	const result = await executeMarkdownTask(task, projectDir);

	parallelMonitor.sample({
		activeWorkers: parallelMonitor.currentActive - 1,
		readyWorkers: 0,
		blockedWorkers: 0,
		completedWorkers: 1,
		failedWorkers: result.exitCode !== 0 ? 1 : 0,
	});

	return result;
}

async function listAllFiles(dir: string): Promise<string[]> {
	const result: string[] = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				result.push(...(await listAllFiles(full)));
			} else {
				result.push(full);
			}
		}
	} catch {
		// Directory may not exist yet
	}
	return result;
}

function buildFailureResult(mode: string, errors: string[], startTime: number): SmokeRealPythonResult {
	return {
		mode,
		passed: false,
		durationMs: Date.now() - startTime,
		tasks: [],
		validation: {
			command: "python -m unittest discover -s tests -v",
			exitCode: -1,
			passed: false,
			outputArtifact: "",
			stdout: "",
			durationMs: 0,
		},
		serverHealth: { started: false, port: 0, healthOk: false },
		parallelismSummary: { maxObservedActiveWorkers: 0, averageActiveWorkers: 0 },
		errors,
		scenarios: [],
	};
}

/**
 * Monte Carlo Runner — P38.1
 *
 * Runs scenarios multiple times with randomized timing/event order
 * to catch race conditions and non-deterministic failures.
 *
 * Randomizes:
 * - Worker completion order
 * - Late completion delays
 * - Command failure types
 * - Command history presence
 * - Retry counts
 *
 * Monte Carlo is seeded, replayable, bounded, and cheap.
 * Only runs after deterministic tests pass.
 */

import * as path from "node:path";
import type { LeadAgent } from "../lead-agent/lead-agent.js";
import { runDeterministicScenario } from "./deterministic-runner.js";
import type { LiveMonitor } from "./live-monitor.js";
import { saveReplay } from "./replay.js";
import type { ScenarioResult } from "./report-writer.js";
import type { GauntletPlan } from "./synthetic-plan-builder.js";
import type { SyntheticRepo } from "./synthetic-repo.js";
import { createRng } from "./synthetic-worker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonteCarloConfig {
	plans: GauntletPlan[];
	seed: number;
	iterations: number;
	executionModes: Array<"stable_3" | "patch_transaction">;
	repo: SyntheticRepo;
	monitor: LiveMonitor;
	createLeadAgent?: () => LeadAgent;
	timeoutMs: number;
	/** Directory for replay files */
	reportDir: string;
	runId: string;
}

export interface MonteCarloResult {
	seed: number;
	iterations: number;
	scenarioResults: ScenarioResult[];
	failedScenarios: Array<{
		planId: string;
		iteration: number;
		replayPath: string;
		failureReason: string;
	}>;
	overallPassed: boolean;
	totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Monte Carlo Runner
// ---------------------------------------------------------------------------

export async function runMonteCarlo(config: MonteCarloConfig): Promise<MonteCarloResult> {
	const { plans, seed, iterations, executionModes, repo, monitor, createLeadAgent, timeoutMs, runId } = config;

	const startTime = Date.now();
	const rng = createRng(seed);

	const allScenarioResults: ScenarioResult[] = [];
	const failedScenarios: MonteCarloResult["failedScenarios"] = [];

	let replayIndex = 0;

	for (let iter = 0; iter < iterations; iter++) {
		// Check timeout
		if (Date.now() - startTime > timeoutMs) {
			await monitor.log(`Monte Carlo timeout at iteration ${iter}/${iterations}`);
			break;
		}

		await monitor.iterationStart(iter + 1, iterations);

		// Shuffle plans deterministically for this iteration
		const iterSeed = seed + iter * 1000;
		const shuffledPlans = shuffleWithRng(plans, rng);

		for (const plan of shuffledPlans) {
			const mode = executionModes.includes(plan.executionMode) ? plan.executionMode : executionModes[0];

			// Randomize worker order within the plan (only for plans without internal deps)
			const hasInternalDeps = plan.workspaces.some((ws) => (ws.dependsOn?.length ?? 0) > 0);
			const randomizedPlan: GauntletPlan = {
				...plan,
				workspaces: hasInternalDeps
					? [...plan.workspaces] // Don't shuffle plans with dependencies
					: shuffleWithRng([...plan.workspaces], rng),
			};

			// Add randomized seed offsets (timing variations only, not behavior changes)
			randomizedPlan.workspaces = randomizedPlan.workspaces.map((ws, _i) => ({
				...ws,
				seedOffset: (ws.seedOffset ?? 0) + iter * 10 + Math.floor(rng() * 100),
			}));

			const scenarioResult = await runDeterministicScenario({
				plan: randomizedPlan,
				seed: iterSeed,
				mode,
				repo,
				monitor,
				createLeadAgent,
				timeoutMs: timeoutMs - (Date.now() - startTime),
			});

			allScenarioResults.push(scenarioResult);
			await monitor.iterationEnd(iter + 1, scenarioResult.passed);

			if (!scenarioResult.passed) {
				replayIndex++;
				const replayPath = path.join(config.reportDir, "replays", `failed-scenario-${replayIndex}.json`);

				await saveReplay(replayPath, {
					runId,
					plan: randomizedPlan,
					seed: iterSeed,
					failureReason: scenarioResult.errors.join("; ") || "Invariant check failed",
					context: {
						iteration: iter,
						invariantResults: scenarioResult.invariantResults.filter((i) => !i.passed),
					},
				});

				failedScenarios.push({
					planId: plan.id,
					iteration: iter,
					replayPath,
					failureReason: scenarioResult.errors.join("; ") || "Invariant check failed",
				});
			}

			// Check timeout between scenarios too
			if (Date.now() - startTime > timeoutMs) break;
		}

		if (Date.now() - startTime > timeoutMs) break;
	}

	const totalDurationMs = Date.now() - startTime;
	const overallPassed = failedScenarios.length === 0;

	return {
		seed,
		iterations,
		scenarioResults: allScenarioResults,
		failedScenarios,
		overallPassed,
		totalDurationMs,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

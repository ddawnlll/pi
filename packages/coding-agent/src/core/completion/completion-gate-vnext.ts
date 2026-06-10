/**
 * P44.5.02 — CompletionGate vNext Stage Orchestrator
 *
 * Runs durability stages in deterministic order and aggregates verdicts.
 * The orchestrator is the entry point for the CompletionGate vNext pipeline.
 *
 * Execution flow:
 * 1. Run each stage in STAGE_ORDER
 * 2. Collect stage verdicts
 * 3. Aggregate overall verdict
 * 4. Route through rollout adapter
 *
 * Contract Schema: 4.1.1
 */

import type { Workspace } from "../../core/workspace-schema.js";
import { evaluateThroughAdapter, shouldUseVNextMode } from "./completion-gate-vnext-adapter.js";
import {
	type CompletionGateStageName,
	type CompletionGateVNextVerdict,
	type RolloutMode,
	STAGE_ORDER,
	type StageVerdict,
} from "./completion-gate-vnext-types.js";

// ---------------------------------------------------------------------------
// Stage Runner Type
// ---------------------------------------------------------------------------

/**
 * A stage runner function that evaluates a single stage and returns a verdict.
 */
export type StageRunner = (
	stage: CompletionGateStageName,
	workspace: Workspace,
	context: StageExecutionContext,
) => Promise<StageVerdict> | StageVerdict;

/**
 * Execution context passed to each stage runner.
 * Contains the plan spec, workspace state, and accumulated results.
 */
export interface StageExecutionContext {
	/** Plan identifier */
	planId: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Current rollout mode */
	rolloutMode: RolloutMode;
	/** Required rollout mode for this workspace (if any) */
	requiredMode?: RolloutMode;
	/** Previous stage verdicts accumulated so far (for cross-stage checks) */
	previousVerdicts?: StageVerdict[];
	/** Runtime facts available for commit message composition */
	runtimeFacts?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stage Runner Registry
// ---------------------------------------------------------------------------

/**
 * Registry of stage runners keyed by stage name.
 * Stages not registered default to unknown (non-blocking).
 */
export class StageRunnerRegistry {
	private runners = new Map<CompletionGateStageName, StageRunner>();

	/**
	 * Register a stage runner for the given stage name.
	 */
	register(stage: CompletionGateStageName, runner: StageRunner): void {
		this.runners.set(stage, runner);
	}

	/**
	 * Get a registered stage runner.
	 */
	get(stage: CompletionGateStageName): StageRunner | undefined {
		return this.runners.get(stage);
	}

	/**
	 * Remove a stage runner (for testing or override).
	 */
	unregister(stage: CompletionGateStageName): void {
		this.runners.delete(stage);
	}

	/**
	 * Get all registered stage names.
	 */
	get registeredStages(): CompletionGateStageName[] {
		return [...this.runners.keys()];
	}
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the CompletionGate vNext pipeline.
 *
 * @param workspace - The workspace being evaluated
 * @param stageRunners - Registry of stage runner functions
 * @param context - Execution context
 * @returns Aggregated gate verdict
 */
export async function runCompletionGateVNext(
	workspace: Workspace,
	stageRunners: StageRunnerRegistry,
	context: StageExecutionContext,
): Promise<CompletionGateVNextVerdict> {
	const startTime = Date.now();

	// If mode is "off", return a skipped verdict
	if (!shouldUseVNextMode(context.rolloutMode)) {
		return {
			workspaceId: context.workspaceId,
			planId: context.planId,
			passed: true,
			rolloutMode: context.rolloutMode,
			blockReasons: [],
			warnings: [],
			stageVerdicts: [],
			evaluated: false,
			evaluatedAt: Date.now(),
			durationMs: Date.now() - startTime,
		};
	}

	const stageVerdicts: StageVerdict[] = [];
	const allBlockReasons: string[] = [];
	const allWarnings: string[] = [];
	let pipelineFailed = false;

	for (const stageName of STAGE_ORDER) {
		const runner = stageRunners.get(stageName);
		if (!runner) {
			// Unregistered stage: treat as passed with warning (not blocking)
			stageVerdicts.push({
				stage: stageName,
				passed: true,
				warning: true,
				detail: { note: "stage not registered — skipped" },
				blockReasons: [],
				warnings: [`Stage ${stageName} has no runner configured`],
				evaluatedAt: Date.now(),
				durationMs: 0,
			});
			continue;
		}

		const verdict = await runner(stageName, workspace, {
			...context,
			previousVerdicts: context.previousVerdicts ?? [...stageVerdicts],
		});

		stageVerdicts.push(verdict);

		if (!verdict.passed) {
			pipelineFailed = true;
			allBlockReasons.push(...verdict.blockReasons);
		}

		if (verdict.warnings.length > 0) {
			allWarnings.push(...verdict.warnings);
		}
	}

	const rawVerdict: CompletionGateVNextVerdict = {
		workspaceId: context.workspaceId,
		planId: context.planId,
		passed: !pipelineFailed,
		rolloutMode: context.rolloutMode,
		blockReasons: allBlockReasons,
		warnings: allWarnings,
		stageVerdicts,
		evaluated: true,
		evaluatedAt: Date.now(),
		durationMs: Date.now() - startTime,
	};

	// Route through rollout adapter
	return evaluateThroughAdapter(rawVerdict, {
		rolloutMode: context.rolloutMode,
		requiredMode: context.requiredMode,
	});
}

/**
 * Create a default stage runner registry with placeholders for all stages.
 * Real runners are registered by their respective workspaces.
 */
export function createDefaultStageRegistry(): StageRunnerRegistry {
	return new StageRunnerRegistry();
}

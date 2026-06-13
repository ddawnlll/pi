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
import { readAccpGateVerdictFromStore, runAccpGateStage } from "../accp-gate-stage-runner.js";
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
	workspace: Workspace | Record<string, unknown>,
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
	workspace: Workspace | Record<string, unknown>,
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
			// Unregistered stage: fail-closed in strict rollout modes.
			// In warn/legacy modes we keep a non-blocking warning so existing
			// plans do not regress, but any required mode must block.
			const isStrict = isStrictRollout(context.rolloutMode);
			stageVerdicts.push({
				stage: stageName,
				passed: !isStrict,
				warning: !isStrict,
				detail: {
					note: isStrict
						? `Stage ${stageName} is required but no runner is registered — failing closed`
						: "stage not registered — skipped",
				},
				blockReasons: isStrict ? [`Stage ${stageName} is required but no runner is registered`] : [],
				warnings: isStrict ? [] : [`Stage ${stageName} has no runner configured`],
				evaluatedAt: Date.now(),
				durationMs: 0,
			});
			if (isStrict) {
				pipelineFailed = true;
			}
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

/**
 * Create the PRODUCTION stage runner registry with all required stages
 * pre-registered. This is the registry that production completion paths
 * MUST use. AccpGate is wired to runAccpGateStage by default.
 *
 * Callers can still register additional/override runners before running
 * the gate; the production defaults are the floor.
 */
export function createProductionStageRegistry(): StageRunnerRegistry {
	const registry = new StageRunnerRegistry();
	// P49.31 FIX-002: Wire ACCP gate runner in production. The runner reads
	// a verdict from the AccpArtifactStore when ACCP mode is required.
	registry.register("AccpGate", (stage, workspace, ctx) => {
		const verdict = readAccpVerdictFromContext(ctx, workspace) ?? readAccpVerdictFromStore(ctx) ?? undefined;
		return runAccpGateStage(stage, workspace, {
			modeRequired: isAccpModeRequired(ctx),
			verdict: verdict ?? undefined,
		});
	});
	return registry;
}

function isStrictRollout(mode: RolloutMode | undefined): boolean {
	return mode === "block_strict_plans" || mode === "block_all_stable_3";
}

function isAccpModeRequired(ctx: StageExecutionContext): boolean {
	// The runtime may surface ACCP required-ness through runtimeFacts or
	// through the explicit requiredMode. We default to true when the
	// required mode is at least block_strict_plans.
	return isStrictRollout(ctx.rolloutMode) || isStrictRollout(ctx.requiredMode);
}

function readAccpVerdictFromContext(
	ctx: StageExecutionContext,
	workspace: Workspace | Record<string, unknown>,
): import("@earendil-works/pi-execution-contracts").AccpGateVerdict | undefined {
	const facts = ctx.runtimeFacts ?? {};
	const verdict = (facts as { accpGateVerdict?: import("@earendil-works/pi-execution-contracts").AccpGateVerdict })
		.accpGateVerdict;
	if (verdict) return verdict;
	const workspaceFact = (
		workspace as { accpGateVerdict?: import("@earendil-works/pi-execution-contracts").AccpGateVerdict }
	).accpGateVerdict;
	return workspaceFact;
}

function readAccpVerdictFromStore(
	ctx: StageExecutionContext,
): import("@earendil-works/pi-execution-contracts").AccpGateVerdict | null | undefined {
	const facts = (ctx.runtimeFacts ?? {}) as {
		planId?: string;
		reportId?: string;
		accpArtifactRoot?: string;
	};
	if (!facts.planId || !facts.reportId) return undefined;
	try {
		return readAccpGateVerdictFromStore(facts.planId, facts.reportId, facts.accpArtifactRoot ?? "reports/accp");
	} catch {
		return undefined;
	}
}

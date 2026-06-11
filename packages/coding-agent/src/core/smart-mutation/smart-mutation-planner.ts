/**
 * P44.6.11 — SmartMutation Planner Contract
 *
 * Enforces the separation of inspect/audit phase from patch phase.
 * A mutation plan is compiled as a read-only artifact BEFORE any
 * file modification occurs. No file mutation is permitted during
 * the planning phase.
 *
 * Contract Schema: 4.1.1
 */

import { type EngineConfig, EngineMode, type SmartEditConfig } from "../mode/engine-mode.js";
import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Mutation Plan Phase
// ---------------------------------------------------------------------------

export type MutationPlanPhase = "inspect" | "audit" | "patch";

// ---------------------------------------------------------------------------
// Planned Mutation
// ---------------------------------------------------------------------------

export interface PlannedMutation {
	/** File to mutate. */
	targetPath: string;
	/** Description of the planned change. */
	description: string;
	/** Audit finding IDs this mutation addresses. */
	addressedFindings: string[];
	/** What to preserve during mutation. */
	preserveConstraints: string[];
}

// ---------------------------------------------------------------------------
// Mutation Plan
// ---------------------------------------------------------------------------

export interface MutationPlan extends DiagnosticCollection {
	/** The current phase. */
	phase: MutationPlanPhase;
	/** All planned mutations (read-only during inspect/audit). */
	plannedMutations: PlannedMutation[];
	/** Whether the plan is ready for the patch phase. */
	readyForPatch: boolean;
}

// ---------------------------------------------------------------------------
// Plan Compilation
// ---------------------------------------------------------------------------

export function createMutationPlan(config: EngineConfig, _envelope: TaskIntentEnvelope): MutationPlan {
	const diagnostics: ModeDiagnostic[] = [];

	if (config.mode !== EngineMode.SmartEdit) {
		return {
			phase: "inspect",
			plannedMutations: [],
			readyForPatch: false,
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: "Mutation plan requires EngineMode.SmartEdit.",
				},
			],
		};
	}

	const smartEditConfig = config as SmartEditConfig;

	if (!smartEditConfig.targetPath) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_MISSING_TARGET",
			message: "SmartEdit requires a target path for the mutation plan.",
		});
		return { phase: "inspect", plannedMutations: [], readyForPatch: false, diagnostics };
	}

	// Phase 1: Inspect — build the plan (read-only)
	const plannedMutations: PlannedMutation[] = [
		{
			targetPath: smartEditConfig.targetPath,
			description: `Smart mutation on '${smartEditConfig.targetPath}' with audit scope: ${smartEditConfig.auditScope.join(", ")}`,
			addressedFindings: [],
			preserveConstraints: [],
		},
	];

	return {
		phase: "inspect",
		plannedMutations,
		readyForPatch: false,
		diagnostics: [
			{
				severity: "warning",
				code: "WARN_MISSING_CONSTRAINTS",
				message:
					"Mutation plan created in inspect phase. No file mutations have been applied. Transition to audit phase to analyze findings, then to patch phase to apply changes.",
			},
		],
	};
}

/**
 * Transition the mutation plan from inspect to audit phase.
 * This is a read-only operation — no file mutation occurs.
 */
export function transitionToAudit(plan: MutationPlan): MutationPlan {
	if (plan.phase !== "inspect") {
		return {
			...plan,
			diagnostics: [
				...plan.diagnostics,
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: `Cannot transition from '${plan.phase}' to 'audit'. Must be in 'inspect' phase.`,
				},
			],
		};
	}

	return {
		...plan,
		phase: "audit",
		diagnostics: [
			...plan.diagnostics,
			{
				severity: "warning",
				code: "WARN_MISSING_CONSTRAINTS",
				message: "Mutation plan transitioned to audit phase. Analyze findings — no mutations applied yet.",
			},
		],
	};
}

/**
 * Transition the mutation plan from audit to patch phase.
 * File mutation is now permitted.
 */
export function transitionToPatch(plan: MutationPlan, findings: string[]): MutationPlan {
	if (plan.phase !== "audit") {
		return {
			...plan,
			diagnostics: [
				...plan.diagnostics,
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: `Cannot transition from '${plan.phase}' to 'patch'. Must be in 'audit' phase.`,
				},
			],
		};
	}

	const updatedMutations = plan.plannedMutations.map((m) => ({
		...m,
		addressedFindings: findings,
	}));

	return {
		...plan,
		phase: "patch",
		plannedMutations: updatedMutations,
		readyForPatch: true,
		diagnostics: [
			...plan.diagnostics,
			{
				severity: "warning",
				code: "WARN_MISSING_CONSTRAINTS",
				message: `Mutation plan transitioned to patch phase. ${findings.length} findings addressed. Mutations are now permitted.`,
			},
		],
	};
}

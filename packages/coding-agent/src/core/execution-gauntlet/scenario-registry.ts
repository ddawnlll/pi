/**
 * Scenario Registry — P38.1
 *
 * Maps gauntlet plans to execution-ready scenarios.
 * Each scenario bundles a plan with its synthetic worker configuration
 * and expected invariants.
 *
 * The registry ensures all required G1-G12 plans are available
 * and discoverable by the deterministic and Monte Carlo runners.
 */

import type { GauntletPlan } from "./synthetic-plan-builder.js";
import { ALL_PLANS } from "./synthetic-plan-builder.js";
import type { SyntheticWorkerBehavior } from "./synthetic-worker.js";

// ---------------------------------------------------------------------------
// Scenario definition
// ---------------------------------------------------------------------------

export interface GauntletScenario {
	/** Scenario ID (matches plan ID) */
	id: string;
	/** The plan definition */
	plan: GauntletPlan;
	/** Execution mode for this scenario */
	executionMode: "stable_3" | "patch_transaction";
	/** Whether this scenario expects the plan to complete successfully */
	expectsSuccess: boolean;
	/** Whether this scenario exercises the completion gate */
	testsCompletionGate: boolean;
	/** Whether this scenario exercises the Lead Agent */
	testsLeadAgent: boolean;
	/** Whether this scenario exercises stop/continue */
	testsStopContinue: boolean;
	/** Whether this scenario exercises patch transactions */
	testsPatchTransaction: boolean;
	/** Whether this scenario exercises final validation/repair */
	testsFinalValidation: boolean;
	/** Whether this scenario exercises FSM transitions */
	testsFSM: boolean;
	/** Whether this scenario exercises parallelism */
	testsParallelism: boolean;
	/** Required behaviors for this scenario */
	requiredBehaviors: SyntheticWorkerBehavior[];
}

// ---------------------------------------------------------------------------
// Scenario Registry
// ---------------------------------------------------------------------------

export class ScenarioRegistry {
	private scenarios: Map<string, GauntletScenario> = new Map();

	constructor() {
		this.registerAll();
	}

	private registerAll(): void {
		for (const plan of ALL_PLANS) {
			this.register(plan);
		}
	}

	private register(plan: GauntletPlan): void {
		const scenario: GauntletScenario = {
			id: plan.id,
			plan,
			executionMode: plan.executionMode,
			expectsSuccess: plan.expected.planCompletes === true,
			testsCompletionGate:
				plan.expected.completionGateBlocks === true || plan.expected.noTestsFoundClassified === true,
			testsLeadAgent: plan.expected.leadDirectiveCreated === true || plan.expected.userEscalationCreated === true,
			testsStopContinue: plan.expected.staleCompletionIgnored === true,
			testsPatchTransaction:
				plan.expected.noDirectMutation === true || plan.expected.patchRejectedOrHandoff === true,
			testsFinalValidation: plan.expected.finalValidationPasses === true || plan.expected.finalRepairPasses === true,
			testsFSM: plan.category === "fsm",
			testsParallelism:
				plan.expected.minObservedParallelism !== undefined || plan.expected.maxParallelism !== undefined,
			requiredBehaviors: plan.workspaces.map((w) => w.behavior),
		};

		this.scenarios.set(scenario.id, scenario);
	}

	/** Get a specific scenario by ID */
	get(id: string): GauntletScenario | undefined {
		return this.scenarios.get(id);
	}

	/** Get all registered scenarios */
	getAll(): GauntletScenario[] {
		return Array.from(this.scenarios.values());
	}

	/** Get scenarios filtered by properties */
	getFiltered(filter: {
		executionMode?: "stable_3" | "patch_transaction";
		testsCompletionGate?: boolean;
		testsLeadAgent?: boolean;
		testsStopContinue?: boolean;
		testsPatchTransaction?: boolean;
		testsFinalValidation?: boolean;
		testsFSM?: boolean;
		testsParallelism?: boolean;
		expectsSuccess?: boolean;
	}): GauntletScenario[] {
		return this.getAll().filter((s) => {
			if (filter.executionMode !== undefined && s.executionMode !== filter.executionMode) return false;
			if (filter.testsCompletionGate !== undefined && s.testsCompletionGate !== filter.testsCompletionGate)
				return false;
			if (filter.testsLeadAgent !== undefined && s.testsLeadAgent !== filter.testsLeadAgent) return false;
			if (filter.testsStopContinue !== undefined && s.testsStopContinue !== filter.testsStopContinue) return false;
			if (filter.testsPatchTransaction !== undefined && s.testsPatchTransaction !== filter.testsPatchTransaction)
				return false;
			if (filter.testsFinalValidation !== undefined && s.testsFinalValidation !== filter.testsFinalValidation)
				return false;
			if (filter.testsFSM !== undefined && s.testsFSM !== filter.testsFSM) return false;
			if (filter.testsParallelism !== undefined && s.testsParallelism !== filter.testsParallelism) return false;
			if (filter.expectsSuccess !== undefined && s.expectsSuccess !== filter.expectsSuccess) return false;
			return true;
		});
	}

	/** Check if all required plans are registered */
	requires(): string[] {
		const required = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"];
		return required.filter((id) => !this.scenarios.has(id));
	}

	/** Number of registered scenarios */
	get count(): number {
		return this.scenarios.size;
	}
}

/** Singleton registry instance */
let _defaultRegistry: ScenarioRegistry | null = null;

export function getScenarioRegistry(): ScenarioRegistry {
	if (!_defaultRegistry) {
		_defaultRegistry = new ScenarioRegistry();
	}
	return _defaultRegistry;
}

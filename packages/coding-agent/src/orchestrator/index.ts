/**
 * Orchestrator - P11
 *
 * Always-on orchestrator daemon types, mutation guard, and proposal
 * generation for continuous self-improvement.
 *
 * @packageDocumentation
 */

export * from "./orchestrator-types.js";
export * from "./mutation-guard.js";

export {
	createOrchestratorProposalGenerator,
	OrchestratorProposalGenerator,
	type OrchestratorProposalGeneratorConfig,
} from "./orchestrator-proposal-generator.js";

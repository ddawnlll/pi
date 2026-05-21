/**
 * Plan Factory — P17.A
 *
 * Converts approved proposals into executable phase plans with workstream
 * definitions, dependency graphs, batch layouts, and JSON execution contracts.
 *
 * @packageDocumentation
 */

export { PlanFactory } from "./engine.js";
export type { ParsedTemplate, RequiredSegment, TemplateData } from "./template.js";
export { MasterTemplateIntegration } from "./template.js";
export type {
	PlanExecutionContract,
	PlanFactoryConfig,
	PlanFactoryInput,
	PlanFactoryOutput,
	ProposalAnalysis,
	ValidationResult2,
	WorkstreamDef,
} from "./types.js";

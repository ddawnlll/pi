/**
 * Proposal Generator — P16.B
 *
 * Generates proposals from triggers: observation accumulation, memory
 * pattern detection, goal alignment scans, plan completion signals,
 * and safety signals.
 *
 * Each proposal includes evidence references, risk assessment, and
 * structured content for downstream consumption (scoring, deduplication,
 * inbox). Evidence validation rejects proposals with missing refs.
 *
 * Acceptance Criteria:
 * 1. Observation trigger: accumulates N observations -> generates proposal
 * 2. Memory trigger: detects pattern -> generates proposal
 * 3. Goal trigger: aligns goals with observations -> generates proposal
 * 4. Plan completion trigger: generates reflection proposal
 * 5. Evidence validation rejects proposals with missing refs
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { GoalRecord } from "../goals/types.js";
import type { MemoryRecord, MemorySourceRef } from "../memory/types.js";
import type { BrainObservation } from "../types.js";
import {
	type Proposal,
	type ProposalCreateInput,
	type ProposalEvidence,
	type ProposalRiskAssessment,
	type ProposalStore,
	type ProposalType,
	validateProposalCreateInput,
	validateProposalEvidence,
} from "./types.js";

export type { ProposalStore };

// ---------------------------------------------------------------------------
// Logger stub (replace with PiLogger when available in brain modules)
// ---------------------------------------------------------------------------

function logDebug(module: string, msg: string, ...args: unknown[]): void {
	if (process.env.DEBUG?.includes("proposal-generator")) {
		console.error(`[${module}] ${msg}`, ...args);
	}
}

function logInfo(module: string, msg: string, ...args: unknown[]): void {
	if (process.env.DEBUG?.includes("proposal-generator")) {
		console.error(`[${module}] ${msg}`, ...args);
	}
}

function logWarn(module: string, msg: string, ...args: unknown[]): void {
	console.error(`[${module}] WARN: ${msg}`, ...args);
}

function logError(module: string, msg: string, ...args: unknown[]): void {
	console.error(`[${module}] ERROR: ${msg}`, ...args);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the proposal generator.
 */
export interface GeneratorConfig {
	/** Number of observations to accumulate before generating a proposal (default: 5) */
	observationAccumulationThreshold: number;
	/** Window in hours for detecting memory patterns (default: 72) */
	memoryPatternWindowHours: number;
	/** Interval in hours between goal alignment scans (default: 24) */
	goalAlignmentScanIntervalHours: number;
	/** Cooldown period in hours for same-type proposals (default: 24) */
	cooldownHours: number;
	/** Maximum proposals generated per batch (default: 3) */
	maxProposalsPerBatch: number;
	/** Whether auto-generation is enabled (default: false) */
	enableAutoGeneration: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
	observationAccumulationThreshold: 5,
	memoryPatternWindowHours: 72,
	goalAlignmentScanIntervalHours: 24,
	cooldownHours: 24,
	maxProposalsPerBatch: 3,
	enableAutoGeneration: false,
};

// ---------------------------------------------------------------------------
// Trigger Types
// ---------------------------------------------------------------------------

/**
 * A trigger that initiates proposal generation.
 */
export type GenerationTrigger =
	| { type: "observations"; observationIds: string[] }
	| { type: "memory_pattern"; memoryIds: string[]; pattern: string }
	| { type: "goal_alignment"; goalIds: string[]; observationIds: string[] }
	| { type: "plan_completion"; planExecId: string; reflectionId: string }
	| { type: "safety_signal"; signal: string; observationIds: string[] }
	| { type: "manual"; userId: string; input: string };

// ---------------------------------------------------------------------------
// Reflection Report (stand-in, will be replaced by P17 types)
// ---------------------------------------------------------------------------

/**
 * A reflection report generated from plan completion.
 *
 * @internal This is a preliminary type. When P17 reflection types are
 * defined, this should align with the canonical ReflectionReport type.
 */
export interface ReflectionReport {
	/** Unique reflection identifier */
	id: string;
	/** ID of the plan execution that triggered this reflection */
	planExecId: string;
	/** ISO 8601 timestamp of the reflection */
	timestamp: string;
	/** Summary of what happened */
	summary: string;
	/** Key lessons learned */
	lessons: string[];
	/** What could be improved */
	improvements: string[];
	/** Confidence in this reflection (0-1) */
	confidence: number;
}

// ---------------------------------------------------------------------------
// Deduplication interface (P16.D — will be implemented separately)
// ---------------------------------------------------------------------------

/**
 * Interface for proposal deduplication.
 *
 * Implemented by P16.D Deduplication & Cooldown. The generator uses
 * this interface to check whether a proposal is a duplicate and to
 * register generated proposals for cooldown tracking.
 */
export interface ProposalDeduplication {
	/**
	 * Check if a proposal with similar content already exists.
	 *
	 * @param contentHash - Content-based hash of the proposal
	 * @returns True if a duplicate exists
	 */
	isDuplicate(contentHash: string): boolean;

	/**
	 * Register a proposal for cooldown and dedup tracking.
	 *
	 * @param contentHash - Content-based hash of the proposal
	 * @param type - The proposal type (for cooldown checks)
	 * @param generatedAt - ISO 8601 timestamp of generation
	 */
	register(contentHash: string, type: string, generatedAt: string): void;

	/**
	 * Check if a proposal type is in cooldown.
	 *
	 * @param type - The proposal type to check
	 * @returns True if this type is in cooldown
	 */
	isInCooldown(type: string): boolean;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/**
 * Result of generating a batch of proposals.
 */
export interface GenerateProposalsResult {
	/** The generated proposals */
	proposals: Proposal[];
	/** How many new proposals were generated */
	generatedCount: number;
	/** How many were skipped as duplicates */
	duplicateCount: number;
	/** How many were skipped due to cooldown */
	cooldownCount: number;
	/** How many failed validation */
	validationFailedCount: number;
	/** Validation errors for rejected proposals */
	validationErrors: string[];
	/** Any errors encountered during generation */
	errors: string[];
}

// ---------------------------------------------------------------------------
// ProposalGenerator
// ---------------------------------------------------------------------------

const MODULE = "proposal-generator";

/**
 * Generates proposals from various triggers.
 *
 * The generator is the core of P16 — it receives triggers from the brain
 * (observations, memory patterns, goal alignment, plan completion, safety
 * signals) and produces typed proposals with evidence and risk assessment.
 *
 * Generated proposals are validated for evidence completeness, checked
 * against the deduplication engine, and then returned for scoring and
 * inbox placement.
 */
export class ProposalGenerator {
	private config: GeneratorConfig;
	private readonly store: ProposalStore;
	private readonly dedup?: ProposalDeduplication;

	/**
	 * @param store - The proposal store for persisting generated proposals
	 * @param dedup - Optional deduplication engine (P16.D)
	 * @param config - Optional configuration overrides
	 */
	constructor(store: ProposalStore, dedup?: ProposalDeduplication, config?: Partial<GeneratorConfig>) {
		this.store = store;
		this.dedup = dedup;
		this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Core Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate proposals from a trigger.
	 *
	 * Dispatches to the appropriate handler based on trigger type.
	 * All generated proposals go through validation, deduplication,
	 * and cooldown checking.
	 *
	 * @param trigger - The generation trigger
	 * @param context - Optional context (observations, memories, goals)
	 * @returns Generation result with proposals and counts
	 */
	async generate(
		trigger: GenerationTrigger,
		context?: {
			observations?: BrainObservation[];
			memories?: MemoryRecord[];
			goals?: GoalRecord[];
		},
	): Promise<GenerateProposalsResult> {
		const errors: string[] = [];
		const validationErrors: string[] = [];

		try {
			switch (trigger.type) {
				case "observations": {
					if (!context?.observations || context.observations.length === 0) {
						return {
							proposals: [],
							generatedCount: 0,
							duplicateCount: 0,
							cooldownCount: 0,
							validationFailedCount: 0,
							validationErrors: [],
							errors: ["No observations provided for observation trigger"],
						};
					}
					return await this.generateFromObservations(context.observations);
				}

				case "memory_pattern": {
					if (!context?.memories || context.memories.length === 0) {
						return {
							proposals: [],
							generatedCount: 0,
							duplicateCount: 0,
							cooldownCount: 0,
							validationFailedCount: 0,
							validationErrors: [],
							errors: ["No memories provided for memory pattern trigger"],
						};
					}
					return await this.generateFromMemoryPattern(context.memories, trigger.pattern);
				}

				case "goal_alignment": {
					if (!context?.goals || context.goals.length === 0) {
						return {
							proposals: [],
							generatedCount: 0,
							duplicateCount: 0,
							cooldownCount: 0,
							validationFailedCount: 0,
							validationErrors: [],
							errors: ["No goals provided for goal alignment trigger"],
						};
					}
					return await this.generateGoalAlignmentProposal(context.goals[0], context.observations ?? []);
				}

				case "plan_completion": {
					// Plan completion generates a reflection proposal using the trigger data
					const reflection: ReflectionReport = {
						id: trigger.reflectionId,
						planExecId: trigger.planExecId,
						timestamp: new Date().toISOString(),
						summary: `Reflection on plan execution ${trigger.planExecId}`,
						lessons: [],
						improvements: [],
						confidence: 0.7,
					};
					return await this.generateReflectionProposal(reflection);
				}

				case "safety_signal": {
					return await this.generateSafetyProposal(trigger.signal, context?.observations ?? []);
				}

				case "manual": {
					// Manual trigger creates a generic proposal from user input
					return await this.generateFromManualTrigger(trigger.userId, trigger.input);
				}

				default: {
					const exhaustive: never = trigger;
					return {
						proposals: [],
						generatedCount: 0,
						duplicateCount: 0,
						cooldownCount: 0,
						validationFailedCount: 0,
						validationErrors: [],
						errors: [`Unknown trigger type: ${(exhaustive as { type: string }).type}`],
					};
				}
			}
		} catch (error) {
			const msg = `Error generating from trigger: ${error instanceof Error ? error.message : String(error)}`;
			errors.push(msg);
			logError(MODULE, msg);

			return {
				proposals: [],
				generatedCount: 0,
				duplicateCount: 0,
				cooldownCount: 0,
				validationFailedCount: 0,
				validationErrors,
				errors,
			};
		}
	}

	// -----------------------------------------------------------------------
	// Trigger-Specific Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate proposals from a set of observations.
	 *
	 * Analyzes observations and creates proposals based on detected
	 * patterns and severity levels. Observations of type "critical"
	 * may produce safety or plan proposals, while repeated retry
	 * patterns may produce memory proposals.
	 *
	 * AC1: Observation trigger accumulates N observations -> generates proposal
	 *
	 * @param observations - Array of brain observations
	 * @returns Generation result
	 */
	async generateFromObservations(observations: BrainObservation[]): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		if (observations.length < this.config.observationAccumulationThreshold) {
			logDebug(
				MODULE,
				`Only ${observations.length} observations, threshold is ${this.config.observationAccumulationThreshold}`,
			);
			return { ...result, errors: ["Insufficient observations to trigger generation"] };
		}

		// Group observations by signal type for targeted proposals
		const bySignalType = new Map<string, BrainObservation[]>();
		for (const obs of observations) {
			const key = obs.signalType;
			if (!bySignalType.has(key)) {
				bySignalType.set(key, []);
			}
			bySignalType.get(key)!.push(obs);
		}

		const proposals: Proposal[] = [];
		let duplicateCount = 0;
		let cooldownCount = 0;
		let validationFailedCount = 0;
		const validationErrors: string[] = [];

		for (const [signalType, group] of bySignalType) {
			if (proposals.length >= this.config.maxProposalsPerBatch) break;

			// Determine proposal type based on signal type
			let proposalType: ProposalType;
			let title: string;
			let description: string;

			switch (signalType) {
				case "retry_hotspot":
				case "failure_pattern": {
					proposalType = "plan_proposal";
					const count = group.length;
					const avgConfidence = this.averageConfidence(group);
					title = `Address ${signalType.replace("_", " ")} patterns (${count} observations)`;
					description =
						`Detected ${count} observations of type "${signalType}" ` +
						`with average confidence ${(avgConfidence * 100).toFixed(0)}%. ` +
						`Consider creating a plan to address these recurring patterns.`;
					break;
				}
				case "memory_conflict": {
					proposalType = "memory_proposal";
					title = "Resolve memory conflicts";
					description =
						`Detected ${group.length} memory conflict observation(s). ` +
						"Consider updating or correcting conflicting memory records.";
					break;
				}
				case "goal_drift": {
					proposalType = "goal_revision_proposal";
					title = "Review goal alignment";
					description =
						`Detected ${group.length} goal drift observation(s). ` +
						"Goals may need revision to stay aligned with current direction.";
					break;
				}
				case "queue_blocked":
				case "integration_dirty":
				case "validation_failure": {
					proposalType = "plan_proposal";
					title = `Resolve ${signalType.replace(/_/g, " ")} issues`;
					description =
						`Detected ${group.length} ${signalType.replace(/_/g, " ")} ` +
						"observation(s). Consider a targeted remediation plan.";
					break;
				}
				default: {
					// Skip unknown signal types
					continue;
				}
			}

			const memoryIds: string[] = [];
			const observationIds = group.map((o) => o.id);
			const sourceRefs: MemorySourceRef[] = group.map((o) => ({
				type: "observation" as const,
				path: o.evidence[0]?.path ?? `observation:${o.id}`,
				id: o.id,
				timestamp: o.timestamp,
			}));

			const evidenceConfidence = this.averageConfidence(group);
			const evidence = this.buildEvidence(
				memoryIds,
				observationIds,
				sourceRefs,
				evidenceConfidence,
				`${group.length} observation(s) of type "${signalType}"`,
			);

			// Skip if evidence confidence is below threshold (< 0.3)
			if (evidence.confidence < 0.3) {
				logDebug(MODULE, `Skipping proposal: evidence confidence ${evidence.confidence} < 0.3`);
				validationFailedCount++;
				validationErrors.push(
					`Evidence confidence ${evidence.confidence.toFixed(2)} is below minimum 0.3 for signal type "${signalType}"`,
				);
				continue;
			}

			const risk = this.assessRiskFromObservations(group, signalType);

			const input = this.buildProposal(proposalType, title, description, evidence, risk);

			// Validate
			const validationResult = this.validateProposalInput(input);
			if (validationResult.length > 0) {
				validationFailedCount++;
				validationErrors.push(...validationResult);
				continue;
			}

			// Dedup check
			const contentHash = this.computeContentHash(input);
			if (this.dedup?.isDuplicate(contentHash)) {
				duplicateCount++;
				continue;
			}

			// Cooldown check
			if (this.dedup?.isInCooldown(proposalType)) {
				cooldownCount++;
				continue;
			}

			// Create proposal
			const proposal = await this.createAndStore(input, contentHash);
			proposals.push(proposal);
		}

		return {
			proposals,
			generatedCount: proposals.length,
			duplicateCount,
			cooldownCount,
			validationFailedCount,
			validationErrors,
			errors: [],
		};
	}

	/**
	 * Generate proposals from a detected memory pattern.
	 *
	 * AC2: Memory trigger detects pattern -> generates proposal
	 *
	 * @param memories - Memory records that form the pattern
	 * @param pattern - Description of the detected pattern
	 * @returns Generation result
	 */
	async generateFromMemoryPattern(memories: MemoryRecord[], pattern: string): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		if (memories.length === 0) {
			return { ...result, errors: ["No memories provided for pattern"] };
		}

		// Determine proposal type based on memory types in the pattern
		const memoryTypes = new Set(memories.map((m) => m.type));
		let proposalType: ProposalType = "memory_proposal";
		let title: string;
		let description: string;

		if (memoryTypes.has("failure_memory")) {
			proposalType = "plan_proposal";
			title = `Address failure pattern: ${pattern}`;
			description =
				`Detected a pattern across ${memories.length} failure memory record(s): "${pattern}". ` +
				"Consider creating a remediation plan to address the root causes.";
		} else if (memoryTypes.has("goal_revision_proposal") || memoryTypes.has("decision_memory")) {
			proposalType = "goal_revision_proposal";
			title = `Revisit goal alignment: ${pattern}`;
			description =
				`Memory pattern "${pattern}" across ${memories.length} record(s) suggests ` +
				"goals may need adjustment to stay aligned with current outcomes.";
		} else {
			title = `Memory insight: ${pattern}`;
			description =
				`Detected a pattern across ${memories.length} memory record(s): "${pattern}". ` +
				"This insight may warrant further investigation.";
		}

		const memoryIds = memories.map((m) => m.id);
		const observationIds: string[] = [];
		const sourceRefs: MemorySourceRef[] = memories.map((m) => ({
			type: "observation" as const,
			path: m.provenance.sourceRefs[0]?.path ?? `memory:${m.id}`,
			id: m.id,
			timestamp: m.createdAt,
		}));

		const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length;
		const evidence = this.buildEvidence(
			memoryIds,
			observationIds,
			sourceRefs,
			avgConfidence,
			`Pattern "${pattern}" detected across ${memories.length} memory record(s)`,
		);

		// Skip if evidence confidence is below threshold
		if (evidence.confidence < 0.3) {
			return {
				...result,
				validationFailedCount: 1,
				validationErrors: [`Evidence confidence ${evidence.confidence.toFixed(2)} is below minimum 0.3`],
				errors: [],
			};
		}

		const risk: ProposalRiskAssessment = {
			level: "medium",
			factors: [`Memory pattern "${pattern}" suggests repeated behavior`],
			mitigation: ["Review memory records for accuracy before acting"],
			affectedSystems: ["memory", ...new Set(memories.map((m) => m.type))],
			impactDescription: `Acting on memory pattern "${pattern}" may affect ${memoryTypes.size} memory categories`,
		};

		const input = this.buildProposal(proposalType, title, description, evidence, risk);

		// Validate
		const validationErrors = this.validateProposalInput(input);
		if (validationErrors.length > 0) {
			return { ...result, validationFailedCount: 1, validationErrors, errors: [] };
		}

		// Dedup check
		const contentHash = this.computeContentHash(input);
		if (this.dedup?.isDuplicate(contentHash)) {
			return { ...result, duplicateCount: 1, errors: [] };
		}

		// Cooldown check
		if (this.dedup?.isInCooldown(proposalType)) {
			return { ...result, cooldownCount: 1, errors: [] };
		}

		const proposal = await this.createAndStore(input, contentHash);

		return {
			proposals: [proposal],
			generatedCount: 1,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	/**
	 * Generate a proposal from goal alignment analysis.
	 *
	 * AC3: Goal trigger aligns goals with observations -> generates proposal
	 *
	 * @param goal - The goal that triggered alignment analysis
	 * @param observations - Observations related to this goal
	 * @returns Generation result
	 */
	async generateGoalAlignmentProposal(
		goal: GoalRecord,
		observations: BrainObservation[],
	): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		if (observations.length === 0) {
			return { ...result, errors: ["No observations provided for goal alignment"] };
		}

		const proposalType: ProposalType = "goal_revision_proposal";
		const title = `Align goal "${goal.title}" with current observations`;
		const description =
			`Goal "${goal.title}" (status: ${goal.status}, priority: ${goal.priority}) ` +
			`has ${observations.length} relevant observation(s). ` +
			"Consider reviewing and updating the goal to reflect current project state.";

		const memoryIds: string[] = [];
		const observationIds = observations.map((o) => o.id);
		const sourceRefs: MemorySourceRef[] = observations.map((o) => ({
			type: "observation" as const,
			path: o.evidence[0]?.path ?? `observation:${o.id}`,
			id: o.id,
			timestamp: o.timestamp,
		}));

		const evidenceConfidence = this.averageConfidence(observations);
		const evidence = this.buildEvidence(
			memoryIds,
			observationIds,
			sourceRefs,
			evidenceConfidence,
			`${observations.length} observation(s) relevant to goal "${goal.title}"`,
		);

		// Skip if evidence confidence is below threshold
		if (evidence.confidence < 0.3) {
			return {
				...result,
				validationFailedCount: 1,
				validationErrors: [`Evidence confidence ${evidence.confidence.toFixed(2)} is below minimum 0.3`],
				errors: [],
			};
		}

		const risk: ProposalRiskAssessment = {
			level: "medium",
			factors: ["Goal revision may affect ongoing plans and priorities"],
			mitigation: ["Review goal dependencies before making changes"],
			affectedSystems: ["goals", "planning"],
			impactDescription: `Revising goal "${goal.title}" may impact planning and prioritization`,
		};

		const input = this.buildProposal(proposalType, title, description, evidence, risk);
		input.relatedGoalIds = [goal.id];

		// Validate
		const validationErrors = this.validateProposalInput(input);
		if (validationErrors.length > 0) {
			return { ...result, validationFailedCount: 1, validationErrors, errors: [] };
		}

		// Dedup check
		const contentHash = this.computeContentHash(input);
		if (this.dedup?.isDuplicate(contentHash)) {
			return { ...result, duplicateCount: 1, errors: [] };
		}

		// Cooldown check
		if (this.dedup?.isInCooldown(proposalType)) {
			return { ...result, cooldownCount: 1, errors: [] };
		}

		const proposal = await this.createAndStore(input, contentHash);

		return {
			proposals: [proposal],
			generatedCount: 1,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	/**
	 * Generate a reflection proposal from a plan completion.
	 *
	 * AC4: Plan completion trigger generates reflection proposal
	 *
	 * @param reflection - The reflection report from plan completion
	 * @returns Generation result
	 */
	async generateReflectionProposal(reflection: ReflectionReport): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		const proposalType: ProposalType = "reflection_proposal";
		const title = `Reflection on plan execution ${reflection.planExecId}`;
		const description = [
			`Reflection summary: ${reflection.summary}`,
			reflection.lessons.length > 0 ? `Lessons learned: ${reflection.lessons.join("; ")}` : "",
			reflection.improvements.length > 0 ? `Improvements: ${reflection.improvements.join("; ")}` : "",
		]
			.filter(Boolean)
			.join("\n");

		const sourceRefs: MemorySourceRef[] = [
			{
				type: "observation" as const,
				path: `plan:${reflection.planExecId}`,
				id: reflection.id,
				timestamp: reflection.timestamp,
			},
		];

		const evidence = this.buildEvidence(
			[],
			[],
			sourceRefs,
			reflection.confidence,
			`Reflection on plan execution ${reflection.planExecId}`,
		);

		const risk: ProposalRiskAssessment = {
			level: "low",
			factors: ["Reflection proposals are informational"],
			mitigation: [],
			affectedSystems: ["planning", "execution"],
			impactDescription: "Reflection proposals document lessons learned for future planning",
		};

		const input = this.buildProposal(proposalType, title, description, evidence, risk);

		// Validate
		const validationErrors = this.validateProposalInput(input);
		if (validationErrors.length > 0) {
			return { ...result, validationFailedCount: 1, validationErrors, errors: [] };
		}

		// Dedup check
		const contentHash = this.computeContentHash(input);
		if (this.dedup?.isDuplicate(contentHash)) {
			return { ...result, duplicateCount: 1, errors: [] };
		}

		const proposal = await this.createAndStore(input, contentHash);

		return {
			proposals: [proposal],
			generatedCount: 1,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	/**
	 * Generate a safety proposal from a safety signal.
	 *
	 * @param signal - The safety signal description
	 * @param observations - Related observations
	 * @returns Generation result
	 */
	async generateSafetyProposal(signal: string, observations: BrainObservation[]): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		const proposalType: ProposalType = "safety_proposal";
		const title = `Safety signal: ${signal}`;
		const description =
			`Detected safety signal: "${signal}". ` +
			`${observations.length > 0 ? `Supported by ${observations.length} observation(s).` : ""} ` +
			"Review and address to maintain system safety.";

		const observationIds = observations.map((o) => o.id);
		const sourceRefs: MemorySourceRef[] =
			observations.length > 0
				? observations.map((o) => ({
						type: "observation" as const,
						path: o.evidence[0]?.path ?? `observation:${o.id}`,
						id: o.id,
						timestamp: o.timestamp,
					}))
				: [
						{
							type: "observation" as const,
							path: `safety-signal:${signal}`,
							id: `safety-${Date.now()}`,
							timestamp: new Date().toISOString(),
						},
					];

		const evidenceConfidence = observations.length > 0 ? Math.max(this.averageConfidence(observations), 0.5) : 0.5;

		const evidence = this.buildEvidence(
			[],
			observationIds,
			sourceRefs,
			evidenceConfidence,
			`Safety signal "${signal}"${observations.length > 0 ? ` with ${observations.length} supporting observation(s)` : ""}`,
		);

		// Safety proposals always pass confidence check
		const risk: ProposalRiskAssessment = {
			level: "high",
			factors: [`Safety signal: ${signal}`],
			mitigation: ["Immediate review recommended", "Assess impact before proceeding"],
			affectedSystems: ["safety", "security"],
			impactDescription: `Safety signal "${signal}" may indicate a system-level concern`,
		};

		const input = this.buildProposal(proposalType, title, description, evidence, risk);

		// Validate
		const validationErrors = this.validateProposalInput(input);
		if (validationErrors.length > 0) {
			return { ...result, validationFailedCount: 1, validationErrors, errors: [] };
		}

		// Dedup check
		const contentHash = this.computeContentHash(input);
		if (this.dedup?.isDuplicate(contentHash)) {
			return { ...result, duplicateCount: 1, errors: [] };
		}

		// Cooldown check
		if (this.dedup?.isInCooldown(proposalType)) {
			return { ...result, cooldownCount: 1, errors: [] };
		}

		const proposal = await this.createAndStore(input, contentHash);

		return {
			proposals: [proposal],
			generatedCount: 1,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	/**
	 * Generate a proposal from a manual trigger.
	 *
	 * @param userId - The user who triggered generation
	 * @param input - The user's input/description
	 * @returns Generation result
	 */
	private async generateFromManualTrigger(userId: string, input: string): Promise<GenerateProposalsResult> {
		const result = this.initResult();

		const proposalType: ProposalType = "plan_proposal";
		const title = `Manual proposal by ${userId}`;
		const description = input;

		const sourceRefs: MemorySourceRef[] = [
			{
				type: "observation" as const,
				path: `manual-trigger:${userId}`,
				id: `manual-${Date.now()}`,
				timestamp: new Date().toISOString(),
			},
		];

		const evidence = this.buildEvidence(
			[],
			[],
			sourceRefs,
			0.8, // Manual triggers have high confidence
			`Manual proposal triggered by ${userId}`,
		);

		const risk: ProposalRiskAssessment = {
			level: "medium",
			factors: ["Manual proposal may not have full evidence backing"],
			mitigation: ["Review before approval"],
			affectedSystems: ["planning"],
			impactDescription: "Manual proposal created from user input",
		};

		const proposalInput = this.buildProposal(proposalType, title, description, evidence, risk);

		// Validate
		const validationErrors = this.validateProposalInput(proposalInput);
		if (validationErrors.length > 0) {
			return { ...result, validationFailedCount: 1, validationErrors, errors: [] };
		}

		// Dedup check
		const contentHash = this.computeContentHash(proposalInput);
		if (this.dedup?.isDuplicate(contentHash)) {
			return { ...result, duplicateCount: 1, errors: [] };
		}

		const proposal = await this.createAndStore(proposalInput, contentHash);

		return {
			proposals: [proposal],
			generatedCount: 1,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	// -----------------------------------------------------------------------
	// Builders
	// -----------------------------------------------------------------------

	/**
	 * Build a ProposalCreateInput from components.
	 *
	 * @param type - Proposal type
	 * @param title - Short title
	 * @param description - Detailed description
	 * @param evidence - Evidence references
	 * @param risk - Risk assessment
	 * @param goals - Optional related goals
	 * @returns A fully populated ProposalCreateInput
	 */
	private buildProposal(
		type: ProposalType,
		title: string,
		description: string,
		evidence: ProposalEvidence,
		risk: ProposalRiskAssessment,
		goals?: GoalRecord[],
	): ProposalCreateInput {
		// V5.08: Generate whyNow and expectedImpact from context
		const whyNow = this.generateWhyNow(type, evidence, risk);
		const expectedImpact = this.generateExpectedImpact(type, description, risk);

		return {
			type,
			title,
			description,
			whyNow,
			expectedImpact,
			evidence: {
				memoryIds: [...evidence.memoryIds],
				observationIds: [...evidence.observationIds],
				sourceRefs: [...evidence.sourceRefs],
				confidence: evidence.confidence,
				evidenceSummary: evidence.evidenceSummary,
			},
			risk: {
				level: risk.level,
				factors: [...risk.factors],
				mitigation: [...risk.mitigation],
				affectedSystems: [...risk.affectedSystems],
				impactDescription: risk.impactDescription,
			},
			relatedGoalIds: goals?.map((g) => g.id) ?? [],
			tags: [type],
			metadata: {},
			// V5.08: All generated proposals are advisory — no draft exists yet
			draftAvailable: false,
			approvalRequired: true,
		};
	}

	/**
	 * Generate a "why now" explanation for a proposal.
	 *
	 * V5.08 AC1: Explains the urgency and timeliness of acting on this proposal.
	 */
	private generateWhyNow(type: ProposalType, evidence: ProposalEvidence, risk: ProposalRiskAssessment): string {
		const evidenceRefs = evidence.memoryIds.length + evidence.observationIds.length + evidence.sourceRefs.length;
		const parts: string[] = [];

		if (evidence.observationIds.length > 0) {
			parts.push(`${evidence.observationIds.length} recent observation(s) signal immediate attention.`);
		}
		if (evidence.memoryIds.length > 0) {
			parts.push(`Backed by ${evidence.memoryIds.length} relevant memory record(s).`);
		}
		if (risk.level === "high" || risk.level === "critical") {
			parts.push(`${risk.level} risk level indicates timely action is warranted.`);
		}
		if (type === "safety_proposal") {
			parts.push("Safety concerns should be addressed promptly to prevent escalation.");
		}

		if (parts.length === 0) {
			parts.push("Timely consideration is recommended based on available observations and evidence.");
		}

		parts.push(
			`This proposal is backed by ${evidenceRefs} evidence reference(s)` +
				` with ${(evidence.confidence * 100).toFixed(0)}% confidence.`,
		);

		return parts.join(" ");
	}

	/**
	 * Generate an expected impact description for a proposal.
	 *
	 * V5.08 AC1: Describes what positive outcome or change is expected.
	 */
	private generateExpectedImpact(type: ProposalType, description: string, risk: ProposalRiskAssessment): string {
		switch (type) {
			case "plan_proposal":
				return `Implementing this plan proposal addresses the described issue: ${description.slice(0, 80)}... Expected to improve stability and reduce recurrence.`;
			case "memory_proposal":
				return "Resolving memory conflicts improves the accuracy of future observations and decision-making.";
			case "goal_revision_proposal":
				return "Updating goal alignment keeps priorities current with observed project state.";
			case "autonomy_adjustment_proposal":
				return "Adjusting autonomy level calibrates the system's ability to act independently.";
			case "reflection_proposal":
				return "Capturing lessons learned improves future planning and execution quality.";
			case "safety_proposal":
				return `Addressing this safety signal ${risk.factors.length > 0 ? `(${risk.factors[0]}) ` : ""}prevents potential system degradation or failure.`;
			default:
				return "Enacting this proposal improves system operations based on observed evidence.";
		}
	}

	/**
	 * Build evidence references from component parts.
	 *
	 * @param memoryIds - Referenced memory record IDs
	 * @param observationIds - Referenced observation IDs
	 * @param sourceRefs - Source references
	 * @param confidence - Evidence confidence (0-1)
	 * @param summary - Human-readable summary
	 * @returns A fully populated ProposalEvidence
	 */
	private buildEvidence(
		memoryIds: string[],
		observationIds: string[],
		sourceRefs: MemorySourceRef[],
		confidence: number,
		summary: string,
	): ProposalEvidence {
		return {
			memoryIds: [...memoryIds],
			observationIds: [...observationIds],
			sourceRefs: [...sourceRefs],
			confidence: Math.max(0, Math.min(1, confidence)),
			evidenceSummary: summary,
		};
	}

	/**
	 * Assess risk from a group of observations.
	 *
	 * @param observations - The observations to assess risk from
	 * @param signalType - The signal type
	 * @returns A risk assessment
	 */
	private assessRiskFromObservations(observations: BrainObservation[], signalType: string): ProposalRiskAssessment {
		const maxSeverity = observations.reduce((max, o) => {
			const severities = { info: 0, warning: 1, critical: 2 };
			return Math.max(max, severities[o.severity] ?? 0);
		}, 0);

		let level: ProposalRiskAssessment["level"];
		if (maxSeverity >= 2) {
			level = "high";
		} else if (maxSeverity >= 1) {
			level = "medium";
		} else {
			level = "low";
		}

		const factors = [`${observations.length} observation(s) of type "${signalType}"`];
		const affectedSystems = [signalType, ...new Set(observations.map((o) => o.source))];

		return {
			level,
			factors,
			mitigation:
				level === "high"
					? ["Immediate review recommended", "Gather additional context before acting"]
					: ["Review before acting"],
			affectedSystems: [...new Set(affectedSystems)],
			impactDescription: `${observations.length} observation(s) of "${signalType}" with max severity ${["info", "warning", "critical"][maxSeverity]}`,
		};
	}

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	/**
	 * Validate a ProposalCreateInput.
	 *
	 * Uses the domain model's validation functions. Returns an array of
	 * error messages (empty if valid).
	 *
	 * @param input - The proposal input to validate
	 * @returns Array of validation error messages
	 */
	validateProposalInput(input: ProposalCreateInput): string[] {
		return validateProposalCreateInput(input);
	}

	/**
	 * Validate evidence references.
	 *
	 * AC5: Evidence validation rejects proposals with missing refs.
	 *
	 * @param evidence - The evidence to validate
	 * @returns True if the evidence is valid
	 */
	validateEvidence(evidence: ProposalEvidence): boolean {
		const errors = validateProposalEvidence(evidence);

		// Additional check: at least one reference must be present
		if (evidence.memoryIds.length === 0 && evidence.observationIds.length === 0 && evidence.sourceRefs.length === 0) {
			logWarn(MODULE, "Evidence validation failed: no references");
			return false;
		}

		return errors.length === 0;
	}

	/**
	 * Validate a risk assessment.
	 *
	 * @param risk - The risk assessment to validate
	 * @returns True if the risk assessment is valid
	 */
	validateRisk(risk: ProposalRiskAssessment): boolean {
		if (!risk.level || !["low", "medium", "high", "critical"].includes(risk.level)) {
			logWarn(MODULE, `Risk validation failed: invalid level "${risk.level}"`);
			return false;
		}
		return true;
	}

	// -----------------------------------------------------------------------
	// Trigger Checkers
	// -----------------------------------------------------------------------

	/**
	 * Check if observations have crossed the accumulation threshold.
	 *
	 * Returns observations that should trigger a proposal. Returns an
	 * empty array if the threshold has not been met.
	 *
	 * @param observations - Current pool of observations
	 * @returns Observations that passed the threshold check
	 */
	checkObservationTrigger(observations: BrainObservation[]): BrainObservation[] {
		if (observations.length >= this.config.observationAccumulationThreshold) {
			logDebug(
				MODULE,
				`Observation trigger: ${observations.length} >= ${this.config.observationAccumulationThreshold}`,
			);
			return observations;
		}
		return [];
	}

	/**
	 * Check if memory records form a detectable pattern.
	 *
	 * Returns memories that match a pattern within the configured window.
	 * Returns an empty array if no pattern is detected.
	 *
	 * @param memories - Current pool of memory records
	 * @returns Memories that form a pattern
	 */
	checkMemoryPatternTrigger(memories: MemoryRecord[]): MemoryRecord[] {
		if (memories.length === 0) return [];

		// Group memories by type to detect patterns
		const byType = new Map<string, MemoryRecord[]>();
		for (const mem of memories) {
			const key = mem.type;
			if (!byType.has(key)) {
				byType.set(key, []);
			}
			byType.get(key)!.push(mem);
		}

		// A pattern is detected when we have 3+ memories of the same type
		const patternMemories: MemoryRecord[] = [];
		for (const [, group] of byType) {
			if (group.length >= 3) {
				patternMemories.push(...group);
			}
		}

		if (patternMemories.length > 0) {
			logDebug(MODULE, `Memory pattern trigger: ${patternMemories.length} memories in pattern`);
		}

		return patternMemories;
	}

	/**
	 * Check if goals are aligned with current observations.
	 *
	 * Returns true if there are observations that suggest goal alignment
	 * needs review. This is a simple check — override for more complex
	 * logic.
	 *
	 * @param goals - Current goals
	 * @param observations - Current observations
	 * @returns True if goal alignment should be reviewed
	 */
	checkGoalTrigger(goals: GoalRecord[], observations: BrainObservation[]): boolean {
		if (goals.length === 0 || observations.length === 0) return false;

		// Check for goal_drift observations
		const driftObservations = observations.filter((o) => o.signalType === "goal_drift");
		if (driftObservations.length >= 1) {
			logDebug(MODULE, `Goal trigger: ${driftObservations.length} goal drift observation(s)`);
			return true;
		}

		// Check if there are observations that reference goals
		const relevantRatio =
			observations.filter(
				(o) =>
					o.signalType === "goal_drift" ||
					o.signalType === "memory_conflict" ||
					o.signalType === "retry_hotspot" ||
					o.signalType === "failure_pattern",
			).length / observations.length;

		if (relevantRatio >= 0.3) {
			logDebug(MODULE, `Goal trigger: ${(relevantRatio * 100).toFixed(0)}% of observations are goal-relevant`);
			return true;
		}

		return false;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the generator configuration.
	 *
	 * Provided values are merged into the current config.
	 *
	 * @param config - Partial configuration to apply
	 */
	setConfig(config: Partial<GeneratorConfig>): void {
		this.config = { ...this.config, ...config };
		logInfo(MODULE, "Configuration updated", this.config);
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Initialize an empty result.
	 */
	private initResult(): GenerateProposalsResult {
		return {
			proposals: [],
			generatedCount: 0,
			duplicateCount: 0,
			cooldownCount: 0,
			validationFailedCount: 0,
			validationErrors: [],
			errors: [],
		};
	}

	/**
	 * Compute the average confidence from a set of observations.
	 */
	private averageConfidence(observations: BrainObservation[]): number {
		if (observations.length === 0) return 0;
		return observations.reduce((sum, o) => sum + o.provenance.confidence, 0) / observations.length;
	}

	/**
	 * Compute a deterministic content hash from a proposal input.
	 *
	 * The hash is used for duplicate detection. It is based on the
	 * proposal type, title, description, and evidence references.
	 */
	private computeContentHash(input: ProposalCreateInput): string {
		const hash = createHash("sha256");
		hash.update(input.type);
		hash.update("|");
		hash.update(input.title.trim().toLowerCase());
		hash.update("|");
		hash.update(input.description.trim().toLowerCase());
		hash.update("|");
		hash.update(input.evidence.memoryIds.sort().join(","));
		hash.update("|");
		hash.update(input.evidence.observationIds.sort().join(","));
		return hash.digest("hex");
	}

	/**
	 * Create a proposal and persist it via the store.
	 *
	 * Also registers the content hash with the dedup engine if available.
	 */
	private async createAndStore(input: ProposalCreateInput, contentHash: string): Promise<Proposal> {
		const proposal = await this.store.create(input);

		if (this.dedup) {
			this.dedup.register(contentHash, input.type, proposal.createdAt);
		}

		logInfo(MODULE, `Created proposal ${proposal.id} (type: ${input.type})`);
		return proposal;
	}
}

/**
 * Fix Strategist Worker — Patch Strategy — 25.J
 *
 * Defines types and logic for generating patch strategies from debug
 * evidence and root cause analysis. A patch strategy describes what
 * files to change, how to change them, and the expected outcome.
 *
 * Key design:
 * - Strategies are evidence-backed — each change links to evidence.
 * - Strategies carry risk assessments and expected impact.
 * - Multiple strategies can be generated for a single failure.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Patch Action — a single atomic change
// ---------------------------------------------------------------------------

/**
 * Type of file change in a patch action.
 */
export type PatchActionType =
	| "modify" // Edit existing file
	| "create" // Create new file
	| "delete" // Delete existing file
	| "rename"; // Rename/move a file

/**
 * All valid PatchActionType values for runtime validation.
 */
export const ALL_PATCH_ACTION_TYPES: readonly PatchActionType[] = ["modify", "create", "delete", "rename"] as const;

/**
 * A single atomic patch action targeting one file.
 */
export interface PatchAction {
	/** Unique action identifier */
	id: string;

	/** Type of change */
	type: PatchActionType;

	/** Target file path (relative to project root) */
	filePath: string;

	/** New file path for rename operations */
	newFilePath?: string;

	/** Description of what this action does */
	description: string;

	/** The patch content (diff, content for new files, etc.) */
	content: string;

	/** Evidence IDs that support this action */
	evidenceRefs: string[];

	/** Confidence that this action is correct */
	confidence: "high" | "medium" | "low" | "speculative";

	/** Estimated complexity (1-10) */
	complexity: number;
}

// ---------------------------------------------------------------------------
// Root Cause Finding
// ---------------------------------------------------------------------------

/**
 * A root cause finding derived from evidence analysis.
 */
export interface FixRootCauseFinding {
	/** Unique finding identifier */
	id: string;

	/** Human-readable description of the root cause */
	description: string;

	/** Category of the root cause */
	category:
		| "logic_error"
		| "type_error"
		| "null_reference"
		| "race_condition"
		| "configuration"
		| "api_misuse"
		| "missing_edge_case"
		| "performance"
		| "security"
		| "dependency"
		| "other";

	/** Evidence IDs that support this finding */
	evidenceRefs: string[];

	/** Confidence level */
	confidence: "high" | "medium" | "low" | "speculative";

	/** The file(s) most likely involved */
	affectedFiles: string[];

	/** Suggested fix approach (free text) */
	suggestedApproach: string;
}

// ---------------------------------------------------------------------------
// Patch Strategy — a complete fix plan
// ---------------------------------------------------------------------------

/**
 * Risk level of implementing a patch strategy.
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * All valid RiskLevel values.
 */
export const ALL_RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"] as const;

/**
 * A complete patch strategy comprising root cause findings, actions,
 * risk assessment, and verification steps.
 */
export interface PatchStrategy {
	/** Unique strategy identifier */
	id: string;

	/** ISO 8601 timestamp of strategy creation */
	createdAt: string;

	/** Correlation / debug session identifier */
	sessionId: string;

	/** Human-readable title for this strategy */
	title: string;

	/** Detailed description of the strategy */
	description: string;

	/** Root cause findings that drive this strategy */
	rootCauses: FixRootCauseFinding[];

	/** Patch actions to execute */
	actions: PatchAction[];

	/** Overall risk level */
	riskLevel: RiskLevel;

	/** Risk explanation */
	riskExplanation: string;

	/** Estimated effort (in minutes) */
	estimatedEffortMinutes: number;

	/** Whether this strategy is eligible for autonomous execution */
	autonomousEligible: boolean;

	/** Priority score (0-100, higher = more urgent) */
	priorityScore: number;

	/** Evidence summary IDs that informed this strategy */
	evidenceSummaryIds: string[];

	/** Diagnostics generated during strategy generation */
	diagnostics: string[];

	/** Whether the strategy generation was successful */
	isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Strategy Rank
// ---------------------------------------------------------------------------

/**
 * Ranked result of comparing multiple strategies.
 */
export interface StrategyRank {
	/** Strategy ID */
	strategyId: string;

	/** Composite score (0-100) */
	score: number;

	/** Breakdown of scoring dimensions */
	dimensions: {
		coverage: number; // How well evidence is covered (0-100)
		risk: number; // Inverted risk (0-100, higher = safer)
		effort: number; // Inverted effort (0-100, higher = faster)
		confidence: number; // Average action confidence (0-100)
	};
}

// ---------------------------------------------------------------------------
// Patch Strategy Generator
// ---------------------------------------------------------------------------

/**
 * Configuration for the PatchStrategyGenerator.
 */
export interface PatchStrategyGeneratorConfig {
	/**
	 * Maximum root cause findings to extract. Default: 10.
	 */
	maxRootCauseFindings: number;

	/**
	 * Maximum patch actions per strategy. Default: 20.
	 */
	maxActions: number;

	/**
	 * Maximum strategies to generate per session. Default: 5.
	 */
	maxStrategies: number;

	/**
	 * Whether to assign autonomous eligibility automatically. Default: true.
	 */
	autoAssignAutonomy: boolean;

	/**
	 * Minimum average confidence for autonomous eligibility. Default: "medium".
	 */
	minAutonomyConfidence: "high" | "medium" | "low";
}

/**
 * Default configuration for the PatchStrategyGenerator.
 */
export const DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG: PatchStrategyGeneratorConfig = {
	maxRootCauseFindings: 10,
	maxActions: 20,
	maxStrategies: 5,
	autoAssignAutonomy: true,
	minAutonomyConfidence: "medium",
};

// ---------------------------------------------------------------------------
// PatchStrategyGenerator
// ---------------------------------------------------------------------------

/**
 * Generates patch strategies from evidence and root cause analysis.
 *
 * Transforms debug evidence into structured fix plans with root cause
 * findings, actions, risk assessments, and priority scoring.
 */
export class PatchStrategyGenerator {
	private config: PatchStrategyGeneratorConfig;
	private strategies: Map<string, PatchStrategy>;

	constructor(config?: Partial<PatchStrategyGeneratorConfig>) {
		this.config = {
			maxRootCauseFindings:
				config?.maxRootCauseFindings ?? DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG.maxRootCauseFindings,
			maxActions: config?.maxActions ?? DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG.maxActions,
			maxStrategies: config?.maxStrategies ?? DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG.maxStrategies,
			autoAssignAutonomy: config?.autoAssignAutonomy ?? DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG.autoAssignAutonomy,
			minAutonomyConfidence:
				config?.minAutonomyConfidence ?? DEFAULT_PATCH_STRATEGY_GENERATOR_CONFIG.minAutonomyConfidence,
		};
		this.strategies = new Map();
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the generator configuration.
	 */
	setConfig(config: Partial<PatchStrategyGeneratorConfig>): void {
		if (config.maxRootCauseFindings !== undefined) this.config.maxRootCauseFindings = config.maxRootCauseFindings;
		if (config.maxActions !== undefined) this.config.maxActions = config.maxActions;
		if (config.maxStrategies !== undefined) this.config.maxStrategies = config.maxStrategies;
		if (config.autoAssignAutonomy !== undefined) this.config.autoAssignAutonomy = config.autoAssignAutonomy;
		if (config.minAutonomyConfidence !== undefined) this.config.minAutonomyConfidence = config.minAutonomyConfidence;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): PatchStrategyGeneratorConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Root Cause Extraction
	// -----------------------------------------------------------------------

	/**
	 * Extract root cause findings from evidence items.
	 *
	 * Analyzes high-confidence evidence (error messages, stack traces,
	 * diagnostics) to identify probable root causes.
	 *
	 * @param evidenceItems - Evidence items to analyze (label:content pairs).
	 * @param sessionId - Session identifier for correlation.
	 * @returns Array of RootCauseFinding objects.
	 */
	extractRootCauses(
		evidenceItems: Array<{ label: string; content: string; type?: string; confidence?: string }>,
		_sessionId?: string,
	): FixRootCauseFinding[] {
		const findings: FixRootCauseFinding[] = [];
		const maxFindings = this.config.maxRootCauseFindings;

		// Categorize evidence by type indicator
		const errorMessages = evidenceItems.filter(
			(e) => e.type === "error_message" || e.label.toLowerCase().includes("error"),
		);
		const stackTraces = evidenceItems.filter(
			(e) => e.type === "stack_trace" || e.label.toLowerCase().includes("stack"),
		);
		const diagnostics = evidenceItems.filter(
			(e) => e.type === "worker_diagnostic" || e.label.toLowerCase().includes("diagnostic"),
		);
		// evidenceItems may include execution_log entries for correlation
		const _logs = evidenceItems.filter((e) => e.type === "execution_log" || e.label.toLowerCase().includes("log"));

		// Extract from error messages
		for (const err of errorMessages.slice(0, 3)) {
			if (findings.length >= maxFindings) break;

			const category = this.categorizeError(err.content);
			const affectedFiles = this.extractFileRefs(err.content);

			findings.push({
				id: randomUUID(),
				description: err.content.length > 200 ? `${err.content.slice(0, 200)}...` : err.content,
				category,
				evidenceRefs: [err.label],
				confidence: (err.confidence as FixRootCauseFinding["confidence"]) ?? "medium",
				affectedFiles,
				suggestedApproach: this.suggestApproach(category, err.content),
			});
		}

		// Extract from stack traces
		for (const st of stackTraces.slice(0, 3)) {
			if (findings.length >= maxFindings) break;

			const lines = st.content.split("\n").filter((l) => l.trim());
			const topFrame = lines.find((l) => l.includes("at ") || l.includes("Error"));
			const affectedFiles = this.extractFileRefs(st.content);

			findings.push({
				id: randomUUID(),
				description: topFrame
					? `Stack trace points to: ${topFrame.trim().slice(0, 200)}`
					: `Stack trace with ${lines.length} frames`,
				category: "null_reference",
				evidenceRefs: [st.label],
				confidence: "medium",
				affectedFiles,
				suggestedApproach: "Examine the top stack frame and verify null/undefined checks",
			});
		}

		// Extract from diagnostics
		for (const diag of diagnostics.slice(0, 3)) {
			if (findings.length >= maxFindings) break;

			const affectedFiles = this.extractFileRefs(diag.content);
			const category = this.categorizeError(diag.content);

			findings.push({
				id: randomUUID(),
				description: diag.content.length > 200 ? `${diag.content.slice(0, 200)}...` : diag.content,
				category,
				evidenceRefs: [diag.label],
				confidence: "medium",
				affectedFiles,
				suggestedApproach: this.suggestApproach(category, diag.content),
			});
		}

		// Fallback: if no findings extracted, create a generic one
		if (findings.length === 0 && evidenceItems.length > 0) {
			const allFiles = evidenceItems.flatMap((e) => this.extractFileRefs(e.content));
			findings.push({
				id: randomUUID(),
				description: `Analyzed ${evidenceItems.length} evidence items but could not isolate a specific root cause`,
				category: "other",
				evidenceRefs: evidenceItems.slice(0, 5).map((e) => e.label),
				confidence: "speculative",
				affectedFiles: [...new Set(allFiles)],
				suggestedApproach: "Review all evidence manually to identify the root cause",
			});
		}

		return findings;
	}

	/**
	 * Categorize an error message by content keywords.
	 */
	private categorizeError(content: string): FixRootCauseFinding["category"] {
		const lower = content.toLowerCase();
		if (
			lower.includes("cannot read properties of null") ||
			lower.includes("cannot read properties of undefined") ||
			lower.includes("cannot read property") ||
			lower.includes("null") ||
			lower.includes("undefined")
		)
			return "null_reference";
		if (lower.includes("typeerror") || lower.includes("type error")) return "type_error";
		if (lower.includes("race") || lower.includes("deadlock") || lower.includes("concurrent")) return "race_condition";
		if (lower.includes("config") || lower.includes("env") || lower.includes("setting")) return "configuration";
		if (lower.includes("performance") || lower.includes("timeout") || lower.includes("slow")) return "performance";
		if (lower.includes("edge case") || lower.includes("boundary") || lower.includes("unexpected input"))
			return "missing_edge_case";
		if (
			lower.includes("api") ||
			lower.includes("endpoint") ||
			lower.includes("request") ||
			lower.includes("response")
		)
			return "api_misuse";
		if (
			lower.includes("security") ||
			lower.includes("auth") ||
			lower.includes("permission") ||
			lower.includes("access")
		)
			return "security";
		if (
			lower.includes("dependency") ||
			lower.includes("module") ||
			lower.includes("import") ||
			lower.includes("require")
		)
			return "dependency";
		if (lower.includes("error") || lower.includes("exception") || lower.includes("fail")) return "logic_error";
		return "other";
	}

	/**
	 * Extract file references from error/stack content.
	 */
	private extractFileRefs(content: string): string[] {
		const refs: string[] = [];
		// Match file paths in stack traces and error messages
		const filePatterns = [
			/(?:at\s+)(?:\S+\s+)?\(?((?:\w:)?[/\\][^\s:)]+(?:\.[a-z]+)+)\)?/gi,
			/(?:file:\/\/\/)?(\/[^\s:)]+(?:\.[a-z]+)+)/gi,
			/((?:src|lib|app|test|packages)\/[^\s:)]+(?:\.[a-z]+)+)/gi,
		];

		for (const pattern of filePatterns) {
			const matches = content.matchAll(pattern);
			for (const match of matches) {
				const file = match[1] ?? match[0];
				if (file && !refs.includes(file)) {
					refs.push(file);
				}
			}
		}

		return refs;
	}

	/**
	 * Suggest a fix approach based on error category.
	 */
	private suggestApproach(category: FixRootCauseFinding["category"], _content: string): string {
		switch (category) {
			case "logic_error":
				return "Review the conditional logic and ensure all branches are covered";
			case "type_error":
				return "Add proper type checking and validation before operations";
			case "null_reference":
				return "Add null/undefined guards and consider using optional chaining";
			case "race_condition":
				return "Add synchronization primitives or restructure as sequential operations";
			case "configuration":
				return "Verify configuration values and add validation with sensible defaults";
			case "api_misuse":
				return "Review API documentation and ensure correct parameter types and ordering";
			case "missing_edge_case":
				return "Add handling for the uncovered edge case with appropriate tests";
			case "performance":
				return "Profile the hot path and optimize the identified bottleneck";
			case "security":
				return "Review security implications and add proper access controls";
			case "dependency":
				return "Check dependency versions, imports, and module resolution";
			default:
				return "Review the evidence and implement appropriate fix";
		}
	}

	// -----------------------------------------------------------------------
	// Strategy Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a PatchStrategy from root cause findings and optional actions.
	 *
	 * @param title - Strategy title.
	 * @param description - Strategy description.
	 * @param rootCauses - Root cause findings.
	 * @param actions - Patch actions (generated automatically if empty).
	 * @param evidenceSummaryIds - Evidence summary IDs.
	 * @param sessionId - Session identifier.
	 * @returns The generated PatchStrategy.
	 */
	generateStrategy(
		title: string,
		description: string,
		rootCauses: FixRootCauseFinding[],
		actions: PatchAction[],
		evidenceSummaryIds: string[],
		sessionId?: string,
	): PatchStrategy {
		const id = randomUUID();
		const now = new Date().toISOString();

		// Calculate average confidence
		const confidences: Record<string, number> = { high: 4, medium: 3, low: 2, speculative: 1 };
		const avgConfidence =
			actions.length > 0
				? actions.reduce((sum, a) => sum + (confidences[a.confidence] ?? 0), 0) / actions.length
				: 0;

		// Determine autonomous eligibility
		let autonomousEligible = false;
		if (this.config.autoAssignAutonomy) {
			const minLevel = confidences[this.config.minAutonomyConfidence] ?? 3;
			autonomousEligible = actions.length > 0 && avgConfidence >= minLevel;
		}

		// Calculate risk level
		const riskLevel = this.calculateRiskLevel(rootCauses, actions);

		// Calculate priority score
		const priorityScore = this.calculatePriorityScore(rootCauses, actions, riskLevel);

		// Estimate effort
		const estimatedEffortMinutes = actions.reduce((sum, a) => sum + a.complexity * 5, 0);

		const diagnostics: string[] = [];
		if (rootCauses.length === 0) {
			diagnostics.push("No root cause findings were extracted from evidence");
		}
		if (actions.length === 0) {
			diagnostics.push("No patch actions were defined — this strategy is incomplete");
		}

		const strategy: PatchStrategy = {
			id,
			createdAt: now,
			sessionId: sessionId ?? `fix-${randomUUID().slice(0, 8)}`,
			title,
			description,
			rootCauses,
			actions,
			riskLevel,
			riskExplanation: this.explainRisk(riskLevel, rootCauses.length, actions.length),
			estimatedEffortMinutes,
			autonomousEligible,
			priorityScore,
			evidenceSummaryIds,
			diagnostics,
			isComplete: actions.length > 0,
		};

		this.strategies.set(id, strategy);
		return strategy;
	}

	/**
	 * Calculate risk level for a strategy.
	 */
	private calculateRiskLevel(rootCauses: FixRootCauseFinding[], actions: PatchAction[]): RiskLevel {
		if (actions.length === 0) return "critical";

		const highRiskActions = actions.filter((a) => a.confidence === "low" || a.confidence === "speculative").length;
		const criticalCategories = rootCauses.filter(
			(r) => r.category === "security" || r.category === "race_condition",
		).length;
		const complexActions = actions.filter((a) => a.complexity >= 8).length;

		if (criticalCategories > 0 || highRiskActions > actions.length / 2) return "critical";
		if (highRiskActions > actions.length / 3 || complexActions > 2) return "high";
		if (highRiskActions > 0 || complexActions > 0) return "medium";
		return "low";
	}

	/**
	 * Calculate a priority score (0-100) based on findings and actions.
	 */
	private calculatePriorityScore(
		rootCauses: FixRootCauseFinding[],
		actions: PatchAction[],
		riskLevel: RiskLevel,
	): number {
		let score = 50; // Baseline

		// More root causes = higher priority
		score += Math.min(rootCauses.length * 5, 20);

		// More actions = higher priority
		score += Math.min(actions.length * 3, 15);

		// Risk level weighting
		const riskScores: Record<RiskLevel, number> = { low: -10, medium: 0, high: 10, critical: 20 };
		score += riskScores[riskLevel];

		// Confidence weighting
		const lowConfidence = actions.filter((a) => a.confidence === "low" || a.confidence === "speculative").length;
		score -= lowConfidence * 5;

		return Math.max(0, Math.min(100, score));
	}

	/**
	 * Generate a human-readable risk explanation.
	 */
	private explainRisk(riskLevel: RiskLevel, rootCauseCount: number, actionCount: number): string {
		switch (riskLevel) {
			case "low":
				return `Low risk: ${actionCount} well-understood actions addressing ${rootCauseCount} root cause(s) with high confidence evidence`;
			case "medium":
				return `Medium risk: ${actionCount} actions with some uncertainty in evidence confidence or complexity`;
			case "high":
				return `High risk: ${actionCount} actions with significant uncertainty or complex changes required`;
			case "critical":
				return `Critical risk: ${actionCount} actions with low-confidence evidence or critical root causes requiring careful review`;
		}
	}

	// -----------------------------------------------------------------------
	// Strategy Management
	// -----------------------------------------------------------------------

	/**
	 * Get a generated strategy by ID.
	 */
	getStrategy(id: string): PatchStrategy | undefined {
		return this.strategies.get(id);
	}

	/**
	 * Get all generated strategies.
	 */
	getAllStrategies(): PatchStrategy[] {
		return Array.from(this.strategies.values());
	}

	/**
	 * Clear all generated strategies.
	 */
	clearStrategies(): void {
		this.strategies.clear();
	}

	/**
	 * Get the count of generated strategies.
	 */
	get strategyCount(): number {
		return this.strategies.size;
	}

	// -----------------------------------------------------------------------
	// Strategy Ranking
	// -----------------------------------------------------------------------

	/**
	 * Rank multiple strategies by composite score.
	 *
	 * Evaluates coverage, risk, effort, and confidence to produce a
	 * ranked list with the most promising strategy first.
	 *
	 * @returns Array of StrategyRank objects sorted by score descending.
	 */
	rankStrategies(): StrategyRank[] {
		const strategies = this.getAllStrategies();
		const confidences: Record<string, number> = { high: 4, medium: 3, low: 2, speculative: 1 };
		const riskScores: Record<RiskLevel, number> = { low: 100, medium: 70, high: 40, critical: 10 };

		const ranks: StrategyRank[] = strategies.map((s) => {
			const avgActionConfidence =
				s.actions.length > 0
					? s.actions.reduce((sum, a) => sum + (confidences[a.confidence] ?? 0), 0) / s.actions.length
					: 0;

			// Coverage: how many evidence summary IDs were used
			const coverage = Math.min(s.evidenceSummaryIds.length * 20, 100);

			// Risk: inverted so higher = safer
			const risk = riskScores[s.riskLevel];

			// Effort: inverted so higher = faster
			const effort = Math.max(0, 100 - Math.min(s.estimatedEffortMinutes / 2, 100));

			// Confidence: average action confidence scaled to 0-100
			const confidenceScore = (avgActionConfidence / 4) * 100;

			// Composite: weighted average
			const score = Math.round(coverage * 0.25 + risk * 0.3 + effort * 0.15 + confidenceScore * 0.3);

			return {
				strategyId: s.id,
				score,
				dimensions: {
					coverage: Math.round(coverage),
					risk: Math.round(risk),
					effort: Math.round(effort),
					confidence: Math.round(confidenceScore),
				},
			};
		});

		return ranks.sort((a, b) => b.score - a.score);
	}

	// -----------------------------------------------------------------------
	// Serialization
	// -----------------------------------------------------------------------

	/**
	 * Serialize a strategy to JSON.
	 */
	serializeStrategy(strategyId: string): string | null {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return null;
		return JSON.stringify(strategy, null, 2);
	}

	/**
	 * Serialize all strategies to JSON.
	 */
	serializeAll(): string {
		return JSON.stringify(this.getAllStrategies(), null, 2);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PatchStrategyGenerator with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new PatchStrategyGenerator instance.
 */
export function createPatchStrategyGenerator(config?: Partial<PatchStrategyGeneratorConfig>): PatchStrategyGenerator {
	return new PatchStrategyGenerator(config);
}
